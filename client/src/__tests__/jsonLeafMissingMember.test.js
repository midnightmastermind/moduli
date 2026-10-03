// json: object leaves: a reference whose root variable exists resolves to null
// when the member is missing (as deepResolveExpr does for an object value);
// only a leaf naming no variable stays literal.
import { describe, it, expect } from "vitest";
import { resolveExpr } from "../helpers/operationActions";

const $vars = { $item: { fields: { d: { value: "2026-10-03" } } } };
describe("json: leaf with a missing member", () => {
  it("a missing member of an existing variable is null, not the expression text", () => {
    const r = resolveExpr('json:{"date":"$item.fields.d.value","slot":"$item.fields.ts.value"}', $vars);
    expect(r).toEqual({ date: "2026-10-03", slot: null });
  });
  it("CONTROL: a leaf naming no variable stays as written", () => {
    expect(resolveExpr('json:{"price":"$5","x":"$nope.y"}', $vars)).toEqual({ price: "$5", x: "$nope.y" });
  });
});
