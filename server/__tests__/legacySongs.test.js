// Guards 0255. It edits MODULES that other rows may share and copies values
// between rows, so each test answers "could this bind the wrong field, copy from
// the wrong song, or overwrite something the user set?"
import { describe, it, expect } from "vitest";
import { planLegacySongs } from "../migrations/0255-connect-legacy-songs.mjs";

// The TEXT decoy is listed FIRST on purpose: with it last, a name-only lookup
// still finds the right field and the type guard is never exercised — which is
// how the first version of that test passed against the broken version.
const FIELDS = [
  { id: "f-artist-text", name: "Artist", type: "text" },
  { id: "f-artist", name: "Artist", type: "occurrence" },
  { id: "f-album", name: "Album", type: "occurrence" },
];
const MODS = [
  { id: "m-board", role: "container", kind: "board", label: "Songs" },
  { id: "m-song", role: "artifact", kind: "song", label: "Song", fieldBindings: [{ fieldId: "f-artist" }, { fieldId: "f-album" }] },
  { id: "m-hall", role: "artifact", label: "Hallelujah", fieldBindings: [{ fieldId: "f-poster", hidden: true }] },
  { id: "m-take", role: "artifact", label: "Take Five", fieldBindings: [{ fieldId: "f-poster", hidden: true }] },
];
const imported = (id, label, artist, album) => ({ id, moduleId: "m-song", label, occurrences: [],
  fields: { "f-artist": { value: artist }, "f-album": { value: album } } });
const legacy = (id, moduleId, label, fields = {}) => ({ id, moduleId, label, occurrences: [], fields });
const board = (ids) => ({ id: "b", moduleId: "m-board", label: "Songs", occurrences: ids });
const plan = (occ, mods = MODS) => planLegacySongs({ occurrences: occ, modules: mods, fields: FIELDS });

describe("0255 — connecting the seeded songs", () => {
  it("copies Artist and Album from the imported twin, matched on a normalised name", () => {
    const occ = [board(["i1", "l1"]), imported("i1", "Hallelujah", "art-1", "alb-1"), legacy("l1", "m-hall", "hallelujah!")];
    const t = plan(occ).targets[0];
    expect(t.twinId).toBe("i1");
    expect(t.artist).toBe("art-1");
    expect(t.album).toBe("alb-1");
    expect(t.needsBindings).toBe(true);
  });

  it("leaves values EMPTY when there is no twin, rather than guessing", () => {
    const occ = [board(["l1"]), legacy("l1", "m-take", "Take Five")];
    const t = plan(occ).targets[0];
    expect(t.twinId).toBeNull();
    expect(t.artist).toBeNull();
    expect(t.album).toBeNull();
    expect(t.needsBindings).toBe(true);       // the field still appears, to be filled
  });

  it("NEVER overwrites a value the row already has", () => {
    const occ = [board(["i1", "l1"]), imported("i1", "Hallelujah", "art-1", "alb-1"),
                 legacy("l1", "m-hall", "Hallelujah", { "f-artist": { value: "MINE" } })];
    const t = plan(occ).targets[0];
    expect(t.artist).toBeNull();              // already set — left alone
    expect(t.album).toBe("alb-1");            // this one was empty
  });

  it("does not treat the IMPORTED songs as targets — they are already connected", () => {
    const occ = [board(["i1", "i2"]), imported("i1", "A", "x", "y"), imported("i2", "B", "x", "y")];
    const p = plan(occ);
    expect(p.targets).toEqual([]);
    expect(p.importedCount).toBe(2);
  });

  it("picks the OCCURRENCE-typed Artist, not a text field of the same name", () => {
    expect(plan([board([]), ]).ARTIST).toBe("f-artist");
  });

  it("reports a module that already binds both as needing nothing", () => {
    const mods = [...MODS, { id: "m-done", role: "artifact", label: "Redbone",
      fieldBindings: [{ fieldId: "f-artist" }, { fieldId: "f-album" }] }];
    const occ = [board(["l1"]), legacy("l1", "m-done", "Redbone")];
    expect(plan(occ, mods).targets[0].needsBindings).toBe(false);
  });

  it("REFUSES when the Songs board is ambiguous", () => {
    const occ = [board(["l1"]), { id: "b2", moduleId: "m-board", label: "Songs", occurrences: [] }, legacy("l1", "m-hall", "x")];
    expect(plan(occ).refusals.join(" ")).toMatch(/expected one Songs board/);
  });
});
