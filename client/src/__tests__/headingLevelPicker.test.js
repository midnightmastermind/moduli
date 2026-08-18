// Markdown typing in a container header.
//
// The button is the reachable control (a bound header is a native <select> —
// there is nothing to type into), but typing stays supported, and this is the
// half that can be tested without a contentEditable: the DOM half of a header
// edit is exactly what is painful to drive in jsdom.
import { describe, it, expect } from "vitest";
import { parseHeadingPrefix, LEVELS } from "../ui/HeadingLevelPicker.jsx";

describe("parseHeadingPrefix", () => {
  it("reads the level off the hashes and hands back the bare label", () => {
    expect(parseHeadingPrefix("## Journal")).toEqual({ level: 2, label: "Journal" });
    expect(parseHeadingPrefix("# Today")).toEqual({ level: 1, label: "Today" });
    expect(parseHeadingPrefix("###### Deep")).toEqual({ level: 6, label: "Deep" });
  });

  it("SEVEN hashes is not a heading — markdown's rule, and clamping would eat text", () => {
    expect(parseHeadingPrefix("####### Nope")).toBeNull();
  });

  it("needs a space, so a label that simply starts with # is left alone", () => {
    expect(parseHeadingPrefix("#1 priority")).toBeNull();
  });

  it("hashes with no words is someone mid-thought, not a rename", () => {
    expect(parseHeadingPrefix("## ")).toBeNull();
    expect(parseHeadingPrefix("##")).toBeNull();
  });

  it("leaves ordinary text completely alone", () => {
    expect(parseHeadingPrefix("Journal")).toBeNull();
    expect(parseHeadingPrefix("")).toBeNull();
    expect(parseHeadingPrefix(null)).toBeNull();
  });

  it("keeps hashes that appear later in the label", () => {
    expect(parseHeadingPrefix("## Sprint #4")).toEqual({ level: 2, label: "Sprint #4" });
  });

  it("offers exactly the six markdown levels", () => {
    expect(LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
