// 0335 — Completed moves off the Tasks page onto its own.
//
// User, 2026-09-17: *"could we put tasks completed in a separate page instead
// of on the tasks page. that way we dont have a bunch of duplicates on the page
// (through copylink)."*
//
// ── WHY IT READS AS DUPLICATES NOW ─────────────────────────────────────────
//
// `0334` removed the `hide-completed` local filters, so a ticked task stays in
// its own dimension container — which is what was asked for, and which is also
// what makes the Completed feed's copy a visible SECOND row on the same page.
// The feed was always minting that copy; until 0334 the original was hidden, so
// only one of the two was on screen at a time. Moving the container to its own
// page keeps the feed and puts its copies somewhere they are not sitting beside
// the originals.
//
// ── THE SCOPE IS WHAT MAKES THIS NON-OBVIOUS, and it is the whole risk ──────
//
//     feed.scope: "9zU5UYHq5FMn"   <- the TASKS page
//
// A feed's SCOPE (what it looks at) and its container's PARENT (where it lives)
// are independent. Re-pointing the scope at the new page would leave the feed
// looking at a page whose only instances are its OWN copies — and
// `resolveFeedItems` skips anything carrying `meta.feedSourceId`, so it would
// resolve to zero matches and sweep every copy it had. Completed would empty
// itself and look like data loss.
//
// So the container MOVES and the scope DOES NOT. There is an explicit
// post-write assertion for exactly that, because the failure is silent and
// only shows up on the next feed sync.
//
// ── NOTHING ELSE POINTS AT IT, measured before writing ──────────────────────
//
//     operations naming the Completed container   0
//     textmaps embedding it                       0
//     parents listing it                          1  (the Tasks page)
//
// That census is why this is a re-parent rather than a rebuild: there is no
// second reference to keep in step.
//
// The new page is homed in the same `Tasks` FOLDER and pinned to the same panel
// the Tasks page already lives on, so it is one tab away rather than only
// reachable through the tree. Unpinning it later is a single array edit.

const TASKS_PAGE = "9zU5UYHq5FMn";
const COMPLETED_CONTAINER = "c54c2971-31f7-4ba9-b648-a64c79f2149d";
const PAGE_LABEL = "Completed";

export const id = "0335-completed-gets-its-own-page";
export const description =
  "Move the Completed feed container off the Tasks page onto its own page, keeping the feed scoped to Tasks.";
export const touches = ["modules", "occurrences"];

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

/**
 * What the move consists of. PURE so the decision is testable without a DB.
 * Returns null when there is nothing to do (already moved) — a re-run then
 * writes nothing rather than minting a second page.
 */
