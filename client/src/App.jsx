// App.jsx — STEP 2: commits routed through CommitHelpers / LayoutHelpers
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preventUnhandled } from "@atlaskit/pragmatic-drag-and-drop/prevent-unhandled";

import { socket } from "./socket";
import { bindSocketToStore, operationsBridge } from "./state/bindSocketToStore";

import { ActionTypes, logoutAction } from "./state/actions";
import Grid from "./Grid";
import LoginScreen from "./LoginScreen";

import { GridDataContext } from "./GridDataContext";
import { GridActionsContext } from "./GridActionsContext";
import { GridLiveContext } from "./GridLiveContext";

import { useBoardState } from "./state/useBoardState";

import Toolbar from "./Toolbar";
import TransactionHistory from "./ui/TransactionHistory";
import CommandCenter from "./ui/CommandCenter";
import { Spinner } from "./components/ui/spinner";
import { Toaster } from "./components/ui/sonner";

import { useUndoRedo } from "./hooks/useUndoRedo";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAnimations } from "./hooks/useAnimations";
import { useTheme } from "./helpers/useTheme";
import { useMobileDetect } from "./hooks/useMobileDetect";

import * as CommitHelpers from "./helpers/CommitHelpers";
import * as LayoutHelpers from "./helpers/LayoutHelpers";
import { buildLookup } from "./helpers/LayoutHelpers";
import { computeRoleByModuleId } from "./state/selectors";

