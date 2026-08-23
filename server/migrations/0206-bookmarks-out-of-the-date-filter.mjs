// 0206 — every one of the 1,467 bookmarks was INVISIBLE, and nothing looked broken.
//
// `0199` imported each bookmark's Raindrop save-date into the field called
// `Date` — which is the field **the grid filter uses**. The grid filters
// `Date = today`, so a bookmark saved in 2021 matches on exactly one day of the
// year and is hidden on every other. Measured before writing anything:
//
//     bookmarks carrying a Date        1467
//     matching today                      0
//     hidden by the filter             1467      <- the whole board
//
// **AND THE FIELD IS HIDDEN ON THAT BOARD**, so it filtered invisibly: the
// grid-level `fieldVisibility` (2026-08-11) hides `Date` everywhere except
// Tasks, Trackers and Schedule. Nothing on screen said why the board was empty.
//
// Same class as 2026-08-19 (5), where 21 timeslots carried yesterday's date and
// the filter hid them — reached here from the import side rather than a template.
//
// ── WHY THE VALUE MOVES INSTEAD OF BEING CLEARED ───────────────────────────
//
// 2026-08-19 (5) CLEARED, because a slot's date was simply wrong. This one is
// RIGHT — it is when the user saved the link, it came out of their own export,
// and Raindrop shows it. What is wrong is the field it lives in. So it moves to
// `Saved`, a date field of its own, and `Date` is cleared.
//
// **Clearing the page's filter instead would not work, and the reason is
// documented**: a CLEARED date filter means "show nothing dated"
// (CLAUDE.md 2026-08-11), so the rows would still be hidden. The value has to
// leave `Date`.
//
// ── SCOPED STRUCTURALLY ────────────────────────────────────────────────────
//
// `module.kind === "bookmark"` — what `0200` made a bookmark — never a label and
// never "everything on the Bookmarks board". A board is a placement; a row
// dragged onto it that is not a bookmark must keep its own date.
//
// REPAIRS FORWARD rather than editing `0199`: that migration has executed and
// its ledger entry has to describe what ran (2026-08-07 (4)). A grid that has
// seen neither gets the import and this repair back to back, and converges.
import { randomUUID as uid } from "crypto";

export const id = "0206-bookmarks-out-of-the-date-filter";
export const description =
  "Move each bookmark's save-date out of the grid's filter field `Date` into `Saved` — all 1,467 were hidden";

export const SAVED_FIELD_NAME = "Saved";

/**
 * What to do with one bookmark's field map.
 * PURE — the decision is "is the save-date sitting in the filter field", and it
 * has to be idempotent, because a half-run must be resumable.
 * @returns { set, unset } | null when there is nothing to do
 */
export function planFieldMove(fields, dateFid, savedFid) {
  const dateVal = fields?.[dateFid]?.value;
  if (dateVal == null || dateVal === "") return null;      // already moved, or never had one
  // Never overwrite a `Saved` the user has since set by hand.
  const existing = fields?.[savedFid]?.value;
  const keep = existing != null && existing !== "" ? existing : dateVal;
  return { set: { [savedFid]: { value: keep, flow: "in" } }, unset: [dateFid] };
}

/** Swap the Date binding for a Saved one, preserving order and everything else. */
export function planBindingSwap(bindings, dateFid, savedFid) {
  const list = Array.isArray(bindings) ? bindings : [];
  if (list.some((b) => b?.fieldId === savedFid)) return null;   // already swapped
  const i = list.findIndex((b) => b?.fieldId === dateFid);
  if (i === -1) return null;
  const next = list.slice();
  next[i] = { ...next[i], fieldId: savedFid };
  return next;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Grid } = models;
  // The runner hands over the grid, not the user — and `Field.userId` is
  // required, so a mint without it throws before anything is written.
  const userId = (await Grid.findById(gridId).lean())?.userId;

  const dateField = await Field.findOne({ gridId, name: "Date", type: "date" }).lean();
  if (!dateField) { log("  no `Date` field on this grid — nothing to move"); return { moved: 0 }; }

  let saved = await Field.findOne({ gridId, name: SAVED_FIELD_NAME, type: "date" }).lean();
  if (!saved) {
    saved = { id: uid(), userId, gridId, name: SAVED_FIELD_NAME, type: "date",
              meta: { note: "When a bookmark was saved. Deliberately NOT the grid's `Date` field, which the filter uses." } };
    log(`  minting field \`${SAVED_FIELD_NAME}\``);
    if (!dryRun) await Field.create(saved);
  }

  // STRUCTURAL: what `0200` made a bookmark, not what sits on the board.
  const mods = await Module.find({ gridId, kind: "bookmark" }).lean();
  const ids = mods.map((m) => m.id);
  const occs = await Occurrence.find({ gridId, moduleId: { $in: ids } }).lean();
  log(`  ${mods.length} bookmark modules, ${occs.length} occurrences`);

  const occOps = [], modOps = [];
  let moved = 0, already = 0;
  for (const o of occs) {
    const plan = planFieldMove(o.fields, dateField.id, saved.id);
    if (!plan) { already++; continue; }
    moved++;
    occOps.push({ updateOne: { filter: { id: o.id, gridId },
      update: { $set: Object.fromEntries(Object.entries(plan.set).map(([k, v]) => [`fields.${k}`, v])),
                $unset: Object.fromEntries(plan.unset.map((k) => [`fields.${k}`, ""])) } } });
  }
  for (const m of mods) {
    const next = planBindingSwap(m.fieldBindings, dateField.id, saved.id);
    if (!next) continue;
    modOps.push({ updateOne: { filter: { id: m.id, gridId }, update: { $set: { fieldBindings: next } } } });
  }

  log(`${dryRun ? "[dry run] " : ""}${moved} dates moved to \`Saved\` (${already} already done), ${modOps.length} bindings swapped`);
  if (!dryRun) {
    // One bulkWrite each rather than 2,934 round trips — the 2026-08-20 (4) lesson.
    if (occOps.length) await Occurrence.bulkWrite(occOps, { ordered: false });
    if (modOps.length) await Module.bulkWrite(modOps, { ordered: false });
  }
  return { moved, bindings: modOps.length };
}
