// helpers/CommitHelpers.js
import { operationsBridge } from "../state/bindSocketToStore";
import { safeEmit } from "./offlineQueue";
import { beginAction, endAction, withAction } from "./actionScope";
import { buildParentMap } from "./dragHitTesting";
import { computePageFilterFields } from "./filterFieldStamp";
import {
  createGridAction,
  updateGridAction,
  deleteGridAction,
  createInstanceInContainerAction,
  createOccurrenceAction,
  updateOccurrenceAction,
  deleteOccurrenceAction,
  createFieldAction,
  updateFieldAction,
  deleteFieldAction,
  createManifestAction,
  updateManifestAction,
  deleteManifestAction,
  createViewAction,
  updateViewAction,
  deleteViewAction,
  createFolderAction,
  updateFolderAction,
  deleteFolderAction,
  createOperationAction,
  updateOperationAction,
  deleteOperationAction,
  createModuleAction,
  updateModuleAction,
  deleteModuleAction,
} from "../state/actions";

/**
 * Commit helper contract:
 * - Always safe to call with missing dispatch/socket.
 * - "emit" controls whether we talk to the backend (hard save).
 *   - default: emit = true
 *   - set emit: false for "soft save" (dispatch only)
 */
function shouldEmit(emit) {
  return emit !== false;
}

// ===== GRID =====
export function createGrid({ dispatch, socket, grid, emit = true }) {
  if (!grid) return;
  dispatch?.(createGridAction(grid));
  if (shouldEmit(emit)) safeEmit(socket, "create_grid", { grid });
}

export function updateGrid({ dispatch, socket, gridId, grid, emit = true }) {
  if (!gridId || !grid) return;

  // ✅ action creator now expects { gridId, grid }
  dispatch?.(updateGridAction({ gridId, grid }));

  if (shouldEmit(emit)) safeEmit(socket, "update_grid", { gridId, grid });
}

