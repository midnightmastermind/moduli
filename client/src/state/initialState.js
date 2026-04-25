// state/initialState.js

export const initialState = {
  // auth
  userId: localStorage.getItem("moduli-userId") || null,

  // grid
  gridId: localStorage.getItem("moduli-gridId") || null,
  grid: null,
  availableGrids: [],

  // modules (unified — role: "panel" | "container" | "instance")
  modules: [],

  // derived role arrays (kept in sync with modules for backward compat)
  panels: [],
  containers: [],
  instances: [],
  artifacts: [],
  textblocks: [],
  occurrences: [], // { id, targetType, targetId, gridId, filterOverride, hidden, ... }
  fields: [],      // { id, name, type, mode, ... }
  operations: [],  // { id, name, blockTree, targetFieldId, triggerType, ... }
  views: [],       // { id, viewType, hasTree, manifestId, activeOccurrenceId, layout }
  manifests: [],   // { id, rootFolderId }
  folders: [],     // { id, name, parentId, children, folderType }

  // computed values: client-only, written by operation executor
  // key = fieldId (global) or "fieldId:occurrenceId" (occurrence-specific)
  computedValues: {},

  // filter nav state: client-only, { [filterId]: ISO date string }
  filterNavState: {},

  // drag state
  activeId: null,
  activeSize: null,

  // rerender tick for draft-ref driven soft-sort
  softTick: 0,

  hydrated: false,
};
