// PagePreviewApp.jsx
// Lightweight app for iframe previews. Loaded when ?previewOcc=<occId> is in the URL.
// Reads state from window.parent.__moduli_state__ (same origin) — no socket needed.
// Renders the actual Page component at full size — the parent iframe handles CSS scaling.

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { GridActionsContext } from "./GridActionsContext";
import { GridDataContext } from "./GridDataContext";
import { GridLiveContext } from "./GridLiveContext";
import { publishComputedValues } from "./state/computedValuesStore";
import { buildLookup } from "./helpers/LayoutHelpers";
import { computeRoleByModuleId } from "./state/selectors";
import { useTheme } from "./helpers/useTheme";

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
  const subtreeOccurrenceIds = useMemo(() => {
    const occByIdAll = buildLookup(allOccurrences);
    const seen = new Set();
    const queue = [occurrenceId];
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const occ = occByIdAll[id];
      if (!occ) continue;
      const children = Array.isArray(occ.occurrences) ? occ.occurrences : [];
      for (const cid of children) if (!seen.has(cid)) queue.push(cid);
      // Also fan out via parentId reverse edge (some occurrences link via
      // parentId only — e.g. artifact occurrences under a folder page).
      // Look up reverse via a scan once and cache.
    }
    // FOLDER pages hold nothing in `occurrences[]` — their cards are the
    // occurrences parented under the FOLDER itself (see ModulePage's
    // folderChildOccs). A folder is not an occurrence, so the walk above can
    // never reach them and the preview rendered empty (2026-07-25: "if i click
    // on mind, its filled with boards but doesnt show it in the preview").
    // Seed the folder's contents, plus the folder-page occurrences of any
    // CHILD folder so nested folders show as cards too.
    const rootOcc = occByIdAll[occurrenceId];
    const rootFolderId = rootOcc?.parentId;
    if (rootFolderId) {
      const childFolderIds = new Set(
        (parentState?.folders || [])
          .filter(f => f.parentId === rootFolderId && f.folderType !== "category")
          .map(f => f.id)
      );
      for (const occ of allOccurrences) {
        if (!occ.id || seen.has(occ.id)) continue;
        if (occ.parentId === rootFolderId || childFolderIds.has(occ.parentId)) seen.add(occ.id);
      }
    }

    // One parentId-reverse pass: include any occurrence whose parentId is
    // already in `seen` (handles parentId-linked artifacts/textblocks).
    let changed = true;
    while (changed) {
      changed = false;
      for (const occ of allOccurrences) {
        if (!occ.id || seen.has(occ.id)) continue;
        if (occ.parentId && seen.has(occ.parentId)) { seen.add(occ.id); changed = true; }
      }
    }
    return seen;
  }, [allOccurrences, occurrenceId, parentState?.folders]);

  const occurrencesById = useMemo(() => {
    const out = Object.create(null);
    for (const occ of allOccurrences) if (subtreeOccurrenceIds.has(occ.id)) out[occ.id] = occ;
    return out;
  }, [allOccurrences, subtreeOccurrenceIds]);

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

  const roleByModuleId = useMemo(
    () => computeRoleByModuleId(parentState?.grid, occurrencesById, modulesById),
    [parentState?.grid, occurrencesById, modulesById]
  );

  const noop = useMemo(() => () => {}, []);
  // Mirror App.jsx's stable non-subscribing getters so hot-path components
  // (ModuleContainer / ModuleInstance) work identically under preview.
  const lookupsRef = useRef({});
  lookupsRef.current = { occurrencesById, modulesById, childrenByParentId, state: parentState || {} };
  const getOcc = useCallback((id) => (id ? lookupsRef.current.occurrencesById?.[id] || null : null), []);
  const getMod = useCallback((id) => (id ? lookupsRef.current.modulesById?.[id] || null : null), []);
  const getOccMap = useCallback(() => lookupsRef.current.occurrencesById || {}, []);
  const getModMap = useCallback(() => lookupsRef.current.modulesById || {}, []);
  const getParentId = useCallback(() => null, []);
  const getLinkedGroup = useCallback(() => [], []);
  const getState = useCallback(() => lookupsRef.current.state || {}, []);
  const actionsValue = useMemo(() => ({
    dispatch: noop,
    socket: null,
    state: parentState || {},
    getOcc, getMod, getOccMap, getModMap, getParentId, getLinkedGroup, getState,
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
    roleByModuleId,
    linkedGroupIndex: {},
    childrenByParentId,
  }), [occurrencesById, modulesById, viewsById, fieldsById, containersById, instancesById, artifactsById, textblocksById, leafModulesById, manifestsById, foldersById, operationsById, roleByModuleId, childrenByParentId, noop, parentState, getOcc, getMod, getOccMap, getModMap, getParentId, getLinkedGroup, getState]);

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
        </GridLiveContext.Provider>
      </GridDataContext.Provider>
    </GridActionsContext.Provider>
  );
}
