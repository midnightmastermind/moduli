// The scroll diagnostic MISATTRIBUTED the capture it was written for.
//
// 2026-08-29, four arms off the tablet. Baseline flung the whole page and was
// 86% main-thread blocked — 16 long tasks, 4,481ms of a 5,240ms gesture, median
// frame 109ms, 14 of 23 frames missed. It reported **MOUNT**, because exactly
// ONE row entered the DOM while the progressive catalogue load was still
// growing the page underneath. One row is not why a five-second fling stuttered,
// and crowning it sends the next round after the mount path.
//
// The second defect is that the four arms were not the same gesture — 2,932 /
// 348 / 207 / 310 px/s — so the marquee/backdrop/shadow A/B they exist to run
// was void, and nothing in the overlay said so.
import { describe, it, expect } from "vitest";
import { verdictFor, mountFloor, scrollRate, comparability } from "../helpers/scrollDiag";

// A tablet row measured 273-287px against a ~1180px viewport → ~4 rows a screen.
const session = (over = {}) => ({
  rowsAdded: 0, unskipped: 0, frameMedian: 16, slowFrames: 0,
  longTasks: 0, longTaskMs: 0, durationMs: 5000,
  realPx: 280, clientHeight: 1180,
  startTop: 0, endTop: 0,
  ...over,
});

describe("mountFloor", () => {
  it("is DERIVED from the device's own geometry, not a picked constant", () => {
    // A screenful of rows, so it follows the screen instead of going stale on
    // the next one.
    expect(mountFloor(session({ realPx: 280, clientHeight: 1180 }))).toBe(4);
    expect(mountFloor(session({ realPx: 60, clientHeight: 1180 }))).toBe(20);
  });

  it("keeps a floor of 2 when the row height is unknown", () => {
    // `contain-intrinsic-size` came back empty in every field report (seed ?px),
    // so realPx can be 0 — the floor must not collapse to 0 and re-open the bug.
    expect(mountFloor(session({ realPx: 0 }))).toBe(2);
  });
});

describe("verdictFor — the misattribution that cost a device round", () => {
  it("does NOT crown MOUNT for the single row the baseline arm saw", () => {
    const v = verdictFor(session({
      rowsAdded: 1, frameMedian: 109, slowFrames: 14,
      longTasks: 16, longTaskMs: 4481, durationMs: 5240,
    }));
    expect(v.code).not.toBe("MOUNT");
    expect(v.code).toBe("MAIN-THREAD");
  });

  it("still REPORTS the sub-threshold mount rather than hiding it", () => {
    const v = verdictFor(session({
      rowsAdded: 1, frameMedian: 109, longTasks: 16, longTaskMs: 4481, durationMs: 5240,
    }));
    expect(v.text).toContain("1 row(s) also entered the DOM");
    // and it no longer claims the DOM was untouched, which was a flat lie
    // whenever a row HAD landed.
    expect(v.text).not.toContain("nothing added to the DOM");
  });

  it("says so when the long-task API is missing, rather than reporting a zero", () => {
    // HONEST GAP: `SUPPORTS_LONGTASK` is resolved at import from
    // `PerformanceObserver.supportedEntryTypes`, which jsdom does not implement
    // — so the arm that prints the long-task figure is UNREACHABLE in this
    // suite and is verified only on the device. What IS reachable is the
    // fallback, and that one matters: an absent signal reading as "zero long
    // tasks" is the 2026-08-04 Firefox trap this file exists to avoid.
    const v = verdictFor(session({ frameMedian: 109, longTasks: 16, longTaskMs: 4481, durationMs: 5240 }));
    expect(v.text).toContain("longtask API unavailable");
  });

  it("STILL crowns MOUNT when a screenful really does arrive late", () => {
    // The positive control. Without it, the fix degrades into "never report
    // MOUNT", which would blind the diagnostic to the case it was built for.
    const v = verdictFor(session({ rowsAdded: 6, frameMedian: 40 }));
    expect(v.code).toBe("MOUNT");
    expect(v.text).toContain("6 rows entered the DOM");
  });

  it("keeps SKIPPED ahead of the main-thread verdict", () => {
    // The un-skip work IS main-thread work, so a busy thread there is the
    // symptom rather than the cause — the existing precedence must survive.
    expect(verdictFor(session({ unskipped: 3, frameMedian: 109 })).code).toBe("SKIPPED");
  });
});

describe("scrollRate / comparability — the A/B was void and said nothing", () => {
  it("computes the rate each arm actually scrolled at", () => {
    expect(scrollRate(session({ startTop: 0, endTop: 15364.76, durationMs: 5240 }))).toBe(2932);
    expect(scrollRate(session({ startTop: 0, endTop: 1945.94, durationMs: 5597 }))).toBe(348);
  });

  it("marks the three tablet arms NOT comparable to baseline", () => {
    const base = 2932;
    for (const rate of [348, 207, 310]) {
      expect(comparability(rate, base)).toBe("not comparable");
    }
  });

  it("accepts arms scrolled at a similar rate", () => {
    // The control: the flag has to be able to say "comparable", or it is just
    // a warning label nailed to every row.
    expect(comparability(2932, 2600)).toBe("comparable");
    expect(comparability(300, 500)).toBe("comparable");
  });

  it("says UNKNOWN rather than guessing when an arm never moved", () => {
    // A 0px arm happened on 2026-08-29's first capture; dividing by it would
    // report Infinity, which reads as a finding.
    expect(comparability(0, 2932)).toBe("unknown");
    expect(comparability(300, 0)).toBe("unknown");
  });
});
