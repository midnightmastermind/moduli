// __tests__/filterMultiPick.test.jsx
// User 2026-11-02: a select field's filter nav "should be a multiselect for it and not a bunch of buttons".
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FilterNavWidget, { defaultStyleForFilter, togglePick, pickSummary } from "../ui/FilterNavWidgets.jsx";
import { formatFilterValue } from "../ui/HeaderChevron.jsx";

const fieldsById = {
  S: { id: "S", name: "Quick Link Type", type: "select", meta: { optionsSource: { mode: "manual", values: ["social", "media", "website"] } } },
  D: { id: "D", name: "Date", type: "date" },
};

describe("select-field filters are a multi-pick", () => {
  it("a select field gets the multi-pick, even where an older filter stored pills or select", () => {
    expect(defaultStyleForFilter({ fieldId: "S" }, fieldsById)).toBe("multipick");
    expect(defaultStyleForFilter({ fieldId: "S", style: "pills" }, fieldsById)).toBe("multipick");
    expect(defaultStyleForFilter({ fieldId: "S", style: "select" }, fieldsById)).toBe("multipick");
    expect(defaultStyleForFilter({ fieldId: "D" }, fieldsById)).toBe("arrows"); // control
  });

  it("toggling builds a list, and the last one off clears the filter", () => {
    expect(togglePick(null, "social")).toEqual(["social"]);
    expect(togglePick(["social"], "media")).toEqual(["social", "media"]);
    expect(togglePick("social", "media")).toEqual(["social", "media"]); // an old single value counts as one pick
    expect(togglePick(["social"], "social")).toBe(null);
  });

  it("the button says what is picked", () => {
    const labels = { social: "Social", media: "Media", website: "Website" };
    expect(pickSummary(null, labels)).toBe("Any");
    expect(pickSummary(["social"], labels)).toBe("Social");
    expect(pickSummary(["social", "media"], labels)).toBe("Social, Media");
    expect(pickSummary(["social", "media", "website"], labels)).toBe("3 selected");
  });

  it("renders one dropdown button, not a row of buttons", () => {
    render(<FilterNavWidget filter={{ id: "f", fieldId: "S", style: "pills" }} value={["media"]} fieldsById={fieldsById} dispatch={() => {}} onNav={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("media");
  });

  it("the header pill names a list", () => {
    expect(formatFilterValue("S", ["social", "media"], fieldsById)).toBe("social, media");
    expect(formatFilterValue("S", ["a", "b", "c"], fieldsById)).toBe("3 selected");
    expect(formatFilterValue("S", [], fieldsById)).toBe(null);
  });
});
