// "+ Add new" on a money dropdown minted a NAME and nothing else.
//
// ── WHAT AND WHY ───────────────────────────────────────────────────────────
//
// User, 2026-09-05: *"i wasnt able to select fields when i added a new bill"*,
// then *"added a new bill via the quick add in the dropdown select"* and *"for
// adding a new option"*. Measured on the live grid before writing anything:
//
//     occurrence dropdowns carrying an `addNew` config        44
//       of those that PROMPT for field values (`fieldIds`)     5
//       Bill / Subscription                                    0
//
// The mechanism is not missing — `addNewOption` has prompted for field values
// through the GET_USER_INPUT modal since 2026-07-25, and five dropdowns (Gift
// Idea, Meal, Creative Work, Event, Savings Goal) demonstrably use it. `Bill`
// simply never declared WHICH fields to ask for, so the flow minted a label and
// stopped. A bill with no amount and no cadence is a row the Bills operations
// cannot act on, and nothing on screen says why.
//
// ── THE PROMPT LIST IS READ OFF A REAL BILL, NOT INVENTED ──────────────────
//
// The obvious implementation names the fields. This one takes the exemplar the
// grid already has — the most completely-filled child of the dropdown's own
// predicate scope — and prompts for the fields IT carries values in, minus the
// ones an operation writes. On this grid that resolves to Amount / Cadence /
// Day off `Rent / Mortgage` (Amount 1450, Cadence "monthly", Day 1), and
// deliberately NOT `Next Due`, which `Bills: Next Due` computes — that is a
// `display` binding, and display is exactly what an operation owns.
//
// Asking for a value an op is about to overwrite trains people to fill in a box
// that does not matter — the inert-control class this repo keeps paying for.
//
// ── IT NEVER OVERWRITES A CHOICE ───────────────────────────────────────────
//
// Only `meta.optionsSource.addNew.fieldIds`, and only where that list is absent
// or empty. A dropdown someone has already configured is LEFT ALONE, so a
// re-run converges and no selector here can undo a deliberate setting.
import mongoose from "mongoose";
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0286-add-new-asks-for-the-fields-that-matter";
export const description =
  "Money dropdowns' + Add new prompts for the fields a new row cannot work without.";
export const touches = ["fields", "modules", "occurrences", "operations"];

// The dropdowns a bare label makes useless. Named by FIELD NAME + TYPE because
// this grid carries duplicate field names (2026-08-24), and refusing on an
// ambiguous match rather than guessing.
const TARGETS = ["Bill", "Subscription"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const ops = await Operation.find({ gridId: gid, enabled: { $ne: false } }).lean();

  // WHICH FIELDS ARE A HUMAN'S TO FILL IS THE GRID'S OWN DECLARATION, not a
  // guess: a binding's `role`. "display" is what an operation writes; anything
  // else is an input someone types.
  //
  // The first version of this derived it from "does any pipeline mention this
  // field id", and that was WRONG in the one way that mattered — `Monthly
  // Bills` READS `Amount` to sum it, so the dry run proposed asking for
  // Cadence / Every N Days / Anchor Date and NOT the amount. Referencing a
  // field is not writing it, and a prompt list missing the amount is worse
  // than no prompt at all.

  // Reverse listing map — `_ancestors` is the occurrences[] tree, not parentId
  // (a board's sections carry no parentId), so scope has to walk the listings.
  const parentOf = new Map();
  for (const o of occs) for (const c of (o.occurrences || [])) if (!parentOf.has(c)) parentOf.set(c, o.id);
  const hasAncestor = (id, anc) => {
    for (let cur = id, i = 0; cur && i < 12; i++, cur = parentOf.get(cur) || occById[cur]?.parentId) {
      if (cur === anc) return true;
    }
    return false;
  };

  let planned = 0;
  for (const name of TARGETS) {
    const matches = fields.filter((f) => f.name === name && f.type === "occurrence");
    if (matches.length !== 1) { log(`  ${name}: ${matches.length} fields match — REFUSING (ambiguous)`); continue; }
    const field = matches[0];
    const src = field.meta?.optionsSource || {};
    const addNew = src.addNew;
    if (!addNew) { log(`  ${name}: no addNew config — skipped`); continue; }
    if ((addNew.fieldIds || []).length) { log(`  ${name}: already prompts for ${addNew.fieldIds.length} field(s) — left alone`); continue; }

    // The dropdown's own scope, off its own predicate.
    const anc = (src.predicate?.rules || []).find((r) => r.comparator === "HAS_ANCESTOR")?.right;
    if (!anc) { log(`  ${name}: predicate names no ancestor scope — REFUSING`); continue; }

    // WHAT TO ASK FOR IS WHAT THE EXISTING ROWS AGREE ON, not what one row
    // happens to carry. Reading the single most-filled row gave `Bill` the
    // shape of `Car Insurance` — Every N Days + Anchor Date — where
    // `Rent / Mortgage` would have taught it `Day`. A field the population
    // mostly fills in is one a new row needs; one row's habits are not.
    const inScope = occs.filter((o) => hasAncestor(o.id, anc));
    if (!inScope.length) { log(`  ${name}: no in-scope rows to learn from — REFUSING`); continue; }

    const filled = new Map();
    for (const o of inScope) {
      const om = modById[o.moduleId];
      for (const [fid, v] of Object.entries(o.fields || {})) {
        if (!byId[fid]) continue;
        if (v?.value === null || v?.value === undefined || v?.value === "") continue;
        // `display` is what an operation writes; anything else a human types.
        if (!(om?.fieldBindings || []).some((b) => b.fieldId === fid && b.role !== "display")) continue;
        filled.set(fid, (filled.get(fid) || 0) + 1);
      }
    }
    const need = Math.max(2, Math.ceil(inScope.length / 2));
    const ask = [...filled.entries()].filter(([, n]) => n >= need)
      .sort((a, b) => b[1] - a[1]).map(([fid]) => fid);

    log(`  ${name}: ${inScope.length} rows in scope, majority=${need} -> prompt for [${ask.map((f) => byId[f].name).join(", ") || "(nothing)"}]`);
    log(`      counts: ${[...filled.entries()].sort((a,b)=>b[1]-a[1]).map(([f,n])=>`${byId[f].name} ${n}`).join(", ")}`);
    if (!ask.length) { log(`    nothing to ask for — REFUSING rather than writing an empty list`); continue; }
    planned++;
    if (apply) {
      await Field.updateOne({ id: field.id, gridId: gid },
        { $set: { "meta.optionsSource.addNew.fieldIds": ask } });
    }
  }

  if (!apply) { log(`  DRY RUN — ${planned} dropdown(s) would be updated. Pass --apply to write.`); return; }
  log(`  wrote fieldIds on ${planned} dropdown(s).`);
}
