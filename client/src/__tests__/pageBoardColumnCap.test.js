// A board page's columns are never wider than the board's visible width: on a 390px phone the rebuild's Day Page
// columns (420-560px) ran off the screen and cut the Emotions Wheel in half (2026-10-20). PageBoard needs the whole
// grid to mount, so this pins the wiring; the fix was measured on prod's data at 390px and 1600px.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/pages/PageBoard.jsx"), "utf8");

describe("board page columns", () => {
  it("cap their min and max width at the scroller's width", () => {
    expect(src).toMatch(/minWidth: `min\(\$\{colMinW\}px, 100cqw\)`, maxWidth: `min\(\$\{colMaxW\}px, 100cqw\)`/);
  });
  it("the column scroller is the query container", () => {
    expect(src).toMatch(/containerType: mode === "flex-row" \? "inline-size" : undefined/);
  });
});
