// THE OPTIONS EDITOR SHOWED AN EMPTY QUERY FOR A FIELD THAT HAS ONE.
//
// Found on poms while widening `Schedule Type`'s options (2026-09-23). Opening
// the field's Find editor rendered NO rule rows and previewed **1548 matches**
// — the whole instance pool — for a field whose stored predicate matches 9.
// Pressing Save there would have written the empty predicate over the real one.
//
// `FindBody` reads `source?.find`, i.e. the NESTED shape. The live data is
// FLAT. Measured across every grid before fixing it:
//
//   find-mode fields 107  ·  FLAT 98  ·  nested 9
//   poms 48 flat / 2 nested      test grid 2  41 / 2
//
// So the editor was showing an empty query for 98 of 107 fields, and the
// resolver has handled BOTH shapes since 2026-05-17 (`const cfg = src.find ||
// src`) — the editor simply never learned the flat one. That split is also what
// hid the `fieldType` ReferenceError in the sibling test: only the flat shape
// reaches the fallback that threw.
//
// The fix reads the shape it was given and WRITES BACK THE SAME SHAPE, so a
// flat field stays flat. Converting on save would be a silent rewrite of 98
// fields the first time anyone opened them.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import SelectOptionsSourceEditor from "../ui/commandCenter/SelectOptionsSourceEditor.jsx";

vi.mock("../helpers/GridActionsContext", () => ({
  useGridActions: () => ({
    fieldsById: { f1: { id: "f1", name: "Board Category", type: "select" } },
    modulesById: {}, occurrencesById: {}, foldersById: {},
  }),
  GridActionsContext: React.createContext({}),
}));

const RULE = { left: "fields.f1.value", comparator: "CONTAINS", right: "appointment" };
const FLAT = {
  mode: "find", over: "$allInstances",
  predicate: { operator: "AND", rules: [RULE] },
  valuePath: "id", labelPath: "label",
  addNew: { parentOccurrenceId: "P1" },
};
const NESTED = {
  mode: "find",
  find: { over: "$allInstances", predicate: { operator: "AND", rules: [RULE] }, valuePath: "id", labelPath: "label" },
};

const inputValues = (c) => [...c.querySelectorAll("input")].map((i) => i.value);

describe("the find editor reads the shape the grid actually stores", () => {
  it("renders a FLAT source's existing rule — this is the empty-query bug", () => {
    const { container } = render(
      <SelectOptionsSourceEditor source={FLAT} onChange={() => {}} fieldType="occurrence" />,
    );
    expect(inputValues(container)).toContain("appointment");
  });

  // The control: the nested shape this editor itself writes must keep working,
  // or the fix trades one silently-empty editor for another.
  it("still renders a NESTED source's rule", () => {
    const { container } = render(
      <SelectOptionsSourceEditor source={NESTED} onChange={() => {}} fieldType="occurrence" />,
    );
    expect(inputValues(container)).toContain("appointment");
  });

  it("writes a flat source back FLAT, keeping its other keys", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SelectOptionsSourceEditor source={FLAT} onChange={onChange} fieldType="occurrence" />,
    );
    const limit = [...container.querySelectorAll("input")].find((i) => i.type === "number");
    fireEvent.change(limit, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.find, "a flat field was rewritten into the nested shape").toBeUndefined();
    expect(next.predicate.rules).toHaveLength(1);        // the real rule survived
    expect(next.addNew).toEqual({ parentOccurrenceId: "P1" });
  });

  it("writes a nested source back NESTED", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SelectOptionsSourceEditor source={NESTED} onChange={onChange} fieldType="occurrence" />,
    );
    const limit = [...container.querySelectorAll("input")].find((i) => i.type === "number");
    fireEvent.change(limit, { target: { value: "25" } });
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.find, "a nested field was flattened").toBeTruthy();
    expect(next.find.predicate.rules).toHaveLength(1);
  });
});
