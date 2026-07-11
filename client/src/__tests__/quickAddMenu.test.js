import { describe, it, expect } from "vitest";
import { tileKindsForRole, ALLOWED_KINDS_BY_ROLE } from "../ui/QuickAddMenu.jsx";

describe("tileKindsForRole — create tiles per role", () => {
  it("container → board/doc/canvas/table", () => {
    expect(tileKindsForRole("container")).toEqual(["board", "doc", "canvas", "table"]);
  });

  it("page → adds folder", () => {
    expect(tileKindsForRole("page")).toEqual(["board", "doc", "canvas", "table", "folder"]);
  });

  it("panel → board only", () => {
    expect(tileKindsForRole("panel")).toEqual(["board"]);
  });

  it("instance → full child palette: Item, Textblock, nested containers, Artifact upload, Image search", () => {
    expect(tileKindsForRole("instance")).toEqual(["instance", "textblock", "board", "doc", "table", "canvas", "artifact", "image"]);
  });
});

describe("ALLOWED_KINDS_BY_ROLE — existing-match filter", () => {
  it("scopes which kinds show in the existing-matches list per role", () => {
    expect(ALLOWED_KINDS_BY_ROLE.container.has("doc")).toBe(true);
    expect(ALLOWED_KINDS_BY_ROLE.container.has("folder")).toBe(false);
    expect(ALLOWED_KINDS_BY_ROLE.page.has("folder")).toBe(true);
    expect(ALLOWED_KINDS_BY_ROLE.instance.has("artifact")).toBe(true);
  });
});

import { menuPosition } from "../ui/QuickAddMenu.jsx";

describe("menuPosition (anchor-relative placement)", () => {
  it("opens below the anchor by default", () => {
    const rect = { top: 100, bottom: 120, left: 50 };
    expect(menuPosition(rect, 1280, 800)).toEqual({ top: 122, left: 50 });
  });
  it("clamps left so the 260px menu stays on-screen", () => {
    const rect = { top: 100, bottom: 120, left: 1200 };
    expect(menuPosition(rect, 1280, 800).left).toBe(1280 - 260 - 8);
  });
  it("flips ABOVE the anchor when the menu would overflow the bottom", () => {
    const rect = { top: 700, bottom: 720, left: 50 };
    const pos = menuPosition(rect, 1280, 780);
    expect(pos.top).toBe(700 - 2 - 360);
  });
  it("never goes above the top edge when flipping", () => {
    const rect = { top: 40, bottom: 60, left: 50 };
    const pos = menuPosition(rect, 400, 300); // too small either way
    expect(pos.top).toBeGreaterThanOrEqual(4);
  });
});
