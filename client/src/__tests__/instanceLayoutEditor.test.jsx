// The placement's Layout settings carry the row-layout editor (user, 2026-10-15).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: (...a) => updateOccurrence(...a) }));
const fieldsById = { c: { id: "c", name: "Completed" }, m: { id: "m", name: "Movement" }, s1: { id: "s1", name: "Set 1" } };
const modulesById = { mod: { id: "mod", role: "instance", fieldBindings: [{ fieldId: "c" }, { fieldId: "m" }, { fieldId: "s1" }] } };
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ dispatch: () => {}, socket: null, modulesById, fieldsById }) }));
import InstanceLayoutEditor from "../ui/InstanceLayoutEditor";

const lastMeta = () => updateOccurrence.mock.calls.at(-1)[0].occurrence.meta;
beforeEach(() => updateOccurrence.mockClear());

describe("InstanceLayoutEditor", () => {
  it("starts a layout from the row's own fields", () => {
    render(<InstanceLayoutEditor occurrence={{ id: "o", moduleId: "mod", meta: {} }} />);
    fireEvent.click(screen.getByText("Arrange this row…"));
    expect(lastMeta().instanceLayout.tree.items[1].items).toEqual(["field:c", "field:m", "field:s1"]);
  });
  it("switches a box between columns and rows, and its wrap", () => {
    const occ = { id: "o", moduleId: "mod", meta: { instanceLayout: { tree: { dir: "row", items: ["field:c"] } }, keep: 1 } };
    render(<InstanceLayoutEditor occurrence={occ} />);
    fireEvent.click(screen.getByText("Columns"));
    expect(lastMeta().instanceLayout.tree.dir).toBe("col");
    expect(lastMeta().keep).toBe(1);
    fireEvent.click(screen.getByText("Wraps"));
    expect(lastMeta().instanceLayout.tree.wrap).toBe(false);
  });
  it("a field's styling: hide its name writes the row's own field cell", () => {
    const occ = { id: "o", moduleId: "mod", fields: { c: { value: true, flow: "in" } }, meta: { instanceLayout: { tree: { dir: "row", items: ["field:c"] } } } };
    render(<InstanceLayoutEditor occurrence={occ} />);
    fireEvent.click(screen.getByText("Completed"));
    fireEvent.click(screen.getByLabelText("Hide its name"));
    expect(updateOccurrence.mock.calls.at(-1)[0].occurrence.fields.c).toEqual({ value: true, flow: "in", hideName: true });
  });
  it("Reset removes the layout", () => {
    render(<InstanceLayoutEditor occurrence={{ id: "o", moduleId: "mod", meta: { instanceLayout: { tree: { dir: "row", items: [] } } } }} />);
    fireEvent.click(screen.getByText("Reset"));
    expect("instanceLayout" in lastMeta()).toBe(false);
  });
});
