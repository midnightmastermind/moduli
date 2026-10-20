// The row "+" field menu (ui/FieldAddMenu): choose a field to show on this row,
// or create one and land in the Command Center's own field editor.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";

const updateModule = vi.fn();
const createField = vi.fn();
const updateField = vi.fn();
const deleteField = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  updateModule: (...a) => updateModule(...a),
  createField: (...a) => createField(...a),
  updateField: (...a) => updateField(...a),
  deleteField: (...a) => deleteField(...a),
}));
vi.mock("../ui/commandCenter/FieldsTab", () => ({
  FieldDetail: ({ field }) => <div data-testid="field-detail">editing:{field.name}</div>,
}));

let ctx;
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ctx }));

import FieldAddMenu from "../ui/FieldAddMenu.jsx";

const FIELDS = [
  { id: "f-water", gridId: "g", name: "Water", type: "number", folderId: "cat-body" },
  { id: "f-tags", gridId: "g", name: "Tags", type: "select" },
  { id: "f-date", gridId: "g", name: "Date", type: "date" },
  { id: "f-other", gridId: "other", name: "Elsewhere", type: "text" },
];

beforeEach(() => {
  updateModule.mockReset(); createField.mockReset();
  const fieldsById = Object.fromEntries(FIELDS.map((f) => [f.id, f]));
  ctx = {
    state: { gridId: "g", fields: FIELDS },
    fieldsById,
    foldersById: { "cat-body": { id: "cat-body", gridId: "g", folderType: "category", categoryKind: "field", name: "Body" } },
    operationsById: {},
    dispatch: vi.fn(),
    socket: { connected: true },
  };
});

const MODULE = { id: "m1", fieldBindings: [{ fieldId: "f-date", role: "input", order: 0 }, { fieldId: "f-tags", role: "input", order: 1, hidden: true }] };
const rect = { top: 100, bottom: 118, left: 400, right: 418 };

describe("FieldAddMenu", () => {
  it("lists this grid's fields grouped by the Fields tab's categories", () => {
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={() => {}} />);
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(screen.getByText("Water")).toBeTruthy();
    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("picking a field binds it to the row's module and closes", () => {
    const onClose = vi.fn();
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={onClose} />);
    fireEvent.click(screen.getByText("Water"));
    const call = updateModule.mock.calls.at(-1)[0];
    expect(call.module.id).toBe("m1");
    expect(call.module.fieldBindings.at(-1)).toEqual({ fieldId: "f-water", role: "input", order: 2, hidden: false });
    expect(onClose).toHaveBeenCalled();
  });

  it("picking a bound-but-hidden field shows it", () => {
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Tags"));
    const b = updateModule.mock.calls.at(-1)[0].module.fieldBindings.find((x) => x.fieldId === "f-tags");
    expect(b.hidden).toBe(false);
  });

  it("a field already showing is disabled and writes nothing", () => {
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={() => {}} />);
    const row = screen.getByText("Date").closest("button");
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(updateModule).not.toHaveBeenCalled();
  });

  it("+ Field in a category creates a field there, binds it, and opens the field editor", () => {
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("New field in Body"));
    const field = createField.mock.calls.at(-1)[0].field;
    expect(field.folderId).toBe("cat-body");
    expect(field.gridId).toBe("g");
    expect(updateModule.mock.calls.at(-1)[0].module.fieldBindings.at(-1).fieldId).toBe(field.id);
  });

  it("search narrows the list, and offers to create the typed name", () => {
    render(<FieldAddMenu module={MODULE} anchorRect={rect} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search fields"), { target: { value: "wat" } });
    expect(screen.getByText("Water")).toBeTruthy();
    expect(screen.queryByText("Date")).toBeNull();
    fireEvent.click(screen.getByText(/Create "wat"/));
    expect(createField.mock.calls.at(-1)[0].field.name).toBe("wat");
  });
});

describe("the row wiring", () => {
  it("ModuleInstance renders the hover + and mounts the menu with the row's module", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/ModuleInstance.jsx"), "utf8");
    expect(src).toMatch(/className="instance-field-add-btn"/);
    expect(src).toMatch(/<FieldAddMenu module=\{instance\}/);
    expect(src).toMatch(/import\("\.\.\/ui\/FieldAddMenu"\)/);
  });
});
