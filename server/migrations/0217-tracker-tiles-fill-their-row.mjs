// 0217 — the tracker tiles leave 56px of every row empty.
//
// User, 2026-08-11 and again 2026-08-23: *"make the tracker occurances a bit
// wider."*
//
// ── TWO OF THE THREE ASKS IN THAT MESSAGE WERE ALREADY DONE, measured on the
// live page before changing anything ────────────────────────────────────────
//
//   "the drag handle and the title should be on top of fields"
//        ALREADY TRUE. `handleTop === labelTop === 874` and `fieldTop === 896`,
//        with `.instance-content` at `flex/column` — handle and title share a
//        line and that line sits above the fields. Shipped 2026-08-11.
//   "let the containers extend full width"
//        ALREADY TRUE. Every tracker container measures the full inner width of
//        its panel (576px); they are not the thing constraining the tiles.
//
// So only the width is outstanding, and it is arithmetic rather than taste:
//
//     container inner width               576px
//     3 tiles at 168 + 2 gaps of 8        520px   -> 56px of slack, every row
//     3 tiles at 184 + 2 gaps of 8        568px   -> fills it, still 3 columns
//
// 184 is the widest value that KEEPS THE THREE-COLUMN GRID. 200 would fit only
// two per row and waste more space than it gained, which is the opposite of the
// ask.
//
// **IT IS A CASCADE KEY, NOT A STYLESHEET NUMBER.** `childMinWidth` feeds
// `--child-w`, which `.container-items--wrap > .instance-wrap` reads — and the
// Layout menu already edits it, so this is a starting value the user can change
// without a migration. That is why the whole change is one number in data and no
// CSS moves.
//
// SCOPED to occurrences under the Trackers page that already carry the OLD
// value: a container someone has since tuned by hand keeps its own number.

export const id = "0217-tracker-tiles-fill-their-row";
export const description =
  "Tracker tiles were 168px in a 576px row, leaving 56px empty — 184 fills it and keeps three columns";

export const OLD_WIDTH = 168;
export const NEW_WIDTH = 184;
export const PAGE_LABEL = "Trackers";

/** Should this occurrence's cascade be bumped? PURE. */
export function planWidthBump(occ, { from = OLD_WIDTH, to = NEW_WIDTH } = {}) {
  const lc = occ?.meta?.layoutCascade;
  if (!lc || typeof lc !== "object") return null;
  // Only the exact old value. A container tuned by hand keeps its own number —
  // "every X" in a migration is how a deliberate choice gets overwritten.
  if (lc.childMinWidth !== from) return null;
  return { ...lc, childMinWidth: to };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const occs = await Occurrence.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId }, { id: 1, label: 1, role: 1 }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  const page = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && m?.label === PAGE_LABEL;
  });
  if (!page) { log(`  no page labelled "${PAGE_LABEL}"`); return { bumped: 0 }; }

  // The page, its direct children, AND their nested groups.
  //
  // The first run covered only the page and its direct children, and rendering
  // it showed why that was wrong: `Today's Workout` and the other three nested
  // groups kept `childW: 168px` while their siblings moved to 184, so the page
  // had two tile sizes on it. A nested group carries its OWN cascade rather than
  // inheriting the parent's, which is exactly the thing that made the four
  // render differently in the first place (`0215`).
  const direct = (page.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
  const nested = direct.flatMap((c) => (c.occurrences || []).map((id) => occById.get(id)).filter(Boolean));
  const targets = [page, ...direct, ...nested];
  const ops = [];
  for (const occ of targets) {
    const next = planWidthBump(occ);
    if (!next) continue;
    const label = modById.get(occ.moduleId)?.label || occ.id;
    log(`    ${label.slice(0, 20).padEnd(22)} childMinWidth ${OLD_WIDTH} -> ${NEW_WIDTH}`);
    ops.push({ updateOne: { filter: { id: occ.id, gridId },
                            update: { $set: { "meta.layoutCascade": next } } } });
  }
  log(`${dryRun ? "[dry run] " : ""}${ops.length} surface(s) widened (of ${targets.length} considered)`);
  if (!dryRun && ops.length) await Occurrence.bulkWrite(ops, { ordered: false });
  return { bumped: ops.length };
}
