// PagePreviewApp.jsx
// Lightweight app for iframe previews. Loaded when ?previewOcc=<occId> is in the URL.
// Reads state from window.parent.__moduli_state__ (same origin) — no socket needed.
// Renders the actual Page component at full size — the parent iframe handles CSS scaling.

import { expandByEmbeds } from "./helpers/textmapEmbeds";
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { GridActionsContext } from "./GridActionsContext";
import { GridDataContext } from "./GridDataContext";
import { GridLiveContext } from "./GridLiveContext";
import { publishComputedValues } from "./state/computedValuesStore";
import { buildLookup } from "./helpers/LayoutHelpers";
import { occurrenceIndexFor, collectSubtreeIds } from "./helpers/previewSubtreeIndex";
import { useTheme } from "./helpers/useTheme";
import { StaticTextContext } from "./ui/AutoMarquee.jsx";

import Page from "./modules/ModulePage.jsx";
import Container from "./modules/ModuleContainer.jsx";
import { DocContent } from "./modules/DocContent.jsx";

function readParentState() {
  try { return window.top?.__moduli_state__ || null; } catch { return null; }
}

// Default export — used by main.jsx for the legacy iframe entry point.
// Sets up theme + polls window.top.__moduli_state__ until hydrated, then
// renders the shared body. Kept for backwards compatibility with any
// outstanding iframes; the in-app PreviewNode bypasses this and renders
// PagePreviewBody inline (zero bundle reload, zero iframe overhead).
export default function PagePreviewApp({ occurrenceId }) {
  useTheme();
  const [parentState, setParentState] = useState(readParentState);

  useEffect(() => {
    if (parentState?.hydrated) return;
    const id = setInterval(() => {
      const s = readParentState();
      if (s?.hydrated) { setParentState(s); clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [parentState?.hydrated]);

  return <PagePreviewBody parentState={parentState} occurrenceId={occurrenceId} />;
}

// Named export — the reusable rendering body. Takes `parentState` as a
// prop instead of polling window globals, so PreviewNode (in the parent
// React tree) can mount it inline without an iframe. Same subtree
// filtering, same context-override architecture — only the state source
// changes.
export function PagePreviewBody({ parentState, occurrenceId }) {
  // Build a SUBTREE-only view of the parent state. The iframe needs:
  //   - the target occurrence + every descendant reachable via .occurrences[]
  //     or .parentId (instances inside containers, container children of a
  //     board page, etc.)
  //   - every module those occurrences reference
  //   - every field bound to those modules (or stamped on those occurrences)
  //   - the views/manifests/folders the target's render path touches
  // Everything else from the 720-occurrence parent grid is dropped — we
  // don't pay for it on every iframe mount.
  //
  // Diffs from "use the full parent state":
  //   - 20 iframes × 720 occurrences in lookups = 14,400 entries
  //   - 20 iframes × ~50 occurrences (typical board page) = 1,000 entries
  // Both lookups + downstream useMemos on containersById / role buckets /
  // childrenByParentId shrink proportionally, which is the dominant cost
  // when folder pages render many cards at once.

  const allOccurrences = parentState?.occurrences || [];
  const allModules = parentState?.modules || [];

  // Step 1: collect the occurrence subtree (walk down).
  //
  // Structural reachability (`occurrences[]` + `parentId`) is delegated to
  // `helpers/previewSubtreeIndex`, which builds ONE reverse index per
  // occurrences array and shares it across every card on the page. What used
  // to live here was a fixpoint scan over the WHOLE grid, per card — see that
  // file's header for the measurement and why it stopped scaling.
  const occIndex = useMemo(() => occurrenceIndexFor(allOccurrences), [allOccurrences]);

  // FOLDER pages hold nothing in `occurrences[]` — their cards are the
  // occurrences parented under the FOLDER itself (see ModulePage's
  // folderChildOccs). A folder is not an occurrence, so a walk from the page
  // can never reach them (2026-07-25: "if i click on mind, its filled with
  // boards but doesnt show it in the preview"). Seed the folder's own
  // contents, plus any CHILD folder's, so nested folders show as cards too.
  const seedFolderIds = useMemo(() => {
    const rootFolderId = occIndex.byId[occurrenceId]?.parentId;
    if (!rootFolderId) return [];
    const kids = (parentState?.folders || [])
      .filter(f => f.parentId === rootFolderId && f.folderType !== "category")
      .map(f => f.id);
    return [rootFolderId, ...kids];
  }, [occIndex, occurrenceId, parentState?.folders]);

  const subtreeOccurrenceIds = useMemo(() => {
    const seen = collectSubtreeIds({
      rootOccurrenceId: occurrenceId,
      index: occIndex,
      folderIds: seedFolderIds,
    });
    // A DOC DRAWS ITS TEXTMAP, and the nodes in it reference other occurrences
    // by id — a THIRD reachability path beside `occurrences[]` and `parentId`.
    // Without this pass the preview dropped them and `ModuleEmbedNode` painted
    // `embed: <uuid>` in a dashed box: measured 2026-08-23, **474 embeds across
    // 233 hosts grid-wide are reachable only this way**, which is why a
    // text-heavy page's preview card was full of placeholders while the page
    // itself rendered fine.
    //
    // Transitive, because an embedded doc can embed further docs — and it only
    // adds ids that RESOLVE, so a dangling embed stays undrawn rather than
    // becoming a phantom entry the module lookup then misses.
    expandByEmbeds(seen, occIndex.byId);
    return seen;
  }, [occIndex, occurrenceId, seedFolderIds]);

  // Built from the SUBTREE, not by scanning the grid: the shared index already
  // resolves an id, so this costs the size of the card's own contents. A
  // dangling child ref (an id the walk kept but no occurrence carries) is
  // dropped here, which is what the walk relies on.
  const occurrencesById = useMemo(() => {
    const out = Object.create(null);
    for (const id of subtreeOccurrenceIds) {
      const occ = occIndex.byId[id];
      if (occ) out[id] = occ;
    }
    return out;
  }, [occIndex, subtreeOccurrenceIds]);

  // Step 2: collect modules referenced by the subtree occurrences.
  // Templates referenced by `meta.appliedFromTemplateId` aren't strictly
  // needed for render — skip them.
  const subtreeModuleIds = useMemo(() => {
    const ids = new Set();
    for (const id of subtreeOccurrenceIds) {
      const occ = occurrencesById[id];
      if (!occ) continue;
      if (occ.moduleId) ids.add(occ.moduleId);
    }
    return ids;
  }, [subtreeOccurrenceIds, occurrencesById]);

  const modulesById = useMemo(() => {
    const out = Object.create(null);
    for (const m of allModules) if (subtreeModuleIds.has(m.id)) out[m.id] = m;
    return out;
  }, [allModules, subtreeModuleIds]);

  // Step 3: subtree-scoped views + folders + manifests + fields. Only the
  // ids actually referenced by the subtree get pulled in.
  const subtreeViewIds = useMemo(() => {
    const ids = new Set();
    for (const id of subtreeOccurrenceIds) {
      const v = occurrencesById[id]?.viewId;
      if (v) ids.add(v);
    }
    for (const id of subtreeModuleIds) {
      const v = modulesById[id]?.viewId;
      if (v) ids.add(v);
    }
    return ids;
  }, [subtreeOccurrenceIds, occurrencesById, subtreeModuleIds, modulesById]);

  const viewsById = useMemo(() => {
    const out = Object.create(null);
    for (const v of parentState?.views || []) if (subtreeViewIds.has(v.id)) out[v.id] = v;
    return out;
  }, [parentState?.views, subtreeViewIds]);

  // Fields referenced by any module binding OR stamped on any occurrence
  // in the subtree. Other grid fields aren't rendered here.
  const subtreeFieldIds = useMemo(() => {
    const ids = new Set();
    for (const id of subtreeModuleIds) {
      const m = modulesById[id];
      if (!m) continue;
      for (const b of (m.fieldBindings || [])) if (b?.fieldId) ids.add(b.fieldId);
    }
    for (const id of subtreeOccurrenceIds) {
      const occ = occurrencesById[id];
      if (!occ?.fields) continue;
      for (const fid of Object.keys(occ.fields)) ids.add(fid);
    }
    return ids;
  }, [subtreeModuleIds, modulesById, subtreeOccurrenceIds, occurrencesById]);

  const fieldsById = useMemo(() => {
    const out = Object.create(null);
    for (const f of parentState?.fields || []) if (subtreeFieldIds.has(f.id)) out[f.id] = f;
    return out;
  }, [parentState?.fields, subtreeFieldIds]);

  // Role-bucket maps — derived from the already-subtree-scoped modulesById.
  const moduleValues = useMemo(() => Object.values(modulesById), [modulesById]);
  const containersById = useMemo(
    () => buildLookup(moduleValues.filter(m => m.role === "container")),
    [moduleValues]
  );
  const instancesById = useMemo(
    () => buildLookup(moduleValues.filter(m => m.role === "instance" || !m.role)),
    [moduleValues]
  );
  const artifactsById = useMemo(
    () => buildLookup(moduleValues.filter(m => m.role === "artifact")),
    [moduleValues]
  );
  const textblocksById = useMemo(
    () => buildLookup(moduleValues.filter(m => m.role === "textblock")),
    [moduleValues]
  );
  const leafModulesById = useMemo(
    () => ({ ...instancesById, ...artifactsById, ...textblocksById }),
    [instancesById, artifactsById, textblocksById]
  );

  // Folders + manifests are tree-nav metadata. We only need the ones in
  // the target occurrence's parentage chain (for breadcrumb lookups on a
  // folder-page render).
  const subtreeFolderIds = useMemo(() => {
    const ids = new Set();
    for (const id of subtreeOccurrenceIds) {
      const pid = occurrencesById[id]?.parentId;
      if (pid) ids.add(pid); // may or may not be a folder id — buildLookup will ignore non-matches
    }
    return ids;
  }, [subtreeOccurrenceIds, occurrencesById]);

  const foldersById = useMemo(() => {
    const out = Object.create(null);
    for (const f of parentState?.folders || []) if (subtreeFolderIds.has(f.id)) out[f.id] = f;
    return out;
  }, [parentState?.folders, subtreeFolderIds]);

  // Manifests are small (typically 1–3 per grid) and the iframe rarely
  // needs them; keep them empty unless a render path complains.
  const manifestsById = useMemo(() => ({}), []);
  // Operations don't run inside previews — they'd write back via socket,
  // and we have no socket. Skip building this map entirely.
  const operationsById = useMemo(() => ({}), []);

  const childrenByParentId = useMemo(() => {
    const idx = Object.create(null);
    for (const id of subtreeOccurrenceIds) {
      const occ = occurrencesById[id];
      if (occ?.parentId) (idx[occ.parentId] || (idx[occ.parentId] = [])).push(occ);
    }
    return idx;
  }, [subtreeOccurrenceIds, occurrencesById]);

  const occurrence = occurrencesById[occurrenceId];
  const module = occurrence?.moduleId ? modulesById[occurrence.moduleId] : null;

  const noop = useMemo(() => () => {}, []);
  // Mirror App.jsx's stable non-subscribing getters so hot-path components
  // (ModuleContainer / ModuleInstance) work identically under preview.
  const lookupsRef = useRef({});
  lookupsRef.current = { occurrencesById, modulesById, childrenByParentId, fieldsById, state: parentState || {} };
  const getOcc = useCallback((id) => (id ? lookupsRef.current.occurrencesById?.[id] || null : null), []);
  const getMod = useCallback((id) => (id ? lookupsRef.current.modulesById?.[id] || null : null), []);
  const getOccMap = useCallback(() => lookupsRef.current.occurrencesById || {}, []);
  const getModMap = useCallback(() => lookupsRef.current.modulesById || {}, []);
  // Read at CALLBACK time like the maps above. `occurrenceUrl` needs it to rank
  // url-ish field NAMES, and the row menus must not subscribe to it.
  const getFieldMap = useCallback(() => lookupsRef.current.fieldsById || {}, []);
  const getParentId = useCallback(() => null, []);
  const getLinkedGroup = useCallback(() => [], []);
  const getState = useCallback(() => lookupsRef.current.state || {}, []);
  const actionsValue = useMemo(() => ({
    dispatch: noop,
    socket: null,
    state: parentState || {},
    getOcc, getMod, getOccMap, getModMap, getFieldMap, getParentId, getLinkedGroup, getState,
    occurrencesById,
    modulesById,
    viewsById,
    fieldsById,
    containersById,
    instancesById,
    artifactsById,
    textblocksById,
    leafModulesById,
    panelsById: {},
    manifestsById,
    foldersById,
    operationsById,
    linkedGroupIndex: {},
    childrenByParentId,
  }), [occurrencesById, modulesById, viewsById, fieldsById, containersById, instancesById, artifactsById, textblocksById, leafModulesById, manifestsById, foldersById, operationsById, childrenByParentId, noop, parentState, getOcc, getMod, getOccMap, getModMap, getFieldMap, getParentId, getLinkedGroup, getState]);

  const dataValue = useMemo(() => ({ state: parentState || {} }), [parentState]);
  // Preview iframes have their own module graph → their own computedValues
  // store instance. Publish the parent snapshot so field displays resolve.
  useLayoutEffect(() => {
    publishComputedValues(parentState?.computedValues || {});
  }, [parentState?.computedValues]);
  const liveValue = useMemo(() => ({
    canUndo: false, canRedo: false,
    undo: noop, redo: noop,
    isProcessing: false,
    isTouch: false, isMobileLayout: false,
    activeCell: null, setActiveCell: noop,
    zoomedOut: false, setZoomedOut: noop,
  }), [noop]);

  if (!occurrence || !module) {
    return <div style={{ width: "100%", height: "100%", background: "var(--body-bg, #101318)" }} />;
  }

  return (
    <GridActionsContext.Provider value={actionsValue}>
      <GridDataContext.Provider value={dataValue}>
        <GridLiveContext.Provider value={liveValue}>
        {/* Everything drawn in a preview card renders its text STATIC — see
            ui/AutoMarquee. One provider covers every label, pill, cell and
            header in the subtree, so no call site has to remember. */}
        <StaticTextContext.Provider value={true}>
          <div style={{
            width: "100%", height: "100%",
            overflow: "hidden",
            background: "var(--body-bg, #101318)",
            color: "var(--text-primary, #e0e0e0)",
            display: "flex",
            flexDirection: "column",
          }}>
            {module.role === "page" ? (
              <Page
                occurrence={occurrence}
                panelId={null}
                panelOccurrence={null}
                panelView={null}
                dispatch={noop}
                socket={null}
                addInstanceToContainer={noop}
                drilldownTarget={null}
                onDrilldownComplete={null}
              />
            ) : (module.kind === "doc" || module.kind === "artifact") ? (
              <DocContent
                occurrence={occurrence}
                dispatch={noop}
                socket={null}
              />
            ) : (
              <Container
                module={module}
                occurrenceOverride={occurrence}
                panelId={null}
                dispatch={noop}
                socket={null}
              />
            )}
          </div>
        </StaticTextContext.Provider>
        </GridLiveContext.Provider>
      </GridDataContext.Provider>
    </GridActionsContext.Provider>
  );
}
