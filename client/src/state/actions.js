// state/actions.js
// =========================================
// actions.js — SINGLE SOURCE OF TRUTH
// =========================================

export const ActionTypes = {
  FULL_STATE: "FULL_STATE",

  SET_USER_ID: "SET_USER_ID",
  SET_GRID_ID: "SET_GRID_ID",
  LOGOUT: "LOGOUT",

  CREATE_GRID: "CREATE_GRID",
  UPDATE_GRID: "UPDATE_GRID",
  DELETE_GRID: "DELETE_GRID",
  SET_AVAILABLE_GRIDS: "SET_AVAILABLE_GRIDS",
  SET_GRID: "SET_GRID",

  CREATE_INSTANCE_IN_CONTAINER: "CREATE_INSTANCE_IN_CONTAINER",

  CREATE_OCCURRENCE: "CREATE_OCCURRENCE",
  UPDATE_OCCURRENCE: "UPDATE_OCCURRENCE",
  DELETE_OCCURRENCE: "DELETE_OCCURRENCE",
  SET_OCCURRENCES: "SET_OCCURRENCES",

  CREATE_FIELD: "CREATE_FIELD",
  UPDATE_FIELD: "UPDATE_FIELD",
  DELETE_FIELD: "DELETE_FIELD",
  SET_FIELDS: "SET_FIELDS",

  // ---- manifests ----
  CREATE_MANIFEST: "CREATE_MANIFEST",
  UPDATE_MANIFEST: "UPDATE_MANIFEST",
  DELETE_MANIFEST: "DELETE_MANIFEST",

  // ---- views ----
  CREATE_VIEW: "CREATE_VIEW",
  UPDATE_VIEW: "UPDATE_VIEW",
  DELETE_VIEW: "DELETE_VIEW",

  // ---- folders ----
  CREATE_FOLDER: "CREATE_FOLDER",
  UPDATE_FOLDER: "UPDATE_FOLDER",
  DELETE_FOLDER: "DELETE_FOLDER",

  // ---- operations ----
  CREATE_OPERATION: "CREATE_OPERATION",
  UPDATE_OPERATION: "UPDATE_OPERATION",
  DELETE_OPERATION: "DELETE_OPERATION",

  // ---- modules (unified Panel + Container + Instance) ----
  CREATE_MODULE: "CREATE_MODULE",
  UPDATE_MODULE: "UPDATE_MODULE",
  DELETE_MODULE: "DELETE_MODULE",
  SET_MODULES: "SET_MODULES",

  // ---- computed values (client-only, written by operation executor) ----
  SET_COMPUTED_VALUES: "SET_COMPUTED_VALUES",

  BATCH_UPDATE_MODULES: "BATCH_UPDATE_MODULES",

  SET_ACTIVE_ID: "SET_ACTIVE_ID",
  SET_ACTIVE_SIZE: "SET_ACTIVE_SIZE",
  SOFT_TICK: "SOFT_TICK",
};

// ---- hydration ----
export const fullStateAction = (payload) => ({
  type: ActionTypes.FULL_STATE,
  payload,
});

// ---- auth/user ----
export const setUserIdAction = (userId) => ({
  type: ActionTypes.SET_USER_ID,
  payload: { userId },
});

export const setGridIdAction = (gridId) => ({
  type: ActionTypes.SET_GRID_ID,
  payload: { gridId },
});

export const logoutAction = () => ({ type: ActionTypes.LOGOUT });

// ---- grids ----
export const setGridAction = (grid) => ({
  type: ActionTypes.SET_GRID,
  payload: { grid },
});

export const setAvailableGridsAction = (availableGrids) => ({
  type: ActionTypes.SET_AVAILABLE_GRIDS,
  payload: { availableGrids },
});

export const createGridAction = (grid) => ({
  type: ActionTypes.CREATE_GRID,
  payload: { grid },
});

// ✅ FIX: now matches reducer expectations
export const updateGridAction = ({ gridId, grid }) => ({
  type: ActionTypes.UPDATE_GRID,
  payload: { gridId, grid },
});

export const deleteGridAction = (gridId) => ({
  type: ActionTypes.DELETE_GRID,
  payload: { gridId },
});

export const createInstanceInContainerAction = ({ containerId, instance }) => ({
  type: ActionTypes.CREATE_INSTANCE_IN_CONTAINER,
  payload: { containerId, instance },
});

