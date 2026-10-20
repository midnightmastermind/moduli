// UI sweep 2026-10-19 (row 10, phone): the op editor and its run log sat side by side with no
// wrap; on a 390px screen the log's 280px floor crushed the editor to ~90px and covered it.
// And a trigger's "specific module" select grew to its longest option, pushing P# and × apart.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
describe("op editor layout", () => {
  it("editor + log wrap, and the editor keeps a usable width", () => {
    expect(src).toMatch(/display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" \}\}>\s*<div style=\{\{ flex: "1 1 60%", minWidth: "min\(100%, 420px\)" \}\}>/);
  });
  it("the specific-module select is capped and priority + remove stay together", () => {
    expect(src).toMatch(/title="Specific module \(optional\)"[\s\S]{0,400}maxWidth: 220/);
    expect(src).toMatch(/marginLeft: "auto", whiteSpace: "nowrap" \}\}>\s*<select\s+value=\{trigObj\.priority/);
  });
});
