import { describe, it, expect } from "vitest";
import { readsLiteralTag, withTagsTrigger } from "../../../server/migrations/0388-tag-trackers-rerun-on-tags.mjs";
const p = (rules) => ({ steps: [{ type: "loop", body: [{ type: "if", condition: { operator: "AND", rules } }] }] });
describe("0388", () => {
  it("a literal tag counts; the category variable does not", () => {
    expect(readsLiteralTag(p([{ left: "$item.fields.T.value", comparator: "CONTAINS", right: "intellectual" }]), "T")).toBe(true);
    expect(readsLiteralTag(p([{ operator: "OR", rules: [{ left: "$item.fields.T.value", comparator: "CONTAINS", right: "$goalCategory" }] }]), "T")).toBe(false);
  });
  it("finds a literal inside a nested group", () => {
    expect(readsLiteralTag(p([{ operator: "AND", rules: [{ left: "$item.fields.T.value", comparator: "CONTAINS", right: "social" }] }]), "T")).toBe(true);
  });
  it("adds the trigger once, at the op's onChange priority", () => {
    expect(withTagsTrigger([{ eventType: "onChange", targetId: "D", priority: 3 }], "T")).toEqual([{ eventType: "onChange", targetId: "D", priority: 3 }, { eventType: "onChange", subjectType: "field", targetId: "T", priority: 3 }]);
    expect(withTagsTrigger([{ eventType: "onChange", targetId: "T", priority: 3 }], "T")).toBeNull();
  });
});
