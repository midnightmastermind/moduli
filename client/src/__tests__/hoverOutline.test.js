import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A hovered occurrence gets a blue outline — the INNERMOST one only.
const css = readFileSync(join(__dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = css.match(/body:not\(\[data-drag-kind\]\) \.instance-wrap:hover[^{]+\{[^}]+\}/)?.[0] || "";

describe("hover outline on occurrences", () => {
  it("rows and containers both get a blue outline", () => {
    expect(rule).toMatch(/\.instance-wrap:hover.*?> \.instance-row/);
    expect(rule).toMatch(/\.container-shell:hover/);
    expect(rule).toMatch(/outline:\s*1px solid rgba\(59, 130, 246/);
  });
  it("an occurrence holding a hovered occurrence is not outlined (innermost only)", () => {
    expect((rule.match(/:not\(:has\(\.instance-wrap:hover, \.container-shell:hover\)\)/g) || []).length).toBe(2);
  });
  it("is an outline, never a border (no layout shift)", () => {
    expect(rule).not.toMatch(/\bborder\s*:/);
  });
  it("stays off during a drag", () => {
    // the selector list is split on ",\n" — the :has(…, …) inside each selector holds a comma too
    const selectors = rule.slice(0, rule.indexOf("{")).split(/,\s*\n/);
    expect(selectors).toHaveLength(2);
    expect(selectors.every((sel) => sel.trim().startsWith("body:not([data-drag-kind])"))).toBe(true);
  });
});
