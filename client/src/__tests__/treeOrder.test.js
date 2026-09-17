import { describe, it, expect } from "vitest";
import { edgeForPoint, sortOrderForDrop, sortOrderAtEnd, wouldNestInsideItself, isInnermostTarget, cardZoneForPoint, planFolderPageDrop } from "../helpers/treeOrder";

const rect = { top: 100, height: 30 };

describe("edgeForPoint", () => {
  it("splits a row in half without an into-zone", () => {
    expect(edgeForPoint(rect, 105)).toBe("top");
    expect(edgeForPoint(rect, 125)).toBe("bottom");
  });
  it("the middle third means INTO when asked", () => {
    expect(edgeForPoint(rect, 103, { into: true })).toBe("top");
    expect(edgeForPoint(rect, 115, { into: true })).toBe("into");
    expect(edgeForPoint(rect, 128, { into: true })).toBe("bottom");
  });
});

describe("sortOrderForDrop", () => {
  const sibs = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 }, { id: "c", sortOrder: 2 }];
  it("lands between neighbours", () => {
    expect(sortOrderForDrop(sibs, "b", "top")).toBe(0.5);
    expect(sortOrderForDrop(sibs, "b", "bottom")).toBe(1.5);
  });
  it("goes past the ends", () => {
    expect(sortOrderForDrop(sibs, "a", "top")).toBe(-1);
    expect(sortOrderForDrop(sibs, "c", "bottom")).toBe(3);
  });
  it("ignores the dragged row itself", () => {
    // Dragging a below c: without the exclusion the neighbour check would read a's old slot.
    expect(sortOrderForDrop(sibs, "b", "bottom", "c")).toBe(2);
  });
  it("appends when the target is not a sibling (cross-folder)", () => {
    expect(sortOrderForDrop(sibs, "zzz", "top")).toBe(3);
  });
  it("end of list", () => {
    expect(sortOrderAtEnd(sibs)).toBe(3);
    expect(sortOrderAtEnd([])).toBe(0);
  });
});

describe("wouldNestInsideItself", () => {
  const f = { root: { id: "root" }, a: { id: "a", parentId: "root" }, b: { id: "b", parentId: "a" } };
  it("refuses a folder into itself or its own descendant", () => {
    expect(wouldNestInsideItself(f, "a", "a")).toBe(true);
    expect(wouldNestInsideItself(f, "a", "b")).toBe(true);
  });
  it("allows a sibling or an ancestor", () => {
    expect(wouldNestInsideItself(f, "b", "root")).toBe(false);
    expect(wouldNestInsideItself(f, "b", "a")).toBe(false);
  });
});

describe("isInnermostTarget", () => {
  it("only the first drop target acts", () => {
    const inner = {}, outer = {};
    const loc = { current: { dropTargets: [{ element: inner }, { element: outer }] } };
    expect(isInnermostTarget(loc, inner)).toBe(true);
    expect(isInnermostTarget(loc, outer)).toBe(false);
  });
});

describe("cardZoneForPoint", () => {
  const card = { left: 0, top: 0, width: 200, height: 100 };
  it("the middle of a folder card is INTO", () => {
    expect(cardZoneForPoint(card, 100, 50, { into: true })).toBe("into");
  });
  it("the middle of a non-folder card reorders instead", () => {
    expect(cardZoneForPoint(card, 100, 50, { into: false })).not.toBe("into");
  });
  it("the rim picks the nearest edge", () => {
    expect(cardZoneForPoint(card, 5, 50, { into: true })).toBe("left");
    expect(cardZoneForPoint(card, 195, 50, { into: true })).toBe("right");
    expect(cardZoneForPoint(card, 100, 3, { into: true })).toBe("top");
  });
  it("list rows only split top/bottom", () => {
    expect(cardZoneForPoint(card, 5, 80, { horizontal: false })).toBe("bottom");
  });
});

describe("planFolderPageDrop", () => {
  const page = { role: "page", kind: "doc" };
  const folderPage = { role: "page", kind: "folder" };
  const instance = { role: "instance" };
  const foldersById = { cur: { id: "cur", parentId: "root" }, sub: { id: "sub", parentId: "cur" }, deep: { id: "deep", parentId: "sub" } };
  const siblings = [
    { id: "a", parentId: "cur", sortOrder: 0 },
    { id: "b", parentId: "cur", sortOrder: 1 },
    { id: "subCard", parentId: "sub", sortOrder: 2 },
  ];
  const childrenOf = (fid) => (fid === "sub" ? [{ id: "x", sortOrder: 4 }] : []);
  const base = { currentFolderId: "cur", siblings, childrenOf, foldersById };

  it("dropping a page INTO a folder card re-files it at the end of that folder", () => {
    expect(planFolderPageDrop({ ...base, dragged: siblings[0], draggedModule: page, target: siblings[2], targetModule: folderPage, zone: "into" }))
      .toEqual({ kind: "occ", id: "a", parentId: "sub", sortOrder: 5 });
  });

  it("reordering on the rim keeps the page in this folder", () => {
    const plan = planFolderPageDrop({ ...base, dragged: siblings[1], draggedModule: page, target: siblings[0], targetModule: page, zone: "left" });
    expect(plan.parentId).toBe("cur");
    expect(plan.sortOrder).toBeLessThan(0);
  });

  it("a page dragged in from another folder and dropped on a rim moves into this one", () => {
    const outsider = { id: "z", parentId: "elsewhere", sortOrder: 9 };
    expect(planFolderPageDrop({ ...base, dragged: outsider, draggedModule: page, target: siblings[1], targetModule: page, zone: "right" }).parentId).toBe("cur");
  });

  it("an instance is never re-filed into a folder", () => {
    const inst = { id: "i", parentId: "someContainer" };
    expect(planFolderPageDrop({ ...base, dragged: inst, draggedModule: instance, target: siblings[2], targetModule: folderPage, zone: "into" })).toBe(null);
    expect(planFolderPageDrop({ ...base, dragged: inst, draggedModule: instance, target: siblings[0], targetModule: page, zone: "left" })).toBe(null);
  });

  it("INTO a non-folder card does nothing", () => {
    // From ANOTHER folder, so "already there" cannot be what refuses it.
    const outsider = { id: "z", parentId: "elsewhere" };
    expect(planFolderPageDrop({ ...base, dragged: outsider, draggedModule: page, target: siblings[1], targetModule: page, zone: "into" })).toBe(null);
  });

  it("dropping a sub-folder card into another folder moves the FOLDER", () => {
    const otherCard = { id: "otherCard", parentId: "other" };
    const fb = { ...foldersById, other: { id: "other", parentId: "cur" } };
    expect(planFolderPageDrop({ ...base, foldersById: fb, dragged: siblings[2], draggedModule: folderPage, target: otherCard, targetModule: folderPage, zone: "into" }))
      .toEqual({ kind: "folder", id: "sub", parentId: "other", sortOrder: 0 });
  });

  it("a folder can never be dropped inside itself or its own descendants", () => {
    const deepCard = { id: "deepCard", parentId: "deep" };
    expect(planFolderPageDrop({ ...base, dragged: siblings[2], draggedModule: folderPage, target: deepCard, targetModule: folderPage, zone: "into" })).toBe(null);
  });

  it("a page already in the target folder is left alone", () => {
    const inSub = { id: "q", parentId: "sub" };
    expect(planFolderPageDrop({ ...base, dragged: inSub, draggedModule: page, target: siblings[2], targetModule: folderPage, zone: "into" })).toBe(null);
  });
});
