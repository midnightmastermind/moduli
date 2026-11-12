// 0493 — the unorganized Lookup board's notes move into a "Miscellaneous" section at the bottom of the organized one,
// and the original Lookup page + board are deleted.
//
// User 2026-11-12: "put all those textblocks inside of a container called miscellanious inside the more organized
// lookup board at the bottom" · "and delete the original then". The organized board is the "Lookup / Catch-All List"
// doc container; its sections are doc containers embedded (moduleEmbed) in its textmap and listed by it, so the new
// section is built the same way and its textblocks are embedded in ITS textmap in board order. The notes keep their ids
// (and their 0492 annotation quotes, which they own). Then the original board + page are deleted, their modules with
// them (each placed once), and the page is pulled from every list that names it (a panel's pinned pages).
// Refuses if anything else still references either — checked across operations, fields, views, grids, folders.
export const id = "0493-lookup-notes-into-miscellaneous";
export const describe = "Lookup notes move into a Miscellaneous section of the organized Lookup; the original board is deleted.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

const read = (tm) => { try { return tm ? decompressTextmap(tm) : null; } catch { return null; } };

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence } = models;
  const G = String(gridId);
  const grid = await Grid.findById(gridId).select("userId").lean();

  const catchMods = await Module.find({ gridId: G, label: "Lookup / Catch-All List", role: "container" }).select("id").lean();
  const catchAlls = await Occurrence.find({ gridId: G, moduleId: { $in: catchMods.map((m) => m.id) } }).lean();
  if (catchAlls.length !== 1) throw new Error(`0493: expected one "Lookup / Catch-All List", found ${catchAlls.length}`);
  const catchAll = catchAlls[0];

  const boardMods = await Module.find({ gridId: G, label: "Lookup", role: "container", kind: "board" }).select("id").lean();
  const boards = (await Occurrence.find({ gridId: G, moduleId: { $in: boardMods.map((m) => m.id) } }).lean())
    .sort((a, b) => (b.occurrences || []).length - (a.occurrences || []).length);
  const board = boards[0];
  if (!board || (board.occurrences || []).length < 200) {
    const done = await Module.findOne({ gridId: G, label: "Miscellaneous", "meta.fromLookupBoard": true }).lean();
    if (done) { log("  already moved"); return { moved: 0 }; }
    throw new Error("0493: the unorganized Lookup board was not found");
  }
  const page = await Occurrence.findOne({ gridId: G, id: board.parentId }).lean();
  if (!page) throw new Error("0493: the board's page was not found");
  const notes = board.occurrences.slice();
  const found = await Occurrence.countDocuments({ gridId: G, id: { $in: notes } });
  if (found !== notes.length) throw new Error(`0493: the board lists ${notes.length} notes, ${found} exist`);

  // Anything else that still points at the board or its page?
  const dead = [board.id, page.id];
  const db = Occurrence.db;
  for (const c of ["operations", "fields", "views", "grids", "folders"]) {
    const hits = (await db.collection(c).find({ gridId: { $in: [G, gridId] } }).toArray()).filter((d) => dead.some((i) => JSON.stringify(d).includes(i)));
    if (hits.length) throw new Error(`0493: ${c} still reference the original Lookup (${hits.map((h) => h.name || h.id).join(", ")})`);
  }
  const listers = await Occurrence.find({ gridId: G, occurrences: { $in: dead }, id: { $nin: dead } }).select("id").lean();
  const stray = await Occurrence.countDocuments({ gridId: G, parentId: { $in: dead }, id: { $nin: [...notes, board.id] } });
  if (stray) throw new Error(`0493: ${stray} other occurrence(s) are parented to the original Lookup`);

  log(`  ${notes.length} notes -> new "Miscellaneous" at the bottom of "Lookup / Catch-All List" (${catchAll.id})`);
  log(`  delete board ${board.id} + page ${page.id}; unlist the page from ${listers.length} list(s)`);
  if (dryRun) return { notes: notes.length };

  const userId = String(grid?.userId || catchAll.userId || "");
  const modId = randomUUID(), occId = randomUUID();
  await Module.create({ id: modId, userId, gridId: G, role: "container", kind: "doc", label: "Miscellaneous",
    fieldBindings: [], meta: { allowChildContainers: true, headingLevel: 2, fromLookupBoard: true } });
  await Occurrence.create({ id: occId, userId, gridId: G, moduleId: modId, parentId: catchAll.id, occurrences: notes, fields: {}, meta: {},
    textmap: compressTextmap({ type: "doc", content: notes.map((n) => ({ type: "moduleEmbed", attrs: { occurrenceId: n } })) }) });
  await Occurrence.updateMany({ gridId: G, id: { $in: notes } }, { $set: { parentId: occId, updatedAt: new Date() } });

  const doc = read(catchAll.textmap) || { type: "doc", content: [] };
  doc.content = [...(doc.content || []), { type: "moduleEmbed", attrs: { occurrenceId: occId, align: "full", width: null } }];
  await Occurrence.updateOne({ gridId: G, id: catchAll.id }, { $set: { textmap: compressTextmap(doc), updatedAt: new Date() }, $addToSet: { occurrences: occId } });

  await Occurrence.updateMany({ gridId: G, occurrences: { $in: dead } }, { $pull: { occurrences: { $in: dead } } });
  await Occurrence.deleteMany({ gridId: G, id: { $in: dead } });
  for (const m of [board.moduleId, page.moduleId]) {
    if (!(await Occurrence.countDocuments({ gridId: G, moduleId: m }))) await Module.deleteOne({ gridId: G, id: m });
  }
  return { moved: notes.length };
}
