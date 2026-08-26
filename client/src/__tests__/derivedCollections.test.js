// $allItems has been cached across a sweep for a while; the collections DERIVED
// from it were not — they were rebuilt inside every executePipeline call, i.e.
// once per OPERATION. On poms grid that is four filters plus two 21,766-key maps
// rebuilt 27 times for one `Completed` toggle.
//
// These tests pin the caching AND that the derivation is still correct, because
// a wrong split here would silently change which occurrences every op can see.
import { describe, it, expect } from "vitest";
import { derivedCollectionsFor } from "../helpers/operationExecutor";

const items = [
  { id: "c1", role: "container" },
  { id: "p1", role: "page" },
  { id: "pan1", role: "panel" },
  { id: "i1", role: "instance" },
  { id: "i2", role: "instance" },
  { id: "a1", role: "artifact" },     // belongs to none of the four
];

describe("derivedCollectionsFor", () => {
  it("splits by role, and a role with no bucket lands in none of them", () => {
    const d = derivedCollectionsFor(items);
    expect(d.containers.map(x => x.id)).toEqual(["c1"]);
    expect(d.pages.map(x => x.id)).toEqual(["p1"]);
    expect(d.panels.map(x => x.id)).toEqual(["pan1"]);
    expect(d.instances.map(x => x.id)).toEqual(["i1", "i2"]);
    // the artifact is still reachable by id — it is only absent from the
    // role-filtered collections, exactly as the old `.filter()` calls left it
    expect(d.byId.a1).toBe(items[5]);
  });

  it("matches what the old per-op filters produced, element for element", () => {
    const d = derivedCollectionsFor(items);
    expect(d.containers).toEqual(items.filter(i => i.role === "container"));
    expect(d.pages).toEqual(items.filter(i => i.role === "page"));
    expect(d.panels).toEqual(items.filter(i => i.role === "panel"));
    expect(d.instances).toEqual(items.filter(i => i.role === "instance"));
    expect(d.byId).toEqual(Object.fromEntries(items.map(i => [i.id, i])));
  });

  it("returns the SAME object for the same array — that is the whole point", () => {
    const first = derivedCollectionsFor(items);
    expect(derivedCollectionsFor(items)).toBe(first);
    expect(derivedCollectionsFor(items).instances).toBe(first.instances);
  });

  it("a NEW array rebuilds — the sweep discards _allItemsCache on a structural write", () => {
    const next = [{ id: "i9", role: "instance" }];
    const d = derivedCollectionsFor(next);
    expect(d).not.toBe(derivedCollectionsFor(items));
    expect(d.instances.map(x => x.id)).toEqual(["i9"]);
  });

  it("tolerates a missing/non-array read model instead of throwing mid-sweep", () => {
    expect(derivedCollectionsFor(undefined).instances).toEqual([]);
    expect(derivedCollectionsFor(null).byId).toEqual({});
  });
});
