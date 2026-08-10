// Pins the INLINE context — 721 of poms grid's 1036 textblocks, 709 of them link
// chips. It is the LARGEST context and it uses NO TipTap at all: the body is a
// contentEditable span whose text is written imperatively via a ref.
//
// These assertions are the gate on the task that unifies the two chip
// implementations (TextblockCard's link branch renders a chip too). If any of them
// has to change to make that unification pass, the chips were not reconcilable and
// the honest outcome is to leave this path alone.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InstanceTextblockInlineNode from "../docs/pills/InstanceTextblockInlineNode.jsx";

// The component puts its className AND its hover handlers ON the NodeViewWrapper,
// so a mock that drops props silently disables both — the hover test then fails
// for a reason that has nothing to do with the component. Forward everything.
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, as, ...rest }) => (
    <span data-testid="nvw" {...rest}>{children}</span>
  ),
}));
vi.mock("../ui/RadialMenu.jsx", () => ({ default: () => <span data-testid="radial" /> }));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({ draggable: () => () => {} }));
vi.mock("../helpers/dragSystem", () => ({ disarmDraggableUntilHandle: () => () => {} }));
vi.mock("../helpers/caretDiag", () => ({ logCaretPointerDown: vi.fn() }));

const jumpToOccurrence = vi.fn();
vi.mock("../helpers/jumpToOccurrence", () => ({
  jumpToOccurrence: (...a) => jumpToOccurrence(...a),
}));

let ctx;
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ctx }));

const MOD = { id: "m1", role: "textblock", kind: "inline" };

const setCtx = (occ) => {
  ctx = {
    occurrencesById: { [occ.id]: occ },
    modulesById: { m1: MOD },
    dispatch: vi.fn(),
    socket: { connected: true },
  };
};

// `isEditable` is load-bearing: the radial is gated on `hovered && editable`,
// so a read-only editor never shows it however long you hover.
const nodeProps = (occ, { isEditable = true } = {}) => ({
  node: { attrs: { instanceId: "m1", occurrenceId: occ.id }, nodeSize: 1 },
  editor: {
    isEditable,
    view: { nodeDOM: () => null },
    state: { doc: { resolve: () => ({}) } },
  },
  getPos: () => 0,
  deleteNode: vi.fn(),
});

const textmap = (t) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});

beforeEach(() => {
  jumpToOccurrence.mockClear();
  window.open = vi.fn();
});

describe("InstanceTextblockInlineNode — inline context", () => {
  it("renders the stored text of a plain inline textblock", () => {
    const occ = { id: "o1", textmap: textmap("hello inline") };
    setCtx(occ);
    const { container } = render(<InstanceTextblockInlineNode {...nodeProps(occ)} />);
    expect(container.textContent).toContain("hello inline");
  });

  it("shows the enter-arrow ONLY for a link chip", () => {
    const plain = { id: "o2", textmap: textmap("no link") };
    setCtx(plain);
    const { container, unmount } = render(<InstanceTextblockInlineNode {...nodeProps(plain)} />);
    expect(container.querySelector(".itbi-arrow")).toBeNull();
    unmount();

    const linked = {
      id: "o3",
      meta: { link: { kind: "url", url: "https://example.com" } },
      textmap: textmap("Example"),
    };
    setCtx(linked);
    const { container: c2 } = render(<InstanceTextblockInlineNode {...nodeProps(linked)} />);
    const arrow = c2.querySelector(".itbi-arrow");
    expect(arrow).not.toBeNull();
    // A URL chip carries the href as its title and the ↗ glyph.
    expect(arrow).toHaveAttribute("title", "https://example.com");
    expect(arrow.textContent).toBe("↗");
  });

  it("jumps in-app for an occurrence link rather than opening a tab", () => {
    const linked = {
      id: "o4",
      meta: { link: { kind: "occurrence", occId: "target-7" } },
      textmap: textmap("Go there"),
    };
    setCtx(linked);
    const { container } = render(<InstanceTextblockInlineNode {...nodeProps(linked)} />);
    const arrow = container.querySelector(".itbi-arrow");
    // An in-app chip is the → glyph with a generic title, not a URL.
    expect(arrow).toHaveAttribute("title", "Open linked item");
    expect(arrow.textContent).toBe("→");
    arrow.click();
    expect(jumpToOccurrence).toHaveBeenCalledWith("target-7");
    expect(window.open).not.toHaveBeenCalled();
  });

  // The handle is ALWAYS in the DOM (Pragmatic DnD needs a stable ref) but the
  // RadialMenu inside it lazy-mounts on hover, deliberately: "a doc full of chips
  // pays nothing at rest." With 721 inline textblocks on poms grid that is a real
  // cost decision, so it is pinned rather than assumed.
  it("keeps the drag handle mounted at rest but lazy-mounts the radial on hover", () => {
    const occ = { id: "o5", textmap: textmap("x") };
    setCtx(occ);
    const { container } = render(<InstanceTextblockInlineNode {...nodeProps(occ)} />);

    const handle = container.querySelector(".itbi-handle");
    expect(handle).not.toBeNull();
    expect(handle.className).not.toContain("is-shown");
    expect(screen.queryByTestId("radial")).toBeNull();

    fireEvent.mouseEnter(container.querySelector(".instance-textblock-inline"));
    expect(container.querySelector(".itbi-handle").className).toContain("is-shown");
    expect(screen.getByTestId("radial")).toBeInTheDocument();

    fireEvent.mouseLeave(container.querySelector(".instance-textblock-inline"));
    expect(screen.queryByTestId("radial")).toBeNull();
  });

  it("never mounts the radial in a read-only editor, however long you hover", () => {
    const occ = { id: "o6", textmap: textmap("read only") };
    setCtx(occ);
    const { container } = render(
      <InstanceTextblockInlineNode {...nodeProps(occ, { isEditable: false })} />
    );
    fireEvent.mouseEnter(container.querySelector(".instance-textblock-inline"));
    expect(screen.queryByTestId("radial")).toBeNull();
  });
});
