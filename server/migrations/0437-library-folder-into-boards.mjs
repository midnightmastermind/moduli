// 0437 — the Library folder goes (user, 2026-10-26: "move those to its relevant spots and get rid of the library
// folder. move those to boards folder"). Its two boards move into Boards/Mind beside Readings / Verses / Courses —
// Daily Journal Questions (the Day Page's question bank) and Emotions (the Emotions Wheel's board); ops and feeds find
// them by their own ids, so a move changes nothing they read. Then what is left is empty and goes: the empty
// "Library" board page (no board on it), the Lookup subfolder (emptied when its board moved to Documents/Notes), the
// Library folder, and their folder pages. "Import from Wikipedia" offered Library as a destination; that choice is
// removed so it can never file into a folder that no longer exists.
export const id = "0437-library-folder-into-boards";
export const describe = "Moves Daily Journal Questions and Emotions into Boards/Mind; deletes the empty Library page, the Lookup subfolder, the Library folder (and their folder pages); removes Library from Import from Wikipedia's folder choices.";
export const touches = ["folders", "occurrences", "modules", "operations"];

const LIBRARY = "kHPj9xWGmXZR", LOOKUP = "hqvsjexu99", MIND = "7JS80jmO0H61";
const MOVE = ["aeTvCYEH9BPH", "3503ac3d-6792-4ca4-80cc-983918d82475"];   // Daily Journal Questions, Emotions
const EMPTY_PAGE = "RIBnFo8lcLre";                                       // the "Library" board page (nothing on it)

/** A pipeline with the Library choice removed from every select question. Pure. */
export function withoutChoice(steps, value) {
  return (steps || []).map((s) => {
    const out = { ...s };
    if (s.config?.options?.some?.((o) => o?.value === value)) out.config = { ...s.config, options: s.config.options.filter((o) => o?.value !== value) };
    for (const k of ["then", "else", "body"]) if (Array.isArray(s[k])) out[k] = withoutChoice(s[k], value);
    return out;
  });
}

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Occurrence, Module, Operation } = models;
  for (const fid of [LIBRARY, LOOKUP, MIND]) if (!(await Folder.exists({ gridId, id: fid }))) { log(`  REFUSED: folder ${fid} is not on this grid`); throw new Error("missing folder"); }
  if (await Folder.exists({ gridId, parentId: { $in: [LIBRARY, LOOKUP] }, id: { $ne: LOOKUP } })) throw new Error("Library or Lookup holds another folder");
  // What may be in the two folders when they go: the two boards that move, the empty page, and the folder pages.
  const inside = await Occurrence.find({ gridId, parentId: { $in: [LIBRARY, LOOKUP] } }).lean();
  const mods = new Map((await Module.find({ gridId, id: { $in: inside.map((o) => o.moduleId) } }).lean()).map((m) => [m.id, m]));
  const folderPages = inside.filter((o) => mods.get(o.moduleId)?.kind === "folder");
  const stray = inside.filter((o) => !MOVE.includes(o.id) && o.id !== EMPTY_PAGE && !folderPages.includes(o));
  if (stray.length) { log(`  REFUSED: the Library folder holds more than expected: ${stray.map((o) => o.label || mods.get(o.moduleId)?.label).join(", ")}`); throw new Error("not empty"); }
  const page = inside.find((o) => o.id === EMPTY_PAGE);
  if (page && (page.occurrences || []).length) throw new Error("the Library page is not empty");
  const mindCount = await Occurrence.countDocuments({ gridId, parentId: MIND });
  const op = await Operation.findOne({ gridId, name: "Import from Wikipedia" }).lean();
  const opMentions = op ? (JSON.stringify(op.pipeline).match(new RegExp(LIBRARY, "g")) || []).length : 0;
  log(`  move into Boards/Mind: ${inside.filter((o) => MOVE.includes(o.id)).map((o) => o.label || mods.get(o.moduleId)?.label).join(", ")}`);
  log(`  delete: the empty "Library" page, ${folderPages.length} folder pages, folders Lookup + Library`);
  log(`  Import from Wikipedia: drop the Library choice (${opMentions} mention)`);
  if (dryRun) return;

  const now = new Date();
  let order = mindCount;
  for (const id of MOVE) await Occurrence.updateOne({ gridId, id }, { $set: { parentId: MIND, sortOrder: order++, updatedAt: now } });
  const gone = [EMPTY_PAGE, ...folderPages.map((o) => o.id)];
  const goneMods = [page?.moduleId, ...folderPages.map((o) => o.moduleId)].filter(Boolean);
  await Occurrence.updateMany({ gridId, occurrences: { $in: gone } }, { $pull: { occurrences: { $in: gone } }, $set: { updatedAt: now } });
  await Occurrence.deleteMany({ gridId, id: { $in: gone } });
  for (const mid of goneMods) if (!(await Occurrence.exists({ gridId, moduleId: mid }))) await Module.deleteOne({ gridId, id: mid });
  await Folder.deleteMany({ gridId, id: { $in: [LOOKUP, LIBRARY] } });
  if (op && opMentions) await Operation.updateOne({ gridId, id: op.id }, { $set: { "pipeline.steps": withoutChoice(op.pipeline.steps, LIBRARY), updatedAt: now } });
  const left = await Occurrence.countDocuments({ gridId, parentId: { $in: [LIBRARY, LOOKUP] } });
  if (left) throw new Error(`${left} occurrence(s) still name the deleted folders`);
  log(`  applied. RESTART pm2.`);
}
