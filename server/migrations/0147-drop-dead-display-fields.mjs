/**
 * 0147 — five display fields nothing has ever written, and one that nothing shows.
 *
 * USER, 2026-08-19: *"look at all my display fields and make sure they are being used by an
 * operation or updated in some way"* — then, shown the result, **drop them**.
 *
 * MEASURED ACROSS ALL 54 DISPLAY FIELDS, cross-referenced against every ENABLED operation's
 * pipeline and every module's `fieldBindings`:
 *
 *     Now · Time Left · Overdue Tasks · Due This Week · Task Count
 *        written by NO enabled operation · 0 rows carrying a value anywhere
 *        four of the five BOUND to a tile, so they render as empty pills
 *
 *     Days Until Due
 *        written by its own op, bound by NOTHING — computed and invisible
 *
 * **"A binding that promises a value nothing will write is worse than no binding"** (CLAUDE.md
 * 2026-08-11 (3)). This is that, five times, on the page the user looks at most.
 *
 * THE DELETE IS GUARDED THREE WAYS, and any one of them cancels the field:
 *   1. no ENABLED operation mentions its id anywhere in a pipeline;
 *   2. no occurrence on the grid carries a value for it;
 *   3. it is display-only — an INPUT field is somewhere for the user to type, and an empty one is
 *      not evidence of anything.
 * A field failing any check is REPORTED and kept. The 2026-08-01 (18) rule: empty AND unreachable,
 * never just one.
 *
 * A TILE LEFT WITH NOTHING TO SHOW GOES WITH IT. Dropping `Now` from a tile whose only binding was
 * `Now` leaves a titled box that renders nothing — the same empty promise one level up. A tile that
 * still has other bindings keeps them and simply loses this one.
 */
export const id = "0147-drop-dead-display-fields";
export const describe = "Remove five display fields no operation writes, and bind Days Until Due, which nothing shows.";

export const DEAD = ["Now", "Time Left", "Overdue Tasks", "Due This Week", "Task Count"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const enabled = ops.filter(o => o.enabled !== false);
  const raws = enabled.map(o => ({ name: o.name, raw: JSON.stringify(o.pipeline) }));
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));

  // CONTROL: the "does an op mention this field" probe must find SOMETHING on
  // this grid, or every field below reads as dead for the wrong reason.
  const anyMentioned = fields.filter(f => raws.some(r => r.raw.includes(f.id))).length;
  if (!anyMentioned) { log("  REFUSING: no field is mentioned by any pipeline — the probe is broken"); return; }
  log(`  probe control: ${anyMentioned} of ${fields.length} fields are referenced by some operation`);

  const drop = [], keep = [];
  for (const name of DEAD) {
    const f = fields.find(x => x.name === name);
    if (!f) { log(`  "${name}" is not on this grid — nothing to drop`); continue; }
    const writers = raws.filter(r => r.raw.includes(f.id)).map(r => r.name);
    const valued  = occs.filter(o => o.fields?.[f.id]?.value != null).length;
    if (writers.length) { keep.push(`"${name}" — written by ${writers.join(", ")}`); continue; }
    if (valued)         { keep.push(`"${name}" — ${valued} occurrence(s) carry a value`); continue; }
    if (!f.displayEnabled) { keep.push(`"${name}" — not display-only; it is somewhere to type`); continue; }
    const boundBy = mods.filter(m => (m.fieldBindings || []).some(b => b.fieldId === f.id));
    // A TILE IS EMPTY WHEN IT HAS NOTHING LEFT TO SHOW, which is not the same as
    // having no bindings left. `Tracker Date` is on every tracker tile and a
    // hidden `Category` is plumbing — a tile left with only those renders a
    // title and a date and no reading, which is the same empty promise one level
    // up. Counting bindings would have missed every one of these.
    const meaningful = (m) => (m.fieldBindings || []).filter(b =>
      b.fieldId !== f.id && !b.hidden && b.role === "display"
      && !["Tracker Date", "Category"].includes(fields.find(x => x.id === b.fieldId)?.name)).length;
    const orphanTiles = boundBy.filter(m => meaningful(m) === 0);
    drop.push({ f, boundBy, orphanTiles });
  }
  keep.forEach(k => log(`  KEEPING ${k}`));
  for (const d of drop) {
    log(`  drop "${d.f.name}" — bound by ${d.boundBy.length} module(s)` +
        (d.orphanTiles.length ? `, ${d.orphanTiles.length} of which would be left empty` : ""));
    d.orphanTiles.forEach(t => log(`        tile "${t.label}" has no other binding — removing it too`));
  }

  // ---- the one that computes and is shown nowhere -------------------------
  const dud = fields.find(f => f.name === "Days Until Due" && f.displayEnabled);
  let bindTargets = [];
  if (dud) {
    const bound = mods.some(m => (m.fieldBindings || []).some(b => b.fieldId === dud.id));
    if (bound) log(`  "Days Until Due" is already bound — nothing to do`);
    else {
      // WHERE IT BELONGS IS STRUCTURAL: it is a countdown to a task's OWN due
      // date, so it goes on whatever binds the `Due` DATE field — not on a
      // tracker tile. The first attempt matched a module whose label ended
      // "Stats" and chose **Fitness Stats**, which would have put a task
      // countdown on the workout tracker. A label match is not a reason.
      const due = fields.find(f => f.name === "Due" && f.type === "date" && !f.displayEnabled);
      if (!due) { log(`  REPORTING: no input "Due" date field — not guessing where the countdown goes`); }
      else {
        bindTargets = mods.filter(m => (m.fieldBindings || []).some(b => b.fieldId === due.id));
        log(bindTargets.length
          ? `  "Days Until Due" -> the ${bindTargets.length} module(s) that bind the Due date: ${bindTargets.map(m => m.label).join(", ")}`
          : `  REPORTING: nothing binds the Due date, so there is nowhere the countdown belongs`);
      }
    }
  }

  if (!drop.length && !bindTargets.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const d of drop) {
    for (const m of d.boundBy) {
      await Module.updateOne({ id: m.id, gridId },
        { $pull: { fieldBindings: { fieldId: d.f.id } } });
    }
    for (const t of d.orphanTiles) {
      const tocc = occs.filter(o => o.moduleId === t.id);
      for (const o of tocc) {
        if (o.parentId) await Occurrence.updateOne({ id: o.parentId, gridId }, { $pull: { occurrences: o.id } });
        await Occurrence.deleteOne({ id: o.id, gridId });
      }
      await Module.deleteOne({ id: t.id, gridId });
      log(`  removed tile "${t.label}" (${tocc.length} occurrence(s))`);
    }
    await Field.deleteOne({ id: d.f.id, gridId });
    log(`  removed field "${d.f.name}"`);
  }
  for (const t of bindTargets) {
    const order = (t.fieldBindings || []).length;
    await Module.updateOne({ id: t.id, gridId },
      { $push: { fieldBindings: { fieldId: dud.id, order, role: "display" } } });
    log(`  bound "Days Until Due" to "${t.label}"`);
  }
  log("  done — RESTART pm2 and reload the tab.");
}
