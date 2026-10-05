// The CREATE step editor must be able to author what live CREATEs run on.
//
// Measured 2026-09-28 across every grid: 33 CREATE steps, and the editor offered
// name / role / kind / parent / fields (+hidden) / output vars only. Rebuilding
// `Schedule: Build Schedule` by clicking needs three more, all read by the
// executor (operationActions CREATE):
//   meta               12 steps · 4 ops   (allowChildContainers on a day column)
//   identitySignature   3 steps · 3 ops   (the server refuses a duplicate column)
//   filterOverride      1 step            (the column pins its own date)
// Every one of those was written by a seed; none could be built in the UI.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ActionConfig } from "../blocks/OperationsBuilder";

const fields = [{ id: "fDate", name: "Date", type: "date" }];
const base = { fields, varOptions: [], localVars: [], modulesById: {}, occurrencesById: {}, fieldsById: { fDate: fields[0] }, operationsById: {}, sources: [] };
const mount = (cfg, setCfg = vi.fn()) => ({ setCfg, ...render(<ActionConfig actionType="CREATE" cfg={cfg} setCfg={setCfg} {...base} />) });

describe("CREATE editor authors meta / identitySignature / filterOverride", () => {
  it("shows a stored identitySignature and writes an edited one", () => {
    const { container, setCfg } = mount({ identitySignature: "schedule:col:${$day}" });
    const inp = [...container.querySelectorAll("input")].find((i) => i.value === "schedule:col:${$day}");
    expect(inp).toBeTruthy();
    fireEvent.change(inp, { target: { value: "daypage:col:${$day}" } });
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ identitySignature: "daypage:col:${$day}" }));
  });

  it("shows a stored meta entry and writes an edited value as an OBJECT", () => {
    const { container, setCfg } = mount({ meta: { allowChildContainers: "true" } });
    const key = [...container.querySelectorAll("input")].find((i) => i.value === "allowChildContainers");
    expect(key).toBeTruthy();
    const val = [...container.querySelectorAll("input")].find((i) => i.value === "true");
    fireEvent.change(val, { target: { value: "false" } });
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ meta: { allowChildContainers: "false" } }));
  });

  it("adds a meta entry", () => {
    const { getByText, setCfg } = mount({});
    fireEvent.click(getByText("+ meta"));
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ meta: { "": "" } }));
  });

  it("shows a stored filterOverride per field, separate from `fields`", () => {
    const { container } = mount({ filterOverride: { fDate: "$day" }, fields: {} });
    expect(container.textContent).toContain("filter override");
    // "$day" opens ExprOrPath in PATH mode — a chip, not a text box — the same
    // as the fields map above it. `fields` is empty, so this chip is the override's.
    expect(container.textContent).toContain("$day");
  });

  it("CONTROL: the existing fields map still renders", () => {
    const { container } = mount({ fields: { fDate: "$day" } });
    expect(container.textContent).toContain("attach fields");
  });
});

// The share rules run on the SERVER executor, whose CREATE reads more keys.
// Measured 2026-10-05 across every grid: parentFolderId 4 ops, fieldsFrom 4,
// moduleFileRef 4, source 4, moduleRole/moduleKind 3, attachFields 2,
// bindingsLike 2, moduleMeta 2, mergeInto 1 — all seed-written.
describe("CREATE editor authors the server's share-rule keys", () => {
  it("a stored key opens the section and shows its value", () => {
    const { container } = mount({ moduleFileRef: "literal:https://example.com" });
    const det = container.querySelector("details");
    expect(det.open).toBe(true);
    expect(container.textContent).toContain("file / url");
  });

  it("a step with none of them keeps the section collapsed", () => {
    const { container } = mount({ name: "x" });
    expect(container.querySelector("details").open).toBe(false);
  });

  it("offers the bookmark kind a shared link is stored as", () => {
    const { container } = mount({ kind: "bookmark" });
    const sel = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "doc"));
    expect(sel.value).toBe("bookmark");
  });

  it("a meta stored as an EXPRESSION is edited as one, not as an empty map", () => {
    const { container } = mount({ meta: "$share.clip.meta" });
    expect(container.querySelector("details").open).toBe(true);
    expect(container.textContent).toContain("meta from");
    expect(container.textContent).not.toContain("+ meta\u0020");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "+ meta")).toBe(false);
  });

  it("a NEW step can author meta as an expression (the row is always in the section)", () => {
    const { container } = mount({});
    expect(container.textContent).toContain("meta from");
  });

  it("removing an attached field writes the rest", () => {
    const { container, setCfg } = mount({ attachFields: ["fDate", "other"] });
    expect(container.textContent).toContain("Date");
    const x = [...container.querySelectorAll("button")].filter((b) => b.title === "remove")[0];
    fireEvent.click(x);
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ attachFields: ["other"] }));
  });

  it("module meta is a map under its own key", () => {
    const { getByText, setCfg } = mount({});
    fireEvent.click(getByText("+ module meta"));
    expect(setCfg).toHaveBeenCalledWith(expect.objectContaining({ moduleMeta: { "": "" } }));
  });
});
