// The caret hand-off between adjacent textblocks focuses the SIBLING's inner
// .ProseMirror directly, behind an `if (innerPM)` guard. When the neighbour is not
// mounted the guard swallows it and the caret silently goes somewhere else — no
// error, nothing in the console.
//
// That matters because the next task makes the block body LAZY, which is exactly
// the condition that produces a neighbour with no .ProseMirror. These tests are
// the only thing that will catch it.
//
// The editor mock mirrors what the real handlers actually walk (read from
// InstanceTextblockNode: forward uses doc.content.size + doc.forEach; backward uses
// doc.resolve(pos).nodeBefore). An earlier draft mocked `doc.resolve` for both and
// would have exercised neither path — a test that passes because the handler bailed
// early proves nothing.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import InstanceTextblockNode from "../docs/pills/InstanceTextblockNode.jsx";
import * as lazyEditor from "../helpers/lazyEditor.js";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }) => <div>{children}</div>,
}));
vi.mock("../modules/DocContent.jsx", () => ({
  default: ({ onExitBlock, onDeleteBlock }) => (
    <div>
      <button data-testid="exit" onClick={() => onExitBlock?.()} />
      <button data-testid="back" onClick={() => onDeleteBlock?.()} />
    </div>
  ),
}));
vi.mock("../modules/BoundBody.jsx", () => ({ default: ({ children }) => <>{children}</> }));
vi.mock("../ui/RadialMenu.jsx", () => ({ default: () => <div /> }));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({ draggable: () => () => {} }));
vi.mock("../helpers/dragSystem", () => ({ disarmDraggableUntilHandle: () => () => {} }));
vi.mock("../state/editorBindings.js", () => ({ resolveEditorBinding: () => null }));
vi.mock("../helpers/provisionalTextblock.js", () => ({
  isProvisionalTextblock: () => false,
  discardProvisionalTextblock: vi.fn(),
  suppressTextblockMint: vi.fn(),
  getProvisionalOccurrence: () => null,
}));

let ctx;
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ctx }));

// A neighbour node view as the DOM actually looks: wrapper > .ProseMirror.
function neighbourWithEditor() {
  const wrap = document.createElement("div");
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  pm.tabIndex = -1;
  wrap.appendChild(pm);
  document.body.appendChild(wrap);
  return { wrap, pm };
}

// A LAZY neighbour: a placeholder and no .ProseMirror at all.
function neighbourWithPlaceholder() {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-occurrence-id", "neighbour-1");
  const ph = document.createElement("div");
  ph.className = "textblock-card-placeholder";
  wrap.appendChild(ph);
  document.body.appendChild(wrap);
  return { wrap, ph };
}

const chainStub = () => {
  const c = {};
  c.command = () => c;
  c.setTextSelection = () => c;
  c.focus = () => c;
  c.deleteRange = () => c;
  c.insertContentAt = () => c;
  c.run = () => true;
  return c;
};

// Forward: this node sits at pos 0 with nodeSize 1; the doc holds two top-level
// children, so afterPos (1) lands exactly on the second child's offset.
function forwardEditor(nodeDOM) {
  const children = [
    { nodeSize: 1, type: { name: "instanceTextblock" } },
    { nodeSize: 1, type: { name: "instanceTextblock" } },
  ];
  return {
    state: {
      doc: {
        content: { size: 2 },
        forEach: (fn) => children.forEach(fn),
        resolve: () => ({ nodeBefore: null }),
      },
    },
    view: { nodeDOM },
    chain: chainStub,
  };
}

// Backward: this node sits at pos 5; nodeBefore is another textblock of size 5,
// so prevFrom resolves to 0.
function backwardEditor(nodeDOM) {
  return {
    state: {
      doc: {
        content: { size: 10 },
        forEach: () => {},
        resolve: () => ({ nodeBefore: { nodeSize: 5, type: { name: "instanceTextblock" } } }),
      },
    },
    view: { nodeDOM },
    chain: chainStub,
  };
}

const renderNode = (editor, getPos) =>
  render(
    <InstanceTextblockNode
      node={{ attrs: { instanceId: "mod-1", occurrenceId: "occ-1" }, nodeSize: 1 }}
      editor={editor}
      getPos={getPos}
      deleteNode={vi.fn()}
    />
  );

beforeEach(() => {
  document.body.innerHTML = "";
  // Hand-registered goLive closures have no unmount cleanup, so without this a
  // closure from the previous test fires against detached DOM.
  lazyEditor.__resetForTest();
  ctx = {
    occurrencesById: { "occ-1": { id: "occ-1", textmap: { type: "doc", content: [] } } },
    modulesById: { "mod-1": { id: "mod-1", role: "textblock", kind: "doc" } },
    dispatch: vi.fn(),
    socket: { connected: true },
  };
});

describe("textblock caret navigation across blocks", () => {
  it("focuses the NEXT sibling textblock's inner editor when exiting forward", () => {
    const { pm, wrap } = neighbourWithEditor();
    const { getByTestId } = renderNode(forwardEditor(() => wrap), () => 0);
    getByTestId("exit").click();
    expect(document.activeElement).toBe(pm);
  });

  it("focuses the PREVIOUS sibling textblock's inner editor when navigating back", () => {
    const { pm, wrap } = neighbourWithEditor();
    const { getByTestId } = renderNode(backwardEditor(() => wrap), () => 5);
    getByTestId("back").click();
    expect(document.activeElement).toBe(pm);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. A lazily-unmounted neighbour renders a
  // placeholder and no .ProseMirror, so the `if (innerPM)` guard would swallow the
  // focus and the caret would silently stop moving between blocks. The node must
  // force the neighbour live first, then focus what it paints.
  it("forces a lazy neighbour live and focuses it, instead of swallowing the caret", () => {
    const { wrap, ph } = neighbourWithPlaceholder();
    const forced = vi.fn(() => {
      const pm = document.createElement("div");
      pm.className = "ProseMirror";
      pm.tabIndex = -1;
      wrap.replaceChild(pm, ph);
    });
    lazyEditor.__registerForTest("neighbour-1", forced);

    const { getByTestId } = renderNode(forwardEditor(() => wrap), () => 0);
    getByTestId("exit").click();

    expect(forced).toHaveBeenCalled();
    expect(document.activeElement).toBe(wrap.querySelector(".ProseMirror"));
  });

  it("does the same going BACKWARD into a lazy previous sibling", () => {
    const { wrap, ph } = neighbourWithPlaceholder();
    const forced = vi.fn(() => {
      const pm = document.createElement("div");
      pm.className = "ProseMirror";
      pm.tabIndex = -1;
      wrap.replaceChild(pm, ph);
    });
    lazyEditor.__registerForTest("neighbour-1", forced);

    const { getByTestId } = renderNode(backwardEditor(() => wrap), () => 5);
    getByTestId("back").click();

    expect(forced).toHaveBeenCalled();
    expect(document.activeElement).toBe(wrap.querySelector(".ProseMirror"));
  });

  it("falls through harmlessly when the neighbour is not registered at all", () => {
    // Not every missing .ProseMirror is a lazy block — the node may simply not be
    // mounted. forceLiveNow returns false and the caller must not throw.
    const { wrap } = neighbourWithPlaceholder();
    const { getByTestId } = renderNode(forwardEditor(() => wrap), () => 0);
    expect(() => getByTestId("exit").click()).not.toThrow();
    expect(wrap.querySelector(".ProseMirror")).toBeNull();
  });
});
