// UI sweep 2026-11-04: a NUMBER filter drew the DATE stepper — "next" stored "2026-11-05" as Quantity's filter value,
// which no number matches. And the switch and the text box had no accessible name (a screen reader read "switch").
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterNavWidget, { defaultStyleForFilter } from "../ui/FilterNavWidgets.jsx";

const fieldsById = {
  q: { id: "q", name: "Quantity", type: "number" },
  d: { id: "d", name: "Date", type: "date" },
  b: { id: "b", name: "Completed", type: "boolean" },
  t: { id: "t", name: "Notes", type: "text" },
};

describe("filter widgets", () => {
  it("a number filter is a number box, not the date stepper — even when a stored style says arrows", () => {
    expect(defaultStyleForFilter({ fieldId: "q" }, fieldsById)).toBe("input");
    expect(defaultStyleForFilter({ fieldId: "q", style: "arrows" }, fieldsById)).toBe("input");
    expect(defaultStyleForFilter({ fieldId: "d" }, fieldsById)).toBe("arrows"); // control
  });
  it("the number box takes numbers and names its field", () => {
    const onNav = vi.fn();
    render(<FilterNavWidget filter={{ id: "f", fieldId: "q" }} value="" fieldsById={fieldsById} onNav={onNav} />);
    const box = screen.getByRole("spinbutton", { name: "Quantity" });
    expect(box).toBeTruthy();
  });
  it("the switch and the text box are named by their field", () => {
    render(<FilterNavWidget filter={{ id: "f", fieldId: "b" }} value={false} fieldsById={fieldsById} onNav={() => {}} />);
    expect(screen.getByRole("switch", { name: "Completed" })).toBeTruthy();
    render(<FilterNavWidget filter={{ id: "g", fieldId: "t" }} value="" fieldsById={fieldsById} onNav={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy();
  });
});
