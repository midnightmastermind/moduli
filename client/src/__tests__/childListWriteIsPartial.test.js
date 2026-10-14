// A child-list write must carry ONLY the list. It used to resend the whole
// container record it was handed — and feedSync hands it a snapshot taken when
// the pass began. Switching a board's feed On (no conditions yet) started a pass
// that listed ~180 copies over several seconds; every one of those writes carried
// `feed: { conditions: [] }` and overwrote the conditions typed meanwhile, so the
// stored feed stayed "match everything" (2026-10-14, rebuild Beverages/Supplements).
import { describe, it, expect, vi, beforeEach } from "vitest";
const calls = [];
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (a) => calls.push(a),
  default: {},
}));
const LH = await import("../helpers/LayoutHelpers");
const stale = { id: "c1", moduleId: "m1", label: "Beverages", feed: { enabled: true, conditions: [] }, occurrences: ["a", "b"] };
describe("child-list writes send only id + occurrences", () => {
  beforeEach(() => { calls.length = 0; });
  it("addInstanceToContainer", () => {
    LH.addInstanceToContainer({ containerOccurrence: stale, occurrenceId: "x" });
    expect(calls[0].occurrence).toEqual({ id: "c1", occurrences: ["a", "b", "x"] });
    expect(calls[0].occurrencesBase).toEqual(["a", "b"]);
  });
  it("removeInstanceFromContainer", () => {
    LH.removeInstanceFromContainer({ containerOccurrence: stale, occurrenceId: "a" });
    expect(calls[0].occurrence).toEqual({ id: "c1", occurrences: ["b"] });
  });
  it("reorderInstancesInContainer", () => {
    LH.reorderInstancesInContainer({ containerOccurrence: stale, fromIndex: 0, toIndex: 1 });
    expect(calls[0].occurrence).toEqual({ id: "c1", occurrences: ["b", "a"] });
  });
});
