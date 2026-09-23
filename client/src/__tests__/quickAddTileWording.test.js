// THE SAME TILE READ TWO DIFFERENT WAYS DEPENDING ON WHERE YOU OPENED THE MENU.
//
// User, 2026-09-23: *"it should use quick add, not a dedicated add container
// button"* → and on measuring, every affordance on a board page ALREADY was
// QuickAddMenu. What differed was the WORDING, which is what made it read as a
// different control (and what made my own probe fall through and click the
// other trigger):
//
//   opened from a CONTAINER   Board container · Doc container · Table container
//   opened from a PAGE        Board · Document · Canvas · Table
//   opened from a PANEL       Board · Document · Canvas · Table · Folder
//
// All three create the same things. The disambiguation existed already — it was
// just scoped to `targetRole === "instance"`, because that is the only menu
// where containers and pages appear side by side. But a user does not learn a
// palette per surface; they learn it once. So the rule is now about WHAT THE
// TILE CREATES, not about which menu happens to be ambiguous:
//
//   creates a container -> "X container"
//   creates a page      -> "X page"
//
// Only the LABEL moves. The `kind` values are untouched — the file's own
// comment records that a "page-folder" kind would persist as an invalid kind on
// the created page, and that hazard is about the value, not the wording.
import { describe, it, expect } from "vitest";
import { tileMeta, tileKindsForRole } from "../ui/QuickAddMenu.jsx";

const labelsFor = (role) => tileKindsForRole(role).map((k) => tileMeta(k, role).label);

describe("quick-add tile wording is the same wherever the menu is opened", () => {
  it("a PAGE's menu names containers as containers", () => {
    const labels = labelsFor("container");
    expect(labels).toEqual(["Board container", "Doc container", "Canvas container", "Table container"]);
  });

  // The control: this menu already read correctly and must not change.
  it("a CONTAINER's menu still names them the same way", () => {
    const labels = labelsFor("instance");
    expect(labels).toContain("Board container");
    expect(labels).toContain("Doc container");
    expect(labels).toContain("Board page");     // its page tiles were already explicit
  });

  it("a PANEL's menu names pages as pages", () => {
    const labels = labelsFor("page");
    expect(labels).toContain("Board page");
    expect(labels).toContain("Folder page");
    expect(labels).not.toContain("Board");      // the bare, ambiguous form is gone
  });

  // Nothing outside the four container kinds / five page kinds should acquire a
  // suffix — "Item", "Textblock", "Wikipedia" are not containers or pages.
  it("leaves the non-container, non-page tiles alone", () => {
    expect(tileMeta("instance", "instance").label).toBe("Item");
    expect(tileMeta("textblock", "instance").label).toBe("Textblock");
    expect(tileMeta("image", "instance").label).toBe("Image");
    expect(tileMeta("wikipedia", "page").label).toBe("Wikipedia");
  });

  // The KIND is the thing that gets persisted; only wording was meant to move.
  it("does not change which kinds each role creates", () => {
    expect(tileKindsForRole("container")).toEqual(["board", "doc", "canvas", "table"]);
    expect(tileKindsForRole("page")).toEqual(["board", "doc", "canvas", "table", "folder", "wikipedia"]);
    expect(tileKindsForRole("panel")).toEqual(["board"]);
  });
});
