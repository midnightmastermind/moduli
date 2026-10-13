// An operation can turn a container's feed on (Combine Schedule builds 49 feed slots).
// `$x.feed` writes the WHOLE feed object, like `$x.fieldVisibility`.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyUpdate } from "../helpers/applyUpdate";

const occ = { id: "slot", fields: {} };
const ctx = { vars: { $slot: occ }, occurrencesById: { slot: occ } };

describe("UPDATE $x.feed", () => {
  it("emits UPDATE_ITEM_FEED with the whole feed object", () => {
    const feed = { enabled: true, scope: "page", roles: ["instance"], conditions: [{ id: "c", fieldId: "ts", comparator: "IS", value: "9:00am" }] };
    const out = applyUpdate("$slot.feed", feed, ctx);
    expect(out.effects).toEqual([{ _effect: "UPDATE_ITEM_FEED", itemId: "slot", value: feed }]);
  });
  it("refuses a partial key (a feed is one decision, like fieldVisibility)", () => {
    expect(() => applyUpdate("$slot.feed.enabled", true, ctx)).toThrow();
  });
  it("the effect is applied and schedules a feed sync (wiring)", () => {
    const b = fs.readFileSync(path.resolve(__dirname, "../state/bindSocketToStore.js"), "utf8");
    const at = b.indexOf('case "UPDATE_ITEM_FEED"');
    expect(at).toBeGreaterThan(0);
    expect(b.slice(at, at + 1200)).toMatch(/updateOccurrence\([\s\S]*feed[\s\S]*scheduleFeedSync\(/);
  });
});

describe("the path picker drills into a feed", () => {
  it("offers feed.enabled (Combine Days tests it before turning a slot's feed on)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/DrilldownPicker.jsx"), "utf8");
    expect(src).toMatch(/value: "feed",[^\n]*hasChildren: true, childShape: "feed"/);
    expect(src).toMatch(/feed: \{\n\s*keys: \(\) => \[\n\s*\{ value: "enabled"/);
  });
});

describe("the path picker drills into a page's layout override", () => {
  it("offers hideChildIds and mode (Combine Days writes them one key at a time)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/DrilldownPicker.jsx"), "utf8");
    expect(src).toMatch(/value: "meta.layoutCascadeOverride",[^\n]*hasChildren: true, childShape: "layoutOverride"/);
    const block = src.slice(src.indexOf("layoutOverride: {"), src.indexOf("feed: {\n"));
    expect(block).toMatch(/value: "hideChildIds"/);
    expect(block).toMatch(/value: "mode"/);
  });
  it("a sub-key write is routed as a meta merge, not a whole-object write", () => {
    const page = { id: "pg", fields: {}, meta: { layoutCascadeOverride: { sortChildrenByField: "d" } } };
    const out = applyUpdate("$pg.meta.layoutCascadeOverride.hideChildIds", ["a"], { vars: { $pg: page }, occurrencesById: { pg: page } });
    expect(JSON.stringify(out.effects)).toMatch(/hideChildIds/);
  });
});
