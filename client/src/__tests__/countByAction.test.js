// COUNT_BY — "how many rows point at each row" in one pass (user, 2026-10-31: counts on the drill-down boards).
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const run = (rows, cfg = {}) => {
  const updates = executeActionItem("COUNT_BY", { byField: "fAlbum", to: "fSongs", ...cfg }, { $allItems: rows },
    { state: {}, modulesById: { mAlbum: { fieldBindings: [{ fieldId: "fSongs" }] }, mSong: { fieldBindings: [{ fieldId: "fAlbum" }] } } });
  return Object.fromEntries(updates.filter((u) => u._effect === "UPDATE_ITEM_FIELD").map((u) => [u.itemId, u.value]));
};
const album = (id, songs) => ({ id, moduleId: "mAlbum", fields: songs == null ? {} : { fSongs: { value: songs } } });
const song = (id, album) => ({ id, moduleId: "mSong", fields: { fAlbum: { value: album } } });

describe("COUNT_BY", () => {
  it("counts the rows pointing at each parent, 0 included", () => {
    expect(run([album("a"), album("b"), song("s1", "a"), song("s2", "a")])).toEqual({ a: 2, b: 0 });
  });
  it("writes only what changed", () => {
    expect(run([album("a", 2), album("b", 0), song("s1", "a"), song("s2", "a")])).toEqual({});
  });
  it("a list value counts once per member; feed copies are not counted", () => {
    const rows = [album("a"), album("b"), { id: "x", moduleId: "mSong", fields: { fAlbum: { value: ["a", "b"] } } },
      { id: "copy", moduleId: "mSong", meta: { feedSourceId: "s1" }, fields: { fAlbum: { value: "a" } } }];
    expect(run(rows)).toEqual({ a: 1, b: 1 });
  });
  it("only rows carrying the count field are written", () => {
    expect(run([album("a"), song("s1", "a")])).toEqual({ a: 1 });   // the song does not bind fSongs
  });
});

describe("COUNT_BY ofModules", () => {
  it("counts only rows of the named modules", () => {
    const rows = [album("a"), song("s1", "a"), { id: "x", moduleId: "mOther", fields: { fAlbum: { value: "a" } } }];
    expect(run(rows, { ofModules: ["mSong"] })).toEqual({ a: 1 });
  });
});

describe("COUNT_BY toModules", () => {
  it("writes only on rows of the named modules", () => {
    const rows = [album("a"), { id: "art", moduleId: "mArtist", fields: {} }, song("s1", "a")];
    const updates = executeActionItem("COUNT_BY", { byField: "fAlbum", to: "fSongs", toModules: ["mAlbum"] }, { $allItems: rows },
      { state: {}, modulesById: { mAlbum: { fieldBindings: [{ fieldId: "fSongs" }] }, mArtist: { fieldBindings: [{ fieldId: "fSongs" }] } } });
    expect(updates.map((u) => u.itemId)).toEqual(["a"]);
  });
});
