// A FULL-SCREEN PANEL HID EVERY POPOVER OPENED INSIDE IT (2026-10-09).
// The overlay sat at z-index 999999 while QuickAddMenu's palette portals to <body>
// at 1100, HeaderDropdown at 1000, the date picker at 9999, the ask-the-user modal
// at 2000 — so in a full-screen panel the "+" / "Add occurrence here…" palette drew
// BEHIND the overlay and its tiles could not be clicked (found building a doc page
// by clicking: the pick reached nothing and nothing was created). The overlay must
// cover the app chrome (the toolbar) and stay under every popover.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const num = (src, rx) => { const m = src.match(rx); if (!m) throw new Error("pattern not found: " + rx); return Number(m[1]); };

describe("full-screen overlay stacking", () => {
  const overlay = num(read("ui/FullscreenOverlay.jsx"), /data-fullscreen-overlay="true"[\s\S]*?zIndex:\s*([0-9]+)/);
  it("sits above the toolbar", () => {
    expect(overlay).toBeGreaterThan(num(read("Toolbar.jsx"), /zIndex:\s*(998)\b/));
  });
  it.each([
    ["QuickAddMenu", "ui/QuickAddMenu.jsx", /zIndex=\{([0-9]+)\}/],
    ["HeaderDropdown", "ui/HeaderDropdown.jsx", /zIndex=\{([0-9]+)\}/],
    ["NavPickerPopover", "ui/NavPickerPopover.jsx", /zIndex=\{([0-9]+)\}/],
    ["UserInputModal", "ui/UserInputModal.jsx", /zIndex:\s*([0-9]+)/],
  ])("sits below %s", (_n, f, rx) => {
    expect(overlay).toBeLessThan(num(read(f), rx));
  });
});
