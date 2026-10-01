// 0373 — reorganize poms grid's manifest (user, 2026-10-01: "reorganize the
// manifest folders and pages … tons of things are in seperate folders that
// should be consolidated. dont touch codex, keep that intact but put it
// somewhere that makes sense. put Daypage in the interface folder" → the
// proposal, "tasks and routines and tasks completed should be in the same
// folder too" → "yes apply that").
//
//   Interfaces   Schedule · Schedule Table · Day Page · Trackers · Schedule Types
//                └ Tasks  Tasks · Completed · Routines
//   Boards       the 8 areas; Media gains Mind's "Media" board, YouTube; Body gains Health;
//                Money gains Bills
//   Projects     + Creative's "Projects" board
//   Library      Emotions · Daily Journal Questions · Lookup/ · Interests/ · Reading/
//                Reading = Bookmarks + the 19 unfiled web pages + one Watts article
//   Documents    Notes · Archive/Codex (Codex untouched inside)
//   Files        Images regrouped by area (People kept), Examples moved in
//   Imports · Templates   unchanged
//
// DELETES, all checked empty of content before they go:
//   folders  Day Pages, Trackers, Tasks/Daily Toolkit, New Folder, the 11
//            Interests/* subfolders, the 31 small Files/Images/* subfolders
//            — each holding ONLY its folder page(s) once its contents moved
//   pages    those folders' own folder pages; 2 duplicate Watts article pages
//            (the copy you edited is kept)
//
// Everything is found by its exact path and the migration throws if a step's
// target is missing or ambiguous. Moves only rewrite parentId, so operations —
// which point at folders and pages by id — keep working. Idempotent: a re-run
// finds everything already where it goes.

export const id = "0373-reorganize-manifest";
export const describe = "Reorganize the manifest (Interfaces / Boards / Projects / Library / Documents / Files). DELETES only emptied folders (Day Pages, Trackers, Daily Toolkit, New Folder, 11 Interests subfolders, 31 small Images subfolders), their folder pages, and 2 duplicate Watts article pages.";
export const touches = ["folders", "occurrences", "modules"];

export const IMAGE_AREAS = {
  Food: ["Beverages", "Groceries", "Ingredients", "Supplements"],
  Mind: ["Courses", "Ideas", "Practices", "Prompts", "Readings", "Skills", "Topics", "Verses"],
  Social: ["Events", "Gratitudes", "Leisures", "Places", "Wins"],
  Home: ["Areas", "Equipments", "Plants"],
  Money: ["Charities", "Gifts", "Savingsgoals", "Wishlists"],
  Creative: ["Creativeworks", "Mediums", "Projects"],
  Body: ["Routes"],
  Media: ["Media", "Movies", "Podcasts"],
};
const WATTS_KEEP = "cfef1e29";                    // the root copy whose doc you edited
const WATTS_DROP = ["16eec15c", "f92ce082"];
const ROOT_ORDER = ["Interfaces", "Boards", "Projects", "Library", "Documents", "Files", "Imports", "Templates"];

