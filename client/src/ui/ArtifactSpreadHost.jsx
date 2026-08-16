// ui/ArtifactSpreadHost.jsx
// ============================================================
// The one mounted host for the artifact spread, mirroring ImagePickerHost's
// imperative pattern: call sites live inside popovers, dropdowns and rows that
// unmount the moment you click, so each rendering its own overlay would make
// the overlay vanish with its host. Instead ONE <ArtifactSpreadHost/> sits in
// App and call sites do `openArtifactSpread(occurrenceId, originRect)`.
//
// WHAT IT OWNS: resolving the occurrence's artifacts, the overlay-only page
// they are arranged on, and the commits. The SHELL (<ArtifactSpread/>) owns the
// chrome, and the app's EXISTING <Container> owns the arrangement.
//
// THE OVERLAY-ONLY PAGE, and why there is one at all (user, 2026-08-06: "these
// pages would exist only in this overlay"): board and canvas arrangement is
// persisted state — order lives in a parent's `occurrences[]`, canvas x/y on
// each child's meta. Reusing those renderers therefore needs a REAL occurrence
// to write to. So the first time an occurrence's spread is opened, one is
// minted: a container carrying `meta.spreadFor = <ownerOccId>`, with the owner
// pointing back at it via `meta.spreadPageId`. It is parented to NOTHING and
// listed in no manifest, so it is reachable only by opening the spread — no
// stray page appears in the tree, and there is nothing to clean up on close.
//
// Its `kind` IS the arrangement: "board" for the grid, "canvas" for free
// dragging. <Container> already dispatches on kind, so switching arrangement is
// one field on one module rather than a second renderer.
//
// ATTACHED artifacts (the Files field) are MULTI-PARENTED into that page — the
// established pattern here (the Schedule's shared slots, Todo on the day page).
// They stay owned wherever they live; the spread page merely lists them, which
// is what lets one artifact hang off several occurrences.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Container from "../modules/ModuleContainer";
import ArtifactSpread from "./ArtifactSpread";
import { openImagePicker } from "./ImagePickerMenu";
import { filesOf } from "../helpers/occurrenceMedia";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { useGridActionsSelector } from "../GridActionsContext";
import { Spinner } from "../components/ui/spinner.jsx";

function makeUUID() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let _hostListener = null;
export function registerArtifactSpreadHost(fn) {
  _hostListener = fn;
  return () => { if (_hostListener === fn) _hostListener = null; };
}

/**
 * Open the spread for an occurrence.
 * @param {string} occurrenceId  the OWNER — the thing whose files these are
 * @param {DOMRect|object} originRect  the thumbnail's rect, so the overlay
 *   animates out of the thing you clicked rather than appearing from nowhere
 */
export function openArtifactSpread(occurrenceId, originRect = null) {
  if (!_hostListener) {
    console.warn("[ArtifactSpread] no host mounted — is <ArtifactSpreadHost/> in App?");
    return;
  }
  _hostListener({ occurrenceId, originRect });
}

