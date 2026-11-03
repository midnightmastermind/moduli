// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { episodeQueueSrc, shelfItems, dvdShelfView } from "../vr/shelfItems.js";
import { readQueue } from "../ReaderApp.jsx";

const ep = (id, label, show, season, jf = true) => ({ id, label, moduleId: "m-ep", meta: { episodeKey: id, ...(jf ? { jellyfinId: "j" + id } : {}) },
  fields: { show: { value: show }, season: { value: season } } });

describe("a DVD disc plays its episodes", () => {
  it("specials go last, so a series starts at S1E1", () => {
    const src = episodeQueueSrc([ep("a", "S00E01 · Special"), ep("b", "S01E01 · Pilot"), ep("c", "S01E02 · Two")]);
    expect(src).toBe("watch:b,c,a");
  });
  it("only episodes Jellyfin streams, and none means no source", () => {
    expect(episodeQueueSrc([ep("x", "S01E01", "s", "t", false)])).toBe(null);
  });
  it("the screen reads several ids as a queue, one id as one", () => {
    expect(readQueue("a,b, c")).toEqual(["a", "b", "c"]);
    expect(readQueue("a")).toEqual(["a"]);
  });
  it("a series on a DVD shelf, and a season disc, carry their queues", () => {
    const occurrencesById = {
      SH: { id: "SH", label: "Show", moduleId: "m-show", parentId: "B", meta: { jellyfinId: "jSH" }, fields: {} },
      S1: { id: "S1", label: "Season 1", moduleId: "m-season", meta: {}, fields: {} },
      S2: { id: "S2", label: "Season 2", moduleId: "m-season", meta: {}, fields: {} },
      e2: ep("e2", "S02E01 · Later", "SH", "S2"), e1: ep("e1", "S01E01 · Pilot", "SH", "S1"), e0: ep("e0", "S01E02 · Next", "SH", "S1"),
      B: { id: "B", label: "Board", moduleId: "m-b", occurrences: ["SH"], fields: {} },
    };
    const modulesById = { "m-show": { id: "m-show", role: "artifact", kind: "series", label: "Show" }, "m-season": { id: "m-season", label: "Season" },
      "m-ep": { id: "m-ep", label: "Episode" }, "m-b": { id: "m-b", role: "container" } };
    const shelf = { id: "sh", title: "TV", asset: "dvd", feed: { enabled: true, conditions: [], roles: ["artifact"], scope: "B", limit: 100 } };
    const items = shelfItems(shelf, { occurrencesById, modulesById });
    expect(items.find((i) => i.rowId === "SH")?.src).toBe("watch:e1,e0,e2");
    const seasons = dvdShelfView(shelf, "show:SH", { occurrencesById, modulesById }).items;
    expect(seasons.map((s) => [s.title, s.src])).toEqual([["Season 1", "watch:e1,e0"], ["Season 2", "watch:e2"]]);
  });
});
