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

  it("instance → generic Item, plus Textblock only when onAddTextblock is wired", () => {
    expect(tileKindsForRole("instance")).toEqual(["instance"]);
    expect(tileKindsForRole("instance", { hasTextblock: true })).toEqual(["instance", "textblock"]);
  });

  it("instance never offers a blank Artifact create tile (artifacts are uploaded)", () => {
    expect(tileKindsForRole("instance", { hasTextblock: true })).not.toContain("artifact");
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
