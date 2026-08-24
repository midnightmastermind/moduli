// 0234 — undoing a write that was not asked for, without touching the config.
import { describe, it, expect } from "vitest";
import { withoutBindings, unsetPaths, FIELD_NAMES } from "../migrations/0234-unwind-the-medication-backfill.mjs";

describe("withoutBindings", () => {
  it("removes only the two it names, in order", () => {
    const before = [{ fieldId: "tag" }, { fieldId: "gen" }, { fieldId: "cls" }, { fieldId: "poster" }];
    expect(withoutBindings(before, ["gen", "cls"])).toEqual([{ fieldId: "tag" }, { fieldId: "poster" }]);
  });
  it("leaves a module that never had them completely alone", () => {
    const before = [{ fieldId: "tag" }, { fieldId: "poster" }];
    expect(withoutBindings(before, ["gen", "cls"])).toEqual(before);
  });
  it("survives a module with no bindings at all", () => {
    expect(withoutBindings(undefined, ["gen"])).toEqual([]);
  });
});

describe("unsetPaths", () => {
  it("unsets only what is actually present", () => {
    // The discriminating case: unsetting a key that was never there is a write
    // for nothing, and it makes the log overstate how many rows changed.
    const occ = { fields: { gen: { value: "Aripiprazole" } } };
    expect(unsetPaths(occ, ["gen", "cls"])).toEqual({ "fields.gen": "" });
  });
  it("returns nothing for a row that carries neither", () => {
    expect(unsetPaths({ fields: {} }, ["gen", "cls"])).toEqual({});
    expect(unsetPaths({}, ["gen"])).toEqual({});
  });
  it("clears a value that is present but empty — it is still a key 0232 wrote", () => {
    expect(unsetPaths({ fields: { gen: { value: "" } } }, ["gen"])).toEqual({ "fields.gen": "" });
  });
});

describe("scope", () => {
  it("names exactly the two fields 0232 minted", () => {
    expect(FIELD_NAMES).toEqual(["Generic Name", "Drug Class"]);
  });
});
