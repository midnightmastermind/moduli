// helpers/coverPick is tested on its own; this is the half that was MISSING —
// that anything calls it.
//
// The user's report was not "the picker is wrong", it was "i cant add a new
// image to it via the share or via the app ui": there was no way in. A helper
// with a green suite and no caller is exactly the shape this project has paid
// for before (`grid.meta.fieldVisibility`: implemented, documented,
// unit-tested, and settable from nowhere — 2026-09-22 (23)).
//
// A source guard, because the surfaces need the whole grid mounted to render.
// It cannot see a broken parse — the build is what says that.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// Comments name the helper while explaining it, so a comment-blind match would
// pass against a file that only talks about the picker.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("every surface that shows a row's picture can set it", () => {
  it("an instance card's menu opens the picker", () => {
    const src = code(read("modules/ModuleInstance.jsx"));
    expect(src).toMatch(/from\s+"\.\.\/helpers\/coverPick"/);
    expect(src).toMatch(/openCoverPicker\s*\(/);
    // Named for what is there now, so it does not read "Set" over a picture.
    expect(src).toMatch(/Change cover image/);
    expect(src).toMatch(/Set cover image/);
    // And a way back out, or a wrong pick is permanent.
    expect(src).toMatch(/setCover\s*\(/);
  });

  it("an artifact with nothing to draw offers the picker where the picture goes", () => {
    // This is the case the user hit: the Saints row rendered its own title as
    // the image, with no menu item in reach of it.
    const src = code(read("modules/ArtifactCard.jsx"));
    expect(src).toMatch(/from\s+"\.\.\/helpers\/coverPick"/);
    expect(src).toMatch(/openCoverPicker\s*\(/);
  });

  it("a page card uses the same picker, not a bare prompt", () => {
    const src = code(read("modules/PreviewNode.jsx"));
    expect(src).toMatch(/openCoverPicker\s*\(/);
    // Its cover used to be a bare URL prompt. Scoped to the COVER prompt: the
    // file still prompts to rename a page, and asserting "no window.prompt"
    // would fail on that and say nothing about covers.
    expect(src).not.toMatch(/prompt\([^)]*[Cc]over/);
  });

  it("the share window offers a cover and posts it", () => {
    const ui = code(read("ui/SharePlace.jsx"));
    expect(ui).toMatch(/cover-row/);
    expect(ui).toMatch(/stage\/\$\{enc\(stageId\)\}\/cover/);
    const helper = code(read("helpers/sharePlacement.js"));
    expect(helper).toMatch(/coverUrl/);
  });

  // The control. Without it "does not use window.prompt" and the absence of a
  // match are equally satisfied by a file that was deleted or renamed, and
  // every expectation above would still pass on an empty string.
  it("the guard is reading the real files", () => {
    for (const f of ["modules/ModuleInstance.jsx", "modules/ArtifactCard.jsx", "modules/PreviewNode.jsx", "ui/SharePlace.jsx", "helpers/sharePlacement.js"]) {
      expect(read(f).length).toBeGreaterThan(500);
    }
    // And that stripping comments leaves the code: a `code()` that returned ""
    // would make every `not.toMatch` above pass.
    expect(code(read("modules/PreviewNode.jsx"))).toMatch(/export default function/);
  });
});
