// helpers/CommitHelpers.js
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
  if (shouldEmit(emit)) socket?.emit("create_grid", { grid });
}

export function updateGrid({ dispatch, socket, gridId, grid, emit = true }) {
  if (!gridId || !grid) return;

  // ✅ action creator now expects { gridId, grid }
  dispatch?.(updateGridAction({ gridId, grid }));

  if (shouldEmit(emit)) socket?.emit("update_grid", { gridId, grid });
}

export function deleteGrid({ dispatch, socket, gridId, emit = true }) {
  if (!gridId) return;
  dispatch?.(deleteGridAction(gridId));
  if (shouldEmit(emit)) socket?.emit("delete_grid", { gridId });
}

// ===== MODULE (unified Panel + Container + Instance) =====
export function createModule({ dispatch, socket, module, emit = true }) {
  if (!module) return;
  dispatch?.(createModuleAction(module));
  if (shouldEmit(emit)) socket?.emit("create_module", { module });
}

export function updateModule({ dispatch, socket, module, emit = true }) {
  if (!module?.id) return;
  dispatch?.(updateModuleAction(module));
  if (shouldEmit(emit)) socket?.emit("update_module", { module });
}

export function deleteModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(deleteModuleAction(moduleId));
  if (shouldEmit(emit)) socket?.emit("delete_module", { moduleId });
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
    socket?.emit("create_instance_in_container", {
      containerId, instance,
      ...(occurrenceId ? { occurrenceId } : {}),
      ...(initialMeta ? { meta: initialMeta } : {}),
    });
  }
}

// ===== OCCURRENCE =====
export function createOccurrence({ dispatch, socket, occurrence, emit = true }) {
  if (!occurrence?.id) return;
  dispatch?.(createOccurrenceAction(occurrence));
  if (shouldEmit(emit)) socket?.emit("create_occurrence", { occurrence });
}

export function updateOccurrence({ dispatch, socket, occurrence, emit = true }) {
  if (!occurrence?.id) return;
  dispatch?.(updateOccurrenceAction(occurrence));
  if (shouldEmit(emit)) socket?.emit("update_occurrence", { occurrence });
}

export function deleteOccurrence({ dispatch, socket, occurrenceId, emit = true }) {
  if (!occurrenceId) return;
  dispatch?.(deleteOccurrenceAction(occurrenceId));
  if (shouldEmit(emit)) socket?.emit("delete_occurrence", { occurrenceId });
}

// Remove occurrence from grid + clean up parent reference (optimistic)
export function removeOccurrence({ dispatch, socket, occurrenceId, parentOccurrence, grid, emit = true }) {
  if (!occurrenceId) return;
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
  if (shouldEmit(emit)) socket?.emit("delete_occurrence", { occurrenceId });
}

// ===== TRASH (soft delete) =====
export function trashModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(updateModuleAction({ id: moduleId, trashed: true }));
  if (shouldEmit(emit)) socket?.emit("trash_module", { moduleId });
}

export function restoreModule({ dispatch, socket, moduleId, emit = true }) {
  if (!moduleId) return;
  dispatch?.(updateModuleAction({ id: moduleId, trashed: false }));
  if (shouldEmit(emit)) socket?.emit("restore_module", { moduleId });
}

// ===== FIELD =====
export function createField({ dispatch, socket, field, emit = true }) {
  if (!field?.id) return;
  dispatch?.(createFieldAction(field));
  if (shouldEmit(emit)) socket?.emit("create_field", { field });
}

export function updateField({ dispatch, socket, field, emit = true }) {
  if (!field?.id) return;
  dispatch?.(updateFieldAction(field));
  if (shouldEmit(emit)) socket?.emit("update_field", { field });
}

export function deleteField({ dispatch, socket, fieldId, emit = true }) {
  if (!fieldId) return;
  dispatch?.(deleteFieldAction(fieldId));
  if (shouldEmit(emit)) socket?.emit("delete_field", { fieldId });
}

// ===== MANIFEST =====
export function createManifest({ dispatch, socket, manifest, emit = true }) {
  if (!manifest?.id) return;
  dispatch?.(createManifestAction(manifest));
  if (shouldEmit(emit)) socket?.emit("create_manifest", { manifest });
}
export function updateManifest({ dispatch, socket, manifest, emit = true }) {
  if (!manifest?.id) return;
  dispatch?.(updateManifestAction(manifest));
  if (shouldEmit(emit)) socket?.emit("update_manifest", { manifest });
}
export function deleteManifest({ dispatch, socket, manifestId, emit = true }) {
  if (!manifestId) return;
  dispatch?.(deleteManifestAction(manifestId));
  if (shouldEmit(emit)) socket?.emit("delete_manifest", { manifestId });
}

// ===== VIEW =====
export function createView({ dispatch, socket, view, emit = true }) {
  if (!view?.id) return;
  dispatch?.(createViewAction(view));
  if (shouldEmit(emit)) socket?.emit("create_view", { view });
}
export function updateView({ dispatch, socket, view, emit = true }) {
  if (!view?.id) return;
  dispatch?.(updateViewAction(view));
  if (shouldEmit(emit)) socket?.emit("update_view", { view });
}
export function deleteView({ dispatch, socket, viewId, emit = true }) {
  if (!viewId) return;
  dispatch?.(deleteViewAction(viewId));
  if (shouldEmit(emit)) socket?.emit("delete_view", { viewId });
}

