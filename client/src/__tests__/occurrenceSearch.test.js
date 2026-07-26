// __tests__/occurrenceSearch.test.js
import { describe, it, expect } from "vitest";
import { dateAliases, fieldValueText, buildSearchIndex } from "../helpers/occurrenceSearch";

describe("dateAliases", () => {
  it("expands an ISO day into every spelling a person might type", () => {
    const a = dateAliases("2026-07-25");
    expect(a).toContain("2026-07-25");
    expect(a).toContain("jul 25");
    expect(a).toContain("july 25");
    expect(a).toContain("july 25th");
    expect(a).toContain("saturday");
    expect(a).toContain("2026");
  });

  it("returns nothing for a non-date", () => {
    expect(dateAliases("not a date")).toEqual([]);
    expect(dateAliases(null)).toEqual([]);
  });
});

describe("fieldValueText", () => {
  const occs = { o1: { id: "o1", label: "Tortillas" }, o2: { id: "o2", label: "Cheese" } };

  it("appends the unit to a number", () => {
    expect(fieldValueText({ type: "number", unit: "g" }, 42, occs)).toBe("42 42g");
  });

  it("spells booleans", () => {
    expect(fieldValueText({ type: "boolean" }, true, occs)).toBe("yes");
    expect(fieldValueText({ type: "boolean" }, false, occs)).toBe("no");
  });

  it("resolves occurrence references to their labels, never ids", () => {
    const out = fieldValueText({ type: "occurrence" }, ["o1", "o2"], occs);
    expect(out).toBe("Tortillas Cheese");
    expect(out).not.toContain("o1");
  });

  it("expands a date value into aliases", () => {
    expect(fieldValueText({ type: "date" }, "2026-07-25", occs)).toContain("july 25");
  });
});

describe("buildSearchIndex", () => {
  const fieldsById = {
    f_water: { id: "f_water", name: "Water", type: "number", unit: "oz" },
    f_date: { id: "f_date", name: "Date", type: "date" },
  };
  const modulesById = {
    m_page: { id: "m_page", role: "page", kind: "board", label: "Routines" },
    m_cont: { id: "m_cont", role: "container", kind: "list", label: "Physical" },
    m_item: { id: "m_item", role: "instance", kind: "list", label: "Drink Water" },
    m_panel: { id: "m_panel", role: "panel", kind: "board", label: "Left Panel" },
    m_text: { id: "m_text", role: "textblock", kind: "doc", label: "" },
  };
  const occurrencesById = {
    panel1: { id: "panel1", gridId: "g1", moduleId: "m_panel", occurrences: ["page1"] },
    page1: { id: "page1", gridId: "g1", moduleId: "m_page", occurrences: ["cont1", "text1"] },
    cont1: {
      id: "cont1", gridId: "g1", moduleId: "m_cont", occurrences: ["item1"],
      filterOverride: { f_date: "2026-07-25" },
    },
    item1: {
      id: "item1", gridId: "g1", moduleId: "m_item",
      fields: { f_water: { value: 16, flow: "in" } },
    },
    text1: {
      id: "text1", gridId: "g1", moduleId: "m_text",
      textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hydration matters" }] }] },
    },
    other: { id: "other", gridId: "g2", moduleId: "m_item" },
  };
  const build = () => buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId: "g1" });

  it("excludes panels, other grids, and module-less occurrences", () => {
    const ids = build().entries.map(e => e.occId);
    expect(ids).toContain("item1");
    expect(ids).toContain("page1");
    expect(ids).not.toContain("panel1");
    expect(ids).not.toContain("other");
  });

  it("indexes the ancestor path root-first", () => {
    const e = build().byId.get("item1");
    expect(e.pathLabels).toEqual(["Routines", "Physical"]);
    expect(e.haystacks.path).toBe("routines physical");
  });

  it("resolves the nearest page ancestor", () => {
    expect(build().byId.get("item1").pageOccId).toBe("page1");
    expect(build().byId.get("page1").pageOccId).toBe("page1");
  });

  it("indexes field names and values together", () => {
    const e = build().byId.get("item1");
    expect(e.haystacks.fields).toContain("water");
    expect(e.haystacks.fields).toContain("16oz");
  });

  it("indexes a date from filterOverride as aliases", () => {
    expect(build().byId.get("cont1").haystacks.dates).toContain("july 25");
  });

  it("indexes textmap body text", () => {
    expect(build().byId.get("text1").haystacks.body).toBe("hydration matters");
  });

  it("falls back to the module label and prefers the occurrence override", () => {
    expect(build().byId.get("item1").label).toBe("Drink Water");
    const withOverride = buildSearchIndex({
      occurrencesById: { ...occurrencesById, item1: { ...occurrencesById.item1, label: "Sip Water" } },
      modulesById, fieldsById, gridId: "g1",
    });
    expect(withOverride.byId.get("item1").label).toBe("Sip Water");
  });
});
