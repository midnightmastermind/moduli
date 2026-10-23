// vr/VrOffice.jsx — the VR office, opened from Moduli itself (`/?office`).
//
// Runs INSIDE the app (user, 2026-10-21): it reads the grid the tab already
// holds, so a shelf is a saved query answered by the feed code, and its
// settings use the app's own feed editor. The grid stays rendered UNDER this
// overlay, which is what a "whole grid" screen is a picture of.
//
// While the office is open the tab keeps its layout to itself
// (helpers/localLayout): opening a book here moves a panel on THIS device only.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toCanvas } from "html-to-image";
import { createOfficeScene } from "./officeScene.js";
import {
  readOffice, addShelf, updateShelf, removeShelf, addScreen, updateScreen, removeScreen,
  SHELF_ASSETS, ASSET_LABELS,
} from "./officeConfig.js";
import { shelfItems } from "./shelfItems.js";
import { decorLibrary } from "./decorLibrary.js";
import FeedSection from "../ui/FeedSection.jsx";
import { PagePreviewBody } from "../PagePreviewApp.jsx";
import { updateGridAction } from "../state/actions";
import { sessionHeaders } from "../helpers/authStorage";
import { openFromLink } from "../helpers/deepLinkOpen.js";
import { setLocalLayout } from "../helpers/localLayout.js";
import { toast } from "../state/notificationStore";

