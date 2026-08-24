// What FieldDetail does with a name on Save.
//
// It REJECTED a duplicate until 2026-08-24, when the user retired that rule:
// *"fields dont have to be unique name based by the way"*. These tests were
// written to pin the guard; they are inverted rather than deleted, because the
// half that still matters — an EMPTY name is refused — lives in the same place,
// and because a test file that quietly disappears takes the contract with it.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import { FieldDetail } from "../ui/commandCenter/FieldsTab";

const fieldsById = {
  f1: { id: "f1", name: "Water", type: "number" },
  f2: { id: "f2", name: "Steps", type: "number" },
};

function renderDetail(field, onSave) {
  const ctx = {
    dispatch: vi.fn(), socket: null,
    fieldsById, modulesById: {}, roleByModuleId: {},
    state: { grid: {} },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldDetail field={field} onSave={onSave} onDelete={vi.fn()} />
    </GridActionsContext.Provider>
  );
}

describe("FieldDetail — what leaves on Save", () => {
  it("SAVES a name that collides with another field — the rule is retired", () => {
    // The inversion. This asserted `not.toHaveBeenCalled()` until today.
    const onSave = vi.fn();
    renderDetail({ id: "f2", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByDisplayValue("Steps"), { target: { value: "  water " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "f2", name: "water" }));
    expect(screen.queryByText(/already exists/i)).toBeNull();
  });

  it("saving under the field's OWN name is fine", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Water", type: "number", meta: {} }, onSave);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "f1", name: "Water" }));
  });

  it("still TRIMS, and still refuses an empty name", () => {
    // The half that survives, and the discriminating case for the change: a
    // nameless field renders as a blank label with no way to tell it from its
    // neighbour. That is a different problem from two fields sharing a name.
    const onSave = vi.fn();
    renderDetail({ id: "f2", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByDisplayValue("Steps"), { target: { value: "  Distance " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Distance" }));

    onSave.mockClear();
    fireEvent.change(screen.getByDisplayValue("Distance"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/can't be empty/i)).toBeTruthy();
  });
});
