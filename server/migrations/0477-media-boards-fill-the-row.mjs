// 0477 — every media board's tiles fill the panel's width, like the Books board and the Trackers (user, 2026-10-31:
// "make sure that like trackers, the media boards follow the same extend the width of the panel styling rule (i
// noticed tv doesnt have that)"). `childFill` (Layout › Fill the row, 2026-10-19) was on for Books only; Movies,
// TV Series, Games, Comics, Songs, Artists and Albums laid out the same 184px grid with a gap at the end of each row.
// Sets `meta.layoutCascadeOverride.childFill = true` on every WRAP-mode board container on a page under
// Boards › Media that lacks it (dotted $set, the rest of the layout untouched). List boards already span the width.
// `childFillLast` is NOT set: a lone last poster would stretch to the whole row (0456's reason it is opt-in).
export const id = "0477-media-boards-fill-the-row";
export const describe = "Media board grids fill the row (Layout › Fill the row), like Books.";
export const touches = ["occurrences"];

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Occurrence, Module } = models;
  const folders = await Folder.find({ gridId }).lean();
  const byId = new Map(folders.map((f) => [f.id, f]));
  const media = folders.find((f) => f.name === "Media" && byId.get(f.parentId)?.name === "Boards");
  if (!media) throw new Error("no Boards › Media folder");
  const under = (fid) => { for (let f = byId.get(fid); f; f = byId.get(f.parentId)) if (f.id === media.id) return true; return false; };
  const pages = await Occurrence.find({ gridId, parentId: { $in: folders.filter((f) => under(f.id)).map((f) => f.id) } }).lean();
  const kidIds = pages.flatMap((p) => p.occurrences || []);
  const kids = await Occurrence.find({ gridId, id: { $in: kidIds } }).lean();
  const mods = new Map((await Module.find({ gridId, id: { $in: kids.map((k) => k.moduleId) } }).select("id role label").lean()).map((m) => [m.id, m]));
  const todo = kids.filter((c) => mods.get(c.moduleId)?.role === "container"
    && c.meta?.layoutCascadeOverride?.mode === "wrap" && c.meta.layoutCascadeOverride.childFill !== true);
  log(`  ${todo.length} grids: ${todo.map((c) => mods.get(c.moduleId)?.label).join(", ") || "none"}`);
  if (dryRun || !todo.length) return;
  await Occurrence.updateMany({ gridId, id: { $in: todo.map((c) => c.id) } },
    { $set: { "meta.layoutCascadeOverride.childFill": true, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
