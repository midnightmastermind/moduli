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

describe("rating, markdown and address controls are named", () => {
  const f = (type, name, meta = {}) => ({ id: `f-${type}`, type, name, inputEnabled: true, meta });
  const commit = { onCommit: () => {}, onChange: () => {}, hostOccurrence: { id: "o" } };
  for (const compact of [true, false]) {
    it(`each star says which star it is (compact=${compact})`, () => {
      const { getByRole } = mount(<Field field={f("rating", "Rating")} value={2} compact={compact} {...commit} />);
      expect(getByRole("button", { name: "Rating: 3 of 5" })).toBeTruthy();
    });
    it(`the markdown box is named (compact=${compact})`, () => {
      const { getByRole } = mount(<Field field={f("markdown", "Journal")} value="" compact={compact} {...commit} />);
      expect(getByRole("textbox", { name: "Journal" })).toBeTruthy();
    });
  }
  it("the address pill on a row shows the field's name", () => {
    const { container } = mount(<Field field={f("address", "Address")} value={null} compact {...commit} />);
    expect(container.textContent).toMatch(/Address/);
  });
});

describe("a picked address shows on the row", () => {
  // FieldRenderer hands the bare location object; it has no `value` key, and extractValue read it as empty.
  it("renders the stored location's name, not 'Set an address…'", () => {
    const loc = { label: "Madison", address: "Wisconsin, United States", lat: 43.07, lon: -89.38, osmId: "R/1" };
    const { container } = mount(<Field field={{ id: "fa", type: "address", name: "Address", inputEnabled: true, meta: {} }}
      value={loc} compact onCommit={() => {}} onChange={() => {}} hostOccurrence={{ id: "o" }} />);
    expect(container.textContent).toMatch(/Madison/);
    expect(container.textContent).not.toMatch(/Set an address/);
  });
});
