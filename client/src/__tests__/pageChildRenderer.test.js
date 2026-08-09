// A page can host ANY module role — `getPageChildrenModules` applies no role
// filter and ModulePage's own comment says as much. But `PageBoard` handed
// EVERY child to `ModuleContainer`, which never inspects its own role (grep:
// zero references to `module.role` in 1600 lines) and so always draws container
// chrome. An artifact dropped straight onto a board page therefore rendered as
// an EMPTY container shell wearing the file's name.
//
// User, 2026-08-09: "a board page can hold artifacts. as occurances in the
// page. so would canvases." Right on both counts — and `PageCanvas` already did
// exactly this ("Leaf-role routing mirrors ModuleContainer's child loop"). The
// board page was the one surface missing it.
import { describe, it, expect } from "vitest";
import { pageChildRenderer } from "../modules/pages/PageBoard.jsx";

describe("pageChildRenderer — what renders a page's direct child", () => {
  it("routes LEAF roles to an instance shell, so they render as themselves", () => {
    // These are the roles that were coming out as empty container shells.
    expect(pageChildRenderer("artifact")).toBe("instance");
    expect(pageChildRenderer("textblock")).toBe("instance");
    expect(pageChildRenderer("instance")).toBe("instance");
  });

  it("still routes containers to Container", () => {
    expect(pageChildRenderer("container")).toBe("container");
  });

  it("leaves a nested PAGE on the old path", () => {
    // Rendering a nested page as a real page is the layout cascade's job (#45);
    // changing it here would be a second, unrelated behaviour change.
    expect(pageChildRenderer("page")).toBe("container");
  });

  it("treats a role-less child as legacy and keeps today's behaviour", () => {
    // Pre-role data must not suddenly start rendering differently.
    expect(pageChildRenderer(undefined)).toBe("container");
    expect(pageChildRenderer(null)).toBe("container");
    expect(pageChildRenderer("")).toBe("container");
  });
});
