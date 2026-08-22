import { describe, it, expect } from "vitest";
import { mergeSignatureFor, reachableIds } from "../migrations/0185-routine-becomes-its-own-layer.mjs";

describe("0185 — the signature merge will compute", () => {
  it("uses a hand-signed signature when there is one", () => {
    expect(mergeSignatureFor({ id: "x", identitySignature: "cycle:Protein Shake" }))
      .toBe("cycle:Protein Shake");
  });

  it("falls back to auto:<sourceId> — the string an unsigned template row produces", () => {
    // This is the whole reason the migration stamps: today's routine rows are unsigned,
    // so the first Routine merge looks for exactly this and would otherwise clone.
    expect(mergeSignatureFor({ id: "0aDPGnue7NWA" })).toBe("auto:0aDPGnue7NWA");
  });

  it("returns null rather than a half-formed signature when there is no id", () => {
    expect(mergeSignatureFor({})).toBeNull();
    expect(mergeSignatureFor(null)).toBeNull();
  });
});

describe("0185 — reachability is measured from the GRID's roots", () => {
  const occs = [
    { id: "panel", occurrences: ["page"] },
    { id: "page", occurrences: ["col"] },
    { id: "col", occurrences: ["slot"] },
    { id: "slot", occurrences: ["liveRow"] },
    { id: "liveRow", occurrences: [] },
    // an orphan subtree: nothing lists deadCol, and it lists a row of its own
    { id: "deadCol", occurrences: ["deadSlot"] },
    { id: "deadSlot", occurrences: ["deadRow"] },
    { id: "deadRow", occurrences: [] },
  ];

  it("reaches everything under the grid's panels", () => {
    const r = reachableIds(occs, ["panel"]);
    expect([...r].sort()).toEqual(["col", "liveRow", "page", "panel", "slot"]);
  });

  it("does NOT reach an orphaned subtree — the case that made the first attempt vacuous", () => {
    // Seeding the walk with "every occurrence nothing lists" makes deadCol its own root,
    // so the whole dead subtree came back reachable and the scoping did nothing.
    const r = reachableIds(occs, ["panel"]);
    expect(r.has("deadRow")).toBe(false);
    expect(r.has("deadCol")).toBe(false);
  });

  it("survives a cycle rather than looping forever", () => {
    const cyc = [{ id: "a", occurrences: ["b"] }, { id: "b", occurrences: ["a"] }];
    expect([...reachableIds(cyc, ["a"])].sort()).toEqual(["a", "b"]);
  });

  it("returns nothing when handed no roots", () => {
    expect(reachableIds(occs, []).size).toBe(0);
  });
});
