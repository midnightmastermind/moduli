// vr/NativeOffice.jsx — the office's control panel inside the Quest app (quest/).
//
// The Quest app draws the room itself (passthrough, room anchors, grab). This
// page is the floating Moduli panel it opens at `/?office`: it answers each
// shelf's query and pictures each screen with the app's own code, hands the
// results to the headset, and holds the settings — so editing a shelf never
// leaves the headset.
//
// Bridge (the app adds `window.ModuliNative`):
//   page → app   ModuliNative.postMessage(JSON)  { type: "state" | "screenImage" | "addDecor" | "delete" | "mode" | "resetLayout" | "closePiece" }
//   app → page   window.__moduliNative.onEvent({ type: "refreshScreen", id } | { type: "mode", mode } | { type: "remove", key })
//
// Each piece has its OWN settings (user, 2026-10-23: "each one should have their own settings button, not all
// coalesced into one screen"): the ⚙ beside a piece's handle opens `/?office&piece=<key>`, which renders
// NativePiece — that piece's settings alone. This main panel keeps only what is about the room.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readOffice, addShelf, addScreen, removeShelf, removeScreen, SHELF_ASSETS, ASSET_LABELS } from "./officeConfig.js";
import { shelfItems } from "./shelfItems.js";
import { decorLibrary } from "./decorLibrary.js";
import { officeBtn as btn, useOfficeSave, usePagePictures, screenPicture, ShelfSettings, ScreenSettings } from "./officeShared.jsx";
import { setLocalLayout } from "../helpers/localLayout.js";

export function hasNativeBridge() {
  return typeof window !== "undefined" && !!window.ModuliNative && typeof window.ModuliNative.postMessage === "function";
}

function post(msg) {
  try { window.ModuliNative?.postMessage(JSON.stringify(msg)); } catch (e) { console.warn("[office] native post failed", e); }
}

/** What the headset draws, as plain data. Pure, so it can be tested. */
export function nativeOfficeState({ grid, occurrencesById, modulesById }, pageLabel) {
  const office = readOffice(grid);
  return {
    type: "state",
    gridId: String(grid?._id || grid?.id || ""),
    origin: typeof window !== "undefined" ? window.location.origin : "",
    shelves: office.shelves.map((s) => ({
      id: s.id, title: s.title, asset: s.asset,
      items: shelfItems(s, { grid, occurrencesById, modulesById }).map((i) => ({ id: i.id, title: i.title, cover: i.cover })),
    })),
    screens: office.screens.map((s) => ({
      id: s.id, source: s.source, pageOccId: s.pageOccId || null,
      label: s.source === "grid" ? "The grid" : (s.pageOccId ? pageLabel(s.pageOccId) || "Missing page" : "No page chosen"),
    })),
    decor: decorLibrary({ grid, occurrencesById, modulesById }).map((d) => ({ key: d.key, title: d.title, src: d.src || null })),
  };
}

/** One piece's settings, in its own window beside it (`/?office&piece=<key>`). Sends no state — the main panel does. */
export function NativePiece({ pieceKey, grid, occurrencesById, modulesById, dispatch }) {
  const gridId = grid?._id || grid?.id;
  const office = useMemo(() => readOffice(grid), [grid]);
  const live = useRef({});
  live.current = { grid, gridId, occurrencesById, modulesById, dispatch, office };
  const save = useOfficeSave(live);
  useEffect(() => { setLocalLayout(true); }, []);
  const [kind, id] = String(pieceKey || "").split(/:(.*)/s);
  const shelf = kind === "shelf" ? office.shelves.find((s) => s.id === id) : null;
  const screen = kind === "screen" ? office.screens.find((s) => s.id === id) : null;
  const close = () => post({ type: "closePiece", key: pieceKey });
  // A removed shelf or screen leaves the room when the main panel sends the new state; this window closes with it.
  const removed = () => post({ type: "delete", key: pieceKey });
  const wrap = { position: "fixed", inset: 0, zIndex: 2000, background: "var(--surface-card)", color: "var(--text-primary)", overflow: "auto", padding: 14, fontSize: 14 };
  // No confirm(): a web confirm never shows inside a headset panel, so it left Remove doing nothing.
  const common = { grid, gridId, occurrencesById, modulesById, save: (m) => save(m), confirmRemove: false };
  if (shelf) return <div style={wrap}><ShelfSettings shelf={shelf} {...common} onDone={close} onRemoved={removed} /></div>;
  if (screen) return <div style={wrap}><ScreenSettings screen={screen} {...common} onDone={close} onRemoved={removed} /></div>;
  const title = kind === "fireplace" ? "Fireplace" : kind === "decor" ? "Decor" : "This piece";
  return (
    <div style={wrap}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>{title}</h3>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
        Move it by its bar. Right stick: turn (left / right) and size (up / down). Left stick while holding: further / closer.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        {kind === "decor" && <button style={btn} onClick={removed}>Remove</button>}
        <button style={btn} onClick={close}>Done</button>
      </div>
    </div>
  );
}

