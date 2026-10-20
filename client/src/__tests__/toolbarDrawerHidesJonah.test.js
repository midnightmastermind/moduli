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
    expect(css).toMatch(/body:has\(\[data-toolbar-drawer\]\) \.assistant-fab[,\s]/);
  });
});

describe("Command Center", () => {
  const cc = fs.readFileSync(path.resolve(__dirname, "../ui/CommandCenter.jsx"), "utf8");
  it("fills the phone screen below the toolbar, and Jonah's button steps aside while it is open", () => {
    expect(cc).toMatch(/CC_MAX_H = isMobileLayout \? "calc\(100dvh - 48px\)"/);
    expect(cc).toMatch(/data-cc-open=\{shown \? "" : undefined\}/);
    expect(css).toMatch(/body:has\(\[data-cc-open\]\) \.assistant-fab \{ display: none !important; \}/);
  });
});
