import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolbarClock from "../ui/ToolbarClock";
import fs from "node:fs";
import path from "node:path";

describe("ToolbarClock", () => {
  it("shows the date and the time", () => {
    render(<ToolbarClock now={new Date(2026, 9, 27, 9, 5)} />);
    const text = screen.getByTestId("toolbar-clock").textContent;
    expect(text).toMatch(/Tuesday, October 27/);
    expect(text).toMatch(/27/);
    expect(text).toMatch(/9:05/);
  });
  it("is mounted in the toolbar's desktop cluster", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../Toolbar.jsx"), "utf8");
    expect(src).toMatch(/<ToolbarClock \/>/);
  });
});
