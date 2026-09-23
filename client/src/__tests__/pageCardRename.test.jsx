// A PAGE COULD NOT BE RENAMED FROM THE UI AT ALL.
//
// Found on poms (2026-09-23) carrying out the user's own instruction to rename
// the `Appointments` page to `Schedule Types`. The CONTAINER renamed fine —
// double-click its header label, as every container does. The PAGE had no path:
//
//   double-click the page header        no editor opens
//   the page header's radial            "Settings" -> PANEL Settings (the panel's,
//                                       not the page's; both handles resolve to it)
//   right-click the card on its         New board page · New doc page ·
//     folder page (hit-tested on the    New canvas page · New table page ·
//     TITLE, so not a missed click)     Set cover image… · Delete      <- no Rename
//
// Folder pages were the only ones that could change name, and only indirectly:
// `planFolderPageRename` (2026-09-22 (9)) makes a folder page follow its
// FOLDER. A page filed in a folder — which is most of them, 214 on this grid —
// had nothing.
//
// The card's context menu is where it belongs: it is the one surface that
// already treats the page as an object (it sets its cover and deletes it), and
// it is where the user went looking.
//
// The write is `CommitHelpers.updateModule({ label })` — the SAME call a
// container's inline rename makes (`ModuleContainer.commitInlineLabel`), so a
// page is renamed the way everything else is. NOT the occurrence's label: that
// overrides one PLACEMENT, and a page's name is a property of the page.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";

const updateModule = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  __esModule: true,
  updateModule: (...a) => updateModule(...a),
  deleteOccurrence: vi.fn(),
}));

import { buildRenameItem } from "../modules/pageCardRename";

beforeEach(() => updateModule.mockClear());

const MODULE = { id: "m1", label: "Appointments", role: "page", kind: "board" };

describe("renaming a page from its card", () => {
  it("offers a Rename item for a PAGE", () => {
    const item = buildRenameItem({ module: MODULE, dispatch: vi.fn(), socket: {}, onStart: vi.fn() });
    expect(item).toBeTruthy();
    expect(item.label).toBe("Rename…");
  });

  // The control: the same card renders for artifacts and containers on a folder
  // page. Offering Rename only where a label is the thing you'd change keeps
  // the menu honest — and a null here is what the caller filters out.
  it("offers nothing when there is no module", () => {
    expect(buildRenameItem({ module: null, dispatch: vi.fn(), socket: {} })).toBeNull();
  });

  it("writes the MODULE label, the way a container rename does", () => {
    const dispatch = vi.fn(), socket = {};
    const item = buildRenameItem({ module: MODULE, dispatch, socket });
    item.commit("Schedule Types");
    expect(updateModule).toHaveBeenCalledTimes(1);
    const arg = updateModule.mock.calls[0][0];
    expect(arg.module.label).toBe("Schedule Types");
    expect(arg.module.id).toBe("m1");
    expect(arg.emit).toBe(true);
  });

  it("keeps every other key on the module — a partial write would drop them", () => {
    const item = buildRenameItem({ module: { ...MODULE, meta: { cover: "x" }, kind: "board" }, dispatch: vi.fn(), socket: {} });
    item.commit("Schedule Types");
    const arg = updateModule.mock.calls[0][0];
    expect(arg.module.meta).toEqual({ cover: "x" });
    expect(arg.module.kind).toBe("board");
  });

  // An empty or unchanged name must write NOTHING — the same guard the
  // container rename has. Without it, clicking Rename and pressing Enter blanks
  // the page's name.
  it("writes nothing for an empty or unchanged name", () => {
    const item = buildRenameItem({ module: MODULE, dispatch: vi.fn(), socket: {} });
    item.commit("   ");
    item.commit("Appointments");
    expect(updateModule).not.toHaveBeenCalled();
  });
});
