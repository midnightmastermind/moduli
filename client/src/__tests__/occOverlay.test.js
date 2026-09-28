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
    // INVERTED 2026-09-27: this asserted the drop "falls back to base" — the
    // defect. A drop is a delete; the base is React state not yet re-rendered,
    // and falling back to it re-counted the deleted row in every onDelete
    // tracker recount. See the tombstone block below.
    expect(ov.merged(b).o0).toBeUndefined();
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
    //
    // INVERTED 2026-09-28, REASONING KEPT. This asserted that a write costs
    // exactly ONE more rebuild ("not 195"). It now costs ZERO, because on the
    // load sweep the local map COVERS the base — `runLoadSweep` fills its own
    // `occurrencesById` and calls `setLocalOcc` for the same rows in the same
    // pass — so the merge is the local map and there is nothing to copy. The
    // old expectation was the measured defect: a poms-grid load spent 2,442ms
    // of self time here, ~57 rebuilds of a 25,525-key object.
    const N = 21207, EFFECTS = 195;
    const ov = makeOccOverlay();
    const b = base(N);
    for (const k in b) ov.set(k, b[k]);      // runLoadSweep seeds every row

    let rebuilds = 0, last = null;
    for (let i = 0; i < EFFECTS; i++) {
      const m = ov.merged(b);
      if (m !== last) { rebuilds++; last = m; }
    }
    expect(rebuilds).toBe(1);                 // 195 reads, ONE answer

    // A write in the middle costs NOTHING — it lands in the map that IS the
    // answer. The value assertion is what says this is a real pass and not an
    // identity that went stale.
    ov.set("o5", { id: "o5", v: -1 });
    for (let i = 0; i < EFFECTS; i++) {
      const m = ov.merged(b);
      if (m !== last) { rebuilds++; last = m; }
    }
    expect(rebuilds).toBe(1);
    expect(ov.merged(b).o5.v).toBe(-1);       // still correct after caching
  });
});

// THE LOCAL MAP COVERING THE BASE IS THE LOAD SWEEP'S OWN SHAPE, not a lucky
// case — and once it covers, it cannot stop covering: `set` only adds a key,
// and `drop` removes one while recording a tombstone whose whole job is to
// hide the base copy too. Only `reset()` retracts the verdict.
describe("makeOccOverlay — the local map already covers the base", () => {
  const seeded = (n) => {
    const ov = makeOccOverlay();
    const b = base(n);
    for (const k in b) ov.set(k, b[k]);
    return { ov, b };
  };

  it("hands back the live local map instead of copying the base", () => {
    const { ov, b } = seeded(5);
    expect(ov.merged(b)).toBe(ov.map);
  });

  it("a later write is visible with no rebuild at all", () => {
    const { ov, b } = seeded(5);
    const first = ov.merged(b);
    ov.set("o2", { id: "o2", v: 42 });
    expect(ov.merged(b)).toBe(first);
    expect(ov.merged(b).o2.v).toBe(42);
  });

  it("a DROP still hides the row, even though the base still holds it", () => {
    // The case that decides whether returning the live map is sound: the base
    // is the load payload and still carries the deleted row.
    const { ov, b } = seeded(5);
    ov.merged(b);
    ov.drop("o3");
    expect(b.o3).toBeTruthy();                // base untouched
    expect(ov.merged(b).o3).toBeUndefined();  // and the merge does not show it
  });

  it("reset() retracts the verdict — an emptied map covers nothing", () => {
    const { ov, b } = seeded(4);
    expect(ov.merged(b)).toBe(ov.map);
    ov.reset();
    ov.set("o0", { id: "o0", v: 7 });
    const m = ov.merged(b);
    expect(m).not.toBe(ov.map);               // back to a real merge
    expect(m.o0.v).toBe(7);                   // local still wins
    expect(m.o3.v).toBe(3);                   // and the base rows are back
  });

  it("control: a base the map does NOT cover is still merged properly", () => {
    // Every path except the load sweep. Without this, \"returns the live map\"
    // is equally satisfied by an overlay that has simply stopped merging.
    const ov = makeOccOverlay();
    const b = base(5);
    ov.set("o1", { id: "o1", v: 999 });
    const m = ov.merged(b);
    expect(m).not.toBe(ov.map);
    expect(m.o1.v).toBe(999);                 // local wins
    expect(m.o4.v).toBe(4);                   // base row survives
  });
});

// A DELETE MUST HIDE THE BASE COPY. `stateRef.current` is assigned on RENDER
// (App.jsx), and CommitHelpers.deleteOccurrence fires OccurrenceDeleteOp in the
// same tick as its dispatch — so at fire time the base still holds the row.
// `drop` used to remove only the overlay entry, the merge fell back to the base
// copy, and every tracker's onDelete recount still counted the deleted row
// (measured on prod 2026-09-27: Daily Coffee 24 -> 24 after deleting a 4oz
// coffee; the next load's onLoad put it right, which is why it hid).
describe("makeOccOverlay — a dropped id is a tombstone", () => {
  it("hides the base copy of a dropped row", () => {
    const ov = makeOccOverlay();
    const b = base(3);
    ov.set("o1", { id: "o1", v: 1 });
    ov.drop("o1");
    expect(ov.merged(b).o1).toBeUndefined();
    expect(ov.merged(b).o0).toBeTruthy(); // control: siblings untouched
    expect(b.o1).toBeTruthy();            // and the base is not mutated
  });
  it("hides a base-only row dropped without ever being overlaid", () => {
    const ov = makeOccOverlay();
    const b = base(2);
    ov.drop("o1");
    expect(ov.merged(b).o1).toBeUndefined();
  });
  it("a later set (undo restore, re-create) brings it back", () => {
    const ov = makeOccOverlay();
    const b = base(2);
    ov.drop("o1");
    ov.set("o1", { id: "o1", v: 7 });
    expect(ov.merged(b).o1.v).toBe(7);
  });
  it("reset clears tombstones", () => {
    const ov = makeOccOverlay();
    const b = base(2);
    ov.drop("o1");
    ov.reset();
    expect(ov.merged(b).o1).toBeTruthy();
  });
  it("a tombstone the base has caught up with is pruned, so a later base row is not hidden", () => {
    const ov = makeOccOverlay();
    ov.drop("o1");
    const after = { o0: { id: "o0" } };          // the re-render removed it
    expect(ov.merged(after).o1).toBeUndefined();
    const restored = { o0: { id: "o0" }, o1: { id: "o1", v: 3 } }; // came back without a set
    expect(ov.merged(restored).o1.v).toBe(3);
  });
});
