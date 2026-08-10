// Pins the BLOCK context — an `instanceTextblock` node inside a doc body.
// 246 of poms grid's 1036 textblocks render this way, and it is the ONLY context
// carrying BoundBody (the Daily Answer field binding) and the provisional
// lifecycle. It mounts ModuleInstance NOWHERE — its own header comment says it
// "Mirrors ModuleInstance", i.e. it re-implements the shell.
//
// Characterization tests: they pin today's behaviour so Tasks 6-10 can be proven
// not to change it.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InstanceTextblockNode from "../docs/pills/InstanceTextblockNode.jsx";
import { embedDeleteRegistry } from "../helpers/embedRegistry.js";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }) => <div data-testid="nvw">{children}</div>,
}));
vi.mock("../modules/DocContent.jsx", () => ({
  default: ({ occurrence }) => <div data-testid="doccontent" data-occ={occurrence?.id} />,
}));
vi.mock("../modules/BoundBody.jsx", () => ({
  default: ({ children, binding }) => (
    <div data-testid="boundbody" data-field={binding?.fieldId}>{children}</div>
  ),
}));
vi.mock("../ui/RadialMenu.jsx", () => ({
  default: (p) => <div data-testid="radial" data-dragmode={p.dragMode} />,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
}));
vi.mock("../helpers/dragSystem", () => ({ disarmDraggableUntilHandle: () => () => {} }));

let binding = null;
vi.mock("../state/editorBindings.js", () => ({
  resolveEditorBinding: () => binding,
}));

let provisional = null;
// Two knobs, because the component distinguishes "marked provisional" from
// "provisional AND an object is available to render from".
let provisionalHasObject = true;
vi.mock("../helpers/provisionalTextblock.js", () => ({
  isProvisionalTextblock: (id) => provisional === id,
  discardProvisionalTextblock: vi.fn(),
  suppressTextblockMint: vi.fn(),
  getProvisionalOccurrence: (id) =>
    provisional === id && provisionalHasObject ? { id, textmap: null } : null,
}));

let ctx;
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ctx }));

const OCC = { id: "occ-1", textmap: { type: "doc", content: [] } };
const MOD = { id: "mod-1", role: "textblock", kind: "doc", label: "A block" };

const makeNodeProps = (over = {}) => ({
  node: { attrs: { instanceId: "mod-1", occurrenceId: "occ-1" } },
  editor: { view: { nodeDOM: () => null }, state: { doc: { resolve: () => ({}) } } },
  getPos: () => 0,
  deleteNode: vi.fn(),
  ...over,
});

beforeEach(() => {
  binding = null;
  provisional = null;
  provisionalHasObject = true;
  ctx = {
    occurrencesById: { "occ-1": OCC },
    modulesById: { "mod-1": MOD },
    dispatch: vi.fn(),
    socket: { connected: true },
  };
});

describe("InstanceTextblockNode — block context", () => {
  it("renders DocContent for the occurrence, with no BoundBody by default", () => {
    render(<InstanceTextblockNode {...makeNodeProps()} />);
    expect(screen.getByTestId("doccontent")).toHaveAttribute("data-occ", "occ-1");
    expect(screen.queryByTestId("boundbody")).toBeNull();
  });

  it("wraps DocContent in BoundBody when a body binding resolves", () => {
    binding = { fieldId: "f-answer", slot: "body" };
    render(<InstanceTextblockNode {...makeNodeProps()} />);
    const bb = screen.getByTestId("boundbody");
    expect(bb).toHaveAttribute("data-field", "f-answer");
    expect(bb).toContainElement(screen.getByTestId("doccontent"));
  });

  it("registers deleteNode in embedDeleteRegistry and cleans up on unmount", () => {
    const deleteNode = vi.fn();
    const { unmount } = render(<InstanceTextblockNode {...makeNodeProps({ deleteNode })} />);
    expect(embedDeleteRegistry.get("occ-1")).toBe(deleteNode);
    unmount();
    expect(embedDeleteRegistry.get("occ-1")).toBeUndefined();
  });

  // The provisional path has TWO distinct states, which is easy to miss: the
  // occurrence is resolved as `store || provisionalRegistry || null`, so a
  // provisional block that HAS an object in the registry renders normally.
  it("renders a provisional block from the registry when the store has not caught up", () => {
    // This is the 2026-08-07 fix: the block is typeable in the frame it appears
    // rather than a second later, because it renders from the object the write
    // will carry rather than waiting for the store.
    ctx.occurrencesById = {};
    provisional = "occ-1";
    render(<InstanceTextblockNode {...makeNodeProps()} />);
    expect(screen.getByTestId("doccontent")).toHaveAttribute("data-occ", "occ-1");
  });

  it("renders a sized empty box — never the em-dash — while provisional with no object yet", () => {
    // A dash that appears and vanishes reads as a glitch; a box that grows reads
    // as the layout moving under the pointer. Hence an aria-hidden spacer.
    ctx.occurrencesById = {};
    provisional = "occ-1";
    provisionalHasObject = false;
    const { container } = render(<InstanceTextblockNode {...makeNodeProps()} />);
    expect(container.textContent).not.toContain("—");
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("falls back to the em-dash when the occurrence is genuinely missing", () => {
    ctx.occurrencesById = {};
    const { container } = render(<InstanceTextblockNode {...makeNodeProps()} />);
    expect(container.textContent).toContain("—");
  });

  it("passes the resolved drag mode to the radial menu", () => {
    ctx.occurrencesById = { "occ-1": { ...OCC, dragMode: "copy" } };
    render(<InstanceTextblockNode {...makeNodeProps()} />);
    expect(screen.getByTestId("radial")).toHaveAttribute("data-dragmode", "copy");
  });
});
