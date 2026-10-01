// A HIDDEN QuickAddMenu opened imperatively positions at its anchor (user,
// 2026-10-01: the manifest folder's "+" "doesnt work at all" — the menu opened
// in the screen's top-left corner, from a display:none button's 0,0 box).
import React, { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

describe("QuickAddMenu anchorRef", () => {
  it("is read in reposition before the menu's own button", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/ui/QuickAddMenu.jsx"), "utf8");
    expect(src).toMatch(/const anchor = anchorRef\?\.current \|\| btnRef\.current/);
  });
  it("both hidden tree menus name their anchor", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/modules/ManifestTree.jsx"), "utf8");
    const hidden = src.split('<div style={{ display: "none" }}>').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
    const menus = hidden.filter((c) => c.includes("<QuickAddMenu"));
    expect(menus.length).toBe(2);
    for (const m of menus) expect(m).toMatch(/anchorRef=\{/);
  });
  // The control: the folder "+" is an icon now, not a typed character.
  it("the folder add button renders the Plus icon", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/modules/ManifestTree.jsx"), "utf8");
    const btn = src.slice(src.indexOf("ref={addBtnRef}"), src.indexOf("</span>", src.indexOf("ref={addBtnRef}")));
    expect(btn).toMatch(/<Plus size=/);
  });
});
