// Backspace on an EMPTY textblock deletes the line too.
//
// User, 2026-08-12: "we need a way to delete empty lines in docs cause currently
// it cant do it if a textblock is being created each time. if i press backwards
// on an empty textblock, it should delete the line it was on as well."
//
// The old behaviour left an empty paragraph behind as "an intermediate empty-line
// step before the next backspace" — and that step was unreachable: the caret
// lands on the vacated line, the caret-entry mint fires on exactly that, and a
// fresh block appears. Backspace again and you are collapsing a NEW block,
// forever, so the line could never be removed.
//
// These drive the real `onDeleteBlock` the sub-editor calls. The existing
// node-view suite mocks DocContent away, so this path had NO coverage at all —
// proven by A/B: breaking the join branch outright left 26 tests green.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import InstanceTextblockNode from "../docs/pills/InstanceTextblockNode.jsx";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }) => <div>{children}</div>,
}));

// Capture the callback the sub-editor would invoke on Backspace.
let onDeleteBlock = null;
vi.mock("../modules/DocContent.jsx", () => ({
  default: (p) => { onDeleteBlock = p.onDeleteBlock; return <div data-testid="doc" />; },
}));
vi.mock("../modules/BoundBody.jsx", () => ({ default: ({ children }) => <>{children}</> }));
vi.mock("../ui/RadialMenu.jsx", () => ({ default: () => <div /> }));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({ draggable: () => () => {} }));
vi.mock("../helpers/dragSystem", () => ({ disarmDraggableUntilHandle: () => () => {} }));
vi.mock("../state/editorBindings.js", () => ({ resolveEditorBinding: () => null }));

const discard = vi.fn();
const suppress = vi.fn();
vi.mock("../helpers/provisionalTextblock.js", () => ({
  isProvisionalTextblock: () => false,
  discardProvisionalTextblock: (...a) => discard(...a),
  suppressTextblockMint: (...a) => suppress(...a),
  getProvisionalOccurrence: () => null,
}));

const removeOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  default: { removeOccurrence: (...a) => removeOccurrence(...a) },
  removeOccurrence: (...a) => removeOccurrence(...a),
}));

let ctx;
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => ctx,
  useGridActionsSelector: (sel) => sel(ctx),
  useGridActionsSelectorShallow: (sel) => sel(ctx),
}));

const OCC = { id: "occ-1", moduleId: "mod-1", textmap: null };
const MOD = { id: "mod-1", label: "Block", role: "textblock" };

// A chain recorder — every editor command lands here in call order.
function makeEditor(prevSibling) {
  const calls = [];
  const chain = {
    focus: () => (calls.push(["focus"]), chain),
    deleteRange: (r) => (calls.push(["deleteRange", r]), chain),
    insertContentAt: (p, c) => (calls.push(["insertContentAt", p, c]), chain),
    setTextSelection: (p) => (calls.push(["setTextSelection", p]), chain),
    run: () => calls.push(["run"]),
  };
  return {
    calls,
    chain: () => chain,
    view: { nodeDOM: () => null },
    state: { doc: { resolve: () => ({ nodeBefore: prevSibling }) },
      schema: { nodes: { paragraph: { create: () => ({}) } } } },
  };
}

const props = (editor) => ({
  node: { attrs: { instanceId: "mod-1", occurrenceId: "occ-1" }, nodeSize: 3 },
  editor,
  getPos: () => 10,
  deleteNode: vi.fn(),
});

beforeEach(() => {
  onDeleteBlock = null;
  discard.mockClear(); suppress.mockClear(); removeOccurrence.mockClear();
  ctx = { occurrencesById: { "occ-1": OCC }, modulesById: { "mod-1": MOD },
    dispatch: vi.fn(), socket: { connected: true } };
});

const namesOf = (calls) => calls.map((c) => c[0]);

describe("backspace on an empty textblock", () => {
  it("deletes the block and does NOT leave an empty paragraph behind", () => {
    // The whole bug: the leftover paragraph is the line that could never be
    // deleted, because the mint re-created a block on it.
    const ed = makeEditor({ type: { name: "paragraph" } });
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    expect(namesOf(ed.calls)).toContain("deleteRange");
    expect(namesOf(ed.calls)).not.toContain("insertContentAt");
  });

  it("joins the caret to the END of the previous block", () => {
    const ed = makeEditor({ type: { name: "paragraph" } });
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    const sel = ed.calls.find((c) => c[0] === "setTextSelection");
    // getPos() is 10, so pos-1 is the last position inside the previous block.
    expect(sel?.[1]).toBe(9);
  });

  it("KEEPS the empty paragraph when there is nothing above to join into", () => {
    // Deleting the only block leaves ProseMirror with no valid cursor position,
    // so this one case must still leave a line.
    const ed = makeEditor(null);
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    expect(namesOf(ed.calls)).toContain("insertContentAt");
  });

  it("suppresses the mint at the vacated position, or the block comes straight back", () => {
    const ed = makeEditor({ type: { name: "paragraph" } });
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    expect(suppress).toHaveBeenCalledWith(10);
  });

  it("does NOT use setTextSelection when the previous sibling is a textblock", () => {
    // Its content lives in a sub-editor; a selection in the OUTER doc cannot
    // reach inside an atom node view, so that path focuses the inner editor.
    const ed = makeEditor({ type: { name: "instanceTextblock" }, nodeSize: 3 });
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    expect(namesOf(ed.calls)).toContain("deleteRange");
    expect(namesOf(ed.calls)).not.toContain("setTextSelection");
  });

  it("still drops the occurrence so no orphan row is left behind", () => {
    const ed = makeEditor({ type: { name: "paragraph" } });
    render(<InstanceTextblockNode {...props(ed)} />);
    onDeleteBlock(true);
    expect(removeOccurrence).toHaveBeenCalled();
  });
});
