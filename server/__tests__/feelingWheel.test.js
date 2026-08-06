// The Willcox Feeling Wheel data — pinned against the SOURCE's own claims.
//
// This is derived data (extracted from the published PDF by reading order +
// label geometry), so the tests assert the properties the source states about
// itself. If a future edit breaks one of these, the data has drifted from the
// wheel it claims to be.
import { describe, it, expect } from "vitest";
import { FEELING_WHEEL, flattenFeelingWheel } from "../seed/feelingWheel.js";

describe("FEELING_WHEEL matches the published wheel's own description", () => {
  it("has the 6 core feelings the source names", () => {
    // "...bucketed into these 6 groups: sad, mad, scared, joyful, powerful, and peaceful"
    expect(Object.keys(FEELING_WHEEL).sort())
      .toEqual(["Joyful", "Mad", "Peaceful", "Powerful", "Sad", "Scared"]);
  });

  it("totals 72 feelings — 36 secondary + 36 tertiary", () => {
    const secs = Object.values(FEELING_WHEEL).flatMap(o => Object.keys(o));
    const ters = Object.values(FEELING_WHEEL).flatMap(o => Object.values(o).flat());
    expect(secs).toHaveLength(36);
    expect(ters).toHaveLength(36);
    expect(secs.length + ters.length).toBe(72);
  });

  it("gives every core exactly 6 secondary feelings", () => {
    for (const [core, secs] of Object.entries(FEELING_WHEEL)) {
      expect(Object.keys(secs), `${core} should have 6`).toHaveLength(6);
    }
  });

  it("gives every secondary exactly 1 tertiary (the wheel's 1:1 outer ring)", () => {
    for (const secs of Object.values(FEELING_WHEEL)) {
      for (const [sec, ters] of Object.entries(secs)) {
        expect(ters, `${sec} should have 1 tertiary`).toHaveLength(1);
      }
    }
  });

  it("ANCHOR — the source's own worked example: Sad > Guilty > Remorseful", () => {
    // The PDF states this pairing in prose, independently of the diagram, so it
    // is the one link that can be checked against something other than geometry.
    expect(FEELING_WHEEL.Sad.Guilty).toEqual(["Remorseful"]);
  });

  it("has no duplicate feeling anywhere — a wheel with a repeat is a bad extraction", () => {
    const all = flattenFeelingWheel().map(f => f.label);
    expect(new Set(all).size).toBe(all.length);
  });

  it("carries none of the source PDF's typos", () => {
    const all = flattenFeelingWheel().map(f => f.label.toUpperCase());
    for (const typo of ["PEACERFUL", "SELFFISH", "EXITED", "ENERGECTIC", "FACINATING", "DISCUORAGED", "SUCCESFUL"]) {
      expect(all).not.toContain(typo);
    }
  });
});

describe("flattenFeelingWheel", () => {
  it("emits every feeling once, with its ring depth and parent label", () => {
    const flat = flattenFeelingWheel();
    expect(flat).toHaveLength(78); // 6 + 36 + 36
    expect(flat.filter(f => f.depth === 0)).toHaveLength(6);
    expect(flat.filter(f => f.depth === 1)).toHaveLength(36);
    expect(flat.filter(f => f.depth === 2)).toHaveLength(36);
  });

  it("gives cores no parent and everything else a real one", () => {
    const flat = flattenFeelingWheel();
    const labels = new Set(flat.map(f => f.label));
    for (const f of flat) {
      if (f.depth === 0) expect(f.parent).toBe(null);
      else expect(labels.has(f.parent)).toBe(true);
    }
  });

  it("orders parents before children, so a seed can mint in one pass", () => {
    const seen = new Set();
    for (const f of flattenFeelingWheel()) {
      if (f.parent) expect(seen.has(f.parent)).toBe(true);
      seen.add(f.label);
    }
  });
});
