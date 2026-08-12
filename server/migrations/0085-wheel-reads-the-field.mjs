// server/migrations/0085-wheel-reads-the-field.mjs
//
// User, 2026-08-12: "if i drag a mood onto a day, it should select it on the
// graph" — and, shown the measurement below, "derive from the Mood field".
//
// THE MEASUREMENT IS WHY THIS EXISTS. `meta.graph.highlight` turned out to be an
// EXACT DUPLICATE of the day's own Mood value: the same 7 ids, on the same day,
// written by the same op in the same step. Two stores for one fact, kept in step
// only by the paths someone remembered to wire — so clicking the wheel lit a
// slice and *every other way a mood can reach a day* left it dark. Dragging a
// Check In row onto another day was the case the user asked about; editing the
// field by hand and any future operation are the same gap.
//
// So the cache is retired and the wheel READS THE FIELD. Every write path lights
// it for free, and the two copies cannot drift because there is only one.
//
// THREE THINGS MOVE, and the order matters:
//   1. the wheel gains `meta.graph.valueFieldId` (Mood) beside the `dayFieldId`
//      0084 added — the renderer needs to know WHICH field holds a selection;
//   2. `meta.graph.highlight` is DELETED — with the op no longer writing it, a
//      leftover map would be a stale list that the renderer's legacy fallback
//      would happily light on a grid that has moved past it;
//   3. the op's highlight UPDATE step is REMOVED. Leaving it would keep writing
//      a key nothing reads — the "shipped and does nothing" class this repo
//      keeps paying for, in its quieter form.
//
// THE MOOD WRITE TO THE JOURNAL IS DELIBERATELY UNTOUCHED. That is the record
// the wheel now reads; removing it would delete the very thing this migration
// makes authoritative.
//
// KNOWN EDGE, stated rather than silently solved: a mood can be held by BOTH the
// journal and a Check In row for the same day, and the wheel unions them. Drag
// the Check In to another day and the new day lights (its Date moved) while the
// old day still lights via the journal, which still holds it. Keeping those two
// in step is a separate decision about which one is the record — it is not
// something to guess at inside a migration.
import { buildPerDayPipeline } from "./0084-highlight-is-per-day.mjs";

export const id = "0085-wheel-reads-the-field";
export const describe =
  "The wheel lights whatever the day's Mood field holds, instead of a separate stored list.";

/**
 * PURE — 0084's pipeline with the highlight write REMOVED.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the write it means to remove is missing: a migration that quietly
 * finds nothing leaves a pipeline that looks updated and is not.
 */
export function buildFieldReadPipeline(args) {
  const pipeline = buildPerDayPipeline(args);
  let removed = 0;

  const isHighlightWrite = (step) =>
    step?.actionType === "UPDATE" &&
    typeof step?.config?.path === "string" &&
    step.config.path.startsWith("$graph.meta.graph.highlight");

  const walk = (steps) =>
    steps
      .filter((step) => {
        if (isHighlightWrite(step)) {
          removed++;
          return false;
        }
        return true;
      })
      .map((step) =>
        step?.type === "if"
          ? { ...step, then: walk(step.then || []), else: walk(step.else || []) }
          : step
      );

  const steps = walk(pipeline.steps || []);
  if (removed !== 1) {
    throw new Error(`0085: expected exactly 1 highlight write to remove, found ${removed}`);
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
  const already = !JSON.stringify(op.pipeline?.steps || []).includes("meta.graph.highlight");

  // WHAT THE CACHE HELD, reported so the run can be checked against the field
  // rather than taken on trust — this is the value the wheel stops reading.
  const cached = graph.meta?.graph?.highlight;
  const cachedDays = cached && !Array.isArray(cached) ? Object.keys(cached) : [];
  const cachedCount = Array.isArray(cached)
    ? cached.length
    : cachedDays.reduce((n, d) => n + (cached[d]?.length || 0), 0);

  // The same ids, read from the FIELD — if these disagree, the cache was already
  // stale and dropping it is a change in what lights, which the user should see.
  const perDay = {};
  for (const o of occs) {
    if (o.meta?.feedSourceId) continue;
    const v = o.fields?.[moodField.id]?.value;
    const d = String(o.fields?.[dateField.id]?.value || "").slice(0, 10);
    if (!d || !Array.isArray(v) || !v.length) continue;
    (perDay[d] ||= new Set());
    v.forEach((x) => perDay[d].add(x));
  }
  const fieldDays = Object.keys(perDay).sort();
  const fieldCount = fieldDays.reduce((n, d) => n + perDay[d].size, 0);

  log(`wheel ${graph.id.slice(0, 8)} · valueFieldId ${moodField.id.slice(0, 8)} (Mood)`);
  log(`  cached highlight : ${cachedCount} id(s) over [${cachedDays.join(", ") || "—"}]`);
  log(`  read from field  : ${fieldCount} id(s) over [${fieldDays.join(", ") || "—"}]`);
  for (const d of new Set([...cachedDays, ...fieldDays])) {
    const c = Array.isArray(cached) ? null : (cached?.[d] || []);
    const f = [...(perDay[d] || [])];
    const same = c && c.length === f.length && f.every((i) => c.includes(i));
    log(`    ${d}  cache ${c ? c.length : "—"}  field ${f.length}  ${same ? "IDENTICAL" : "DIFFERS"}`);
  }
  if (already) log(`  op already reads the field — pipeline unchanged.`);

  if (dryRun) {
    log(`WOULD stamp meta.graph.valueFieldId, DELETE meta.graph.highlight, and drop the ` +
      `op's highlight write so the wheel reads the Mood field.`);
    return;
  }

  const nextGraph = { ...(graph.meta?.graph || {}), valueFieldId: moodField.id };
  delete nextGraph.highlight;
  await Occurrence.updateOne(
    { gridId, id: graph.id },
    { $set: { meta: { ...(graph.meta || {}), graph: nextGraph } } }
  );

  if (!already) {
    const pipeline = buildFieldReadPipeline({
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
  log(`the wheel now reads the Mood field — the stored highlight is gone.`);
}
