/**
 * 0156 — a tile that is not about today says what it IS about.
 *
 * USER, 2026-08-20: *"the tiles that are labeled for diff days (or total days),
 * should label the tracker date correctly too"*, *"for Tracker Date it should say
 * total"*, *"so for like the account trackers."*
 *
 * `0148` made the cumulative financial tiles STOP being stamped with today's
 * date, which fixed the lie and left a blank where the date pill had been. A
 * blank is not an answer: the tile now says nothing about its own scope, and
 * "no date" and "all time" look identical.
 *
 * **`Tracker Date` CANNOT HOLD THE WORD, and that is why this adds a field
 * rather than writing to it.** It is a `date`-typed field; "Total" is not a
 * date, and writing one would either render as an invalid date or be coerced
 * away. So `Tracker Scope` is a TEXT display field that takes the same slot on
 * the tiles that are not about a single day.
 *
 * WHICH TILES IS ALREADY DECIDED, and deliberately not re-decided here: `0148`
 * marked each cumulative tile `meta.cumulative` by DERIVING it from the tracker's
 * own writing op (no date comparator, or `DATE_AFTER` present). This reuses that
 * mark rather than forming a second opinion about which trackers are cumulative
 * — the two must not be able to disagree.
 *
 * THE VALUE IS WRITTEN BY THE SAME OP THAT WRITES THE DATE. `Trackers:
 * Date-Prefix Labels` already loops every tile under the Trackers page and
 * stamps `$activeDate` on the ones that are about today; `0148` gave it a rule
 * to skip the cumulative ones. It now writes "Total" into `Tracker Scope` on
 * exactly those, in the branch it was already skipping — so there is one op
 * deciding one thing, and a tile can never carry both a date and a scope word.
 */
export const id = "0156-tracker-scope-label";
export const describe = "Cumulative tiles say \"Total\" where a daily tile shows its date.";

const TRACKERS_PAGE = "5zaCM_ScvI7n";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const TD = fields.find(f => f.name === "Tracker Date" && f.displayEnabled);
  if (!TD) { log("  REFUSING: no Tracker Date field"); return; }

  // The tiles 0148 already derived as cumulative — never re-derived here.
  const cumulative = occs.filter(o => o.meta?.cumulative === true);
  log(`  tiles marked cumulative by 0148: ${cumulative.length}`);
  if (!cumulative.length) { log("  REFUSING: none marked — 0148 has not run, and guessing which are cumulative is what it exists to avoid"); return; }
  cumulative.slice(0, 12).forEach(o => log(`    ${o.label || modById.get(o.moduleId)?.label}`));

  const op = ops.find(o => /Date-Prefix/i.test(o.name));
  if (!op) { log("  REFUSING: the Date-Prefix op is gone"); return; }

  const have = fields.find(f => f.name === "Tracker Scope" && f.displayEnabled);
  log(`  "Tracker Scope" field: ${have ? "present" : "to create"}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  let scopeId = have?.id;
  if (!scopeId) {
    scopeId = uid();
    await Field.create({ id: scopeId, gridId, userId: cumulative[0].userId, name: "Tracker Scope",
      type: "text", inputEnabled: false, displayEnabled: true, meta: {} });
    log(`  created "Tracker Scope"`);
  }

  // Swap the binding on each cumulative tile: Tracker Date out, Tracker Scope in
  // at the same position, so the pill lands where the date pill used to be.
  let swapped = 0;
  for (const o of cumulative) {
    const mod = modById.get(o.moduleId);
    if (!mod) continue;
    const binds = mod.fieldBindings || [];
    if (binds.some(b => b.fieldId === scopeId)) continue;
    const at = binds.findIndex(b => b.fieldId === TD.id);
    const next = binds.filter(b => b.fieldId !== TD.id)
      .map(b => ({ fieldId: b.fieldId, order: b.order, role: b.role, hidden: b.hidden }));
    next.splice(at >= 0 ? at : next.length, 0, { fieldId: scopeId, order: at >= 0 ? at : next.length, role: "display" });
    next.forEach((b, i) => { b.order = i; });
    await Module.updateOne({ id: mod.id, gridId }, { $set: { fieldBindings: next } });
    swapped++;
  }
  log(`  swapped Tracker Date -> Tracker Scope on ${swapped} tile(s)`);

  // THE OP WRITES THE WORD IN ITS OWN LOOP, not in the existing ELSE — and that
  // distinction was nearly a bug. The tile loop's condition is
  // `HAS_ANCESTOR <Trackers page> AND ... AND meta.cumulative IS_EMPTY`, so its
  // ELSE arm catches every instance that fails ANY rule — including the
  // thousands of occurrences that are simply not on the Trackers page at all.
  // Appending the write there would have stamped "Total" across the whole grid.
  // A second loop states the positive condition instead.
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const path = `$goal2.fields.${scopeId}.value`;
  if (JSON.stringify(pipeline).includes(path)) log("  op already wired");
  else {
    pipeline.steps.push({ id: uid(), type: "loop", overExpr: "$allInstances", as: "$goal2", body: [
      { id: uid(), type: "if", condition: { operator: "AND", rules: [
        { id: uid(), left: "$goal2._ancestors", comparator: "HAS_ANCESTOR", right: TRACKERS_PAGE },
        { id: uid(), left: "$goal2.meta.cumulative", comparator: "IS_NOT_EMPTY", right: "" },
      ] }, then: [
        { id: uid(), type: "action", config: { type: "UPDATE", path, value: "literal:Total" } },
      ], else: [] },
    ] });
    await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
    log(`  the Date-Prefix op gains a scoped loop writing "Total" on cumulative tiles`);
  }
  log("  RESTART pm2 and reload.");
}
