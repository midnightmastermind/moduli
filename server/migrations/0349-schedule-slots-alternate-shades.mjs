// 0349 — Schedule slots alternate between two shades, like table rows.
//
// User, 2026-09-21: *"change my schedule to have 2 diff shades of color,
// switching off between the two (including the red ones), as you go down the
// timeslots … 2 diff shades of red and 2 diff shades of whatever color it is
// when its not red. (green is fine as just one for now)"*
//
// THE COLOURS ARE DATA, SO THE STRIPE IS TOO. A slot's background is written by
// "Schedule: Mark Passed Slots" to `occurrence.ownStyle.bg` — nothing in the
// renderer knows what a timeslot is (`noDomainKnowledge.test.js`), and that op
// is the ONE writer of that target (createLiveData: "One writer per target").
// So the alternation goes into the op, not a CSS `:nth-child`, which would
// also have to know which containers are slots.
//
// HOW: pass 2 already walks each day column's own `occurrences[]` in order. A
// `$slotStripe` flag is reset per column and flipped on every SLOT (not every
// child — a non-slot row would otherwise shift the pattern), then each paint
// picks its shade by it:
//
//   current  green                     (one shade, as asked)
//   passed   PASSED_A  /  PASSED_B      the existing red and a deeper one
//   idle     cleared   /  IDLE_B       the existing "no colour" and a faint slate
//
// Shade A is exactly what each slot gets today, so the first slot of every
// column is unchanged. Both B shades sit under `WASH_ALPHA_MAX` (0.35), so no
// skin palette re-hues them — they stay state washes.
//
// Every write stays dedup'd against the slot's current bg, the property that
// makes a 5-minute tick emit ~zero writes in steady state.

export const id = "0349-schedule-slots-alternate-shades";
export const describe = "Schedule: Mark Passed Slots paints alternate slots in a second shade (red and uncoloured each get two). Pipeline only.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Mark Passed Slots";
export const PASSED_A = "rgba(248,113,113,0.10)";
export const PASSED_B = "rgba(248,113,113,0.20)";
export const IDLE_B = "rgba(148,163,184,0.12)";
const MARK = "slotStripe";
const BG = "$slot.ownStyle.bg";

const isBgUpdate = (s, value) => s?.type === "action" && s.config?.type === "UPDATE" && s.config.path === BG && s.config.value === value;
// The dedup'd paint: `if bg <cmp> … then UPDATE bg = value`.
const isDedupPaint = (s, value) => s?.type === "if" && (s.then || []).length === 1 && isBgUpdate(s.then[0], value);

const paint = (key, value) => ({
  id: `${MARK}-${key}`, type: "if",
  condition: { operator: "AND", rules: [{ id: `${MARK}-${key}-r`, left: BG, comparator: "IS_NOT", right: value }] },
  then: [{ id: `${MARK}-${key}-u`, type: "action", config: { type: "UPDATE", path: BG, value } }],
  else: [],
});
const byStripe = (key, whenA, whenB) => ({
  id: `${MARK}-${key}`, type: "if",
  condition: { operator: "AND", rules: [{ id: `${MARK}-${key}-r`, left: "$slotStripe", comparator: "IS", right: 1 }] },
  then: [whenA],
  else: [whenB],
});

// Every step list in the tree, so a match can be replaced in place.
function* lists(steps) {
  if (!Array.isArray(steps)) return;
  yield steps;
  for (const s of steps) {
    yield* lists(s.body);
    yield* lists(s.then);
    yield* lists(s.else);
  }
}
const find = (steps, pred) => {
  for (const list of lists(steps)) {
    const i = list.findIndex(pred);
    if (i >= 0) return { list, i };
  }
  return null;
};

/**
 * Pure: returns `{ pipeline, changed, reason }`. Idempotent — a pipeline that
 * already carries the stripe comes back unchanged.
 */
export function stripeSlotPaint(pipeline) {
  const p = structuredClone(pipeline);
  const steps = p.steps || [];
  if (find(steps, (s) => s.id === `${MARK}-init`)) return { pipeline: p, changed: false, reason: "already striped" };

  // Pass 2 is the slot loop that PAINTS (pass 1 only finds the current slot).
  const pass2 = find(steps, (s) => s.type === "loop" && s.overExpr === "$dayCol.occurrences"
    && find(s.body, (t) => isDedupPaint(t, PASSED_A)));
  if (!pass2) return { pipeline: p, changed: false, reason: "no painting slot loop" };
  const loop = pass2.list[pass2.i];

  const slotIf = find(loop.body, (s) => s.type === "if" && s.condition?.rules?.some((r) => r.right === "slot"));
  const passed = find(loop.body, (s) => isDedupPaint(s, PASSED_A));
  const clear = find(loop.body, (s) => isDedupPaint(s, ""));
  if (!slotIf || !passed || !clear) return { pipeline: p, changed: false, reason: "pass 2 not in the expected shape" };

  passed.list[passed.i] = byStripe("passed", passed.list[passed.i], paint("passedB", PASSED_B));
  clear.list[clear.i] = byStripe("idle", clear.list[clear.i], paint("idleB", IDLE_B));
  // Flip first, so the first slot of a column is stripe 1 = shade A = today's look.
  slotIf.list[slotIf.i].then.unshift(byStripe("toggle",
    { id: `${MARK}-to0`, type: "action", config: { type: "SET_VAR", name: "$slotStripe", expr: "literal:0" } },
    { id: `${MARK}-to1`, type: "action", config: { type: "SET_VAR", name: "$slotStripe", expr: "literal:1" } }));
  // Reset per column, OUTSIDE the slot loop (vars are shared across iterations).
  pass2.list.splice(pass2.i, 0,
    { id: `${MARK}-init`, type: "action", config: { type: "INIT_VAR", name: "$slotStripe", expr: "literal:0" } });

  return { pipeline: p, changed: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op on this grid — nothing to do.`); return; }
  const { pipeline, changed, reason } = stripeSlotPaint(op.pipeline);
  if (!changed) { log(`unchanged: ${reason}.`); return; }
  log(`${OP_NAME} (${op.id}): will stripe slots — passed ${PASSED_A} / ${PASSED_B}, idle cleared / ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (stripeSlotPaint(after.pipeline).reason !== "already striped") throw new Error("readback: stripe not present");
  log(`applied and read back.`);
}
