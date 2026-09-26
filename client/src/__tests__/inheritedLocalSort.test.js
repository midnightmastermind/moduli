// A page's sort orders the rows of a container that sets none of its own
// (user, 2026-09-26: "sorting by label isnt working").
import { describe, it, expect } from "vitest";
import { getContainerItemsWithOccurrences } from "../helpers/LayoutHelpers";

const mods = { a: { id: "a", label: "zeta" }, b: { id: "b", label: "Alpha" } };
const occs = { r1: { id: "r1", moduleId: "a" }, r2: { id: "r2", moduleId: "b" } };
const ids = (items) => items.map((i) => i.occurrence.id);

describe("inherited local sort", () => {
  it("applies the ancestor's sort when the container has none", () => {
    const cont = { id: "c", occurrences: ["r1", "r2"], meta: {} };
    expect(ids(getContainerItemsWithOccurrences(null, occs, mods, undefined, cont, { fieldId: "label", dir: "asc" }))).toEqual(["r2", "r1"]);
  });
  it("the container's own sort wins", () => {
    const cont = { id: "c", occurrences: ["r1", "r2"], meta: { localSort: { fieldId: "label", dir: "desc" } } };
    expect(ids(getContainerItemsWithOccurrences(null, occs, mods, undefined, cont, { fieldId: "label", dir: "asc" }))).toEqual(["r1", "r2"]);
  });
  it("no sort anywhere keeps drop order", () => {
    const cont = { id: "c", occurrences: ["r1", "r2"] };
    expect(ids(getContainerItemsWithOccurrences(null, occs, mods, undefined, cont))).toEqual(["r1", "r2"]);
  });
});
