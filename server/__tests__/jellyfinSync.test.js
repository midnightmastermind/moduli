import { describe, it, expect } from "vitest";
import { syncJellyfin, applyChanges, isNewerWatch, DANNY_SIGNATURE } from "../services/jellyfinSync.js";

// ── a fake grid: a tiny Mongo-ish matcher over an in-memory occurrence store ──────────────────────────────────────
const F = { cat: "fCat", year: "fYear", path: "fPath", owned: "fOwned", show: "fShow", season: "fSeason", num: "fNum",
  air: "fAir", link: "fLink", list: "fList", lw: "fLW", wa: "fWA" };
const FIELDS = [
  ["fCat", "Board Category", "select"], ["fYear", "Year", "number"], ["fPath", "File Path", "text"], ["fOwned", "Owned", "boolean"],
  ["fShow", "TV Show", "occurrence"], ["fSeason", "Season", "number"], ["fNum", "Episode #", "number"], ["fAir", "Air Date", "date"],
  ["fLink", "TV Season", "occurrence"], ["fList", "Episode List", "occurrence"], ["fLW", "Last Watched", "date"], ["fWA", "Watched At", "text"],
].map(([id, name, type]) => ({ id, name, type, gridId: "g" }));

const cell = (value) => ({ value, flow: "in" });
const getPath = (o, p) => p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);
function matches(doc, q) {
  return Object.entries(q).every(([k, cond]) => {
    const v = getPath(doc, k);
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) return cond.$in.some((x) => (Array.isArray(v) ? v.includes(x) : v === x));
      if ("$exists" in cond) return cond.$exists ? v !== undefined : v === undefined;
      if ("$ne" in cond) return v !== cond.$ne;
    }
    return Array.isArray(v) ? v.includes(cond) : v === cond;
  });
}
function fakeGrid(rows) {
  const store = new Map();
  const put = (o) => store.set(o.id, { gridId: "g", meta: {}, fields: {}, occurrences: [], ...o });
  put({ id: "bMovies", feed: { enabled: true, conditions: [{ fieldId: F.cat, comparator: "CONTAINS", value: "movie" }] } });
  put({ id: "bTv", feed: { enabled: true, conditions: [{ fieldId: F.cat, comparator: "CONTAINS", value: "series" }] } });
  put({ id: "bSeasons", identitySignature: "tv:seasons", meta: { seasonModuleId: "mSeason" } });
  put({ id: "bEpisodes", identitySignature: "tv:episodes", meta: { episodeModuleId: "mEp" } });
  put({ id: "bDanny", identitySignature: DANNY_SIGNATURE, meta: { documentaryModuleId: "mDoc" }, feed: { enabled: true, conditions: [{ fieldId: F.cat, comparator: "CONTAINS", value: "documentary" }] } });
  // A show already on the TV board: the shared TV Series module a created show uses.
  put({ id: "rCurb", moduleId: "mSeries", parentId: "bTv", label: "Curb", fields: { [F.cat]: cell(["series"]) } });
  for (const r of rows) put(r);
  const models = {
    Field: { find: () => ({ lean: async () => FIELDS }) },
    Occurrence: {
      find: (q) => ({ lean: async () => [...store.values()].filter((d) => matches(d, q)).map((d) => structuredClone(d)) }),
      findOne: (q) => ({ lean: async () => structuredClone([...store.values()].find((d) => matches(d, q)) || null) }),
    },
  };
  const writes = [];
  const write = async (changes) => { writes.push(changes); applyChanges(store, changes); };
  return { store, models, write, writes };
}
const movieRow = (o = {}) => ({ id: "rHeat", moduleId: "mMovie", parentId: "bMovies", label: "Heat",
  fields: { [F.cat]: cell(["movie"]), [F.year]: cell(1995) }, ...o });
