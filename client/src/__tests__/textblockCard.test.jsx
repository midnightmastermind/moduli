// Pins the CARD context of a textblock (ModuleContainer / PageBoard / PageCanvas /
// ModuleEmbedNode → <ModuleInstance renderBody={TextblockCard}>). ~51 of poms grid's
// 1036 textblocks render this way — the SMALLEST of the three contexts, which is
// itself the finding: the other 95% never touch the instance shell.
//
// These are CHARACTERIZATION tests. They pin behaviour that exists today so the
// refactor that follows can be proven not to change it. Passing against unchanged
// code is correct; the A/B in the plan is what proves they discriminate.
//
// jsdom has NO IntersectionObserver, and TextblockCard falls back to eager mount
// when it is absent — so a lazy test without the stub below passes VACUOUSLY.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// `act` is required around the IntersectionObserver callback: it sets React state
// from outside React's own event plumbing, so without act() the re-render never
// flushes and the test reads the PRE-intersection DOM. (Observed: the placeholder
// assertions passed and only the post-fire one failed — the tell that the state
// write, not the component, was being missed.)
import { render, screen, fireEvent, act } from "@testing-library/react";
import TextblockCard from "../modules/TextblockCard.jsx";

const jumpToOccurrence = vi.fn();
vi.mock("../helpers/jumpToOccurrence", () => ({
  jumpToOccurrence: (...a) => jumpToOccurrence(...a),
}));

// The real Editor mounts TipTap; here it only has to prove it was reached.
vi.mock("../ui/Editor.jsx", () => ({
  default: ({ mode }) => <div data-testid="editor" data-mode={mode} />,
}));

vi.mock("../GridActionsContext", () => ({
  useGridActions: () => ({ dispatch: vi.fn(), socket: { connected: true } }),
}));

// Captures observers so a test can fire intersection deliberately.
let observed;
function installIO() {
  observed = [];
  class IO {
    constructor(cb) { this.cb = cb; observed.push(this); }
    observe(el) { this.el = el; }
    disconnect() { this.disconnected = true; }
    fire() { this.cb([{ isIntersecting: true }]); }
  }
  global.IntersectionObserver = IO;
}

const textmap = (...lines) => ({
  type: "doc",
  content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

beforeEach(() => { jumpToOccurrence.mockClear(); installIO(); });
afterEach(() => { delete global.IntersectionObserver; });

describe("TextblockCard — card context", () => {
  it("renders an external link as an anchor chip, not an editor", () => {
    render(
      <TextblockCard
        occurrence={{ id: "o1", meta: { link: { kind: "url", url: "https://example.com/a" } } }}
        module={{ id: "m1", label: "Example", role: "textblock" }}
      />
    );
    const a = screen.getByRole("link", { name: /Example/ });
    expect(a).toHaveAttribute("href", "https://example.com/a");
    expect(a).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("renders an in-app link as a button that jumps to the target", () => {
    render(
      <TextblockCard
        occurrence={{ id: "o2", meta: { link: { kind: "occurrence", occId: "target-9" } } }}
        module={{ id: "m2", label: "Go there", role: "textblock" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Go there/ }));
    expect(jumpToOccurrence).toHaveBeenCalledWith("target-9");
  });

  it("shows a plain-text placeholder before intersection, and the editor after", () => {
    render(
      <TextblockCard
        occurrence={{ id: "o3", textmap: textmap("first line", "second line") }}
        module={{ id: "m3", role: "textblock", kind: "doc" }}
      />
    );
    // Before intersection: real text on screen, NO editor. The text matters —
    // WrapGroupNode measures rendered characters to decide wrap vs stack.
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second line")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();

    act(() => observed[0].fire());
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("goes live on pointerdown without waiting for intersection", () => {
    const { container } = render(
      <TextblockCard
        occurrence={{ id: "o4", textmap: textmap("click me") }}
        module={{ id: "m4", role: "textblock", kind: "doc" }}
      />
    );
    expect(screen.queryByTestId("editor")).toBeNull();
    fireEvent.pointerDown(container.querySelector(".textblock-card"));
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("mounts an inline textblock eagerly and in inline mode", () => {
    render(
      <TextblockCard
        occurrence={{ id: "o5", textmap: textmap("inline text") }}
        module={{ id: "m5", role: "textblock", kind: "inline" }}
      />
    );
    expect(screen.getByTestId("editor")).toHaveAttribute("data-mode", "inline");
  });

  it("adds the multi-column class and cap var when listCapRows is set", () => {
    const { container } = render(
      <TextblockCard
        occurrence={{ id: "o6", textmap: textmap("a"), meta: { listCapRows: 20 } }}
        module={{ id: "m6", role: "textblock", kind: "doc" }}
      />
    );
    const card = container.querySelector(".textblock-card");
    expect(card.className).toContain("textblock-card--cols");
    expect(card.style.getPropertyValue("--list-cap-rows")).toBe("20");
  });
});
