// Tests for the category registry that drives CategoryPathPicker.
import { describe, it, expect } from "vitest";
import { CATEGORIES, resolveCategoryItems } from "../ui/categoryRegistry";

describe("categoryRegistry", () => {
  it("declares the five top-level categories in order", () => {
    expect(CATEGORIES.map(c => c.id)).toEqual([
      "sources", "occurrences", "fields", "localVars", "builtins",
    ]);
  });

  it("each category has label, description, icon, color, resolveItems", () => {
    for (const c of CATEGORIES) {
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.icon).toBeTruthy();
      expect(c.color).toBeTruthy();
      expect(typeof c.resolveItems).toBe("function");
    }
  });

  it("resolves Sources items from ctx.sources with title + description", () => {
    const ctx = {
      sources: [{ id: "a", variableName: "schedDate", entityType: "trigger", triggerProp: "date" }],
      localVars: [], modulesById: {}, occurrencesById: {}, fields: [],
    };
    const items = resolveCategoryItems("sources", ctx);
    const it0 = items.find(i => i.value === "$schedDate");
    expect(it0).toBeTruthy();
    expect(it0.title).toBe("$schedDate");
    expect(typeof it0.description).toBe("string");
  });

  it("Occurrences resolves only from sources that bound an occurrence collection", () => {
    const ctxNone = { sources: [], localVars: [], modulesById: {}, occurrencesById: {}, fields: [] };
    expect(resolveCategoryItems("occurrences", ctxNone)).toEqual([]);

    const ctxBound = {
      sources: [
        { id: "x", variableName: "everyOcc", entityType: "allOccurrences" },
        { id: "y", variableName: "containers", entityType: "allContainers" },
      ],
      localVars: [], modulesById: {}, occurrencesById: {}, fields: [],
    };
    const items = resolveCategoryItems("occurrences", ctxBound);
    expect(items.find(i => i.value === "$everyOcc")).toBeTruthy();
    expect(items.find(i => i.value === "$containers")).toBeTruthy();
  });

  it("Fields lists every field with type as the description", () => {
    const ctx = {
      sources: [], localVars: [], modulesById: {}, occurrencesById: {},
      fields: [{ id: "f1", name: "Water", type: "number" }],
    };
    const items = resolveCategoryItems("fields", ctx);
    expect(items[0]).toMatchObject({ value: "field:f1", title: "Water", sub: "number" });
    expect(items[0].description).toBeTruthy();
  });

  it("Built-ins always returns the date/time/grid scalars", () => {
    const items = resolveCategoryItems("builtins", { sources: [], localVars: [], modulesById: {}, occurrencesById: {}, fields: [] });
    const values = items.map(i => i.value);
    expect(values).toContain("$today");
    expect(values).toContain("$now");
    expect(values).toContain("$activeDate");
    expect(values).toContain("$grid");
  });
});
