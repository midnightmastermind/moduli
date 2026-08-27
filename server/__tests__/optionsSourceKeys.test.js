import { describe, it, expect } from "vitest";
import { planOptionsSourceFix } from "../migrations/0268-optionssource-key-vocabulary.mjs";
import { planLabelPathFix, CANON } from "../migrations/0269-optionssource-label-path.mjs";

const fld = (optionsSource) => ({ id: "f", name: "Author", meta: { optionsSource } });

describe("0268 — key vocabulary", () => {
  it("moves collection -> over and conditions -> predicate", () => {
    const out = planOptionsSourceFix(fld({ mode: "find", collection: "$allItems",
      conditions: [{ fieldId: "tag", comparator: "CONTAINS", value: "bookAuthor" },
                   { path: "meta.feedSourceId", comparator: "IS_EMPTY" }] }));
    expect(out.patch.over).toBe("$allItems");
    expect(out.patch.predicate).toEqual({ operator: "AND", rules: [
      { left: "fields.tag.value", comparator: "CONTAINS", right: "bookAuthor" },
      { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
    ] });
  });

  it("LEAVES a correctly-keyed field alone — the control", () => {
    // 41 of 47 fields are already right; churning them is the risk here.
    expect(planOptionsSourceFix(fld({ mode: "find", over: "$allInstances",
      predicate: { operator: "AND", rules: [{ left: "a", comparator: "IS", right: "b" }] },
      valuePath: "id", labelPath: "label" }))).toBeNull();
  });

  it("leaves the NESTED {find:{...}} form alone — the resolver reads it", () => {
    expect(planOptionsSourceFix(fld({ mode: "find", find: { over: "$allItems" } }))).toBeNull();
  });

  it("SKIPS a condition shape it does not understand rather than guessing", () => {
    const out = planOptionsSourceFix(fld({ mode: "find", collection: "$allItems",
      conditions: [{ weird: true }] }));
    expect(out.skip).toMatch(/not understood/);
  });

  it("does not clobber an existing predicate while fixing `over`", () => {
    // Mood/Files/Parent Emotion have `collection` wrong but a WORKING predicate.
    const out = planOptionsSourceFix(fld({ mode: "find", collection: "$allInstances",
      predicate: { operator: "AND", rules: [{ left: "x", comparator: "IS", right: "y" }] } }));
    expect(out.patch.over).toBe("$allInstances");
    expect(out.patch.predicate).toBeUndefined();
  });
});

describe("0269 — label path", () => {
  it("declares the grid's own convention when a field declares neither", () => {
    expect(planLabelPathFix(fld({ mode: "find", over: "$allItems" }))).toEqual(CANON);
    expect(CANON).toEqual({ valuePath: "id", labelPath: "label" });
  });

  it("LEAVES a field that already declares a labelPath — a deliberate shape is a choice", () => {
    expect(planLabelPathFix(fld({ mode: "find", over: "$allItems", labelPath: "fields.x.value" }))).toBeNull();
  });

  it("leaves a field that declares only valuePath — one without the other is deliberate", () => {
    expect(planLabelPathFix(fld({ mode: "find", over: "$allItems", valuePath: "id" }))).toBeNull();
  });

  it("ignores manual and range sources", () => {
    expect(planLabelPathFix(fld({ mode: "manual", values: ["a"] }))).toBeNull();
  });
});
