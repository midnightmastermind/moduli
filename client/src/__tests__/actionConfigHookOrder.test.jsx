// A step's action type can be CHANGED in the operations editor, and
// `<ActionConfig>` is rendered without a `key` — so React reuses the same
// component instance across that change. A hook called inside one `case` of the
// switch therefore changes the HOOK COUNT between renders, which React refuses:
// "Rendered fewer hooks than during the previous render."
//
// This is the class that crashed BoundHeader (a useMemo after an early return,
// modules/CLAUDE.md 2026-08-11) and it was live here until 2026-08-23. Every
// case below FAILS against the pre-fix code with that React error.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { ActionConfig } from "../blocks/OperationsBuilder";

const props = {
  cfg: {}, setCfg: vi.fn(), fields: [], varOptions: [], localVars: [],
  modulesById: {}, occurrencesById: {}, fieldsById: {}, operationsById: {}, sources: [],
};

describe("ActionConfig hook order", () => {
  // The exact gesture: pick FIND on a step, then change your mind.
  it("survives changing the action type FROM FIND", () => {
    const { rerender } = render(<ActionConfig actionType="FIND" {...props} />);
    expect(() => rerender(<ActionConfig actionType="SET_VAR" {...props} />)).not.toThrow();
  });

  it("survives changing the action type TO FIND", () => {
    const { rerender } = render(<ActionConfig actionType="SET_VAR" {...props} />);
    expect(() => rerender(<ActionConfig actionType="FIND" {...props} />)).not.toThrow();
  });

  // A round trip is the one that catches an asymmetric fix — hoisting the hook
  // for one direction only would pass one of the two tests above.
  it("survives a round trip through several action types", () => {
    const { rerender } = render(<ActionConfig actionType="FIND" {...props} />);
    for (const t of ["CREATE", "FIND", "UPDATE", "FIND", "DELETE", "FIND"]) {
      expect(() => rerender(<ActionConfig actionType={t} {...props} />)).not.toThrow();
    }
  });

  // CONTROL: the component must actually be rendering something, or "did not
  // throw" would be true of a component that returns null for every input.
  it("CONTROL: FIND renders its own controls", () => {
    const { container } = render(<ActionConfig actionType="FIND" {...props} />);
    expect(container.textContent).toContain("Look in");
  });
});
