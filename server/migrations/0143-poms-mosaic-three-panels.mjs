/**
 * 0143 — poms grid becomes the 2x2 mosaic: Routines, Trackers, Schedule.
 *
 * USER, 2026-08-19: *"top left should be routines, bottom left should be
 * trackers, right should be schedule."* Then, asked what happens to the two
 * panels with no slot: **close them**; and asked how the right pane reaches the
 * Schedule: **re-point the panel that is already there**.
 *
 *     +-------------+-------------+
 *     |  Routines   |             |
 *     +-------------+  SCHEDULE   |   <- spans both rows
 *     |  Trackers   |             |
 *     +-------------+-------------+
 *
 * MEASURED FIRST, AND THE CENSUS MADE THIS SMALLER THAN THE PLAN.  poms grid is
 * already mosaic (`meta.layoutTree`), 2x3, five panels:
 *
 *     A  YGVS8DQ_vphC  Routines     r0 c0
 *     B  CMjTDM0Bja3O  Tasks        r1 c0
 *     C  rkN14S6dVkeG  Day Page     r0 c1, spans 2 rows
 *     D  78gtKMbXSiuP  Trackers     r0 c2
 *     E  bIk31RnE-giv  Ingredients  r1 c2
 *
 * **Panel C ALREADY CARRIES THE SCHEDULE AS A TAB** (`llpF10Bda5nu`), so
 * "no panel shows the Schedule" is true of what is ACTIVE, not of what is
 * pinned. Re-pointing it is one field on its View — no page is moved, no panel
 * is minted, and the Day Page stays on C as a tab. The handoff note assumed
 * this would need a new panel; reading the panel's own tab list is what said
 * otherwise.
 *
 * CLOSING A PANEL MUST NOT CLOSE A PAGE, and that is checked rather than
 * assumed. A panel LISTS pages in `occurrences[]`; it does not own them. Every
 * tab on B and E is parented to a FOLDER:
 *
 *     Panel B   Tasks   parentId=HN6TJ5MlVux6
 *     Panel E   Boards  parentId=cWmQGvVKp8rv
 *               Food    parentId=uv8i-r_T7ZmA
 *
 * so all three survive in the tree. The migration RE-VERIFIES this at run time
 * and REFUSES if any tab is parented to the panel being closed — deleting a
 * page the user asked to keep is the one outcome this must not have.
 *
 * THE MODULE AND THE VIEW GO WITH THE OCCURRENCE. Deleting an occurrence never
 * removes its module (2026-08-19), and a panel module has exactly one
 * occurrence — verified here before the delete, so a shared module can never be
 * swept by this.
 *
 * THE RATIOS ARE PRESERVED, NOT INVENTED. The user specified an arrangement and
 * said nothing about proportions. The left column keeps the split they
 * themselves dragged for it (1.283 / 0.717, Routines over what was Tasks), and
 * the left-vs-right widths keep the values those two panes already had
 * (0.743 / 0.799). Only the bottom-left OCCUPANT changes. Every splitter is
 * still draggable, so a number I guessed would have been a number they had to
 * undo.
 *
 * `removeLeaf` IS NOT ENOUGH, and that is why the tree is authored rather than
 * derived. Dropping B and E from the existing tree collapses both single-child
 * splits and leaves THREE columns side by side — Trackers stays on the right.
 * The target moves Trackers into the left column, which is a re-parent, not a
 * removal.
 *
 * PLACEMENTS ARE UPDATED ALONGSIDE THE TREE. `meta.layoutTree` is the DESKTOP
 * arrangement; `MosaicMobileNav` derives its rows x cols from each panel's own
 * `occurrence.placement` (2026-07-14). Writing only the tree would leave the
 * phone navigating a 2x3 space with two dead cells.
 *
 * AFTER APPLYING: restart pm2 AND reload the tab. The warm cache is
 * authoritative for reads, and a connected client holding the old
 * `grid.occurrences` can echo it back over this write — the self-restoring
 * class recorded on 2026-07-29 and paid for again on 2026-08-13 (2).
 */
export const id = "0143-poms-mosaic-three-panels";
export const describe = "poms grid -> 2x2 mosaic: Routines top-left, Trackers bottom-left, Schedule spanning the right.";

const ROUTINES_PANEL = "YGVS8DQ_vphC";   // A — keeps r0 c0
const TRACKERS_PANEL = "78gtKMbXSiuP";   // D — moves to r1 c0
const SCHEDULE_PANEL = "rkN14S6dVkeG";   // C — stays r0 c1 h2, re-pointed
const CLOSING        = ["CMjTDM0Bja3O", "bIk31RnE-giv"];  // B (Tasks), E (Ingredients)

const SCHEDULE_PAGE_OCC = "llpF10Bda5nu";  // already a tab on C

