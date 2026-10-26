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
//   app → page   window.__moduliNative.onEvent({ type: "refreshScreen", id } | { type: "mode", mode } | { type: "remove", key }
//                                              | { type: "moveMode", on })
//   page → app   also { type: "moveMode", on } — furniture can be moved only while it is on (off at every start).
//   app → page   { type: "layout", layout } — the headset's placements, saved on the grid as a backup (PUT
//                /api/v1/vr/layout); the state sent back carries `layout`, which the app restores from when its own
//                copy is gone.
//
// Each piece has its OWN settings (user, 2026-10-23: "each one should have their own settings button, not all
// coalesced into one screen"): the ⚙ beside a piece's handle opens `/?office&piece=<key>`, which renders
// NativePiece — that piece's settings alone. This main panel keeps only what is about the room.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readOffice, addShelf, addScreen, removeShelf, removeScreen, SHELF_ASSETS, ASSET_LABELS } from "./officeConfig.js";
import { albumQueue } from "./shelfItems.js";
import { deleteFolderMoveUp } from "../helpers/folderDelete";
import { deleteOccurrenceEverywhere } from "../helpers/confirmDeleteOccurrence";
import { withAction } from "../helpers/actionScope";
import { runGroupDrop } from "../helpers/selectionDrag";
import { decorLibrary } from "./decorLibrary.js";
import { nativeOfficeState, findBookmarksBoard, findDayPage, findNotesFolder, planShelfReorder } from "./officeState.js";
export { BOOKMARK_BAR_MAX, findBookmarksBoard, bookmarkBar, nativeOfficeState, findDayPage, findNotesFolder } from "./officeState.js";
import { officeBtn as btn, useOfficeSave, usePagePictures, screenPicture, ShelfSettings, ScreenSettings } from "./officeShared.jsx";
import { setLocalLayout } from "../helpers/localLayout.js";
import { createPageInFolder } from "../helpers/createPageInFolder.js";
import { addBookmarkOccurrence, movePage } from "../helpers/CommitHelpers.js";
import { socket } from "../socket";
import { sessionHeaders } from "../helpers/authStorage";

export function hasNativeBridge() {
  return typeof window !== "undefined" && !!window.ModuliNative && typeof window.ModuliNative.postMessage === "function";
}

function post(msg) {
  try { window.ModuliNative?.postMessage(JSON.stringify(msg)); } catch (e) { console.warn("[office] native post failed", e); }
}

/** Save the headset's placements on the grid (a backup the app restores from). Failures are only logged: the
 *  headset keeps its own copy, and the next change tries again. */
export async function saveLayoutBackup(gridId, layout) {
  if (!gridId || !layout) return;
  try {
    const r = await fetch("/api/v1/vr/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...sessionHeaders() },
      body: JSON.stringify({ gridId, layout }),
    });
    if (!r.ok) console.warn("[office] layout backup refused", r.status);
  } catch (e) {
    console.warn("[office] layout backup failed", e);
  }
}

/** Make a new note: a doc page in Notes, named for now. Returns its occurrence id, or null. */
function newNotePage({ grid, foldersById, dispatch }) {
  const folderId = findNotesFolder(foldersById);
  if (!folderId) return null;
  const label = "Note — " + new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return createPageInFolder({ folderId, kind: "doc", label, state: { userId: grid?.userId || localStorage.getItem("moduli-userId"), grid }, dispatch, socket });
}

