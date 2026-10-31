// 0473 — TV seasons, and the shows 0472 could not fill (user, 2026-10-31: "a seasons field … (extra board)" · "so
// this is like albums" · "and episodes field" · "fix the episodes board thing for the remaining shows").
//   show : season : episode  =  artist : album : song.
//   - Boards/Media › Seasons (page + container, identitySignature `tv:seasons`), one shared Season module: a row per
//     show per season ("Curb Your Enthusiasm — Season 3") carrying TV Show, Season and an **Episode List** (like an
//     album's Songs). Every episode gains **TV Season** (like a song's Album). The daily sync keeps both
//     (services/tvEpisodes).
//   - Watch binds TV Season; the Episode dropdown narrows to the picked season as well as the picked show, and the
//     TV Season dropdown narrows to the picked show.
//   - The 9 shows 0472 left out: NGE, The George Carlin Show (names corrected), Dark and Joseph Campbell Mythos get
//     their TMDB ids; Harmontown (a podcast) reads its feed, one season; "Season 4", "Season 9" (folder names the
//     media import made into shows) and "Ricky Gervais Is Deadly Sirius" (no episode list anywhere) are deleted.
import { randomUUID } from "node:crypto";
import { narrowedPredicate } from "./0472-episodes-board.mjs";

export const id = "0473-tv-seasons";
export const describe = "Seasons board between TV shows and episodes (Episode List / TV Season, like albums and songs); the remaining shows filled (TMDB ids, Harmontown's podcast feed); three non-shows deleted.";
export const touches = ["fields", "modules", "occurrences"];

const BC = "uew6sn6WWXin", TV_BOARD = "4l9lpinrjgxp", MEDIA_FOLDER = "o2uq0erxbwwt";
export const SHOW_FIXES = {
  "ec1506f0-1188-4450-a988-fb478d901662": { label: "Neon Genesis Evangelion", tmdbId: 890 },
  wjhk39gizmg4: { label: "The George Carlin Show", tmdbId: 5186 },
  xmpgzhy54oz4: { tmdbId: 70523 },              // Dark (2017); TMDB's top hit for "Dark" is Dark Shadows
  "7tilakhywm03": { tmdbId: 17894 },            // Mythos — Joseph Campbell's lectures
  "9sk43ffftk1w": { podcastFeed: "https://feeds.megaphone.fm/harmontown" },
};
export const NOT_SHOWS = ["iofdmoylutsj", "zv5wbfqlcp6r", "tsyy02ueofzl"];   // Season 4, Season 9, Ricky Gervais Is Deadly Sirius

