// A feed condition can name WHERE a row sits ("under this occurrence") instead
// of a field. Combine Days pulls whatever is listed in each picked day's slot —
// a Todo item carries no Time Slot, and a shift spanning 13 slots carries only
// its start, so no field says where it sits.
import { describe, it, expect } from "vitest";
import { resolveFeedItems } from "../state/selectors";
import { buildFeedPredicate } from "../helpers/feedPredicate";

function world(feed) {
  return {
    page:  { id: "page", occurrences: ["mon", "tue", "comb"] },
    mon:   { id: "mon", parentId: "page", occurrences: ["monTodo"], role: "container" },
    tue:   { id: "tue", parentId: "page", occurrences: ["tueTodo", "tue9"], role: "container" },
    monTodo: { id: "monTodo", parentId: "mon", occurrences: ["a"], role: "container" },
    tueTodo: { id: "tueTodo", parentId: "tue", occurrences: ["b"], role: "container" },
    tue9:  { id: "tue9", parentId: "tue", occurrences: ["c", "shift"], role: "container" },
    tue930: { id: "tue930", parentId: "tue", occurrences: ["shift"], role: "container" },
    comb:  { id: "comb", parentId: "page", occurrences: ["combTodo"], role: "container" },
    combTodo: { id: "combTodo", parentId: "comb", occurrences: [], role: "container",
      feed: { enabled: true, roles: ["instance"], scope: "page", limit: 50, ...feed } },
    a: { id: "a", parentId: "monTodo", role: "instance", fields: {} },
    b: { id: "b", parentId: "tueTodo", role: "instance", fields: {} },
    c: { id: "c", parentId: "tue9", role: "instance", fields: {} },
    shift: { id: "shift", parentId: "tue9", role: "instance", fields: {} },
  };
}
const run = (feed) => {
  const w = world(feed);
  return resolveFeedItems(w.combTodo, { occurrencesById: w, modulesById: {} }).map((i) => i.occurrence.id).sort();
};
const under = (id) => ({ id: `u-${id}`, path: "_ancestors", comparator: "HAS_ANCESTOR", value: id });

describe("a feed condition naming where a row sits", () => {
  it("pulls every row under any of the named slots (OR)", () => {
    expect(run({ conditionOperator: "OR", conditions: [under("monTodo"), under("tueTodo")] })).toEqual(["a", "b"]);
  });
  it("a row listed in a second slot is under that slot too (any-parent)", () => {
    expect(run({ conditions: [under("tue930")] })).toEqual(["shift"]);
  });
  it("a slot with nothing in it pulls nothing", () => {
    expect(run({ conditions: [under("comb")] })).toEqual([]);
  });
  it("only the listed paths are accepted — any other path is not a condition", () => {
    expect(buildFeedPredicate({ conditions: [{ id: "x", path: "label", comparator: "IS", value: "a" }] })).toBeNull();
  });
  it("CONTROL — a field leaf still reads fields.<id>.value", () => {
    const p = buildFeedPredicate({ conditions: [{ id: "f", fieldId: "ts", comparator: "IS", value: "9:00am" }] });
    expect(p.rules[0].left).toBe("fields.ts.value");
  });
});
