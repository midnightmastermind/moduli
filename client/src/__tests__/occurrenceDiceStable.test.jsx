// An occurrence dropdown resolves its list when you reach for it (2026-10-14), and the 🎲 segment used to
// appear only then — so the pill grew at the moment you touched it. On a phone the wider pill reflowed its
// line and the tap's click landed on whatever was now under the finger: Meal's list never opened on the
// first tap (2026-11-04 UI sweep, measured on prod). The dice keeps its place from the start.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import FieldRenderer from "../ui/FieldRenderer";

const find = { mode: "find", over: "$allInstances", predicate: { rules: [{ left: "fields.f-kind.value", comparator: "IS", right: "meal" }] }, valuePath: "id", labelPath: "label" };
const field = { id: "f-meal", type: "occurrence", name: "Meal", inputEnabled: true, meta: { optionsSource: find } };

function mount(nMeals) {
  const occs = { o1: { id: "o1", moduleId: "m1", fields: {} } };
  const mods = { m1: { id: "m1", role: "instance", label: "Row" } };
  for (let i = 0; i < nMeals; i++) {
    mods[`mm${i}`] = { id: `mm${i}`, role: "instance", label: `Meal ${i}` };
    occs[`om${i}`] = { id: `om${i}`, moduleId: `mm${i}`, fields: { "f-kind": { value: "meal" } } };
  }
  const ctx = {
    dispatch: vi.fn(), socket: { emit: vi.fn() }, gridId: "g1", userId: "u1",
    occurrencesById: occs, modulesById: mods, fieldsById: { [field.id]: field },
    foldersById: {}, operationsById: {}, state: { grid: {}, occurrences: Object.values(occs) },
    getOccMap: () => occs, getModMap: () => mods,
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldRenderer field={field} occurrence={occs.o1} compact />
    </GridActionsContext.Provider>
  );
}
const dice = (c) => c.querySelector('button[title="Pick random"]');

describe("an occurrence pill's 🎲 does not appear under the pointer", () => {
  it("is drawn before the list is reached", () => {
    const { container } = mount(3);
    expect(dice(container)).toBeTruthy();
  });

  it("is still there once reached, and picks from the resolved list", () => {
    const { container } = mount(3);
    fireEvent.pointerEnter(container.firstChild);
    expect(dice(container)).toBeTruthy();
  });

  it("goes away once reached if there is nothing to choose between — the control", () => {
    const { container } = mount(1);
    fireEvent.pointerEnter(container.firstChild);
    expect(dice(container)).toBeNull();
  });
});
