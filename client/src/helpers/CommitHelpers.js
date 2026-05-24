// helpers/CommitHelpers.js
import { operationsBridge } from "../state/bindSocketToStore";
import { safeEmit } from "./offlineQueue";
import { buildParentMap } from "./dragHitTesting";
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
export function createOccurrence({ dispatch, socket, occurrence, emit = true, panelId = null, containerLabel = "", panelLabel = "" }) {
  if (!occurrence?.id) return;
  operationsBridge.updateLocalOcc?.(occurrence);
  dispatch?.(createOccurrenceAction(occurrence));
  if (shouldEmit(emit)) safeEmit(socket, "create_occurrence", { occurrence });
  operationsBridge.fireOperations?.("OccurrenceCreateOp", {
    type: "OccurrenceCreateOp",
    occurrenceId: occurrence.id,
    instanceId: occurrence.moduleId,
    containerId: occurrence.parentId,
    gridId: occurrence.gridId,
    ...(panelId ? { panelId } : {}),
    // Trigger enrichment — operations like Schedule: Stamp Date read these
    // off $trigger to populate slot fields. Without them the optimistic
    // create writes nulls that overwrite drop-side pre-stamps.
    containerLabel,
    panelLabel,
  });
  // Fire MeasureOp for each field so onChange operations (e.g. aggregations) retrigger on add
  const fields = occurrence.fields;
  if (fields) {
    for (const fieldId of Object.keys(fields)) {
      const fv = fields[fieldId];
      operationsBridge.fireOperations?.("MeasureOp", {
        type: "MeasureOp",
        occurrenceId: occurrence.id,
        instanceId: occurrence.moduleId,
        fieldId,
        value: fv && typeof fv === "object" && "value" in fv ? fv.value : fv,
      });
    }
  }
}

