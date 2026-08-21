/**
 * 0180 — RETRACTS `0179`. `Tasks › Completed` is a materialized FEED, not a folder.
 *
 * ── THE PREMISE OF `0179` WAS WRONG, AND ONE READ WOULD HAVE CAUGHT IT ───────────────────────
 *
 * `0179` built an operation to MOVE completed tasks into `Tasks › Completed`. That container
 * carries a `feed` — `0060`'s predicate, scoped to the Tasks page:
 *
 *     Completed IS true   OR   ( Date DATE_BEFORE $today  AND  Time Slot IS_NOT_EMPTY )
 *
 * So the mechanism the user asked for **already existed**, and `0179` built a second one beside it.
 * I never read the destination's own configuration before writing an op that targets it. That is
 * the "measure before building — the premise may be stale" rule, violated at the one step where it
 * was cheapest to obey.
 *
 * ── WHAT IT ACTUALLY DID, AND HOW THE DAMAGE SURFACED ───────────────────────────────────────
 *
 * A feed container's children are COPIES carrying `meta.feedSourceId`, minted and swept by
 * `feedSync`. `0179` moved three ORIGINALS in — out of `Emotional` and `Financial`, where they
 * belong and where the user put them. On the next grid load the feed re-evaluated and swept the
 * copy of `Psych appointment with Angela` (`1786537342785-bwwheepag`), because its source was now a
 * direct child of the very container the copy was standing in for.
 *
 * That sweep was the FEED ENGINE WORKING, not a fault — but it is what made the mistake visible,
 * and reading a container's child list back out of Mongo twenty minutes apart is the only reason it
 * was noticed at all. **Nothing was lost:** the copy is derived, the source is intact, and this
 * migration puts all three sources back exactly where the pre-`0179` snapshot has them.
 *
 * ── THE REAL DEFECT IS THE FEED'S REACH, AND IT IS DELIBERATELY NOT FIXED HERE ───────────────
 *
 * Measured before `0179` ran: three tasks under the Tasks page carried `Completed IS true`, and the
 * feed had materialized exactly ONE of them. The two it missed — `Talk to Angela about Vivance` and
 * `Sign up for foodstamps` — are both ALSO listed by a day column's `Todo`, and the feed's `scope`
 * is an ancestor test resolved through `buildParentMap`, which keys child → ONE parent, **last
 * writer wins**. So a task that is also on the schedule falls out of Tasks-page scope arbitrarily.
 *
 * That is the thing worth fixing, and it is a change to a shared resolver on the render path, so it
 * gets its own measured pass rather than being bolted onto a retraction.
 *
 * ── IT REPAIRS FORWARD RATHER THAN EDITING `0179` ───────────────────────────────────────────
 *
 * `0179` has executed and its ledger entry has to describe what ran (the 2026-08-07 (4) rule).
 * Migrations run in order, so a grid seeing neither gets the mistake and the repair back to back and
 * converges. The operation it created is DELETED by name; the three rows are restored to the parent
 * and the list POSITION the snapshot records, and `meta.filedFrom` — which only `0179` wrote — is
 * unset.
 *
 * The `0178` repair is NOT retracted: `parentId` disagreeing with the only container that lists a
 * row is a defect on its own terms, whatever is done about filing.
 *
 * The three comparator fixes and the two `applyEffectsToLiveOccs` fixes that shipped alongside
 * `0179` are NOT retracted either. They are independent live defects — `DATE_BEFORE_TODAY` read
 * today as past west of UTC (which `Compute Next Due` was silently paying for), and the overlay
 * diverged from the persisting handler on moves and on every `meta.*` write.
 */
export const id = "0180-retract-0179-completed-is-a-feed";
export const describe =
  "Retract 0179: put the three tasks back in Emotional/Financial, unset meta.filedFrom, and DELETE " +
  "the `Tasks: File Completed` operation. `Tasks › Completed` is a feed and already does this job.";

const OP_NAME = "Tasks: File Completed";
const DONE = "c54c2971-31f7-4ba9-b648-a64c79f2149d";

// Exactly what the pre-0179 snapshot records, including list POSITION — a
// restore that appends is not a restore.
const RESTORE = [
  { id: "1a53289c-12b6-48fc-bb3e-e8f85c803998", parent: "Fttd1PJImVWp", index: 0 },
  { id: "8c6a3fc7-1de4-4e3c-a6c9-a5e06c3c4e7c", parent: "Fttd1PJImVWp", index: 2 },
  { id: "s0usbrgbck",                            parent: "qx_3apQ6_NfT", index: 0 },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Operation } = models;

  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  log(`  operation "${OP_NAME}": ${op ? "present — deleting" : "absent (already retracted)"}`);

  const moves = [];
  for (const r of RESTORE) {
    const occ = (await Occurrence.find({ gridId, id: r.id }).lean())[0];
    if (!occ) { log(`    MISSING ${r.id} — skipping`); continue; }
    if (occ.parentId === r.parent) { log(`    ok      ${r.id} already under ${r.parent}`); continue; }
    moves.push({ ...r, occ });
    log(`    RESTORE ${r.id}  ${occ.parentId} -> ${r.parent} @${r.index}`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const m of moves) {
    // Unlist from wherever 0179 put it, restore parentId, drop the marker it wrote.
    await Occurrence.updateOne({ gridId, id: DONE }, { $pull: { occurrences: m.id } });
    await Occurrence.updateOne({ gridId, id: m.id },
      { $set: { parentId: m.parent }, $unset: { "meta.filedFrom": "" } });
    // Re-list at the recorded position, and only if absent — idempotent.
    const parent = (await Occurrence.find({ gridId, id: m.parent }).lean())[0];
    const list = (parent?.occurrences || []).filter((x) => x !== m.id);
    list.splice(Math.min(m.index, list.length), 0, m.id);
    await Occurrence.updateOne({ gridId, id: m.parent }, { $set: { occurrences: list } });
  }
  if (op) await Operation.deleteOne({ _id: op._id });

  log(`  restored ${moves.length} · operation ${op ? "deleted" : "already gone"} — RESTART pm2.`);
}