// ---- occurrences ----
export const setOccurrencesAction = (occurrences) => ({
  type: ActionTypes.SET_OCCURRENCES,
  payload: { occurrences },
});

export const createOccurrenceAction = (occurrence) => ({
  type: ActionTypes.CREATE_OCCURRENCE,
  payload: { occurrence },
});

export const updateOccurrenceAction = (occurrence) => ({
  type: ActionTypes.UPDATE_OCCURRENCE,
  payload: { occurrence },
});

export const deleteOccurrenceAction = (occurrenceId) => ({
  type: ActionTypes.DELETE_OCCURRENCE,
  payload: { occurrenceId },
});

// ---- fields ----
export const setFieldsAction = (fields) => ({
  type: ActionTypes.SET_FIELDS,
  payload: { fields },
});

export const createFieldAction = (field) => ({
  type: ActionTypes.CREATE_FIELD,
  payload: { field },
});

export const updateFieldAction = (field) => ({
  type: ActionTypes.UPDATE_FIELD,
  payload: { field },
});

export const deleteFieldAction = (fieldId) => ({
  type: ActionTypes.DELETE_FIELD,
  payload: { fieldId },
});

// ---- dnd/ui ----
export const setActiveIdAction = (activeId) => ({
  type: ActionTypes.SET_ACTIVE_ID,
  payload: { activeId },
});

export const setActiveSizeAction = (activeSize) => ({
  type: ActionTypes.SET_ACTIVE_SIZE,
  payload: { activeSize },
});

export const softTickAction = () => ({
  type: ActionTypes.SOFT_TICK,
});

// ---- manifests ----
export const createManifestAction = (manifest) => ({
  type: ActionTypes.CREATE_MANIFEST,
  payload: { manifest },
});
export const updateManifestAction = (manifest) => ({
  type: ActionTypes.UPDATE_MANIFEST,
  payload: { manifest },
});
export const deleteManifestAction = (manifestId) => ({
  type: ActionTypes.DELETE_MANIFEST,
  payload: { manifestId },
});

// ---- views ----
export const createViewAction = (view) => ({
  type: ActionTypes.CREATE_VIEW,
  payload: { view },
});
export const updateViewAction = (view) => ({
  type: ActionTypes.UPDATE_VIEW,
  payload: { view },
});
export const deleteViewAction = (viewId) => ({
  type: ActionTypes.DELETE_VIEW,
  payload: { viewId },
});

// ---- folders ----
export const createFolderAction = (folder) => ({
  type: ActionTypes.CREATE_FOLDER,
  payload: { folder },
});
export const updateFolderAction = (folder) => ({
  type: ActionTypes.UPDATE_FOLDER,
  payload: { folder },
});
export const deleteFolderAction = (folderId) => ({
  type: ActionTypes.DELETE_FOLDER,
  payload: { folderId },
});

// ---- operations ----
export const createOperationAction = (operation) => ({
  type: ActionTypes.CREATE_OPERATION,
  payload: { operation },
});
export const updateOperationAction = (operation) => ({
  type: ActionTypes.UPDATE_OPERATION,
  payload: { operation },
});
export const deleteOperationAction = (operationId) => ({
  type: ActionTypes.DELETE_OPERATION,
  payload: { operationId },
});

// ---- modules ----
export const setModulesAction = (modules) => ({
  type: ActionTypes.SET_MODULES,
  payload: { modules },
});
export const createModuleAction = (module) => ({
  type: ActionTypes.CREATE_MODULE,
  payload: { module },
});
export const updateModuleAction = (module) => ({
  type: ActionTypes.UPDATE_MODULE,
  payload: { module },
});
export const deleteModuleAction = (moduleId) => ({
  type: ActionTypes.DELETE_MODULE,
  payload: { moduleId },
});

// ---- batch modules ----
export const batchUpdateModulesAction = (modules) => ({
  type: ActionTypes.BATCH_UPDATE_MODULES,
  payload: { modules },
});

// ---- computed values ----
// updates: [{ fieldId, occurrenceId?, value }]
// key = fieldId (global) or "fieldId:occurrenceId" (occurrence-specific)
export const setComputedValuesAction = (updates) => ({
  type: ActionTypes.SET_COMPUTED_VALUES,
  payload: { updates },
});