// client/src/state/bindSocketToStore.js
// =========================================
// bindSocketToStore.js — CLEAN + CONSISTENT
// ✅ UPDATED for no-echo rooms:
// - Other windows must self-heal if their active grid is deleted.
// =========================================

import { ActionTypes } from "./actions";
import { runMatchingOperations, executeOperation, executePipeline, setOpApplyingEffects } from "../helpers/operationExecutor";
import { setComputedValuesAction, createModuleAction, updateModuleAction, deleteModuleAction, createOccurrenceAction, updateOccurrenceAction, initFilterNavAction, setFilterNavAction, updateGridAction } from "./actions";
import { toast } from "sonner";
import { pushTxNotification } from "./notificationStore";
import {
  setOccurrenceFieldValue,
  moveOccurrence,
  createOccurrenceInContainer,
  createInstanceInContainer,
  deleteOccurrence,
  updateModule,
  deleteModule,
  updateOccurrence,
  ensureModuleBindingsForOccurrenceFields,
} from "../helpers/CommitHelpers";
import { flushOfflineQueue, safeEmit } from "../helpers/offlineQueue";
import { buildReverseMap, findGridPanelOcc } from "../helpers/occurrenceHelpers";
import { migrateFieldOptionsSource, needsMigration } from "./migrateFieldOptionsSource";
import { analyzeAllOperations } from "../helpers/operationIntrospection";

/**
 * Module-level bridge so CommitHelpers can fire operations immediately
 * after optimistic dispatch (no server round-trip needed).
 */
export const operationsBridge = { fireOperations: null, fireOperationsBatch: null, updateLocalOcc: null, removeLocalOcc: null, getLocalOcc: null, getLocalMod: null, getLinkedOccs: null, getAncestorChain: null, applyEffect: null, requestUserInput: null, importText: null, beginDropBatch: null, endDropBatch: null };

