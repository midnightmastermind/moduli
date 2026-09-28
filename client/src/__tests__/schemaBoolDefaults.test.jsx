// A schema checkbox must show what the executor will DO with an unset value.
//
// The bool renderer read `cfg[key] === true`, so an absent key showed UNCHECKED.
// Two executor bools default ON: COPY_LINK `recursive` (`cfg.recursive !==
// false`) and DATE_DIFF `perOccurrence` (`= true`). Measured 2026-09-28: 16 of
// 19 live COPY_LINK steps leave `recursive` unset — each displayed "include
// children: off" while copying the children. The walker pairs every schema bool
// with how the executor defaults it, so a new one cannot drift the same way.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, fireEvent } from "@testing-library/react";
import { ActionConfig } from "../blocks/OperationsBuilder";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema";

const exec = fs.readFileSync(path.resolve(__dirname, "../helpers/operationActions.js"), "utf8");
const defaultsOnInExecutor = (k) => new RegExp(`cfg\\.${k}\\s*!==\\s*false|\\b${k}\\s*=\\s*true\\b`).test(exec);
const props = { fields: [], varOptions: [], localVars: [], modulesById: {}, occurrencesById: {}, fieldsById: {}, operationsById: {}, sources: [] };
const box = (c) => [...c.querySelectorAll('input[type="checkbox"]')].find((i) => (i.closest("label")?.textContent || "").includes("include children"));

describe("schema bool defaults match the executor", () => {
  it("every schema bool declares the default the executor applies", () => {
    const wrong = [];
    for (const [action, schema] of Object.entries(ACTION_CONFIG_SCHEMA)) {
      for (const f of schema.fields || []) {
        if (f.kind !== "bool") continue;
        if (defaultsOnInExecutor(f.key) !== (f.defaultValue === true)) wrong.push(`${action}.${f.key}`);
      }
    }
    expect(wrong).toEqual([]);
  });
  it("COPY_LINK with recursive unset shows include children CHECKED", () => {
    const { container } = render(<ActionConfig actionType="COPY_LINK" cfg={{}} setCfg={vi.fn()} {...props} />);
    expect(box(container).checked).toBe(true);
  });
  it("unticking it stores the explicit false the executor checks for", () => {
    const setCfg = vi.fn();
    const { container } = render(<ActionConfig actionType="COPY_LINK" cfg={{}} setCfg={setCfg} {...props} />);
    fireEvent.click(box(container));
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ recursive: false }));
  });
  it("CONTROL: an explicit false shows unchecked", () => {
    const { container } = render(<ActionConfig actionType="COPY_LINK" cfg={{ recursive: false }} setCfg={vi.fn()} {...props} />);
    expect(box(container).checked).toBe(false);
  });
});
