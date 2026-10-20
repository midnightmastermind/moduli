import { describe, it, expect } from "vitest";
import { recordViewPage, applyViewOverlay } from "../helpers/bootViewOverlay";

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const snap = () => ({
  gridId: "g1",
  views: [{ id: "v1", activeOccurrenceId: "book" }, { id: "v2", activeOccurrenceId: "sched" }],
  occurrences: [{ id: "book" }, { id: "dayPage" }, { id: "sched" }],
});

describe("boot view overlay", () => {
  it("draws the page a panel switched to after the snapshot was saved", () => {
    const s = mem();
    recordViewPage("g1", "v1", "dayPage", s);
    const out = applyViewOverlay(snap(), s);
    expect(out.views[0].activeOccurrenceId).toBe("dayPage");
    expect(out.views[1].activeOccurrenceId).toBe("sched");
  });
  it("leaves the snapshot alone with no overlay", () => {
    const p = snap();
    expect(applyViewOverlay(p, mem())).toBe(p);
  });
  it("skips a page the snapshot does not hold", () => {
    const s = mem();
    recordViewPage("g1", "v1", "missing", s);
    expect(applyViewOverlay(snap(), s).views[0].activeOccurrenceId).toBe("book");
  });
  it("keeps grids apart", () => {
    const s = mem();
    recordViewPage("g2", "v1", "dayPage", s);
    expect(applyViewOverlay(snap(), s).views[0].activeOccurrenceId).toBe("book");
  });
});
