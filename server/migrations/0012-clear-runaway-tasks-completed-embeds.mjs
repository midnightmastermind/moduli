// User, 2026-07-30: "the daypage is crashing the app."
//
// Today's day page held a Tasks Completed container whose textmap carried a
// moduleEmbed for EVERY occurrence on the grid — 1280 of them, including the
// day page that contains it. The tab did not throw; it died (Chromium reported a
// renderer crash, no page error), because rendering a doc that embeds the whole
// grid — pages, panels, containers, and itself — is unbounded work.
//
// The cause was in the executor, and is fixed in the same commit: a LOOP step
// naming a collection in `over` (`$allInstances` — FIND's spelling, which the
// Tasks Completed builder used) fell through gatherLoopItems' legacy-key
// branches to its every-occurrence default, and a `predicate` on a loop step was
// ignored outright. So the filter that was supposed to keep the loop to today's
// completed tasks never ran, on a pool that was never the instances.
//
// This clears the wreckage. It does NOT rewrite the op: the stored pipeline was
// always expressing the right thing, and does the right thing under the fixed
// executor. **The client fix must be deployed and the tab reloaded first** — a
// tab running the old bundle re-poisons the container on its next load.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0012-clear-runaway-tasks-completed-embeds";
export const describe =
  "Empties any Tasks Completed container whose textmap embeds non-task occurrences (pages, containers, " +
  "itself) — wreckage from the unfiltered loop. The op refills the current day's page on its next fire; " +
  "no user-authored content lives in these bodies.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const containerMods = await Module.find({ gridId, label: "Tasks Completed" }).select({ id: 1 }).lean();
  if (!containerMods.length) {
    log("no Tasks Completed containers on this grid — nothing to clear");
    return;
  }
  const conts = await Occurrence.find({ gridId, moduleId: { $in: containerMods.map(m => m.id) } })
    .select({ id: 1, textmap: 1 }).lean();

  // The op embeds INSTANCE occurrences only (a completed, dated task). Any embed
  // resolving to something else — or to nothing — is wreckage. That is the test,
  // rather than a node-count threshold: a real day with many completed tasks is
  // legitimate, and one bad embed of the page itself is enough to hang the tab.
  const mods = await Module.find({ gridId }).select({ id: 1, role: 1 }).lean();
  const roleOf = new Map(mods.map(m => [m.id, m.role]));
  const occs = await Occurrence.find({ gridId }).select({ id: 1, moduleId: 1 }).lean();
  const moduleOf = new Map(occs.map(o => [o.id, o.moduleId]));

  let cleared = 0;
  for (const c of conts) {
    const content = (decompressTextmap(c.textmap) || {}).content;
    if (!Array.isArray(content) || !content.length) continue;
    const embeds = content.filter(n => n?.type === "moduleEmbed");
    if (!embeds.length) continue;

    const bad = embeds.filter((n) => {
      const target = n?.attrs?.occurrenceId;
      if (typeof target !== "string" || !target || target.startsWith("$")) return true;
      return roleOf.get(moduleOf.get(target)) !== "instance";
    });
    if (!bad.length) continue;

    log(`  ${c.id}: ${bad.length} of ${embeds.length} embed(s) do not name a task occurrence — emptying`);
    cleared++;
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: c.id }, {
        $set: { textmap: { type: "doc", content: [{ type: "paragraph" }] } },
      });
    }
  }

  log(cleared
    ? `${cleared} Tasks Completed container(s) ${dryRun ? "would be" : ""} emptied`
    : "every Tasks Completed container embeds only task occurrences — nothing to clear");
}
