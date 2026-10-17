import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  wordRangeAt, wordAt, lookupTerm, isCheckableWord, readSpelling, spellingSuggestions,
  readDefinitions, wikipediaSearchUrl,
} from "../helpers/textLookup.js";
import { buildTextActionItems } from "../helpers/textClipboard.js";

describe("wordRangeAt", () => {
  it("finds the word around or right after the offset", () => {
    expect(wordRangeAt("hello wrold here", 8)).toEqual({ from: 6, to: 11, word: "wrold" });
    expect(wordAt("hello wrold here", 11)).toBe("wrold");   // caret right after it
    expect(wordAt("don't stop", 2)).toBe("don't");
  });
  it("is empty between words and on punctuation", () => {
    expect(wordRangeAt("a  b", 2)).toBeNull();
    expect(wordAt("...", 1)).toBe("");
  });
  it("trims quotes and dashes at the ends", () => {
    expect(wordAt("'quoted'", 3)).toBe("quoted");
  });
});

describe("lookups", () => {
  it("prefers the selection, cut to one line", () => {
    expect(lookupTerm("  Carl \n Jung  ", "x")).toBe("Carl Jung");
    expect(lookupTerm("", "word")).toBe("word");
  });
  it("only checks real words", () => {
    expect(isCheckableWord("teh")).toBe(true);
    expect(isCheckableWord("NASA")).toBe(false);
    expect(isCheckableWord("a1")).toBe(false);
    expect(isCheckableWord("x")).toBe(false);
  });
  it("a word Datamuse returns as itself is spelled right", () => {
    expect(readSpelling("there", [{ word: "there" }, { word: "three" }])).toEqual({ misspelled: false, suggestions: [] });
  });
  it("otherwise offers suggestions, keeping capitalisation", () => {
    const r = readSpelling("Teh", [{ word: "the" }, { word: "tea" }, { word: "ten" }, { word: "the end" }]);
    expect(r.misspelled).toBe(true);
    expect(r.suggestions).toEqual(["The", "Tea", "Ten"]);
  });
  it("spellingSuggestions answers null when the service cannot be reached", async () => {
    const f = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await spellingSuggestions("wrold", f)).toBeNull();
  });
  it("reads definitions", () => {
    const lines = readDefinitions([{ meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A thing." }, { definition: "Another." }] }] }], 1);
    expect(lines).toEqual(["(noun) A thing."]);
    expect(wikipediaSearchUrl("Carl Jung")).toContain("search=Carl%20Jung");
  });
});

describe("buildTextActionItems", () => {
  const fn = () => {};
  it("offers the Windows text items in order", () => {
    const labels = buildTextActionItems({
      hasSelection: true, selectedText: "jung", onUndo: fn, onRedo: fn, onCut: fn, onCopy: fn,
      onPaste: fn, onDelete: fn, onSelectAll: fn,
    }).filter((i) => !i.separator).map((i) => i.label);
    expect(labels).toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "Delete", "Select all",
      'Search Wikipedia for "jung"', 'Define "jung"']);
  });
  it("a read-only selection offers Copy and the lookups only", () => {
    const labels = buildTextActionItems({ hasSelection: true, selectedText: "two words", onCopy: fn })
      .filter((i) => !i.separator).map((i) => i.label);
    expect(labels).toEqual(["Copy", 'Search Wikipedia for "two words"']);   // no Define for a phrase
  });
});

describe("a right-click keeps the highlight", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  it("the editor's caret fix-up runs on the LEFT button only", () => {
    expect(read("ui/Editor.jsx")).toMatch(/if \(e\.button === 0 && editor && editor\.isEditable && ownsClick/);
  });
  it("a lazy textblock goes live on a left press only", () => {
    for (const f of ["modules/TextblockCard.jsx", "modules/DocContent.jsx"]) {
      expect(read(f)).toMatch(/onPointerDown=\{\(e\) => \{ if \(e\.button === 0\) goLive\(\); \}\}/);
      expect(read(f)).not.toMatch(/onPointerDown=\{goLive\}/);
    }
  });
});
