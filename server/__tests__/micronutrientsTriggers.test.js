import { describe, it, expect } from "vitest";
import { withFieldTriggers } from "../migrations/0392-micronutrients-rerun-on-what-they-read.mjs";

const live = [{ eventType: "onChange", subjectType: "field", targetId: "fats", priority: 3 }, { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 3 }];
describe("0392 withFieldTriggers", () => {
  it("adds an onChange per missing field at the op's own priority, keeping the rest", () => {
    const next = withFieldTriggers(live, ["completed", "ingredient", "date"]);
    expect(next.slice(0, 2)).toEqual(live);
    expect(next.slice(2)).toEqual(["completed", "ingredient", "date"].map((t) => ({ eventType: "onChange", subjectType: "field", targetId: t, priority: 3 })));
  });
  it("only the missing ones", () => {
    expect(withFieldTriggers([...live, { eventType: "onChange", targetId: "date", priority: 3 }], ["completed", "date"]).length).toBe(4);
  });
  it("null when nothing is missing (a re-run is a no-op)", () => {
    expect(withFieldTriggers(withFieldTriggers(live, ["a"]), ["a"])).toBeNull();
  });
});
