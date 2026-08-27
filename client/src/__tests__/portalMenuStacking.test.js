// __tests__/portalMenuStacking.test.js
//
// A menu opened FROM a popover must paint ABOVE it.
//
// That was violated by exactly one: `DrilldownPicker` sat at 9999 against the
// settings sheet's 10000, so "Add field" opened a dropdown behind the sheet that
// mounted it (user, 2026-08-27). The numbers lived in two files, so nothing
// could have caught it but someone looking.
//
// These assert the RELATIONSHIP, not the values — raising the popover moves the
// menus with it and this stays green.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Z_POPOVER, Z_PORTAL_MENU } from "../helpers/zLayers";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");

// Every surface that portals a MENU to document.body and can be opened from a
// popover. Adding one here without wiring the constant is the failure.
const PORTAL_MENUS = [
  "ui/DrilldownPicker.jsx",
  "ui/ActionPicker.jsx",
  "ui/ContainerKindSelector.jsx",
];

describe("portalled menu stacking", () => {
  it("a portalled menu outranks the popover it is opened from", () => {
    expect(Z_PORTAL_MENU).toBeGreaterThan(Z_POPOVER);
  });

  it("the popover level is declared in zLayers, not inline in popover.jsx", () => {
    const src = read("components/ui/popover.jsx");
    expect(src).toContain("Z_POPOVER");
    // The literal Tailwind class is what drifted away from the menus.
    expect(src).not.toMatch(/z-\[\d+\]/);
  });

  for (const file of PORTAL_MENUS) {
    it(`${file} takes its level from zLayers`, () => {
      const src = read(file);
      expect(src).toContain("Z_PORTAL_MENU");
    });

    // The discriminating case: the ORIGINAL defect is a hardcoded level at or
    // below the popover's. A file that reintroduces one fails here even though
    // it also imports the constant.
    it(`${file} hardcodes no stacking level that loses to a popover`, () => {
      const src = read(file);
      const levels = [
        ...[...src.matchAll(/zIndex:\s*(\d{3,})/g)].map((m) => Number(m[1])),
        ...[...src.matchAll(/z-\[(\d{3,})\]/g)].map((m) => Number(m[1])),
      ];
      const losing = levels.filter((n) => n <= Z_POPOVER);
      expect(losing).toEqual([]);
    });
  }
});
