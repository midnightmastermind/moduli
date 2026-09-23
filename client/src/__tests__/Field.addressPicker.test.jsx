// PICKING AN ADDRESS HAS TO STORE THE ADDRESS.
//
// Found on prod 2026-09-22 by creating an `address` field through the Fields
// tab, binding it to a row, and searching the picker for a real place. The
// search worked; clicking the result wrote a cell with NO VALUE:
//
//     fields["<Location>"]  ->  { "flow": "in" }
//
// The branch did `handleChange(loc); handleCommit(loc);`. `handleCommit` takes
// NO PARAMETERS — it reads `localValue` out of its own closure — so the `loc`
// argument was ignored, and because `setLocalValue` had not landed yet in the
// same tick it committed the previous (empty) value.
//
// WIDENING `handleCommit` IS NOT THE FIX, and that is the load-bearing reason
// this lives at the call site: EIGHT inputs pass `handleCommit` straight to
// `onBlur`, where the first argument is a React SyntheticEvent. A positional
// value parameter would commit the event object as the field's value on every
// blur — a far worse bug than the one being fixed.
//
// Corroboration from the database, which is suggestive rather than proof:
// across every grid, all 22 stored address values were written by SEEDS (bulk
// timestamps milliseconds apart, plain strings). The only entry the picker
// itself ever wrote is the valueless one above.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

vi.mock("../ui/AddressPickerMenu", () => ({
  openAddressPicker: vi.fn(),
  AddressPickerHost: () => null,
}));
import { openAddressPicker } from "../ui/AddressPickerMenu";

import Field from "../ui/Field";

const HOST_OCC = { id: "o-task", moduleId: "m-task", fields: {} };
const MAPS = {
  occurrencesById: { "o-task": HOST_OCC },
  modulesById: { "m-task": { id: "m-task", label: "Email Sam", fieldBindings: [{ fieldId: "f-loc" }] } },
  fieldsById: {},
};

function renderWithCtx(node) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    ...MAPS, operationsById: {},
    getOccMap: () => MAPS.occurrencesById,
    state: { grid: {} },
  };
  return render(<GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>);
}

const locField = { id: "f-loc", type: "address", name: "Location", inputEnabled: true, meta: {} };
const PICKED = {
  label: "Milwaukee Public Market",
  address: "400 North Water Street, Downtown, Milwaukee, WI",
  lat: 43.0353, lon: -87.9081, osmId: "n123",
};

beforeEach(() => { openAddressPicker.mockClear(); });

describe("Field — the address picker commits what was picked", () => {
  it("passes the picked location to onCommit", () => {
    const onCommit = vi.fn();
    const { container } = renderWithCtx(
      <Field field={locField} value={null} hostOccurrence={HOST_OCC} onCommit={onCommit} />
    );
    fireEvent.click(container.querySelector("button"));
    expect(openAddressPicker).toHaveBeenCalledTimes(1);

    // the picker hands the chosen place back through onPick
    openAddressPicker.mock.calls[0][0].onPick(PICKED);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0][0];
    expect(committed).toBeTruthy();                       // NOT undefined — the defect
    expect(committed.label).toBe("Milwaukee Public Market");
    expect(committed.lat).toBeCloseTo(43.0353, 4);
  });

  it("commits the NEW pick, not the value the field already held", () => {
    // The stale-closure case stated directly: with a previous value present,
    // the broken version committed THAT instead of the new pick.
    const onCommit = vi.fn();
    const previous = { label: "Old Place", address: "1 Old St", lat: 1, lon: 2, osmId: "n1" };
    const { container } = renderWithCtx(
      <Field field={locField} value={previous} hostOccurrence={HOST_OCC} onCommit={onCommit} />
    );
    fireEvent.click(container.querySelector("button"));
    openAddressPicker.mock.calls[0][0].onPick(PICKED);
    expect(onCommit.mock.calls[0][0].label).toBe("Milwaukee Public Market");
    expect(onCommit.mock.calls[0][0].label).not.toBe("Old Place");
  });

  it("seeds the search from the row's name (the documented convenience)", () => {
    renderWithCtx(<Field field={locField} value={null} hostOccurrence={HOST_OCC} onCommit={vi.fn()} />);
    // control: the behaviour observed on prod, kept so the fix does not remove it
    const { container } = renderWithCtx(
      <Field field={locField} value={null} hostOccurrence={HOST_OCC} onCommit={vi.fn()} />
    );
    fireEvent.click(container.querySelector("button"));
    expect(openAddressPicker.mock.calls.at(-1)[0].query).toBe("Email Sam");
  });

  it("a cleared pick (null) still reaches onCommit", () => {
    // "Remove the address" is a real gesture; it must not be swallowed.
    const onCommit = vi.fn();
    const { container } = renderWithCtx(
      <Field field={locField} value={PICKED} hostOccurrence={HOST_OCC} onCommit={onCommit} />
    );
    fireEvent.click(container.querySelector("button"));
    openAddressPicker.mock.calls[0][0].onPick(null);
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});

describe("handleCommit must stay parameterless", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../ui/Field.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is still declared with no parameters", () => {
    // Eight inputs pass it to onBlur. If it ever takes a positional value, a
    // blur commits a SyntheticEvent as the field's value.
    expect(code).toMatch(/const handleCommit = useCallback\(\(\) =>/);
  });

  it("is never called with an argument", () => {
    const calls = [...code.matchAll(/handleCommit\(([^)]*)\)/g)].map(m => m[1].trim());
    expect(calls.filter(a => a !== "")).toEqual([]);
  });

  it("onBlur still uses it (control — the parameterless contract is load-bearing)", () => {
    expect(code.match(/onBlur=\{handleCommit\}/g)?.length).toBeGreaterThan(4);
  });
});
