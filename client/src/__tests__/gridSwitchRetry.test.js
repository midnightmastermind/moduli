// A grid switch re-asked every 8s, and a big grid takes longer than that to arrive. It waits longer each time now, and
// says what is happening: "Retrying..." read as a failure while the grid was simply still on its way.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { gridSwitchRetryDelay } from "../helpers/gridSwitchRetry";

describe("gridSwitchRetryDelay", () => {
  it("waits longer each time, up to a minute", () => {
    expect(gridSwitchRetryDelay(0)).toBe(15000);
    expect(gridSwitchRetryDelay(1)).toBe(30000);
    expect(gridSwitchRetryDelay(2)).toBe(60000);
    expect(gridSwitchRetryDelay(9)).toBe(60000);
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(`${process.cwd()}/src/App.jsx`, "utf8");
  it("App uses it and no longer re-asks on a fixed interval", () => {
    expect(src).toMatch(/gridSwitchRetryDelay\(/);
    expect(src).not.toMatch(/\}, 8000\);/);
  });
  it("the overlay says the grid is on its way", () => {
    expect(src).toMatch(/Still loading this grid/);
    expect(src).not.toMatch(/Retrying\.\.\.\s*<\/div>/);
  });
});
