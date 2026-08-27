/**
 * 0269 — the dropdown found the right rows and then labelled them with their ids.
 *
 * The second half of *"the author is showing ids ... when its in the author
 * selection box"*. `0268` fixed WHICH rows the Author dropdown matches; this
 * fixes what it CALLS them.
 *
 * ── THE DEFAULT IS THE ID, AND IT IS SILENT ─────────────────────────────
 * `optionsResolver.resolveOptions`:
 * ```
 * const valuePath = cfg.valuePath || "id";
 * const labelPath = cfg.labelPath || valuePath;     // -> "id"
 * ```
 * With no `labelPath`, an option's label IS its value. Measured after `0268`,
 * over live data through the real resolver:
 * ```
 * totalMatched 297   options 297        <- the predicate is right now
 * { value: "gh737i93kg4c", label: "gh737i93kg4c" }
 *   ...while that occurrence's own label is "Abraham H. Maslow"
 * ```
 * The rows were correct the whole time; every one was captioned with its id.
 *
 * ── THE FIX IS WHAT 44 OTHER FIELDS ALREADY DO ──────────────────────────
 * Of this grid's find-mode occurrence fields, **44 declare
 * `valuePath:"id", labelPath:"label"`** and exactly **3 declare neither**:
 * Author, Files and Parent Emotion. So this is not a judgement call about what
 * the label should be — it is the grid's own overwhelming convention, and three
 * fields that never got it.
 *
 * Only fields MISSING the keys are touched; a field that declares something
 * else is left alone rather than normalised, because a deliberate `labelPath`
 * is a real choice (`chipDisplay` fields nearby show several).
 *
 * ── WHY IT TOOK THREE TRIES, RECORDED SO IT DOES NOT TAKE A FOURTH ──────
 * `0264` widened `collection` — a key the resolver never reads. Then I blamed
 * the 100-option cap and raised the limit; still ids. Both were "verified" by
 * re-running my own simulation of the predicate, which agreed with me every
 * time. Only running THE REAL `resolveOptions` over live data showed the
 * label field, because a simulation reproduces the parts you already
 * understand. The instrument had to be the shipped function.
 */

export const id = "0269-optionssource-label-path";
export const describe =
  "Declares valuePath:\"id\" and labelPath:\"label\" on find-mode option sources that declare neither — without a labelPath the resolver captions every option with its own id, which is what a selection box renders.";
export const touches = ["fields"];

export const CANON = { valuePath: "id", labelPath: "label" };

/** Pure. Returns the patch a field needs, or null. */
export function planLabelPathFix(field) {
  const src = field?.meta?.optionsSource;
  if (!src || src.mode !== "find" || src.find) return null;
  // Only the fields that declare NEITHER. One without the other is a
  // deliberate shape and not this migration's business.
  if (src.labelPath || src.valuePath) return null;
  return { ...CANON };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const plans = [];
  for (const f of fields) {
    const patch = planLabelPathFix(f);
    if (patch) plans.push({ f, patch });
  }
  if (!plans.length) { log("every find-mode options source already declares a label path."); return; }
  for (const { f } of plans) log(`"${f.name}" (${f.id}) — labelPath <- "label", valuePath <- "id"`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  for (const { f, patch } of plans) {
    await Field.updateOne({ gridId, id: f.id }, { $set: {
      "meta.optionsSource.valuePath": patch.valuePath,
      "meta.optionsSource.labelPath": patch.labelPath,
    } });
  }
  log(`patched ${plans.length} field(s).`);
}
