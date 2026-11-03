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

// The same class, 2026-11-02: the Jellyfin player's "maximized hides the rest" rule was a `:has()` whose subject was
// any tile, so every row a virtual list inserted invalidated the whole body (People board on a phone: ~370ms of
// style recalc per scroll step over ~10,400 elements). The player is the body's first child; a sibling rule does it.
describe("the maximized player hides the other tiles without :has()", () => {
  it("no :has() rule asks the viewer body about the player", () => {
    expect(css).not.toMatch(/artifact-spread-body--playing:has\(/);
  });
  it("the sibling rule hides what follows a maximized player", () => {
    expect(css).toMatch(/\.artifact-spread-body--playing > \.spread-player-tile--max ~ :not\(\.spread-player-tile\) \{ display: none !important; \}/);
  });
});

// And a `:has()` rule whose SUBJECT is a bare tag (`> div:first-child`) re-checks every element of that tag under any
// change: the wrap-float handle rule restyled every div on the People board per scroll step.
// Known and bounded: a ProseMirror <br> cannot carry a class, and this re-check is confined to one paragraph's child.
const ALLOWED = new Set([".doc-editor-content.ProseMirror p:has(.doc-instance-block) > br"]);

describe("no :has() rule ends on a bare tag name", () => {
  it("no selector puts a :has() on an ancestor and ends on a bare tag", () => {
    const offenders = [];
    for (const rule of css.split("}")) {
      const sel = rule.split("{")[0];
      for (const part of sel.split(",")) {
        const p = part.trim();
        if (!p.includes(":has(")) continue;
        // Only `ANCESTOR:has(...) <combinator> tag`: a :has() on the subject itself (`p:has(...)`) is a different shape.
        const marked = p.replace(/:has\((?:[^()]|\([^()]*\))*\)/g, "§").trim();
        const last = marked.split(/\s*[>+~ ]\s*/).pop();
        if (last.includes("§") || !marked.includes("§")) continue;
        if (/^[a-z]+(?::[a-z-]+(?:\([^)]*\))?)*$/i.test(last) && !ALLOWED.has(p)) offenders.push(p);
      }
    }
    expect(offenders).toEqual([]);
  });
});

