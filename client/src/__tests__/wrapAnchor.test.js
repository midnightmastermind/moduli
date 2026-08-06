import { describe, it, expect } from "vitest";
import { sideFromFrac, anchorOffsetForDrop, hasMidAnchor, classifyWrapShape } from "../docs/wrapAnchor.js";

describe("sideFromFrac", () => {
  it("left for the left ~half, right for the right ~half (no dead middle)", () => {
    expect(sideFromFrac(0.1)).toBe("left");
    expect(sideFromFrac(0.49)).toBe("left");
    expect(sideFromFrac(0.51)).toBe("right");
    expect(sideFromFrac(0.9)).toBe("right");
  });
});

describe("anchorOffsetForDrop", () => {
  it("returns the drop Y minus the host prose top, clamped to >= 0", () => {
    expect(anchorOffsetForDrop({ dropY: 250, hostProseTop: 100 })).toBe(150);
    expect(anchorOffsetForDrop({ dropY: 80, hostProseTop: 100 })).toBe(0);
  });
  it("snaps to a provided line top when lineTops are given (nearest at-or-above)", () => {
    expect(anchorOffsetForDrop({ dropY: 133, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(20);
    expect(anchorOffsetForDrop({ dropY: 158, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(40);
  });
});

describe("hasMidAnchor", () => {
  it("top anchor: no offset, no index", () => {
    expect(hasMidAnchor({ anchorIndex: 0, anchorOffset: null })).toBe(false);
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 0 })).toBe(false);
  });
  it("line-level offset wins (anchorIndex null — the post-2026-06-17 shape)", () => {
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 120 })).toBe(true);
  });
  it("anchorOffset 0 with a legacy anchorIndex set: offset is authoritative", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: 0 })).toBe(false);
  });
  it("legacy nodes: anchorIndex > 0, no offset", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: null })).toBe(true);
  });
});

describe("classifyWrapShape", () => {
  const geo = { neighborBottom: 400, hostBottom: 900 };
  it("top: anchored at the very top", () => {
    expect(classifyWrapShape({ anchorIndex: 0, anchorOffset: null, ...geo })).toBe("top");
  });
  it("middle: line-level offset with prose below the neighbor", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, ...geo })).toBe("middle");
  });
  it("bottom: mid-anchored neighbor reaching the host bottom (within threshold)", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, neighborBottom: 890, hostBottom: 900 })).toBe("bottom");
  });
});

// ── decideWrapStack (2026-07-11 sliver policy) ────────────────────────────────
import { decideWrapStack, WRAP_MIN_PROSE_W } from "../docs/wrapAnchor";

describe("decideWrapStack — WIDTH decides: a readable column wraps, a narrow one stacks", () => {
  // POLICY CHANGED 2026-08-06, user: "why would i want to stack at large sizes".
  // The old rule compared the predicted beside-prose height against a FRACTION of
  // the neighbour's height. `predicted = textArea / besideW` falls as the column
  // widens, so widening the panel made the same text look like a smaller sliver
  // and STACKED it — measured on the Eminem page: beside 584 → 0.40 wrapped,
  // beside 1184 → 0.30 stacked, beside 2000 → stacked. Backwards.
  const tallNbr = 620; // Wikipedia-infobox-ish

  it("blank host always stacks", () => {
    expect(decideWrapStack({ textArea: 0, besideW: 400, neighborH: 143 })).toBe(true);
  });

  it("narrow prose column stacks (readable floor 160px)", () => {
    expect(decideWrapStack({ textArea: 27520, besideW: 159, neighborH: 143 })).toBe(true);
    expect(decideWrapStack({ textArea: 27520, besideW: 84, neighborH: 143 })).toBe(true);
  });

  it("short neighbor wraps at any readable width", () => {
    expect(decideWrapStack({ textArea: 27520, besideW: 900, neighborH: 143 })).toBe(false);
    expect(decideWrapStack({ textArea: 2000, besideW: 322, neighborH: 280 })).toBe(false);
  });

  it("THE REGRESSION: a tall neighbour no longer stacks a readable column", () => {
    // The real numbers off the Eminem page. Every one of these stacked under the
    // sliver rule; all three are a wide, readable column with text in it.
    expect(decideWrapStack({ textArea: 272910, besideW: 1184, neighborH: 757 })).toBe(false);
    expect(decideWrapStack({ textArea: 272910, besideW: 2000, neighborH: 757 })).toBe(false);
    expect(decideWrapStack({ textArea: 27520, besideW: 322, neighborH: tallNbr })).toBe(false);
  });

  it("WIDER IS NEVER MORE STACKED — the property the old rule violated", () => {
    // Sweep the column from the readable floor outward. Once it wraps it must
    // never stack again, for any neighbour height. This is the invariant that
    // failed before: the same content flipped to stacked as the panel grew.
    for (const neighborH of [143, 300, 620, 757, 1156]) {
      let sawWrap = false;
      for (let besideW = WRAP_MIN_PROSE_W; besideW <= 2600; besideW += 40) {
        const stacked = decideWrapStack({ textArea: 272910, besideW, neighborH, prevStacked: !sawWrap });
        if (!stacked) sawWrap = true;
        else if (sawWrap) throw new Error(`stacked again at besideW=${besideW}, neighborH=${neighborH}`);
      }
      expect(sawWrap).toBe(true);
    }
  });

  it("under ~2 lines beside the neighbor still stacks — it reads broken either way", () => {
    // Tiny host, very wide column: 16000/2000 = 8px of prose beside the float.
    expect(decideWrapStack({ textArea: 16000, besideW: 2000, neighborH: 300 })).toBe(true);
  });

  it("hysteresis on the WIDTH so the boundary cannot flap", () => {
    const args = { textArea: 200000, neighborH: tallNbr };
    expect(decideWrapStack({ ...args, besideW: 170, prevStacked: false })).toBe(false); // holds a wrap
    expect(decideWrapStack({ ...args, besideW: 170, prevStacked: true })).toBe(true);   // but will not enter one
    expect(decideWrapStack({ ...args, besideW: 181, prevStacked: true })).toBe(false);  // clear of the margin → enters
  });
});
