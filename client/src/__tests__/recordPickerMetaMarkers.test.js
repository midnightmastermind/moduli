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

  it("control: still offers fields and the existing meta keys", () => {
    expect(top()).toEqual(expect.arrayContaining(["fields", "meta.appliedFromTemplateId", "parentId"]));
  });
});
