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
  artifactsById: Object.create(null),
  textblocksById: Object.create(null),
  leafModulesById: Object.create(null),
  occurrencesById: Object.create(null),
  linkedGroupIndex: Object.create(null),
  childrenByParentId: Object.create(null),
  containersById: Object.create(null),
  fieldsById: Object.create(null),
  pagesById: Object.create(null),
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

  // Filter system handlers
  onSelectFilter: () => {},
  onFilterValueChange: () => {},
  // NOTE: computedValues, undo/redo, isMobile, activeCell, zoomedOut
  // moved to GridLiveContext (C4 context split)
});