// The copy step's editor can write what live copy steps carry: `linked:false`
// (1 step), `fields` (7) and `fieldHidden` (6) — none was settable (2026-10-03).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema";

describe("COPY_LINK schema", () => {
  const f = Object.fromEntries(ACTION_CONFIG_SCHEMA.COPY_LINK.fields.map((x) => [x.key, x]));
  it("offers linked, default on (the executor's `cfg.linked !== false`)", () => {
    expect(f.linked).toMatchObject({ kind: "bool", defaultValue: true });
  });
  it("offers the fields map", () => { expect(f.fields.kind).toBe("fieldMap"); });
  it("the renderer draws a fieldMap with the CREATE step's editor, which also writes fieldHidden", () => {
    const src = fs.readFileSync(path.join(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
    expect(src).toMatch(/case "fieldMap":\s*return <FieldsMapEditor cfg=\{cfg\} setCfg=\{setCfg\} fields=\{fields\} exprProps=\{exprProps\} mapKey=\{key\}/);
    expect(src).toMatch(/function FieldVisibilityToggle[\s\S]{0,400}setCfg\(\{ fieldHidden:/);
  });
});
