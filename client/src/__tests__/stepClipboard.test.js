// @vitest-environment jsdom
// Copy / Paste a pipeline step (2026-10-15). The step editor can only reorder
// within one list, so an existing loop could never be moved INTO a new IF, and a
// block built in one op could not be reused in another (38 trackers need poms'
// event gate around their loop). Copy puts the step on a clipboard that survives
// switching ops; Paste inserts a copy with FRESH ids everywhere.
import { describe, it, expect, beforeEach } from "vitest";
import { copyStep, readCopiedStep, pasteableStep, clearCopiedStep } from "../helpers/stepClipboard";

const loop = { id: "L", type: "loop", overExpr: "$allInstances", as: "$item", body: [
  { id: "I", type: "if", condition: { id: "g", operator: "AND", rules: [{ id: "r1", left: "$a", comparator: "IS", right: "1" }, { id: "g2", operator: "OR", rules: [{ id: "r2", left: "$b", comparator: "IS_EMPTY" }] }] },
    then: [{ id: "A", type: "action", config: { type: "ADD_TO_VAR", name: "$acc" } }], else: [] },
] };
const ids = (x, out = []) => { if (Array.isArray(x)) x.forEach((y) => ids(y, out)); else if (x && typeof x === "object") { if (x.id) out.push(x.id); Object.values(x).forEach((v) => ids(v, out)); } return out; };

beforeEach(() => clearCopiedStep());
describe("step clipboard", () => {
  it("nothing copied reads null", () => { expect(readCopiedStep()).toBeNull(); });
  it("a copied step reads back with the same content", () => {
    copyStep(loop);
    expect(readCopiedStep()).toEqual(loop);
  });
  it("a pasted step has fresh ids on every step AND every rule/group, and nothing else changes", () => {
    copyStep(loop);
    const p = pasteableStep();
    const before = new Set(ids(loop)); const after = ids(p);
    expect(after.length).toBe(before.size);
    for (const id of after) expect(before.has(id)).toBe(false);
    const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" ? undefined : v)));
    expect(strip(p)).toEqual(strip(loop));
  });
  it("pasting twice gives two different id sets", () => {
    copyStep(loop);
    const a = ids(pasteableStep()), b = ids(pasteableStep());
    expect(a.some((x) => b.includes(x))).toBe(false);
  });
});

import fs from "node:fs"; import path from "node:path";
describe("wiring", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
  it("every step carries a Copy step button and every list offers + Paste", () => {
    expect(src).toMatch(/aria-label="Copy step"/);
    expect(src).toMatch(/onClick=\{\(\) => copyStep\(step\)\}/);
    expect(src).toMatch(/onClick=\{pasteStep\}/);
    expect(src).toMatch(/\{extra\}/); // the wrapper renders it
  });
});
