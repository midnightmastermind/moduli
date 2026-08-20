/**
 * 0163 — the Medications board had no PAGE, so nothing could reach it.
 *
 * FOUND BY LOOKING, which is the whole reason to look. `0158` read back clean — the board holds all
 * four medications, the dropdown resolves them and excludes feed copies, and every one of those
 * claims is still true. It is also **unreachable**: opening the grid in a browser and searching for
 * "Medications" surfaces the board and the four rows in the index, and clicking through lands
 * somewhere else, because there is no page to land on.
 *
 * THE BUG IN `0158`, exactly: it minted the board container with `parentId: supBoard.parentId`,
 * commented "the same folder the other boards live in". **A board CONTAINER is not in a folder.**
 * Supplements is a pair — a `page/board` homed in `Root/Boards/Food` whose `occurrences[]` LISTS a
 * `container/board` whose own `parentId` is null. Copying the container's parent copied null, and
 * the page half was never minted at all. So the board was born listed by nobody, parented to
 * nothing: the created-but-unlinked class this repo has repaired from six directions, reached from
 * a seventh — and the first one where the data was perfect and only the ROUTE to it was missing.
 *
 * THE DEFECT TEST IS STRUCTURAL AND IT IS A TRUE ANOMALY DETECTOR, measured before it was written:
 * of **36** feed-backed board containers on poms grid, **35** are listed by a page and exactly
 * **1** — Medications, timestamped to `0158`'s own run this morning — is not. So "a feed-backed
 * board container that no occurrence lists" names this defect and nothing else on the grid. A rule
 * that fired on a third of the boards would be noise; this one fires on the broken one.
 *
 * IT IS NOT FOLDED BACK INTO `0158`, deliberately. That migration has already executed against poms
 * grid and its ledger entry has to describe what actually ran — the 2026-08-07 (4) rule. Migrations
 * run in order, so a grid that has never seen either runs `0158`, gets the orphan, and runs this one
 * immediately after and converges to the same place. Repairing forward costs one file and keeps the
 * record honest; editing history would save the file and make the ledger a lie.
 *
 * THE FOLDER IS `Root/Boards/Food`, WHICH IS WHERE `0158` SAID IT WAS PUTTING IT — "homed beside
 * Supplements". That folder is not really "food": it holds Ingredients, Grocery List, Meals,
 * Beverages and Supplements, i.e. the things you consume, and a supplement is no more a food than a
 * medication is. This board was built as Supplements' twin — same three-part shape, same
 * multi-select dropdown, same routine — so it lands beside its twin, restoring the placement the
 * original migration intended and failed to write. It is one drag from anywhere else if the user
 * would rather have it under Body.
 *
 * THE PAGE IS COPIED FROM THE SUPPLEMENTS PAGE at run time rather than restated, for the reason
 * `0158`'s own header gives: a board folder that has since been renamed or re-homed carries this one
 * with it. Nothing here hardcodes a folder id, a sortOrder or a page shape.
 *
 * REFUSES rather than guesses: if the exemplar page is missing, or does not list the exemplar board,
 * the shape this migration is copying is not the shape that is there, and it stops.
 */
export const id = "0163-medications-board-needs-a-page";
export const describe = "Gives the orphaned Medications board a page in Root/Boards/Food beside Supplements, so it can be opened. Creates one module and one occurrence; deletes nothing.";

const ORPHAN = "Medications";
const EXEMPLAR = "Supplements";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map(m => [m.id, m]));
  const lbl = (o) => o.label || mById.get(o.moduleId)?.label || "";
  const roleKind = (o) => { const m = mById.get(o.moduleId); return `${m?.role}/${m?.kind}`; };

  // Every id that some occurrence lists as a child. A board is REACHABLE when a page lists it —
  // PageBoard renders `occurrence.occurrences`, not a parentId index, which is why Supplements
  // works with a null parentId and Medications does not work at all.
  const listed = new Set();
  for (const o of occs) for (const c of o.occurrences || []) listed.add(c);

  const boards = occs.filter(o => roleKind(o) === "container/board" && o.feed?.enabled);
  const orphans = boards.filter(o => !listed.has(o.id) && !o.parentId);
  log(`  feed-backed board containers: ${boards.length} · unreachable: ${orphans.length}` +
      (orphans.length ? ` (${orphans.map(lbl).join(", ")})` : ""));

  const target = orphans.find(o => lbl(o) === ORPHAN);
  if (!target) { log(`  "${ORPHAN}" is already reachable — nothing to do`); return; }

  // ---- the exemplar pair, resolved structurally --------------------------
  const exBoard = boards.find(o => lbl(o) === EXEMPLAR);
  const exPage = exBoard && occs.find(o => roleKind(o) === "page/board" &&
                                          (o.occurrences || []).includes(exBoard.id));
  if (!exBoard) { log(`  REFUSING: no "${EXEMPLAR}" board to copy`); return; }
  if (!exPage) { log(`  REFUSING: nothing lists the "${EXEMPLAR}" board, so its shape is not the shape being copied`); return; }
  const exMod = mById.get(exPage.moduleId);
  if (!exMod) { log(`  REFUSING: the "${EXEMPLAR}" page has no module`); return; }

  log(`  exemplar: "${EXEMPLAR}" page ${exPage.id} in folder ${exPage.parentId} (sortOrder ${exPage.sortOrder})`);
  log(`  would create: a "${ORPHAN}" page/board in that folder, listing board ${target.id} (${(target.occurrences || []).length} medications)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const modId = uid(), pageId = uid();

  await Module.create({ ...stripId(exMod), id: modId, label: ORPHAN });
  await Occurrence.create({
    id: pageId,
    userId: target.userId,
    gridId,
    moduleId: modId,
    parentId: exPage.parentId,                       // the FOLDER — what homes a page in the tree
    occurrences: [target.id],                        // what makes the board render
    filterOverride: exPage.filterOverride ?? {},
    filterNavConfig: exPage.filterNavConfig ?? {},
    fields: {},
    sortOrder: (exPage.sortOrder ?? 0) + 1,
  });
  log(`  created the "${ORPHAN}" page (${pageId}) beside "${EXEMPLAR}", listing the board`);
  log("  done — RESTART pm2 and reload.");
}

// Mongo's own `_id` must never be carried onto a copy, and neither must the subdocument `_id`s
// inside fieldBindings — reusing one is a duplicate key.
function stripId(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  if (Array.isArray(rest.fieldBindings)) {
    rest.fieldBindings = rest.fieldBindings.map(({ _id: _drop, ...b }) => b);
  }
  return rest;
}
