// "THERE SHOULD BE NO HIDDEN SETTING" (2026-10-05), applied to two field keys
// found while rebuilding poms' fields by clicking (2026-10-07):
//
//   meta.optionsSource.addNew   45 poms fields — where "+ Add new" puts a new
//                               option and which fields it asks for. Read by
//                               Field.jsx; no editor wrote it, so every
//                               occurrence field made in the UI had no add row.
//   meta.placeholder            5 poms fields (Notes, Answer, Cover, Workout,
//                               Activity). Read by a markdown textarea and a
//                               bound body's editor; no editor wrote it.
//
// Each case asserts what LEAVES the component, not that a control rendered.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import SelectOptionsSourceEditor, { planAddNew } from "../ui/commandCenter/SelectOptionsSourceEditor.jsx";
import { FieldDetail } from "../ui/commandCenter/FieldsTab";

const ctx = {
  dispatch: vi.fn(), socket: null, roleByModuleId: {}, state: { grid: {} },
  fieldsById: { f1: { id: "f1", name: "Amount", type: "number" } },
  modulesById: { m1: { id: "m1", role: "container", label: "Bills" } },
  occurrencesById: { c1: { id: "c1", moduleId: "m1" } },
  foldersById: {},
};
const wrap = (ui) => render(<GridActionsContext.Provider value={ctx}>{ui}</GridActionsContext.Provider>);

describe("planAddNew — the stored shape", () => {
  it("reads a legacy parentOccurrenceId and writes it back as targets", () => {
    expect(planAddNew({ parentOccurrenceId: "c1" }, { fieldIds: ["f1"] }))
      .toEqual({ targets: ["c1"], fieldIds: ["f1"] });
  });
  it("keeps keys it does not author (stampFields)", () => {
    const stamp = { b: { value: "book", flow: "in" } };
    expect(planAddNew({ parentOccurrenceId: "c1", stampFields: stamp }, { hidden: true }))
      .toEqual({ targets: ["c1"], stampFields: stamp, hidden: true });
  });
  it("no destination left -> no addNew at all (an add row that cannot add is worse than none)", () => {
    expect(planAddNew({ targets: ["c1"], fieldIds: ["f1"] }, { targets: [] })).toBeUndefined();
  });
  it("drops an empty field list and a false hidden", () => {
    expect(planAddNew({ targets: ["c1"], fieldIds: ["f1"], hidden: true }, { fieldIds: [], hidden: false }))
      .toEqual({ targets: ["c1"] });
  });
});

describe("the Add new section in the options editor", () => {
  const src = { mode: "manual", values: [], addNew: { parentOccurrenceId: "c1", fieldIds: ["f1"] } };
  it("shows the stored destination and asked field on an occurrence field", () => {
    wrap(<SelectOptionsSourceEditor source={src} onChange={vi.fn()} fieldType="occurrence" />);
    expect(screen.getByLabelText("Destination 1").textContent).toMatch(/Bills/);
    expect(screen.getByLabelText("Asked field 1").textContent).toMatch(/Amount/);
  });
  it("removing the only destination writes addNew away", () => {
    const onChange = vi.fn();
    wrap(<SelectOptionsSourceEditor source={src} onChange={onChange} fieldType="occurrence" />);
    fireEvent.click(screen.getByTitle("Remove destination"));
    expect(onChange.mock.calls.at(-1)[0].addNew).toBeUndefined();
  });
  it("ticking 'hidden rows' writes addNew.hidden", () => {
    const onChange = vi.fn();
    wrap(<SelectOptionsSourceEditor source={src} onChange={onChange} fieldType="occurrence" />);
    fireEvent.click(screen.getByLabelText(/New options are hidden rows/));
    expect(onChange.mock.calls.at(-1)[0].addNew).toEqual({ targets: ["c1"], fieldIds: ["f1"], hidden: true });
  });
  it("CONTROL — a select field has no Add new section (an add mints a ROW)", () => {
    wrap(<SelectOptionsSourceEditor source={{ mode: "manual", values: [] }} onChange={vi.fn()} fieldType="select" />);
    expect(screen.queryByText(/Add new" puts new options in/)).toBeNull();
  });
});

describe("the placeholder box in the field editor", () => {
  const saved = (fn) => fn.mock.calls.at(-1)[0];
  it("writes meta.placeholder on a text field", () => {
    const onSave = vi.fn();
    wrap(<FieldDetail field={{ id: "x", name: "Notes", type: "text", meta: {} }} onSave={onSave} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Placeholder"), { target: { value: "Add notes..." } });
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.placeholder).toBe("Add notes...");
  });
  it("shows a stored placeholder", () => {
    wrap(<FieldDetail field={{ id: "x", name: "Answer", type: "markdown", meta: { placeholder: "Write your answer..." } }} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByLabelText("Placeholder").value).toBe("Write your answer...");
  });
  it("CONTROL — a number field has no placeholder box", () => {
    wrap(<FieldDetail field={{ id: "x", name: "Steps", type: "number", meta: {} }} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByLabelText("Placeholder")).toBeNull();
  });
});
