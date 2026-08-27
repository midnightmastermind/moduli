// server/utils/mongoId.js
//
// `_id` IS MONGO'S, NOT THE APP'S — AND IT MUST NEVER RIDE IN AN UPDATE.
//
// Every entity here is identified by an app-level `id` (unique-indexed);
// Mongo's `_id` is an implementation detail that nothing reads. Grep says so on
// both sides: no server code reads `_id` off a cached entity, and the client
// provably never reads it either (CLAUDE.md 2026-08-24, measured at 0 sites).
//
// It matters because `loadUserIntoCache` stores `{ ...leanDoc, id }` — a lean
// document carries `_id` — and the write handlers build their update payload as
// `{ ...cachedDoc, ...clientPayload }`. Mongoose casts that plain object to
// `$set`, so every write was `$set`ting `_id`.
//
// That is INERT while the cached `_id` matches the live document, and the moment
// they diverge Mongo rejects the ENTIRE write:
//
//   update_occurrence error: MongoServerError: Plan executor error during
//   findAndModify :: caused by :: Performing an update on the path '_id' would
//   modify the immutable field '_id'        (code 66, ImmutableField)
//
// The user's edit is LOST — the handler throws, so the parent `$push` and
// everything after it never runs. Seen on prod 2026-08-26.
//
// `txRecorder.js` already knows this hazard and defends against it in its own
// snapshot path ("`_id`/`__v` stripped: `$set: { _id }` on restore is rejected
// by Mongo"). The undo path learned it; the write path never did.
//
// DELIBERATELY NOT APPLIED TO `Grid`: a grid's identity IS its `_id`, and
// `update_grid` passes `{ _id: gridId, ... }` on purpose so an upsert creates
// the document with that id. Stripping there would break grid creation.

/** A shallow copy of `doc` with Mongo's `_id` removed. Null-safe. */
export function withoutMongoId(doc) {
  if (!doc || typeof doc !== "object") return doc;
  if (!("_id" in doc)) return doc;          // don't allocate when there's nothing to strip
  const { _id, ...rest } = doc;
  return rest;
}
