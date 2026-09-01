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
    expect(line).toMatch(/START hold=\d+ms work=\d+ms/);
    expect(line).toMatch(/DROP handler=\d+ms/);
    expect(line).toContain('"Drink"');
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
