// 0341 — Tasks Completed is a MANAGED container, and it was sweeping the moods.
//
// User, 2026-09-18: *"those checkins are showing up in todo but it should be in
// tasks completed."* `0339` re-pointed the Mood op to file them there. They did
// not stay, and this is why.
//
// ── MEASURED, NOT REASONED ────────────────────────────────────────────────
//
// A browser on the live grid, polling the client's own state once a second
// after a cold load:
//
//     t=7.1s   Tasks Completed has 5 children   <- full_state delivers them
//     t=9.3s   still 5                          (the deferred half lands)
//     t=10.4s  0                                <- load-time operations run
//
// The op is `Day Page: Build Tasks Completed`: on every load it finds the day's
// Completed board by `identitySignature` (0320) and SWEEPS every child that
// fails its keep rule, then re-adds the day's completed tasks from the Schedule
// page. It is not a container you put things in; it is a container something
// keeps.
//
// The clause that removed them is the THIRD one:
//
//     $kid._boundFieldIds ARRAY_NOT_INCLUDES <Habit>
//
// A Check In binds Habit, so a mood check-in fails it — Completed and the Date
// both matched. It was excluded for being a habit, which it is not.
//
// ── TWO EDITS, AND THE SECOND IS WHAT MAKES IT SELF-HEALING ───────────────
//
//   1. THE SWEEP SPARES A MOOD ROW. The removal is wrapped in the mirror of the
//      rule that failed: a child carrying a Mood value dated this day is kept.
//      Written as a nested IF of exactly the same shape rather than an OR,
//      because a rule list is flat and an OR across a group is not a thing this
//      condition schema expresses.
//
//   2. THE BUILDER RE-LISTS THEM. A second ADD loop pulls the day's mood rows
//      from UNDER THE DAY PAGE, which is where the Mood op parents them. Without
//      it the container is only ever correct until something sweeps it once —
//      and the ADD_CHILD in the Mood op is a single write nobody repeats. With
//      it, any load repairs the listing, which is also why this migration does
//      not go and re-list today's five by hand.
//
// SCOPED BY ANCESTOR so a JOURNAL's Mood row is not dragged in: journals live
// under the Schedule page, check-ins under the day column, and the loop asks for
// the latter. `ADD_CHILD` already skips a child it is holding, so a re-run of
// the op costs one comparison.
//
// Both edits are anchored on SHAPE (the removal that targets `$tcContId`, the
// add loop over `$allInstances`) and both THROW unless exactly one anchor
// matches — a pipeline patcher that quietly finds nothing leaves an operation
// that looks repaired and is not.

export const id = "0341-tasks-completed-keeps-the-days-check-ins";
export const describe =
  "Day Page: Build Tasks Completed stops sweeping the day's mood check-ins and re-lists them on "
  + "every load. Pipeline only — no occurrence is created, moved or deleted.";

const OP_NAME = "Day Page: Build Tasks Completed";
const MOOD_LOOP_ID = "moodRowsIntoTasksCompleted";

