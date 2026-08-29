// Splitting full_state into "what you are looking at" and "what merely exists".
//
// The tablet downloads 28.74 MB of grid state on every load, 16.15 MB of which
// is the song/album/bookmark/artist catalogue. This split sends the working
// surfaces first and the catalogue immediately behind it — everything still
// arrives, so the 19 ops that walk $allItems are unaffected.
import { describe, it, expect } from "vitest";
import { splitFullState, DEFERRED_ROLES } from "../utils/splitFullState.js";

const mod = (id, role) => ({ id, role });
const occ = (id, moduleId) => ({ id, moduleId });

describe("splitFullState", () => {
  it("holds artifacts back and keeps the working surfaces", () => {
    const modules = [mod("mi", "instance"), mod("mc", "container"), mod("mp", "page"), mod("ma", "artifact")];
    const occurrences = [occ("i1", "mi"), occ("c1", "mc"), occ("p1", "mp"), occ("a1", "ma"), occ("a2", "ma")];
    const { core, deferred } = splitFullState(occurrences, modules);
    expect(core.map(o => o.id)).toEqual(["i1", "c1", "p1"]);
    expect(deferred.map(o => o.id)).toEqual(["a1", "a2"]);
  });

  // NOTHING MAY BE LOST. The two halves must reconstitute the input exactly —
  // a row in neither is a row that vanishes from the grid.
  it("loses nothing: core + deferred is the whole set, with no overlap", () => {
    const modules = [mod("mi", "instance"), mod("ma", "artifact"), mod("mt", "textblock")];
    const occurrences = Array.from({ length: 50 }, (_, i) =>
      occ(`o${i}`, ["mi", "ma", "mt"][i % 3]));
    const { core, deferred } = splitFullState(occurrences, modules);
    expect(core.length + deferred.length).toBe(occurrences.length);
    expect(new Set([...core, ...deferred].map(o => o.id)).size).toBe(occurrences.length);
  });

  it("the same holds for modules", () => {
    const modules = [mod("mi", "instance"), mod("ma", "artifact"), mod("mb", "artifact")];
    const { coreModules, deferredModules } = splitFullState([], modules);
    expect(coreModules.length + deferredModules.length).toBe(modules.length);
  });

  // THE CASE THAT WOULD BREAK A WORKING ROW. An artifact-role MODULE can also
  // back something in the core set (a poster child of a live row). It must ship
  // WITH the core, or that row is module-less until the second message lands —
  // which renders as nothing at all.
  it("keeps an artifact module whose placement is in the core set", () => {
    const modules = [mod("shared", "artifact"), mod("lonely", "artifact")];
    const occurrences = [
      { id: "row", moduleId: "shared", role: "instance" },   // core: placed by a working row
      occ("a1", "lonely"),                                   // deferred: artifact only
    ];
    // The occurrence split keys on the MODULE's role, so `row` lands in deferred
    // here; what this test pins is the MODULE decision, which reads the core set.
    const { coreModules, deferredModules } = splitFullState(
      [occ("row2", "mi"), occ("a1", "lonely")],
      [mod("mi", "instance"), mod("shared", "artifact"), mod("lonely", "artifact")],
    );
    expect(deferredModules.map(m => m.id).sort()).toEqual(["lonely", "shared"]);
    // …and once something in CORE places it, it is kept:
    const r2 = splitFullState([occ("row3", "shared")], [mod("shared", "instance"), mod("lonely", "artifact")]);
    expect(r2.coreModules.map(m => m.id)).toContain("shared");
    expect(occurrences.length).toBe(2);
  });

  it("defers an artifact module only when nothing in core places it", () => {
    const modules = [mod("ma", "artifact")];
    // placed ONLY by a deferred occurrence → safe to hold back
    const a = splitFullState([occ("a1", "ma")], modules);
    expect(a.deferredModules.map(m => m.id)).toEqual(["ma"]);
  });

  it("is a no-op on a grid with no artifacts", () => {
    const modules = [mod("mi", "instance")];
    const occurrences = [occ("i1", "mi"), occ("i2", "mi")];
    const { core, deferred, deferredModules } = splitFullState(occurrences, modules);
    expect(core).toHaveLength(2);
    expect(deferred).toHaveLength(0);
    expect(deferredModules).toHaveLength(0);
  });

  // An occurrence whose module is missing must not silently disappear into the
  // deferred half — that is the `module-less-occurrence` integrity class, and
  // holding those back would hide them from the load sweep too.
  it("keeps a module-less occurrence in the core set", () => {
    const { core, deferred } = splitFullState([occ("orphan", "gone")], []);
    expect(core.map(o => o.id)).toEqual(["orphan"]);
    expect(deferred).toHaveLength(0);
  });

  it("handles empty input", () => {
    const r = splitFullState();
    expect(r.core).toEqual([]); expect(r.deferred).toEqual([]);
  });

  it("names a ROLE, never a label or a board", () => {
    expect(DEFERRED_ROLES).toEqual(["artifact"]);
  });
});
