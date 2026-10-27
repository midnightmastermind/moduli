import { describe, it, expect } from "vitest";
import { upTarget } from "../helpers/panelUp";

const foldersById = { root: { id: "root", parentId: null }, boards: { id: "boards", parentId: "root" }, mind: { id: "mind", parentId: "boards" } };
const modulesById = { mp: { id: "mp", role: "page" }, mc: { id: "mc", role: "container" } };
const occurrencesById = {
  fpRoot: { id: "fpRoot", parentId: "root", meta: { folderPage: true } },
  fpBoards: { id: "fpBoards", parentId: "boards", meta: { folderPage: true } },
  fpMind: { id: "fpMind", parentId: "mind", meta: { folderPage: true } },
  verses: { id: "verses", moduleId: "mp", parentId: "mind" },
  box: { id: "box", moduleId: "mc", parentId: "verses" },
  nested: { id: "nested", moduleId: "mp", parentId: "box" },
  lone: { id: "lone", moduleId: "mp", parentId: null },
};
const ctx = { occurrencesById, modulesById, foldersById };

describe("Up one level", () => {
  it("a page in a folder goes to the folder's page", () => expect(upTarget("verses", ctx)).toEqual({ id: "fpMind" }));
  it("a folder page goes to the folder above's page", () => expect(upTarget("fpMind", ctx)).toEqual({ id: "fpBoards" }));
  it("a page inside a container on a page goes to that page", () => expect(upTarget("nested", ctx)).toEqual({ id: "verses" }));
  it("a folder with no folder page yet names the folder, so one can be made", () => {
    const occs = { ...occurrencesById }; delete occs.fpMind;
    expect(upTarget("verses", { ...ctx, occurrencesById: occs })).toEqual({ folderId: "mind" });
  });
  it("the top folder and a page with no parent have nowhere to go", () => {
    expect(upTarget("fpRoot", ctx)).toBeNull();
    expect(upTarget("lone", ctx)).toBeNull();
  });
});
