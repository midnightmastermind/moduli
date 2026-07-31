// User, 2026-07-31: "tasks completed in the daypage should be like the todo
// container, right now its diff. it says click to edit instead of add new item."
//
// Tasks Completed was a kind:"doc" container, so its body was a TipTap editor
// and the build op painted a list of moduleEmbeds into it — a RENDERING of the
// day's completed tasks. Todo, sitting right above it, is a board container
// holding the real occurrences. Same page, two different things pretending to
// be the same section.
//
// It becomes a board: the tasks are its CHILDREN, exactly as Todo's are, so it
// gains the add pocket and the rows behave like rows everywhere else. The op
// (rewritten in the same commit) links them with ADD_CHILD and unlinks stale
// ones with the new REMOVE_CHILD — never REMOVE_OCCURRENCE, because these are
// the Schedule's own occurrences multi-parented in and deleting one would take
// the user's task out of the Schedule too.
//
// The existing embeds are converted to children first, so the section keeps
// showing the same tasks between this migration and the op's next fire.

import { decompressTextmap } from "../utils/textmapCompression.js";
import { makeDayPageBuildTasksCompletedOp } from "../utils/liveSystemBuilders.js";

export const id = "0017-tasks-completed-is-a-board";
export const describe =
  "Turns every Tasks Completed container into a board (like Todo), converting the moduleEmbeds its " +
  "body held into real children first so nothing disappears, and rebuilds Day Page: Build Tasks " +
  "Completed to link tasks as children instead of painting a doc body. Deletes no occurrences.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;

  const mods = await Module.find({ gridId, role: "container", label: "Tasks Completed" })
    .select({ id: 1, kind: 1 }).lean();
  if (!mods.length) { log("no Tasks Completed containers on this grid"); return; }

  const stillDoc = mods.filter(m => m.kind !== "board");
  if (stillDoc.length) {
    log(`${stillDoc.length} module(s): kind "doc" → "board"`);
    if (!dryRun) {
      await Module.updateMany({ gridId, id: { $in: stillDoc.map(m => m.id) } }, { $set: { kind: "board" } });
    }
  } else log("every Tasks Completed module is already a board");

  const occs = await Occurrence.find({ gridId, moduleId: { $in: mods.map(m => m.id) } })
    .select({ id: 1, occurrences: 1, textmap: 1 }).lean();

  let converted = 0;
  for (const occ of occs) {
    const content = (decompressTextmap(occ.textmap) || {}).content || [];
    const embedded = content
      .map(n => n?.attrs?.occurrenceId)
      .filter(ref => typeof ref === "string" && ref && !ref.startsWith("$"));
    if (!embedded.length && !content.some(n => n?.type === "moduleEmbed")) continue;

    // Only link ids that still name a real occurrence.
    const live = new Set((await Occurrence.find({ gridId, id: { $in: embedded } }).select({ id: 1 }).lean()).map(o => o.id));
    const kids = occ.occurrences || [];
    const add = embedded.filter(ref => live.has(ref) && !kids.includes(ref));

    log(`  ${occ.id.slice(0, 8)}: ${add.length} embed(s) → children, body cleared`);
    converted++;
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: occ.id }, {
        $set: {
          occurrences: [...kids, ...add],
          // A board container renders its children, not a textmap; leaving the
          // old embed list behind would double every row once the op re-links.
          textmap: { type: "doc", content: [{ type: "paragraph" }] },
        },
      });
    }
  }

  log(converted
    ? `${converted} container body(ies) ${dryRun ? "would be" : ""} converted`
    : "no doc bodies left to convert");

  // ── the op has to move with the container ────────────────────────────────
  // A board renders children; the stored pipeline still paints a textmap. Left
  // alone it would keep writing a body nothing shows while the child list never
  // fills — the section would just go blank.
  const sched = grid?.meta?.scheduleFieldIds || {};
  const completed = await Field.findOne({ gridId, name: "Completed" }).select({ id: 1 }).lean();
  const habit = await Field.findOne({ gridId, name: "Habit" }).select({ id: 1 }).lean();
  const op = await Operation.findOne({ gridId, name: "Day Page: Build Tasks Completed" }).lean();
  if (!op) { log("no 'Day Page: Build Tasks Completed' op — nothing to rebuild"); return; }
  if (!sched.dateFieldId || !sched.pageOccurrenceId || !completed) {
    throw new Error("missing scheduleFieldIds / Completed — cannot rebuild the op");
  }
  if (JSON.stringify(op.pipeline).includes("ADD_CHILD")) { log("op already links children"); return; }

  const rebuilt = makeDayPageBuildTasksCompletedOp({
    userId: grid.userId, gridId,
    dateFieldId: sched.dateFieldId,
    completedFieldId: completed.id,
    schedulePageOccId: sched.pageOccurrenceId,
    habitFieldId: habit?.id ?? null,
  });
  log("rebuilding the op: ADD_CHILD / REMOVE_CHILD instead of a textmap rewrite");
  if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: rebuilt.pipeline } });
}
