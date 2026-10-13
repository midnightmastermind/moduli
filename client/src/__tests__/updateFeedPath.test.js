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
