// The drag probe measured the MIDDLE of a drag and nothing else, and reported
// only to a console nobody on the affected device could read.
//
// User, 2026-09-01: "dragging an instance is taking forever to start up and
// then is just jittery around the grid … the drop takes a bit too" — three
// phases, of which one was instrumented. And on being told the middle was
// "covered": "i called out the entire performace of the drag so during too its
// terrible." Instrumented is not measured; the summary never reached anyone.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../socket.js", () => ({ socket: { emit: vi.fn(), connected: true } }));
const emitted = [];
vi.mock("../helpers/offlineQueue.js", () => ({
  safeEmit: (_s, ev, payload) => emitted.push({ ev, payload }),
}));

const { dragPerf } = await import("../helpers/dragPerf");

const flush = () => new Promise((r) => setTimeout(r, 40));

describe("dragPerf covers all three phases", () => {
  beforeEach(() => { emitted.length = 0; window.__dragPerf = true; });

  it("separates the deliberate hold delay from our own startup work", async () => {
    // The whole point of the split: 80ms of it is a hold we IMPOSE, and
    // reporting one total makes "forever to start" unattributable.
    dragPerf.touchStart();
    dragPerf.activate();
    dragPerf.start({ label: "Drink", mode: "move" });
    dragPerf.dropStart();
    dragPerf.dropDone();
    dragPerf.end();
    await flush();
    const line = emitted[0]?.payload?.line || "";
    expect(line).toMatch(/START touchRect=-?[\d.]+ms holdScrolls=-?\d+ hold=\d+ms work=\d+ms/);
    expect(line).toMatch(/DROP handler=\d+ms/);
    expect(line).toContain('"Drink"');
  });

  it("reports the touchstart forced-layout cost when dragSystem measures it", async () => {
    // The witness for "was the page already dirty when the finger landed".
    // Reading the grid rect FIRST at drag start changed nothing (1,036ms), so
    // the ~1s was owed before we wrote anything — this is the number that says
    // whether it was owed before the gesture existed at all.
    dragPerf.touchStart(842.5);
    dragPerf.activate();
    dragPerf.start({ label: "Cook", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted[0]?.payload?.line || "").toContain("touchRect=842.5ms");
  });

  it("reports -1 rather than 0 when nobody measured it", async () => {
    // A caller that passes nothing must not read as "one forced layout cost
    // zero milliseconds" — that is the absent-signal-as-measurement trap, and
    // it would retire the very hypothesis this field exists to test.
    dragPerf.touchStart();
    dragPerf.activate();
    dragPerf.start({ label: "Cook", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    const line = emitted[0]?.payload?.line || "";
    expect(line).toContain("touchRect=-1ms");
    expect(line).not.toContain("touchRect=0ms");
  });

  it("reports how many scrolls landed in the hold window", async () => {
    // The discriminator for the startup cost that survived: dirtied by the
    // panel scrolling under the finger, or dirtied by our own writes.
    dragPerf.touchStart(0.1);
    dragPerf.activate(7);
    dragPerf.start({ label: "Cook", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted[0]?.payload?.line || "").toContain("holdScrolls=7");
  });

  it("reports holdScrolls=-1, not 0, when nobody counted", async () => {
    // ZERO IS THE ANSWER THAT BLAMES US — it says the page scrolled not at all
    // and our own writes dirtied it. An uninstrumented caller must never be
    // able to produce that reading by accident.
    dragPerf.touchStart();
    dragPerf.activate();
    dragPerf.start({ label: "Cook", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    const line = emitted[0]?.payload?.line || "";
    expect(line).toContain("holdScrolls=-1");
    expect(line).not.toContain("holdScrolls=0");
  });

  it("attributes with forced flushes on the FIRST drag only", async () => {
    // The attribution converts one deferred style/layout pass into several, so
    // it makes the drag it measures SLOWER. That is acceptable once and not
    // twice — a permanent forced flush would be a regression shipped as a
    // diagnostic, which is the shape this file exists to avoid.
    //
    // The gate is module scope ("once per page LOAD"), and every test above
    // has already activated once — so a fresh module is the only honest way to
    // observe a first drag. Both halves are asserted: a run that emitted no
    // flush mark at all would satisfy the second for the wrong reason.
    vi.resetModules();
    const fresh = (await import("../helpers/dragPerf.js")).dragPerf;
    window.__dragPerf = true;
    emitted.length = 0;

    fresh.touchStart(0.1); fresh.activate(0);
    fresh.mark("t0");                       // as the real activation does
    fresh.flushMark("f:htmlStyle");
    fresh.start({ label: "one", mode: "copy" });
    fresh.dropStart(); fresh.dropDone(); fresh.end();
    await flush();

    fresh.touchStart(0.1); fresh.activate(0);
    fresh.mark("t0");
    // SPIN, so the suppressed segment would be NON-ZERO if it leaked. Without
    // this the second drag's delta is 0ms under jsdom and the zero-filter
    // hides a broken gate — A/B'd, and the test passed against a flushMark
    // with the gate deleted. The fixture has to isolate the case only this
    // guard covers, or it is testing the filter instead.
    { const t = performance.now(); while (performance.now() - t < 3) { /* spin */ } }
    fresh.flushMark("f:htmlStyle");         // suppressed: not the first drag
    fresh.mark("after");
    fresh.start({ label: "two", mode: "copy" });
    fresh.dropStart(); fresh.dropDone(); fresh.end();
    await flush();

    const first = emitted.find(e => e.payload.line.includes('"one"'))?.payload.line || "";
    const second = emitted.find(e => e.payload.line.includes('"two"'))?.payload.line || "";
    expect(first).toContain("f:htmlStyle");      // it really did attribute once
    expect(second).not.toContain("f:htmlStyle"); // and never again
  });

  it("reports to the SERVER, not just the console", async () => {
    // The device with the problem is the one whose console is hardest to read.
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "x", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].ev).toBe("save_scroll_diag");
    expect(emitted[0].payload.kind).toBe("drag");
  });

  it("still carries the DURING numbers it always collected", async () => {
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "y", mode: "move" });
    dragPerf.move(4); dragPerf.move(40);
    dragPerf.hit(9); dragPerf.frame(50);
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    const line = emitted[0].payload.line;
    expect(line).toMatch(/moves=2/);
    expect(line).toMatch(/onMove avg=22\/max=40ms/);
    expect(line).toMatch(/hit avg=9\/max=9ms/);
    expect(line).toMatch(/over16=1 over32=1/);
  });

  it("stays silent when switched off", async () => {
    // The control: this defaults ON for touch, so it must genuinely do nothing
    // when disabled rather than merely skip the console line.
    window.__dragPerf = false;
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "z" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted).toHaveLength(0);
  });
});

// THE REPORT READ ITS NUMBERS A FRAME LATE. It waits for the drop's paint, and
// everything was read from the live state INSIDE that callback — so a second
// gesture starting in between rewrote them. The first tablet capture showed two
// drags with byte-identical START figures and wildly different durations, which
// is not something two real drags can do.
describe("the summary is snapshotted, not read a frame later", () => {
  beforeEach(() => { emitted.length = 0; window.__dragPerf = true; });

  it("reports the numbers from ITS OWN drag, not the one that started after", async () => {
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "first", mode: "move" });
    dragPerf.move(5); dragPerf.move(5);
    dragPerf.dropStart(); dragPerf.dropDone();
    dragPerf.end();                       // report is now pending a frame
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "second", mode: "copy" });   // …and this lands first
    dragPerf.move(99);
    await flush();
    const first = emitted.find(e => e.payload.line.includes('"first"'));
    expect(first, "the pending report took the SECOND drag's label").toBeTruthy();
    expect(first.payload.line).toMatch(/moves=2/);
    expect(first.payload.line).not.toContain('"second"');
  });

  it("says whether the grid had settled when the drag began", async () => {
    // 5,790 renders and 23 op sweeps during a drag is within noise of what an
    // idle LOAD produces, so "the drag is slow" and "the load was still
    // draining" are not separable without this.
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "x", mode: "move" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted[0].payload.line).toMatch(/sinceLoad=\d+ms/);
  });
});

