import { describe, it, expect } from "vitest";
import { planReadings, withoutEmbeds } from "../migrations/0439-day-page-names-and-single-readings.mjs";

describe("0439 readings", () => {
  const kid = (id, title, at) => ({ id, title, createdAt: `2026-10-26T12:03:${at}Z` });
  it("keeps the shown copy of each book, else the earliest, and drops the rest", () => {
    const kids = [kid("a", "Stoic", "20"), kid("b", "Stoic", "21"), kid("c", "Stoic", "22"), kid("d", "Tao", "25"), kid("e", "Tao", "26")];
    const shown = new Set(["b"]);
    const { keep, drop } = planReadings(kids, { titleOf: (k) => k.title, shown: (k) => (shown.has(k.id) ? 1 : 0) });
    expect(keep.map((k) => k.id).sort()).toEqual(["b", "d"]);
    expect(drop.map((k) => k.id).sort()).toEqual(["a", "c", "e"]);
  });
  it("a section with one of each changes nothing", () => {
    const { drop } = planReadings([kid("a", "Stoic", "1"), kid("b", "Tao", "2")], { titleOf: (k) => k.title, shown: () => 1 });
    expect(drop).toEqual([]);
  });
  it("removes the deleted readings' embeds and keeps the rest", () => {
    const doc = { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "a" } }, { type: "paragraph" }, { type: "moduleEmbed", attrs: { occurrenceId: "b" } }] };
    expect(withoutEmbeds(doc, new Set(["a"])).content.map((n) => n.attrs?.occurrenceId || n.type)).toEqual(["paragraph", "b"]);
  });
});