export function updateOccurrence({ dispatch, socket, occurrence, emit = true, triggerField = null }) {
  if (!occurrence?.id) return;
  // Conflict resolution (#26 cheapest-level): pass the local cache's
  // `updatedAt` so the server can reject this write when another window
  // landed a newer edit. Skipped silently when the local cache has no
  // updatedAt yet (first-write / pre-cache occurrence).
  const localPrev = operationsBridge.getLocalOcc?.(occurrence.id) || null;
  const expectedUpdatedAt = localPrev?.updatedAt || null;
  dispatch?.(updateOccurrenceAction(occurrence));
  if (shouldEmit(emit)) {
    const payload = expectedUpdatedAt
      ? { occurrence, expectedUpdatedAt }
      : { occurrence };
    safeEmit(socket, "update_occurrence", payload);
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
    operationsBridge.fireOperations?.("MeasureOp", {
      type: "MeasureOp",
      occurrenceId: occurrence.id,
      instanceId: triggerField.instanceId,
      fieldId: triggerField.fieldId,
      value: triggerField.value,
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

  // Fire NavigationOp for the source occurrence — onFilterChange / onNavigation
  // triggers configured with ancestorId/ancestorLabel use the source's ancestor
  // chain to decide scope.
  const sourceChain = _ancestorChain(id, occurrencesById, modulesById);
  operationsBridge.fireOperations?.("NavigationOp", {
    type: "NavigationOp",
    sourceOccurrenceId: id,
    occurrenceId: id,
    fieldId: navFieldId,
    date,
    activeFilterValues: filterOverride || {},
    _ancestorIds: sourceChain.ids,
    _ancestorLabels: sourceChain.labels,
  });

  // Cascade: descendants whose effective filter actually moved (still inheriting
  // any of the changed keys) need their own NavigationOp so per-occurrence
  // triggers (e.g. ancestorLabel:"Schedule" + subjectRole:"container" on a
  // timeslot) fire. The descendant's stored data is unchanged — only the
  // derived effective filter shifted — so without an explicit fire here, those
  // ops would never run when a parent's filter moves.
  if (changedKeys.length) {
    const affected = _walkInheritingDescendants(id, changedKeys, occurrencesById);
    for (const desc of affected) {
      const chain = _ancestorChain(desc.id, occurrencesById, modulesById);
      operationsBridge.fireOperations?.("NavigationOp", {
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
}

export function deleteOccurrence({ dispatch, socket, occurrenceId, occurrence, emit = true }) {
  if (!occurrenceId) return;
  // Evict from local cache BEFORE dispatch so fireOperations sees updated state
  operationsBridge.removeLocalOcc?.(occurrenceId);
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) safeEmit(socket, "delete_occurrence", { occurrenceId });
  const deleteOverride = occurrence ? { [occurrenceId]: occurrence } : null;
  const deleteOpts = deleteOverride ? { occurrencesOverride: deleteOverride } : undefined;
  // Fire onDelete/onRemove trigger immediately (occurrence visible via override for trigger checking)
  operationsBridge.fireOperations?.("OccurrenceDeleteOp", {
    type: "OccurrenceDeleteOp",
    occurrenceId,
    instanceId: occurrence?.moduleId,
    containerId: occurrence?.parentId,
  }, deleteOpts);
  // Defer MeasureOp until after React renders so _cachedBaseOccsById is rebuilt without this
  // occurrence — otherwise the aggregation still counts it and produces the same result
  if (occurrence?.fields) {
    const savedFields = occurrence.fields;
    const savedTargetId = occurrence.moduleId;
    requestAnimationFrame(() => {
      for (const fieldId of Object.keys(savedFields)) {
        operationsBridge.fireOperations?.("MeasureOp", {
          type: "MeasureOp",
          occurrenceId,
          instanceId: savedTargetId,
          fieldId,
        });
      }
    });
  }
}

// Remove occurrence from grid + clean up parent reference (optimistic)
export function removeOccurrence({ dispatch, socket, occurrenceId, occurrence, parentOccurrence, grid, emit = true }) {
  if (!occurrenceId) return;
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
  const removeOverride = occurrence ? { [occurrenceId]: occurrence } : null;
  const removeOpts = removeOverride ? { occurrencesOverride: removeOverride } : undefined;
  // Fire onDelete/onRemove trigger immediately
  operationsBridge.fireOperations?.("OccurrenceDeleteOp", {
    type: "OccurrenceDeleteOp",
    occurrenceId,
    instanceId: occurrence?.moduleId,
    containerId: occurrence?.parentId,
  }, removeOpts);
  // Defer MeasureOp until after React renders so _cachedBaseOccsById no longer has this occurrence
  if (occurrence?.fields) {
    const savedFields = occurrence.fields;
    const savedTargetId = occurrence.moduleId;
    requestAnimationFrame(() => {
      for (const fieldId of Object.keys(savedFields)) {
        operationsBridge.fireOperations?.("MeasureOp", {
          type: "MeasureOp",
          occurrenceId,
          instanceId: savedTargetId,
          fieldId,
        });
      }
    });
  }
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
  dispatch?.(updateOccurrenceAction(updatedOcc));
  // Update local occurrence cache + fire operations immediately (optimistic)
  operationsBridge.updateLocalOcc?.(updatedOcc);
  operationsBridge.fireOperations?.("MeasureOp", {
    type: "MeasureOp",
    occurrenceId,
    instanceId: occ.moduleId,
    fieldId,
    value,
  });
  safeEmit(socket, "update_occurrence", { occurrence: updatedOcc });
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
export function createTextblockInContainer({
  dispatch, socket, gridId, userId, containerOccurrence, label = "",
}) {
  if (!gridId || !userId || !containerOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `tb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `to-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = {
    id: moduleId,
    userId,
    gridId,
    role: "textblock",
    kind: "doc",
    label: label || "",
  };
  const occurrence = {
    id: occurrenceId,
    userId,
    gridId,
    moduleId,
    parentId: containerOccurrence.id,
    textmap: { type: "doc", content: [] },
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

  // Append to container occurrences[].
  updateOccurrence({
    dispatch, socket,
    occurrence: {
      id: containerOccurrence.id,
      occurrences: [...(containerOccurrence.occurrences || []), occurrenceId],
    },
    emit: true,
  });

  return { moduleId, occurrenceId };
}

// Creates a role:"instance" module + occurrence with optional initialFields,
// appends it to a parent occurrence's occurrences[].
// Follows createTextblockInContainer pattern — optimistic dispatch + socket emits.
// Returns { moduleId, occurrenceId } synchronously (IDs are pre-minted).
export function createLeafInstanceInParent({
  dispatch, socket, gridId, userId, parentOccurrence, label = "", initialFields = {},
}) {
  if (!gridId || !userId || !parentOccurrence) return null;
  const moduleId = crypto?.randomUUID?.() || `li-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const occurrenceId = crypto?.randomUUID?.() || `lo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const module = {
    id: moduleId, userId, gridId,
    role: "instance", kind: "board",
    label: label || "",
  };
  const occurrence = {
    id: occurrenceId, userId, gridId,
    moduleId,
    parentId: parentOccurrence.id,
    fields: initialFields,
  };

  dispatch?.(createModuleAction(module));
  dispatch?.(createOccurrenceAction(occurrence));
  safeEmit(socket, "create_module", { module });
  safeEmit(socket, "create_occurrence", { occurrence });

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