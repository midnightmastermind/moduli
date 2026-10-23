// The VR office's data layer: shelves and screens kept on the grid, and a
// shelf's saved query answered by the feed code (no copies, no board pages).
import { describe, it, expect } from "vitest";
import {
  readOffice, addShelf, updateShelf, removeShelf, addScreen, updateScreen, removeScreen,
} from "../vr/officeConfig.js";
import { shelfItems } from "../vr/shelfItems.js";

const grid = { _id: "g1", meta: { layoutTree: { keep: true } } };

describe("officeConfig", () => {
  it("reads an empty office from a grid that has none", () => {
    expect(readOffice(grid)).toEqual({ shelves: [], screens: [] });
  });

  it("a new shelf pulls files as well as rows (poms' books, songs and movies are artifacts)", () => {
    const { shelf } = addShelf(grid, "book");
    expect(shelf.feed.roles).toEqual(["instance", "artifact"]);
  });

  it("adds a shelf without dropping the grid's other meta", () => {
    const { meta, shelf } = addShelf(grid, "record");
    expect(meta.layoutTree).toEqual({ keep: true });
    expect(shelf.asset).toBe("record");
    expect(shelf.title).toBe("Record crate");
    expect(meta.vrOffice.shelves).toHaveLength(1);
    expect(shelf.feed.enabled).toBe(true);
  });

  it("keeps a shelf's query ON whatever the editor writes", () => {
    const { meta, shelf } = addShelf(grid, "book");
    const next = updateShelf({ meta }, shelf.id, { feed: { enabled: false, conditions: [] } });
    expect(next.vrOffice.shelves[0].feed.enabled).toBe(true);
  });

  it("an unknown asset becomes a bookshelf", () => {
    expect(addShelf(grid, "toaster").shelf.asset).toBe("book");
  });

  it("removes a shelf; adds, retargets and removes a screen", () => {
    const a = addShelf(grid, "vhs");
    expect(removeShelf({ meta: a.meta }, a.shelf.id).vrOffice.shelves).toEqual([]);
    const s = addScreen(grid, { pageOccId: "p1" });
    expect(s.screen.pageOccId).toBe("p1");
    expect(s.screen.source).toBe("page");
    expect(addScreen(grid, { source: "grid" }).screen.source).toBe("grid");
    const moved = updateScreen({ meta: s.meta }, s.screen.id, { pageOccId: "p2" });
    expect(moved.vrOffice.screens[0].pageOccId).toBe("p2");
    expect(removeScreen({ meta: moved }, s.screen.id).vrOffice.screens).toEqual([]);
  });
});

describe("shelfItems", () => {
  const modulesById = {
    mBook: { id: "mBook", role: "instance" },
    mPdf: { id: "mPdf", role: "artifact", kind: "pdf", fileRef: "user/x.pdf" },
    mImg: { id: "mImg", role: "artifact", kind: "image", fileRef: "https://img/cover.jpg" },
    mTrack: { id: "mTrack", role: "artifact", kind: "audio", fileRef: "user/a.mp3" },
  };
  // A row binds its picture (media) and its files.
  modulesById.mBook.fieldBindings = [{ fieldId: "fPoster", role: "media" }, { fieldId: "fFiles", role: "files" }];
  const occurrencesById = {
    b1: { id: "b1", moduleId: "mBook", gridId: "g1", label: "Dune", fields: { tag: { value: "book" }, fPoster: { value: "img1" }, fFiles: { value: ["pdf1"] } } },
    b2: { id: "b2", moduleId: "mBook", gridId: "g1", label: "Notes", fields: { tag: { value: "note" } } },
    b3: { id: "b3", moduleId: "mBook", gridId: "g1", label: "", fields: { tag: { value: "book" } } },
    pdf1: { id: "pdf1", moduleId: "mPdf", gridId: "g1", label: "dune.pdf" },
    img1: { id: "img1", moduleId: "mImg", gridId: "g1" },
    trk: { id: "trk", moduleId: "mTrack", gridId: "g1", label: "Song" },
  };
  const shelf = (asset, conditions, roles) => ({
    id: "shelf-1", asset,
    feed: { enabled: false, conditions, roles: roles || ["instance"], scope: null, sort: null, limit: 50 },
  });

  it("answers the shelf's query, even when its stored feed reads Off", () => {
    const items = shelfItems(shelf("book", [{ id: "c", fieldId: "tag", comparator: "IS", value: "book" }]), { grid, occurrencesById, modulesById });
    expect(items.map((i) => i.title)).toEqual(["Dune"]);       // b2 is not a book, b3 has no title
  });

  it("a book opens its readable file and shows its picture", () => {
    const [dune] = shelfItems(shelf("book", [{ id: "c", fieldId: "tag", comparator: "IS", value: "book" }]), { grid, occurrencesById, modulesById });
    expect(dune.rowId).toBe("b1");
    expect(dune.id).toBe("pdf1");
    expect(dune.fileKind).toBe("pdf");
    expect(dune.cover).toBe("https://img/cover.jpg");
  });

  it("a new shelf with no query holds nothing (not every row on the grid)", () => {
    expect(shelfItems(shelf("book", []), { grid, occurrencesById, modulesById })).toEqual([]);
  });

  it("a record shelf over artifacts opens the audio file itself", () => {
    const items = shelfItems(shelf("record", [{ id: "c", fieldId: "nope", comparator: "IS_EMPTY" }], ["artifact"]), { grid, occurrencesById, modulesById });
    const song = items.find((i) => i.rowId === "trk");
    expect(song.fileId).toBe("trk");
    // A pdf on a record shelf is not playable: it opens as itself, with no file.
    expect(items.find((i) => i.rowId === "pdf1").fileId).toBe(null);
  });

  it("a shelf whose conditions are half-written shows nothing", () => {
    expect(shelfItems(shelf("book", [{ id: "c", fieldId: null }]), { grid, occurrencesById, modulesById })).toEqual([]);
  });
});

