import { describe, it, expect } from "vitest";
import { applyUpdate } from "../helpers/applyUpdate";

describe("applyUpdate with a user-defined $var bound to an occurrence record", () => {
  const occ = {
    id: "occ_goal",
    targetId: "mod_goal",
    fields: { f1: { value: 0, flow: "in" } },
    meta: { tag: "old" },
  };
  const ctx = () => ({
    vars: { $goalItem: occ },
    occurrencesById: { occ_goal: occ },
  });

  it("$goalItem.fields.<fid>.value emits UPDATE_ITEM_FIELD for occ_goal", () => {
    const out = applyUpdate("$goalItem.fields.f1.value", 42, ctx());
    expect(out.varWrites).toEqual({});
    expect(out.effects).toHaveLength(1);
    const eff = out.effects[0];
    expect(eff._effect).toBe("UPDATE_ITEM_FIELD");
    expect(eff.itemId).toBe("occ_goal");
    expect(eff.fieldId).toBe("f1");
    expect(eff.subKind).toBe("value");
    expect(eff.value).toBe(42);
  });

  it("$goalItem.fields.<fid>.flow emits UPDATE_ITEM_FIELD with subKind 'flow'", () => {
    const out = applyUpdate("$goalItem.fields.f1.flow", "out", ctx());
    expect(out.effects[0].subKind).toBe("flow");
    expect(out.effects[0].value).toBe("out");
  });

  it("$goalItem.meta.<key> emits UPDATE_ITEM_META with metaPath", () => {
    const out = applyUpdate("$goalItem.meta.tag", "new", ctx());
    expect(out.effects[0]._effect).toBe("UPDATE_ITEM_META");
    expect(out.effects[0].metaPath).toEqual(["tag"]);
    expect(out.effects[0].value).toBe("new");
  });

  it("$goalItem.fields.<fid>.value with null clears the field value", () => {
    const out = applyUpdate("$goalItem.fields.f1.value", null, ctx());
    expect(out.effects[0].value).toBe(null);
  });

  it("$goalItem.parentId emits UPDATE_ITEM_PARENT", () => {
    const out = applyUpdate("$goalItem.parentId", "occ_other", ctx());
    expect(out.effects[0]._effect).toBe("UPDATE_ITEM_PARENT");
    expect(out.effects[0].toParentId).toBe("occ_other");
  });

  it("$goalItem.label emits UPDATE_ITEM_LABEL with the string label", () => {
    const out = applyUpdate("$goalItem.label", "Today's Water", ctx());
    expect(out.varWrites).toEqual({});
    expect(out.effects).toHaveLength(1);
    const eff = out.effects[0];
    expect(eff._effect).toBe("UPDATE_ITEM_LABEL");
    expect(eff.itemId).toBe("occ_goal");
    expect(eff.label).toBe("Today's Water");
  });

  it("$goalItem.label with null clears the override (label null)", () => {
    const out = applyUpdate("$goalItem.label", null, ctx());
    expect(out.effects[0]._effect).toBe("UPDATE_ITEM_LABEL");
    expect(out.effects[0].label).toBe(null);
  });

  it("$goalItem.label coerces a non-string value to string", () => {
    const out = applyUpdate("$goalItem.label", 2026, ctx());
    expect(out.effects[0].label).toBe("2026");
  });

  it("throws when the named var isn't bound", () => {
    expect(() => applyUpdate("$missing.fields.f1.value", 5, { vars: {}, occurrencesById: {} }))
      .toThrow(/not bound/i);
  });

  it("throws when the bound var isn't a record (no .id)", () => {
    expect(() => applyUpdate("$scalar.fields.f1.value", 5, { vars: { $scalar: 7 }, occurrencesById: {} }))
      .toThrow(/not a record/i);
  });

  it("legacy $item path still works after the refactor", () => {
    const out = applyUpdate("$item.fields.f1.value", 99, {
      vars: { $item: occ },
      occurrencesById: { occ_goal: occ },
    });
    expect(out.effects[0]._effect).toBe("UPDATE_ITEM_FIELD");
    expect(out.effects[0].itemId).toBe("occ_goal");
    expect(out.effects[0].value).toBe(99);
  });
});

describe("applyUpdate filterOverride routing", () => {
  const page = { id: "page1", targetId: "mod_page", fields: {}, filterOverride: { f_date: "2026-07-25" } };
  const ctx = () => ({ vars: { $page: page }, occurrencesById: { page1: page } });

  it("routes $page.filterOverride.<fieldId> to an UPDATE_ITEM_FILTER_OVERRIDE effect", () => {
    const out = applyUpdate("$page.filterOverride.f_date", "2026-07-26", ctx());
    expect(out.varWrites).toEqual({});
    expect(out.effects).toEqual([
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: "page1", fieldId: "f_date", value: "2026-07-26" },
    ]);
  });

  it("carries a null value through, which clears that key", () => {
    const out = applyUpdate("$page.filterOverride.f_date", null, ctx());
    expect(out.effects[0].value).toBeNull();
  });

  it("rejects a bare filterOverride path with no field", () => {
    expect(() => applyUpdate("$page.filterOverride", "x", ctx())).toThrow(/unknown path head/);
  });
});
