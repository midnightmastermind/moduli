// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liftPopupHosts, POPUP_LIFT_ATTR } from "../helpers/editorPopupLift";

function tree() {
  document.body.innerHTML = `
    <div class="container-shell" id="c"><div class="instance-wrap" id="outer">
      <div class="container-shell" id="inner"><div class="instance-wrap" id="row"><div id="ed"></div></div>
      <div class="instance-wrap" id="next"></div></div></div></div>`;
  return (id) => document.getElementById(id);
}

describe("liftPopupHosts", () => {
  it("lifts every row and container above the editor, and nothing beside it", () => {
    const $ = tree();
    const undo = liftPopupHosts($("ed"));
    for (const id of ["row", "inner", "outer", "c"]) expect($(id).hasAttribute(POPUP_LIFT_ATTR)).toBe(true);
    expect($("next").hasAttribute(POPUP_LIFT_ATTR)).toBe(false);
    undo();
    expect(document.querySelectorAll(`[${POPUP_LIFT_ATTR}]`).length).toBe(0);
  });

  it("does not remove a lift another popup put there", () => {
    const $ = tree();
    $("c").setAttribute(POPUP_LIFT_ATTR, "");
    liftPopupHosts($("ed"))();
    expect($("c").hasAttribute(POPUP_LIFT_ATTR)).toBe(true);
  });

  it("is wired: Editor lifts while a popup is open, and the class raises the stacking", () => {
    const ed = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(ed).toMatch(/liftPopupHosts\(wrapperRef\.current\)/);
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/\.instance-wrap\[data-editor-popup\][\s\S]{0,200}z-index:\s*\d{2}/);
  });
});
