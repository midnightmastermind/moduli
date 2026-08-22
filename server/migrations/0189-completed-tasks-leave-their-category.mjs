/**
 * 0189 — a completed task leaves its category, and `hides` becomes a DECLARED flag everywhere.
 *
 * USER, 2026-08-22: *"tasks that are being completed in the task container (not dragged to
 * schedule though), is not moving to the completed section"* — then, on the design: *"i dont want
 * backwards compatible. that creates bug"*.
 *
 * ── THE FEED WAS ALREADY WORKING; THE ORIGINAL NEVER LEFT ───────────────────────────────────
 *
 * Measured before writing anything. All three completed tasks ARE in `Tasks › Completed`:
 *
 *     Emotional   Talk to Angela about Vivance   ✅        Completed   Talk to Angela   ✅ (copy)
 *     Emotional   Psych appointment with Angela  ✅        Completed   Psych appt      ✅ (copy)
 *     Financial   Sign up for foodstamps         ✅        Completed   Sign up …       ✅ (copy)
 *
 * So `96b0699a` fixed the reach `0180` filed. What the user is seeing is that the SOURCE stays put,
 * so a finished task shows in two places. `0179` tried MOVING the rows and `0180` retracted it —
 * `Completed` is a materialized FEED, and moving a source into it makes the feed sweep its own
 * copy. **So the answer has to hide the source, not move it**, which is a different mechanism.
 *
 * ── THERE WAS NO PER-CONTAINER WAY TO HIDE BY PREDICATE, AND ONE `hides` FLAG ADDS IT ───────
 *
 * `ModuleContainer` filters its children through `isOccurrenceVisible`, which already evaluates a
 * nested condition group against `$occ` — but `getLocalFilterConditions` dropped condition-bearing
 * entries on the floor, so no container could ask for it. It reads a declared `hides` now.
 *
 * ── NO IMPLICIT DEFAULT, WHICH IS THE USER'S RULE AND IT IS THE RIGHT ONE ───────────────────
 *
 * A flag whose ABSENCE means "the old behaviour" is two behaviours under one name — exactly the
 * inert-token class this repo keeps rediscovering. So the flag is DECLARED on every live entry,
 * and `localFilterHidesDeclared.test.js` fails the build if one ever lacks it.
 *
 * **The flag cannot simply be "all conditions hide", and the census is why.** Five filter entries
 * exist on the whole grid, four of them condition-bearing, and they do two different jobs:
 *
 *     Trackers  Tags        rescopes the NUMBERS      hides:false  <- 2026-08-20 (5): hiding by
 *     Trackers  Date        (inactive)                hides:false     Tags EMPTIES the page, because
 *     Schedule  Date        drives the nav            hides:false     Tags is mixed — nine wellness
 *     Day Page  Date        drives the nav            hides:false     dimensions among 45 live values
 *     Tasks     Completed   takes finished rows off   hides:true   <- NEW
 *
 * Every existing entry is stamped with the behaviour it ALREADY HAS, so this migration changes
 * nothing on screen except the Tasks page. One mechanism, two declared intents, no default.
 *
 * ── WHICH CONTAINERS GET THE RULE IS STRUCTURAL ────────────────────────────────────────────
 *
 * The category containers are "a container child of the Tasks page that is NOT feed-backed" —
 * never a list of the nine dimension names, which would miss `Paul's Website` (a real category the
 * user added) and would break on the tenth. The `Completed` container is excluded because it
 * carries a feed, which is the fact that makes it the destination rather than a source.
 *
 * `IS_NOT` compares as strings, so a row that has NEVER been ticked reads `"undefined" !== "true"`
 * and stays visible. That is the discriminating case — most tasks carry no value for `Completed`
 * at all, and hiding those would empty every category.
 */
export const id = "0189-completed-tasks-leave-their-category";
export const describe =
  "Hide completed tasks from their category container on the Tasks page, and stamp the `hides` flag on every existing condition filter with the behaviour it already has. Deletes nothing.";

const uid = () => Math.random().toString(36).slice(2, 14);

/** A container child of the Tasks page that is not itself feed-backed. */
export function taskCategories({ tasksPage, occs, modById }) {
  return (tasksPage?.occurrences || [])
    .map((id) => occs.find((o) => o.id === id))
    .filter((o) => o && modById.get(o.moduleId)?.role === "container" && !o.feed?.enabled);
}

export function hideCompletedEntry(completedFieldId) {
  return {
    id: `hide-completed-${uid()}`,
    active: true,
    hides: true,
    condition: { operator: "AND", rules: [
      { id: uid(), left: `$occ.fields.${completedFieldId}.value`, comparator: "IS_NOT", right: true },
    ] },
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const COMPLETED = fields.find((f) => f.name === "Completed")?.id;
  if (!COMPLETED) { log("  REFUSING: no `Completed` field on this grid"); return; }

  // ── 1. declare the flag on every EXISTING condition entry, preserving today's behaviour ──
  let stamped = 0;
  for (const o of occs) {
    const fs = o.filters || [];
    if (!fs.some((f) => f?.condition != null && typeof f.hides !== "boolean")) continue;
    const next = fs.map((f) =>
      (f?.condition != null && typeof f.hides !== "boolean") ? { ...f, hides: false } : f);
    log(`    ${nameOf(o)}: declaring hides:false on ${next.filter((f, i) => f !== fs[i]).length} entry/entries`);
    if (!dryRun) await Occurrence.updateOne({ id: o.id, gridId }, { $set: { filters: next } });
    stamped++;
  }
  log(`  ${stamped} occurrence(s) had undeclared condition filters — stamped hides:false (no behaviour change)`);

  // ── 2. the Tasks page's categories get the hiding rule ──────────────────────────────────
  const tasksPage = occs.find((o) => nameOf(o) === "Tasks" && modById.get(o.moduleId)?.role === "page");
  if (!tasksPage) { log("  REFUSING: no `Tasks` page on this grid"); return; }
  const cats = taskCategories({ tasksPage, occs, modById });
  const feedBacked = (tasksPage.occurrences || []).map((id) => occs.find((o) => o.id === id))
    .filter((o) => o?.feed?.enabled).map(nameOf);
  log(`  Tasks categories: ${cats.map(nameOf).join(", ")}`);
  log(`  excluded (feed-backed, the destination): ${feedBacked.join(", ") || "(none)"}`);

  let added = 0;
  for (const c of cats) {
    const has = (c.filters || []).some((f) => f?.hides === true
      && JSON.stringify(f.condition || {}).includes(COMPLETED));
    if (has) continue;
    const next = [...(c.filters || []), hideCompletedEntry(COMPLETED)];
    if (!dryRun) await Occurrence.updateOne({ id: c.id, gridId }, { $set: { filters: next } });
    added++;
  }
  log(`  ${added} category container(s) ${dryRun ? "would get" : "got"} the hide-completed rule`);
  if (!dryRun && (added || stamped)) log("  written — RESTART pm2 and reload.");
}
