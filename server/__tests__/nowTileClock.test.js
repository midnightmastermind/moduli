// Guards 0249. The tile already carries bindings other passes put there, so the
// question each test answers is "could this drop an existing binding, bind the
// wrong field, or double-bind on a re-run?"
import { describe, it, expect } from "vitest";
import { planNowClock, buildBindings, LIVE_FIELDS } from "../migrations/0249-now-tile-live-clock.mjs";

const tile = (bindings = []) => ({ id: "m-now", role: "instance", label: "Now", fieldBindings: bindings });
const clockField = (id, source) => ({ id, name: source === "currentTime" ? "Now" : "Time Left", meta: { liveSource: source } });
const plan = (fields, modules, occurrences = [{ id: "o1", moduleId: "m-now" }]) =>
  planNowClock({ fields, modules, occurrences });

describe("0249 — the Now tile's live clock", () => {
  it("plans BOTH fields on a grid that has none", () => {
    const p = plan([], [tile()]);
    expect(p.refusals).toEqual([]);
    expect(p.missingFields.map((f) => f.meta.liveSource)).toEqual(["currentTime", "endOfDayCountdown"]);
    expect(p.alreadyBound).toBe(0);
  });

  it("REUSES a live field that already exists rather than minting a duplicate", () => {
    const p = plan([clockField("f-now", "currentTime")], [tile()]);
    expect(p.missingFields.map((f) => f.meta.liveSource)).toEqual(["endOfDayCountdown"]);
    expect(p.existingBySource.get("currentTime").id).toBe("f-now");
  });

  it("is a no-op once both fields exist AND are bound", () => {
    const fs = [clockField("f-a", "currentTime"), clockField("f-b", "endOfDayCountdown")];
    const p = plan(fs, [tile([{ fieldId: "f-a" }, { fieldId: "f-b" }])]);
    expect(p.missingFields).toEqual([]);
    expect(p.alreadyBound).toBe(LIVE_FIELDS.length);
  });

  it("resolves by meta.liveSource, NOT by name — the tile, module and field are all called Now", () => {
    const decoy = { id: "f-decoy", name: "Now", meta: {} };   // same name, no liveSource
    const p = plan([decoy], [tile()]);
    expect(p.missingFields.length).toBe(2);                    // the decoy satisfies nothing
    expect(p.existingBySource.size).toBe(0);
  });

  it("REFUSES when two instance modules are labelled Now", () => {
    const p = plan([], [tile(), { id: "m2", role: "instance", label: "Now" }]);
    expect(p.refusals.join(" ")).toMatch(/ambiguous/);
  });

  it("REFUSES when there is no Now tile at all", () => {
    const p = plan([], [{ id: "x", role: "instance", label: "Streak" }]);
    expect(p.refusals.join(" ")).toMatch(/no instance module/);
  });

  it("KEEPS the bindings other passes added — Category and Tracker Date", () => {
    const t = tile([{ fieldId: "f-cat", role: "input", order: 0 }, { fieldId: "f-date", role: "display", order: 1 }]);
    const next = buildBindings(t, ["f-a", "f-b"]);
    expect(next.map((b) => b.fieldId)).toEqual(["f-a", "f-b", "f-cat", "f-date"]);
    expect(next.find((b) => b.fieldId === "f-cat").role).toBe("input");  // role preserved
    expect(next.map((b) => b.order)).toEqual([0, 1, 2, 3]);              // contiguous
  });

  it("puts the clock FIRST — binding order is render order and the clock is the point", () => {
    const next = buildBindings(tile([{ fieldId: "f-date" }]), ["f-a", "f-b"]);
    expect(next[0].fieldId).toBe("f-a");
    expect(next[1].fieldId).toBe("f-b");
  });

  it("does not DOUBLE-bind a clock field the tile already had", () => {
    const t = tile([{ fieldId: "f-a", role: "display", order: 0 }, { fieldId: "f-date" }]);
    const next = buildBindings(t, ["f-a", "f-b"]);
    expect(next.filter((b) => b.fieldId === "f-a")).toHaveLength(1);
    expect(next.map((b) => b.fieldId)).toEqual(["f-a", "f-b", "f-date"]);
  });

  it("mints display-only fields — a computed clock must not be typeable", () => {
    for (const f of LIVE_FIELDS) {
      expect(f.inputEnabled).toBe(false);
      expect(f.displayEnabled).toBe(true);
    }
  });
});
