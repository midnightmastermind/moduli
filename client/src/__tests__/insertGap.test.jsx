import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  createChildInContainer: vi.fn(() => ({ moduleId: "new-mod" })),
  createLeafInstanceAtIndex: vi.fn(() => ({ moduleId: "new-mod", occurrenceId: "new-occ" })),
  qam: { props: null },
}));

vi.mock("../helpers/CommitHelpers", () => ({
  createChildInContainer: mocks.createChildInContainer,
  createLeafInstanceAtIndex: mocks.createLeafInstanceAtIndex,
}));
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => ({
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    state: {}, modulesById: {},
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

  it("picking an EXISTING module splices it at the gap index (regression: unimported createLeafInstanceAtIndex threw)", () => {
    render(<InsertGap parentOccurrence={{ id: "occ-parent", moduleId: "m-parent" }} index={2} />);
    expect(mocks.qam.props).toBeTruthy();
    // This threw `ReferenceError: createLeafInstanceAtIndex is not defined` before the fix.
    mocks.qam.props.onSelect({ id: "mod-1" });
    expect(mocks.createLeafInstanceAtIndex).toHaveBeenCalledWith(expect.objectContaining({
      existingModuleId: "mod-1",
      index: 2,
      parentOccurrence: expect.objectContaining({ id: "occ-parent" }),
    }));
  });
});
