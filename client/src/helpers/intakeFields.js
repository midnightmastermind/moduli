// helpers/intakeFields.js
//
// Which of an occurrence's fields could a dropped LINK be written into?
//
// ── THE ANSWER IS "ASK", AND THAT IS A MEASUREMENT, NOT A SHRUG ─────────────
//
// There is no url/link field TYPE and no link binding ROLE. Measured on poms
// grid before any of this was written:
//
//   field types in use   occurrence 43 · text 42 · number 52 · date 11 ·
//                        select 14 · boolean 2 · rating 3 · duration 2 · address 1
//   binding roles in use input 3497 · display 81 · media 207 · files 192
//   name looks url-ish   "Website", "LinkedIn"          ← 2 of 170
//   actually holds http  "Website"                      ← 1 of 170, 10 rows
//
// So a link field can only be GUESSED — from its name, or from what it happens
// to contain today. Name matching is precisely what produced 10 candidates and
// 10 FALSE POSITIVES in the link-relink work (CLAUDE.md 2026-08-07 (6)), and
// guessing from current contents means an empty field can never be chosen.
//
// The user's own decision removes the need to detect anything at all
// (2026-08-09: always ask which field, even when there is only one candidate).
// So this offers the TEXT fields the occurrence actually binds and lets the
// person pick. A URL is a string; number/date/boolean/rating/duration cannot
// hold one, and `address` and `occurrence` have their own pickers.
//
// ── WHY THE LIST IS USABLE, ALSO MEASURED ───────────────────────────────────
// Of 274 modules binding at least one text field: 253 bind exactly ONE, 9 bind
// two, and 12 bind seventeen. The twelve are the People rows (Name, Email,
// Phone, Company, Job Title, City, Website …) — which is exactly the case where
// asking earns its keep, because Website / LinkedIn / Email are all plausible.
//
// ORDER IS THE MODULE'S OWN BINDING ORDER, deliberately. Floating a
// url-ish-looking name to the top would be a recommendation, and the sheet
// stopped making those. Binding order is also the order the row renders its
// fields in, so the list matches what is on screen.

const TEXT_TYPE = "text";

/**
 * @param {object} module      the destination occurrence's module
 * @param {object} fieldsById  id → field record
 * @returns {Array<{id: string, name: string}>} in binding order
 */
export function linkTargetFieldsFor(module, fieldsById) {
  const bindings = Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];
  const seen = new Set();
  const out = [];
  for (const b of bindings) {
    const fid = b?.fieldId;
    if (!fid || seen.has(fid)) continue;
    const f = fieldsById?.[fid];
    if (!f || f.type !== TEXT_TYPE) continue;
    seen.add(fid);
    // A field with no name would render as a blank row in the picker — worse
    // than not offering it, because there is no way to tell which one it is.
    const name = (f.name || "").trim();
    if (!name) continue;
    out.push({ id: fid, name });
  }
  return out;
}
