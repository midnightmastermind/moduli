// __tests__/conditionRuleSides.test.jsx
//
// A RETRACTION, pinned as a test.
//
// While building an operation through the UI on 2026-08-18 I reported that the
// record-path picker kept assigning my picks to a rule's RIGHT side instead of
// its LEFT. Reading the code afterwards, each side owns its own picker with its
// own `onChange`, and `DrilldownPicker` keeps its open/drill state per instance
// — there is no shared state for one picker to write through another.
//
// So the likelier explanation is the probe: the two pickers render as identical
// small buttons on one row, and my clicks were landing on the wrong one. This
// test pins what the component actually does, so if the wiring ever DOES cross
// over, that is a failure rather than an argument.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import ConditionGroup from "../blocks/ConditionGroup";

// The picker is a drilldown popover; here it stands in as a button that commits
// a fixed path, so the assertion is about WHICH SIDE receives it.
vi.mock("../ui/DrilldownPicker", () => ({
  default: ({ value, onChange }) => (
    <button data-testid={`picker:${value || "empty"}`} onClick={() => onChange("$item.fields.f1.value")}>
      pick
    </button>
  ),
}));

const group = {
  operator: "AND",
  // The right side starts in PATH mode only when it already holds a `$`
  // path — otherwise the row renders a free-text input instead of a picker.
  rules: [{ id: "r1", left: "$LEFT", comparator: "IS", right: "$RIGHT" }],
};

const renderGroup = () => {
  const onChange = vi.fn();
  render(
    <ConditionGroup
      group={group}
      onChange={onChange}
      sources={[]}
      fields={[]}
      fieldsById={{}}
      modulesById={{}}
      occurrencesById={{}}
    />,
  );
  return onChange;
};

describe("a condition rule's two sides", () => {
  it("the LEFT picker writes left and leaves right alone", () => {
    const onChange = renderGroup();
    fireEvent.click(screen.getByTestId("picker:$LEFT"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0].rules[0];
    expect(next.left).toBe("$item.fields.f1.value");
    expect(next.right).toBe("$RIGHT");
  });

  it("the RIGHT picker writes right and leaves left alone", () => {
    const onChange = renderGroup();
    fireEvent.click(screen.getByTestId("picker:$RIGHT"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0].rules[0];
    expect(next.right).toBe("$item.fields.f1.value");
    expect(next.left).toBe("$LEFT");
  });
});
