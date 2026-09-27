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
  it("control: still offers fields and the existing meta keys", () => {
    expect(top()).toEqual(expect.arrayContaining(["fields", "meta.appliedFromTemplateId", "parentId"]));
  });
});