export default function NativeOffice({ grid, occurrencesById, modulesById, dispatch }) {
  const gridId = grid?._id || grid?.id;
  const office = useMemo(() => readOffice(grid), [grid]);
  const live = useRef({});
  live.current = { grid, gridId, occurrencesById, modulesById, dispatch, office };
  const save = useOfficeSave(live);
  const { picture, snapshotPage, portal } = usePagePictures();
  const [mode, setMode] = useState("mr");

  useEffect(() => { setLocalLayout(true); }, []);

  const pageLabel = useCallback((id) => {
    const o = live.current.occurrencesById?.[id];
    const m = o && live.current.modulesById?.[o.moduleId];
    return o ? (o.label || m?.label || "Page") : null;
  }, []);

  // ── State to the headset: settings at once, contents at most every few seconds ──
  const lastSent = useRef("");
  const sendState = useCallback(() => {
    const msg = nativeOfficeState(live.current, pageLabel);
    const json = JSON.stringify(msg);
    if (json === lastSent.current) return;
    lastSent.current = json;
    post(msg);
  }, [pageLabel]);
  const officeKey = JSON.stringify(office);
  useEffect(() => { sendState(); }, [officeKey, sendState]);
  const lastRows = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, 5000 - (Date.now() - lastRows.current));
    const t = setTimeout(() => { lastRows.current = Date.now(); sendState(); }, wait);
    return () => clearTimeout(t);
  }, [occurrencesById, sendState]);

  // ── Screen pictures, one at a time, after the room is up ──
  const paint = useCallback(async (id) => {
    const screen = readOffice(live.current.grid).screens.find((s) => s.id === id);
    if (!screen) return;
    const canvas = await screenPicture(screen, { picture, snapshotPage, occurrencesById: live.current.occurrencesById }).catch(() => null);
    if (canvas) post({ type: "screenImage", id, image: canvas.toDataURL("image/jpeg", 0.82) });
  }, [picture, snapshotPage]);
  const screensKey = JSON.stringify(office.screens.map((s) => [s.id, s.source, s.pageOccId]));
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      for (const s of readOffice(live.current.grid).screens) { if (cancelled) return; await paint(s.id); }
    }, 2500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [screensKey, paint]);

  // ── Events from the headset ──
  useEffect(() => {
    window.__moduliNative = {
      onEvent: (ev) => {
        const e = typeof ev === "string" ? JSON.parse(ev) : ev;
        if (e?.type === "refreshScreen") paint(e.id);
        else if (e?.type === "remove") {
          // The 🗑 beside a shelf or screen in the headset: take it out of the grid's office (the headset already
          // dropped it from the room; without this the next state would bring it back).
          const [k, id] = String(e.key || "").split(/:(.*)/s);
          const g = live.current.grid;
          if (k === "shelf") save(removeShelf(g, id));
          else if (k === "screen") save(removeScreen(g, id));
        }
        else if (e?.type === "mode") setMode(e.mode);
        else if (e?.type === "hello") { lastSent.current = ""; sendState(); }
      },
    };
    post({ type: "ready" });
    return () => { delete window.__moduliNative; };
  }, [paint, sendState, save]);

  const addAShelf = async (asset) => {
    const { meta, shelf: s } = addShelf(grid, asset);
    await save(meta); post({ type: "spawn", key: "shelf:" + s.id });
  };
  const addAScreen = async () => {
    const { meta, screen: s } = addScreen(grid, { source: "grid" });
    await save(meta); post({ type: "spawn", key: "screen:" + s.id });
  };
  const decor = useMemo(() => decorLibrary({ grid, occurrencesById, modulesById }), [grid, occurrencesById, modulesById]);

  const section = { borderTop: "1px solid var(--border-subtle)", paddingTop: 10, marginTop: 12 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "var(--surface-card)", color: "var(--text-primary)", overflow: "auto", padding: 14, fontSize: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 16, marginRight: 8 }}>Office</strong>
        <button style={{ ...btn, outline: mode === "mr" ? "2px solid var(--accent, #4a8)" : "none" }} onClick={() => post({ type: "mode", mode: "mr" })}>Mixed reality</button>
        <button style={{ ...btn, outline: mode === "vr" ? "2px solid var(--accent, #4a8)" : "none" }} onClick={() => post({ type: "mode", mode: "vr" })}>VR room</button>
        <button style={btn} onClick={() => { if (window.confirm("Put everything back to where it started?")) post({ type: "resetLayout" }); }}>Reset layout</button>
      </div>

      <div style={section}>
        <div style={{ marginBottom: 6 }}>Add</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SHELF_ASSETS.map((a) => <button key={a} style={btn} onClick={() => addAShelf(a)}>+ {ASSET_LABELS[a]}</button>)}
          <button style={btn} onClick={addAScreen}>+ Screen</button>
        </div>
        <div style={{ margin: "10px 0 6px" }}>Decor</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {decor.map((d) => <button key={d.key} style={btn} onClick={() => post({ type: "addDecor", key: d.key, title: d.title, src: d.src || null })}>+ {d.title}</button>)}
        </div>
      </div>

      <div style={{ ...section, color: "var(--text-muted)", fontSize: 12 }}>
        Grab a piece by the bar above it. Its ⚙ opens that piece's own settings. Right stick: turn (left / right) and
        size (up / down). Left stick while holding: push further / pull closer.
      </div>
      {portal}
    </div>
  );
}
