// __tests__/occurrenceSearch.query.test.js
import { describe, it, expect } from "vitest";
import { buildSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";

const fieldsById = {
  f_protein: { id: "f_protein", name: "Protein", type: "number", unit: "g" },
  f_date: { id: "f_date", name: "Date", type: "date" },
};
const modulesById = {
  m_page: { id: "m_page", role: "page", kind: "board", label: "Routines" },
  m_slot6: { id: "m_slot6", role: "container", kind: "list", label: "6:00am" },
  m_slot9: { id: "m_slot9", role: "container", kind: "list", label: "9:00am" },
  m_water: { id: "m_water", role: "instance", kind: "list", label: "Drink Water" },
  m_meal: { id: "m_meal", role: "instance", kind: "list", label: "Greek Salad" },
  m_text: { id: "m_text", role: "textblock", kind: "doc", label: "Intro" },
};
const occurrencesById = {
  page1: { id: "page1", gridId: "g1", moduleId: "m_page", occurrences: ["slot6", "slot9", "meal1", "text1"] },
  slot6: { id: "slot6", gridId: "g1", moduleId: "m_slot6", occurrences: ["water6"], filterOverride: { f_date: "2026-07-25" } },
  slot9: { id: "slot9", gridId: "g1", moduleId: "m_slot9", occurrences: ["water9"] },
  water6: { id: "water6", gridId: "g1", moduleId: "m_water" },
  water9: { id: "water9", gridId: "g1", moduleId: "m_water" },
  meal1: { id: "meal1", gridId: "g1", moduleId: "m_meal", fields: { f_protein: { value: 42 } } },
  text1: {
    id: "text1", gridId: "g1", moduleId: "m_text",
    textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "drink water often" }] }] },
  },
  outside: { id: "outside", gridId: "g1", moduleId: "m_water" },
};
const index = buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId: "g1" });
const ids = (q, opts) => searchOccurrences(index, q, opts).results.map(r => r.entry.occId);

describe("searchOccurrences", () => {
  it("returns nothing for an empty query", () => {
    expect(searchOccurrences(index, "   ").results).toEqual([]);
  });

  it("ranks a label match above a body-text match", () => {
    const out = ids("water");
    expect(out.indexOf("water6")).toBeLessThan(out.indexOf("text1"));
  });

  it("requires every term to match — location terms narrow the result", () => {
    expect(ids("water 9:00am")).toEqual(["water9"]);
  });

  it("matches an ancestor date alias from a descendant", () => {
    expect(ids("water july 25")).toEqual(["water6"]);
  });

  it("matches a field name and a field value", () => {
    expect(ids("protein")).toEqual(["meal1"]);
    expect(ids("42g")).toEqual(["meal1"]);
  });

  it("reports why a non-label match hit", () => {
    const [hit] = searchOccurrences(index, "protein").results;
    expect(hit.why.source).toBe("field");
    expect(hit.why.text.toLowerCase()).toContain("protein");
    const [labelHit] = searchOccurrences(index, "greek").results;
    expect(labelHit.why).toBeNull();
  });

  it("scopes to a subtree when scopeRootId is given", () => {
    expect(ids("water", { scopeRootId: "slot9" })).toEqual(["water9"]);
    expect(ids("water", { scopeRootId: "page1" })).not.toContain("outside");
  });

  it("is case-insensitive and reports the untruncated total", () => {
    const out = searchOccurrences(index, "DRINK WATER", { limit: 1 });
    expect(out.results).toHaveLength(1);
    expect(out.total).toBeGreaterThan(1);
  });
});
