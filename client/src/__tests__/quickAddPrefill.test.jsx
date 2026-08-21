// The field picker opens ALREADY WEARING what the destination's rows wear.
//
// User, 2026-08-21: *"so if i have add an ingrediant, it already has all those
// fields set"* — and *"i need the display and then input fields seperated by
// section"*.
//
// THIS FILE TESTS THE COMPONENT, NOT THE HELPER. `siblingFieldBindings` has its
// own suite; what breaks silently is the WIRING — the picker seeding itself, the
// roles surviving to `onCreateNew`, and the two sections rendering. A helper that
// returns the right answer into a component that never asks is the inert-call-site
// class this repo has paid for four sessions running.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const store = {
  modulesById: {}, socket: null, manifestsById: {}, foldersById: {},
  fieldsById: {}, state: { grid: { _id: "g1" }, gridId: "g1" },
  getOccMap: () => store.occurrencesById || {},
  occurrencesById: {},
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel(store),
  useGridActions: () => store,
}));
vi.mock("../ui/ImagePickerMenu.jsx", () => ({ openImagePicker: vi.fn(), default: () => null }));

import QuickAddMenu from "../ui/QuickAddMenu.jsx";

const FIELDS = {
  cal:     { id: "cal",     name: "Calories", type: "number", displayEnabled: false },
  protein: { id: "protein", name: "Protein",  type: "number", displayEnabled: false },
  iron:    { id: "iron",    name: "Iron",     type: "number", displayEnabled: false },
  total:   { id: "total",   name: "Total",    type: "number", displayEnabled: true },
  unused:  { id: "unused",  name: "Zebra",    type: "text",   displayEnabled: false },
};
const MODULES = {
  "m-ing": { id: "m-ing", role: "instance", fieldBindings: [
    { fieldId: "cal", role: "input" }, { fieldId: "protein", role: "input" },
    { fieldId: "total", role: "display" }] },
  "m-other": { id: "m-other", role: "instance", fieldBindings: [{ fieldId: "iron", role: "input" }] },
};

function mount({ children = [], onCreateNew = vi.fn() } = {}) {
  store.fieldsById = FIELDS;
  store.modulesById = MODULES;
  store.occurrencesById = {
    host: { id: "host", occurrences: children.map((_, i) => `k${i}`) },
    ...Object.fromEntries(children.map((moduleId, i) => [`k${i}`, { id: `k${i}`, moduleId }])),
  };
  const utils = render(
    <QuickAddMenu targetRole="instance" onCreateNew={onCreateNew}
      hostOccurrence={store.occurrencesById.host} />);
  fireEvent.click(utils.container.querySelector("button"));   // open the menu
  fireEvent.click(screen.getByText("Item"));                  // → the field picker
  return { onCreateNew, ...utils };
}
const tickedCount = () => Number(/\((\d+) selected\)/.exec(screen.getByText(/selected\)/).textContent)[1]);

beforeEach(() => { store.occurrencesById = {}; });

describe("the field picker seeds itself from the destination", () => {
  it("opens with the siblings' fields already ticked", () => {
    mount({ children: ["m-ing", "m-other"] });
    expect(tickedCount()).toBe(4);   // cal, protein, total, iron
  });

  it("opens with NOTHING ticked in an empty container — the control", () => {
    // Without this the first test could be measuring a picker that ticks
    // everything, which would look identical on a populated board.
    mount({ children: [] });
    expect(tickedCount()).toBe(0);
  });

  it("carries each binding's ROLE through to onCreateNew", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Create"));
    const arg = onCreateNew.mock.calls[0][0];
    expect(arg.fieldIds).toEqual(["cal", "protein", "total"]);
    expect(arg.fieldBindings).toEqual([
      { fieldId: "cal", role: "input" },
      { fieldId: "protein", role: "input" },
      { fieldId: "total", role: "display" },   // NOT flattened to input
    ]);
  });

  it("a field the user ticks by hand defaults to input", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Zebra"));
    fireEvent.click(screen.getByText("Create"));
    const arg = onCreateNew.mock.calls[0][0];
    expect(arg.fieldBindings).toContainEqual({ fieldId: "unused", role: "input" });
  });

  it("unticking a prefilled field drops it", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Protein"));
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateNew.mock.calls[0][0].fieldIds).toEqual(["cal", "total"]);
  });

  it("Skip still creates a bare item", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Skip"));
    expect(onCreateNew).toHaveBeenCalledWith({ fieldIds: [] });
  });
});

describe("display and input are separate sections", () => {
  it("renders both captions, display first", () => {
    mount({ children: ["m-ing"] });
    const captions = [...document.querySelectorAll("div")]
      .map(d => d.textContent)
      .filter(t => t === "Display" || t === "Input");
    expect(captions[0]).toBe("Display");
    expect(captions).toContain("Input");
  });

  it("omits a section that has nothing in it", () => {
    store.fieldsById = { cal: FIELDS.cal };            // no display fields at all
    store.modulesById = MODULES;
    store.occurrencesById = { host: { id: "host", occurrences: [] } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(screen.queryByText("Display")).toBeNull();
    expect(screen.getByText("Input")).toBeTruthy();
  });
});
