// modules/ManifestTree.jsx
// Sidebar tree for notebook/artifact panels. Shows folder hierarchy + doc occurrences.
// Selecting a doc row calls updateView({ activeOccurrenceId }) so the content pane updates.
// Selecting an anchor chip calls updateView({ activeOccurrenceId: parentOccId, scrollAnchor: heading })
// so the parent doc stays open and scrolls to that heading.
import { useContext, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { ChevronRight, Plus, Layout, FileText, Paintbrush, FolderPlus, Monitor, Folder, Hash, Pencil, Trash2 } from "lucide-react";
import ContextMenu from "../ui/ContextMenu.jsx";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

// Compact row style — tight padding, small text, minimal visual weight
const PILL_STYLE = {
  display: "flex", alignItems: "center", gap: 3,
  padding: "1px 5px 1px 4px",
  borderRadius: 4,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  userSelect: "none",
  marginBottom: 0,
};
const PILL_ACTIVE = (color = "rgba(100,180,255,0.5)") => ({
  border: `1px solid ${color}`,
  background: `${color.replace(/[\d.]+\)$/, "0.08)")}`,
});

// Kind → lucide icon for pages
const PAGE_KIND_ICON = { board: Layout, canvas: Paintbrush, doc: FileText, display: Monitor };
import { hexToRgba } from "../helpers/colorHelpers.js";
import RadialMenu from "../ui/RadialMenu.jsx";

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
function DocNode({ occ, depth, isAnchor, parentOccId, occurrencesById, modulesById, childrenByParentId, activeOccurrenceId, onSelect, onScrollTo, collapseGen = 0, onSetDefault, defaultOccurrenceId, showAnchors = true }) {
  const childOccs = useMemo(() =>
    (childrenByParentId?.[occ.id] || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [childrenByParentId, occ.id]
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

  // Draggable — file rows use "artifact" type, anchors use "module" with tree-anchor source
  const contMod = modulesById?.[occ.targetId];
  useEffect(() => {
    if (!rowRef.current) return;
    if (isAnchor) {
      return draggable({
        element: rowRef.current,
        getInitialData: () => ({
          type: "module", sourceType: "tree-anchor", role: "container",
          id: occ.targetId, data: contMod, occurrenceId: occ.id,
        }),
      });
    } else {
      return draggable({
        element: rowRef.current,
        getInitialData: () => ({ type: "artifact", occurrenceId: occ.id, parentId: occ.parentId }),
      });
    }
  }, [isAnchor, occ.id, occ.parentId, occ.targetId, contMod]);

  // Anchor chip — clicking scrolls parent doc to this container
  if (isAnchor) {
    const rawColor = contMod?.ownStyle?.bg || null;
    const chipColor = hexToRgba(rawColor, isActive ? 1.0 : 0.82) ?? (isActive ? "rgba(134,239,172,1)" : "rgba(134,239,172,0.82)");

    return (
      <div>
        <div
          ref={rowRef}
          style={{ paddingLeft: indent, paddingRight: 2, paddingTop: 1, paddingBottom: 1, display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}
        >
          {hasChildren ? (
            <span onClick={toggleOpen} style={{ fontSize: 8, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, width: 10, textAlign: "center", userSelect: "none", padding: "4px 2px" }}>
              {open ? "▾" : "▸"}
            </span>
          ) : <span style={{ width: 10, flexShrink: 0 }} />}
          <div
            onClick={() => onScrollTo(parentOccId, occ.id)}
            title={displayLabel}
            style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              padding: "1px 5px 1px 3px", borderRadius: 999,
              border: `1px solid ${isActive ? chipColor : "transparent"}`,
              background: isActive ? `${chipColor.replace(/[\d.]+\)$/, "0.1)")}` : "transparent",
              cursor: "pointer", userSelect: "none",
            }}
          >
            <Hash size={8} style={{ color: chipColor, flexShrink: 0, opacity: 0.6 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9, fontFamily: "var(--font-mono)", color: chipColor }}>
              {displayLabel}
            </span>
          </div>
        </div>
        {hasChildren && open && (
          <div>
            {childOccs.map(co => (
              <DocNode key={co.id} occ={co} depth={depth + 1} isAnchor={true} parentOccId={parentOccId}
                occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
                onSelect={onSelect} onScrollTo={onScrollTo} collapseGen={childCollapseGen} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File row — pill style with FileText icon, draggable
  return (
    <div style={{ paddingLeft: indent, paddingRight: 2 }}>
      <div
        ref={rowRef}
        onClick={() => onSelect(occ.id)}
        onContextMenu={(e) => { if (onSetDefault) { e.preventDefault(); onSetDefault(occ.id); } }}
        style={{
          ...PILL_STYLE,
          ...(isActive ? PILL_ACTIVE() : {}),
        }}
      >
        {showAnchors && hasChildren && (
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); toggleOpen(); }}>
            <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
          </span>
        )}
        <FileText size={9} style={{ color: "rgba(100,180,255,0.7)", flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontFamily: "var(--font-mono)", color: isActive ? "rgba(100,180,255,1)" : "var(--text-secondary)" }}>
          {displayLabel}
        </span>
        {defaultOccurrenceId === occ.id && (
          <span style={{ fontSize: 8, color: "var(--text-faint)", flexShrink: 0 }} title="Default page">&#x1F4CC;</span>
        )}
      </div>
      {showAnchors && hasChildren && open && (
        <div style={{ paddingLeft: 6, paddingBottom: 4 }}>
          {childOccs.map(co => (
            <DocNode key={co.id} occ={co} depth={depth + 1} isAnchor={true} parentOccId={occ.id}
              occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect} onScrollTo={onScrollTo} collapseGen={childCollapseGen} showAnchors={showAnchors} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FolderNode ──────────────────────────────────────────────────────────────
function FolderNode({ folder, depth, foldersById, occurrencesById, modulesById, childrenByParentId, activeOccurrenceId, onSelect, onScrollTo, onSetDefault, defaultOccurrenceId, onOpenPage, showAnchors = true }) {
  const { dispatch, socket, state } = useContext(GridActionsContext);
  const [open, setOpen] = useState(folder?.isExpanded !== false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [ctxMenu, setCtxMenu] = useState(null);
  const folderRef = useRef(null);

  const childFolders = useMemo(() =>
    Object.values(foldersById ?? {})
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [foldersById, folder.id]
  );

  // All child occurrences, split into artifacts vs pages
  const allChildOccs = useMemo(() =>
    (childrenByParentId?.[folder.id] || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [childrenByParentId, folder.id]
  );
  const artifactOccs = useMemo(() =>
    allChildOccs.filter(occ => modulesById?.[occ.targetId]?.role !== "page"),
    [allChildOccs, modulesById]
  );
  const pageOccs = useMemo(() =>
    allChildOccs.filter(occ => modulesById?.[occ.targetId]?.role === "page"),
    [allChildOccs, modulesById]
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
        const maxOrder = allChildOccs.reduce((m, o) => Math.max(m, o.sortOrder ?? 0), -1);
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occurrenceId, parentId: folder.id, sortOrder: maxOrder + 1 },
          emit: true,
        });
        setOpen(true);
      },
    });
  }, [folder.id, allChildOccs, dispatch, socket]);

  // Rename handler — saves on Enter/blur, cancels on Escape
  const renameInputRef = useRef(null);
  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) {
      CommitHelpers.updateFolder({ dispatch, socket, folder: { id: folder.id, name: trimmed }, emit: true });
    }
    setIsRenaming(false);
  }, [renameValue, folder.id, folder.name, dispatch, socket]);

  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    else if (e.key === "Escape") { setIsRenaming(false); setRenameValue(folder.name); }
  }, [commitRename, folder.name]);

  // Delete handler — deletes folder and reparents children to parent folder
  const handleDelete = useCallback(() => {
    if (!dispatch || !socket) return;
    // Reparent child occurrences to the folder's parent
    for (const occ of allChildOccs) {
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occ.id, parentId: folder.parentId }, emit: true });
    }
    // Reparent child folders to the folder's parent
    for (const cf of childFolders) {
      CommitHelpers.updateFolder({ dispatch, socket, folder: { id: cf.id, parentId: folder.parentId }, emit: true });
    }
    CommitHelpers.deleteFolder({ dispatch, socket, folderId: folder.id, emit: true });
  }, [dispatch, socket, folder.id, folder.parentId, allChildOccs, childFolders]);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const hasChildren = childFolders.length > 0 || artifactOccs.length > 0 || pageOccs.length > 0;
  const indent = depth * 8;

  // Collect all child occurrence IDs for drag payload
  const childOccIds = useMemo(() => artifactOccs.map(o => o.id), [artifactOccs]);

  // Make folder draggable (type: "folder")
  const dragRef = useRef(null);
  useEffect(() => {
    if (!dragRef.current) return;
    return draggable({
      element: dragRef.current,
      getInitialData: () => ({
        type: "folder", folderId: folder.id, folderName: folder.name, childOccurrenceIds: childOccIds,
      }),
    });
  }, [folder.id, folder.name, childOccIds]);

  const handleNewDoc = useCallback((e) => {
    e.stopPropagation();
    const userId = state?.userId;
    const gridId = state?.grid?._id;
    if (!userId || !gridId || !dispatch || !socket) return;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    const maxOrder = allChildOccs.reduce((m, o) => Math.max(m, o.sortOrder ?? 0), -1);
    CommitHelpers.createModule({ dispatch, socket, module: { id: modId, userId, gridId, role: "container", kind: "artifact", label: "Untitled" }, emit: true });
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, targetId: modId, targetType: "module", parentId: folder.id, sortOrder: maxOrder + 1, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] } }, emit: true });
    setOpen(true);
    onSelect(occId);
  }, [state, socket, dispatch, folder.id, allChildOccs, onSelect]);

  return (
    <div ref={folderRef} style={{ paddingLeft: indent, paddingRight: 2 }}>
      {/* Folder pill */}
      <div
        ref={dragRef}
        onClick={() => !isRenaming && hasChildren && setOpen(v => !v)}
        onDoubleClick={(e) => { e.stopPropagation(); setRenameValue(folder.name); setIsRenaming(true); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        style={{
          ...PILL_STYLE,
          cursor: isRenaming ? "text" : hasChildren ? "grab" : "default",
          ...(isDragOver ? { border: "1px solid rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.08)" } : {}),
        }}
        title={isRenaming ? undefined : folder.name}
      >
        {hasChildren && (
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: "pointer" }}>
            <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
          </span>
        )}
        <Folder size={9} style={{ color: "rgba(251,191,36,0.7)", flexShrink: 0 }} />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 3, padding: "0 3px", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)", outline: "none", minWidth: 0 }}
          />
        ) : (
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            {folder.name}
          </span>
        )}
        <span
          onClick={handleNewDoc}
          title="New document"
          style={{ fontSize: 13, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, opacity: 0, transition: "opacity 0.15s", lineHeight: 1, padding: "4px 6px" }}
          className="folder-add-btn"
        >+</span>
      </div>

      {ctxMenu && (
        <ContextMenu
          ctx={{ x: ctxMenu.x, y: ctxMenu.y, items: [
            { label: "Rename", icon: Pencil, onClick: () => { setRenameValue(folder.name); setIsRenaming(true); } },
            { separator: true },
            { label: "Delete folder", icon: Trash2, danger: true, onClick: handleDelete },
          ] }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {open && (
        <div style={{ paddingLeft: 4 }}>
          {childFolders.map(cf => (
            <FolderNode key={cf.id} folder={cf} depth={depth + 1} foldersById={foldersById}
              occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect} onScrollTo={onScrollTo} onSetDefault={onSetDefault} defaultOccurrenceId={defaultOccurrenceId} onOpenPage={onOpenPage} showAnchors={showAnchors} />
          ))}
          {pageOccs.map(occ => (
            <PageTreeNode key={occ.id} pageOccId={occ.id} activeOccId={activeOccurrenceId}
              onOpenPage={onOpenPage} occurrencesById={occurrencesById} modulesById={modulesById} />
          ))}
          {artifactOccs.map(occ => (
            <DocNode key={occ.id} occ={occ} depth={depth + 1} isAnchor={false} parentOccId={occ.id}
              occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect} onScrollTo={onScrollTo} onSetDefault={onSetDefault} defaultOccurrenceId={defaultOccurrenceId} showAnchors={showAnchors} />
          ))}
        </div>
      )}
    </div>
  );
}

