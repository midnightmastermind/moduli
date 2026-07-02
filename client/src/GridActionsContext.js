// GridActionsContext.js
//
// Migrated to use-context-selector so per-id subscriptions (useGridActionsSelector)
// only re-render when their specific slice changes. The previous monolithic
// React.useContext caused ~162 component re-renders per drop because the
// actionsValue memo invalidates on every occurrencesById update.
//
// Public API:
//   - GridActionsContext: the use-context-selector context (use with Provider as before)
//   - useGridActions(): subscribe to the full context value (re-renders on any change)
//   - useGridActionsSelector(selector): subscribe to a slice (re-renders only when
//     the selector's return value changes via Object.is). Hot-path components
//     (ModuleInstance / ModuleContainer / ModulePanel / ModulePage / PageBoard)
//     use this to read their own occurrence/module by id.
import { useRef } from "react";
import { createContext, useContext, useContextSelector } from "use-context-selector";

const DEFAULT_VALUE = {
  socket: null,
  dispatch: () => {},

  // Full state object (for calculations)
  state: {},

  // Stable NON-subscribing getters (see App.jsx lookupsRef) — callback-time /
  // rare-path reads of the per-write-rebuilt maps without subscribing to them.
  getOcc: () => null,
  getMod: () => null,
  getOccMap: () => ({}),
  getModMap: () => ({}),
  getParentId: () => null,
  getLinkedGroup: () => [],
  getState: () => ({}),

  // action creators (passed in)
  updatePanel: () => {},
  updateGrid: () => {},

  // lookups (passed in)
  modulesById: Object.create(null),
  roleByModuleId: Object.create(null),
  instancesById: Object.create(null),
  artifactsById: Object.create(null),
  textblocksById: Object.create(null),
  leafModulesById: Object.create(null),
  occurrencesById: Object.create(null),
  linkedGroupIndex: Object.create(null),
  childrenByParentId: Object.create(null),
  occurrencesByModuleId: Object.create(null),
  parentByChildId: Object.create(null),
  containersById: Object.create(null),
  fieldsById: Object.create(null),
  pagesById: Object.create(null),
  panelsById: Object.create(null),
  manifestsById: Object.create(null),
  viewsById: Object.create(null),
  foldersById: Object.create(null),
  operationsById: Object.create(null),

  // adders (passed in)
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
  // NOTE: computedValues, undo/redo, isMobileLayout, activeCell, zoomedOut
  // moved to GridLiveContext (C4 context split)
};

export const GridActionsContext = createContext(DEFAULT_VALUE);

export function useGridActions() {
  return useContext(GridActionsContext);
}

export function useGridActionsSelector(selector) {
  return useContextSelector(GridActionsContext, selector);
}

// Like useGridActionsSelector, but for selectors that RETURN AN ARRAY built
// fresh each call (e.g. a container mapping its child ids to occurrence
// objects). Object.is on a fresh array always differs, which would re-render
// the subscriber on EVERY context change — the exact broad-map storm this
// selector layer exists to prevent. This variant returns the PREVIOUS array
// when the new one is element-wise identical, so subscribers re-render only
// when a member reference actually changed.
export function useGridActionsSelectorShallow(selector) {
  const cache = useRef(null);
  return useContextSelector(GridActionsContext, (s) => {
    const next = selector(s);
    const prev = cache.current;
    if (
      Array.isArray(next) && Array.isArray(prev) &&
      prev.length === next.length &&
      next.every((v, i) => v === prev[i])
    ) {
      return prev;
    }
    cache.current = next;
    return next;
  });
}
