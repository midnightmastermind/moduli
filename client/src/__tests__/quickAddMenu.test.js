import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("instance → every occurrence type: leaves, all 4 nested containers, all 5 nested pages (incl. folder)", () => {
    expect(tileKindsForRole("instance")).toEqual([
      "instance", "textblock", "artifact", "image",
      "board", "doc", "table", "canvas",
      "page-board", "page-doc", "page-table", "page-canvas", "page-folder",
    ]);
  });
});

// Task 4 — one create-page menu, Folder page included.
//
// CORRECTION vs the task brief's literal test snippet: the brief asserted
// `tileKindsForRole("page")).toContain("page-folder")` — but `page` role
// already offers a bare "folder" tile (since 2026-06-28, confirmed via
// `git blame`) that `ModulePanel`'s `handlePanelCreatePage({kind})` consumes
// DIRECTLY (no "page-" prefix stripping happens on that path — only
// `CommitHelpers.createChildInContainer`, the CONTAINER/instance-role path,
// strips it). Adding a *second*, "page-"-prefixed tile to the `page` role
// would reach that same unstripped path and persist a literal
// `kind: "page-folder"` on the created page — a real, shippable bug, not a
// hypothetical. The actual gap (mirroring "the tree offered it and the panel
// did not") is that a CONTAINER's add-child menu offers nested
// page-board/doc/table/canvas but no nested page-folder. Tests below target
// `"instance"` (the container role) accordingly; `page` role is asserted to
// keep its existing (unprefixed) kinds untouched.
describe("create-page menu parity (page-folder)", () => {
  it("offers Folder page as a nested page — the container menu had page-board/doc/table/canvas but no page-folder", () => {
    expect(tileKindsForRole("instance")).toContain("page-folder");
  });

  it("labels it", () => {
    expect(tileMeta("page-folder", "page").label).toBe("Folder page");
  });

  it("still offers every other nested page kind", () => {
    for (const k of ["page-board", "page-doc", "page-table", "page-canvas"]) {
      expect(tileKindsForRole("instance")).toContain(k);
    }
  });

  it("page role is unchanged — still its own bare folder tile, no duplicate page-folder", () => {
    expect(tileKindsForRole("page")).toEqual(["board", "doc", "canvas", "table", "folder"]);
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

describe("open-state reporting", () => {
  // A menu that unmounts while open used to leave its host stuck in the
  // forced-open state — that is what pinned the blue insert lines on screen.
  it("reports the close when unmounted while open", async () => {
    const React = await import("react");
    const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
    const QuickAddMenu = (await import("../ui/QuickAddMenu.jsx")).default;
    const seen = [];
    const { unmount } = render(
      React.createElement(QuickAddMenu, {
        targetRole: "instance",
        onSelect: () => {},
        onCreateNew: () => {},
        onOpenChange: (v) => seen.push(v),
      })
    );
    fireEvent.click(screen.getByRole("button"));
    expect(seen).toEqual([true]);
    unmount();
    expect(seen).toEqual([true, false]);
    cleanup();
  });

  it("stays silent when unmounted while closed", async () => {
    const React = await import("react");
    const { render, cleanup } = await import("@testing-library/react");
    const QuickAddMenu = (await import("../ui/QuickAddMenu.jsx")).default;
    const seen = [];
    const { unmount } = render(
      React.createElement(QuickAddMenu, {
        targetRole: "instance", onSelect: () => {}, onCreateNew: () => {},
        onOpenChange: (v) => seen.push(v),
      })
    );
    unmount();
    expect(seen).toEqual([]);
    cleanup();
  });
});

// Task 4 Step 5 — template tiles can CREATE a page, not just apply-into-host.
// Each test resets + re-mocks the module graph so QuickAddMenu.jsx picks up a
// fresh GridActionsContext (its own import of the hook is cached otherwise —
// the earlier describe blocks above already loaded the real module statically).
describe("template tiles — create-a-page case (targetRole=\"page\")", () => {
  const foldersById = {
    tf1: { id: "tf1", gridId: "g1", name: "Templates", meta: { protected: true } },
  };
  const modulesById = {
    boardTplMod: { id: "boardTplMod", role: "page", kind: "board" },
  };
  const occurrencesById = {
    boardTplOcc: {
      id: "boardTplOcc", gridId: "g1", moduleId: "boardTplMod", parentId: "tf1",
      meta: { templateName: "Board Template" },
    },
  };
  const gridActionsMockState = {
    modulesById, occurrencesById, foldersById, fieldsById: {}, socket: null,
    state: { grid: { _id: "g1" }, gridId: "g1" },
  };

  afterEach(() => {
    document.body.innerHTML = "";
    vi.doUnmock("../GridActionsContext.js");
    vi.doUnmock("../helpers/CommitHelpers");
  });

  it("host WITHOUT onCreatePageFromTemplate wired shows no template tiles (no dead tiles)", async () => {
    vi.resetModules();
    vi.doMock("../GridActionsContext.js", () => ({
      useGridActionsSelector: (sel) => sel(gridActionsMockState),
    }));
    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const QuickAddMenu = (await import("../ui/QuickAddMenu.jsx")).default;
    render(createElement(QuickAddMenu, {
      targetRole: "page", hostOccurrence: { id: "panel1" }, onCreateNew: () => {},
    }));
    fireEvent.click(screen.getByTitle("Add page"));
    expect(screen.queryByText("Board Template", { exact: false })).toBeNull();
  });

  it("host WITH onCreatePageFromTemplate wired: picking a template calls it — NOT commitApplyTemplate directly", async () => {
    vi.resetModules();
    vi.doMock("../GridActionsContext.js", () => ({
      useGridActionsSelector: (sel) => sel(gridActionsMockState),
    }));
    const commitApplyTemplate = vi.fn();
    vi.doMock("../helpers/CommitHelpers", () => ({ commitApplyTemplate }));
    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const QuickAddMenu = (await import("../ui/QuickAddMenu.jsx")).default;
    const onCreatePageFromTemplate = vi.fn();
    render(createElement(QuickAddMenu, {
      targetRole: "page", hostOccurrence: { id: "panel1" }, onCreateNew: () => {},
      onCreatePageFromTemplate,
    }));
    fireEvent.click(screen.getByTitle("Add page"));
    // The button's own text is one node: "📋 Board Template" — RTL's exact-text
    // matcher works on the DIRECT text-node children concatenated together, so
    // an exact match on "Board Template" alone never hits; exact:false does a
    // substring match against that same concatenation.
    fireEvent.click(screen.getByText("Board Template", { exact: false }));
    expect(onCreatePageFromTemplate).toHaveBeenCalledWith({ templateOccId: "boardTplOcc", kind: "board" });
    expect(commitApplyTemplate).not.toHaveBeenCalled();
  });

  it("container role is UNCHANGED — still applies the template directly into the host", async () => {
    vi.resetModules();
    vi.doMock("../GridActionsContext.js", () => ({
      useGridActionsSelector: (sel) => sel(gridActionsMockState),
    }));
    const commitApplyTemplate = vi.fn();
    vi.doMock("../helpers/CommitHelpers", () => ({ commitApplyTemplate }));
    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const QuickAddMenu = (await import("../ui/QuickAddMenu.jsx")).default;
    render(createElement(QuickAddMenu, {
      targetRole: "container", hostOccurrence: { id: "cont1" }, onCreateNew: () => {},
    }));
    fireEvent.click(screen.getByTitle("Add container"));
    fireEvent.click(screen.getByText("Board Template", { exact: false }));
    expect(commitApplyTemplate).toHaveBeenCalledWith(null, {
      templateOccurrenceId: "boardTplOcc", targetOccurrenceId: "cont1", mode: "append",
    });
  });
});
