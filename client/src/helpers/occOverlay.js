// helpers/occOverlay.js
//
// The local occurrence overlay, and the ONE cached merge of it onto a base map.
//
// WHY THIS IS ITS OWN FILE. `applyOperationEffect` rebuilt
// `{ ...state.occurrencesById, ...localOccsById }` in SEVEN of its cases —
// once per effect applied. On the load sweep BOTH maps hold every occurrence
// on the grid (runLoadSweep seeds the local map from the full payload: 21,207
// on poms grid), so that is ~42,000 property copies per effect and ~195
// effects per load: **8.3 million copies**. Measured on the live grid, every
// effect cost a flat ~10ms regardless of what it did —
//
//     UPDATE_ITEM_FIELD             142   1452ms   10.2ms each
//     UPDATE_ITEM_LABEL              48    469ms    9.8ms each
//     UPDATE_ITEM_META                2     19ms    9.6ms each
//     UPDATE_ITEM_TEXTMAP             1      0ms    0.1ms each   <- builds no overlay
//     SCROLL_TO                       1      0ms    0.0ms each   <- builds no overlay
//
// — and those last two lines are the measurement: the only two effect cases
// that do not build an overlay are the only two that are free.
//
// THIS IS THE 2026-08-25 (9) DEFECT IN THE SIBLING FUNCTION. That session found
// and cached the identical merge in `_fireOperationsInner`, and the seven
// rebuilds one function over went untouched. Both consumers call in here now,
// so there is one implementation of one decision and it cannot drift again.
//
// WHY A VERSION COUNTER AND NOT A FINGERPRINT. The 2026-08-25 (9) cache
// compared the local map's key list and value identities rather than counting
// writes, because there were ~20 scattered assignment sites and "a missed bump
// would serve operations stale occurrences, which is a correctness bug, not a
// perf one". That risk is real — and the answer to it is a chokepoint, not a
// scan. Every write goes through `set`/`drop`/`reset` here, so the counter
// cannot be missed, and `occOverlayChokepoint.test.js` greps the consumer for
// raw mutation so the twenty-second caller cannot reintroduce one.
//
// It also matters that the scan was not cheap where it counted: the
// fingerprint's premise — the local overlay is "tiny, a couple of dozen entries
// during a cascade" — is FALSE during the load sweep, where it holds all 21,207
// occurrences. The scan was O(21,207) per call to avoid an O(42,414) copy.

/**
 * @returns an overlay whose `map` is the live local occurrence cache. Reads go
 *   straight to `map`; every WRITE must go through `set` / `drop` / `reset`.
 */
export function makeOccOverlay() {
  const map = {};
  let version = 0;
  // Keyed on the BASE MAP'S IDENTITY. A WeakMap rather than a single slot for
  // two reasons: the two consumers pass different base maps (the load sweep's
  // `hydratedState.occurrencesById` and the fire path's `_cachedBaseOccsById`),
  // so one slot would thrash between them; and a superseded base stays
  // collectable. Base maps are REPLACED, never patched, on every change — which
  // is what makes identity a sound version for the base half.
  const cache = new WeakMap();

  return {
    map,
    get version() { return version; },

    set(id, occ) {
      if (!id) return occ;
      map[id] = occ;
      version++;
      return occ;
    },

    drop(id) {
      // Guarded so a delete of something absent cannot invalidate the cache for
      // nothing — this runs on every server echo for an occurrence we never
      // held.
      if (!(id in map)) return false;
      delete map[id];
      version++;
      return true;
    },

    reset() {
      for (const key in map) delete map[key];
      version++;
    },

    /**
     * `base` overlaid with the local map, local winning — cached until either
     * the base identity or the local version changes.
     *
     * With NO base (every path except the load sweep — the reducer keeps
     * `occurrences` as a flat ARRAY and carries no `occurrencesById`) the local
     * map IS the answer, and copying it would be pure waste. The returned
     * object is shared and MUST be treated as read-only by callers.
     */
    merged(base) {
      if (!base) return map;
      const hit = cache.get(base);
      if (hit && hit.version === version) return hit.merged;
      const merged = Object.assign({}, base, map);
      cache.set(base, { version, merged });
      return merged;
    },
  };
}
