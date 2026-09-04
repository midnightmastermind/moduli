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
import { dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

import Panel from "./ModulePanel";
import ErrorBoundary from "../ui/ErrorBoundary";
import { DragType } from "../helpers/dragSystem";
import * as CommitHelpers from "../helpers/CommitHelpers";
import {
  computeLayout, resizeSplit, removeLeaf, splitLeaf, allPanelOccIds, makeLeaf,
} from "../helpers/bspTree";
import { regionOf, snapLeaf, zoneAt } from "../helpers/mosaicSnap";

// Coarse pointers (tablet/phone) get a finger-sized splitter band — the 6px
// desktop band was nearly impossible to hit, so touch presses landed on the
// pane underneath and opened its long-press menu instead of resizing.
// Static per load: pointer coarseness doesn't change at runtime.
const IS_COARSE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
const SPLITTER = IS_COARSE ? 28 : 6; // px hit band (visual nub styled separately)

// How deep the perimeter snap band reaches in from the grid's outer edge. Wide
// enough to aim at with a dragged panel, narrow enough that the middle of every
// pane still belongs to the pane (that drop is what builds nested layouts).
const SNAP_BAND = 48;

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

  // PERIMETER SNAP. A band around the grid's outer edge means "give this panel
  // a region of the WHOLE grid". Inside the band, drops keep resolving against
  // the pane under the pointer — that is how you say "below Routines
  // specifically", and it is the gesture that builds nested layouts.
  const handlePerimeterDrop = useCallback((draggedOccId, zone) => {
    if (!draggedOccId || !zone) return;
    const cur = treeRef.current;
    if (!cur) return;
    // A quadrant is the half followed by the perpendicular press — the same two
    // steps the keyboard takes, so there is one definition of a quadrant.
    let next = snapLeaf(cur, draggedOccId, zone.direction) || cur;
    if (zone.quadrant) next = snapLeaf(next, draggedOccId, zone.quadrant) || next;
    if (next === cur) return;
    setTree(next);
    persist(next);
  }, [persist]);

  // The band is MOUNTED ONLY WHILE A PANEL IS BEING DRAGGED. At rest it would
  // sit over the outermost 48px of every edge pane and swallow splitter grabs
  // and panel clicks there — and the styling's own promise is that it must not
  // read as a frame when nothing is happening.
  const [dragOccId, setDragOccId] = useState(null);
  useEffect(() => monitorForElements({
    canMonitor: ({ source }) => source?.data?.type === DragType.PANEL,
    onDragStart: ({ source }) => setDragOccId(source?.data?.data?._occurrenceId || null),
    onDrop: () => setDragOccId(null),
  }), []);

  return (
    <div
      ref={setRefs}
      // `grid-surface` is THE grid's own background layer — the thing the
      // wallpaper paints on. It is not `.grid-frame`: that is App's padding
      // wrapper, and this div covers 99.9% of it opaquely, so a wallpaper on
      // the frame is invisible (measured — 1598x968 inside 1600x970). The
      // rows x cols renderer carries the same class for the same reason.
      className={["grid-surface bg-background2 shadow-inner rounded-xl border border-border ring-1 ring-black/30",
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
          {/* THE SEAM LINE. This was an 18px NUB at 18% white floating in the
              middle of the splitter — so a column boundary was marked by a short
              tick rather than a line, which is what read as "no grid lines"
              (user, 2026-08-17: "make the grid lines more pronounced … thicker
              gray boarder lines").

              It now spans the FULL length of the seam and uses the shared
              `--grid-line` gray, so the seams and the outer frame match.
              THICKNESS IS STILL SEPARATE FROM THE GRAB AREA: the parent div's
              rect is the hit target and is unchanged — only this child is
              painted, so a 3px line does not make the splitter 3px to grab.
              Coarse pointers keep their fatter line for the same reason they
              keep a fatter lane. */}
          <div style={{
            background: "var(--grid-line, rgba(160,170,182,0.55))",
            borderRadius: 2,
            width: s.dir === "v" ? (IS_COARSE ? 5 : 3) : "100%",
            height: s.dir === "v" ? "100%" : (IS_COARSE ? 5 : 3),
          }} />
        </div>
      ))}

      {dragOccId && (
        <SnapBand
          rootRef={rootRef}
          size={size}
          tree={tree}
          dragOccId={dragOccId}
          onSnapDrop={handlePerimeterDrop}
        />
      )}
    </div>
  );
}

