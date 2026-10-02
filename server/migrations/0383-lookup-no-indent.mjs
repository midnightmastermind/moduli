// 0383 — the Lookup board's textblocks lose the first-line indent.
//
// User, 2026-10-02: *"for all those lookups, can you get rid of the beginning
// tabbed space"*. The space is the book-style `text-indent` every block textblock
// gets; the text itself starts clean (0382 wrote it trimmed). The container
// carries `meta.textIndent: false`, which ModuleContainer turns into the
// `.text-flush` class — so lookups added later are flush too. Dotted `$set`, so
// no other key on the container's meta is touched.

export const id = "0383-lookup-no-indent";
export const describe = "Set meta.textIndent=false on the Lookup container so its textblocks have no first-line indent.";
export const touches = ["modules"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;
  const mods = await Module.find({ gridId: String(gridId), role: "container", label: "Lookup" }, { id: 1, meta: 1 }).lean();
  if (mods.length !== 1) throw new Error(`expected one Lookup container module, found ${mods.length}`);
  if (mods[0].meta?.textIndent === false) { log("already flush"); return; }
  log(`Lookup container module ${mods[0].id}: meta.textIndent = false`);
  if (dryRun) return;
  await Module.updateOne({ id: mods[0].id }, { $set: { "meta.textIndent": false } });
}
