// server/services/occurrenceMint.js
//
// THE ONE WAY THE SERVER MINTS A ROW.
//
// Extracted from the `/api/v1/ingest` route so the share engine's CREATE does
// not grow a second copy — "two implementations of one question" is this
// codebase's most-repeated defect class (see the spec's §9).
//
// BINDINGS ARE NOT OPTIONAL POLISH. Operations gate on `_boundFieldIds`, so a
// value written to an unbound field renders nowhere AND is invisible to the
// Schedule. `addNewOption.js` already records this defect once.
//
// Deviations from the task brief's first draft, forced by staying faithful to
// the LIVE `/ingest` route (see task-1-report.md for the full reasoning):
//   - `onExisting` ("skip" | "update" | "replace") — /ingest's own default is
//     "skip"; a bare mintOccurrence() call with no caller-supplied mode
//     defaults to "update", which is what a fresh caller (a re-share of the
//     same item) wants.
//   - `resolveModule` — an optional async callback the caller supplies when it
//     already owns a richer find-or-mint (label/fileRef keyed, batch-cached,
//     as /ingest's own `resolveModule` closure is). Invoked ONLY when no
//     existing occurrence is found, which preserves /ingest's original order:
//     a record whose (source, externalId) already exists and is being
//     skipped never touches the Module collection at all.
//   - `parentExists` — an optional async callback so a caller with its own
//     batch-scoped cache (/ingest checks up to 200 records against a Map
//     keyed by parentId) can hand in the already-known answer instead of this
//     module re-querying Mongo per record. Falls back to a direct
//     `Occurrence.exists` when no callback is supplied (the Step-1 tests'
//     contract).
//   - `linkToParent` — an optional async callback so a caller that already
//     owns an ATOMIC, cache-mirroring, broadcast-emitting linker (/ingest's
//     `linkIntoParent`: `$push` guarded by `occurrences: {$ne: childId}`) can
//     hand it in rather than have this module reimplement — and possibly
//     drift from — that guarantee. When no callback is supplied, this module
//     performs the SAME atomic `$push`/`$ne` guard itself (see
//     `pushChildIntoParent` below) rather than falling back to a
//     read-modify-write of the whole array, so the standalone contract never
//     reintroduces the "two concurrent ingests clobber each other's appends"
//     class the router's own comment on `linkIntoParent` names.
//   - `occurrenceId` / `index` — explicit overrides so /ingest's deterministic
//     (source, externalId) hash id and a record's `rec.index` insertion point
//     survive the extraction unchanged.
//   - `mirror(model, doc)` — an optional callback so the warm-cache mirror
//     (`peekUserCache`-based, defined inside the router closure) can be
//     supplied by the caller without this module depending on the router.
//   - every value read back from Mongo is normalised through `asPlain` before
//     it is spread, mirrored or broadcast — the SAME `?.toObject?.() : doc`
//     shape this file already used for `create()` results, now applied
//     uniformly to `findOne`/`findOneAndUpdate` reads too. A real Mongoose
//     Document's schema paths are not reliable own-enumerable properties, so
//     `{ ...doc }` on an un-lean-ed read can silently drop fields; neither
//     test double here can catch that (both are already plain-object stores),
//     so this is reasoned from Mongoose's own documented behaviour, not from
//     a passing test — see task-1-report.md for how this was checked.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { randomUUID } from "node:crypto";

const userRoom = (userId) => `user:${userId}`;

// A real Mongoose Document exposes `.toObject()`; both test doubles in this
// repo already hand back plain objects (or plain-object copies), so this is a
// no-op against them and a real safety net against production Mongo reads.
const asPlain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// The standalone fallback for `linkToParent`: atomic `$push` guarded by
// `occurrences: { $ne: childId }`, the exact shape `linkIntoParent` in
// apiV1.js uses (and the reason it exists — see that function's own comment).
// A caller with a richer/cached linker should inject one instead; this is
// what a caller with NEITHER a cache NOR a shared linker still gets for free.
async function pushChildIntoParent({ parentId, userId, childId, index, mirror, io }) {
  const pushUpdate = Number.isInteger(index)
    ? { $push: { occurrences: { $each: [childId], $position: index } } }
    : { $push: { occurrences: childId } };
  await Occurrence.updateOne(
    { id: parentId, userId, occurrences: { $ne: childId } },
    pushUpdate,
  );
  // The write above is already atomic and correct on its own; this read is
  // only to report the parent's new shape to the cache mirror and the socket
  // broadcast — it is not relied on for correctness of the write itself.
  const parent = asPlain(await Occurrence.findOne({ id: parentId, userId }));
  if (parent) {
    mirror?.("occurrence", parent);
    io?.to?.(userRoom(userId))?.emit?.("occurrence_updated", { occurrence: parent });
  }
  return !!parent;
}

