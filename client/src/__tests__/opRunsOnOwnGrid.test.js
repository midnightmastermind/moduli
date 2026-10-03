// An operation runs only on its own grid. Writes — operations included — go to
// the USER room, so a tab on one grid holds every other grid's operations. On
// 2026-10-03 a tab on poms grid received the rebuild grid's Coffee-shop edit,
// matched the rebuild's "Cash Balance" (onChange Amount), ran it over poms'
// rows and wrote "0" into the rebuild's Cash tile half a second after the
// rebuild tab wrote the right 188.
import { describe, it, expect } from "vitest";
import { runMatchingOperations, opRunsOnGrid } from "../helpers/operationExecutor";

const op = (id, gridId) => ({
  id, name: id, gridId, enabled: true, triggerTypes: ["onChange"],
  triggerObjects: [{ eventType: "onChange", subjectType: "field", targetId: "fAmt", priority: 3 }],
  pipeline: { steps: [{ id: "s", type: "action", config: { type: "SHOW_VALUE", name: "who", expr: `literal:${id}` } }] },
});
const tx = { type: "MeasureOp", occurrenceId: "o1", fields: { fAmt: 12 } };
const ctx = (gridId) => ({ state: { gridId, grid: { _id: gridId }, modules: [], occurrences: [] }, fieldsById: {}, occurrencesById: {}, operationsById: {} });
const ran = (updates) => updates.filter((u) => u?._effect === "SHOW_VALUE").map((u) => u._sourceOpId);

describe("an operation runs only on its own grid", () => {
  it("a tab on grid A does not run grid B's operation", () => {
    const u = runMatchingOperations([op("mine", "A"), op("theirs", "B")], "MeasureOp", tx, ctx("A"));
    expect(ran(u)).toEqual(["mine"]);
  });
  it("CONTROL: the same two ops on grid B run B's", () => {
    const u = runMatchingOperations([op("mine", "A"), op("theirs", "B")], "MeasureOp", tx, ctx("B"));
    expect(ran(u)).toEqual(["theirs"]);
  });
  it("fails OPEN when either side carries no grid id", () => {
    expect(opRunsOnGrid({ id: "x" }, { gridId: "A" })).toBe(true);
    expect(opRunsOnGrid({ id: "x", gridId: "B" }, {})).toBe(true);
  });
  it("the scheduler asks the same question", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../state/useScheduler.js", import.meta.url), "utf8");
    expect(src).toMatch(/if \(!opRunsOnGrid\(op, state\)\) continue;/);
  });
});
