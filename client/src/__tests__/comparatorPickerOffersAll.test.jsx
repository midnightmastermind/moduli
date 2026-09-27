// The RENDERED comparator dropdown, not just the catalog.
//
// A comparator being in helpers/comparators.js is not the same claim as it being
// selectable — `ConditionGroup` held its OWN 20-entry literal, which is how 14
// comparators the evaluator implements became unauthorable. These tests read the
// <select> the user actually sees.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import ConditionGroup from "../blocks/ConditionGroup";

vi.mock("../ui/DrilldownPicker", () => ({
  default: ({ value }) => <button>{value || "pick"}</button>,
}));

const renderRule = (rule) => {
  const { container } = render(
    <ConditionGroup
      group={{ operator: "AND", rules: [rule] }}
      onChange={vi.fn()}
      sources={[]}
      fields={[]}
      fieldsById={{}}
      modulesById={{}}
      occurrencesById={{}}
    />
  );
  // The FIRST select is the group's AND/OR operator; the rule's comparator is
  // the one carrying comparator values.
  const sel = [...container.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "SAME_DAY")
  );
  return { container, sel };
};

describe("the comparator dropdown a user sees", () => {
  it("offers the comparators live operations depend on", () => {
    const { sel } = renderRule({ id: "r1", left: "$a", comparator: "IS", right: "" });
    expect(sel).toBeTruthy();
    const values = [...sel.options].map((o) => o.value);
    for (const c of [
      "DATE_IN_PERIOD", "DATE_ON_OR_BEFORE_PERIOD",
      "ARRAY_INCLUDES", "ARRAY_NOT_INCLUDES",
      "NOT_HAS_ANCESTOR", "DATE_WITHIN_DAYS", "TIME_BEFORE", "TIME_AFTER",
    ]) {
      expect(values, `${c} is not in the dropdown`).toContain(c);
    }
    // And it did not lose what it already had.
    for (const c of ["IS", "IS_NOT", "SAME_DAY", "HAS_ANCESTOR", "IS_EMPTY"]) {
      expect(values).toContain(c);
    }
  });

  it("groups the options so a 30-entry list stays findable", () => {
    const { sel } = renderRule({ id: "r1", left: "$a", comparator: "IS", right: "" });
    const groups = [...sel.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Value", "Numbers", "Dates", "Time of day", "Lists", "Structure"]);
  });

  it("shows a STORED comparator the list does not carry, rather than lying about the rule", () => {
    // A <select> whose value is absent from its options renders blank or shows
    // the first entry. 576 live rules hold a comparator the old list omitted —
    // every one of them read as something it was not.
    const { sel } = renderRule({ id: "r1", left: "$a", comparator: "SOME_FUTURE_COMPARATOR", right: "x" });
    expect(sel.value).toBe("SOME_FUTURE_COMPARATOR");
    expect([...sel.options].map((o) => o.value)).toContain("SOME_FUTURE_COMPARATOR");
  });

  it("keeps an alias selected when a rule already stores one, without offering it twice", () => {
    const { sel } = renderRule({ id: "r1", left: "$a", comparator: "GREATER_THAN", right: "1" });
    expect(sel.value).toBe("GREATER_THAN");
    const n = [...sel.options].filter((o) => o.value === "GREATER_THAN").length;
    expect(n).toBe(1);
  });

  it("hides the value box for a comparator that takes no right operand", () => {
    // The unary set moved to the shared catalog; this is the behaviour it drives.
    const unary = renderRule({ id: "r1", left: "$a", comparator: "DATE_IS_TODAY", right: "" });
    const binary = renderRule({ id: "r2", left: "$a", comparator: "DATE_BEFORE", right: "" });
    const boxes = (r) => r.container.querySelectorAll('input[placeholder="value or $var"]').length
      + [...r.container.querySelectorAll("button")].filter((b) => b.textContent === "text" || b.textContent === "path").length;
    expect(boxes(unary)).toBe(0);
    expect(boxes(binary)).toBeGreaterThan(0);
  });
});