const newId = () => Math.random().toString(36).slice(2, 14);

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Occurrence, Module, View } = models;
  const gid = String(gridId);
  let folders = await Folder.find({ gridId: gid }).lean();
  const byId = () => new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id) => { const m = byId(); const out = []; let f = m.get(id); for (let i = 0; f && i < 20; i++) { out.unshift(f.name); f = m.get(f.parentId); } return out.join("/"); };
  const at = (p, { optional = false } = {}) => {
    const hits = folders.filter((f) => pathOf(f.id) === p);
    if (hits.length > 1) throw new Error(`ambiguous folder ${p}`);
    if (!hits.length && !optional) throw new Error(`no folder ${p}`);
    return hits[0] || null;
  };
  const ops = [];   // human log of the plan
  const write = async (fn) => { if (!dryRun) await fn(); };

  const ensureFolder = async (parentPath, name, sortOrder = 0) => {
    const existing = at(`${parentPath}/${name}`, { optional: true });
    if (existing) return existing;
    const parent = at(parentPath);
    const f = { id: newId(), userId: parent.userId, gridId: gid, parentId: parent.id, name, sortOrder, folderType: "normal", isExpanded: false };
    ops.push(`create folder ${parentPath}/${name}`);
    await write(() => Folder.create(f));
    folders.push(f);
    return f;
  };
  const moveFolder = async (from, toParent, name = null) => {
    const leaf = name || from.split("/").pop();
    if (at(`${toParent}/${leaf}`, { optional: true })) return;          // already moved
    const f = at(from); const p = at(toParent);
    ops.push(`move folder ${from} -> ${toParent}/`);
    await write(() => Folder.updateOne({ id: f.id }, { $set: { parentId: p.id } }));
    f.parentId = p.id;
  };
  const pagesIn = async (folder) => {
    const rows = await Occurrence.find({ parentId: folder.id }, { id: 1, moduleId: 1, label: 1 }).lean();
    const mods = new Map((await Module.find({ id: { $in: rows.map((r) => r.moduleId) } }, { id: 1, role: 1, kind: 1, label: 1 }).lean()).map((m) => [m.id, m]));
    return rows.map((r) => ({ ...r, mod: mods.get(r.moduleId), name: r.label || mods.get(r.moduleId)?.label }));
  };
  const movePageNamed = async (fromPath, name, toPath) => {
    const to = at(toPath);
    const already = (await pagesIn(to)).filter((r) => r.mod?.role === "page" && r.mod?.kind !== "folder" && r.name === name);
    const from = at(fromPath, { optional: true });
    const hits = from ? (await pagesIn(from)).filter((r) => r.mod?.role === "page" && r.mod?.kind !== "folder" && r.name === name) : [];
    if (!hits.length) { if (already.length) return; throw new Error(`no page "${name}" in ${fromPath}`); }
    if (hits.length > 1) throw new Error(`ambiguous page "${name}" in ${fromPath}`);
    ops.push(`move page ${fromPath}/"${name}" -> ${toPath}/`);
    await write(() => Occurrence.updateOne({ id: hits[0].id }, { $set: { parentId: to.id } }));
  };
  // Delete an occurrence (and its module when nothing else uses it), unlisting
  // it from every parent and clearing any view that has it open.
  const deleteOcc = async (occ) => {
    ops.push(`delete page "${occ.name}" (${occ.id.slice(0, 8)})`);
    await write(async () => {
      await Occurrence.updateMany({ occurrences: occ.id }, { $pull: { occurrences: occ.id } });
      await View.updateMany({ activeOccurrenceId: occ.id }, { $set: { activeOccurrenceId: null } });
      await Occurrence.deleteOne({ id: occ.id });
      if (occ.moduleId && !(await Occurrence.exists({ moduleId: occ.moduleId }))) await Module.deleteOne({ id: occ.moduleId });
    });
  };
  // A folder may go only when nothing but folder pages and no subfolder is left.
  const deleteEmptyFolder = async (p) => {
    const f = at(p, { optional: true });
    if (!f) return;
    if (folders.some((x) => x.parentId === f.id)) throw new Error(`folder ${p} still has subfolders`);
    const rows = await pagesIn(f);
    const keep = rows.filter((r) => !(r.mod?.role === "page" && r.mod?.kind === "folder"));
    if (!dryRun && keep.length) throw new Error(`folder ${p} still holds ${keep.length} item(s): ${keep.map((k) => k.name).join(", ")}`);
    for (const r of rows.filter((r) => !keep.includes(r))) await deleteOcc(r);
    ops.push(`delete folder ${p}`);
    await write(() => Folder.deleteOne({ id: f.id }));
    folders = folders.filter((x) => x.id !== f.id);
  };

  // ── Interfaces ───────────────────────────────────────────────────────────
  await movePageNamed("Root/Day Pages", "Day Page", "Root/Interfaces");
  await deleteEmptyFolder("Root/Day Pages");
  await movePageNamed("Root/Trackers", "Trackers", "Root/Interfaces");
  await deleteEmptyFolder("Root/Trackers");
  await moveFolder("Root/Tasks", "Root/Interfaces");
  await movePageNamed("Root/Interfaces/Tasks/Daily Toolkit", "Routines", "Root/Interfaces/Tasks");
  await deleteEmptyFolder("Root/Interfaces/Tasks/Daily Toolkit");
  await movePageNamed("Root/Boards/Social", "Schedule Types", "Root/Interfaces");

  // ── Boards / Projects ────────────────────────────────────────────────────
  await movePageNamed("Root/Library", "Bills", "Root/Boards/Money");
  await movePageNamed("Root/Boards/Creative", "Projects", "Root/Projects");
  await movePageNamed("Root/Boards/Mind", "Media", "Root/Boards/Media");
  await moveFolder("Root/YouTube", "Root/Boards/Media");
  await moveFolder("Root/Documents/Notes/Health", "Root/Boards/Body");

  // ── Library ──────────────────────────────────────────────────────────────
  await moveFolder("Root/Lookup", "Root/Library");
  await moveFolder("Root/Interests", "Root/Library");
  for (const sub of folders.filter((f) => pathOf(f.parentId) === "Root/Library/Interests").map((f) => f.name)) {
    await deleteEmptyFolder(`Root/Library/Interests/${sub}`);
  }
  const reading = await ensureFolder("Root/Library", "Reading", 10);
  await movePageNamed("Root/Boards/Media", "Bookmarks", "Root/Library/Reading");
  // The web pages filed nowhere (pages made from links), and the root's strays.
  const pageMods = (await Module.find({ gridId: gid, role: "page" }, { id: 1 }).lean()).map((m) => m.id);
  const unfiled = await Occurrence.find({ gridId: gid, moduleId: { $in: pageMods }, $or: [{ parentId: null }, { parentId: { $exists: false } }] }, { id: 1, label: 1 }).lean();
  if (unfiled.length > 25) throw new Error(`expected ~19 unfiled pages, found ${unfiled.length}`);
  if (unfiled.length) ops.push(`move ${unfiled.length} unfiled page(s) -> Root/Library/Reading/`);
  await write(() => Occurrence.updateMany({ id: { $in: unfiled.map((u) => u.id) } }, { $set: { parentId: reading.id } }));
  const root = at("Root");
  for (const r of await pagesIn(root)) {
    if (WATTS_DROP.some((p) => r.id.startsWith(p))) await deleteOcc(r);
    else if (r.id.startsWith(WATTS_KEEP)) { ops.push(`move page "${r.name}" -> Root/Library/Reading/`); await write(() => Occurrence.updateOne({ id: r.id }, { $set: { parentId: reading.id } })); }
    else if (r.mod?.role === "artifact" && r.mod?.kind === "bookmark") { ops.push(`move bookmark "${r.name}" -> Root/Library/Reading/`); await write(() => Occurrence.updateOne({ id: r.id }, { $set: { parentId: reading.id } })); }
    else if (r.mod?.role === "artifact" && r.mod?.kind === "image") { ops.push(`move image "${r.name}" -> Root/Files/Images/`); await write(() => Occurrence.updateOne({ id: r.id }, { $set: { parentId: at("Root/Files/Images").id } })); }
  }

  // ── Documents ────────────────────────────────────────────────────────────
  await ensureFolder("Root/Documents", "Archive", 10);
  await moveFolder("Root/Documents/Codex", "Root/Documents/Archive");

  // ── Files ────────────────────────────────────────────────────────────────
  await moveFolder("Root/Examples", "Root/Files");
  await deleteEmptyFolder("Root/New Folder");
  for (const [area, subs] of Object.entries(IMAGE_AREAS)) {
    const dest = await ensureFolder("Root/Files/Images", area);
    for (const sub of subs) {
      const src = at(`Root/Files/Images/${sub}`, { optional: true });
      if (!src) continue;
      if (src.id === dest.id) continue;
      const files = (await pagesIn(src)).filter((r) => r.mod?.role === "artifact");
      ops.push(`move ${files.length} image(s) Files/Images/${sub} -> Files/Images/${area}`);
      await write(() => Occurrence.updateMany({ id: { $in: files.map((f) => f.id) } }, { $set: { parentId: dest.id } }));
      await deleteEmptyFolder(`Root/Files/Images/${sub}`);
    }
  }

  // ── Order of the top level ───────────────────────────────────────────────
  for (const [i, name] of ROOT_ORDER.entries()) {
    const f = at(`Root/${name}`, { optional: true });
    if (f && f.sortOrder !== i) { ops.push(`order Root/${name} = ${i}`); await write(() => Folder.updateOne({ id: f.id }, { $set: { sortOrder: i } })); }
  }

  for (const line of ops) log(line);
  if (!ops.length) log("already organized — nothing to do.");
}
