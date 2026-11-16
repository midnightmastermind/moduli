import { describe, it, expect } from "vitest";
import { bindingConnected } from "../state/editorBindings.js";

// 2026-11-16: the day's Daily Question is the only one for its day; "linked" must not need a second copy.
describe("bindingConnected", () => {
  const binding = { selfField: "dq", link: "date" };
  const fieldsById = { dq: { id: "dq" }, date: { id: "date" } };
  it("connected when the host has a value for the link field — no sibling needed", () => {
    expect(bindingConnected({ binding, fieldsById, hostOccurrence: { fields: { date: { value: "2026-11-16" } } } })).toBe(true);
  });
  it("broken when the link value is missing, or a field is gone", () => {
    expect(bindingConnected({ binding, fieldsById, hostOccurrence: { fields: {} } })).toBe(false);
    expect(bindingConnected({ binding, fieldsById, hostOccurrence: { fields: { date: { value: "" } } } })).toBe(false);
    expect(bindingConnected({ binding, fieldsById: { date: {} }, hostOccurrence: { fields: { date: { value: "x" } } } })).toBe(false);
    expect(bindingConnected({ binding: { selfField: "dq" }, fieldsById, hostOccurrence: { fields: { date: { value: "x" } } } })).toBe(false);
  });
});
