// server/migrations/0107-hot-tub-routine.mjs
//
// User, 2026-08-13: "put a hot tub routine in under physical as well."
//
// It lands in **Physical → Care**, beside Hygiene and Groom. Care is where the
// body-maintenance actions live; Fitness is training and Rest is sleep. The
// container is resolved STRUCTURALLY — the parent of the existing "Hygiene"
// action — rather than by the label "Care", because that is the container the
// user pointed at when they said "the same timeslot as hygiene", and a label
// can be renamed.
//
// THE SHAPE IS COPIED FROM HYGIENE, NOT INVENTED. Same `fieldBindings`
// (Completed · Date · Category · Habit), same Category value, same
// `ownStyle`/`styleMode`. Two of those matter beyond looks:
//   - the **Habit** binding is the discriminator "Completed Habits" counts on
//     (2026-07-30 (3)); a routine minted without it silently lands in the TASKS
//     count instead.
//   - `styleMode: "own"` + the dimension colour is what `0100`/`0102` had to
//     repair once already — inheriting instead would render it uncoloured.
// Copying the exemplar rather than listing field ids means a schema change to
// routines carries here for free.
import { randomUUID } from "node:crypto";

export const id = "0107-hot-tub-routine";
export const describe = "A Hot Tub routine under Physical → Care, shaped like Hygiene.";

export const ROUTINE_LABEL = "Hot Tub";
export const EXEMPLAR = "Hygiene";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  const routines = occs.find((o) => nameOf(o) === "Routines");
  if (!routines) { log(`REFUSING: no "Routines" page.`); return; }
  const dims = (routines.occurrences || []).map((i) => byId.get(i)).filter(Boolean);
  const physical = dims.find((d) => /^physical$/i.test(nameOf(d)));
  if (!physical) { log(`REFUSING: no "Physical" dimension.`); return; }

  // The exemplar, and through it the destination container.
  let exemplar = null, dest = null;
  for (const cid of physical.occurrences || []) {
    const c = byId.get(cid);
    for (const k of (c?.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      if (nameOf(k) === EXEMPLAR) { exemplar = k; dest = c; }
    }
  }
  if (!exemplar || !dest) { log(`REFUSING: no "${EXEMPLAR}" action under Physical.`); return; }

  // Scoped to Physical's own children — "Hot Tub" could legitimately label
  // something else on the grid, and a global match would decide it exists.
  const existing = (dest.occurrences || [])
    .map((i) => byId.get(i)).filter(Boolean)
    .find((k) => nameOf(k) === ROUTINE_LABEL);
  if (existing) { log(`"${ROUTINE_LABEL}" already in ${nameOf(dest)} — no change.`); return; }

  const srcMod = modById.get(exemplar.moduleId);
  log(`destination  Physical > ${nameOf(dest)}  (holds ${(dest.occurrences || []).length})`);
  log(`exemplar     "${EXEMPLAR}"  ${(srcMod?.fieldBindings || []).length} binding(s), style ${JSON.stringify(srcMod?.ownStyle)}`);
  if (dryRun) { log(`WOULD mint "${ROUTINE_LABEL}" with the exemplar's shape.`); return; }

  const nMod = randomUUID(), nOcc = randomUUID();
  await Module.create({
    id: nMod, gridId, userId: exemplar.userId, label: ROUTINE_LABEL,
    role: srcMod?.role || "instance",
    fieldBindings: srcMod?.fieldBindings || [],
    meta: { ...(srcMod?.meta || {}) },
    ownStyle: srcMod?.ownStyle || null,
    styleMode: srcMod?.styleMode || "inherit",
  });
  await Occurrence.create({
    id: nOcc, gridId, userId: exemplar.userId, moduleId: nMod, targetId: nMod,
    parentId: dest.id, occurrences: [],
    // The dimension tag, carried from the exemplar — it is what scopes the
    // action to Physical everywhere the tag is read.
    fields: { ...(exemplar.fields || {}) },
  });
  await Occurrence.updateOne({ gridId, id: dest.id }, { $push: { occurrences: nOcc } });
  log(`minted "${ROUTINE_LABEL}" occ=${nOcc} under ${nameOf(dest)}.`);
}
