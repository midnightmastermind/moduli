// The file viewer with the Jellyfin player (user 2026-11-03 15:39): "no fields in the file viewer" — a row shown as a
// viewer tile (an episode's own tile next to its video) is its picture, not its whole card; and maximizing the player
// must hide the other tiles. The container shell sets `display` INLINE, so the hide rule needs !important (measured on
// prod: the poster tile stayed display:flex beside the maximized player).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("viewer tiles", () => {
  it("a row inside the viewer resolves no fields", () => {
    const src = code(read("modules/ModuleInstance.jsx"));
    const memo = src.slice(src.indexOf("const instanceFields = useMemo"), src.indexOf("const instanceFields = useMemo") + 600);
    expect(memo).toMatch(/inSpread\)\s*return \[\]/);
    expect(memo).toMatch(/\[[^\]]*inSpread[^\]]*\]\);/);           // a dep, or a viewer opened later keeps stale fields
    expect(src).toMatch(/const inSpread = !!useSpreadHost\(\)/);   // control: the flag still exists
  });
  it("a maximized player hides the other tiles over the shell's inline display", () => {
    const css = read("index.css");
    expect(css).toMatch(/\.spread-player-tile--max ~ :not\(\.spread-player-tile\)\s*\{\s*display:\s*none\s*!important;/);
  });
});
