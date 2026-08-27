// client/src/state/bindSocketToStore.js
// =========================================
// bindSocketToStore.js — CLEAN + CONSISTENT
// ✅ UPDATED for no-echo rooms:
// - Other windows must self-heal if their active grid is deleted.
// =========================================

import { ActionTypes } from "./actions";
import { runMatchingOperations, executeOperation, executePipeline, setOpApplyingEffects } from "../helpers/operationExecutor";
import { kindForNewModule } from "../helpers/operationActions";
import { setComputedValuesAction, createModuleAction, updateModuleAction, deleteModuleAction, createOccurrenceAction, initFilterNavAction, setFilterNavAction, updateGridAction } from "./actions";
import { toast, pushTxNotification } from "./notificationStore";
import { afterPaint } from "../helpers/afterPaint";
import { makeOpNotificationCallbacks } from "../helpers/opResultSummary";
import { syncAllFeeds } from "../helpers/feedSync";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import {
  setOccurrenceFieldValue,
  moveOccurrence,
  createOccurrenceInContainer,
  createInstanceInContainer,
  deleteOccurrence,
  updateModule,
  deleteModule,
  updateOccurrence,
  updateOccurrenceFilterOverride,
  ensureModuleBindingsForOccurrenceFields,
} from "../helpers/CommitHelpers";
import { flushOfflineQueue, safeEmit } from "../helpers/offlineQueue";
import { beginAction, endAction, setActionCloseHook, captureAction, retainAction, releaseAction, runInAction, runDerived } from "../helpers/actionScope";
import { requestForceSync, commitForceSync } from "../helpers/editorSyncSignal";
import { startLoadDiag, markLoad, timeLoad } from "../helpers/loadDiag";
import { whenStagedFirstRelease } from "../helpers/stagedMount";
import { buildReverseMap, findGridPanelOcc } from "../helpers/occurrenceHelpers";
import { migrateFieldOptionsSource, needsMigration } from "./migrateFieldOptionsSource";
import { analyzeAllOperations } from "../helpers/operationIntrospection";
import { persistAuth, clearAuth } from "../helpers/authStorage.js";

/**
 * Module-level bridge so CommitHelpers can fire operations immediately
 * after optimistic dispatch (no server round-trip needed).
 */
export const operationsBridge = { fireOperations: null, fireOperationsBatch: null, updateLocalOcc: null, removeLocalOcc: null, getLocalOcc: null, getLocalMod: null, getFilterContext: null, getLinkedOccs: null, getAncestorChain: null, applyEffect: null, requestUserInput: null, importText: null, beginDropBatch: null, endDropBatch: null, markDerivedOcc: null, scheduleFeedSync: null };

// Pure decision half of the SET_FILTER effect, so it can be tested without a
// socket. `filterNavState` drives the nav WIDGET; `grid.activeFilterValues`
// drives the filter CASCADE (isOccurrenceVisible) — an op must write BOTH or it
// moves the date display without actually filtering anything.
// Returns null when there is nothing to do; the no-op guard is what keeps an
// onLoad op from looping on its own write.
export function applySetFilterEffect(effect, state) {
  const key = effect?.filterId || effect?.fieldId;
  if (!key) return null;
  const value = effect.value;
  const currentNav = state?.filterNavState?.[key];
  const currentGrid = state?.grid?.activeFilterValues?.[key];
  const gridMatches = currentGrid === value
    || (currentGrid && typeof currentGrid === "object" && currentGrid.value === value);
  if (currentNav === value && gridMatches) return null;
  return {
    navValue: { key, value },
    gridPatch: { activeFilterValues: { ...(state?.grid?.activeFilterValues || {}), [key]: value } },
    gridId: state?.grid?._id || null,
  };
}

// ── id-map cache, keyed on the SOURCE ARRAY's identity ──────────────────────
// The reducer swaps `state.fields` / `state.modules` for a new array on every
// write, so array identity IS the version — no invalidation to get wrong, and
// a WeakMap lets a superseded array be collected. Used by the transaction-toast
// path, which was rebuilding these maps on every single transaction (51 of them
// for one `Completed` toggle on poms grid, over 6,557 modules each time).
const _byIdCache = new WeakMap();
export function byIdCached(arr) {
  if (!Array.isArray(arr)) return {};
  const hit = _byIdCache.get(arr);
  if (hit) return hit;
  const out = {};
  for (const x of arr) if (x?.id) out[x.id] = x;
  _byIdCache.set(arr, out);
  return out;
}

