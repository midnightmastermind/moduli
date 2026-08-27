// server/utils/undoSync.js
//
// WHAT AN UNDO HAS TO TELL THE CLIENT — and what it must stop telling it.
//
// ── THE COST THIS EXISTS TO REMOVE ─────────────────────────────────────────
//
// Undoing ONE checkbox took ~26 seconds to settle on poms grid. Traced over the
// websocket, from the Ctrl+Z:
//
//        0ms  -> undo_transaction
//    5,500ms     (silence)
//    7,500ms  -> update_occurrence x30, close_action x30
//    9,000ms  <- occurrence_persisted x28, transaction_created x23
//   24,000ms     still dribbling writes
//   settle: 19,399 DOM mutations · 351 KB of traffic
//
// Three costs, all of them the same mistake — answering a question about N
// documents by re-reading everything:
//
//   1. the handler called `loadUserIntoCache`, re-reading all 21,039
//      occurrences. Prod's own log times that query at 1.5-2.9s. EVERY undo.
//   2. it then broadcast `sync_state`, whose client handler is two lines:
//      `requestForceSync()` + `socket.emit("request_full_state")` — the entire
//      grid, re-serialized and re-hydrated (~3.9s measured).
//   3. re-hydrating re-runs the onLoad OP SWEEP, which writes ~30 occurrences,
//      each of which records a transaction and echoes back, provoking more
//      sweeps. That is the 24-second tail.
//
// ── AND (3) IS NOT MERELY SLOW, IT IS WRONG ────────────────────────────────
//
// A write and its whole operation cascade are ONE action (2026-08-25 (8):
// `withAction` "still groups it with its whole cascade into ONE undo step"), so
// the snapshots an undo restores ALREADY include everything the operations
// derived. Firing them again recomputes what was just restored — and its writes
// mint NEW transactions, which is why the trace shows `transaction_created x23`
// arriving after an undo the user did not make. The restored documents must
// therefore be applied WITHOUT firing operations.
//
// ── IT FAILS CLOSED, WHICH IS THE WHOLE SAFETY ─────────────────────────────
//
// An incremental apply is only safe when every restored document is one the
// client can place by id. Anything else — an unknown model, a `grid` restore
// (grid state fans out into filters, layout and the panel tree), a snapshot with
// no id — returns `incremental: false`, and the caller does exactly what it did
// before. A wrong incremental apply leaves the user looking at stale state and
// believing their undo failed; a needless full reload is merely slow.

/** Cache map on the warm per-user cache, by snapshot model. */
export const CACHE_KEY_BY_MODEL = Object.freeze({
  module: "modulesById",
  occurrence: "occurrencesById",
  field: "fieldsById",
  manifest: "manifestsById",
  view: "viewsById",
  folder: "foldersById",
  operation: "operationsById",
});

/**
 * @param applied  what `applySnapshots` wrote: [{ type, model, id, doc }]
 * @returns { incremental: true, docs } | { incremental: false, reason }
 */
export function planUndoSync(applied) {
  if (!Array.isArray(applied) || applied.length === 0) {
    return { incremental: false, reason: "nothing was restored" };
  }
  const docs = [];
  for (const a of applied) {
    if (!a || !a.id) return { incremental: false, reason: "a snapshot carried no id" };
    // A grid restore changes filters, layout and the panel tree at once — far
    // more than a keyed patch can express. Take the slow path.
    if (a.model === "grid") return { incremental: false, reason: "grid restored" };
    if (!CACHE_KEY_BY_MODEL[a.model]) {
      return { incremental: false, reason: `unknown model "${a.model}"` };
    }
    if (a.type === "deleted") {
      docs.push({ model: a.model, id: a.id, doc: null });
    } else {
      // A restore with no document is not a restore we can apply.
      if (!a.doc) return { incremental: false, reason: "restored snapshot had no document" };
      docs.push({ model: a.model, id: a.id, doc: a.doc });
    }
  }
  return { incremental: true, docs };
}
