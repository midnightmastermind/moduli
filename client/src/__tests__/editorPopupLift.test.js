// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liftPopupHosts, POPUP_LIFT_CLASS } from "../helpers/editorPopupLift";

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
    for (const id of ["row", "inner", "outer", "c"]) expect($(id).classList.contains(POPUP_LIFT_CLASS)).toBe(true);
    expect($("next").classList.contains(POPUP_LIFT_CLASS)).toBe(false);
    undo();
    expect(document.querySelectorAll(`.${POPUP_LIFT_CLASS}`).length).toBe(0);
  });

  it("does not remove a lift another popup put there", () => {
    const $ = tree();
    $("c").classList.add(POPUP_LIFT_CLASS);
    liftPopupHosts($("ed"))();
    expect($("c").classList.contains(POPUP_LIFT_CLASS)).toBe(true);
  });

  it("is wired: Editor lifts while a popup is open, and the class raises the stacking", () => {
    const ed = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(ed).toMatch(/liftPopupHosts\(wrapperRef\.current\)/);
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/\.instance-wrap\.has-editor-popup[\s\S]{0,80}z-index:\s*\d{2}/);
  });
});
