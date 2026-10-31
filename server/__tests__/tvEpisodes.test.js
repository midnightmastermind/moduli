import { describe, it, expect } from "vitest";
import { matchShow, planEpisodeRows, episodeLabel, showsToSync, syncTvEpisodes, episodeKey } from "../services/tvEpisodes.js";
import { narrowedPredicate, withAlbumNarrowing } from "../migrations/0472-episodes-board.mjs";

const ids = { show: "fShow", season: "fSeason", number: "fNum", airDate: "fAir", category: "fCat", year: "fYear" };

describe("matchShow", () => {
  const results = [{ id: 1, poster_path: "/a.jpg", first_air_date: "1999-01-01" }, { id: 2, poster_path: "/b.jpg", first_air_date: "2005-01-01" }];
  it("the result with the row's own poster wins", () => {
    expect(matchShow(results, { meta: { cover: "https://image.tmdb.org/t/p/w500/b.jpg" } })).toEqual({ result: results[1], by: "poster" });
  });
  it("then the first-air year", () => {
    expect(matchShow(results, { meta: { cover: "https://bing/x" }, year: 2005 }).by).toBe("year");
  });
  it("then the first result, only when it carries the show's own name", () => {
    const r = [{ id: 1, name: "Dark Shadows" }, { id: 2, name: "Dark" }];
    expect(matchShow(r, { label: "Dark" })).toBeNull();
    expect(matchShow([{ id: 3, name: "Shameless" }], { label: "Shameless (US)" }).result.id).toBe(3);
    expect(matchShow([{ id: 4, name: "What If...?" }], { label: "What If…!" }).by).toBe("first");
    expect(matchShow([], {})).toBeNull();
  });
});

describe("planEpisodeRows", () => {
  const base = { show: { id: "s1" }, tmdbId: 9, fieldIds: ids, moduleId: "mEp", containerId: "board", userId: "u", gridId: "g" };
  const eps = [{ season: 0, episode: 1, title: "Special" }, { season: 1, episode: 1, title: "Pilot", airDate: "2000-01-01" }, { season: 1, episode: 2, title: "" }];
  it("skips specials and what is already there; links the show", () => {
    const keys = new Set([episodeKey(9, 1, 2)]);
    let n = 0;
    const rows = planEpisodeRows({ ...base, episodes: eps, existingKeys: keys, newId: () => `id${n++}` });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "S01E01 · Pilot", parentId: "board", moduleId: "mEp", meta: { episodeKey: "tmdb:9:1:1" } });
    expect(rows[0].fields.fShow.value).toBe("s1");
    expect(rows[0].fields.fAir.value).toBe("2000-01-01");
    expect(rows[0].fields.fCat.value).toEqual(["episode"]);
  });
  it("labels without a title", () => expect(episodeLabel({ season: 2, episode: 10 })).toBe("S02E10"));
});

describe("showsToSync", () => {
  it("never-read shows and airing shows; not finished ones", () => {
    const s = [{ id: "a" }, { id: "b", meta: { episodesSyncedAt: "x", tmdbStatus: "Ended" } }, { id: "c", meta: { episodesSyncedAt: "x", tmdbStatus: "Returning Series" } }];
    expect(showsToSync(s).map((x) => x.id)).toEqual(["a", "c"]);
    expect(showsToSync(s, { all: true })).toHaveLength(3);
  });
});

// A fake grid: models answer the three queries loadEpisodeContext makes.
function fakeModels({ episodes = [], shows }) {
  const fields = Object.entries({ "TV Show": "occurrence", Season: "number", "Episode #": "number", "Air Date": "date", "Board Category": "select", Year: "number" })
    .map(([name, type], i) => ({ id: Object.values(ids)[i], name, type }));
  return {
    Field: { find: () => ({ lean: async () => fields }) },
    Occurrence: { find: (q) => ({ lean: async () => (q.identitySignature ? [] : q["meta.episodeKey"] ? episodes : shows) }),
      findOne: () => ({ lean: async () => ({ id: "board", gridId: "g", meta: { episodeModuleId: "mEp" } }) }) },
  };
}
const tmdb = (calls) => ({
  search: async () => [{ id: 9, name: "X", poster_path: "/p.jpg" }],
  show: async () => ({ status: "Returning Series", name: "X", seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }] }),
  season: async (_id, n) => { calls.push(n); return [{ season: n, episode: 1, title: "a" }, { season: n, episode: 2, title: "b" }]; },
});

describe("syncTvEpisodes", () => {
  it("first read: every season, the show stamped with its id and status", async () => {
    const calls = [], written = [];
    const r = await syncTvEpisodes({ gridId: "g", userId: "u", models: fakeModels({ shows: [{ id: "s1", label: "X", meta: { cover: "/t/p/w500/p.jpg" } }] }),
      tmdb: tmdb(calls), all: true, write: async (rows, patch) => written.push({ rows, patch }) });
    expect(calls).toEqual([1, 2]);
    expect(r).toMatchObject({ shows: 1, added: 4, matched: { poster: 1 } });
    expect(written[0].patch.meta).toMatchObject({ tmdbId: 9, tmdbStatus: "Returning Series" });
  });
  it("a show already read re-reads from its latest season and adds only what is new", async () => {
    const calls = [];
    const episodes = [{ moduleId: "mEp", meta: { episodeKey: "tmdb:9:1:1" } }, { moduleId: "mEp", meta: { episodeKey: "tmdb:9:1:2" } }, { moduleId: "mEp", meta: { episodeKey: "tmdb:9:2:1" } }];
    const show = { id: "s1", label: "X", meta: { tmdbId: 9, tmdbStatus: "Returning Series", episodesSyncedAt: "x" } };
    const r = await syncTvEpisodes({ gridId: "g", userId: "u", models: fakeModels({ episodes, shows: [show] }), tmdb: tmdb(calls), write: async () => {} });
    expect(calls).toEqual([2]);
    expect(r.added).toBe(1);
  });
  it("a dry run writes nothing", async () => {
    let wrote = false;
    await syncTvEpisodes({ gridId: "g", userId: "u", models: fakeModels({ shows: [{ id: "s1", label: "X" }] }), tmdb: tmdb([]), all: true, dryRun: true, write: async () => { wrote = true; } });
    expect(wrote).toBe(false);
  });
});

describe("0472 predicates", () => {
  it("the Episode rule: every episode until a show is picked", () => {
    const p = narrowedPredicate("episode", "fShow", "fShow");
    expect(p.rules[2]).toMatchObject({ operator: "OR" });
    expect(p.rules[2].rules[0].left).toBe("$this.fields.fShow.value");
    expect(p.rules[2].rules[1]).toMatchObject({ comparator: "SHARES_ANY", right: "$this.fields.fShow.value" });
  });
  it("Song keeps its rules and gains the album narrowing once", () => {
    const orig = { operator: "AND", rules: [{ left: "x", comparator: "CONTAINS", right: "song" }] };
    const once = withAlbumNarrowing(orig);
    expect(once.rules).toHaveLength(2);
    expect(withAlbumNarrowing(once)).toBe(once);
  });
});