// ===== FOLDER =====
export function createFolder({ dispatch, socket, folder, emit = true }) {
  if (!folder?.id) return;
  dispatch?.(createFolderAction(folder));
  if (shouldEmit(emit)) socket?.emit("create_folder", { folder });
}
export function updateFolder({ dispatch, socket, folder, emit = true }) {
  if (!folder?.id) return;
  dispatch?.(updateFolderAction(folder));
  if (shouldEmit(emit)) socket?.emit("update_folder", { folder });
}
export function deleteFolder({ dispatch, socket, folderId, emit = true }) {
  if (!folderId) return;
  dispatch?.(deleteFolderAction(folderId));
  if (shouldEmit(emit)) socket?.emit("delete_folder", { folderId });
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
    socket?.emit("create_page", { module, view, occurrence, panelOccurrenceId, panelViewData });
  }
}

export function deletePage({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId) return;
  dispatch?.(deleteOccurrenceAction(pageOccurrenceId));
  if (shouldEmit(emit)) {
    socket?.emit("delete_page", { pageOccurrenceId, panelOccurrenceId });
  }
}

export function movePage({ dispatch, socket, pageOccurrenceId, targetFolderId, sortOrder, emit = true }) {
  if (!pageOccurrenceId) return;
  const patch = { id: pageOccurrenceId };
  if (targetFolderId !== undefined) patch.parentId = targetFolderId;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  dispatch?.(updateOccurrenceAction(patch));
  if (shouldEmit(emit)) {
    socket?.emit("move_page", { pageOccurrenceId, targetFolderId, sortOrder });
  }
}

export function pinPageToPanel({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId || !panelOccurrenceId) return;
  dispatch?.(updateOccurrenceAction({
    id: panelOccurrenceId,
    _appendOcc: pageOccurrenceId,
  }));
  if (shouldEmit(emit)) {
    socket?.emit("pin_page_to_panel", { pageOccurrenceId, panelOccurrenceId });
  }
}

export function unpinPageFromPanel({ dispatch, socket, pageOccurrenceId, panelOccurrenceId, emit = true }) {
  if (!pageOccurrenceId || !panelOccurrenceId) return;
  dispatch?.(updateOccurrenceAction({
    id: panelOccurrenceId,
    _removeOcc: pageOccurrenceId,
  }));
  if (shouldEmit(emit)) {
    socket?.emit("unpin_page_from_panel", { pageOccurrenceId, panelOccurrenceId });
  }
}

// ===== GRID FILTER =====
export function updateGridFilter({ dispatch, socket, gridId, patch, emit = true }) {
  if (!gridId || !patch) return;
  dispatch?.({ type: "UPDATE_GRID", payload: { gridId, grid: patch } });
  if (shouldEmit(emit)) socket?.emit("update_grid_filter", { gridId, ...patch });
}

// ---- templates ----
export function saveTemplate({ socket, gridId, template }) {
  if (!gridId || !template?.id) return;
  socket?.emit("save_template", { gridId, template });
}

export function fillFromTemplate({ socket, gridId, templateId, containerId, iterationValue }) {
  if (!gridId || !templateId || !containerId) return;
  socket?.emit("fill_from_template", { gridId, templateId, containerId, iterationValue });
}

// ===== OPERATION =====
export function createOperation({ dispatch, socket, operation, emit = true }) {
  if (!operation?.id) return;
  dispatch?.(createOperationAction(operation));
  if (shouldEmit(emit)) socket?.emit("create_operation", { operation });
}

export function updateOperation({ dispatch, socket, operation, emit = true }) {
  if (!operation?.id) return;
  dispatch?.(updateOperationAction(operation));
  if (shouldEmit(emit)) socket?.emit("update_operation", { operation });
}

export function deleteOperation({ dispatch, socket, operationId, emit = true }) {
  if (!operationId) return;
  dispatch?.(deleteOperationAction(operationId));
  if (shouldEmit(emit)) socket?.emit("delete_operation", { operationId });
}

// ---- file upload ----
// ===== OPERATION ACTIONS (used by operationExecutor effects + callable from UI) =====

/**
 * Set a single field value on a specific occurrence.
 * Handles optimistic dispatch + server emit.
 * Used by: operation executor SET_FIELD_VALUE effect, future UI shortcuts.
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
  socket?.emit("update_occurrence", { occurrence: updatedOcc });
}

/**
 * Move an occurrence to a different container.
 * Server handles the parent re-linking; no optimistic dispatch needed.
 */
export function moveOccurrence({ socket, occurrenceId, toContainerId }) {
  if (!occurrenceId || !toContainerId) return;
  socket?.emit("move_occurrence", { occurrenceId, toContainerId });
}

/**
 * Create a new occurrence from an instance in a container.
 */
export function createOccurrenceInContainer({ socket, instanceId, containerId, fields }) {
  if (!instanceId || !containerId) return;
  socket?.emit("create_occurrence_in_container", { instanceId, containerId, fields });
}

export async function uploadFile({ file, userId, gridId, dispatch }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", userId);
  if (gridId) formData.append("gridId", gridId);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();
    // Server now emits module_created via socket — no local dispatch needed
    return data.module;
  } catch (err) {
    console.error("Upload failed:", err);
    return null;
  }
}