// 0351 — sort Files/Images by what uses each image; imported images to Imports.
import { describe, it, expect } from "vitest";
import { planImageSort, categoryFolderName } from "../migrations/0351-sort-images-into-subfolders.mjs";
import { filesFolderIdSet, classifyFileDelete } from "../utils/filesFolder.js";

const BC = "bc", LIB = "lib", POSTER = "poster", FILES = "files";
const mods = new Map([
  ["img", { id: "img", role: "artifact", kind: "image", fileRef: "user/2026-09/a.png" }],
  ["remote", { id: "remote", role: "artifact", kind: "image", fileRef: "https://upload.wikimedia.org/x.jpg" }],
  ["row", { id: "row", role: "instance" }],
]);
const img = (id, mod = "img", parentId = "IMG") => ({ id, moduleId: mod, parentId, fields: {} });
const row = (id, fields) => ({ id, moduleId: "row", parentId: "board", fields });

function plan(occurrences, embedded = []) {
  return planImageSort({ occurrences, modulesById: mods, imagesFolderId: "IMG",
    boardCategoryFieldId: BC, libraryFieldId: LIB, embeddedIds: new Set(embedded) });
}
const dest = (p, id) => p.moves.find(m => m.occId === id)?.to;

describe("planImageSort", () => {
  it("files an image under its referrer's Board Category", () => {
    const p = plan([img("cover"), row("dune", { [BC]: { value: "book" }, [POSTER]: { value: "cover" } })]);
    expect(dest(p, "cover")).toEqual({ kind: "category", name: "Books" });
  });

  it("reads a multi-select category, a Files array, and a Files value with a main", () => {
    const p = plan([
      img("a"), img("b"),
      row("sam", { [BC]: { value: ["person"] }, [FILES]: { value: ["a"] } }),
      row("oat", { [LIB]: { value: "ingredient" }, [FILES]: { value: ["b"], main: "b" } }),
    ]);
    expect(dest(p, "a").name).toBe("People");
    expect(dest(p, "b").name).toBe("Ingredients");
  });

  it("most votes wins", () => {
    const p = plan([img("x"),
      row("r1", { [BC]: { value: "movie" }, [POSTER]: { value: "x" } }),
      row("r2", { [BC]: { value: "book" }, [POSTER]: { value: "x" } }),
      row("r3", { [BC]: { value: "book" }, [FILES]: { value: ["x"] } })]);
    expect(dest(p, "x").name).toBe("Books");
  });

  it("an image embedded in a document with a REMOTE file goes to Imports", () => {
    const p = plan([img("w", "remote")], ["w"]);
    expect(dest(p, "w")).toEqual({ kind: "imports" });
  });

  it("controls: an uploaded image in a doc, an unused image, and an image outside Images all stay", () => {
    const p = plan([img("mine"), img("unused"), img("elsewhere", "img", "OTHER"),
      row("r", { [BC]: { value: "book" }, [POSTER]: { value: "elsewhere" } })], ["mine"]);
    expect(p.moves).toEqual([]);
    expect(p.stay).toBe(2);
  });

  it("a referrer category beats the import rule", () => {
    const p = plan([img("w", "remote"), row("r", { [BC]: { value: "person" }, [POSTER]: { value: "w" } })], ["w"]);
    expect(dest(p, "w").name).toBe("People");
  });
});

describe("categoryFolderName", () => {
  it("pluralises for a folder name", () => {
    expect(categoryFolderName("book")).toBe("Books");
    expect(categoryFolderName("person")).toBe("People");
    expect(categoryFolderName("tv show")).toBe("TV Shows");
    expect(categoryFolderName("grocery")).toBe("Groceries");
    expect(categoryFolderName("ingredient")).toBe("Ingredients");
    expect(categoryFolderName("courses")).toBe("Courses");
  });
});

describe("filesFolderIdSet covers the whole Files tree", () => {
  const f = (id, parentId, name) => ({ id, parentId, name, gridId: "g", userId: "u", meta: name === "Files" ? { protected: true } : {} });
  const uc = { foldersById: Object.fromEntries([f("root", null, "Root"), f("files", "root", "Files"),
    f("IMG", "files", "Images"), f("books", "IMG", "Books"), f("other", "root", "Imports")].map(x => [x.id, x])) };
  it("includes a sub-subfolder, so removing a book cover from a page unlinks it", () => {
    const ids = filesFolderIdSet(uc, { gridId: "g", userId: "u" });
    expect([...ids].sort()).toEqual(["IMG", "books", "files"]);
    expect(classifyFileDelete({ occurrence: { parentId: "books", moduleId: "m" }, fromParentId: "page", filesFolderIds: ids }).action).toBe("unlink");
  });
});
