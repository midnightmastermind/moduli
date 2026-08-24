// modules/pages/PageFolder.jsx
// Folder page — Explorer-style grid of PreviewNode cards with drilldown animation.
// Header mimics Windows 7 date picker: clicking scope label drills out,
// prev/next arrows navigate peer pages at the same depth.

import React, { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import PreviewNode from "../PreviewNode.jsx";
import useDrilldown, { getCardAnimStyle } from "../../hooks/useDrilldown.js";
import { useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { ensureArtifactPageOcc } from "../../helpers/importsFolder";

export default function PageFolder({
  childOccs,
  siblingOccs,
  dropRef,
  isOver,
  isMobileLayout,
  modulesById,
  panelView,
  folderPageOccId,
  dispatch,
  socket,
  autoNavigateTo,
  onAutoNavigateComplete,
}) {
  const folderRef = useRef(null);
  const { occurrencesById, fieldsById } = useGridActions();

  // F5-ext (2026-05-24) — search-in-folder. Filters cards by label OR
  // field values OR occurrence content. Defaults to all three scopes; the
  // dropdown lets the user narrow to a single scope.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all"); // "all" | "label" | "fields" | "content"
  const matchesSearch = useCallback((occ, mod) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (searchScope === "all" || searchScope === "label") {
      if ((mod?.label || "").toLowerCase().includes(q)) return true;
      if ((occ?.label || "").toLowerCase().includes(q)) return true;
    }
    if (searchScope === "all" || searchScope === "fields") {
      const fields = occ?.fields || {};
      for (const fid of Object.keys(fields)) {
        const slot = fields[fid];
        const v = slot && typeof slot === "object" ? slot.value : slot;
        if (v == null) continue;
        const str = typeof v === "string" ? v : (typeof v === "number" || typeof v === "boolean") ? String(v) : "";
        if (str.toLowerCase().includes(q)) return true;
        // Field NAME match — useful for "show me cards with a 'priority' field"
        const fname = fieldsById?.[fid]?.name || "";
        if (fname.toLowerCase().includes(q)) return true;
      }
    }
    if (searchScope === "all" || searchScope === "content") {
      // textmap is a TipTap JSON tree; flatten text nodes.
      const tm = occ?.textmap;
      if (tm && typeof tm === "object") {
        const stack = [tm];
        while (stack.length) {
          const n = stack.shift();
          if (!n) continue;
          if (typeof n.text === "string" && n.text.toLowerCase().includes(q)) return true;
          if (Array.isArray(n.content)) stack.push(...n.content);
        }
      }
    }
    return false;
  }, [searchQuery, searchScope, fieldsById]);
  const filteredChildOccs = useMemo(
    () => (childOccs || []).filter(occ => matchesSearch(occ, modulesById?.[occ.moduleId])),
    [childOccs, matchesSearch, modulesById]
  );

  // F4 — Grid/List layout toggle. Persisted on the folder page occurrence's
  // meta.viewLayout (grid is the default; list renders as compact rows). The
  // toggle survives across sessions because we write through CommitHelpers.
  const folderPageOcc = folderPageOccId ? occurrencesById?.[folderPageOccId] : null;
  const viewLayout = folderPageOcc?.meta?.viewLayout === "list" ? "list" : "grid";
  const setViewLayout = useCallback((mode) => {
    if (!folderPageOcc) return;
    if ((folderPageOcc.meta?.viewLayout || "grid") === mode) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: folderPageOcc.id, meta: { ...(folderPageOcc.meta || {}), viewLayout: mode } },
      emit: true,
    });
  }, [folderPageOcc, dispatch, socket]);

  // F3 — drag-reorder within the folder page. Persisted via the dragged
  // occurrence's sortOrder; we set it to the midpoint between the neighbors
  // on either side of the closest edge so neither neighbor needs to be
  // rewritten. This is the same midpoint-by-sortOrder pattern used by
  // ManifestTree's between-folder reorder (Apr 6 2026 / Mar 31 2026).
  const reorderToNeighbor = useCallback((draggedOccId, targetOccId, edge) => {
    if (!draggedOccId || !targetOccId || draggedOccId === targetOccId) return;
    const idx = childOccs.findIndex(o => o.id === targetOccId);
    if (idx < 0) return;
    const target = childOccs[idx];
    const before = edge === "top" || edge === "left";
    const neighborIdx = before ? idx - 1 : idx + 1;
    const neighbor = childOccs[neighborIdx] || null;
    const targetSort = target.sortOrder ?? idx;
    const neighborSort = neighbor ? (neighbor.sortOrder ?? neighborIdx) : (before ? targetSort - 2 : targetSort + 2);
    const newSort = (targetSort + neighborSort) / 2;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: draggedOccId, sortOrder: newSort },
      emit: true,
    });
  }, [childOccs, dispatch, socket]);

  // Briefly highlight cards that NEWLY appear in this folder — e.g. a fresh
  // import landing in the "Imports" folder (the user: "since the import folder
  // holds all the imports, highlight the new ones added just for a second").
  // First render seeds the seen-set WITHOUT flashing (opening a populated
  // folder shouldn't strobe every card); only ids that show up afterwards
  // pulse for ~1.3s. Generic — any folder page gets the affordance.
  const seenIdsRef = useRef(null);
  const flashTimersRef = useRef(new Map());
  const [flashIds, setFlashIds] = useState(() => new Set());
  useEffect(() => {
    const currentIds = (childOccs || []).map(o => o.id);
    const currentSet = new Set(currentIds);
    if (seenIdsRef.current === null) {
      seenIdsRef.current = currentSet; // seed silently on first render
      return;
    }
    const fresh = currentIds.filter(id => !seenIdsRef.current.has(id));
    seenIdsRef.current = currentSet;
    if (!fresh.length) return;
    setFlashIds(prev => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });
    for (const id of fresh) {
      const existing = flashTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        flashTimersRef.current.delete(id);
        setFlashIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1300);
      flashTimersRef.current.set(id, t);
    }
  }, [childOccs]);
  useEffect(() => () => {
    for (const t of flashTimersRef.current.values()) clearTimeout(t);
    flashTimersRef.current.clear();
  }, []);

  const handleNavigate = useCallback((occId) => {
    if (panelView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...panelView, activeOccurrenceId: occId }, emit: true });
    }
  }, [panelView, dispatch, socket]);

  const { animState, drilldownStack, startDrillDown, startDrillOut, navigatePeer, resetStack, canDrillOut } = useDrilldown({
    onNavigate: handleNavigate,
    containerRef: folderRef,
  });

  // Wrap startDrillDown to prime the folder into the stack when entering from a clean state.
  // Artifact cards (2026-07-12) drill into a full-screen ARTIFACT PAGE —
  // navigating the panel view straight to a bare artifact occurrence resolves
  // to no page and the panel snapped back to page 0.
  const handleDrillDown = useCallback((occId, cardEl) => {
    const occ = occurrencesById?.[occId];
    // Non-artifact cards return null and drill into the occurrence itself.
    const pageOccId = ensureArtifactPageOcc({
      artifactOccId: occId, occurrencesById, modulesById,
      gridId: occ?.gridId, userId: occ?.userId, dispatch, socket,
    });
    const targetId = pageOccId || occId;
    if (drilldownStack.length === 0 && folderPageOccId) {
      resetStack([folderPageOccId]);
    }
    startDrillDown(targetId, cardEl);
  }, [drilldownStack.length, folderPageOccId, resetStack, startDrillDown, occurrencesById, modulesById, dispatch, socket]);

  // Auto-drilldown when navigating from tree (folder-first flow)
  useEffect(() => {
    if (!autoNavigateTo) return;
    resetStack(folderPageOccId ? [folderPageOccId] : []);
    const timer = setTimeout(() => {
      const cardEl = folderRef.current?.querySelector(`[data-occurrence-id="${autoNavigateTo}"]`);
      startDrillDown(autoNavigateTo, cardEl || null);
      onAutoNavigateComplete?.();
    }, 10);
    return () => clearTimeout(timer);
  }, [autoNavigateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Peer navigation
  const currentDrilledId = canDrillOut ? drilldownStack[drilldownStack.length - 1] : null;
  const currentSiblingIndex = useMemo(() => {
    if (!currentDrilledId || !siblingOccs?.length) return -1;
    return siblingOccs.findIndex(o => o.id === currentDrilledId);
  }, [currentDrilledId, siblingOccs]);

  const handlePeerNav = useCallback((delta) => {
    if (!siblingOccs?.length || currentSiblingIndex < 0) return;
    const nextIndex = currentSiblingIndex + delta;
    if (nextIndex < 0 || nextIndex >= siblingOccs.length) return;
    navigatePeer(siblingOccs[nextIndex].id);
  }, [siblingOccs, currentSiblingIndex, navigatePeer]);

  // Keyboard: Escape = drill out, Left/Right = peer nav
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
      if (e.key === "Escape" && canDrillOut) { e.preventDefault(); startDrillOut(); }
      if (e.key === "ArrowLeft" && canDrillOut) { e.preventDefault(); handlePeerNav(-1); }
      if (e.key === "ArrowRight" && canDrillOut) { e.preventDefault(); handlePeerNav(1); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Scope header (Windows 7 breadcrumb + peer nav)
  const scopeLabels = useMemo(() => {
    return drilldownStack.map(occId => {
      const occ = occurrencesById[occId];
      const mod = occ ? modulesById[occ.moduleId] : null;
      return { occId, label: mod?.label || "…" };
    });
  }, [drilldownStack, occurrencesById, modulesById]);

  const scopeHeader = canDrillOut ? (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0, padding: "4px 8px 4px 18px",
      borderBottom: "1px solid var(--border-default)",
      background: "var(--surface-base)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, flex: 1, overflow: "hidden" }}>
        {scopeLabels.map((crumb, i) => {
          const isLast = i === scopeLabels.length - 1;
          return (
            <React.Fragment key={crumb.occId}>
              {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 12, flexShrink: 0 }}>›</span>}
              <span
                style={{
                  fontSize: 12, fontFamily: "var(--font-mono)",
                  color: isLast ? "var(--text-primary)" : "var(--accent-blue, #38bdf8)",
                  cursor: isLast ? "default" : "pointer",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: isLast ? "none" : "underline",
                  textDecorationColor: "rgba(56,189,248,0.4)",
                }}
                onClick={() => {
                  if (isLast) return;
                  const stepsOut = scopeLabels.length - 1 - i;
                  for (let s = 0; s < stepsOut; s++) startDrillOut();
                }}
                title={isLast ? undefined : `Back to ${crumb.label}`}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {/* F4 — Grid/List toggle. Always visible; persists per-folder. */}
      <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, marginLeft: 8 }} role="group" aria-label="Folder layout">
        <button
          onClick={() => setViewLayout("grid")}
          aria-pressed={viewLayout === "grid"}
          title="Grid layout"
          style={{
            background: viewLayout === "grid" ? "var(--input-bg)" : "transparent",
            border: "1px solid var(--border-subtle)", borderRadius: 3,
            cursor: "pointer", color: "var(--text-muted)",
            padding: "1px 4px", display: "flex", alignItems: "center",
          }}
        >
          <LayoutGrid size={11} />
        </button>
        <button
          onClick={() => setViewLayout("list")}
          aria-pressed={viewLayout === "list"}
          title="List layout"
          style={{
            background: viewLayout === "list" ? "var(--input-bg)" : "transparent",
            border: "1px solid var(--border-subtle)", borderRadius: 3,
            cursor: "pointer", color: "var(--text-muted)",
            padding: "1px 4px", display: "flex", alignItems: "center",
          }}
        >
          <List size={11} />
        </button>
      </div>
      {siblingOccs?.length > 1 && currentSiblingIndex >= 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, marginLeft: 8 }}>
          <button
            onClick={() => handlePeerNav(-1)}
            disabled={currentSiblingIndex <= 0}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex <= 0 ? "default" : "pointer",
              color: currentSiblingIndex <= 0 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", userSelect: "none" }}>
            {currentSiblingIndex + 1}/{siblingOccs.length}
          </span>
          <button
            onClick={() => handlePeerNav(1)}
            disabled={currentSiblingIndex >= siblingOccs.length - 1}
            style={{
              background: "none", border: "none", cursor: currentSiblingIndex >= siblingOccs.length - 1 ? "default" : "pointer",
              color: currentSiblingIndex >= siblingOccs.length - 1 ? "var(--text-faint)" : "var(--text-muted)",
              padding: "1px 2px", display: "flex", alignItems: "center",
            }}
            title="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={(node) => {
        folderRef.current = node;
        if (dropRef) dropRef.current = node;
      }}
      style={{
        flex: 1, minHeight: 0,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        outline: isOver ? "2px solid rgba(50,150,255,0.5)" : "none",
        outlineOffset: -2,
        position: "relative",
      }}
    >
      {scopeHeader}
      {/* F5-ext search bar — filters cards by label / fields / content. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        padding: "4px 8px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-base)",
      }}>
        <Search size={11} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search folder"
          style={{
            flex: 1, minWidth: 0,
            background: "transparent",
            border: "none", outline: "none",
            color: "var(--text-primary)",
            fontSize: 12, fontFamily: "var(--font-mono)",
          }}
        />
        <select
          value={searchScope}
          onChange={(e) => setSearchScope(e.target.value)}
          aria-label="Search scope"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--border-subtle)", borderRadius: 3,
            color: "var(--text-muted)",
            fontSize: 12, padding: "1px 3px",
            fontFamily: "var(--font-mono)",
          }}
        >
          <option value="all">All</option>
          <option value="label">Label</option>
          <option value="fields">Fields</option>
          <option value="content">Content</option>
        </select>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--text-faint)", fontSize: 12, padding: "0 4px",
            }}
            title="Clear search"
          >×</button>
        )}
      </div>
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        padding: isMobileLayout ? "8px 8px 80px 8px" : "0px 0px 80px 0px",
      }}>
        <div className={viewLayout === "list" ? "preview-node-list" : "preview-node-grid"}>
          {filteredChildOccs.map((occ, i) => {
            const mod = modulesById[occ.moduleId];
            return (
              <FolderItem
                key={occ.id}
                occ={occ}
                mod={mod}
                index={i}
                viewLayout={viewLayout}
                onDrillDown={handleDrillDown}
                onReorder={reorderToNeighbor}
                isAnimating={!!animState}
                autoNavigateTo={autoNavigateTo}
                animState={animState}
                isNew={flashIds.has(occ.id)}
              />
            );
          })}
          {filteredChildOccs.length === 0 && (
            <div className="text-xs text-muted-foreground text-center empty-placeholder" style={{ gridColumn: "1 / -1" }}>
              {searchQuery.trim() ? `No matches for "${searchQuery}"` : "Drop items here"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// F3 + F4 — per-card wrapper. Owns the dropTargetForElements for reorder
// (closest-edge top/left = drop before, bottom/right = drop after) and
// switches between the existing PreviewNode card render (grid) and a
// compact row render (list). Row mode renders directly here so PreviewNode
// stays a pure card.
function FolderItem({ occ, mod, index, viewLayout, onDrillDown, onReorder, isAnimating, autoNavigateTo, animState, isNew }) {
  const wrapRef = useRef(null);
  const [edgeHint, setEdgeHint] = useState(null); // "top" | "bottom" | "left" | "right" | null

  useEffect(() => {
    if (!wrapRef.current) return;
    return dropTargetForElements({
      element: wrapRef.current,
      canDrop: ({ source }) => {
        const s = source?.data || {};
        // Accept any module/occurrence drag whose payload has an occurrenceId
        // (folder-node drags are the canonical case, but instance + container
        // drags from elsewhere on the grid should reorder too).
        return !!s.occurrenceId && s.occurrenceId !== occ.id;
      },
      getData: ({ input, element }) => attachClosestEdge(
        { type: "folder-item", occurrenceId: occ.id, index },
        { input, element, allowedEdges: viewLayout === "list" ? ["top", "bottom"] : ["top", "bottom", "left", "right"] }
      ),
      onDragEnter: ({ self }) => setEdgeHint(extractClosestEdge(self.data) || null),
      onDrag: ({ self }) => setEdgeHint(extractClosestEdge(self.data) || null),
      onDragLeave: () => setEdgeHint(null),
      onDrop: ({ source, self }) => {
        const draggedOccId = source?.data?.occurrenceId;
        const edge = extractClosestEdge(self.data);
        setEdgeHint(null);
        if (draggedOccId && edge) onReorder?.(draggedOccId, occ.id, edge);
      },
    });
  }, [occ.id, index, viewLayout, onReorder]);

  if (viewLayout === "list") {
    const role = mod?.role || "instance";
    const kind = mod?.kind || null;
    const label = mod?.label || occ?.label || "Untitled";
    const size = mod?.meta?.uploadSize;
    const fmtSize = (n) => {
      if (!n) return "—";
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    };
    const updated = occ?.updatedAt || mod?.updatedAt;
    const date = updated ? new Date(updated).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
    const glyph = kind === "folder" ? "📁" : (role === "page" ? "📄" : (role === "artifact" ? "📎" : "•"));
    return (
      <div
        ref={wrapRef}
        data-occurrence-id={occ.id}
        onClick={() => onDrillDown?.(occ.id, wrapRef.current)}
        className={isNew ? "preview-node-list-row preview-node-flash" : "preview-node-list-row"}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "20px 1fr auto auto",
          alignItems: "center",
          gap: 10,
          padding: "5px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          cursor: "pointer",
          background: "transparent",
          ...getCardAnimStyle(occ.id, animState),
        }}
      >
        <span style={{ fontSize: 12 }}>{glyph}</span>
        <span style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          {fmtSize(size)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          {date}
        </span>
        {edgeHint === "top" && <div style={{ position: "absolute", left: 0, right: 0, top: -1, height: 2, background: "var(--accent-blue, #38bdf8)" }} />}
        {edgeHint === "bottom" && <div style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2, background: "var(--accent-blue, #38bdf8)" }} />}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={isNew ? "preview-node-flash" : undefined} style={{ position: "relative" }}>
      <PreviewNode
        occurrence={occ}
        module={mod}
        onDrillDown={onDrillDown}
        isAnimating={isAnimating}
        loadPreview={autoNavigateTo ? occ.id === autoNavigateTo : true}
        loadIndex={index}
        style={getCardAnimStyle(occ.id, animState)}
      />
      {edgeHint === "left" && <div style={{ position: "absolute", left: -1, top: 4, bottom: 4, width: 2, background: "var(--accent-blue, #38bdf8)" }} />}
      {edgeHint === "right" && <div style={{ position: "absolute", right: -1, top: 4, bottom: 4, width: 2, background: "var(--accent-blue, #38bdf8)" }} />}
      {edgeHint === "top" && <div style={{ position: "absolute", left: 4, right: 4, top: -1, height: 2, background: "var(--accent-blue, #38bdf8)" }} />}
      {edgeHint === "bottom" && <div style={{ position: "absolute", left: 4, right: 4, bottom: -1, height: 2, background: "var(--accent-blue, #38bdf8)" }} />}
    </div>
  );
}
