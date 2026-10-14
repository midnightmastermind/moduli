// An occurrence dropdown builds its option list when you reach for it (user,
// 2026-10-14: "once you reach for the dropdown"). A phone load resolved 40
// dropdown fields twice each (1.28s) while every one of them was closed.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

const calls = [];
vi.mock("../helpers/optionsResolver", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveOptions: (field, ...rest) => { calls.push(field.id); return actual.resolveOptions(field, ...rest); } };
});

import FieldRenderer from "../ui/FieldRenderer";

const find = { mode: "find", over: "$allInstances", predicate: { rules: [] }, valuePath: "id", labelPath: "label" };
const occField = { id: "f-occ", type: "occurrence", name: "Beverage", inputEnabled: true, meta: { optionsSource: find } };
const rollField = { ...occField, id: "f-roll", meta: { ...occField.meta, randomizable: true } };
const selField = { id: "f-sel", type: "select", name: "Kind", inputEnabled: true, meta: { optionsSource: find } };

const coffeeMod = { id: "m-coffee", role: "instance", label: "Coffee" };
const coffee = { id: "o-coffee", moduleId: "m-coffee" };
const host = (fid) => ({ id: "o1", moduleId: "m1", fields: { [fid]: { value: "o-coffee" } } });

function mount(field) {
  const occ = host(field.id);
  const occs = { o1: occ, "o-coffee": coffee };
  const mods = { m1: { id: "m1", role: "instance", label: "Row" }, "m-coffee": coffeeMod };
  const ctx = {
    dispatch: vi.fn(), socket: { emit: vi.fn() }, gridId: "g1", userId: "u1",
    occurrencesById: occs, modulesById: mods, fieldsById: { [field.id]: field },
    foldersById: {}, operationsById: {}, state: { grid: {}, occurrences: Object.values(occs) },
    getOccMap: () => occs, getModMap: () => mods,
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldRenderer field={field} occurrence={occ} compact />
    </GridActionsContext.Provider>
  );
}

describe("occurrence dropdown options resolve on reach", () => {
  beforeEach(() => { calls.length = 0; });

  it("a closed occurrence dropdown resolves nothing, and still shows its pick", () => {
    const { container } = mount(occField);
    expect(calls).toEqual([]);
    expect(container.textContent).toContain("Coffee");
  });

  it("hovering it resolves the list", () => {
    const { container } = mount(occField);
    fireEvent.pointerEnter(container.firstChild);
    expect(calls).toContain("f-occ");
  });

  it("pressing or focusing it resolves the list", () => {
    const a = mount(occField);
    fireEvent.pointerDown(a.container.firstChild.querySelector("*") || a.container.firstChild);
    expect(calls).toContain("f-occ");
    a.unmount(); calls.length = 0;
    const b = mount(occField);
    fireEvent.focus(b.container.firstChild.querySelector("button") || b.container.firstChild);
    expect(calls).toContain("f-occ");
  });

  it("controls: a re-rollable occurrence field and a select still resolve up front", () => {
    mount(rollField);
    expect(calls).toContain("f-roll");
    calls.length = 0;
    mount(selField);
    expect(calls).toContain("f-sel");
  });
});
