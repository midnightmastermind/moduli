// A TV show on a VHS shelf opens into its episodes, in season order (user, 2026-10-31).
import { describe, it, expect } from "vitest";
import { showEpisodeItems, shelfItems } from "../vr/shelfItems";
import { nativeOfficeState } from "../vr/officeState";

const ep = (id, s, e, show) => ({ id, moduleId: "mEp", label: `S0${s}E0${e} · t`, fields: { fShow: { value: show } }, meta: { episodeKey: `tmdb:9:${s}:${e}` } });
const occurrencesById = {
  show: { id: "show", moduleId: "mSeries", label: "Curb", fields: { cat: { value: ["series"] } }, meta: { cover: "http://x/curb.jpg" } },
  other: { id: "other", moduleId: "mSeries", label: "Other", fields: { cat: { value: ["series"] } } },
  e3: ep("e3", 2, 1, "show"), e1: ep("e1", 1, 1, "show"), e2: ep("e2", 1, 2, "show"), x: ep("x", 1, 1, "other"),
};
const modulesById = { mSeries: { id: "mSeries", role: "artifact", kind: "series", label: "TV Series" }, mEp: { id: "mEp", role: "instance", label: "Episode" } };

describe("TV shelf", () => {
  it("a show's episodes, in season/episode order, with the show's cover", () => {
    const items = showEpisodeItems("show", { occurrencesById, modulesById });
    expect(items.map((i) => i.rowId)).toEqual(["e1", "e2", "e3"]);
    expect(items[0].cover).toBe("http://x/curb.jpg");
  });
  it("a show on a VHS shelf is openable; on a bookshelf it is not", () => {
    const shelf = (asset) => ({ id: "sh", asset, feed: { conditions: [{ fieldId: "cat", comparator: "CONTAINS", value: "series" }], roles: ["artifact"] } });
    const vhs = shelfItems(shelf("vhs"), { occurrencesById, modulesById });
    expect(vhs.find((i) => i.rowId === "show")?.album).toBe(true);
    expect(shelfItems(shelf("book"), { occurrencesById, modulesById }).find((i) => i.rowId === "show")?.album).toBe(false);
  });
  it("an opened show on the headset's shelf lists its episodes", () => {
    const grid = { _id: "g", meta: { vrOffice: { shelves: [{ id: "sh", title: "TV", asset: "vhs", feed: { conditions: [{ fieldId: "cat", comparator: "CONTAINS", value: "series" }] } }], screens: [] } } };
    const st = nativeOfficeState({ grid, occurrencesById, modulesById, foldersById: {}, shelfAt: { sh: "album:show|" } });
    expect(st.shelves[0].items.map((i) => i.rowId)).toEqual(["e1", "e2", "e3"]);
    expect(st.shelves[0].path).toEqual(["TV", "Curb"]);
  });
});
