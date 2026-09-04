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
import {
  panelIdForElement, observePanelRect, readDockPreference, writeDockPreference,
} from "../helpers/spreadDock";

function makeUUID() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * HOW THE FILES ARE ARRANGED — and why it is DATA rather than CSS.
 *
 * "Spread" means a grid you can see at a glance. But a board container's
 * default is a STACK of full-width rows (`PAGE_DEFAULTS.board.mode = "stack"`),
 * so a page minted with no layout laid every artifact out one per row — a
 * vertical list, which is the opposite of the thing this overlay is for.
 *
 * `ModuleContainer` has had the wrapping-grid mode since 2026-08-10
 * (`mode: "wrap"` → `.container-items--wrap`, `childMinWidth` as the tile
 * width). Nothing here re-implements it: this is the same layout cascade the
 * Layout menu edits, written to the slot a container reads for its OWN
 * children (`meta.layoutCascade`, per `SURFACE_SHAPE_KEYS`). So the spread's
 * arrangement is editable in the app rather than frozen in a stylesheet, and
 * there is no second grid implementation to drift.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: the tile SIZE. `childMinWidth` /
 * `childMaxHeight` are stored PIXELS, and the right tile size depends on two
 * things a stored pixel cannot know — the viewport, and how many files this
 * particular occurrence has. Writing 200px here produced exactly what the user
 * then reported: a full-size overlay holding four small tiles in a sea of
 * empty, and a single file opening no bigger than one of four. So the spread's
 * own stylesheet sizes the tiles from the live column count (see
 * `.artifact-spread-body .container-items--wrap` in index.css), and this
 * carries only the durable ARRANGEMENT decision.
 *
 * Only `board` mode reads any of this — canvas positions by x/y.
 */
const SPREAD_LAYOUT = Object.freeze({
  mode: "wrap",
  childGap: 10,
});

let _hostListener = null;
export function registerArtifactSpreadHost(fn) {
  _hostListener = fn;
  return () => { if (_hostListener === fn) _hostListener = null; };
}

/**
 * Open the spread for an occurrence.
 * @param {string} occurrenceId  the OWNER — the thing whose files these are
 * @param {Element} originEl  the ELEMENT that was clicked. Two things are read
 *   off it, in ONE place:
 *     - its rect, so the overlay animates out of the thing you clicked rather
 *       than appearing from nowhere;
 *     - the PANEL it sits in, so the viewer can dock into that panel.
 *   It takes the element rather than the rect precisely so the panel walk lives
 *   here instead of at each of the four call sites — "the fifth caller forgets"
 *   is the defect class this codebase keeps paying for, and a caller that
 *   handed over a rect could not have answered the panel question at all.
 */
/**
 * What the spread page's child list should become — or `null` for "leave it".
 *
 * Exported and pure because mounting the host needs the whole grid store, and
 * this is where an infinite render loop lived: the convergence check and the
 * write disagreed about the OWNER'S OWN id, so the effect rewrote the same
 * value forever (React #185, blank app, reported as "clicking on one of the
 * covers crashed the entire app").
 *
 * The invariant a test can hold onto: **whatever this returns, feeding it back
 * in must return null.** An effect that cannot say "nothing left to do" about
 * its own output is an infinite loop waiting for the right data.
 */
export function planSpreadSync({ listed, fileIds, ownerId, needsLayout }) {
  const have = new Set(listed || []);

  // ── ASK `filesOf`, DO NOT SECOND-GUESS IT ────────────────────────────────
  //
  // Whether the owner is one of its own files is `filesOf`'s decision and it
  // already makes it carefully: it pushes self when the owner CARRIES a src,
  // or when nothing else would render — that second arm exists precisely so a
  // row whose only picture is its own cover opens onto something rather than
  // an empty window.
  //
  // Stripping the owner unconditionally overruled that arm, and it is not a
  // rare shape: 11,559 artifact rows on this grid have no artifact child and
  // no fileRef of their own — every book, album, song and artist — and 10,795
  // of them carry a cover the card draws from `occurrence.meta.cover`. All of
  // them opened onto "0 files" (user, 2026-08-27: *"images arent loading at
  // all when focused in the artifact viewer … just fails to load"*).
  //
  // So: when `filesOf` reports the owner, it is a file and it stays. When it
  // does NOT, the owner is a PHANTOM persisted by an older mint and is pruned
  // — which is the movie double-poster case `504fc3ca` was written for, kept
  // intact.
  const ownerIsAFile = (fileIds || []).includes(ownerId);

  const missing = (fileIds || []).filter((id) => !have.has(id));
  const phantomSelf = !ownerIsAFile && (listed || []).includes(ownerId);
  if (!missing.length && !needsLayout && !phantomSelf) return null;

  const next = [...(listed || []), ...missing];
  return ownerIsAFile ? next : next.filter((id) => id !== ownerId);
}

