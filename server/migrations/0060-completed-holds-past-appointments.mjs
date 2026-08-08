// server/migrations/0060-completed-holds-past-appointments.mjs
//
// The half of the user's 2026-08-07 ask that `0056` could not ship:
//
//   "make sure for the tasks op too that if i finish a todo, it gets put in a
//    completed container at the bottom of the tasks page. include appointments
//    there too after the date passes for it."
//
// One container, TWO unrelated reasons to be in it. `0056` shipped the todo
// half and recorded why the appointment half was blocked. Both blockers are now
// gone:
//
//   1. A condition could not say "today" — it is evaluated with an EMPTY
//      `$vars`, and this page's `filterOverride: {}` kills the owner-filter
//      fallback. `helpers/feedTokens` resolves `$today` (2026-08-08).
//   2. Conditions were ANDed with no way to express OR or nesting.
//      `feed.conditionOperator` + nested groups (2026-08-08); the evaluator
//      `evalGroupAgainstRecord` already handled both.
//
// ── THE PREDICATE ───────────────────────────────────────────────────────────
//
//   Completed IS true
//     OR
//   ( Date DATE_BEFORE $today  AND  Time Slot IS_NOT_EMPTY )
//
// **THE SECOND ARM IS A GROUP, AND THE NESTING IS THE POINT.** A bare
// `Date DATE_BEFORE $today` would sweep every past-dated row under the Tasks
// page, not just the appointments. `Time Slot IS_NOT_EMPTY` narrows it to
// things that were SCHEDULED AT A TIME.
//
// **IT IS A PROXY FOR "is an appointment", said plainly.** The precise test is
// the MODULE — `templateId IS <Appointment>`, which is what
// `Schedule: Place Dated Work` matches on — and a feed condition's left side is
// always `fields.<id>.value`, so a feed cannot say that today. Measured on this
// grid before choosing it: of 100 occurrences carrying a Date value, 96 are not
// appointments and **0 of those are in the Tasks-page scope**; the two
// due-dated tasks carry `Due` and no `Date`, and no Time Slot. So the proxy is
// exact on real data. If it ever needs to be exact by construction, the change
// is a module-matching leaf, not a different predicate.
//
// ── AN APPOINTMENT LEAVES WHEN ITS DATE PASSES, NOT WHEN IT IS TICKED ───────
//
// Deliberate, and the user's own framing: one you attended and one you missed
// both stop being upcoming. `Completed` is untouched by the second arm.
//
// ── SCOPE IS PRESERVED, AND IS LOAD-BEARING ─────────────────────────────────
//
// `0056` A/B'd it: without `scope` the feed pulls every completed instance on
// the grid — every Routines action, every schedule row. This migration only
// swaps `conditions` + `conditionOperator` and leaves scope/roles/limit alone.
//
// ── WHAT A COPY IN HERE MEANS ───────────────────────────────────────────────
//
// Unchanged from 0056: a feed MINTS COPY-LINKED children, so a row appears in
// both its own container and Completed. Un-ticking either clears both and the
// copy goes on the next sync. A past appointment's copy will likewise vanish if
// its date is moved back into the future.

export const id = "0060-completed-holds-past-appointments";
export const describe =
  "Rewrites the Tasks page's Completed container feed to OR: a ticked todo, or a "
  + "dated+time-slotted row whose date has passed (the appointments). Changes only "
  + "`conditions`/`conditionOperator` on one occurrence; deletes nothing.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  const fields = await Field.find({ gridId }).lean();
  const pick = (name, type) => fields.find(
    (f) => (f.name || "").trim().toLowerCase() === name.toLowerCase() && f.type === type,
  ) || null;

  // By NAME AND TYPE — this grid has two fields called "Due", and the same
  // discipline is what kept 0055 correct.
  const fCompleted = pick("Completed", "boolean");
  const fDate = pick("Date", "date");
  const fSlot = pick("Time Slot", "select");
  const missing = Object.entries({ Completed: fCompleted, Date: fDate, "Time Slot": fSlot })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    log(`REFUSING: required field(s) absent or wrong type: ${missing.join(", ")}`);
    return;
  }

  // The Completed container: found as the Tasks page's child whose MODULE is
  // labelled Completed — not by a global label search, which would also match
  // the "Tasks Completed" day-page container and the Completed FIELD.
  const tasksMods = await Module.find({ gridId, role: "page", label: "Tasks" }).lean();
  const tasksOcc = tasksMods.length
    ? await Occurrence.findOne({ gridId, moduleId: { $in: tasksMods.map((m) => m.id) } }).lean()
    : null;
  if (!tasksOcc) { log("REFUSING: no Tasks page on this grid"); return; }

  const kids = await Occurrence.find({ gridId, id: { $in: tasksOcc.occurrences || [] } }).lean();
  const kidMods = await Module.find({ gridId, id: { $in: kids.map((k) => k.moduleId) } }).lean();
  const kidModById = Object.fromEntries(kidMods.map((m) => [m.id, m]));
  const completed = kids.find((k) => kidModById[k.moduleId]?.label === "Completed");
  if (!completed) { log("REFUSING: no Completed container on the Tasks page — 0056 has not run"); return; }
  if (!completed.feed?.enabled) { log("REFUSING: the Completed container carries no enabled feed"); return; }

  const conditionOperator = "OR";
  const conditions = [
    { id: "completed-todo", fieldId: fCompleted.id, comparator: "IS", value: true },
    { id: "past-appointment", operator: "AND", conditions: [
      { id: "date-passed", fieldId: fDate.id, comparator: "DATE_BEFORE", value: "$today" },
      { id: "was-scheduled", fieldId: fSlot.id, comparator: "IS_NOT_EMPTY", value: "" },
    ] },
  ];

  const already = completed.feed.conditionOperator === conditionOperator
    && JSON.stringify(completed.feed.conditions) === JSON.stringify(conditions);
  if (already) { log(`SKIP   ${completed.id} — already carries this predicate`); return; }

  log(`Completed container ${completed.id} (scope ${completed.feed.scope || "—"}, limit ${completed.feed.limit})`);
  log(`  FROM  ${completed.feed.conditionOperator || "AND"}  ${JSON.stringify(completed.feed.conditions)}`);
  log(`  TO    ${conditionOperator}  Completed IS true  OR  (Date DATE_BEFORE $today AND Time Slot IS_NOT_EMPTY)`);
  if (dryRun) return;

  // Only the two predicate keys move. scope / roles / sort / limit / enabled are
  // read from the stored feed and written back untouched.
  await Occurrence.updateOne(
    { gridId, id: completed.id },
    { $set: { feed: { ...completed.feed, conditionOperator, conditions } } },
  );
  log(`DONE   ${completed.id} — scope and limit preserved`);
}
