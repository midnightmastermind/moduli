// The overlay's STRUCTURE version moves only on writes that can change who lists whom, so the whole-grid
// parent index (keyed on it) is not rebuilt once per field write while an op sweep's effects apply.
import { describe, it, expect } from "vitest";
import { makeOccOverlay } from "../helpers/occOverlay.js";

const seed = () => {
  const o = makeOccOverlay();
  o.set("p", { id: "p", occurrences: ["a", "b"] });
  o.set("a", { id: "a", parentId: "p", fields: {} });
  o.set("b", { id: "b", parentId: "p", fields: {} });
  return o;
};

describe("occOverlay.structVersion", () => {
  it("does NOT move on a value write", () => {
    const o = seed(); const v = o.structVersion, full = o.version;
    o.set("a", { id: "a", parentId: "p", fields: { f: { value: 1 } } });
    o.set("p", { id: "p", occurrences: ["a", "b"], label: "renamed" }); // a new array with the same ids
    expect(o.structVersion).toBe(v);
    expect(o.version).toBe(full + 2);
  });
  it("moves when a child list changes", () => {
    const o = seed(); const v = o.structVersion;
    o.set("p", { id: "p", occurrences: ["b", "a"] });
    expect(o.structVersion).toBe(v + 1);
    o.set("p", { id: "p", occurrences: ["b"] });
    expect(o.structVersion).toBe(v + 2);
  });
  it("moves when a parentId changes, a new row arrives, a row is dropped, or on reset", () => {
    const o = seed(); let v = o.structVersion;
    o.set("a", { id: "a", parentId: "q" }); expect(o.structVersion).toBe(++v);
    o.set("c", { id: "c", parentId: "p" }); expect(o.structVersion).toBe(++v);
    o.drop("c"); expect(o.structVersion).toBe(++v);
    o.reset(); expect(o.structVersion).toBe(++v);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
describe("wiring", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../state/bindSocketToStore.js"), "utf8");
  it("the ancestor-chain parent index and the sweep's parent map key on the STRUCTURE version", () => {
    expect(src).toMatch(/_acParentVersion !== _occOverlay\.structVersion/);
    expect(src).toMatch(/_occVersion: _occOverlay\.structVersion/);
    expect(src).toMatch(/buildParentMap\(localOccsById\)/); // control: the index is still built here
  });
});
