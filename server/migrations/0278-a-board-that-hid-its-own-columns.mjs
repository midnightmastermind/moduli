/**
 * 0278 — the trello board has NEVER rendered its columns.
 *
 * Found by opening it. After `0277` repaired the embeds, all three project pages
 * painted — and the Kanban drew as an EMPTY container offering "Add new item",
 * on the template, on the pre-existing `Via Fluere` project, and on the freshly
 * cloned one alike. Its six columns exist in the data and render nowhere.
 *
 * **A board container draws its children from `occurrences[]`, and
 * `ModuleContainer` draws child CONTAINERS only when the module carries
 * `meta.allowChildContainers`.** The six kanban columns ARE containers. The flag
 * has never been on the Kanban module — so the board this whole feature is named
 * for has been blank since `buildProjectTemplate` was written.
 *
 * This is the defect that read as *"you got rid of my trackers"* on 2026-07-31
 * (2), where the tracker tiles were correctly parented and simply did not draw.
 * The data is right in every check anyone would run; only rendering it shows it.
 *
 * ── THE SCOPE IS STRUCTURAL AND THE CONTROL IS WHAT MAKES IT SAFE ───────────
 * Measured on poms grid, containers that HOLD container children:
 *
 *     board, WITH the flag       22      <- the healthy shape, 22 times over
 *     board, WITHOUT             3       <- all three are "Kanban"
 *     doc,   WITH               127
 *     doc,   WITHOUT             89      <- correctly untouched
 *
 * **The 89 doc containers are deliberately excluded, and that is the whole
 * safety of this migration.** A `kind:"doc"` container renders its TEXTMAP, not
 * its child list — its children appear through `moduleEmbed` nodes — so the flag
 * is meaningless there and setting it would change how 89 live containers behave
 * to fix a problem they do not have. The rule names no module and no label: a
 * BOARD-kind container module that holds container children and lacks the flag.
 *
 * Idempotent — a module that already carries the flag is skipped. Adds one meta
 * key; deletes nothing.
 */

export const id = "0278-a-board-that-hid-its-own-columns";
export const describe = "Set meta.allowChildContainers on board-kind container modules that hold container children — without it a board renders none of them, which is why the project kanban was always empty. Adds one meta key; deletes nothing.";
export const touches = ["modules"];

/**
 * Module ids that need the flag.
 *
 * BOARD-kind only. A doc container renders its textmap, so the flag does nothing
 * there — including them would change 89 live containers to fix nothing.
 */
export function planAllowChildContainers(occurrences, modulesById) {
  const occById = Object.fromEntries(occurrences.map(o => [o.id, o]));
  const need = new Map();   // moduleId → { label, placements, hiddenChildren }
  for (const o of occurrences) {
    const m = modulesById[o.moduleId];
    if (m?.role !== "container") continue;
    if (m.kind !== "board" && m.kind !== "list") continue;      // list IS board (the standing rule)
    if (m.meta?.allowChildContainers === true) continue;
    const containerKids = (o.occurrences || [])
      .map(c => occById[c])
      .filter(k => modulesById[k?.moduleId]?.role === "container");
    if (!containerKids.length) continue;
    const e = need.get(m.id) || { moduleId: m.id, label: m.label ?? "(unnamed)", placements: 0, hiddenChildren: 0 };
    e.placements++;
    e.hiddenChildren += containerKids.length;
    need.set(m.id, e);
  }
  return [...need.values()];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  const plan = planAllowChildContainers(occs, modulesById);

  // THE CONTROL, printed first: the healthy shape has to be shown to exist, or
  // "3 need it" is a claim about the query rather than about the grid.
  const healthy = new Set();
  for (const o of occs) {
    const m = modulesById[o.moduleId];
    if (m?.role === "container" && (m.kind === "board" || m.kind === "list") && m.meta?.allowChildContainers === true
        && (o.occurrences || []).some(c => modulesById[occs.find(x => x.id === c)?.moduleId]?.role === "container")) healthy.add(m.id);
  }
  log(`  board containers holding containers — already correct ${healthy.size} · MISSING the flag ${plan.length}`);
  if (!plan.length) { log("  every board that holds containers can render them — already converged"); return; }
  for (const p of plan) log(`      "${p.label}" (${p.moduleId.slice(0, 10)}) — ${p.placements} placement(s), ${p.hiddenChildren} container child(ren) that render nowhere`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const p of plan) {
    await Module.updateOne({ gridId, id: p.moduleId }, { $set: { "meta.allowChildContainers": true } });
  }
  log(`  done — ${plan.length} module(s) can render their child containers`);
}
