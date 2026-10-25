// ReaderApp.jsx — `/?read=<occurrenceId>`: one page or one book, without the grid.
//
// The Quest app's reader windows used to load the whole app (~15MB of grid, a socket, every operation) to show a
// single note, and every window was a full app tab sharing the others' storage — so pulling several books off a
// shelf turned them all into the last one picked. This reads only that occurrence's subtree
// (`GET /api/v1/occurrences/:id/subtree`) and draws it with the preview renderers. Each window holds its own state.
//
// It EDITS: the window keeps its own store (the grid reducer over just this subtree) and its own socket, which joins
// the grid quietly (`join_grid_quiet` — no full_state), so a typed note saves and reaches the other tabs, and their
// edits to this page come back here.
import React, { useEffect, useReducer, useState } from "react";
import { masterReducer, deriveRoleArrays } from "./state/masterReducer";
import { initialState } from "./state/initialState";
import { socket } from "./socket";
import {
  createOccurrenceAction, updateOccurrenceAction, deleteOccurrenceAction, createModuleAction, updateModuleAction,
} from "./state/actions";
import { PagePreviewBody } from "./PagePreviewApp.jsx";
import BookReader from "./modules/BookReader.jsx";
import { sessionHeaders } from "./helpers/authStorage";
import { resolveFileRef } from "./helpers/fileRef";
import { useTheme } from "./helpers/useTheme";
import { ChoiceDialogHost } from "./ui/ChoiceDialog";
import { DragProvider } from "./helpers/DragProvider.jsx";
import { readerDropTarget } from "./helpers/readerDropTarget.js";
import { panelPointToPage } from "./helpers/readerDropTarget.js";
import { touchHoverStep, touchDropStep, windowDragCtx, createDragPill, clearDocTouchHover } from "./helpers/dragSystem.js";
import { embedDeleteRegistry } from "./helpers/embedRegistry.js";
import { installHeadsetScroll } from "./helpers/headsetScroll.js";

const BOOK_KINDS = new Set(["pdf", "ebook"]);

/** The isolated state the preview renderers read, from a subtree answer. Pure. */
export function readerState(sub) {
  return {
    hydrated: true,
    gridId: sub.gridId,
    grid: { _id: sub.gridId, id: sub.gridId, occurrences: [], meta: {} },
    occurrences: sub.occurrences || [],
    modules: sub.modules || [],
    // The per-role lists the main app's store derives on load: without them a drop in this window found no
    // container (`state.containers`) and did nothing.
    ...deriveRoleArrays(sub.modules || []),
    fields: sub.fields || [],
    views: sub.views || [],
    folders: [], manifests: [], operations: [],
    computedValues: {},
    userId: typeof localStorage !== "undefined" ? localStorage.getItem("moduli-userId") : null,
  };
}

const fill = { width: "100vw", height: "100vh", background: "var(--body-bg, #101318)", color: "var(--text-primary, #e0e0e0)" };

/** Changes made elsewhere to what this window shows (or new things placed in it) go into its store. */
function useReaderSync(dispatch, has) {
  useEffect(() => {
    const onOcc = ({ occurrence } = {}) => {
      if (!occurrence?.id) return;
      if (has.occ(occurrence.id)) dispatch(updateOccurrenceAction(occurrence));
      else if (occurrence.parentId && has.occ(occurrence.parentId)) dispatch(createOccurrenceAction(occurrence));
    };
    const onDel = (p = {}) => { const id = p.occurrenceId || p.id; if (id && has.occ(id)) dispatch(deleteOccurrenceAction(id)); };
    const onMod = ({ module: m } = {}) => {
      if (!m?.id) return;
      if (has.mod(m.id)) dispatch(updateModuleAction(m));
      else if (has.usesMod(m.id)) dispatch(createModuleAction(m));
    };
    socket.on("occurrence_created", onOcc); socket.on("occurrence_updated", onOcc); socket.on("occurrence_deleted", onDel);
    socket.on("module_created", onMod); socket.on("module_updated", onMod);
    return () => {
      socket.off("occurrence_created", onOcc); socket.off("occurrence_updated", onOcc); socket.off("occurrence_deleted", onDel);
      socket.off("module_created", onMod); socket.off("module_updated", onMod);
    };
  }, [dispatch, has]);
}

export default function ReaderApp({ occurrenceId }) {
  useTheme();
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    // A brand-new note may still be on its way to the server: a 404 is tried again a few times before it counts.
    const get = (tries) => fetch(`/api/v1/occurrences/${encodeURIComponent(occurrenceId)}/subtree`, { headers: sessionHeaders() })
      .then((r) => (r.status === 404 && tries > 0 ? new Promise((ok) => setTimeout(ok, 1000)).then(() => get(tries - 1)) : r));
    get(5)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Sign in on this device first." : r.status === 404 ? "That item is gone." : `Could not load it (${r.status}).`);
        return r.json();
      })
      .then((sub) => { if (live) setLoaded({ ...initialState, ...readerState(sub) }); })
      .catch((e) => { if (live) setError(e.message || String(e)); });
    return () => { live = false; };
  }, [occurrenceId]);

  // The store starts from the subtree (ReaderBody); its socket joins that grid, again on every reconnect.
  return loaded
    ? <ReaderBody initial={loaded} occurrenceId={occurrenceId} />
    : error
      ? <div style={{ ...fill, display: "grid", placeItems: "center", padding: 24 }}>{error}</div>
      : <div style={{ ...fill, display: "grid", placeItems: "center", opacity: 0.6 }}>Loading…</div>;
}

