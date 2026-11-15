// A link chip's open buttons (↗ and 🌐) show at rest, not only on hover (user, 2026-11-15: "if its a link, we should
// have those link buttons always show"). The chip draws them only when it IS a link, so the CSS needs no gate.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const rule = (sel) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[2] || "";

describe("link chip buttons", () => {
  it("the ↗ / 🌐 buttons are displayed at rest", () => {
    const base = rule(".itbi-arrow");
    expect(base).not.toBe("");
    expect(base).not.toMatch(/display:\s*none/);
  });
  it("no hover rule is needed to reveal them", () => {
    expect(css).not.toMatch(/--zoned:hover \.itbi-arrow \{ display: inline; \}/);
  });
});
