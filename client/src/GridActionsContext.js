// GridActionsContext.js
import { createContext } from "react";

export const GridActionsContext = createContext({
  socket: null,
  dispatch: () => {},

  // Full state object (for calculations)
  state: {},

  // action creators (you pass these)
  updatePanel: () => {},
  updateGrid: () => {},

  // lookups (you pass these)
  modulesById: Object.create(null),
  roleByModuleId: Object.create(null),
  instancesById: Object.create(null),
  occurrencesById: Object.create(null),
  containersById: Object.create(null),
  fieldsById: Object.create(null),
  panelsById: Object.create(null),
  manifestsById: Object.create(null),
  viewsById: Object.create(null),
  foldersById: Object.create(null),
  operationsById: Object.create(null),

  // adders (you pass these)
  addContainerToPanel: () => {},
  addInstanceToContainer: () => {},

  // Doc navigation — called by [[doc]] links to navigate the containing panel
  setSelectedDocId: () => {},

  // Field CRUD actions (grid-level field management)
  createField: () => {},
  updateField: () => {},
  deleteField: () => {},

  // Computed values: written by operation executor, read by display fields
  // key = fieldId (global) or "fieldId:occurrenceId" (occurrence-specific)
  computedValues: Object.create(null),

  // Undo/Redo state (lifted to App.jsx)
  canUndo: false,
  canRedo: false,
  undo: () => {},
  redo: () => {},
  isProcessing: false,
});