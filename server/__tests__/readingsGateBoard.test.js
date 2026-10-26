import { describe, it, expect } from "vitest";
import { withGateVars } from "../migrations/0440-readings-gate-board.mjs";

const gate = { operator: "OR", rules: [{ left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY" }, { left: "$trigger.sourceOccurrenceId", comparator: "IS", right: "$board.id" }] };
const build = [
  { id: "s", type: "action", config: { type: "INIT_VAR", name: "$schedPage", expr: "$allItemsById.x" } },
  { id: "b", type: "action", config: { type: "INIT_VAR", name: "$board", expr: "$allItemsById.page" } },
  { id: "g", type: "if", condition: gate, then: [] },
];
const caller = [{ id: "r", type: "action", config: { type: "INIT_VAR", name: "$readings", expr: "json:[]" } }, { id: "g2", type: "if", condition: gate, then: [] }];

describe("0440 readings gate", () => {
  it("adds the $board the gate reads, right after $readings, and only that", () => {
    const next = withGateVars(caller, build);
    expect(next.map((s) => s.config?.name || s.type)).toEqual(["$readings", "$board", "if"]);
    expect(next[1].config.expr).toBe("$allItemsById.page");
  });
  it("is a no-op once present", () => {
    expect(withGateVars(withGateVars(caller, build), build)).toBeNull();
  });
});