export function bindSocketToStore(socket, dispatch, stateRef = { current: {} }) {
  // Wrap dispatch to tag all socket-originated actions
  // This prevents BroadcastChannel from re-broadcasting server events
  const socketDispatch = (action) => dispatch({ ...action, _fromSocket: true });

  // Local occurrence cache — updated synchronously on each occurrence event,
  // BEFORE React re-renders stateRef.current. Used by fireOperations so that
  // onChange operations always see the latest occurrence values even when the
  // React render cycle hasn't completed yet.
  const localOccsById = {};
  // Cache slots for the base+local merge built in _fireOperationsInner. See the
  // comment there for why this is fingerprinted rather than version-counted.
  let _mergedOccsById = null;
  let _mergedBase = null;
  let _mergedLocalKeys = null;
  let _mergedLocalVals = null;

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
  // ── FEED SYNC SCHEDULER (2026-07-07) ──────────────────────────────────────
  // Debounced full-grid feed reconciliation (helpers/feedSync.js). Runs after
  // full_state settles, after filter changes, and after occurrence CRUD
  // bursts — the trigger surface the old Table:/Canvas: Build ops declared,
  // covered once here. Idempotent + zero-write when nothing changed, so an
  // eager schedule is cheap and the mint→echo→schedule chain self-quiets.
  let _feedSyncTimer = null;
  const scheduleFeedSync = (delay = 300) => {
    if (_feedSyncTimer) clearTimeout(_feedSyncTimer);
    _feedSyncTimer = setTimeout(() => {
      _feedSyncTimer = null;
      try {
        const state = stateRef.current || {};
        const occs = {};
        for (const o of state.occurrences || []) if (o?.id) occs[o.id] = o;
        Object.assign(occs, localOccsById);
        const mods = {};
        for (const m of state.modules || []) if (m?.id) mods[m.id] = m;
        syncAllFeeds({ state, occurrencesById: occs, modulesById: mods, dispatch, socket });
      } catch (e) {
        console.warn("[feedSync] pass failed:", e);
      }
    }, delay);
  };

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
    startLoadDiag();
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

    timeLoad("dispatch", () => socketDispatch({ type: ActionTypes.FULL_STATE, payload }));

    // The replacement state is in the store now, so a pending undo force-sync
    // can be released: mounted editors re-render with the reverted content AND
    // the bumped token, and accept it despite their echo guards. No-op unless
    // an undo/redo actually requested one.
    commitForceSync();

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
    timeLoad("filterNav", () => dispatch(initFilterNavAction(navMap)));

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
          // THE KEY IS `grid`, NOT `patch` — see the SET_FILTER emit below.
          safeEmit(socket, "update_grid", { gridId: grid._id || payload.gridId, grid: { activeFilterValues: patch } });
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

    // Defer operation execution until after the first paint so the grid renders
    // immediately. rAF then a MACROTASK: a rAF callback still runs before that
    // frame's paint, so a nested rAF only guarantees "a frame later", not "after
    // the pixels landed" — and with the sweep costing 0.5s (2.5s throttled) that
    // difference is the whole wait. Measured with a CDP screencast: the chrome
    // was committed and unpainted for 7.7s because this ran first.
    // ── THE LOAD SWEEP IS THE APP'S OWN BOOKKEEPING, NOT A USER ACTION ────
    //
    // Every write helper opens an action, so each tracker tile this sweep
    // recomputes became its own undo step. Measured on the live grid, a page
    // load with NOTHING clicked: 26-29 transactions on the undo stack, 0
    // derived, one document each — so after a reload Ctrl+Z reverted a tracker
    // recomputation instead of the last thing the user did. A second load
    // immediately after the first still wrote 26, which is the control that
    // rules out the sweep merely catching up on stale state.
    //
    // `runDerived` covers the deferred cascade too: `captureAction` carries
    // the derived scope across the paint boundary exactly as it carries an
    // action id, so the continuation cannot re-open one.
    whenStagedFirstRelease(() => requestAnimationFrame(() => setTimeout(() => runDerived(() => {
      const tOps0 = performance.now();
      // Overlay localOccsById on top of the payload snapshot. Between full_state
      // dispatch and this deferred callback, React's filterNavState useEffect
      // may already have fired a NavigationOp synchronously — that pipeline
      // pass mutates localOccsById with its optimistic CREATE_ITEM stubs.
      // Without this overlay, the onLoad fire below reads stale occurrences
      // and re-creates the same items the NavigationOp pass already created.
      const overlay = Object.assign({}, occurrencesById, localOccsById);
      markLoad("ops:start", { ops: operations.length });
      const allUpdates = runMatchingOperations(operations, null, null, { state: hydratedState, fieldsById, operationsById, occurrencesById: overlay, modulesById },
        makeOpNotificationCallbacks(pushTxNotification, () => ({ fieldsById, occurrencesById: Object.assign({}, occurrencesById, localOccsById), modulesById })));
      const tOps1 = performance.now();
      markLoad("ops:end", { ms: +(tOps1 - tOps0).toFixed(1) });
      const displayUpdates = allUpdates.filter(u => !u._effect);
      const effects = allUpdates.filter(u => u._effect);
      console.log(`[full_state-client] runMatchingOperations: ${Math.round(tOps1 - tOps0)}ms — ${operations.length} ops, ${effects.length} effects, ${displayUpdates.length} display updates`);
      if (displayUpdates.length > 0) {
        dispatch(setComputedValuesAction(displayUpdates));
      }
      // ONE EFFECT MUST NOT TAKE THE REST DOWN.
      //
      // This loop was unguarded, so the FIRST effect to throw silently discarded
      // every effect after it — for the whole load. That is the daily
      // half-built schedule: measured on the live grid 2026-08-20, the day
      // column and its slots were created in one burst at 11:53:34 and stopped
      // dead **18 of 49 in, after 8 seconds**, with the server reporting NO
      // skipped and NO aborted creates. Nothing was lost in flight; the client
      // simply stopped emitting, at the same point every day.
      //
      // Guarding per effect does not fix whatever throws — it stops one failure
      // becoming thirty-one, and it NAMES the effect, which is the thing nobody
      // could see before. A silent partial build is indistinguishable from a
      // slow one; a logged one is a bug report.
      let effectErrors = 0;
      for (const eff of effects) {
        try {
          applyOperationEffect(eff, hydratedState);
        } catch (err) {
          effectErrors++;
          console.error(
            `[full_state-client] effect ${eff?._effect} threw — continuing with the rest`,
            err, eff,
          );
        }
      }
      if (effectErrors) {
        console.error(`[full_state-client] ${effectErrors} of ${effects.length} effect(s) threw`);
      }
      markLoad("effects:end", { count: effects.length, ms: +(performance.now() - tOps1).toFixed(1) });
      console.log(`[full_state-client] applied effects in ${Math.round(performance.now() - tOps1)}ms`);
      // Flush any mutations queued while offline — replayed on top of fresh server state
      flushOfflineQueue(socket);
      // Materialize feeds once the load sweep's creates have settled.
      scheduleFeedSync(400);
    }), 50)));
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

  // Undo/redo, SLOW PATH: the server could not express the restore as a keyed
  // patch (a grid snapshot, an unknown model) and asks for a full re-hydrate.
  // Mark a force-sync pending so mounted editors accept the reverted content
  // when it lands; without it their echo guards (focus / recently-typed) reject
  // an undo outright and the revert never reaches the screen.
  const onSyncState = () => {
    requestForceSync();
    socket.emit("request_full_state");
  };
  socket.on("sync_state", onSyncState);

  // Undo/redo, FAST PATH — the documents that actually changed.
  //
  // This used to BE `sync_state` for every undo, and undoing one checkbox took
  // ~26 seconds to settle: a 21,039-occurrence cache reload, a full_state
  // re-hydrate, and then the onLoad op sweep it provokes writing ~30
  // occurrences back, each minting a transaction and echoing.
  //
  // ── IT DELIBERATELY FIRES NO OPERATIONS ──────────────────────────────────
  // `onOccurrenceUpdated` fires a MeasureOp on any field change, which is right
  // for someone else's edit and WRONG here: a write and its whole operation
  // cascade are one action, so the snapshots being restored already contain
  // everything those operations derived. Re-running them recomputes what the
  // undo just reverted, and their writes mint new transactions the user never
  // made. So this applies to the store directly rather than reusing the CRUD
  // handlers.
  const UNDO_DISPATCH = {
    occurrence: (doc) => ({ type: ActionTypes.UPDATE_OCCURRENCE, payload: { occurrence: doc } }),
    field:      (doc) => ({ type: ActionTypes.UPDATE_FIELD,      payload: { field: doc } }),
    view:       (doc) => ({ type: ActionTypes.UPDATE_VIEW,       payload: { view: doc } }),
    folder:     (doc) => ({ type: ActionTypes.UPDATE_FOLDER,     payload: { folder: doc } }),
    manifest:   (doc) => ({ type: ActionTypes.UPDATE_MANIFEST,   payload: { manifest: doc } }),
    operation:  (doc) => ({ type: ActionTypes.UPDATE_OPERATION,  payload: { operation: doc } }),
  };
  const UNDO_DELETE = {
    occurrence: (id) => ({ type: ActionTypes.DELETE_OCCURRENCE, payload: { occurrenceId: id } }),
    field:      (id) => ({ type: ActionTypes.DELETE_FIELD,      payload: { fieldId: id } }),
    view:       (id) => ({ type: ActionTypes.DELETE_VIEW,       payload: { viewId: id } }),
    folder:     (id) => ({ type: ActionTypes.DELETE_FOLDER,     payload: { folderId: id } }),
    manifest:   (id) => ({ type: ActionTypes.DELETE_MANIFEST,   payload: { manifestId: id } }),
    operation:  (id) => ({ type: ActionTypes.DELETE_OPERATION,  payload: { operationId: id } }),
  };
  const onUndoApplied = ({ docs } = {}) => {
    // No list means the server could not describe the restore. Fall back to the
    // slow path rather than silently applying nothing — an undo that does not
    // reach the screen reads as an undo that did not happen.
    if (!Array.isArray(docs) || docs.length === 0) { onSyncState(); return; }
    requestForceSync();
    for (const { model, id, doc } of docs) {
      if (!id) continue;
      if (doc == null) {
        if (model === "module") { socketDispatch(deleteModuleAction(id)); continue; }
        const del = UNDO_DELETE[model];
        if (del) socketDispatch(del(id));
        if (model === "occurrence") delete localOccsById[id];
        continue;
      }
      if (model === "module") { socketDispatch(updateModuleAction(doc)); continue; }
      const make = UNDO_DISPATCH[model];
      if (!make) continue;
      // Keep the local overlay current before React re-renders from it — the
      // same order `onOccurrenceUpdated` uses.
      if (model === "occurrence") localOccsById[id] = doc;
      socketDispatch(make(doc));
    }
    scheduleFeedSync();
  };
  socket.on("undo_applied", onUndoApplied);

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
  // Burst detector for bulk occurrence_created floods (Wikipedia/markdown imports,
  // cross-window mass creates). The server echoes one event per minted entity; a
  // big import is 200+. The per-entity trigger path below rebuilds the whole
  // occurrence map + reverse map (O(N)) AND runs every operation, so the flood is
  // O(N²) of SYNCHRONOUS work → the main thread blocks for the entire import (the
  // UI + the assistant progress timer visibly freeze). A bulk echo is not user
  // automation, so once we're clearly in a burst we skip the per-entity trigger.
  let _createBurstCount = 0;
  let _createBurstResetTimer = null;
  const CREATE_BURST_THRESHOLD = 12;  // > this many creates within the window → bulk
  const CREATE_BURST_WINDOW_MS = 300;
  function _noteCreateBurst() {
    _createBurstCount++;
    if (_createBurstResetTimer) clearTimeout(_createBurstResetTimer);
    _createBurstResetTimer = setTimeout(() => { _createBurstCount = 0; _createBurstResetTimer = null; }, CREATE_BURST_WINDOW_MS);
  }
  function _inCreateBurst() { return _createBurstCount > CREATE_BURST_THRESHOLD; }

  function onOccurrenceCreated({ occurrence } = {}) {
    scheduleFeedSync();
    if (!occurrence?.id) return;

    // Keep local cache current before React re-renders stateRef
    localOccsById[occurrence.id] = occurrence;

    socketDispatch({
      type: ActionTypes.CREATE_OCCURRENCE,
      payload: { occurrence },
    });

    // Fire onCreate trigger with context from the new occurrence.
    // Skip the fire when (a) THIS client already fired it optimistically /
    // op-emitted it (server own-echo — without this guard an op-created occurrence
    // re-fires OccurrenceCreateOp at depth 0 → unbounded async create loop), OR
    // (b) we're in a BULK BURST (import / mass create — see _noteCreateBurst). The
    // O(N) label resolution below runs ONLY inside the fire branch now, so echoes
    // AND bursts pay nothing — that's what un-freezes the import.
    _noteCreateBurst();
    if (!optimisticFiredSet.has(occurrence.id) && !opEmittedOccIds.has(occurrence.id) && !_inCreateBurst()) {
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
    scheduleFeedSync();
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
    scheduleFeedSync();
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
        // Trigger-context snapshot — see CommitHelpers.deleteOccurrence.
        _occurrenceSnapshot: removedOcc || null,
      });
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
      scheduleFeedSync();
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

    persistAuth({ token, userId });

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
    clearAuth();
    socketDispatch({ type: ActionTypes.LOGOUT });
  }

  function onConnectError(err) {
    const msg = err?.message;
    console.log("[socket] connect_error:", msg);

    if (msg === "INVALID_TOKEN" || msg === "USER_NOT_FOUND") {
      clearAuth();

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

      case "UPDATE_ITEM_FIELD_VISIBILITY": {
        // Per-occurrence {mode, fieldIds} — which of a tile's bound fields
        // actually render. `fieldVisibility` is a declared top-level key on the
        // Occurrence schema, so the generic update_occurrence persists it; this
        // goes through the same updateOccurrence helper as ownStyle above rather
        // than a bespoke socket event.
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        if (!occ) break;
        const nextVis = effect.value ?? null;
        localOccsById[effect.itemId] = { ...occ, fieldVisibility: nextVis };
        updateOccurrence({ dispatch: socketDispatch, socket, occurrence: { id: effect.itemId, fieldVisibility: nextVis } });
        break;
      }

      case "UPDATE_ITEM_FILTER_OVERRIDE": {
        // Move (or clear, with a null value) one key of an occurrence's own
        // filter override. Goes through updateOccurrenceFilterOverride so the
        // NavigationOp cascade fires for this occurrence AND every descendant
        // still inheriting — the same path a nav widget takes.
        const occOverlay = { ...(state.occurrencesById || {}), ...localOccsById };
        const occ = occOverlay[effect.itemId];
        if (!occ || !effect.fieldId) break;
        const nextOverride = { ...(occ.filterOverride || {}) };
        if (effect.value == null) delete nextOverride[effect.fieldId];
        else nextOverride[effect.fieldId] = effect.value;
        localOccsById[effect.itemId] = { ...occ, filterOverride: nextOverride };
        updateOccurrenceFilterOverride({
          dispatch: socketDispatch, socket,
          // `id`, NOT `occurrenceId` — the helper destructures `{ id }` and
          // bails on `if (!id) return`. Passing the wrong key made this whole
          // effect a silent no-op, so NO operation could ever move a page's
          // filter override. That is why `Grid: Snap Filter To Today` stamped
          // its "Last Opened" marker every morning (a plain UPDATE_ITEM_FIELD,
          // which works) while the Day Page and Schedule pages stayed pinned to
          // the previous day — and why the day column for today never built.
          // Every UI call site (ui/FiltersSection.jsx) already passes `id`,
          // which is why navigating a date BY HAND always worked.
          id: effect.itemId,
          filterOverride: nextOverride,
          occurrencesById: occOverlay,
          modulesById: state.modulesById,
          navFieldId: effect.fieldId,
          date: effect.value,
        });
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
          // A CLONE emits `kind: srcMod.kind`, so a kindless template arrives
          // here as undefined. Defaulting that to "doc" is what minted 232
          // inert `instance/doc` modules on the live grid between 2026-08-02
          // and 08-11 — the 2026-07-29 kind removal was fixed in the CREATE
          // action and never here. One shared rule now, so the two cannot
          // disagree again.
          const newRole = effect.template.role || "container";
          const newKind = kindForNewModule(newRole, effect.template.kind);
          const newModule = {
            id: effect.template.id,
            role: newRole,
            ...(newKind ? { kind: newKind } : {}),
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

      case "SCROLL_TO": {
        // An onLoad op runs during hydration, so the target is usually NOT in
        // the DOM yet — its page may still be mounting (measured: a schedule
        // slot appears well after the sweep). jumpToOccurrence returns false
        // when it can't find the node, so poll until it lands, then stop.
        // Bounded so a target that never renders (page not open in any panel)
        // costs a handful of cheap lookups and gives up silently.
        if (!effect.itemId) break;
        const { itemId, block } = effect;
        let tries = 0;
        const attempt = () => {
          if (jumpToOccurrence(itemId, { scrollBlock: block || "center" })) return;
          if (++tries < 24) setTimeout(attempt, 250);   // up to ~6s
        };
        setTimeout(attempt, 250);
        break;
      }

      case "SET_FILTER": {
        const plan = applySetFilterEffect(effect, state);
        if (!plan) break;
        socketDispatch(setFilterNavAction(plan.navValue.key, plan.navValue.value));
        if (plan.gridId) {
          socketDispatch(updateGridAction({ gridId: plan.gridId, grid: plan.gridPatch }));
          // THE PAYLOAD KEY IS `grid`, AND SENDING `patch` SILENTLY DID NOTHING.
          // `update_grid` reads the patch from `payload.grid`, falling back to
          // the top-level rest of the payload — so `{ gridId, patch: {...} }`
          // resolved to `{ patch: {...} }`, which Mongoose strict mode drops
          // whole. The local dispatch still moved, so the date changed on
          // screen and reverted on the next load when `full_state` sent the
          // stored value back. `CommitHelpers.updateGrid` has always used
          // `grid`, and its test pins that shape; these two emits were the
          // outliers. Measured 2026-08-18: grid filter stuck nine days back
          // while the client showed today.
          safeEmit(socket, "update_grid", { gridId: plan.gridId, grid: plan.gridPatch });
        }
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

  function fireOperations(transactionType, transaction) {
    // During a drop batch (beginDropBatch active), collect top-level fires instead
    // of executing them synchronously. endDropBatch flushes them after rAF so the
    // browser paints the visual drop result before any operation work runs.
    if (_dropBatchFires !== null && _fireDepth === 0) {
      _dropBatchFires.push({ transactionType, transaction });
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
      return _fireOperationsInner(transactionType, transaction);
    } finally {
      _fireDepth--;
    }
  }

  function _fireOperationsInner(transactionType, transaction) {
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
    // Deleted occurrences are NOT re-injected here — a delete transaction
    // carries its own `_occurrenceSnapshot` for $trigger.occurrence enrichment
    // (operationExecutor), so tracker recounts see post-delete state.
    //
    // ── THE MERGE IS CACHED, because it was the largest cost in the sweep ──
    // Everything above this line is already keyed on an array identity; this
    // last step was not, and it copies **21,766 keys** on poms grid. One
    // `Completed` toggle produces ~80 fires, so that was ~1.7M property copies
    // and 80 large short-lived objects — measured as ~1.9s of the ~3.2s of
    // operation time, sitting OUTSIDE the per-op `[op-timing]` totals, which is
    // why it hid for so long.
    //
    // The cache is keyed on the base map's identity plus a fingerprint of the
    // LOCAL overlay — which is tiny (a couple of dozen entries during a
    // cascade) and, crucially, whose every mutation site ASSIGNS A NEW OBJECT
    // (`localOccsById[id] = { ...occ, … }`). So comparing key list + value
    // identity catches every write without having to hook ~20 call sites and
    // hope none is ever missed — a missed bump would serve operations stale
    // occurrences, which is a correctness bug, not a perf one.
    const _localKeys = Object.keys(localOccsById);
    let _localSame = _mergedBase === _cachedBaseOccsById
      && _mergedLocalKeys
      && _mergedLocalKeys.length === _localKeys.length;
    if (_localSame) {
      for (let i = 0; i < _localKeys.length; i++) {
        if (_mergedLocalKeys[i] !== _localKeys[i] || _mergedLocalVals[i] !== localOccsById[_localKeys[i]]) {
          _localSame = false; break;
        }
      }
    }
    if (!_localSame) {
      _mergedOccsById = Object.assign({}, _cachedBaseOccsById, localOccsById);
      _mergedBase = _cachedBaseOccsById;
      _mergedLocalKeys = _localKeys;
      _mergedLocalVals = _localKeys.map((k) => localOccsById[k]);
    }
    const occurrencesById = _mergedOccsById;

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
    const allUpdates = runMatchingOperations(operations, transactionType, transaction, { state, fieldsById: _cachedFieldsById, operationsById: _cachedOperationsById, occurrencesById, modulesById: _cachedModulesById, cascadeFiredOps },
      makeOpNotificationCallbacks(pushTxNotification, () => ({ fieldsById: _cachedFieldsById, occurrencesById, modulesById: _cachedModulesById })));

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
      // Same per-effect guard as the full_state path above, and for the same
      // reason: a throw here used to discard every remaining effect in the batch.
      for (const eff of effects) {
        try {
          applyOperationEffect(eff, state);
        } catch (err) {
          console.error(`[fireOperations] effect ${eff?._effect} threw — continuing`, err, eff);
        }
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
    // Mark as optimistically fired so onOccurrenceUpdated skips the duplicate.
    // THIS STAYS SYNCHRONOUS even when the fire below is deferred: the server
    // echo can beat a deferred fire, and if the set were not populated yet
    // `onOccurrenceUpdated` would fire its own MeasureOp and we would have
    // DOUBLED the work instead of moving it.
    if (transaction.occurrenceId) {
      optimisticFiredSet.add(transaction.occurrenceId);
      // Clear after 5s (server echo should arrive well before this)
      setTimeout(() => optimisticFiredSet.delete(transaction.occurrenceId), 5000);
    }

    // ── A FIELD WRITE PAINTS FIRST, THEN RECOMPUTES ───────────────────────
    // `setOccurrenceFieldValue` dispatches the optimistic value and then calls
    // this synchronously, so the browser cannot paint the tick until every
    // matching operation has run — the user watches a frozen checkbox for the
    // whole sweep. Deferring past the paint is what helpers/afterPaint.js was
    // built for (the textblock mint went 1000ms -> 30ms the same way).
    //
    // MEASURED ON ONE ROW, four runs each — comparing across DIFFERENT rows is
    // what made me briefly conclude this was a bad trade, because a cheaper row
    // fires far fewer operations:
    //
    //     no deferral        paint 3333ms · longest 3308ms · blocked ~6800ms
    //     top-level only     paint 3403ms · longest 3269ms · blocked ~7300ms
    //     nested too         paint 2535ms · longest 2218ms · blocked ~6100ms
    //
    // The win comes from deferring the NESTED fires — an operation writing a
    // field during a cascade — not the outermost one. Restricting it to
    // `_fireDepth === 0` buys nothing.
    //
    // AND THE DEPTH IS CARRIED ACROSS THE DEFERRAL, which is the whole reason
    // this is safe. `_fireDepth` is incremented synchronously around each fire,
    // so a naively deferred nested fire would run at depth 0 and the
    // `_FIRE_DEPTH_LIMIT` cap could never accumulate — a runaway op loop would
    // spin forever in separate tasks instead of tripping the guard, which is
    // exactly when the guard is needed. Restoring the depth keeps both the cap
    // and the depth-1 cascade dedup behaving as they do synchronously.
    //
    // AND THE ACTION IS CARRIED THE SAME WAY, for exactly the reason the depth
    // is. `withAction` closes synchronously, so a cascade that runs a task later
    // wrote outside it and every write minted an action of its own. Measured on
    // the live grid: one toggle produced 40-54 transactions across 201 DISTINCT
    // action ids, one document each — so Ctrl+Z undid the last derived write
    // rather than the toggle, which is why undo looked like it did nothing.
    // `retainAction` also holds back the close signal until the last
    // continuation drains, or the server would flush the buffer early and the
    // tail would become a second transaction.
    if (transactionType === "MeasureOp") {
      const savedDepth = _fireDepth;
      const captured = captureAction();
      retainAction(captured);
      afterPaint(() => {
        const prev = _fireDepth;
        _fireDepth = savedDepth;
        try {
          runInAction(captured, () => fireOperations(transactionType, transaction, options));
        } finally {
          _fireDepth = prev;
          releaseAction(captured);
        }
      });
      return;
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
    // Local filter changes (date switches) re-scope every feed — reconcile.
    scheduleFeedSync();
  }

  // Drop-batch: collect all top-level op fires during a drop, then flush
  // them after rAF so the browser can paint the committed drop first.
  // An action scope closing is the signal the server needs to flush its buffer
  // early; otherwise the transaction only becomes undoable on the 1500ms idle
  // timer and a quick Ctrl+Z targets the previous one.
  setActionCloseHook((actionId) => { safeEmit(socket, "close_action", { actionId }); });

  operationsBridge.beginDropBatch = () => {
    _dropBatchFires = [];
    // Open the undo action here and hold it across the WHOLE drain below, so
    // the move and every tracker write it causes land in one transaction —
    // one Ctrl+Z puts the user back where they were.
    beginAction("Moved item");
  };
  operationsBridge.endDropBatch = () => {
    const batch = _dropBatchFires;
    _dropBatchFires = null;
    if (!batch || batch.length === 0) { endAction(); return; }
    // DOUBLE rAF: a single requestAnimationFrame runs BEFORE the next paint, so
    // the deferred op cascade (trackers + Table/Canvas builds → a big grid
    // re-render) executed in the SAME frame as the optimistic move and blocked
    // the dropped item from painting — the user saw a long delay before the
    // item appeared at the drop spot when the destination runs operations.
    // Waiting TWO frames lets the browser paint the move first, then runs the
    // op work on the following frame so the drop feels instant.
    //
    // The drain is CHUNKED (one fire per macrotask) and DEDUPED (one shared
    // cascade Set across the whole burst, same semantic as fireOperationsBatch):
    // a drop emits OccurrenceListOp + one MeasureOp per field, and each sweep
    // used to re-run the same Build/Tracker ops — N× the work — all in ONE
    // synchronous frame, freezing the UI for seconds right after the paint.
    // Now each matching op runs once for the burst, and the browser can paint /
    // take input between sweeps.
    const cascadeSet = new Set();
    const t0 = performance.now();
    const total = batch.length;
    const step = () => {
      const next = batch.shift();
      if (!next) {
        // The cascade has drained — close the undo action so later writes
        // aren't swallowed into this one.
        endAction();
        if (typeof window !== "undefined" && window.__dragPerf === true) {
          console.log(`[drop] op drain done — ${total} fires, ${cascadeSet.size} ops, ${Math.round(performance.now() - t0)}ms`);
        }
        return;
      }
      // Install the shared dedup Set only for the duration of this synchronous
      // sweep so interleaved user-initiated fires never dedup against it.
      const prev = _navCascadeFiredOps;
      _navCascadeFiredOps = cascadeSet;
      try {
        fireOperations(next.transactionType, next.transaction);
      } finally {
        _navCascadeFiredOps = prev;
      }
      setTimeout(step, 0);
    };
    requestAnimationFrame(() => { requestAnimationFrame(step); });
  };

  // Expose on module-level bridge so CommitHelpers can call optimistically
  // A local write must re-sync feeds in the tab that made it. The server
  // broadcasts occurrence CRUD with socket.to(userRoom()) — the sender is
  // EXCLUDED and gets a timestamp-only ack — so the three CRUD call sites
  // above are echo handlers that never fire in the originating window (the
  // other three are full_state, grid_updated and the local filter cascade).
  // Ticking a task's Completed left it out of the
  // `Completed` feed until a reload. Same shape as the 2026-08-07 (2)
  // NavigationOp fix, which reached CommitHelpers.updateGrid for the same reason.
  operationsBridge.scheduleFeedSync = () => scheduleFeedSync();
  operationsBridge.fireOperations = fireOperationsOptimistic;
  operationsBridge.fireOperationsBatch = fireOperationsBatch;
  operationsBridge.updateLocalOcc = (occ) => { if (occ?.id) localOccsById[occ.id] = occ; };
  operationsBridge.markDerivedOcc = _markOpEmitted;
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
  // Read-only snapshot for filter-value stamping on create. Same reason
  // `getLocalMod` exists: a create path deep inside CommitHelpers has to be able
  // to answer "what date does this parent impose?" without every call site
  // threading state through. `localOccsById` is the live overlay, so the
  // effective-filter walk sees writes that have not round-tripped yet.
  operationsBridge.getFilterContext = () => ({
    state: stateRef.current || null,
    occurrencesById: localOccsById,
  });
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
  // ── BOTH MAPS ARE CACHED; THIS WALKS <=20 ANCESTORS ───────────────────────
  // This used to rebuild a full module map (6,557 entries on poms grid) AND a
  // parent-by-child map from the whole local overlay on EVERY CALL — to walk at
  // most 20 links. It is called once per `occurrence_updated`, ~80 times for one
  // `Completed` toggle, so the module map alone was ~524k iterations. A CPU
  // profile put `getAncestorChain` at **440ms** of the toggle, which is what
  // sent me here; `_cachedModulesById` was already sitting in this same closure.
  //
  // Modules are keyed on the ARRAY identity (the reducer swaps it on a write).
  // The overlay is fingerprinted the same way the occurrence merge above is, and
  // for the same reason: its ~20 mutation sites all assign a NEW object, so
  // comparing key list + value identity catches every write without hooking
  // them and hoping none is missed.
  let _acModsFrom = null, _acModsById = null;
  let _acParentKeys = null, _acParentVals = null, _acParentMap = null;
  operationsBridge.getAncestorChain = (occId) => {
    const ids = [];
    const labels = [];
    if (!occId) return { ids, labels };

    const mods = stateRef.current?.modules;
    if (mods !== _acModsFrom) {
      _acModsById = {};
      if (Array.isArray(mods)) for (const m of mods) if (m?.id) _acModsById[m.id] = m;
      _acModsFrom = mods;
    }
    const modById = _acModsById;

    const _keys = Object.keys(localOccsById);
    let _same = _acParentKeys && _acParentKeys.length === _keys.length;
    if (_same) {
      for (let i = 0; i < _keys.length; i++) {
        if (_acParentKeys[i] !== _keys[i] || _acParentVals[i] !== localOccsById[_keys[i]]) { _same = false; break; }
      }
    }
    if (!_same) {
      _acParentMap = {};
      for (const o of Object.values(localOccsById)) {
        for (const childId of o?.occurrences || []) _acParentMap[childId] = o.id;
      }
      _acParentKeys = _keys;
      _acParentVals = _keys.map((k) => localOccsById[k]);
    }
    const parentByChildId = _acParentMap;

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
    // A SnapshotOp is an UNDO RECORD, not a domain event — it carries no
    // trigger semantics, so firing operations for it would run the whole
    // matcher (~70 ops) against a type nothing matches, and the toast
    // machinery below is O(grid) per transaction (it rebuilds modulesById,
    // occurrencesById and a full parent reverse map). Since every write now
    // produces one, that work would run on every keystroke-debounced doc save.
    // TransactionHistory has its own `transaction_created` listener and still
    // live-updates from these.
    if (transaction.type === "SnapshotOp") return;

    // ── A MeasureOp TRANSACTION MUST NOT RE-FIRE OPERATIONS ───────────────
    // A MeasureOp transaction is the RECORD of a field write. The write itself
    // already fired operations through `occurrence_updated` above, which builds
    // the compound `{ fields: { [fid]: value } }` transaction and is guarded by
    // `optimisticFiredSet` so a local write fires exactly once.
    //
    // Firing again from the echo is not merely redundant, it is INERT: a
    // field-scoped trigger matches on `transaction.fields[targetId]`
    // (matchSubjectFilter, subjectType "field"), and a transaction record has
    // `operations[].measure`, no `fields` map at all. So the matcher walks
    // every operation on the grid and can match none of them.
    //
    // Measured on poms grid: ONE `Completed` toggle produces 51 MeasureOp
    // transactions, and `window.__renderTally()` reported **90 sweeps of
    // runMatchingOperations totalling 3551ms** for that click — against a
    // longest task of ~3.4s. Only 2 of those sweeps logged `[op-timing]`,
    // i.e. only 2 did any work; the rest spun the matcher over ~70 operations
    // for a shape that cannot match.
    //
    // Remote changes are unaffected: another window's field write reaches this
    // client as `occurrence_updated` too, which fires the correctly-shaped
    // MeasureOp. Every other transaction type still fires as before.
    if (transaction.type !== "MeasureOp") fireOperations(transaction.type, transaction);

    // ── Toast lookups: LAZY, and O(1) where they used to be O(grid) ───────
    // This block used to run UNCONDITIONALLY on every transaction, before it
    // knew whether a toast would even be shown — building fieldsById,
    // modulesById, a FULL SPREAD of occurrencesById and a parent reverse map.
    //
    // Measured on poms grid, 2026-08-25: ONE `Completed` toggle produces
    // **51 MeasureOp transactions** (26 outbound writes -> 127 inbound frames),
    // so that was ~51 x (6,557 module iterations + a **21,000-key object
    // allocation** + a 21,000-occurrence reverse-map walk) — millions of
    // operations and 51 large short-lived objects of GC churn, per click.
    //
    // The handler's own SnapshotOp early-return above already says this work
    // is too expensive to do per transaction; MeasureOps simply went straight
    // through it. Nothing below changes what a toast SAYS — only when the
    // lookups are built.
    const state = stateRef.current || {};
    // Keyed on the identity of the array it came from: the reducer swaps these
    // arrays on every write, so array identity IS the version — the same trick
    // helpers/previewSubtreeIndex.js uses.
    const fieldsById = () => byIdCached(state.fields);
    const modulesById = () => byIdCached(state.modules);
    // The merged map was only ever used for single-id lookups, so it does not
    // need to exist. Local (optimistic) rows win, exactly as the old spread
    // `{ ...state.occurrencesById, ...localOccsById }` made them win.
    const occById = (id) => (id ? (localOccsById?.[id] ?? state.occurrencesById?.[id] ?? null) : null);

    // Resolve a human-readable name for any occurrence id by walking
    // occurrence → module.label. Falls back to the occurrence's own label if
    // the module isn't loaded yet, or to a short id tail if neither is.
    const nameForOcc = (id) => {
      if (!id) return "";
      const occ = occById(id);
      if (!occ) return id.slice(0, 6);
      return modulesById()[occ.moduleId]?.label || occ.label || id.slice(0, 6);
    };
    const nameForModule = (id) => {
      if (!id) return "";
      return modulesById()[id]?.label || id.slice(0, 6);
    };

    // The parent reverse map exists ONLY for `chainForOcc`, which is called
    // from the toast branches — so it is built at most once per transaction,
    // and only when a toast is actually being written.
    let _parentByChild = null;
    const parentOf = (id) => {
      if (!_parentByChild) {
        _parentByChild = {};
        for (const occ of Object.values(state.occurrencesById || {})) {
          for (const childId of occ?.occurrences || []) _parentByChild[childId] = occ.id;
        }
        for (const occ of Object.values(localOccsById || {})) {
          for (const childId of occ?.occurrences || []) _parentByChild[childId] = occ.id;
        }
      }
      return _parentByChild[id];
    };
    // Returns "Page › Container" (or whatever non-grid ancestors exist)
    // for an occurrence id, omitting the occurrence itself. Stops at the
    // first ancestor whose module has role:"page" so the chain stays short
    // and meaningful. Returns "" when no chain can be built.
    const chainForOcc = (id) => {
      if (!id) return "";
      const labels = [];
      let cur = parentOf(id) || occById(id)?.parentId;
      const seen = new Set();
      let depth = 0;
      while (cur && !seen.has(cur) && depth++ < 8) {
        seen.add(cur);
        const occ = occById(cur);
        if (!occ) break;
        const mod = modulesById()[occ.moduleId];
        const label = mod?.label || occ.label;
        if (label) labels.unshift(label);
        // Stop after we've passed the page level so we don't surface the
        // panel/grid scaffolding.
        if (mod?.role === "page") break;
        cur = parentOf(cur) || occ.parentId;
      }
      return labels.join(" › ");
    };

    const ops = transaction.operations || [];
    if (transaction.type === "MeasureOp" && ops.length > 0) {
      const op = ops[0];
      const m = op?.measure || {};
      const field = fieldsById()[m.fieldId];
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
    operationsBridge.markDerivedOcc = null;
    if (_feedSyncTimer) { clearTimeout(_feedSyncTimer); _feedSyncTimer = null; }
    operationsBridge.removeLocalOcc = null;
    operationsBridge.getLocalOcc = null;
    operationsBridge.getLocalMod = null;
    operationsBridge.getLinkedOccs = null;
    operationsBridge.getAncestorChain = null;
    operationsBridge.applyEffect = null;
    operationsBridge.importText = null;
    setActionCloseHook(null);
    operationsBridge.beginDropBatch = null;
    operationsBridge.endDropBatch = null;
    _dropBatchFires = null;
    clearInterval(scheduleInterval);
    if (bc) { bc.close(); bc = null; }
    socket.off("full_state", onFullState);
    socket.off("priority_state", onPriorityState);
    socket.off("textmaps_loaded", onTextmapsLoaded);
    socket.off("sync_state", onSyncState);
    socket.off("undo_applied", onUndoApplied);

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