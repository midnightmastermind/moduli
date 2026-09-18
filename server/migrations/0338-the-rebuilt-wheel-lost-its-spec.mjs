// 0338 — the rebuilt Emotions Wheel is missing four migrations' worth of spec.
//
// User, 2026-09-18: *"the emotions arent being shown on the third level and the
// graph isnt selecting the emotions. it should be highlighted if selected."*
//
// ── ONE EVENT EXPLAINS BOTH HALVES, and the ledger is what hides it ─────────
//
// `0296` records the wheel being REBUILT on 2026-09-09 by re-running `0046`,
// because the container had stopped being `kind:"graph"`. `0046` is the
// authoritative builder and it is idempotent — but its `buildGraphSpec` mints
// exactly three keys:
//
//     { type, encoding, literals }
//
// Everything four later migrations had added to the OLD occurrence went with
// the old occurrence, and `grid.meta.migrations[]` still lists all four as
// applied. Measured on poms grid today:
//
//     0084-highlight-is-per-day      applied   dayFieldId        ABSENT
//     0085-wheel-reads-the-field     applied   valueFieldId      ABSENT
//     0090-wheel-shows-its-outer-…   applied   labelMinArcPx     ABSENT
//     0138-wheel-outer-ring-labels   applied   labelFontPx       ABSENT
//                                              hideTooltipValue  ABSENT
//
// A ledger entry is a record that a migration RAN, never that its effect
// survived. That is the whole lesson here.
//
// ── WHY EACH ABSENCE IS EXACTLY ONE OF THE TWO SYMPTOMS ────────────────────
//
// THIRD RING, no labels. `graphOption` falls back to `LABEL_FONT_PX` (9) and
// `LABEL_MIN_ARC_PX` (9 * 1.67 = 15.03px of arc). The outer ring is 80 slices
// of a FIXED 4.5°, and `minArcPx * 360 / (2*pi*r)` <= 4.5 needs r >= 191px —
// a 416px box. The wheel renders in a day column at ~330px, so every one of
// the 80 outer labels is hidden at rest. `0138` measured 6 on the live chart
// and 7px lettering with it; both are imported from that file rather than
// retyped, so there is one source for the pair.
//
// NO HIGHLIGHT. `ContainerGraph` lights slices only when
// `derivesSelection(spec)` is true, and that asks for `valueFieldId` AND
// `dayFieldId`. With neither, `derivedIds` is null, `dayKey` is never resolved,
// and the click path still records perfectly — which is why the user sees
// check-ins appear while the wheel stays dark.
//
// ── AND THE OP STILL NAMES THE DEAD OCCURRENCE ─────────────────────────────
//
// `0296` re-pointed the operation's SCOPE (its `targetOccurrenceId` and the
// trigger's `targetId`) at the rebuilt wheel. It did not walk the pipeline, and
// one step inside it still FINDs the wheel by the id that was deleted:
//
//     FIND over $allOccurrences into $graph  where id IS 289583d9…   -> nothing
//
// `$graph` is the fallback source for `$day` when the click cannot resolve a
// column. Today that fallback is dead and the final `$today` catch covers it,
// so nothing is visibly wrong — it is the quiet half of the same event, and it
// is repaired here because the next person to lose a column will be repaid for
// it.
//
// Every id is RESOLVED, never typed: the fields by name+type the way `0084` and
// `0085` resolve them, the wheel as the grid's single graph occurrence the way
// `0296` does. Refuses rather than guessing if any of that is ambiguous.
import { LABEL_FONT_PX, LABEL_MIN_ARC_PX } from "./0138-wheel-outer-ring-labels.mjs";

export const id = "0338-the-rebuilt-wheel-lost-its-spec";
export const describe =
  "Restores the Emotions Wheel's graph spec (per-day highlight fields + outer-ring label sizing) "
  + "that the 2026-09-09 rebuild dropped, and points the Mood op's $graph lookup at the live wheel. "
  + "Deletes nothing.";

const OP_NAME = "Mood: Record Selection";

/**
 * PURE — the spec keys the rebuild dropped, merged onto whatever is there now.
 *
 * Returns null when every key already holds the wanted value, so a re-run
 * writes nothing rather than re-stamping the same object.
 */
