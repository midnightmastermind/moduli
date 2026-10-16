// "Apply to all" matches same-named instances with the same field set (user, 2026-10-16).
import { describe, it, expect } from "vitest";
import { sameShapeTargets, layoutFieldIds } from "../helpers/instanceLayout";

const fieldsById = { c: {}, m: {}, s1: {}, w1: {}, t1: {}, d: {} };
const b = (...ids) => ids.map((fieldId) => ({ fieldId }));
const modulesById = {
  bank: { id: "bank", role: "instance", label: "Exercise", fieldBindings: [...b("c", "m", "s1", "w1"), { fieldId: "d", hidden: true }] },
  clone: { id: "clone", role: "instance", label: "Exercise", fieldBindings: b("w1", "s1", "m", "c") },
  timed: { id: "timed", role: "instance", label: "Exercise", fieldBindings: b("c", "m", "s1", "t1") },
  eat: { id: "eat", role: "instance", label: "Eat", fieldBindings: b("c", "m", "s1", "w1") },
  ctr: { id: "ctr", role: "container", label: "Exercise", fieldBindings: b("c", "m", "s1", "w1") },
};
const occurrencesById = {
  src: { id: "src", moduleId: "bank" },
  copy: { id: "copy", moduleId: "bank" },
  day: { id: "day", moduleId: "clone" },
  feed: { id: "feed", moduleId: "bank", meta: { feedSourceId: "src" } },
  time: { id: "time", moduleId: "timed" },
  eat: { id: "eat", moduleId: "eat" },
  ctr: { id: "ctr", moduleId: "ctr" },
  renamed: { id: "renamed", moduleId: "bank", label: "Leg day" },
};

describe("sameShapeTargets", () => {
  it("takes same-named instances whose visible fields are the same set, in any order, on any module", () => {
    expect(sameShapeTargets(occurrencesById.src, { occurrencesById, modulesById, fieldsById }).sort()).toEqual(["copy", "day"]);
  });
  it("hidden and media bindings are not part of the shape", () => {
    expect(layoutFieldIds({ fieldBindings: [{ fieldId: "c" }, { fieldId: "d", hidden: true }, { fieldId: "m", role: "media" }] }, fieldsById)).toEqual(["c"]);
  });
  it("a placement's own label names it", () => {
    expect(sameShapeTargets(occurrencesById.renamed, { occurrencesById, modulesById, fieldsById })).toEqual([]);
  });
});
