// A textblock made by clicking a wrap's gap is removed when it is left empty
// (helpers/gapMints). It is a real row from the start, so the doc mint's
// provisional vanish never covered it (2026-10-01 (5): "Not done").
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { markGapMint, isGapMint, forgetGapMint } from "../helpers/gapMints";

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

describe("gapMints", () => {
  test("mark, ask, forget", () => {
    markGapMint("a");
    expect(isGapMint("a")).toBe(true);
    expect(isGapMint("b")).toBe(false);
    forgetGapMint("a");
    expect(isGapMint("a")).toBe(false);
    expect(isGapMint(null)).toBe(false);
  });
});

describe("wiring", () => {
  test("the gap click marks the block it makes", () => {
    expect(read("../docs/WrapGroupNode.jsx")).toMatch(/markGapMint\(made\.occurrenceId\)/);
  });
  test("a marked card hands its editor an empty-blur that runs the embed's Delete", () => {
    const mt = read("../modules/ModuleTextblock.jsx");
    expect(mt).toMatch(/onEmptyBlur=\{isGapMint\(occurrence\.id\) && rest\.embedOnDelete/);
    expect(mt).toMatch(/forgetGapMint\(occurrence\.id\); rest\.embedOnDelete\(\);/);
    const tc = read("../modules/TextblockCard.jsx");
    expect(tc).toMatch(/onEmptyBlur=\{onEmptyBlur\}/);
  });
  test("a block that has held text is no longer removed when emptied", () => {
    expect(read("../modules/TextblockCard.jsx")).toMatch(/!isEmptyTextblockDoc\(occurrence\.textmap\)\) \{\s*forgetGapMint/);
  });
});