function findNextOpenPosition(panels = [], rows = 1, cols = 1) {
  const taken = new Set(panels.map((p) => `${p.row}-${p.col}`));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}-${c}`;
      if (!taken.has(key)) return { row: r, col: c };
    }
  }
  return { row: 0, col: 0 };
}

export default function App() {
  const { state, dispatch: rawDispatch } = useBoardState();

  // Keep a ref to current state so bindSocketToStore's executor always sees fresh state
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track previous filterNavState to detect date changes for NavigationOp
  const prevFilterNavRef = useRef({});

  // Expose state to window for E2E test data verification
  if (typeof window !== "undefined") window.__moduli_state__ = state;

  // BroadcastChannel for multi-window sync (same origin, same browser)
  const bcRef = useRef(null);

  // Wrapped dispatch: posts to BroadcastChannel for non-socket, non-BC actions
  const dispatch = useCallback((action) => {
    rawDispatch(action);
    if (!action._fromSocket && !action._fromBC && bcRef.current) {
      try {
        bcRef.current.postMessage({ _type: "dispatch", payload: action });
      } catch {
        // ignore non-serializable actions
      }
    }
  }, [rawDispatch]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("moduli-sync");
    bcRef.current = bc;
    bc.onmessage = (e) => {
      if (e.data?._type === "dispatch") {
        rawDispatch({ ...e.data.payload, _fromBC: true });
      }
    };
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, [rawDispatch]);

  const modulesById = useMemo(
    () => buildLookup(state.modules),
    [state.modules]
  );

  const roleByModuleId = useMemo(
    () => computeRoleByModuleId(state.grid, buildLookup(state.occurrences), modulesById),
    [state.grid, state.occurrences, modulesById]
  );

  const instancesById = useMemo(
    () => buildLookup(state.instances),
    [state.instances]
  );

  const artifactsById = useMemo(
    () => buildLookup(state.artifacts),
    [state.artifacts]
  );

  const textblocksById = useMemo(
    () => buildLookup(state.textblocks),
    [state.textblocks]
  );

  // Merged leaf-placeable lookup — anything that can live as a child of a container.
  const leafModulesById = useMemo(
    () => ({ ...instancesById, ...artifactsById, ...textblocksById }),
    [instancesById, artifactsById, textblocksById]
  );

  const occurrencesById = useMemo(
    () => buildLookup(state.occurrences),
    [state.occurrences]
  );

  // C3: Pre-index linked groups for O(1) sibling lookup in Instance.jsx
  const linkedGroupIndex = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of state.occurrences || []) {
      if (occ.linkedGroupId) {
        (idx[occ.linkedGroupId] || (idx[occ.linkedGroupId] = [])).push(occ);
      }
    }
    return idx;
  }, [state.occurrences]);

  // Pre-index children by parentId for O(1) lookups in ManifestTree
  const childrenByParentId = useMemo(() => {
    const idx = Object.create(null);
    for (const occ of state.occurrences || []) {
      if (occ.parentId) {
        (idx[occ.parentId] || (idx[occ.parentId] = [])).push(occ);
      }
    }
    return idx;
  }, [state.occurrences]);

  const containersById = useMemo(
    () => buildLookup(state.containers),
    [state.containers]
  );

  const fieldsById = useMemo(
    () => buildLookup(state.fields),
    [state.fields]
  );

  const manifestsById = useMemo(
    () => buildLookup(state.manifests),
    [state.manifests]
  );

  const viewsById = useMemo(
    () => buildLookup(state.views),
    [state.views]
  );

  const foldersById = useMemo(
    () => buildLookup(state.folders),
    [state.folders]
  );

  const operationsById = useMemo(
    () => buildLookup(state.operations),
    [state.operations]
  );

  // Undo/Redo state (lifted from Grid so Toolbar can access it)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  // Once CC opens for the first time, keep it mounted so slide animation works on close
  const [commandCenterEverOpened, setCommandCenterEverOpened] = useState(false);
  useEffect(() => { if (commandCenterOpen) setCommandCenterEverOpened(true); }, [commandCenterOpen]);

  // Auto-collapse CommandCenter when ANY drag starts + prevent OS from intercepting unhandled drags
  useEffect(() => {
    return monitorForElements({
      onDragStart: () => {
        setCommandCenterOpen(false);
        preventUnhandled.start();
      },
      onDrop: () => {
        preventUnhandled.stop();
      },
    });
  }, []);

  // Global Escape key: close history dialog first, then CommandCenter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.contentEditable === "true") return;
      if (historyOpen) { setHistoryOpen(false); return; }
      if (commandCenterOpen) { setCommandCenterOpen(false); return; }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandCenterOpen, historyOpen]);

  const { captureAllPositions, animateToNewPositions, flashElement } = useAnimations();
  useTheme(); // Applies data-theme + dark class from localStorage on mount

  // Mobile grid navigation state
  const { isMobile } = useMobileDetect();
  const [activeCell, setActiveCell] = useState({ row: 0, col: 0 });
  const [zoomedOut, setZoomedOut] = useState(false);

  // CS6b — Load persisted CSS token overrides on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("moduli-token-overrides") || "{}");
      const entries = Object.entries(saved).filter(([, v]) => v?.trim());
      if (entries.length === 0) return;
      let tag = document.getElementById("moduli-token-overrides");
      if (!tag) { tag = document.createElement("style"); tag.id = "moduli-token-overrides"; document.head.appendChild(tag); }
      tag.textContent = `:root { ${entries.map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
    } catch {}
  }, []);

  // onUndoAnimation: called by useUndoRedo when undo_result arrives with move_back ops
  // By this point positions are captured (captureAllPositions called in undoWithCapture below)
  // sync_state has been queued but not yet processed; 100ms is enough for React to re-render
  const onUndoAnimation = useCallback((moveOps) => {
    const ids = moveOps.map(op => op.occurrenceId);
    setTimeout(() => {
      animateToNewPositions(ids).then(() => ids.forEach(flashElement));
    }, 100);
  }, [animateToNewPositions, flashElement]);

  const { canUndo, canRedo, undo: _undo, redo, isProcessing } = useUndoRedo(
    socket,
    state.grid?._id,
    onUndoAnimation
  );

  // Wrap undo to capture all occurrence positions BEFORE state changes
  const undo = useCallback(() => {
    captureAllPositions();
    _undo();
  }, [captureAllPositions, _undo]);

  // Global keyboard shortcuts for undo/redo (Ctrl+Z, Ctrl+Y)
  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    enabled: !isProcessing,
  });

  // Filter system — reads directly from grid state (no local copy needed — grid is source of truth)

  // Global toolbar date nav — steps all isNav conditions' fields by timeUnit
  const handleFilterNav = useCallback((dir) => {
    const grid = state.grid;
    const activeFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
    const navConditions = (activeFilter?.conditions || []).filter(c => c.isNav && c.fieldId);
    if (!navConditions.length) return;
    const timeUnit = activeFilter?.timeUnit || "day";
    // Use first nav field as the reference for current value
    const refFieldId = navConditions[0].fieldId;
    const currentVal = grid?.activeFilterValues?.[refFieldId];
    const base = currentVal ? new Date(currentVal + "T00:00:00") : new Date();
    if (timeUnit === "week")       base.setDate(base.getDate() + dir * 7);
    else if (timeUnit === "month") base.setMonth(base.getMonth() + dir);
    else if (timeUnit === "year")  base.setFullYear(base.getFullYear() + dir);
    else                           base.setDate(base.getDate() + dir);
    // Local-tz YYYY-MM-DD (toISOString rolls over to UTC day — "next" silently
    // becomes tomorrow anywhere west of UTC after local-evening).
    const next = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    const updatedValues = navConditions.reduce((acc, c) => {
      acc[c.fieldId] = next;
      return acc;
    }, { ...(grid.activeFilterValues || {}) });
    CommitHelpers.updateGrid({
      dispatch, socket,
      gridId: state.gridId,
      grid: { activeFilterValues: updatedValues },
    });
  }, [state.grid, state.gridId, dispatch, socket]);

  // Legacy filterNavState NavigationOp (for occurrences still using the old filters[] system)
  useEffect(() => {
    const prev = prevFilterNavRef.current;
    const curr = state.filterNavState || {};

    const changed = Object.entries(curr).filter(([id, val]) => {
      if (!val || typeof val !== "string") return false;
      if (isNaN(Date.parse(val))) return false;
      return val !== prev[id];
    });

    if (changed.length > 0) {
      const date = changed[0][1];
      operationsBridge.fireOperations?.("NavigationOp", {
        type: "NavigationOp",
        activeFilterValues: curr,
        date,
      });
    }

    prevFilterNavRef.current = curr;
  }, [state.filterNavState]);

  useEffect(() => {
    const unbind = bindSocketToStore(socket, dispatch, stateRef);

    const token = localStorage.getItem("moduli-token");
    if (!token) return () => unbind?.();

    let didRequest = false;
    const request = () => {
      if (didRequest) return;
      didRequest = true;

      const savedGridId = localStorage.getItem("moduli-gridId");
      socket.emit(
        "request_full_state",
        savedGridId ? { gridId: savedGridId } : undefined
      );
    };

    if (socket.connected) request();
    else socket.once("connect", request);

    return () => {
      socket.off("connect", request);
      unbind?.();
    };
  }, [dispatch]);

  // BroadcastChannel: respond to preview iframes requesting state
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("moduli-preview");
    bc.onmessage = (e) => {
      if (e.data?.type === "REQUEST_STATE") {
        const s = stateRef.current;
        bc.postMessage({
          type: "PREVIEW_STATE",
          payload: {
            userId: s.userId, gridId: s.gridId, grid: s.grid,
            modules: s.modules || [],
            occurrences: s.occurrences || [],
            instances: s.instances || [],
            containers: s.containers || [],
            panels: s.panels || [],
            views: s.views || [],
            manifests: s.manifests || [],
            folders: s.folders || [],
            fields: s.fields || [],
            operations: s.operations || [],
            pages: s.pages || [],
            computedValues: s.computedValues || {},
          },
        });
      }
    };
    return () => bc.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGridChange = (e) => {
    const newGridId = e.target.value;
    if (!newGridId || newGridId === state.gridId) return;

    dispatch({ type: ActionTypes.SET_GRID_ID, payload: newGridId });
    localStorage.setItem("moduli-gridId", newGridId);

    socket.emit("request_full_state", { gridId: newGridId });
  };

  const handleCreateNewGrid = () => {
    localStorage.removeItem("moduli-gridId");
    socket.emit("request_full_state");
  };

  // Reset activeCell + zoomedOut when grid changes — restore from localStorage if available
  useEffect(() => {
    if (!state.gridId) return;
    try {
      const saved = JSON.parse(localStorage.getItem("moduli-activeCell-" + state.gridId));
      const rows = state.grid?.rows ?? 1;
      const cols = state.grid?.cols ?? 1;
      if (saved && typeof saved.row === "number" && typeof saved.col === "number") {
        setActiveCell({ row: Math.min(saved.row, rows - 1), col: Math.min(saved.col, cols - 1) });
      } else {
        setActiveCell({ row: 0, col: 0 });
      }
    } catch { setActiveCell({ row: 0, col: 0 }); }
    setZoomedOut(false);
  }, [state.gridId, state.grid?.rows, state.grid?.cols]);

  // Persist activeCell to localStorage when it changes
  // Guard: only save when grid is loaded (prevents overwriting saved position with {0,0} during init)
  useEffect(() => {
    if (!state.gridId || !state.grid) return;
    localStorage.setItem("moduli-activeCell-" + state.gridId, JSON.stringify(activeCell));
  }, [activeCell, state.gridId, state.grid]);


  const addNewPanel = useCallback((kind = "board") => {
    if (!state.gridId || !state.grid || !state.userId) return;

    const moduleId = crypto.randomUUID();
    const { row, col } = findNextOpenPosition(
      state.panels || [],
      state.grid.rows ?? 1,
      state.grid.cols ?? 1
    );

    const panelNumber = (state.panels?.length || 0) + 1;
    const kindLabels = { board: "Board", notebook: "Notebook", doc: "Doc", mixed: "Mixed" };

    // Module with role: "panel"
    const module = {
      id: moduleId,
      role: "panel",
      kind,
      label: `${kindLabels[kind] || "Panel"} ${panelNumber}`,
      occurrences: [],
      layout: {},
    };

    // Use occurrence-based helper: creates module + occurrence + adds to grid
    LayoutHelpers.createPanelInGrid({
      dispatch,
      socket,
      grid: state.grid,
      panel: module,
      placement: { row, col, width: 1, height: 1 },
      userId: state.userId,
      emit: true,
    });
  }, [dispatch, state.gridId, state.grid, state.panels, state.userId]);

  const addContainerToPanel = useCallback(
    (panelId, kind = "list") => {
      if (!panelId || !state.gridId || !state.userId) return;

      const id = crypto.randomUUID();
      const kindLabels = { list: "List", doc: "Doc", log: "Log", smart: "Smart" };
      const label = `${kindLabels[kind] || "List"} ${(state.containers?.length || 0) + 1}`;
      // Module with role: "container"
      const module = { id, role: "container", label, kind, occurrences: [] };

      const panel = (state.panels || []).find((p) => p.id === panelId);
      if (!panel) return;

      // Find the panel occurrence so createContainerInPanel can update ordering
      const panelOcc = Object.values(occurrencesById || {}).find(o => o.targetId === panelId);

      // Use the occurrence-based helper which creates module + occurrence + adds to panel
      LayoutHelpers.createContainerInPanel({
        dispatch,
        socket,
        gridId: state.gridId,
        panel: panelOcc ? { ...panel, _occurrence: panelOcc } : panel,
        container: module,
        userId: state.userId,
        emit: true,
      });
    },
    [dispatch, state.gridId, state.userId, state.containers, state.panels, socket]
  );

  // Use occurrence-based creation with userId
  const addInstanceToContainer = useCallback(
    (containerId) => {
      if (!containerId || !state.gridId || !state.userId) return;

      const id = crypto.randomUUID();
      const label = `Item ${(state.instances?.length || 0) + 1}`;
      // Module with role: "instance"
      const module = { id, role: "instance", kind: "list", label };

      const container = (state.containers || []).find((c) => c.id === containerId);
      if (!container) return;

      // Find the container occurrence so createInstanceInContainer can update ordering
      const containerOcc = Object.values(occurrencesById || {}).find(o => o.targetId === containerId);

      // Use the occurrence-based helper which creates module + occurrence + adds to container
      LayoutHelpers.createInstanceInContainer({
        dispatch,
        socket,
        gridId: state.gridId,
        container,
        containerOccurrence: containerOcc || null,
        instance: module,
        userId: state.userId,
        emit: true,
      });
    },
    [dispatch, state.instances, state.gridId, state.userId, state.containers, socket]
  );


  // Field CRUD handlers (grid-level field management)
  const createField = useCallback((field) => {
    const gridId = state?.gridId || state?.grid?._id;
    if (!gridId || !state.userId) return;
    const fieldWithGrid = { ...field, gridId, userId: state.userId };
    CommitHelpers.createField({ dispatch, socket, field: fieldWithGrid });
  }, [dispatch, socket, state?.gridId, state?.grid?._id, state.userId]);

  const updateField = useCallback((field) => {
    CommitHelpers.updateField({ dispatch, socket, field });
  }, [dispatch, socket]);

  const deleteField = useCallback((fieldId) => {
    CommitHelpers.deleteField({ dispatch, socket, fieldId });
  }, [dispatch, socket]);

  const dataValue = useMemo(
    () => ({
      // Raw state - components use lookups from context (occurrencesById, instancesById, containersById)
      state: {
        userId: state.userId,
        gridId: state.gridId,
        grid: state.grid,
        modules: state.modules || [],
        panels: state.panels || [],
        containers: state.containers || [],
        instances: state.instances || [],
        occurrences: state.occurrences || [],
        fields: state.fields || [],
        activeId: state.activeId,
        activeSize: state.activeSize,
        softTick: state.softTick,
        containersById,
        panelsById: buildLookup(state.panels),
      },
    }),
    [
      state.userId,
      state.gridId,
      state.grid,
      state.modules,
      state.panels,
      state.containers,
      state.instances,
      state.occurrences,
      state.fields,
      state.activeId,
      state.activeSize,
      state.softTick,
      containersById,
    ]
  );

  const panelsById = useMemo(
    () => buildLookup(state.panels),
    [state.panels]
  );

  const pagesById = useMemo(
    () => buildLookup(state.pages),
    [state.pages]
  );

  const actionsValue = useMemo(
    () => ({
      socket,
      dispatch,

      // Full state object for calculations
      state,

      modulesById,
      roleByModuleId,
      instancesById,
      artifactsById,
      textblocksById,
      leafModulesById,
      occurrencesById,
      linkedGroupIndex,
      childrenByParentId,
      containersById,
      fieldsById,
      pagesById,
      panelsById,
      manifestsById,
      viewsById,
      foldersById,
      operationsById,
      addContainerToPanel,
      addInstanceToContainer,
      // Field CRUD
      createField,
      updateField,
      deleteField,
      // Filter nav (ephemeral, per-component)
      filterNavState: state.filterNavState || {},
    }),
    [
      dispatch,
      // Granular state deps — deliberately excludes state.computedValues
      // so that frequent computedValues changes (via GridLiveContext) don't
      // force all GridActionsContext consumers to re-render.
      state.grid, state.occurrences, state.containers, state.instances,
      state.fields, state.modules, state.panels, state.pages,
      state.artifacts, state.textblocks,
      state.userId, state.gridId, state.activeId, state.softTick,
      state.filterNavState,
      modulesById,
      roleByModuleId,
      instancesById,
      artifactsById,
      textblocksById,
      leafModulesById,
      occurrencesById,
      linkedGroupIndex,
      childrenByParentId,
      containersById,
      fieldsById,
      pagesById,
      panelsById,
      manifestsById,
      viewsById,
      foldersById,
      operationsById,
      addContainerToPanel,
      addInstanceToContainer,
      createField,
      updateField,
      deleteField,
    ]
  );

  // C4: Frequently-changing values in separate context — only consumers
  // that need computedValues/undo/mobile state subscribe here
  const liveValue = useMemo(
    () => ({
      computedValues: state.computedValues || {},
      fullStateLoaded: state.fullStateLoaded ?? false,
      canUndo,
      canRedo,
      undo,
      redo,
      isProcessing,
      isMobile,
      activeCell,
      setActiveCell,
      zoomedOut,
      setZoomedOut,
    }),
    [
      state.computedValues,
      state.fullStateLoaded,
      canUndo,
      canRedo,
      undo,
      redo,
      isProcessing,
      isMobile,
      activeCell,
      setActiveCell,
      zoomedOut,
      setZoomedOut,
    ]
  );

  if (!state.userId) return <LoginScreen />;

  return (
    <GridActionsContext.Provider value={actionsValue}>
      <GridLiveContext.Provider value={liveValue}>
      <GridDataContext.Provider value={dataValue}>
        {/* ── Header wrapper — relative so CommandCenter can overlay grid below ── */}
        <div style={{ position: "relative", flexShrink: 0, zIndex: 1050 }}>
        <Toolbar
          gridId={state.gridId}
          availableGrids={state.availableGrids || []}
          onGridChange={handleGridChange}
          onCreateNewGrid={handleCreateNewGrid}
          onAddPanel={addNewPanel}
          grid={state?.grid}
          fieldsById={fieldsById}
          onFilterNav={handleFilterNav}
          onCommandCenter={() => setCommandCenterOpen((prev) => !prev)}
          commandCenterOpen={commandCenterOpen}
          onHistory={() => setHistoryOpen((prev) => !prev)}
          historyOpen={historyOpen}
          userId={state.userId}
          onLogout={() => { socket?.emit("logout"); dispatch(logoutAction()); }}
          isMobile={isMobile}
          activeCell={activeCell}
          setActiveCell={setActiveCell}
          zoomedOut={zoomedOut}
          setZoomedOut={setZoomedOut}
        />

        {/* CommandCenter — keep mounted once opened so slide-up animation works on close */}
        {commandCenterEverOpened && (
          <CommandCenter
            open={commandCenterOpen}
            onOpenChange={setCommandCenterOpen}
            isMobile={isMobile}
          />
        )}
        </div>{/* end header wrapper */}

        {/* Transaction History Dialog */}
        <TransactionHistory
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          gridId={state.gridId}
        />

        <div data-testid="app-root" className={`app-root grid-frame bg-background2 shadow-inner ${isMobile ? 'p-0 border-0 rounded-none ring-0' : 'p-3 ring-1 ring-black/40 rounded-xl border border-border'}`}
          onTouchStart={(ev) => {
            if (!commandCenterOpen) return;
            const startY = ev.touches[0].clientY;
            const onMove = (e) => {
              const dy = e.touches[0].clientY - startY;
              if (dy < -15) { setCommandCenterOpen(false); done(); }
            };
            const done = () => {
              window.removeEventListener("touchmove", onMove);
              window.removeEventListener("touchend", done);
            };
            window.addEventListener("touchmove", onMove, { passive: true });
            window.addEventListener("touchend", done, { passive: true });
          }}>
          {state.grid?._id ? (
            <Grid />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Spinner size="xl" />
            </div>
          )}
        </div>

        {/* Toast notifications */}
        <Toaster position="bottom-right" />
      </GridDataContext.Provider>
      </GridLiveContext.Provider>
    </GridActionsContext.Provider>
  );
}