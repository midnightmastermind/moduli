// ui/FeedSection — editing a feed's predicate in the app.
//
// The resolver can understand OR and nesting and still leave the feature
// unusable if the editor cannot express one. This pins the two things that are
// invisible from the outside: what the form WRITES back onto the occurrence,
// and that a nested group renders the same controls as the top level (it is the
// same recursive component, so a regression there is silent).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (...a) => updateOccurrence(...a),
}));

const gridActions = { current: {} };
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => gridActions.current,
}));

import FeedSection from "../ui/FeedSection";

const OCC = "occ-completed";
const F_DONE = "f-done";
const F_DATE = "f-date";

const lastFeed = () => updateOccurrence.mock.calls.at(-1)[0].occurrence.feed;

function mount(feed) {
  const occurrence = { id: OCC, moduleId: "m", occurrences: [], feed };
  gridActions.current = {
    dispatch: vi.fn(), socket: {},
    occurrencesById: { [OCC]: occurrence },
    modulesById: { m: { id: "m", role: "page", label: "Completed" } },
    fieldsById: {
      [F_DONE]: { id: F_DONE, name: "Completed", type: "boolean" },
      [F_DATE]: { id: F_DATE, name: "Date", type: "date" },
    },
  };
  return render(<FeedSection occurrence={occurrence} />);
}

const FLAT = {
  enabled: true, roles: ["instance"], scope: null, limit: 300,
  conditions: [
    { id: "c1", fieldId: F_DONE, comparator: "IS", value: true },
    { id: "c2", fieldId: F_DATE, comparator: "IS_NOT_EMPTY", value: "" },
  ],
};

const NESTED = {
  enabled: true, roles: ["instance"], scope: null, limit: 300,
  conditionOperator: "OR",
  conditions: [
    { id: "c1", fieldId: F_DONE, comparator: "IS", value: true },
    { id: "g1", operator: "AND", conditions: [{ id: "c2", fieldId: F_DATE, comparator: "DATE_BEFORE", value: "$today" }] },
  ],
};

beforeEach(() => updateOccurrence.mockClear());
afterEach(cleanup);

describe("FeedSection — the operator", () => {
  // Every feed authored before 2026-08-08 omits conditionOperator; the editor
  // must show it as AND rather than blank or OR.
  it("shows a flat legacy feed as 'match all'", () => {
    mount(FLAT);
    expect(screen.getByText(/match all/i)).toBeTruthy();
  });

  it("writes conditionOperator when the toggle is flipped, and keeps the conditions", () => {
    mount(FLAT);
    fireEvent.click(screen.getByText(/match all/i));
    const feed = lastFeed();
    expect(feed.conditionOperator).toBe("OR");
    expect(feed.conditions).toHaveLength(2);
    expect(feed.conditions[0].fieldId).toBe(F_DONE);
  });

  it("reads an existing OR back as 'match any'", () => {
    mount(NESTED);
    expect(screen.getAllByText(/match any/i).length).toBeGreaterThan(0);
  });

  // A single condition has nothing to combine, so offering all/any there is
  // noise that implies the choice matters.
  it("hides the toggle when there is only one condition", () => {
    mount({ ...FLAT, conditions: [FLAT.conditions[0]] });
    expect(screen.queryByText(/match (all|any)/i)).toBeNull();
  });
});

describe("FeedSection — groups", () => {
  it("renders a nested group's own controls, not just the top level", () => {
    mount(NESTED);
    // Two field selects: the top-level leaf, and the one inside the group.
    const fieldSelects = screen.getAllByRole("combobox").filter(
      (s) => Array.from(s.options).some((o) => o.textContent === "field…"),
    );
    expect(fieldSelects).toHaveLength(2);
    expect(screen.getByTitle("Remove group")).toBeTruthy();
  });

  it("appends a group seeded with one condition, so it is never born empty", () => {
    mount(FLAT);
    fireEvent.click(screen.getByText("group"));
    const added = lastFeed().conditions.at(-1);
    expect(Array.isArray(added.conditions)).toBe(true);
    expect(added.conditions).toHaveLength(1);
    expect(added.operator).toBe("AND");
  });

  it("edits a condition INSIDE a group without disturbing the top level", () => {
    mount(NESTED);
    const inner = screen.getAllByRole("combobox").filter(
      (s) => Array.from(s.options).some((o) => o.textContent === "field…"),
    )[1];
    fireEvent.change(inner, { target: { value: F_DONE } });
    const feed = lastFeed();
    expect(feed.conditions[0].fieldId).toBe(F_DONE);       // untouched leaf
    expect(feed.conditions[1].conditions[0].fieldId).toBe(F_DONE); // the edited one
    expect(feed.conditionOperator).toBe("OR");             // operator survives
  });

  it("removing a group leaves the sibling condition alone", () => {
    mount(NESTED);
    fireEvent.click(screen.getByTitle("Remove group"));
    const feed = lastFeed();
    expect(feed.conditions).toHaveLength(1);
    expect(feed.conditions[0].id).toBe("c1");
  });

  // The token has to survive the value input's coercion, or it is unreachable
  // from the only UI that edits feeds. Note the edit must CHANGE the value —
  // React does not fire onChange when it is identical, which is how the first
  // version of this test read an empty mock and threw instead of failing.
  it("renders an existing $today, and stores a newly typed one as a literal string", () => {
    mount(NESTED);
    const inputs = screen.getAllByPlaceholderText("value");
    expect(inputs.some((i) => i.value === "$today")).toBe(true);

    fireEvent.change(inputs[0], { target: { value: "$today" } });   // was `true`
    expect(lastFeed().conditions[0].value).toBe("$today");
  });

  // The same coercion still has to turn "true"/"false" and numbers into real
  // values — that is what every existing feed relies on.
  it("still coerces booleans and numbers", () => {
    mount(NESTED);
    const input = screen.getAllByPlaceholderText("value")[0];
    fireEvent.change(input, { target: { value: "false" } });
    expect(lastFeed().conditions[0].value).toBe(false);
    fireEvent.change(input, { target: { value: "42" } });
    expect(lastFeed().conditions[0].value).toBe(42);
  });
});