export function planGraphSpec(spec, { dayFieldId, valueFieldId }) {
  const want = {
    dayFieldId,
    valueFieldId,
    labelFontPx: LABEL_FONT_PX,
    labelMinArcPx: LABEL_MIN_ARC_PX,
    hideTooltipValue: true,
  };
  const current = spec && typeof spec === "object" ? spec : {};
  const missing = Object.keys(want).filter((k) => current[k] !== want[k]);
  if (!missing.length) return null;
  // Spread LAST so the restored keys win, and so `type`, `encoding` and
  // `literals` — which the rebuild got right — are carried through untouched.
  return { next: { ...current, ...want }, missing };
}

/**
 * PURE — re-point the pipeline's `$graph` FIND at the live wheel occurrence.
 *
 * Matched by the VARIABLE it fills, not by the stale id: an id is the thing
 * that went wrong, so keying on it would only work until it goes wrong again.
 *
 * THROWS unless exactly one such step exists. A pipeline patcher that silently
 * finds nothing leaves an operation that looks repaired and is not (0085's
 * rule, paid for in the same op).
 */
export function repointGraphFind(pipeline, wheelId) {
  let found = 0;
  let changed = 0;

  const patch = (step) => {
    if (step?.actionType !== "FIND" || step?.config?.itemVar !== "$graph") return step;
    found++;
    const rules = step.config.predicate?.rules || [];
    const idRule = rules.findIndex((r) => r?.left === "id" && r?.comparator === "IS");
    if (idRule < 0) return step;
    if (rules[idRule].right === wheelId) return step;
    changed++;
    const nextRules = rules.map((r, i) => (i === idRule ? { ...r, right: wheelId } : r));
    return { ...step, config: { ...step.config, predicate: { ...step.config.predicate, rules: nextRules } } };
  };

  const walk = (steps) => (steps || []).map((step) => {
    if (step?.type === "if") return { ...step, then: walk(step.then), else: walk(step.else) };
    if (step?.type === "loop") return { ...step, body: walk(step.body) };
    return patch(step);
  });

  const steps = walk(pipeline?.steps || []);
  if (found !== 1) throw new Error(`0338: expected exactly 1 FIND into $graph, found ${found}`);
  return { pipeline: { ...pipeline, steps }, changed };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Module, Field, Operation } = models;
  const gid = String(gridId);

  const [occs, mods, fields, op] = await Promise.all([
    Occurrence.find({ gridId: gid }).lean(),
    Module.find({ gridId: gid }).lean(),
    Field.find({ gridId: gid }).lean(),
    Operation.findOne({ gridId: gid, name: OP_NAME }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));

  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");

  if (!dateField || !moodField || graphs.length !== 1) {
    log(`  REFUSING: Date=${!!dateField} Mood=${!!moodField} graphs=${graphs.length} — nothing written.`);
    return { changed: 0 };
  }

  const wheel = graphs[0];
  const label = wheel.label || modById.get(wheel.moduleId)?.label;
  const plan = planGraphSpec(wheel.meta?.graph, { dayFieldId: dateField.id, valueFieldId: moodField.id });
  const opPlan = op ? repointGraphFind(op.pipeline, wheel.id) : null;

  log(`  wheel ${wheel.id} ("${label}") · type ${wheel.meta?.graph?.type}`);
  log(`  restoring: ${plan ? plan.missing.join(", ") : "(nothing — already complete)"}`);
  log(`  ${OP_NAME}: ${op ? (opPlan.changed ? "$graph FIND re-pointed at the live wheel" : "$graph FIND already correct") : "not on this grid"}`);

  if (dryRun) {
    log("  WOULD write meta.graph and the op pipeline. Dry run — nothing written.");
    return { changed: 0 };
  }
  if (!plan && !opPlan?.changed) return { changed: 0 };

  if (plan) {
    await Occurrence.updateOne({ gridId: gid, id: wheel.id },
      { $set: { meta: { ...(wheel.meta || {}), graph: plan.next } } });
  }
  if (opPlan?.changed) {
    await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: opPlan.pipeline } });
  }

  // Read the RESULT back out of the database rather than trusting the write.
  const after = await Occurrence.findOne({ gridId: gid, id: wheel.id }).lean();
  const left = planGraphSpec(after?.meta?.graph, { dayFieldId: dateField.id, valueFieldId: moodField.id });
  if (left) throw new Error(`0338: the wheel still lacks ${left.missing.join(", ")} after the write`);
  if (opPlan?.changed) {
    const opAfter = await Operation.findOne({ gridId: gid, id: op.id }).lean();
    if (repointGraphFind(opAfter.pipeline, wheel.id).changed !== 0) {
      throw new Error("0338: the $graph FIND still names a stale id after the write");
    }
  }
  log(`  wheel spec restored; encoding and literals untouched.`);
  return { changed: 1 };
}
