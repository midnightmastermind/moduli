// client/src/state/bindSocketToStore.js
// =========================================
// bindSocketToStore.js — CLEAN + CONSISTENT
// ✅ UPDATED for no-echo rooms:
// - Other windows must self-heal if their active grid is deleted.
// =========================================

import { ActionTypes } from "./actions";
import { runMatchingOperations, executeOperation } from "../helpers/operationExecutor";
import { setComputedValuesAction, createModuleAction, updateModuleAction, deleteModuleAction } from "./actions";
import { toast } from "sonner";
import {
  setOccurrenceFieldValue,
  moveOccurrence,
  createOccurrenceInContainer,
  createInstanceInContainer,
  deleteOccurrence,
  updateModule,
  deleteModule,
  updateOccurrence,
} from "../helpers/CommitHelpers";
import { flushOfflineQueue } from "../helpers/offlineQueue";

/**
 * Module-level bridge so CommitHelpers can fire operations immediately
 * after optimistic dispatch (no server round-trip needed).
 */
export const operationsBridge = { fireOperations: null };

/**
 * @param {Object} socket
 * @param {Function} dispatch
 * @param {React.MutableRefObject} stateRef — ref to current state (keeps executor up-to-date)
 */
export function bindSocketToStore(socket, dispatch, stateRef = { current: {} }) {
  // Wrap dispatch to tag all socket-originated actions
  // This prevents BroadcastChannel from re-broadcasting server events
  const socketDispatch = (action) => dispatch({ ...action, _fromSocket: true });

  // Local occurrence cache — updated synchronously on each occurrence event,
  // BEFORE React re-renders stateRef.current. Used by fireOperations so that
  // onChange operations always see the latest occurrence values even when the
  // React render cycle hasn't completed yet.
  const localOccsById = {};

  // ======================================================
  // FULL STATE HYDRATE
  // ======================================================
  function onFullState(payload = {}) {
    console.log("[socket] full_state received:", payload);

    // persist selection
    if (payload.gridId) {
      localStorage.setItem("moduli-gridId", payload.gridId);
    }

    socketDispatch({ type: ActionTypes.FULL_STATE, payload });

    // Fire onLoad/onNavigation operations after hydration (via microtask so state is updated first)
    const operations = payload.operations || [];
    const fieldsById = {};
    for (const f of payload.fields || []) fieldsById[f.id] = f;
    const operationsById = {};
    for (const o of operations) operationsById[o.id] = o;
    // Build occurrencesById from the payload array for the pipeline executor
    // Also repopulate localOccsById so subsequent fireOperations have fresh data
    for (const key in localOccsById) delete localOccsById[key];
    const occurrencesById = {};
    for (const o of payload.occurrences || []) {
      const id = o.id || o._id?.toString?.();
      if (id) {
        occurrencesById[id] = { ...o, id };
        localOccsById[id] = { ...o, id };
      }
    }
    const hydratedState = { ...stateRef.current, ...payload, occurrencesById, operations, fields: payload.fields || [] };

    // Defer operation execution until after the first paint so the grid renders immediately.
    // requestAnimationFrame fires before next paint, the nested rAF fires AFTER paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const allUpdates = runMatchingOperations(operations, null, null, { state: hydratedState, fieldsById, operationsById, occurrencesById }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });
      const displayUpdates = allUpdates.filter(u => !u._effect);
      const effects = allUpdates.filter(u => u._effect);
      if (displayUpdates.length > 0) {
        dispatch(setComputedValuesAction(displayUpdates));
      }
      for (const eff of effects) {
        applyOperationEffect(eff, hydratedState);
      }
      // Flush any mutations queued while offline — replayed on top of fresh server state
      flushOfflineQueue(socket);
    }));
  }

  socket.on("full_state", onFullState);

  // Undo/redo: server emits sync_state after applying — re-request full state to sync client
  const onSyncState = () => {
    socket.emit("request_full_state");
  };
  socket.on("sync_state", onSyncState);

  // ======================================================
  // MODULES (unified CRUD — replaces container/instance/panel handlers)
  // ======================================================
  function onModuleCreated({ module: mod } = {}) {
    if (!mod?.id) return;
    socketDispatch(createModuleAction(mod));
  }

  function onModuleUpdated({ module: mod } = {}) {
    if (!mod?.id) return;
    socketDispatch(updateModuleAction(mod));

    // Fire onModuleUpdate trigger
    fireOperations("ModuleOp", {
      type: "ModuleOp",
      moduleId: mod.id,
      moduleRole: mod.role,
      label: mod.label,
      kind: mod.kind,
    });
  }

  function onModuleDeleted({ moduleId } = {}) {
    if (!moduleId) return;
    socketDispatch(deleteModuleAction(moduleId));
  }

  socket.on("module_created", onModuleCreated);
  socket.on("module_updated", onModuleUpdated);
  socket.on("module_deleted", onModuleDeleted);

  // ======================================================
  // OCCURRENCES (CRUD)
  // ======================================================
  function onOccurrenceCreated({ occurrence } = {}) {
    if (!occurrence?.id) return;

    // Keep local cache current before React re-renders stateRef
    localOccsById[occurrence.id] = occurrence;

    socketDispatch({
      type: ActionTypes.CREATE_OCCURRENCE,
      payload: { occurrence },
    });

    // Fire onCreate trigger with context from the new occurrence
    // Resolve container + panel labels so operations can use $trigger.containerLabel / panelLabel
    const _stateNow = stateRef.current || {};
    const _occById = { ...Object.fromEntries((_stateNow.occurrences||[]).map(o=>[o.id,o])), ...localOccsById };
    const _modsArr = _stateNow.modules || [];
    const _containerOcc = occurrence.parentId ? _occById[occurrence.parentId] : null;
    const _containerMod = _containerOcc ? _modsArr.find(m => m.id === _containerOcc.targetId) : null;
    const _panelOcc = _containerOcc?.parentId ? _occById[_containerOcc.parentId] : null;
    const _panelMod = _panelOcc ? _modsArr.find(m => m.id === _panelOcc.targetId) : null;
    fireOperations("OccurrenceCreateOp", {
      type: "OccurrenceCreateOp",
      occurrenceId: occurrence.id,
      instanceId: occurrence.targetId,
      containerId: occurrence.parentId,
      panelId: _panelOcc?.targetId || occurrence.panelId,
      containerLabel: _containerMod?.label || "",
      panelLabel: _panelMod?.label || "",
    });
  }

  function onOccurrenceUpdated({ occurrence } = {}) {
    if (!occurrence?.id) return;

    // Check if field values changed (triggers optimistic operation execution)
    const prevOcc = localOccsById[occurrence.id];
    const fieldsChanged = occurrence.fields && (!prevOcc || JSON.stringify(prevOcc.fields) !== JSON.stringify(occurrence.fields));

    // Keep local cache current before React re-renders stateRef
    localOccsById[occurrence.id] = occurrence;

    socketDispatch({
      type: ActionTypes.UPDATE_OCCURRENCE,
      payload: { occurrence },
    });

    // Fire operations on field change — skip if already fired optimistically by CommitHelpers
    if (fieldsChanged && !optimisticFiredSet.has(occurrence.id)) {
      fireOperations("MeasureOp", {
        type: "MeasureOp",
        occurrenceId: occurrence.id,
        instanceId: occurrence.targetId,
      });
    }
    // Clear the optimistic flag either way (server echo received)
    optimisticFiredSet.delete(occurrence.id);
  }

  function onOccurrenceDeleted(payload = {}) {
    const occurrenceId = payload.occurrenceId || payload.id;
    if (!occurrenceId) return;

    // Remove from local cache immediately
    delete localOccsById[occurrenceId];

    socketDispatch({
      type: ActionTypes.DELETE_OCCURRENCE,
      payload: { occurrenceId },
    });

    // Fire onDelete trigger
    fireOperations("OccurrenceDeleteOp", {
      type: "OccurrenceDeleteOp",
      occurrenceId,
      instanceId: payload.instanceId,
      containerId: payload.containerId,
    });
  }

  socket.on("occurrence_created", onOccurrenceCreated);
  socket.on("occurrence_updated", onOccurrenceUpdated);
  socket.on("occurrence_deleted", onOccurrenceDeleted);

  // ======================================================
  // FIELDS (CRUD)
  // ======================================================
  function onFieldCreated({ field } = {}) {
    if (!field?.id) return;

    socketDispatch({
      type: ActionTypes.CREATE_FIELD,
      payload: { field },
    });
  }

  function onFieldUpdated({ field } = {}) {
    if (!field?.id) return;

    socketDispatch({
      type: ActionTypes.UPDATE_FIELD,
      payload: { field },
    });
  }

  function onFieldDeleted(payload = {}) {
    const fieldId = payload.fieldId || payload.id;
    if (!fieldId) return;

    socketDispatch({
      type: ActionTypes.DELETE_FIELD,
      payload: { fieldId },
    });
  }

  socket.on("field_created", onFieldCreated);
  socket.on("field_updated", onFieldUpdated);
  socket.on("field_deleted", onFieldDeleted);

  // panel_created/updated/deleted are now handled via module_created/updated/deleted

  // ======================================================
  // GRIDS (CRUD)
  // ======================================================
  function onGridUpdated(payload = {}) {
    const gridId = payload.gridId || payload.id;
    const patch = payload.grid || payload;

    if (!gridId) return;

    socketDispatch({
      type: ActionTypes.UPDATE_GRID,
      payload: { gridId, grid: patch },
    });

    // Fire NavigationOp operations when active filter values change (date navigation)
    if (patch.activeFilterValues !== undefined) {
      // Extract a representative date from the new filter values for $trigger.date
      const filterDate = Object.values(patch.activeFilterValues || {}).find(v => {
        if (!v || typeof v !== "string") return false;
        const d = new Date(v);
        return !isNaN(d);
      });
      fireOperations("NavigationOp", { type: "NavigationOp", activeFilterValues: patch.activeFilterValues, date: filterDate || null });
    }
  }

  // ✅ UPDATED: self-heal other windows when their active grid is deleted
  function onGridDeleted(payload = {}) {
    const gridId = payload.gridId || payload.id;
    if (!gridId) return;

    socketDispatch({
      type: ActionTypes.DELETE_GRID,
      payload: { gridId },
    });

    const saved = localStorage.getItem("moduli-gridId");
    if (saved && saved === gridId) {
      localStorage.removeItem("moduli-gridId");
      // ✅ in no-echo mode, other windows must re-hydrate themselves
      socket.emit("request_full_state");
    }
  }

  function onGridCreated(payload = {}) {
    const grid = payload.grid || payload;
    socketDispatch({
      type: ActionTypes.CREATE_GRID,
      payload: { grid },
    });
  }

  socket.on("grid_updated", onGridUpdated);
  socket.on("grid_deleted", onGridDeleted);
  socket.on("grid_created", onGridCreated);

  // ======================================================
  // AUTH
  // ======================================================
  function onAuthSuccess({ token, userId } = {}) {
    console.log("[socket] auth_success", { userId });

    if (token) localStorage.setItem("moduli-token", token);
    if (userId) localStorage.setItem("moduli-userId", userId);

    socketDispatch({
      type: ActionTypes.SET_USER_ID,
      payload: { userId },
    });

    try {
      socket.disconnect();
    } catch {}

    socket.auth = { token };
    socket.connect();

    socket.once("connect", () => {
      const savedGridId = localStorage.getItem("moduli-gridId");
      socket.emit(
        "request_full_state",
        savedGridId ? { gridId: savedGridId } : undefined
      );
    });
  }

  function onAuthError(msg) {
    console.log("[socket] auth_error:", msg);
    localStorage.removeItem("moduli-token");
    localStorage.removeItem("moduli-userId");
    localStorage.removeItem("moduli-gridId");
    socketDispatch({ type: ActionTypes.LOGOUT });
  }

  function onConnectError(err) {
    const msg = err?.message;
    console.log("[socket] connect_error:", msg);

    if (msg === "INVALID_TOKEN" || msg === "USER_NOT_FOUND") {
      localStorage.removeItem("moduli-token");
      localStorage.removeItem("moduli-userId");
      localStorage.removeItem("moduli-gridId");

      socketDispatch({ type: ActionTypes.LOGOUT });

      try {
        socket.disconnect();
      } catch {}

      socket.auth = {};
      socket.connect();
    }
  }

  socket.on("auth_success", onAuthSuccess);
  socket.on("auth_error", onAuthError);
  socket.on("connect_error", onConnectError);

  // ======================================================
  // GENERIC CRUD — Manifests, Views, Folders, Operations
  // ======================================================
  const genericModels = [
    { name: "manifest", createType: ActionTypes.CREATE_MANIFEST, updateType: ActionTypes.UPDATE_MANIFEST, deleteType: ActionTypes.DELETE_MANIFEST },
    { name: "view", createType: ActionTypes.CREATE_VIEW, updateType: ActionTypes.UPDATE_VIEW, deleteType: ActionTypes.DELETE_VIEW },
    { name: "folder", createType: ActionTypes.CREATE_FOLDER, updateType: ActionTypes.UPDATE_FOLDER, deleteType: ActionTypes.DELETE_FOLDER },
    { name: "operation", createType: ActionTypes.CREATE_OPERATION, updateType: ActionTypes.UPDATE_OPERATION, deleteType: ActionTypes.DELETE_OPERATION },
  ];

  const genericHandlers = [];

  for (const { name, createType, updateType, deleteType } of genericModels) {
    const onCreated = (payload = {}) => {
      const entity = payload[name];
      if (!entity?.id) return;
      socketDispatch({ type: createType, payload: { [name]: entity } });
    };
    const onUpdated = (payload = {}) => {
      const entity = payload[name];
      if (!entity?.id) return;
      socketDispatch({ type: updateType, payload: { [name]: entity } });
    };
    const onDeleted = (payload = {}) => {
      const entityId = payload[`${name}Id`] || payload.id;
      if (!entityId) return;
      socketDispatch({ type: deleteType, payload: { [`${name}Id`]: entityId } });
    };

    socket.on(`${name}_created`, onCreated);
    socket.on(`${name}_updated`, onUpdated);
    socket.on(`${name}_deleted`, onDeleted);

    genericHandlers.push({ name, onCreated, onUpdated, onDeleted });
  }

  // ======================================================
  // OPERATION EXECUTOR — fires on transactions + full_state load
  // ======================================================

  /**
   * Apply a single operation effect: optimistic dispatch + socket emit.
   * Effects are returned by executePipeline for real CRUD operations
   * (not just display-value updates).
   */
  function applyOperationEffect(effect, state) {
    if (!effect?._effect) return;

    switch (effect._effect) {
      case "SET_FIELD_VALUE":
        setOccurrenceFieldValue({
          dispatch: socketDispatch,
          socket,
          occurrencesById: state.occurrencesById,
          occurrences: state.occurrences,
          occurrenceId: effect.occurrenceId,
          fieldId: effect.fieldId,
          value: effect.value,
          flow: effect.flow,
        });
        break;

      case "MOVE_OCCURRENCE":
        moveOccurrence({ socket, occurrenceId: effect.occurrenceId, toContainerId: effect.toContainerId });
        break;

      case "REMOVE_OCCURRENCE":
        deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: effect.occurrenceId });
        break;

      case "CREATE_OCCURRENCE":
        createOccurrenceInContainer({ socket, instanceId: effect.instanceId, containerId: effect.containerId, fields: effect.fields });
        break;

      case "UPDATE_MODULE": {
        const mod = (state.modules || []).find(m => m.id === effect.moduleId);
        if (!mod) break;
        const patch = effect.patch || {};
        const merged = { ...mod, ...patch };
        // Deep-merge nested style objects so UPDATE_STYLE patches one key without wiping others
        if (patch.ownStyle) merged.ownStyle = { ...(mod.ownStyle || {}), ...patch.ownStyle };
        if (patch.behavior) merged.behavior = { ...(mod.behavior || {}), ...patch.behavior };
        updateModule({ dispatch: socketDispatch, socket, module: merged });
        break;
      }

      case "DELETE_MODULE":
        deleteModule({ dispatch: socketDispatch, socket, moduleId: effect.moduleId });
        break;

      case "UPDATE_OCCURRENCE":
        // Used by APPEND_TO_DOC, SET_TEXTMAP — updates occurrence directly
        if (effect.occurrence?.id) {
          updateOccurrence({ dispatch: socketDispatch, socket, occurrence: effect.occurrence });
        }
        break;

      case "APPLY_TEMPLATE":
        // Delegates to server fill_from_template handler
        socket?.emit("fill_from_template", {
          gridId: state.grid?._id || state.gridId,
          templateId: effect.templateId,
          containerId: effect.containerId,
          iterationValue: effect.iterationValue,
        });
        break;

      case "CREATE_FOLDER":
        socket?.emit("create_folder", {
          folder: {
            id: effect.folderId,
            name: effect.name,
            parentId: effect.parentId || null,
            folderType: effect.folderType || "normal",
            sortOrder: 0,
            isExpanded: true,
          },
          gridId: state.grid?._id || state.gridId,
        });
        break;

      case "CREATE_MODULE": {
        // Creates a module + its occurrence in one shot via generic CRUD handlers.
        const gridId = state.grid?._id || state.gridId;
        const userId = state.userId;
        if (gridId && userId) {
          socket?.emit("create_module", {
            module: {
              id: effect.moduleId,
              role: effect.role || "container",
              kind: effect.kind || "doc",
              label: effect.name,
              name: effect.name,
              userId,
              gridId,
              fieldBindings: [],
            },
          });
          socket?.emit("create_occurrence", {
            occurrence: {
              id: effect.occurrenceId,
              targetType: "module",
              targetId: effect.moduleId,
              gridId,
              parentId: effect.parentId || null,
              viewId: effect.viewId || null,
              fields: {},
              meta: { createdByOperation: true },
              textmap: effect.kind === "doc" ? { type: "doc", content: [] } : null,
              occurrences: [],
            },
          });
        }
        break;
      }

      case "UPDATE_VIEW":
        socket?.emit("update_view", { view: { id: effect.viewId, ...effect.patch } });
        break;

      case "CREATE_OCCURRENCE_AT":
        // PREPEND_OCCURRENCE variant — position 0
        socket?.emit("create_occurrence_in_container", {
          instanceId: effect.instanceId,
          containerId: effect.containerId,
          position: effect.position ?? 0,
          fields: effect.fields || {},
        });
        break;

      case "ADD_TO_POOL": {
        // Create a new instance module + place in pool container
        const instanceId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
        const gridId = state.grid?._id || state.gridId;
        const userId = state.userId;
        if (gridId && userId) {
          createInstanceInContainer({
            dispatch: socketDispatch,
            socket,
            containerId: effect.poolId,
            instance: { id: instanceId, role: "instance", kind: "list", label: effect.label || "New Item", userId, gridId, fieldBindings: [] },
            emit: true,
          });
        }
        break;
      }

      case "REMOVE_FROM_POOL": {
        // Find the canonical pool occurrence: targetId === moduleId, inside the pool container's occurrences list
        const { moduleId, poolId } = effect;
        const poolContainerOcc = Object.values(localOccsById).find(
          o => o.targetId === poolId
        ) || Object.values(state.occurrencesById || {}).find(
          o => o.targetId === poolId
        );
        const childOccIds = poolContainerOcc?.occurrences || [];
        const poolOcc = childOccIds
          .map(id => localOccsById[id] || state.occurrencesById?.[id])
          .find(o => o && o.targetId === moduleId);
        if (poolOcc) {
          deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: poolOcc.id });
        }
        break;
      }

      case "HIDE_OCCURRENCE":
        socket?.emit("update_occurrence_hidden", { occurrenceId: effect.occurrenceId, hidden: true });
        break;

      case "SHOW_OCCURRENCE":
        socket?.emit("update_occurrence_hidden", { occurrenceId: effect.occurrenceId, hidden: false });
        break;

      default:
        break;
    }
  }

  // Memoized maps — rebuilt only when the source arrays change (by reference)
  let _cachedFieldsById = null, _lastFields = null;
  let _cachedOperationsById = null, _lastOperations = null;
  let _cachedBaseOccsById = null, _lastOccurrences = null;

  function fireOperations(transactionType, transaction) {
    const state = stateRef.current || {};
    const operations = state.operations || [];
    const fields = state.fields || [];
    const occurrences = state.occurrences || [];

    // Rebuild fieldsById only when fields array changes
    if (fields !== _lastFields) {
      _cachedFieldsById = {};
      for (const f of fields) _cachedFieldsById[f.id] = f;
      _lastFields = fields;
    }
    // Rebuild operationsById only when operations array changes
    if (operations !== _lastOperations) {
      _cachedOperationsById = {};
      for (const o of operations) _cachedOperationsById[o.id] = o;
      _lastOperations = operations;
    }
    // Rebuild base occurrencesById only when occurrences array changes
    if (occurrences !== _lastOccurrences) {
      _cachedBaseOccsById = {};
      for (const o of occurrences) {
        const id = o.id || o._id?.toString?.();
        if (id) _cachedBaseOccsById[id] = o;
      }
      _lastOccurrences = occurrences;
    }
    // Overlay localOccsById on top of cached base (localOccsById is always fresh)
    const occurrencesById = Object.assign({}, _cachedBaseOccsById, localOccsById);

    const allUpdates = runMatchingOperations(operations, transactionType, transaction, { state, fieldsById: _cachedFieldsById, operationsById: _cachedOperationsById, occurrencesById }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });

    // Separate display updates (computedValues) from real CRUD effects
    const displayUpdates = allUpdates.filter(u => !u._effect);
    const effects = allUpdates.filter(u => u._effect);

    if (displayUpdates.length > 0) {
      dispatch(setComputedValuesAction(displayUpdates));
    }
    for (const eff of effects) {
      applyOperationEffect(eff, state);
    }

  }

  // Track optimistically-fired occurrences to prevent double-firing on server echo
  const optimisticFiredSet = new Set();

  function fireOperationsOptimistic(transactionType, transaction) {
    // Mark as optimistically fired so onOccurrenceUpdated skips the duplicate
    if (transaction.occurrenceId) {
      optimisticFiredSet.add(transaction.occurrenceId);
      // Clear after 5s (server echo should arrive well before this)
      setTimeout(() => optimisticFiredSet.delete(transaction.occurrenceId), 5000);
    }
    fireOperations(transactionType, transaction);
  }

  // Expose on module-level bridge so CommitHelpers can call optimistically
  operationsBridge.fireOperations = fireOperationsOptimistic;
  operationsBridge.updateLocalOcc = (occ) => { if (occ?.id) localOccsById[occ.id] = occ; };

  // On transaction_created: fire operations + toast notification
  function onTransactionCreated({ transaction } = {}) {
    if (!transaction) return;
    fireOperations(transaction.type, transaction);

    // Toast per transaction
    const state = stateRef.current || {};
    const fieldsById = {};
    for (const f of state.fields || []) fieldsById[f.id] = f;
    const modulesById = {};
    for (const m of state.modules || []) modulesById[m.id] = m;
    const occurrencesById = { ...state.occurrencesById, ...localOccsById };

    const ops = transaction.operations || [];
    if (transaction.type === "MeasureOp" && ops.length > 0) {
      const op = ops[0];
      const field = fieldsById[op?.measure?.fieldId];
      const fieldName = field?.name || "Field";
      const prev = op?.measure?.previousValue;
      const next = op?.measure?.value;
      const desc = prev != null ? `${prev} → ${next}` : String(next ?? "");
      toast(fieldName, { description: desc, duration: 2500 });
    } else if (transaction.type === "OccurrenceListOp" && ops.length > 0) {
      const op = ops[0];
      const instanceId = op?.occurrence_list?.instanceId;
      const mod = modulesById[instanceId];
      if (mod?.label) toast("Moved", { description: mod.label, duration: 2000 });
    } else if (transaction.type === "EntityOp" && ops.length > 0) {
      const op = ops[0];
      const label = op?.entity?.label || op?.entity?.name || "";
      toast("Updated", { description: label || "entity", duration: 2000 });
    } else if (transaction.type === "DocEditOp") {
      toast("Doc edited", { duration: 1500 });
    }
  }
  socket.on("transaction_created", onTransactionCreated);

  // On trigger_operation: external webhook fired a specific operation
  function onTriggerOperation({ operationId, transactionType, transaction } = {}) {
    if (!operationId) return;
    const state = stateRef.current || {};
    const op = (state.operations || []).find(o => o.id === operationId);
    if (!op) return;
    const fieldsById = {};
    for (const f of state.fields || []) fieldsById[f.id] = f;
    const updates = executeOperation(op, transactionType || "WebhookOp", transaction || {}, { state, fieldsById });
    if (updates.length > 0) dispatch(setComputedValuesAction(updates));
  }
  socket.on("trigger_operation", onTriggerOperation);

  // ======================================================
  // SERVER ERRORS / MISC
  // ======================================================
  function onServerError(msg) {
    console.warn("[socket] server_error:", msg);

    if (typeof msg === "string" && msg.toLowerCase().includes("grid not found")) {
      localStorage.removeItem("moduli-gridId");
      socket.emit("request_full_state");
    } else {
      toast.error(typeof msg === "string" ? msg : "Server error", { duration: 4000 });
    }
  }
  socket.on("server_error", onServerError);

  // ======================================================
  // SCHEDULE INTERVAL — fires "ScheduleOp" every minute
  // ======================================================
  const scheduleInterval = setInterval(() => {
    fireOperations("ScheduleOp", { timestamp: new Date().toISOString() });
  }, 60000);

  // ======================================================
  // CLEANUP (important with HMR)
  // ======================================================
  return () => {
    operationsBridge.fireOperations = null;
    operationsBridge.updateLocalOcc = null;
    clearInterval(scheduleInterval);
    socket.off("full_state", onFullState);
    socket.off("sync_state", onSyncState);

    socket.off("module_created", onModuleCreated);
    socket.off("module_updated", onModuleUpdated);
    socket.off("module_deleted", onModuleDeleted);

    socket.off("occurrence_created", onOccurrenceCreated);
    socket.off("occurrence_updated", onOccurrenceUpdated);
    socket.off("occurrence_deleted", onOccurrenceDeleted);

    socket.off("field_created", onFieldCreated);
    socket.off("field_updated", onFieldUpdated);
    socket.off("field_deleted", onFieldDeleted);

    socket.off("grid_updated", onGridUpdated);
    socket.off("grid_deleted", onGridDeleted);
    socket.off("grid_created", onGridCreated);

    socket.off("auth_success", onAuthSuccess);
    socket.off("auth_error", onAuthError);
    socket.off("connect_error", onConnectError);

    socket.off("server_error", onServerError);
    socket.off("transaction_created", onTransactionCreated);
    socket.off("trigger_operation", onTriggerOperation);

    for (const { name, onCreated, onUpdated, onDeleted } of genericHandlers) {
      socket.off(`${name}_created`, onCreated);
      socket.off(`${name}_updated`, onUpdated);
      socket.off(`${name}_deleted`, onDeleted);
    }
  };
}