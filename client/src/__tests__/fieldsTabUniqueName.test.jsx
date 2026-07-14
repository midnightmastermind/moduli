// FieldDetail rejects duplicate field names (2026-07-14 rule: "there
// shouldnt be duplicate field names" → "yeah reject duplicate names").
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

describe("FieldDetail — unique name guard", () => {
  it("rejects a rename that collides with ANOTHER field (case-insensitive)", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f2", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByDisplayValue("Steps"), { target: { value: "  water " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/i)).toBeTruthy();
  });

  it("saving under the field's OWN name is fine (no self-collision)", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Water", type: "number", meta: {} }, onSave);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "f1", name: "Water" }));
  });

  it("a unique name saves TRIMMED; empty names are rejected", () => {
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
