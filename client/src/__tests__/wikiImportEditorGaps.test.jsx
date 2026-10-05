// The keys poms' "Import from Wikipedia" runs on — GET_USER_INPUT title/options,
// CALL_API headers (and an OBJECT body), SHOW_VALUE's result name — were
// seed-written and had no editor (2026-10-05, "there should be no hidden setting").
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema.js";
import { KeyValueEditor, OptionRowsEditor } from "../blocks/OperationsBuilder.jsx";

const keyOf = (a, k) => ACTION_CONFIG_SCHEMA[a].fields.find((f) => f.key === k);

describe("schema declares the keys the executor reads", () => {
  it("GET_USER_INPUT: title + options", () => {
    expect(keyOf("GET_USER_INPUT", "title")?.kind).toBe("text");
    expect(keyOf("GET_USER_INPUT", "options")?.kind).toBe("options");
  });
  it("CALL_API: headers, query, body as key/value (body may stay an expression)", () => {
    expect(keyOf("CALL_API", "headers")?.kind).toBe("kv");
    expect(keyOf("CALL_API", "query")?.kind).toBe("kv");
    expect(keyOf("CALL_API", "body")).toMatchObject({ kind: "kv", orExpr: true });
  });
  it("SHOW_VALUE's editor offers the result name", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../blocks/OperationsBuilder.jsx"), "utf8");
    const block = src.slice(src.indexOf('case "SHOW_VALUE":'), src.indexOf('case "AGGREGATE":'));
    expect(block).toMatch(/varNameInput\("name"/);
    expect(block).toMatch(/targetFieldId/); // control: it is the SHOW_VALUE editor
  });
});

describe("KeyValueEditor", () => {
  it("shows a stored object as rows, never [object Object]", () => {
    render(<KeyValueEditor value={{ "Content-Type": "application/json" }} onChange={() => {}} label="header" />);
    expect(screen.getByDisplayValue("Content-Type")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/object Object/);
  });
  it("writes a plain object, and an emptied map as undefined", () => {
    const onChange = vi.fn();
    render(<KeyValueEditor value={{ a: "1" }} onChange={onChange} label="header" />);
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "Accept" } });
    expect(onChange).toHaveBeenLastCalledWith({ Accept: "1" });
    fireEvent.click(screen.getByLabelText("remove header row"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("OptionRowsEditor", () => {
  it("reads {value,label} rows and plain strings", () => {
    render(<OptionRowsEditor value={[{ value: "create", label: "Create new page" }, "append"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("Create new page")).toBeTruthy();
    expect(screen.getAllByDisplayValue("append")).toHaveLength(2);
  });
  it("writes [{value,label}]", () => {
    const onChange = vi.fn();
    render(<OptionRowsEditor value={[{ value: "a", label: "A" }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "Alpha" } });
    expect(onChange).toHaveBeenLastCalledWith([{ value: "a", label: "Alpha" }]);
  });
});
