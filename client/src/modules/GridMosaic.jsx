// GridMosaic.jsx — renderer for the opt-in BSP / "mosaic" panel layout.
//
// When a grid carries `grid.meta.layoutTree`, GridInner renders this instead of
// the rows×cols GridRender. Panes are absolutely positioned from the tree; the
// splitter bars between sibling panes resize INDEPENDENTLY on each axis (the
// whole point — resizing a row split in the right column never touches the left
// column). Drag a panel onto another pane's edge to re-split the layout.
//
// Pure tree math lives in helpers/bspTree.js (unit-tested). This component owns
// only the React/DOM/persistence/DnD glue.

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

import Panel from "./ModulePanel";
import ErrorBoundary from "../ui/ErrorBoundary";
import { DragType } from "../helpers/dragSystem";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  computeLayout, resizeSplit, removeLeaf, splitLeaf, allPanelOccIds, makeLeaf,
} from "../helpers/bspTree";

// Coarse pointers (tablet/phone) get a finger-sized splitter band — the 6px
// desktop band was nearly impossible to hit, so touch presses landed on the
// pane underneath and opened its long-press menu instead of resizing.
// Static per load: pointer coarseness doesn't change at runtime.
const IS_COARSE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
const SPLITTER = IS_COARSE ? 28 : 6; // px hit band (visual nub styled separately)

