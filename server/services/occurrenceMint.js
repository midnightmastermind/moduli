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
// the LIVE `/ingest` route (see task-1-report.md §Deviations for the reasoning
// behind each one):
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
//   - `occurrenceId` / `index` — explicit overrides so /ingest's deterministic
//     (source, externalId) hash id and a record's `rec.index` insertion point
//     survive the extraction unchanged.
//   - `mirror(model, doc)` — an optional callback so the warm-cache mirror
//     (`peekUserCache`-based, defined inside the router closure) can be
//     supplied by the caller without this module depending on the router.
//   - the parent link is a read-then-`$set` (not an atomic `$push`/`$ne`),
//     matching this task's own given test double (its `Occurrence` mock has
//     no `$push` support). This trades away the original route's
//     concurrent-double-POST safety on the parent's `occurrences[]` array —
//     flagged in the report as a known, accepted risk for this task, not
//     silently dropped.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { randomUUID } from "node:crypto";

const userRoom = (userId) => `user:${userId}`;

export async function mintOccurrence({
  userId, gridId, label, parentId = null,
  moduleId: explicitModuleId = null,
  moduleRole = "instance", moduleKind = null, moduleFileRef = null,
  resolveModule = null,
  fields = {}, fieldBindings = [],
  occurrenceId: explicitOccurrenceId = null,
  index = null,
  externalId, source = "share", meta = {}, onExisting = "update",
  io = null, mirror = null,
}) {
  if (!externalId) throw new Error("externalId required — without it a re-share duplicates");
  if (parentId && !(await Occurrence.exists({ id: parentId, userId }))) {
    throw new Error(`parent ${parentId} not found`);
  }

  // Identity is (source, externalId) — the ingest route's existing scheme.
  const existing = await Occurrence.findOne({
    userId, gridId, "meta.source": source, "meta.externalId": externalId,
  });

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
    const updated = await Occurrence.findOneAndUpdate(
      { id: existing.id },
      { $set: { label: nextLabel, fields: nextFields, meta: nextMeta } },
    ) || { ...existing, label: nextLabel, fields: nextFields, meta: nextMeta };
    mirror?.("occurrence", updated);
    io?.to?.(userRoom(userId))?.emit?.("occurrence_updated", { occurrence: updated });
    return { occurrenceId: existing.id, moduleId: existing.moduleId, status: "updated", linked: null };
  }

  let mod = explicitModuleId ? await Module.findOne({ id: explicitModuleId, userId }) : null;
  if (!mod && resolveModule) mod = await resolveModule();
  if (!mod) {
    const moduleIdToUse = explicitModuleId || randomUUID();
    const created = await Module.create({
      id: moduleIdToUse, userId, gridId, label,
      role: moduleRole, kind: moduleKind, fileRef: moduleFileRef,
      fieldBindings,
    });
    mod = created?.toObject ? created.toObject() : created;
    mirror?.("module", mod);
    io?.to?.(userRoom(userId))?.emit?.("module_created", { module: mod });
  }

  const occId = explicitOccurrenceId || randomUUID();
  const createdOcc = await Occurrence.create({
    id: occId, userId, gridId, moduleId: mod.id,
    ...(parentId ? { parentId } : {}),
    label: label ?? null, fields, occurrences: [],
    meta: { ...meta, source, externalId, ingestedAt: new Date().toISOString() },
  });
  const occ = createdOcc?.toObject ? createdOcc.toObject() : createdOcc;
  mirror?.("occurrence", occ);
  io?.to?.(userRoom(userId))?.emit?.("occurrence_created", { occurrence: occ });

  let linked = false;
  if (parentId) {
    const parent = await Occurrence.findOne({ id: parentId, userId });
    if (parent) {
      const list = parent.occurrences || [];
      if (!list.includes(occId)) {
        const nextList = Number.isInteger(index)
          ? [...list.slice(0, index), occId, ...list.slice(index)]
          : [...list, occId];
        const nextParent = await Occurrence.findOneAndUpdate(
          { id: parentId },
          { $set: { occurrences: nextList } },
        ) || { ...parent, occurrences: nextList };
        mirror?.("occurrence", nextParent);
        io?.to?.(userRoom(userId))?.emit?.("occurrence_updated", { occurrence: nextParent });
      }
      linked = true;
    }
  }

  return { occurrenceId: occId, moduleId: mod.id, status: "created", linked };
}
