// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readOpenSpread, saveOpenSpread, clearOpenSpread } from "../helpers/spreadRestore";
import { isTypingTarget } from "../ui/ArtifactSpread.jsx";

describe("the open viewer is remembered per grid", () => {
  beforeEach(() => localStorage.clear());
  it("saves, reads back and clears", () => {
    saveOpenSpread("g1", { occurrenceId: "o1", panelId: "p1", maxId: "o1" });
    expect(readOpenSpread("g1")).toEqual({ occurrenceId: "o1", panelId: "p1", maxId: "o1" });
    expect(readOpenSpread("g2")).toBeNull();
    clearOpenSpread("g1");
    expect(readOpenSpread("g1")).toBeNull();
  });
  it("ignores junk and missing grids", () => {
    localStorage.setItem("moduli-open-viewer:g1", "{not json");
    expect(readOpenSpread("g1")).toBeNull();
    expect(readOpenSpread(null)).toBeNull();
    saveOpenSpread("g1", {});
    expect(readOpenSpread("g1")).toBeNull();
  });
});

describe("Shift does not fade the viewer while typing", () => {
  it("text inputs, textareas and editable text count as typing", () => {
    const input = document.createElement("input");
    const ta = document.createElement("textarea");
    const div = document.createElement("div"); div.setAttribute("contenteditable", "true");
    const inner = document.createElement("span"); div.appendChild(inner); document.body.appendChild(div);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(ta)).toBe(true);
    expect(isTypingTarget(inner)).toBe(true);
  });
  it("buttons, checkboxes and the page itself do not", () => {
    const cb = document.createElement("input"); cb.type = "checkbox";
    expect(isTypingTarget(cb)).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });
});
