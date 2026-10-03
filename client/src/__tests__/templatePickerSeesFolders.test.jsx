// The APPLY_TEMPLATE step's template picker lists the children of the grid's
// protected Templates folder — which it can only find with `foldersById` and
// `gridId`. 2026-10-03: building `Project: Create` by clicking, "Saved
// templates" was EMPTY on a grid with three templates: the builder held both
// values in `shared`, but ActionStep never destructured them and ActionConfig
// never took them, so every action-step picker ran without folders.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";

const seen = [];
vi.mock("../ui/DrilldownPicker", () => ({ default: (p) => { seen.push(p); return null; }, DrilldownPicker: (p) => { seen.push(p); return null; } }));

const { ActionConfig } = await import("../blocks/OperationsBuilder");
const { TEMPLATE_PICKER_CONFIG } = await import("../ui/categoryRegistry");

const G = "g1";
const foldersById = { tf: { id: "tf", gridId: G, name: "Templates", meta: { protected: true } } };
const modulesById = { m1: { id: "m1", role: "page", kind: "board", label: "Project: {ProjectName}" } };
const occurrencesById = { t1: { id: "t1", moduleId: "m1", parentId: "tf" } };
const base = { fields: [], varOptions: [], localVars: [], modulesById, occurrencesById, fieldsById: {}, operationsById: {}, sources: [] };
const templates = (ctx) => TEMPLATE_PICKER_CONFIG.categories.find((c) => c.id === "templates").resolveItems(ctx);

describe("APPLY_TEMPLATE template picker", () => {
  it("lists the grid's templates when the editor is given its folders", () => {
    seen.length = 0;
    render(<ActionConfig actionType="APPLY_TEMPLATE" cfg={{}} setCfg={vi.fn()} {...base} foldersById={foldersById} gridId={G} />);
    const picker = seen.find((p) => p.config === TEMPLATE_PICKER_CONFIG);
    expect(picker).toBeTruthy();
    expect(templates(picker.ctx).map((t) => t.title)).toEqual(["Project: {ProjectName}"]);
  });
  it("CONTROL: without folders the same picker is empty (what the editor used to hand it)", () => {
    expect(templates({ ...base })).toEqual([]);
  });
  it("ActionStep forwards foldersById and gridId to ActionConfig", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
    const step = src.slice(src.indexOf("function ActionStep("), src.indexOf("export function ActionConfig("));
    expect(step.split("\n")[0]).toContain("foldersById = {}, gridId = null }");
    expect(step).toMatch(/<ActionConfig[^>]*foldersById=\{foldersById\}[^>]*gridId=\{gridId\}/);
  });
});

// The first fix covered a top-level step only. The Project: Create step that
// found it sits in an IF's `then`, and IfStep rebuilt `shared` without the two
// values — so a nested step still got an empty picker. Every component that
// renders a nested StepsList must pass them on.
describe("nested step lists keep the folders", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
  for (const name of ["IfStep", "LoopStep"]) {
    it(`${name} forwards foldersById and gridId to its nested steps`, () => {
      const start = src.indexOf(`function ${name}(`);
      const body = src.slice(start, src.indexOf("\nfunction ", start + 10));
      expect(body.split("\n")[0]).toContain("foldersById = {}, gridId = null");
      expect(body).toMatch(/const shared = \{[^}]*foldersById, gridId \};/);
      expect(body).toContain("<StepsList");
    });
  }
});
