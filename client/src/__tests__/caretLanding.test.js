/**
 * caretLanding.test.js
 *
 * The throw this prevents is not cosmetic: it aborts the backspace handler after
 * the node is gone from the document and before the occurrence is dropped, so a
 * provisional textblock leaks instead of vanishing.
 */
import { describe, test, expect } from "vitest";
import { canHoldCaret, caretPosBeforeBlock } from "../helpers/caretLanding";

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
