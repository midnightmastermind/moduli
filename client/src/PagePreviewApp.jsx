// PagePreviewApp.jsx
// Lightweight app for iframe previews. Loaded when ?previewOcc=<occId> is in the URL.
// Reads state from window.parent.__moduli_state__ (same origin) — no socket needed.
// Renders the actual Page component at full size — the parent iframe handles CSS scaling.

import React, { useState, useEffect, useMemo } from "react";
import { GridActionsContext } from "./GridActionsContext";
import { GridDataContext } from "./GridDataContext";
import { GridLiveContext } from "./GridLiveContext";
import { buildLookup } from "./helpers/LayoutHelpers";
import { computeRoleByModuleId } from "./state/selectors";
import { useTheme } from "./helpers/useTheme";

import Page from "./modules/ModulePage.jsx";
import Container from "./modules/ModuleContainer.jsx";
import { DocContent } from "./modules/DocContent.jsx";

function readParentState() {
  try { return window.top?.__moduli_state__ || null; } catch { return null; }
}

export default function PagePreviewApp({ occurrenceId }) {
  useTheme();
  const [parentState, setParentState] = useState(readParentState);

  // Poll parent state until it's hydrated (parent may still be loading)
  useEffect(() => {
    if (parentState?.hydrated) return;
    const id = setInterval(() => {
      const s = readParentState();
      if (s?.hydrated) { setParentState(s); clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [parentState?.hydrated]);

  const occurrencesById = useMemo(() => buildLookup(parentState?.occurrences || []), [parentState?.occurrences]);
  const modulesById = useMemo(() => buildLookup(parentState?.modules || []), [parentState?.modules]);
  const viewsById = useMemo(() => buildLookup(parentState?.views || []), [parentState?.views]);
  const fieldsById = useMemo(() => buildLookup(parentState?.fields || []), [parentState?.fields]);
  const containersById = useMemo(() => buildLookup(parentState?.containers || []), [parentState?.containers]);
  const instancesById = useMemo(() => buildLookup((parentState?.modules || []).filter(m => m.role === "instance")), [parentState?.modules]);
  const foldersById = useMemo(() => buildLookup(parentState?.folders || []), [parentState?.folders]);
  const manifestsById = useMemo(() => buildLookup(parentState?.manifests || []), [parentState?.manifests]);
  const operationsById = useMemo(() => buildLookup(parentState?.operations || []), [parentState?.operations]);

  const childrenByParentId = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of parentState?.occurrences || []) {
      if (occ.parentId) {
        (idx[occ.parentId] || (idx[occ.parentId] = [])).push(occ);
      }
    }
    return idx;
  }, [parentState?.occurrences]);

  const occurrence = occurrencesById[occurrenceId];
  const module = occurrence?.targetId ? modulesById[occurrence.targetId] : null;

  const roleByModuleId = useMemo(
    () => computeRoleByModuleId(parentState?.grid, occurrencesById, modulesById),
    [parentState?.grid, occurrencesById, modulesById]
  );

  const noop = useMemo(() => () => {}, []);
  const actionsValue = useMemo(() => ({
    dispatch: noop,
    socket: null,
    occurrencesById,
    modulesById,
    viewsById,
    fieldsById,
    containersById,
    instancesById,
    panelsById: {},
    manifestsById,
    foldersById,
    operationsById,
    roleByModuleId,
    linkedGroupIndex: {},
    childrenByParentId,
  }), [occurrencesById, modulesById, viewsById, fieldsById, containersById, instancesById, manifestsById, foldersById, operationsById, roleByModuleId, childrenByParentId, noop]);

  const dataValue = useMemo(() => ({ state: parentState || {} }), [parentState]);
  const liveValue = useMemo(() => ({
    computedValues: parentState?.computedValues || {},
    canUndo: false, canRedo: false,
    undo: noop, redo: noop,
    isProcessing: false,
    isMobile: false,
    activeCell: null, setActiveCell: noop,
    zoomedOut: false, setZoomedOut: noop,
  }), [noop, parentState?.computedValues]);

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
