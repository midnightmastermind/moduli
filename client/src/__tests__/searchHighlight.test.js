// A SEARCH ROW EXPLAINS ITSELF, and it was explaining only its first word.
// User, 2026-09-30: *"I type A Guide and it does pop up with the right results
// but the 'A' is only highlighted"* — the component derived
// `firstTerm = query.split(/\s+/)[0]` and marked that alone.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { highlightSegments } from "../helpers/searchHighlight";

const TITLE = "A Guide to Recognizing Your Saints (2006) - IMDb";
const render = (text, q) =>
  highlightSegments(text, q).map((s) => (s.hit ? `[${s.text}]` : s.text)).join("");

describe("highlightSegments", () => {
  // THE REPORT.
  it("marks the whole phrase, not just its first word", () => {
    expect(render(TITLE, "A Guide")).toBe("[A Guide] to Recognizing Your Saints (2006) - IMDb");
  });

  // …and the phrase is ONE run, which is also what stops a one-letter word in
  // the query lighting up every letter like it in the label.
  it("keeps an adjacent phrase as a single mark", () => {
    const segs = highlightSegments(TITLE, "A Guide");
    expect(segs.filter((s) => s.hit)).toHaveLength(1);
  });

  it("normalises the typed whitespace", () => {
    expect(render(TITLE, "  a   guide  ")).toBe("[A Guide] to Recognizing Your Saints (2006) - IMDb");
  });

  it("matches case-insensitively and keeps the text's own case", () => {
    expect(render(TITLE, "gUiDe")).toBe("A [Guide] to Recognizing Your Saints (2006) - IMDb");
  });

  // When the words are apart there IS no phrase, so each term marks itself —
  // otherwise a real multi-term match would explain nothing.
  it("marks each term when they are not adjacent", () => {
    expect(render(TITLE, "saints 2006"))
      .toBe("A Guide to Recognizing Your [Saints] ([2006]) - IMDb");
  });

  it("marks every occurrence of a term", () => {
    expect(render("to and fro and back", "and")).toBe("to [and] fro [and] back");
  });

  it("merges overlapping runs so nothing is marked twice", () => {
    const segs = highlightSegments("aaaa", "aa");
    expect(segs).toEqual([{ text: "aaaa", hit: true }]);
  });

  // A query is typed text, not a pattern: "(2006)" must be searched literally.
  it("treats regex characters as literal text", () => {
    expect(render(TITLE, "(2006)")).toBe("A Guide to Recognizing Your Saints [(2006)] - IMDb");
    expect(render("a.b", "a.b")).toBe("[a.b]");
    expect(render("axb", "a.b")).toBe("axb");
  });

  it("returns the text whole when nothing matches, and for an empty query", () => {
    expect(highlightSegments(TITLE, "nope")).toEqual([{ text: TITLE, hit: false }]);
    expect(highlightSegments(TITLE, "")).toEqual([{ text: TITLE, hit: false }]);
    expect(highlightSegments(TITLE, "   ")).toEqual([{ text: TITLE, hit: false }]);
  });

  it("survives a missing label", () => {
    expect(highlightSegments(null, "a")).toEqual([{ text: "", hit: false }]);
    expect(highlightSegments(undefined, undefined)).toEqual([{ text: "", hit: false }]);
  });

  // Every segment concatenates back to the input — a highlighter that drops or
  // duplicates a character corrupts the row it was meant to explain.
  it("never loses or repeats a character", () => {
    for (const q of ["a", "A Guide", "saints 2006", "imdb", "(2006)", "zzz"]) {
      expect(highlightSegments(TITLE, q).map((s) => s.text).join("")).toBe(TITLE);
    }
  });

  it("is bounded on a pathological query", () => {
    const long = "a ".repeat(5000);
    expect(highlightSegments(long, "a").length).toBeLessThan(200);
  });
});

// The component must pass the WHOLE query. A helper that handles a phrase is
// inert behind a caller that still hands it one word — which is the bug.
describe("the search list passes the whole query", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/ui/OccurrenceSearch.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("derives no first-word term", () => {
    expect(code).not.toMatch(/split\(\/\\s\+\/\)\.filter\(Boolean\)\[0\]/);
    expect(code).toMatch(/term=\{debounced\}/);
  });

  it("renders through the shared helper", () => {
    expect(code).toMatch(/highlightSegments\(/);
    expect(src).toContain("occ-search-row-label");   // the control: reading the real file
  });
});
