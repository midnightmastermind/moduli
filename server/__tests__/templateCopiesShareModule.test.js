// 0425 — a template's copy modules fold back into the template's own module.
import { describe, it, expect } from "vitest";
import { planFolds, repointTextmap, comparable } from "../migrations/0425-template-copies-share-module.mjs";

const src = { id: "S", role: "instance", label: "Sleep", defaultDragMode: "copy", fieldBindings: [{ fieldId: "tags" }], meta: { templateModule: true } };
const copy = (extra = {}) => ({ id: "C", role: "instance", label: "Sleep", defaultDragMode: "move", fieldBindings: [], meta: { clonedFromModuleId: "S", templateModule: false }, ...extra });

describe("planFolds", () => {
  it("folds a copy that differs only in what can be carried, and says what to carry", () => {
    const { folds, kept } = planFolds([src, copy({ fieldBindings: [{ fieldId: "date" }] })]);
    expect(kept).toEqual([]);
    expect(folds).toEqual([{ copyId: "C", sourceId: "S", rename: null, dragMode: "move", ownStyle: null, addBindings: [{ fieldId: "date" }] }]);
  });
  it("a renamed copy carries its name onto the placement", () => {
    const { folds } = planFolds([src, copy({ label: "Tuesday" })]);
    expect(folds[0].rename).toBe("Tuesday");
  });
  it("a copy's own style is carried; an inherited one is not", () => {
    expect(planFolds([src, copy({ styleMode: "own", ownStyle: { bg: "red" } })]).folds[0].ownStyle).toEqual({ bg: "red" });
    expect(planFolds([src, copy({ styleMode: "inherit", ownStyle: { bg: "red" } })]).folds[0].ownStyle).toBeNull();
  });
  it("keeps a copy whose other settings differ, and one whose source is gone", () => {
    const { folds, kept } = planFolds([src, copy({ meta: { clonedFromModuleId: "S", layoutCascade: { mode: "wrap" } } }), { id: "D", meta: { clonedFromModuleId: "gone" } }]);
    expect(folds).toEqual([]);
    expect(kept.map((k) => k.why)).toEqual(["differs: meta", "source module gone"]);
  });
  it("ignores modules that are not copies", () => {
    expect(planFolds([src, { id: "X", role: "instance" }])).toEqual({ folds: [], kept: [] });
  });
  it("comparable ignores identity, names and the copy stamps", () => {
    expect(comparable(copy({ label: "Other" }))).toBe(comparable(src));
  });
});

describe("repointTextmap", () => {
  it("re-points instanceId embeds and reports no change otherwise", () => {
    const tm = { type: "doc", content: [{ type: "moduleEmbed", attrs: { instanceId: "C", occurrenceId: "o1" } }] };
    expect(repointTextmap(tm, new Map([["C", "S"]])).content[0].attrs.instanceId).toBe("S");
    expect(tm.content[0].attrs.instanceId).toBe("C"); // input untouched
    expect(repointTextmap(tm, new Map([["Z", "S"]]))).toBeNull();
  });
});
