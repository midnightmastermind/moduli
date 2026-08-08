// Feed conditions as a PREDICATE TREE (2026-08-08).
//
// User 2026-08-07: "if i finish a todo, it gets put in a completed container at
// the bottom of the tasks page. include appointments there too after the date
// passes for it."
//
// ONE container, TWO unrelated reasons to be in it. `resolveFeedItems` ANDed a
// flat list, so that was inexpressible: adding a date rule to the Completed
// feed yields "completed AND past", and an unqualified date rule sweeps every
// past-dated row rather than just the appointments. The predicate the user
// described is nested:
//
//   Completed IS true   OR   (Date DATE_BEFORE $today  AND  Time Slot IS_NOT_EMPTY)
//
// `evalGroupAgainstRecord` has always handled AND/OR and nesting — the gap was
// that feeds flattened. This builds the tree it already understands.
//
// BACK-COMPAT IS THE WHOLE RISK: 77 enabled feeds across three grids carry flat
// AND lists, and a feed that silently changes what it matches is wrong in a way
// nobody sees. Absent `conditionOperator` MUST mean AND.

import { describe, it, expect } from "vitest";
import { buildFeedPredicate } from "../helpers/feedPredicate.js";

const leaf = (fieldId, comparator, value) => ({ id: `c-${fieldId}`, fieldId, comparator, value });
const NOW = new Date(2026, 7, 8, 12, 0, 0); // 2026-08-08

describe("buildFeedPredicate — the flat AND shape every live feed uses", () => {
  it("defaults to AND when no operator is declared", () => {
    const p = buildFeedPredicate({ conditions: [leaf("f1", "IS", true)] }, { now: NOW });
    expect(p.operator).toBe("AND");
    expect(p.rules).toEqual([{ left: "fields.f1.value", comparator: "IS", right: true }]);
  });

  it("defaults a missing comparator to IS, as the resolver always did", () => {
    const p = buildFeedPredicate({ conditions: [{ id: "c", fieldId: "f1", value: "x" }] }, { now: NOW });
    expect(p.rules[0].comparator).toBe("IS");
  });

  it("returns null when there are no conditions — the caller matches everything", () => {
    expect(buildFeedPredicate({ conditions: [] }, { now: NOW })).toBe(null);
    expect(buildFeedPredicate({}, { now: NOW })).toBe(null);
  });

  // FeedSection's "+ condition" mints {fieldId: ""}. If a half-configured row
  // became a real rule, adding one would instantly empty the feed.
  it("drops a condition with no fieldId instead of letting it match nothing", () => {
    const p = buildFeedPredicate({ conditions: [leaf("f1", "IS", true), { id: "c2", fieldId: "" }] }, { now: NOW });
    expect(p.rules).toHaveLength(1);
  });

  it("returns null when every condition is incomplete", () => {
    expect(buildFeedPredicate({ conditions: [{ id: "c", fieldId: "" }] }, { now: NOW })).toBe(null);
  });
});

describe("buildFeedPredicate — operator and nesting", () => {
  it("honours a top-level OR", () => {
    const p = buildFeedPredicate(
      { conditionOperator: "OR", conditions: [leaf("f1", "IS", true), leaf("f2", "IS", false)] },
      { now: NOW },
    );
    expect(p.operator).toBe("OR");
    expect(p.rules).toHaveLength(2);
  });

  it("builds a nested group as a `rules` sub-tree, which is what evalGroup detects", () => {
    const p = buildFeedPredicate({
      conditionOperator: "OR",
      conditions: [
        leaf("done", "IS", true),
        { id: "g1", operator: "AND", conditions: [leaf("date", "DATE_BEFORE", "$today"), leaf("slot", "IS_NOT_EMPTY", "")] },
      ],
    }, { now: NOW });
    expect(p.operator).toBe("OR");
    expect(p.rules[0]).toEqual({ left: "fields.done.value", comparator: "IS", right: true });
    expect(Array.isArray(p.rules[1].rules)).toBe(true);
    expect(p.rules[1].operator).toBe("AND");
    expect(p.rules[1].rules).toHaveLength(2);
  });

  it("resolves date tokens inside a nested group", () => {
    const p = buildFeedPredicate({
      conditionOperator: "OR",
      conditions: [{ id: "g", operator: "AND", conditions: [leaf("date", "DATE_BEFORE", "$today")] }],
    }, { now: NOW });
    expect(p.rules[0].rules[0].right).toBe("2026-08-08");
  });

  // An empty AND group evaluates TRUE, so inside an OR it would make the whole
  // feed match everything. Dropping it is the only safe reading.
  it("drops a group whose children are all incomplete rather than emitting an empty one", () => {
    const p = buildFeedPredicate({
      conditionOperator: "OR",
      conditions: [leaf("f1", "IS", true), { id: "g", operator: "AND", conditions: [{ id: "x", fieldId: "" }] }],
    }, { now: NOW });
    expect(p.rules).toHaveLength(1);
    expect(p.rules[0].left).toBe("fields.f1.value");
  });

  it("returns null when the only entry is an empty group", () => {
    expect(buildFeedPredicate(
      { conditionOperator: "OR", conditions: [{ id: "g", operator: "AND", conditions: [] }] },
      { now: NOW },
    )).toBe(null);
  });

  it("normalises an unknown operator to AND rather than inventing behaviour", () => {
    const p = buildFeedPredicate({ conditionOperator: "XOR", conditions: [leaf("f1", "IS", 1)] }, { now: NOW });
    expect(p.operator).toBe("AND");
  });

  // Nesting the UI can actually produce survives intact. Asserted with real
  // structure so it cannot pass against a builder that returns null.
  it("keeps a group nested inside a group", () => {
    const p = buildFeedPredicate({
      conditionOperator: "OR",
      conditions: [{
        id: "g1", operator: "AND",
        conditions: [leaf("a", "IS", 1), { id: "g2", operator: "OR", conditions: [leaf("b", "IS", 2)] }],
      }],
    }, { now: NOW });
    expect(p.rules[0].rules[1].operator).toBe("OR");
    expect(p.rules[0].rules[1].rules[0].left).toBe("fields.b.value");
  });

  // A backstop against a hand-edited or cyclic structure, not a path the UI can
  // reach. It degrades to "unconfigured" — the same reading the resolver has
  // always given a condition it cannot use — rather than walking an unbounded
  // tree on every feed sync.
  it("refuses an absurdly nested tree instead of descending it", () => {
    let deep = { id: "leafiest", operator: "AND", conditions: [leaf("f1", "IS", 1)] };
    for (let i = 0; i < 12; i++) deep = { id: `g${i}`, operator: "AND", conditions: [deep] };
    expect(buildFeedPredicate({ conditions: [deep] }, { now: NOW })).toBe(null);
  });
});