/** Episode rows grouped into seasons by their episodeKey ("<source>:<show>:<season>:<ep>"). Pure. */
export function groupBySeason(episodes, showFieldId) {
  const out = new Map();   // seasonKey -> { showId, season, eps: [{id, n}] }
  for (const e of episodes) {
    const parts = String(e.meta?.episodeKey || "").split(":");
    if (parts.length < 4) continue;
    const season = Number(parts[2]);
    const showId = e.fields?.[showFieldId]?.value;
    if (!(season > 0) || !showId) continue;
    const key = `${parts[0]}:${parts[1]}:${season}`;
    if (!out.has(key)) out.set(key, { showId, season, eps: [] });
    out.get(key).eps.push({ id: e.id, n: Number(parts[3]) || 0 });
  }
  for (const g of out.values()) g.eps.sort((a, b) => a.n - b.n);
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const now = new Date();
  const fields = await Field.find({ gridId }).lean();
  const byName = (n, t) => fields.find((f) => f.name === n && f.type === t && !f.displayEnabled);
  const show = byName("TV Show", "occurrence"), season = byName("Season", "number"), episodeF = byName("Episode", "occurrence");
  if (!show || !season || !episodeF) throw new Error("run 0472 first");
  const epBoard = await Occurrence.findOne({ gridId, identitySignature: "tv:episodes" }).lean();
  const epModuleId = epBoard?.meta?.episodeModuleId;
  if (!epModuleId) throw new Error("no Episodes board / module (0472)");

  // 1. the shows
  const fixRows = await Occurrence.find({ gridId, id: { $in: Object.keys(SHOW_FIXES) } }).lean();
  const goneRows = await Occurrence.find({ gridId, id: { $in: NOT_SHOWS } }).lean();
  if (fixRows.length !== Object.keys(SHOW_FIXES).length || goneRows.length !== NOT_SHOWS.length) throw new Error("a named show row is missing");
  // Refuse to delete a row anything still points at (a field value or a list, other than the TV board's own list).
  for (const g of goneRows) {
    const refs = await Occurrence.countDocuments({ gridId, id: { $ne: TV_BOARD }, $or: [{ occurrences: g.id }, { [`fields.${show.id}.value`]: g.id }] });
    if (refs) throw new Error(`${g.label} is referenced by ${refs} row(s)`);
  }
  log(`  fix: ${fixRows.map((r) => `${r.label}${SHOW_FIXES[r.id].label ? ` -> ${SHOW_FIXES[r.id].label}` : ""}`).join(", ")}`);
  log(`  delete: ${goneRows.map((r) => r.label).join(", ")}`);

  // 2. fields
  const created = [];
  const mint = (name, type, meta = {}) => byName(name, type) || (() => { const f = { id: randomUUID(), userId, gridId, name, type, folderId: show.folderId || null, inputEnabled: true, displayEnabled: false, meta }; created.push(f); fields.push(f); return f; })();
  const seasonLink = mint("TV Season", "occurrence", { optionsSource: { mode: "find", over: "$allInstances",
    predicate: narrowedPredicate("season", show.id, show.id), valuePath: "id", labelPath: "label" } });
  const episodeList = mint("Episode List", "occurrence", { multiSelect: true, optionsSource: { mode: "find", over: "$allInstances",
    predicate: narrowedPredicate("episode", show.id, show.id), valuePath: "id", labelPath: "label" } });
  // Episode narrows by the picked season too.
  const epPred = episodeF.meta.optionsSource.predicate;
  const seasonNarrow = narrowedPredicate("episode", seasonLink.id, seasonLink.id).rules[2];
  const nextEpPred = JSON.stringify(epPred).includes(seasonLink.id) ? epPred : { ...epPred, rules: [...epPred.rules, seasonNarrow] };

  // 3. seasons from the episodes already there
  const eps = await Occurrence.find({ gridId, "meta.episodeKey": { $exists: true } }, { id: 1, fields: 1, "meta.episodeKey": 1 }).lean();
  const groups = groupBySeason(eps, show.id);
  const shows = new Map((await Occurrence.find({ gridId, id: { $in: [...new Set([...groups.values()].map((g) => g.showId))] } }, { id: 1, label: 1, "meta.cover": 1 }).lean()).map((r) => [r.id, r]));
  log(`  seasons: ${groups.size} from ${eps.length} episodes · fields new: ${created.map((f) => f.name).join(", ") || "none"}`);
  if (dryRun) return;

  if (created.length) await Field.insertMany(created.map((f) => ({ ...f, createdAt: now, updatedAt: now })));
  await Field.updateOne({ gridId, id: episodeF.id }, { $set: { "meta.optionsSource.predicate": nextEpPred, updatedAt: now } });
  const bc = fields.find((f) => f.id === BC);
  if (!(bc.meta?.optionsSource?.values || []).includes("season")) await Field.updateOne({ gridId, id: BC }, { $push: { "meta.optionsSource.values": "season" } });

  for (const r of fixRows) {
    const f = SHOW_FIXES[r.id], set = { updatedAt: now };
    if (f.label) set.label = f.label;
    if (f.tmdbId) set["meta.tmdbId"] = f.tmdbId;
    if (f.podcastFeed) set["meta.podcastFeed"] = f.podcastFeed;
    await Occurrence.updateOne({ gridId, id: r.id }, { $set: set });
    if (f.label) await Module.updateOne({ gridId, id: r.moduleId, label: r.label }, { $set: { label: f.label, updatedAt: now } });
  }
  await Occurrence.updateOne({ gridId, id: TV_BOARD }, { $pull: { occurrences: { $in: NOT_SHOWS } }, $set: { updatedAt: now } });
  await Occurrence.deleteMany({ gridId, id: { $in: NOT_SHOWS } });

  // the board + module
  let board = await Occurrence.findOne({ gridId, identitySignature: "tv:seasons" }).lean();
  let seasonModuleId = board?.meta?.seasonModuleId;
  if (!board) {
    const base = { userId, gridId, iteration: { mode: "inherit", timeFilter: "daily" }, defaultDragMode: "move", styleMode: "inherit", trashed: false, meta: {}, createdAt: now, updatedAt: now };
    const pageMod = { ...base, id: randomUUID(), role: "page", kind: "board", label: "Seasons", fieldBindings: [] };
    const contMod = { ...base, id: randomUUID(), role: "container", kind: "board", label: "Seasons", fieldBindings: [] };
    const seasonMod = { ...base, id: randomUUID(), role: "instance", label: "Season", fieldBindings: [
      { fieldId: show.id, order: 0, role: "input" }, { fieldId: season.id, order: 1, role: "input" },
      { fieldId: episodeList.id, order: 2, role: "input" }, { fieldId: BC, order: 3, role: "input", hidden: true }] };
    await Module.insertMany([pageMod, contMod, seasonMod]);
    seasonModuleId = seasonMod.id;
    const pageId = randomUUID(), contId = randomUUID();
    const occ = { userId, gridId, filters: [], fields: {}, meta: {}, occurrences: [], timestamp: now, createdAt: now, updatedAt: now };
    await Occurrence.insertMany([
      { ...occ, id: pageId, moduleId: pageMod.id, parentId: MEDIA_FOLDER, occurrences: [contId] },
      { ...occ, id: contId, moduleId: contMod.id, parentId: pageId, identitySignature: "tv:seasons",
        fields: { [BC]: { value: ["season"], flow: "in" } }, meta: { seasonModuleId } },
    ]);
    // listed right before Episodes, after TV Series
    const fp = await Occurrence.findOne({ gridId, occurrences: epBoard.parentId }).lean();
    const list = fp.occurrences || [];
    const at = list.indexOf(epBoard.parentId);
    await Occurrence.updateOne({ gridId, id: fp.id }, { $set: { occurrences: [...list.slice(0, at), pageId, ...list.slice(at)] } });
    board = { id: contId };
  }
  // the episode module carries TV Season; Watch binds it
  for (const mod of [await Module.findOne({ gridId, id: epModuleId }).lean(), await Module.findOne({ gridId, label: "Watch", role: "instance" }).lean()]) {
    if (mod && !(mod.fieldBindings || []).some((b) => b.fieldId === seasonLink.id)) {
      await Module.updateOne({ gridId, id: mod.id }, { $push: { fieldBindings: { fieldId: seasonLink.id, role: "input", order: (mod.fieldBindings || []).length } } });
    }
  }

  // season rows + links
  const have = new Set((await Occurrence.find({ gridId, "meta.seasonKey": { $exists: true } }, { "meta.seasonKey": 1 }).lean()).map((r) => r.meta.seasonKey));
  const seasonDocs = [], epOps = [];
  for (const [key, g] of groups) {
    if (have.has(key)) continue;
    const s = shows.get(g.showId);
    const id = randomUUID();
    seasonDocs.push({ id, userId, gridId, moduleId: seasonModuleId, parentId: board.id, label: `${s?.label || "Show"} — Season ${g.season}`, occurrences: [],
      fields: { [show.id]: { value: g.showId, flow: "in" }, [season.id]: { value: g.season, flow: "in" }, [BC]: { value: ["season"], flow: "in" },
        [episodeList.id]: { value: g.eps.map((e) => e.id), flow: "in" } },
      meta: { seasonKey: key, ...(s?.meta?.cover ? { cover: s.meta.cover } : {}) }, timestamp: now, createdAt: now, updatedAt: now });
    for (const e of g.eps) epOps.push({ updateOne: { filter: { gridId, id: e.id }, update: { $set: { [`fields.${seasonLink.id}`]: { value: id, flow: "in" } } } } });
  }
  seasonDocs.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  if (seasonDocs.length) {
    await Occurrence.insertMany(seasonDocs);
    await Occurrence.updateOne({ gridId, id: board.id }, { $push: { occurrences: { $each: seasonDocs.map((d) => d.id) } } });
  }
  for (let i = 0; i < epOps.length; i += 1000) await Occurrence.bulkWrite(epOps.slice(i, i + 1000));
  log(`  wrote ${seasonDocs.length} seasons, linked ${epOps.length} episodes`);

  // the shows just fixed: their episodes (and seasons) now
  const { syncTvEpisodes, tmdbClient, writeEpisodesToMongo } = await import("../services/tvEpisodes.js");
  const { userSearchKeys } = await import("../services/searchKeys.js");
  const key = (await userSearchKeys(userId)).tmdb || process.env.TMDB_API_KEY;
  const report = await syncTvEpisodes({ gridId, userId, models, tmdb: await tmdbClient(key),
    write: (rows, patch, ctx) => writeEpisodesToMongo({ models }, rows, patch, ctx) });
  log(`  sync: ${JSON.stringify({ shows: report.shows, added: report.added, seasonsAdded: report.seasonsAdded, matched: report.matched, failed: report.failed })}`);
  log("  applied. RESTART pm2.");
}
