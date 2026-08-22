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
// The controls live on the picker rows now, so the field SEARCH box has to be
// excluded too — it is an <input> on the same screen and would otherwise be
// the first one found, making every assertion below about the wrong element.
const valueInputs = () => [...document.querySelectorAll("input, select, textarea")]
  .filter(el => el.type !== "file" && el.placeholder !== "Search fields\u2026");

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

describe("three sections: Selected, then Input, then Display", () => {
  // User, 2026-08-22: *"put the selected fields first, then input fields and
  // then display fields."* Ticked fields used to sort to the top WITHIN each
  // section, which left them split across two captions and — on a grid with
  // ~99 display fields — put the ones you can type into below the fold.
  const captions = () => [...document.querySelectorAll("div")]
    .map(d => d.textContent)
    .filter(t => t === "Selected" || t === "Input" || t === "Display");

  it("renders the three captions in that order", () => {
    // `total` is the fixture's only display field and the siblings BIND it, so
    // a Display caption needs one more display field that nobody binds — with
    // FIELDS alone the section is legitimately empty and correctly omitted.
    // (That is what the first version of this test got wrong: it asserted a
    // caption the fixture could not produce, and read as a code failure.)
    store.fieldsById = { ...FIELDS, spare: { id: "spare", name: "Spare", type: "number", displayEnabled: true } };
    store.modulesById = MODULES;
    store.occurrencesById = {
      host: { id: "host", occurrences: ["k0", "k1"] },
      k0: { id: "k0", moduleId: "m-ing" }, k1: { id: "k1", moduleId: "m-other" },
    };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(captions()).toEqual(["Selected", "Input", "Display"]);
  });

  it("a ticked DISPLAY field leaves the Display section for Selected", () => {
    // `total` is the only display field bound by the siblings. If sections were
    // still split by role it would head the Display caption; here Display holds
    // nothing at all and is omitted.
    store.fieldsById = { cal: FIELDS.cal, total: FIELDS.total };
    store.modulesById = MODULES;
    store.occurrencesById = { host: { id: "host", occurrences: ["k0"] }, k0: { id: "k0", moduleId: "m-ing" } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(captions()).toEqual(["Selected"]);
  });

  it("with nothing ticked there is no Selected section — the control", () => {
    // Without this the first test could be measuring a picker that always
    // prints three captions, which looks identical on a populated container.
    mount({ children: [] });
    expect(captions()).toEqual(["Input", "Display"]);
  });

  it("omits a section that has nothing in it", () => {
    store.fieldsById = { cal: FIELDS.cal };            // no display fields at all
    store.modulesById = MODULES;
    store.occurrencesById = { host: { id: "host", occurrences: [] } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(captions()).toEqual(["Input"]);
  });

  it("inside Selected, input fields come before display ones", () => {
    // The same preference the three sections express, applied one level down:
    // `total` sorts before `cal` alphabetically and must still render after it.
    mount({ children: ["m-ing"] });
    const names = [...document.querySelectorAll("button")]
      .map(b => b.textContent).filter(t => /^(Calories|Protein|Total)/.test(t));
    expect(names.map(t => t.replace(/(number|text).*$/, "").trim()))
      .toEqual(["Calories", "Protein", "Total"]);
  });

  it("a LATE-alphabet ticked field renders before an early unticked one", () => {
    store.fieldsById = FIELDS;
    store.modulesById = { ...MODULES,
      "m-z": { id: "m-z", role: "instance", fieldBindings: [{ fieldId: "unused", role: "input" }] } };
    store.occurrencesById = { host: { id: "host", occurrences: ["k0"] }, k0: { id: "k0", moduleId: "m-z" } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    const names = [...document.querySelectorAll("button")]
      .map(b => b.textContent).filter(t => /^(Zebra|Calories)/.test(t));
    expect(names[0]).toContain("Zebra");   // ticked, last alphabetically
  });
});

describe("values are typed IN the field selection, not on a second screen", () => {
  // User, 2026-08-22: *"just seed the fields themselves so they are at the top
  // of the fields selection for that new occurance ... and being able to enter
  // my own values in that field selection (using the appropriate inputs)"*.
  // The separate "Values →" step is gone; a ticked typeable field carries its
  // own control on its own row.

  it("has no 'Values →' step any more", () => {
    mount({ children: ["m-ing"] });
    expect(screen.queryByText("Values \u2192")).toBeNull();
  });

  it("a ticked typeable field renders an input on its row", () => {
    mount({ children: ["m-ing"] });      // cal + protein ticked and typeable
    expect(valueInputs().length).toBe(2);
  });

  it("unticking one removes its input — the control", () => {
    // Without this, the test above could be counting inputs the picker renders
    // for EVERY field, which looks identical when everything is ticked.
    mount({ children: ["m-ing"] });
    fireEvent.click(screen.getByText("Protein"));
    expect(valueInputs().length).toBe(1);
  });

  it("a ticked DISPLAY field gets no input — an op writes it", () => {
    store.fieldsById = { total: FIELDS.total };
    store.modulesById = { "m-d": { id: "m-d", role: "instance",
      fieldBindings: [{ fieldId: "total", role: "display" }] } };
    store.occurrencesById = { host: { id: "host", occurrences: ["k"] }, k: { id: "k", moduleId: "m-d" } };
    const utils = render(<QuickAddMenu targetRole="instance" onCreateNew={vi.fn()}
      hostOccurrence={store.occurrencesById.host} />);
    fireEvent.click(utils.container.querySelector("button"));
    fireEvent.click(screen.getByText("Item"));
    expect(tickedCount()).toBe(1);       // it IS ticked...
    expect(valueInputs().length).toBe(0); // ...and still has nothing to type into
  });

  it("every input starts EMPTY — the fields are inherited, the values never are", () => {
    // The seeding question was asked and answered: fields come from the
    // siblings, values are always the user's to type. A future change that
    // pre-fills from a sibling fails here.
    mount({ children: ["m-ing"] });
    const inputs = valueInputs();
    // The control comes FIRST: a for-loop over an empty list passes trivially,
    // which would make this test green against a picker that renders no inputs
    // at all — the exact shape of a vacuous assertion.
    expect(inputs.length).toBe(2);
    for (const el of inputs) expect(el.value).toBe("");
  });

  it("carries typed values to onCreateNew as initialFields", () => {
    const { onCreateNew } = mount({ children: ["m-ing"] });
    const input = valueInputs()[0];
    fireEvent.change(input, { target: { value: "150" } });
    // `Field` commits on blur/Enter, not on every keystroke — the same debounce
    // a row uses. Firing only `change` asserts nothing about the commit path.
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Create"));
    const arg = onCreateNew.mock.calls[0][0];
    expect(arg.initialFields).toEqual({ cal: { value: 150, flow: "in" } });
    // Bindings still ride along — typing ADDS to the pick, it does not replace it.
    expect(arg.fieldIds).toEqual(["cal", "protein", "total"]);
  });

  it("a field TYPED INTO AND THEN CLEARED contributes nothing", () => {
    // Deliberately not "an untouched field": an untouched one never enters the
    // value map at all, so that version passed with the empty-value guard
    // deleted and proved nothing. Typing then clearing puts a "" in the map and
    // is the only shape that exercises the guard.
    const { onCreateNew } = mount({ children: ["m-ing"] });
    const input = valueInputs()[0];
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateNew.mock.calls[0][0].initialFields).toEqual({});
  });

  it("typing does not untick the field being filled in", () => {
    // The row used to be one <button>; an <input> nested in a button is invalid
    // and a click into the control would toggle the pick out from under you.
    const { onCreateNew } = mount({ children: ["m-ing"] });
    const input = valueInputs()[0];
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);
    expect(tickedCount()).toBe(3);
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateNew.mock.calls[0][0].initialFields).toEqual({ cal: { value: 42, flow: "in" } });
  });
});
