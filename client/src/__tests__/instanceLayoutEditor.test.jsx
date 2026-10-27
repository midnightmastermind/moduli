// The placement's Layout settings carry the row-layout editor (user, 2026-10-15).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const updateOccurrence = vi.fn();
const applyInstanceLayout = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: (...a) => updateOccurrence(...a), applyInstanceLayout: (...a) => applyInstanceLayout(...a) }));
const fieldsById = { c: { id: "c", name: "Completed" }, m: { id: "m", name: "Movement" }, s1: { id: "s1", name: "Set 1" } };
const modulesById = { mod: { id: "mod", role: "instance", fieldBindings: [{ fieldId: "c" }, { fieldId: "m" }, { fieldId: "s1" }] } };
const occurrencesById = { o: { id: "o", moduleId: "mod" }, twin: { id: "twin", moduleId: "mod" } };
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ dispatch: () => {}, socket: null, modulesById, fieldsById, occurrencesById }) }));
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
  it("Apply to all gives the stored layout to every same-shaped instance, after a confirm", () => {
    const layout = { tree: { dir: "row", items: ["field:c"] } };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<InstanceLayoutEditor occurrence={{ id: "o", moduleId: "mod", meta: { instanceLayout: layout } }} />);
    fireEvent.click(screen.getByText("Apply to all 1"));
    const arg = applyInstanceLayout.mock.calls.at(-1)[0];
    expect(arg.occurrenceIds).toEqual(["twin"]);
    expect(arg.layout).toEqual(layout);
  });

  describe("drag and drop (2026-10-27)", () => {
    // jsdom has no layout: stub the hit test and each element's box.
    const box = (el, r) => { el.getBoundingClientRect = () => ({ left: r[0], top: r[1], right: r[0] + r[2], bottom: r[1] + r[3], width: r[2], height: r[3] }); };
    const ev = (type, x, y) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    const occ = { id: "o", moduleId: "mod", meta: { instanceLayout: { tree: { dir: "col", items: ["label", "field:c", { dir: "row", items: ["field:m"] }, "field:s1"] } } } };
    const chip = (name) => screen.getByText(name, { selector: "span" });

    it("drags a field to the very top, showing a drop line on the way", () => {
      render(<InstanceLayoutEditor occurrence={occ} />);
      const label = chip("Label"), set1 = chip("Set 1");
      box(label, [0, 0, 100, 20]);
      document.elementFromPoint = () => label;
      set1.dispatchEvent(ev("pointerdown", 50, 200));
      act(() => { window.dispatchEvent(ev("pointermove", 50, 2)); });
      expect(screen.getByTestId("layout-drop-line")).toBeTruthy();
      window.dispatchEvent(ev("pointerup", 50, 2));
      expect(lastMeta().instanceLayout.tree.items.slice(0, 2)).toEqual(["field:s1", "label"]);
    });

    it("drags a field into a box", () => {
      render(<InstanceLayoutEditor occurrence={occ} />);
      const movement = chip("Movement");
      box(movement, [0, 100, 100, 20]);
      document.elementFromPoint = () => movement;
      chip("Completed").dispatchEvent(ev("pointerdown", 50, 40));
      window.dispatchEvent(ev("pointermove", 10, 110));   // left half of a chip in a row box: before it
      window.dispatchEvent(ev("pointerup", 10, 110));
      expect(lastMeta().instanceLayout.tree.items[1].items).toEqual(["field:c", "field:m"]);
    });

    it("a press without movement is a click: it selects the field, writes nothing", () => {
      render(<InstanceLayoutEditor occurrence={occ} />);
      const c = chip("Completed");
      c.dispatchEvent(ev("pointerdown", 50, 40));
      window.dispatchEvent(ev("pointerup", 50, 40));
      fireEvent.click(c);
      expect(updateOccurrence).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Hide its name")).toBeTruthy();
    });

    it("+ Box puts the new box first in its box", () => {
      render(<InstanceLayoutEditor occurrence={occ} />);
      fireEvent.click(screen.getAllByText("+ Box")[0]);
      expect(lastMeta().instanceLayout.tree.items[0]).toEqual({ dir: "row", items: [] });
    });
  });
});
