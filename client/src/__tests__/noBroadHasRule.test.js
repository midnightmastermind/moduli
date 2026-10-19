import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A `:has()` rule makes the browser re-check it whenever something is added inside its subject.
// `.container-shell:has(.container-doc) > .container-header span` restyled every span in a
// container each time a row mounted — 126,800 restyles in one Books scroll (2026-10-19).
// A doc container carries `container-shell--doc` on its own shell instead.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const jsx = readFileSync(resolve(process.cwd(), "src/modules/ModuleContainer.jsx"), "utf8");

describe("doc container styling without :has()", () => {
  it("no rule asks a container shell whether it holds a doc body", () => {
    expect(css).not.toMatch(/container-shell:has\(\.container-doc\)/);
  });
  it("the doc header rule targets the shell's own class", () => {
    expect(css).toMatch(/\.container-shell--doc > \.container-header span/);
  });
  it("a doc container's shell carries that class", () => {
    expect(jsx).toMatch(/isDocContainer \? " container-shell--doc"/);
  });
});
