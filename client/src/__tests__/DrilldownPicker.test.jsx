// Tests for DrilldownPicker — the rich-tile category-first path picker.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import DrilldownPicker from "../ui/DrilldownPicker";

const baseCtx = { sources: [], fields: [], localVars: [], modulesById: {}, occurrencesById: {}, fieldsById: {} };

describe("DrilldownPicker", () => {
  it("renders an empty placeholder when no value", () => {
    render(<DrilldownPicker value="" ctx={baseCtx} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /pick path/i })).toBeTruthy();
  });

  it("opens the level-1 category menu on click and shows all five categories", () => {
    render(<DrilldownPicker value="" ctx={baseCtx} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Occurrences")).toBeTruthy();
    expect(screen.getByText("Fields")).toBeTruthy();
    expect(screen.getByText("Local Variables")).toBeTruthy();
    expect(screen.getByText("Built-ins")).toBeTruthy();
  });

  it("each category row shows label AND description", () => {
    render(<DrilldownPicker value="" ctx={baseCtx} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    // Rich tile means the description text is visible alongside the label.
    expect(screen.getByText(/variables you bound from the trigger/i)).toBeTruthy();
    expect(screen.getByText(/collections of placements/i)).toBeTruthy();
  });

  it("renders a fluffed-out chip chain (no dots) when a value is set", () => {
    const value = "$everyOcc.fields.water.value";
    const ctx = { ...baseCtx, sources: [{ id: "s", variableName: "everyOcc", entityType: "allOccurrences" }] };
    const { container } = render(<DrilldownPicker value={value} ctx={ctx} onChange={() => {}} />);
    // No dot-form rendered as visible content (the title attribute may still hold it for hover).
    const visible = container.querySelector("[data-testid='picker-closed-chips']");
    expect(visible).toBeTruthy();
    expect(visible.textContent).not.toContain(".fields.water.");
    expect(visible.textContent).toContain("$everyOcc");
  });

  it("commits a chosen built-in scalar on click (level 2 leaf)", () => {
    const onChange = vi.fn();
    render(<DrilldownPicker value="" ctx={baseCtx} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    fireEvent.click(screen.getByText("Built-ins"));
    fireEvent.click(screen.getByText("$today"));
    expect(onChange).toHaveBeenCalledWith("$today");
  });

  it("supports stopping at a category-level item via the Pick this button", () => {
    const onChange = vi.fn();
    const ctx = {
      ...baseCtx,
      sources: [{ id: "s", variableName: "everyOcc", entityType: "allOccurrences" }],
    };
    render(<DrilldownPicker value="" ctx={ctx} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /pick path/i }));
    fireEvent.click(screen.getByText("Occurrences"));
    fireEvent.click(screen.getByTestId("pick-this-$everyOcc"));
    expect(onChange).toHaveBeenCalledWith("$everyOcc");
  });

  it("entity mode: level-1 swaps categories for a config-driven set", () => {
    const config = {
      placeholder: "Pick container",
      categories: [
        {
          id: "containers",
          label: "Containers",
          description: "List-kind containers",
          color: "rgba(34,197,94,0.7)",
          resolveItems: () => [
            { value: "c1", title: "Schedule", sub: "container", description: "Daily schedule", hasChildren: false },
            { value: "c2", title: "Physical", sub: "container", description: "Physical area",  hasChildren: false },
          ],
        },
        {
          id: "byLabel",
          label: "By Label",
          description: "Match by label string",
          color: "rgba(251,191,36,0.7)",
          resolveItems: () => [
            { value: "label:Schedule", title: "Match label = Schedule", sub: "label match", description: "Resolved at runtime", hasChildren: false },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    render(<DrilldownPicker value="" ctx={baseCtx} config={config} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /pick container/i }));
    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("By Label")).toBeTruthy();
    fireEvent.click(screen.getByText("Containers"));
    fireEvent.click(screen.getByText("Schedule"));
    expect(onChange).toHaveBeenCalledWith("c1");
  });
});
