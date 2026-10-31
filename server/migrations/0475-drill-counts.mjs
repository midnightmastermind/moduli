// 0475 — counts on the boards you drill through (user, 2026-10-31: "we should have counts like the tv too on the
// drilldown ones to show how many there are" · "yes to the extra operation step").
//   artist: Album Count, Song Count   album: Song Count   author: Book Count   show: Season Count, Episode Count
//   season: Episode Count   meal: Ingredient Count
// Each count is an operation of one COUNT_BY step ("count by field": one pass over the rows, counting each value of
// the link field the children carry, written on the parent rows of the named modules). It runs on load, when a row
// is added to or removed from the child board, and when the link field changes. The counts are filled here too, so
// the first load writes none of them.
import { randomUUID } from "node:crypto";
import { BOARDS } from "./0474-board-drill-buttons.mjs";

export const id = "0475-drill-counts";
export const describe = "Count fields on drill-down parents (albums/songs per artist, songs per album, books per author, seasons/episodes per show, episodes per season, ingredients per meal), each kept by a COUNT_BY operation.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const BC = "uew6sn6WWXin", ARTIST = "8wotshpcdlog", ALBUM = "9i0yaflshggo", AUTHOR = "d5nhkf8nvkw4";
export const relations = (f) => [
  { name: "Album Count", by: ARTIST, child: "albums", parent: "artists", op: "Count: Albums per Artist" },
  { name: "Song Count", by: ARTIST, child: "songs", parent: "artists", op: "Count: Songs per Artist" },
  { name: "Song Count", by: ALBUM, child: "songs", parent: "albums", op: "Count: Songs per Album" },
  { name: "Book Count", by: AUTHOR, child: "books", parent: "authors", op: "Count: Books per Author" },
  { name: "Season Count", by: f.show, child: "seasons", parent: "shows", op: "Count: Seasons per Show" },
  { name: "Episode Count", by: f.show, child: "episodes", parent: "shows", op: "Count: Episodes per Show" },
  { name: "Episode Count", by: f.season, child: "episodes", parent: "seasons", op: "Count: Episodes per Season" },
  { name: "Ingredient Count", by: f.inMeals, child: "ingredients", parent: "meals", op: "Count: Ingredients per Meal" },
];

/** { parentId: n } over the child rows. Pure. */
export function countBy(rows, byField) {
  const out = {};
  for (const r of rows) {
    const c = r.fields?.[byField]; const v = c && typeof c === "object" && "value" in c ? c.value : c;
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && id) out[id] = (out[id] || 0) + 1;
  }
  return out;
}

const catsOf = (o) => { const v = o?.fields?.[BC]?.value; return Array.isArray(v) ? v : v ? [v] : []; };

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const now = new Date();
  const fields = await Field.find({ gridId }).lean();
  const byName = (n, t) => fields.find((x) => x.name === n && x.type === t && !x.displayEnabled);
  const f = { show: byName("TV Show", "occurrence")?.id, season: byName("TV Season", "occurrence")?.id, inMeals: byName("In Meals", "occurrence")?.id };
  if (!f.show || !f.season || !f.inMeals) throw new Error("run 0472-0474 first");
  const boards = { ...BOARDS };
  for (const [k, sig] of [["episodes", "tv:episodes"], ["seasons", "tv:seasons"]]) {
    const b = await Occurrence.findOne({ gridId, identitySignature: sig }).lean();
    boards[k] = { ...boards[k], cont: b.id, page: b.parentId };
  }
  const rowsOf = {};
  for (const [key, b] of Object.entries(boards)) {
    const cont = await Occurrence.findOne({ gridId, id: b.cont }).lean();
    rowsOf[key] = (await Occurrence.find({ gridId, id: { $in: cont?.occurrences || [] }, "meta.feedSourceId": { $exists: false } }).lean())
      .filter((r) => catsOf(r).includes(b.cat));
  }
  const modsOf = (key) => [...new Set(rowsOf[key].map((r) => r.moduleId))];
  const folder = fields.find((x) => x.name === "Episodes" && x.type === "number")?.folderId || null;
  const created = [];
  const countField = (name) => byName(name, "number") || (() => { const x = { id: randomUUID(), userId, gridId, name, type: "number", folderId: folder, inputEnabled: true, displayEnabled: false, meta: {} }; created.push(x); fields.push(x); return x; })();
  const rels = relations(f).map((r) => ({ ...r, to: countField(r.name).id }));

  const writes = new Map();   // rowId -> { fieldId: n }
  for (const r of rels) {
    const counts = countBy(rowsOf[r.child], r.by);
    for (const p of rowsOf[r.parent]) {
      if (!writes.has(p.id)) writes.set(p.id, {});
      writes.get(p.id)[r.to] = counts[p.id] || 0;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    log(`  ${r.op}: ${rowsOf[r.parent].length} ${r.parent}, ${total} ${r.child} counted`);
  }
  log(`  fields new: ${created.map((x) => x.name).join(", ") || "none"} · rows to write: ${writes.size}`);
  if (dryRun) return;

  if (created.length) await Field.insertMany(created.map((x) => ({ ...x, createdAt: now, updatedAt: now })));
  // bind each count on its parents' modules (visible)
  for (const r of rels) for (const mid of modsOf(r.parent)) {
    const m = await Module.findOne({ gridId, id: mid }).lean();
    if (!(m.fieldBindings || []).some((b) => b.fieldId === r.to)) {
      await Module.updateOne({ gridId, id: mid }, { $push: { fieldBindings: { fieldId: r.to, role: "input", order: (m.fieldBindings || []).length } } });
    }
  }
  const ops = [];
  for (const [id, set] of writes) ops.push({ updateOne: { filter: { gridId, id }, update: { $set: Object.fromEntries(Object.entries(set).map(([fid, n]) => [`fields.${fid}`, { value: n, flow: "in" }])) } } });
  for (let i = 0; i < ops.length; i += 1000) await Occurrence.bulkWrite(ops.slice(i, i + 1000));

  const existing = await Operation.find({ gridId }).lean();
  const opFolder = existing.find((o) => o.name === "Music: Show Albums")?.folderId || null;
  for (const r of rels) {
    const pipeline = { sources: [], steps: [{ id: randomUUID(), type: "action", config: { type: "COUNT_BY", byField: r.by, to: r.to,
      ofModules: modsOf(r.child), toModules: modsOf(r.parent), over: "$allItems" } }] };
    const childPage = boards[r.child].page;
    const triggerObjects = [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 6 },
      { eventType: "onAdd", subjectType: "module", targetId: "", ancestorId: childPage, priority: 6 },
      { eventType: "onDelete", subjectType: "module", targetId: "", ancestorId: childPage, priority: 6 },
      { eventType: "onChange", subjectType: "field", targetId: r.by, priority: 6 },
    ];
    const types = [...new Set(triggerObjects.map((t) => t.eventType))];
    const doc = { name: r.op, description: `${r.name} on each ${r.parent.replace(/s$/, "")}: how many ${r.child} point at it (0475).`,
      pipeline, triggerObjects, triggerTypes: types, triggerType: types[0], enabled: true, updatedAt: now };
    const hit = existing.find((o) => o.name === r.op);
    if (hit) await Operation.updateOne({ gridId, id: hit.id }, { $set: doc });
    else await Operation.create({ id: randomUUID(), userId, gridId, folderId: opFolder, ...doc });
  }
  log("  applied. RESTART pm2.");
}
