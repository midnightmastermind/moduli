// Guards 0246's selection rule. The migration MINTS two documents per matched
// row on live data, so the question each test answers is "could this attach a
// poster to the wrong row, or attach a second one?"
import { describe, it, expect } from "vitest";
import { planPosterArtifacts, KINDS } from "../migrations/0246-poster-artifacts.mjs";

const MODS = new Map([
  ["m-movie",  { id: "m-movie",  role: "artifact", kind: "movie",  label: "Movie" }],
  ["m-series", { id: "m-series", role: "artifact", kind: "series", label: "TV Series" }],
  ["m-game",   { id: "m-game",   role: "artifact", kind: "game",   label: "Game" }],
  ["m-img",    { id: "m-img",    role: "artifact", kind: "image",  label: "poster" }],
  ["m-inst",   { id: "m-inst",   role: "instance", kind: "board",  label: "Task" }],
]);

const row = (id, moduleId, cover, extra = {}) => ({
  id, moduleId, userId: "u1", label: id, meta: cover ? { cover } : {}, ...extra,
});
const plan = (occs) => planPosterArtifacts({ occs, modById: MODS });

describe("0246 — which rows get a poster artifact", () => {
  it("matches a covered movie and a covered series", () => {
    const { targets } = plan([
      row("wick", "m-movie", "https://image.tmdb.org/a.jpg"),
      row("dark", "m-series", "https://image.tmdb.org/b.jpg"),
    ]);
    expect(targets.map((t) => t.occId).sort()).toEqual(["dark", "wick"]);
    expect(targets.find((t) => t.occId === "wick").cover).toBe("https://image.tmdb.org/a.jpg");
  });

  it("SKIPS a row with no cover instead of attaching an empty file", () => {
    // The 8 titles TMDB never matched. A poster artifact with no fileRef is a
    // broken-image glyph on the board — worse than the row it replaces.
    const { targets, noCover } = plan([row("obscure", "m-movie", null)]);
    expect(targets).toHaveLength(0);
    expect(noCover).toBe(1);
  });

  it("SKIPS a row that already owns an artifact child — so a re-run mints nothing", () => {
    // This is what makes the migration resumable. Without it, every pass adds
    // another poster and the row accumulates duplicates silently.
    const { targets, already } = plan([
      row("wick", "m-movie", "https://image.tmdb.org/a.jpg"),
      row("p1", "m-img", null, { parentId: "wick" }),
    ]);
    expect(targets).toHaveLength(0);
    expect(already).toBe(1);
  });

  it("still matches a row whose only child is NOT an artifact", () => {
    // The discriminator is the child's ROLE, not merely having children — a row
    // carrying some other occurrence still has no file.
    const { targets } = plan([
      row("wick", "m-movie", "https://image.tmdb.org/a.jpg"),
      row("note", "m-inst", null, { parentId: "wick" }),
    ]);
    expect(targets.map((t) => t.occId)).toEqual(["wick"]);
  });

  it("never touches a kind outside the table — a covered GAME is skipped", () => {
    // TMDB indexes neither games nor comics; a cover there would be someone
    // else's artwork. The kind table is the whole scope.
    const { targets, noCover, already } = plan([row("doom", "m-game", "https://image.tmdb.org/x.jpg")]);
    expect(targets).toHaveLength(0);
    expect(noCover).toBe(0);   // not "no cover" — out of scope entirely
    expect(already).toBe(0);
  });

  it("labels the poster after the ROW, not the shared module", () => {
    // 0238 mints ONE module per kind, so falling back to the module label would
    // name all 993 of them "Movie poster".
    const { targets } = plan([row("wick", "m-movie", "https://image.tmdb.org/a.jpg")]);
    expect(targets[0].label).toBe("wick");
  });

  it("KINDS is the movie/series pair and nothing else", () => {
    expect(KINDS).toEqual(["movie", "series"]);
  });
});
