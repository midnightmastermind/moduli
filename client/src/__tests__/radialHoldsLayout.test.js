// While a radial menu is open, the card it belongs to keeps its trailing line
// revealed — the menu is portalled out of the card, so reaching an arc item
// ended the :hover and the collapse slid Delete out from under the pointer
// (user video, 2026-09-19: "i have to click the delete button again").
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const radial = readFileSync(resolve(__dirname, "../ui/RadialMenu.jsx"), "utf-8");
const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");

describe("an open radial menu holds its card's layout", () => {
  it("marks the nearest card and editor wrapper while open, and unmarks on close", () => {
    const body = radial.slice(radial.indexOf("if (!isOpen) return undefined;"), radial.indexOf("}, [isOpen]);"));
    expect(body).toContain('closest?.(".container-shell")');
    expect(body).toContain('closest?.(".doc-editor-wrapper")');
    expect(body).toContain('setAttribute("data-radial-hold", "")');
    expect(body).toContain('removeAttribute("data-radial-hold")');
  });
  it("the reveal rule honours the hold on both chains", () => {
    const rule = css.slice(css.indexOf(".container-shell[data-radial-hold]"), css.indexOf("height: auto;", css.indexOf(".container-shell[data-radial-hold]")));
    expect(rule).toContain("p:last-child:not(:first-child):has(> br.ProseMirror-trailingBreak:only-child)");
    expect(rule).toContain(".doc-editor-wrapper[data-radial-hold] > * > .doc-editor-content.ProseMirror");
  });
});
