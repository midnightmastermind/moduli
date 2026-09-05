// The rebuilt Emotions Wheel needed the op pointed at it.
//
// `Mood: Record Selection` was scoped to an occurrence that no longer exists,
// and the grid carried ZERO graph modules - so clicking a mood recorded
// nothing, silently. Found 2026-09-05 by refreshing the op fixture, which had
// been 8 days stale and was hiding it.
//
// The emotion DATA had survived intact: the "Emotions" board still held its 128
// rows. What was gone was the chart - the container had stopped being
// `kind:"graph"`. So the rebuild is `0046` re-run, which is written to be
// idempotent and is the authoritative builder; it minted the wheel again and
// re-tagged the 129 emotion rows.
//
// WHAT `0046` DELIBERATELY WILL NOT DO IS TOUCH AN OP THAT ALREADY EXISTS. It
// sets `targetOccurrenceId` and the trigger's `targetId` only on the CREATE
// branch, and reports "operation: exists" otherwise - correctly, because
// overwriting a live op's scope is not a thing a re-run should do on its own.
// So the op kept naming the dead id and this file closes that gap.
//
// ── BOTH IDS ARE THE OCCURRENCE, AND THAT LOOKS WRONG UNTIL YOU READ WHY ───
//
// The trigger is `subjectType: "module"` yet its `targetId` is the graph
// OCCURRENCE. `0046`'s own comment records the reason: `matchSubjectFilter`
// compares `transaction.containerId` against `targetId`, and `ContainerGraph`
// reports the graph OCCURRENCE as the containerId. A `subjectType:"occurrence"`
// is not a case that function knows, so it would fall through to "match
// anything" and the op would fire for every graph on the grid.
//
// Refuses unless exactly one graph occurrence exists, rather than picking one.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0296-point-the-mood-op-at-the-rebuilt-wheel";
export const description = "Mood: Record Selection scopes to the rebuilt Emotions Wheel.";
export const touches = ["modules", "occurrences", "operations"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const graphMods = await Module.find({ gridId: gid, role: "container", kind: "graph" }).lean();
  if (!graphMods.length) throw new Error("no graph module on the grid - run 0046 first");
  const occs = await Occurrence.find({ gridId: gid, moduleId: { $in: graphMods.map((m) => m.id) } }).lean();
  if (occs.length !== 1) throw new Error(`${occs.length} graph occurrences - refusing to pick one`);
  const wheel = occs[0];
  log(`  wheel: ${wheel.id} ("${graphMods.find((m) => m.id === wheel.moduleId)?.label}")`);

  const op = await Operation.findOne({ gridId: gid, name: "Mood: Record Selection" }).lean();
  if (!op) { log("  no Mood: Record Selection - nothing to repoint"); return; }

  const wasTarget = op.targetOccurrenceId;
  const triggers = JSON.parse(JSON.stringify(op.triggerObjects || []));
  let movedTriggers = 0;
  for (const t of triggers) {
    if (t.eventType === "onGraphSelect" && t.targetId !== wheel.id) { t.targetId = wheel.id; movedTriggers++; }
  }
  const needTarget = wasTarget !== wheel.id;
  if (!needTarget && !movedTriggers) { log("  already scoped to the wheel - converged"); return; }

  log(`  targetOccurrenceId ${String(wasTarget).slice(0, 12)} -> ${wheel.id.slice(0, 12)}`);
  log(`  onGraphSelect trigger(s) repointed: ${movedTriggers}`);
  // `triggerTypes` is the other half 0046 records as failing SILENTLY when
  // absent - without it the op only ever fires on LOAD.
  const types = Array.isArray(op.triggerTypes) && op.triggerTypes.includes("onGraphSelect")
    ? op.triggerTypes : [...new Set([...(op.triggerTypes || []), "onGraphSelect"])];
  if (types.length !== (op.triggerTypes || []).length) log(`  triggerTypes += onGraphSelect`);

  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }
  await Operation.updateOne({ id: op.id, gridId: gid },
    { $set: { targetOccurrenceId: wheel.id, triggerObjects: triggers, triggerTypes: types } });
  log("  repointed.");
}
