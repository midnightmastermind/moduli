import { describe, it, expect } from "vitest";
import { tileKindsForRole, tileMeta, ALLOWED_KINDS_BY_ROLE } from "../ui/QuickAddMenu.jsx";

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

  it("instance → every occurrence type: leaves, all 4 nested containers, all 4 pages", () => {
    expect(tileKindsForRole("instance")).toEqual([
      "instance", "textblock", "artifact", "image",
      "board", "doc", "table", "canvas",
      "page-board", "page-doc", "page-table", "page-canvas",
    ]);
  });
});

describe("tileMeta — container vs page labels", () => {
  it("inside a container, the bare kinds read as CONTAINERS (they sit next to page tiles)", () => {
    expect(tileMeta("board", "instance").label).toBe("Board container");
    expect(tileMeta("canvas", "instance").label).toBe("Canvas container");
  });

  it("page tiles are labelled as pages", () => {
    expect(tileMeta("page-board", "instance").label).toBe("Board page");
    expect(tileMeta("page-table", "instance").label).toBe("Table page");
  });

  it("other roles offer only one of the two, so labels stay short", () => {
    expect(tileMeta("board", "page").label).toBe("Board");
    expect(tileMeta("doc", "container").label).toBe("Document");
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
