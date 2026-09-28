// MOVE_OCCURRENCE's "to container" must be switchable to an expression.
//
// Its mode was `!!cfg.toContainerIdExpr`, and the toggle, from static, only
// cleared `toContainerId` — nothing could make the expression truthy, so the
// dynamic target was unreachable unless already stored. Measured 2026-09-28:
// 16 of 20 live MOVE steps (4 ops) move to a computed container
// (`$noSlotId`, `$dayColId`…), every one seed-written.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ActionConfig } from "../blocks/OperationsBuilder";

const props = { fields: [], varOptions: [], localVars: [], modulesById: {}, occurrencesById: {}, fieldsById: {}, operationsById: {}, sources: [] };
const toggle = (c) => c.querySelector('button[title="Toggle static/dynamic container"]');

describe("MOVE target toggle", () => {
  it("from static, the toggle switches to an expression", () => {
    const setCfg = vi.fn();
    const { container } = render(<ActionConfig actionType="MOVE_OCCURRENCE" cfg={{}} setCfg={setCfg} {...props} />);
    fireEvent.click(toggle(container));
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ toContainerIdExpr: "" }));
  });
  it("an empty expression is still expression mode (the box to type into)", () => {
    const { container } = render(<ActionConfig actionType="MOVE_OCCURRENCE" cfg={{ toContainerIdExpr: "" }} setCfg={vi.fn()} {...props} />);
    expect(toggle(container).textContent).toBe("expr");
  });
  it("from expression, the toggle goes back to static", () => {
    const setCfg = vi.fn();
    const { container } = render(<ActionConfig actionType="MOVE_OCCURRENCE" cfg={{ toContainerIdExpr: "$x" }} setCfg={setCfg} {...props} />);
    fireEvent.click(toggle(container));
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ toContainerIdExpr: undefined }));
  });
});
