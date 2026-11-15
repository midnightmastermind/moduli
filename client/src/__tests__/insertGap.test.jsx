import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  createChildInContainer: vi.fn(() => ({ moduleId: "new-mod" })),
  createLeafInstanceAtIndex: vi.fn(() => ({ moduleId: "new-mod", occurrenceId: "new-occ" })),
  qam: { props: null },
  occMap: {},
}));

vi.mock("../helpers/CommitHelpers", () => ({
  createChildInContainer: mocks.createChildInContainer,
  createLeafInstanceAtIndex: mocks.createLeafInstanceAtIndex,
}));
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => ({
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    state: {}, modulesById: {}, getOccMap: () => mocks.occMap,
  }),
}));
// Capture QuickAddMenu's props so the test can drive onSelect directly.
vi.mock("../ui/QuickAddMenu.jsx", () => ({
  default: (props) => { mocks.qam.props = props; return null; },
}));

import InsertGap from "../ui/InsertGap.jsx";

describe("InsertGap", () => {
  beforeEach(() => {
    mocks.qam.props = null;
    mocks.createLeafInstanceAtIndex.mockClear();
  });

  it("does not build the + menu until the gap is hovered (a menu per row cost every long board)", () => {
    mocks.qam.props = null;
    const { container } = render(<InsertGap parentOccurrence={{ id: "occ-parent", moduleId: "m-parent" }} index={1} />);
    expect(mocks.qam.props).toBeFalsy();
    fireEvent.pointerEnter(container.querySelector(".insert-gap"));
    expect(mocks.qam.props).toBeTruthy();
  });

  it("picking an EXISTING module splices it at the gap index (regression: unimported createLeafInstanceAtIndex threw)", () => {
    const { container } = render(<InsertGap parentOccurrence={{ id: "occ-parent", moduleId: "m-parent" }} index={2} />);
    // The + menu is built on first hover (it is hidden until then).
    fireEvent.pointerEnter(container.querySelector(".insert-gap"));
    expect(mocks.qam.props).toBeTruthy();
    // This threw `ReferenceError: createLeafInstanceAtIndex is not defined` before the fix.
    mocks.qam.props.onSelect({ id: "mod-1" });
    expect(mocks.createLeafInstanceAtIndex).toHaveBeenCalledWith(expect.objectContaining({
      existingModuleId: "mod-1",
      index: 2,
      parentOccurrence: expect.objectContaining({ id: "occ-parent" }),
    }));
  });

  // 2026-11-15: a gap drawn INSIDE a memoized tile (its edge gaps) can hold an older copy of the container; splicing
  // at `index` into that stale child list would drop rows added since. The insert reads the live parent.
  it("inserts into the LIVE parent, not the copy it was drawn with", () => {
    mocks.occMap = { "occ-parent": { id: "occ-parent", moduleId: "m-parent", occurrences: ["a", "b", "c"] } };
    const stale = { id: "occ-parent", moduleId: "m-parent", occurrences: ["a"] };
    const { container } = render(<InsertGap parentOccurrence={stale} index={1} />);
    fireEvent.pointerEnter(container.querySelector(".insert-gap"));
    mocks.qam.props.onSelect({ id: "mod-1" });
    expect(mocks.createLeafInstanceAtIndex.mock.calls.at(-1)[0].parentOccurrence.occurrences).toEqual(["a", "b", "c"]);
    mocks.occMap = {};
  });

  it("an edge gap carries its side", () => {
    const { container } = render(<InsertGap parentOccurrence={{ id: "occ-parent", moduleId: "m-parent" }} index={3} edge="left" />);
    expect(container.querySelector(".insert-gap").className).toMatch(/insert-gap--edge insert-gap--edge-left/);
  });
});
