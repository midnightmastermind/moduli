/**
 * PER-MOVE COST, BUCKETED BY WHAT THE FINGER IS OVER.
 *
 * User, 2026-09-02: "it only jitters when its passing over other instances ...
 * dragging over empty containers is faster." A drag-wide `onMove avg` cannot
 * answer that, and TWO hypotheses were falsified against it before this existed:
 *
 *   - instance re-renders: 0 across 12 crossings, with a live counter (461 ->
 *     461) as the control, so it is not the `edgeAsAttribute` gap
 *   - `elementsFromPoint`: 12.4ms over a row vs 12.5ms over empty space, stack
 *     depth 30 vs 28 — flat, so it is not the hit-test either
 *
 * What is pinned here is that the buckets SEPARATE, because a report where
 * every move lands in one bucket would look like a working instrument and
 * answer nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dragPerf } from "../helpers/dragPerf.js";

beforeEach(() => { window.__dragPerf = true; });
afterEach(() => { delete window.__dragPerf; });

// `end()` bails under 40ms as "a tap, not a drag", and the report waits a frame
// for the drop's paint — so the helper has to outlast both. The first version
// did neither and every arm read "", which is the empty-probe tell rather than
// a broken bucket.
const line = async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    await new Promise((r) => setTimeout(r, 60));    // clear the tap threshold
    dragPerf.end();
    await new Promise((r) => setTimeout(r, 60));    // let afterNextPaint fire
  } finally { console.log = orig; }
  return logs.find((l) => l.startsWith("[drag]")) || "";
};

describe("dragPerf move buckets", () => {
  it("separates the buckets, with a count and a mean for each", async () => {
    dragPerf.start({ label: "Row", mode: "move" });
    dragPerf.move(20, "instance");
    dragPerf.move(30, "instance");
    dragPerf.move(4, "container-empty");
    const l = await line();
    expect(l).toMatch(/moveBy=\[/);
    expect(l).toMatch(/instance:2x25\.0/);
    expect(l).toMatch(/container-empty:1x4\.0/);
  });

  it("keeps the drag-wide average too — the buckets ADD to the line", async () => {
    // Without this the change would be a rename, and the existing figure is
    // what every previous capture in the log is expressed in.
    dragPerf.start({ label: "Row", mode: "move" });
    dragPerf.move(10, "instance");
    dragPerf.move(30, "instance");
    expect(await line()).toMatch(/onMove avg=20/);
  });

  it("reports a max per bucket — jitter is the MAX, not the mean", async () => {
    dragPerf.start({ label: "Row", mode: "move" });
    dragPerf.move(5, "instance");
    dragPerf.move(90, "instance");
    expect(await line()).toMatch(/instance:2x47\.5\/max90ms/);
  });

  it("buckets an unclassified move rather than dropping it", async () => {
    // A move with no classification must still be counted, or the buckets and
    // the drag-wide count disagree and neither can be trusted.
    dragPerf.start({ label: "Row", mode: "move" });
    dragPerf.move(7);
    expect(await line()).toMatch(/unknown:1x7\.0/);
  });

  it("starts each drag with empty buckets", async () => {
    dragPerf.start({ label: "A", mode: "move" });
    dragPerf.move(50, "instance");
    await line();
    dragPerf.start({ label: "B", mode: "move" });
    dragPerf.move(5, "gap");
    const l = await line();
    expect(l).toMatch(/gap:1x5\.0/);
    expect(l).not.toMatch(/instance:/);
  });
});