// The ratios the user dragged, carried across unchanged. See the header.
const COL_RATIO  = [0.7426585379485251, 0.7986035734376491];  // left column : Schedule
const LEFT_RATIO = [1.2831257078142695, 0.7168742921857305];  // Routines : Trackers

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, View, Grid } = models;

  const occs = await Occurrence.find({ gridId }).lean();
  const mods = await Module.find({ gridId }).lean();
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "?";

  // ---- the panels this migration names must all exist ---------------------
  const keep = [ROUTINES_PANEL, TRACKERS_PANEL, SCHEDULE_PANEL];
  for (const pid of [...keep, ...CLOSING]) {
    if (!byId.get(pid)) { log(`  REFUSING: panel occurrence ${pid} is not on this grid`); return; }
  }
  if (!byId.get(SCHEDULE_PAGE_OCC)) {
    log(`  REFUSING: the Schedule page ${SCHEDULE_PAGE_OCC} is not on this grid`);
    return;
  }

  // ---- IDEMPOTENCE: already converged? ------------------------------------
  const gridOccs = grid.occurrences || [];
  const already =
    gridOccs.length === 3 && keep.every(id => gridOccs.includes(id)) &&
    grid.rows === 2 && grid.cols === 2;
  if (already) { log("  already a 2x2 with these three panels — nothing to do"); return; }

  log(`  before: ${gridOccs.length} panels, ${grid.rows}x${grid.cols}`);
  for (const pid of gridOccs) {
    const p = byId.get(pid);
    log(`     ${labelOf(p)} (${pid})  placement=${JSON.stringify(p?.placement)}`);
  }

  // ---- THE GUARD: closing a panel must not close a page --------------------
  // A panel LISTS pages; it does not own them. A tab parented to the panel
  // itself would be orphaned by the delete, and that is a page the user said to
  // keep. Fail closed.
  const doomed = [];
  for (const pid of CLOSING) {
    const p = byId.get(pid);
    const owned = (p.occurrences || []).filter(cid => byId.get(cid)?.parentId === pid);
    if (owned.length) {
      log(`  REFUSING: ${labelOf(p)} (${pid}) is the PARENT of ${owned.length} tab(s) — ` +
          `closing it would orphan ${owned.map(id => labelOf(byId.get(id))).join(", ")}`);
      return;
    }
    const tabs = (p.occurrences || []).map(cid => labelOf(byId.get(cid)));
    log(`  closing ${labelOf(p)} (${pid}) — ${tabs.length} tab(s) stay in the tree: ${tabs.join(", ") || "(none)"}`);

    // The module goes too, but only if this occurrence is its only placement.
    const shares = occs.filter(o => o.moduleId === p.moduleId).length;
    if (shares !== 1) {
      log(`  REFUSING: module ${p.moduleId} has ${shares} occurrences — not a panel module, not sweeping it`);
      return;
    }
    doomed.push({ occId: pid, moduleId: p.moduleId, viewId: p.viewId, label: labelOf(p) });
  }

  // ---- the target tree, authored rather than derived -----------------------
  const layoutTree = {
    id: "mosaic-root",
    dir: "v",
    ratio: COL_RATIO,
    children: [
      {
        id: "mosaic-col0",
        dir: "h",
        ratio: LEFT_RATIO,
        children: [
          { id: "mosaic-leaf-routines", panelOccId: ROUTINES_PANEL },
          { id: "mosaic-leaf-trackers", panelOccId: TRACKERS_PANEL },
        ],
      },
      { id: "mosaic-leaf-schedule", panelOccId: SCHEDULE_PANEL },
    ],
  };

  const placements = {
    [ROUTINES_PANEL]: { row: 0, col: 0, width: 1, height: 1 },
    [TRACKERS_PANEL]: { row: 1, col: 0, width: 1, height: 1 },
    [SCHEDULE_PANEL]: { row: 0, col: 1, width: 1, height: 2 },
  };

  // ---- the Schedule pane ---------------------------------------------------
  const sched = byId.get(SCHEDULE_PANEL);
  const view = sched.viewId ? await View.findOne({ id: sched.viewId }).lean() : null;
  if (!view) { log(`  REFUSING: panel ${SCHEDULE_PANEL} has no View to re-point`); return; }
  const wasActive = view.activeOccurrenceId;
  if (!(sched.occurrences || []).includes(SCHEDULE_PAGE_OCC)) {
    log(`  REFUSING: the Schedule page is not a tab on ${SCHEDULE_PANEL} — re-pointing would show a page it does not carry`);
    return;
  }
  log(`  re-pointing ${labelOf(sched)}: active page "${labelOf(byId.get(wasActive))}" -> "${labelOf(byId.get(SCHEDULE_PAGE_OCC))}"`);

  log(`  after: 3 panels, 2x2 · Routines r0c0 · Trackers r1c0 · Schedule r0c1 h2`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // ---- write ---------------------------------------------------------------
  for (const [occId, placement] of Object.entries(placements)) {
    await Occurrence.updateOne({ id: occId, gridId }, { $set: { placement } });
  }
  await View.updateOne({ id: sched.viewId }, { $set: { activeOccurrenceId: SCHEDULE_PAGE_OCC } });
  await Grid.updateOne(
    { _id: grid._id },
    { $set: { rows: 2, cols: 2, occurrences: keep, "meta.layoutTree": layoutTree } },
  );
  for (const d of doomed) {
    await Occurrence.deleteOne({ id: d.occId, gridId });
    await Module.deleteOne({ id: d.moduleId, gridId });
    if (d.viewId) await View.deleteOne({ id: d.viewId });
    log(`  removed ${d.label}: occurrence + module${d.viewId ? " + view" : ""}`);
  }
  log("  done — RESTART pm2 AND RELOAD THE TAB before believing this stuck (see header)");
}
