// The SCROLL_TO effect opens the long list holding its row only when a USER's action applied it (a button press →
// form → Create on a virtualized board left the new row unmounted, so nothing scrolled — 2026-10-25). An automatic run
// (no action open) keeps expandWindows off: the on-load "scroll to now" once opened every long list (2026-09-26).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../state/bindSocketToStore.js", import.meta.url), "utf8");
const block = src.slice(src.indexOf('case "SCROLL_TO": {'), src.indexOf('case "SET_FILTER": {'));

describe("SCROLL_TO effect", () => {
  it("expands only for a gesture", () => {
    expect(block).toMatch(/const fromGesture = !!getActionId\(\);/);
    expect(block).toMatch(/expandWindows: fromGesture/);
    expect(block).not.toMatch(/expandWindows: (true|false)/);
  });
  it("still yields to a user who takes over (control)", () => {
    expect(block).toMatch(/isUserBusy/);
  });
});
