// "make sure i can edit everything in the ui" (2026-08-22) — the audit's item C2.
//
// Four field-meta keys were LIVE on real data and reachable only by writing a
// migration: `increment` (71 fields across four grids), `min`/`max` (7/4), and
// `multiSelect` (46 — whether an occurrence dropdown takes one pick or many).
// `FieldDetail` rendered fourteen controls and none of them.
//
// Every case asserts what LEAVES the component (the saved field), not that a
// control rendered — a control that writes a key nothing reads is the very
// class this audit is about, so the assertion has to be the write.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import { FieldDetail } from "../ui/commandCenter/FieldsTab";

const fieldsById = { f1: { id: "f1", name: "Steps", type: "number" } };

function renderDetail(field, onSave) {
  const ctx = { dispatch: vi.fn(), socket: null, fieldsById, modulesById: {}, roleByModuleId: {}, state: { grid: {} } };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldDetail field={field} onSave={onSave} onDelete={vi.fn()} />
    </GridActionsContext.Provider>
  );
}
const saved = (onSave) => onSave.mock.calls.at(-1)[0];

describe("FieldDetail — the number clamp and step are editable", () => {
  it("writes meta.increment as a NUMBER, not the input's string", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "500" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.increment).toBe(500);
  });

  it("keeps a FRACTIONAL step — a macro field steps by 0.1", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "0.1" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.increment).toBe(0.1);
  });

  it("writes min and max", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: {} }, onSave);
    fireEvent.change(screen.getByLabelText("Min"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Max"), { target: { value: "99" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.min).toBe(0);
    expect(saved(onSave).meta.max).toBe(99);
  });

  it("CLEARING a box stores null, never NaN or an empty string", () => {
    // Number("") is 0 and Number("x") is NaN — either would silently CLAMP a
    // field to zero or make the input reject every value. Emptying the box
    // has to mean "no clamp".
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: { min: 5, increment: 10 } }, onSave);
    fireEvent.change(screen.getByLabelText("Min"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.min).toBeNull();
    expect(saved(onSave).meta.increment).toBeNull();
  });

  it("shows the stored values when one already exists", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: { increment: 500, min: 0 } }, onSave);
    expect(screen.getByLabelText("Step").value).toBe("500");
    expect(screen.getByLabelText("Min").value).toBe("0");
  });

  it("CONTROL — a text field gets no number clamp at all", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Notes", type: "text", meta: {} }, onSave);
    expect(screen.queryByLabelText("Step")).toBeNull();
    expect(screen.queryByLabelText("Min")).toBeNull();
  });
});

describe("FieldDetail — multi-line and multi-select", () => {
  it("a TEXT field can be marked multi-line", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Notes", type: "text", meta: {} }, onSave);
    fireEvent.click(screen.getByLabelText("Multi-line"));
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.multiline).toBe(true);
  });

  it("CONTROL — a number field is never offered multi-line", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Steps", type: "number", meta: {} }, onSave);
    expect(screen.queryByLabelText("Multi-line")).toBeNull();
  });

  it("a SELECT field can take several picks", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Tags", type: "select", meta: {} }, onSave);
    fireEvent.click(screen.getByLabelText("Several picks"));
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.multiSelect).toBe(true);
  });

  it("an OCCURRENCE dropdown can too — it is the same question", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Ingredient", type: "occurrence", meta: {} }, onSave);
    fireEvent.click(screen.getByLabelText("Several picks"));
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.multiSelect).toBe(true);
  });

  it("CONTROL — a boolean is never offered several picks", () => {
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Done", type: "boolean", meta: {} }, onSave);
    expect(screen.queryByLabelText("Several picks")).toBeNull();
  });

  it("turning multi-select OFF writes false rather than dropping the key", () => {
    // The renderer reads `meta.multiSelect === true`, so a dropped key and a
    // false both read as single-pick — but a DROPPED key is indistinguishable
    // from "never configured" to the next migration that audits this grid.
    const onSave = vi.fn();
    renderDetail({ id: "f1", name: "Tags", type: "select", meta: { multiSelect: true } }, onSave);
    fireEvent.click(screen.getByLabelText("Several picks"));
    fireEvent.click(screen.getByText("Save"));
    expect(saved(onSave).meta.multiSelect).toBe(false);
  });
});
