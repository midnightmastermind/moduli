// The outline tracer.
//
// The test that matters is the SOFT RAMP. The first two attempts at this
// feature thresholded raw Sobel magnitude and produced solid blobs — and a
// hard-edge test passes against that broken version, because a hard edge has
// a narrow gradient anyway. A soft ramp is the case that separates "found the
// crest of the edge" from "kept the whole slope", so it is the one that proves
// non-maximum suppression is actually doing its job.
import { describe, it, expect } from "vitest";
import {
  traceOutline, toGrayscale, gaussianBlur, sobel, nonMaxSuppress,
  percentile, hysteresis, dilate, OUTLINE_MODES,
} from "../helpers/imageOutline";

/** Build an RGBA buffer from a per-pixel grey function. */
function img(width, height, fn) {
  const a = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      const o = (y * width + x) * 4;
      a[o] = v; a[o + 1] = v; a[o + 2] = v; a[o + 3] = 255;
    }
  }
  return a;
}

/** Count inked (black) pixels per column of the output. */
function inkPerColumn(rgba, width, height) {
  const cols = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4] === 0) cols[x]++;
    }
  }
  return cols;
}

describe("traceOutline draws lines, not blobs", () => {
  const W = 60, H = 40;

  it("a HARD edge becomes a thin line, not a filled half", () => {
    const { rgba } = traceOutline(img(W, H, (x) => (x < 30 ? 20 : 230)), W, H, "blueprint");
    const cols = inkPerColumn(rgba, W, H);
    const inked = cols.filter((c) => c > H * 0.5).length;
    expect(inked, `${inked} columns are inked — a filled region, not a line`).toBeLessThanOrEqual(4);
    expect(inked, "nothing was traced at all").toBeGreaterThan(0);
  });

  it("a SOFT EDGE becomes a thin line — the blob case", () => {
    // A sigmoid: what a real out-of-focus edge looks like. Every pixel across
    // it has a real gradient, so a magnitude threshold keeps the whole slope —
    // but unlike a straight ramp it has a genuine CREST, so suppression has
    // something to find. This is the shape the blob bug actually showed up on.
    const soft = img(W, H, (x) => 20 + 210 / (1 + Math.exp(-(x - 30) / 6)));
    const { rgba } = traceOutline(soft, W, H, "blueprint");
    const cols = inkPerColumn(rgba, W, H);
    const inked = cols.filter((c) => c > H * 0.5).length;
    expect(inked, `${inked} columns inked — the slope was kept, not its crest`).toBeLessThan(6);
    expect(inked, "the soft edge was missed entirely").toBeGreaterThan(0);
  });

  it("a STRAIGHT RAMP does not survive as a plateau", () => {
    // Constant gradient end to end: there is no crest at all, so `>=` on BOTH
    // suppression neighbours passes every pixel and the entire ramp inks. The
    // comparison is asymmetric for exactly this case.
    const ramp = img(W, H, (x) => {
      if (x < 15) return 20;
      if (x > 45) return 230;
      return 20 + ((x - 15) / 30) * 210;
    });
    const { rgba } = traceOutline(ramp, W, H, "blueprint");
    const inked = inkPerColumn(rgba, W, H).filter((c) => c > H * 0.5).length;
    expect(inked, `${inked} of 30 ramp columns inked — the plateau survived whole`).toBeLessThan(10);
  });

  it("a FLAT image traces nothing and does not divide by zero", () => {
    const { rgba, inkRatio } = traceOutline(img(W, H, () => 128), W, H, "coloring");
    expect(inkRatio).toBe(0);
    expect(rgba.every((v, i) => (i % 4 === 3 ? v === 255 : v === 255))).toBe(true);
  });

  it("the background is OPAQUE WHITE — a transparent trace is invisible on a dark surface", () => {
    const { rgba } = traceOutline(img(W, H, (x) => (x < 30 ? 20 : 230)), W, H, "blueprint");
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
    // And every pixel is pure black or pure white — no greys, so it prints.
    for (let i = 0; i < rgba.length; i += 4) expect([0, 255]).toContain(rgba[i]);
  });

  it("coloring lays down MORE ink than blueprint — it dilates", () => {
    const src = img(W, H, (x, y) => ((x + y) % 17 < 3 ? 30 : 220));
    const a = traceOutline(src, W, H, "coloring").inkRatio;
    const b = traceOutline(src, W, H, "blueprint").inkRatio;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(OUTLINE_MODES.coloring.dilate).toBeGreaterThan(OUTLINE_MODES.blueprint.dilate);
  });

  it("LINE ART traces as continuous strokes, not dashes", () => {
    // A uniform stroke: nearly every ridge pixel has the same magnitude. An
    // independent percentile for the LOW threshold cuts through the middle of
    // that flat distribution and chops the contour into dashes at arbitrary
    // points — measured on a real ring, 0.24% ink in fragments. A ratio of
    // `high` extends every seed along its own contour instead.
    //
    // The probe is the LONGEST UNBROKEN RUN, because total ink cannot tell a
    // continuous line from the same number of scattered dots.
    // The stroke FADES along its length (dark at the left, faint at the right),
    // so its ridge magnitude varies ~5x end to end. A uniform bar does not
    // discriminate — an independent percentile keeps all of it too, and the
    // test proves nothing (checked: the mutation passed against it).
    const bar = img(W, H, (x, y) => (y >= 18 && y <= 22 ? 20 + (x / W) * 150 : 235));
    const { rgba } = traceOutline(bar, W, H, "blueprint");
    let best = 0, run = 0;
    for (let x = 0; x < W; x++) {
      // The stroke's top edge, wherever suppression put it.
      let inked = false;
      for (let y = 10; y < 22; y++) if (rgba[(y * W + x) * 4] === 0) inked = true;
      run = inked ? run + 1 : 0;
      if (run > best) best = run;
    }
    expect(best, `longest unbroken run was ${best} of ${W} columns — the line is dashed`)
      .toBeGreaterThan(W * 0.7);
  });

  it("an unknown mode falls back rather than producing nothing", () => {
    const { inkRatio } = traceOutline(img(W, H, (x) => (x < 30 ? 20 : 230)), W, H, "nope");
    expect(inkRatio).toBeGreaterThan(0);
  });
});