const mv = (o = {}) => ({ Id: "jHeat", Type: "Movie", Name: "Heat", ProductionYear: 1995, Path: "/m/heat.mkv", ProviderIds: { Tmdb: "949" }, library: "movies", ...o });
const series = { Id: "jDark", Type: "Series", Name: "Dark", ProductionYear: 2017, ProviderIds: { Tmdb: "70523" }, library: "shows", ImageTags: { Primary: "x" } };
const season1 = { Id: "jDarkS1", Type: "Season", Name: "Season 1", SeriesId: "jDark", IndexNumber: 1, library: "shows" };
const ep1 = { Id: "jDarkE1", Type: "Episode", Name: "Secrets", SeriesId: "jDark", ParentIndexNumber: 1, IndexNumber: 1, PremiereDate: "2017-12-01T00:00:00Z", library: "shows" };

let n = 0;
const newId = () => `new${n++}`;
const run = (g, items, extra = {}) => syncJellyfin({ gridId: "g", userId: "u", models: g.models, write: g.write, newId,
  jf: { items: async () => items, cover: async (id) => `/uploads/user/jf-${id}.jpg` }, ...extra });

describe("syncJellyfin", () => {
  it("a dry run reports link / create / ambiguous and writes nothing", async () => {
    const g = fakeGrid([movieRow(), movieRow({ id: "rA", label: "Twin" }), movieRow({ id: "rB", label: "Twin" })]);
    const r = await run(g, [mv(), mv({ Id: "jTwin", Name: "Twin", ProviderIds: {}, Path: "" }), mv({ Id: "jNew", Name: "Brand New", ProductionYear: 2020, ProviderIds: {}, Path: "" }),
      series, season1, ep1], { dryRun: true });
    expect(g.writes).toEqual([]);
    expect(r.link).toBe(1);
    expect(r.create).toEqual({ movies: 1, tv: 1, seasons: 1, episodes: 1 });   // the new show's children come from pass 2
    expect(r.ambiguous.map((a) => a.jfId)).toEqual(["jTwin"]);
    expect(r.ambiguous[0]).toMatchObject({ name: "Twin", reason: expect.any(String) });
  });

  it("links and creates in the shape of the board, then a second run writes nothing", async () => {
    const g = fakeGrid([movieRow()]);
    const items = [mv(), series, season1, ep1, mv({ Id: "jDoc", Name: "Planet", library: "documentaries", ProviderIds: {}, Path: "/d/planet.mkv", ImageTags: { Primary: "t" } })];
    const r1 = await run(g, items);
    expect(r1.link).toBe(1);
    expect(r1.create).toEqual({ tv: 1, danny: 1, seasons: 1, episodes: 1 });
    const heat = g.store.get("rHeat");
    expect(heat.meta).toMatchObject({ jellyfinId: "jHeat", jellyfinPlayable: true, tmdbId: 949 });
    const all = [...g.store.values()];
    const show = all.find((o) => o.meta?.jellyfinId === "jDark");
    expect(show).toMatchObject({ moduleId: "mSeries", parentId: "bTv", label: "Dark", meta: { tmdbId: 70523, cover: "/uploads/user/jf-jDark.jpg" } });
    expect(show.fields[F.cat].value).toEqual(["series"]);
    expect(g.store.get("bTv").occurrences).toContain(show.id);
    const seasonRow = all.find((o) => o.meta?.jellyfinId === "jDarkS1");
    expect(seasonRow).toMatchObject({ moduleId: "mSeason", parentId: "bSeasons", label: "Dark — Season 1", meta: { seasonKey: "tmdb:70523:1" } });
    expect(seasonRow.fields[F.show].value).toBe(show.id);
    const epRow = all.find((o) => o.meta?.jellyfinId === "jDarkE1");
    expect(epRow).toMatchObject({ moduleId: "mEp", parentId: "bEpisodes", label: "S01E01 · Secrets", meta: { episodeKey: "tmdb:70523:1:1", jellyfinPlayable: true } });
    expect(epRow.fields[F.link].value).toBe(seasonRow.id);
    expect(epRow.fields[F.air].value).toBe("2017-12-01");
    expect(g.store.get(seasonRow.id).fields[F.list].value).toEqual([epRow.id]);
    const doc = all.find((o) => o.meta?.jellyfinId === "jDoc");
    expect(doc).toMatchObject({ moduleId: "mDoc", parentId: "bDanny", label: "Planet" });
    expect(doc.fields[F.cat].value).toEqual(["documentary"]);

    const before = g.writes.length;
    const r2 = await run(g, items);
    expect(g.writes.length).toBe(before);
    expect(r2.link).toBe(0);
    expect(r2.create).toEqual({});
    expect(r2.watch).toBe(0);
  });

  it("Played in Jellyfin moves Last Watched forward, never backward", async () => {
    const played = (iso) => ({ UserData: { Played: true, LastPlayedDate: iso } });
    const g = fakeGrid([
      movieRow({ id: "old", label: "Old", meta: { jellyfinId: "jOld" }, fields: { [F.cat]: cell(["movie"]), [F.lw]: cell("2026-10-01") } }),
      movieRow({ id: "newer", label: "Newer", meta: { jellyfinId: "jNewer" }, fields: { [F.cat]: cell(["movie"]), [F.lw]: cell("2026-11-05") } }),
      movieRow({ id: "exact", label: "Exact", meta: { jellyfinId: "jExact" }, fields: { [F.cat]: cell(["movie"]), [F.lw]: cell("2026-10-20"), [F.wa]: cell("2026-10-25T10:00:00.000Z") } }),
      movieRow({ id: "unplayed", label: "Unplayed", meta: { jellyfinId: "jUn" }, fields: { [F.cat]: cell(["movie"]) } }),
    ]);
    const r = await run(g, [
      mv({ Id: "jOld", Name: "Old", ...played("2026-10-20T21:30:00.0000000Z") }),
      mv({ Id: "jNewer", Name: "Newer", ...played("2026-10-20T21:30:00Z") }),
      mv({ Id: "jExact", Name: "Exact", ...played("2026-10-24T10:00:00Z") }),
      mv({ Id: "jUn", Name: "Unplayed", UserData: { Played: false, LastPlayedDate: "2026-10-20T00:00:00Z" } }),
    ]);
    expect(r.watch).toBe(1);
    expect(g.store.get("old").fields[F.lw].value).toBe("2026-10-20");
    expect(g.store.get("old").fields[F.wa].value).toBe("2026-10-20T21:30:00.000Z");
    expect(g.store.get("newer").fields[F.lw].value).toBe("2026-11-05");
    expect(g.store.get("newer").fields[F.wa]).toBeUndefined();
    expect(g.store.get("exact").fields[F.wa].value).toBe("2026-10-25T10:00:00.000Z");
    expect(g.store.get("unplayed").fields[F.lw]).toBeUndefined();
  });

  it("isNewerWatch: Watched At first, else the Last Watched day", () => {
    expect(isNewerWatch({}, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(isNewerWatch({ lastWatched: "2026-01-01" }, "2026-01-01T23:00:00.000Z")).toBe(false);
    expect(isNewerWatch({ lastWatched: "2026-01-01" }, "2026-01-02T12:00:00.000Z")).toBe(true);
    expect(isNewerWatch({ lastWatched: "2026-03-01", watchedAt: "2026-01-01T00:00:00.000Z" }, "2026-02-01T00:00:00.000Z")).toBe(true);
    expect(isNewerWatch({ watchedAt: "2026-02-01T00:00:00.000Z" }, "2026-02-01T00:00:00.000Z")).toBe(false);
  });
});

import { fetchJellyfinItems } from "../services/jellyfinSync.js";
describe("fetchJellyfinItems", () => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetcher = (calls) => async (_cfg, p) => {
    calls.push(p);
    if (p.startsWith("/UserViews")) return json({ Items: [
      { Id: "vM", Name: "Movies", CollectionType: "movies" }, { Id: "vS", Name: "Shows", CollectionType: "tvshows" },
      { Id: "vD", Name: "Documentaries", CollectionType: "homevideos" }, { Id: "vMu", Name: "Music", CollectionType: "music" }] });
    const parent = new URLSearchParams(p.split("?")[1]).get("ParentId");
    const items = { vM: [{ Id: "m", Type: "Movie" }], vS: [{ Id: "s", Type: "Series" }, { Id: "x", Type: "Video" }], vD: [{ Id: "d", Type: "Video" }] }[parent] || [];
    return json({ Items: items });
  };
  it("reads only the owner's views; a documentaries Video is a Movie there and nowhere else; music is skipped", async () => {
    const calls = [];
    const items = await fetchJellyfinItems({ userId: "own" }, fetcher(calls));
    expect(items.map((i) => [i.Id, i.Type, i.library])).toEqual([["m", "Movie", "movies"], ["s", "Series", "shows"], ["d", "Movie", "documentaries"]]);
    expect(items.find((i) => i.Id === "d").jellyfinType).toBe("Video");
    expect(calls.every((p) => p.includes("userId=own"))).toBe(true);
    expect(calls.some((p) => p.includes("vMu"))).toBe(false);
  });
});

import { dedupeItems, localDay } from "../services/jellyfinSync.js";
describe("fix round 1", () => {
  it("dedupeItems: one item per Id, the first view wins, and the disagreements are named", () => {
    const { items, dropped } = dedupeItems([{ Id: "a", library: "documentaries" }, { Id: "b", library: "movies" }, { Id: "a", library: "movies" }]);
    expect(items.map((i) => [i.Id, i.library])).toEqual([["a", "documentaries"], ["b", "movies"]]);
    expect(dropped).toEqual([{ Id: "a", kept: "documentaries", dropped: "movies" }]);
  });
  it("fetchJellyfinItems returns each Id once even when two views list it", async () => {
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    const f = async (_c, p) => p.startsWith("/UserViews")
      ? json({ Items: [{ Id: "v1", Name: "Movies", CollectionType: "movies" }, { Id: "v2", Name: "Mixed", CollectionType: "movies" }] })
      : json({ Items: [{ Id: "same", Type: "Movie" }] });
    const items = await fetchJellyfinItems({ userId: "own" }, f);
    expect(items.map((i) => i.Id)).toEqual(["same"]);
    expect(items.dropped).toEqual([{ Id: "same", kept: "movies", dropped: "movies" }]);
  });
  it("a 23:30 CDT play is that Chicago day, and Watched At stays the instant", async () => {
    expect(localDay("2026-10-21T04:30:00.000Z", "America/Chicago")).toBe("2026-10-20");
    const g = fakeGrid([movieRow({ id: "late", label: "Late", meta: { jellyfinId: "jLate" }, fields: { [F.cat]: cell(["movie"]) } })]);
    await run(g, [mv({ Id: "jLate", Name: "Late", UserData: { Played: true, LastPlayedDate: "2026-10-21T04:30:00Z" } })], { timeZone: "America/Chicago" });
    expect(g.store.get("late").fields[F.lw].value).toBe("2026-10-20");
    expect(g.store.get("late").fields[F.wa].value).toBe("2026-10-21T04:30:00.000Z");
  });
  it("compares Last Watched in the same zone: a same-Chicago-day play does not move it", () => {
    expect(isNewerWatch({ lastWatched: "2026-10-20" }, "2026-10-21T04:30:00.000Z", "America/Chicago")).toBe(false);
    expect(isNewerWatch({ lastWatched: "2026-10-20" }, "2026-10-21T04:30:00.000Z", "UTC")).toBe(true);
  });
  it("a linked row its board does not list (a partial write) is re-listed, once", async () => {
    const g = fakeGrid([movieRow({ id: "stray", label: "Stray", meta: { jellyfinId: "jStray" } })]);
    const r = await run(g, [mv({ Id: "jStray", Name: "Stray" })]);
    expect(r.relisted).toBe(1);
    expect(g.store.get("bMovies").occurrences).toEqual(["stray"]);
    const before = g.writes.length;
    const r2 = await run(g, [mv({ Id: "jStray", Name: "Stray" })]);
    expect(r2.relisted).toBe(0);
    expect(g.writes.length).toBe(before);
  });
  it("a row linked under ANOTHER parent is not pulled onto the board", async () => {
    const g = fakeGrid([movieRow({ id: "elsewhere", parentId: "someDoc", label: "Elsewhere", meta: { jellyfinId: "jE" } })]);
    const r = await run(g, [mv({ Id: "jE", Name: "Elsewhere" })]);
    expect(r.relisted).toBe(0);
  });
});
