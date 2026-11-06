// @vitest-environment jsdom
// axe target-size (sweep, 2026-11-06): rating stars were 14x14 and "Pick random" 23x19. Both are 24px targets now
// (user: "enlarge them").
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(process.cwd(), "src/ui/Field.jsx"), "utf8");
const starButtons = [...src.matchAll(/aria-label=\{`\$\{name \? name \+ ": " : ""\}\$\{star\} of \$\{maxRating\}`\}[^\n]*\n\s*style=\{\{([^}]*)\}\}/g)].map((m) => m[1]);
const diceButtons = [...src.matchAll(/title="Pick random"[\s\S]{0,700}?style=\{\{([^}]*)\}\}/g)].map((m) => m[1]);

describe("rating and dice are 24px targets", () => {
  it("finds both rating variants and both dice", () => {
    expect(starButtons.length).toBe(2);
    expect(diceButtons.length).toBe(2);
  });
  it.each([0, 1])("star button %i is 24x24", (i) => {
    expect(starButtons[i]).toMatch(/width: 24/);
    expect(starButtons[i]).toMatch(/height: 24/);
  });
  it.each([0, 1])("dice %i is at least 24x24", (i) => {
    expect(diceButtons[i]).toMatch(/minWidth: 24/);
    expect(diceButtons[i]).toMatch(/minHeight: 24/);
  });
});
