// ReaderApp.jsx — `/?read=<occurrenceId>`: one page or one book, without the grid.
//
// The Quest app's reader windows used to load the whole app (~15MB of grid, a socket, every operation) to show a
// single note, and every window was a full app tab sharing the others' storage — so pulling several books off a
// shelf turned them all into the last one picked. This reads only that occurrence's subtree
// (`GET /api/v1/occurrences/:id/subtree`) and draws it with the preview renderers. Each window holds its own state.
//
// Read-only: nothing here writes (no socket). A book reopens at its stored reading position but does not save a new one.
import React, { useEffect, useState } from "react";
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

export default function ReaderApp({ occurrenceId }) {
  useTheme();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/v1/occurrences/${encodeURIComponent(occurrenceId)}/subtree`, { headers: sessionHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Sign in on this device first." : r.status === 404 ? "That item is gone." : `Could not load it (${r.status}).`);
        return r.json();
      })
      .then((sub) => { if (live) setState(readerState(sub)); })
      .catch((e) => { if (live) setError(e.message || String(e)); });
    return () => { live = false; };
  }, [occurrenceId]);

  if (error) return <div style={{ ...fill, display: "grid", placeItems: "center", padding: 24 }}>{error}</div>;
  if (!state) return <div style={{ ...fill, display: "grid", placeItems: "center", opacity: 0.6 }}>Loading…</div>;

  const occ = state.occurrences.find((o) => o.id === occurrenceId);
  const mod = occ && state.modules.find((m) => m.id === occ.moduleId);
  if (mod?.role === "artifact" && BOOK_KINDS.has(mod.kind) && mod.fileRef) {
    return (
      <div style={{ ...fill, display: "flex", flexDirection: "column" }}>
        <BookReader module={mod} occurrence={occ} src={resolveFileRef(mod.fileRef)} kind={mod.kind}
          inPanelPage socket={null} dispatch={() => {}} gridId={state.gridId} />
      </div>
    );
  }
  return (
    <div style={fill}>
      <PagePreviewBody parentState={state} occurrenceId={occurrenceId} scroll publishComputed={false} rootChrome />
    </div>
  );
}
