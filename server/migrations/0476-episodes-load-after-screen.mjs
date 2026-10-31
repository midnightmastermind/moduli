// 0476 — episodes and seasons load after the screen (user, 2026-10-31: "load after the screen" · "lets try to drop
// down that time"). 14,787 episodes + 909 seasons were plain rows, so all 20 MB of them rode in the FIRST message
// (48 MB, rows at 11.6s on a fresh browser). The first message holds back exactly one thing: rows whose module is
// `role: "artifact"` (server/utils/splitFullState) — the catalogue, which is what TV shows and albums already are.
// So the Episode and Season modules become artifacts (kind "episode" / "season"), and the three dropdowns that list
// them read every item instead of instances only. Nothing else reads their role: the counts and drill buttons name
// their modules, the sync reuses the module of the rows already there.
export const id = "0476-episodes-load-after-screen";
export const describe = "Episode and Season modules become catalogue rows (role artifact) so they load after the screen; TV Season / Episode / Episode List options read $allItems.";
export const touches = ["fields", "modules"];

const FIELDS = [["TV Season", "occurrence"], ["Episode", "occurrence"], ["Episode List", "occurrence"]];

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;
  const ep = await Occurrence.findOne({ gridId, identitySignature: "tv:episodes" }).lean();
  const se = await Occurrence.findOne({ gridId, identitySignature: "tv:seasons" }).lean();
  const mods = [[ep?.meta?.episodeModuleId, "episode"], [se?.meta?.seasonModuleId, "season"]];
  if (mods.some(([id]) => !id)) throw new Error("run 0472/0473 first");
  const fields = [];
  for (const [name, type] of FIELDS) {
    const f = await Field.findOne({ gridId, name, type }).lean();
    if (!f) throw new Error(`no ${name} field`);
    fields.push(f);
  }
  for (const [id, kind] of mods) {
    const m = await Module.findOne({ gridId, id }).lean();
    const n = await Occurrence.countDocuments({ gridId, moduleId: id });
    log(`  ${m.label}: ${m.role}/${m.kind || "-"} -> artifact/${kind} (${n} rows)`);
  }
  log(`  options -> $allItems: ${fields.map((f) => `${f.name} (${f.meta?.optionsSource?.over})`).join(", ")}`);
  if (dryRun) return;
  const now = new Date();
  for (const [id, kind] of mods) await Module.updateOne({ gridId, id }, { $set: { role: "artifact", kind, updatedAt: now } });
  for (const f of fields) await Field.updateOne({ gridId, id: f.id }, { $set: { "meta.optionsSource.over": "$allItems", updatedAt: now } });
  log("  applied. RESTART pm2.");
}
