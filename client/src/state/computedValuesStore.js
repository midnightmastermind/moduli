// state/computedValuesStore.js
// ============================================================
// Per-key subscription store for computedValues (display field outputs,
// keyed "fieldId" or "fieldId:occurrenceId").
//
// WHY: computedValues used to ride on GridLiveContext. Every op drain
// dispatches SET_COMPUTED_VALUES → new map identity → the context value
// swapped → EVERY consumer re-rendered (all mounted FieldRenderers, all
// ModuleInstances, panels, pages) — several waves per drop because the
// drain is chunked. That was the bulk of the drop frame-1 flush.
//
// The reducer's merge preserves the identity of unchanged per-key entry
// objects, so a useSyncExternalStore snapshot that returns ONE entry only
// changes identity when THAT key was updated — React bails everywhere else.
//
// App.jsx (and PagePreviewApp for the preview iframe) publish the reducer's
// map here via useLayoutEffect, so subscribers update in the same commit
// window, pre-paint. The reducer stays the single source of truth; this is
// a render-subscription fan-out layer, not a second store of record.
// ============================================================
import { useSyncExternalStore } from "react";

let _map = Object.create(null);
const _listeners = new Set();

export function publishComputedValues(map) {
  _map = map || Object.create(null);
  for (const l of _listeners) l();
}

export function getComputedValuesMap() {
  return _map;
}

function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Entry for one key ("fieldId" or "fieldId:occId"). Re-renders only when
 *  that entry's identity changes. */
export function useComputedValue(key) {
  return useSyncExternalStore(subscribe, () => (key ? _map[key] : undefined));
}

/** FieldRenderer's read: the per-occurrence key wins when present, else the
 *  bare field key. Snapshot is entry identity → per-key granularity. */
export function useComputedValueWithFallback(primaryKey, fallbackKey) {
  return useSyncExternalStore(subscribe, () => {
    if (primaryKey && _map[primaryKey] !== undefined) return _map[primaryKey];
    return fallbackKey ? _map[fallbackKey] : undefined;
  });
}

/** Whole map — re-renders on every publish. For consumers that genuinely
 *  scan all keys (doc pills). Prefer the per-key hooks everywhere else. */
export function useComputedValuesMap() {
  return useSyncExternalStore(subscribe, () => _map);
}