export default function GridMosaic({
  gridRef,
  panelsRender,
  grid,
  dispatch,
  socket,
  fullscreenPanelId,
  setFullscreenPanelId,
  addContainerToPanel,
  addInstanceToContainer,
  sizesRef,
}) {
  const gridId = grid?._id || grid?.id;

  // panelOccId → panel module object (same shape Grid.jsx builds).
  const panelByOccId = useMemo(() => {
    const m = Object.create(null);
    for (const p of panelsRender || []) if (p?._occurrenceId) m[p._occurrenceId] = p;
    return m;
  }, [panelsRender]);

  // Local tree, seeded from grid.meta.layoutTree, re-synced when it changes
  // server-side. treeRef mirrors it for synchronous handler reads.
  const [tree, setTree] = useState(() => grid?.meta?.layoutTree || null);
  const treeRef = useRef(tree);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  useEffect(() => {
    const next = grid?.meta?.layoutTree || null;
    setTree((prev) => (sameTree(prev, next) ? prev : next));
  }, [grid?.meta?.layoutTree]);

  const persist = useCallback((nextTree) => {
    if (!gridId) return;
    CommitHelpers.updateGrid({
      dispatch, socket, gridId,
      grid: { meta: { ...(grid?.meta || {}), layoutTree: nextTree } },
      emit: true,
    });
  }, [gridId, dispatch, socket, grid?.meta]);

  // Measure the container so we can compute pixel rects.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rootRef = useRef(null);
  const setRefs = useCallback((node) => {
    rootRef.current = node;
    if (gridRef) gridRef.current = node;
  }, [gridRef]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { panes, splitters } = useMemo(
    () => computeLayout(tree, { x: 0, y: 0, w: size.w, h: size.h }, SPLITTER),
    [tree, size.w, size.h]
  );

  // Keep the tree in sync with the AUTHORITATIVE panel set — grid.occurrences
  // (the grid record's panel-occurrence id list):
  //   • PRUNE leaves whose id left grid.occurrences ("Remove from grid").
  //   • ADD ids in grid.occurrences missing from the tree (+Panel button) by
  //     splitting the largest pane.
  // MUST NOT key off the rendered/visible panel set: filters and hydration can
  // make it transiently PARTIAL, and a reconcile against a partial set prunes
  // live panels then re-adds them as largest-pane splits — permanently
  // scrambling the persisted tree (this corrupted the seeded Live Grid into a
  // 4-column split, 2026-07-04). A filtered-out panel keeps its pane (renders
  // empty — same semantic as a hidden panel's reserved rows×cols cell).
  useEffect(() => {
    if (!tree || size.w === 0) return;
    const liveIds = Array.isArray(grid?.occurrences) ? grid.occurrences : null;
    if (!liveIds || liveIds.length === 0) return;
    const liveSet = new Set(liveIds);
    const inTree = new Set(allPanelOccIds(tree));
    const dead = [...inTree].filter((id) => !liveSet.has(id));
    const added = liveIds.filter((id) => !inTree.has(id));
    if (dead.length === 0 && added.length === 0) return;

    let next = tree;
    for (const d of dead) next = removeLeaf(next, d);
    for (const a of added) {
      if (!next) { next = makeLeaf(a); continue; }
      const { panes: cur } = computeLayout(next, { x: 0, y: 0, w: size.w, h: size.h });
      let largest = cur[0];
      for (const p of cur) {
        if (p.rect.w * p.rect.h > (largest ? largest.rect.w * largest.rect.h : 0)) largest = p;
      }
      if (!largest) { next = makeLeaf(a); continue; }
      const dir = largest.rect.w >= largest.rect.h ? "v" : "h"; // split the longer side
      next = splitLeaf(next, largest.leafId, dir, a, false);
    }
    if (!next) return; // never persist an empty tree
    setTree(next);
    persist(next);
  }, [tree, grid?.occurrences, size.w, size.h, persist]);

  // ---- splitter drag → resizeSplit ----------------------------------------
  const startSplitterDrag = useCallback((e, splitter) => {
    e.preventDefault();
    e.stopPropagation();
    const baseTree = treeRef.current;
    const startX = clientX(e);
    const startY = clientY(e);

    const move = (ev) => {
      ev.preventDefault();
      const px = splitter.dir === "v" ? clientX(ev) - startX : clientY(ev) - startY;
      const frDelta = (px / (splitter.axisExtentPx || 1)) * (splitter.ratioTotal || 1);
      setTree(resizeSplit(baseTree, splitter.splitId, splitter.index, frDelta));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("touchcancel", stop);
      persist(treeRef.current);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", stop);
    // Without this, an OS-interrupted gesture (notification shade, palm)
    // stranded the listeners — "works once then dead" (same bug class as the
    // rows×cols track resizers).
    window.addEventListener("touchcancel", stop);
  }, [persist]);

  // ---- drag a panel onto a pane edge → re-split ----------------------------
  const handlePaneDrop = useCallback((draggedOccId, targetLeafId, edge) => {
    if (!draggedOccId || !targetLeafId || !edge) return;
    const cur = treeRef.current;
    if (!cur) return;
    const targetLeaf = findLeafById(cur, targetLeafId);
    if (!targetLeaf || targetLeaf.panelOccId === draggedOccId) return; // self-drop
    const dir = edge === "left" || edge === "right" ? "v" : "h";
    const before = edge === "left" || edge === "top";
    // Pull the dragged pane out of its old spot (no-op if it's a new panel not
    // yet in the tree), then split the target pane and drop it in.
    let next = removeLeaf(cur, draggedOccId) || cur;
    next = splitLeaf(next, targetLeafId, dir, draggedOccId, before);
    setTree(next);
    persist(next);
  }, [persist]);

  return (
    <div
      ref={setRefs}
      className={["bg-background2 shadow-inner rounded-xl border border-border ring-1 ring-black/30",
        fullscreenPanelId !== null ? "pointer-events-none opacity-0" : ""].join(" ")}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", boxSizing: "border-box", transition: "opacity 0.15s ease" }}
    >
      {panes.map((pane) => {
        const panel = panelByOccId[pane.panelOccId];
        if (!panel) return null;
        return (
          <MosaicPane
            key={pane.panelOccId}
            pane={pane}
            panel={panel}
            dispatch={dispatch}
            socket={socket}
            fullscreenPanelId={fullscreenPanelId}
            setFullscreenPanelId={setFullscreenPanelId}
            addContainerToPanel={addContainerToPanel}
            addInstanceToContainer={addInstanceToContainer}
            sizesRef={sizesRef}
            onPaneDrop={handlePaneDrop}
          />
        );
      })}

      {splitters.map((s) => (
        <div
          key={s.id}
          data-dnd-handle="true"
          onMouseDown={(e) => startSplitterDrag(e, s)}
          onTouchStart={(e) => startSplitterDrag(e, s)}
          style={{
            position: "absolute",
            left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h,
            cursor: s.dir === "v" ? "col-resize" : "row-resize",
            zIndex: 30,
            display: "flex", alignItems: "center", justifyContent: "center",
            // Claim the gesture — React's onTouchStart is passive, so its
            // preventDefault can't stop the browser turning the drag into a
            // page scroll (→ touchcancel → "resize doesn't work on tablet").
            touchAction: "none",
          }}
        >
          <div style={{
            background: IS_COARSE ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.18)",
            borderRadius: 3,
            width: s.dir === "v" ? (IS_COARSE ? 5 : 2) : (IS_COARSE ? 44 : 18),
            height: s.dir === "v" ? (IS_COARSE ? 44 : 18) : (IS_COARSE ? 5 : 2),
          }} />
        </div>
      ))}
    </div>
  );
}

// A single pane: positioned wrapper + the panel filling it + a Pragmatic drop
// target that accepts panel drags (closest edge → split direction).
function MosaicPane({ pane, panel, dispatch, socket, fullscreenPanelId, setFullscreenPanelId, addContainerToPanel, addInstanceToContainer, sizesRef, onPaneDrop }) {
  const ref = useRef(null);
  const [edgeHint, setEdgeHint] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const d = source?.data;
        return d?.type === DragType.PANEL && d?.data?._occurrenceId && d.data._occurrenceId !== pane.panelOccId;
      },
      getData: ({ input, element }) => attachClosestEdge(
        { mosaicLeafId: pane.leafId },
        { input, element, allowedEdges: ["top", "bottom", "left", "right"] }
      ),
      onDragEnter: ({ self }) => setEdgeHint(extractClosestEdge(self.data)),
      onDrag: ({ self }) => setEdgeHint(extractClosestEdge(self.data)),
      onDragLeave: () => setEdgeHint(null),
      onDrop: ({ source, self }) => {
        const edge = extractClosestEdge(self.data);
        setEdgeHint(null);
        onPaneDrop?.(source?.data?.data?._occurrenceId, pane.leafId, edge);
      },
    });
  }, [pane.leafId, pane.panelOccId, onPaneDrop]);

  return (
    <div
      ref={ref}
      data-mosaic-pane={pane.panelOccId}
      style={{ position: "absolute", left: pane.rect.x, top: pane.rect.y, width: pane.rect.w, height: pane.rect.h, padding: 3, boxSizing: "border-box" }}
    >
      <ErrorBoundary label={panel.label || "Panel"}>
        <Panel
          module={panel}
          mosaic
          dispatch={dispatch}
          socket={socket}
          addContainerToPanel={addContainerToPanel}
          addInstanceToContainer={addInstanceToContainer}
          sizesRef={sizesRef}
          fullscreenPanelId={fullscreenPanelId}
          setFullscreenPanelId={setFullscreenPanelId}
        />
      </ErrorBoundary>
      {edgeHint && <EdgeHint edge={edgeHint} />}
    </div>
  );
}

function EdgeHint({ edge }) {
  const base = { position: "absolute", background: "rgba(56,189,248,0.5)", zIndex: 40, pointerEvents: "none", borderRadius: 3 };
  const half = { left: "50%", top: "50%" };
  const style =
    edge === "left" ? { ...base, left: 2, top: 6, bottom: 6, width: 4 } :
    edge === "right" ? { ...base, right: 2, top: 6, bottom: 6, width: 4 } :
    edge === "top" ? { ...base, top: 2, left: 6, right: 6, height: 4 } :
    edge === "bottom" ? { ...base, bottom: 2, left: 6, right: 6, height: 4 } : half;
  return <div style={style} />;
}

// --- small utils ---
function clientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
function clientY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

function findLeafById(node, leafId) {
  if (!node) return null;
  if (!Array.isArray(node.children)) return node.id === leafId ? node : null;
  for (const c of node.children) { const f = findLeafById(c, leafId); if (f) return f; }
  return null;
}

// Cheap structural identity check so a server echo of the same tree doesn't
// stomp an in-flight local drag.
function sameTree(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
