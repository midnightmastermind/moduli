// The "/" command palette opened on EVERY slash typed — including inside a word
// ("zucchini/peppers/onions") — then sat open reading "No commands found" and
// swallowed the next Enter, so the rest of the line and the line break were lost
// (2026-10-09, typing poms' Nutrition Plan into the rebuild). A slash opens it only
// where a command can start: the start of a line or after whitespace.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { slashOpensPalette } from "../docs/suggestions/slashTrigger.js";

describe("slashOpensPalette", () => {
  it("opens at the start of a line", () => { expect(slashOpensPalette("")).toBe(true); });
  it("opens after a space or tab", () => { expect(slashOpensPalette("Add ")).toBe(true); expect(slashOpensPalette("a\t")).toBe(true); });
  it("does NOT open inside a word or after punctuation", () => {
    expect(slashOpensPalette("zucchini")).toBe(false);
    expect(slashOpensPalette("1")).toBe(false);
    expect(slashOpensPalette("and/or (")).toBe(false);
  });
  it("Editor gates the trigger on it (control: the trigger still exists)", () => {
    const ed = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(ed).toMatch(/if \(event\.key === "\/" && slashOpensPalette\(/);
    expect(ed).toMatch(/handleSlashKey\(\)/);
  });
});
