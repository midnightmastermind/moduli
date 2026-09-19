// 0342 — a check-in belongs under the Emotions Wheel, not in Tasks Completed.
//
// User, 2026-09-18: *"just put the checkins underneath the emotions wheel and
// not tasks completed."*
//
// ── WHAT THE DATA SAID, BEFORE ANY CODE CHANGED ───────────────────────────
//
// Measured on poms grid across all 24 Check In occurrences:
//
//     parentId points at        the DAY COLUMN, on all 24   (0 point at a board)
//     listed by                 the day column, on all 24
//     ALSO listed by Tasks Completed   5   (today's, from 0339 + 0341)
//
// So the check-ins were ALREADY under the wheel — the day column's textmap
// renders `Todo, Journal, Notes, Tasks Completed, Highlights, Emotions Wheel,
// Check In ×5`, i.e. directly beneath it. What the last two migrations added
// was a SECOND listing, so today's five rendered TWICE. This is a listing to
// remove, not a re-parent: nothing here touches `parentId`.
//
// ── THE MOOD OP: ONE STEP FILES THEM, AND `$placeParent` IS ALREADY DEAD ───
//
// `0339` re-pointed a `$doneBoard` lookup at `identitySignature IS
// "daypage:Tasks Completed"`, on the understanding that `$placeParent` decided
// where the Check In was PARENTED. Reading the stored pipeline says otherwise:
//
//     COPY_LINK  parent: "$col.id"        <- the column, hard-wired
//     ADD_CHILD  parentId: "$doneBoard.id"  <- the only Tasks Completed listing
//
// `$placeParent` is SET twice and READ NOWHERE — `0086` introduced it as the
// COPY_LINK's parent and something later hard-wired `$col.id` in its place.
// So the fix is the ADD_CHILD; the `$doneBoard` scan, the `$placeParent`
// branch and their two INIT_VARs are dead weight that ran a walk over every
// column child on every wheel click. All five go, and the migration REFUSES
// unless neither name survives — removing a variable something still reads is
// how a pipeline throws at run time instead of failing here.
//
// ── THE BUILD OP: REMOVE `0341`, AND THE SWEEP REPAIRS THE ROWS ────────────
//
// `0341` made `Day Page: Build Tasks Completed` spare a mood row from its
// sweep and re-list the day's mood rows on every load. Both go. Removing them
// means the container's EXISTING sweep — whose third clause is
// `_boundFieldIds ARRAY_NOT_INCLUDES <Habit>`, and a Check In binds Habit —
// takes today's five out on the next load.
//
// **THAT IS DELIBERATELY THE REPAIR PATH.** The alternative is writing
// `occurrences[]` on a live container, which is the warm-cache clobber this
// project has paid for repeatedly; the sweep is idempotent, already runs, and
// leaves the check-ins' own parentage untouched.
//
// ── ANCHORED ON SHAPE AND ON `0341`'S OWN IDS ─────────────────────────────
//
// The Mood op's steps are anchored on what they DO (an ADD_CHILD into
// `$doneBoard`, a SET_VAR of `$doneBoard`, a branch assigning `$placeParent`)
// rather than on generated ids. `0341`'s two edits are anchored on the ids it
// minted itself. Every anchor must match EXACTLY once or this throws — a
// pipeline patcher that quietly finds nothing leaves an operation that looks
// repaired and is not.

export const id = "0342-check-ins-live-under-the-emotions-wheel";
export const describe =
  "Mood check-ins stop being filed into Tasks Completed: the Mood op's ADD_CHILD (and its dead "
  + "$doneBoard/$placeParent machinery) and both of 0341's edits are removed. Pipelines only — no "
  + "occurrence is created, moved or deleted.";
export const touches = ["operations"];

const MOOD_OP = "Mood: Record Selection";
const TC_OP = "Day Page: Build Tasks Completed";
const MOOD_LOOP_ID = "moodRowsIntoTasksCompleted";

const cfgType = (step) => step?.actionType || step?.config?.type;
const isAction = (step, type) => step?.type === "action" && cfgType(step) === type;

/** Does this step (or anything nested in it) assign `name`? */
const assignsVar = (step, name) =>
  (isAction(step, "SET_VAR") || isAction(step, "INIT_VAR")) && step?.config?.name === name;

