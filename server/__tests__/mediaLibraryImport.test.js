// 0238 — the decisions in "use media.md to fill in the remaining medias", driven dry.
//
// The dedupe is the whole risk of this migration: a false negative mints a
// duplicate onto a board that already holds a clean catalogue. My first probe
// reported 44 of media.md's 676 books already present; the truth is 464. These
// tests pin the rule that closed that gap.
import { describe, it, expect } from "vitest";
import {
  KINDS, readTagOptions, cleanTitle, normTitle, alreadyPresent, ownedFor, topicOf, TRUNC_AT, yearOf,
} from "../migrations/0238-media-library-import.mjs";
import { parseMediaMd, parseOwned, parseSize, driveOf } from "../scripts/parseMediaMd.mjs";

describe("cleanTitle — the year comes OUT of the title, on every kind", () => {
  it("strips the trailing parenthetical from a film, a book and an album alike", () => {
    // User: "dont put the year in the title in our system". It also matches
    // what the boards these merge into already look like — 0 of 666 grid books
    // and 0 of 2,757 grid albums carry a suffix.
    expect(cleanTitle("RoboCop (2014)")).toBe("RoboCop");
    expect(cleanTitle("Watchmen (217)")).toBe("Watchmen");
    expect(cleanTitle("Ballbreaker (1995)")).toBe("Ballbreaker");
  });

  it("leaves a NON-numeric parenthetical alone — that is part of the name", () => {
    expect(cleanTitle("The Office (US)")).toBe("The Office (US)");
  });
});

describe("yearOf — the year is moved, not deleted", () => {
  it("reads the year off a film, a series and an album", () => {
    expect(yearOf("RoboCop (2014)", "movie")).toBe(2014);
    expect(yearOf("Fargo (2014)", "series")).toBe(2014);
    expect(yearOf("Ballbreaker (1995)", "musicAlbum")).toBe(1995);
  });

  it("refuses to read a BOOK's trailing number as a year", () => {
    // A book's (415) is a file count. Reading it as a year would print an
    // authoritative-looking 415 beside a book, and 2010 beside another — the
    // key's NAME is not evidence about its VALUE.
    expect(yearOf("A Theory of Human Motivation (415)", "book")).toBeNull();
    expect(yearOf("Some Book (2010)", "book")).toBeNull();
  });

  it("returns null for a count that is not a plausible year, and for no suffix", () => {
    expect(yearOf("Thing (217)", "movie")).toBeNull();
    expect(yearOf("Thing", "movie")).toBeNull();
  });
});

describe("normTitle — the match key keeps the year only where it is identity", () => {
  it("keeps two same-named FILMS apart", () => {
    // The discriminating case for the whole rule: a bare-title key merges every
    // remake into its original.
    expect(normTitle("The Ring (2002)", "movie")).not.toBe(normTitle("The Ring (1927)", "movie"));
  });

  it("collapses an ALBUM onto its bare title so it can find the Spotify row", () => {
    expect(normTitle("Ballbreaker (1995)", "musicAlbum")).toBe(normTitle("Ballbreaker", "musicAlbum"));
  });

  it("collapses a BOOK onto its bare title so it can find the Calibre row", () => {
    expect(normTitle("Watchmen (217)", "book")).toBe(normTitle("Watchmen", "book"));
  });
});

describe("alreadyPresent — the rule that stopped ~442 duplicate books", () => {
  const grid = new Set([
    normTitle("Watchmen"),
    normTitle("Become What You Are: Expanded Edition"),
    normTitle("Nature, Man and Woman"),
    normTitle("The Ring Two"),
  ]);

  it("matches an exact title through the count suffix", () => {
    expect(alreadyPresent("Watchmen (217)", grid, "book")).toBe(true);
  });

  it("matches a TRUNCATED title as a prefix of the real one", () => {
    // media.md cuts book titles at ~34 chars, so this is the same book:
    //   grid      "Become What You Are: Expanded Edition"
    //   media.md  "Become What You Are_ Expanded Editi (152)"
    const truncated = "Become What You Are_ Expanded Editi (152)";
    expect(cleanTitle(truncated).length).toBeGreaterThanOrEqual(TRUNC_AT);
    expect(alreadyPresent(truncated, grid, "book")).toBe(true);
  });

  it("gives the prefix arm to BOOKS ONLY — no other table truncates", () => {
    // A 33+ char film title is a full title, not a truncated one. Applying the
    // prefix arm there would silently merge a film into any longer film whose
    // name starts with it.
    const long = "The Lord of the Rings: The Fellowship of the Ring";
    const short = "The Lord of the Rings: The Fellowship";     // 37 chars: past TRUNC_AT
    expect(short.length).toBeGreaterThanOrEqual(TRUNC_AT);       // or this proves nothing
    const films = new Set([normTitle(long, "movie")]);
    expect(alreadyPresent(short, films, "movie")).toBe(false);
    // the control: the SAME pair does match once it is a book, so the arm works
    expect(alreadyPresent(short, films, "book")).toBe(true);
  });

  it("does NOT let a SHORT title prefix-match a longer different work", () => {
    // The discriminating case, and the reason the prefix arm is gated on the
    // truncation length: "The Ring" is not "The Ring Two". Ungated, every short
    // title would silently match any longer one that starts with it.
    expect(cleanTitle("The Ring").length).toBeLessThan(TRUNC_AT);
    expect(alreadyPresent("The Ring", grid, "book")).toBe(false);
  });

  it("reports a genuinely new work as new", () => {
    expect(alreadyPresent("The Silmarillion", grid, "book")).toBe(false);
  });

  it("refuses an untitled row rather than importing a blank card", () => {
    expect(alreadyPresent("", grid, "book")).toBe(true);
    expect(alreadyPresent("   ", grid, "book")).toBe(true);
  });
});

