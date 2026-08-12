// server/migrations/0087-the-check-in-is-the-truth.mjs
//
// User, 2026-08-12: "it should always be in sync between todays emotional wheel
// and todays schedule. same as the other days."
//
// 0086 GOT HALF OF IT AND THE RE-MEASUREMENT SAID SO. After applying it, firing
// the stored op per column again:
//
//   2026-08-06   still NOTHING          <- no journal for that date
//   2026-08-10   journal + Check In on the column   (fixed by 0086)
//   2026-08-11   still NOTHING          <- no journal for that date
//   2026-08-12   journal + Check In in the Todo
//
// The remaining cause is structural, and dumping the stored pipeline as a tree is
// what showed it: EVERYTHING — the Todo find, the toggle, the placement — sits
// inside `IF $moodHost IS_NOT_EMPTY`. On a day with no journal that gate is false,
// so the click does nothing at all, silently. That is the 0046 swallow, still
// live, and it is why two of four days record nothing.
//
// AND THE TOGGLE ASKS THE WRONG THING. It decides "is this feeling already
// picked?" by reading the JOURNAL's Mood list — a question a journal-less day can
// never answer, so even ungated it would add a second Check In on every click
// instead of toggling off.
//
// SO THE CHECK IN BECOMES THE TRUTH, which is what the user asked for: the wheel
// already reads the Mood field per day (0085), and the Check In carries the Mood
// AND the Date. Making the toggle test the Check In means the wheel and the
// schedule are answering from the SAME row — in sync by construction rather than
// by two writes being kept in step.
//
//   IF (a Check In for this feeling on this day) OR (the journal already lists it)
//     THEN delete the Check In, and drop it from the journal if there is one
//     ELSE place a Check In,   and add it to the journal if there is one
//
// THE `OR` ARM IS NOT BELT-AND-BRACES. Seven feelings were recorded on 2026-08-12
// BEFORE the Check In existed, so they live only on the journal. Without that arm
// clicking one of those would find no Check In, conclude "not picked", and add a
// duplicate. With it, the first click correctly un-picks.
//
// THE JOURNAL WRITE SURVIVES, gated on its own host existing. Where a journal
// exists it is a visible record and deleting it would remove something the user
// can see; where one does not, the click now works anyway.
import { buildAlwaysLandsPipeline } from "./0086-a-click-always-lands.mjs";

export const id = "0087-the-check-in-is-the-truth";
export const describe =
  "A day with no journal still records: the toggle asks the Check In, so the wheel and the schedule cannot disagree.";

/**
 * PURE — 0086's pipeline with the journal-host gate reduced to the journal write.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the shape it means to restructure is missing.
 */
