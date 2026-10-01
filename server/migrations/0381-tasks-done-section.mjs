// 0381 — a "Done" section at the bottom of the Tasks page.
//
// User, 2026-10-01, after deleting four finished tasks by accident: *"i need a
// done section to drag those to in the tasks section as well (at the bottom)
// instead of deleting them, cause right now its linked to the completed page,
// so it will remove it there as well"*. Deleting a task deletes its module, so
// its linked copy on the Completed page goes too.
//
// A drag into Done is a MOVE, and it keeps the task on the Completed page: that
// page's container is a FEED scoped to the whole Tasks page (`feed.scope` =
// the page) on "Completed is ticked", not to any one area container. So Done
// only has to live on the Tasks page. Shaped exactly like its siblings (a plain
// board container, e.g. "Appointments"); no colour — it is not a life area.
// Idempotent: a page that already has a "Done" container is left alone.

import { randomUUID } from "node:crypto";

export const id = "0381-tasks-done-section";
export const describe = "Add a plain 'Done' board container at the bottom of the Tasks page, inside the Completed feed's scope.";
export const touches = ["occurrences", "modules"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);
  // TWO pages are named "Tasks" on poms grid (one is an empty duplicate), so the
  // name does not identify it. The one that matters is the page the Completed
  // feed is scoped to — that scope is the whole reason Done must live there.
  const pageMods = await Module.find({ gridId: gid, role: "page", label: "Tasks" }, { id: 1 }).lean();
  const candidates = await Occurrence.find({ gridId: gid, moduleId: { $in: pageMods.map((m) => m.id) } }).lean();
  const scoped = await Occurrence.find({ gridId: gid, "feed.enabled": true, "feed.scope": { $in: candidates.map((c) => c.id) } }, { feed: 1 }).lean();
  const scopeIds = new Set(scoped.map((f) => f.feed.scope));
  const fed = candidates.filter((c) => scopeIds.has(c.id));
  if (fed.length !== 1) throw new Error(`expected exactly one Tasks page scoped by a feed, found ${fed.length}`);
  const page = fed[0];
  const kids = await Occurrence.find({ gridId: gid, id: { $in: page.occurrences || [] } }, { moduleId: 1 }).lean();
  const kidMods = await Module.find({ gridId: gid, id: { $in: kids.map((k) => k.moduleId) } }, { label: 1 }).lean();
  if (kidMods.some((m) => m.label === "Done")) { log("Tasks already has a Done section"); return; }
  const modId = randomUUID(), occId = randomUUID();
  log(`Tasks (${page.id}): + Done container ${occId}, after ${(page.occurrences || []).length} sections`);
  if (dryRun) return;
  await Module.create({ id: modId, userId: page.userId, gridId: gid, role: "container", kind: "board", label: "Done", fieldBindings: [], meta: {} });
  await Occurrence.create({ id: occId, userId: page.userId, gridId: gid, moduleId: modId, parentId: page.id, occurrences: [], fields: {}, meta: {} });
  await Occurrence.updateOne({ id: page.id }, { $push: { occurrences: occId } });
}
