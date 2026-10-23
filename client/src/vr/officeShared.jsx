// vr/officeShared.jsx — what the browser office (VrOffice) and the Quest app's
// control panel (NativeOffice) share: saving the office, the shelf and screen
// settings forms, and taking a picture of a page for a screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toCanvas } from "html-to-image";
import { updateShelf, removeShelf, updateScreen, removeScreen, SHELF_ASSETS, ASSET_LABELS } from "./officeConfig.js";
import { shelfItems } from "./shelfItems.js";
import FeedSection from "../ui/FeedSection.jsx";
import { PagePreviewBody } from "../PagePreviewApp.jsx";
import { updateGridAction } from "../state/actions";
import { sessionHeaders } from "../helpers/authStorage";
import { toast } from "../state/notificationStore";

export const SNAP_W = 1280, SNAP_H = 720;
const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export const officeBtn = {
  fontSize: 13, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
  border: "1px solid var(--border-subtle)", background: "var(--surface-2, #2a2a2a)", color: "var(--text-primary)",
};

/** html-to-image `filter`: keep an element only if it shows inside the pictured box and inside its panel. */
export function visibleOnlyFilter(root, rectOf = (el) => el.getBoundingClientRect()) {
  const box = rectOf(root);
  const clips = new Map();
  const clipFor = (el) => {
    const panel = el.closest?.("[data-panel-id]");
    if (!panel || !root.contains(panel)) return box;
    if (!clips.has(panel)) {
      const r = rectOf(panel);
      clips.set(panel, { left: Math.max(r.left, box.left), top: Math.max(r.top, box.top), right: Math.min(r.right, box.right), bottom: Math.min(r.bottom, box.bottom) });
    }
    return clips.get(panel);
  };
  return (el) => {
    if (!(el instanceof Element) || el === root) return true;
    const r = rectOf(el);
    if (r.width === 0 && r.height === 0) return true; // an inline wrapper or a display:contents box: judge its children
    const c = clipFor(el);
    return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom;
  };
}

/** Save the office: locally at once, then `meta.vrOffice` alone on the server. `live` is a ref to { grid, gridId, dispatch }. */
export function useOfficeSave(live) {
  return useCallback(async (meta) => {
    const { grid: g, gridId: id, dispatch: d } = live.current;
    if (!id) return;
    d?.(updateGridAction({ gridId: id, grid: { ...g, meta } }));
    try {
      const r = await fetch("/api/v1/vr/office", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ gridId: id, office: meta.vrOffice }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.status);
    } catch (e) {
      toast.error(`The office could not be saved: ${e.message}`);
    }
  }, [live]);
}

/**
 * Pictures for the screens. `picture(node)` draws an element; `snapshotPage(id)` mounts that page off screen,
 * lets it draw, and pictures it (one at a time). Render `portal` somewhere in the tree.
 *
 * A picture copies every element's computed style, so it only takes what can be SEEN (visibleOnlyFilter): on poms
 * grid the whole-grid picture took ~16s on a desktop (~200s at a Quest's speed) without it.
 */
export function usePagePictures() {
  const [snapPage, setSnapPage] = useState(null);
  const snapResolve = useRef(null);
  const snapHostRef = useRef(null);
  const picture = useCallback(async (node) => {
    if (!node) return null;
    try {
      return await toCanvas(node, {
        width: SNAP_W, height: SNAP_H, canvasWidth: SNAP_W, canvasHeight: SNAP_H, pixelRatio: 1,
        filter: visibleOnlyFilter(node),
        skipFonts: true, imagePlaceholder: PLACEHOLDER, cacheBust: false,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        // The page is drawn off screen; the copy html-to-image paints must not be.
        style: { transform: "none", position: "static", left: "0", top: "0" },
      });
    } catch (e) {
      console.warn("[office] screen picture failed:", e?.message || e);
      return null;
    }
  }, []);
  const snapChain = useRef(Promise.resolve());
  const snapshotPage = useCallback((pageOccId) => {
    const run = () => new Promise((resolve) => { snapResolve.current = resolve; setSnapPage(pageOccId); });
    const p = snapChain.current.then(run, run);
    snapChain.current = p.catch(() => {});
    return p;
  }, []);
  useEffect(() => {
    if (!snapPage) return undefined;
    const t = setTimeout(async () => {
      const canvas = await picture(snapHostRef.current);
      const done = snapResolve.current; snapResolve.current = null;
      setSnapPage(null);
      done?.(canvas);
    }, 1500);
    return () => clearTimeout(t);
  }, [snapPage, picture]);
  const portal = snapPage ? createPortal(
    <div ref={snapHostRef} aria-hidden style={{
      position: "fixed", left: -20000, top: 0, width: SNAP_W, height: SNAP_H, overflow: "hidden",
      background: getComputedStyle(document.body).backgroundColor, pointerEvents: "none",
    }}>
      <PagePreviewBody parentState={window.__moduli_state__} occurrenceId={snapPage} publishComputed={false} rootChrome />
    </div>,
    document.body,
  ) : null;
  return { picture, snapshotPage, portal };
}

