// The whole codex plan rests on a census of the corpus. If the corpus changes
// underneath it, every later expectation is silently wrong — so the census is a
// test rather than a number in a document.
import { describe, it, expect } from "vitest";
import { listCodexFiles, CODEX_ROOT } from "../utils/codexCorpus.js";
import fs from "node:fs";

const present = fs.existsSync(CODEX_ROOT);

describe.skipIf(!present)("listCodexFiles", () => {
  const files = present ? listCodexFiles(CODEX_ROOT) : [];

  it("finds every markdown file and NOTHING else", () => {
    // profileoverview.txt is deliberately excluded: it is not markdown, and the
    // importer's parser is a markdown parser. Importing it would produce one
    // giant prose blob rather than a structured page.
    expect(files.length).toBe(75);
    expect(files.every(f => f.relPath.endsWith(".md"))).toBe(true);
  });

  it("keys each file by its RELATIVE path, because basenames repeat", () => {
    // Measured: `Untitled 1.md` exists at the root AND in untitled_notes/ with
    // different content. A basename signature would collide and the second file
    // would be silently skipped as "already imported".
    const dupes = files.filter(f => f.basename === "Untitled 1.md");
    expect(dupes.length).toBe(2);
    expect(new Set(dupes.map(f => f.relPath)).size).toBe(2);
  });

  it("reports the folder each file lives in, '' for the root", () => {
    expect(new Set(files.map(f => f.folder))).toEqual(new Set([
      "", "writing", "daytracker", "dreams", "organization",
      "portugal", "tvshow", "untitled_notes", "voice_notes",
    ]));
  });

  it("is sorted, so a resumed run walks the same order", () => {
    const paths = files.map(f => f.relPath);
    expect(paths).toEqual([...paths].sort());
  });
});
