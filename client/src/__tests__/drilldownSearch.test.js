// The field picker's search, and the rule for when it appears.
//
// User, 2026-08-27: "there should be a search for adding new fields onto an
// occurance too in the quick add menu." Binding a field meant finding one among
// the 292 this grid carries, in a list you could only scroll.
//
// The threshold is DERIVED from the dropdown's own box rather than picked, so
// changing the box moves the rule with it — the trick this repo already uses
// for `LABEL_MIN_ARC_PX` and the tablet sidebar's `ROOT_TREE_W * 3`.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SEARCH_MIN_ITEMS } from "../ui/DrilldownPicker";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "DrilldownPicker.jsx"),
  "utf8",
);

describe("DrilldownPicker search", () => {
  it("the threshold is what FITS, not a number someone picked", () => {
    // ~14 rows in a 420px box. The assertion is the derivation, not the value:
    // it must be a plausible screenful, and it must come from the box.
    expect(SEARCH_MIN_ITEMS).toBeGreaterThan(5);
    expect(SEARCH_MIN_ITEMS).toBeLessThan(40);
    expect(SRC).toContain("Math.floor(DROPDOWN_MAX_H / ROW_H)");
    // The box must READ the constant, or the two drift apart silently.
    expect(SRC).toContain("maxHeight: DROPDOWN_MAX_H");
  });

  it("a level that fits on screen grows no search box", () => {
    // A control that appears on a three-item list is noise.
    expect(SRC).toContain("level.items.length > SEARCH_MIN_ITEMS");
  });

  it("the query is CLEARED on every level change", () => {
    // Carried into a level it was not typed for, a query empties the list and
    // reads as "there is nothing here" — the failure this guards.
    const clears = SRC.split("setQuery(\"\")").length - 1;
    expect(clears).toBeGreaterThanOrEqual(3);   // open, drill in, breadcrumb out
  });

  it("a query matching nothing SAYS so rather than falling back to the list", () => {
    expect(SRC).toContain("filtered.length === 0");
    expect(SRC).toContain("Nothing matches");
  });

  it("a first level offering ONE category is skipped, not shown", () => {
    // `FieldBindingsEditor` declares a single flat category — "a field is
    // picked in one click, no drilling" — and the picker still opened onto a
    // one-row list you had to click through before the fields, and their
    // search, appeared.
    expect(SRC).toContain("categories.length === 1 ? [categories[0].id] : []");
    // Declared BEFORE openMenu reads it: a useCallback dep array is evaluated
    // at RENDER time, so the reverse throws before the callback ever runs —
    // a trap this repo has paid for twice.
    expect(SRC.indexOf("const categories = config?.categories"))
      .toBeLessThan(SRC.indexOf("const openMenu = useCallback"));
  });

  it("the list rendered is the FILTERED one — otherwise the box is decoration", () => {
    // The inert-control class: a search box that types but does not narrow.
    expect(SRC).toContain("{filtered.map((item, i) => (");
    expect(SRC).not.toContain("{level.items.map((item, i) => (");
  });
});
