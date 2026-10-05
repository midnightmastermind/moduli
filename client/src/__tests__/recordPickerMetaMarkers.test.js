// The Find editor's record-field picker must offer the meta markers poms'
// predicates actually use — `meta.feedSourceId IS_EMPTY` guards 89 of its
// fields and ops, and it could not be authored from the UI (2026-09-27).
import { describe, it, expect } from "vitest";
import { itemsForLevel } from "../ui/DrilldownPicker.jsx";

const top = () => itemsForLevel([], { fields: [] }, [], "occurrence").items.map((i) => i.value);

describe("record picker offers the app's meta markers", () => {
  it("offers meta.feedSourceId", () => { expect(top()).toContain("meta.feedSourceId"); });
  it("offers meta.copyLinkSource and meta.userTouched", () => {
    expect(top()).toEqual(expect.arrayContaining(["meta.copyLinkSource", "meta.userTouched"]));
  });
  it("offers _boundFieldIds — 38 live operations gate on it across 113 rules", () => {
    // The executor enriches it onto every $allItems entry, and it is how a
    // tracker expresses "this row never bound Completed". No picker entry meant
    // none of those 113 rules could be authored here.
    expect(top()).toContain("_boundFieldIds");
  });

  it("offers linkedGroupId — 7 live reads across 4 ops find a mirror by it", () => {
    // Project: Sync To Todo List finds a task's mirror with `linkedGroupId IS $lgId`;
    // building it by clicking found no picker row (2026-10-03).
    expect(top()).toContain("linkedGroupId");
  });

  it("offers moduleLabel — 17 live reads across 8 ops tell a kind of card by it", () => {
    // People: Birthdays sweeps stale cards by `moduleLabel IS Birthday`; the
    // executor enriches it from the template, and no picker row offered it.
    expect(top()).toContain("moduleLabel");
  });

  it("drills filterOverride per field, like its read-only twin", () => {
    // Both are filter maps keyed by field id; `filterOverride` is the WRITABLE
    // one (`applyUpdate` routes `$page.filterOverride.<fieldId>` — how a page's
    // pinned date is moved). It was offered as a LEAF, so the 10 such paths in
    // `Grid: Snap Filter To Today` could not be authored.
    const { items } = itemsForLevel([], { fields: [] }, [], "occurrence");
    const fo = items.find((i) => i.value === "filterOverride");
    const ef = items.find((i) => i.value === "_effectiveFilter");
    expect(fo.hasChildren).toBe(true);
    expect(fo.childShape).toBe(ef.childShape);
  });

  it("drills a filter entry into the range object's own keys", () => {
    // A filter value is either a bare "YYYY-MM-DD" or `{value, unit, span,
    // kind, dates}`. Telling those apart is what `Grid: Snap Filter To Today`
    // guards on (`.unit IS_EMPTY` = a plain day pin), and the per-field entries
    // were leaves, so none of those three arms could be authored.
    const ctx = { fields: [{ id: "f1", name: "Date", type: "date" }] };
    const entry = itemsForLevel([], ctx, [], "filter").items.find((i) => i.value === "f1");
    expect(entry.hasChildren).toBe(true);
    const sub = itemsForLevel(["f1"], ctx, [], "filter").items.map((i) => i.value);
    expect(sub).toEqual(["value", "unit", "span", "kind", "dates"]);
  });

  it("offers occurrences — the ordered child list, and the commonest loop target", () => {
    // 45 pipeline strings across 8 operations read `$var.occurrences` (42 of
    // them as a loop's collection); it had no picker entry, so none of those
    // loops could be authored.
    expect(top()).toContain("occurrences");
  });

  it("offers meta.layoutCascadeOverride — the day-column builder writes it", () => {
    expect(top()).toContain("meta.layoutCascadeOverride");
  });

  it("offers role and kind — the executor resolves both from the template", () => {
    // 16 live rules in 2 ops gate on `.role IS instance`; the day-column builder
    // could not author its own "is this a row?" test (2026-09-28).
    expect(top()).toEqual(expect.arrayContaining(["role", "kind"]));
  });

  it("control: still offers fields and the existing meta keys", () => {
    expect(top()).toEqual(expect.arrayContaining(["fields", "meta.appliedFromTemplateId", "parentId"]));
  });
});

// THE CLASS, not the instance: `descendShape` was a hand-listed dispatch, so a
// shape declared as some row's `childShape` could exist in SHAPES and still
// drill to nothing (`filterValue`, and `tableColumn` / `tableCellsMap` since
// they were written). Every childShape the source names must descend.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
describe("every declared childShape is reachable", () => {
  const src = readFileSync(resolve(__dirname, "../ui/DrilldownPicker.jsx"), "utf8");
  const shapes = [...new Set([...src.matchAll(/childShape:\s*"(\w+)"/g)].map((m) => m[1]))];
  const ctx = {
    fields: [{ id: "f1", name: "Date", type: "date" }],
    occurrencesById: { o1: { id: "o1", label: "Row" } },
  };
  it("the scan found the shapes it is about (control)", () => {
    expect(shapes).toEqual(expect.arrayContaining(["filter", "filterValue", "tableColumn", "tableCellsMap"]));
  });
  it.each(shapes)("%s descends to at least one row", (shape) => {
    expect(itemsForLevel([], ctx, [], shape).items.length).toBeGreaterThan(0);
  });
});
