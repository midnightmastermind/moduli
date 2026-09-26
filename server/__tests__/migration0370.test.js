import { describe, it, expect } from "vitest";
import { withPeopleBinding } from "../migrations/0370-appointments-have-people.mjs";
describe("0370 withPeopleBinding", () => {
  it("adds People after the existing bindings", () => {
    expect(withPeopleBinding([{ fieldId: "a", order: 0 }, { fieldId: "b", order: 3 }], "P")).toEqual([
      { fieldId: "a", order: 0 }, { fieldId: "b", order: 3 }, { fieldId: "P", role: "input", order: 4 }]);
  });
  it("un-hides a hidden People binding, leaves a visible one alone", () => {
    expect(withPeopleBinding([{ fieldId: "P", hidden: true }], "P")).toEqual([{ fieldId: "P", hidden: false }]);
    expect(withPeopleBinding([{ fieldId: "P" }], "P")).toBeNull();
  });
});
