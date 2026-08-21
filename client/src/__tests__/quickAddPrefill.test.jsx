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
// The value step renders REAL `Field` controls — the same components a row uses —
// so the inputs are whatever those emit. The hidden file input the artifact tile
// mounts is excluded, or it would be the first "input" on the page.
const valueInputs = () => [...document.querySelectorAll("input, select, textarea")]
  .filter(el => el.type !== "file");

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

describe("selected fields sort to the top of the picker", () => {
  // The helper has its own tests; this one asserts the COMPONENT uses it.
  // Without it, removing `selectedFirst` from the render passed every helper
  // test — the inert-call-site class.
  // The INPUT section only — the Display section renders above it and would
  // otherwise be the first row whatever the sort does.
  const inputNames = Object.values(FIELDS).filter(f => !f.displayEnabled).map(f => f.name);
  const order = () => [...document.querySelectorAll("button")]
    .map(b => b.textContent).filter(t => inputNames.some(n => t.startsWith(n)));

  it("a LATE-alphabet ticked field renders before an early unticked one", () => {
    store.fieldsById = FIELDS;
    store.modulesById = { ...MODULES,
      "m-z": { id: "m-z", role: "instance", fieldBindings: [{ fieldId: "unused", role: "input" }] } };
    store.occurrencesById = { host: { id: "host", occurrences: ["k0"] }, k0: { id: "k0", moduleId: "m-z" } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    const o = order();
    expect(o[0]).toContain("Zebra");                    // ticked, last alphabetically
    expect(o.findIndex(t => t.startsWith("Calories"))).toBeGreaterThan(0);
  });

  it("with nothing ticked the list stays alphabetical — the control", () => {
    store.fieldsById = FIELDS;
    store.modulesById = MODULES;
    store.occurrencesById = { host: { id: "host", occurrences: [] } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(order()[0]).toContain("Calories");
  });
});

describe("the value sub-step", () => {
  it("offers 'Values →' only when something can actually be typed", () => {
    // A step that opens empty is a dead end, so the button is conditional.
    mount({ children: ["m-ing"] });                 // cal/protein are numbers
    expect(screen.getByText("Values →")).toBeTruthy();
  });

  it("does NOT offer it when every picked field is a display field", () => {
    store.fieldsById = { total: FIELDS.total };
    store.modulesById = { "m-d": { id: "m-d", role: "instance",
      fieldBindings: [{ fieldId: "total", role: "display" }] } };
    store.occurrencesById = { host: { id: "host", occurrences: ["k"] }, k: { id: "k", moduleId: "m-d" } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(screen.queryByText("Values →")).toBeNull();
  });

  it("carries typed values to onCreateNew as initialFields", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Values →"));
    const inputs = valueInputs();
    expect(inputs.length).toBeGreaterThan(0);
    fireEvent.change(inputs[0], { target: { value: "150" } });
    // `Field` commits on blur/Enter, not on every keystroke — the same debounce
    // a row uses. Firing only `change` asserts nothing about the commit path.
    fireEvent.blur(inputs[0]);
    fireEvent.click(screen.getByText("Create"));
    const arg = onCreateNew.mock.calls[0][0];
    expect(arg.initialFields).toEqual({ cal: { value: 150, flow: "in" } });
    // Bindings still ride along — the value step ADDS to the pick, it does not
    // replace it.
    expect(arg.fieldIds).toEqual(["cal", "protein", "total"]);
  });

  it("a field TYPED INTO AND THEN CLEARED contributes nothing", () => {
    // Deliberately not "an untouched field": an untouched one never enters the
    // value map at all, so that version passed with the empty-value guard
    // deleted and proved nothing. Typing then clearing puts a "" in the map and
    // is the only shape that exercises the guard.
    const { onCreateNew } = mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Values →"));
    const input = valueInputs()[0];
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateNew.mock.calls[0][0].initialFields).toEqual({});
  });

  it("shows only the typeable fields — the display one is bound but not typed", () => {
    mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Values →"));
    expect(screen.getByText(/Set values \(2 fields\)/)).toBeTruthy();   // cal + protein, not total
  });

  it("Back returns to the field picker with the picks intact", () => {
    mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Values →"));
    fireEvent.click(screen.getByText(/Back/));
    expect(tickedCount()).toBe(3);
  });
});
