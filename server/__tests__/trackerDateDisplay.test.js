// 0072 adds a write into an op that runs on every filter change, and binds a
// field onto 35 modules. Tests weigh the anchor and the refusals.
import { describe, it, expect } from "vitest";
import { addTrackerDateStep } from "../migrations/0072-tracker-date-display.mjs";

const FID = "f-trackerdate";
const act = (config) => ({ id: "s" + Math.random(), type: "action", config });
// The real shape: two loops, the second clearing $goal.label per tile.
const op = () => ({ pipeline: { steps: [
  { id: "l1", type: "loop", overExpr: "$allContainers", as: "$grp", body: [
    { id: "if1", type: "if", condition: { operator: "AND", rules: [] },
      then: [act({ type: "UPDATE", path: "$grp.label", value: "${$activeDatePossessive} x" })], else: [] },
  ]},
  { id: "l2", type: "loop", overExpr: "$allInstances", as: "$goal", body: [
    { id: "if2", type: "if", condition: { operator: "AND", rules: [] },
      then: [act({ type: "UPDATE", path: "$goal.label", value: null })], else: [] },
  ]},
]}});
const tileSteps = (o) => o.pipeline.steps[1].body[0].then;

describe("0072 addTrackerDateStep", () => {
  it("writes $activeDate into the field, inside the per-TILE loop", () => {
    const o = op();
    expect(addTrackerDateStep(o, FID).added).toBe(1);
    const added = tileSteps(o)[1];
    expect(added.config).toEqual({ type: "UPDATE", path: `$goal.fields.${FID}.value`, value: "$activeDate" });
  });

  // It must land after the label write — same scope, where $goal is bound and
  // the page guard above has already run.
  it("anchors after the $goal.label write, not at the top of the loop", () => {
    const o = op(); addTrackerDateStep(o, FID);
    expect(tileSteps(o)[0].config.path).toBe("$goal.label");
    expect(tileSteps(o)).toHaveLength(2);
  });

  it("does NOT touch the container loop", () => {
    const o = op(); addTrackerDateStep(o, FID);
    expect(o.pipeline.steps[0].body[0].then).toHaveLength(1);
  });

  it("is idempotent — a second run adds nothing", () => {
    const o = op(); addTrackerDateStep(o, FID);
    const before = JSON.stringify(o.pipeline);
    const r = addTrackerDateStep(o, FID);
    expect(r.added).toBe(0);
    expect(r.alreadyPresent).toBe(1);
    expect(JSON.stringify(o.pipeline)).toBe(before);
  });

  it("fails CLOSED when the anchor step is absent", () => {
    const bare = { pipeline: { steps: [act({ type: "INIT_VAR", name: "$x", expr: "1" })] } };
    const r = addTrackerDateStep(bare, FID);
    expect(r.added).toBe(0);
    expect(r.reason).toMatch(/anchor/i);
  });

  it("fails CLOSED on an op with no pipeline", () => {
    expect(addTrackerDateStep({}, FID).reason).toBeTruthy();
  });

  it("writes a DIFFERENT field id than the filter's date field — the whole safety argument", () => {
    // isOccurrenceVisible only evaluates the ids the active filter names, so a
    // value on any other field cannot make the tile date-filtered.
    const o = op(); addTrackerDateStep(o, FID);
    expect(JSON.stringify(o.pipeline)).toContain(`$goal.fields.${FID}.value`);
    expect(JSON.stringify(o.pipeline)).not.toContain("Eh7oi4HKdbHB");
  });
});