import { decorModels, decorLibrary, decorPage, BUILTIN_DECOR } from "../vr/decorLibrary.js";

describe("decorLibrary", () => {
  const modulesById = {
    m1: { id: "m1", role: "artifact", kind: "model", fileRef: "user/2026-10/chair.glb", label: "chair.glb" },
    m2: { id: "m2", role: "artifact", kind: "image", fileRef: "user/x.png" },
    m3: { id: "m3", role: "artifact", kind: "model", fileRef: "https://cdn/x/Globe.glb", label: "Globe.glb", trashed: true },
  };
  const occurrencesById = {
    a: { id: "a", moduleId: "m1", gridId: "g1" },
    b: { id: "b", moduleId: "m1", gridId: "g1" },     // same file placed twice
    c: { id: "c", moduleId: "m2", gridId: "g1" },
    d: { id: "d", moduleId: "m3", gridId: "g1" },
    e: { id: "e", moduleId: "m1", gridId: "other" },  // another grid
  };
  const ctx = { grid: { _id: "g1" }, occurrencesById, modulesById };

  it("lists every live model file on the grid once, named without its extension", () => {
    const m = decorModels(ctx);
    expect(m).toHaveLength(1);
    expect(m[0].title).toBe("chair");
    expect(m[0].src).toBe("/uploads/user/2026-10/chair.glb");
    expect(m[0].key).toBe("model:" + m[0].occId);
  });

  it("puts the built-in pieces first", () => {
    const lib = decorLibrary(ctx);
    expect(lib.slice(0, BUILTIN_DECOR.length)).toEqual(BUILTIN_DECOR);
    expect(lib.at(-1).title).toBe("chair");
  });

  it("pages wrap round", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(decorPage(items, 0, 8)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7], page: 0, pages: 2 });
    expect(decorPage(items, 2, 8).page).toBe(0);
    expect(decorPage(items, -1, 8).items).toEqual([8, 9]);
  });
});

import { folderShelfItems, shelfItems as shelfItemsF } from "../vr/shelfItems.js";

describe("a shelf that holds a whole folder", () => {
  const foldersById = {
    docs: { id: "docs", name: "Documents", parentId: "root" },
    notes: { id: "notes", name: "Notes", parentId: "docs" },
    codex: { id: "codex", name: "Codex", parentId: "docs" },
    other: { id: "other", name: "Other", parentId: "root" },
  };
  const modulesById = { pg: { id: "pg", role: "page", kind: "doc" }, fp: { id: "fp", role: "page", kind: "folder" }, it: { id: "it", role: "instance" } };
  const occurrencesById = {
    a: { id: "a", moduleId: "pg", parentId: "notes", label: "Philosopher's Stone" },
    b: { id: "b", moduleId: "pg", parentId: "codex", label: "Dreams" },
    c: { id: "c", moduleId: "pg", parentId: "other", label: "Elsewhere" },
    d: { id: "d", moduleId: "fp", parentId: "notes", label: "Notes" },
    e: { id: "e", moduleId: "it", parentId: "notes", label: "A row" },
  };

  it("holds every page in the folder and its subfolders, by title, and nothing else", () => {
    const items = folderShelfItems("docs", { occurrencesById, modulesById, foldersById });
    expect(items.map((i) => i.title)).toEqual(["Dreams", "Philosopher's Stone"]);
    expect(items[0].id).toBe("b");
  });

  it("is what a shelf with a folderId holds, whatever its query says", () => {
    const shelf = { id: "s", asset: "book", folderId: "notes", feed: { conditions: [], scope: null } };
    expect(shelfItemsF(shelf, { occurrencesById, modulesById, foldersById }).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("a folder VHS shelf", () => {
  it("holds the folder's videos (with their file url) as well as its pages", () => {
    const foldersById = { vid: { id: "vid", name: "Video", parentId: "files" } };
    const modulesById = { v: { id: "v", role: "artifact", kind: "video", fileRef: "/uploads/user/a.mp4" }, im: { id: "im", role: "artifact", kind: "image", fileRef: "/x.png" } };
    const occurrencesById = {
      a: { id: "a", moduleId: "v", parentId: "vid", label: "Big Buck Bunny" },
      b: { id: "b", moduleId: "im", parentId: "vid", label: "A picture" },
    };
    const items = folderShelfItems("vid", { occurrencesById, modulesById, foldersById, asset: "vhs" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "a", title: "Big Buck Bunny", fileKind: "video" });
    expect(items[0].src).toContain("a.mp4");
  });
});
