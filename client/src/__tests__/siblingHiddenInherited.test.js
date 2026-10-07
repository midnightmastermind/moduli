// A new row added to a templated board keeps which fields its siblings HIDE
// (2026-10-07). poms' People rows bind 27 fields and hide 15; the add menu
// inherited the 27 ids and their roles and dropped `hidden`, so a new person
// came out showing fifteen chips none of its siblings show.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { siblingFieldBindings, normalizeFieldBindings } from "../helpers/siblingFieldBindings.js";

const modulesById = {
  m1: { id: "m1", role: "instance", fieldBindings: [{ fieldId: "name", role: "input" }, { fieldId: "notes", role: "input", hidden: true }, { fieldId: "poster", role: "media", hidden: true }] },
};
const occurrencesById = { a: { id: "a", moduleId: "m1" } };
const board = { id: "b", occurrences: ["a"] };

describe("hidden survives inheritance", () => {
  it("siblingFieldBindings reports a sibling's hidden binding", () => {
    expect(siblingFieldBindings(board, occurrencesById, modulesById)).toEqual([
      { fieldId: "name", role: "input" },
      { fieldId: "notes", role: "input", hidden: true },
      { fieldId: "poster", role: "media", hidden: true },
    ]);
  });
  it("normalizeFieldBindings keeps hidden:true (and still stamps hidden:false in App's shape)", () => {
    const fb = [{ fieldId: "name", role: "input" }, { fieldId: "notes", role: "input", hidden: true }];
    expect(normalizeFieldBindings({ fieldBindings: fb })).toEqual([{ fieldId: "name", role: "input" }, { fieldId: "notes", role: "input", hidden: true }]);
    expect(normalizeFieldBindings({ fieldBindings: fb, hidden: true })).toEqual([{ fieldId: "name", role: "input", hidden: false }, { fieldId: "notes", role: "input", hidden: true }]);
  });
  it("CONTROL — a field the siblings show stays shown", () => {
    expect(normalizeFieldBindings({ fieldIds: ["x"] })).toEqual([{ fieldId: "x", role: "input" }]);
  });
  it("the add menu passes the inherited hidden flag into the new row's bindings", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/QuickAddMenu.jsx"), "utf8");
    expect(src).toMatch(/inheritedHiddenRef\.current = new Set\(inherited\.filter\(b => b\.hidden\)/);
    expect(src).toMatch(/inheritedHiddenRef\.current\?\.has\?\.\(fid\) \? \{ hidden: true \}/);
  });
});
