import { describe, it, expect } from "vitest";
import { evalRule } from "../helpers/operationActions";
import { matchesPattern, compilePattern } from "../../../server/utils/matchesPattern.js";
import { slicePassage, pageStarts, pageAt } from "../helpers/bookText";

describe("MATCHES / NOT_MATCHES", () => {
  const rule = (left, comparator, right) => evalRule({ left: `literal:${left}`, comparator, right: `literal:${right}` }, {});
  it("plain text is a case-insensitive pattern; /re/flags is honoured", () => {
    expect(matchesPattern("October 15th", "^october \\d+")).toBe(true);
    expect(matchesPattern("October 15th", "/^october/")).toBe(false);   // flags given: case-sensitive
    expect(matchesPattern("October 15th", "/^october/i")).toBe(true);
  });
  it("an array left matches when any member does; empty never matches", () => {
    expect(matchesPattern(["a", "Chapter 3"], "chapter \\d")).toBe(true);
    expect(matchesPattern("", ".*")).toBe(false);
    expect(matchesPattern(null, ".*")).toBe(false);
  });
  it("an invalid pattern matches nothing instead of throwing", () => {
    expect(compilePattern("(")).toBeNull();
    expect(matchesPattern("anything", "(")).toBe(false);
  });
  it("evalRule wires both comparators", () => {
    expect(rule("Chapter 12", "MATCHES", "chapter \\d+")).toBe(true);
    expect(rule("Chapter 12", "NOT_MATCHES", "chapter \\d+")).toBe(false);
    expect(rule("Preface", "NOT_MATCHES", "chapter \\d+")).toBe(true);
  });
  it("a g flag cannot make the test stateful across records", () => {
    expect(matchesPattern("abc", "/b/g")).toBe(true);
    expect(matchesPattern("abc", "/b/g")).toBe(true);
  });
});

describe("READ_FILE: the page a passage starts on", () => {
  const pages = ["Title page", "JANUARY 1\nfirst reading", "more of it\nJANUARY 2\nsecond", "end"];
  const joined = pages.join("\n\n");
  const starts = pageStarts(pages);
  it("maps an offset of the joined text to its 1-based page", () => {
    expect(pageAt(starts, 0)).toBe(1);
    expect(pageAt(starts, joined.indexOf("JANUARY 1"))).toBe(2);
    expect(pageAt(starts, joined.indexOf("JANUARY 2"))).toBe(3);
    expect(pageAt(starts, joined.length - 1)).toBe(4);
  });
  it("slicePassage reports where the passage starts and ends", () => {
    const cut = slicePassage(joined, { from: "/^JANUARY 1\\b/m", to: "/^JANUARY 2\\b/m" });
    expect(cut.found).toBe(true);
    expect(pageAt(starts, cut.start)).toBe(2);
    expect(pageAt(starts, cut.end - 1)).toBe(3);   // runs on into the next page
  });
});