const SNAP_W = 1280, SNAP_H = 720;
const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const btn = {
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

export default function VrOffice({ grid, occurrencesById, modulesById, viewsById, dispatch, socket, onClose }) {
  const gridId = grid?._id || grid?.id;
  const office = useMemo(() => readOffice(grid), [grid]);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [statusText, setStatusText] = useState("");
  const [editing, setEditing] = useState(null);          // { kind: "shelf"|"screen", id }
  const [snapPage, setSnapPage] = useState(null);        // page occurrence being pictured
  const snapResolve = useRef(null);
  const [xr, setXr] = useState({ ar: false, vr: false });

  // The scene reads the newest props through this ref, never a stale closure.
  const live = useRef({});
  live.current = { grid, gridId, occurrencesById, modulesById, viewsById, dispatch, socket, office };

  // Keep the tab's layout local for as long as it is in the office.
  useEffect(() => { setLocalLayout(true); }, []);

  // ── Saving: locally at once, then `meta.vrOffice` alone on the server ────
  const save = useCallback(async (meta) => {
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
  }, []);

  // ── Pictures for the screens ────────────────────────────────────────────
  // A picture copies every element's computed style, so it only takes what can be SEEN: anything scrolled out of
  // its panel (or out of the pictured box) is left out. On poms grid the whole-grid picture took ~16s on a desktop
  // (~200s at a Quest's speed) and froze the office's load; a picture can never show the hidden rows anyway.
  const picture = useCallback(async (node) => {
    if (!node) return null;
    try {
      const keep = visibleOnlyFilter(node);
      return await toCanvas(node, {
        width: SNAP_W, height: SNAP_H, canvasWidth: SNAP_W, canvasHeight: SNAP_H, pixelRatio: 1,
        filter: keep,
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
  // One page at a time: mount it off screen, give it a moment to draw, picture it.
  const snapChain = useRef(Promise.resolve());
  const snapshotPage = useCallback((pageOccId) => {
    const run = () => new Promise((resolve) => { snapResolve.current = resolve; setSnapPage(pageOccId); });
    const p = snapChain.current.then(run, run);
    snapChain.current = p.catch(() => {});
    return p;
  }, []);
  const snapHostRef = useRef(null);
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

  const pageLabel = useCallback((id) => {
    const o = live.current.occurrencesById?.[id];
    const m = o && live.current.modulesById?.[o.moduleId];
    return o ? (o.label || m?.label || "Page") : null;
  }, []);

  // ── Leaving the headset for a 2D step ───────────────────────────────────
  const leaveForEdit = useCallback(async (kind, id) => {
    await sceneRef.current?.endSession();
    setEditing({ kind, id });
  }, []);
  const openInApp = useCallback(async (id) => {
    await sceneRef.current?.endSession();
    onClose();
    if (!id) return; // the grid itself: it is what you return to
    const L = live.current;
    const res = openFromLink({ occId: id, grid: L.grid, occurrencesById: L.occurrencesById, modulesById: L.modulesById, viewsById: L.viewsById, dispatch: L.dispatch, socket: L.socket });
    if (!res.ok) toast(`Could not open that: ${res.reason}.`);
  }, [onClose]);

  // ── The scene ───────────────────────────────────────────────────────────
  useEffect(() => {
    const host = {
      layoutKey: `moduli-vr-layout:${live.current.gridId}`,
      status: setStatusText,
      shelves: () => live.current.office.shelves.map((shelf) => ({
        shelf, items: shelfItems(shelf, live.current),
      })),
      screens: () => live.current.office.screens.map((screen) => ({
        screen,
        label: screen.source === "grid" ? "The grid" : (screen.pageOccId ? pageLabel(screen.pageOccId) || "Missing page" : null),
      })),
      decor: () => decorLibrary(live.current),
      open: openInApp,
      editShelf: (id) => leaveForEdit("shelf", id),
      editScreen: (id) => leaveForEdit("screen", id),
      addShelf: async (asset) => {
        const { meta, shelf } = addShelf(live.current.grid, asset);
        live.current.office = meta.vrOffice; await save(meta); return shelf.id;
      },
      // Delete from the headset (the hold menu): a shelf or screen leaves the office's saved setup.
      removeFixture: async (key) => {
        const [kind, id] = String(key).split(":");
        const g = live.current.grid;
        const meta = kind === "shelf" ? removeShelf(g, id) : kind === "screen" ? removeScreen(g, id) : null;
        if (!meta) return false;
        live.current.office = meta.vrOffice; await save(meta); return true;
      },
      addScreen: async () => {
        const { meta, screen } = addScreen(live.current.grid, { source: "grid" });
        live.current.office = meta.vrOffice; await save(meta); return screen.id;
      },
      snapshot: (screen) => {
        if (screen.source === "grid") return picture(document.querySelector(".grid-frame"));
        if (screen.pageOccId && live.current.occurrencesById?.[screen.pageOccId]) return snapshotPage(screen.pageOccId);
        return Promise.resolve(null);
      },
    };
    const scene = createOfficeScene(mountRef.current, host);
    sceneRef.current = scene;
    if (navigator.xr) {
      Promise.all([
        navigator.xr.isSessionSupported("immersive-ar").catch(() => false),
        navigator.xr.isSessionSupported("immersive-vr").catch(() => false),
      ]).then(([ar, vr]) => setXr({ ar, vr }));
    } else setStatusText("This browser has no WebXR — open Moduli on the Quest and choose Office.");
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [openInApp, leaveForEdit, save, picture, snapshotPage, pageLabel]);

  // Shelves and screens follow their settings; contents follow the grid
  // (at most every few seconds — a shelf rebuild draws textures).
  const officeKey = JSON.stringify(office);
  useEffect(() => { sceneRef.current?.refresh(); }, [officeKey]);
  const lastRows = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, 5000 - (Date.now() - lastRows.current));
    const t = setTimeout(() => { lastRows.current = Date.now(); sceneRef.current?.refresh(); sceneRef.current?.refreshDecor(); }, wait);
    return () => clearTimeout(t);
  }, [occurrencesById]);

  const enter = (mode) => sceneRef.current?.startSession(mode).catch((e) => setStatusText((mode === "immersive-ar" ? "Mixed reality" : "VR") + " failed: " + e.message));

  // ── Settings dialogs (the 2D step) ──────────────────────────────────────
  const shelf = editing?.kind === "shelf" ? office.shelves.find((s) => s.id === editing.id) : null;
  const screen = editing?.kind === "screen" ? office.screens.find((s) => s.id === editing.id) : null;
  const pages = useMemo(() => {
    if (editing?.kind !== "screen") return [];
    const out = [];
    for (const o of Object.values(occurrencesById || {})) {
      const m = modulesById?.[o.moduleId];
      if (m?.role === "page" && (!o.gridId || o.gridId === gridId)) out.push({ id: o.id, label: o.label || m.label || "Untitled" });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [editing, occurrencesById, modulesById, gridId]);
  const shelfCount = useMemo(() => (shelf ? shelfItems(shelf, { grid, occurrencesById, modulesById }).length : 0), [shelf, grid, occurrencesById, modulesById]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "var(--surface-card)" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn} disabled={!xr.ar} onClick={() => enter("immersive-ar")}>Enter mixed reality</button>
        <button style={btn} disabled={!xr.vr} onClick={() => enter("immersive-vr")}>Enter VR</button>
        <button style={btn} onClick={() => sceneRef.current?.resetLayout()}>Reset layout</button>
        <button style={btn} onClick={onClose}>Back to Moduli</button>
        <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{statusText}</span>
      </div>
      <div style={{ position: "absolute", bottom: 10, left: 10, color: "var(--text-muted)", fontSize: 12, maxWidth: 520 }}>
        On this device, the panels and the date stay as you leave them here. Other devices are not changed.
      </div>

      {(shelf || screen) && (
        <div role="dialog" aria-label={shelf ? "Shelf settings" : "Screen settings"} style={{
          position: "absolute", inset: 0, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{
            width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", background: "var(--surface-card, #1d1d1d)",
            border: "1px solid var(--border-subtle)", borderRadius: 12, color: "var(--text-primary)", padding: 14,
          }}>
            {shelf && (
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
                <div style={{ fontSize: 13, margin: "6px 0" }}>What it holds ({shelfCount} now):</div>
                <FeedSection
                  occurrence={{ id: shelf.id, gridId }}
                  feed={shelf.feed}
                  onFeedChange={(feed) => save(updateShelf(grid, shelf.id, { feed }))}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 12 }}>
                  <button style={btn} onClick={() => { if (window.confirm(`Remove "${shelf.title}"?`)) { save(removeShelf(grid, shelf.id)); setEditing(null); } }}>Remove shelf</button>
                  <button style={btn} onClick={() => setEditing(null)}>Done</button>
                </div>
              </>
            )}
            {screen && (
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
                  <button style={btn} onClick={() => { if (window.confirm("Remove this screen?")) { save(removeScreen(grid, screen.id)); setEditing(null); } }}>Remove screen</button>
                  <button style={btn} onClick={() => setEditing(null)}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {snapPage && createPortal(
        <div ref={snapHostRef} aria-hidden style={{
          position: "fixed", left: -20000, top: 0, width: SNAP_W, height: SNAP_H, overflow: "hidden",
          background: getComputedStyle(document.body).backgroundColor, pointerEvents: "none",
        }}>
          <PagePreviewBody parentState={window.__moduli_state__} occurrenceId={snapPage} publishComputed={false} rootChrome />
        </div>,
        document.body,
      )}
    </div>
  );
}
