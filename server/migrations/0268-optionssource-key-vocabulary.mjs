/**
 * 0268 — an options source whose keys nothing reads.
 *
 * User, 2026-08-27: *"also all the authors are just ids"*, then *"the author is
 * showing ids i mean, when its in the author selection box"*.
 *
 * ── THE RESOLVER READS `over` AND `predicate`. NOTHING ELSE. ────────────
 * `optionsResolver.resolveOptions`:
 * ```
 * const cfg  = src.find || src;
 * const over = cfg.over || "$allOccurrences";
 * const predicate = cfg.predicate || { rules: [] };
 * ...
 * if (!predicate.rules?.length) return true;      // EVERYTHING matches
 * ```
 * The Author field stored `collection` and `conditions`. Both are ignored, so
 * `over` fell back to every occurrence on the grid and the predicate was empty
 * — the dropdown offered the first 100 of 21,000 arbitrary rows, none of them
 * authors. A stored value that is not in the option list has no label, and the
 * pill falls back to printing the raw id.
 *
 * Measured across the grid's 47 occurrence fields: 41 use `over`+`predicate`,
 * one uses the nested `{find:{...}}` form the resolver also accepts, and FIVE
 * do not. Author is the only one with BOTH keys wrong, which is why it is the
 * only one the user noticed — `Mood`, `Files` and `Parent Emotion` get `over`
 * wrong but keep a working `predicate`, so they still filter correctly, just
 * over every occurrence instead of their own slice.
 *
 * ── AND `0264` WAS INERT, WHICH IS THE SAME MISTAKE ONE LEVEL UP ────────
 * Yesterday I "fixed" this by widening `collection` from `$allInstances` to
 * `$allItems` and verified it by re-running my own predicate simulation, which
 * agreed with me. It could not have worked: the resolver never reads
 * `collection`. The check that would have caught it — looking at a rendered
 * pill — is the one I skipped. `0264` is left applied because it is harmless
 * and its reasoning about role filtering is still right for the key that
 * actually gets read; this migration moves the value onto that key.
 *
 * ── IT REWRITES KEYS, NEVER MEANING ─────────────────────────────────────
 * `collection` -> `over` verbatim. `conditions` -> `predicate` as an AND group,
 * mapping each entry's `fieldId` to `fields.<id>.value` and `path` to itself —
 * the two shapes the stored conditions actually use. A field that already has
 * `over`/`predicate`, or the nested `find` form, is left alone. Anything whose
 * conditions are not one of those two shapes is REPORTED AND SKIPPED rather
 * than guessed at.
 */

export const id = "0268-optionssource-key-vocabulary";
export const describe =
  "Moves optionsSource.collection -> over and conditions -> predicate on occurrence/select fields that use the keys the resolver does not read. An unread `conditions` means an EMPTY predicate, so the dropdown matched every occurrence on the grid and selected values rendered as raw ids.";
export const touches = ["fields"];

/** Pure. One field's optionsSource -> the patch it needs, or null. */
export function planOptionsSourceFix(field) {
  const src = field?.meta?.optionsSource;
  if (!src || src.mode !== "find") return null;
  if (src.find) return null;                       // nested form: the resolver reads it
  const patch = {};
  const notes = [];

  if (!src.over && src.collection) { patch.over = src.collection; notes.push(`over <- collection (${src.collection})`); }

  if (!src.predicate?.rules?.length && Array.isArray(src.conditions) && src.conditions.length) {
    const rules = [];
    for (const c of src.conditions) {
      const left = c.fieldId ? `fields.${c.fieldId}.value` : c.path;
      if (!left || !c.comparator) return { skip: `condition shape not understood: ${JSON.stringify(c)}` };
      rules.push({ left, comparator: c.comparator, right: c.value ?? "" });
    }
    patch.predicate = { operator: "AND", rules };
    notes.push(`predicate <- ${rules.length} condition(s)`);
  }

  if (!Object.keys(patch).length) return null;
  return { patch, notes };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const plans = [];
  for (const f of fields) {
    const p = planOptionsSourceFix(f);
    if (!p) continue;
    if (p.skip) { log(`  SKIPPED "${f.name}" — ${p.skip}`); continue; }
    plans.push({ f, ...p });
  }
  if (!plans.length) { log("every find-mode options source already uses the keys the resolver reads."); return; }
  for (const { f, notes } of plans) log(`"${f.name}" (${f.id}) — ${notes.join(" · ")}`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  for (const { f, patch } of plans) {
    const $set = {};
    for (const [k, v] of Object.entries(patch)) $set[`meta.optionsSource.${k}`] = v;
    await Field.updateOne({ gridId, id: f.id }, { $set });
  }
  log(`patched ${plans.length} field(s).`);
}
