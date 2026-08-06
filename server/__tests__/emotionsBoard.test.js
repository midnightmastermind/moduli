// Migration 0044's PURE half — the rows it will mint.
//
// The risky part is the PARENT WIRING: the wheel's hierarchy is carried by a
// field pointing at another occurrence, so a mistake here produces a board that
// looks fine as a list and draws as a broken wheel.
import { describe, it, expect } from "vitest";
import { planEmotionRows } from "../migrations/0044-emotions-board.mjs";

// Deterministic ids so assertions can name relationships.
const seq = () => { let n = 0; return () => `occ-${String(++n).padStart(3, "0")}`; };

describe("planEmotionRows", () => {
  it("plans one row per node — 8 core + 40 secondary + 80 tertiary", () => {
    const rows = planEmotionRows(seq());
    expect(rows).toHaveLength(128);
    expect(rows.filter(r => r.level === "core")).toHaveLength(8);
    expect(rows.filter(r => r.level === "secondary")).toHaveLength(40);
    expect(rows.filter(r => r.level === "tertiary")).toHaveLength(80);
  });

  it("gives every row a UNIQUE occurrence id", () => {
    const rows = planEmotionRows(seq());
    expect(new Set(rows.map(r => r.occurrenceId)).size).toBe(128);
  });

  it("leaves CORE emotions parentless — they are the wheel's roots", () => {
    for (const r of planEmotionRows(seq()).filter(r => r.level === "core")) {
      expect(r.parentOccurrenceId).toBe(null);
    }
  });

  it("points every non-core row at a row that EXISTS in the same plan", () => {
    // A parent id naming nothing is the failure that renders as a wheel with
    // rings missing, so it is asserted rather than assumed.
    const rows = planEmotionRows(seq());
    const ids = new Set(rows.map(r => r.occurrenceId));
    for (const r of rows.filter(r => r.level !== "core")) {
      expect(r.parentOccurrenceId).toBeTruthy();
      expect(ids.has(r.parentOccurrenceId)).toBe(true);
    }
  });

  it("wires parents to the RIGHT level — secondary→core, tertiary→secondary", () => {
    const rows = planEmotionRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    for (const r of rows) {
      if (r.level === "secondary") expect(byId.get(r.parentOccurrenceId).level).toBe("core");
      if (r.level === "tertiary") expect(byId.get(r.parentOccurrenceId).level).toBe("secondary");
    }
  });

  it("reproduces a branch read off the chart: Sad > Ashamed > Embarrassed", () => {
    const rows = planEmotionRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    const embarrassed = rows.find(r => r.label === "Embarrassed");
    const ashamed = byId.get(embarrassed.parentOccurrenceId);
    const sad = byId.get(ashamed.parentOccurrenceId);
    expect(ashamed.label).toBe("Ashamed");
    expect(sad.label).toBe("Sad");
    expect(sad.parentOccurrenceId).toBe(null);
  });

  it("has no cycles — every row reaches a root in at most 2 hops", () => {
    const rows = planEmotionRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    for (const r of rows) {
      let cur = r, hops = 0;
      while (cur.parentOccurrenceId) {
        cur = byId.get(cur.parentOccurrenceId);
        expect(++hops).toBeLessThan(3);
      }
      expect(cur.level).toBe("core");
    }
  });
});
