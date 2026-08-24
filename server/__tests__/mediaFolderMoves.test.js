// 0224 — where each thing lands. The plan is pure and exported, so a wrong
// destination fails here rather than moving a live page.
import { describe, it, expect } from "vitest";
import { planMoves } from "../migrations/0224-media-folder-and-documents.mjs";

const ids = { mediaFolder: "MEDIA", musicFolder: "MUSIC", documentsFolder: "DOCS" };
const full = () => planMoves({
  musicPages: [{ id: "s", label: "Songs" }, { id: "a", label: "Albums" }, { id: "r", label: "Artists" }],
  bookmarksPage: { id: "bm" },
  codexFolder: { id: "cx" },
  notesFolder: { id: "nt" },
  ids,
});

describe("planMoves — the tree the user asked for", () => {
  it("puts the three music boards in Media/MUSIC, not Media itself", () => {
    // "media is going to get too big so that should be a folder with music and
    // bookmarks in it" — music is THREE boards, so it gets its own subfolder.
    const m = full().filter((x) => ["s", "a", "r"].includes(x.id));
    expect(m).toHaveLength(3);
    expect(new Set(m.map((x) => x.to))).toEqual(new Set(["MUSIC"]));
  });

  it("puts Bookmarks in Media, BESIDE Music rather than inside it", () => {
    // Bookmarks is one board; nesting it under Music would say it is music.
    expect(full().find((x) => x.id === "bm").to).toBe("MEDIA");
  });

  it("moves Codex and Notes as FOLDERS into Documents", () => {
    // The folder, not its 11 pages: `Health/` rides along and one move undoes it.
    const f = full().filter((x) => x.kind === "folder");
    expect(f.map((x) => x.what).sort()).toEqual(["Codex", "Notes"]);
    expect(new Set(f.map((x) => x.to))).toEqual(new Set(["DOCS"]));
  });

  it("moves a PAGE for the boards and a FOLDER for the documents", () => {
    // A board's 8,428 rows hang off its container, which its page lists — so
    // re-homing the page carries the board and never touches a row.
    const p = full();
    expect(p.filter((x) => x.kind === "page").map((x) => x.id).sort()).toEqual(["a", "bm", "r", "s"]);
    expect(p.filter((x) => x.kind === "folder")).toHaveLength(2);
  });

  it("plans nothing for a thing that is absent, rather than inventing an id", () => {
    // A fresh grid has no Codex, no Bookmarks and no music boards. The
    // migration must no-op there instead of minting moves against undefined.
    expect(planMoves({ musicPages: [], bookmarksPage: null, codexFolder: null, notesFolder: null, ids })).toEqual([]);
  });

  it("plans a partial grid without dropping the parts that ARE present", () => {
    // A grid with the codex but no music must still move the codex.
    const p = planMoves({ musicPages: [], bookmarksPage: null, codexFolder: { id: "cx" }, notesFolder: null, ids });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ what: "Codex", to: "DOCS", kind: "folder" });
  });
});
