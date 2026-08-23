// 0208 — no bill could be marked PAID, so `Bills: Paid This Month` read 0 forever.
//
// User's original ask: *"monthly bills should be a monthly goal totalling the
// amount of bills vs what i paid so far."* The total half shipped; the paid half
// never could, because the tracker's predicate needs `Completed IS true` and
// **not one of the eleven bills binds `Completed` at all** — so there is no
// checkbox on a bill anywhere in the UI and the tile is structurally inert.
// User, 2026-08-23, asked directly: ***bind a checkbox to all 11 bills.***
//
// ── THE BINDING IS THE WHOLE FIX, and it has to be on the MODULE ───────────
//
// A field renders because the MODULE binds it; a value on the occurrence with no
// binding is invisible (2026-08-13 (6) — the ingredients had `Quantity` values
// and no control to type them into). So this writes `fieldBindings`, not fields.
//
// **APPENDED, never inserted.** Binding order is render order, and reordering
// seven existing pills on eleven live rows to gain one checkbox is a bigger
// change than the ask. The checkbox lands after the fields that are already
// there.
//
// STRUCTURAL, never a list of names: the bills are the grandchildren of the
// `Bills` page — its category containers' children — so a bill added to
// Utilities next month is covered by a re-run rather than by editing this file.
// Matching on eleven labels is how a migration goes stale the day after it runs.
//
// **The `Completed` field is resolved by name AND TYPE.** This grid has had
// duplicate field names before (`0053` records having to discriminate two fields
// called "Due"), and binding a text field named Completed would produce a
// checkbox-shaped control that stores a string the tracker never matches.
//
// REPORTED, NOT FIXED: the eleven amounts sum to **2220.97** while the tile's
// target is a frozen literal **2040.97** — a 180.00 gap, exactly Car Insurance.
// Deriving the target was offered and the user chose the checkbox alone, so the
// literal stands and the discrepancy is written down rather than quietly
// corrected.

export const id = "0208-bills-can-be-ticked";
export const description =
  "Bind `Completed` to all 11 bills — the tracker needs it and no bill had a checkbox";

export const BILLS_PAGE_LABEL = "Bills";

/** Append a binding unless the module already has one for that field. PURE. */
export function planBindingAppend(bindings, fieldId) {
  const list = Array.isArray(bindings) ? bindings : [];
  if (list.some((b) => b?.fieldId === fieldId)) return null;      // already bound
  const maxOrder = list.reduce((m, b) => Math.max(m, Number(b?.order) || 0), -1);
  return [...list, { fieldId, order: maxOrder + 1, role: "input", hidden: false }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;

  const completed = await Field.findOne({ gridId, name: "Completed", type: "boolean" }).lean();
  if (!completed) { log("  no boolean field named `Completed` — REFUSING"); return { bound: 0, refused: true }; }

  const occs = await Occurrence.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  const page = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && m?.label === BILLS_PAGE_LABEL;
  });
  if (!page) { log(`  no page labelled "${BILLS_PAGE_LABEL}" — nothing to do`); return { bound: 0 }; }

  // grandchildren: the category containers' own children
  const bills = [];
  for (const catId of page.occurrences || []) {
    for (const billId of occById.get(catId)?.occurrences || []) {
      const b = occById.get(billId);
      if (b) bills.push({ occ: b, category: modById.get(occById.get(catId)?.moduleId)?.label });
    }
  }
  log(`  ${bills.length} bill(s) under "${BILLS_PAGE_LABEL}"`);

  const ops = [];
  let already = 0;
  for (const { occ, category } of bills) {
    const mod = modById.get(occ.moduleId);
    if (!mod) continue;
    const next = planBindingAppend(mod.fieldBindings, completed.id);
    if (!next) { already++; continue; }
    log(`    ${(mod.label || "?").slice(0, 24).padEnd(26)} (${category})  ${(mod.fieldBindings || []).length} -> ${next.length} bindings`);
    ops.push({ updateOne: { filter: { id: mod.id, gridId }, update: { $set: { fieldBindings: next } } } });
  }

  log(`${dryRun ? "[dry run] " : ""}${ops.length} bill(s) gain a Completed checkbox${already ? `, ${already} already had one` : ""}`);
  if (!dryRun && ops.length) await Module.bulkWrite(ops, { ordered: false });
  return { bound: ops.length, already };
}
