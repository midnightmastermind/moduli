// server/migrations/0082-mood-click-toggles.mjs
//
// User, 2026-08-12: "if i select one, it should be selected and added to moods
// for the day, if i click that one again, it should remove it. if i click on
// another one, both should be selected and added."
//
// 0079 made the click RECORD (verified: 5 emotions landed on today's journal
// from the user's own clicks). It records with `MERGE_ARRAY … unique: true`,
// which is UNION-ONLY — so a second click on the same feeling is a no-op and
// there has never been a way to take one back. A feeling wheel you cannot
// un-pick is a wheel that only ever fills up.
//
// This makes the click a TOGGLE:
//
//     IF $moods ARRAY_INCLUDES $picked   ->  REMOVE_FROM_VAR $moods value $picked
//     ELSE                               ->  MERGE_ARRAY  $moods with $picked
//
// Everything else about the pipeline is 0079's and is IMPORTED rather than
// copied — the day still comes from the clicked column, the host is still found
// by binding and scoped to the Schedule, and the highlight is still written from
// the same `$moods` the field gets. Re-stating those steps here would be a
// second copy to drift; this is a DELTA, and it FAILS CLOSED if the step it
// means to replace is not found, rather than writing a pipeline that silently
// lost its union.
//
// WHY THE HIGHLIGHT NEEDS NOTHING EXTRA: it is written from `$moods` AFTER the
// toggle, so removing a feeling clears its slice by the same one-truth rule that
// lit it. `graphOption.toDatum` already draws whatever ids sit in
// `meta.graph.highlight`.
import { buildRecordSelectionPipeline as buildV2 } from "./0079-mood-records-the-clicked-day.mjs";
import { randomUUID as uuid } from "node:crypto";

export const id = "0082-mood-click-toggles";
export const describe =
  "Clicking a feeling that is already recorded REMOVES it; clicking a new one adds it.";

/**
 * PURE — 0079's pipeline with the union step replaced by a toggle.
 * Exported so the behavioural test drives exactly what ships.
 *
 * THROWS when the anchor is missing. A migration that silently no-ops leaves a
 * pipeline that looks updated and is not — the class this repo keeps paying for.
 */
export function buildTogglePipeline(args) {
  const pipeline = buildV2(args);
  let replaced = 0;

  const walk = (steps) => steps.map((step) => {
    if (step?.type === "if") {
      return { ...step, then: walk(step.then || []), else: walk(step.else || []) };
    }
    if (step?.actionType === "MERGE_ARRAY" && step.config?.name === "$moods") {
      replaced++;
      return {
        id: uuid(), type: "if",
        // `condition` + `operator` — an IF reads step.condition, and an
        // unrecognised key falls back to an EMPTY AND, which evaluates TRUE.
        // A mis-keyed guard here would make every click a REMOVE.
        condition: { operator: "AND", rules: [
          { left: "$moods", comparator: "ARRAY_INCLUDES", right: "$picked" },
        ]},
        // Already recorded -> take it back.
        then: [{
          id: uuid(), type: "action", actionType: "REMOVE_FROM_VAR",
          config: { name: "$moods", value: "$picked" },
        }],
        // Not recorded yet -> add it, still de-duped. `with`, not `expr` —
        // MERGE_ARRAY's incoming key; a wrong key reads as an empty merge and
        // records nothing.
        else: [{
          id: uuid(), type: "action", actionType: "MERGE_ARRAY",
          config: { name: "$moods", with: "$picked", unique: true },
        }],
      };
    }
    return step;
  });

  const steps = walk(pipeline.steps || []);
  if (replaced !== 1) {
    throw new Error(`0082: expected exactly 1 MERGE_ARRAY on $moods to replace, found ${replaced}`);
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
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();

  if (!dateField || !moodField || graphs.length !== 1 || !schedulePage || !op) {
    log(`REFUSING: Date=${!!dateField} Mood=${!!moodField} graphs=${graphs.length} ` +
      `schedule=${!!schedulePage} op=${!!op} — nothing written.`);
    return;
  }

  const pipeline = buildTogglePipeline({
    graphOccId: graphs[0].id, moodFieldId: moodField.id,
    dateFieldId: dateField.id, schedulePageOccId: schedulePage.id,
  });

  const already = JSON.stringify(op.pipeline?.steps || []).includes("REMOVE_FROM_VAR");
  if (already) { log(`pipeline already toggles — no change.`); return; }

  log(`wheel ${graphs[0].id.slice(0, 8)}  Schedule ${schedulePage.id.slice(0, 8)}`);
  if (dryRun) {
    log(`WOULD rewrite "Mood: Record Selection": a click on an already-recorded feeling now REMOVES it.`);
    return;
  }
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log(`rewrote "Mood: Record Selection" — clicking a recorded feeling now removes it.`);
}
