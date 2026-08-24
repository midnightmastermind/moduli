// 0215 — the four nested tracker groups render as bare runs, not boxes.
//
// User, 2026-08-11 and again 2026-08-23: *"why arent the workout trackers boxes
// like the rest… planning, nutrition, and media arent boxes either."*
//
// They are the ONLY nested containers on the Trackers page — `Workout` and
// `Nutrition` inside Physical, `Media` inside Intellectual, `Planning` inside
// Occupational (the 2026-07-30 restructure). Every other tracker group is a
// direct child of the page and gets its card chrome from `PageBoard`.
//
// `ModuleContainer` drew a nested container as a card only when it was a DOC
// (`embedded={mod.kind === "doc"}`), and all four are BOARDS — so they had no
// background and no border, which is exactly "not boxes like the rest".
//
// ── WHY A FLAG AND NOT A RULE ──────────────────────────────────────────────
//
// The obvious fix is `embedded={true}` for any nested container. Measured
// first: **539 nested board containers on poms grid**, including every schedule
// time slot (`12:00am` ×9, `12:30am` ×9 …), `Todo`, `Tasks Completed` and the
// Emotions Wheel. That change would put a card and a border around the entire
// Schedule — a visual change nobody asked for, on 535 containers beyond the four
// in the ask.
//
// So the renderer reads `meta.cardChrome` and this sets it. Same shape as `0124`,
// where a timeslot opted OUT of the rainbow band without the stylesheet learning
// what a timeslot is — `noDomainKnowledge` fails the build if the generic
// renderer starts naming domain concepts.
//
// STRUCTURAL: "a container nested inside a container that is a direct child of
// the Trackers page". No list of four labels, so a fifth group nested next month
// is covered by a re-run rather than by editing this file.

export const id = "0215-tracker-groups-are-boxes";
export const description =
  "Nested tracker groups (Workout, Nutrition, Media, Planning) opt in to card chrome — they were the only ones rendering as bare runs";

export const PAGE_LABEL = "Trackers";

/** Nested containers one level under a page's direct children. PURE. */
export function nestedGroupsOf(page, occById, modById) {
  const out = [];
  for (const cid of page?.occurrences || []) {
    const top = occById.get(cid);
    if (!top || modById.get(top.moduleId)?.role !== "container") continue;
    for (const gid of top.occurrences || []) {
      const g = occById.get(gid);
      const gm = g && modById.get(g.moduleId);
      if (gm?.role === "container") out.push({ occ: g, mod: gm, parent: modById.get(top.moduleId)?.label });
    }
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const occs = await Occurrence.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  const page = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && m?.label === PAGE_LABEL;
  });
  if (!page) { log(`  no page labelled "${PAGE_LABEL}" — nothing to do`); return { flagged: 0 }; }

  const groups = nestedGroupsOf(page, occById, modById);
  const ops = [];
  for (const { mod, parent } of groups) {
    if (mod.meta?.cardChrome === true) continue;              // idempotent
    log(`    ${(mod.label || "?").padEnd(14)} (${mod.kind}) inside ${parent}`);
    // $set on the ONE key, never the whole `meta` — a container carries more
    // than this, and writing meta wholesale is how `0107` clobbered a sibling key.
    ops.push({ updateOne: { filter: { id: mod.id, gridId }, update: { $set: { "meta.cardChrome": true } } } });
  }
  log(`${dryRun ? "[dry run] " : ""}${ops.length} nested tracker group(s) opt in to card chrome (of ${groups.length} nested)`);
  if (!dryRun && ops.length) await Module.bulkWrite(ops, { ordered: false });
  return { flagged: ops.length };
}
