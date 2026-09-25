/**
 * pastValues.test.js — the radial History lists a block's OTHER copies and what
 * they said, keyed by data rather than a hardcoded Date field. The fixture is
 * the live day-page shape (2026-09-25): a Daily Question doc container, a child
 * holding the question in a field, and the answer as an EMBEDDED textblock
 * (reachable only through the child's textmap).
 */
import { describe, it, expect } from "vitest";
import { buildPastValues, blockLineage, periodFieldIds } from "../helpers/pastValues";

const DAY = "fDay", QUESTION = "fQ", ANSWER = "fA", MOOD = "fMood";
const fieldsById = {
  [DAY]: { id: DAY, name: "Day", type: "date" },
  [QUESTION]: { id: QUESTION, name: "Question", type: "text" },
  [ANSWER]: { id: ANSWER, name: "Answer", type: "text" },
  [MOOD]: { id: MOOD, name: "Mood", type: "text" },
};
const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

function dayCopy(day, qMod, question, answer, extra = {}) {
  return [
    { id: `col-${day}`, moduleId: "colMod", fields: { [DAY]: { value: day } }, occurrences: [`q-${day}`] },
    { id: `q-${day}`, moduleId: qMod, fields: {}, occurrences: [`inner-${day}`], textmap: doc(""), ...extra },
    { id: `inner-${day}`, moduleId: "innerMod", fields: { [QUESTION]: { value: question } },
      textmap: { type: "doc", content: [{ type: "instanceTextblock", attrs: { occurrenceId: `a-${day}` } }] } },
    { id: `a-${day}`, moduleId: "ansMod", fields: { [ANSWER]: { value: doc(answer) } } },
  ];
}

const modulesById = {
  qRoot: { id: "qRoot", label: "Daily Question", meta: {} },
  qNew: { id: "qNew", label: "Daily Question", meta: { clonedFromModuleId: "qRoot" } },
  qOther: { id: "qOther", label: "Daily Question", meta: {} },   // same NAME, not lineage
  colMod: { id: "colMod" }, innerMod: { id: "innerMod" }, ansMod: { id: "ansMod", label: "Daily Answer" },
};
const occs = [
  ...dayCopy("2026-09-25", "qNew", "What is in my control?", "test"),
  ...dayCopy("2026-09-24", "qNew", "What am I grateful for?", "coffee"),
  ...dayCopy("2026-07-28", "qRoot", "First question", "first answer"),
  ...dayCopy("2026-08-10", "qOther", "Unrelated", "nope"),
];
const occurrencesById = Object.fromEntries(occs.map(o => [o.id, o]));
// The grid filters on DAY and its active value is TODAY — a past copy must not
// be stamped with it.
const grid = { activeFilterValues: { [DAY]: "2026-09-25" } };
const ctx = { occurrencesById, modulesById, fieldsById, grid };

describe("buildPastValues", () => {
  const { periodFields, entries } = buildPastValues(occurrencesById["q-2026-09-25"], ctx);

  it("the period field comes from the grid's filter, not a hardcoded name", () => {
    expect(periodFields).toEqual([DAY]);
  });

  it("lists the other copies across clone lineage, newest period first, never itself", () => {
    expect(entries.map(e => e.occurrence.id)).toEqual(["q-2026-09-24", "q-2026-07-28"]);
  });

  it("a module that merely shares the label is not the same block", () => {
    expect(entries.some(e => e.occurrence.moduleId === "qOther")).toBe(false);
  });

  it("each copy is dated by ITS value (read from its ancestor), not the filter's today", () => {
    expect(entries[0].period).toMatch(/Sep 24, 2026/);
    expect(entries[0].sortKey).toBe("2026-09-24");
    expect(entries[1].sortKey).toBe("2026-07-28");
  });

  it("shows the question and that day's EMBEDDED answer", () => {
    const text = entries[0].lines.flatMap(l => [l.text, ...l.values.map(v => v.text)]).join(" | ");
    expect(text).toContain("What am I grateful for?");
    expect(text).toContain("coffee");
    expect(text).not.toContain("test");
  });

  it("a block's own join field wins over the grid filter", () => {
    const mod = { id: "m", meta: { bodyLink: { selfField: ANSWER, link: MOOD } } };
    expect(periodFieldIds({ id: "x", moduleId: "m" }, { module: mod, grid, occurrencesById })).toEqual([MOOD]);
  });

  it("with no period field anywhere, copies order by creation time", () => {
    const o = {
      a: { id: "a", moduleId: "solo", createdAt: "2026-01-01" },
      b: { id: "b", moduleId: "solo", createdAt: "2026-03-01" },
      c: { id: "c", moduleId: "solo", createdAt: "2026-02-01" },
    };
    const r = buildPastValues(o.a, { occurrencesById: o, modulesById: { solo: { id: "solo" } }, fieldsById, grid: {} });
    expect(r.periodFields).toEqual([]);
    expect(r.entries.map(e => e.occurrence.id)).toEqual(["b", "c"]);
  });
});

describe("blockLineage", () => {
  it("walks up to the root and down to every clone", () => {
    expect([...blockLineage("qNew", modulesById)].sort()).toEqual(["qNew", "qRoot"]);
    expect([...blockLineage("qRoot", modulesById)].sort()).toEqual(["qNew", "qRoot"]);
  });
});
