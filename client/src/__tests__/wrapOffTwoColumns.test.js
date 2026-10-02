// "Side by side" is TWO columns — floats on one side, the text side stacked on
// the other — however many blocks the group holds (2026-10-02). It used to be a
// flex row with a column per member, which squeezed every lead.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(",").map((s) => s.trim()), body: m[2] }));
const bodyOf = (sel) => rules.filter((r) => r.sels.includes(sel)).map((r) => r.body).join(";");
const M = ".wrap-group-content > * >";

describe("wrap group, columns mode", () => {
  it("is not a flex row of every member", () => {
    const body = bodyOf(".wrap-group--off > .wrap-group-content > *");
    expect(body).toMatch(/display:\s*flow-root/);
    expect(body).not.toMatch(/display:\s*flex/);
  });
  it("floats stack in one column on the group's side", () => {
    expect(bodyOf(`.wrap-group--off.wrap-group--left > ${M} [data-wrap-role="float"]`)).toMatch(/float:\s*left;\s*clear:\s*left/);
    expect(bodyOf(`.wrap-group--off.wrap-group--right > ${M} [data-wrap-role="float"]`)).toMatch(/float:\s*right;\s*clear:\s*right/);
  });
  it("leads AND the host share the other column", () => {
    for (const role of ["lead", "host"]) {
      expect(bodyOf(`.wrap-group--off.wrap-group--left > ${M} [data-wrap-role="${role}"]`)).toMatch(/margin-left:\s*calc\(var\(--wrap-nw/);
      expect(bodyOf(`.wrap-group--off.wrap-group--right > ${M} [data-wrap-role="${role}"]`)).toMatch(/margin-right:\s*calc\(var\(--wrap-nw/);
    }
  });
  it("the node view still stamps the roles and the off class these rules read (the control)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../docs/WrapGroupNode.jsx"), "utf8");
    expect(src).toMatch(/"wrap-group--off"/);
    expect(src).toMatch(/dataset\.wrapRole/);
  });
});
