// A picker that HOLDS a value must reopen when its value is clicked.
//
// The closed state rendered its chips with no handler: the only way back into
// the menu was × -> the "+ placeholder" button -> open. FIND's "Look in"
// converts a cleared value straight back to "$allOccurrences", so the
// placeholder never appears — a FIND's collection could not be changed in the
// UI at all. Measured 2026-09-28: 143 of 174 live FIND steps (33 ops) look in
// $allContainers / $allInstances / $allPages, every one seed-written.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import DrilldownPicker from "../ui/DrilldownPicker.jsx";
import { COLLECTION_PICKER_CONFIG } from "../ui/categoryRegistry";

const rows = () => [...document.querySelectorAll("button")].map((b) => (b.innerText || b.textContent || "").split("\n")[0].trim());

describe("a picker holding a value reopens when the value is clicked", () => {
  it("clicking the chosen value opens the menu", () => {
    const { getByTestId } = render(<DrilldownPicker value="$allOccurrences" onChange={vi.fn()} ctx={{}} config={COLLECTION_PICKER_CONFIG} />);
    expect(rows().some((t) => t.includes("$allContainers"))).toBe(false);
    fireEvent.click(getByTestId("picker-closed-chips"));
    expect(rows().some((t) => t.includes("$allContainers"))).toBe(true);
  });
  it("× clears without opening the menu", () => {
    const onChange = vi.fn();
    const { getByTitle } = render(<DrilldownPicker value="$allOccurrences" onChange={onChange} ctx={{}} config={COLLECTION_PICKER_CONFIG} />);
    fireEvent.click(getByTitle("Clear path"));
    expect(onChange).toHaveBeenCalled();
    expect(rows().some((t) => t.includes("$allContainers"))).toBe(false);
  });
});