// "IT COULD HAVE TO DO WITH HIGHLIGHTING TOO … on drop points" — a reasonable
// reading of `hit avg=13.5ms max=119.9ms`, since one drop target is registered
// per container, per instance and per insert gap. But the registry lookup is a
// Map.get per ancestor while `elementsFromPoint` forces a hit-test over a
// 20,416-node document. Same total, opposite fixes.
describe("the hit-test is split into its two halves", () => {
  beforeEach(() => { emitted.length = 0; window.__dragPerf = true; });

  it("separates elementsFromPoint from the drop-registry walk", async () => {
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "x", mode: "move" });
    dragPerf.hit(20); dragPerf.hitParts(18, 2, 37, 412);
    dragPerf.hit(10); dragPerf.hitParts(8, 2, 21, 412);
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    const line = emitted[0].payload.line;
    expect(line).toMatch(/efp avg=13\/max=18/);
    expect(line).toMatch(/walk avg=2\/max=2/);
    // How many drop points exist at all, and the deepest stack under a finger.
    expect(line).toContain("els=37 targets=412");
  });
});

// "the start is pretty much as bad as the drop" — `work` is 916-1044ms on the
// user's tablet against 10-26ms on Firefox, and it is ONE number covering a
// React state update, the payload build, the drag pill and `handleDragStart`
// (which opens a session, spawns edge barriers and hit-tests for the cell).
describe("the startup block, split", () => {
  beforeEach(() => { emitted.length = 0; window.__dragPerf = true; });

  it("reports each step of the activation, not one total", async () => {
    dragPerf.touchStart();
    dragPerf.activate();
    dragPerf.mark("t0");
    dragPerf.mark("setIsDragging");
    dragPerf.mark("buildPayload");
    dragPerf.mark("pill");
    dragPerf.mark("handleDragStart");
    dragPerf.start({ label: "x", mode: "copy" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    const line = emitted[0].payload.line;
    // Names present means the split survived; the durations are whatever the
    // machine did.
    for (const n of ["setIsDragging", "buildPayload", "pill", "handleDragStart"]) {
      expect(line.includes(n) || line.includes("[")).toBe(true);
    }
    expect(line).toMatch(/START touchRect=-?[\d.]+ms holdScrolls=-?\d+ hold=\d+ms work=\d+ms/);
  });

  it("marks outside a drag are ignored rather than accumulating", async () => {
    // `mark` is called from the touch handler, which runs for taps that never
    // become drags. Left unguarded those would pile into the next real drag's
    // breakdown.
    dragPerf.mark("stray");
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.mark("t0"); dragPerf.mark("only");
    dragPerf.start({ label: "y" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(emitted[0].payload.line).not.toContain("stray");
  });
});


// The render causes came back EMPTY twice while the user had been asked to set
// `window.__RENDER_ATTR` by hand — most likely cleared by the reload that
// fetched the build the capture was for. A diagnostic that depends on a manual
// step surviving a page load is a diagnostic that does not run.
describe("attribution arms itself for the drag", () => {
  beforeEach(() => { emitted.length = 0; window.__dragPerf = true; delete window.__RENDER_ATTR; });

  it("turns attribution on for the duration of the gesture", () => {
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "x", mode: "move" });
    expect(window.__RENDER_ATTR, "attribution was not armed").toBe(true);
  });

  it("restores what the caller had, rather than forcing it off", async () => {
    // A developer who switched it on deliberately keeps it on; the default of
    // "unset" comes back as unset rather than false.
    window.__RENDER_ATTR = true;
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "y" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(window.__RENDER_ATTR).toBe(true);

    delete window.__RENDER_ATTR;
    dragPerf.touchStart(); dragPerf.activate();
    dragPerf.start({ label: "z" });
    dragPerf.dropStart(); dragPerf.dropDone(); dragPerf.end();
    await flush();
    expect(window.__RENDER_ATTR, "left the probe armed after the drag").toBeUndefined();
  });
});
