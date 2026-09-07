// "Reading Time" counted every minute you logged, whatever you were doing.
//
// User, 2026-09-07: *"make sure all the ops are working for updating trackers.
// make sure are tests are making sure values are updated (my ops specifically)"*
//
// Driving one logged row through the real sweep and watching which tiles move
// is what found it. A 60-minute mentoring session and a 20-minute meditation
// BOTH landed in Reading Time:
//
//     Mentor   +60  ->  Connection Time ✓   Reading Time ✗   Reading Stats ✗
//     Meditate +20  ->  Practice Duration ✓ Reading Time ✗   Reading Stats ✗
//
// Five tiles track time by dimension and four of them gate on their own tag —
// `Connection Time` on "social", `Creative Duration` on "creative",
// `Practice Duration` on "spiritual", `Work Duration` on "occupational". The
// intellectual pair never got the rule, so they summed EVERY duration on the
// day and reported it as reading.
//
// `Productivity.Time Spent` also counts everything and is LEFT ALONE: it is the
// day's total, not a dimension, so counting everything is what it is for. That
// distinction is why this migration names two ops rather than "every op that
// sums Duration".
//
// ── WHAT THEY SHOULD COUNT WAS THE USER'S CALL, NOT A GUESS ───────────────
//
// Two readings were defensible and produce different numbers on a tile read
// daily: all INTELLECTUAL time (Read · Study · Teach · Learn), or reading only.
// Asked directly, the user chose **all intellectual time** — which also makes
// the family complete: one time tracker per dimension, all five gated the same
// way.
//
// ── THE RULE IS COPIED FROM A WORKING SIBLING, NOT AUTHORED ───────────────
//
// `Connection Time` wraps its base gate in an outer AND carrying one dimension
// rule. This reads that shape off the live op and reproduces it, so the five
// cannot drift apart — the alternative is hand-writing a predicate that looks
// right and is subtly different, which is how the two got missed originally.
//
// Idempotent: converges once both gates carry the dimension rule.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0315-reading-time-counts-reading";
export const description =
  "The two intellectual time trackers gate on their dimension, like the other four.";
export const touches = ["fields", "operations"];

const DIMENSION = "intellectual";
const TARGETS = ["Time Spent", "Total Reading Time"];
const EXEMPLAR = "Connection Time";

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const ops = await Operation.find({ gridId: gid }).lean();

  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}" is ambiguous or missing (${hits.length}) - refusing`);
    return hits[0];
  };
  const tags = one("Tags");
  const duration = one("Duration");
  const tagLeft = `$item.fields.${tags.id}.value`;

  // The `if` that decides whether a ROW's Duration is added — found by what it
  // does, never by position. Two properties pin it: its branch sums Duration,
  // and it asks about `$item`. The second is load-bearing: the outermost gate
  // whose branch sums Duration is the pipeline's TRIGGER gate
  // (`$trigger.type IS "onLoad" OR …`), which wraps everything and is not a
  // per-row decision at all.
  const summingGate = (op) => {
    const hits = [];
    walk(op.pipeline, (n) => {
      if (n.type !== "if" || !Array.isArray(n.then)) return;
      if (!JSON.stringify(n.condition || {}).includes("$item")) return;
      let sums = false;
      walk(n.then, (b) => {
        const c = b.config || {};
        if (c.type === "ADD_TO_VAR" && String(c.expr || "").includes(duration.id)) sums = true;
      });
      if (sums) hits.push(n);
    });
    // A gate nested INSIDE another gate is not the one to wrap — the sibling
    // carries its dimension rule on the OUTERMOST condition, and wrapping an
    // inner one would gate only part of the branch. Drop anything contained by
    // another hit.
    const contains = (outer, inner) => {
      if (outer === inner) return false;
      let found = false;
      walk(outer, (n) => { if (n === inner) found = true; });
      return found;
    };
    return hits.filter((h) => !hits.some((other) => contains(other, h)));
  };

  // ── THE SHAPE COMES OFF A WORKING SIBLING ───────────────────────────────
  const model = ops.find((o) => o.name === EXEMPLAR);
  if (!model) throw new Error(`no "${EXEMPLAR}" operation to copy the gate shape from - refusing`);
  const modelGates = summingGate(model);
  if (modelGates.length !== 1)
    throw new Error(`"${EXEMPLAR}" has ${modelGates.length} duration gates - refusing to guess the shape`);
  const modelCond = modelGates[0].condition;
  const modelDim = (modelCond?.rules || []).find(
    (r) => r.left === tagLeft && r.comparator === "CONTAINS" && typeof r.right === "string" && !r.right.startsWith("$"));
  if (!modelDim)
    throw new Error(`"${EXEMPLAR}" carries no dimension rule - the shape this migration copies no longer exists; refusing`);
  log(`  shape from "${EXEMPLAR}": outer ${modelCond.operator} + [${modelDim.left} ${modelDim.comparator} "${modelDim.right}"]`);

  let changed = 0;
  for (const name of TARGETS) {
    const op = ops.find((o) => o.name === name);
    if (!op) throw new Error(`no operation named "${name}" - refusing`);
    const gates = summingGate(op);
    if (gates.length !== 1)
      throw new Error(`"${name}" has ${gates.length} gates whose branch sums Duration - refusing`);
    const gate = gates[0];

    const already = JSON.stringify(gate.condition || {}).includes(`"${DIMENSION}"`);
    if (already) { log(`  ${name}: already gated on "${DIMENSION}"`); continue; }

    // Wrap, exactly as the sibling is wrapped: the existing condition becomes
    // the first rule of an outer AND, the dimension rule the second. Rewriting
    // the condition in place would drop whatever it already required.
    gate.condition = {
      operator: "AND",
      rules: [
        gate.condition || { operator: "AND", rules: [] },
        { id: `dim${Math.random().toString(36).slice(2, 10)}`,
          left: tagLeft, comparator: modelDim.comparator, right: DIMENSION },
      ],
    };
    log(`  ${name}: now requires Tags CONTAINS "${DIMENSION}"`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    changed++;
  }

  // The CONTROL: the day's total must NOT gain a dimension gate. Without this
  // the "fix" is also satisfied by gating every op that sums Duration, which
  // would silently stop Productivity counting anything but reading.
  const total = ops.find((o) => o.name === "Time Spent This Week");
  if (total) {
    const g = summingGate(total)[0];
    if (g && JSON.stringify(g.condition || {}).includes(`"${DIMENSION}"`))
      throw new Error(`"Time Spent This Week" is the day's TOTAL and must not be dimension-gated - refusing`);
    log(`  Time Spent This Week: left alone — it is the total, not a dimension`);
  }

  log(`  ${changed} op(s) ${apply ? "gated" : "would be gated"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
