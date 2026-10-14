// ModuleContainer renders its settings form in three places (standard header,
// header hidden, embedded). Two of them never passed onOccurrenceStyleChange, so
// Style › "This Placement" could not leave Inherit there (a nested Kanban column
// was one). Every site now spreads ONE props object, so they cannot drift.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.join(__dirname, "../modules/ModuleContainer.jsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sites = [...src.matchAll(/<ContainerForm\b([\s\S]*?)\/>/g)].map((m) => m[1]);
describe("ModuleContainer settings forms", () => {
  it("renders the form in more than one place (control)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });
  it("every site spreads the shared props, which carry the placement style writer", () => {
    for (const s of sites) expect(s).toMatch(/\{\.\.\.containerFormProps\}/);
    expect(src).toMatch(/containerFormProps\s*=\s*\{[\s\S]*?onOccurrenceStyleChange/);
  });
});