export function bindSocketToStore(socket, dispatch, stateRef = { current: {} }) {
  // Wrap dispatch to tag all socket-originated actions
  // This prevents BroadcastChannel from re-broadcasting server events
  const socketDispatch = (action) => dispatch({ ...action, _fromSocket: true });

  // Local occurrence cache — updated synchronously on each occurrence event,
  // BEFORE React re-renders stateRef.current. Used by fireOperations so that
  // onChange operations always see the latest occurrence values even when the
  // React render cycle hasn't completed yet.
  const localOccsById = {};

  // ── EXECUTOR CYCLE BREAKER (2026-05-25) ───────────────────────────────────
  // Durable suppression set for occurrences CREATED or DELETED by operation
  // effects (CREATE_ITEM / DELETE_ITEM / REMOVE_OCCURRENCE). Such derived-data
  // CRUD must NEVER re-fire OccurrenceCreateOp / OccurrenceDeleteOp on the
  // server's echo — the producing op already ran (and any downstream op saw
  // the effect synchronously in the same runMatchingOperations sweep via the
  // liveOccs overlay), so the echo would only re-trigger mirror ops and feed
  // the cascade.
  //
  // This complements two existing guards that each have a blind spot:
  //   - setOpApplyingEffects (operationExecutor): covers the SYNCHRONOUS
  //     nested-fire path only — an op can't re-trigger while its own effect
  //     batch is applying.
  //   - optimisticFiredSet (below): dedups echoes, but on a 5s timer. When
  //     deleteOccurrence's rAF-deferred MeasureOps stretch a rebuild across
  //     many frames (35s+ in the toolkit-drop freeze), that timer expires
  //     between chunks and the echo re-fires — the async leak.
  // opEmittedOccIds is cleared on echo ARRIVAL (its natural lifecycle), with a
  // long 60s fallback sweep only to bound memory if an echo never lands
  // (offline). It does NOT expire mid-storm, so it closes the async leak
  // regardless of how long the cascade runs.
  const opEmittedOccIds = new Set();
  const _markOpEmitted = (id) => {
    if (!id) return;
    opEmittedOccIds.add(id);
    setTimeout(() => opEmittedOccIds.delete(id), 60000);
  };

  // ======================================================
  // FULL STATE HYDRATE
  // ======================================================
  function onFullState(payload = {}) {
    const tFS0 = performance.now();
    const markFS = (label) => console.log(`[full_state-client] +${Math.round(performance.now() - tFS0)}ms ${label}`);
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

    markFS(`reducer dispatched (${(payload.occurrences || []).length} occs, ${(payload.modules || []).length} mods)`);

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
      const tOps0 = performance.now();
      // Overlay localOccsById on top of the payload snapshot. Between full_state
      // dispatch and this deferred callback, React's filterNavState useEffect
      // may already have fired a NavigationOp synchronously — that pipeline
      // pass mutates localOccsById with its optimistic CREATE_ITEM stubs.
      // Without this overlay, the onLoad fire below reads stale occurrences
      // and re-creates the same items the NavigationOp pass already created.
      const overlay = Object.assign({}, occurrencesById, localOccsById);
      const allUpdates = runMatchingOperations(operations, null, null, { state: hydratedState, fieldsById, operationsById, occurrencesById: overlay, modulesById }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });
      const tOps1 = performance.now();
      const displayUpdates = allUpdates.filter(u => !u._effect);
      const effects = allUpdates.filter(u => u._effect);
      console.log(`[full_state-client] runMatchingOperations: ${Math.round(tOps1 - tOps0)}ms — ${operations.length} ops, ${effects.length} effects, ${displayUpdates.length} display updates`);
      if (displayUpdates.length > 0) {
        dispatch(setComputedValuesAction(displayUpdates));
      }
      for (const eff of effects) {
        applyOperationEffect(eff, hydratedState);
      }
      console.log(`[full_state-client] applied effects in ${Math.round(performance.now() - tOps1)}ms`);
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
    // Skip the trigger fire if THIS client already fired it optimistically when
    // it created the occurrence (CommitHelpers.createOccurrence → fireOperations
    // Optimistic). Without this, the server's own-echo of an op-created
    // occurrence re-fires OccurrenceCreateOp at depth 0 (fresh stack, outside the
    // synchronous self-trigger guard) → the rebuild op re-creates → emits →
    // echoes again → unbounded async create loop (the create_occurrence flood).
    // Other windows didn't create it, so their set lacks the id and they fire
    // normally — multi-window sync preserved.
    if (!optimisticFiredSet.has(occurrence.id) && !opEmittedOccIds.has(occurrence.id)) {
      const ancestors = operationsBridge.getAncestorChain?.(occurrence.id) || { ids: [], labels: [] };
      fireOperations("OccurrenceCreateOp", {
        type: "OccurrenceCreateOp",
        occurrenceId: occurrence.id,
        instanceId: occurrence.moduleId,
        containerId: occurrence.parentId,
        panelId: _panelOcc?.moduleId || occurrence.panelId,
        containerLabel: _containerMod?.label || "",
        panelLabel: _panelMod?.label || "",
        fields: occurrence.fields || {},
        _ancestorIds: ancestors.ids,
        _ancestorLabels: ancestors.labels,
      });
    }
    optimisticFiredSet.delete(occurrence.id);
    opEmittedOccIds.delete(occurrence.id);
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

    // Fire operations on field change — skip if already fired optimistically by CommitHelpers.
    // Coalesces all changed fields into ONE compound MeasureOp; matchSubjectFilter
    // matches on `transaction.fields[targetId]` so per-field-targeted triggers still match.
    if (!optimisticFiredSet.has(occurrence.id)) {
      const prevFields = prevOcc?.fields || {};
      const changedFields = {};
      for (const fid of Object.keys(occurrence.fields || {})) {
        if (JSON.stringify(occurrence.fields[fid]) !== JSON.stringify(prevFields[fid])) {
          changedFields[fid] = occurrence.fields[fid];
        }
      }
      if (Object.keys(changedFields).length > 0) {
        const ancestors = operationsBridge.getAncestorChain?.(occurrence.id) || { ids: [], labels: [] };
        fireOperations("MeasureOp", {
          type: "MeasureOp",
          occurrenceId: occurrence.id,
          instanceId: occurrence.moduleId,
          fields: changedFields,
          _ancestorIds: ancestors.ids,
          _ancestorLabels: ancestors.labels,
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

    // Skip if THIS client already fired the delete trigger optimistically
    // (CommitHelpers.deleteOccurrence). Otherwise the server's own-echo of an
    // op-deleted occurrence re-fires OccurrenceDeleteOp at depth 0 (outside the
    // synchronous self-trigger guard) → rebuild op re-deletes → emits → echoes →
    // unbounded async loop (the OccurrenceDeleteOp depth-cap flood).
    if (!optimisticFiredSet.has(occurrenceId) && !opEmittedOccIds.has(occurrenceId)) {
      // Compute the ancestor chain for the just-deleted occurrence using the
      // override (the occurrence is gone from localOccsById, so the live-overlay
      // walk inside getAncestorChain would miss it; we walk from the snapshot).
      let delAncestors = { ids: [], labels: [] };
      if (removedOcc) {
        // Best-effort: use bridge if it still resolves; otherwise just walk
        // parentId from the snapshot.
        const probe = operationsBridge.getAncestorChain?.(occurrenceId);
        if (probe && (probe.ids.length || probe.labels.length)) delAncestors = probe;
      }
      // ONE trigger per user action — OccurrenceDeleteOp carries the deleted
      // occurrence's fields so field-scoped onDelete triggers
      // (subjectType:"field" → transaction.fields[targetId]) match. No piggyback
      // MeasureOp — onChange is reserved for value edits on a live occurrence.
      fireOperations("OccurrenceDeleteOp", {
        type: "OccurrenceDeleteOp",
        occurrenceId,
        instanceId: payload.instanceId || removedOcc?.moduleId,
        containerId: payload.containerId || removedOcc?.parentId,
        fields: removedOcc?.fields || {},
        _ancestorIds: delAncestors.ids,
        _ancestorLabels: delAncestors.labels,
      }, { occurrencesOverride: override });
    }
    optimisticFiredSet.delete(occurrenceId);
    opEmittedOccIds.delete(occurrenceId);
  }

  socket.on("occurrence_created", onOccurrenceCreated);
  socket.on("occurrence_updated", onOccurrenceUpdated);
  socket.on("occurrence_deleted", onOccurrenceDeleted);

  // Stale-write rejection (#26 cheapest-level conflict resolution).
  // Server emits this when an update_occurrence's expectedUpdatedAt is
  // older than the stored copy — another window beat us. We sync the
  // server's current state into local + Redux + toast the user so they
  // know their edit was lost.
  function onOccurrenceStale({ occurrence } = {}) {
    if (!occurrence?.id) return;
    localOccsById[occurrence.id] = occurrence;
    socketDispatch({ type: ActionTypes.UPDATE_OCCURRENCE, payload: { occurrence } });
    try {
      toast?.("Refreshed — another window had a newer edit.", { duration: 3500 });
    } catch {}
  }
  socket.on("occurrence_stale", onOccurrenceStale);

  // Persistence ack from the server — sent ONLY to the originator after a
  // successful update_occurrence. Carries just the fresh updatedAt (and
  // fieldUpdatedAt map when fields were written). Patches the local cache
  // so the NEXT write on this occurrence sends a current expectedUpdatedAt
  // and doesn't trip the stale-write guard. Without this ack the
  // originator's updatedAt stays frozen at the value from full_state and
  // every subsequent write looks stale → spurious "another window had a
  // newer edit" toast despite no other window existing.
  function onOccurrencePersisted({ id, updatedAt, fieldUpdatedAt } = {}) {
    if (!id || !updatedAt) return;
    const prev = localOccsById[id];
    if (!prev) return;
    const patch = { ...prev, updatedAt };
    if (fieldUpdatedAt && typeof fieldUpdatedAt === "object") patch.fieldUpdatedAt = fieldUpdatedAt;
    localOccsById[id] = patch;
    // Skip Redux dispatch — these timestamps are stale-check bookkeeping;
    // no UI consumes them, so we avoid the re-render storm of N persists
    // per pipeline run.
  }
  socket.on("occurrence_persisted", onOccurrencePersisted);

  // Per-field conflict (#26 medium-tier conflict resolution). Server
  // emits this when a fields-patch carried `expectedFieldUpdatedAt`
  // baselines and at least one field's stored timestamp is newer
  // than the client's expectation. Non-conflicting fields in the same
  // patch were auto-merged and broadcast via the regular
  // `occurrence_updated` path; this event covers ONLY the rejected
  // fields so the client can surface a "same field touched in another
  // window" decision to the user. Default UX: sync the server's value
  // for the conflicting field + toast with the count.
  function onOccurrenceFieldConflict({ occurrenceId, conflicts, occurrence } = {}) {
    if (!occurrenceId || !conflicts) return;
    // Refresh local cache + Redux to the server's current state so the
    // user sees the winning value immediately. The user's attempt for
    // the conflicting field is dropped — same trade as the cheap tier,
    // but only for the colliding field instead of the whole occurrence.
    if (occurrence?.id) {
      localOccsById[occurrence.id] = occurrence;
      socketDispatch({ type: ActionTypes.UPDATE_OCCURRENCE, payload: { occurrence } });
    }
    const count = Object.keys(conflicts).length;
    try {
      toast?.(
        count === 1
          ? "1 field had a newer edit in another window — yours was discarded for that field."
          : `${count} fields had newer edits in other windows — your values were discarded for those.`,
        { duration: 4000 }
      );
    } catch {}
  }
  socket.on("occurrence_field_conflict", onOccurrenceFieldConflict);

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
  // FOLDERS / VIEWS / MANIFESTS / OPERATIONS (CRUD)
  //
  // These broadcasts come from the /api/v1 REST endpoints (used by the
  // assistant + external API). full_state already seeds the maps; these
  // listeners keep them live so assistant-driven folder/view/manifest/
  // operation changes repaint without a manual refresh. Reducer cases +
  // action creators already exist — we just route the events here.
  // ======================================================
  function onFolderCreated(p = {}) { const folder = p.folder || p; if (folder?.id) socketDispatch({ type: ActionTypes.CREATE_FOLDER, payload: { folder } }); }
  function onFolderUpdated(p = {}) { const folder = p.folder || p; if (folder?.id) socketDispatch({ type: ActionTypes.UPDATE_FOLDER, payload: { folder } }); }
  function onFolderDeleted(p = {}) { const folderId = p.folderId || p.id; if (folderId) socketDispatch({ type: ActionTypes.DELETE_FOLDER, payload: { folderId } }); }

  function onViewCreated(p = {}) { const view = p.view || p; if (view?.id) socketDispatch({ type: ActionTypes.CREATE_VIEW, payload: { view } }); }
  function onViewUpdated(p = {}) { const view = p.view || p; if (view?.id) socketDispatch({ type: ActionTypes.UPDATE_VIEW, payload: { view } }); }
  function onViewDeleted(p = {}) { const viewId = p.viewId || p.id; if (viewId) socketDispatch({ type: ActionTypes.DELETE_VIEW, payload: { viewId } }); }

  function onManifestCreated(p = {}) { const manifest = p.manifest || p; if (manifest?.id) socketDispatch({ type: ActionTypes.CREATE_MANIFEST, payload: { manifest } }); }
  function onManifestUpdated(p = {}) { const manifest = p.manifest || p; if (manifest?.id) socketDispatch({ type: ActionTypes.UPDATE_MANIFEST, payload: { manifest } }); }
  function onManifestDeleted(p = {}) { const manifestId = p.manifestId || p.id; if (manifestId) socketDispatch({ type: ActionTypes.DELETE_MANIFEST, payload: { manifestId } }); }

  function onOperationCreated(p = {}) { const operation = p.operation || p; if (operation?.id) socketDispatch({ type: ActionTypes.CREATE_OPERATION, payload: { operation } }); }
  function onOperationUpdated(p = {}) { const operation = p.operation || p; if (operation?.id) socketDispatch({ type: ActionTypes.UPDATE_OPERATION, payload: { operation } }); }
  function onOperationDeleted(p = {}) { const operationId = p.operationId || p.id; if (operationId) socketDispatch({ type: ActionTypes.DELETE_OPERATION, payload: { operationId } }); }

  socket.on("folder_created", onFolderCreated);
  socket.on("folder_updated", onFolderUpdated);
  socket.on("folder_deleted", onFolderDeleted);
  socket.on("view_created", onViewCreated);
  socket.on("view_updated", onViewUpdated);
  socket.on("view_deleted", onViewDeleted);
  socket.on("manifest_created", onManifestCreated);
  socket.on("manifest_updated", onManifestUpdated);
  socket.on("manifest_deleted", onManifestDeleted);
  socket.on("operation_created", onOperationCreated);
  socket.on("operation_updated", onOperationUpdated);
  socket.on("operation_deleted", onOperationDeleted);

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
        // Module-level bindings are the canonical contract the rest of the
        // system reads (every renderer, form, picker walks `module.fieldBindings`).
        // When a value lands on an occurrence whose module doesn't bind that
        // field, the field pill never appears even though occ.fields[fieldId]
        // is set. Adding the binding to the module surfaces the pill on every
        // occurrence sharing the module — by design: occurrences without a
        // value just render an empty pill, which is the coherent system
        // behavior. Idempotent — already-bound fields are skipped.
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
          // No-op guard: skip if the new value is identical to what's
          // already stored. Without this, a tracker that re-computes the
          // same sum on every fire (e.g. Total Subscriptions writing
          // amount=30.97 every time) re-emits MeasureOp and can cascade
          // into the recursion cap. Equality via JSON to handle arrays/
          // objects + primitives uniformly.
          const _curOcc = occOverlay[effect.itemId];
          const _curVal = _curOcc?.fields?.[effect.fieldId]?.value;
          const _isSame = (() => {
            if (_curVal === effect.value) return true;
            if (_curVal == null && effect.value == null) return true;
            try { return JSON.stringify(_curVal) === JSON.stringify(effect.value); }
            catch (_) { return false; }
          })();
          if (!_isSame) {
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

      case "UPDATE_ITEM_LABEL": {
        // Per-placement label override (occurrence.label). The renderer prefers
        // it over module.label, so an op can rename one placement (date-prefix
        // goal/tracker labels) without touching the shared template. Mirror into
        // the overlay so a same-batch re-read sees the new label; dedup vs the
        // current value so steady-state fires emit nothing.
        if (!effect.itemId) break;
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        const nextLabel = effect.label ?? null;
        if (occ && (occ.label ?? null) === nextLabel) break;
        if (occ) localOccsById[effect.itemId] = { ...occ, label: nextLabel };
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, label: nextLabel } });
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
        if (effect.itemId) {
          _markOpEmitted(effect.itemId);  // suppress async echo from re-firing OccurrenceDeleteOp
          // fireTrigger:false suppresses the SYNCHRONOUS OccurrenceDeleteOp +
          // tracker re-aggregation too — a deleted derived row never changes a
          // Schedule-scoped aggregate, so firing it was ~300ms of pure waste
          // per row (the post-loop ~5s freeze). See CommitHelpers.deleteOccurrence.
          deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: effect.itemId, fireTrigger: false });
        }
        break;

      case "REMOVE_OCCURRENCE":
        _markOpEmitted(effect.occurrenceId);  // suppress async echo from re-firing OccurrenceDeleteOp
        deleteOccurrence({ dispatch: socketDispatch, socket, occurrenceId: effect.occurrenceId, fireTrigger: false });
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
          // Per-occurrence filter override. Build Schedule mints day-cols
          // with `filterOverride: {dateFid: <thisDay>}` so each day-col
          // pins itself to its own date instead of inheriting the page's
          // multi-day filter.
          filterOverride: inst.filterOverride || null,
        };
        socketDispatch(createOccurrenceAction(newOcc));
        localOccsById[newOcc.id] = newOcc;

        // Mark op-created occurrences so the server's own-echo
        // (occurrence_created) does NOT re-fire OccurrenceCreateOp for them in
        // onOccurrenceCreated. CREATE_ITEM emits create_occurrence directly
        // (it does not route through CommitHelpers.createOccurrence's optimistic
        // fire), so without this the echo of every op-minted row/card/copy
        // re-triggers the rebuild op → it creates more → emits → echoes → an
        // unbounded async create loop (the create_occurrence server flood that
        // froze the app). Cleared by onOccurrenceCreated on echo; 5s fallback in
        // case the echo never arrives (offline).
        optimisticFiredSet.add(newOcc.id);
        setTimeout(() => optimisticFiredSet.delete(newOcc.id), 5000);
        _markOpEmitted(newOcc.id);  // durable suppression — survives long rAF-stretched cascades (see cycle breaker)

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
        // Same module-binding contract as CommitHelpers.createOccurrence —
        // op-emitted CREATE_ITEM doesn't route through that function, so the
        // ensure step runs here. Idempotent.
        ensureModuleBindingsForOccurrenceFields({
          dispatch: socketDispatch, socket, occurrence: newOcc,
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
        // Used by APPEND_TO_DOC, SET_TEXTMAP, COPY_LINK's source-stamp,
        // LINK_OCCURRENCE_TO_PARENT, etc. — updates occurrence directly.
        //
        // MIRROR TO localOccsById (2026-05-25) — without this, the next
        // synchronous fireOperations call reads stale data because
        // _cachedBaseOccsById only refreshes when state.occurrences gets
        // a new array reference (React batches dispatches across the
        // current tick). Symptom this fixes: Table:Build's COPY_LINK
        // mints `lg-<src.id>` on a new row copy AND emits
        // UPDATE_OCCURRENCE on the source to stamp the same lg back.
        // The dispatch + socket emit land eventually, but the source
        // patch never reaches localOccsById, so when Table:Build fires
        // again ~10ms later (from the next OccurrenceCreateOp /
        // MeasureOp) it reads source.linkedGroupId === null,
        // existence-checks fail, and it deletes every row it just
        // created. Merging the patch into localOccsById here closes
        // that gap — the next fire sees the freshly-stamped source.
        if (effect.occurrence?.id) {
          const prev = localOccsById[effect.occurrence.id];
          if (prev) {
            localOccsById[effect.occurrence.id] = { ...prev, ...effect.occurrence };
          }
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
            instance: { id: instanceId, role: "instance", kind: "board", label: effect.label || "New Item", userId, gridId, fieldBindings: [] },
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

  // Defensive cap on synchronous fire→effect→fire recursion. A pipeline
  // can write a field via UPDATE_ITEM_FIELD, which lands in CommitHelpers'
  // setOccurrenceFieldValue, which calls operationsBridge.fireOperations
  // ("MeasureOp",…) again — if another op listens on that same field, the
  // chain becomes self-feeding and blows the stack ("too much recursion").
  // Real op chains should converge well under this limit; a higher number
  // here just hides the bug longer. 8 is plenty for legitimate cascades.
  let _fireDepth = 0;
  const _FIRE_DEPTH_LIMIT = 8;
  // When a single filter change fans out into many top-level NavigationOp fires
  // (CommitHelpers.updateOccurrenceFilterOverride emits one per inheriting
  // descendant), this holds a per-cascade Set of opIds that have already run so
  // each matching op fires ONCE for the whole cascade. Non-null only for the
  // duration of fireOperationsBatch; applied only to depth-1 fires so nested
  // op-triggered fires (MeasureOp/OccurrenceCreateOp from effects) are untouched.
  let _navCascadeFiredOps = null;
  // When non-null, fireOperations at depth 0 queues into this array instead of
  // executing immediately. endDropBatch flushes it after rAF so the browser can
  // paint the drop result before any op work begins.
  let _dropBatchFires = null;
  // Throttle the depth-cap warning per (transactionType + fieldId + occurrenceId)
  // so a runaway cycle doesn't flood the console.
  const _fireWarnAt = new Map();

  function fireOperations(transactionType, transaction, { occurrencesOverride } = {}) {
    // During a drop batch (beginDropBatch active), collect top-level fires instead
    // of executing them synchronously. endDropBatch flushes them after rAF so the
    // browser paints the visual drop result before any operation work runs.
    if (_dropBatchFires !== null && _fireDepth === 0) {
      _dropBatchFires.push({ transactionType, transaction, occurrencesOverride });
      return;
    }
    if (_fireDepth >= _FIRE_DEPTH_LIMIT) {
      // Skip recursive fires past the cap. Surface once per breach so the
      // user can find the op-loop without the page hard-crashing.
      // Throttle by (transactionType + fieldId + occurrenceId) so a chatty
      // loop logs once every 5s instead of flooding the console.
      const state = stateRef.current || {};
      const fieldId = transaction?.fieldId;
      const occurrenceId = transaction?.occurrenceId;
      const field = fieldId ? (state.fields || []).find(f => f.id === fieldId) : null;
      const occ = occurrenceId ? (localOccsById[occurrenceId] || (state.occurrences || []).find(o => o.id === occurrenceId)) : null;
      const module = occ ? (state.modules || []).find(m => m.id === occ.moduleId) : null;
      const key = `${transactionType}|${fieldId || ""}|${occurrenceId || ""}`;
      const now = Date.now();
      const lastAt = _fireWarnAt.get(key) || 0;
      if (now - lastAt > 5000) {
        _fireWarnAt.set(key, now);
        // Find candidate ops that could form a loop:
        //   - MeasureOp (field write): trigger-on-field AND write-that-field
        //   - OccurrenceCreateOp / OccurrenceDeleteOp: trigger on the matching
        //     onAdd/onDelete event AND emit a CREATE/DELETE/COPY_LINK in
        //     their pipeline (occurrences_written via introspection).
        const ops = state.operations || [];
        let suspects = [];
        try {
          const fieldsById = {};
          for (const f of (state.fields || [])) fieldsById[f.id] = f;
          const opsById = {};
          for (const o of ops) opsById[o.id] = o;
          const introspect = analyzeAllOperations(opsById, { fieldsById });
          if (fieldId) {
            suspects = ops.filter(o => {
              const rec = introspect[o.id] || {};
              const triggers = (o.triggerObjects || []).some(t => t?.fieldId === fieldId);
              const writes = (rec.fields_written || []).includes?.(fieldId);
              return triggers && writes;
            }).map(o => o.name);
          } else if (transactionType === "OccurrenceCreateOp" || transactionType === "OccurrenceDeleteOp") {
            const wantEvent = transactionType === "OccurrenceCreateOp" ? "onAdd" : "onDelete";
            suspects = ops.filter(o => {
              const rec = introspect[o.id] || {};
              const triggers = (o.triggerObjects || []).some(t => t?.eventType === wantEvent);
              const mutates = (rec.occurrences_written || []).length > 0;
              return triggers && mutates;
            }).map(o => o.name);
          }
        } catch (_) { /* analysis is best-effort */ }
        console.warn(
          `[operations] fire depth cap hit (${_FIRE_DEPTH_LIMIT}) — skipping ${transactionType}. ` +
          `field="${field?.name || fieldId || "?"}" occ="${module?.label || occ?.label || occurrenceId || "?"}" value=${JSON.stringify(transaction?.value)}` +
          (suspects.length ? ` — candidate looping ops: ${suspects.join(", ")}` : ""),
          { transactionType, transaction, fieldId, occurrenceId, field, occ, module, suspects }
        );
      }
      return;
    }
    _fireDepth++;
    try {
      return _fireOperationsInner(transactionType, transaction, { occurrencesOverride });
    } finally {
      _fireDepth--;
    }
  }

  function _fireOperationsInner(transactionType, transaction, { occurrencesOverride } = {}) {
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

    // ── DIAG: fire entry log ────────────────────────────────────────────────
    // Each top-level fire (depth=1) logs trigger + matched-op preview so the
    // user can spot which trigger is producing the create flood. Nested fires
    // (depth>1) log condensed so cascades are visible without console spam.
    const _tFire0 = performance.now();
    const _diagDepth = _fireDepth;
    const _diagTriggerSummary = transaction ? (
      transaction.occurrenceId ? `occ=${String(transaction.occurrenceId).slice(0, 8)}` :
      transaction.fields ? `fields=${Object.keys(transaction.fields).map(s => s.slice(0, 6)).join(",")}` : "—"
    ) : "—";
    if (_diagDepth <= 2) {
      console.log(`[op-fire] depth=${_diagDepth} ${transactionType} ${_diagTriggerSummary}`);
    }

    // Cascade-dedup only applies to top-level (depth-1) fires — the burst of
    // NavigationOps from one filter change. Nested fires (effect-driven
    // MeasureOp/OccurrenceCreateOp) must NOT consult it or they'd be wrongly
    // skipped when an already-fired op legitimately re-runs under a new trigger.
    const cascadeFiredOps = _fireDepth === 1 ? _navCascadeFiredOps : null;
    const allUpdates = runMatchingOperations(operations, transactionType, transaction, { state, fieldsById: _cachedFieldsById, operationsById: _cachedOperationsById, occurrencesById, modulesById: _cachedModulesById, cascadeFiredOps }, { onError: (name, err) => toast.error(`Operation "${name}" failed`, { description: err?.message, duration: 4000 }) });

    // Separate display updates (computedValues) from real CRUD effects
    const displayUpdates = allUpdates.filter(u => !u._effect);
    const effects = allUpdates.filter(u => u._effect);

    // ── DIAG: per-op effect counts ─────────────────────────────────────────
    // Groups effects by their producing op and tallies by type. Reveals which
    // op is responsible for which slice of the work in a single line per op.
    if (effects.length > 0) {
      const byOp = new Map();
      for (const eff of effects) {
        const sid = eff._sourceOpId || "?";
        if (!byOp.has(sid)) byOp.set(sid, {});
        const counts = byOp.get(sid);
        counts[eff._effect] = (counts[eff._effect] || 0) + 1;
      }
      for (const [sid, counts] of byOp) {
        const op = _cachedOperationsById[sid];
        const opName = op?.name || String(sid).slice(0, 8);
        const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ");
        console.log(`[op-effects] depth=${_diagDepth} "${opName}" ${summary}`);
      }
    }

    if (displayUpdates.length > 0) {
      dispatch(setComputedValuesAction(displayUpdates));
    }
    // Mark EVERY op that produced effects in this batch as "applying" for the
    // WHOLE application phase (not per-effect). Any OccurrenceCreateOp/DeleteOp/
    // MeasureOp these effects synchronously fire (via createOccurrence /
    // deleteOccurrence / setOccurrenceFieldValue) then can't re-trigger ANY of
    // these ops — including cross-loops (Table→Canvas→Table). Per-effect marking
    // was too granular: while applying op A's effect, op B (also in this batch)
    // was unmarked and re-ran once per effect, re-creating occurrences in a loop.
    // Ops with a DIFFERENT trigger that didn't run in this batch are NOT marked,
    // so legitimate A→B cross-trigger chains still fire.
    const batchOpIds = [...new Set(effects.map(e => e._sourceOpId).filter(Boolean))];
    for (const sid of batchOpIds) setOpApplyingEffects(sid, true);
    try {
      for (const eff of effects) {
        applyOperationEffect(eff, state);
      }
    } finally {
      for (const sid of batchOpIds) setOpApplyingEffects(sid, false);
    }

    if (_diagDepth <= 2 && effects.length > 0) {
      console.log(`[op-fire-done] depth=${_diagDepth} ${transactionType} ${Math.round(performance.now() - _tFire0)}ms total=${effects.length} display=${displayUpdates.length}`);
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

  // Fire a burst of related transactions (e.g. the NavigationOp fan-out a
  // single filter change emits — source page + every inheriting descendant)
  // as ONE cascade: each matching op runs only once across the whole burst.
  // The fresh per-call Set means independent filter changes never dedup
  // against each other. Routes through the optimistic path so each
  // occurrence's filterOverride echo is still de-duplicated.
  function fireOperationsBatch(transactionType, transactions) {
    if (!Array.isArray(transactions) || transactions.length === 0) return;
    const prev = _navCascadeFiredOps;
    _navCascadeFiredOps = new Set();
    try {
      for (const t of transactions) fireOperationsOptimistic(transactionType, t);
    } finally {
      _navCascadeFiredOps = prev;
    }
  }

  // Drop-batch: collect all top-level op fires during a drop, then flush
  // them after rAF so the browser can paint the committed drop first.
  operationsBridge.beginDropBatch = () => { _dropBatchFires = []; };
  operationsBridge.endDropBatch = () => {
    const batch = _dropBatchFires;
    _dropBatchFires = null;
    if (!batch || batch.length === 0) return;
    requestAnimationFrame(() => {
      for (const { transactionType, transaction, occurrencesOverride } of batch) {
        fireOperations(transactionType, transaction, { occurrencesOverride });
      }
    });
  };

  // Expose on module-level bridge so CommitHelpers can call optimistically
  operationsBridge.fireOperations = fireOperationsOptimistic;
  operationsBridge.fireOperationsBatch = fireOperationsBatch;
  operationsBridge.updateLocalOcc = (occ) => { if (occ?.id) localOccsById[occ.id] = occ; };
  operationsBridge.removeLocalOcc = (occurrenceId) => { delete localOccsById[occurrenceId]; };
  operationsBridge.getLocalOcc = (occurrenceId) => localOccsById[occurrenceId] || null;
  // Read-only access to the current modules map. Used by
  // CommitHelpers.createOccurrence's auto-bind to look up the source module
  // without forcing every caller to thread state through. No mirror cache
  // for modules (unlike `localOccsById`) — modules change rarely, so reading
  // directly off the latest snapshot is fine.
  operationsBridge.getLocalMod = (moduleId) => {
    if (!moduleId) return null;
    const s = stateRef.current;
    // `modulesById` is a derived lookup built by `createLookupsFromState` —
    // it's NOT on the raw redux state. Scan `state.modules` (the array of
    // truth) for the id; small enough that the linear scan is fine for the
    // once-per-drop auto-bind path.
    const mods = s?.modules;
    if (!Array.isArray(mods)) return null;
    return mods.find(m => m?.id === moduleId) || null;
  };
  operationsBridge.getLinkedOccs = (linkedGroupId, excludeId) => {
    if (!linkedGroupId) return [];
    const out = [];
    for (const o of Object.values(localOccsById)) {
      if (o?.linkedGroupId === linkedGroupId && o.id !== excludeId) out.push(o);
    }
    return out;
  };
  // Compute the ancestor chain for an occurrence: returns { ids, labels }
  // closest-first. Powers ancestor-scoped triggers (ancestorLabel:"Daily Goals")
  // on onAdd/onDelete/onMove — the executor's matchAncestorScope reads
  // `transaction._ancestorIds`/`_ancestorLabels` to gate match. Walks via
  // each occurrence's `occurrences[]` reverse map (with parentId fallback) so
  // page/panel parents (which usually have no parentId) are still seen.
  operationsBridge.getAncestorChain = (occId) => {
    const ids = [];
    const labels = [];
    if (!occId) return { ids, labels };
    // Build a parent-by-child reverse map from the live overlay.
    const parentByChildId = {};
    for (const o of Object.values(localOccsById)) {
      for (const childId of o?.occurrences || []) {
        parentByChildId[childId] = o.id;
      }
    }
    const mods = stateRef.current?.modules;
    const modById = {};
    if (Array.isArray(mods)) {
      for (const m of mods) if (m?.id) modById[m.id] = m;
    }
    let cur = localOccsById[occId];
    const seen = new Set();
    let depth = 0;
    while (cur && !seen.has(cur.id) && depth++ < 20) {
      seen.add(cur.id);
      ids.push(cur.id);
      const label = modById[cur.moduleId]?.label;
      if (label) labels.push(label);
      const nextId = parentByChildId[cur.id] ?? cur.parentId;
      cur = nextId ? localOccsById[nextId] : null;
    }
    return { ids, labels };
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



  // Pipeline IMPORT_HTML / IMPORT_MARKDOWN bridge. Emits the existing
  // `import_text` socket event (server/socketHandlers/import.js) and
  // returns a Promise that resolves with `{ rootOccurrenceId, stats }`
  // when the matching `import_text_result` acks. The server broadcasts
  // module_created + occurrence_created for every minted entity in the
  // same flow, which the existing store handlers absorb — pipeline
  // callers only need the root id to chain MOVE_OCCURRENCE / UPDATE
  // steps against the imported subtree.
  operationsBridge.importText = ({ content, format = "auto", parentId = null, title = "Imported", htmlOpts = {}, timeoutMs = 60000 } = {}) => {
    return new Promise((resolve, reject) => {
      if (!content) { reject(new Error("IMPORT: content required")); return; }
      const stateNow = stateRef?.current || {};
      const gridId = stateNow.gridId || stateNow.grid?._id;
      if (!gridId) { reject(new Error("IMPORT: no active gridId")); return; }
      if (typeof socket?.emit !== "function") { reject(new Error("IMPORT: socket unavailable")); return; }
      const requestId = (crypto?.randomUUID?.() || `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const timer = setTimeout(() => {
        socket.off?.("import_text_result", onResult);
        reject(new Error("IMPORT timed out"));
      }, Math.min(120000, Math.max(1000, Number(timeoutMs) || 60000)));
      const onResult = (resp) => {
        if (!resp || resp.requestId !== requestId) return;
        clearTimeout(timer);
        socket.off?.("import_text_result", onResult);
        if (resp.ok) {
          resolve({ rootOccurrenceId: resp.rootOccurrenceId, stats: resp.stats || {}, detectedFormat: resp.detectedFormat || format });
        } else {
          reject(new Error(`IMPORT failed: ${resp.error || "unknown error"}`));
        }
      };
      socket.on("import_text_result", onResult);
      socket.emit("import_text", {
        content, format, gridId, parentId, title, htmlOpts, requestId,
      });
    });
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

    // Resolve a human-readable name for any occurrence id by walking
    // occurrence → targetId → module.label. Falls back to the
    // occurrence's own label if the module isn't loaded yet, or to a
    // short id tail if neither is available.
    const nameForOcc = (id) => {
      if (!id) return "";
      const occ = occurrencesById[id];
      if (!occ) return id.slice(0, 6);
      return (
        modulesById[occ.targetId]?.label ||
        modulesById[occ.moduleId]?.label ||
        occ.label ||
        id.slice(0, 6)
      );
    };
    const nameForModule = (id) => {
      if (!id) return "";
      return modulesById[id]?.label || id.slice(0, 6);
    };

    // Build a parent reverse map so we can walk an occurrence up to its
    // container + page for "chain" display in toasts.
    const parentByChild = {};
    for (const occ of Object.values(occurrencesById)) {
      for (const childId of occ?.occurrences || []) parentByChild[childId] = occ.id;
    }
    // Returns "Page › Container" (or whatever non-grid ancestors exist)
    // for an occurrence id, omitting the occurrence itself. Stops at the
    // first ancestor whose module has role:"page" so the chain stays short
    // and meaningful. Returns "" when no chain can be built.
    const chainForOcc = (id) => {
      if (!id) return "";
      const labels = [];
      let cur = parentByChild[id] || occurrencesById[id]?.parentId;
      const seen = new Set();
      let depth = 0;
      while (cur && !seen.has(cur) && depth++ < 8) {
        seen.add(cur);
        const occ = occurrencesById[cur];
        if (!occ) break;
        const mod = modulesById[occ.moduleId] || modulesById[occ.targetId];
        const label = mod?.label || occ.label;
        if (label) labels.unshift(label);
        // Stop after we've passed the page level so we don't surface the
        // panel/grid scaffolding.
        if (mod?.role === "page") break;
        cur = parentByChild[cur] || occ.parentId;
      }
      return labels.join(" › ");
    };

    const ops = transaction.operations || [];
    if (transaction.type === "MeasureOp" && ops.length > 0) {
      const op = ops[0];
      const m = op?.measure || {};
      const field = fieldsById[m.fieldId];
      const fieldName = field?.name || "Field";
      const prev = m.previousValue;
      const next = m.value;
      // Skip the chip when nothing actually changed — the executor still
      // fires MeasureOp on every write (used by trigger plumbing) so we'd
      // otherwise stack a "Field: 1 → 1" chip on every idempotent write.
      // Value-aware compare: primitives via String, objects/arrays via JSON.
      // The old `String(prev) === String(next)` collapsed EVERY object value to
      // "[object Object]" — so occurrence pickers, multi-selects, and the mood
      // wheel (all object/array-valued) read as "unchanged" and never notified,
      // even though amounts (primitive) did. That was the "other inputs don't
      // send notifications" bug.
      const isObj = (v) => v != null && typeof v === "object";
      const sameValue = (isObj(prev) || isObj(next))
        ? (() => { try { return JSON.stringify(prev ?? null) === JSON.stringify(next ?? null); } catch { return false; } })()
        : String(prev ?? "") === String(next ?? "");
      if (!sameValue) {
        const occName = nameForOcc(m.occurrenceId) || nameForModule(m.instanceId);
        const chain = chainForOcc(m.occurrenceId);
        // Readable description: primitive transitions show "prev → next";
        // object/array values (no useful inline form) show a count or "updated".
        const fmtVal = (v) => {
          if (v == null) return "";
          if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
          if (typeof v === "object") return "updated";
          return String(v);
        };
        const desc = (!isObj(prev) && !isObj(next) && prev != null)
          ? `${fmtVal(prev)} → ${fmtVal(next)}`
          : fmtVal(next);
        const head = chain ? `${chain} · ${occName}` : occName;
        const label = head
          ? `${head} · ${fieldName}: ${desc}`
          : `${fieldName}: ${desc}`;
        pushTxNotification({ kind: "success", label });
      }
    } else if (transaction.type === "OccurrenceListOp" && ops.length > 0) {
      const op = ops[0];
      const ol = op?.occurrence_list || {};
      const what = nameForOcc(ol.occurrenceId) || nameForModule(ol.instanceId) || "item";
      const chainFrom = chainForOcc(ol.from?.containerId);
      const chainTo = chainForOcc(ol.to?.containerId);
      const fromName = [chainFrom, nameForOcc(ol.from?.containerId)].filter(Boolean).join(" › ");
      const toName = [chainTo, nameForOcc(ol.to?.containerId)].filter(Boolean).join(" › ");
      let label;
      switch (ol.action) {
        case "copy":
          label = toName ? `Copied "${what}" to ${toName}` : `Copied "${what}"`;
          break;
        case "add":
          label = toName ? `Added "${what}" to ${toName}` : `Added "${what}"`;
          break;
        case "remove":
          label = fromName ? `Removed "${what}" from ${fromName}` : `Removed "${what}"`;
          break;
        case "move":
        default:
          if (fromName && toName) label = `Moved "${what}": ${fromName} → ${toName}`;
          else if (toName) label = `Moved "${what}" to ${toName}`;
          else label = `Moved "${what}"`;
      }
      pushTxNotification({ kind: "success", label });
    } else if (transaction.type === "EntityOp" && ops.length > 0) {
      const op = ops[0];
      const e = op?.entity || {};
      const verbMap = { create: "Created", update: "Updated", delete: "Deleted" };
      const verb = verbMap[e.action] || "Changed";
      const type = e.entityType || "entity";
      const name =
        e.data?.label ||
        e.data?.name ||
        e.previousData?.label ||
        e.previousData?.name ||
        nameForModule(e.entityId) ||
        nameForOcc(e.entityId) ||
        "(unnamed)";
      const chain = chainForOcc(e.entityId);
      const head = chain ? `${chain} · ${name}` : name;
      pushTxNotification({ kind: "success", label: `${verb} ${type}: ${head}` });
    } else if (transaction.type === "DocEditOp" && ops.length > 0) {
      const op = ops[0];
      const occId = op?.doc_edit?.occurrenceId;
      const occName = nameForOcc(occId);
      const chain = chainForOcc(occId);
      const head = [chain, occName].filter(Boolean).join(" › ");
      pushTxNotification({ kind: "success", label: head ? `Edited "${head}"` : "Doc edited" });
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
    operationsBridge.fireOperationsBatch = null;
    operationsBridge.updateLocalOcc = null;
    operationsBridge.removeLocalOcc = null;
    operationsBridge.getLocalOcc = null;
    operationsBridge.getLocalMod = null;
    operationsBridge.getLinkedOccs = null;
    operationsBridge.getAncestorChain = null;
    operationsBridge.applyEffect = null;
    operationsBridge.importText = null;
    operationsBridge.beginDropBatch = null;
    operationsBridge.endDropBatch = null;
    _dropBatchFires = null;
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
    socket.off("occurrence_stale", onOccurrenceStale);
    socket.off("occurrence_persisted", onOccurrencePersisted);
    socket.off("occurrence_field_conflict", onOccurrenceFieldConflict);
    socket.off("occurrence_deleted", onOccurrenceDeleted);

    socket.off("field_created", onFieldCreated);
    socket.off("field_updated", onFieldUpdated);
    socket.off("field_deleted", onFieldDeleted);

    socket.off("grid_updated", onGridUpdated);
    socket.off("grid_deleted", onGridDeleted);
    socket.off("grid_created", onGridCreated);

    socket.off("folder_created", onFolderCreated);
    socket.off("folder_updated", onFolderUpdated);
    socket.off("folder_deleted", onFolderDeleted);
    socket.off("view_created", onViewCreated);
    socket.off("view_updated", onViewUpdated);
    socket.off("view_deleted", onViewDeleted);
    socket.off("manifest_created", onManifestCreated);
    socket.off("manifest_updated", onManifestUpdated);
    socket.off("manifest_deleted", onManifestDeleted);
    socket.off("operation_created", onOperationCreated);
    socket.off("operation_updated", onOperationUpdated);
    socket.off("operation_deleted", onOperationDeleted);

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