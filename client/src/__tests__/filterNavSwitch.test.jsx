// A true/false filter in the filter menu is a SWITCH, not two "true"/"false" pills that start
// with neither picked (user, 2026-10-13, on the Schedule page's Combine Schedule filter).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterNavWidget, { defaultStyleForFilter } from "../ui/FilterNavWidgets";

const fieldsById = { fB: { id: "fB", name: "Combine Schedule", type: "boolean" } };
const filter = { id: "flt", fieldId: "fB" };

describe("boolean filter nav", () => {
  it("defaults to a switch", () => {
    expect(defaultStyleForFilter(filter, fieldsById)).toBe("switch");
  });
  it("an unset value reads OFF, and clicking writes true", () => {
    const onNav = vi.fn();
    render(<FilterNavWidget filter={filter} value={undefined} fieldsById={fieldsById} onNav={onNav} />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onNav).toHaveBeenCalledWith(true);
  });
  it("on reads ON, and clicking writes false", () => {
    const onNav = vi.fn();
    render(<FilterNavWidget filter={filter} value={true} fieldsById={fieldsById} onNav={onNav} />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onNav).toHaveBeenCalledWith(false);
  });
  it("an author-pinned style still wins", () => {
    expect(defaultStyleForFilter({ ...filter, style: "pills" }, fieldsById)).toBe("pills");
  });
});
