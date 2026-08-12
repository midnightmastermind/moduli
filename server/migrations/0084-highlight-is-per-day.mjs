// server/migrations/0084-highlight-is-per-day.mjs
//
// User, 2026-08-12: "the highlight of the selected should be per day, not all of
// them." / "and it doesnt need to be opened if we have it saved in the db."
//
// THE SAME ONE-OCCURRENCE-MANY-DAYS SHAPE, third appearance. The wheel is ONE
// occurrence multi-parented into every day column (0068). `meta.graph.highlight`
// therefore belongs to the GRAPH, not to a day — so the ids recorded on Tuesday
// lit the same slices when you looked at Monday. 0079 fixed the RECORD (the mood
// lands on the clicked day's journal) and left the HIGHLIGHT global, which is why
// the wheel still looked like it was selecting on every day.
//
// The op now keys the write by the day it already resolved:
//     meta.graph.highlight["2026-08-12"] = [ids]
// `UPDATE`'s path supports `${…}` interpolation, and `UPDATE_ITEM_META` deep-sets
// at a nested path clone-merging each level — so one day's write preserves every
// other day, and the legacy flat ARRAY is replaced by a map on the first write.
//
// THE RENDERER NEEDS TO KNOW WHICH DAY IT IS SHOWING, so the graph occurrence
// carries `meta.graph.dayFieldId` — the id of the Date field on the column.
// That is DATA: nothing in the chart code learns what a day or an emotion is, it
// just reads a configured field off the surface it is rendered in.
//
// THE EXISTING FLAT LIST IS RE-KEYED rather than dropped. Those ids are the moods
// the user recorded, and they are still correct — they were just filed under
// "always". They move to the day whose journal actually holds them, so nothing
// the user picked disappears and the all-days behaviour stops immediately.
import { buildCheckInPipeline } from "./0083-mood-mints-a-check-in.mjs";

export const id = "0084-highlight-is-per-day";
export const describe =
  "The wheel's selection is stored and shown PER DAY, instead of one list lighting every day.";

/**
 * PURE — 0083's pipeline with the highlight write keyed by day.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the write it means to re-key is missing.
 */
export function buildPerDayPipeline(args) {
  const pipeline = buildCheckInPipeline(args);
  let rekeyed = 0;

  const walk = (steps) => steps.map((step) => {
    if (step?.type === "if") {
      return { ...step, then: walk(step.then || []), else: walk(step.else || []) };
    }
    const path = step?.config?.path;
    // The whole-graph highlight write, and ONLY that one — the mood write to the
    // journal keeps its own path.
    if (step?.actionType === "UPDATE" && path === "$graph.meta.graph.highlight") {
      rekeyed++;
      return { ...step, config: { ...step.config, path: "$graph.meta.graph.highlight.${$day}" } };
    }
    return step;
  });

  const steps = walk(pipeline.steps || []);
  if (rekeyed !== 1) {
    throw new Error(`0084: expected exactly 1 highlight write to re-key, found ${rekeyed}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));

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

  const graph = graphs[0];
  const already = String(op.pipeline?.steps ? JSON.stringify(op.pipeline.steps) : "")
    .includes("meta.graph.highlight.${$day}");

  const pipeline = buildPerDayPipeline({
    graphOccId: graph.id, moodFieldId: moodField.id, dateFieldId: dateField.id,
    schedulePageOccId: schedulePage.id, checkInSourceOccId: checkInOccs[0].id,
    timeslotFieldId: timeslotField.id, completedFieldId: completedField.id,
  });

  // Re-key the flat list onto the day whose journal actually holds those ids.
  // Reading it back from the DATA rather than assuming "today" — the ids are the
  // record of what was picked, and the journal says which day that was.
  const current = graph.meta?.graph?.highlight;
  let rekeyPlan = null;
  if (Array.isArray(current) && current.length) {
    const hosts = occs.filter((o) =>
      (modById.get(o.moduleId)?.fieldBindings || []).some((b) => b.fieldId === moodField.id));
    const holder = hosts.find((h) => {
      const v = h.fields?.[moodField.id]?.value;
      return Array.isArray(v) && current.every((idv) => v.includes(idv));
    });
    const day = holder?.fields?.[dateField.id]?.value;
    if (day) rekeyPlan = { day, ids: current };
    else log(`  NOTE: ${current.length} highlighted id(s) match no single day's journal — ` +
      `leaving the legacy list alone rather than filing it under a guessed day.`);
  }

  log(`wheel ${graph.id.slice(0, 8)} · dayFieldId ${dateField.id.slice(0, 8)}` +
    (rekeyPlan ? ` · re-key ${rekeyPlan.ids.length} id(s) onto ${rekeyPlan.day}` : " · no flat list to re-key") +
    (already ? " · pipeline already per-day" : ""));

  if (dryRun) {
    log(`WOULD write meta.graph.dayFieldId on the wheel, re-key the highlight by day, ` +
      `and make the op write meta.graph.highlight.\${$day}.`);
    return;
  }

  const nextGraphMeta = {
    ...(graph.meta || {}),
    graph: {
      ...(graph.meta?.graph || {}),
      dayFieldId: dateField.id,
      ...(rekeyPlan ? { highlight: { [rekeyPlan.day]: rekeyPlan.ids } } : {}),
    },
  };
  await Occurrence.updateOne({ gridId, id: graph.id }, { $set: { meta: nextGraphMeta } });
  if (!already) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log(`the wheel's selection is now per day — ${rekeyPlan ? `${rekeyPlan.ids.length} existing id(s) filed under ${rekeyPlan.day}` : "no existing list"}.`);
}
