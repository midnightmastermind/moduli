// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { slicePassage, toPattern, sectionToText } from "../helpers/bookText";

const BOOK = [
  "JANUARY 1\n\n\"I AM A MIRACLE\" The central fact of our lives today.",
  "JANUARY 2\n\nA second day's reading.",
  "OCTOBER 1\n\nFirst of October.",
  "OCTOBER 15\n\nThe fifteenth.\n\nMore of the fifteenth.",
  "OCTOBER 16\n\nThe sixteenth.",
].join("\n\n");
const NEXT_DATE = "/^(january|february|march|april|may|june|july|august|september|october|november|december) \\d+\\b/im";

describe("bookText.slicePassage", () => {
  it("cuts one day's reading: from its date to the next date heading", () => {
    const r = slicePassage(BOOK, { from: "/^October 15\\b/im", to: NEXT_DATE });
    expect(r.found).toBe(true);
    expect(r.text).toBe("OCTOBER 15\n\nThe fifteenth.\n\nMore of the fifteenth.");
  });
  it("a word boundary keeps OCTOBER 1 from matching OCTOBER 15", () => {
    expect(slicePassage(BOOK, { from: "/^October 1\\b/im", to: NEXT_DATE }).text).toBe("OCTOBER 1\n\nFirst of October.");
  });
  it("plain text matches case-insensitively; a missing marker is found:false, not the whole book", () => {
    expect(slicePassage(BOOK, { from: "second day" }).text.startsWith("second day")).toBe(true);
    expect(slicePassage(BOOK, { from: "/^March 3\\b/im" })).toEqual({ text: "", found: false });
  });
  it("no `to` → runs to maxChars; nothing at all → the start of the text", () => {
    expect(slicePassage(BOOK, { from: "/^October 16/im", maxChars: 9 }).text).toBe("OCTOBER 1");
    expect(slicePassage(BOOK, {}).found).toBe(true);
  });
  it("a bad regex is no pattern rather than a throw", () => {
    expect(toPattern("/(/")).toBe(null);
  });
});

describe("bookText.sectionToText", () => {
  it("reads headings as # lines and every other block once", () => {
    const doc = new DOMParser().parseFromString(
      "<body><h2>Step One</h2><p>We admitted.</p><ul><li><p>nested once</p></li></ul><div>loose</div></body>", "text/html");
    expect(sectionToText(doc)).toBe("## Step One\n\nWe admitted.\n\n- nested once");
  });

  it("reads a <br> as a space, so a heading's date does not run into its title", () => {
    const doc = new DOMParser().parseFromString("<body><h3>October 15th<br/><strong>THE DAY TITLE</strong></h3></body>", "text/html");
    expect(sectionToText(doc)).toBe("### October 15th THE DAY TITLE");
  });
});
