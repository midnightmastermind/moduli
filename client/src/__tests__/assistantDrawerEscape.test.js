// Escape closes Jonah's drawer like every other dialog (UI sweep 2026-10-19) — and leaves a key
// something inside already handled alone. Mounting the drawer needs the grid store; this pins
// the wiring.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(__dirname, "../ui/AssistantDrawer.jsx"), "utf8");
describe("Jonah drawer Escape", () => {
  it("closes on an unhandled Escape while open", () => {
    expect(src).toMatch(/e\.key === "Escape" && !e\.defaultPrevented\) setOpen\(false\)/);
    expect(src).toMatch(/if \(!open\) return undefined;/);
  });
});
