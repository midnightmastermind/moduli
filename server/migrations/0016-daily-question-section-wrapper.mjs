// User, 2026-07-31: "put the daily question in a daily question container with
// the actual question being a container inside of it … make sure its not
// repeating the question next to it … it should say the question as the
// selection and daily question small next to it."
//
// The bound container WAS the section: its header rendered the picker, so the
// section heading was a whole sentence — printed once as the header label and
// again as the select's value, and long enough that the header marquee-scrolled
// its own empty space.
//
// Split in two, matching the template:
//   Daily Question            (plain section heading, like Journal / Notes)
//     └─ <the question>       (bound container — header IS the picker)
//          └─ Daily Answer    (unchanged)
//
// The inner container also loses its "Daily Question" label, because a label
// prints beside the selected question — the duplication that was reported. The
// field name now shows only in the binding badge, which is the "small next to
// it". The client half (BoundHeader no longer echoing the value, and an empty
// option instead of "— pick —") ships in the same commit.
//
// Idempotent: a page whose Daily Question already wraps a bound child is skipped.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0016-daily-question-section-wrapper";
export const describe =
  "Wraps each day page's bound Daily Question container in a plain 'Daily Question' section container " +
  "and clears the inner container's label, so the section heading is the words 'Daily Question' and the " +
  "selected question renders once, in the picker. Moves no answers and deletes nothing.";

const uid = () => Math.random().toString(36).slice(2, 14);

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const userId = grid.userId;

  // Every container whose module carries a headerLink binding IS a bound
  // question container — found by the binding, not by label, since the label is
  // exactly what this migration clears.
  const boundMods = (await Module.find({ gridId, role: "container" }).select({ id: 1, label: 1, meta: 1 }).lean())
    .filter(m => m.meta?.headerLink?.selfField);
  if (!boundMods.length) { log("no bound question containers on this grid"); return; }

  const boundOccs = await Occurrence.find({ gridId, moduleId: { $in: boundMods.map(m => m.id) } })
    .select({ id: 1, moduleId: 1, parentId: 1 }).lean();

  let wrapped = 0, relabelled = 0;
  for (const q of boundOccs) {
    const parent = await Occurrence.findOne({ gridId, id: q.parentId })
      .select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
    if (!parent) { log(`  question ${q.id.slice(0, 8)}: no parent — skipping`); continue; }
    const parentMod = await Module.findOne({ gridId, id: parent.moduleId }).select({ role: 1, label: 1 }).lean();

    // Already wrapped? Then the parent is a plain container labelled Daily
    // Question, not the page itself.
    const alreadyWrapped = parentMod?.role === "container";
    if (!alreadyWrapped) {
      if (parentMod?.role !== "page") { log(`  question ${q.id.slice(0, 8)}: parent is a ${parentMod?.role} — skipping`); continue; }

      const outerModId = uid();
      const outerOccId = uid();
      log(`  ${parentMod.label}: wrapping the question in a "Daily Question" section container`);
      wrapped++;
      if (!dryRun) {
        await new Module({ id: outerModId, userId, gridId, role: "container", kind: "doc", label: "Daily Question" }).save();
        await new Occurrence({
          id: outerOccId, userId, gridId, moduleId: outerModId, targetId: outerModId, targetType: "module",
          parentId: parent.id, occurrences: [q.id],
          textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: q.id } }] },
        }).save();
        await Occurrence.updateOne({ gridId, id: q.id }, { $set: { parentId: outerOccId } });

        // The page swaps the question for the wrapper, in place — so the section
        // keeps its position between the heading and the Todo.
        const tm = decompressTextmap(parent.textmap) || {};
        const content = (tm.content || []).map(n =>
          n?.attrs?.occurrenceId === q.id
            ? { type: "moduleEmbed", attrs: { occurrenceId: outerOccId } }
            : n);
        await Occurrence.updateOne({ gridId, id: parent.id }, {
          $set: {
            textmap: { type: "doc", content },
            occurrences: (parent.occurrences || []).map(k => (k === q.id ? outerOccId : k)),
          },
        });
      }
    }

    // The inner container's label prints beside the selected question. Clear it
    // on the module (the shared template) and on any per-placement override.
    const mod = boundMods.find(m => m.id === q.moduleId);
    if (mod?.label) {
      log(`  clearing the inner question container's label ("${mod.label}")`);
      relabelled++;
      if (!dryRun) await Module.updateOne({ gridId, id: mod.id }, { $set: { label: "" } });
    }
  }

  log(`${wrapped} question(s) ${dryRun ? "would be" : ""} wrapped; ${relabelled} label(s) cleared`);
}
