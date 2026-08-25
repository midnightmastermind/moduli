/**
 * 0240 — the Daily Question Rotator threw because a SECOND Journal appeared.
 *
 * Found by regenerating the ops fixture after `0238` and running the suite the
 * user asked for (*"make sure the ops still work for it"*). It failed with:
 *
 *     Daily Question Rotator: $journalingInst is not a record (no .id)
 *                             — UPDATE needs a FOUND occurrence
 *
 * ── IT IS NOT THE IMPORT, AND THAT WAS THE FIRST THING TO ESTABLISH ───────
 *
 * The op's FIND is `over: $allInstances`, which is ROLE-FILTERED — and every
 * row `0238` added is `role: "artifact"` precisely so it stays out of that
 * slice. So the import cannot contribute a match. Counted on both fixtures:
 *
 *     occurrences with moduleId tDhKsWljZfS2 ("Journal")
 *       fixture of 2026-08-24   1   -> FIND binds a record, UPDATE works
 *       fixture of today        2   -> FIND binds an ARRAY,  UPDATE throws
 *
 * The second one is `9:00pm < Routine < Schedule Template` — the **Routine
 * template layer**, a placement of the same Journal module. Ordinary use, not
 * a migration and not the import.
 *
 * ── SO THE OP WAS ALWAYS WRONG, AND HAPPENED TO HAVE ONE MATCH ───────────
 *
 * `FIND templateId IS <module>` over every instance on the grid, with NO scope,
 * asks "the occurrence of this module" of a module that is a RECURRING ROUTINE —
 * something whose whole job is to be placed many times. It was one bad day away
 * from this from the moment it was written. This is the 2026-08-11 (4) class:
 * a multi-match FIND binds an array and `UPDATE` refuses it rather than silently
 * writing to the first, which is the executor being right.
 *
 * ── THE FIX RESTORES, IT DOES NOT CHOOSE ─────────────────────────────────
 *
 * Which Journal *should* carry the question is a product question, and guessing
 * it is how a fix becomes a behaviour change nobody asked for. So this pins the
 * FIND to the occurrence it ALREADY resolved to for as long as it worked — the
 * catalog row under `Routines > Emotional > Reflection` — picker-direct via
 * `$allItemsById.<id>`, which is this repo's documented preferred form (2026-05-20:
 * "zero label-collision risk") and is what `$schedPage` two steps above already
 * uses. Behaviour on 2026-08-24 and behaviour after this are identical by
 * construction.
 *
 * **REPORTED, NOT DECIDED:** if the Routine layer's 9:00pm Journal is the row
 * that should now carry the daily question, that is a one-id change here — but
 * it is the user's call, not a migration's.
 *
 * It resolves the id BY STRUCTURE rather than baking it in: the Journal
 * placement that is NOT under a template. If that is ever ambiguous it REFUSES
 * rather than picking one, because picking wrong is silent.
 */
const uid = () => Math.random().toString(36).slice(2, 14);

export const id = "0240-rotator-finds-one-journal";
export const describe =
  "Pins Daily Question Rotator's Journal FIND to the catalog row, so a second placement of the Journal routine cannot make it bind an array and throw.";
export const touches = ["occurrences", "modules", "operations"];

export const OP_NAME = "Daily Question Rotator";

/** The step whose FIND we pin. PURE, so the selector is testable. */
export function findJournalStep(pipeline) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    const c = n.cfg || n.config;
    if (c && (n.action === "FIND" || c.type === "FIND") && c.itemVar === "$journalingInst") out.push(n);
    for (const v of Object.values(n)) Array.isArray(v) ? v.forEach(walk) : walk(v);
  };
  walk(pipeline);
  return out;
}

/** Rewrite a FIND over a collection into a picker-direct id match. */
export function pinToId(step, occId) {
  const c = step.cfg || step.config;
  c.over = "$allItemsById";
  c.predicate = { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right: occId }] };
  return step;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const gid = String(gridId);

  const op = await Operation.findOne({ gridId: gid, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" on this grid — nothing to do`); return; }

  const steps = findJournalStep(op.pipeline);
  if (steps.length !== 1) { log(`expected exactly 1 $journalingInst FIND, found ${steps.length} — refusing`); return; }
  const cfg = steps[0].cfg || steps[0].config;
  const moduleId = cfg?.predicate?.rules?.find((r) => r.left === "templateId")?.right;
  if (!moduleId) { log("the FIND no longer matches on templateId — already changed, refusing to guess"); return; }

  const occs = await Occurrence.find({ gridId: gid, moduleId },
    { id: 1, moduleId: 1, label: 1, parentId: 1, occurrences: 1 }).lean();
  const mod = await Module.findOne({ gridId: gid, id: moduleId }, { id: 1, label: 1 }).lean();
  log(`"${mod?.label}" (${moduleId}) has ${occs.length} occurrence(s):`);

  // Walk each one's ancestor chain and name it, so the choice is visible in the log.
  const all = await Occurrence.find({ gridId: gid }, { id: 1, moduleId: 1, label: 1, parentId: 1, occurrences: 1 }).lean();
  const mods = await Module.find({ gridId: gid }, { id: 1, label: 1 }).lean();
  const mById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(all.map((o) => [o.id, o]));
  const parent = new Map();
  for (const o of all) for (const c of o.occurrences || []) if (!parent.has(c)) parent.set(c, o.id);
  for (const o of all) if (o.parentId && !parent.has(o.id)) parent.set(o.id, o.parentId);
  const lbl = (o) => o?.label ?? mById.get(o?.moduleId)?.label ?? "?";
  const chain = (id2) => { const out = []; let c = parent.get(id2), n = 0;
    while (c && n++ < 8) { out.push(lbl(byId.get(c))); c = parent.get(c); } return out; };

  const scored = occs.map((o) => ({ o, chain: chain(o.id) }));
  for (const s of scored) log(`   ${s.o.id}  ${s.chain.join(" < ") || "(no parent)"}`);

  // The catalog row is the one NOT under a template. Structural, so a rename
  // cannot break it and a THIRD placement cannot silently change the answer.
  const isTemplate = (c) => c.some((x) => /template/i.test(x));
  const catalog = scored.filter((s) => !isTemplate(s.chain));
  if (catalog.length !== 1) {
    log(`REFUSING: ${catalog.length} non-template placements — which one carries the question is the user's call, not a guess`);
    return;
  }
  const target = catalog[0];
  log(`pinning the FIND to ${target.o.id} (${target.chain.join(" < ")})`);
  if (dryRun) return { pinnedTo: target.o.id, placements: occs.length };

  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const [step] = findJournalStep(pipeline);
  pinToId(step, target.o.id);
  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  log(`  done — the FIND is picker-direct now and cannot bind an array`);
  log("  RESTART pm2 and reload.");
  return { pinnedTo: target.o.id, placements: occs.length };
}
