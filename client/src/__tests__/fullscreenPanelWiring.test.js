import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The full-screen copy of a panel must get dispatch + socket like the grid's
// own copy, or every editor inside it silently skips its save (2026-10-02).
describe("full-screen panel wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../Grid.jsx"), "utf8");
  const overlay = src.slice(src.indexOf("<FullscreenOverlay"), src.indexOf("/>", src.indexOf("<FullscreenOverlay")));
  it("finds the overlay (control)", () => { expect(overlay.length).toBeGreaterThan(20); });
  it("passes dispatch and socket through panelProps", () => {
    expect(overlay).toMatch(/panelProps=\{\{[^}]*\bdispatch\b/);
    expect(overlay).toMatch(/panelProps=\{\{[^}]*\bsocket\b/);
  });
});