export function openArtifactSpread(occurrenceId, originEl = null) {
  if (!_hostListener) {
    console.warn("[ArtifactSpread] no host mounted — is <ArtifactSpreadHost/> in App?");
    return;
  }
  // BOTH derived here, from the one thing every caller already has in hand. A
  // caller passing a rect could not have answered the panel question at all,
  // and asking four call sites to answer it themselves is the trap named above.
  const originRect = originEl?.getBoundingClientRect
    ? originEl.getBoundingClientRect()
    : (originEl || null);
  _hostListener({ occurrenceId, originRect, panelId: panelIdForElement(originEl) });
}

export function ArtifactSpreadHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerArtifactSpreadHost((r) => setReq(r || null)), []);

  // ── DOCKING ────────────────────────────────────────────────────────────────
  // The preference is read ONCE per session and remembered per device, so
  // flipping the switch on one viewer applies to the next (user, 2026-09-04:
  // "this new button should be a switch button", answered: remembered globally).
  const [docked, setDocked] = useState(() => readDockPreference());
  const changeDock = useCallback((next) => {
    setDocked(next);
    writeDockPreference(next);
  }, []);

  // The panel's LIVE box — it can be resized, re-laid-out or scrolled while the
  // viewer sits over it, and a rect captured at open time would leave the
  // viewer floating over nothing.
  const [dockRect, setDockRect] = useState(null);
  const panelId = req?.panelId || null;
  useEffect(() => {
    if (!req || !panelId) { setDockRect(null); return undefined; }
    return observePanelRect(panelId, setDockRect);
  }, [req, panelId]);

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
        meta: { spreadFor: ownerOcc.id, layoutCascade: { ...SPREAD_LAYOUT } },
      },
      fireTrigger: false,
    });
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { ...ownerOcc, meta: { ...(ownerOcc.meta || {}), spreadPageId: occId } },
    });
  }, [req, ownerOcc, spreadOcc, dispatch, socket, gridId, userId, ownerLabel, files]);

  // Keep the page in step with the owner on open. TWO things can be stale, and
  // they are written TOGETHER in ONE update on purpose: both patches spread the
  // same `spreadOcc` snapshot, so as separate effects whichever landed second
  // would carry a copy of the occurrence taken before the first — dropping it.
  // That stale-snapshot clobber is a class this repo has paid for repeatedly.
  useEffect(() => {
    if (!req || !spreadOcc || !dispatch) return;

    // (1) Artifacts the owner has gained since the page was minted (a new Files
    // pick, a new child). Additive only — the ORDER inside the page is the
    // user's arrangement and is never rewritten from the field.
    // (1) Artifacts the owner has gained since the page was minted, (2) a page
    // minted before the spread had a layout, (3) an owner that must never list
    // itself. All three decided by `planSpreadSync` above — pure, exported and
    // tested, because this is where an infinite render loop lived.
    const needsLayout = !spreadOcc.meta?.layoutCascade?.mode;
    const nextList = planSpreadSync({
      listed: spreadOcc.occurrences || [],
      fileIds: files.map((f) => f.occ.id),
      ownerId: ownerOcc?.id,
      needsLayout,
    });
    if (!nextList) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        ...spreadOcc,
        occurrences: nextList,
        ...(needsLayout
          ? { meta: { ...(spreadOcc.meta || {}), layoutCascade: { ...SPREAD_LAYOUT } } }
          : null),
      },
    });
  }, [req, spreadOcc, files, dispatch, socket, ownerOcc?.id]);

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
      // THE COUNT IS WHAT IS RENDERED, not what the owner's Files field holds.
      // The page can legitimately carry MORE than `filesOf`: the top-up below
      // is additive only (a picture replaced by a migration stays listed), and
      // the "+" button adds straight to the page rather than to the field. The
      // header said "4 files" over five tiles, and — because `count` also
      // drives the column count — the fifth wrapped onto a second row.
      count={spreadOcc?.occurrences?.length ?? files.length}
      originRect={req.originRect}
      // `canDock` is the honest answer to "is there a panel to dock into" — a
      // viewer opened from a doc embed or a preview iframe has none, and the
      // switch is hidden there rather than shown doing nothing.
      canDock={!!panelId}
      docked={docked}
      dockRect={dockRect}
      onDockChange={changeDock}
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
