// server/migrations/0391-tracker-flags-become-fields.mjs
//
// "There should be no hidden setting" (user, 2026-10-05). Three tracker flags lived
// in occurrence META, where no editor can reach them — written by the seed, read by
// one op (Trackers: Date-Prefix Labels):
//   meta.cumulative = true   on Checking / Savings / Mom's Account / Cash / Net Worth
//   meta.period = "month"    on Monthly Bills
//   meta.noDatePrefix = true on the Financial container
// They become two ordinary fields, set on the same rows and editable in each row's
// Settings › Fields like any other:
//   Tracker Period  (select: total | month; empty = a daily tile)
//   No Date Prefix  (boolean)
// The op's rules read the fields instead, with the same meaning, and the meta keys
// are REMOVED afterwards (a flag left behind is the hidden setting all over again).
// Bindings are added hidden, like Date / Time Slot — shown by the eye in Settings.

export const id = "0391-tracker-flags-become-fields";
export const describe = "Tracker meta flags (cumulative / period / noDatePrefix) become the fields Tracker Period and No Date Prefix; the meta keys are removed from the 7 rows; Date-Prefix Labels reads the fields.";
export const touches = ["fields", "modules", "occurrences", "operations"];

export const PERIOD = "Tracker Period";
export const NOPREFIX = "No Date Prefix";

/** PURE. The field value a row's meta flags stand for. */
export function valuesFromMeta(meta = {}) {
  const out = {};
  if (meta.cumulative) out.period = "total";
  else if (meta.period) out.period = String(meta.period);
  if (meta.noDatePrefix) out.noPrefix = true;
  return out;
}

/** PURE. A rule rewritten to read the fields, or the rule unchanged. */
export function rewriteRule(rule, ids) {
  const m = /^(\$[A-Za-z0-9_]+)\.meta\.(cumulative|period|noDatePrefix)$/.exec(String(rule.left || ""));
  if (!m) return rule;
  const [, v, key] = m;
  const field = (fid) => `${v}.fields.${fid}.value`;
  if (key === "noDatePrefix") {
    // IS_EMPTY (= prefix it) → not ticked
    return { ...rule, left: field(ids.noPrefix), comparator: rule.comparator === "IS_EMPTY" ? "IS_NOT" : "IS", right: "true" };
  }
  if (key === "cumulative") {
    return { ...rule, left: field(ids.period), comparator: rule.comparator === "IS_EMPTY" ? "IS_NOT" : "IS", right: "total" };
  }
  // period: IS_EMPTY stays IS_EMPTY (no period = daily), IS month stays IS month
  return { ...rule, left: field(ids.period) };
}

/** PURE. Every condition in the pipeline rewritten. */
export function rewritePipeline(pipeline, ids) {
  const group = (g) => g && ({ ...g, rules: (g.rules || []).map((r) => (r.rules ? group(r) : rewriteRule(r, ids))) });
  const walk = (steps) => (steps || []).map((s) => ({
    ...s,
    ...(s.condition ? { condition: group(s.condition) } : {}),
    ...(s.then ? { then: walk(s.then) } : {}),
    ...(s.else ? { else: walk(s.else) } : {}),
    ...(s.body ? { body: walk(s.body) } : {}),
  }));
  return { ...pipeline, steps: walk(pipeline?.steps) };
}

const uid = () => (globalThis.crypto?.randomUUID?.() || `f-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;
  const rows = await Occurrence.find({ gridId, $or: [{ "meta.cumulative": { $exists: true } }, { "meta.period": { $exists: true } }, { "meta.noDatePrefix": { $exists: true } }] }).lean();
  const op = await Operation.findOne({ gridId, name: "Trackers: Date-Prefix Labels" }).lean();
  log(`${rows.length} row(s) carry tracker meta flags; reader op ${op ? "found" : "absent"}`);
  const userId = rows[0]?.userId || op?.userId;
  let period = await Field.findOne({ gridId, name: PERIOD }).lean();
  let noPrefix = await Field.findOne({ gridId, name: NOPREFIX }).lean();
  for (const r of rows) log(`  ${r.label || r.moduleId}: ${JSON.stringify(valuesFromMeta(r.meta))}`);
  if (dryRun) return;
  if (!period) period = (await Field.create({ id: uid(), userId, gridId, name: PERIOD, type: "select", inputEnabled: true, displayEnabled: false, meta: { optionsSource: { mode: "manual", values: ["total", "month"] } } })).toObject();
  if (!noPrefix) noPrefix = (await Field.create({ id: uid(), userId, gridId, name: NOPREFIX, type: "boolean", inputEnabled: true, displayEnabled: false, meta: { variant: "switch", defaultValue: false } })).toObject();
  const ids = { period: period.id, noPrefix: noPrefix.id };
  for (const r of rows) {
    const v = valuesFromMeta(r.meta);
    const want = [v.period ? ids.period : null, v.noPrefix ? ids.noPrefix : null].filter(Boolean);
    const mod = await Module.findOne({ gridId, id: r.moduleId }).lean();
    const bindings = mod?.fieldBindings || [];
    const add = want.filter((fid) => !bindings.some((b) => b.fieldId === fid)).map((fid, i) => ({ fieldId: fid, role: "input", order: bindings.length + i, hidden: true }));
    if (mod && add.length) await Module.updateOne({ gridId, id: mod.id }, { $set: { fieldBindings: [...bindings, ...add] } });
    const set = {};
    if (v.period) set[`fields.${ids.period}`] = { value: v.period, flow: "replace" };
    if (v.noPrefix) set[`fields.${ids.noPrefix}`] = { value: true, flow: "in" };
    await Occurrence.updateOne({ gridId, id: r.id }, { $set: set, $unset: { "meta.cumulative": "", "meta.period": "", "meta.noDatePrefix": "" } });
  }
  if (op) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: rewritePipeline(op.pipeline, ids) } });
  const left = await Occurrence.countDocuments({ gridId, $or: [{ "meta.cumulative": { $exists: true } }, { "meta.period": { $exists: true } }, { "meta.noDatePrefix": { $exists: true } }] });
  if (left) throw new Error(`0391: ${left} row(s) still carry a tracker meta flag`);
  log("done. Restart the server (pm2).");
}
