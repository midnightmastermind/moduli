// __tests__/occurrenceSearch.test.js
import { describe, it, expect } from "vitest";
import { dateAliases, fieldValueText, buildSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";

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

// A HIT YOU CAN OPEN OUTRANKS ONE YOU CANNOT.
//
// `openOccurrenceInPanel` bails when an occurrence has no page in its ancestry:
// it says "That item isn't on a page yet" and goes nowhere. The depth tiebreak
// sorts the SHALLOWEST first, and an unreachable row has no ancestors at all —
// so those sorted to the TOP.
//
// Measured on poms grid 2026-09-22, searching "Chicken Breast":
//
//   1-5  Chicken Breast                          <- no path, none of them open
//   6    Chicken Breast · Ingredients › Ingredients   <- the only usable one
//
// which is what "why doesn't search find it" actually felt like.
describe("ranking: openable first", () => {
  const modulesById = {
    "m-page": { id: "m-page", role: "page", kind: "board", label: "Ingredients" },
    "m-row": { id: "m-row", role: "instance", label: "Chicken Breast" },
  };
  // One row sits under a page; two are parented by nobody — the live shape.
  const occurrencesById = {
    page1: { id: "page1", moduleId: "m-page", occurrences: ["onPage"] },
    onPage: { id: "onPage", moduleId: "m-row", occurrences: [] },
    orphanA: { id: "orphanA", moduleId: "m-row", occurrences: [] },
    orphanB: { id: "orphanB", moduleId: "m-row", occurrences: [] },
  };
  const index = buildSearchIndex({ occurrencesById, modulesById, fieldsById: {} });

  it("puts the row that is ON A PAGE above the rows that are not", () => {
    const { results } = searchOccurrences(index, "chicken");
    const ids = results.map((r) => r.entry.occId);
    expect(ids[0], `got ${ids.join(", ")}`).toBe("onPage");
  });

  it("still LISTS the unopenable rows — hiding them is the original complaint in a new form", () => {
    const { results } = searchOccurrences(index, "chicken");
    expect(results.map((r) => r.entry.occId).sort()).toEqual(["onPage", "orphanA", "orphanB"]);
  });

  it("marks them: the index says which hits have no page", () => {
    // What the row renders "not on a page" from, and the same question the
    // opener asks — so the list cannot disagree with what a click does.
    const { results } = searchOccurrences(index, "chicken");
    const byId = Object.fromEntries(results.map((r) => [r.entry.occId, r.entry]));
    expect(byId.onPage.pageOccId).toBe("page1");
    expect(byId.orphanA.pageOccId).toBeNull();
  });

  // CONTROL — the openability tiebreak must not outrank the MATCH QUALITY.
  // A better match that happens to be unreachable still beats a weak match on
  // a page, or the ranking would be answering the wrong question.
  it("score still wins: a label match outranks a body match even when unreachable", () => {
    const mods = { ...modulesById, "m-other": { id: "m-other", role: "instance", label: "Notes" } };
    const occs = {
      page1: { id: "page1", moduleId: "m-page", occurrences: ["weakOnPage"] },
      // on a page, but only its BODY mentions the term
      weakOnPage: { id: "weakOnPage", moduleId: "m-other", occurrences: [],
        textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "chicken" }] }] } },
      // unreachable, but the LABEL matches
      strongOrphan: { id: "strongOrphan", moduleId: "m-row", occurrences: [] },
    };
    const idx2 = buildSearchIndex({ occurrencesById: occs, modulesById: mods, fieldsById: {} });
    const { results } = searchOccurrences(idx2, "chicken");
    expect(results[0].entry.occId).toBe("strongOrphan");
  });
});
