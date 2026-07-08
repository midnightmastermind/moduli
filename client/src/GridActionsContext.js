// GridActionsContext.js
//
// Store-in-context (react-redux pattern): the React context carries a STABLE
// per-provider store object; the provider publishes each new actionsValue into
// the store pre-paint, and selector hooks subscribe via
// useSyncExternalStoreWithSelector.
//
// WHY (2026-07-07, replaces use-context-selector): u-c-s notifies EVERY
// consumer's reducer on every provider value change; when React can't take the
// eager same-state bailout (busy lanes — e.g. the post-drop commit) the
// consumer's body still RENDERS once even though its selected slice is
// unchanged (React only prunes the children cascade). Measured via the
// __RENDER_ATTR probe: ~350 phantom component renders per drop (~120
// containers + ~70 instances + ~150 fields with byte-identical props AND
// selector outputs). uSES-with-selector compares snapshots OUTSIDE render —
// an unchanged slice means NO render at all.
//
// The store lives per-provider (not module-level) so PagePreviewApp's preview
// subtrees and test harnesses keep their own scoped values, exactly like the
// old context did.
//
// Public API (unchanged):
//   - GridActionsContext.Provider: value-taking provider, same as before
//   - useGridActions(): subscribe to the full context value (re-renders on any change)
//   - useGridActionsSelector(selector): subscribe to a slice (re-renders only when
//     the selector's return value changes via Object.is). Hot-path components
//     (ModuleInstance / ModuleContainer / ModulePanel / ModulePage / PageBoard)
//     use this to read their own occurrence/module by id.
//   - useGridActionsSelectorShallow(selector): array-returning selectors;
//     re-renders only when an element identity changed.
import { createContext, createElement, useContext, useLayoutEffect, useRef } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector.js";

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

function makeStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// Bare renders (no provider — unit tests mounting a component directly) fall
// back to a static store holding the defaults, mirroring a plain context's
// default value.
const _defaultStore = makeStore(DEFAULT_VALUE);
const StoreContext = createContext(_defaultStore);

function GridActionsProvider({ value, children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = makeStore(value ?? DEFAULT_VALUE);
  // Publish pre-paint. Subscribers whose slices changed re-render in the
  // layout-effect flush of the same commit window; unchanged ones don't
  // render at all. Same staleness window the use-context-selector provider
  // had (it also published from a layout effect).
  useLayoutEffect(() => {
    storeRef.current.set(value ?? DEFAULT_VALUE);
  }, [value]);
  return createElement(StoreContext.Provider, { value: storeRef.current }, children);
}

// Compat shim — call sites render <GridActionsContext.Provider value={...}>.
export const GridActionsContext = { Provider: GridActionsProvider };

const identity = (x) => x;

export function useGridActions() {
  const store = useContext(StoreContext);
  return useSyncExternalStoreWithSelector(store.subscribe, store.get, store.get, identity);
}

export function useGridActionsSelector(selector) {
  const store = useContext(StoreContext);
  return useSyncExternalStoreWithSelector(store.subscribe, store.get, store.get, selector);
}

// Element-wise equality for selectors that build a fresh array per run (e.g.
// a container mapping its child ids to occurrence objects) — Object.is on a
// fresh array always differs, which would re-render the subscriber on every
// store publish. with-selector keeps the PREVIOUS array (and skips the
// re-render) when this comparator says nothing inside changed.
function shallowArrayEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

export function useGridActionsSelectorShallow(selector) {
  const store = useContext(StoreContext);
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.get,
    store.get,
    selector,
    shallowArrayEqual
  );
}
