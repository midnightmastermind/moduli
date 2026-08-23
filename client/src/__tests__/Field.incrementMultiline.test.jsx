// Two field-meta keys were authored by the seed and read by NOTHING.
//
// `meta.increment` — 71 fields across four grids carry it (Steps 500, Calories
// 50, Liquid Amount 8, Amount/Weight/Protein 5, macros 0.1) and the number input
// asked for `meta.step`, which **0 fields on any grid carry** and nothing writes.
// So every number field has stepped by the browser's default of 1: tapping ↑ on
// `Steps` moved it by 1 where its author said 500. A name mismatch, not a missing
// feature — the inert-token class this repo keeps rediscovering.
//
// `meta.multiline` — 6 fields (Person Notes, Allergies, Interests, How We Met,
// Excerpt) and only a `markdown`-typed field ever rendered a textarea, so every
// one of those prose fields was a single-line box.
//
// Each case is paired with a CONTROL asserting the OTHER shape, because "renders
// a textarea" proves nothing unless a field without the key demonstrably does not.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import Field from "../ui/Field";

function renderWithCtx(node) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
    state: { grid: {} },
  };
  return render(<GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>);
}
const numberField = (meta) => ({ id: "f-n", name: "Steps", type: "number", inputEnabled: true, meta });
const textField = (meta) => ({ id: "f-t", name: "Person Notes", type: "text", inputEnabled: true, meta });
const binding = (fieldId) => ({ fieldId, role: "input" });

describe("Field — meta.increment drives the number input's step", () => {
  it("steps by the authored increment", () => {
    const { container } = renderWithCtx(
      <Field field={numberField({ increment: 500 })} binding={binding("f-n")} value={1000} onCommit={vi.fn()} />
    );
    const input = container.querySelector('input[type="number"]');
    expect(input.getAttribute("step")).toBe("500");
  });

  it("carries a FRACTIONAL increment — a macro field steps by 0.1, not 1", () => {
    // The discriminating case: the browser's default step is 1, which REJECTS
    // a fractional value outright, so a 0.1 field was unusable by the arrows.
    const { container } = renderWithCtx(
      <Field field={numberField({ increment: 0.1 })} binding={binding("f-n")} value={2.5} onCommit={vi.fn()} />
    );
    expect(container.querySelector('input[type="number"]').getAttribute("step")).toBe("0.1");
  });

  it("CONTROL — a field with no increment sets no step", () => {
    const { container } = renderWithCtx(
      <Field field={numberField({})} binding={binding("f-n")} value={10} onCommit={vi.fn()} />
    );
    expect(container.querySelector('input[type="number"]').getAttribute("step")).toBeNull();
  });

  it("CONTROL — min and max are unregressed", () => {
    const { container } = renderWithCtx(
      <Field field={numberField({ increment: 5, min: 0, max: 99 })} binding={binding("f-n")} value={10} onCommit={vi.fn()} />
    );
    const input = container.querySelector('input[type="number"]');
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("99");
    expect(input.getAttribute("step")).toBe("5");
  });
});

describe("Field — meta.multiline makes a text field a textarea", () => {
  it("renders a textarea carrying the value", () => {
    const { container } = renderWithCtx(
      <Field field={textField({ multiline: true })} binding={binding("f-t")} value={"line one\nline two"} onCommit={vi.fn()} />
    );
    const ta = container.querySelector("textarea");
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("line one\nline two");
  });

  it("CONTROL — a text field without it stays a single-line input", () => {
    const { container } = renderWithCtx(
      <Field field={textField({})} binding={binding("f-t")} value={"hello"} onCommit={vi.fn()} />
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeTruthy();
  });

  it("does NOT reach a compact pill — a row's field is one line by design", () => {
    // A textarea inside an instance row would break the single-centreline
    // alignment the row layout is built on (2026-07-28). Multiline is a
    // full-size-editor affordance only.
    const { container } = renderWithCtx(
      <Field field={textField({ multiline: true })} binding={binding("f-t")} value={"x"} compact onCommit={vi.fn()} />
    );
    expect(container.querySelector("textarea")).toBeNull();
  });
});
