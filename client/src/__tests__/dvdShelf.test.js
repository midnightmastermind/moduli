// A DVD shelf drills like a record crate: show → season → episode (user, 2026-11-03).
import { describe, it, expect } from "vitest";
import { dvdShelfView, shelfItems } from "../vr/shelfItems";
import { nativeOfficeState } from "../vr/officeState";

const ep = (id, s, e, show, season) => ({
  id, moduleId: "mEp", label: `S0${s}E0${e} · t`,
  fields: { fShow: { value: show }, ...(season ? { fSeason: { value: season } } : {}) },
  meta: { episodeKey: `tmdb:9:${s}:${e}`, jellyfinId: `j${id}` },
});
const occurrencesById = {
  show: { id: "show", moduleId: "mSeries", label: "Curb", fields: { cat: { value: ["series"] } }, meta: { cover: "http://x/curb.jpg" } },
  s2: { id: "s2", moduleId: "mSeason", label: "Season 2", fields: { fShow: { value: "show" } } },
  s10: { id: "s10", moduleId: "mSeason", label: "Season 10", fields: { fShow: { value: "show" } } },
  e3: ep("e3", 2, 1, "show", "s2"), e1: ep("e1", 1, 1, "show", "s10"), e2: ep("e2", 1, 2, "show", "s10"),
  bare: { id: "bare", moduleId: "mSeries", label: "NoSeasons", fields: { cat: { value: ["series"] } } },
  b1: ep("b1", 1, 1, "bare"), b2: ep("b2", 1, 2, "bare"),
};
const modulesById = {
  mSeries: { id: "mSeries", role: "artifact", kind: "series", label: "TV Series" },
  mSeason: { id: "mSeason", role: "instance", label: "Season" },
  mEp: { id: "mEp", role: "instance", label: "Episode" },
};
const ctx = { occurrencesById, modulesById };
const shelf = { id: "sh", title: "TV", asset: "dvd", feed: { conditions: [{ fieldId: "cat", comparator: "CONTAINS", value: "series" }], roles: ["artifact"] } };

describe("DVD shelf", () => {
  it("at the top a show is a disc that opens", () => {
    const top = dvdShelfView(shelf, null, ctx);
    expect(top.canUp).toBe(false);
    expect(top.items.find((i) => i.rowId === "show")?.album).toBe(true);
  });
  it("an opened show lists its seasons as folders, in number order (2 before 10)", () => {
    const v = dvdShelfView(shelf, "show:show", ctx);
    expect(v.items.map((i) => [i.id, i.folder, i.count])).toEqual([["season:s2", true, 1], ["season:s10", true, 2]]);
    expect(v.items[0].cover).toBe("http://x/curb.jpg");
    expect(v.path).toEqual(["TV", "Curb"]);
    expect(v.canUp).toBe(true);
  });
  it("an opened season lists only its episodes", () => {
    const v = dvdShelfView(shelf, "season:s10|show:show", ctx);
    expect(v.items.map((i) => i.rowId)).toEqual(["e1", "e2"]);
    expect(v.items[0].src).toBe("watch:e1");
    expect(v.path).toEqual(["TV", "Curb", "Season 10"]);
  });
  it("a show whose episodes name no season goes straight to its episodes", () => {
    expect(dvdShelfView(shelf, "show:bare", ctx).items.map((i) => i.rowId)).toEqual(["b1", "b2"]);
  });
  it("a show is openable on a DVD shelf, and the headset's state carries the drill", () => {
    expect(shelfItems(shelf, ctx).find((i) => i.rowId === "show")?.album).toBe(true);
    const grid = { _id: "g", meta: { vrOffice: { shelves: [shelf], screens: [] } } };
    const st = nativeOfficeState({ grid, ...ctx, foldersById: {}, shelfAt: { sh: "show:show" } });
    expect(st.shelves[0].asset).toBe("dvd");
    expect(st.shelves[0].items.map((i) => i.id)).toEqual(["season:s2", "season:s10"]);
  });
});