function ReaderBody({ initial, occurrenceId }) {
  const [state, dispatch] = useReducer(masterReducer, initial);
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    const join = () => socket.emit("join_grid_quiet", { gridId: initial.gridId }, (res) => setJoined(!!res?.ok));
    if (socket.connected) join();
    socket.on("connect", join);
    return () => socket.off("connect", join);
  }, [initial.gridId]);
  const ref = React.useRef(state);
  ref.current = state;
  const has = React.useMemo(() => ({
    occ: (id) => (ref.current.occurrences || []).some((o) => o.id === id),
    mod: (id) => (ref.current.modules || []).some((m) => m.id === id),
    usesMod: (id) => (ref.current.occurrences || []).some((o) => o.moduleId === id),
  }), []);
  useReaderSync(dispatch, has);

  // Where a drag carried in from ANOTHER window lands: the headset asks this page (u, v on the panel) and has the
  // control panel, which holds the whole grid, do the move or copy.
  React.useEffect(() => {
    window.__moduliDropTarget = (u, v, wM, hM) => JSON.stringify(readerDropTarget({
      u, v, wM, hM, rootId: occurrenceId, occurrences: ref.current.occurrences, modules: ref.current.modules,
    }));
    return () => { delete window.__moduliDropTarget; };
  }, [occurrenceId]);
  // A drag the headset carries in from ANOTHER window runs here exactly as one begun here would: the same pill, the
  // same highlight and insertion line, the same drop (a doc embeds it, a board lists it). `prepare` (at drag start,
  // while it is still in its own window) brings the dragged row and its parent into this window's store — the drop
  // writes both lists; `enter` / `move` / `drop` / `leave` follow the controller across this window's panel.
  React.useEffect(() => {
    // A headset window logs every step of a drop (the editor's DLOG), so a drop that places nothing says why.
    if (window.ModuliNative) window.__dragDiag = true;
    const unScroll = window.ModuliNative ? installHeadsetScroll() : null;
    let payload = null, ready = null, cur = null, pill = null, inSession = false;
    const ctx = () => windowDragCtx();
    // Aimed at "the side" a ray lands in the window's margin, outside the doc: that counts as the content's edge
    // (otherwise nothing there answers — no side line, and the drop fell back to the top).
    const pt = (u, v, wM, hM) => {
      const p = panelPointToPage({ u, v, wM, hM, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
      const pm = document.querySelector(".doc-editor .ProseMirror")?.getBoundingClientRect();
      if (pm && pm.width > 40 && p.y >= pm.top && p.y <= pm.bottom) p.x = Math.min(pm.right - 4, Math.max(pm.left + 4, p.x));
      return p;
    };
    const load = async (id) => {
      const r = await fetch(`/api/v1/occurrences/${encodeURIComponent(id)}/subtree`, { headers: sessionHeaders() });
      if (!r.ok) return null;
      const sub = await r.json();
      for (const m of sub.modules || []) if (!has.mod(m.id)) dispatch(createModuleAction(m));
      for (const o of sub.occurrences || []) if (!has.occ(o.id)) dispatch(createOccurrenceAction(o));
      return (sub.occurrences || []).find((o) => o.id === id) || null;
    };
    const loadOne = async (id) => {
      if (!id || has.occ(id)) return;
      const r = await fetch(`/api/v1/occurrences/${encodeURIComponent(id)}`, { headers: sessionHeaders() });
      if (r.ok) { const { occurrence } = await r.json(); if (occurrence && !has.occ(id)) dispatch(createOccurrenceAction(occurrence)); }
    };
    const end = () => {
      cur?.stateRef?.current?.setIsOver?.(false); cur?.stateRef?.current?.setClosestEdge?.(null); cur = null;
      pill?.remove(); pill = null;
      clearDocTouchHover();
      if (inSession) { inSession = false; ctx()?.handleDragEnd(); }
    };
    window.__moduliRemoteDrag = {
      prepare(json) {
        const p = JSON.parse(json);
        payload = { type: p.type, id: p.id, data: p.data, context: p.context || {}, occurrenceId: p.occurrenceId ?? null,
          sourceWindowId: p.sourceWindowId || null, mode: p.mode || "move" };
        const id = payload.occurrenceId;
        ready = id ? load(id).then((o) => loadOne(o?.parentId || payload.context?.parentOccurrenceId)).catch(() => {}) : Promise.resolve();
        console.log("[headsetDrag] remote prepare", id);
      },
      enter(label, u, v, wM, hM) {
        if (!payload || !ctx()) return;
        const { x, y } = pt(u, v, wM, hM);
        ctx().handleDragStart(payload, x, y, { mode: payload.mode });
        inSession = true;
        pill = createDragPill(label, payload.mode);
        document.body.appendChild(pill);
        this.move(u, v, wM, hM);
      },
      move(u, v, wM, hM) {
        if (!inSession) return;
        const { x, y } = pt(u, v, wM, hM);
        if (pill) pill.style.transform = `translate3d(${x - 40}px, ${y - 14}px, 0)`;
        cur = touchHoverStep({ x, y, payload, cur, dragCtx: ctx() });
      },
      leave() { end(); },
      // Waits for `prepare`'s rows; the headset reads the answer from window.__moduliRemoteDropped.
      // "Dropped" means PLACED HERE: a drop handler can take the drop and still place nothing (a doc's drop bailed),
      // and on a move the window it came from then took its copy out — the row vanished from both (user,
      // 2026-10-25). So the answer is whether this window now shows it in one more place than before.
      drop(u, v, wM, hM) {
        window.__moduliRemoteDropped = null;
        const id = payload?.occurrenceId;
        const shownIn = () => (ref.current.occurrences || []).reduce((n, o) =>
          n + ((o.occurrences || []).includes(id) ? 1 : 0) + (id && o.textmap && JSON.stringify(o.textmap).includes(id) ? 1 : 0), 0);
        const go = () => {
          let taken = false;
          const before = id ? shownIn() : 0;
          try {
            if (inSession) {
              const { x, y } = pt(u, v, wM, hM);
              ({ dropped: taken } = touchDropStep({ x, y, payload, cur, dragCtx: ctx() }));
              cur = null;
            }
          } finally {
            end();
            // The doc saves its text a moment after the drop; give the store that moment, then count.
            setTimeout(() => {
              const placed = taken && !!id && shownIn() > before;
              window.__moduliRemoteDropped = placed;
              console.log("[headsetDrag] remote drop", id, { taken, placed });
            }, 1200);
          }
        };
        (ready || Promise.resolve()).then(go, go);
      },
      cancel() { end(); payload = null; ready = null; },
    };
    // The other half of a MOVE carried out of this window: the window it landed in has embedded it, and an embed in
    // a doc here is removed only by this doc's editor (in one window the cross-doc drop does this itself, through
    // embedDeleteRegistry — which only holds the editors mounted HERE). A row listed by a board here is unlisted by
    // the drop itself (it loaded that board).
    window.__moduliMovedOut = (occId) => {
      const del = embedDeleteRegistry.get(occId);
      console.log("[headsetDrag] moved out", occId, del ? "embed removed" : "no embed here");
      del?.();
    };
    return () => { end(); unScroll?.(); delete window.__moduliRemoteDrag; delete window.__moduliMovedOut; };
  }, [dispatch, has]);
  const gridRef = React.useRef(null);
  const occ = state.occurrences.find((o) => o.id === occurrenceId);
  const mod = occ && state.modules.find((m) => m.id === occ.moduleId);
  const live = joined ? socket : null;
  // A bookmark is a web page, not a board: show the page itself (the headset opens bookmarks in its own browser
  // window; this is for one reached another way).
  const bookmarkUrl = mod?.kind === "bookmark" ? (occ?.meta?.url || mod.fileRef || "") : "";
  useEffect(() => { if (/^https?:\/\//i.test(bookmarkUrl)) window.location.replace(bookmarkUrl); }, [bookmarkUrl]);
  if (bookmarkUrl) return <div style={{ ...fill, display: "grid", placeItems: "center", opacity: 0.6 }}>Opening {bookmarkUrl}…</div>;
  if (mod?.role === "artifact" && BOOK_KINDS.has(mod.kind) && mod.fileRef) {
    return (
      <div style={{ ...fill, display: "flex", flexDirection: "column" }}>
        <BookReader module={mod} occurrence={occ} src={resolveFileRef(mod.fileRef)} kind={mod.kind}
          inPanelPage socket={live} dispatch={dispatch} gridId={state.gridId} />
      </div>
    );
  }
  // A drag system of its own (it had none, so a drag on a handle became a tap that opened the menu). In the
  // headset the controller's trigger arrives as touch, so the touch drag path is the one that runs.
  return (
    <DragProvider state={state} dispatch={dispatch} socket={live} gridRef={gridRef}
      isTouch={typeof window !== "undefined" && !!window.ModuliNative} isMobileLayout={false}>
      <div ref={gridRef} style={fill}>
        <PagePreviewBody parentState={state} occurrenceId={occurrenceId} scroll publishComputed={false} rootChrome
          dispatch={dispatch} socket={live} />
        <ChoiceDialogHost />
      </div>
    </DragProvider>
  );
}
