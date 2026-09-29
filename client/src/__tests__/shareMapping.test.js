// client/src/__tests__/shareMapping.test.js
//
// The failure this guards: a mapping that silently resolves to empty. The
// window shows every resolved value in an editable box precisely because that
// failure is invisible otherwise — these tests are the same claim, offline.
import { describe, it, expect } from "vitest";
import { SHARE_SOURCES, SHARE_TRANSFORMS, resolveMapping, resolveMappings } from "../helpers/shareMapping";

// The real clip the feature was designed against (spec §1).
const CLIP = {
  title: "A Guide to Recognizing Your Saints (2006) IMDb",
  url: "https://www.imdb.com/title/tt0473488/",
  linkUrl: "https://www.imdb.com/title/tt0473488/",
  selection: "",
  imageUrl: "https://m.media-amazon.com/images/M/poster.jpg",
  siteName: "IMDb",
  description: "A coming-of-age story set in Astoria, Queens.",
};

describe("sources", () => {
  it("reads every declared source off a clip without throwing", () => {
    for (const s of SHARE_SOURCES) expect(() => s.read(CLIP)).not.toThrow();
  });

  it("returns an empty string for a source the clip does not carry", () => {
    // Not undefined: the box is a controlled input, and undefined makes React
    // flip it to uncontrolled mid-edit.
    const sel = SHARE_SOURCES.find((s) => s.value === "selection");
    expect(sel.read(CLIP)).toBe("");
    expect(sel.read({})).toBe("");
  });

  it("offers today's date as an ISO day", () => {
    const today = SHARE_SOURCES.find((s) => s.value === "today");
    expect(today.read(CLIP)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("transforms", () => {
  const apply = (v, input) => SHARE_TRANSFORMS.find((t) => t.value === v).apply(input);

  it("extracts a year", () => {
    expect(apply("year", CLIP.title)).toBe("2006");
  });

  it("returns an empty string when there is no year, rather than the input", () => {
    // A transform that silently passes the input through would write
    // "A Guide to Recognizing Your Saints" into a Year field.
    expect(apply("year", "A Guide to Recognizing Your Saints")).toBe("");
  });

  it("takes the FIRST year when a title carries two", () => {
    expect(apply("year", "Blade Runner (1982) vs 2049 (2017)")).toBe("1982");
  });

  it("strips a trailing site suffix", () => {
    expect(apply("stripSuffix", "A Guide to Recognizing Your Saints (2006) IMDb"))
      .toBe("A Guide to Recognizing Your Saints (2006)");
    expect(apply("stripSuffix", "Some Page – Wikipedia")).toBe("Some Page");
    expect(apply("stripSuffix", "Some Page | IMDb")).toBe("Some Page");
  });

  it("leaves a title with no suffix alone", () => {
    expect(apply("stripSuffix", "A Guide to Recognizing Your Saints")).toBe("A Guide to Recognizing Your Saints");
  });

  it("leaves a hyphenated TITLE alone — a bare hyphen is not a separator", () => {
    // An earlier regex put a bare `-` in the separator class and turned
    // "Ant-Man and the Wasp" into "Ant". Movie titles are full of hyphens.
    expect(apply("stripSuffix", "X-Men")).toBe("X-Men");
    expect(apply("stripSuffix", "Spider-Man: No Way Home")).toBe("Spider-Man: No Way Home");
    expect(apply("stripSuffix", "Ant-Man and the Wasp")).toBe("Ant-Man and the Wasp");
  });

  it("still strips a spaced separator, which is what a site suffix uses", () => {
    expect(apply("stripSuffix", "Spider-Man: No Way Home - IMDb")).toBe("Spider-Man: No Way Home");
    expect(apply("stripSuffix", "X-Men | Rotten Tomatoes")).toBe("X-Men");
  });

  it("takes the text inside parentheses", () => {
    expect(apply("parens", "Movie Night (2006)")).toBe("2006");
    expect(apply("parens", "no parens here")).toBe("");
  });

  it("extracts a number, including a decimal", () => {
    expect(apply("number", "42.7 GB")).toBe("42.7");
    expect(apply("number", "no digits")).toBe("");
  });

  it("trims and lowercases", () => {
    expect(apply("trim", "  spaced  ")).toBe("spaced");
    expect(apply("lower", "IMDb")).toBe("imdb");
  });

  it("every transform survives an empty input", () => {
    for (const t of SHARE_TRANSFORMS) expect(t.apply("")).toBe("");
  });
});

describe("resolveMapping", () => {
  it("applies the source then the transform", () => {
    expect(resolveMapping(CLIP, { source: "title", transform: "year" })).toBe("2006");
  });

  it("a literal source returns its own value, untransformed by default", () => {
    expect(resolveMapping(CLIP, { source: "literal", value: "movie" })).toBe("movie");
  });

  it("an override wins over everything — the edited box", () => {
    expect(resolveMapping(CLIP, { source: "title", transform: "year", override: "1999" })).toBe("1999");
  });

  it("an empty-string override is respected, not treated as absent", () => {
    // Clearing the box means "write nothing here", and must not silently
    // re-resolve the source.
    expect(resolveMapping(CLIP, { source: "title", override: "" })).toBe("");
  });

  it("an unknown source or transform resolves to empty rather than throwing", () => {
    expect(resolveMapping(CLIP, { source: "nope" })).toBe("");
    expect(resolveMapping(CLIP, { source: "title", transform: "nope" })).toBe(CLIP.title);
  });

  it("source 'none' is empty — the unmapped row", () => {
    expect(resolveMapping(CLIP, { source: "none" })).toBe("");
  });
});

describe("resolveMappings", () => {
  it("resolves a whole table and DROPS the empty ones", () => {
    // An empty value must not be written: CREATE skips empties anyway, and a
    // row of "" in the payload reads as an intended blank.
    const out = resolveMappings(CLIP, {
      "f-title": { source: "title", transform: "stripSuffix" },
      "f-year": { source: "title", transform: "year" },
      "f-rating": { source: "none" },
    });
    expect(out).toEqual({
      "f-title": "A Guide to Recognizing Your Saints (2006)",
      "f-year": "2006",
    });
  });
});
