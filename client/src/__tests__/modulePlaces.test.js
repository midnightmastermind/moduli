import { describe, it, expect } from "vitest";
import { modulePlaces, ancestryOf } from "../helpers/modulePlaces";
import { placementsHeading } from "../ui/ModulePlacements";

const folders = {
  root: { id: "root", name: "Root", parentId: null },
  docs: { id: "docs", name: "Documents", parentId: "root" },
  files: { id: "files", name: "Files", parentId: "root" },
  fdocs: { id: "fdocs", name: "Documents", parentId: "files" },
};
const modules = {
  panelM: { id: "panelM", role: "panel", label: "Panel A" },
  pageM: { id: "pageM", role: "page", kind: "board", label: "Board" },
  boardM: { id: "boardM", role: "container", kind: "board", label: "Inbox" },
  docM: { id: "docM", role: "page", kind: "doc", label: "Notes" },
  rowM: { id: "rowM", role: "instance", label: "Drink" },
  fileM: { id: "fileM", role: "artifact", kind: "image", label: "photo.png", fileRef: "user/2026-10/photo.png" },
  spreadM: { id: "spreadM", role: "page", kind: "board", label: "viewer" },
};
function world(extra = {}) {
  const o = {
    panel: { id: "panel", moduleId: "panelM", occurrences: ["page"] },
    page: { id: "page", moduleId: "pageM", parentId: "docs", occurrences: ["board"] },
    board: { id: "board", moduleId: "boardM", parentId: "page", occurrences: ["r1", "home"] },
    r1: { id: "r1", moduleId: "rowM", parentId: "board" },
    r2: { id: "r2", moduleId: "rowM", parentId: "board2" },
    board2: { id: "board2", moduleId: "boardM", parentId: "page", occurrences: ["r2"], label: "Later" },
    home: { id: "home", moduleId: "fileM", parentId: "fdocs" },
    doc: { id: "doc", moduleId: "docM", parentId: "docs",
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "home" } }] } },
    spread: { id: "spread", moduleId: "spreadM", meta: { spreadFor: "x" }, occurrences: ["home"] },
    ...extra,
  };
  return { occurrencesById: o, modulesById: modules, foldersById: folders };
}

describe("ancestryOf", () => {
  it("names folders, the page and the container, top first — never the panel", () => {
    expect(ancestryOf("r1", world()).path).toEqual(["Root", "Documents", "Board", "Inbox"]);
  });
  it("stops at a panel: a page listed only by a panel ends the path", () => {
    const w = world({
      page2: { id: "page2", moduleId: "pageM", label: "Loose", occurrences: ["r4"] },
      r4: { id: "r4", moduleId: "rowM", parentId: "page2" },
    });
    w.occurrencesById.panel.occurrences.push("page2");
    expect(ancestryOf("r4", w).path).toEqual(["Loose"]);
  });
  it("a placement's own label overrides its module's", () => {
    expect(ancestryOf("r2", world()).path).toEqual(["Root", "Documents", "Board", "Later"]);
  });
});

describe("modulePlaces", () => {
  it("lists EVERY placement, the one you are looking at included", () => {
    const places = modulePlaces("rowM", world());
    expect(places.map((p) => p.occId).sort()).toEqual(["r1", "r2"]);
  });

  it("a placement with its own name ends with that name; one wearing the module's name does not", () => {
    const w = world({ r3: { id: "r3", moduleId: "rowM", parentId: "board", label: "Monday" } });
    w.occurrencesById.board.occurrences.push("r3");
    const byId = Object.fromEntries(modulePlaces("rowM", w).map((p) => [p.occId, p.path]));
    expect(byId.r3).toEqual(["Root", "Documents", "Board", "Inbox", "Monday"]);
    expect(byId.r1).toEqual(["Root", "Documents", "Board", "Inbox"]);
  });

  it("a file's Files home does not count; the board listing it and the doc embedding it do", () => {
    const places = modulePlaces("fileM", world());
    expect(places.map((p) => p.jumpId).sort()).toEqual(["board", "doc"]);
    expect(places.find((p) => p.jumpId === "doc").path).toEqual(["Root", "Documents", "Notes"]);
  });

  it("the viewer's hidden page is not a place", () => {
    expect(modulePlaces("fileM", world()).some((p) => p.jumpId === "spread")).toBe(false);
  });

  it("a placement under a hidden page is not a place", () => {
    const w = world({ r3: { id: "r3", moduleId: "rowM", parentId: "spread" } });
    w.occurrencesById.spread.occurrences.push("r3");
    expect(modulePlaces("rowM", w).map((p) => p.occId).sort()).toEqual(["r1", "r2"]);
  });

  it("a page filed in a folder is one place, named by its folders", () => {
    const places = modulePlaces("docM", world());
    expect(places).toEqual([{ occId: "doc", jumpId: "doc", path: ["Root", "Documents"] }]);
  });

  it("a non-file artifact (an external picture) counts its folder placement like anything else", () => {
    const w = world();
    w.modulesById = { ...modules, fileM: { ...modules.fileM, fileRef: "https://x/y.png" } };
    expect(modulePlaces("fileM", w).map((p) => p.jumpId)).toContain("home");
  });
});

describe("placementsHeading", () => {
  it("counts places, and says a file's count leaves out Files", () => {
    expect(placementsHeading(1, false)).toBe("This module is in 1 place");
    expect(placementsHeading(3, true)).toBe("This file is in 3 places (not counting Files)");
  });
});