/** The rules that say "this row records a mood for the day being built". */
const moodRowRules = (moodFieldId, dateFieldId, prefix) => [
  { id: `${MOOD_LOOP_ID}-mood`, left: `${prefix}fields.${moodFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" },
  { id: `${MOOD_LOOP_ID}-day`, left: `${prefix}fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$dayDate" },
];

/**
 * PURE — the sweep spares a row that records a mood for this day.
 *
 * Anchored on the REMOVE_CHILD that unlists from `$tcContId`, which is the one
 * thing in this pipeline that can take a child out of the Completed board.
 */
export function keepMoodCheckIns(pipeline, { moodFieldId, dateFieldId }) {
  let found = 0;
  let wrapped = 0;

  const isSweep = (step) => step?.type === "action"
    && step?.config?.type === "REMOVE_CHILD" && step?.config?.parentId === "$tcContId";

  const walk = (steps) => (steps || []).map((step) => {
    if (isSweep(step)) {
      found++;
      wrapped++;
      return {
        id: `${MOOD_LOOP_ID}-spare`,
        type: "if",
        condition: { operator: "AND", rules: moodRowRules(moodFieldId, dateFieldId, "$kid.") },
        then: [],                 // a mood row for this day stays
        else: [step],             // everything else is swept exactly as before
      };
    }
    if (step?.id === `${MOOD_LOOP_ID}-spare`) { found++; return step; }   // already applied
    if (step?.type === "if") return { ...step, then: walk(step.then), else: walk(step.else) };
    if (step?.type === "loop") return { ...step, body: walk(step.body) };
    return step;
  });

  const steps = walk(pipeline?.steps || []);
  if (found !== 1) throw new Error(`0341: expected exactly 1 sweep of $tcContId, found ${found}`);
  return { pipeline: { ...pipeline, steps }, wrapped };
}

/**
 * PURE — the builder re-lists the day's mood rows.
 *
 * Appended immediately after the loop that adds the day's completed tasks, so
 * the two additions sit together and the sweep above has already run.
 */
export function relistMoodCheckIns(pipeline, { moodFieldId, dateFieldId }) {
  let anchors = 0;
  let added = 0;

  // TWO PASSES, because the loop this adds sits AFTER the anchor and is itself
  // a loop over `$allInstances`: deciding "already applied" while walking would
  // make the re-run see two anchors and refuse.
  let already = false;
  const scan = (steps) => (steps || []).forEach((step) => {
    if (step?.id === MOOD_LOOP_ID) already = true;
    for (const k of ["then", "else", "body"]) if (step?.[k]) scan(step[k]);
  });
  scan(pipeline?.steps || []);

  const moodLoop = () => ({
    id: MOOD_LOOP_ID,
    type: "loop",
    over: "$allInstances",
    as: "$moodRow",
    predicate: {
      operator: "AND",
      rules: [
        // The day column, not the Schedule page: a journal carries a Mood too.
        { id: `${MOOD_LOOP_ID}-anc`, left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayPageId" },
        ...moodRowRules(moodFieldId, dateFieldId, ""),
      ],
    },
    body: [{
      id: `${MOOD_LOOP_ID}-add`, type: "action",
      config: { type: "ADD_CHILD", parentId: "$tcContId", childId: "$moodRow.id" },
    }],
  });

  const walk = (steps) => (steps || []).flatMap((step) => {
    if (step?.id === MOOD_LOOP_ID) return [step];                         // already applied
    if (step?.type === "loop" && step.over === "$allInstances") {
      anchors++;
      if (already) return [{ ...step, body: walk(step.body) }];
      added++;
      return [{ ...step, body: walk(step.body) }, moodLoop()];
    }
    if (step?.type === "if") return [{ ...step, then: walk(step.then), else: walk(step.else) }];
    if (step?.type === "loop") return [{ ...step, body: walk(step.body) }];
    return [step];
  });

  const steps = walk(pipeline?.steps || []);
  if (anchors !== 1) throw new Error(`0341: expected exactly 1 add loop over $allInstances, found ${anchors}`);
  return { pipeline: { ...pipeline, steps }, added };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Field, Operation } = models;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const moodField = fields.find((f) => f.name === "Mood");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const op = await Operation.findOne({ gridId: gid, name: OP_NAME }).lean();

  if (!moodField || !dateField || !op) {
    log(`  REFUSING: Mood=${!!moodField} Date=${!!dateField} op=${!!op} — nothing written.`);
    return { changed: 0 };
  }

  const args = { moodFieldId: moodField.id, dateFieldId: dateField.id };
  const swept = keepMoodCheckIns(op.pipeline, args);
  const relisted = relistMoodCheckIns(swept.pipeline, args);

  log(`  ${OP_NAME}: sweep spared ${swept.wrapped ? "(patched)" : "(already patched)"}`
    + ` · re-list loop ${relisted.added ? "(added)" : "(already present)"}`);
  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (!swept.wrapped && !relisted.added) return { changed: 0 };

  await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: relisted.pipeline } });

  // Read the RESULT back and re-run the planners: both must now be no-ops.
  const after = await Operation.findOne({ gridId: gid, id: op.id }).lean();
  const again = relistMoodCheckIns(keepMoodCheckIns(after.pipeline, args).pipeline, args);
  if (keepMoodCheckIns(after.pipeline, args).wrapped || again.added) {
    throw new Error("0341: the pipeline did not take both edits");
  }
  log("  the day's mood check-ins survive the sweep and are re-listed on every load.");
  return { changed: 1 };
}
