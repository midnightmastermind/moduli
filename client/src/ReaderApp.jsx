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
import { masterReducer } from "./state/masterReducer";
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

const BOOK_KINDS = new Set(["pdf", "ebook"]);

/** The isolated state the preview renderers read, from a subtree answer. Pure. */
export function readerState(sub) {
  return {
    hydrated: true,
    gridId: sub.gridId,
    grid: { _id: sub.gridId, id: sub.gridId, occurrences: [], meta: {} },
    occurrences: sub.occurrences || [],
    modules: sub.modules || [],
    fields: sub.fields || [],
    views: sub.views || [],
    folders: [], manifests: [], operations: [],
    computedValues: {},
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

  const occ = state.occurrences.find((o) => o.id === occurrenceId);
  const mod = occ && state.modules.find((m) => m.id === occ.moduleId);
  const live = joined ? socket : null;
  if (mod?.role === "artifact" && BOOK_KINDS.has(mod.kind) && mod.fileRef) {
    return (
      <div style={{ ...fill, display: "flex", flexDirection: "column" }}>
        <BookReader module={mod} occurrence={occ} src={resolveFileRef(mod.fileRef)} kind={mod.kind}
          inPanelPage socket={live} dispatch={dispatch} gridId={state.gridId} />
      </div>
    );
  }
  return (
    <div style={fill}>
      <PagePreviewBody parentState={state} occurrenceId={occurrenceId} scroll publishComputed={false} rootChrome
        dispatch={dispatch} socket={live} />
    </div>
  );
}
