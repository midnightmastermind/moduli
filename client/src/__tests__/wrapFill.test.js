import { describe, it, expect } from "vitest";
import { resolveContainerChildLayout } from "../helpers/containerChildLayout";
import { fillColumns } from "../helpers/wrapFill";
import { SURFACE_SHAPE_KEYS } from "../helpers/layoutCascade";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("wrap fill (childFill)", () => {
  it("adds the fill class and drops the max width", () => {
    const l = resolveContainerChildLayout({ mode: "wrap", childMinWidth: 184, childMaxWidth: 184, childFill: true });
    expect(l.fill).toBe(true);
    expect(l.className).toContain("container-items--fill");
    expect(l.vars["--child-max-w"]).toBe("none");
    expect(l.vars["--child-w"]).toBe("184px");
  });
  it("leaves a wrap grid without fill as it was", () => {
    const l = resolveContainerChildLayout({ mode: "wrap", childMinWidth: 184, childMaxWidth: 184 });
    expect(l.fill).toBe(false);
    expect(l.className).toBe("container-items--wrap");
    expect(l.vars["--child-max-w"]).toBe("184px");
  });
  it("only applies to wrap mode", () => {
    expect(resolveContainerChildLayout({ mode: "flex-row", childFill: true }).fill).toBe(false);
  });
  it("counts the columns the way the virtual grid does", () => {
    // 4 tiles of 184 + 3 gaps of 8 = 760; a 900px row still holds 4, and they grow to fill it.
    expect(fillColumns(900, 184, 8)).toBe(4);
    expect(fillColumns(760, 184, 8)).toBe(4);
    expect(fillColumns(759, 184, 8)).toBe(3);
    expect(fillColumns(100, 184, 8)).toBe(1);
  });
  it("is a shape key, so it does not cascade to descendants", () => {
    expect(SURFACE_SHAPE_KEYS).toContain("childFill");
  });
  it("has a rule that sizes tiles from the measured columns", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(/\.container-items--wrap\.container-items--fill > \.instance-wrap\s*\{[^}]*var\(--wrap-cols/);
  });
});

// The last line stretches too (user 2026-10-29, Trackers: "have the row take up the entire space").
describe("childFillLast", () => {
  it("adds the fill-last class only with fill on a wrap", () => {
    expect(resolveContainerChildLayout({ mode: "wrap", childFill: true, childFillLast: true }).className).toContain("container-items--fill-last");
    expect(resolveContainerChildLayout({ mode: "wrap", childFill: true }).className).not.toContain("fill-last");
    expect(resolveContainerChildLayout({ mode: "wrap", childFillLast: true }).className).not.toContain("fill-last");
    expect(resolveContainerChildLayout({ mode: "stack", childFill: true, childFillLast: true }).className).not.toContain("fill-last");
  });
  it("the stylesheet grows the tiles of a fill-last list", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.container-items--fill-last > \.instance-wrap \{\s*flex-grow: 1;/);
  });
});
