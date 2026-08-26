// Guards 0260. It reshapes whole boards, so each test answers "could this tile a
// board with no artwork, or a board that is not media at all?"
import { describe, it, expect } from "vitest";
import { planTileAllMedia, folderChain, COVERAGE_THRESHOLD } from "../migrations/0260-tile-all-media.mjs";

const MODS = [
  { id: "m-board", role: "container", kind: "board" },
  { id: "m-page", role: "page", kind: "board" },
  { id: "m-row", role: "artifact", kind: "album" },
];
const FOLDERS = [
  { id: "root", name: "Root", parentId: null },
  { id: "boards", name: "Boards", parentId: "root" },
  { id: "media", name: "Media", parentId: "boards" },
  { id: "music", name: "Music", parentId: "media" },
  { id: "other", name: "Interests", parentId: "boards" },
];
const HOUSE = { childMinWidth: 184 };
const rows = (n, covered) => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, moduleId: "m-row", occurrences: [], meta: i < covered ? { cover: "https://c/x.jpg" } : {},
}));
function world({ folder = "music", n = 10, covered = 10, mode = null } = {}) {
  const rs = rows(n, covered);
  const board = { id: "b", moduleId: "m-board", label: "Albums", occurrences: rs.map((r) => r.id),
    meta: mode ? { layoutCascadeOverride: { mode } } : {} };
  const page = { id: "p", moduleId: "m-page", label: "Albums", parentId: folder, occurrences: ["b"] };
  return [page, board, ...rs];
}
const plan = (occ) => planTileAllMedia({ occurrences: occ, modules: MODS, folders: FOLDERS, houseSize: HOUSE });

describe("0260 — tiling every media board", () => {
  it("tiles a fully pictured board under Media/Music", () => {
    const p = plan(world());
    expect(p.targets.map((t) => t.label)).toEqual(["Albums"]);
    expect(p.targets[0].next.mode).toBe("wrap");
    expect(p.targets[0].next.childMinWidth).toBe(184);      // the house width, imported
    expect(p.targets[0].next.childMaxHeight).toBeGreaterThanOrEqual(432);
  });

  it("REFUSES a board that is not pictured — the rule is answered, not dropped", () => {
    const p = plan(world({ covered: 2 }));
    expect(p.targets).toEqual([]);
    expect(p.refused[0].coverage).toBeCloseTo(0.2);
    expect(COVERAGE_THRESHOLD).toBe(0.8);
  });

  it("ignores a fully pictured board that is NOT under Media", () => {
    const p = plan(world({ folder: "other" }));
    expect(p.targets).toEqual([]);
    expect(p.refused).toEqual([]);            // not media — not even considered
  });

  it("leaves an already-tiled board alone", () => {
    expect(plan(world({ mode: "wrap" })).targets[0].already).toBe(true);
  });

  it("skips a board with too few rows", () => {
    expect(plan(world({ n: 2, covered: 2 })).targets).toEqual([]);
  });

  it("walks the folder chain so a SUB-folder of Media still counts", () => {
    const byId = new Map(FOLDERS.map((f) => [f.id, f]));
    expect(folderChain("music", byId)).toEqual(["Music", "Media", "Boards", "Root"]);
    expect(folderChain("other", byId)).not.toContain("Media");
  });

  it("counts a cover on the row OR on its shared module", () => {
    const w = world({ covered: 0 });
    const mods = [...MODS.filter((m) => m.id !== "m-row"), { id: "m-row", role: "artifact", kind: "album", meta: { cover: "https://c/m.jpg" } }];
    const p = planTileAllMedia({ occurrences: w, modules: mods, folders: FOLDERS, houseSize: HOUSE });
    expect(p.targets).toHaveLength(1);        // Bookmarks store theirs on the module
  });
});