describe("ownedFor — measured per kind, never guessed", () => {
  it("takes the Status column where the table has one", () => {
    expect(ownedFor({ kind: "movie", owned: true })).toBe(true);
    expect(ownedFor({ kind: "movie", owned: false })).toBe(false);   // the want-list
  });

  it("reads a file listing as owned, because the row exists only if the file does", () => {
    // Documentaries, games, music and books have no Status column: those tables
    // are drive scans. This is a reading of the source, not an assumption.
    expect(ownedFor({ kind: "documentary", owned: null })).toBe(true);
    expect(ownedFor({ kind: "game" })).toBe(true);
  });
});

describe("KINDS — what merges and what gets a board of its own", () => {
  it("merges the kinds whose board already exists", () => {
    // Minting a second Books board beside the Calibre one splits one library in
    // two; the music halves are the same artists Spotify already knows.
    for (const k of ["book", "musicArtist", "musicAlbum"]) expect(KINDS[k].merge).toBe(true);
  });

  it("gives a board to the kinds with no home today", () => {
    for (const k of ["movie", "series", "documentary", "game", "comic"]) {
      expect(KINDS[k].merge).toBeUndefined();
    }
  });

  it("never reuses a tag that already means something else on the grid", () => {
    // `media`, `reading` and `course` are live Board Category values. A movie
    // tagged `media` would land on the Media board beside podcasts.
    const tags = Object.values(KINDS).map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const t of ["media", "reading", "course", "person"]) expect(tags).not.toContain(t);
  });
});

describe("topicOf — the documentary topic folder, without its stats", () => {
  it("keeps the folder name and drops the count", () => {
    expect(topicOf("13 Secret History — 221 files, 33.6 GB")).toBe("13 Secret History");
    expect(topicOf("MIX — 106 files, 13.4 GB")).toBe("MIX");
  });
  it("returns null rather than an empty string for a row with no section", () => {
    expect(topicOf(null)).toBeNull();
    expect(topicOf("")).toBeNull();
  });
});

describe("readTagOptions — the option list lives in one of two places", () => {
  it("prefers optionsSource.values when present", () => {
    const f = { meta: { optionsSource: { values: ["a"] }, options: ["b"] } };
    expect(readTagOptions(f)).toEqual({ path: "meta.optionsSource.values", values: ["a"] });
  });
  it("falls back to meta.options", () => {
    expect(readTagOptions({ meta: { options: ["b"] } }))
      .toEqual({ path: "meta.options", values: ["b"] });
  });
});

// ── the parser the migration is fed by ──────────────────────────────────────
describe("parseMediaMd — a table is read only when its header is a declared shape", () => {
  const MD = `
## Movies

### Odin — 400 movie folders

| Film | Status | Files | Size | Location |
|---|---|---|---|---|
| Dune (2021) | **owned — complete** | 1 | 45.0 GB | \`movies/Dune (2021)\` |
| Tenet | not owned | 0 | — | \`movies/Tenet\` |

## Cross-drive overlap

| Film | Drives | Reclaimable |
|---|---|---|
| Forces of Nature (1999) | Freyja 8.9 GB · Loki 8.9 GB | **8.9 GB** |
| RoboCop (2014) | Odin 22.7 GB · Baldr 4.2 GB | **4.2 GB** |
`;

  it("imports the data table and NOT the analysis table beside it", () => {
    // The overlap table's first column is also called "Film". Walking every
    // table under "## Movies" would import the analysis as two more films.
    const { rows, skipped } = parseMediaMd(MD);
    expect(rows.map((r) => r.title)).toEqual(["Dune (2021)", "Tenet"]);
    expect(rows.every((r) => r.kind === "movie")).toBe(true);
    expect(skipped).toEqual([]);          // the overlap table is DECLARED, not a mystery
  });

  it("does not re-test an ignored table's DATA rows as headers", () => {
    // The three-state fix: collapsing "ignored" into "no table open" made every
    // data row of an ignored table get reported as an unparsed table.
    const { skipped } = parseMediaMd(MD);
    expect(skipped.some((s) => s.sig?.includes("Forces of Nature"))).toBe(false);
  });

  it("reports an UNDECLARED table once, so a missed shape is visible", () => {
    const { rows, skipped } = parseMediaMd(
      "| Mystery | Thing |\n|---|---|\n| a | b |\n| c | d |\n");
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);      // once, not once per row
  });

  it("reads owned from the Status column and carries the drive down from the h3", () => {
    const { rows } = parseMediaMd(MD);
    expect(rows[0]).toMatchObject({ owned: true, drive: "Odin", location: "movies/Dune (2021)" });
    expect(rows[1].owned).toBe(false);
  });
});

describe("parseOwned / parseSize / driveOf", () => {
  it("reads 'not owned' as false BEFORE it reads 'owned' as true", () => {
    // "not owned" CONTAINS "owned"; testing the positive first inverts the
    // whole want-list.
    expect(parseOwned("**not owned**")).toBe(false);
    expect(parseOwned("owned — complete")).toBe(true);
    expect(parseOwned("—")).toBeNull();
  });

  it("converts sizes to bytes and refuses what it cannot parse", () => {
    expect(parseSize("45.0 GB")).toBe(45_000_000_000);
    expect(parseSize("~5.0 GB")).toBe(5_000_000_000);
    expect(parseSize("877 MB")).toBe(877_000_000);
    expect(parseSize("—")).toBeNull();
    expect(parseSize("a few gigs")).toBeNull();
  });

  it("takes the drive name off an h3 that also carries its stats", () => {
    expect(driveOf("### Odin — 400 movie folders (3.21 TB)")).toBe("Odin");
  });
});
