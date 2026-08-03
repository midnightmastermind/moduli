// utils/pendingOccCreates.js — closes the create-then-apply race between
// socket handlers that live in DIFFERENT files (crud.js's create_page,
// templates.js's apply_template) but share the same per-(userId,gridId) warm
// cache object (`uc`, from server.js's ensureUserCache — every handler file
// resolves the SAME object instance for a given user+grid).
//
// The race: a client mints a page then immediately applies a template onto
// it (ManifestTree / ModulePanel's create-from-template flow). create_page
// awaits a real Mongo round-trip before the new occurrence lands in
// `uc.occurrencesById`; apply_template resolves its target purely from that
// cache with no wait. If apply_template's frame is processed while
// create_page is still awaiting Mongo, the target is undefined and the
// template silently fails to apply.
//
// Fix: `registerPendingOccCreate` must be called SYNCHRONOUSLY, as the very
// first thing a create handler does after obtaining `uc` (before any other
// awaited work) — before returning that resolver to the caller. A second
// handler that depends on the same occurrence id (`awaitPendingOccCreate`)
// must likewise resolve `uc` via its own `await getUc()` as its first step.
// JS's microtask queue preserves FIFO order across `.then` continuations
// registered on the same (or equivalent) promise chain, so no matter how the
// underlying transport interleaves the two socket frames, the registering
// handler's synchronous continuation (which runs the registration) is
// guaranteed to execute before the dependent handler's continuation (which
// checks for the pending entry) — see the two handlers' own comments for the
// full ordering argument. This is a correctness guarantee, not a timing
// hack: no polling, no retry, no fixed delay.

/**
 * Mark `occurrenceId` as being created on `uc`. Call this synchronously,
 * immediately after resolving `uc`, before any further `await`. Returns a
 * resolver — call it (in a `finally`) once the create has persisted (or
 * failed) so waiters unblock and the entry doesn't leak.
 */
export function registerPendingOccCreate(uc, occurrenceId) {
  if (!uc || !occurrenceId) return () => {};
  uc._pendingOccCreates = uc._pendingOccCreates || new Map();
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  uc._pendingOccCreates.set(occurrenceId, promise);
  return () => {
    uc._pendingOccCreates.delete(occurrenceId);
    resolve();
  };
}

/**
 * Await any in-flight create for `occurrenceId` on `uc`. No-ops immediately
 * when nothing is pending (the common case — most reads target an occurrence
 * that was created in some earlier request and is already in the cache).
 */
export async function awaitPendingOccCreate(uc, occurrenceId) {
  const pending = uc?._pendingOccCreates?.get(occurrenceId);
  if (pending) await pending;
}
