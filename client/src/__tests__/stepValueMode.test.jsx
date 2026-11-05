// UI sweep 2026-11-05: a step's value was the same text box for every field type. Setting an occurrence field meant
// pasting a raw id no screen shows; a select meant knowing its stored value; a Schedule value could not be typed at all.
// The value box now offers the field's own control ("value" mode), written as a plain literal.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { encodeStepValue, decodeStepValue, isPlainStepValue } from "../helpers/stepValue";
import { resolveExpr } from "../helpers/operationActions";
import StepValueField from "../blocks/StepValueField.jsx";

describe("encodeStepValue / decodeStepValue", () => {
  const num = { type: "number" }, txt = { type: "text" };
  it("round-trips through the executor's own reader, keeping the type", () => {
    for (const [v, f] of [["hello", txt], ["$not a var", txt], [true, { type: "boolean" }], [false, { type: "boolean" }], [7, num], [["a", "b"], { type: "select" }], [{ mode: "once", dates: ["2026-11-05"] }, { type: "when" }]]) {
      const e = encodeStepValue(v, f);
      expect(resolveExpr(e, {})).toEqual(v);
      expect(decodeStepValue(e)).toEqual(v);
    }
  });
  it("a number field's typed text is a number; a text field's stays text", () => {
    expect(resolveExpr(encodeStepValue("7", num), {})).toBe(7);
    expect(resolveExpr(encodeStepValue("007", txt), {})).toBe("007");
    expect(resolveExpr(encodeStepValue("true", txt), {})).toBe("true");
  });
  it("nothing typed is an empty expression", () => {
    expect(encodeStepValue("", txt)).toBe("");
    expect(encodeStepValue(null, txt)).toBe("");
  });
  it("only a literal or empty value is plain — a path or template stays an expression", () => {
    expect(isPlainStepValue("")).toBe(true);
    expect(isPlainStepValue("literal:x")).toBe(true);
    expect(isPlainStepValue('json:["a"]')).toBe(true);
    expect(isPlainStepValue("$item.id")).toBe(false);
    expect(isPlainStepValue("a ${$b}")).toBe(false);
    expect(isPlainStepValue('json:["$item.id"]')).toBe(false);
  });
});

describe("StepValueField", () => {
  it("draws the field's own control and writes a literal", () => {
    const onChange = vi.fn();
    render(<StepValueField field={{ id: "n", name: "Notes", type: "text", inputEnabled: true }} value="literal:hi" onChange={onChange} />);
    const box = screen.getByDisplayValue("hi");
    fireEvent.change(box, { target: { value: "hello" } });
    expect(onChange.mock.calls.at(-1)[0]).toBe("literal:hello");
  });
});

describe("wiring", () => {
  it("Set field and the attach-a-field rows hand the value box their field", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(`${process.cwd()}/src/blocks/OperationsBuilder.jsx`, "utf8");
    expect(src).toMatch(/StepValueField/);
    expect((src.match(/valueField=\{/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