/** One piece's settings, in its own window beside it (`/?office&piece=<key>`). Sends no state — the main panel does. */
export function NativePiece({ pieceKey, grid, occurrencesById, modulesById, foldersById, dispatch }) {
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
  const common = { grid, gridId, occurrencesById, modulesById, foldersById, save: (m) => save(m), confirmRemove: false };
  // The app passes the decor's model and, for a VHS player, the screen it plays on (`&model=…&screen=…`).
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const model = params.get("model") || "";
  const [vhsScreen, setVhsScreen] = useState(params.get("screen") || "");
  if (shelf) return <div style={wrap}><ShelfSettings shelf={shelf} {...common} onDone={close} onRemoved={removed} /></div>;
  if (screen) return <div style={wrap}><ScreenSettings screen={screen} {...common} onDone={close} onRemoved={removed} /></div>;
  const pickScreen = (sid) => { setVhsScreen(sid); post({ type: "decorSetting", key: pieceKey, screenId: sid || null }); };
  const screenLabel = (s) => (s.source === "grid" ? "The grid" : (occurrencesById?.[s.pageOccId]?.label || modulesById?.[occurrencesById?.[s.pageOccId]?.moduleId]?.label || "A page"));
  const title = kind === "fireplace" ? "Fireplace" : model === "vhsplayer" ? "VHS player" : kind === "decor" ? "Decor" : "This piece";
  return (
    <div style={wrap}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>{title}</h3>
      {model === "vhsplayer" && (
        <label style={{ display: "block", fontSize: 13, marginBottom: 12 }}>A tape dropped on it plays on<br />
          <select value={vhsScreen} onChange={(e) => pickScreen(e.target.value)} style={{ width: "100%", fontSize: 14, padding: 4 }}>
            <option value="">The first screen in the room</option>
            {office.screens.map((s) => <option key={s.id} value={s.id}>Screen · {screenLabel(s)}</option>)}
          </select>
        </label>
      )}
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

/**
 * `remote` (OfficePanelApp): the panel holds no grid — the server answers what the office shows and plans the actions
 * that read across the grid (docs/superpowers/plans/2026-10-26-office-panel-without-the-grid.md):
 *   remote.state(shelfAt) → the state message + { dayPageId, notesFolderId, bookmarksBoardId, decor }
 *   remote.plan(type, body), remote.occurrence(id), remote.subtree(id)
 * `rowsVersion` / `removedIds`: what changed on the grid (its socket events), so the shelves are sent again.
 */
export default function NativeOffice({ grid, occurrencesById, modulesById, foldersById, dispatch, remote = null, rowsVersion = 0, removedIds = null }) {
  const gridId = grid?._id || grid?.id;
  const office = useMemo(() => readOffice(grid), [grid]);
  const live = useRef({});
  // Which folder each folder shelf stands in (the headset opens folders like books), kept on this device so a
  // reload comes back to the same folder.
  const atKey = `moduli-vr-shelf-at:${gridId || ""}`;
  const [shelfAt, setShelfAt] = useState(() => { try { return JSON.parse(localStorage.getItem(atKey) || "{}") || {}; } catch { return {}; } });
  useEffect(() => { try { setShelfAt(JSON.parse(localStorage.getItem(atKey) || "{}") || {}); } catch { setShelfAt({}); } }, [atKey]);
  const moveShelf = useCallback((shelfId, folderId) => {
    setShelfAt((prev) => {
      const next = { ...prev };
      if (folderId) next[shelfId] = folderId; else delete next[shelfId];
      try { localStorage.setItem(atKey, JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
  }, [atKey]);
  // The decor in the room (the headset owns it): listed here so a piece can be removed even when the room is too
  // crowded to reach its 🗑 (too many record players crashed the app).
  const [decorInRoom, setDecorInRoom] = useState([]);
  const [removeArmed, setRemoveArmed] = useState(null);
  useEffect(() => { if (!removeArmed) return; const t = setTimeout(() => setRemoveArmed(null), 3000); return () => clearTimeout(t); }, [removeArmed]);
  live.current = { grid, gridId, occurrencesById, modulesById, foldersById, dispatch, office, shelfAt };
  const save = useOfficeSave(live);
  const { picture, snapshotPage, portal } = usePagePictures();
  const [mode, setMode] = useState("mr");
  const [moveMode, setMoveMode] = useState(false);
  // Two taps to reset (a web confirm never shows inside a headset panel): the first arms it for 3s.
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => { if (!resetArmed) return; const t = setTimeout(() => setResetArmed(false), 3000); return () => clearTimeout(t); }, [resetArmed]);

  useEffect(() => { setLocalLayout(true); }, []);

  const pageLabel = useCallback((id) => {
    const o = live.current.occurrencesById?.[id];
    const m = o && live.current.modulesById?.[o.moduleId];
    return o ? (o.label || m?.label || "Page") : null;
  }, []);

  // ── State to the headset: settings at once, contents at most every few seconds ──
  const lastSent = useRef("");
  const [extra, setExtra] = useState(null);
  const extraRef = useRef(null);
  const stateSeq = useRef(0);
  const sendState = useCallback(() => {
    if (remote) {
      const seq = ++stateSeq.current;
      remote.state(live.current.shelfAt).then((st) => {
        if (!st || seq !== stateSeq.current) return;
        const { dayPageId, notesFolderId, bookmarksBoardId, grid: _g, folders: _f, hash: _h, ...msg } = st;
        extraRef.current = { dayPageId, notesFolderId, bookmarksBoardId, decor: msg.decor };
        setExtra(extraRef.current);
        const json = JSON.stringify(msg);
        if (json === lastSent.current) return;
        lastSent.current = json;
        post(msg);
      }).catch((e) => console.warn("[office] state failed", e));
      return;
    }
    const msg = nativeOfficeState({ ...live.current, origin: window.location.origin }, pageLabel);
    const json = JSON.stringify(msg);
    if (json === lastSent.current) return;
    lastSent.current = json;
    post(msg);
  }, [pageLabel, remote]);
  const officeKey = JSON.stringify(office) + JSON.stringify(shelfAt);
  useEffect(() => { sendState(); }, [officeKey, sendState]);
  const lastRows = useRef(0);
  const lastCount = useRef(0);
  const lastIds = useRef(null);
  // Remote: the grid's socket events say something changed (OfficePanelApp counts them).
  useEffect(() => {
    if (!remote) return undefined;
    const removed = !!removedIds?.length;
    if (removed) post({ type: "gone", ids: removedIds });
    const wait = removed ? 0 : Math.max(0, 5000 - (Date.now() - lastRows.current));
    const t = setTimeout(() => { lastRows.current = Date.now(); sendState(); }, wait);
    return () => clearTimeout(t);
  }, [remote, rowsVersion, removedIds, sendState]);
  useEffect(() => {
    if (remote) return undefined;
    // Something removed (a page deleted): the shelves change at once — a book you just deleted must not sit there
    // for 5 seconds. Additions and edits still wait, so a busy grid does not resend the shelves every moment.
    const count = Object.keys(occurrencesById || {}).length;
    const removed = count < lastCount.current;
    lastCount.current = count;
    // A page deleted anywhere (its radial menu, the file tree, a shelf) also closes the reader windows showing it.
    const ids = new Set(Object.keys(occurrencesById || {}));
    if (removed && lastIds.current) {
      const gone = [...lastIds.current].filter((id) => !ids.has(id));
      if (gone.length) post({ type: "gone", ids: gone });
    }
    lastIds.current = ids;
    const wait = removed ? 0 : Math.max(0, 5000 - (Date.now() - lastRows.current));
    const t = setTimeout(() => { lastRows.current = Date.now(); sendState(); }, wait);
    return () => clearTimeout(t);
  }, [remote, occurrencesById, sendState]);

  // ── Screen pictures, one at a time, after the room is up ──
  const paint = useCallback(async (id) => {
    if (remote) return; // a remote panel holds no pages to picture (a page screen is drawn by the headset's own panel)
    const screen = readOffice(live.current.grid).screens.find((s) => s.id === id);
    if (!screen) return;
    const canvas = await screenPicture(screen, { picture, snapshotPage, occurrencesById: live.current.occurrencesById }).catch(() => null);
    if (canvas) post({ type: "screenImage", id, image: canvas.toDataURL("image/jpeg", 0.82) });
  }, [picture, snapshotPage, remote]);
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
        else if (e?.type === "saveBookmark") {
          // A browser screen's ☆: the page goes to the top of the Bookmarks board (and so onto every browser's bar).
          const L = live.current;
          if (!e.url) return;
          const add = (board) => board && addBookmarkOccurrence({
            dispatch: L.dispatch, socket, gridId: L.gridId, userId: L.grid?.userId || localStorage.getItem("moduli-userId"),
            containerOccurrence: board, url: e.url, label: e.title || null, index: 0, meta: { browserBar: true },
          });
          if (remote) { const bid = extraRef.current?.bookmarksBoardId; if (bid) remote.occurrence(bid).then(add); }
          else add(findBookmarksBoard(L));
          setTimeout(() => { lastSent.current = ""; sendState(); }, 600);
        }
        else if (e?.type === "newNote") {
          // The new-note screen's button: a doc page in Notes (it is on the Documents shelf), opened beside the screen.
          const id = newNotePage(live.current);
          if (id) setTimeout(() => post({ type: "openNote", id, key: e.key }), 1200);
        }
        else if (e?.type === "albumQueue") {
          // An album dropped on a record player with no Spotify album link: its songs, one after another.
          const send = (items) => post({ type: "playQueue", key: e.key, title: e.title || "", items: items || [], fallback: e.fallback || "" });
          if (remote) remote.plan("albumQueue", { id: e.id }).then((r) => send(r?.items));
          else send(albumQueue(e.id, live.current));
        }
        else if (e?.type === "openAlbum") {
          const shelfId = String(e.key || "").replace(/^shelf:/, "");
          const prev = live.current.shelfAt[shelfId];
          moveShelf(shelfId, `album:${e.id}|${typeof prev === "string" && !prev.startsWith("album:") ? prev : ""}`);
        }
        else if (e?.type === "openFolder" || e?.type === "shelfUp") {
          const shelfId = String(e.key || "").replace(/^shelf:/, "");
          const L = live.current;
          const shelf = readOffice(L.grid).shelves.find((x) => x.id === shelfId);
          const atNow = L.shelfAt[shelfId];
          // Up from an open album: back to where the shelf was before it.
          if (e.type === "shelfUp" && typeof atNow === "string" && atNow.startsWith("album:")) { moveShelf(shelfId, atNow.split("|")[1] || null); return; }
          // A record crate's artists: open one, or go back up to all of them.
          if (e.type === "openFolder" && String(e.folderId || "").startsWith("artist:")) { moveShelf(shelfId, String(e.folderId)); return; }
          if (e.type === "shelfUp" && typeof atNow === "string" && atNow.startsWith("artist:")) { moveShelf(shelfId, null); return; }
          if (!shelf?.folderId) return;
          if (e.type === "openFolder") moveShelf(shelfId, String(e.folderId || "").replace(/^folder:/, ""));
          else {
            const at = L.shelfAt[shelfId];
            const up = at && at !== shelf.folderId ? L.foldersById?.[at]?.parentId : null;
            moveShelf(shelfId, up && up !== shelf.folderId ? up : null);
          }
        }
        else if (e?.type === "shelfReorder") {
          // A book let go on its folder shelf: before / after another book (that order is the file tree's), or onto
          // a folder book (filed inside it). One undo step.
          const shelfId = String(e.key || "").replace(/^shelf:/, "");
          const L = live.current;
          const shelf = readOffice(L.grid).shelves.find((x) => x.id === shelfId);
          if (!shelf?.folderId) return;
          const apply = (moves) => {
            withAction("Moved on shelf", () => {
              for (const m of moves || []) movePage({ dispatch: L.dispatch, socket, pageOccurrenceId: m.id, targetFolderId: m.folder, sortOrder: m.sortOrder });
            });
            setTimeout(() => { lastSent.current = ""; sendState(); }, 300);
          };
          const ask = { shelfId, at: L.shelfAt[shelfId], id: e.id, targetId: e.targetId, edge: e.edge };
          if (remote) remote.plan("shelfReorder", ask).then((r) => apply(r?.moves));
          else if (L.occurrencesById?.[e.id]) apply(planShelfReorder({ ...ask, shelf }, L));
        }
        else if (e?.type === "deleteItems") {
          // The shelf's Select → Delete: rows go the way any delete goes; a folder book deletes the folder and
          // moves what it held up a level (helpers/folderDelete). One undo step for the lot.
          const L = live.current;
          const ids = e.ids || [];
          const folderIds = ids.filter((id) => String(id).startsWith("folder:")).map((id) => String(id).slice(7));
          // A remote panel holds no folder contents: the server plans each folder delete first.
          const plans = remote
            ? Promise.all(folderIds.map((fid) => remote.plan("folderDelete", { folderId: fid }).then((r) => [fid, r?.plan || null])))
            : Promise.resolve(folderIds.map((fid) => [fid, undefined]));
          plans.then((planned) => {
            withAction("Deleted from shelf", () => {
              for (const [fid, plan] of planned) {
                const folder = L.foldersById?.[fid];
                if (folder && plan !== null) deleteFolderMoveUp({ dispatch: L.dispatch, socket, folder, plan, occurrencesById: L.occurrencesById, foldersById: L.foldersById, modulesById: L.modulesById });
              }
              for (const id of ids) {
                if (String(id).startsWith("folder:")) continue;
                // The same delete as a page's own "Delete page" (helpers/confirmDeleteOccurrence) — the shelf has
                // already asked (two taps). A remote panel knows the row by its id alone, which is all the delete sends.
                const occurrence = L.occurrencesById?.[id] || (remote ? { id } : null);
                if (occurrence) deleteOccurrenceEverywhere({ occurrence, dispatch: L.dispatch, socket });
              }
            });
            setTimeout(() => { lastSent.current = ""; sendState(); }, 300);
          });
        }
        else if (e?.type === "placeInto") {
          // A drag carried from one reader window into another (the headset found where it landed): the same write a
          // drop inside one window makes. Then both windows reload to show it.
          const L = live.current;
          const run = (occurrencesById, modulesById) => {
            const dest = occurrencesById?.[e.parentId];
            if (!dest || !occurrencesById?.[e.occId]) return;
            runGroupDrop({
              ids: [e.occId], dest, insertAt: Number.isInteger(e.index) ? e.index : undefined,
              mode: e.mode === "copy" || e.mode === "copylink" ? e.mode : "move",
              ctx: { dispatch: L.dispatch, socket, occurrencesById,
                state: { modulesById, gridId: L.gridId, grid: L.grid, userId: L.grid?.userId || localStorage.getItem("moduli-userId") } },
            });
            setTimeout(() => post({ type: "placed", panels: e.panels || [] }), 1500);
          };
          if (!remote) { run(L.occurrencesById, L.modulesById); return; }
          // Remote: the destination's subtree and the moved row, fetched for this one drop.
          Promise.all([remote.subtree(e.parentId), remote.subtree(e.occId)]).then(([a, b]) => {
            const occs = {}; const mods = {};
            for (const sub of [a, b]) {
              for (const o of sub?.occurrences || []) occs[o.id] = o;
              for (const m of sub?.modules || []) mods[m.id] = m;
            }
            run(occs, mods);
          });
        }
        else if (e?.type === "decorList") setDecorInRoom(Array.isArray(e.list) ? e.list : []);
        else if (e?.type === "mode") setMode(e.mode);
        else if (e?.type === "moveMode") setMoveMode(!!e.on);
        else if (e?.type === "layout") saveLayoutBackup(live.current.gridId, e.layout);
        else if (e?.type === "hello") { lastSent.current = ""; sendState(); }
      },
    };
    post({ type: "ready" });
    return () => { delete window.__moduliNative; };
  }, [paint, sendState, save, moveShelf, remote]);

  const addAShelf = async (asset) => {
    const { meta, shelf: s } = addShelf(grid, asset);
    await save(meta); post({ type: "spawn", key: "shelf:" + s.id });
  };
  const addAScreen = async () => {
    const { meta, screen: s } = addScreen(grid, { source: "grid" });
    await save(meta); post({ type: "spawn", key: "screen:" + s.id });
  };
  // A "today board" is a screen showing the Day Page (the one in use, not its template).
  const localDayPageId = useMemo(() => (remote ? null : findDayPage({ occurrencesById, modulesById, foldersById })), [remote, occurrencesById, modulesById, foldersById]);
  const dayPageId = remote ? extra?.dayPageId || null : localDayPageId;
  const addTodayBoard = async () => {
    if (!dayPageId) return;
    const { meta, screen: s } = addScreen(grid, { source: "page", pageOccId: dayPageId });
    await save(meta); post({ type: "spawn", key: "screen:" + s.id });
  };
  const localDecor = useMemo(() => (remote ? [] : decorLibrary({ grid, occurrencesById, modulesById })), [remote, grid, occurrencesById, modulesById]);
  const decor = remote ? extra?.decor || [] : localDecor;

  const section = { borderTop: "1px solid var(--border-subtle)", paddingTop: 10, marginTop: 12 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "var(--surface-card)", color: "var(--text-primary)", overflow: "auto", padding: 14, fontSize: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 16, marginRight: 8 }}>Office</strong>
        <button style={{ ...btn, outline: mode === "mr" ? "2px solid var(--accent, #4a8)" : "none" }} onClick={() => post({ type: "mode", mode: "mr" })}>Mixed reality</button>
        <button style={{ ...btn, outline: mode === "vr" ? "2px solid var(--accent, #4a8)" : "none" }} onClick={() => post({ type: "mode", mode: "vr" })}>VR room</button>
        <button style={{ ...btn, outline: moveMode ? "2px solid var(--accent, #4a8)" : "none" }} aria-pressed={moveMode}
          onClick={() => post({ type: "moveMode", on: !moveMode })}>Move furniture: {moveMode ? "On" : "Off"}</button>
        <button style={btn} onClick={() => { if (resetArmed) { post({ type: "resetLayout" }); setResetArmed(false); } else setResetArmed(true); }}>
          {resetArmed ? "Tap again to reset" : "Reset layout"}
        </button>
      </div>

      <div style={section}>
        <div style={{ marginBottom: 6 }}>Add</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SHELF_ASSETS.map((a) => <button key={a} style={btn} onClick={() => addAShelf(a)}>+ {ASSET_LABELS[a]}</button>)}
          <button style={btn} onClick={addAScreen}>+ Screen</button>
          <button style={btn} onClick={addTodayBoard} disabled={!dayPageId} title={dayPageId ? "A screen showing your Day Page" : "No Day Page found"}>+ Today board</button>
        </div>
        <div style={{ margin: "10px 0 6px" }}>Decor</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {decor.map((d) => <button key={d.key} style={btn} onClick={() => post({ type: "addDecor", key: d.key, title: d.title, src: d.src || null })}>+ {d.title}</button>)}
        </div>
      </div>

      {decorInRoom.length > 0 && (
        <div style={section}>
          <div style={{ marginBottom: 6 }}>In the room</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {decorInRoom.map((d) => (
              <button key={d.key} style={{ ...btn, outline: removeArmed === d.key ? "2px solid #c55" : "none" }}
                onClick={() => {
                  if (removeArmed === d.key) { post({ type: "delete", key: d.key }); setRemoveArmed(null); }
                  else setRemoveArmed(d.key);
                }}>
                {removeArmed === d.key ? `Tap again to remove ${d.title}` : `✕ ${d.title}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ ...section, color: "var(--text-muted)", fontSize: 12 }}>
        Turn on Move furniture, then grab a piece by the bar above it. Its ⚙ opens that piece's own settings. Right stick: turn (left / right) and
        size (up / down). Left stick while holding: push further / pull closer.
      </div>
      {portal}
    </div>
  );
}