/**
 * PURE — the Mood op stops listing a Check In under Tasks Completed.
 *
 * Four shapes, each asserted to match exactly once:
 *   1. the IF wrapping `ADD_CHILD parentId: "$doneBoard.id"`   (the listing)
 *   2. the loop that SET_VARs `$doneBoard`                     (the scan)
 *   3. the IF/ELSE that assigns `$placeParent`                 (dead branch)
 *   4. the `$placeParent` and `$doneBoard` INIT_VARs           (dead vars)
 *
 * Idempotent: a pipeline that no longer mentions `$doneBoard` is returned
 * untouched with `changed: 0`.
 */
export function unfileFromTasksCompleted(pipeline) {
  const json = JSON.stringify(pipeline || {});
  if (!json.includes("$doneBoard") && !json.includes("$placeParent")) {
    return { pipeline, changed: 0, removed: {} };
  }

  const removed = { listing: 0, scan: 0, placeBranch: 0, initVars: 0 };

  // 1. The listing: an IF whose branches hold the ADD_CHILD into $doneBoard.
  const isListingIf = (step) => {
    if (step?.type !== "if") return false;
    const kids = [...(step.then || []), ...(step.else || [])];
    return kids.some((k) => isAction(k, "ADD_CHILD") && k?.config?.parentId === "$doneBoard.id");
  };

  // 2. The scan: a loop whose body (at any depth) sets $doneBoard.
  const setsDoneBoard = (steps) => (steps || []).some((s) =>
    assignsVar(s, "$doneBoard")
    || setsDoneBoard(s?.then) || setsDoneBoard(s?.else) || setsDoneBoard(s?.body));
  const isScanLoop = (step) => step?.type === "loop" && setsDoneBoard(step.body);

  // 3. The dead branch: an IF whose arms only ever assign $placeParent.
  const isPlaceBranch = (step) => {
    if (step?.type !== "if") return false;
    const kids = [...(step.then || []), ...(step.else || [])];
    return kids.length > 0 && kids.every((k) => assignsVar(k, "$placeParent"));
  };

  // 4. The dead INIT_VARs.
  const isDeadInit = (step) => isAction(step, "INIT_VAR")
    && (step?.config?.name === "$placeParent" || step?.config?.name === "$doneBoard");

  const walk = (steps) => (steps || []).flatMap((step) => {
    if (isListingIf(step)) { removed.listing++; return []; }
    if (isScanLoop(step)) { removed.scan++; return []; }
    if (isPlaceBranch(step)) { removed.placeBranch++; return []; }
    if (isDeadInit(step)) { removed.initVars++; return []; }
    if (step?.type === "if") return [{ ...step, then: walk(step.then), else: walk(step.else) }];
    if (step?.type === "loop") return [{ ...step, body: walk(step.body) }];
    return [step];
  });

  const steps = walk(pipeline?.steps || []);

  if (removed.listing !== 1) throw new Error(`0342: expected exactly 1 ADD_CHILD-into-$doneBoard IF, found ${removed.listing}`);
  if (removed.scan !== 1) throw new Error(`0342: expected exactly 1 $doneBoard scan loop, found ${removed.scan}`);
  if (removed.placeBranch !== 1) throw new Error(`0342: expected exactly 1 $placeParent branch, found ${removed.placeBranch}`);
  if (removed.initVars !== 2) throw new Error(`0342: expected 2 dead INIT_VARs, found ${removed.initVars}`);

  const next = { ...pipeline, steps };
  const after = JSON.stringify(next);
  // A surviving reference means something still READS one of these — removing
  // it would make the pipeline throw at run time instead of failing here.
  if (after.includes("$doneBoard")) throw new Error("0342: a $doneBoard reference survived — something still reads it");
  if (after.includes("$placeParent")) throw new Error("0342: a $placeParent reference survived — something still reads it");
  // The COPY_LINK must still parent the Check In to the day column.
  if (!after.includes('"parent":"$col.id"')) throw new Error("0342: the Check In no longer parents to the day column");

  return { pipeline: next, changed: 1, removed };
}

/**
 * PURE — `Day Page: Build Tasks Completed` stops sparing and re-listing moods.
 *
 * Anchored on the two ids `0341` minted: its re-add loop is dropped, and its
 * mood-sparing IF is UNWRAPPED back to the sweep it was wrapped around (never
 * deleted — that REMOVE_CHILD is the container's own sweep).
 */
