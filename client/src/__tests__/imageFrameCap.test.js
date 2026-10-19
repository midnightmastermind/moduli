// @vitest-environment jsdom
// UI sweep 52: an image on its own page is capped to the PANEL's height, not the window's.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { imageFrameCap } from "../modules/ArtifactContent.jsx";

describe("imageFrameCap", () => {
  it("fits a half-height panel (the measured 354px pane leaves room for the controls)", () => {
    expect(imageFrameCap(354)).toBe("322px");
  });
  it("never shrinks below 160px nor grows past 800px", () => {
    expect(imageFrameCap(100)).toBe("160px");
    expect(imageFrameCap(2000)).toBe("800px");
  });
  it("keeps the old window cap until the pane has been measured", () => {
    expect(imageFrameCap(0)).toBe("min(70vh, 800px)");
  });
  it("the image page uses it, not the bare 70vh cap", () => {
    const src = readFileSync(path.join(__dirname, "..", "modules/ArtifactContent.jsx"), "utf8");
    expect(src).toMatch(/maxHeight: imageFrameCap\(paneH\)/);
    expect(src).not.toMatch(/maxHeight: "min\(70vh, 800px\)"/);
  });
});