//   - `parentFolderId` — a FOLDER parent (the share catch-all's Files
//     folder). A folder holds rows by `parentId` alone — the tree places an
//     occurrence whose parentId names it — and has no `occurrences[]`, so
//     there is nothing to push and nothing to check against Occurrence. The
//     CALLER validates the folder (the executor checks it is on this grid).
//     Mutually exclusive with `parentId`.
export async function mintOccurrence({
  userId, gridId, label, parentId = null, parentFolderId = null,
  moduleId: explicitModuleId = null,
  moduleRole = "instance", moduleKind = null, moduleFileRef = null,
  resolveModule = null,
  parentExists: parentExistsCheck = null,
  linkToParent = null,
  fields = {}, fieldBindings = [],
  occurrenceId: explicitOccurrenceId = null,
  index = null,
  externalId, source = "share", meta = {}, onExisting = "update",
  io = null, mirror = null,
}) {
  if (!externalId) throw new Error("externalId required — without it a re-share duplicates");
  if (parentId && parentFolderId) throw new Error("parentId and parentFolderId are mutually exclusive");
  if (parentId) {
    const exists = parentExistsCheck
      ? await parentExistsCheck(parentId)
      : !!(await Occurrence.exists({ id: parentId, userId }));
    if (!exists) throw new Error(`parent ${parentId} not found`);
  }

  // Identity is (source, externalId) — the ingest route's existing scheme.
  const existing = asPlain(await Occurrence.findOne({
    userId, gridId, "meta.source": source, "meta.externalId": externalId,
  }));

  if (existing) {
    if (onExisting === "skip") {
      return { occurrenceId: existing.id, moduleId: existing.moduleId, status: "skipped", linked: null };
    }
    // "update" merges the incoming fields over what is there; "replace"
    // takes the incoming set as authoritative. Neither touches parentId — a
    // row moved by hand since stays where it was put.
    const nextFields = onExisting === "replace"
      ? { ...fields }
      : { ...(existing.fields || {}), ...fields };
    const nextLabel = (label !== undefined && label !== null) ? label : existing.label;
    const nextMeta = {
      ...(existing.meta || {}), ...meta,
      source, externalId, ingestedAt: new Date().toISOString(),
    };
    const updated = asPlain(await Occurrence.findOneAndUpdate(
      { id: existing.id, userId },
      { $set: { label: nextLabel, fields: nextFields, meta: nextMeta } },
    )) || { ...existing, label: nextLabel, fields: nextFields, meta: nextMeta };
    mirror?.("occurrence", updated);
    io?.to?.(userRoom(userId))?.emit?.("occurrence_updated", { occurrence: updated });
    return { occurrenceId: existing.id, moduleId: existing.moduleId, status: "updated", linked: null };
  }

  let mod = explicitModuleId ? asPlain(await Module.findOne({ id: explicitModuleId, userId })) : null;
  if (!mod && resolveModule) mod = asPlain(await resolveModule());
  if (!mod) {
    const moduleIdToUse = explicitModuleId || randomUUID();
    const created = await Module.create({
      id: moduleIdToUse, userId, gridId, label,
      role: moduleRole, kind: moduleKind, fileRef: moduleFileRef,
      fieldBindings,
    });
    mod = asPlain(created);
    mirror?.("module", mod);
    io?.to?.(userRoom(userId))?.emit?.("module_created", { module: mod });
  }

  const occId = explicitOccurrenceId || randomUUID();
  const createdOcc = await Occurrence.create({
    id: occId, userId, gridId, moduleId: mod.id,
    ...(parentId ? { parentId } : parentFolderId ? { parentId: parentFolderId } : {}),
    label: label ?? null, fields, occurrences: [],
    meta: { ...meta, source, externalId, ingestedAt: new Date().toISOString() },
  });
  const occ = asPlain(createdOcc);
  mirror?.("occurrence", occ);
  io?.to?.(userRoom(userId))?.emit?.("occurrence_created", { occurrence: occ });

  let linked = false;
  if (parentId) {
    linked = linkToParent
      ? !!(await linkToParent({ childId: occId, index }))
      : await pushChildIntoParent({ parentId, userId, childId: occId, index, mirror, io });
  }

  return { occurrenceId: occId, moduleId: mod.id, status: "created", linked };
}
