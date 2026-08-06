// The wrap/stack decision turns on ONE number: how tall the neighbor would be if
// wrapped. Measure it wrong in one of the two states and the group oscillates —
// which is exactly what happened on the Eminem page (2026-08-05).
import { describe, it, expect } from "vitest";
import { resolveNeighborHeight, decideWrapStack, WRAP_SHORT_NEIGHBOR_H } from "../docs/wrapAnchor";

// Real numbers off the page, Firefox, 2482px group, 320px float:
//   stacked  → the aside renders full width:   2482 × 1182
//   wrapped  → the aside floats at 320 wide:    320 ×  757
const STACKED = { measuredW: 2482, measuredH: 1182 };
const WRAPPED = { measuredW: 320, measuredH: 757 };
const WRAP_W = 320;

describe("resolveNeighborHeight", () => {
  it("while WRAPPED, the measurement IS the answer", () => {
    expect(resolveNeighborHeight({ stacked: false, ...WRAPPED, wrapWidth: WRAP_W })).toBe(757);
  });

  it("while STACKED, it reuses the height last measured wrapped — not a projection", () => {
    const h = resolveNeighborHeight({
      stacked: true, ...STACKED, wrapWidth: WRAP_W,
      remembered: { wrapWidth: WRAP_W, height: 757 },
    });
    expect(h).toBe(757);
  });

  it("the projection it replaces was out by 5x on this content", () => {
    // No memory yet → bootstrap projection. Recorded so the size of the error is
    // visible: a table gets TALLER as it narrows, so inverse-scaling is backwards.
    const projected = resolveNeighborHeight({ stacked: true, ...STACKED, wrapWidth: WRAP_W });
    expect(Math.round(projected)).toBe(152);
    expect(757 / projected).toBeGreaterThan(4);
  });

  it("THE OSCILLATION: the projection makes the two states disagree, the memory makes them agree", () => {
    const textArea = 272910; // measured, identical in both states (layout-invariant)
    const besideW = 2144;

    // BEFORE — each state feeds decideWrapStack a different neighbour height.
    const hStackedOld = resolveNeighborHeight({ stacked: true, ...STACKED, wrapWidth: WRAP_W });
    const hWrapped = resolveNeighborHeight({ stacked: false, ...WRAPPED, wrapWidth: WRAP_W });
    expect(hStackedOld).toBeLessThan(WRAP_SHORT_NEIGHBOR_H);  // "short neighbour" → exempt → wrap
    expect(hWrapped).toBeGreaterThan(WRAP_SHORT_NEIGHBOR_H);  // not short → sliver policy → stack
    const fromStacked = decideWrapStack({ textArea, besideW, neighborH: hStackedOld, prevStacked: true });
    const fromWrapped = decideWrapStack({ textArea, besideW, neighborH: hWrapped, prevStacked: false });
    expect(fromStacked).toBe(false); // stacked says: WRAP
    expect(fromWrapped).toBe(true);  // wrapped says: STACK  → the loop
    expect(fromStacked).not.toBe(fromWrapped);

    // AFTER — the remembered wrapped height is used in both states, so the
    // decision is a fixed point and the group settles.
    const hStackedNew = resolveNeighborHeight({
      stacked: true, ...STACKED, wrapWidth: WRAP_W,
      remembered: { wrapWidth: WRAP_W, height: 757 },
    });
    expect(decideWrapStack({ textArea, besideW, neighborH: hStackedNew, prevStacked: true }))
      .toBe(decideWrapStack({ textArea, besideW, neighborH: hWrapped, prevStacked: false }));
  });

  it("a memory taken at a DIFFERENT float width is discarded", () => {
    // Dragging the seam changes the float width, so the remembered height is a
    // fact about a layout that no longer exists.
    const h = resolveNeighborHeight({
      stacked: true, ...STACKED, wrapWidth: 260,
      remembered: { wrapWidth: WRAP_W, height: 757 },
    });
    expect(Math.round(h)).toBe(Math.round(1182 * (260 / 2482)));
  });

  it("degenerate measurements do not produce NaN", () => {
    expect(resolveNeighborHeight({ stacked: true, measuredW: 0, measuredH: 500, wrapWidth: 320 })).toBe(500);
  });
});
