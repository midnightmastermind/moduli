import { describe, it, expect } from "vitest";
import { planJellyfinLinks } from "../services/jellyfinMatch.js";

const mv = (o = {}) => ({ Id: "m1", Type: "Movie", Name: "Heat", ProductionYear: 1995, Path: "", ProviderIds: {}, library: "movies", ...o });
const row = (o = {}) => ({ id: "r1", label: "Heat", year: 1995, filePath: "", tmdbId: "", imdbId: "", jellyfinId: "", board: "movies", ...o });
const plan = (items, rows) => planJellyfinLinks({ items, rows });

describe("planJellyfinLinks", () => {
  it("path match wins over a conflicting title match", () => {
    const r = plan([mv({ Path: "D:\\Movies\\Heat (1995)\\heat.mkv" })], [
      row({ id: "title", label: "Heat" }),
      row({ id: "path", label: "Other", year: 2001, filePath: "d:/movies/heat (1995)/heat.mkv" }),
    ]);
    expect(r.link).toEqual([{ occId: "path", jfId: "m1" }]);
    expect(r.create).toEqual([]);
  });
  it("matches a WSL path against the Jellyfin UNC path by the mnt/wsl tail", () => {
    const r = plan([mv({ Path: "\\\\wsl.localhost\\Ubuntu-24.04\\mnt\\wsl\\d\\Movies\\Heat.mkv", Name: "zzz" })],
      [row({ label: "Nope", year: 1, filePath: "/mnt/wsl/d/Movies/heat.mkv" })]);
    expect(r.link).toEqual([{ occId: "r1", jfId: "m1" }]);
  });
  it("matches by TMDB id and IMDb id", () => {
    expect(plan([mv({ Name: "x", ProviderIds: { Tmdb: "949" } })], [row({ label: "Heat!", year: 0, tmdbId: "949" })]).link).toHaveLength(1);
    expect(plan([mv({ Name: "x", ProviderIds: { Imdb: "tt0113277" } })], [row({ label: "Q", year: 0, imdbId: "tt0113277" })]).link).toHaveLength(1);
  });
  it("matches title + year within one year, ignoring articles and punctuation", () => {
    const r = plan([mv({ Name: "The Heat!", ProductionYear: 1996 })], [row({ label: "heat", year: 1995 })]);
    expect(r.link).toEqual([{ occId: "r1", jfId: "m1" }]);
    expect(plan([mv({ ProductionYear: 1998 })], [row()]).create).toHaveLength(1);
  });
  it("counts a row already carrying the jellyfinId as unchanged", () => {
    const r = plan([mv()], [row({ jellyfinId: "m1" })]);
    expect(r).toMatchObject({ link: [], create: [], ambiguous: [], unchanged: 1 });
  });
  it("does not relink a row carrying another jellyfinId", () => {
    const r = plan([mv({ Id: "m2" })], [row({ jellyfinId: "m1" })]);
    expect(r.ambiguous).toEqual([{ jfId: "m2", reason: "row linked to another item" }]);
    expect(r.create).toEqual([]);
  });
  it("two rows with the same title+year are ambiguous, not created", () => {
    const r = plan([mv()], [row({ id: "a" }), row({ id: "b" })]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.create).toEqual([]);
    expect(r.link).toEqual([]);
  });
  it("two items to one row are both ambiguous", () => {
    const r = plan([mv({ Id: "a" }), mv({ Id: "b" })], [row()]);
    expect(r.ambiguous.map((a) => a.jfId).sort()).toEqual(["a", "b"]);
    expect(r.link).toEqual([]);
  });
  it("a row with no year matches title-only only when unique", () => {
    expect(plan([mv()], [row({ year: null })]).link).toHaveLength(1);
    const r = plan([mv({ Id: "a" }), mv({ Id: "b" })], [row({ year: null })]);
    expect(r.link).toEqual([]);
    expect(r.create).toEqual([]);
  });
  it("creates a Jellyfin-only movie on movies", () => {
    expect(plan([mv()], []).create).toEqual([{ item: mv(), board: "movies" }]);
  });
  it("documentaries library links in place, else creates on danny", () => {
    const d = mv({ library: "documentaries" });
    expect(plan([d], [row({ board: "documentaries" })]).link).toHaveLength(1);
    expect(plan([d], [row({ board: "danny" })]).link).toHaveLength(1);
    expect(plan([d], [row({ board: "movies" })]).create[0].board).toBe("danny");
    expect(plan([mv()], [row({ board: "tv" })]).create[0].board).toBe("movies");
  });
  it("links an episode to the episode row of the linked show", () => {
    const show = { Id: "s1", Type: "Series", Name: "Dark", ProductionYear: 2017, ProviderIds: {}, library: "shows" };
    const ep = { Id: "e5", Type: "Episode", Name: "x", SeriesId: "s1", ParentIndexNumber: 1, IndexNumber: 5, library: "shows" };
    const rows = [
      row({ id: "showrow", label: "Dark", year: 2017, board: "tv" }),
      row({ id: "ep5", label: "ep", board: "episodes", showRowId: "showrow", season: 1, number: 5, year: null }),
      row({ id: "ep6", label: "ep", board: "episodes", showRowId: "showrow", season: 1, number: 6, year: null }),
    ];
    const r = plan([show, ep], rows);
    expect(r.link).toEqual(expect.arrayContaining([{ occId: "showrow", jfId: "s1" }, { occId: "ep5", jfId: "e5" }]));
  });
  it("creates a special S00E01 on episodes when the show is linked", () => {
    const show = { Id: "s1", Type: "Series", Name: "Dark", ProductionYear: 2017, ProviderIds: {}, library: "shows" };
    const ep = { Id: "sp", Type: "Episode", Name: "Special", SeriesId: "s1", ParentIndexNumber: 0, IndexNumber: 1, library: "shows" };
    const r = plan([show, ep], [row({ id: "showrow", label: "Dark", year: 2017, board: "tv" })]);
    expect(r.create).toEqual([{ item: ep, board: "episodes" }]);
  });
  it("links a season by (show row, season number)", () => {
    const show = { Id: "s1", Type: "Series", Name: "Dark", ProductionYear: 2017, ProviderIds: {}, library: "shows" };
    const se = { Id: "se2", Type: "Season", Name: "Season 2", SeriesId: "s1", IndexNumber: 2, library: "shows" };
    const rows = [row({ id: "sr", label: "Dark", year: 2017, board: "tv" }),
      row({ id: "season2", label: "S2", board: "seasons", showRowId: "sr", season: 2, year: null })];
    expect(plan([show, se], rows).link).toContainEqual({ occId: "season2", jfId: "se2" });
  });
  it("seasons/episodes of an unlinked series are ambiguous, never created", () => {
    const ep = { Id: "e1", Type: "Episode", Name: "x", SeriesId: "ghost", ParentIndexNumber: 1, IndexNumber: 1, library: "shows" };
    const se = { Id: "se1", Type: "Season", Name: "x", SeriesId: "ghost", IndexNumber: 1, library: "shows" };
    const r = plan([ep, se], []);
    expect(r.create).toEqual([]);
    expect(r.ambiguous).toEqual(expect.arrayContaining([{ jfId: "e1", reason: "series unlinked" }, { jfId: "se1", reason: "series unlinked" }]));
  });
  it("uses a show row that already carries the series jellyfinId", () => {
    const ep = { Id: "e1", Type: "Episode", Name: "x", SeriesId: "s1", ParentIndexNumber: 1, IndexNumber: 1, library: "shows" };
    const rows = [row({ id: "sr", board: "tv", jellyfinId: "s1" }),
      row({ id: "e", board: "episodes", showRowId: "sr", season: 1, number: 1, year: null })];
    expect(plan([ep], rows).link).toEqual([{ occId: "e", jfId: "e1" }]);
  });
});
