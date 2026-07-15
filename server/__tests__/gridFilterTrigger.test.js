import { describe, it, expect } from "vitest";
import { ensureGridFilterTrigger } from "../utils/gridFilterTrigger.js";

const nav = (label) => ({ eventType: "onFilterChange", subjectType: "filterNav", targetId: "", ancestorLabel: label, priority: 3 });
const grid = () => ({ eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 3 });

describe("ensureGridFilterTrigger", () => {
  it("adds a grid onFilterChange trigger to a filterNav-only op", () => {
    const op = { name: "Tracker: Water", triggerObjects: [nav("Goals"), { eventType: "onLoad", subjectType: "grid" }], triggerTypes: ["onFilterChange", "onLoad"] };
    const changed = ensureGridFilterTrigger([op]);
    expect(changed).toHaveLength(1);
    expect(op.triggerObjects.some(t => t.eventType === "onFilterChange" && t.subjectType === "grid")).toBe(true);
  });

  it("covers an Accounts-scoped op (Net Worth) too", () => {
    const op = { name: "Net Worth", triggerObjects: [nav("Accounts")], triggerTypes: ["onFilterChange"] };
    ensureGridFilterTrigger([op]);
    expect(op.triggerObjects.filter(t => t.subjectType === "grid" && t.eventType === "onFilterChange")).toHaveLength(1);
  });

  it("is idempotent — an op that already has the grid trigger is untouched", () => {
    const op = { name: "Schedule: Build Schedule", triggerObjects: [grid(), nav()], triggerTypes: ["onFilterChange"] };
    const before = JSON.stringify(op.triggerObjects);
    const changed = ensureGridFilterTrigger([op]);
    expect(changed).toHaveLength(0);
    expect(JSON.stringify(op.triggerObjects)).toBe(before);
  });

  it("leaves non-filter ops alone (no filterNav trigger → no grid trigger added)", () => {
    const op = { name: "Alarm: 5 PM", triggerObjects: [{ eventType: "onLoad", subjectType: "grid" }], triggerTypes: ["onLoad"] };
    const changed = ensureGridFilterTrigger([op]);
    expect(changed).toHaveLength(0);
    expect(op.triggerObjects.some(t => t.eventType === "onFilterChange")).toBe(false);
  });

  it("matches the filterNav priority when appending", () => {
    const op = { name: "X", triggerObjects: [{ eventType: "onFilterChange", subjectType: "filterNav", priority: 7 }] };
    ensureGridFilterTrigger([op]);
    expect(op.triggerObjects.find(t => t.subjectType === "grid").priority).toBe(7);
  });
});
