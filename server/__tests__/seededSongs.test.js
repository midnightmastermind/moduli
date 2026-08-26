// Guards 0256. It DELETES rows from live data, so each test answers "could this
// delete an imported song, or take the artwork down with it?"
import { describe, it, expect } from "vitest";
import { planSeededSongs } from "../migrations/0256-drop-seeded-songs.mjs";

const FIELDS = [{ id: "f-poster", name: "Poster", type: "occurrence" }];
const MODS = [
  { id: "m-board", role: "container", kind: "board", label: "Songs" },
  { id: "m-song", role: "artifact", kind: "song", label: "Song" },
  { id: "m-seed", role: "artifact", label: "Hallelujah" },            // no kind = seeded
  { id: "m-img", role: "artifact", kind: "image", fileRef: "https://img/x.jpg" },
  { id: "m-localimg", role: "artifact", kind: "image", fileRef: "/local/y.jpg" },
];
const board = (ids) => ({ id: "b", moduleId: "m-board", label: "Songs", occurrences: ids });
const imported = (id, label) => ({ id, moduleId: "m-song", label, occurrences: [], fields: {} });
const seeded = (id, label, posterId, extra = {}) => ({ id, moduleId: "m-seed", label, occurrences: [],
  fields: posterId ? { "f-poster": { value: posterId } } : {}, ...extra });
const art = (id, moduleId = "m-img", parentId = "files") => ({ id, moduleId, parentId, occurrences: [] });
const plan = (occ, mods = MODS) => planSeededSongs({ occurrences: occ, modules: mods, fields: FIELDS });

describe("0256 — dropping the seeded Song rows", () => {
  it("moves the artwork to the twin and marks the seeded row for removal", () => {
    const occ = [board(["i1", "s1"]), imported("i1", "Hallelujah"), seeded("s1", "Hallelujah", "a1"), art("a1")];
    const t = plan(occ).targets;
    expect(t).toHaveLength(1);
    expect(t[0].twinId).toBe("i1");
    expect(t[0].cover).toBe("https://img/x.jpg");
  });

  it("NEVER targets an imported row", () => {
    const occ = [board(["i1", "i2"]), imported("i1", "A"), imported("i2", "B")];
    expect(plan(occ).targets).toEqual([]);
  });

  it("removes a row with NO twin, and carries no cover for it", () => {
    const occ = [board(["s1"]), seeded("s1", "Take Five", "a1"), art("a1")];
    const t = plan(occ).targets[0];
    expect(t.twinId).toBeNull();
    expect(t.cover).toBeNull();          // nowhere to put it — the artifact stays in Files
  });

  it("REFUSES when the row OWNS its poster as a child — the cascade would eat the art", () => {
    const occ = [board(["i1", "s1"]), imported("i1", "Hallelujah"),
                 seeded("s1", "Hallelujah", "a1"), art("a1", "m-img", "s1")];
    expect(plan(occ).refusals.join(" ")).toMatch(/owns its poster as a child/);
  });

  it("REFUSES a row that has children of any kind", () => {
    const occ = [board(["s1"]), seeded("s1", "X", null), { id: "kid", moduleId: "m-song", parentId: "s1", occurrences: [] }];
    expect(plan(occ).refusals.join(" ")).toMatch(/has children/);
  });

  it("does not copy a non-http fileRef as a cover", () => {
    const occ = [board(["i1", "s1"]), imported("i1", "Hallelujah"),
                 seeded("s1", "Hallelujah", "a1"), art("a1", "m-localimg")];
    expect(plan(occ).targets[0].cover).toBeNull();
  });

  it("REFUSES when the Songs board is ambiguous", () => {
    const occ = [board([]), { id: "b2", moduleId: "m-board", label: "Songs", occurrences: [] }];
    expect(plan(occ).refusals.join(" ")).toMatch(/expected one Songs board/);
  });
});
