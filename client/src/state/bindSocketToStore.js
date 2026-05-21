// client/src/state/bindSocketToStore.js
// =========================================
// bindSocketToStore.js — CLEAN + CONSISTENT
// ✅ UPDATED for no-echo rooms:
// - Other windows must self-heal if their active grid is deleted.
// =========================================

import { ActionTypes } from "./actions";
import { runMatchingOperations, executeOperation, executePipeline } from "../helpers/operationExecutor";
import { setComputedValuesAction, createModuleAction, updateModuleAction, deleteModuleAction, createOccurrenceAction, updateOccurrenceAction, initFilterNavAction, setFilterNavAction, updateGridAction } from "./actions";
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
import { migrateFieldOptionsSource, needsMigration } from "./migrateFieldOptionsSource";

/**
 * Module-level bridge so CommitHelpers can fire operations immediately
 * after optimistic dispatch (no server round-trip needed).
 */
export const operationsBridge = { fireOperations: null, updateLocalOcc: null, removeLocalOcc: null, getLocalOcc: null, getLinkedOccs: null, applyEffect: null, requestUserInput: null };

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

    const migratedFields = (payload.fields || []).map(f => {
      if (!needsMigration(f)) return f;
      const migrated = migrateFieldOptionsSource(f);
      safeEmit(socket, "update_field", { field: migrated });
      return migrated;
    });
    payload = { ...payload, fields: migratedFields };

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

    // Bootstrap grid.activeFilterValues for nav-driven conditions on the
    // active named filter. The seed leaves activeFilterValues:{} so the
    // value resolves to local-tz today on every load (the comment-blessed
    // pattern — pre-seeded literals would bake in the seed day). filterNavState
    // (above) drives what the nav WIDGET displays; activeFilterValues drives
    // what the filter CASCADE reads. Without this, on a fresh load the widget
    // shows "today" but isOccurrenceVisible's rightVal is undefined → the date
    // condition skips → all dates show, regardless of what the widget claims.
    // Only fills missing fieldIds — never overwrites an explicit user-set
    // value (so toolbar navs persist across reloads as expected).
    const grid = payload.grid;
    if (grid?.namedFilters?.length) {
      const activeFilter = grid.namedFilters.find(f => f.id === grid.activeFilterId);
      const navConditions = (activeFilter?.conditions || []).filter(c => c?.isNav && c?.fieldId);
      if (navConditions.length) {
        const existing = grid.activeFilterValues || {};
        const patch = { ...existing };
        let changed = false;
        // A bare string value is treated as `{value: <string>, unit: "day"}` —
        // both shapes count as "set" for bootstrap purposes.
        const hasValue = (v) => v != null && v !== "" && (typeof v !== "object" || v.value);
        for (const c of navConditions) {
          if (!hasValue(existing[c.fieldId])) {
            patch[c.fieldId] = localDay(now);
            changed = true;
          }
        }
        if (changed) {
          dispatch(updateGridAction({ gridId: grid._id || payload.gridId, grid: { activeFilterValues: patch } }));
          // Persist to server so a subsequent load (or another tab) sees the
          // bootstrapped value rather than re-bootstrapping each time.
          safeEmit(socket, "update_grid", { gridId: grid._id || payload.gridId, patch: { activeFilterValues: patch } });
        }
      }
    }

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
        const occ = { ...o, id };
        occurrencesById[id] = occ;
        localOccsById[id] = occ;
      }
    }
    const hydratedState = { ...stateRef.current, ...payload, occurrencesById, operations, fields: payload.fields || [] };

    // Defer operation execution until after the first paint so the grid renders immediately.
    // requestAnimationFrame fires before next paint, the nested rAF fires AFTER paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Overlay localOccsById on top of the payload snapshot. Between full_state
      // dispatch and this deferred callback, React's filterNavState useEffect
      // may already have fired a NavigationOp synchronously — that pipeline
      // pass mutates localOccsById with its optimistic CREATE_ITEM stubs.
      // Without this overlay, the onLoad fire below reads stale occurrences
      // and re-creates the same items the NavigationOp pass already created.
      const overlay = Object.assign({}, occurrencesById, localOccsById);
      const allUpdates = runMatchingOperations(operations, null, null, { state: hydratedState, fieldsById, operationsById, occurrencesById: overlay, modulesById }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });
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
    const _containerMod = _containerOcc ? _modsArr.find(m => m.id === _containerOcc.moduleId) : null;
    const _revMap = buildReverseMap(Object.values(_occById));
    const _gridOccSet = new Set(_stateNow.grid?.occurrences || []);
    const _panelOcc = findGridPanelOcc(_containerOcc, _revMap, _occById, _gridOccSet);
    const _panelMod = _panelOcc ? _modsArr.find(m => m.id === _panelOcc.moduleId) : null;
    fireOperations("OccurrenceCreateOp", {
      type: "OccurrenceCreateOp",
      occurrenceId: occurrence.id,
      instanceId: occurrence.moduleId,
      containerId: occurrence.parentId,
      panelId: _panelOcc?.moduleId || occurrence.panelId,
      containerLabel: _containerMod?.label || "",
      panelLabel: _panelMod?.label || "",
    });
  }

  function onOccurrenceUpdated({ occurrence } = {}) {
    if (!occurrence?.id) return;

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
          instanceId: occurrence.moduleId,
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
          instanceId: removedOcc.moduleId,
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

        // Auto-attach the field to the target module's fieldBindings if missing.
        // Required so date-stamping ops (Schedule: Stamp Date & Time Slot, etc.)
        // produce a value the renderer can show — without a binding the field
        // pill never appears even though occ.fields[fieldId] is set.
        if (effect.subKind !== "flow" && effect.fieldId) {
          const occ = occOverlay[effect.itemId];
          const mod = occ ? state.modulesById?.[occ.moduleId] : null;
          if (mod) {
            const bindings = mod.fieldBindings || [];
            const alreadyBound = bindings.some(b => b?.fieldId === effect.fieldId);
            if (!alreadyBound) {
              const nextBindings = [
                ...bindings,
                { fieldId: effect.fieldId, role: "input", order: bindings.length },
              ];
              updateModule({
                dispatch: socketDispatch, socket,
                module: { id: mod.id, fieldBindings: nextBindings },
                emit: true,
              });
            }
          }
        }

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
        // Two emit shapes:
        //   - metaPath: [seg, seg, ...] + value — deep-set at the nested path,
        //     clone-merging at each level so siblings under the same parent are
        //     preserved (writing meta.table.cells["0:0"] keeps meta.table.columns,
        //     meta.table.rowCount, and all other cells intact).
        //   - metaPatch: { key: value } — legacy shallow merge (kept for any
        //     direct emitters; applyUpdate now emits metaPath instead).
        let nextMeta;
        if (Array.isArray(effect.metaPath) && effect.metaPath.length) {
          const path = effect.metaPath;
          nextMeta = { ...(occ.meta || {}) };
          let cursor = nextMeta;
          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            const existing = cursor[key];
            cursor[key] = existing && typeof existing === "object" && !Array.isArray(existing)
              ? { ...existing }
              : {};
            cursor = cursor[key];
          }
          cursor[path[path.length - 1]] = effect.value;
        } else {
          nextMeta = { ...(occ.meta || {}), ...(effect.metaPatch || {}) };
        }
        // Mirror the freshly-computed meta into the local overlay BEFORE
        // emitting. Without this, a subsequent UPDATE_ITEM_META in the same
        // effect batch (e.g. the Schedule Table op writing 4 cells per row)
        // reads the pre-write meta from localOccsById, recomputes nextMeta
        // from that stale snapshot, and silently overwrites the previous cell
        // entries — only the LAST write per batch survives. Updating the
        // overlay synchronously here means the next handler sees the merged
        // state. dispatch() updates Redux for the React render layer; the
        // overlay update keeps the executor's view fresh too.
        localOccsById[effect.itemId] = { ...occ, meta: nextMeta };
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, meta: nextMeta } });
        break;
      }

      case "UPDATE_ITEM_TEXTMAP": {
        if (!effect.itemId) break;
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, textmap: effect.textmap } });
        break;
      }

      case "UPDATE_ITEM_OWN_STYLE": {
        // Single-key write into occurrence.ownStyle — same shape as the
        // settings menu's StyleEditor produces (which writes the whole
        // ownStyle object on the module). Here we write per-occurrence,
        // partial-merge so writing `.bg` doesn't clobber `.opacity` etc.
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        if (!occ || !effect.styleKey) break;
        const nextOwnStyle = { ...(occ.ownStyle || {}), [effect.styleKey]: effect.value };
        localOccsById[effect.itemId] = { ...occ, ownStyle: nextOwnStyle };
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, ownStyle: nextOwnStyle } });
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
            fieldBindings: Array.isArray(effect.template.fieldBindings) ? effect.template.fieldBindings : [],
            ...(effect.template.meta && { meta: effect.template.meta }),
          };
          socketDispatch(createModuleAction(newModule));
          socket?.emit("create_module", { module: newModule });
        }

        // Mint instance
        // role/kind/label are stamped directly on the occurrence so the
        // executor's $allInstances / $allContainers / $allPages filters
        // (operationExecutor.js:842-909, which read `occ.role ?? tpl?.role`)
        // include this occurrence on the next fireOperations call WITHOUT
        // needing state.modules to be up-to-date. Within a synchronous
        // cascade (e.g. updateOccurrenceFilterOverride firing one
        // NavigationOp per inheriting descendant of a page), stateRef.current
        // is the pre-cascade snapshot — newly-minted clone modules aren't
        // visible until React re-renders. Without these stamps, fires
        // #2..#N see the new occurrences with role=null, exclude them from
        // $allInstances, and the idempotency FIND in `Schedule: Build Day`
        // (server/scripts/createTestGrid.js:1217-1234) silently misses
        // them — APPLY_TEMPLATE re-runs and stacks duplicates.
        const newOcc = {
          id: inst.id,
          userId,
          moduleId: inst.templateId,
          gridId,
          parentId: inst.parentId || null,
          viewId: inst.viewId || null,
          fields: inst.fields || {},
          meta: { createdByOperation: true, ...(inst.meta || {}) },
          textmap: inst.textmap || null,
          role: effect.template?.role || null,
          kind: effect.template?.kind || null,
          label: effect.template?.label || effect.template?.name || null,
          // Honor occurrences[] if the caller passed one (APPLY_TEMPLATE
          // sends nested children's ids so the parent is created WITH the
          // child list rather than patched via a separate UPDATE_OCCURRENCE
          // — which races against the createQueue and can get overwritten.
          occurrences: Array.isArray(inst.occurrences) ? inst.occurrences : [],
          identitySignature: inst.identitySignature || null,
          // COPY_LINK: when present, the server's update_occurrence handler
          // (server/socketHandlers/occurrences.js:91) propagates field/textmap
          // writes bidirectionally across all occurrences sharing this id.
          // Default null = independent occurrence.
          linkedGroupId: inst.linkedGroupId || null,
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
        // Find the canonical pool occurrence inside the pool container's occurrences list
        const { moduleId, poolId } = effect;
        const poolContainerOcc = Object.values(localOccsById).find(
          o => o.moduleId === poolId
        ) || Object.values(state.occurrencesById || {}).find(
          o => o.moduleId === poolId
        );
        const childOccIds = poolContainerOcc?.occurrences || [];
        const poolOcc = childOccIds
          .map(id => localOccsById[id] || state.occurrencesById?.[id])
          .find(o => o && o.moduleId === moduleId);
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
  let _cachedModulesById = null, _lastModules = null;

  function fireOperations(transactionType, transaction, { occurrencesOverride } = {}) {
    const state = stateRef.current || {};
    const operations = state.operations || [];
    const fields = state.fields || [];
    const occurrences = state.occurrences || [];
    const modules = state.modules || [];


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
    // Rebuild modulesById only when modules array changes
    if (modules !== _lastModules) {
      _cachedModulesById = {};
      for (const m of modules) {
        if (m?.id) _cachedModulesById[m.id] = m;
      }
      _lastModules = modules;
    }
    // Overlay localOccsById on top of cached base (localOccsById is always fresh).
    // occurrencesOverride wins over both — used by delete handlers to keep a
    // just-removed occurrence visible to the executor for this one call so
    // $trigger.occurrence enrichment still works.
    const occurrencesById = Object.assign({}, _cachedBaseOccsById, localOccsById, occurrencesOverride || null);

    const allUpdates = runMatchingOperations(operations, transactionType, transaction, { state, fieldsById: _cachedFieldsById, operationsById: _cachedOperationsById, occurrencesById, modulesById: _cachedModulesById }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });

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
  operationsBridge.getLinkedOccs = (linkedGroupId, excludeId) => {
    if (!linkedGroupId) return [];
    const out = [];
    for (const o of Object.values(localOccsById)) {
      if (o?.linkedGroupId === linkedGroupId && o.id !== excludeId) out.push(o);
    }
    return out;
  };
  // Scheduler path: apply a single pipeline effect (UPDATE_ITEM_FIELD,
  // CREATE_ITEM, NOTIFY, etc.) without going through runMatchingOperations.
  // Used by useScheduler for hour+ scheduled ops that fire on cadence
  // without an event trigger. Sub-hour scheduled ops skip persistent
  // effects entirely (display-only rule enforced at the caller).
  operationsBridge.applyEffect = (effect) => {
    if (!effect) return;
    const stateNow = stateRef?.current || {};
    applyOperationEffect(effect, stateNow);
  };

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
      // Skip the toast when nothing actually changed — the executor still
      // fires MeasureOp on every write (used by trigger plumbing) so we'd
      // otherwise show "Field: 1 → 1" noise on idempotent writes.
      const sameValue = String(prev ?? "") === String(next ?? "");
      if (!sameValue) {
        const desc = prev != null ? `${prev} → ${next}` : String(next ?? "");
        toast(fieldName, { description: desc, duration: 2500 });
      }
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

  // ── /api/v1/operations/:id/run bridge ────────────────────────────
  // Server holds the HTTP response open and emits `run_op_for_api` to
  // the user's room. First connected client (this one) runs the op,
  // collects effects + final $vars, and emits `api_op_result` back so
  // the server can resolve the awaiting Promise.
  //
  // CALL_API actions inside the op happen here in the browser — for
  // dev / same-origin endpoints this is fine. Phase 3 will move
  // CALL_API to the server-side executor (CORS + secrets).
  function onRunOpForApi({ requestId, operationId, vars = {}, dryRun = false } = {}) {
    const startedAt = Date.now();
    const state = stateRef.current || {};
    const op = (state.operations || []).find(o => o.id === operationId);
    if (!op) {
      if (requestId) safeEmit(socket, "api_op_result", {
        requestId, ok: false,
        error: { code: "not_found", message: "Operation not found in client state" },
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const fieldsById = {};
    for (const f of state.fields || []) fieldsById[f.id] = f;
    const occurrencesById = {};
    for (const o of state.occurrences || []) occurrencesById[o.id] = o;
    const modulesById = {};
    for (const m of state.modules || []) modulesById[m.id] = m;
    const operationsById = {};
    for (const o of state.operations || []) operationsById[o.id] = o;

    // Synthetic transaction matching docs/api-plan.md §1.3:
    //   { type: "ApiCallOp", apiRequestId, ...vars }
    // so trigger predicates can route on it.
    const transaction = {
      type: "ApiCallOp",
      apiRequestId: requestId,
      ...vars,
    };

    // The pipeline can suspend (CALL_API / GET_USER_INPUT) and resume
    // asynchronously. _onPipelineDone fires once with the FULL effects
    // array — that's when we emit `api_op_result`.
    let alreadyEmitted = false;
    const emit = (effects, error = null) => {
      if (alreadyEmitted || !requestId) return;
      alreadyEmitted = true;
      const finalVars = {};
      for (const eff of effects || []) {
        if (eff && eff._effect === "SHOW_VALUE" && eff.name) {
          finalVars[eff.name] = eff.value;
        }
      }
      if (!dryRun) {
        // Apply any effects not already applied via the suspend resume
        // path's operationsBridge.applyEffect. Idempotent enough — the
        // server-side handlers tolerate same-shape repeats.
        for (const eff of effects || []) {
          if (eff && eff._effect && !eff._suspend) applyOperationEffect(eff);
        }
      }
      safeEmit(socket, "api_op_result", {
        requestId,
        ok: !error,
        vars: finalVars,
        effects: effects || [],
        log: [],
        durationMs: Date.now() - startedAt,
        ...(error ? { error } : {}),
      });
    };

    try {
      const ctx = {
        state, fieldsById, occurrencesById, modulesById, operationsById,
        _onPipelineDone: (allEffects) => emit(allEffects, null),
      };
      executePipeline(op, ctx, transaction, vars);
    } catch (err) {
      emit([], { code: "execution_error", message: String(err?.message || err) });
    }
  }
  socket.on("run_op_for_api", onRunOpForApi);

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
  // TEMPLATE LIFECYCLE — server emits these on completion of clone/apply/save-over.
  // Surface as toasts so the user gets confirmation that the bulk-clone burst
  // actually persisted (per server CLAUDE.md the burst is racy without the
  // deferred bulk_clone_subtree handler, so explicit confirmation matters).
  // The cloned modules/occurrences themselves arrive via the normal
  // module_created/occurrence_created stream, so no state hydration here.
  // ======================================================
  function onTemplateCreated({ name } = {}) {
    toast.success(name ? `Saved template "${name}"` : "Template saved", { duration: 2500 });
  }
  function onTemplateApplied({ newOccurrenceIds } = {}) {
    const n = Array.isArray(newOccurrenceIds) ? newOccurrenceIds.length : 0;
    toast.success(n ? `Applied template (${n} item${n === 1 ? "" : "s"})` : "Template applied", { duration: 2500 });
  }
  function onTemplateSavedOver({ name } = {}) {
    toast.success(name ? `Updated template "${name}"` : "Template updated", { duration: 2500 });
  }
  socket.on("template_created", onTemplateCreated);
  socket.on("template_applied", onTemplateApplied);
  socket.on("template_saved_over", onTemplateSavedOver);

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
    operationsBridge.getLocalOcc = null;
    operationsBridge.getLinkedOccs = null;
    operationsBridge.applyEffect = null;
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
    socket.off("template_created", onTemplateCreated);
    socket.off("template_applied", onTemplateApplied);
    socket.off("template_saved_over", onTemplateSavedOver);

    for (const { name, onCreated, onUpdated, onDeleted } of genericHandlers) {
      socket.off(`${name}_created`, onCreated);
      socket.off(`${name}_updated`, onUpdated);
      socket.off(`${name}_deleted`, onDeleted);
    }
  };
}