// The rotator wrote `null` onto the Journal, because a question's text is on
// its MODULE.
//
// `0293` repaired the lookup and the op finally emitted a write. It wrote null:
//
//     UPDATE_ITEM_FIELD on Journal .Daily Question = null
//
// The step reads `$firstQuestion.label`, and all 117 question occurrences carry
// `label: null` - the text is the MODULE's label. That is not a quirk of these
// rows, it is how this grid stores a shared thing placed many times, and the
// renderer has always drawn `occurrence.label ?? module.label`. A collection
// item exposes BOTH: `label` (the placement's own) and `moduleLabel` (the
// template's). `Trackers: Date-Prefix Labels` already reads `$grp.moduleLabel`
// for the same reason.
//
// ── IT COALESCES RATHER THAN SWAPPING ──────────────────────────────────────
//
// Reading `moduleLabel` alone would be wrong the day someone renames one
// question in place - the placement's own label is the more specific answer
// and must win when it exists. `INIT_VAR` already supports exactly this:
// `cfg.fallback` is used when the primary resolves null/undefined. So the text
// is bound once, own-label-first, and the UPDATE writes that var.
//
// Verified before writing: with the coalesce the sweep writes a real question
// instead of null.
import Operation from "../models/Operation.js";

export const id = "0294-a-questions-text-lives-on-its-module";
export const description =
  "Daily Question Rotator: write the question's text, not the placement's empty label.";
export const touches = ["operations"];

const VAR = "$questionText";

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);
  const op = await Operation.findOne({ gridId: gid, name: "Daily Question Rotator" }).lean();
  if (!op) { log("  no Daily Question Rotator - nothing to do"); return; }
  const steps = JSON.parse(JSON.stringify(op.pipeline?.steps || []));

  if (JSON.stringify(steps).includes(VAR)) { log("  already coalesced - converged"); return; }

  const cfgOf = (s) => s.cfg || s.config || {};
  const actOf = (s) => s.action || s.config?.type || s.type;

  // The write, wherever it sits.
  let found = 0;
  const retarget = (list) => {
    for (const s of list || []) {
      if (actOf(s) === "UPDATE" && String(cfgOf(s).value || "") === "$firstQuestion.label") {
        (s.cfg || s.config).value = VAR;
        found++;
      }
      for (const k of ["then", "else", "steps", "body"]) if (Array.isArray(s[k])) retarget(s[k]);
      if (Array.isArray(cfgOf(s).steps)) retarget(cfgOf(s).steps);
    }
  };
  retarget(steps);
  if (!found) throw new Error("no UPDATE writing $firstQuestion.label - shape changed, refusing");
  log(`  ${found} write(s) repointed at ${VAR}`);

  // Bind it right after the question is found, so the var exists before use.
  const at = steps.findIndex((s) => actOf(s) === "FIND" && cfgOf(s).itemVar === "$firstQuestion");
  if (at === -1) throw new Error("no FIND binding $firstQuestion - refusing");
  steps.splice(at + 1, 0, {
    type: "action", action: "INIT_VAR",
    cfg: { name: VAR, expr: "$firstQuestion.label", fallback: "$firstQuestion.moduleLabel" },
  });
  log("  + $questionText = own label, falling back to the module's");

  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }
  await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { "pipeline.steps": steps } });
  log("  rewritten.");
}
