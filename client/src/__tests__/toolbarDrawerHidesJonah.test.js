// UI sweep 2026-10-19 (row 1, phone): Jonah's floating button sat on the toolbar menu's
// User Settings / Log out rows. It steps aside while the menu is open, as it does for sheets.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const tb = fs.readFileSync(path.resolve(__dirname, "../Toolbar.jsx"), "utf8");
describe("phone toolbar menu", () => {
  it("marks its drawer and hides Jonah's button while it is open", () => {
    expect(tb).toMatch(/data-toolbar-drawer/);
    expect(css).toMatch(/body:has\(\[data-toolbar-drawer\]\) \.assistant-fab \{ display: none !important; \}/);
  });
});
