/**
 * docCaretHidden.test.js
 *
 * User, 2026-09-18: *"id like the input cursor to not show up on an empty line
 * (before the textblock is created) … this should be for outside textblocks,
 * not inside of them."* Then, on the first attempt: *"the input cursor should
 * still be INSIDE the textblock, i specified that. currently thats gone as
 * well."*
 *
 * THE FIRST VERSION RESTORED THE CARET UNDER `.textblock-card` — AND THE IN-DOC
 * BLOCK NEVER CARRIES THAT CLASS. `ModuleTextblock` routes `context === "card"`
 * (the BOARD ROW) through `TextblockCard`, which is the only thing that renders
 * it; `context === "block"` returns `DocContent` bare. So the override matched
 * nothing, the broad rule reached the nested editor as a descendant, and the
 * caret went out inside textblocks too.
 *
 * The lesson is the reason these guards exist: it was "verified" against a DOM
 * fixture written from assumption rather than from the components. So the rule
 * no longer keys on a wrapper class at all — `DocContent` stamps
 * `doc-editor--mints` from the SAME `!onExitBlock` it derives the mint props
 * from, and the invariant under test is that those three cannot drift apart.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf-8");
// A grep cannot tell a comment from the code it explains, and the comment above
// these rules NAMES `.textblock-card` and `caret-color` while explaining why
// neither belongs in the rule. Strip comments the way a parser does, or the
// guard fails on its own documentation (which is what it did first).
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the mint flag is derived, not asserted", () => {
  const src = read("../modules/DocContent.jsx");

  it("is computed from the condition the mint itself uses", () => {
    expect(src).toContain("const mintsOnEmptyLine = !onExitBlock;");
  });

  // The whole point: one const feeds the class AND both mint props, so a class
  // that says "this line mints" cannot be wrong about whether it mints.
  it("feeds the class and BOTH mint props from that one const", () => {
    expect(src).toContain("doc-editor--mints");
    expect(src).toMatch(/onCaretMintTextblock=\{mintsOnEmptyLine \?/);
    expect(src).toMatch(/onAutoCreateTextblock=\{mintsOnEmptyLine \?/);
  });

  // The shape that drifted. A prop re-deriving `onExitBlock` on its own is how
  // the class and the behaviour come apart again.
  it("no mint prop re-derives the condition behind the class's back", () => {
    expect(src).not.toMatch(/onCaretMintTextblock=\{onExitBlock/);
    expect(src).not.toMatch(/onAutoCreateTextblock=\{onExitBlock/);
  });
});

describe("the caret rules key on that flag", () => {
  const css = stripComments(read("../index.css"));

  it("hides the caret only where the line will mint", () => {
    expect(css).toMatch(
      /\.doc-editor--mints \.doc-editor-content\.ProseMirror p:has\(> br\.ProseMirror-trailingBreak:only-child\)\s*\{\s*caret-color: transparent/
    );
  });

  // A textblock body sits INSIDE the page editor, so the rule above reaches it
  // as a descendant — this is what puts the caret back, and its absence is
  // exactly what the user reported.
  it("puts it back inside a doc editor that does NOT mint", () => {
    expect(css).toMatch(
      /\.doc-container:not\(\.doc-editor--mints\) \.doc-editor-content\.ProseMirror p:has\(> br\.ProseMirror-trailingBreak:only-child\)\s*\{\s*caret-color: auto/
    );
  });

  // THE REGRESSION, named. `.textblock-card` is the board-row rendering; keying
  // the restore on it is what blanked the caret inside every in-doc textblock.
  it("does not key the restore on a wrapper the in-doc block never has", () => {
    const rules = css.match(/[^{}]*\{[^}]*caret-color[^}]*\}/g) || [];
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => r.includes(".textblock-card"))).toBe(false);
  });

  // THE CONTROL. Without it, "no bare rule" is also satisfied by a stylesheet
  // where the whole feature was deleted.
  it("the feature is still there at all", () => {
    expect(css.match(/caret-color:/g) || []).toHaveLength(2);
  });
});
