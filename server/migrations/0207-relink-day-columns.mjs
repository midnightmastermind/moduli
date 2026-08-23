// 0207 — the Day Page board does not list nine of the columns it parents.
//
// User, 2026-08-23, asked which past day columns belong back on the board:
// ***"Relink all of them."***
//
// Nine columns (Jul 28 – Aug 5, plus Saturday Aug 22) carry `parentId` naming the
// board and are absent from its `occurrences[]`, so they render nowhere. Beyond
// being unreachable, an unlisted column is what lets `Day Page: Build` mint a
// SECOND column for that date — the duplicate-day-column bug 2026-08-07 (4)
// dated and closed.
//
// ── WHY THIS IS SCOPED TO ONE BOARD AND NOT THE GENERAL RULE ────────────────
//
// The general form — adopt any child a board parents but does not list — was
// written first, dry-run, and ABANDONED. It matches 28 children across five
// boards, and most of them are unlisted ON PURPOSE:
//
//   Ingredients   10   the seed's plain rows, unlisted by `0103` when it replaced
//                      them with the plan's unit-bearing ones. Relinking restores
//                      the old ingredients the user asked to have removed.
//   Grocery List   6   superseded 2026-07-29, same reason
//   Trackers       1   `Last Opened`, the hidden marker `Grid: Snap Filter To
//                      Today` reads — deliberately not rendered
//   Schedule       2   two `Journal` rows of unestablished provenance
//   Day Page       9   <- the only ones the user answered about
//
// *A selector matching "things that look unlinked" matches every deliberate
// unlink too.* The wider version was measured against a named expectation of 1
// and reported 265; the board-scoped version reports 28. Both are wrong, and only
// checking WHAT matched rather than how many said so.
//
// STRUCTURALLY SANITY-CHECKED, not merely resolved by label: the board is found by
// label and then REFUSED unless the children it already lists look like day
// columns — every one carrying a value in the grid's filter date field. A renamed
// or repurposed board fails closed instead of adopting whatever it parents.
//
// **$push WITH A $ne GUARD**, never a whole-array write: `0111` exists because a
// migration rewrote `occurrences[]` while a browser held a stale copy and the tab
// echoed its version back over the repair.
//
// ORDER DOES NOT MATTER, and it was checked: the board carries
// `sortChildrenByField: <date>` (2026-06-04), so `PageBoard` sorts its visible
// children by date and an appended column lands in its right place.

export const id = "0207-relink-day-columns";
export const description =
  "Relink the nine day columns the Day Page board parents but does not list — unreachable, and a duplicate waiting to be minted";

export const BOARD_LABEL = "Day Page";

/** Children a parent claims that do not claim it back. PURE. */
export function unlistedChildrenOf(parent, all) {
  const listed = new Set(parent?.occurrences || []);
  return all
    .filter((o) => o && o.id !== parent?.id && o.parentId === parent?.id && !listed.has(o.id))
    .map((o) => o.id);
}

/**
 * Does this look like the day-column board? Every child it ALREADY lists has to
 * carry a date. A board that fails this is not the one this migration means.
 */
export function looksLikeDayBoard(parent, byId, dateFieldId) {
  const listed = (parent?.occurrences || []).map((id) => byId.get(id)).filter(Boolean);
  if (listed.length < 3) return false;
  return listed.every((c) => {
    const v = c?.fields?.[dateFieldId]?.value;
    return v != null && v !== "";
  });
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const dateFieldId = Object.keys(grid?.activeFilterValues || {})[0];
  if (!dateFieldId) { log("  the grid filters on no field — cannot identify day columns"); return { relinked: 0 }; }

  const occs = await Occurrence.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId }, { id: 1, label: 1, role: 1, kind: 1 }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  const board = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && m?.kind === "board" && m?.label === BOARD_LABEL;
  });
  if (!board) { log(`  no page/board labelled "${BOARD_LABEL}" — nothing to do`); return { relinked: 0 }; }

  if (!looksLikeDayBoard(board, occById, dateFieldId)) {
    // Fails CLOSED. Adopting whatever a mis-identified board parents is exactly
    // the damage the wider version of this migration would have done.
    log(`  "${BOARD_LABEL}" does not look like a day-column board (its listed children are not all dated) — REFUSING`);
    return { relinked: 0, refused: true };
  }

  const missing = unlistedChildrenOf(board, occs);
  for (const id of missing) {
    const c = occById.get(id);
    log(`  adopt ${(modById.get(c?.moduleId)?.label || id).slice(0, 34).padEnd(36)} date=${c?.fields?.[dateFieldId]?.value || "(none)"}`);
  }
  if (!dryRun) {
    for (const childId of missing) {
      await Occurrence.updateOne(
        { id: board.id, gridId, occurrences: { $ne: childId } },
        { $push: { occurrences: childId } },
      );
    }
  }
  log(`${dryRun ? "[dry run] " : ""}${missing.length} day column(s) relinked (board now lists ${(board.occurrences || []).length + (dryRun ? 0 : missing.length)})`);
  return { relinked: missing.length };
}