/** A screen's picture, or null: the whole grid as it shows under the office, or one page. */
export function screenPicture(screen, { picture, snapshotPage, occurrencesById }) {
  if (screen.source === "grid") return picture(document.querySelector(".grid-frame"));
  if (screen.pageOccId && occurrencesById?.[screen.pageOccId]) return snapshotPage(screen.pageOccId);
  return Promise.resolve(null);
}

export function ShelfSettings({ shelf, grid, gridId, occurrencesById, modulesById, foldersById, save, onDone, onRemoved, confirmRemove = true }) {
  const count = useMemo(() => shelfItems(shelf, { grid, occurrencesById, modulesById, foldersById }).length,
    [shelf, grid, occurrencesById, modulesById, foldersById]);
  // Folders by path, to pick one a shelf holds whole. Category folders (the Fields/Operations tabs') are not places.
  const folderPaths = useMemo(() => {
    const byId = foldersById || {};
    const path = (f) => { const p = []; let c = f; let n = 0; while (c && n++ < 30) { p.unshift(c.name); c = byId[c.parentId]; } return p.join(" / "); };
    return Object.values(byId)
      .filter((f) => f && f.folderType !== "category" && (!gridId || !f.gridId || f.gridId === gridId))
      .map((f) => ({ id: f.id, path: path(f) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [foldersById, gridId]);
  const remove = () => {
    if (confirmRemove && !window.confirm(`Remove "${shelf.title}"?`)) return;
    save(removeShelf(grid, shelf.id)); (onRemoved || onDone)?.();
  };
  return (
    <>
      <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Shelf</h3>
      <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Name<br />
        <input value={shelf.title} onChange={(e) => save(updateShelf(grid, shelf.id, { title: e.target.value }))}
          style={{ width: "100%", fontSize: 14, padding: 6 }} />
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Each result is a<br />
        <select value={shelf.asset} onChange={(e) => save(updateShelf(grid, shelf.id, { asset: e.target.value }))} style={{ fontSize: 14, padding: 4 }}>
          {SHELF_ASSETS.map((a) => <option key={a} value={a}>{ASSET_LABELS[a]}</option>)}
        </select>
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Holds a whole folder (every page in it and its subfolders)<br />
        <select value={shelf.folderId || ""} onChange={(e) => save(updateShelf(grid, shelf.id, { folderId: e.target.value || null }))}
          style={{ width: "100%", fontSize: 14, padding: 4 }}>
          <option value="">No — use the query below</option>
          {folderPaths.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </label>
      <div style={{ fontSize: 13, margin: "6px 0" }}>What it holds ({count} now){shelf.folderId ? " — from the folder" : ":"}</div>
      {!shelf.folderId && (
        <FeedSection
          occurrence={{ id: shelf.id, gridId }}
          feed={shelf.feed}
          onFeedChange={(feed) => save(updateShelf(grid, shelf.id, { feed }))}
        />
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 12 }}>
        <button style={officeBtn} onClick={remove}>Remove shelf</button>
        {onDone && <button style={officeBtn} onClick={onDone}>Done</button>}
      </div>
    </>
  );
}

export function ScreenSettings({ screen, grid, gridId, occurrencesById, modulesById, save, onDone, onRemoved, extra = null, confirmRemove = true }) {
  const pages = useMemo(() => {
    const out = [];
    for (const o of Object.values(occurrencesById || {})) {
      const m = modulesById?.[o.moduleId];
      if (m?.role === "page" && (!o.gridId || o.gridId === gridId)) out.push({ id: o.id, label: o.label || m.label || "Untitled" });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [occurrencesById, modulesById, gridId]);
  const remove = () => {
    if (confirmRemove && !window.confirm("Remove this screen?")) return;
    save(removeScreen(grid, screen.id)); (onRemoved || onDone)?.();
  };
  return (
    <>
      <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Screen</h3>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
        <input type="radio" checked={screen.source === "grid"} onChange={() => save(updateScreen(grid, screen.id, { source: "grid" }))} /> The whole grid
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
        <input type="radio" checked={screen.source === "page"} onChange={() => save(updateScreen(grid, screen.id, { source: "page" }))} /> A page
      </label>
      {screen.source === "page" && (
        <select value={screen.pageOccId || ""} onChange={(e) => save(updateScreen(grid, screen.id, { pageOccId: e.target.value || null }))}
          style={{ width: "100%", fontSize: 14, padding: 4, marginBottom: 8 }}>
          <option value="">Choose a page…</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 12 }}>
        <button style={officeBtn} onClick={remove}>Remove screen</button>
        {extra}
        {onDone && <button style={officeBtn} onClick={onDone}>Done</button>}
      </div>
    </>
  );
}
