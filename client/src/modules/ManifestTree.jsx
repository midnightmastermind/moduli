// modules/ManifestTree.jsx
// Sidebar tree for notebook/artifact panels. Shows folder hierarchy + doc occurrences.
// Selecting a doc row calls updateView({ activeOccurrenceId }) so the content pane updates.
// Selecting an anchor chip calls updateView({ activeOccurrenceId: parentOccId, scrollAnchor: heading })
// so the parent doc stays open and scrolls to that heading.
import { useContext, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { ChevronRight } from "lucide-react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { hexToRgba } from "../helpers/colorHelpers.js";

// Extract first heading text from a TipTap textmap — strips markdown, ignores field pills
function getDocHeading(textmap) {
  if (!textmap?.content) return null;
  for (const node of textmap.content) {
    if (node.type === "heading" && node.content?.length > 0) {
      const text = node.content
        .filter(n => n.type === "text")
        .map(n => n.text || "")
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

// ─── DocNode — occurrence item ──────────────────────────────────────────────
// isAnchor=false: renders as a clickable file row (opens the doc)
// isAnchor=true: renders as a small anchor chip (scrolls to heading in parent doc)
function DocNode({ occ, depth, isAnchor, parentOccId, occurrencesById, modulesById, activeOccurrenceId, onSelect, onScrollTo, collapseGen = 0, onSetDefault, defaultOccurrenceId }) {
  const childOccs = useMemo(() =>
    Object.values(occurrencesById ?? {})
      .filter(o => o.parentId === occ.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [occurrencesById, occ.id]
  );
  const [open, setOpen] = useState(true);
  const [childCollapseGen, setChildCollapseGen] = useState(0);
  // When parent collapses and re-opens, children start collapsed
  const [lastGen, setLastGen] = useState(collapseGen);
  if (collapseGen !== lastGen) {
    setLastGen(collapseGen);
    if (open) setOpen(false);
  }
  const toggleOpen = useCallback(() => {
    setOpen(v => {
      if (v) setChildCollapseGen(g => g + 1); // closing → bump gen so children collapse
      return !v;
    });
  }, []);
  const rowRef = useRef(null);
  const hasChildren = childOccs.length > 0;
  const mod = modulesById?.[occ.targetId];
  const label = mod?.label || occ.id;
  const heading = getDocHeading(occ.textmap);
  const displayLabel = heading || label;
  const isActive = occ.id === activeOccurrenceId;
  const indent = depth * 4;

  // Draggable file rows (not anchors)
  useEffect(() => {
    if (isAnchor || !rowRef.current) return;
    return draggable({
      element: rowRef.current,
      getInitialData: () => ({ type: "artifact", occurrenceId: occ.id, parentId: occ.parentId }),
    });
  }, [isAnchor, occ.id, occ.parentId]);

  // Anchor chip (child of a doc) — clicking scrolls parent doc to this container card
  if (isAnchor) {
    const contMod = modulesById?.[occ.targetId];
    const rawColor = contMod?.ownStyle?.bg || null;
    const chipBg     = hexToRgba(rawColor, isActive ? 0.22 : 0.14) ?? (isActive ? "rgba(134,239,172,0.16)" : "rgba(134,239,172,0.10)");
    const chipBorder = hexToRgba(rawColor, isActive ? 0.6  : 0.42) ?? (isActive ? "rgba(134,239,172,0.5)"  : "rgba(134,239,172,0.32)");
    const chipColor  = hexToRgba(rawColor, isActive ? 1.0  : 0.92) ?? (isActive ? "rgba(134,239,172,1)"    : "rgba(134,239,172,0.82)");
    return (
      <div>
        <div style={{ paddingLeft: 6 + indent, paddingRight: 4, paddingTop: 1, paddingBottom: 2, display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}>
          {/* Toggle arrow — only shown when there are children */}
          {hasChildren ? (
            <span
              onClick={toggleOpen}
              style={{ fontSize: 8, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, width: 10, textAlign: "center", userSelect: "none" }}
            >
              {open ? "▾" : "▸"}
            </span>
          ) : (
            <span style={{ width: 8, flexShrink: 0 }} />
          )}
          {/* Chip pill — navigate to this anchor */}
          <div
            onClick={() => onScrollTo(parentOccId, occ.id)}
            title={displayLabel}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "1px 5px 1px 4px",
              borderRadius: 999,
              border: `1px solid ${chipBorder}`,
              background: chipBg,
              cursor: "pointer",
              fontSize: 11,
              color: chipColor,
              userSelect: "none",
              maxWidth: 100,
              overflow: "hidden",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayLabel}
            </span>
          </div>
        </div>
        {hasChildren && (
          <div style={{ display: open ? "block" : "none" }}>
            {childOccs.map(co => (
              <DocNode
                key={co.id}
                occ={co}
                depth={depth + 1}
                isAnchor={true}
                parentOccId={parentOccId}
                occurrencesById={occurrencesById}
                modulesById={modulesById}
                activeOccurrenceId={activeOccurrenceId}
                onSelect={onSelect}
                onScrollTo={onScrollTo}
                collapseGen={childCollapseGen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File row (direct child of folder) — clicking opens this doc
  return (
    <div>
      <div
        ref={rowRef}
        onClick={() => onSelect(occ.id)}
        onContextMenu={(e) => { if (onSetDefault) { e.preventDefault(); onSetDefault(occ.id); } }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          paddingLeft: 6 + indent,
          paddingRight: 4,
          paddingTop: 1,
          paddingBottom: 1,
          cursor: "pointer",
          fontSize: 12,
          color: isActive ? "rgba(100,180,255,1)" : "var(--text-primary)",
          background: isActive ? "rgba(100,180,255,0.12)" : "transparent",
          borderRadius: 3,
          userSelect: "none",
          fontWeight: isActive ? 500 : 400,
        }}
      >
        <span
          style={{ fontSize: 9, color: "var(--text-faint)", width: 10, textAlign: "center", cursor: hasChildren ? "pointer" : "default", flexShrink: 0 }}
          onClick={hasChildren ? (e) => { e.stopPropagation(); toggleOpen(); } : undefined}
        >
          {hasChildren ? (open ? "▾" : "▸") : "›"}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayLabel}
        </span>
        {defaultOccurrenceId === occ.id && (
          <span style={{ fontSize: 8, color: "var(--text-faint)", flexShrink: 0 }} title="Default page">&#x1F4CC;</span>
        )}
      </div>
      {hasChildren && (
        <div style={{ display: open ? "block" : "none", paddingBottom: 6 }}>
          {childOccs.map(co => (
            <DocNode
              key={co.id}
              occ={co}
              depth={depth + 1}
              isAnchor={true}
              parentOccId={occ.id}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
              activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect}
              onScrollTo={onScrollTo}
              collapseGen={childCollapseGen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FolderNode ──────────────────────────────────────────────────────────────
function FolderNode({ folder, depth, foldersById, occurrencesById, modulesById, activeOccurrenceId, onSelect, onScrollTo, onSetDefault, defaultOccurrenceId }) {
  const { dispatch, socket, state } = useContext(GridActionsContext);
  const [open, setOpen] = useState(folder?.isExpanded !== false);
  const [isDragOver, setIsDragOver] = useState(false);
  const folderRef = useRef(null);

  const childFolders = useMemo(() =>
    Object.values(foldersById ?? {})
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [foldersById, folder.id]
  );

  const artifactOccs = useMemo(() =>
    Object.values(occurrencesById ?? {})
      .filter(occ => occ.parentId === folder.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [occurrencesById, folder.id]
  );

  // Drop target — accept artifact doc nodes dragged from tree
  useEffect(() => {
    if (!folderRef.current) return;
    return dropTargetForElements({
      element: folderRef.current,
      canDrop: ({ source }) => source.data.type === "artifact" && source.data.occurrenceId !== undefined,
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: ({ source }) => {
        setIsDragOver(false);
        const { occurrenceId } = source.data;
        if (!occurrenceId || !dispatch || !socket) return;
        // Append to end of this folder
        const maxOrder = artifactOccs.reduce((m, o) => Math.max(m, o.sortOrder ?? 0), -1);
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occurrenceId, parentId: folder.id, sortOrder: maxOrder + 1 },
          emit: true,
        });
        setOpen(true);
      },
    });
  }, [folder.id, artifactOccs, dispatch, socket]);

  const hasChildren = childFolders.length > 0 || artifactOccs.length > 0;
  const indent = depth * 4;

  const handleNewDoc = useCallback((e) => {
    e.stopPropagation();
    const userId = state?.userId;
    const gridId = state?.grid?._id;
    if (!userId || !gridId) return;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    const maxOrder = artifactOccs.reduce((m, o) => Math.max(m, o.sortOrder ?? 0), -1);
    // Create module + occurrence via socket
    socket.emit("create_module", {
      id: modId, userId, gridId,
      role: "container", kind: "artifact",
      label: "Untitled",
    });
    socket.emit("create_occurrence", {
      id: occId, userId, gridId,
      targetId: modId, targetType: "module",
      parentId: folder.id, sortOrder: maxOrder + 1,
      iteration: { mode: "persistent" },
      textmap: { type: "doc", content: [{ type: "paragraph" }] },
    });
    dispatch({ type: "module_created", payload: { id: modId, userId, gridId, role: "container", kind: "artifact", label: "Untitled" } });
    dispatch({ type: "occurrence_created", payload: { id: occId, userId, gridId, targetId: modId, targetType: "module", parentId: folder.id, sortOrder: maxOrder + 1, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] } } });
    setOpen(true);
    onSelect(occId);
  }, [state, socket, dispatch, folder.id, artifactOccs, onSelect]);

  return (
    <div ref={folderRef}>
      <div
        onClick={() => hasChildren && setOpen(v => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          paddingLeft: 6 + indent,
          paddingRight: 4,
          paddingTop: 1,
          paddingBottom: 1,
          cursor: hasChildren ? "pointer" : "default",
          fontSize: 12,
          color: isDragOver ? "rgba(134,239,172,0.9)" : "var(--text-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          userSelect: "none",
          background: isDragOver ? "rgba(134,239,172,0.08)" : "transparent",
          borderRadius: 3,
          transition: "color 0.1s, background 0.1s",
        }}
        title={folder.name}
      >
        <span style={{ fontSize: 9, color: "var(--text-faint)", width: 10, textAlign: "center", flexShrink: 0 }}>
          {hasChildren ? (open ? "▾" : "▸") : ""}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {folder.name}
        </span>
        <span
          onClick={handleNewDoc}
          title="New document"
          style={{ fontSize: 11, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, opacity: 0, transition: "opacity 0.15s", lineHeight: 1, padding: "0 2px" }}
          className="folder-add-btn"
        >+</span>
      </div>

      {open && (
        <div>
          {childFolders.map(cf => (
            <FolderNode
              key={cf.id}
              folder={cf}
              depth={depth + 1}
              foldersById={foldersById}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
              activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect}
              onScrollTo={onScrollTo}
              onSetDefault={onSetDefault}
              defaultOccurrenceId={defaultOccurrenceId}
            />
          ))}
          {artifactOccs.map(occ => (
            <DocNode
              key={occ.id}
              occ={occ}
              depth={depth + 1}
              isAnchor={false}
              parentOccId={occ.id}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
              activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect}
              onScrollTo={onScrollTo}
              onSetDefault={onSetDefault}
              defaultOccurrenceId={defaultOccurrenceId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ManifestTree ─────────────────────────────────────────────────────────────
export default function ManifestTree({ manifestId, view, dispatch, socket, collapsed, onToggleCollapse, scrollHighlightId }) {
  const { manifestsById, foldersById, occurrencesById, modulesById } = useContext(GridActionsContext);
  const manifest = manifestsById?.[manifestId];
  const rootFolder = manifest?.rootFolderId ? foldersById?.[manifest.rootFolderId] : null;

  // Clicking a doc file → open it (switch activeOccurrenceId)
  const handleSelect = useCallback((occId) => {
    if (!view?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: occId, scrollAnchor: null } });
  }, [view, dispatch, socket]);

  // Clicking an anchor chip → keep parent doc open, scroll to heading
  const handleScrollTo = useCallback((parentOccId, headingText) => {
    if (!view?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: parentOccId, scrollAnchor: headingText } });
  }, [view, dispatch, socket]);

  // Set a doc as the default landing page for this tree panel
  const handleSetDefault = useCallback((occId) => {
    if (!view?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...view, defaultOccurrenceId: occId } });
  }, [view, dispatch, socket]);

  // Touch drag to open/close sidebar
  const handleThumbTouchStart = useCallback((e) => {
    const startX = e.touches[0].clientX;
    const threshold = 50;
    const onMove = (ev) => {
      const dx = ev.touches[0].clientX - startX;
      if (collapsed && dx > threshold) { onToggleCollapse(); cleanup(); }
      else if (!collapsed && dx < -threshold) { onToggleCollapse(); cleanup(); }
    };
    const cleanup = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", cleanup);
    };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", cleanup, { passive: true });
  }, [collapsed, onToggleCollapse]);

  return (
    <div
      style={{
        width: collapsed ? 24 : 154,
        height: "100%",
        borderRight: "1px solid var(--border-default)",
        background: "var(--surface-card)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.2s ease-out",
        flexShrink: 0,
        position: "relative",
        pointerEvents: "auto",
      }}
    >
      {collapsed ? (
        /* Vertically centered thumb + arrow */
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "e-resize" }}
          onTouchStart={handleThumbTouchStart}
          onClick={onToggleCollapse}
        >
          <div className="tree-thumb-handle" style={{ width: 4, height: 40, borderRadius: 2, background: "var(--text-faint)", transition: "background 0.15s" }} />
          <ChevronRight size={12} style={{ color: "var(--text-muted)", marginTop: 6 }} />
        </div>
      ) : (
        <>
          {/* Header with label + collapse button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 3px", flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {manifest?.name || "Files"}
            </span>
            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 2px", borderRadius: 4, display: "flex", alignItems: "center" }}
            >
              <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
            </button>
          </div>

          {/* Tree content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1px 0 4px" }}>
            {(!manifest || !rootFolder) ? (
              <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 8px" }}>No files</div>
            ) : (
              <FolderNode
                folder={rootFolder}
                depth={0}
                foldersById={foldersById}
                occurrencesById={occurrencesById}
                modulesById={modulesById}
                activeOccurrenceId={scrollHighlightId || view?.activeOccurrenceId}
                onSelect={handleSelect}
                onScrollTo={handleScrollTo}
                onSetDefault={handleSetDefault}
                defaultOccurrenceId={view?.defaultOccurrenceId}
              />
            )}
          </div>

          {/* Touch-drag edge on right border to collapse */}
          <div
            style={{ position: "absolute", top: 0, right: -4, bottom: 0, width: 8, cursor: "w-resize", zIndex: 101 }}
            onTouchStart={handleThumbTouchStart}
          />
        </>
      )}
    </div>
  );
}
