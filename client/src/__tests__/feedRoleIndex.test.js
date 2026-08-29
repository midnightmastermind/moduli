// A feed declares the roles it pulls; it should not walk the rest of the grid.
//
// `resolveFeedItems` applied the role filter by walking EVERY occurrence, once
// per feed. Measured on poms grid 2026-08-29:
//
//     occurrences   21,207  (artifact 15,708 · textblock 2,434 · container
//                            1,654 · instance 1,206 · page 202 · panel 3)
//     enabled feeds     46  of which 44 declare roles ["instance"]
//
// 44 feeds each walked 21,207 rows to reach the 1,206 that could match — 94% of
// every walk rejected by one property read, and 975,522 candidate visits across
// a pass to evaluate 84,480 real ones. At that role mix, resolveFeedItems x46
// went 490ms -> 155ms.
import { describe, it, expect } from "vitest";
import { occurrencesByRole, resolveFeedItems } from "../state/selectors";

const grid = () => {
  const occurrencesById = {}, modulesById = {
    mi: { id: "mi", role: "instance" }, ma: { id: "ma", role: "artifact" },
  };
  const add = (id, moduleId, extra = {}) => (occurrencesById[id] = { id, moduleId, occurrences: [], fields: {}, meta: {}, ...extra });
  add("feed", "mi", { feed: { enabled: true, roles: ["instance"], limit: 50, conditions: [] } });
  // INTERLEAVED on purpose. With all instances added before all artifacts,
  // concatenating the buckets happens to reproduce the walk order and the
  // multi-role ordering test below passes against the very mutation it exists
  // to catch — which is what the A/B found.
  for (let i = 0; i < 5; i++) { add(`i${i}`, "mi"); add(`a${i}`, "ma"); }
  add("own", "mi", { role: "artifact" });     // occurrence role WINS over module
  return { occurrencesById, modulesById };
};

describe("occurrencesByRole", () => {
  it("buckets by the occurrence's role, falling back to the module's", () => {
    const { occurrencesById, modulesById } = grid();
    const byRole = occurrencesByRole(occurrencesById, modulesById);
    expect(byRole.get("instance").map(o => o.id)).toEqual(["feed", "i0", "i1", "i2", "i3", "i4"]);
    expect(byRole.get("artifact").map(o => o.id)).toEqual(["a0", "a1", "a2", "a3", "a4", "own"]);
    // "own" declares artifact on the OCCURRENCE while its module says instance.
    expect(byRole.get("artifact").map(o => o.id)).toContain("own");
  });

  it("preserves insertion order within a role — the slice(0, limit) depends on it", () => {
    const { occurrencesById, modulesById } = grid();
    const ids = occurrencesByRole(occurrencesById, modulesById).get("instance").map(o => o.id);
    expect(ids).toEqual([...ids].sort((a, b) =>
      Object.keys(occurrencesById).indexOf(a) - Object.keys(occurrencesById).indexOf(b)));
  });

  it("drops role-less occurrences, matching roles.includes(null) === false", () => {
    const occurrencesById = { x: { id: "x", moduleId: "gone", occurrences: [] } };
    const byRole = occurrencesByRole(occurrencesById, {});
    expect([...byRole.values()].flat()).toEqual([]);
  });

  it("is cached on the map identity, and REBUILDS when modulesById changes", () => {
    // An occurrence with no role of its own inherits its MODULE's, so a module
    // edit changes the answer without the occurrence map moving. Keying on the
    // occurrence map alone would serve the old buckets.
    const { occurrencesById } = grid();
    const mods1 = { mi: { id: "mi", role: "instance" }, ma: { id: "ma", role: "artifact" } };
    expect(occurrencesByRole(occurrencesById, mods1)).toBe(occurrencesByRole(occurrencesById, mods1));
    const mods2 = { mi: { id: "mi", role: "container" }, ma: { id: "ma", role: "artifact" } };
    expect(occurrencesByRole(occurrencesById, mods2).get("container").map(o => o.id)).toContain("i0");
    expect(occurrencesByRole(occurrencesById, mods2).get("instance")).toBeUndefined();
  });
});

describe("resolveFeedItems is unchanged by the bucketing", () => {
  const rowsOf = (r) => r.map(x => x.occurrence.id);

  it("returns the same rows a full walk would, in the same order", () => {
    const { occurrencesById, modulesById } = grid();
    const out = resolveFeedItems(occurrencesById.feed, { occurrencesById, modulesById });
    expect(rowsOf(out)).toEqual(["i0", "i1", "i2", "i3", "i4"]);   // never the artifacts, never itself
  });

  it("a MULTI-role feed keeps the full scan, so its order is interleaved not grouped", () => {
    // The order guard. Concatenating buckets would return all instances then
    // all artifacts, which is a DIFFERENT first 50 rows once limit bites.
    const { occurrencesById, modulesById } = grid();
    const feed = { ...occurrencesById.feed, id: "feed", feed: { enabled: true, roles: ["instance", "artifact"], limit: 50, conditions: [] } };
    occurrencesById.feed = feed;
    const ids = rowsOf(resolveFeedItems(feed, { occurrencesById, modulesById }));
    const walkOrder = Object.keys(occurrencesById).filter(id => id !== "feed");
    expect(ids).toEqual(walkOrder.filter(id => ids.includes(id)));
    // And it is genuinely interleaved, so grouping by role WOULD differ —
    // without this the assertion above can pass on a fixture where the two
    // orders coincide.
    expect(ids.slice(0, 4)).toEqual(["i0", "a0", "i1", "a1"]);
  });

  it("still excludes feed copies as sources", () => {
    const { occurrencesById, modulesById } = grid();
    occurrencesById.i0.meta = { feedSourceId: "somewhere" };
    expect(rowsOf(resolveFeedItems(occurrencesById.feed, { occurrencesById, modulesById }))).not.toContain("i0");
  });
});