// Kind glyphs for page type indicators
const PAGE_KIND_GLYPH = { canvas: "∿", doc: "≋", display: "□", board: "≡" };

// ─── PageTreeNode — pill style page entry + container anchor chips (draggable) ──
function PageTreeNode({ pageOccId, activeOccId, onOpenPage, occurrencesById, modulesById }) {
  const [open, setOpen] = useState(false);
  const pageRef = useRef(null);
  const pageOcc = occurrencesById?.[pageOccId];
  const pageMod = pageOcc ? modulesById?.[pageOcc.targetId] : null;

  // Make page pill draggable (must be before early return — hooks rule)
  useEffect(() => {
    if (!pageRef.current || !pageMod) return;
    return draggable({
      element: pageRef.current,
      getInitialData: () => ({
        type: "module", sourceType: "tree-page", role: "page",
        id: pageMod.id, data: pageMod, occurrenceId: pageOccId,
      }),
    });
  }, [pageMod?.id, pageOccId, pageMod]);

  if (!pageOcc || !pageMod || pageMod.role !== "page") return null;

  const label = pageMod.label || "Untitled";
  const isActive = pageOccId === activeOccId;
  const kind = pageMod.kind || "board";
  const KindIcon = PAGE_KIND_ICON[kind] || Layout;
  const containerOccs = (pageOcc.occurrences || [])
    .map(id => occurrencesById?.[id])
    .filter(o => o && modulesById?.[o.targetId] && modulesById[o.targetId].role !== "page")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const hasChildren = containerOccs.length > 0;

  return (
    <div style={{ paddingLeft: 2, paddingRight: 2 }}>
      {/* Page pill */}
      <div
        ref={pageRef}
        onClick={() => onOpenPage?.(pageOccId)}
        style={{
          ...PILL_STYLE,
          ...(isActive ? PILL_ACTIVE("rgba(6,182,212,0.5)") : {}),
        }}
      >
        {hasChildren && (
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}>
            <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
          </span>
        )}
        <KindIcon size={9} style={{ color: "#06b6d4", flexShrink: 0 }} />
        <span style={{
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontSize: 10, fontFamily: "var(--font-mono)",
          color: isActive ? "#06b6d4" : "var(--text-secondary)",
        }}>
          {label}
        </span>
      </div>
      {/* Container anchor chips — draggable, copy mode */}
      {hasChildren && open && (
        <div style={{ paddingLeft: 10, paddingBottom: 2 }}>
          {containerOccs.map(contOcc => (
            <AnchorChip key={contOcc.id} contOcc={contOcc} modulesById={modulesById}
              onOpenPage={onOpenPage} pageOccId={pageOccId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AnchorChip — draggable anchor inside PageTreeNode ──
function AnchorChip({ contOcc, modulesById, onOpenPage, pageOccId }) {
  const chipRef = useRef(null);
  const contMod = modulesById?.[contOcc.targetId];
  const contLabel = contMod?.label || contOcc.id;

  useEffect(() => {
    if (!chipRef.current) return;
    return draggable({
      element: chipRef.current,
      getInitialData: () => ({
        type: "module", sourceType: "tree-anchor", role: "container",
        id: contOcc.targetId, data: contMod, occurrenceId: contOcc.id,
      }),
    });
  }, [contOcc.id, contOcc.targetId, contMod]);

  return (
    <div
      ref={chipRef}
      onClick={() => {
        onOpenPage?.(pageOccId);
        setTimeout(() => {
          document.querySelector(`[data-occ-id="${contOcc.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 150);
      }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 2,
        padding: "1px 5px 1px 3px", borderRadius: 999,
        background: "transparent", border: "1px solid transparent",
        cursor: "pointer", userSelect: "none", marginBottom: 0,
      }}
    >
      <Hash size={8} style={{ color: "rgba(134,239,172,0.6)", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(134,239,172,0.75)" }}>
        {contLabel}
      </span>
    </div>
  );
}

// ─── ManifestTree ─────────────────────────────────────────────────────────────
export default function ManifestTree({ manifestId, view, dispatch, socket, collapsed, onToggleCollapse, scrollHighlightId, panelOccurrence, onOpenPage, onClosePage, activePageView }) {
  const { manifestsById, foldersById, occurrencesById, modulesById, childrenByParentId, state } = useContext(GridActionsContext);
  const manifest = manifestsById?.[manifestId];
  const rootFolder = manifest?.rootFolderId ? foldersById?.[manifest.rootFolderId] : null;
  const isPagePanel = !!panelOccurrence;

  // Clicking a doc — opens page (page panels) or sets active doc (artifact panels)
  // When activePageView is set, doc clicks update the page's view instead of calling onOpenPage
  const handleSelect = useCallback((occId) => {
    if (isPagePanel && activePageView?.id) {
      // Active page has a tree view — update the page's activeOccurrenceId
      CommitHelpers.updateView({ dispatch, socket, view: { ...activePageView, activeOccurrenceId: occId, scrollAnchor: null } });
    } else if (isPagePanel) {
      onOpenPage?.(occId);
    } else {
      if (!view?.id) return;
      CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: occId, scrollAnchor: null } });
    }
  }, [isPagePanel, activePageView, onOpenPage, view, dispatch, socket]);

  // Clicking an anchor chip → keep parent doc open, scroll to heading
  const handleScrollTo = useCallback((parentOccId, headingText) => {
    const targetView = activePageView || view;
    if (!targetView?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, activeOccurrenceId: parentOccId, scrollAnchor: headingText } });
  }, [activePageView, view, dispatch, socket]);

  // Set a doc as the default landing page for this tree panel
  const handleSetDefault = useCallback((occId) => {
    const targetView = activePageView || view;
    if (!targetView?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, defaultOccurrenceId: occId } });
  }, [activePageView, view, dispatch, socket]);

  // Create a new page and pin it to the panel
  const handleCreatePage = useCallback((kind) => {
    if (!panelOccurrence?.id || !state?.userId || !state?.grid?._id) return;
    const userId = state.userId;
    const gridId = state.grid._id;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    const label = `${kind.charAt(0).toUpperCase() + kind.slice(1)} Page`;
    CommitHelpers.createPage({
      dispatch, socket,
      module: { id: modId, userId, gridId, role: "page", kind, label },
      occurrence: { id: occId, userId, gridId, targetId: modId, parentId: manifest?.rootFolderId ?? null, iteration: { mode: "persistent" }, fields: {} },
      panelOccurrenceId: panelOccurrence.id,
      ...(!view?.id && {
        panelViewData: { id: crypto.randomUUID(), userId, gridId, viewType: "board", activeOccurrenceId: occId },
      }),
      emit: true,
    });
  }, [panelOccurrence, state, dispatch, socket, manifest, view]);

  // Create a new folder in the manifest root
  const handleCreateFolder = useCallback(() => {
    if (!state?.userId || !state?.grid?._id || !manifest?.rootFolderId || !dispatch || !socket) return;
    const folder = { id: crypto.randomUUID(), name: "New Folder", parentId: manifest.rootFolderId, gridId: state.grid._id, userId: state.userId, folderType: "normal" };
    CommitHelpers.createFolder({ dispatch, socket, folder, emit: true });
  }, [state, socket, dispatch, manifest]);

  // Open pages list for the local section
  const localPageOccs = useMemo(() => {
    if (!isPagePanel) return [];
    return (panelOccurrence.occurrences || [])
      .filter(id => {
        const occ = occurrencesById?.[id];
        const mod = occ ? modulesById?.[occ.targetId] : null;
        return mod?.role === "page";
      });
  }, [isPagePanel, panelOccurrence?.occurrences, occurrencesById, modulesById]);

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
        width: collapsed ? 24 : "170px",
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
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 3px 6px", flexShrink: 0, borderBottom: "1px solid var(--border-default)" }}>
            <span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.05em", textTransform: "uppercase", flex: 1 }}>
              {isPagePanel ? "Pages" : (manifest?.name || "Files")}
            </span>
            {isPagePanel && (
              <div style={{ flexShrink: 0, position: "relative" }}>
                <RadialMenu
                  handleIcon={Plus}
                  forceDirection="down"
                  items={[
                    { label: "Board page", icon: Layout, onClick: () => handleCreatePage("board") },
                    { label: "Doc page", icon: FileText, onClick: () => handleCreatePage("doc") },
                    { label: "Canvas page", icon: Paintbrush, onClick: () => handleCreatePage("canvas") },
                    { label: "Folder", icon: FolderPlus, onClick: handleCreateFolder },
                  ]}
                />
              </div>
            )}
            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 2px", borderRadius: 4, display: "flex", alignItems: "center", flexShrink: 0 }}
            >
              <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
            </button>
          </div>

          {/* Tree content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1px 0 4px" }}>
            {isPagePanel ? (
              /* Local tree — only panel pages + anchors, no root folder tree */
              localPageOccs.length > 0 ? (
                localPageOccs.map(pageOccId => (
                  <PageTreeNode
                    key={pageOccId}
                    pageOccId={pageOccId}
                    activeOccId={view?.activeOccurrenceId}
                    onOpenPage={onOpenPage}
                    occurrencesById={occurrencesById}
                    modulesById={modulesById}
                  />
                ))
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "8px" }}>No pages</div>
              )
            ) : (
              /* Root tree — folder hierarchy */
              (!manifest || !rootFolder) ? (
                <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 8px" }}>No files</div>
              ) : (
                <FolderNode
                  folder={rootFolder}
                  depth={0}
                  foldersById={foldersById}
                  occurrencesById={occurrencesById}
                  modulesById={modulesById}
                  childrenByParentId={childrenByParentId}
                  activeOccurrenceId={scrollHighlightId || activePageView?.activeOccurrenceId || view?.activeOccurrenceId}
                  onSelect={handleSelect}
                  onScrollTo={handleScrollTo}
                  onSetDefault={handleSetDefault}
                  defaultOccurrenceId={view?.defaultOccurrenceId}
                  onOpenPage={onOpenPage}
                  showAnchors={false}
                />
              )
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
