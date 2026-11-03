// A boolean field's switch/checkbox must carry the field's name (deep UI sweep 2026-11-03: axe "button-name" —
// every Completed / Done switch on the grid read as an unnamed button to a screen reader).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
vi.mock("../helpers/operationExecutor", () => ({ runMatchingOperations: () => [] }));
import Field from "../ui/Field";

const ctx = { dispatch: vi.fn(), socket: null, gridId: "g", userId: "u", occurrencesById: {}, modulesById: {},
  fieldsById: {}, operationsById: {}, state: { grid: {} } };
const mount = (node) => render(<GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>);
const field = (meta = {}) => ({ id: "fdone", type: "boolean", name: "Completed", inputEnabled: true, meta });

describe("boolean field controls are named", () => {
  it("compact switch", () => {
    const { getByRole } = mount(<Field field={field()} value={false} compact hostOccurrence={{ id: "o" }} onCommit={() => {}} onChange={() => {}} />);
    expect(getByRole("switch", { name: "Completed" })).toBeTruthy();
  });
  it("full switch", () => {
    const { getByRole } = mount(<Field field={field()} value={true} hostOccurrence={{ id: "o" }} onCommit={() => {}} onChange={() => {}} />);
    expect(getByRole("switch", { name: "Completed" })).toBeTruthy();
  });
  it("full checkbox", () => {
    const { getByRole } = mount(<Field field={field({ variant: "checkbox" })} value={false} hostOccurrence={{ id: "o" }} onCommit={() => {}} onChange={() => {}} />);
    expect(getByRole("checkbox", { name: "Completed" })).toBeTruthy();
  });
});

import AutoMarquee from "../ui/AutoMarquee";
describe("a field pill is findable by its field id", () => {
  it("AutoMarquee stamps data-field-id when given one, and nothing otherwise", () => {
    const a = render(<AutoMarquee dataFieldId="f9"><span>x</span></AutoMarquee>);
    expect(a.container.querySelector('[data-field-id="f9"]')).toBeTruthy();
    const b = render(<AutoMarquee><span>x</span></AutoMarquee>);
    expect(b.container.querySelector("[data-field-id]")).toBeNull();
  });
});
