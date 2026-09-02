// helpers/measureCoalesce.js
//
// N EFFECTS MINT N TRANSACTIONS, AND EACH ONE RAN A WHOLE SWEEP.
//
// Measured on the user's tablet, 2026-09-02, on one copy-drop:
//     OccurrenceCreateOp:1x435ms/14fx      <- the real work
//     MeasureOp:1ve8fwc6c7k:12x523ms/0fx   <- 12 sweeps, ZERO effects
//     MeasureOp:kg860us2nhc:7x306ms/0fx    <- 7 more, ZERO effects
//
// The create's 14 effects are two tracker tiles recomputing. Applying them
// writes 14 fields, each write mints its own MeasureOp, and each MeasureOp
// deferred a continuation that ran a FULL sweep over ~68 operations.
// **19 sweeps for 2 occurrences, 829ms, every one emitting nothing.** The
// cycle guard is why they emit nothing; it cannot stop them RUNNING.
//
// So writes to one occurrence, made in one context, coalesce into ONE compound
// transaction — exactly what `onOccurrenceUpdated` already does on the echo
// path. `matchSubjectFilter` reads `transaction.fields[targetId]`, so a
// field-targeted trigger still matches every field that changed.
//
// Extracted because the KEY is where this goes wrong. `fireOperationsOptimistic`
// captures the fire depth, the ambient action and the applying-ops set and
// restores all three around the continuation — each added after a defect caused
// by NOT carrying it. Merging two writes made in DIFFERENT contexts would run
// the second under the first one's scope, which is that same class of defect
// arriving through the optimisation meant to be free.

/**
 * The key two deferred MeasureOps must share to be merged: the same occurrence
 * AND the same captured context. Returns null when the transaction cannot be
 * coalesced at all (no occurrence to key on) — the caller then defers it on its
 * own, which is the pre-existing behaviour.
 */
export function measureCoalesceKey(transaction, ctx = {}) {
  const occId = transaction?.occurrenceId;
  if (!occId) return null;
  const { depth = 0, actionId = null, applyingKey = "" } = ctx;
  return `${occId}|${depth}|${actionId || ""}|${applyingKey}`;
}

/**
 * Fold an incoming transaction's fields into the pending one. Shallow, later
 * wins — the same merge `onOccurrenceUpdated` performs, and the same one a
 * single write would have produced had the effects been applied as a batch.
 *
 * MUTATES `pending`, deliberately: the caller has already scheduled a
 * continuation holding that exact object, so returning a new one would fire the
 * pre-merge copy and silently drop every field after the first.
 */
export function mergeMeasureTransaction(pending, incoming) {
  if (!pending) return pending;
  pending.fields = { ...(pending.fields || {}), ...(incoming?.fields || {}) };
  return pending;
}
