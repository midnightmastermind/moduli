// 0472 — TV episodes (user, 2026-10-31: "an episodes board that we prefill for now, that uses an operation for future
// ones" · "an episodes and song field … so i can select a tv show, and then the episode field … only uses those
// episodes in the dropdown with nothing selected"; answers: all 187 shows, everything listed until a show is picked,
// a daily check).
//   - Fields TV Show (pick a show), Season, Episode #, Air Date, Episode (pick an episode); `episode` added to Board
//     Category. The Episode dropdown lists every episode until the row has a TV Show, then only that show's — a
//     plain options rule ($this = the row being edited, SHARES_ANY), not a prefill: nothing is selected for you.
//   - Boards/Media › Episodes (page + container, identitySignature `tv:episodes`), one shared Episode module.
//   - Watch binds TV Show + Episode. Sing binds Album, and Song narrows to the picked album the same way.
//   - "TV: Fetch New Episodes" (once a day, a tab open) calls POST /api/v1/tv/episodes/sync, which adds what TMDB
//     lists that the board lacks — for shows not yet read, and shows still airing.
//   - The first fill runs here (services/tvEpisodes, TMDB key from the server env or the user's Search sources).
import { randomUUID } from "node:crypto";

export const id = "0472-episodes-board";
export const describe = "Episodes board filled from TMDB for every TV show; TV Show / Episode fields with the episode list narrowed to the picked show; Song narrowed to the picked album; a daily op adds new episodes.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const BOARD_CATEGORY = "uew6sn6WWXin", ALBUM = "9i0yaflshggo", SONG = "TK-KK9OmAOPF";
const MEDIA_FOLDER = "o2uq0erxbwwt", TV_PAGE = "oo0m7u1ep4qp";

