// The APPLY_TEMPLATE step editor must author what the executor reads.
//
// Measured 2026-09-28: 20 live APPLY_TEMPLATE steps. The executor reads
// templateRef, targetOccurrenceVar, mode, unwrapRoot, defaultFields,
// replacements, rootParent, rootLabel, rootSignature (and rootIdVar); the editor
// authored the first four and a result var. Every day-column / day-page builder
// uses the rest — `Schedule: Build Schedule` stamps each cloned routine row
// `Date = $day` via defaultFields, and `Day Page: Build` signs its column with
// rootSignature. The template picker also offered no local vars, so
// `templateRef: "$tplInstId"` (a loop's item) could not be picked.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ActionConfig } from "../blocks/OperationsBuilder";
import { TEMPLATE_PICKER_CONFIG } from "../ui/categoryRegistry";

const fields = [{ id: "fDate", name: "Date", type: "date" }];
const base = { fields, varOptions: [], localVars: ["$tplInstId"], modulesById: {}, occurrencesById: {}, fieldsById: { fDate: fields[0] }, operationsById: {}, sources: [] };
const mount = (cfg, setCfg = vi.fn()) => ({ setCfg, ...render(<ActionConfig actionType="APPLY_TEMPLATE" cfg={cfg} setCfg={setCfg} {...base} />) });
const inputWith = (c, v) => [...c.querySelectorAll("input")].find((i) => i.value === v);

describe("APPLY_TEMPLATE editor", () => {
  it("shows stored defaultFields (the per-clone stamp)", () => {
    const { container } = mount({ defaultFields: { fDate: "literal:2026-09-28" } });
    expect(container.textContent).toContain("stamp fields on every clone");
    expect(inputWith(container, "literal:2026-09-28")).toBeTruthy();
  });
  it("shows and edits rootSignature", () => {
    const { container, setCfg } = mount({ rootSignature: "daypage:col:${$day}" });
    fireEvent.change(inputWith(container, "daypage:col:${$day}"), { target: { value: "x:${$day}" } });
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ rootSignature: "x:${$day}" }));
  });
  it("shows rootLabel, rootIdVar and a replacement", () => {
    const { container } = mount({ rootLabel: "literal:Day", rootIdVar: "$colId", replacements: { "{Date}": "literal:today" } });
    expect(inputWith(container, "literal:Day")).toBeTruthy();
    expect(container.textContent).toContain("replace text tokens");
    expect(inputWith(container, "{Date}")).toBeTruthy();
  });
  it("offers a local var as the template (a loop's item)", () => {
    const cat = TEMPLATE_PICKER_CONFIG.categories.find((c) => c.id === "localVars");
    expect(cat?.resolveItems({ localVars: ["$tplInstId"] }).map((i) => i.value)).toContain("$tplInstId");
  });
  it("CONTROL: mode still renders", () => {
    const { container } = mount({ mode: "merge" });
    expect(container.textContent).toContain("mode:");
  });
});
