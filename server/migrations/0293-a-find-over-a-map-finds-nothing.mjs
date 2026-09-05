// The Daily Question Rotator FOUND nothing, because it searched a MAP.
//
// Found while auditing the trackers, 2026-09-05. The op runs on every load,
// reports no error, and emits ZERO effects - and the Journal it writes to
// carries no Daily Question at all.
//
// Its second step is:
//
//     FIND over "$allItemsById"  where  id IS "RWo6EN_ubw0R"  -> $journalingInst
//
// `$allItemsById` is an id-keyed OBJECT, not a list. The executor's FIND is
// explicit about that:
//
//     const itemList = Array.isArray(resolveExpr(overExpr, $vars)) ? ... : [];
//
// A non-array resolves to an EMPTY LIST, so the FIND matches nothing,
// `$journalingInstId` stays empty, the `if` below it is false and the UPDATE
// never runs. Silent, every load, with a clean run log - the exact shape of
// every other "the op never fired" defect in this repo.
//
// ── THE FIX IS THE FORM THE REST OF THE GRID ALREADY USES ──────────────────
//
// A FIND is the wrong tool for "the occurrence with this id". Every tracker op
// binds its goal picker-direct - `INIT_VAR $goalItem = $allItemsById.<id>` -
// which is a map LOOKUP, needs no predicate, and cannot be defeated by the
// collection being the wrong shape. The FIND becomes two INIT_VARs.
//
// ── AND THE GUARD THAT WAS WRITTEN BUT NEVER READ ──────────────────────────
//
// The pipeline sets `$earlyExit = true` when no question is found and then
// NEVER CHECKS IT - the steps below run regardless. With the lookup repaired
// that stops being harmless: with an empty pool the UPDATE would write
// `$firstQuestion.label` of nothing onto the user's Journal. So the final `if`
// is ANDed with `$firstQuestionId IS_NOT_EMPTY`, which is what `$earlyExit`
// was reaching for. The dead var is left in place - removing it is tidying,
// and this migration should be reviewable as one behaviour change.
import Operation from "../models/Operation.js";

export const id = "0293-a-find-over-a-map-finds-nothing";
export const description =
  "Daily Question Rotator: look the Journal up by id instead of FINDing over a map.";
export const touches = ["operations"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const op = await Operation.findOne({ gridId: gid, name: "Daily Question Rotator" }).lean();
  if (!op) { log("  no Daily Question Rotator - nothing to do"); return; }
  const steps = JSON.parse(JSON.stringify(op.pipeline?.steps || []));

  const cfgOf = (s) => s.cfg || s.config || {};
  const actOf = (s) => s.action || s.config?.type || s.type;

  const idx = steps.findIndex((s) => actOf(s) === "FIND" && String(cfgOf(s).over || "").includes("ById"));
  if (idx === -1) {
    log("  no FIND over an id-map - already converged (or the shape changed)");
  } else {
    const cfg = cfgOf(steps[idx]);
    const rule = (cfg.predicate?.rules || []).find((r) => r.left === "id" && r.comparator === "IS");
    if (!rule?.right) throw new Error("the map-FIND does not name an id - refusing to guess");
    const targetId = String(rule.right);
    const itemVar = cfg.itemVar || "$journalingInst";
    const idVar = cfg.itemIdVar || "$journalingInstId";
    log(`  FIND over "${cfg.over}" -> picker-direct lookup of ${targetId}`);
    steps.splice(idx, 1,
      { type: "action", action: "INIT_VAR", cfg: { name: itemVar, expr: `$allItemsById.${targetId}` } },
      { type: "action", action: "INIT_VAR", cfg: { name: idVar, expr: `${itemVar}.id` } },
    );
  }

  // The guard `$earlyExit` was reaching for.
  let gated = 0;
  for (const s of steps) {
    if ((s.type || actOf(s)) !== "if") continue;
    const cond = s.condition;
    if (!cond || !Array.isArray(cond.rules)) continue;
    if (!cond.rules.some((r) => r.left === "$journalingInstId")) continue;
    if (JSON.stringify(cond).includes("$firstQuestionId") && JSON.stringify(cond).includes("IS_NOT_EMPTY")) continue;
    cond.rules.push({ left: "$firstQuestionId", comparator: "IS_NOT_EMPTY", right: "" });
    gated++;
  }
  log(gated ? `  + guarded the write on a question actually being found (${gated})`
            : "  write already guarded on a question being found");

  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }
  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { "pipeline.steps": steps } });
  log("  rewritten.");
}
