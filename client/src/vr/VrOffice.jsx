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
import { createOfficeScene } from "./officeScene.js";
import { readOffice, addShelf, removeShelf, addScreen, removeScreen } from "./officeConfig.js";
import { shelfItems } from "./shelfItems.js";
import { decorLibrary } from "./decorLibrary.js";
import { officeBtn as btn, useOfficeSave, usePagePictures, screenPicture, ShelfSettings, ScreenSettings, visibleOnlyFilter } from "./officeShared.jsx";
import NativeOffice, { NativePiece, hasNativeBridge } from "./NativeOffice.jsx";
import { openFromLink } from "../helpers/deepLinkOpen.js";
import { setLocalLayout } from "../helpers/localLayout.js";
import { toast } from "../state/notificationStore";

export { visibleOnlyFilter };

/** In the Quest app the office is native; this page is its control panel. */
export default function VrOfficeEntry(props) {
  if (!hasNativeBridge()) return <VrOffice {...props} />;
  // `/?office&piece=<key>`: one piece's own settings window (the ⚙ beside it in the headset).
  const piece = new URLSearchParams(window.location.search).get("piece");
  return piece ? <NativePiece pieceKey={piece} {...props} /> : <NativeOffice {...props} />;
}

function VrOffice({ grid, occurrencesById, modulesById, viewsById, dispatch, socket, onClose }) {
  const gridId = grid?._id || grid?.id;
  const office = useMemo(() => readOffice(grid), [grid]);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [statusText, setStatusText] = useState("");
  const [editing, setEditing] = useState(null);          // { kind: "shelf"|"screen", id }
  const [xr, setXr] = useState({ ar: false, vr: false });

  // The scene reads the newest props through this ref, never a stale closure.
  const live = useRef({});
  live.current = { grid, gridId, occurrencesById, modulesById, viewsById, dispatch, socket, office };

  // Keep the tab's layout local for as long as it is in the office.
  useEffect(() => { setLocalLayout(true); }, []);

  const save = useOfficeSave(live);
  const { picture, snapshotPage, portal: snapPortal } = usePagePictures();

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
      snapshot: (screen) => screenPicture(screen, { picture, snapshotPage, occurrencesById: live.current.occurrencesById }),
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
            {shelf && <ShelfSettings shelf={shelf} grid={grid} gridId={gridId} occurrencesById={occurrencesById} modulesById={modulesById} save={save} onDone={() => setEditing(null)} />}
            {screen && <ScreenSettings screen={screen} grid={grid} gridId={gridId} occurrencesById={occurrencesById} modulesById={modulesById} save={save} onDone={() => setEditing(null)} />}
          </div>
        </div>
      )}

      {snapPortal}
    </div>
  );
}
