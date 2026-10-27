// vr/OfficePanelApp.jsx — the headset's control panel WITHOUT the grid.
//
// Inside the Quest app (window.ModuliNative) `/?office` used to boot the whole Moduli app: every occurrence of the grid
// in memory, the grid drawn under the office menu, every operation run again — in the same process as the grid screen
// and every other window, which got the app killed for its memory (user, 2026-10-26: "the control panel shouldnt load
// the entire grid"). This boots only the office: the server answers what the office shows and plans the actions that
// read across the grid (POST /api/v1/vr/office/state and /plan, with the app's own code); the writes go out through
// the app's usual events on the socket, joined quietly (no full_state).
// Plan: docs/superpowers/plans/2026-10-26-office-panel-without-the-grid.md.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import { sessionHeaders } from "../helpers/authStorage";
import { useTheme } from "../helpers/useTheme";
import { ActionTypes } from "../state/actions";
import NativeOffice from "./NativeOffice.jsx";

const fill = { width: "100vw", height: "100vh", background: "var(--body-bg, #101318)", color: "var(--text-primary, #e0e0e0)" };

async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `${r.status}`);
  return r.json();
}

async function getJson(url) {
  const r = await fetch(url, { headers: sessionHeaders() });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function OfficePanelApp() {
  useTheme();
  const gridId = typeof localStorage !== "undefined" ? localStorage.getItem("moduli-gridId") : null;
  const [grid, setGrid] = useState(null);
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [removedIds, setRemovedIds] = useState(null);

  // The last full answer: the server says "unchanged" when nothing differs (no megabytes resent), and the headset
  // asking again after a reload still gets it.
  const lastState = useRef(null);
  const remote = useMemo(() => ({
    // `only` (shelf ids): just those shelves, for a change on one shelf (a small answer, not the whole office).
    state: (shelfAt, only = null) => postJson("/api/v1/vr/office/state", {
      gridId, shelfAt, origin: window.location.origin, hash: only ? null : (lastState.current?.hash || null), only,
    }).then((st) => {
      if (st?.unchanged) return lastState.current;
      if (st?.partial) {
        if (Array.isArray(st.folders)) setFolders(st.folders);
        return st;
      }
      lastState.current = st;
      if (st?.grid) setGrid((g) => (g && JSON.stringify(g.meta) === JSON.stringify(st.grid.meta) ? g : st.grid));
      if (Array.isArray(st?.folders)) setFolders(st.folders);
      return st;
    }),
    plan: (type, body) => postJson("/api/v1/vr/office/plan", { gridId, type, ...body }),
    occurrence: (id) => getJson(`/api/v1/occurrences/${encodeURIComponent(id)}`).then((r) => r?.occurrence || r),
    subtree: (id) => getJson(`/api/v1/occurrences/${encodeURIComponent(id)}/subtree`),
  }), [gridId]);

  // First answer: the office's own settings and the folders.
  useEffect(() => {
    if (!gridId) { setError("Open Moduli on this headset once and pick your grid."); return; }
    remote.state({}).catch((e) => setError(e.message === "401" ? "Sign in on this device first." : `Could not load the office (${e.message}).`));
  }, [gridId, remote]);

  // The grid's changes, without its contents: any row change asks for the shelves again (NativeOffice spaces them out;
  // a delete at once, and its ids close the reader windows showing them).
  useEffect(() => {
    if (!gridId) return undefined;
    const join = () => socket.emit("join_grid_quiet", { gridId }, () => {});
    if (socket.connected) join();
    socket.on("connect", join);
    const changed = () => setRowsVersion((v) => v + 1);
    const deleted = (p = {}) => {
      const id = p.occurrenceId || p.id;
      if (id) setRemovedIds([id]);
      setRowsVersion((v) => v + 1);
    };
    const gridChanged = ({ grid: g } = {}) => {
      if (g?.meta && String(g.id || g._id) === String(gridId)) setGrid((cur) => (cur ? { ...cur, meta: { ...cur.meta, ...g.meta } } : cur));
    };
    const evs = ["occurrence_created", "occurrence_updated", "module_created", "module_updated", "folder_created", "folder_updated", "folder_deleted"];
    for (const ev of evs) socket.on(ev, changed);
    socket.on("occurrence_deleted", deleted);
    socket.on("grid_updated", gridChanged);
    return () => {
      socket.off("connect", join);
      for (const ev of evs) socket.off(ev, changed);
      socket.off("occurrence_deleted", deleted);
      socket.off("grid_updated", gridChanged);
    };
  }, [gridId]);

  // The office's helpers write through a dispatch; only the grid's own settings are kept here.
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const dispatch = useCallback((action) => {
    if (action?.type === ActionTypes.UPDATE_GRID && action.payload?.grid) {
      const next = action.payload.grid;
      setGrid((g) => ({ ...(g || {}), ...next, meta: { ...(g?.meta || {}), ...(next.meta || {}) } }));
    }
  }, []);
  const foldersById = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders]);
  const empty = useMemo(() => ({}), []);

  if (error) return <div style={{ ...fill, display: "grid", placeItems: "center", padding: 24 }}>{error}</div>;
  if (!grid) return <div style={{ ...fill, display: "grid", placeItems: "center", opacity: 0.6 }}>Loading the office…</div>;
  return (
    <NativeOffice
      grid={grid} occurrencesById={empty} modulesById={empty} foldersById={foldersById} dispatch={dispatch}
      remote={remote} rowsVersion={rowsVersion} removedIds={removedIds}
    />
  );
}
