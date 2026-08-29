// The local occurrence overlay's cached merge.
//
// `applyOperationEffect` rebuilt `{ ...state.occurrencesById, ...localOccsById }`
// once per effect in seven of its cases. On the load sweep both maps hold every
// occurrence on the grid, so that was ~42,000 property copies per effect and
// ~195 effects a load — 8.3 million copies, measured as a FLAT ~10ms per effect
// whatever the effect actually did. The two effect cases that build no overlay
// (UPDATE_ITEM_TEXTMAP, SCROLL_TO) were the only two that cost 0.0ms, which is
// what identified it.
import { describe, it, expect } from "vitest";
import { makeOccOverlay } from "../helpers/occOverlay";

const base = (n) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`o${i}`, { id: `o${i}`, v: i }]),
);

describe("makeOccOverlay — correctness first", () => {
  it("overlays local on top of base, local winning", () => {
    const ov = makeOccOverlay();
    const b = base(3);
    ov.set("o1", { id: "o1", v: 999 });
    ov.set("newbie", { id: "newbie" });
    const m = ov.merged(b);
    expect(m.o0.v).toBe(0);        // untouched base row
    expect(m.o1.v).toBe(999);      // local wins
    expect(m.newbie).toBeTruthy(); // local-only row is present
    expect(b.o1.v).toBe(1);        // and the BASE is not mutated
  });

  it("sees a write made between two reads — in-batch visibility", () => {
    // THE correctness property. The load sweep applies effects in sequence and
    // effect N+1 must see what effect N wrote; a cache that missed this would
    // silently feed operations stale occurrences.
    const ov = makeOccOverlay();
    const b = base(3);
    expect(ov.merged(b).o2.v).toBe(2);
    ov.set("o2", { id: "o2", v: 42 });
    expect(ov.merged(b).o2.v).toBe(42);
  });

  it("sees a DROP between two reads", () => {
    const ov = makeOccOverlay();
    const b = base(2);
    ov.set("o0", { id: "o0", v: 7 });
    expect(ov.merged(b).o0.v).toBe(7);
    ov.drop("o0");
    expect(ov.merged(b).o0.v).toBe(0);  // falls back to base
  });

  it("reset clears the overlay and invalidates", () => {
    const ov = makeOccOverlay();
    const b = base(2);
    ov.set("o1", { id: "o1", v: 5 });
    expect(ov.merged(b).o1.v).toBe(5);
    ov.reset();
    expect(ov.merged(b).o1.v).toBe(1);
  });
});

describe("makeOccOverlay — the caching that is the whole point", () => {
  it("returns the SAME object while nothing has changed", () => {
    const ov = makeOccOverlay();
    const b = base(5);
    expect(ov.merged(b)).toBe(ov.merged(b));
  });

  it("rebuilds when the local map changes", () => {
    const ov = makeOccOverlay();
    const b = base(5);
    const first = ov.merged(b);
    ov.set("o0", { id: "o0", v: 1 });
    expect(ov.merged(b)).not.toBe(first);
  });

  it("rebuilds when the BASE identity changes", () => {
    // The base half of the key. `_cachedBaseOccsById` is REPLACED whenever
    // state.occurrences changes, so identity is its version — but only if the
    // cache actually consults it. Without this the fire path would serve a
    // merge built over a superseded grid.
    const ov = makeOccOverlay();
    const b1 = base(3), b2 = base(3);
    const m1 = ov.merged(b1);
    const m2 = ov.merged(b2);
    expect(m2).not.toBe(m1);
    expect(ov.merged(b1)).toBe(m1);   // and b1's entry is still cached
  });

  it("does NOT invalidate on a drop of something it never held", () => {
    // Every server echo for an unheld occurrence calls drop(); bumping the
    // version there would defeat the cache on the busiest path there is.
    const ov = makeOccOverlay();
    const b = base(3);
    const first = ov.merged(b);
    ov.drop("not-here");
    expect(ov.merged(b)).toBe(first);
  });

  it("copies nothing at all when there is no base map", () => {
    // Every path except the load sweep: the reducer keeps `occurrences` as a
    // flat ARRAY and carries no `occurrencesById`, so the old code was
    // spreading the local map to produce a copy of itself.
    const ov = makeOccOverlay();
    ov.set("a", { id: "a" });
    expect(ov.merged(null)).toBe(ov.map);
    expect(ov.merged(undefined)).toBe(ov.map);
  });

  it("holds up under the real load-sweep shape: 21,207 rows, 195 effects", () => {
    // The regression this exists to prevent, at the size it actually happens.
    // Only the effects that WRITE may cost a rebuild; on a settled grid most
    // trackers recompute the value already stored and write nothing.
    const N = 21207, EFFECTS = 195;
    const ov = makeOccOverlay();
    const b = base(N);
    for (const k in b) ov.set(k, b[k]);      // runLoadSweep seeds every row

    let rebuilds = 0, last = null;
    for (let i = 0; i < EFFECTS; i++) {
      const m = ov.merged(b);
      if (m !== last) { rebuilds++; last = m; }
    }
    expect(rebuilds).toBe(1);                 // 195 reads, ONE merge

    // And a write in the middle costs exactly one more, not 195.
    ov.set("o5", { id: "o5", v: -1 });
    for (let i = 0; i < EFFECTS; i++) {
      const m = ov.merged(b);
      if (m !== last) { rebuilds++; last = m; }
    }
    expect(rebuilds).toBe(2);
    expect(ov.merged(b).o5.v).toBe(-1);       // still correct after caching
  });
});
