// The off-screen skip's placeholder height. `contain-intrinsic-size` shipped as
// a constant and has been wrong in BOTH directions — 60px over-estimated on a
// Samsung A15 (index.css's own comment records lowering it to 44 because "the
// scroller shrank as they rendered and dragged content under the finger"), and
// 44px UNDER-estimates by 2-2.5x on the user's phone, where the on-device
// diagnostic reads `seed=44 real=81 / 109 / 110`. The error is multiplied by
// the row count, which is what makes a long list slide as it renders.
import { describe, it, expect } from "vitest";
import { rowSeedFrom, applyRowSeed, ROW_SEED_FALLBACK, ROW_SEED_MIN, ROW_SEED_MAX } from "../helpers/rowSeed";

describe("rowSeedFrom", () => {
  it("takes the MEDIAN, so one odd row cannot set the estimate", () => {
    // A tracker tile and a bare task row are legitimately 44 and 110 in the
    // same board, so the first row is a coin flip.
    expect(rowSeedFrom([44, 110, 81])).toBe(81);
  });

  it("is not dragged by the tallest row the way a mean would be", () => {
    // mean = 96; median = 56. A mean re-creates the 60px over-estimate that
    // dragged content under the finger.
    expect(rowSeedFrom([56, 56, 56, 56, 256])).toBe(56);
  });

  it("reports the device's real height, not the shipped guess", () => {
    // The measured case: the phone's rows against the 44px constant.
    expect(rowSeedFrom([81, 109, 110])).toBe(109);
    expect(rowSeedFrom([81, 109, 110])).not.toBe(ROW_SEED_FALLBACK);
  });

  it("falls back rather than returning NaN when nothing is measurable", () => {
    // jsdom, a display:none list, a backgrounded tab — every height is 0. A
    // NaN here becomes `contain-intrinsic-size: auto NaNpx`, which the engine
    // drops, silently restoring the un-seeded behaviour.
    expect(rowSeedFrom([])).toBe(ROW_SEED_FALLBACK);
    expect(rowSeedFrom([0, 0])).toBe(ROW_SEED_FALLBACK);
    expect(rowSeedFrom(undefined)).toBe(ROW_SEED_FALLBACK);
    expect(rowSeedFrom([NaN, null])).toBe(ROW_SEED_FALLBACK);
  });

  it("clamps, so one absurd measurement cannot break the list's geometry", () => {
    expect(rowSeedFrom([2])).toBe(ROW_SEED_MIN);
    expect(rowSeedFrom([99999])).toBe(ROW_SEED_MAX);
  });
});

describe("applyRowSeed", () => {
  const listWith = (heights) => ({
    isConnected: true,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    querySelectorAll: () => heights.map(h => ({ getBoundingClientRect: () => ({ height: h }) })),
  });

  it("publishes the measured seed as --cv-seed", () => {
    const el = listWith([81, 109, 110]);
    expect(applyRowSeed(el)).toBe(109);
    expect(el.style.props["--cv-seed"]).toBe("109px");
  });

  it("does nothing for a detached or empty list", () => {
    // The control: a torn-down tree must not be written to, and a list with no
    // rows has nothing to measure — both are no-ops, not fallback writes.
    expect(applyRowSeed(null)).toBe(null);
    expect(applyRowSeed({ ...listWith([44]), isConnected: false })).toBe(null);
    expect(applyRowSeed(listWith([]))).toBe(null);
  });

  it("samples ACROSS the list, not the first N — the regression its own log caught", () => {
    // Shipped sampling the first 8. On the first live capture the diagnostic
    // reported `seed=32px real=110px`: 32 was the median of the short rows at
    // the top of the list, 110 the median of the whole thing — WORSE than the
    // 44px constant it replaced. A stride estimates the median it is after.
    const heights = [...Array(80).fill(32), ...Array(80).fill(110)];
    const el = { isConnected: true, style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
      querySelectorAll: () => heights.map(h => ({ getBoundingClientRect: () => ({ height: h }) })) };
    const seed = applyRowSeed(el);
    expect(seed, "sampled only the short rows at the top").toBeGreaterThan(32);
  });

  it("samples a bounded number of rows, not all 993 of them", () => {
    let asked = 0;
    const el = { isConnected: true, style: { setProperty() {} },
      querySelectorAll: () => Array.from({ length: 993 }, () => ({
        getBoundingClientRect: () => { asked++; return { height: 60 }; } })) };
    applyRowSeed(el);
    expect(asked).toBeLessThanOrEqual(8);
  });
});

// ── The op tally counts SWEEPS, and had no idea what set them off ──────────
// A 14-second scroll on the user's phone reported `runs: 2, ms: 2563`: two
// full `runMatchingOperations` passes costing 2.5 seconds between them, with
// nothing to say whether that was the documented post-paint load tail, a write
// echo, a navigation, or a scheduler tick landing mid-gesture. Those have
// different fixes.