// The perimeter band: four edge strips, each a drop target, plus a preview of
// the region the drop would produce.
//
// FOUR STRIPS RATHER THAN ONE FULL-SIZE OVERLAY, because a full-size overlay
// would be the element under the pointer everywhere and would steal the
// interior drops that split a pane. The interior has no element at all here.
function SnapBand({ rootRef, size, tree, dragOccId, onSnapDrop }) {
  const [zone, setZone] = useState(null);

  // The region a drop RIGHT NOW would land in — READ BACK OFF THE RESULTING
  // TREE, not off the zone the pointer is in. Those differ whenever a quadrant
  // degrades: aiming at the top-right corner when the complement has no rows to
  // partition lands the panel in the top HALF, and a preview drawn from the
  // zone would outline a quadrant the drop cannot produce (measured on the live
  // grid, 2026-09-04). Null when nothing would move at all.
  const preview = useMemo(() => {
    if (!zone || !tree || !dragOccId) return null;
    let next = snapLeaf(tree, dragOccId, zone.direction) || tree;
    if (zone.quadrant) next = snapLeaf(next, dragOccId, zone.quadrant) || next;
    if (next === tree) return null;
    return regionRect(regionOf(next, dragOccId), size.w, size.h);
  }, [zone, tree, dragOccId, size.w, size.h]);

  const strips = useMemo(() => ([
    { key: "top", style: { left: 0, top: 0, width: "100%", height: SNAP_BAND } },
    { key: "bottom", style: { left: 0, bottom: 0, width: "100%", height: SNAP_BAND } },
    { key: "left", style: { left: 0, top: 0, width: SNAP_BAND, height: "100%" } },
    { key: "right", style: { right: 0, top: 0, width: SNAP_BAND, height: "100%" } },
  ]), []);

  return (
    <>
      {strips.map((s) => (
        <SnapStrip
          key={s.key}
          style={s.style}
          rootRef={rootRef}
          size={size}
          onZone={setZone}
          onSnapDrop={onSnapDrop}
        />
      ))}
      {preview && <div className="mosaic-snap-zone" style={{ ...preview, zIndex: 45 }} />}
    </>
  );
}

function SnapStrip({ style, rootRef, size, onZone, onSnapDrop }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The zone is resolved from the pointer against the GRID's rect, not this
    // strip's — a corner sits in two strips and both must answer the same
    // quadrant, which only holds if they measure from the same origin.
    const zoneFor = (input) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return null;
      return zoneAt({ x: input.clientX - r.left, y: input.clientY - r.top, w: size.w, h: size.h, band: SNAP_BAND });
    };
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source?.data?.type === DragType.PANEL && !!source?.data?.data?._occurrenceId,
      onDragEnter: ({ location }) => onZone(zoneFor(location.current.input)),
      onDrag: ({ location }) => onZone(zoneFor(location.current.input)),
      onDragLeave: () => onZone(null),
      onDrop: ({ source, location }) => {
        const z = zoneFor(location.current.input);
        onZone(null);
        onSnapDrop?.(source?.data?.data?._occurrenceId, z);
      },
    });
  }, [rootRef, size.w, size.h, onZone, onSnapDrop]);

  return <div ref={ref} style={{ position: "absolute", zIndex: 50, ...style }} />;
}

// Where the preview rectangle goes for a REGION (the output of `regionOf`).
// Presentation only, and deliberately fed from the tree the drop would produce
// so it cannot promise a region the snap will not deliver.
function regionRect(region, w, h) {
  if (!region) return null;
  return {
    position: "absolute",
    left: region.col === "right" ? w / 2 : 0,
    top: region.row === "bottom" ? h / 2 : 0,
    width: region.col === "full" ? w : w / 2,
    height: region.row === "full" ? h : h / 2,
  };
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