export function deleteGrid({ dispatch, socket, gridId, emit = true }) {
  if (!gridId) return;
  dispatch?.(deleteGridAction(gridId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_grid", { gridId });
}

// ===== MODULE (unified Panel + Container + Instance) =====
export function createModule({ dispatch, socket, module, emit = true }) {
  if (!module) return;
  dispatch?.(createModuleAction(module));
  if (shouldEmit(emit)) safeEmit(socket, "create_module", { module });
}

export function updateModule({ dispatch, socket, module, emit = true }) {
  if (!module?.id) return;
  dispatch?.(updateModuleAction(module));
  if (shouldEmit(emit)) safeEmit(socket, "update_module", { module });
}

export function deleteModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(deleteModuleAction(moduleId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_module", { moduleId });
}

// ===== INSTANCE IN CONTAINER (create module + place in container atomically) =====
export function createInstanceInContainer({
  dispatch,
  socket,
  containerId,
  instance,
  occurrenceId,
  initialMeta,
  emit = true,
}) {
  if (!containerId || !instance?.id) return;

  // atomic optimistic state: adds instance (if missing) AND pushes into container.occurrences
  dispatch?.(createInstanceInContainerAction({ containerId, instance }));

  if (shouldEmit(emit)) {
    safeEmit(socket, "create_instance_in_container", {
      containerId, instance,
      ...(occurrenceId ? { occurrenceId } : {}),
      ...(initialMeta ? { meta: initialMeta } : {}),
    });
  }
}

// ===== OCCURRENCE =====
// Helper: ensure every fieldId carried on `occurrence.fields` (with a real
// value) has a binding on the source module's `fieldBindings`. Module-level
// bindings are the system's canonical contract — the rest of the codebase
// (renderers, forms, pickers) reads `module.fieldBindings` to know what
// fields exist on an occurrence. When a drop / op pre-populates fields on
// create, the binding must follow so the pill renders. Idempotent.
// Exported for the op-CREATE_ITEM handler in bindSocketToStore (which mints
// occurrences without going through `createOccurrence`).
export function ensureModuleBindingsForOccurrenceFields({ dispatch, socket, occurrence }) {
  const fields = occurrence?.fields;
  if (!fields || typeof fields !== "object") return;
  const fieldIds = Object.keys(fields).filter(fid => {
    const v = fields[fid];
    if (v == null) return false;
    // Skip slots that exist but carry no real value yet (e.g. flow-only).
    if (typeof v === "object" && !("value" in v)) return false;
    const vv = typeof v === "object" ? v.value : v;
    return vv != null && vv !== "";
  });
  if (fieldIds.length === 0) return;
  const moduleId = occurrence.moduleId;
  if (!moduleId) return;
  const mod = operationsBridge.getLocalMod?.(moduleId);
  if (!mod) return;
  const bindings = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
  const bound = new Set(bindings.map(b => b?.fieldId).filter(Boolean));
  const missing = fieldIds.filter(fid => !bound.has(fid));
  if (missing.length === 0) return;
  const maxOrder = bindings.reduce((m, b) => Math.max(m, b?.order ?? 0), -1);
  const nextBindings = [...bindings];
  for (let i = 0; i < missing.length; i++) {
    nextBindings.push({ fieldId: missing[i], role: "input", order: maxOrder + 1 + i });
  }
  updateModule({
    dispatch, socket,
    module: { id: mod.id, fieldBindings: nextBindings },
    emit: true,
  });
}

// `fireTrigger: false` marks DERIVED data (feed copies, op-materialized rows —
// see feedSync). Those stay out of the undo stack; everything else is a user
// action and gets one.
export function createOccurrence(args) {
  if (!args?.occurrence?.id) return undefined;
  if (args.fireTrigger === false) return _createOccurrence(args);
  return withAction("Created item", () => _createOccurrence(args));
}

function _createOccurrence({ dispatch, socket, occurrence, emit = true, panelId = null, containerLabel = "", panelLabel = "", fireTrigger = true, insertAtIndex = null }) {
  if (!occurrence?.id) return;
  operationsBridge.updateLocalOcc?.(occurrence);
  dispatch?.(createOccurrenceAction(occurrence));
  // `insertAtIndex` rides ONLY on the emit (not the dispatched/cached occurrence — it's
  // not a persisted field). The server's create handler uses it to $position the child
  // into parent.occurrences[] at the drop index instead of appending at the end; without
  // it a copy-drop lands at the drop spot optimistically then rubber-bands to the last
  // slot when the server's append-order surfaces back to the originator.
  if (shouldEmit(emit)) {
    const payload = insertAtIndex != null ? { ...occurrence, insertAtIndex } : occurrence;
    safeEmit(socket, "create_occurrence", { occurrence: payload });
  }
  // Module-level binding contract: if the new occurrence carries values for
  // fields the module doesn't bind, add the bindings now so the pill renders.
  ensureModuleBindingsForOccurrenceFields({ dispatch, socket, occurrence });
  // CYCLE BREAKER (mirror of deleteOccurrence's) — fireTrigger:false marks
  // DERIVED-data creates (feed-minted copies). No OccurrenceCreateOp fires,
  // and the id is marked so the server echo doesn't re-fire either.
  if (!fireTrigger) {
    operationsBridge.markDerivedOcc?.(occurrence.id);
    return;
  }
  // Compute the new occurrence's ancestor chain so ancestor-scoped triggers
  // (e.g. `ancestorLabel: "Daily Goals"` on a tracker's onAdd) can match.
  // Without this enrichment, every tracker with an unscoped onAdd matched
  // every create grid-wide — the 300ms+ fan-out per drop. Now ops opt in
  // by declaring ancestorLabel on the trigger and the matcher drops them
  // from the match list entirely when the create happened outside scope.
  const ancestors = operationsBridge.getAncestorChain?.(occurrence.id) || { ids: [], labels: [] };
  // ONE trigger per user action. A create fires OccurrenceCreateOp only;
  // onAdd subscribers (incl. field-scoped via subjectType:"field" against
  // transaction.fields[targetId]) match here. onChange is reserved for actual
  // value changes on an existing occurrence (setOccurrenceFieldValue / the
  // triggerField branch in updateOccurrence). No piggyback MeasureOp.
  operationsBridge.fireOperations?.("OccurrenceCreateOp", {
    type: "OccurrenceCreateOp",
    occurrenceId: occurrence.id,
    instanceId: occurrence.moduleId,
    containerId: occurrence.parentId,
    gridId: occurrence.gridId,
    ...(panelId ? { panelId } : {}),
    containerLabel,
    panelLabel,
    fields: occurrence.fields || {},
    _ancestorIds: ancestors.ids,
    _ancestorLabels: ancestors.labels,
  });
}

// Every user-caused write has to be undoable. `beginAction` is re-entrant
// (depth-counted), so a write made INSIDE an already-open action joins it — a
// drop and its tracker cascade still collapse into one undo step — while a
// standalone call gets its own. Without this only field edits and drops opened
// an action; typing, creating and deleting reached the server with no actionId,
// were recorded as `derived`, and the undo stack skipped them. Measured on the
// live grid: 33 of 35 transactions were derived, so Ctrl+Z had almost nothing
// to act on (user: "control z ... not working on docpages").
export function updateOccurrence(args) {
  if (!args?.occurrence?.id) return undefined;
  const label = args.occurrence.textmap !== undefined ? "Edited text" : "Updated item";
  return withAction(label, () => _updateOccurrence(args));
}

function _updateOccurrence({ dispatch, socket, occurrence, emit = true, triggerField = null }) {
  if (!occurrence?.id) return;
  // Conflict resolution (#26 cheapest-level): pass the local cache's
  // `updatedAt` so the server can reject this write when another window
  // landed a newer edit. Skipped silently when the local cache has no
  // updatedAt yet (first-write / pre-cache occurrence).
  //
  // #26 medium-tier: when the patch carries fields, also pass per-field
  // baselines from the local cache's `fieldUpdatedAt` map. The server
  // does per-field collision detection — fields whose stored timestamp
  // is newer than what the client expected come back via
  // `occurrence_field_conflict`; non-conflicting fields auto-merge so
  // two windows editing different fields no longer trample each other.
  const localPrev = operationsBridge.getLocalOcc?.(occurrence.id) || null;
  const expectedUpdatedAt = localPrev?.updatedAt || null;
  let expectedFieldUpdatedAt = null;
  if (occurrence.fields && typeof occurrence.fields === "object" && Object.keys(occurrence.fields).length > 0) {
    const prevFieldTs = (localPrev?.fieldUpdatedAt && typeof localPrev.fieldUpdatedAt === "object") ? localPrev.fieldUpdatedAt : {};
    expectedFieldUpdatedAt = {};
    for (const fid of Object.keys(occurrence.fields)) {
      expectedFieldUpdatedAt[fid] = Number(prevFieldTs[fid]) || 0;
    }
  }
  dispatch?.(updateOccurrenceAction(occurrence));
  if (shouldEmit(emit)) {
    const payload = { occurrence };
    if (expectedUpdatedAt) payload.expectedUpdatedAt = expectedUpdatedAt;
    if (expectedFieldUpdatedAt) payload.expectedFieldUpdatedAt = expectedFieldUpdatedAt;
    safeEmit(socket, "update_occurrence", payload);

    // Optimistically advance local updatedAt so the NEXT updateOccurrence
    // call for this id (which can happen multiple times in a single tick
    // when an op pipeline produces several UPDATE_OCCURRENCE effects for
    // the same occurrence) uses a fresh expectedUpdatedAt. Without this:
    // — Write 1 sends expectedUpdatedAt=T0 → server accepts, stores T1
    // — Write 2 reads localPrev.updatedAt still=T0 (the persisted ack
    //   hasn't round-tripped yet) → sends expectedUpdatedAt=T0
    // — Server compares stored=T1 vs expected=T0 → flags as stale →
    //   emits occurrence_stale → spurious "another window had a newer
    //   edit" toast even though no other window exists.
    // Per-field timestamps are also bumped so the medium-tier
    // expectedFieldUpdatedAt check stays consistent.
    if (localPrev) {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const patch = { ...localPrev, updatedAt: nowIso };
      if (occurrence.fields && Object.keys(occurrence.fields).length > 0) {
        const nextFieldTs = { ...(localPrev.fieldUpdatedAt || {}) };
        for (const fid of Object.keys(occurrence.fields)) nextFieldTs[fid] = nowMs;
        patch.fieldUpdatedAt = nextFieldTs;
      }
      operationsBridge.updateLocalOcc?.(patch);
    }
  }

  // Optimistic linked-group fan-out: mirror the server's update_occurrence
  // propagation locally (server/socketHandlers/occurrences.js:91) so every copy
  // in the group reflects field/textmap changes in the same frame as the
  // toggled one — eliminates the round-trip pause between linked rows ticking.
  // Source of linkedGroupId: payload first (FieldRenderer sends a full spread),
  // local cache fallback (some callers send a partial patch).
  const linkedGroupId = occurrence.linkedGroupId
    ?? operationsBridge.getLocalOcc?.(occurrence.id)?.linkedGroupId
    ?? null;
  if (linkedGroupId && (occurrence.fields || occurrence.textmap !== undefined)) {
    const siblings = operationsBridge.getLinkedOccs?.(linkedGroupId, occurrence.id) || [];
    for (const sib of siblings) {
      const patch = { id: sib.id };
      if (occurrence.fields) patch.fields = { ...(sib.fields || {}), ...occurrence.fields };
      if (occurrence.textmap !== undefined) patch.textmap = occurrence.textmap;
      dispatch?.(updateOccurrenceAction(patch));
      operationsBridge.updateLocalOcc?.({ ...sib, ...patch });
    }
  }
  if (triggerField) {
    // Update local cache with the new occurrence so the executor sees the correct value
    operationsBridge.updateLocalOcc?.(occurrence);
    const tfAncestors = operationsBridge.getAncestorChain?.(occurrence.id) || { ids: [], labels: [] };
    operationsBridge.fireOperations?.("MeasureOp", {
      type: "MeasureOp",
      occurrenceId: occurrence.id,
      instanceId: triggerField.instanceId,
      fields: { [triggerField.fieldId]: triggerField.value },
      _ancestorIds: tfAncestors.ids,
      _ancestorLabels: tfAncestors.labels,
    });
  }
}

// Diff two filterOverride maps and return the set of keys whose value changed.
// Treats null/undefined override as empty {}. Going from null → {date: x} yields
// ["date"]; {date: a} → {date: b} yields ["date"]; identity → [].
function _changedFilterKeys(prev, next) {
  const a = (prev && typeof prev === "object") ? prev : {};
  const b = (next && typeof next === "object") ? next : {};
  const all = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of all) if (a[k] !== b[k]) out.push(k);
  return out;
}

// Walk descendants of rootId via occurrence.occurrences[]. Collect every descendant
// whose effective filter actually moved when changedKeys at the root flipped.
//   filterOverride: null    — fully inheriting → all changedKeys propagate, recurse
//   filterOverride: {}      — cleared → child sees no filter regardless of root, stop
//   filterOverride: {keys}  — partial → only keys NOT in override still inherit;
//                             if any of those overlap changedKeys, child is affected
//                             and we recurse with the still-inherited subset.
function _walkInheritingDescendants(rootId, changedKeys, occurrencesById) {
  if (!changedKeys.length) return [];
  const out = [];
  const visited = new Set([rootId]);
  function visit(parentId, keys) {
    const parent = occurrencesById[parentId];
    if (!parent) return;
    for (const childId of parent.occurrences || []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = occurrencesById[childId];
      if (!child) continue;
      const override = child.filterOverride;
      let stillInherited;
      if (override == null) {
        stillInherited = keys;
      } else if (Object.keys(override).length === 0) {
        continue; // {} blocks inheritance entirely
      } else {
        stillInherited = keys.filter(k => !(k in override));
        if (!stillInherited.length) continue;
      }
      out.push(child);
      visit(childId, stillInherited);
    }
  }
  visit(rootId, changedKeys);
  return out;
}

// Walk source → root, returning [ancestorIds, ancestorLabels].
// Uses parent-by-child derived from `occ.occurrences[]` arrays as the
// authoritative ordering source, falling back to `cur.parentId`. The fallback
// matters because many seeded grids (e.g. the test grid) only set parentId on
// leaf instances; pages and panels track children via `occurrences[]` and have
// no parentId, so a cur.parentId-only walk used to stop after one hop and
// ancestor-scoped triggers (`ancestorLabel: "Daily Goals"` etc.) silently
// failed to match. Mirrors the executor's `ancestorsFor` logic so triggers and
// HAS_ANCESTOR predicates resolve from the same chain.
function _ancestorChain(occId, occurrencesById, modulesById) {
  const ids = [];
  const labels = [];
  if (!occurrencesById) return { ids, labels };

  const parentByChildId = buildParentMap(occurrencesById);

  let cur = occurrencesById[occId];
  const seen = new Set();
  let depth = 0;
  while (cur && !seen.has(cur.id) && depth++ < 20) {
    seen.add(cur.id);
    ids.push(cur.id);
    const label = modulesById?.[cur.moduleId]?.label;
    if (label) labels.push(label);
    const nextId = parentByChildId[cur.id] ?? cur.parentId;
    cur = nextId ? occurrencesById[nextId] : null;
  }
  return { ids, labels };
}

export function updateOccurrenceFilterOverride({ dispatch, socket, id, filterOverride, occurrencesById, modulesById, navFieldId, date }) {
  if (!id) return;
  const prevOcc = occurrencesById?.[id];
  const prevOverride = prevOcc?.filterOverride;
  const changedKeys = _changedFilterKeys(prevOverride, filterOverride);

  dispatch?.(updateOccurrenceAction({ id, filterOverride }));
  safeEmit(socket, "update_occurrence", { occurrence: { id, filterOverride } });
  // Update the executor's local cache so subsequent reads of $foo._effectiveFilter
  // resolve against the NEW override, not the previous Redux snapshot. Without
  // this the NavigationOp below sees stale data and ops like "Schedule: Build Day"
  // build for the previous date.
  if (prevOcc) {
    operationsBridge.updateLocalOcc?.({ ...prevOcc, filterOverride });
  } else {
    operationsBridge.updateLocalOcc?.({ id, filterOverride });
  }

  if (!occurrencesById || !modulesById) return;

  // Build the NavigationOp fan-out: one transaction for the source occurrence
  // plus one for every descendant whose effective filter actually moved (still
  // inheriting a changed key). Per-occurrence triggers (e.g. ancestorLabel +
  // subjectRole:"container" on a timeslot) need a transaction carrying their
  // own ancestor chain to match.
  //
  // These are fired as a SINGLE cascade so an op matching many of them runs
  // ONCE — not once per descendant. Without this, changing the date on the
  // Schedule page fanned out ~50 NavigationOps and re-ran every ancestor-scoped
  // page-rebuild op (Table: Build / Canvas: Build / Build Schedule) ~50× — the
  // 5-10s freeze. The rebuild ops resolve their date from targetOccurrenceId,
  // not the trigger, so a single run is correct.
  const sourceChain = _ancestorChain(id, occurrencesById, modulesById);
  const transactions = [{
    type: "NavigationOp",
    sourceOccurrenceId: id,
    occurrenceId: id,
    fieldId: navFieldId,
    date,
    activeFilterValues: filterOverride || {},
    _ancestorIds: sourceChain.ids,
    _ancestorLabels: sourceChain.labels,
  }];

  if (changedKeys.length) {
    const affected = _walkInheritingDescendants(id, changedKeys, occurrencesById);
    for (const desc of affected) {
      const chain = _ancestorChain(desc.id, occurrencesById, modulesById);
      transactions.push({
        type: "NavigationOp",
        sourceOccurrenceId: desc.id,
        occurrenceId: desc.id,
        fieldId: navFieldId,
        date,
        activeFilterValues: desc.filterOverride || {},
        _ancestorIds: chain.ids,
        _ancestorLabels: chain.labels,
      });
    }
  }

  // Defer the cascade so the picker UI commits visually before the op storm
  // runs. Filter writes are user-facing and the click latency dominates UX —
  // without this, a date pick blocks the main thread for the sync cost of
  // every matching rebuild op (Schedule: Build, Table: Build, trackers, …)
  // plus their re-render fan-out. The Redux dispatch + socket emit + local
  // cache update above already happened synchronously, so consumers reading
  // grid.activeFilterValues / filterOverride see the new value immediately.
  // The ops then catch up on the next animation frame.
  const fireCascade = () => {
    if (operationsBridge.fireOperationsBatch) {
      operationsBridge.fireOperationsBatch("NavigationOp", transactions);
    } else {
      // Fallback (bridge not wired, e.g. in unit tests): fire individually.
      for (const t of transactions) operationsBridge.fireOperations?.("NavigationOp", t);
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fireCascade);
  } else {
    fireCascade();
  }
}

export function deleteOccurrence(args) {
  if (!args?.occurrenceId) return undefined;
  if (args.fireTrigger === false) return _deleteOccurrence(args);
  return withAction("Deleted item", () => _deleteOccurrence(args));
}

function _deleteOccurrence({ dispatch, socket, occurrenceId, occurrence, emit = true, fireTrigger = true }) {
  if (!occurrenceId) return;
  // Snapshot the occurrence BEFORE eviction. Callers that delete via an
  // operation effect (applyOperationEffect → DELETE_ITEM) don't pass
  // `occurrence`, so without this the OccurrenceDeleteOp below fires with no
  // override and the executor can't enrich `$trigger.occurrence` — which the
  // Table/Canvas "Build" self-trigger guard relies on to tell "I deleted my
  // own derived copy" from "the source changed". Missing that, the rebuild's
  // own orphan-sweep deletes re-fire the rebuild → exponential freeze.
  const snap = occurrence || operationsBridge.getLocalOcc?.(occurrenceId) || null;
  // Capture ancestor chain BEFORE eviction so ancestor-scoped triggers
  // (e.g. tracker onDelete ancestorLabel:"Daily Goals") can match against
  // the occurrence's actual position in the tree at delete time.
  const ancestors = operationsBridge.getAncestorChain?.(occurrenceId) || { ids: [], labels: [] };
  // Evict from local cache BEFORE dispatch so fireOperations sees updated state
  operationsBridge.removeLocalOcc?.(occurrenceId);
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
  // CYCLE BREAKER (2026-05-25) — when `fireTrigger` is false the caller is an
  // operation effect deleting DERIVED data (a mirror op's row/card copy, via
  // applyOperationEffect → DELETE_ITEM / REMOVE_OCCURRENCE). Such deletions
  // must NOT fire OccurrenceDeleteOp + the per-field MeasureOp re-aggregation:
  //   - The trackers aggregate over Schedule tasks (HAS_ANCESTOR $schedPageId).
  //     A deleted table row / canvas card lives under $tblId / $canvasId, never
  //     under Schedule, so re-aggregating produces the IDENTICAL total — pure
  //     waste. In the toolkit-drop trace this was 17 OccurrenceDeleteOps ×
  //     ~300ms (42 tracker effects each) = the ~5s post-fix freeze.
  //   - Any op that genuinely needs downstream re-aggregation already runs it
  //     in the same runMatchingOperations sweep (liveOccs overlay) or via an
  //     explicit RUN_OPERATION tail. The mirror ops don't.
  // User-initiated deletes (drag-out, manual remove) keep fireTrigger=true so
  // trackers update normally. Pairs with the async-echo suppression
  // (opEmittedOccIds in bindSocketToStore) — same policy, both paths.
  if (!fireTrigger) return;
  // ONE trigger per user action. Delete fires OccurrenceDeleteOp only,
  // carrying the deleted occurrence's fields so field-scoped onDelete
  // subscribers (subjectType:"field" → transaction.fields[targetId]) match.
  // No piggyback MeasureOp — onChange is reserved for value edits.
  // The snapshot rides ON THE TRANSACTION (trigger context) instead of an
  // occurrencesOverride into executor state — state must exclude the deleted
  // occurrence or tracker recounts still count it (stale Tasks Completed).
  operationsBridge.fireOperations?.("OccurrenceDeleteOp", {
    type: "OccurrenceDeleteOp",
    occurrenceId,
    instanceId: snap?.moduleId,
    containerId: snap?.parentId,
    fields: snap?.fields || {},
    _ancestorIds: ancestors.ids,
    _ancestorLabels: ancestors.labels,
    _occurrenceSnapshot: snap || null,
  });
}

// Remove occurrence from grid + clean up parent reference (optimistic)
export function removeOccurrence(args) {
  if (!args?.occurrenceId) return undefined;
  if (args.fireTrigger === false) return _removeOccurrence(args);
  return withAction("Removed item", () => _removeOccurrence(args));
}

function _removeOccurrence({ dispatch, socket, occurrenceId, occurrence, parentOccurrence, grid, emit = true, fireTrigger = true }) {
  if (!occurrenceId) return;
  // Capture ancestor chain BEFORE eviction (see deleteOccurrence for rationale).
  const ancestors = operationsBridge.getAncestorChain?.(occurrenceId) || { ids: [], labels: [] };
  // Evict from local cache BEFORE dispatch so fireOperations sees updated state
  operationsBridge.removeLocalOcc?.(occurrenceId);
  // Update parent's occurrences array optimistically
  if (parentOccurrence) {
    const updatedOccs = (parentOccurrence.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateOccurrenceAction({ id: parentOccurrence.id, occurrences: updatedOccs }));
  } else if (grid) {
    const gid = grid._id?.toString?.() || grid.id;
    const updatedGridOccs = (grid.occurrences || []).filter(id => id !== occurrenceId);
    dispatch?.(updateGridAction({ gridId: gid, grid: { occurrences: updatedGridOccs } }));
  }
  // Delete the occurrence (server cascades children + cleans parent)
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
  // CYCLE BREAKER — derived-data sweeps (feed copies) skip the trigger and
  // suppress the server echo (see deleteOccurrence's fireTrigger doc).
  if (!fireTrigger) {
    operationsBridge.markDerivedOcc?.(occurrenceId);
    return;
  }
  // ONE trigger per user action — see deleteOccurrence above. The delete
  // carries fields so field-scoped onDelete/onRemove subscribers match.
  // Snapshot rides on the transaction (trigger context only) — see
  // deleteOccurrence for why it must not re-enter executor state.
  operationsBridge.fireOperations?.("OccurrenceDeleteOp", {
    type: "OccurrenceDeleteOp",
    occurrenceId,
    instanceId: occurrence?.moduleId,
    containerId: occurrence?.parentId,
    fields: occurrence?.fields || {},
    _ancestorIds: ancestors.ids,
    _ancestorLabels: ancestors.labels,
    _occurrenceSnapshot: occurrence || null,
  });
}

// ===== TRASH (soft delete) =====
export function trashModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(updateModuleAction({ id: moduleId, trashed: true }));
  if (shouldEmit(emit)) safeEmit(socket, "trash_module", { moduleId });
}

export function restoreModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(updateModuleAction({ id: moduleId, trashed: false }));
  if (shouldEmit(emit)) safeEmit(socket, "restore_module", { moduleId });
}

