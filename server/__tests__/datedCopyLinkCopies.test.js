// __tests__/datedCopyLinkCopies.test.js — 0271
//
// `0145` clears a copy-link SOURCE that carries a value in a field the grid
// FILTERS on, so the next copy is not born hidden. It does not touch the copies
// that already inherited it — that was `0144`, written against ONE day's column.
// So the pair only ever repaired one day, and on 2026-08-28 the integrity rule
// caught the recurrence: the "Todo" container and all SIX of its copies carrying
// Date = 2026-08-18, i.e. hidden on every other day for ten days.
//
// The discriminator is the whole design: a copy is cleared only when its value
// EQUALS its source's. A value that DIFFERS was set deliberately, and clearing
// it would be data loss.
import { describe, it, expect } from "vitest";
import { planCopyLinkDateRepair, filterFieldIds } from "../migrations/0271-dated-copy-link-copies.mjs";

const DATE = "fDate", OTHER = "fOther";
const occ = (id, extra = {}) => ({ id, fields: {}, meta: {}, ...extra });
const dated = (id, v, extra = {}) => occ(id, { fields: { [DATE]: { value: v } }, ...extra });
const copyOf = (id, src, v) => ({ ...(v === undefined ? occ(id) : dated(id, v)), meta: { copyLinkSource: src } });

describe("planCopyLinkDateRepair", () => {
  it("clears the SOURCE and every copy that inherited its value", () => {
    const world = [dated("src", "2026-08-18"), copyOf("c1", "src", "2026-08-18"), copyOf("c2", "src", "2026-08-18")];
    const p = planCopyLinkDateRepair(world, new Set([DATE]));
    expect(p.sources.map(s => s.id)).toEqual(["src"]);
    expect(p.copies.map(c => c.id).sort()).toEqual(["c1", "c2"]);
    expect(p.kept).toEqual([]);
  });

  it("KEEPS a copy whose value DIFFERS — that was set deliberately", () => {
    // The guard that stops this being data loss: a task genuinely placed on a
    // day must survive a repair aimed at an inherited stamp.
    const world = [dated("src", "2026-08-18"), copyOf("c1", "src", "2026-08-18"), copyOf("c2", "src", "2026-08-25")];
    const p = planCopyLinkDateRepair(world, new Set([DATE]));
    expect(p.copies.map(c => c.id)).toEqual(["c1"]);
    expect(p.kept).toEqual([{ id: "c2", sourceId: "src", field: DATE, value: "2026-08-25" }]);
  });

  it("leaves a copy that carries NO value alone", () => {
    const world = [dated("src", "2026-08-18"), copyOf("c1", "src")];
    const p = planCopyLinkDateRepair(world, new Set([DATE]));
    expect(p.copies).toEqual([]);
    expect(p.kept).toEqual([]);
  });

  it("touches only the FILTER fields — an identity marker in another field survives", () => {
    // `Time Slot` on these containers is what Build Schedule / Alarm /
    // Pomodoro: Start all FIND by; nulling it breaks all three (2026-07-30).
    const src = { ...dated("src", "2026-08-18"), fields: { [DATE]: { value: "2026-08-18" }, [OTHER]: { value: "Todo" } } };
    const p = planCopyLinkDateRepair([src, copyOf("c1", "src", "2026-08-18")], new Set([DATE]));
    expect(p.sources[0].fields).toEqual([DATE]);
    expect(p.sources[0].fields).not.toContain(OTHER);
  });

  it("a source carrying NO filter value is not a target at all — the converged case", () => {
    const p = planCopyLinkDateRepair([occ("src"), copyOf("c1", "src")], new Set([DATE]));
    expect(p).toEqual({ sources: [], copies: [], kept: [] });
  });

  it("an occurrence nothing copies from is ignored even when dated", () => {
    // 571 occurrences on the live grid carry a Date legitimately. Only SOURCES
    // propagate it, so only sources are in scope.
    const p = planCopyLinkDateRepair([dated("lonely", "2026-08-18")], new Set([DATE]));
    expect(p.sources).toEqual([]);
  });

  it("a dangling source (copies pointing at nothing) is skipped, not crashed on", () => {
    const p = planCopyLinkDateRepair([copyOf("c1", "gone", "2026-08-18")], new Set([DATE]));
    expect(p.sources).toEqual([]);
    expect(p.copies).toEqual([]);
  });

  it("empty string counts as NO value, the same way an absent key does", () => {
    const world = [dated("src", ""), copyOf("c1", "src", "")];
    expect(planCopyLinkDateRepair(world, new Set([DATE])).sources).toEqual([]);
  });
});

describe("filterFieldIds reads the grid's own statement about itself", () => {
  it("takes activeFilterValues AND namedFilters conditions", () => {
    const ids = filterFieldIds({ activeFilterValues: { a: 1 }, namedFilters: [{ conditions: [{ fieldId: "b" }] }] });
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
  it("a grid that filters on nothing yields nothing — up() refuses on this", () => {
    expect([...filterFieldIds({})]).toEqual([]);
  });
});