export function ArtifactSpreadHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerArtifactSpreadHost((r) => setReq(r || null)), []);

  const dispatch = useGridActionsSelector(s => s.dispatch);
  const socket = useGridActionsSelector(s => s.socket);
  const gridId = useGridActionsSelector(s => s.gridId ?? s.state?.gridId);
  const userId = useGridActionsSelector(s => s.userId ?? s.state?.userId);
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);

  const ownerOcc = req?.occurrenceId ? occurrencesById?.[req.occurrenceId] : null;
  const ownerModule = ownerOcc ? modulesById?.[ownerOcc.moduleId] : null;
  const ownerLabel = ownerOcc?.label || ownerModule?.label || "Files";

  const files = useMemo(
    () => (ownerOcc ? filesOf(ownerOcc, { occurrencesById, modulesById, fieldsById }) : []),
    [ownerOcc, occurrencesById, modulesById, fieldsById]
  );

  const spreadOccId = ownerOcc?.meta?.spreadPageId || null;
  const spreadOcc = spreadOccId ? occurrencesById?.[spreadOccId] : null;
  const spreadModule = spreadOcc ? modulesById?.[spreadOcc.moduleId] : null;
  const mode = spreadModule?.kind === "canvas" ? "canvas" : "board";

  const close = useCallback(() => setReq(null), []);

  // Mint the overlay page on first open, then keep it listing whatever the
  // owner has. Guarded per owner so a re-render inside the same open cannot
  // mint a second page — the create/parent-list asymmetry this codebase has
  // been bitten by makes a duplicate expensive to clean up.
  const mintedForRef = useRef(null);
  useEffect(() => {
    if (!req || !ownerOcc || !dispatch) return;
    if (spreadOcc) return;
    if (mintedForRef.current === ownerOcc.id) return;
    mintedForRef.current = ownerOcc.id;

    const moduleId = makeUUID();
    const occId = makeUUID();
    CommitHelpers.createModule({
      dispatch, socket,
      module: {
        id: moduleId, userId, gridId,
        role: "container", kind: "board",
        label: `${ownerLabel} — files`,
        // The marker AND the reason this page is invisible everywhere else:
        // nothing lists it, so only the spread can reach it.
        meta: { spreadFor: ownerOcc.id },
      },
    });
    CommitHelpers.createOccurrence({
      dispatch, socket,
      occurrence: {
        id: occId, userId, gridId, moduleId,
        // Parented to NOTHING on purpose — see the file header.
        fields: {},
        occurrences: files.map(f => f.occ.id),
        meta: { spreadFor: ownerOcc.id },
      },
      fireTrigger: false,
    });
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { ...ownerOcc, meta: { ...(ownerOcc.meta || {}), spreadPageId: occId } },
    });
  }, [req, ownerOcc, spreadOcc, dispatch, socket, gridId, userId, ownerLabel, files]);

  // Keep the page listing every artifact the owner has gained since it was
  // minted (a new Files pick, a new child). Additive only: the ORDER inside the
  // page is the user's arrangement and is never rewritten from the field.
  useEffect(() => {
    if (!req || !spreadOcc || !dispatch) return;
    const listed = new Set(spreadOcc.occurrences || []);
    const missing = files.map(f => f.occ.id).filter(id => !listed.has(id));
    if (missing.length === 0) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { ...spreadOcc, occurrences: [...(spreadOcc.occurrences || []), ...missing] },
    });
  }, [req, spreadOcc, files, dispatch, socket]);

  const handleModeChange = useCallback((next) => {
    if (!spreadModule) return;
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { ...spreadModule, kind: next === "canvas" ? "canvas" : "board" },
    });
  }, [spreadModule, dispatch, socket]);

  // Adding routes to the picker every other image entry point already uses, so
  // upload progress, the batched toast and placement behave as they do
  // everywhere else. The picked URL becomes an artifact listed by the page.
  const handleAdd = useCallback(() => {
    if (!ownerOcc) return;
    openImagePicker({
      query: ownerLabel,
      title: `Add a file — ${ownerLabel}`,
      onPick: (url) => {
        if (!url || !spreadOcc) return;
        // Lands IN the spread page, which is what makes it show up in the
        // arrangement immediately rather than after a resync.
        CommitHelpers.addImageArtifactFromUrl({
          dispatch, socket, gridId, userId,
          containerOccurrence: spreadOcc,
          url,
        });
      },
    });
  }, [ownerOcc, ownerLabel, dispatch, socket, gridId, userId, spreadOcc]);

  if (!req || !ownerOcc) return null;

  return (
    <ArtifactSpread
      open
      title={ownerLabel}
      mode={mode}
      count={files.length}
      originRect={req.originRect}
      onClose={close}
      onAdd={handleAdd}
      onModeChange={handleModeChange}
    >
      {/* The app's own container renderer, whole and unmodified — `kind`
          decides board vs canvas, so there is no second arrangement here. */}
      {spreadOcc && spreadModule ? (
        <Container
          module={spreadModule}
          panel={null}
          dispatch={dispatch}
          socket={socket}
          occurrenceOverride={spreadOcc}
          embedded
          embedSourceType="artifact-spread"
        />
      ) : files.length > 0 ? (
        // PREPARING, not empty. The spread's own page is minted lazily on first
        // open, so `spreadOcc` is null for the first render(s) — and printing
        // "No files yet" there told the user the opposite of the truth right
        // before their pictures appeared (user, 2026-08-16). The owner's file
        // count is known immediately, so it is what decides which of the two
        // this is.
        <div className="artifact-spread-loading">
          <Spinner size="sm" />
          <span>{files.length === 1 ? "Opening 1 file…" : `Opening ${files.length} files…`}</span>
        </div>
      ) : (
        <div className="artifact-spread-empty">No files yet — add one.</div>
      )}
    </ArtifactSpread>
  );
}

export default ArtifactSpreadHost;
