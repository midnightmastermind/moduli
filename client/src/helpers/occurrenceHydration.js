// FETCH THE REST OF A ROW WHEN SOMETHING ACTUALLY LOOKS AT IT.
//
// The deferred catalogue ships PROJECTED (server/utils/deferredProjection.js):
// every row carries what the grid's own declarations reference, and nothing
// else. That is enough for the load sweep and for every dropdown — proven by
// `deferredProjectionEquivalence.test.js` over the live grid's own pipelines —
// and it is NOT enough to draw the row: a media tile needs its cover, its URL,
// its artist. Those arrive here, when a renderer asks.
//
// ── ONE REQUEST PER FRAME, NOT ONE PER ROW ─────────────────────────────────
//
// Opening a board mounts many rows in the same tick. Each asking for itself
// would be a socket frame per row; the ids are collected and sent together.
// `renderWindow` virtualises above 120 rows, so a board open asks for about a
// screenful rather than for all 15,708.
//
// ── IN-FLIGHT IDS ARE REMEMBERED, and that is what stops a request storm ───
//
// A row re-renders while its own hydration is in flight — the response has not
// arrived, so it still looks partial. Without `pending`, every re-render would
// queue it again and a slow reply would compound into a flood. Ids are released
// only when the reply lands or the socket drops, never on a timer: a timer is a
// guess about latency, and this codebase has been bitten by picked timeouts.
//
// ── IT FAILS TOWARD SHOWING SOMETHING ──────────────────────────────────────
//
// No socket, no handler, a reply that never comes: the row keeps rendering with
// the projected fields it already has. A blank board would be a worse failure
// than a late one, and this path must never be able to produce one.

const queued = new Set();
const pending = new Set();
let scheduled = false;
let sink = null;

/** Wired once by `bindSocketToStore`, which owns the socket and the dispatch. */
export function setHydrationSink(fn) { sink = fn; }

/** True when the server sent a projected row rather than a whole one. */
export function isPartial(occ) { return !!occ && occ._partial === true; }

/**
 * Ask for the rest of `id`. Cheap and idempotent — safe to call from a render
 * effect on every row.
 */
export function requestHydration(id) {
  if (!id || !sink) return;
  if (queued.has(id) || pending.has(id)) return;
  queued.add(id);
  if (scheduled) return;
  scheduled = true;
  // A macrotask, so every row mounting in this commit lands in one batch.
  setTimeout(flushHydration, 0);
}

export function flushHydration() {
  scheduled = false;
  if (!queued.size || !sink) return;
  const ids = [...queued];
  queued.clear();
  for (const id of ids) pending.add(id);
  try {
    sink(ids);
  } catch {
    // The send failed, so these were never really in flight — let a later
    // render ask again rather than stranding the rows as permanently partial.
    for (const id of ids) pending.delete(id);
  }
}

/** Called when rows come back (or the request is known to have failed). */
export function releaseHydration(ids) {
  if (!Array.isArray(ids)) return;
  for (const id of ids) pending.delete(id);
}

/** A reconnect re-sends `full_state`; nothing in flight survives it. */
export function resetHydration() {
  queued.clear();
  pending.clear();
  scheduled = false;
}

export function _hydrationState() {
  return { queued: queued.size, pending: pending.size, scheduled };
}
