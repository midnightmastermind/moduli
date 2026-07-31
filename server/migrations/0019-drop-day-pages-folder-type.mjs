// User, 2026-07-31: "the hard code shouldnt know its a daypage btw" → "yes get
// rid of the foldertype".
//
// `folderType: "day-pages"` was a domain concept sitting in a SCHEMA ENUM: the
// database declared that days are a thing this app has. A folder holding day
// pages is a normal folder that happens to be named "Day Pages" — the tree
// treats it identically either way, which is the tell that the value carried
// no behaviour, only knowledge.
//
// The enum value is gone from the model in the same commit, so any document
// still carrying it would now fail validation on its next save. This flips them
// to "normal". Nothing reads the value: the two migrations that looked a folder
// up by it now match on either the old type or the name, and no client code
// ever branched on it.
//
// The `manifestType: "day-pages"` enum entry went the same way, but no manifest
// was ever created with it, so there is nothing to migrate there.

export const id = "0019-drop-day-pages-folder-type";
export const describe =
  'Rewrites folderType "day-pages" → "normal". The value was removed from the Folder schema (a folder ' +
  "holding day pages is a normal folder named \"Day Pages\"); nothing reads it, and documents keeping it " +
  "would fail validation on their next save.";

export async function up({ gridId, models, log, dryRun }) {
  const { Folder } = models;

  const stale = await Folder.find({ gridId, folderType: "day-pages" }).select({ id: 1, name: 1 }).lean();
  if (!stale.length) { log('no folder carries folderType "day-pages"'); return; }

  for (const f of stale) log(`  "${f.name}" (${f.id}) → folderType "normal"`);
  if (!dryRun) {
    // updateMany with a plain $set bypasses the enum validator, which is what we
    // want: the value being written is valid, the one being replaced is not.
    await Folder.updateMany({ gridId, folderType: "day-pages" }, { $set: { folderType: "normal" } });
  }
  log(`${stale.length} folder(s) ${dryRun ? "would be" : ""} rewritten`);
}
