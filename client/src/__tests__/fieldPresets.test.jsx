// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../helpers/CommitHelpers", () => ({ updateGrid: vi.fn() }));
vi.mock("../ui/Field.jsx", () => ({ default: () => null }));

import * as CommitHelpers from "../helpers/CommitHelpers";
import { presetsOf, presetFromPick, withPreset, withoutPreset, applyPreset, orderPresets, writePresets } from "../helpers/fieldPresets";
import FieldPickerPanel from "../ui/FieldPickerPanel.jsx";

const fieldsById = {
  f1: { id: "f1", name: "Movement", type: "text" },
  f2: { id: "f2", name: "Weight", type: "number" },
  f3: { id: "f3", name: "Gone", type: "text", trashed: true },
};

describe("fieldPresets", () => {
  it("keeps values only for ticked, filled-in fields", () => {
    const p = presetFromPick({ name: " Workout ", fieldIds: ["f1", "f2", "f1"], values: { f1: "Squat", f2: "", f9: "x" } });
    expect(p.name).toBe("Workout");
    expect(p.fieldIds).toEqual(["f1", "f2"]);
    expect(p.values).toEqual({ f1: "Squat" });
  });

  it("saving under an existing name replaces it and keeps its id", () => {
    const a = { id: "a", name: "Workout", fieldIds: ["f1"], values: {} };
    const next = withPreset([a], { id: "new", name: "workout", fieldIds: ["f1", "f2"], values: {} });
    expect(next).toEqual([{ id: "a", name: "workout", fieldIds: ["f1", "f2"], values: {} }]);
    expect(withPreset([a], { id: "b", name: "Meal", fieldIds: [], values: {} }).map((p) => p.id)).toEqual(["a", "b"]);
    expect(withoutPreset([a], "a")).toEqual([]);
  });

  it("applying drops fields deleted since", () => {
    expect(applyPreset({ fieldIds: ["f1", "f3"], values: { f1: "Squat", f3: "x" } }, fieldsById))
      .toEqual({ fieldIds: ["f1"], values: { f1: "Squat" } });
  });

  it("presets that fit what this container's rows wear come first", () => {
    const list = [{ id: "z", name: "Alpha", fieldIds: ["f9"] }, { id: "y", name: "Workout", fieldIds: ["f1", "f2"] }];
    expect(orderPresets(list, ["f1", "f2"]).map((p) => p.id)).toEqual(["y", "z"]);
    expect(orderPresets(list, []).map((p) => p.id)).toEqual(["z", "y"]);
  });

  it("writes the list onto the grid, keeping every other meta key", () => {
    const grid = { _id: "g1", meta: { scheduleFieldIds: { x: 1 }, fieldPresets: [] } };
    writePresets({ dispatch: vi.fn(), socket: null, getGrid: () => grid, list: [{ id: "a", name: "A", fieldIds: [] }] });
    const arg = CommitHelpers.updateGrid.mock.calls.at(-1)[0];
    expect(arg.gridId).toBe("g1");
    expect(arg.grid.meta).toEqual({ scheduleFieldIds: { x: 1 }, fieldPresets: [{ id: "a", name: "A", fieldIds: [] }] });
    expect(presetsOf({ meta: { fieldPresets: [{ id: "a", fieldIds: [] }, { bad: 1 }] } })).toHaveLength(1);
  });
});

describe("FieldPickerPanel presets row", () => {
  const base = { fieldsById, values: {}, onToggle: () => {}, onSetValue: () => {}, onConfirm: () => {}, title: "Pick", getOccMap: () => ({}), modulesById: {}, foldersById: {} };

  it("is not drawn without onSavePreset (the add-an-option flow)", () => {
    render(<FieldPickerPanel {...base} picked={[]} />);
    expect(screen.queryByTestId("field-presets")).toBeNull();
  });

  it("clicking a preset applies it; Save as preset asks for a name and saves", () => {
    const onApply = vi.fn(), onSave = vi.fn();
    const preset = { id: "a", name: "Workout", fieldIds: ["f1"], values: {} };
    render(<FieldPickerPanel {...base} picked={["f1"]} presets={[preset]} onApplyPreset={onApply} onSavePreset={onSave} onDeletePreset={() => {}} />);
    fireEvent.click(screen.getByText("Workout"));
    expect(onApply).toHaveBeenCalledWith(preset);
    fireEvent.click(screen.getByText("Save as preset"));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "Leg day" } });
    fireEvent.keyDown(screen.getByLabelText("Preset name"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Leg day");
  });

  it("Save as preset is off until a field is ticked", () => {
    render(<FieldPickerPanel {...base} picked={[]} presets={[]} onSavePreset={() => {}} />);
    expect(screen.getByText("Save as preset").closest("button").disabled).toBe(true);
  });
});