// ===== FIELD =====
export function createField({ dispatch, socket, field, emit = true }) {
  if (!field?.id) return;
  dispatch?.(createFieldAction(field));
  if (shouldEmit(emit)) safeEmit(socket, "create_field", { field });
}

export function updateField({ dispatch, socket, field, emit = true }) {
  if (!field?.id) return;
  dispatch?.(updateFieldAction(field));
  if (shouldEmit(emit)) safeEmit(socket, "update_field", { field });
}

export function deleteField({ dispatch, socket, fieldId, emit = true }) {
  if (!fieldId) return;
  dispatch?.(deleteFieldAction(fieldId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_field", { fieldId });
}

// ===== MANIFEST =====
export function createManifest({ dispatch, socket, manifest, emit = true }) {
  if (!manifest?.id) return;
  dispatch?.(createManifestAction(manifest));
  if (shouldEmit(emit)) safeEmit(socket, "create_manifest", { manifest });
}
export function updateManifest({ dispatch, socket, manifest, emit = true }) {
  if (!manifest?.id) return;
  dispatch?.(updateManifestAction(manifest));
  if (shouldEmit(emit)) safeEmit(socket, "update_manifest", { manifest });
}
export function deleteManifest({ dispatch, socket, manifestId, emit = true }) {
  if (!manifestId) return;
  dispatch?.(deleteManifestAction(manifestId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_manifest", { manifestId });
}

// ===== VIEW =====
export function createView({ dispatch, socket, view, emit = true }) {
  if (!view?.id) return;
  dispatch?.(createViewAction(view));
  if (shouldEmit(emit)) safeEmit(socket, "create_view", { view });
}
export function updateView({ dispatch, socket, view, emit = true }) {
  if (!view?.id) return;
  dispatch?.(updateViewAction(view));
  if (shouldEmit(emit)) safeEmit(socket, "update_view", { view });
}
export function deleteView({ dispatch, socket, viewId, emit = true }) {
  if (!viewId) return;
  dispatch?.(deleteViewAction(viewId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_view", { viewId });
}

// ===== FOLDER =====
export function createFolder({ dispatch, socket, folder, emit = true }) {
  if (!folder?.id) return;
  dispatch?.(createFolderAction(folder));
  if (shouldEmit(emit)) safeEmit(socket, "create_folder", { folder });
}
export function updateFolder({ dispatch, socket, folder, emit = true }) {
  if (!folder?.id) return;
  dispatch?.(updateFolderAction(folder));
  if (shouldEmit(emit)) safeEmit(socket, "update_folder", { folder });
}
export function deleteFolder({ dispatch, socket, folderId, emit = true }) {
  if (!folderId) return;
  dispatch?.(deleteFolderAction(folderId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_folder", { folderId });
}


// ===== PAGE (composite: module + view + occurrence + panel wiring) =====
export function createPage({ dispatch, socket, module, view, occurrence, panelOccurrenceId, panelViewData, emit = true }) {
  if (!module?.id || !occurrence?.id) return;
  dispatch?.(createModuleAction(module));
  if (view?.id) dispatch?.(createViewAction(view));
  dispatch?.(createOccurrenceAction(occurrence));
  if (panelOccurrenceId) {
    dispatch?.(updateOccurrenceAction({ id: panelOccurrenceId, _appendOcc: occurrence.id }));
  }
  if (panelViewData?.id) {
    dispatch?.(createViewAction(panelViewData));
    dispatch?.(updateOccurrenceAction({ id: panelOccurrenceId, viewId: panelViewData.id }));
  }
  if (shouldEmit(emit)) {
    safeEmit(socket, "create_page", { module, view, occurrence, panelOccurrenceId, panelViewData });
  }
}

// Mint a fresh page (module + occurrence) pinned to a panel — the shared body
// of ManifestTree's + ModulePanel's "create page" flows. Mints the panel's
// board View when it has none; `activate` flips an existing panel view to the
// new page (the right-click "Add page…" path wants that, the tree's + menu
// doesn't). Returns the new page occurrence id.
export function createPagePinnedToPanel({ dispatch, socket, gridId, userId, kind = "board", panelOccurrenceId, panelView = null, rootFolderId = null, activate = false }) {
  if (!panelOccurrenceId || !gridId || !userId) return null;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();
  const label = `${kind.charAt(0).toUpperCase() + kind.slice(1)} Page`;
  createPage({
    dispatch, socket,
    module: { id: modId, userId, gridId, role: "page", kind, label },
    // Carry both moduleId (schema canonical, read by pagesList) and targetId
    // (legacy alias still used by server's createOccurrenceData).
    occurrence: { id: occId, userId, gridId, moduleId: modId, targetId: modId, parentId: rootFolderId ?? null, iteration: { mode: "persistent" }, fields: {} },
    panelOccurrenceId,
    ...(!panelView?.id && {
      panelViewData: { id: crypto.randomUUID(), userId, gridId, viewType: "board", activeOccurrenceId: occId },
    }),
    emit: true,
  });
  if (activate && panelView?.id) {
    updateView({ dispatch, socket, view: { ...panelView, activeOccurrenceId: occId }, emit: true });
  }
  return occId;
}

export function deletePage({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId) return;
  dispatch?.(deleteOccurrenceAction(pageOccurrenceId));
  if (shouldEmit(emit)) {
    safeEmit(socket, "delete_page", { pageOccurrenceId, panelOccurrenceId });
  }
}

export function movePage({ dispatch, socket, pageOccurrenceId, targetFolderId, sortOrder, emit = true }) {
  if (!pageOccurrenceId) return;
  const patch = { id: pageOccurrenceId };
  if (targetFolderId !== undefined) patch.parentId = targetFolderId;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  dispatch?.(updateOccurrenceAction(patch));
  if (shouldEmit(emit)) {
    safeEmit(socket, "move_page", { pageOccurrenceId, targetFolderId, sortOrder });
  }
}

export function pinPageToPanel({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId || !panelOccurrenceId) return;
  dispatch?.(updateOccurrenceAction({
    id: panelOccurrenceId,
    _appendOcc: pageOccurrenceId,
  }));
  if (shouldEmit(emit)) {
    safeEmit(socket, "pin_page_to_panel", { pageOccurrenceId, panelOccurrenceId });
  }
}

export function unpinPageFromPanel({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId || !panelOccurrenceId) return;
  dispatch?.(updateOccurrenceAction({
    id: panelOccurrenceId,
    _removeOcc: pageOccurrenceId,
  }));
  if (shouldEmit(emit)) {
    safeEmit(socket, "unpin_page_from_panel", { pageOccurrenceId, panelOccurrenceId });
  }
}

// ===== GRID FILTER =====
export function updateGridFilter({ dispatch, socket, gridId, patch, emit = true }) {
  if (!gridId || !patch) return;
  dispatch?.({ type: "UPDATE_GRID", payload: { gridId, grid: patch } });
  if (shouldEmit(emit)) safeEmit(socket, "update_grid_filter", { gridId, ...patch });
}

// ---- templates ----
export function commitCloneSubtreeAsTemplate(socket, { sourceOccurrenceId, name, parentFolderId }) {
  if (!socket) return;
  safeEmit(socket, "clone_subtree_as_template", { sourceOccurrenceId, name, parentFolderId });
}

export function commitApplyTemplate(socket, { templateOccurrenceId, targetOccurrenceId, mode = "append" }) {
  if (!socket) return;
  safeEmit(socket, "apply_template", { templateOccurrenceId, targetOccurrenceId, mode });
}

export function commitSaveOverTemplate(socket, { sourceOccurrenceId, templateOccurrenceId }) {
  if (!socket) return;
  safeEmit(socket, "save_over_template", { sourceOccurrenceId, templateOccurrenceId });
}

// ===== OPERATION =====
export function createOperation({ dispatch, socket, operation, emit = true }) {
  if (!operation?.id) return;
  dispatch?.(createOperationAction(operation));
  if (shouldEmit(emit)) safeEmit(socket, "create_operation", { operation });
}

export function updateOperation({ dispatch, socket, operation, emit = true }) {
  if (!operation?.id) return;
  dispatch?.(updateOperationAction(operation));
  if (shouldEmit(emit)) safeEmit(socket, "update_operation", { operation });
}

export function deleteOperation({ dispatch, socket, operationId, emit = true }) {
  if (!operationId) return;
  dispatch?.(deleteOperationAction(operationId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_operation", { operationId });
}

// ---- file upload ----
// ===== OPERATION ACTIONS (used by operationExecutor effects + callable from UI) =====

/**
 * Set a single field value on a specific occurrence.
 * Handles optimistic dispatch + server emit.
 * Used by: operation executor UPDATE_ITEM_FIELD effect, future UI shortcuts.
 */
export function setOccurrenceFieldValue({ dispatch, socket, occurrences, occurrencesById, occurrenceId, fieldId, value, flow = "replace" }) {
  if (!occurrenceId || !fieldId) return;
  const lookup = occurrencesById || {};
  const listLookup = Array.isArray(occurrences)
    ? Object.fromEntries(occurrences.map(o => [o.id || o._id?.toString?.(), o]))
    : {};
  const occ = lookup[occurrenceId] || listLookup[occurrenceId];
  if (!occ) return;
  const updatedOcc = {
    ...occ,
    id: occurrenceId,
    fields: {
      ...occ.fields,
      [fieldId]: { value, flow, timestamp: Date.now() },
    },
  };
  // One undo step for the edit AND the tracker cascade it triggers. The fire
  // below is synchronous, so everything it writes is stamped with this action.
  beginAction("Changed a value");
  try {
    dispatch?.(updateOccurrenceAction(updatedOcc));
    // Update local occurrence cache + fire operations immediately (optimistic)
    operationsBridge.updateLocalOcc?.(updatedOcc);
    const sfvAncestors = operationsBridge.getAncestorChain?.(occurrenceId) || { ids: [], labels: [] };
    operationsBridge.fireOperations?.("MeasureOp", {
      type: "MeasureOp",
      occurrenceId,
      instanceId: occ.moduleId,
      fields: { [fieldId]: value },
      _ancestorIds: sfvAncestors.ids,
      _ancestorLabels: sfvAncestors.labels,
    });
    safeEmit(socket, "update_occurrence", { occurrence: updatedOcc });
  } finally {
    endAction();
  }
}

/**
 * Move an occurrence to a different container.
 * Server handles the parent re-linking; no optimistic dispatch needed.
 */
export function moveOccurrence({ socket, occurrenceId, toContainerId }) {
  if (!occurrenceId || !toContainerId) return;
  safeEmit(socket, "move_occurrence", { occurrenceId, toContainerId });
}

/**
 * Create a new occurrence from an instance in a container.
 */
export function createOccurrenceInContainer({ socket, instanceId, containerId, fields }) {
  if (!instanceId || !containerId) return;
  safeEmit(socket, "create_occurrence_in_container", { instanceId, containerId, fields });
}

// Creates a role:"textblock" module + occurrence and appends it to a container.
// Optimistic local dispatch + socket emits. Returns the created IDs.
// `kind` accepts "doc" (default — full block textblock) or "inline" (LT1 —
// compact inline variant that renders inside doc text flow when embedded).
// Splice `occurrenceId` into a parent's occurrences[] at `index` (append when
// null/out-of-range) and commit the new child list. The one insert-child
// primitive every create-in-container helper below shares. Returns the
// position the child landed at.
export function spliceChildIntoParent({ dispatch, socket, parentOccurrence, occurrenceId, index = null }) {
  const existing = Array.isArray(parentOccurrence.occurrences) ? [...parentOccurrence.occurrences] : [];
  const at = (index == null || index < 0 || index > existing.length) ? existing.length : index;
  existing.splice(at, 0, occurrenceId);
  updateOccurrence({
    dispatch, socket,
    occurrence: { id: parentOccurrence.id, occurrences: existing },
    emit: true,
  });
  return at;
}

// What the parent's effective filter says a NEW child should carry — the date,
// in practice. Returns null when there is nothing to stamp.
//
// Drops have folded these values into the create since 2026-05-07; the TYPED
// paths below never did, so a textblock or container made by typing / the +
// menu was born with no `fields` key at all and the date filter could not see
// it (user, 2026-08-05: "any occurrence can carry fields"). Resolved through the
// bridge rather than a parameter because the alternative — threading `state`
// into every call site — is exactly how the drop path and the typed path drifted
// apart in the first place. Never throws: a create must not fail because the
// bridge is unwired (unit tests) or the filter is unreadable.
function parentFilterFields(parentOccurrence) {
  try {
    const ctx = operationsBridge.getFilterContext?.();
    if (!ctx?.state || !parentOccurrence) return null;
    const merged = computePageFilterFields({
      state: ctx.state,
      occurrencesById: ctx.occurrencesById || {},
      parentContainerOcc: parentOccurrence,
      existingFields: {},
    });
    return merged && Object.keys(merged).length ? merged : null;
  } catch {
    return null;
  }
}

export function createTextblockInContainer({
  dispatch, socket, gridId, userId, containerOccurrence, label = "", kind = "doc", index = null,
}) {
  if (!gridId || !userId || !containerOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `tb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `to-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = {
    id: moduleId,
    userId,
    gridId,
    role: "textblock",
    kind,
    label: label || "",
  };
  const stamped = parentFilterFields(containerOccurrence);
  const occurrence = {
    id: occurrenceId,
    userId,
    gridId,
    moduleId,
    parentId: containerOccurrence.id,
    textmap: { type: "doc", content: [] },
    // Born with the date, not patched afterwards — a follow-up update races the
    // create's server queue, and the create's own trigger burst would evaluate
    // against a record that has no date yet.
    ...(stamped ? { fields: stamped } : {}),
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

  spliceChildIntoParent({ dispatch, socket, parentOccurrence: containerOccurrence, occurrenceId, index });

  return { moduleId, occurrenceId };
}

// Create a CONTAINER (board/doc/table/canvas) as a child of another container.
// Splices into the parent's occurrences[] at `index` AND flips the parent module's
// meta.allowChildContainers so the renderer actually shows the nested container
// (ModuleContainer only renders child containers when that flag is set).
export function createContainerInContainer({
  dispatch, socket, gridId, userId, containerOccurrence, containerModule = null,
  kind = "board", label = "", index = null,
}) {
  if (!gridId || !userId || !containerOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `co-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = { id: moduleId, userId, gridId, role: "container", kind, label: label || "" };
  const stamped = parentFilterFields(containerOccurrence);
  const occurrence = {
    id: occurrenceId, userId, gridId, moduleId,
    parentId: containerOccurrence.id,
    occurrences: [],
    // doc/canvas containers render a textmap; seed an empty one so they mount clean.
    ...((kind === "doc" || kind === "canvas") ? { textmap: { type: "doc", content: [] } } : {}),
    ...(stamped ? { fields: stamped } : {}),
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

  spliceChildIntoParent({ dispatch, socket, parentOccurrence: containerOccurrence, occurrenceId, index });

  // Make the parent render nested containers (once).
  const parentMeta = containerModule?.meta || {};
  if (!parentMeta.allowChildContainers && containerOccurrence.moduleId) {
    updateModule({
      dispatch, socket,
      module: { id: containerOccurrence.moduleId, meta: { ...parentMeta, allowChildContainers: true } },
    });
  }

  return { moduleId, occurrenceId };
}

// Create a PAGE (doc / table / canvas / board) from a container's add-menu and
// show it at that spot as a preview (user 2026-07-29: the page tiles "creating
// those pages and putting the preview viewed one in the place we are adding
// too").
//
// ONE module and ONE occurrence, deliberately. The occurrence is HOMED in the
// manifest folder (`parentId = folderId`, so the Local/Root tree lists it as a
// real page) and ALSO spliced into the container's `occurrences[]` — the
// multi-parent pattern the Schedule already uses to share one slot across
// several day-columns.
//
// Do NOT "solve" this with two occurrences, one per home: `textmap` lives on the
// OCCURRENCE, so a doc/canvas page would then carry two independent bodies and
// the in-container copy would render permanently empty.
//
// The layout cascade renders a page nested in a container as either a
// representation chip or `actual-converted` (inline container chrome), and
// defaults to the latter — which for a brand-new empty page is an empty box
// indistinguishable from just adding a container. So the occurrence carries the
// per-occurrence override that survives the cascade walk, pinning it to the
// compact representation view; the header switcher still lets the user flip it.
export function createPageInContainer({
  dispatch, socket, gridId, userId, containerOccurrence, containerModule = null,
  kind = "doc", label = "", index = null, folderId = null,
}) {
  if (!gridId || !userId || !containerOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `pm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `po-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = { id: moduleId, userId, gridId, role: "page", kind, label: label || "" };
  const occurrence = {
    id: occurrenceId, userId, gridId, moduleId,
    // Its home in the tree. Null (no manifest yet) leaves the container as its
    // only parent — still renders, just not listed in the tree.
    parentId: folderId || containerOccurrence.id,
    occurrences: [],
    meta: { layoutCascadeOverride: { dragInView: "representation" } },
    // doc/canvas pages render a textmap; seed an empty one so they mount clean.
    ...((kind === "doc" || kind === "canvas") ? { textmap: { type: "doc", content: [] } } : {}),
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

  spliceChildIntoParent({ dispatch, socket, parentOccurrence: containerOccurrence, occurrenceId, index });

  // The parent has to be willing to render a non-leaf child (same reason
  // createContainerInContainer flips it).
  const parentMeta = containerModule?.meta || {};
  if (!parentMeta.allowChildContainers && containerOccurrence.moduleId) {
    updateModule({
      dispatch, socket,
      module: { id: containerOccurrence.moduleId, meta: { ...parentMeta, allowChildContainers: true } },
    });
  }

  return { moduleId, occurrenceId };
}

// Upload a file as an artifact and place it inside a container. Pre-mints the
// module/occurrence ids so the server upsert lands on them, then optimistically
// splices the new occurrence into the container's occurrences[] at `index`.
export async function addArtifactToContainer({
  dispatch, socket, gridId, userId, containerOccurrence, file, index = null,
}) {
  if (!gridId || !userId || !containerOccurrence || !file) return null;
  const moduleId = crypto?.randomUUID?.() || `am-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `ao-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Optimistically splice the (not-yet-uploaded) occurrence into the container so
  // the slot shows immediately; the server fills in the module/occurrence content.
  const at = spliceChildIntoParent({ dispatch, socket, parentOccurrence: containerOccurrence, occurrenceId, index });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", userId);
  formData.append("gridId", gridId);
  formData.append("moduleId", moduleId);
  formData.append("occurrenceId", occurrenceId);
  try {
    const res = await fetch("/api/artifacts/upload", { method: "POST", body: formData });
    const data = await res.json();
    // Server emits module_created + occurrence_created; reducer is idempotent on id.
    // Ensure the artifact occurrence stays parented into the container.
    if (data?.occurrence?.id && data.occurrence.id !== occurrenceId) {
      // server minted a different id (no occurrenceId support) — re-splice the real one.
      const fixed = Array.isArray(containerOccurrence.occurrences) ? [...containerOccurrence.occurrences] : [];
      const idx = fixed.indexOf(occurrenceId);
      if (idx >= 0) fixed.splice(idx, 1, data.occurrence.id); else fixed.splice(at, 0, data.occurrence.id);
      updateOccurrence({ dispatch, socket, occurrence: { id: containerOccurrence.id, occurrences: fixed }, emit: true });
    }
    return data.module;
  } catch (err) {
    console.error("Artifact upload failed:", err);
    return null;
  }
}

// Image picked by URL (ImagePicker search / URL tab, or its upload tab which
// already returns a served URL) — no /api/artifacts/upload round-trip. Mints a
// remote-ref artifact module (same shape the importer uses for Wikipedia
// images: resolveFileRef passes absolute URLs through verbatim) + an
// occurrence spliced into the container. Synchronous — ids known up-front.
export function addImageArtifactFromUrl({
  dispatch, socket, gridId, userId, containerOccurrence, url, label = "", index = null,
}) {
  if (!gridId || !userId || !containerOccurrence || !url) return null;
  const moduleId = crypto?.randomUUID?.() || `im-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `io-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = {
    id: moduleId, userId, gridId,
    role: "artifact", kind: "image",
    label: label || "",
    fileRef: url,
    meta: { external: true },
  };
  const occurrence = {
    id: occurrenceId, userId, gridId, moduleId,
    parentId: containerOccurrence.id,
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

  spliceChildIntoParent({ dispatch, socket, parentOccurrence: containerOccurrence, occurrenceId, index });

  return { moduleId, occurrenceId };
}

// One router the container header + the InsertGap both call. Routes a QuickAddMenu
// "create" by kind/role to the right child-create path. Artifact needs a File
// (the menu opens an OS picker and passes it through).
export function createChildInContainer({
  dispatch, socket, gridId, userId, containerOccurrence, containerModule = null,
  kind = "instance", role = null, fieldIds = [], index = null, file = null, url = null,
  panelId = null, containerLabel = "", folderId = null,
}) {
  const args = { dispatch, socket, gridId, userId, containerOccurrence, index };
  // "page-<kind>" tiles create a real PAGE and show a preview of it here; the
  // bare kinds keep creating nested CONTAINERS (unchanged).
  if (typeof kind === "string" && kind.startsWith("page-")) {
    return createPageInContainer({
      ...args, containerModule, kind: kind.slice("page-".length), folderId,
    });
  }
  if (kind === "textblock" || role === "textblock") {
    return createTextblockInContainer({ ...args, kind: "doc" });
  }
  if (kind === "artifact" || role === "artifact") {
    if (url) return addImageArtifactFromUrl({ ...args, url });
    if (!file) return null;
    return addArtifactToContainer({ ...args, file });
  }
  if (["board", "doc", "table", "canvas"].includes(kind)) {
    return createContainerInContainer({ ...args, containerModule, kind });
  }
  // default: a leaf instance (with any pre-picked fields)
  return createLeafInstanceAtIndex({
    ...args, role: "instance", fieldIds,
    parentOccurrence: containerOccurrence,
    panelId, containerLabel,
  });
}

// Creates a role:"instance" module + occurrence with optional initialFields,
// appends it to a parent occurrence's occurrences[].
// Follows createTextblockInContainer pattern — optimistic dispatch + socket emits.
// Returns { moduleId, occurrenceId } synchronously (IDs are pre-minted).
export function createLeafInstanceInParent({
  dispatch, socket, gridId, userId, parentOccurrence, label = "", initialFields = {},
  panelId = null, containerLabel = "", fieldBindings = null,
}) {
  if (!gridId || !userId || !parentOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `li-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `lo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = {
    id: moduleId, userId, gridId,
    // No `kind`: it is inert on an instance leaf and the icon resolver prefers
    // kind over role, so a stray kind renders the WRONG icon (2026-07-29).
    role: "instance",
    label: label || "",
    // Optional bindings (the addNew option flow binds stamp fields hidden +
    // entry fields visible so a fresh option renders its inputs).
    ...(Array.isArray(fieldBindings) && fieldBindings.length ? { fieldBindings } : {}),
  };
  const occurrence = {
    id: occurrenceId, userId, gridId,
    moduleId,
    parentId: parentOccurrence.id,
    // Caller-supplied values win over the parent's filter stamp — the addNew
    // flow deliberately copies identity values off the chosen parent.
    fields: { ...(parentFilterFields(parentOccurrence) || {}), ...initialFields },
  };

  dispatch?.(createModuleAction(module));
  safeEmit(socket, "create_module", { module });
  // Through createOccurrence — NOT a raw dispatch+emit — so OccurrenceCreateOp
  // FIRES with the panel/container context. Without the trigger, the
  // "Schedule: Stamp Date & Time Slot" op never stamps + adds created via the
  // + menus, and an unstamped item fails every tracker's date gate FOREVER
  // ("history/courses don't update at all", 2026-07-13 repro).
  createOccurrence({ dispatch, socket, occurrence, emit: true, panelId, containerLabel });

  // Append to parent's occurrences[].
  updateOccurrence({
    dispatch, socket,
    occurrence: {
      id: parentOccurrence.id,
      occurrences: [...(parentOccurrence.occurrences || []), occurrenceId],
    },
    emit: true,
  });

  return { moduleId, occurrenceId };
}

// Insert-here affordance (project_block_wrap_l_shape sibling task): mint OR
// reuse a module as a new occurrence and splice it into the parent's
// occurrences[] at a SPECIFIC index (not appended). `existingModuleId` reuses a
// module the user picked from QuickAddMenu (a fresh placement of an existing
// template); when null a brand-new role:"instance" module is minted.
// Synchronous — the new occurrence id is known up-front so the splice has no
// race (unlike the App-level append path).
export function createLeafInstanceAtIndex({
  dispatch, socket, gridId, userId, parentOccurrence, index = null,
  existingModuleId = null, role = "instance", kind = null, label = "", initialFields = {},
  fieldIds = [], panelId = null, containerLabel = "",
}) {
  if (!gridId || !userId || !parentOccurrence) return null;
  const occurrenceId = crypto?.randomUUID?.() || `lo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Tolerate a full module object — QuickAddMenu.onSelect hands back the module
  // `m`, not its id. Normalize to the id string so the occurrence's moduleId is
  // never an object (callers also pass m?.id ?? m, but harden the helper too).
  let moduleId = existingModuleId && typeof existingModuleId === "object"
    ? existingModuleId.id
    : existingModuleId;

  if (!moduleId) {
    moduleId = crypto?.randomUUID?.() || `li-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // `kind` is omitted when null — it is the SUB-TYPE within a role and is
    // inert on instance/textblock leaves. Writing a junk one is not harmless:
    // getModuleTypeIcon prefers kind over role, so an instance carrying
    // kind:"board" renders the BOARD icon everywhere (2026-07-29 audit).
    const module = { id: moduleId, userId, gridId, role, label: label || "", ...(kind ? { kind } : {}) };
    // Bind any fields the user pre-picked in the QuickAddMenu field step.
    if (Array.isArray(fieldIds) && fieldIds.length) {
      module.fieldBindings = fieldIds.map(fid => ({ fieldId: fid, role: "input" }));
    }
    dispatch?.(createModuleAction(module));
    safeEmit(socket, "create_module", { module });
  }

  const occurrence = {
    id: occurrenceId, userId, gridId,
    moduleId,
    parentId: parentOccurrence.id,
    fields: { ...(parentFilterFields(parentOccurrence) || {}), ...initialFields },
  };
  // Through createOccurrence so OccurrenceCreateOp FIRES with panel/container
  // context — the raw dispatch+emit here never fired the create trigger, so
  // the Stamp op skipped every InsertGap / + menu placement: no Date/Time Slot
  // → the item failed every tracker's date gate forever (2026-07-13 repro).
  createOccurrence({ dispatch, socket, occurrence, emit: true, panelId, containerLabel });

  spliceChildIntoParent({ dispatch, socket, parentOccurrence, occurrenceId, index });

  return { moduleId, occurrenceId };
}

export async function uploadFile({ file, userId, gridId, parentFolderId = null, manifestId = null, dispatch }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", userId);
  if (gridId) formData.append("gridId", gridId);
  if (parentFolderId) formData.append("parentFolderId", parentFolderId);
  if (manifestId) formData.append("manifestId", manifestId);

  try {
    const res = await fetch("/api/artifacts/upload", { method: "POST", body: formData });
    const data = await res.json();
    // Server emits module_created + occurrence_created via socket.
    return data.module;
  } catch (err) {
    console.error("Upload failed:", err);
    return null;
  }
}