// One of Net Worth's three terms was left pointing at an empty row.
//
// `0311` repointed Net Worth by collecting the account MODULE ids from
// occurrences carrying `meta.cumulative` — and `0310` had already stripped that
// flag off the row it was rebuilding. So the Checking term kept naming the old
// module, which by then held no balance at all, and Net Worth quietly dropped
// 4.16: 144.30 -> 140.14. Caught by `moneySemantics`, not by the migration's
// own log, which reported "repointed: yes" because the OTHER two moved.
//
// THE LESSON IS THE SELECTOR, NOT THE VALUE. `0311` keyed on a marker that its
// own predecessor had removed — a set built from state that the migration
// before it had already changed. This one keys on the thing that cannot drift:
// each term ADDS a balance FIELD, so its guard must name the row that HOLDS
// that field. The question "which row holds Checking Balance" has one answer
// and it is answerable from the data.
//
// Idempotent: converges once every term names the row holding its own field.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0312-net-worth-reads-the-row-that-holds-the-balance";
export const description = "Every Net Worth term names the row that holds the balance it adds.";
export const touches = ["fields", "modules", "occurrences", "operations"];

/** Walk every node of a pipeline. */
const walk = (n, fn) => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach((x) => walk(x, fn)); return; }
  fn(n);
  Object.values(n).forEach((v) => walk(v, fn));
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const fieldName = Object.fromEntries(fields.map((f) => [f.id, f.name]));
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));

  const op = await Operation.findOne({ gridId: gid, name: "Net Worth" }).lean();
  if (!op) throw new Error('operation "Net Worth" not found - refusing');
  const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));

  /** The single row whose module BINDS this field visibly. */
  const rowHolding = (fid) => {
    const holders = mods.filter((m) =>
      (m.fieldBindings || []).some((b) => b.fieldId === fid && !b.hidden));
    if (holders.length !== 1) {
      throw new Error(`"${fieldName[fid]}" is displayed by ${holders.length} module(s) - refusing`);
    }
    return holders[0];
  };

  // An IF whose body adds `$item.fields.<fid>.value` must gate on the row that
  // holds <fid>. Both halves are read off the pipeline itself.
  const patches = [];
  walk(pipeline, (n) => {
    if (n.type !== "if" || !Array.isArray(n.then)) return;
    let addedField = null;
    walk(n.then, (b) => {
      const c = b.config || {};
      if (c.type !== "ADD_TO_VAR" && c.type !== "SUBTRACT_FROM_VAR") return;
      const m = /^\$item\.fields\.([A-Za-z0-9_-]+)\.value$/.exec(String(c.expr || ""));
      if (m) addedField = m[1];
    });
    if (!addedField) return;

    const want = rowHolding(addedField);
    for (const r of n.condition?.rules || []) {
      if (r.left === "$item.templateId" && r.comparator === "IS" && r.right !== want.id) {
        patches.push({
          field: fieldName[addedField],
          from: modById[r.right]?.label || r.right,
          to: want.label,
        });
        r.right = want.id;
      }
    }
  });

  // A control, because "0 patches" is also what a migration that found nothing
  // to walk reports: every ADD term must have been SEEN.
  let terms = 0;
  walk(pipeline, (n) => { if ((n.config || {}).type === "ADD_TO_VAR") terms += 1; });
  if (!terms) throw new Error("Net Worth has no ADD_TO_VAR terms - refusing");
  log(`  ADD terms found: ${terms}`);
  log(`  terms repointed: ${patches.length}`);
  patches.forEach((p) => log(`    ${p.field}: ${p.from} -> ${p.to}`));

  // And a second control: the sum this now describes, computed from the data.
  const total = [];
  walk(pipeline, (n) => {
    const c = n.config || {};
    const m = /^\$item\.fields\.([A-Za-z0-9_-]+)\.value$/.exec(String(c.expr || ""));
    if (c.type === "ADD_TO_VAR" && m) {
      const holder = rowHolding(m[1]);
      const row = occs.find((o) => o.moduleId === holder.id);
      total.push(`${fieldName[m[1]]}=${row?.fields?.[m[1]]?.value ?? 0}`);
    }
  });
  log(`  Net Worth will sum: ${total.join(" + ")}`);

  if (!patches.length) { log("  already converged"); return { ok: true, converged: true }; }
  if (!apply) { log("  DRY RUN - nothing written"); return { ok: true, dryRun: true, patches: patches.length }; }

  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  log(`  APPLIED - ${patches.length} term(s)`);
  return { ok: true, patches: patches.length };
}
