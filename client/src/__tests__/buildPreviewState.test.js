// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildPreviewState } from "../ui/AssistantDrawer.jsx";

describe("buildPreviewState", () => {
  it("is the planned records, isolated, rooted at roots that exist", () => {
    const p = { modules: [{ id: "m" }], occurrences: [{ id: "a" }, { id: "b" }], fields: [{ id: "f" }], roots: ["a", "gone"] };
    const t = buildPreviewState(p);
    expect(t.roots).toEqual(["a"]);
    expect(t.state).toMatchObject({ occurrences: p.occurrences, modules: p.modules, fields: p.fields, views: [], folders: [] });
    expect(t.state.computedValues).toBeUndefined();
  });
  it("nothing to draw → null", () => {
    expect(buildPreviewState(null)).toBe(null);
    expect(buildPreviewState({ modules: [{ id: "m" }], occurrences: [{ id: "a" }], roots: ["x"] })).toBe(null);
  });
});
