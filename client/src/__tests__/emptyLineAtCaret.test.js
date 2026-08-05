import { describe, test, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { emptyLineAtCaret } from "../ui/Editor.jsx";

// The predicate behind click-to-mint: the caret sits on an EMPTY top-level line.
// Driven against a REAL ProseMirror state (no DOM needed) so the depth /
// nodeSize arithmetic is exercised rather than restated.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    blockquote: { group: "block", content: "block+", toDOM: () => ["blockquote", 0] },
    instanceTextblock: { group: "block", atom: true, toDOM: () => ["div"] },
    text: { group: "inline" },
  },
});

const stateFrom = (nodes, caretAt) => {
  const doc = schema.node("doc", null, nodes);
  const state = EditorState.create({ schema, doc });
  if (caretAt == null) return state;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, caretAt)));
};
const p = (text) => schema.node("paragraph", null, text ? [schema.text(text)] : []);

describe("emptyLineAtCaret", () => {
  test("an empty top-level line returns its position and size", () => {
    // [ para("written") ][ para("") ] — caret inside the second, which starts
    // at 9 (para 1 is 2 + 7 chars) and is 2 wide (open + close token).
    const state = stateFrom([p("written"), p()], 10);
    expect(emptyLineAtCaret(state)).toEqual({ start: 9, size: 2 });
  });

  test("the FIRST line of an empty doc qualifies", () => {
    expect(emptyLineAtCaret(stateFrom([p()], 1))).toEqual({ start: 0, size: 2 });
  });

  test("a line with text does not", () => {
    expect(emptyLineAtCaret(stateFrom([p("hi")], 2))).toBeNull();
  });

  test("an empty line NESTED inside another block does not", () => {
    // A blockquote/list/table cell is not the doc body — minting there would
    // put a textblock inside a structure the user is editing.
    const state = stateFrom([schema.node("blockquote", null, [p()])], 2);
    expect(emptyLineAtCaret(state)).toBeNull();
  });

  test("a RANGE selection does not (the user is selecting, not placing a caret)", () => {
    const base = stateFrom([p("hello")], null);
    const ranged = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 1, 4)));
    expect(emptyLineAtCaret(ranged)).toBeNull();
  });

  test("a selected atom block does not", () => {
    const state = stateFrom([schema.node("instanceTextblock"), p()], null);
    // NodeSelection-ish position: right before the atom, depth 0.
    expect(emptyLineAtCaret(state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(0)))))).toBeNull();
  });

  test("the empty line AFTER a textblock qualifies — that is the common case", () => {
    // [ instanceTextblock (size 1) ][ para("") ] → the trailing line you click
    // into to keep writing.
    const state = stateFrom([schema.node("instanceTextblock"), p()], 2);
    expect(emptyLineAtCaret(state)).toEqual({ start: 1, size: 2 });
  });
});
