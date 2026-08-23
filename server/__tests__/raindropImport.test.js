// Turning the Raindrop export into what goes on the grid. Pure, because the
// alternative is discovering a rule was wrong after 1,467 rows are written.
import { describe, it, expect } from "vitest";
import { parseCsv, isMeaningfulTag, isMeaningfulFolder, searchTermOf, tagsFor, planRaindropImport }
  from "../utils/raindropImport.js";

describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("keeps a COMMA inside a quoted field", () => {
    // Excerpts are full of them. A split(",") shears the row and every column
    // after it lands in the wrong key — silently.
    expect(parseCsv('a,b\n"x, y",2')).toEqual([{ a: "x, y", b: "2" }]);
  });

  it("keeps a NEWLINE inside a quoted field", () => {
    // Some excerpts in this export span lines; a line-based reader would treat
    // the remainder as a new bookmark.
    expect(parseCsv('a,b\n"one\ntwo",2')).toEqual([{ a: "one\ntwo", b: "2" }]);
  });

  it('reads "" as one escaped quote', () => {
    expect(parseCsv('a\n"he said ""hi"""')).toEqual([{ a: 'he said "hi"' }]);
  });

  it("normalises CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("skips a trailing blank line rather than inventing a row", () => {
    expect(parseCsv("a\n1\n")).toHaveLength(1);
  });
});

describe("isMeaningfulTag", () => {
  it("drops Raindrop's auto DATE tags", () => {
    // 19 of the export's 28 tags are these, covering 906 bookmarks.
    for (const t of ["21/08/2025", "3/12/2026", "2/28/2026", "April 29 2023", "August 14 2023"]) {
      expect(isMeaningfulTag(t)).toBe(false);
    }
  });

  it("keeps a real tag — the control", () => {
    for (const t of ["articles", "philosophy", "ai_project", "want"]) {
      expect(isMeaningfulTag(t)).toBe(true);
    }
  });

  it("is a RULE, not a list of the nine that exist today", () => {
    // A list would silently drop whatever a future export adds.
    expect(isMeaningfulTag("some-tag-nobody-has-used-yet")).toBe(true);
  });
});

describe("isMeaningfulFolder", () => {
  it("drops a folder Raindrop named after a moment", () => {
    expect(isMeaningfulFolder("Bookmarks Bar / Jul 24 at 11:34")).toBe(false);
  });
  it("keeps a real folder", () => {
    expect(isMeaningfulFolder("Bookmarks Bar / Computer Science")).toBe(true);
    expect(isMeaningfulFolder("Unsorted")).toBe(true);
  });
});

describe("searchTermOf", () => {
  it("extracts the term from a google search", () => {
    expect(searchTermOf("https://www.google.com/search?client=firefox&q=hand+of+mysteries"))
      .toBe("hand of mysteries");
  });

  it("returns null for a google URL that is NOT a search", () => {
    // The 43 rows this protects — accounts.google.com, remotedesktop.google.com.
    // Matching the DOMAIN instead of the parameter would have binned four dozen
    // real bookmarks.
    expect(searchTermOf("https://remotedesktop.google.com/access/")).toBeNull();
    expect(searchTermOf("https://accounts.google.com/v3/signin/accountchooser")).toBeNull();
  });

  it("returns null for any other site, even one with a q parameter", () => {
    expect(searchTermOf("https://example.com/search?q=cats")).toBeNull();
  });

  it("is null for junk rather than a crash", () => {
    expect(searchTermOf("not a url")).toBeNull();
    expect(searchTermOf(null)).toBeNull();
  });
});

describe("tagsFor", () => {
  it("combines real tags with the folder and drops the dates", () => {
    expect(tagsFor({ tags: "articles, 21/08/2025, videos", folder: "Content" }))
      .toEqual(["articles", "videos", "Content"]);
  });
  it("de-duplicates when the folder repeats a tag", () => {
    expect(tagsFor({ tags: "Content", folder: "Content" })).toEqual(["Content"]);
  });
});

describe("planRaindropImport", () => {
  const rows = [
    { id: "1", url: "https://a.example", title: "A", created: "2026-01-02", tags: "articles", folder: "Content" },
    { id: "2", url: "https://a.example", title: "A again", created: "2026-03-04" },
    { id: "3", url: "https://www.google.com/search?q=hand+of+mysteries", created: "2026-01-01" },
    { id: "4", url: "https://www.google.com/search?q=Hand+Of+Mysteries", created: "2026-01-05" },
    { id: "5", url: "https://remotedesktop.google.com/access/", title: "Remote", created: "2026-01-06" },
  ];

  it("routes searches to Lookup and keeps everything else", () => {
    const p = planRaindropImport(rows);
    expect(p.bookmarks.map(b => b.title)).toEqual(["A", "Remote"]);
    expect(p.dropped.searches).toBe(2);
  });

  it("de-duplicates a repeated term case-insensitively", () => {
    expect(planRaindropImport(rows).lookupTerms).toEqual(["hand of mysteries"]);
  });

  it("keeps the EARLIEST of a repeated URL", () => {
    // The first time you saved something is the one with the context you saved
    // it in. Sorting before de-duplication is what makes that true.
    const p = planRaindropImport(rows);
    expect(p.bookmarks.find(b => b.url === "https://a.example").title).toBe("A");
    expect(p.dropped.duplicates).toBe(1);
  });

  it("carries the fields a row needs and nothing it does not", () => {
    const b = planRaindropImport(rows).bookmarks[0];
    expect(b).toMatchObject({ url: "https://a.example", title: "A", created: "2026-01-02", tags: ["articles", "Content"] });
  });

  it("falls back to the URL when a bookmark has no title", () => {
    const p = planRaindropImport([{ id: "9", url: "https://x.example", created: "2026-01-01" }]);
    expect(p.bookmarks[0].title).toBe("https://x.example");
  });

  it("an empty export plans nothing — the control", () => {
    expect(planRaindropImport([])).toEqual({ bookmarks: [], lookupTerms: [], dropped: { searches: 0, duplicates: 0 } });
  });
});