export function planMove({ tasksPage, completed, existingPage }) {
  if (!tasksPage) throw new Error("Tasks page not found - refusing");
  if (!completed) throw new Error("Completed container not found - refusing");
  // The scope is the thing that must survive; if it is not what we measured,
  // the feed has been re-pointed since and this migration's reasoning no
  // longer describes it.
  if (completed.feed?.scope !== TASKS_PAGE) {
    throw new Error(`Completed feed scope is ${completed.feed?.scope}, expected the Tasks page - refusing`);
  }
  if (existingPage && completed.parentId === existingPage.id) return null; // converged
  return {
    reuseExistingPage: existingPage || null,
    unlistFrom: (tasksPage.occurrences || []).includes(COMPLETED_CONTAINER) ? tasksPage.id : null,
    folderId: tasksPage.parentId,
    sortOrder: (tasksPage.sortOrder ?? 0) + 1,
  };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);

  const tasksPage = await Occurrence.findOne({ id: TASKS_PAGE, gridId: gid }).lean();
  const completed = await Occurrence.findOne({ id: COMPLETED_CONTAINER, gridId: gid }).lean();

  // A page minted by an earlier (partial) run — found by label so a re-run
  // adopts it instead of minting a second one.
  const pageMods = await Module.find({ gridId: gid, role: "page", label: PAGE_LABEL }).lean();
  let existingPage = null;
  for (const m of pageMods) {
    const occ = await Occurrence.findOne({ moduleId: m.id, gridId: gid }).lean();
    if (occ) { existingPage = occ; break; }
  }

  const plan = planMove({ tasksPage, completed, existingPage });
  if (!plan) { log(`"${PAGE_LABEL}" page already holds the container - nothing to do`); return { changed: 0 }; }

  const tasksMod = await Module.findOne({ id: tasksPage.moduleId }).lean();
  log(`Tasks page "${tasksMod?.label}" [${tasksPage.id}] in folder ${plan.folderId}, ${tasksPage.occurrences.length} children`);
  log(`Completed container [${COMPLETED_CONTAINER}] parent=${completed.parentId}, ${completed.occurrences?.length || 0} feed copies`);
  log(`  feed scope stays: ${completed.feed.scope} (the Tasks page) - the feed keeps collecting from Tasks`);
  log(plan.reuseExistingPage
    ? `  reusing existing "${PAGE_LABEL}" page [${plan.reuseExistingPage.id}]`
    : `  minting a new "${PAGE_LABEL}" page (role:page kind:board) in the same folder`);
  const panels = await Occurrence.find({ gridId: gid, occurrences: TASKS_PAGE }).lean();
  log(`  pinning to ${panels.length} panel(s) that already show Tasks`);
  if (dryRun) { log("\n(dry run - pass --apply)"); return { changed: 0, planned: 1 }; }

  // ── 1. the page (module + occurrence), modelled on the Tasks page ─────────
  let pageOccId;
  if (plan.reuseExistingPage) {
    pageOccId = plan.reuseExistingPage.id;
  } else {
    const modId = uid();
    pageOccId = uid();
    await Module.create({
      id: modId, userId: tasksPage.userId, gridId: gid,
      role: "page", kind: "board", label: PAGE_LABEL,
      iteration: { mode: "inherit", timeFilter: "daily" },
      defaultDragMode: "move", styleMode: "inherit",
    });
    await Occurrence.create({
      id: pageOccId, userId: tasksPage.userId, gridId: gid, moduleId: modId,
      parentId: plan.folderId,
      occurrences: [],
      // `{}` = opt OUT of the date filter, exactly as the Tasks page does. A
      // completed-task archive filtered to today would be empty every morning.
      filterOverride: {},
      filterNavConfig: tasksPage.filterNavConfig || {},
      filters: [],
      sortOrder: plan.sortOrder,
    });
  }

  // ── 2. move the container (unlink from the old parent FIRST) ──────────────
  if (plan.unlistFrom) await Occurrence.updateOne({ id: plan.unlistFrom }, { $pull: { occurrences: COMPLETED_CONTAINER } });
  await Occurrence.updateOne({ id: COMPLETED_CONTAINER }, { $set: { parentId: pageOccId } });
  await Occurrence.updateOne({ id: pageOccId }, { $addToSet: { occurrences: COMPLETED_CONTAINER } });

  // ── 3. pin it beside Tasks on every panel that shows Tasks ────────────────
  for (const p of panels) await Occurrence.updateOne({ id: p.id }, { $addToSet: { occurrences: pageOccId } });

  // ── Read the RESULT back out of the database, not off the log ────────────
  const after = await Occurrence.findOne({ id: COMPLETED_CONTAINER }).lean();
  const page = await Occurrence.findOne({ id: pageOccId }).lean();
  const tasksAfter = await Occurrence.findOne({ id: TASKS_PAGE }).lean();

  if (after.feed?.scope !== TASKS_PAGE) throw new Error("the feed scope MOVED - it must stay on the Tasks page or the feed empties itself");
  if (after.parentId !== pageOccId) throw new Error("the container did not re-parent");
  if (!page.occurrences.includes(COMPLETED_CONTAINER)) throw new Error("the new page does not list the container");
  if (tasksAfter.occurrences.includes(COMPLETED_CONTAINER)) throw new Error("the Tasks page still lists the container");
  const listers = await Occurrence.find({ gridId: gid, occurrences: COMPLETED_CONTAINER }).lean();
  if (listers.length !== 1) throw new Error(`container listed by ${listers.length} parents, expected exactly 1`);
  if ((after.occurrences || []).length !== (completed.occurrences || []).length) {
    throw new Error("the feed copies changed during the move");
  }

  log(`\nmoved: "${PAGE_LABEL}" page [${pageOccId}] now holds the container (${after.occurrences.length} copies intact)`);
  log(`  Tasks page ${tasksPage.occurrences.length} -> ${tasksAfter.occurrences.length} children`);
  log(`  feed scope still the Tasks page: ${after.feed.scope}`);
  return { changed: 1, pageOccId };
}
