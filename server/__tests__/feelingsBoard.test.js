// Migration 0044's PURE half — the rows it will mint.
//
// The risky part is the PARENT WIRING: the wheel's hierarchy is carried by a
// field pointing at another occurrence, so a mistake here produces a board that
// looks fine as a list and draws as a broken wheel.
import { describe, it, expect } from "vitest";
import { planFeelingRows } from "../migrations/0044-feelings-board.mjs";

// Deterministic ids so the assertions can name relationships.
const seq = () => { let n = 0; return () => `occ-${String(++n).padStart(3, "0")}`; };

describe("planFeelingRows", () => {
  it("plans one row per feeling — 6 core + 36 secondary + 36 tertiary", () => {
    const rows = planFeelingRows(seq());
    expect(rows).toHaveLength(78);
    expect(rows.filter(r => r.level === "core")).toHaveLength(6);
    expect(rows.filter(r => r.level === "secondary")).toHaveLength(36);
    expect(rows.filter(r => r.level === "tertiary")).toHaveLength(36);
  });

  it("gives every row a UNIQUE occurrence id", () => {
    const rows = planFeelingRows(seq());
    expect(new Set(rows.map(r => r.occurrenceId)).size).toBe(78);
  });

  it("leaves CORE feelings parentless — they are the wheel's roots", () => {
    for (const r of planFeelingRows(seq()).filter(r => r.level === "core")) {
      expect(r.parentOccurrenceId).toBe(null);
    }
  });

  it("points every non-core row at a row that EXISTS in the same plan", () => {
    // A parent id that names nothing is the failure that renders as a wheel
    // with rings missing, so it is asserted rather than assumed.
    const rows = planFeelingRows(seq());
    const ids = new Set(rows.map(r => r.occurrenceId));
    for (const r of rows.filter(r => r.level !== "core")) {
      expect(r.parentOccurrenceId).toBeTruthy();
      expect(ids.has(r.parentOccurrenceId)).toBe(true);
    }
  });

  it("wires parents to the RIGHT level — secondary→core, tertiary→secondary", () => {
    const rows = planFeelingRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    for (const r of rows) {
      if (r.level === "secondary") expect(byId.get(r.parentOccurrenceId).level).toBe("core");
      if (r.level === "tertiary") expect(byId.get(r.parentOccurrenceId).level).toBe("secondary");
    }
  });

  it("reproduces the source's worked example: Sad > Guilty > Remorseful", () => {
    const rows = planFeelingRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    const remorseful = rows.find(r => r.label === "Remorseful");
    const guilty = byId.get(remorseful.parentOccurrenceId);
    const sad = byId.get(guilty.parentOccurrenceId);
    expect(guilty.label).toBe("Guilty");
    expect(sad.label).toBe("Sad");
    expect(sad.parentOccurrenceId).toBe(null);
  });

  it("has no cycles — every row reaches a root", () => {
    const rows = planFeelingRows(seq());
    const byId = new Map(rows.map(r => [r.occurrenceId, r]));
    for (const r of rows) {
      let cur = r, hops = 0;
      while (cur.parentOccurrenceId) {
        cur = byId.get(cur.parentOccurrenceId);
        expect(++hops).toBeLessThan(5);
      }
      expect(cur.level).toBe("core");
    }
  });
});