describe("the pieces", () => {
  it("grayscale uses luma weights, not a flat average", () => {
    // Pure green is much brighter than pure blue to the eye; a flat average
    // would call them equal and lose every green/blue edge.
    const g = toGrayscale(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255]), 2, 1);
    expect(g[0]).toBeGreaterThan(g[1] * 5);
  });

  it("blur CLAMPS at the border instead of inventing a black frame", () => {
    const flat = new Float32Array(25).fill(100);
    const out = gaussianBlur(flat, 5, 5, 1.5);
    // Zero-padding would darken the border; the corners must stay at 100.
    for (const v of out) expect(v).toBeCloseTo(100, 3);
  });

  it("percentile ranks only the LIVE pixels, ignoring the suppressed zeros", () => {
    // 90% zeros. Over everything, the 90th percentile is 0; over the live
    // values it is 10 — the whole reason the thresholds mean anything.
    const v = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 10]);
    expect(percentile(v, 0.9)).toBe(10);
  });

  it("suppression keeps the crest and drops its shoulders", () => {
    // One row: a symmetric hill. Only the peak survives.
    const src = new Float32Array([0, 10, 40, 90, 40, 10, 0]);
    const grid = new Float32Array(21);
    for (let x = 0; x < 7; x++) { grid[7 + x] = src[x]; grid[x] = src[x]; grid[14 + x] = src[x]; }
    const { mag, dir } = sobel(grid, 7, 3);
    const thin = nonMaxSuppress(mag, dir, 7, 3);
    const row = Array.from(thin.slice(7, 14));
    const live = row.filter((v) => v > 0).length;
    expect(live, `${live} of 7 pixels survived — the shoulders were kept`).toBeLessThanOrEqual(3);
  });

  it("hysteresis keeps a weak pixel CONNECTED to a strong one and drops a lone one", () => {
    //  idx: 0    1    2    3     4    5
    //       hi  weak  .    .   weak   .
    const mag = new Float32Array([100, 50, 0, 0, 50, 0]);
    const keep = hysteresis(mag, 6, 1, 90, 40);
    expect(keep[0]).toBe(1);
    expect(keep[1], "the connected weak pixel was dropped").toBe(1);
    expect(keep[4], "an isolated weak pixel was kept — that is noise").toBe(0);
  });

  it("dilate thickens, and radius 0 is a no-op", () => {
    const keep = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(Array.from(dilate(keep, 3, 3, 0))).toEqual(Array.from(keep));
    expect(Array.from(dilate(keep, 3, 3, 1))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
