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
  let cache = new WeakMap();
  const tombstones = new Set();

  return {
    map,
    get version() { return version; },

    set(id, occ) {
      if (!id) return occ;
      tombstones.delete(id);
      map[id] = occ;
      version++;
      return occ;
    },

    drop(id) {
      // Guarded so a delete of something absent cannot invalidate the cache for
      // nothing — this runs on every server echo for an occurrence we never
      // held.
      //
      // A DROP IS A DELETE, so it also records a TOMBSTONE that hides the BASE
      // copy. The base is React state, assigned on RENDER, and a delete fires
      // its operations in the same tick — so at fire time the base still holds
      // the row, and without this the merge fell back to it: every tracker's
      // onDelete recount still counted the deleted row (2026-09-27, Daily
      // Coffee 24 -> 24 after deleting a 4oz coffee). Recording it does not
      // bump the version; `merged` rebuilds only when a cached merge actually
      // CONTAINS a tombstoned id, so the unheld-echo guard above still holds.
      if (id) tombstones.add(id);
      if (!(id in map)) return false;
      delete map[id];
      version++;
      return true;
    },

    reset() {
      tombstones.clear();
      for (const key in map) delete map[key];
      version++;
      // Emptying the map is the ONE thing that can retract a coverage verdict,
      // so the verdicts go with it. A WeakMap cannot be cleared in place.
      cache = new WeakMap();
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
      // Prune tombstones the base no longer holds: the re-render landed, or
      // the id was an echo for a row this tab never had. That keeps the set the
      // size of the in-flight deletes, and a row that comes BACK into the base
      // without a `set` is not hidden.
      let hiddenInCache = false;
      const hit = cache.get(base);
      for (const t of tombstones) {
        if (!(t in base)) tombstones.delete(t);
        else if (hit && hit.merged && t in hit.merged) hiddenInCache = true;
      }
      // THE LOCAL MAP ALREADY COVERS THE BASE — so the merge IS the local map,
      // and copying is pure waste. That is not a lucky case, it is how the load
      // sweep is built: `runLoadSweep` fills its own `occurrencesById` and calls
      // `setLocalOcc` for the SAME rows in the SAME pass, so every key of the
      // base is a key of `map` and local wins for all of them. Same reasoning
      // `merged(null)` already applies to the no-base path, and the object
      // handed back is live there too.
      //
      // WHY THIS IS CHECKED ONCE PER BASE AND NOT PER CALL: coverage cannot be
      // lost. `set` only ever ADDS a key, and `drop` removes one while
      // recording a TOMBSTONE whose whole job is to hide the base copy as well
      // — so a row missing from `map` after a drop is a row the merge must not
      // carry either. Only `reset()` can break it, and it clears the cache.
      //
      // Without this the version counter defeated the cache once per write: a
      // source-mapped profile of a poms-grid load put this one line at 2,442ms
      // of SELF time — ~57 rebuilds of a 25,525-key object, 1.45 MILLION
      // property copies, 32% of the whole 7.7s op sweep.
      if (hit?.covers) return map;
      if (hit && hit.version === version && !hiddenInCache) return hit.merged;
      let covers = true;
      for (const k in base) { if (!(k in map)) { covers = false; break; } }
      if (covers) { cache.set(base, { covers: true }); return map; }
      const merged = Object.assign({}, base, map);
      for (const t of tombstones) delete merged[t];
      cache.set(base, { version, merged });
      return merged;
    },
  };
}
