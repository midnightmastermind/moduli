// UI sweep 2026-10-19, item 43: the "/" palette opened at the window's top-left (a caret on an
// empty line has an all-zero rect) and listed nothing (the "/" itself was appended to its search).
// Editor needs the whole grid to mount, so these pin the wiring in its source.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf8");
const body = (name) => {
  const at = src.indexOf(`const ${name} = useCallback(`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("}, [", at));
};

describe("Editor popup triggers", () => {
  it("both openers mark their own character to be skipped", () => {
    expect(body("handleSlashKey")).toMatch(/skipTriggerCharRef\.current = "\/"/);
    expect(body("handleAtKey")).toMatch(/skipTriggerCharRef\.current = "@"/);
  });

  it("text input skips the marked character before appending to a popup's query", () => {
    const skip = src.indexOf("text === skipTriggerCharRef.current");
    const append = src.indexOf("if (showCommandPalette) setCommandQuery(p => p + text)");
    expect(skip).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(skip);
  });

  it("an all-zero caret rect falls back to the editor's own coordinates", () => {
    const pos = body("getCursorPosition");
    expect(pos).toMatch(/coordsAtPos/);
    expect(pos).toMatch(/!rect\.top && !rect\.bottom && !rect\.left/);
  });
});
