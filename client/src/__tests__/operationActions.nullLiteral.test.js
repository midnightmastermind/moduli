import { describe, it, expect } from "vitest";
import { resolveExpr, executeActionItem } from "../helpers/operationActions";

describe("resolveExpr null literal", () => {
  it("returns JS null for the string 'literal:null'", () => {
    expect(resolveExpr("literal:null", {})).toBe(null);
  });

  it("returns JS null when given JS null directly (no string wrapping)", () => {
    expect(resolveExpr(null, {})).toBe(null);
  });

  it("returns JS null when expr is the empty string", () => {
    expect(resolveExpr("", {})).toBe(null);
  });
});

describe("UPDATE accepts JS null as cfg.value", () => {
  it("UPDATE with cfg.value === null writes null through applyUpdate to a $var", () => {
    const $vars = { $myField: "old value" };
    const occurrencesById = {};
    const ctx = { state: {}, occurrencesById, fieldsById: {} };
    executeActionItem("UPDATE", { path: "$myField", value: null }, $vars, ctx, {});
    expect($vars.$myField).toBe(null);
  });
});
