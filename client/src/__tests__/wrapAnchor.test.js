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

describe("decideWrapStack — stack only when the beside band is blank or a sliver", () => {
  const tallNbr = 620; // Wikipedia-infobox-ish

  it("blank host always stacks", () => {
    expect(decideWrapStack({ textArea: 0, besideW: 400, neighborH: 143 })).toBe(true);
  });

  it("narrow prose column stacks (readable floor 160px — was 60)", () => {
    expect(decideWrapStack({ textArea: 27520, besideW: 159, neighborH: 143 })).toBe(true);
    expect(decideWrapStack({ textArea: 27520, besideW: 84, neighborH: 143 })).toBe(true); // old rule kept this wrapped
  });

  it("short neighbor (≤280px) wraps at ANY width with any text", () => {
    expect(decideWrapStack({ textArea: 27520, besideW: 900, neighborH: 143 })).toBe(false);
    expect(decideWrapStack({ textArea: 2000, besideW: 322, neighborH: 280 })).toBe(false);
  });

  it("LONG text beside a tall neighbor keeps wrapping at LARGE widths (the old 100% fill rule stacked here)", () => {
    // Eminem-style: textArea 200k → predicted 400px at besideW 500 = 65% of a 620px infobox.
    // Old rule: 400 < 620 → stacked. New rule: 65% ≥ 35% → WRAP.
    expect(decideWrapStack({ textArea: 200000, besideW: 500, neighborH: tallNbr })).toBe(false);
  });

  it("a SLIVER of text beside a tall neighbor stacks (the 2026-07-09 'half text / empty band')", () => {
    // Seeded-description-sized text: predicted 85px = 14% of the 620px infobox.
    expect(decideWrapStack({ textArea: 27520, besideW: 322, neighborH: tallNbr })).toBe(true);
  });

  it("under ~2 lines beside the neighbor stacks regardless of ratio", () => {
    // predicted 40px < WRAP_MIN_BESIDE_H even though 40 ≥ 35% of a 110px... (neighbor >280 required)
    expect(decideWrapStack({ textArea: 16000, besideW: 400, neighborH: 300 })).toBe(true);
  });

  it("hysteresis: entry (stacked→wrap) needs a higher fill than staying wrapped", () => {
    // predicted = 120k/500 = 240 → 38.7% of 620: keeps a wrap (≥35%) but does NOT enter one (<45%).
    const args = { textArea: 120000, besideW: 500, neighborH: tallNbr };
    expect(decideWrapStack({ ...args, prevStacked: false })).toBe(false); // stays wrapped
    expect(decideWrapStack({ ...args, prevStacked: true })).toBe(true);   // stays stacked
  });

  it("widening NEVER flips a wrapped long-text group to stacked before the sliver point", () => {
    // Sweep besideW upward with long text: once wrapped, it stays wrapped until the
    // beside prose genuinely thins to a sliver — monotone, no mid-band stack window.
    const textArea = 200000, neighborH = tallNbr;
    let stacked = false, everRewrapAfterStack = false;
    for (let besideW = WRAP_MIN_PROSE_W; besideW <= 1400; besideW += 50) {
      const next = decideWrapStack({ textArea, besideW, neighborH, prevStacked: stacked });
      if (stacked && !next) everRewrapAfterStack = true;
      stacked = next;
    }
    expect(everRewrapAfterStack).toBe(false); // once it thins to a sliver it stays stacked, no oscillation
  });
});
