// A HALF-WRITTEN FEED CONDITION MUST NOT PULL THE WHOLE GRID.
//
// Found rebuilding poms grid through the UI (2026-09-22): switching a Meals
// container's Feed on and pressing "+ condition" minted a copy of nearly every
// instance on the grid (35) before a field was even chosen. A leaf with no
// field was dropped — and a feed with nothing usable left meant "match
// everything". `CONTAINS ""` matched everything too.
//
// Measured before changing it, over all 86 enabled feeds on the three grids:
// 4 have no usable condition and ALL 4 are SCOPED (they mirror a page); 0
// depend on an empty-value condition. So conditions that are still being
// written pull nothing; a feed with NO conditions keeps its designed meaning
// ("everything the roles allow", feedSync.test's "no scope = whole grid").
import { describe, it, expect } from "vitest";
import { resolveFeedItems } from "../state/selectors";
import { buildFeedPredicate } from "../helpers/feedPredicate";

const CAT = "cat";
function world(feed) {
  return {
    food:  { id: "food", occurrences: ["lib", "meals"] },
    lib:   { id: "lib", occurrences: ["oat", "rice"], parentId: "food", role: "container" },
    meals: { id: "meals", occurrences: [], parentId: "food", role: "container", feed: { enabled: true, roles: ["instance"], limit: 50, ...feed } },
    tasks: { id: "tasks", occurrences: ["email"] },
    oat:   { id: "oat", parentId: "lib", role: "instance", fields: { [CAT]: { value: ["meal"] } } },
    rice:  { id: "rice", parentId: "lib", role: "instance", fields: { [CAT]: { value: ["ingredient"] } } },
    email: { id: "email", parentId: "tasks", role: "instance", fields: {} },
  };
}
const run = (feed) => {
  const w = world(feed);
  return resolveFeedItems(w.meals, { occurrencesById: w, modulesById: {} }).map((i) => i.occurrence.id).sort();
};

describe("a half-written feed condition", () => {
  it("a fresh '+ condition' (no field yet) pulls NOTHING, not the grid", () => {
    expect(run({ conditions: [{ id: "c", fieldId: "", comparator: "IS", value: "" }] })).toEqual([]);
  });

  it("a field with an EMPTY value is not a condition yet", () => {
    expect(buildFeedPredicate({ conditions: [{ id: "c", fieldId: CAT, comparator: "CONTAINS", value: "" }] })).toBeNull();
    expect(run({ conditions: [{ id: "c", fieldId: CAT, comparator: "CONTAINS", value: "" }] })).toEqual([]);
  });

  it("CONTROL — a scoped feed with no conditions still mirrors its page (4 live feeds)", () => {
    expect(run({ scope: "food", conditions: [] })).toEqual(["oat", "rice"]);
  });

  it("CONTROL — a feed with NO conditions still pulls what its roles allow", () => {
    expect(run({ conditions: [] })).toEqual(["email", "oat", "rice"]);
  });

  it("CONTROL — a complete condition matches", () => {
    expect(run({ conditions: [{ id: "c", fieldId: CAT, comparator: "CONTAINS", value: "meal" }] })).toEqual(["oat"]);
  });

  it("CONTROL — a unary comparator needs no value", () => {
    expect(run({ conditions: [{ id: "c", fieldId: CAT, comparator: "IS_EMPTY" }] })).toEqual(["email"]);
  });

  it("CONTROL — false and 0 are values, not blanks", () => {
    expect(buildFeedPredicate({ conditions: [{ id: "c", fieldId: CAT, comparator: "IS", value: false }] })).not.toBeNull();
    expect(buildFeedPredicate({ conditions: [{ id: "c", fieldId: CAT, comparator: "IS", value: 0 }] })).not.toBeNull();
  });
});
