// The editor writes fieldBindings onto a MODULE — every occurrence of that
// module is affected — so the tests are about what it commits and, carrying
// more weight, what it refuses to touch.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FieldBindingsEditor from "../ui/FieldBindingsEditor.jsx";

const updateModule = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  updateModule: (...a) => updateModule(...a),
}));

// The real picker drills through a category tree; here it only has to hand
// back a picked field id, which is the contract the editor depends on.
vi.mock("../ui/DrilldownPicker", () => ({
  default: ({ onChange, config }) => (
    <div>
      {(config?.categories?.[0]?.resolveItems?.() || []).map((it) => (
        <button key={it.value} onClick={() => onChange(it.value)}>
          pick:{it.title}
        </button>
      ))}
    </div>
  ),
}));

let ctx;
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => ctx,
}));

const FIELDS = {
  "f-water": { id: "f-water", name: "Water", type: "number" },
  "f-tags": { id: "f-tags", name: "Tags", type: "select" },
  "f-date": { id: "f-date", name: "Date", type: "date" },
};

const setCtx = (autoAppliedFieldIds = []) => {
  ctx = {
    fieldsById: FIELDS,
    dispatch: vi.fn(),
    socket: { connected: true },
    state: { grid: { meta: { autoAppliedFieldIds } } },
  };
};

const lastBindings = () => updateModule.mock.calls.at(-1)[0].module.fieldBindings;

beforeEach(() => {
  updateModule.mockClear();
  setCtx();
});

describe("FieldBindingsEditor — binding a field", () => {
  it("commits a new binding for a picked field", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [] }} />);
    fireEvent.click(screen.getByText("pick:Water"));
    expect(updateModule).toHaveBeenCalledTimes(1);
    const call = updateModule.mock.calls[0][0];
    expect(call.module.id).toBe("m1");
    expect(call.module.fieldBindings).toEqual([{ fieldId: "f-water", role: "input", order: 0 }]);
  });

  it("does not offer a field the module already binds", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [{ fieldId: "f-water" }] }} />);
    expect(screen.queryByText("pick:Water")).toBeNull();
    expect(screen.getByText("pick:Tags")).toBeTruthy();
  });

  it("APPENDS rather than replacing, so an existing binding survives", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [{ fieldId: "f-water", role: "display" }] }} />);
    fireEvent.click(screen.getByText("pick:Tags"));
    expect(lastBindings()).toEqual([
      { fieldId: "f-water", role: "display" },
      { fieldId: "f-tags", role: "input", order: 1 },
    ]);
  });

  it("commits ONLY id + fieldBindings, so an unrelated module key is never clobbered", () => {
    // updateModule merges by id; sending the whole module would carry a stale
    // copy of every other key back over whatever else has changed.
    render(<FieldBindingsEditor module={{ id: "m1", label: "Journal", meta: { keep: 1 }, fieldBindings: [] }} />);
    fireEvent.click(screen.getByText("pick:Water"));
    expect(Object.keys(updateModule.mock.calls[0][0].module).sort()).toEqual(["fieldBindings", "id"]);
  });
});

describe("FieldBindingsEditor — editing a binding", () => {
  it("toggles hidden without touching the other bindings", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [
      { fieldId: "f-water", role: "input" },
      { fieldId: "f-tags", role: "input", hidden: true },
    ] }} />);
    fireEvent.click(screen.getByTitle("Hide field"));
    expect(lastBindings()).toEqual([
      { fieldId: "f-water", role: "input", hidden: true },
      { fieldId: "f-tags", role: "input", hidden: true },
    ]);
  });

  it("unbinds exactly one field", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [
      { fieldId: "f-water" }, { fieldId: "f-tags" },
    ] }} />);
    fireEvent.click(screen.getAllByTitle("Unbind field")[0]);
    expect(lastBindings()).toEqual([{ fieldId: "f-tags" }]);
  });

  it("renders nothing for a binding whose field no longer exists", () => {
    // A deleted field must not blank the whole editor.
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [
      { fieldId: "f-gone" }, { fieldId: "f-water" },
    ] }} />);
    expect(screen.getAllByTitle("Unbind field")).toHaveLength(1);
    expect(screen.getByText("Water")).toBeTruthy();
  });
});

describe("FieldBindingsEditor — fields the GRID gives every occurrence", () => {
  it("lists a universal field the module does not bind, as its own section", () => {
    // Without this the field renders on the occurrence and appears nowhere in
    // the editor, which reads as a bug.
    setCtx(["f-tags"]);
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [] }} />);
    expect(screen.getByText("From the grid — every occurrence carries these")).toBeTruthy();
    expect(screen.getByTitle(/Bind to this one/)).toBeTruthy();
  });

  it("does NOT list one the module already binds — the explicit binding is in force", () => {
    setCtx(["f-tags"]);
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [{ fieldId: "f-tags" }] }} />);
    expect(screen.queryByText("From the grid — every occurrence carries these")).toBeNull();
  });

  it("binding one writes an explicit VISIBLE binding", () => {
    // An explicit binding is what lets THIS module order it, hide it, or give
    // it a role — the inherited one carries no such intent.
    setCtx(["f-tags"]);
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [] }} />);
    fireEvent.click(screen.getByTitle(/Bind to this one/));
    expect(lastBindings()).toEqual([{ fieldId: "f-tags", role: "input", order: 0, hidden: false }]);
  });

  it("shows no grid section when the grid names no universal fields", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [] }} />);
    expect(screen.queryByText("From the grid — every occurrence carries these")).toBeNull();
  });

  it("ignores a universal id naming a field that does not exist", () => {
    setCtx(["f-nope"]);
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [] }} />);
    expect(screen.queryByText("From the grid — every occurrence carries these")).toBeNull();
  });
});

describe("FieldBindingsEditor — refusals", () => {
  it("renders nothing without a module", () => {
    const { container } = render(<FieldBindingsEditor module={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("tolerates a module whose fieldBindings is missing or not an array", () => {
    render(<FieldBindingsEditor module={{ id: "m1" }} />);
    fireEvent.click(screen.getByText("pick:Water"));
    expect(lastBindings()).toEqual([{ fieldId: "f-water", role: "input", order: 0 }]);
    updateModule.mockClear();
    render(<FieldBindingsEditor module={{ id: "m2", fieldBindings: "nope" }} />);
    fireEvent.click(screen.getAllByText("pick:Water")[1]);
    expect(lastBindings()).toEqual([{ fieldId: "f-water", role: "input", order: 0 }]);
  });

  it("skips a binding row with no fieldId instead of rendering a blank row", () => {
    render(<FieldBindingsEditor module={{ id: "m1", fieldBindings: [{ role: "input" }, { fieldId: "f-water" }] }} />);
    expect(screen.getAllByTitle("Unbind field")).toHaveLength(1);
  });
});