export function buildCheckInTruthPipeline(args) {
  const pipeline = buildAlwaysLandsPipeline(args);
  let restructured = 0;

  const isHostGate = (st) =>
    st?.type === "if" &&
    (st.condition?.rules || []).length === 1 &&
    st.condition.rules[0]?.left === "$moodHost" &&
    st.condition.rules[0]?.comparator === "IS_NOT_EMPTY";

  const walk = (steps) => steps.flatMap((step) => {
    if (step?.type !== "if") return [step];
    if (!isHostGate(step)) {
      return [{ ...step, then: walk(step.then || []), else: walk(step.else || []) }];
    }

    const inner = step.then || [];
    const readMoods = inner.filter(
      (s) => s.actionType === "INIT_VAR" && s.config?.name === "$moods");
    const findTodo = inner.filter(
      (s) => s.actionType === "FIND" && s.config?.itemVar === "$todo");
    const placeGate = inner.filter(
      (s) => s.type === "if" && (s.then || []).some((x) => x.config?.name === "$placeParent"));
    const toggle = inner.find(
      (s) => s.type === "if" &&
        (s.condition?.rules || []).some((r) => r.left === "$moods" && r.comparator === "ARRAY_INCLUDES"));
    const journalWrite = inner.filter(
      (s) => s.actionType === "UPDATE" && String(s.config?.path || "").includes("$moodHost"));

    if (!toggle || !findTodo.length || !placeGate.length || !journalWrite.length) return [step];
    restructured++;

    // The stale-Check-In FIND is HOISTED out of the toggle's THEN so its result
    // can be the toggle's own question. It was only ever consulted after the
    // journal had already decided.
    const findStale = (toggle.then || []).find(
      (s) => s.actionType === "FIND" && s.config?.itemVar === "$staleCheckIn");
    if (!findStale) return [step];

    const removeRest = (toggle.then || []).filter((s) => s !== findStale);

    return [
      // The journal is optional now: read its list when it exists, else $moods
      // stays the `json:[]` the pipeline already declares at the top.
      { ...step, then: readMoods, else: [] },
      ...findTodo,
      ...placeGate,
      findStale,
      {
        ...toggle,
        condition: {
          operator: "OR",
          rules: [
            { left: "$staleCheckIn", comparator: "IS_NOT_EMPTY", right: null },
            ...(toggle.condition?.rules || []),
          ],
        },
        then: removeRest,
        else: toggle.else || [],
      },
      // Writing the journal is the ONLY thing that still needs a journal.
      { ...step, then: journalWrite, else: [] },
    ];
  });

  const steps = walk(pipeline.steps || []);
  if (restructured !== 1) {
    throw new Error(`0087: expected exactly 1 mood-host gate to restructure, found ${restructured}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));

  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  const timeslotField = fields.find((f) => f.name === "Time Slot");
  const completedField = fields.find((f) => f.name === "Completed" && f.type === "boolean");
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  const checkInMods = mods.filter((m) => /^check ?in$/i.test(m.label || "") && m.role === "instance");
  const checkInOccs = occs.filter((o) => checkInMods.some((m) => m.id === o.moduleId));
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();

  if (!dateField || !moodField || !timeslotField || !completedField ||
      graphs.length !== 1 || !schedulePage || checkInOccs.length !== 1 || !op) {
    log(`REFUSING: Date=${!!dateField} Mood=${!!moodField} TimeSlot=${!!timeslotField} ` +
      `Completed=${!!completedField} graphs=${graphs.length} schedule=${!!schedulePage} ` +
      `checkIn=${checkInOccs.length} op=${!!op} — nothing written.`);
    return;
  }

  // WHICH DAYS HAVE A JOURNAL — the days that work today, and the ones that do not.
  const graph = graphs[0];
  const cols = occs.filter((o) => (o.occurrences || []).includes(graph.id));
  const hostForDay = (day) => occs.find((o) => {
    const binds = (modById.get(o.moduleId)?.fieldBindings || []).some((b) => b.fieldId === moodField.id);
    return binds && String(o.fields?.[dateField.id]?.value || "").slice(0, 10) === day;
  });
  log(`the wheel is rendered in ${cols.length} column(s):`);
  for (const col of cols) {
    const day = String(col.fields?.[dateField.id]?.value || "").slice(0, 10);
    const host = hostForDay(day);
    log(`  ${day.padEnd(12)} ${host ? `journal ${host.id.slice(0, 8)}` : "NO journal -> today a click does nothing; after this it records"}`);
  }

  const already = JSON.stringify(op.pipeline?.steps || []).includes('"operator":"OR"');
  if (already) {
    log(`the toggle already asks the Check In — no change.`);
    if (dryRun) return;
  }

  if (dryRun) {
    log(`WOULD move the toggle onto the Check In and reduce the journal gate to the ` +
      `journal WRITE, so a day with no journal still records and still lights.`);
    return;
  }

  if (!already) {
    const pipeline = buildCheckInTruthPipeline({
      graphOccId: graph.id,
      moodFieldId: moodField.id,
      dateFieldId: dateField.id,
      schedulePageOccId: schedulePage.id,
      checkInSourceOccId: checkInOccs[0].id,
      timeslotFieldId: timeslotField.id,
      completedFieldId: completedField.id,
    });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`the Check In is the truth — every day records, and the wheel reads the same row.`);
}
