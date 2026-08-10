// DocContent's opt-in `lazy` prop. The default MUST stay eager — every existing
// call site omits it, and a doc that silently stopped mounting its editor would
// be a behaviour change nobody asked for.
//
// The placeholder must contain REAL TEXT: WrapGroupNode measures rendered
// characters to decide wrap vs stack, and an empty placeholder reads to it as
// "blank host, nothing to wrap" — the exact defect it recorded once already
// (17 of 18 wrap groups measured 0 text with ~3000 real characters on screen).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import DocContent from "../modules/DocContent.jsx";
import { forceLiveNow, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";

vi.mock("../ui/Editor", () => ({
  default: React.forwardRef(() => <div data-testid="tiptap" />),
}));
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: vi.fn() }));
vi.mock("../helpers/caretDiag", () => ({ logCaretInterference: vi.fn() }));
vi.mock("../helpers/pendingTextblockFocus", () => ({
  requestTextblockFocus: vi.fn(),
  cancelTextblockFocus: vi.fn(),
}));
vi.mock("../helpers/provisionalTextblock", () => ({
  registerProvisionalTextblock: vi.fn(),
  discardProvisionalTextblock: vi.fn(),
  isProvisionalTextblock: () => false,
}));
vi.mock("../helpers/mintDiag", () => ({ mintMark: vi.fn(), mintStep: vi.fn() }));
vi.mock("../helpers/afterPaint", () => ({ afterPaint: (fn) => fn() }));

let observers;
beforeEach(() => {
  observers = [];
  class IO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(el) { this.el = el; }
    disconnect() { this.disconnected = true; }
    fire() { this.cb([{ isIntersecting: true }]); }
  }
  global.IntersectionObserver = IO;
});
afterEach(() => { delete global.IntersectionObserver; });

const doc = (...lines) => ({
  type: "doc",
  content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

const props = (over = {}) => ({ dispatch: vi.fn(), socket: {}, ...over });

describe("DocContent lazy prop", () => {
  it("defaults to eager, so every existing call site is unchanged", () => {
    render(<DocContent {...props({ occurrence: { id: "d1", textmap: doc("body text") } })} />);
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
    expect(observers.length).toBe(0);
  });

  it("renders a measurable placeholder carrying the real text when lazy", () => {
    const { container } = render(
      <DocContent lazy {...props({ occurrence: { id: "d2", textmap: doc("alpha", "beta") } })} />
    );
    expect(screen.queryByTestId("tiptap")).toBeNull();
    const ph = container.querySelector(`.${LAZY_PLACEHOLDER_CLASS}`);
    expect(ph).toBeInTheDocument();
    expect(ph.textContent).toContain("alpha");
    expect(ph.textContent).toContain("beta");
  });

  it("mounts the real editor on intersection", () => {
    render(<DocContent lazy {...props({ occurrence: { id: "d3", textmap: doc("x") } })} />);
    expect(screen.queryByTestId("tiptap")).toBeNull();
    act(() => observers[0].fire());
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
  });

  it("mounts the real editor when FORCED live — the caret hand-off path", () => {
    render(<DocContent lazy {...props({ occurrence: { id: "d4", textmap: doc("x") } })} />);
    expect(screen.queryByTestId("tiptap")).toBeNull();
    let forced;
    act(() => { forced = forceLiveNow("d4"); });
    expect(forced).toBe(true);
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
  });

  it("mounts an EMPTY doc eagerly even when lazy — nothing to stand in for it", () => {
    render(<DocContent lazy {...props({ occurrence: { id: "d5", textmap: null } })} />);
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
  });
});