/** "every row of category X; once this row has a value in `scopeField`, only rows whose `linkField` shares it". Pure. */
export function narrowedPredicate(category, linkField, scopeField) {
  return { operator: "AND", rules: [
    { id: randomUUID(), left: `fields.${BOARD_CATEGORY}.value`, comparator: "CONTAINS", right: category },
    { id: randomUUID(), left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
    { id: randomUUID(), operator: "OR", rules: [
      { id: randomUUID(), left: `$this.fields.${scopeField}.value`, comparator: "IS_EMPTY", right: "" },
      { id: randomUUID(), left: `fields.${linkField}.value`, comparator: "SHARES_ANY", right: `$this.fields.${scopeField}.value` },
    ] },
  ] };
}

/** Song's existing rules + the album narrowing (idempotent). Pure. */
export function withAlbumNarrowing(predicate) {
  if (JSON.stringify(predicate).includes("SHARES_ANY")) return predicate;
  return { ...predicate, operator: "AND", rules: [...(predicate.rules || []), narrowedPredicate("song", ALBUM, ALBUM).rules[2]] };
}

export const fetchPipeline = () => ({ sources: [], steps: [
  { id: randomUUID(), type: "action", config: { type: "CALL_API", url: "/api/v1/tv/episodes/sync", method: "POST",
    body: { gridId: "$grid._id" }, timeoutMs: 60000, responseVar: "$tvSync", onError: "continue", errorVar: "$tvSyncError" } },
] });

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const now = new Date();
  const fields = await Field.find({ gridId }).lean();
  const byName = (name, type) => fields.find((f) => f.name === name && f.type === type && !f.displayEnabled && !f.trashed);
  const bc = fields.find((f) => f.id === BOARD_CATEGORY), song = fields.find((f) => f.id === SONG);
  if (!bc || !song || !fields.some((f) => f.id === ALBUM)) throw new Error("Board Category / Song / Album field missing");
  const cat = song.folderId || null;

  // 1. fields
  const created = [];
  const mint = (name, type, meta = {}) => byName(name, type) || (() => { const f = { id: randomUUID(), userId, gridId, name, type, folderId: cat, inputEnabled: true, displayEnabled: false, meta }; created.push(f); return f; })();
  const showF = mint("TV Show", "occurrence", { optionsSource: { mode: "find", over: "$allOccurrences",
    predicate: { operator: "AND", rules: [
      { id: randomUUID(), left: `fields.${BOARD_CATEGORY}.value`, comparator: "CONTAINS", right: "series" },
      { id: randomUUID(), left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" }] },
    valuePath: "id", labelPath: "label" } });
  const seasonF = mint("Season", "number"), numberF = mint("Episode #", "number"), airF = mint("Air Date", "date");
  const episodeF = mint("Episode", "occurrence", { optionsSource: { mode: "find", over: "$allInstances",
    predicate: narrowedPredicate("episode", showF.id, showF.id), valuePath: "id", labelPath: "label",
    chipDisplay: { showLabel: true, showMedia: false, fieldIds: [showF.id] } } });
  const bcValues = bc.meta?.optionsSource?.values || [];

  // 2. board + module
  const existingBoard = await Occurrence.findOne({ gridId, identitySignature: "tv:episodes" }).lean();
  const folderPage = await Occurrence.findOne({ gridId, occurrences: TV_PAGE }).lean();
  if (!folderPage) throw new Error("no folder page listing TV Series");
  const watch = await Module.findOne({ gridId, label: "Watch", role: "instance" }).lean();
  const sing = await Module.findOne({ gridId, label: "Sing", role: "instance" }).lean();
  if (!watch || !sing) throw new Error("Watch / Sing routine missing");

  log(`  fields new: ${created.map((f) => f.name).join(", ") || "none"} · Board Category ${bcValues.includes("episode") ? "has" : "gains"} "episode"`);
  log(`  Episodes board: ${existingBoard ? "exists" : "create in Media beside TV Series"} · Watch binds TV Show + Episode · Sing binds Album · Song narrows by album`);

  let containerId = existingBoard?.id, episodeModuleId = existingBoard?.meta?.episodeModuleId;
  if (!dryRun) {
    if (created.length) await Field.insertMany(created.map((f) => ({ ...f, createdAt: now, updatedAt: now })));
    if (!bcValues.includes("episode")) await Field.updateOne({ gridId, id: BOARD_CATEGORY }, { $push: { "meta.optionsSource.values": "episode" }, $set: { updatedAt: now } });
    await Field.updateOne({ gridId, id: SONG }, { $set: { "meta.optionsSource.predicate": withAlbumNarrowing(song.meta.optionsSource.predicate), updatedAt: now } });
    const bind = async (mod, add) => {
      const have = new Set((mod.fieldBindings || []).map((b) => b.fieldId));
      const extra = add.filter(({ fieldId }) => !have.has(fieldId)).map((b, i) => ({ ...b, role: "input", order: (mod.fieldBindings || []).length + i }));
      if (extra.length) await Module.updateOne({ gridId, id: mod.id }, { $push: { fieldBindings: { $each: extra } }, $set: { updatedAt: now } });
    };
    await bind(watch, [{ fieldId: showF.id }, { fieldId: episodeF.id }]);
    await bind(sing, [{ fieldId: ALBUM }]);
    if (!existingBoard) {
      const base = { userId, gridId, iteration: { mode: "inherit", timeFilter: "daily" }, defaultDragMode: "move", styleMode: "inherit", trashed: false, meta: {}, createdAt: now, updatedAt: now };
      const pageMod = { ...base, id: randomUUID(), role: "page", kind: "board", label: "Episodes", fieldBindings: [] };
      const contMod = { ...base, id: randomUUID(), role: "container", kind: "board", label: "Episodes", fieldBindings: [] };
      const epMod = { ...base, id: randomUUID(), role: "instance", label: "Episode", fieldBindings: [
        { fieldId: showF.id, order: 0, role: "input" }, { fieldId: seasonF.id, order: 1, role: "input" },
        { fieldId: numberF.id, order: 2, role: "input" }, { fieldId: airF.id, order: 3, role: "input" },
        { fieldId: BOARD_CATEGORY, order: 4, role: "input", hidden: true }] };
      await Module.insertMany([pageMod, contMod, epMod]);
      const pageId = randomUUID(); containerId = randomUUID(); episodeModuleId = epMod.id;
      const occ = { userId, gridId, filters: [], fields: {}, meta: {}, occurrences: [], timestamp: now, createdAt: now, updatedAt: now };
      await Occurrence.insertMany([
        { ...occ, id: pageId, moduleId: pageMod.id, parentId: MEDIA_FOLDER, occurrences: [containerId] },
        { ...occ, id: containerId, moduleId: contMod.id, parentId: pageId, identitySignature: "tv:episodes",
          fields: { [BOARD_CATEGORY]: { value: ["episode"], flow: "in" } }, meta: { episodeModuleId } },
      ]);
      const list = folderPage.occurrences || [];
      const at = list.indexOf(TV_PAGE) + 1;
      await Occurrence.updateOne({ gridId, id: folderPage.id }, { $set: { occurrences: [...list.slice(0, at), pageId, ...list.slice(at)], updatedAt: now } });
    }
    const ops = await Operation.find({ gridId, name: "TV: Fetch New Episodes" }).lean();
    const cat2 = (await Operation.findOne({ gridId, name: "New series" }).lean())?.folderId || null;
    const doc = { name: "TV: Fetch New Episodes", description: "Once a day: adds the episodes TMDB lists that the Episodes board lacks (new shows, and shows still airing).",
      pipeline: fetchPipeline(), triggerObjects: [], triggerTypes: [], enabled: true, folderId: cat2,
      schedule: { kind: "interval", every: 1, unit: "day", suppressNotifications: true, lastFiredAt: now.toISOString() }, updatedAt: now };
    if (ops[0]) await Operation.updateOne({ gridId, id: ops[0].id }, { $set: doc });
    else await Operation.create({ id: randomUUID(), userId, gridId, ...doc });
  }

  // 3. the first fill
  const { syncTvEpisodes, tmdbClient, writeEpisodesToMongo } = await import("../services/tvEpisodes.js");
  const { userSearchKeys } = await import("../services/searchKeys.js");
  const key = (await userSearchKeys(userId)).tmdb || process.env.TMDB_API_KEY;
  if (!key) throw new Error("no TMDB key");
  if (dryRun && !existingBoard) { log("  (episodes are planned after the board exists — run --apply; the sync reports matches)"); return; }
  const report = await syncTvEpisodes({ gridId, userId, models, tmdb: await tmdbClient(key), all: true, dryRun,
    write: (rows, patch, ctx) => writeEpisodesToMongo({ models }, rows, patch, ctx), log: () => {} });
  log(`  shows ${report.shows} · episodes ${dryRun ? "to add" : "added"} ${report.added} · matched ${JSON.stringify(report.matched)}`);
  if (report.failed.length) log(`  failed: ${report.failed.join(" | ")}`);
  if (report.firstMatches.length) log(`  no poster/year match (took TMDB's first): ${report.firstMatches.join(" | ")}`);
  if (!dryRun) log("  applied. RESTART pm2.");
}
