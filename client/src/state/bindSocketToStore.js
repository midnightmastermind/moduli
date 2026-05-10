// client/src/state/bindSocketToStore.js
// =========================================
// bindSocketToStore.js — CLEAN + CONSISTENT
// ✅ UPDATED for no-echo rooms:
// - Other windows must self-heal if their active grid is deleted.
// =========================================

import { ActionTypes } from "./actions";
import { runMatchingOperations, executeOperation } from "../helpers/operationExecutor";
import { setComputedValuesAction, createModuleAction, updateModuleAction, deleteModuleAction, createOccurrenceAction, updateOccurrenceAction, initFilterNavAction, setFilterNavAction } from "./actions";
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
import { flushOfflineQueue, safeEmit } from "../helpers/offlineQueue";
import { buildReverseMap, findGridPanelOcc } from "../helpers/occurrenceHelpers";
import { aliasOccurrence } from "../helpers/dragHitTesting";

/**
 * Module-level bridge so CommitHelpers can fire operations immediately
 * after optimistic dispatch (no server round-trip needed).
 */
export const operationsBridge = { fireOperations: null, updateLocalOcc: null, removeLocalOcc: null, getLocalOcc: null };

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

    // Initialize ephemeral filter nav values from each occurrence's filter defaultNavValue.
    // All date strings are LOCAL-tz YYYY-MM-DD. `toISOString().slice(0,10)` returns the
    // UTC day, which rolls over after local-evening anywhere west of UTC and silently
    // resolves "today" → tomorrow (or yesterday) — the bug this app keeps hitting.
    const navMap = {};
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const localDay = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const resolveDefault = (defaultNavValue) => {
      if (!defaultNavValue || defaultNavValue === "today") return localDay(now);
      if (defaultNavValue === "startOfWeek") {
        const d = new Date(now);
        const dow = d.getDay();
        d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
        return localDay(d);
      }
      if (defaultNavValue === "startOfMonth") {
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      }
      return defaultNavValue;
    };
    for (const occ of payload.occurrences || []) {
      for (const f of (occ.filters || [])) {
        if (f.id && f.showNav) navMap[f.id] = resolveDefault(f.defaultNavValue);
      }
    }
    dispatch(initFilterNavAction(navMap));

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
    const modulesById = {};
    for (const m of payload.modules || []) { if (m?.id) modulesById[m.id] = m; }
    for (const o of payload.occurrences || []) {
      const id = o.id || o._id?.toString?.();
      if (id) {
        const aliased = aliasOccurrence({ ...o, id });
        occurrencesById[id] = aliased;
        localOccsById[id] = aliased;
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

  // Priority state — renders the visible grid immediately with the viewport slice.
  // No operations fired here; full_state (arriving right after) handles that.
  function onPriorityState(payload = {}) {
    if (payload.gridId) localStorage.setItem("moduli-gridId", payload.gridId);
    // Seed localOccsById so any interim fireOperations calls see the viewport data
    for (const o of payload.occurrences || []) {
      const id = o.id || o._id?.toString?.();
      if (id) localOccsById[id] = { ...o, id };
    }
    socketDispatch({ type: ActionTypes.PRIORITY_STATE, payload });
    // Operations intentionally skipped — full_state fires them with the complete dataset
  }
  socket.on("priority_state", onPriorityState);

  // Lazy textmap loading — server responds to request_textmap with textmaps_loaded
  function onTextmapsLoaded(updates = []) {
    for (const { id, textmap } of updates) {
      if (!id || !textmap) continue;
      if (localOccsById[id]) localOccsById[id] = { ...localOccsById[id], textmap };
      socketDispatch({ type: ActionTypes.UPDATE_OCCURRENCE, payload: { occurrence: { id, textmap } } });
    }
  }
  socket.on("textmaps_loaded", onTextmapsLoaded);

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
    occurrence = aliasOccurrence(occurrence);

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
    const _revMap = buildReverseMap(Object.values(_occById));
    const _gridOccSet = new Set(_stateNow.grid?.occurrences || []);
    const _panelOcc = findGridPanelOcc(_containerOcc, _revMap, _occById, _gridOccSet);
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
    occurrence = aliasOccurrence(occurrence);

    const prevOcc = localOccsById[occurrence.id];

    // Keep local cache current before React re-renders stateRef
    localOccsById[occurrence.id] = occurrence;

    socketDispatch({
      type: ActionTypes.UPDATE_OCCURRENCE,
      payload: { occurrence },
    });

    // Fire operations on field change — skip if already fired optimistically by CommitHelpers
    if (!optimisticFiredSet.has(occurrence.id)) {
      const prevFields = prevOcc?.fields || {};
      const changedFieldIds = Object.keys(occurrence.fields || {}).filter(
        fid => JSON.stringify(occurrence.fields[fid]) !== JSON.stringify(prevFields[fid])
      );
      for (const fieldId of changedFieldIds) {
        fireOperations("MeasureOp", {
          type: "MeasureOp",
          occurrenceId: occurrence.id,
          instanceId: occurrence.targetId,
          fieldId,
          value: occurrence.fields[fieldId]?.value,
        });
      }
    }
    // Clear the optimistic flag either way (server echo received)
    optimisticFiredSet.delete(occurrence.id);
  }

  function onOccurrenceDeleted(payload = {}) {
    const occurrenceId = payload.occurrenceId || payload.id;
    if (!occurrenceId) return;

    // Save field data BEFORE removing from cache (needed for MeasureOp below)
    const removedOcc = localOccsById[occurrenceId];

    // Remove from local cache immediately
    delete localOccsById[occurrenceId];

    socketDispatch({
      type: ActionTypes.DELETE_OCCURRENCE,
      payload: { occurrenceId },
    });

    // The occurrence is gone from localOccsById at this point, so the executor
    // can no longer enrich $trigger.occurrence from state. Pass the snapshot
    // as an override so onRemove / onDelete operations still see the full data.
    const override = removedOcc ? { [occurrenceId]: removedOcc } : null;

    // Fire onDelete trigger
    fireOperations("OccurrenceDeleteOp", {
      type: "OccurrenceDeleteOp",
      occurrenceId,
      instanceId: payload.instanceId,
      containerId: payload.containerId,
    }, { occurrencesOverride: override });

    // Re-run onChange operations for each field that was set on the deleted occurrence.
    // This ensures aggregation operations (e.g. water total) recalculate after removal.
    if (removedOcc?.fields) {
      for (const fieldId of Object.keys(removedOcc.fields)) {
        fireOperations("MeasureOp", {
          type: "MeasureOp",
          occurrenceId,
          instanceId: removedOcc.targetId,
          fieldId,
        }, { occurrencesOverride: override });
      }
    }
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
      // ======================================================
      // Unified UPDATE-verb effects (routed by applyUpdate.js)
      // ======================================================

      case "UPDATE_ITEM_FIELD": {
        // subKind: "value" (fires MeasureOp → onChange triggers) or "flow" (no trigger)
        // Overlays localOccsById on the frozen pass-state so writes can find items
        // that were CREATEd earlier in the same pipeline tick.
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        if (effect.subKind === "flow") {
          const occ = occOverlay[effect.itemId];
          if (!occ) break;
          const existing = occ.fields?.[effect.fieldId];
          const fields = {
            ...occ.fields,
            [effect.fieldId]: {
              value: existing?.value !== undefined ? existing.value : existing,
              flow: effect.value,
            },
          };
          updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, fields } });
        } else {
          setOccurrenceFieldValue({
            dispatch: socketDispatch,
            socket,
            occurrencesById: occOverlay,
            occurrences: state.occurrences,
            occurrenceId: effect.itemId,
            fieldId: effect.fieldId,
            value: effect.value,
            flow: "replace",
          });
        }
        break;
      }

      case "MOVE_OCCURRENCE":
        moveOccurrence({ socket, occurrenceId: effect.occurrenceId, toContainerId: effect.toContainerId });
        break;

      case "UPDATE_ITEM_PARENT": {
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        if (!occ) break;
        const fromParentId = occ.parentId;

        if (fromParentId && fromParentId !== effect.toParentId) {
          const fromParent = occOverlay[fromParentId];
          if (fromParent) {
            updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
              id: fromParentId,
              occurrences: (fromParent.occurrences || []).filter(x => x !== effect.itemId),
            }});
          }
        }

        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
          id: effect.itemId,
          parentId: effect.toParentId,
        }});

        const toParent = occOverlay[effect.toParentId];
        if (toParent && !(toParent.occurrences || []).includes(effect.itemId)) {
          updateOccurrence({ dispatch: socketDispatch, socket, occurrence: {
            id: effect.toParentId,
            occurrences: [...(toParent.occurrences || []), effect.itemId],
          }});
        }
        break;
      }

      case "UPDATE_ITEM_META": {
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        if (!occ) break;
        const merged = { ...(occ.meta || {}), ...(effect.metaPatch || {}) };
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, meta: merged } });
        break;
      }

      case "UPDATE_ITEM_TEXTMAP": {
        if (!effect.itemId) break;
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, textmap: effect.textmap } });
        break;
      }

      case "UPDATE_DISPLAY_VALUE": {
        if (!effect.fieldId) break;
        socketDispatch(setComputedValuesAction([
          { fieldId: effect.fieldId, occurrenceId: effect.itemId || null, value: effect.value },
        ]));
        break;
      }

      case "DELETE_ITEM":
        if (effect.itemId) deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: effect.itemId });
        break;

      case "REMOVE_OCCURRENCE":
        deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: effect.occurrenceId });
        break;

      case "CREATE_OCCURRENCE":
        createOccurrenceInContainer({ socket, instanceId: effect.instanceId, containerId: effect.containerId, fields: effect.fields });
        break;

      case "CREATE_ITEM": {
        // Mints a new instance + (optionally) a new template. Both records are dispatched
        // optimistically and emitted to the server; the server's broadcast excludes the
        // sender, so the optimistic dispatch is what makes the originating client see
        // the new item immediately.
        const gridId = state.grid?._id || state.gridId;
        const userId = state.userId;
        if (!gridId || !userId) break;
        const inst = effect.instance;
        if (!inst?.id || !inst?.templateId) break;

        // Mint template if one was created
        if (effect.template?.id) {
          const newModule = {
            id: effect.template.id,
            role: effect.template.role || "container",
            kind: effect.template.kind || "doc",
            label: effect.template.label || effect.template.name,
            name: effect.template.name || effect.template.label,
            userId,
            gridId,
            fieldBindings: [],
            ...(effect.template.meta && { meta: effect.template.meta }),
          };
          socketDispatch(createModuleAction(newModule));
          socket?.emit("create_module", { module: newModule });
        }

        // Mint instance
        const newOcc = {
          id: inst.id,
          userId,
          targetType: "module",
          targetId: inst.templateId,
          gridId,
          parentId: inst.parentId || null,
          viewId: inst.viewId || null,
          fields: inst.fields || {},
          meta: { createdByOperation: true },
          textmap: inst.textmap || null,
          occurrences: [],
        };
        socketDispatch(createOccurrenceAction(newOcc));
        localOccsById[newOcc.id] = newOcc;

        // Optimistically append to the parent's occurrences[] — server auto-pushes
        // server-side, but its broadcast excludes the sender. localOccsById is preferred
        // over state.occurrencesById since state is frozen for the entire op pass.
        if (newOcc.parentId) {
          const parent = localOccsById[newOcc.parentId] || state.occurrencesById?.[newOcc.parentId];
          if (parent && !(parent.occurrences || []).includes(newOcc.id)) {
            const current = Array.isArray(parent.occurrences) ? parent.occurrences : [];
            const insertAt = typeof inst.insertAtIndex === "number" ? inst.insertAtIndex : current.length;
            const next = [...current];
            next.splice(insertAt, 0, newOcc.id);
            updateOccurrence({
              dispatch: socketDispatch,
              socket,
              occurrence: { id: newOcc.parentId, occurrences: next },
              emit: false,
            });
            localOccsById[newOcc.parentId] = { ...parent, occurrences: next };
          }
        }

        socket?.emit("create_occurrence", {
          occurrence: {
            ...newOcc,
            ...(typeof inst.insertAtIndex === "number" && { insertAtIndex: inst.insertAtIndex }),
          },
        });
        break;
      }

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

      case "SET_FILTER": {
        // Write a filter nav value. Skip if already set to avoid infinite loop on onLoad ops.
        if (!effect.filterId && !effect.fieldId) break;
        const key = effect.filterId || effect.fieldId;
        const currentVal = state?.filterNavState?.[key];
        if (currentVal === effect.value) break;
        socketDispatch(setFilterNavAction(key, effect.value));
        break;
      }

      default:
        break;
    }
  }

  // Memoized maps — rebuilt only when the source arrays change (by reference)
  let _cachedFieldsById = null, _lastFields = null;
  let _cachedOperationsById = null, _lastOperations = null;
  let _cachedBaseOccsById = null, _lastOccurrences = null;

  function fireOperations(transactionType, transaction, { occurrencesOverride } = {}) {
    const state = stateRef.current || {};
    const operations = state.operations || [];
    const fields = state.fields || [];
    const occurrences = state.occurrences || [];

    if (transactionType === "OccurrenceCreateOp" || transactionType === "MeasureOp") {
      console.log(`[fireOps] ${transactionType}`, {
        occurrenceId: transaction.occurrenceId,
        instanceId: transaction.instanceId,
        containerId: transaction.containerId,
        fieldId: transaction.fieldId,
        value: transaction.value,
        opCount: operations.length,
      });
    }

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
    // Overlay localOccsById on top of cached base (localOccsById is always fresh).
    // occurrencesOverride wins over both — used by delete handlers to keep a
    // just-removed occurrence visible to the executor for this one call so
    // $trigger.occurrence enrichment still works.
    const occurrencesById = Object.assign({}, _cachedBaseOccsById, localOccsById, occurrencesOverride || null);

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

  function fireOperationsOptimistic(transactionType, transaction, options) {
    // Mark as optimistically fired so onOccurrenceUpdated skips the duplicate
    if (transaction.occurrenceId) {
      optimisticFiredSet.add(transaction.occurrenceId);
      // Clear after 5s (server echo should arrive well before this)
      setTimeout(() => optimisticFiredSet.delete(transaction.occurrenceId), 5000);
    }
    fireOperations(transactionType, transaction, options);
  }

  // Expose on module-level bridge so CommitHelpers can call optimistically
  operationsBridge.fireOperations = fireOperationsOptimistic;
  operationsBridge.updateLocalOcc = (occ) => { if (occ?.id) localOccsById[occ.id] = occ; };
  operationsBridge.removeLocalOcc = (occurrenceId) => { delete localOccsById[occurrenceId]; };
  operationsBridge.getLocalOcc = (occurrenceId) => localOccsById[occurrenceId] || null;

  // On transaction_created: fire operations + toast notification
  function onTransactionCreated({ transaction } = {}) {
    if (!transaction) return;
    // Guard against typeless transactions — historically `type` wasn't on the
    // server's Transaction schema so it was dropped on save, then `undefined`
    // matched onLoad triggers (undefined == null) and every tracker UPDATE
    // looped back into another transaction_created echo.
    if (!transaction.type) return;
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
  // BROADCASTCHANNEL — preview iframes request state from main app
  // Runs in the iframe context: sends REQUEST_STATE, hydrates immediately
  // when the main window responds (avoids waiting for socket round-trip)
  // ======================================================
  let bc = null;
  const isInIframe = (() => { try { return window !== window.parent; } catch (_) { return true; } })();
  if (isInIframe && "BroadcastChannel" in window) {
    bc = new BroadcastChannel("moduli-preview");
    bc.onmessage = (e) => {
      if (e.data?.type === "PREVIEW_STATE") {
        onFullState(e.data.payload);
        bc.close();
        bc = null;
      }
    };
    bc.postMessage({ type: "REQUEST_STATE" });
  }

  // ======================================================
  // CLEANUP (important with HMR)
  // ======================================================
  return () => {
    operationsBridge.fireOperations = null;
    operationsBridge.updateLocalOcc = null;
    operationsBridge.removeLocalOcc = null;
    clearInterval(scheduleInterval);
    if (bc) { bc.close(); bc = null; }
    socket.off("full_state", onFullState);
    socket.off("priority_state", onPriorityState);
    socket.off("textmaps_loaded", onTextmapsLoaded);
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