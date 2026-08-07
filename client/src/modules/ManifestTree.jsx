// modules/ManifestTree.jsx
// Sidebar tree for notebook/artifact panels. Shows folder hierarchy + doc occurrences.
// Selecting a doc row calls updateView({ activeOccurrenceId }) so the content pane updates.
// Selecting an anchor chip calls updateView({ activeOccurrenceId: parentOccId, scrollAnchor: heading })
// so the parent doc stays open and scrolls to that heading.
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGridActions } from "../GridActionsContext.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { ChevronRight, Plus, Layout, FolderPlus, Folder, Pencil, Trash2, X, Image as ImageIcon } from "lucide-react";
import ContextMenu from "../ui/ContextMenu.jsx";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

// Kind → lucide icon for pages — delegates to the shared
// helpers/moduleIcons.js helper so add/edit happens in one place.
import { KIND_ICONS as PAGE_KIND_ICON } from "../helpers/moduleIcons";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { ensureArtifactPageOcc } from "../helpers/importsFolder";
import { isProtectedFolder } from "../helpers/protectedFolders";
import { resolveFileRef, isExternalFileRef } from "../helpers/fileRef.js";
import QuickAddMenu from "../ui/QuickAddMenu.jsx";
import NodePill from "./NodePill.jsx";

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
function DocNode({ occ, depth, isAnchor, parentOccId, occurrencesById, modulesById, childrenByParentId, activeOccurrenceId, onSelect, onScrollTo, collapseGen = 0, onSetDefault, defaultOccurrenceId, showAnchors = true, dispatch, socket, siblingOccs }) {
  const childOccs = useMemo(() =>
    (childrenByParentId?.[occ.id] || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [childrenByParentId, occ.id]
  );
  const [open, setOpen] = useState(true);
  const [childCollapseGen, setChildCollapseGen] = useState(0);
  const [dropEdge, setDropEdge] = useState(null); // "top" | "bottom" | null
  const dropEdgeRef = useRef(null);
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
  const hasChildren = childOccs.length > 0;
  const mod = modulesById?.[occ.moduleId];
  const contMod = mod; // alias for anchor branch
  // Drag-out-to-OS for artifact rows: stamp text/uri-list + DownloadURL on the
  // drag so dragging the pill onto the desktop saves the file under its
  // original name. Internal refs need the full origin prefix so the OS can
  // actually fetch them. External (Wikipedia / data: / blob:) URLs pass
  // through. Docket §8 gap #24.
  const externalDragData = useMemo(() => {
    if (mod?.role !== "artifact" || !mod?.fileRef) return null;
    const resolved = resolveFileRef(mod.fileRef);
    if (!resolved) return null;
    let absUrl = resolved;
    try {
      if (typeof window !== "undefined" && !isExternalFileRef(mod.fileRef)) {
        absUrl = new URL(resolved, window.location.origin).toString();
      }
    } catch { /* fall back to resolved as-is */ }
    const mime = mod.meta?.mimeType || "application/octet-stream";
    const name = mod.meta?.originalName || mod.label || "file";
    return {
      "text/uri-list": absUrl,
      "text/plain": absUrl,
      "DownloadURL": `${mime}:${name}:${absUrl}`,
    };
  }, [mod?.role, mod?.fileRef, mod?.meta?.mimeType, mod?.meta?.originalName, mod?.label]);
  // Don't leak the raw occurrence UUID as a label — render "Untitled" when
  // the module has no label set and the textmap has no heading to fall back on.
  const label = mod?.label || "Untitled";
  const heading = getDocHeading(occ.textmap);
  const displayLabel = heading || label;
  const isActive = occ.id === activeOccurrenceId;

  // Drop target for reorder — accept artifact drags between siblings
  const rowRef = useRef(null);
  useEffect(() => {
    if (!rowRef.current || isAnchor || !dispatch || !socket) return;
    return dropTargetForElements({
      element: rowRef.current,
      canDrop: ({ source }) => source.data.type === "artifact" && source.data.occurrenceId !== occ.id,
      onDragEnter: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const edge = location.current.input.clientY < mid ? "top" : "bottom";
        setDropEdge(edge); dropEdgeRef.current = edge;
      },
      onDrag: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const edge = location.current.input.clientY < mid ? "top" : "bottom";
        setDropEdge(edge); dropEdgeRef.current = edge;
      },
      onDragLeave: () => { setDropEdge(null); dropEdgeRef.current = null; },
      onDrop: ({ source }) => {
        const edge = dropEdgeRef.current;
        setDropEdge(null); dropEdgeRef.current = null;
        const { occurrenceId } = source.data;
        if (!occurrenceId) return;
        // Compute new sortOrder based on position relative to this item
        const myOrder = occ.sortOrder ?? 0;
        const siblings = siblingOccs || [];
        const sorted = siblings.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const myIdx = sorted.findIndex(s => s.id === occ.id);
        let newOrder;
        if (edge === "top") {
          const prev = myIdx > 0 ? sorted[myIdx - 1] : null;
          newOrder = prev ? ((prev.sortOrder ?? 0) + myOrder) / 2 : myOrder - 1;
        } else {
          const next = myIdx < sorted.length - 1 ? sorted[myIdx + 1] : null;
          newOrder = next ? (myOrder + (next.sortOrder ?? 0)) / 2 : myOrder + 1;
        }
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occurrenceId, parentId: occ.parentId, sortOrder: newOrder },
          emit: true,
        });
      },
    });
  }, [occ.id, occ.parentId, occ.sortOrder, isAnchor, dispatch, socket, siblingOccs]);

  // Anchor chip — clicking scrolls parent doc to this container
  if (isAnchor) {
    return (
      <div style={{ marginLeft: depth * 8 }}>
        <div style={{ paddingRight: 2, display: "flex", alignItems: "center", gap: 2 }}>
          {hasChildren ? (
            <span onClick={toggleOpen} style={{ fontSize: 8, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, width: 10, textAlign: "center", userSelect: "none", padding: "4px 2px" }}>
              {open ? "▾" : "▸"}
            </span>
          ) : <span style={{ width: 10, flexShrink: 0 }} />}
          <NodePill
            occurrence={occ}
            module={{ ...contMod, role: "container", label: displayLabel }}
            onClick={() => onScrollTo(parentOccId, occ.id)}
            isActive={isActive}
            depth={depth}
            dragData={{
              type: "module", sourceType: "tree-anchor", role: "container",
              id: occ.moduleId, data: contMod, occurrenceId: occ.id,
            }}
            style={{ flex: 1 }}
          />
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

  // File row — NodePill, draggable + drop target for reorder
  return (
    <div ref={rowRef} style={{ paddingRight: 2, position: "relative", marginLeft: depth * 8 }}>
      {dropEdge === "top" && <div style={{ position: "absolute", top: 0, left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1 }} />}
      {dropEdge === "bottom" && <div style={{ position: "absolute", bottom: 0, left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1 }} />}
      <div style={{ display: "flex", alignItems: "center" }}
        onContextMenu={(e) => { if (onSetDefault) { e.preventDefault(); onSetDefault(occ.id); } }}
      >
        {/* Chevron placeholder is ALWAYS rendered (opacity 0 when not
            applicable) so every row — folders, pages, docs with or without
            anchors — has the same left offset. Without this, anchor-less doc
            rows have their pill start at the row's left edge while folder
            rows have a 14px chevron offset, breaking visual alignment. */}
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: (showAnchors && hasChildren) ? "pointer" : "default", opacity: (showAnchors && hasChildren) ? 1 : 0, pointerEvents: (showAnchors && hasChildren) ? "auto" : "none" }}
          onClick={(e) => { if (showAnchors && hasChildren) { e.stopPropagation(); toggleOpen(); } }}>
          <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
        </span>
        <NodePill
          occurrence={occ}
          module={{ ...mod, label: displayLabel }}
          onClick={() => onSelect(occ.id)}
          isActive={isActive}
          depth={depth}
          dragData={{ type: "artifact", occurrenceId: occ.id, parentId: occ.parentId }}
          externalDragData={externalDragData}
          style={{ flex: 1 }}
          // File-size + original-name tooltip (file/artifact audit gap #5)
          title={(() => {
            const parts = [];
            if (mod?.meta?.originalName) parts.push(mod.meta.originalName);
            const sz = mod?.meta?.uploadSize;
            if (typeof sz === "number" && sz > 0) {
              const KB = 1024, MB = KB * 1024, GB = MB * 1024;
              const label = sz >= GB ? `${(sz / GB).toFixed(1)} GB`
                : sz >= MB ? `${(sz / MB).toFixed(1)} MB`
                : sz >= KB ? `${(sz / KB).toFixed(0)} KB`
                : `${sz} B`;
              parts.push(label);
            }
            return parts.length > 0 ? parts.join(" · ") : undefined;
          })()}
        >
          {defaultOccurrenceId === occ.id && (
            <span style={{ fontSize: 8, color: "var(--text-faint)", flexShrink: 0 }} title="Default page">&#x1F4CC;</span>
          )}
        </NodePill>
      </div>
      {showAnchors && hasChildren && open && (
        <div style={{ paddingBottom: 4 }}>
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

// ─── FolderCoverEditor (F2) ──────────────────────────────────────────────────
// Tiny portaled popover with two tabs: Color (8 swatches) / Image (file picker
// → upload via /api/artifacts/upload then write the returned fileRef as the
// cover). Stored on folder.meta.cover = { kind: "color"|"image", value }.
// Rendered cover surfaces:
//   - Folder pill leading icon slot (small color square OR image thumb)
//   - Folder-page header (when implemented)
function FolderCoverEditor({ folder, dispatch, socket, position, onClose }) {
  const popRef = useRef(null);
  const [tab, setTab] = useState(folder.meta?.cover?.kind === "image" ? "image" : "color");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const onDocDown = (e) => {
      if (!popRef.current) return;
      if (!popRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose]);

  const setCover = useCallback((cover) => {
    CommitHelpers.updateFolder({
      dispatch, socket,
      folder: { id: folder.id, meta: { ...(folder.meta || {}), cover } },
      emit: true,
    });
    onClose?.();
  }, [folder, dispatch, socket, onClose]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // The artifact upload endpoint expects userId + gridId. We don't need
      // to mint a module here — the upload still creates one, but we just
      // grab the fileRef for the cover. Future polish: a lightweight
      // /api/folders/:id/cover upload that doesn't mint a module.
      const userId = window?.__moduliUserId || "";
      const gridId = window?.__moduliGridId || "";
      fd.append("userId", userId);
      fd.append("gridId", gridId);
      const res = await fetch("/api/artifacts/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (body?.fileRef) setCover({ kind: "image", value: body.fileRef });
    } finally {
      setUploading(false);
    }
  }, [setCover]);

  const COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#818cf8", "#e879f9", "#94a3b8"];

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: "fixed", left: position.x, top: position.y, zIndex: 1200,
        minWidth: 200, padding: 8,
        background: "var(--surface, #1f2125)",
        border: "1px solid var(--border-default)", borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontSize: 11, fontFamily: "var(--font-mono)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", gap: 4, marginBottom: 8, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6 }}>
        <button
          onClick={() => setTab("color")}
          aria-pressed={tab === "color"}
          style={{
            flex: 1, padding: "3px 6px", borderRadius: 3,
            background: tab === "color" ? "var(--input-bg)" : "transparent",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)", cursor: "pointer", fontSize: 10,
          }}
        >Color</button>
        <button
          onClick={() => setTab("image")}
          aria-pressed={tab === "image"}
          style={{
            flex: 1, padding: "3px 6px", borderRadius: 3,
            background: tab === "image" ? "var(--input-bg)" : "transparent",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)", cursor: "pointer", fontSize: 10,
          }}
        >Image</button>
      </div>
      {tab === "color" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setCover({ kind: "color", value: c })}
              title={c}
              style={{
                width: 32, height: 32, borderRadius: 4,
                background: c, border: folder.meta?.cover?.value === c ? "2px solid var(--text-primary)" : "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      )}
      {tab === "image" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              padding: "6px 10px", borderRadius: 3,
              background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)", cursor: uploading ? "default" : "pointer",
              fontSize: 10,
            }}
          >
            {uploading ? "Uploading…" : "Choose image…"}
          </button>
          {folder.meta?.cover?.kind === "image" && (
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--text-faint)", wordBreak: "break-all" }}>
              Current: {folder.meta.cover.value}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

/**
 * Dropping onto the protected Templates folder COPIES; every other folder
 * MOVES, as it always has. Without this, dragging the real Schedule page in to
 * "make a template of it" would move it out of Interfaces and break the app.
 *
 * Keyed to meta.protected, never the name — a user folder that happens to be
 * called "Templates" is theirs, and drops into it should still move.
 */
export function resolveFolderDrop({ folder } = {}) {
  return folder?.meta?.protected ? "copy" : "move";
}

// ─── FolderNode ──────────────────────────────────────────────────────────────
function FolderNode({ folder, depth, foldersById, occurrencesById, modulesById, childrenByParentId, activeOccurrenceId, onSelect, onScrollTo, onSetDefault, defaultOccurrenceId, onOpenPage, onOpenPageAndClose, showAnchors = true }) {
  const { dispatch, socket, state } = useGridActions();
  const [open, setOpen] = useState(folder?.isExpanded !== false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [coverEditor, setCoverEditor] = useState(null);
  const [folderDropEdge, setFolderDropEdge] = useState(null);
  const folderDropEdgeRef = useRef(null);
  const folderRef = useRef(null);
  const rowRef = useRef(null);

  const childFolders = useMemo(() =>
    Object.values(foldersById ?? {})
      // `folderType: "category"` folders (Scheduling / Workouts / Trackers /
      // Schedule Ops / …) are Command Center field+operation groupings, NOT
      // manifest-tree folders — they're parented under root for the CC's
      // convenience but must never render in the file sidebar (they'd show as
      // a pile of empty folders). Only normal/day-pages/etc. folders belong here.
      .filter(f => f.parentId === folder.id && f.folderType !== "category")
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
    allChildOccs.filter(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.role !== "page" && !occ.meta?.isTemplate;
    }),
    [allChildOccs, modulesById]
  );
  // Exclude folder-page occurrences (kind="folder") — those are navigation-only, not tree rows.
  // Exclude template occurrences (meta.isTemplate) — those are internal templates, not user content.
  const pageOccs = useMemo(() =>
    allChildOccs.filter(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.role === "page" && mod?.kind !== "folder" && !occ.meta?.isTemplate;
    }),
    [allChildOccs, modulesById]
  );

  // Sibling-reorder drop target — accepts other folder drags onto this
  // row's top/bottom edge and rewrites sortOrder so the dropped folder
  // slots above/below this one. Skipped for the manifest root folder
  // (folder.parentId == null and there are no siblings).
  useEffect(() => {
    if (!rowRef.current || !dispatch || !socket || !folder.parentId) return;
    return dropTargetForElements({
      element: rowRef.current,
      canDrop: ({ source }) =>
        source.data?.type === "folder" &&
        source.data?.folderId &&
        source.data.folderId !== folder.id,
      onDragEnter: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const edge = location.current.input.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
        setFolderDropEdge(edge);
        folderDropEdgeRef.current = edge;
      },
      onDrag: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const edge = location.current.input.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
        if (folderDropEdgeRef.current !== edge) {
          setFolderDropEdge(edge);
          folderDropEdgeRef.current = edge;
        }
      },
      onDragLeave: () => { setFolderDropEdge(null); folderDropEdgeRef.current = null; },
      onDrop: ({ source }) => {
        const edge = folderDropEdgeRef.current;
        setFolderDropEdge(null);
        folderDropEdgeRef.current = null;
        const draggedId = source.data?.folderId;
        if (!draggedId) return;
        // Build siblings list including SELF so midpoint math has a stable
        // anchor index for "this row". Use foldersById directly (siblings
        // useMemo above excluded self for simpler iteration elsewhere).
        const allSiblings = Object.values(foldersById ?? {})
          .filter(f => f.parentId === folder.parentId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const myIdx = allSiblings.findIndex(s => s.id === folder.id);
        const myOrder = folder.sortOrder ?? 0;
        let newOrder;
        if (edge === "top") {
          const prev = myIdx > 0 ? allSiblings[myIdx - 1] : null;
          newOrder = prev ? ((prev.sortOrder ?? 0) + myOrder) / 2 : myOrder - 1;
        } else {
          const next = myIdx < allSiblings.length - 1 ? allSiblings[myIdx + 1] : null;
          newOrder = next ? (myOrder + (next.sortOrder ?? 0)) / 2 : myOrder + 1;
        }
        CommitHelpers.updateFolder({
          dispatch, socket,
          folder: { id: draggedId, parentId: folder.parentId, sortOrder: newOrder },
          emit: true,
        });
      },
    });
  }, [folder.id, folder.parentId, folder.sortOrder, foldersById, dispatch, socket]);

  // Drop target — accept artifact doc nodes dragged from tree
  useEffect(() => {
    if (!folderRef.current) return;
    return dropTargetForElements({
      element: folderRef.current,
      // Pages drag as type "page" (tree-page), artifacts as "artifact". Both are
      // droppable into a folder: an artifact re-homes, and a page is how you
      // make a template of it (the Templates folder copies — resolveFolderDrop).
      canDrop: ({ source }) =>
        (source.data.type === "artifact" || source.data.type === "page")
        && source.data.occurrenceId !== undefined,
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: ({ source }) => {
        setIsDragOver(false);
        const { occurrenceId } = source.data;
        if (!occurrenceId || !dispatch || !socket) return;

        // The Templates folder takes a COPY — see resolveFolderDrop.
        if (resolveFolderDrop({ folder }) === "copy") {
          const label = modulesById?.[occurrencesById?.[occurrenceId]?.moduleId]?.label || "Template";
          CommitHelpers.commitCloneSubtreeAsTemplate(socket, {
            sourceOccurrenceId: occurrenceId,
            name: label,
            parentFolderId: folder.id,
          });
          setOpen(true);
          return;
        }

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
  }, [folder, allChildOccs, dispatch, socket, modulesById, occurrencesById]);

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
    // A protected folder (Templates / Files / Imports) is refused server-side.
    // Bail BEFORE the reparent loop below: that loop persists immediately, so
    // running it and then losing the delete leaves the folder alive with its
    // contents scattered into the root — worse than no guard at all. The menu
    // item is hidden too; this is the second half of that pair, because the
    // handler is reachable from anywhere the item is rendered.
    if (isProtectedFolder(folder)) return;
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
    // moduleId is the schema-canonical pointer that PageFolder / pagesList /
    // role lookups read; targetId is the legacy alias still used by server
    // createOccurrenceData. Without moduleId, the new doc renders as
    // `modulesById[undefined]` → blank PreviewNode card in the folder page
    // grid. (Symptomatically: "Folder page renders no instances" even though
    // the doc is parented under the folder.)
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: folder.id, sortOrder: maxOrder + 1, iteration: { mode: "persistent" }, textmap: { type: "doc", content: [{ type: "paragraph" }] } }, emit: true });
    setOpen(true);
    onSelect(occId);
  }, [state, socket, dispatch, folder.id, allChildOccs, onSelect]);

  // Folder pill click — open folder as a page (mint a folder-page occurrence
  // on demand if one doesn't exist yet). Falls back to onSelect when
  // onOpenPage is missing (e.g. the artifact/FILES tree panel which doesn't
  // pin pages — it just swaps the active occurrence in its own view).
  const handleFolderClick = useCallback(() => {
    if (isRenaming) return;
    const navigate = onOpenPage || onSelect;
    if (!navigate) return;
    const existing = allChildOccs.find(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.kind === "folder" && mod?.role === "page";
    });
    if (existing) {
      navigate(existing.id);
      return;
    }
    const userId = state?.userId;
    const gridId = state?.grid?._id || state?.gridId;
    if (!dispatch || !socket || !userId || !gridId) return;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: modId, userId, gridId, role: "page", kind: "folder", label: folder.name }, emit: true });
    // moduleId is the schema-canonical pointer the rest of the client reads
    // (pagesList / activePageEntry / role lookups all do `occurrencesById[id].moduleId`).
    // Without it the new folder page is invisible to ModulePanel.pagesList → falls back to pagesList[0] (Schedule).
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: folder.id, sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: {} }, emit: true });
    navigate(occId);
  }, [isRenaming, onOpenPage, onSelect, allChildOccs, modulesById, dispatch, socket, state, folder.id, folder.name]);

  return (
    <div ref={folderRef} style={{ paddingRight: 2, marginLeft: depth * 8, position: "relative" }}>
      {folderDropEdge === "top"    && <div style={{ position: "absolute", top: 0,    left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1, zIndex: 2 }} />}
      {folderDropEdge === "bottom" && <div style={{ position: "absolute", bottom: 0, left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1, zIndex: 2 }} />}
      {/* Folder pill — depth indent applied on this outer wrapper (not
          NodePill's padding), so the pill itself starts further right with
          each level instead of just shifting its content. */}
      <div ref={rowRef} style={{ display: "flex", alignItems: "center" }} className="manifest-row"
        onDoubleClick={(e) => { e.stopPropagation(); setRenameValue(folder.name); setIsRenaming(true); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <span
          style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: hasChildren ? "pointer" : "default", opacity: hasChildren ? 1 : 0, pointerEvents: hasChildren ? "auto" : "none" }}
          onClick={(e) => { if (hasChildren) { e.stopPropagation(); setOpen(v => !v); } }}
        >
          <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
        </span>
        {isRenaming ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--input-bg)" }}>
            <Folder size={10} style={{ color: "rgba(251,191,36,0.7)", flexShrink: 0 }} />
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              style={{ flex: 1, background: "transparent", border: "none", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)", outline: "none", minWidth: 0 }}
            />
          </div>
        ) : (
          <NodePill
            module={{ kind: "folder", label: folder.name }}
            onClick={handleFolderClick}
            isActive={isDragOver}
            depth={depth}
            dragData={{
              type: "folder", folderId: folder.id, folderName: folder.name, childOccurrenceIds: childOccIds,
            }}
            style={{ flex: 1 }}
          >
            <span
              onClick={(e) => { e.stopPropagation(); handleNewDoc(e); }}
              title="New document"
              style={{ fontSize: 13, color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, opacity: 0, transition: "opacity 0.15s", lineHeight: 1, padding: "4px 6px" }}
              className="folder-add-btn"
            >+</span>
          </NodePill>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          ctx={{ x: ctxMenu.x, y: ctxMenu.y, items: [
            { label: "Rename", icon: Pencil, onClick: () => { setRenameValue(folder.name); setIsRenaming(true); } },
            { label: "Set cover…", icon: ImageIcon, onClick: () => setCoverEditor({ x: ctxMenu.x, y: ctxMenu.y }) },
            ...(folder.meta?.cover ? [{ label: "Clear cover", icon: X, onClick: () => CommitHelpers.updateFolder({ dispatch, socket, folder: { id: folder.id, meta: { ...(folder.meta || {}), cover: null } }, emit: true }) }] : []),
            ...(isProtectedFolder(folder) ? [] : [
              { separator: true },
              { label: "Delete folder", icon: Trash2, danger: true, onClick: handleDelete },
            ]),
          ] }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {coverEditor && (
        <FolderCoverEditor
          folder={folder}
          dispatch={dispatch}
          socket={socket}
          position={coverEditor}
          onClose={() => setCoverEditor(null)}
        />
      )}

      {open && (
        <div>
          {childFolders.map(cf => (
            <FolderNode key={cf.id} folder={cf} depth={depth + 1} foldersById={foldersById}
              occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect} onScrollTo={onScrollTo} onSetDefault={onSetDefault} defaultOccurrenceId={defaultOccurrenceId} onOpenPage={onOpenPage} onOpenPageAndClose={onOpenPageAndClose} showAnchors={showAnchors} />
          ))}
          {pageOccs.map(occ => (
            <PageTreeNode key={occ.id} pageOccId={occ.id} activeOccId={activeOccurrenceId}
              onOpenPage={onOpenPageAndClose || onOpenPage} occurrencesById={occurrencesById} modulesById={modulesById}
              childrenByParentId={childrenByParentId} onSelect={onSelect} onScrollTo={onScrollTo}
              activeOccurrenceId={activeOccurrenceId}
              siblingOccs={pageOccs}
              depth={depth + 1} />
          ))}
          {artifactOccs.map(occ => (
            <DocNode key={occ.id} occ={occ} depth={depth + 1} isAnchor={false} parentOccId={occ.id}
              occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId} activeOccurrenceId={activeOccurrenceId}
              onSelect={onSelect} onScrollTo={onScrollTo} onSetDefault={onSetDefault} defaultOccurrenceId={defaultOccurrenceId} showAnchors={showAnchors}
              dispatch={dispatch} socket={socket} siblingOccs={artifactOccs} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PageTreeNode — pill style page entry + container anchor chips (draggable) ──
function PageTreeNode({ pageOccId, activeOccId, onOpenPage, onClosePage, occurrencesById, modulesById, childrenByParentId, onSelect, onScrollTo, activeOccurrenceId, reverseIndent = false, depth = 0, siblingOccs = null }) {
  const { dispatch, socket } = useGridActions();
  const pageOcc = occurrencesById?.[pageOccId];
  const pageMod = pageOcc ? modulesById?.[pageOcc.moduleId] : null;
  const [open, setOpen] = useState(false);
  const [dropEdge, setDropEdge] = useState(null);
  const dropEdgeRef = useRef(null);
  const rowRef = useRef(null);

  // Sibling-reorder drop target — accepts other page rows from the same tree
  // and rewrites sortOrder so they slot above/below this row. Only enabled
  // when the caller hands us a `siblingOccs` list (root tree mode).
  useEffect(() => {
    if (!rowRef.current || !siblingOccs || !dispatch || !socket || !pageOcc) return;
    return dropTargetForElements({
      element: rowRef.current,
      canDrop: ({ source }) => source.data?.type === "module" && source.data?.sourceType === "tree-page" && source.data?.occurrenceId && source.data.occurrenceId !== pageOccId,
      onDragEnter: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const edge = location.current.input.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
        setDropEdge(edge); dropEdgeRef.current = edge;
      },
      onDrag: ({ location }) => {
        const rect = rowRef.current.getBoundingClientRect();
        const edge = location.current.input.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
        if (dropEdgeRef.current !== edge) { setDropEdge(edge); dropEdgeRef.current = edge; }
      },
      onDragLeave: () => { setDropEdge(null); dropEdgeRef.current = null; },
      onDrop: ({ source }) => {
        const edge = dropEdgeRef.current;
        setDropEdge(null); dropEdgeRef.current = null;
        const occurrenceId = source.data?.occurrenceId;
        if (!occurrenceId) return;
        const myOrder = pageOcc.sortOrder ?? 0;
        const sorted = siblingOccs.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const myIdx = sorted.findIndex(s => s.id === pageOccId);
        let newOrder;
        if (edge === "top") {
          const prev = myIdx > 0 ? sorted[myIdx - 1] : null;
          newOrder = prev ? ((prev.sortOrder ?? 0) + myOrder) / 2 : myOrder - 1;
        } else {
          const next = myIdx < sorted.length - 1 ? sorted[myIdx + 1] : null;
          newOrder = next ? (myOrder + (next.sortOrder ?? 0)) / 2 : myOrder + 1;
        }
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occurrenceId, parentId: pageOcc.parentId, sortOrder: newOrder },
          emit: true,
        });
      },
    });
  }, [pageOccId, pageOcc, siblingOccs, dispatch, socket]);

  if (!pageOcc || !pageMod || pageMod.role !== "page") return null;

  const label = pageMod.label || "Untitled";
  const isActive = pageOccId === activeOccId;
  const kind = pageMod.kind || "board";
  const KindIcon = PAGE_KIND_ICON[kind] || Layout;
  // Children from explicit occurrences[] array + implicit parentId linkage
  const explicitOccs = (pageOcc.occurrences || [])
    .map(id => occurrencesById?.[id])
    .filter(o => o && modulesById?.[o.moduleId] && modulesById[o.moduleId].role !== "page");
  const implicitOccs = (childrenByParentId?.[pageOccId] || [])
    .filter(o => o && modulesById?.[o.moduleId] && modulesById[o.moduleId].role !== "page");
  // Deduplicate by ID
  const seenIds = new Set(explicitOccs.map(o => o.id));
  const combined = [...explicitOccs, ...implicitOccs.filter(o => !seenIds.has(o.id))];
  const containerOccs = combined.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const hasChildren = containerOccs.length > 0;

  // Whether we have the props needed to render DocNode-style rows (root tree mode)
  const hasDocNodeProps = !!childrenByParentId;

  const chevron = (
    <span
      onClick={(e) => { if (hasChildren) { e.stopPropagation(); setOpen(v => !v); } }}
      style={{ cursor: hasChildren ? "pointer" : "default", opacity: hasChildren ? 0.5 : 0, pointerEvents: hasChildren ? "auto" : "none", padding: "4px 2px", flexShrink: 0, display: "flex", alignItems: "center" }}
    >
      <ChevronRight size={8} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
    </span>
  );

  // X close button — rendered INSIDE the pill via `leadingSlot`, so it sits
  // immediately to the left of the drag handle (GripVertical) on the node
  // itself. Hover-revealed via .manifest-row-x-slot CSS.
  const closeSlot = onClosePage ? (
    <span
      onClick={(e) => { e.stopPropagation(); onClosePage(pageOccId); }}
      onPointerDown={(e) => e.stopPropagation()}
      title="Close page"
      className="manifest-row-x-slot"
      style={{
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", borderRadius: 3, cursor: "pointer",
      }}
    >
      <X size={9} />
    </span>
  ) : null;
  return (
    <div ref={rowRef} style={{ paddingRight: 2, position: "relative", marginLeft: depth * 8 }}>
      {dropEdge === "top"    && <div style={{ position: "absolute", top: 0,    left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1, zIndex: 2 }} />}
      {dropEdge === "bottom" && <div style={{ position: "absolute", bottom: 0, left: 4, right: 4, height: 2, background: "var(--accent-blue)", borderRadius: 1, zIndex: 2 }} />}
      <div style={{ display: "flex", alignItems: "center", flexDirection: "row", gap: 1 }} className="manifest-row">
        {!reverseIndent && chevron}
        <NodePill
          occurrence={pageOcc}
          module={pageMod}
          leadingSlot={closeSlot}
          onClick={() => {
            // Clicking a page opens THE PAGE (user 2026-08-05: "folders are
            // opening before the pages when i click on them in the side bar …
            // thats too many steps to get to what i want").
            //
            // This deliberately retires the folder-first drilldown from
            // 2026-04-02, which opened the page's FOLDER and then animated into
            // the card. That was a nice reveal exactly once; every time after,
            // it is a detour on the way somewhere you already named by clicking
            // it. The folder is still one click away — its own row opens it.
            onOpenPage?.(pageOccId);
          }}
          isActive={isActive}
          depth={depth}
          dragData={{
            // type: "page" so containers (CONTAINER_LIST accepts MODULE+INSTANCE
            // but not PAGE) reject the drop and only panels — whose pageDropRef
            // accepts [DragType.PAGE] — light up.
            type: "page", sourceType: "tree-page", role: "page",
            id: pageMod.id, data: pageMod, occurrenceId: pageOccId,
            moduleId: pageMod.id,
          }}
          reverseIndent={reverseIndent}
          style={{ flex: 1 }}
        />
        {reverseIndent && chevron}
      </div>
      {/* Children — visible when expanded */}
      {hasChildren && open && (
        <div style={{ paddingLeft: reverseIndent ? 0 : (hasDocNodeProps ? 6 : 10), paddingRight: reverseIndent ? (hasDocNodeProps ? 6 : 10) : 0, paddingBottom: 2 }}>
          {hasDocNodeProps ? (
            containerOccs.map(contOcc => (
              <DocNode key={contOcc.id} occ={contOcc} depth={1} isAnchor={true} parentOccId={pageOccId}
                occurrencesById={occurrencesById} modulesById={modulesById} childrenByParentId={childrenByParentId}
                activeOccurrenceId={activeOccurrenceId || activeOccId}
                onSelect={onSelect} onScrollTo={onScrollTo} showAnchors={true} />
            ))
          ) : (
            containerOccs.map(contOcc => (
              <AnchorChip key={contOcc.id} contOcc={contOcc} modulesById={modulesById}
                onOpenPage={onOpenPage} pageOccId={pageOccId} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── LocalFolderGroup — folder header + pinned pages, mirrors FolderNode style ──
function LocalFolderGroup({ folder, pageOccIds, occurrencesById, modulesById, childrenByParentId, view, onOpenPage, onClosePage, onSelect, onScrollTo }) {
  const { dispatch, socket, state } = useGridActions();
  const [open, setOpen] = useState(true);
  const hasChildren = pageOccIds.length > 0;

  // Find an existing folder-page occurrence under this folder, or mint one on
  // demand. Mirrors FolderNode.handleFolderClick so the local tree behaves the
  // same as the root tree. Calls onOpenPage SYNCHRONOUSLY after dispatch — the
  // optimistic createOccurrence dispatch lands the new occ in the store before
  // openPage runs, so a setTimeout grace window is unnecessary (and was masking
  // the case where openPage's `currentView` closure was stale by 50ms).
  const openFolderAsPage = useCallback(() => {
    const navigate = onOpenPage || onSelect;
    if (!navigate) return;
    const allChildren = childrenByParentId?.[folder.id] || [];
    const folderPageOcc = allChildren.find(occ => {
      const mod = modulesById?.[occ.moduleId];
      return mod?.kind === "folder" && mod?.role === "page";
    });
    if (folderPageOcc) {
      navigate(folderPageOcc.id);
      return;
    }
    const userId = state?.userId;
    const gridId = state?.grid?._id || state?.gridId;
    if (!dispatch || !socket || !userId || !gridId) return;
    const modId = crypto.randomUUID();
    const occId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: modId, userId, gridId, role: "page", kind: "folder", label: folder.name }, emit: true });
    // moduleId is the schema-canonical pointer the rest of the client reads
    // (pagesList / activePageEntry / role lookups all do `occurrencesById[id].moduleId`).
    // Without it the new folder page is invisible to ModulePanel.pagesList → falls back to pagesList[0] (Schedule).
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: folder.id, sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: {} }, emit: true });
    navigate(occId);
  }, [onOpenPage, onSelect, childrenByParentId, folder.id, folder.name, modulesById, dispatch, socket, state]);

  return (
    <div style={{ marginLeft: 0, paddingRight: 2 }}>
      <div style={{ display: "flex", alignItems: "center" }} className="manifest-row">
        <span
          style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: hasChildren ? "pointer" : "default", opacity: hasChildren ? 1 : 0, pointerEvents: hasChildren ? "auto" : "none" }}
          onClick={(e) => { if (hasChildren) { e.stopPropagation(); setOpen(v => !v); } }}
        >
          <ChevronRight size={8} style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
        </span>
        <NodePill
          module={{ kind: "folder", label: folder.name }}
          onClick={openFolderAsPage}
          style={{ flex: 1 }}
          leadingSlot={
            onClosePage ? (
              <span
                onClick={(e) => { e.stopPropagation(); pageOccIds.forEach(id => onClosePage(id)); }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Close all pages in folder"
                className="manifest-row-x-slot"
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-muted)", borderRadius: 3, cursor: "pointer",
                }}
              >
                <X size={9} />
              </span>
            ) : null
          }
        />
      </div>
      {open && hasChildren && (
        <div>
          {pageOccIds.map(pageOccId => (
            <PageTreeNode
              key={pageOccId}
              pageOccId={pageOccId}
              activeOccId={view?.activeOccurrenceId}
              activeOccurrenceId={view?.activeOccurrenceId}
              onOpenPage={onOpenPage}
              onClosePage={onClosePage}
              occurrencesById={occurrencesById}
              modulesById={modulesById}
              childrenByParentId={childrenByParentId}
              onSelect={onSelect}
              onScrollTo={onScrollTo}
              depth={1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AnchorChip — draggable anchor inside PageTreeNode (local tree mode) ──
function AnchorChip({ contOcc, modulesById, onOpenPage, pageOccId }) {
  const contMod = modulesById?.[contOcc.moduleId];
  return (
    <NodePill
      occurrence={contOcc}
      module={{ ...contMod, role: "container" }}
      onClick={() => {
        // jumpToOccurrence opens the host page (via onActivatePage) and
        // then retries the scroll-and-flash after the page mounts.
        jumpToOccurrence(contOcc.id, {
          onActivatePage: () => onOpenPage?.(pageOccId),
        });
      }}
      dragData={{
        type: "module", sourceType: "tree-anchor", role: "container",
        id: contOcc.moduleId, data: contMod, occurrenceId: contOcc.id,
      }}
    />
  );
}

// Small icon-only buttons in the tree header (new folder / add page / close).
const treeHeaderBtnStyle = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--text-faint)", padding: "0 3px",
  display: "flex", alignItems: "center", justifyContent: "center",
  opacity: 0.7, height: 20, width: 20,
};

// ─── ManifestTree ─────────────────────────────────────────────────────────────
export default function ManifestTree({ manifestId, view, dispatch, socket, collapsed, onToggleCollapse, scrollHighlightId, panelOccurrence, onOpenPage, onClosePage, activePageView }) {
  const { manifestsById, foldersById, occurrencesById, modulesById, childrenByParentId, state } = useGridActions();
  // foldersById is already available above
  const manifest = manifestsById?.[manifestId];
  const rootFolder = manifest?.rootFolderId ? foldersById?.[manifest.rootFolderId] : null;
  const isPagePanel = !!panelOccurrence;
  // Local-tree single-root toggle. Synthetic "Local" wrapper around the
  // panel's pinned folder groups + root pages so the tree reads as one
  // collapsible root instead of N flat top-level entries. Pure render-
  // only grouping — no seed change, no folder record. Defaults open;
  // user collapses to hide the whole pinned set.
  const [localRootOpen, setLocalRootOpen] = useState(true);

  // Clicking a doc — opens page (page panels) or sets active doc (artifact panels)
  // Priority: activePageView (tree-view page) > panel view > onOpenPage fallback
  const handleSelect = useCallback((occId) => {
    const targetView = activePageView || view;
    // Artifact rows in a PAGE panel open a full-screen ARTIFACT PAGE
    // (2026-07-12): a page panel's board view tracks the ACTIVE PAGE — setting
    // its activeOccurrenceId to a bare artifact occurrence resolved to nothing
    // and the panel snapped back to page 0 ("can't open image artifacts from
    // the manifest"). Non-artifact clicks return null and fall through;
    // artifact-tree panels (hasTree views) keep the inline viewer behavior.
    if (onOpenPage && !targetView?.hasTree) {
      const pageOccId = ensureArtifactPageOcc({
        artifactOccId: occId, occurrencesById, modulesById,
        gridId: state?.grid?._id, userId: state?.userId, dispatch, socket,
      });
      if (pageOccId) { onOpenPage(pageOccId); return; }
    }
    if (targetView?.id) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, activeOccurrenceId: occId, scrollAnchor: null }, emit: true });
    } else if (onOpenPage) {
      onOpenPage(occId);
    }
  }, [activePageView, view, onOpenPage, dispatch, socket, occurrencesById, modulesById, state?.grid?._id, state?.userId]);

  // Wrap onOpenPage — keep tree open when navigating
  const handleOpenPage = useCallback((...args) => {
    onOpenPage?.(...args);
  }, [onOpenPage]);

  // Clicking an anchor chip → keep parent doc open, scroll to heading
  const handleScrollTo = useCallback((parentOccId, anchorOccId) => {
    const targetView = activePageView || view;
    const pageAlreadyOpen = targetView?.activeOccurrenceId === parentOccId;

    if (targetView?.id) {
      if (pageAlreadyOpen && anchorOccId) {
        // Page already open — scroll directly via getBoundingClientRect (works for nested containers)
        const el = document.querySelector(`[data-occ-id="${anchorOccId}"]`);
        if (el) {
          const sc = el.closest(".artifact-markdown");
          if (sc) {
            sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top, behavior: "smooth" });
          } else {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          el.classList.remove("anchor-highlight");
          void el.offsetWidth;
          el.classList.add("anchor-highlight");
          setTimeout(() => el.classList.remove("anchor-highlight"), 1200);
        }
        CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, scrollAnchor: anchorOccId }, emit: false });
      } else {
        CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, activeOccurrenceId: parentOccId, scrollAnchor: anchorOccId }, emit: true });
      }
    } else if (onOpenPage) {
      onOpenPage(parentOccId);
    }
  }, [activePageView, view, dispatch, socket, onOpenPage]);

  // Set a doc as the default landing page for this tree panel
  const handleSetDefault = useCallback((occId) => {
    const targetView = activePageView || view;
    if (!targetView?.id) return;
    CommitHelpers.updateView({ dispatch, socket, view: { ...targetView, defaultOccurrenceId: occId } });
  }, [activePageView, view, dispatch, socket]);

  // Create a new page and pin it to the panel. Returns the new page's
  // occurrence id (or null) so callers that need it — the create-from-
  // template flow below — don't need a second creation path.
  const handleCreatePage = useCallback((kind) => {
    if (!panelOccurrence?.id || !state?.userId || !state?.grid?._id) return null;
    return CommitHelpers.createPagePinnedToPanel({
      dispatch, socket, gridId: state.grid._id, userId: state.userId,
      kind, panelOccurrenceId: panelOccurrence.id,
      panelView: view, rootFolderId: manifest?.rootFolderId ?? null,
    });
  }, [panelOccurrence, state, dispatch, socket, manifest, view]);

  // QuickAddMenu (targetRole="page") "Create new" tile → mint the page via
  // the SAME commit path as picking a kind by hand.
  const handleQuickAddCreatePage = useCallback(({ kind }) => {
    handleCreatePage(kind);
  }, [handleCreatePage]);

  // QuickAddMenu existing-match row → open the picked page module. Routed
  // through the same `onOpenPage` (ModulePanel's `openPage`) every other row
  // in this tree already uses — it pins-if-not-pinned + activates + closes
  // the trees, so this doesn't need its own pin/activate copy.
  const handleQuickAddSelectPage = useCallback((pageModule) => {
    if (!pageModule?.id || !panelOccurrence?.id) return;
    const pageOcc = Object.values(occurrencesById).find(o => o.moduleId === pageModule.id);
    if (!pageOcc) return;
    handleOpenPage(pageOcc.id);
  }, [panelOccurrence?.id, occurrencesById, handleOpenPage]);

  // QuickAddMenu template row (targetRole="page") — the menu only tells us
  // WHICH template + kind was picked; the host owns create-then-apply.
  // mode:"merge" because structure flows from the template while anything
  // the (empty, freshly-minted) page already has stays untouched.
  const handleCreatePageFromTemplate = useCallback(({ templateOccId, kind }) => {
    const newOccId = handleCreatePage(kind);
    if (!newOccId || !templateOccId) return;
    CommitHelpers.commitApplyTemplate(socket, { templateOccurrenceId: templateOccId, targetOccurrenceId: newOccId, mode: "merge" });
  }, [handleCreatePage, socket]);

  // Imperative open for the header's "+" — the same lazy-mount +
  // openTrigger pattern ModulePanel uses for its "Add page…" adder.
  const [pageQuickAddTrigger, setPageQuickAddTrigger] = useState(0);

  // Create a new folder in the manifest root
  const handleCreateFolder = useCallback(() => {
    if (!state?.userId || !state?.grid?._id || !manifest?.rootFolderId || !dispatch || !socket) return;
    const folder = { id: crypto.randomUUID(), name: "New Folder", parentId: manifest.rootFolderId, gridId: state.grid._id, userId: state.userId, folderType: "normal" };
    CommitHelpers.createFolder({ dispatch, socket, folder, emit: true });
  }, [state, socket, dispatch, manifest]);

  // Open pages list for the local section — grouped by parent folder for B2
  const localTreeData = useMemo(() => {
    if (!isPagePanel) return { folderGroups: [], rootPages: [], folderNodes: [] };
    const pinned = (panelOccurrence.occurrences || [])
      .map(id => occurrencesById?.[id])
      .filter(occ => occ && modulesById?.[occ.moduleId]?.role === "page");
    // A pinned FOLDER page (kind:"folder") is the "open this folder" artifact,
    // not a content page — it can't be a tree row itself. But when it's the
    // ONLY thing a panel holds (the Boards panel: one folder page fronting 34
    // board pages nested in 7 sub-folders), excluding it left the sidebar
    // reading "No pages" (2026-07-25). Render the FOLDER it points at as a real
    // FolderNode instead, so its whole subtree is browsable from the panel.
    const folderNodes = [];
    const pageOccs = [];
    for (const occ of pinned) {
      if (modulesById[occ.moduleId]?.kind === "folder") {
        const folder = occ.parentId ? foldersById?.[occ.parentId] : null;
        if (folder) folderNodes.push(folder);
      } else {
        pageOccs.push(occ);
      }
    }
    const folderMap = new Map();
    const rootPages = [];
    for (const occ of pageOccs) {
      const folder = occ.parentId ? foldersById?.[occ.parentId] : null;
      if (folder) {
        if (!folderMap.has(folder.id)) folderMap.set(folder.id, { folder, pages: [] });
        folderMap.get(folder.id).pages.push(occ.id);
      } else {
        rootPages.push(occ.id);
      }
    }
    // A folder already shown as a full FolderNode must not ALSO render as a
    // flat pinned-pages group — that would list its pages twice.
    const nodeIds = new Set(folderNodes.map(f => f.id));
    return {
      folderGroups: [...folderMap.values()].filter(g => !nodeIds.has(g.folder.id)),
      rootPages,
      folderNodes,
    };
  }, [isPagePanel, panelOccurrence?.occurrences, occurrencesById, modulesById, foldersById]);

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
        width: collapsed ? 24 : "220px",
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
              {isPagePanel ? "Local" : (manifest?.name || "Files")}
            </span>
            <div style={{ flexShrink: 0, position: "relative", display: "flex", alignItems: "center", gap: 1 }}>
              {isPagePanel && (
                <button onClick={handleCreateFolder} title="New folder" style={treeHeaderBtnStyle}>
                  <FolderPlus size={12} />
                </button>
              )}
              {/* ONE create-page menu (shared with ModulePanel's "Add page…"):
                  the header's own + button bumps the imperative openTrigger —
                  same lazy-mount pattern ModulePanel already uses — instead of
                  the old hardcoded per-kind RadialMenu item list. Board / Doc /
                  Canvas / Table / Folder + every matching template now come
                  from QuickAddMenu, so this surface and the panel's "Add
                  page…" can never drift apart. */}
              {isPagePanel && (
                <>
                  <button onClick={() => setPageQuickAddTrigger(n => n + 1)} title="Add page" style={treeHeaderBtnStyle}>
                    <Plus size={12} />
                  </button>
                  {pageQuickAddTrigger > 0 && (
                    <span style={{ width: 0, height: 0, overflow: "hidden" }}>
                      <QuickAddMenu
                        targetRole="page"
                        onSelect={handleQuickAddSelectPage}
                        onCreateNew={handleQuickAddCreatePage}
                        onCreatePageFromTemplate={handleCreatePageFromTemplate}
                        hostOccurrence={panelOccurrence}
                        openTrigger={pageQuickAddTrigger}
                      />
                    </span>
                  )}
                </>
              )}
              <button onClick={onToggleCollapse} title="Close" style={treeHeaderBtnStyle}>
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Tree content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1px 0 4px" }}>
            {isPagePanel ? (
              /* Local tree — wrapped under a synthetic "Local" root so the
                 panel sidebar reads as one expandable section instead of N
                 flat top-level folder headers. Chevron + pill mirrors
                 LocalFolderGroup/FolderNode chrome. */
              (localTreeData.rootPages.length === 0 && localTreeData.folderGroups.length === 0 && localTreeData.folderNodes.length === 0) ? (
                <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 8px" }}>No pages</div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center" }} className="manifest-row">
                    <span
                      style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 2px", cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setLocalRootOpen(v => !v); }}
                    >
                      <ChevronRight size={8} style={{ opacity: 0.35, transform: localRootOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s" }} />
                    </span>
                    <NodePill
                      module={{ kind: "folder", label: "Local" }}
                      onClick={() => setLocalRootOpen(v => !v)}
                      style={{ flex: 1 }}
                    />
                  </div>
                  {localRootOpen && (
                  <div style={{ marginLeft: 12 }}>
                  {/* Pinned FOLDER pages render their real folder subtree, so a
                      panel fronted by a folder page (Boards) is fully browsable. */}
                  {localTreeData.folderNodes.map(folder => (
                    <FolderNode
                      key={folder.id}
                      folder={folder}
                      depth={0}
                      foldersById={foldersById}
                      occurrencesById={occurrencesById}
                      modulesById={modulesById}
                      childrenByParentId={childrenByParentId}
                      activeOccurrenceId={view?.activeOccurrenceId}
                      onSelect={handleSelect}
                      onScrollTo={handleScrollTo}
                      onOpenPage={handleOpenPage}
                      onOpenPageAndClose={handleOpenPage}
                    />
                  ))}
                  {/* Folder groups — chevron + folder pill, pages indented underneath (same as FolderNode) */}
                  {localTreeData.folderGroups.map(({ folder, pages }) => (
                    <LocalFolderGroup
                      key={folder.id}
                      folder={folder}
                      pageOccIds={pages}
                      occurrencesById={occurrencesById}
                      modulesById={modulesById}
                      childrenByParentId={childrenByParentId}
                      view={view}
                      onOpenPage={handleOpenPage}
                      onClosePage={onClosePage}
                      onSelect={handleSelect}
                      onScrollTo={handleScrollTo}
                    />
                  ))}
                  {/* Root-level pages (no parent folder) — flat, like root tree's flat pages */}
                  {localTreeData.rootPages.map(pageOccId => (
                    <PageTreeNode
                      key={pageOccId}
                      pageOccId={pageOccId}
                      activeOccId={view?.activeOccurrenceId}
                      activeOccurrenceId={view?.activeOccurrenceId}
                      onOpenPage={handleOpenPage}
                      onClosePage={onClosePage}
                      occurrencesById={occurrencesById}
                      modulesById={modulesById}
                      childrenByParentId={childrenByParentId}
                      onSelect={handleSelect}
                      onScrollTo={handleScrollTo}
                      depth={0}
                    />
                  ))}
                  </div>
                  )}
                </div>
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
                  onOpenPageAndClose={handleOpenPage}
                  showAnchors={true}
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
