// server/__tests__/shareRules.test.js
//
// One rule per type (D8); branching lives INSIDE a rule. Ordering therefore
// matters in exactly one place: the catch-all runs last.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ops = [];
vi.mock("../models/Operation.js", () => ({ default: {
  find: () => ({ lean: async () => ops }),
}}));
const runs = [];
let seenShare = null;
vi.mock("../services/serverExecutor.js", () => ({
  runOperationServerSide: async (op, o) => {
    runs.push(op.id);
    seenShare = o.vars.$share;
    if (op.__throws) return { ok: false, error: { code: "execution_error", message: "boom" }, effects: [], scope: {} };
    const scope = op.__haltsFlat ? { "$share.handled": true }
      : op.__haltsNested ? { $share: { ...o.vars.$share, handled: true } }
      : {};
    return { ok: true, effects: op.__creates ? [{ _effect: "CREATE", occurrenceId: "o1" }] : [], vars: {}, scope, unsupported: [] };
  },
}));

const { runShareRules, selectShareRules } = await import("../services/shareRules.js");

const rule = (id, shareType, priority, extra = {}) => ({
  id, name: id, enabled: true, priority,
  triggerObjects: [{ eventType: "onShare", shareType }],
  pipeline: { steps: [] }, ...extra,
});

beforeEach(() => { ops.length = 0; runs.length = 0; seenShare = null; });

describe("runShareRules", () => {
  it("runs the rule whose type matches", async () => {
    ops.push(rule("ics-rule", "ics", 1), rule("link-rule", "link", 1));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule"]);
  });

  it("runs the catch-all LAST even when its priority number is lower", async () => {
    ops.push(rule("catch", "*", 0), rule("ics-rule", "ics", 99));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule", "catch"]);
  });

  it("runs only the catch-all when no typed rule matches", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1));
    await runShareRules({ share: { type: "zip" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["catch"]);
  });

  it("a typed rule that halts (flat SET_VAR name) stops the catch-all", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1, { __haltsFlat: true }));
    const r = await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule"]);
    expect(r.halted).toBe(true);
  });

  it("a typed rule that halts (nested $share) stops the catch-all", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1, { __haltsNested: true }));
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule"]);
  });

  it("skips disabled rules and operations with no onShare trigger", async () => {
    ops.push({ ...rule("ics-rule", "ics", 1), enabled: false }, rule("catch", "*", 99),
      { id: "other", enabled: true, triggerObjects: [{ eventType: "onLoad" }] });
    await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["catch"]);
  });

  it("passes $share to the rule", async () => {
    ops.push(rule("ics-rule", "ics", 1));
    await runShareRules({ share: { type: "ics", events: [{ summary: "Dentist" }] }, userId: "u1", gridId: "g1" });
    expect(seenShare.events[0].summary).toBe("Dentist");
  });

  it("a rule that throws is REPORTED and the catch-all still runs (§12: the share is not lost)", async () => {
    ops.push(rule("catch", "*", 99), rule("ics-rule", "ics", 1, { __throws: true }));
    const r = await runShareRules({ share: { type: "ics" }, userId: "u1", gridId: "g1" });
    expect(runs).toEqual(["ics-rule", "catch"]);
    expect(r.ran[0].ok).toBe(false);
    expect(r.ran[0].error.message).toBe("boom");
  });

  it("reports what each rule created", async () => {
    ops.push(rule("link-rule", "link", 1, { __creates: true }));
    const r = await runShareRules({ share: { type: "link" }, userId: "u1", gridId: "g1" });
    expect(r.ran[0].created).toHaveLength(1);
  });
});

describe("selectShareRules", () => {
  it("orders typed rules by priority, then the catch-all", () => {
    const out = selectShareRules([rule("c", "*", 1), rule("b", "ics", 5), rule("a", "ics", 2)], "ics");
    expect(out.map(o => o.id)).toEqual(["a", "b", "c"]);
  });
});
