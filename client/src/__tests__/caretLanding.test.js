/**
 * caretLanding.test.js
 *
 * The throw this prevents is not cosmetic: it aborts the backspace handler after
 * the node is gone from the document and before the occurrence is dropped, so a
 * provisional textblock leaks instead of vanishing.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, test, expect } from "vitest";
import { canHoldCaret, caretPosBeforeBlock, focusDocEnd } from "../helpers/caretLanding";

// Stand-ins shaped like a ProseMirror node — `inlineContent` is what the schema
// exposes, so this asks the same question the editor does.
const paragraph = { type: { name: "paragraph" }, inlineContent: true, nodeSize: 7 };
const wrapGroup = { type: { name: "wrapGroup" }, inlineContent: false, nodeSize: 4 };
const image = { type: { name: "moduleEmbed" }, inlineContent: false, nodeSize: 1 };

describe("canHoldCaret", () => {
  test("a block with inline content can", () => {
    expect(canHoldCaret(paragraph)).toBe(true);
  });

  test("a wrap group cannot — this is the node that threw", () => {
    expect(canHoldCaret(wrapGroup)).toBe(false);
    expect(canHoldCaret(image)).toBe(false);
  });

  test("no sibling at all cannot", () => {
    expect(canHoldCaret(null)).toBe(false);
    expect(canHoldCaret(undefined)).toBe(false);
  });
});

describe("caretPosBeforeBlock", () => {
  test("lands at the last position inside a paragraph", () => {
    expect(caretPosBeforeBlock(paragraph, 12)).toBe(11);
  });

  test("REFUSES rather than returning a position ProseMirror will throw on", () => {
    expect(caretPosBeforeBlock(wrapGroup, 12)).toBeNull();
    expect(caretPosBeforeBlock(null, 12)).toBeNull();
  });

  test("refuses at the start of the document", () => {
    expect(caretPosBeforeBlock(paragraph, 0)).toBeNull();
    expect(caretPosBeforeBlock(paragraph, undefined)).toBeNull();
  });
});

// ── CLICKING THE PADDING BELOW A DOC THAT ENDS IN AN ATOM ──────────────────
//
// A textblock is an ATOM, so a doc ending in one has no inline position at
// `doc.content.size` and `focus("end")` throws
//     TextSelection endpoint not pointing into a node with inline content (doc)
// — reported by the user on 2026-09-18 beside the [mint] tables. `Editor.jsx`
// guarded it; `DocContent.jsx`, the same click one file over, did not.
describe("focusDocEnd", () => {
  const editorWith = (endThrows, plainThrows = false) => {
    const calls = [];
    return {
      calls,
      isDestroyed: false,
      commands: {
        focus: (where) => {
          calls.push(where);
          if (where === "end" && endThrows) throw new RangeError(
            "TextSelection endpoint not pointing into a node with inline content (doc)");
          if (where === undefined && plainThrows) throw new Error("gone");
        },
      },
    };
  };

  test("an ordinary doc takes the end caret", () => {
    const ed = editorWith(false);
    expect(focusDocEnd(ed)).toBe("end");
    expect(ed.calls).toEqual(["end"]);
  });

  // THE ONE THAT MATTERS. Before this the throw escaped the click handler.
  test("a doc ending in an atom falls back instead of throwing", () => {
    const ed = editorWith(true);
    expect(() => focusDocEnd(ed)).not.toThrow();
    expect(focusDocEnd(ed)).toBe("fallback");
  });

  test("the fallback really focuses — the click is not swallowed", () => {
    const ed = editorWith(true);
    focusDocEnd(ed);
    expect(ed.calls).toEqual(["end", undefined]);
  });

  test("an editor that cannot focus at all reports it rather than throwing", () => {
    expect(focusDocEnd(editorWith(true, true))).toBe("failed");
  });

  test("a missing or destroyed editor is inert", () => {
    expect(focusDocEnd(null)).toBe("no-editor");
    expect(focusDocEnd({ isDestroyed: true, commands: { focus: () => { throw new Error("boom"); } } }))
      .toBe("no-editor");
  });

  // THE WIRING. Two padding-click handlers, one decision — and the drift is
  // exactly how this bug existed: one had the guard for months, the other never
  // got it. Neither component can be mounted without the whole grid store.
  describe("both padding clicks go through it", () => {
    const read = (f) => readFileSync(resolve(__dirname, f), "utf-8");

    test("DocContent's padding click", () => {
      const src = read("../modules/DocContent.jsx");
      expect(src).toContain("focusDocEnd(editor)");
      // The raw form is what threw.
      expect(src).not.toContain("editor.commands.focus('end')");
    });

    test("Editor's padding click", () => {
      const src = read("../ui/Editor.jsx");
      expect(src).toContain("focusDocEnd(editor)");
      expect(src).not.toContain("editor.commands.focus('end')");
    });
  });
});