export function stopRelistingMoodRows(pipeline) {
  const json = JSON.stringify(pipeline || {});
  if (!json.includes(MOOD_LOOP_ID)) return { pipeline, changed: 0, removed: {} };

  const removed = { relistLoop: 0, spareIf: 0 };

  const walk = (steps) => (steps || []).flatMap((step) => {
    if (step?.id === MOOD_LOOP_ID) { removed.relistLoop++; return []; }
    if (step?.id === `${MOOD_LOOP_ID}-spare`) {
      removed.spareIf++;
      // The sweep lived in the ELSE arm; the THEN was the "keep it" no-op.
      return walk(step.else);
    }
    if (step?.type === "if") return [{ ...step, then: walk(step.then), else: walk(step.else) }];
    if (step?.type === "loop") return [{ ...step, body: walk(step.body) }];
    return [step];
  });

  const steps = walk(pipeline?.steps || []);

  if (removed.relistLoop !== 1) throw new Error(`0342: expected exactly 1 ${MOOD_LOOP_ID} loop, found ${removed.relistLoop}`);
  if (removed.spareIf !== 1) throw new Error(`0342: expected exactly 1 ${MOOD_LOOP_ID}-spare IF, found ${removed.spareIf}`);

  const next = { ...pipeline, steps };
  const after = JSON.stringify(next);
  if (after.includes(MOOD_LOOP_ID)) throw new Error("0342: a 0341 marker survived the removal");
  // THE CONTROL: the sweep this unwrapped must still be there, or the container
  // stops cleaning itself and this migration has caused a different bug.
  //
  // Counted by walking STEPS, not by matching the string in the JSON: a
  // REMOVE_CHILD step carries the name twice (`actionType` AND `config.type`),
  // so a string count reads 2 for one sweep and this guard threw on the real
  // pipeline. Caught by the test, not by reading.
  const countSweeps = (list) => (list || []).reduce((n, s) =>
    n + (isAction(s, "REMOVE_CHILD") ? 1 : 0)
      + countSweeps(s?.then) + countSweeps(s?.else) + countSweeps(s?.body), 0);
  const sweeps = countSweeps(steps);
  if (sweeps !== 1) throw new Error(`0342: expected exactly 1 REMOVE_CHILD sweep to survive, found ${sweeps}`);

  return { pipeline: next, changed: 1, removed };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation } = models;
  const gid = String(gridId);

  const [moodOp, tcOp] = await Promise.all([
    Operation.findOne({ gridId: gid, name: MOOD_OP }).lean(),
    Operation.findOne({ gridId: gid, name: TC_OP }).lean(),
  ]);

  if (!moodOp || !tcOp) {
    log(`  REFUSING: "${MOOD_OP}"=${!!moodOp} "${TC_OP}"=${!!tcOp} — nothing written.`);
    return { changed: 0 };
  }

  const mood = unfileFromTasksCompleted(moodOp.pipeline);
  const tc = stopRelistingMoodRows(tcOp.pipeline);

  log(`  ${MOOD_OP}: ${mood.changed ? `un-filed (${JSON.stringify(mood.removed)})` : "already un-filed"}`);
  log(`  ${TC_OP}: ${tc.changed ? `0341 removed (${JSON.stringify(tc.removed)})` : "0341 already removed"}`);
  if (tc.changed) {
    log("  today's already-listed check-ins are swept out of Tasks Completed by the container's own");
    log("  sweep on the next load — nothing is written to an occurrence here.");
  }

  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (!mood.changed && !tc.changed) return { changed: 0 };

  if (mood.changed) await Operation.updateOne({ gridId: gid, id: moodOp.id }, { $set: { pipeline: mood.pipeline } });
  if (tc.changed) await Operation.updateOne({ gridId: gid, id: tcOp.id }, { $set: { pipeline: tc.pipeline } });

  // Read the RESULT back out of the database and re-run both planners: both
  // must now be no-ops, or the write did not take.
  const [moodAfter, tcAfter] = await Promise.all([
    Operation.findOne({ gridId: gid, id: moodOp.id }).lean(),
    Operation.findOne({ gridId: gid, id: tcOp.id }).lean(),
  ]);
  if (unfileFromTasksCompleted(moodAfter.pipeline).changed) throw new Error("0342: the Mood op did not take the edit");
  if (stopRelistingMoodRows(tcAfter.pipeline).changed) throw new Error("0342: the Tasks Completed op did not take the edit");

  log("  check-ins are listed by the day column alone — they render under the Emotions Wheel.");
  return { changed: (mood.changed ? 1 : 0) + (tc.changed ? 1 : 0) };
}
