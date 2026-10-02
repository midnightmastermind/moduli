// A step setting that names a FIELD is a picker, never a text box (2026-10-02:
// DATE_DIFF and seven others asked the author to type a raw field id, so
// "Days Until Due" could not be built by clicking).
import { describe, test, expect } from "vitest";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema";
import fs from "node:fs";
import path from "node:path";

describe("schema field-id keys", () => {
  const all = Object.entries(ACTION_CONFIG_SCHEMA).flatMap(([a, s]) => (s.fields || []).map((f) => ({ a, ...f })));
  test("every key that holds a field id is kind:'field'", () => {
    const ids = all.filter((f) => /(^f|F)ieldId$/.test(f.key));
    expect(ids.length).toBeGreaterThanOrEqual(8);   // control: the detector sees them
    expect(ids.filter((f) => f.kind !== "field").map((f) => `${f.a}.${f.key}`)).toEqual([]);
  });
  test("the renderer draws kind:'field' as the searchable FieldSelect", () => {
    const src = fs.readFileSync(path.join(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
    const at = src.indexOf('case "field":');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 700)).toMatch(/<FieldSelect/);
  });
});
