# Textblock as its own occurrence type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `role: "textblock"` its own renderer (`ModuleTextblock`) as a peer of
`ModuleInstance` / `ModuleContainer` / `ModulePage`, and make the 246 eager ProseMirror instances on
the doc-block path lazy — **without changing anything the user sees**.

**Architecture:** A textblock renders in exactly three measured contexts — `card` (~51 on poms),
`block` (246), `inline` (721). They have **disjoint feature sets**, so `ModuleTextblock` takes a
context and each context keeps its features explicitly rather than inheriting a union. The refactor
is staged so behaviour is identical by construction at every point: characterization tests first,
then the shared lazy seam, then routing, then delegation. There is **no data change** — module↔
occurrence is 1:1 and no textblock occurrence carries children, `viewId`, `ownStyle` or
`linkedGroupId`.

**Tech Stack:** React 18, vitest 4 + @testing-library/react + jsdom, TipTap 3 (ProseMirror),
Pragmatic drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-08-10-textblock-occurrence-type-design.md`

## Global Constraints

- **"It should work exactly the same way it does now, just as its own type"** — the user's own words.
  Any visible behaviour change is a defect, not an improvement. If a unification cannot preserve
  behaviour, leave the path alone and say so.
- **No data migration.** Nothing in this plan writes to a grid, a module, or an occurrence shape.
- **`ModuleInstance` does not get smaller.** `ArtifactCard` still rides `renderBody`; textblock
  leaving is not a deletion.
- **A/B every test:** each new test must FAIL against a mutation of the thing it pins, and pass
  otherwise. A test that passes before the change exists is not a test.
- **Read the failure COUNT, not "roughly the same."** Verified baseline as of 2026-08-10:
  `client 160 files / 2372 passed / 0 failed / 0 skipped`, `server 49 files / 666 passed / 0 failed`.
- **jsdom has no `IntersectionObserver`.** `TextblockCard`'s own guard
  (`typeof IntersectionObserver === "undefined" → setLive(true)`) means any lazy test WITHOUT a stub
  passes vacuously. Every lazy test in this plan installs the stub in `beforeEach`.
- Test command from the repo root: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- <pattern>`
- Full suite: `TMPDIR=$HOME/tmp npm --prefix ./client run test`

---

## File Structure

**Created:**

| path | responsibility |
|---|---|
| `client/src/__tests__/textblockCard.test.jsx` | pins the `card` context: link chips, lazy mount, `listCapRows`, inline class |
| `client/src/__tests__/instanceTextblockNode.test.jsx` | pins the `block` context: DocContent/BoundBody, delete registry, provisional render |
| `client/src/__tests__/textblockCaretNav.test.jsx` | pins cross-block caret navigation — the silent failure Stage 1 would cause |
| `client/src/__tests__/instanceTextblockInlineNode.test.jsx` | pins the `inline` context: chip text, right-arrow, radial |
| `client/src/helpers/lazyEditor.js` | the shared lazy-mount decision + a `forceLive` registry so a neighbour can be made live synchronously |
| `client/src/__tests__/lazyEditor.test.js` | unit-pins the seam |
| `client/src/modules/ModuleTextblock.jsx` | the peer renderer; dispatches by context |
| `client/src/__tests__/moduleTextblock.test.jsx` | pins routing + that each context keeps its own feature set |

**Modified:**

| path | change |
|---|---|
| `client/src/modules/TextblockCard.jsx` | consume `lazyEditor` instead of its own IntersectionObserver |
| `client/src/modules/DocContent.jsx` | accept `lazy` + render a measurable placeholder |
| `client/src/docs/pills/InstanceTextblockNode.jsx` | lazy body; force neighbour live before focusing it |
| `client/src/docs/WrapGroupNode.jsx` | placeholder fallback must cover the block path's class too |
| `client/src/modules/ModuleContainer.jsx:752,1623` | route textblock → `ModuleTextblock` |
| `client/src/modules/pages/PageBoard.jsx:208` | route textblock → `ModuleTextblock` |
| `client/src/modules/pages/PageCanvas.jsx:72` | route textblock → `ModuleTextblock` |
| `client/src/docs/ModuleEmbedNode.jsx:272` | route textblock → `ModuleTextblock` |

---

# PHASE A — Characterization tests (Stage 0)

**Nothing in Phase B–D may start until Phase A is green.** The three renderer components have zero
direct coverage today; the only existing inline test pins the TipTap *extension config*, never the
node view. Without Phase A, "works exactly the same" is unverifiable.

---

### Task 1: Pin the `card` context — `TextblockCard`

**Files:**
- Test: `client/src/__tests__/textblockCard.test.jsx` (create)
- Reads: `client/src/modules/TextblockCard.jsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `installIO()` IntersectionObserver stub pattern reused by Tasks 5 and 7.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/textblockCard.test.jsx`:

```jsx
// Pins the CARD context of a textblock (ModuleContainer / PageBoard / PageCanvas /
// ModuleEmbedNode → <ModuleInstance renderBody={TextblockCard}>). ~51 of poms grid's
// 1036 textblocks render this way.
//
// jsdom has NO IntersectionObserver, and TextblockCard falls back to eager mount when
// it is absent — so a lazy test without the stub below passes VACUOUSLY.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

// Captures observed elements so a test can fire intersection deliberately.
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
    // Before intersection: real text on screen, NO editor.
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second line")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();

    observed[0].fire();
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
```

- [ ] **Step 2: Run it and confirm it passes against today's code**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCard`
Expected: `Tests  6 passed (6)`

This is a *characterization* test — it pins existing behaviour, so passing now is correct. Step 3 is
what proves it discriminates.

- [ ] **Step 3: A/B — prove each assertion actually discriminates**

Temporarily mutate `client/src/modules/TextblockCard.jsx` and confirm the named test fails, reverting
after each:

| mutation | must fail |
|---|---|
| `const eager = isInline \|\| !hasContent;` → `const eager = true;` | placeholder test |
| delete the `onPointerDown={() => setLive(true)}` prop | pointerdown test |
| `mode={isInline ? "inline" : "doc"}` → `mode="doc"` | inline-mode test |
| in the link branch, `target="_blank"` → `target="_self"` | external-link test |

Run after each mutation: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCard`
Expected: exactly the named test fails; **revert the mutation before moving on.**

- [ ] **Step 4: Commit**

```bash
git add client/src/__tests__/textblockCard.test.jsx
git commit -m "test(textblock): pin the card context before the type split"
```

---

### Task 2: Pin the `block` context — `InstanceTextblockNode`

**Files:**
- Test: `client/src/__tests__/instanceTextblockNode.test.jsx` (create)
- Reads: `client/src/docs/pills/InstanceTextblockNode.jsx`

**Interfaces:**
- Consumes: nothing from Task 1 (independent file).
- Produces: `makeNodeProps()` — the TipTap node-view prop factory reused by Task 3.

- [ ] **Step 1: Write the test**

Create `client/src/__tests__/instanceTextblockNode.test.jsx`:

```jsx
// Pins the BLOCK context — an `instanceTextblock` node inside a doc body.
// 246 of poms grid's 1036 textblocks render this way, and it is the ONLY context
// carrying BoundBody (the Daily Answer field binding) and the provisional lifecycle.
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
vi.mock("../helpers/provisionalTextblock.js", () => ({
  isProvisionalTextblock: (id) => provisional === id,
  discardProvisionalTextblock: vi.fn(),
  suppressTextblockMint: vi.fn(),
  getProvisionalOccurrence: (id) => (provisional === id ? { id, textmap: null } : null),
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

  it("renders a provisional block as a sized empty box, never the em-dash", () => {
    ctx.occurrencesById = {};
    provisional = "occ-1";
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
```

- [ ] **Step 2: Run it**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- instanceTextblockNode`
Expected: `Tests  6 passed (6)`

If a mock path is wrong the failure will be an import error, not an assertion failure — fix the mock
path, do not weaken the assertion.

- [ ] **Step 3: A/B**

| mutation in `InstanceTextblockNode.jsx` | must fail |
|---|---|
| render `<DocContent/>` unconditionally (drop the `bodyBinding ?` branch) | BoundBody test |
| delete the `embedDeleteRegistry.set(...)` line | registry test |
| swap the provisional branch to render the `—` span | provisional test |
| hardcode `dragMode="move"` on RadialMenu | drag-mode test |

Revert each after confirming.

- [ ] **Step 4: Commit**

```bash
git add client/src/__tests__/instanceTextblockNode.test.jsx
git commit -m "test(textblock): pin the block context incl. BoundBody + provisional render"
```

---

### Task 3: Pin cross-block caret navigation — the silent failure Stage 1 would cause

**Files:**
- Test: `client/src/__tests__/textblockCaretNav.test.jsx` (create)
- Reads: `client/src/docs/pills/InstanceTextblockNode.jsx:148-160, 262-275`

**Why this task exists:** `InstanceTextblockNode` moves the caret between adjacent textblocks by
focusing the **sibling's inner `.ProseMirror`**, behind `if (innerPM)`. A lazily-unmounted neighbour
has no `.ProseMirror`, so the guard swallows it and **the caret silently stops moving between
blocks**. Nothing logs. This test is the only thing that will catch it in Task 7.

**Interfaces:**
- Consumes: `makeNodeProps()` shape from Task 2 (repeated below — do not import across test files).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `client/src/__tests__/textblockCaretNav.test.jsx`:

```jsx
// The caret hand-off between adjacent textblocks focuses the SIBLING's inner
// .ProseMirror directly. It is guarded by `if (innerPM)`, so when the neighbour is
// not mounted the failure is SILENT — the caret just stops moving. Task 7 makes the
// block body lazy, which is exactly the condition that produces a missing .ProseMirror.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import InstanceTextblockNode from "../docs/pills/InstanceTextblockNode.jsx";

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
function neighbourDom() {
  const wrap = document.createElement("div");
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  pm.tabIndex = -1;
  wrap.appendChild(pm);
  document.body.appendChild(wrap);
  return { wrap, pm };
}

beforeEach(() => {
  document.body.innerHTML = "";
  ctx = {
    occurrencesById: { "occ-1": { id: "occ-1", textmap: { type: "doc", content: [] } } },
    modulesById: { "mod-1": { id: "mod-1", role: "textblock", kind: "doc" } },
    dispatch: vi.fn(),
    socket: { connected: true },
  };
});

describe("textblock caret navigation across blocks", () => {
  it("focuses the NEXT sibling textblock's inner editor when exiting forward", () => {
    const { pm } = neighbourDom();
    const editor = {
      view: { nodeDOM: () => pm.parentElement },
      state: {
        doc: {
          resolve: () => ({
            // minimal shape the handler walks; the next child is another textblock
            parent: { childCount: 2 },
          }),
        },
      },
    };
    const { getByTestId } = render(
      <InstanceTextblockNode
        node={{ attrs: { instanceId: "mod-1", occurrenceId: "occ-1" } }}
        editor={editor}
        getPos={() => 0}
        deleteNode={vi.fn()}
      />
    );
    getByTestId("exit").click();
    expect(document.activeElement).toBe(pm);
  });

  it("focuses the PREVIOUS sibling textblock's inner editor when navigating back", () => {
    const { pm } = neighbourDom();
    const editor = {
      view: { nodeDOM: () => pm.parentElement },
      state: { doc: { resolve: () => ({ parent: { childCount: 2 } }) } },
    };
    const { getByTestId } = render(
      <InstanceTextblockNode
        node={{ attrs: { instanceId: "mod-1", occurrenceId: "occ-1" } }}
        editor={editor}
        getPos={() => 5}
        deleteNode={vi.fn()}
      />
    );
    getByTestId("back").click();
    expect(document.activeElement).toBe(pm);
  });

  it("REGRESSION GUARD: a neighbour with no .ProseMirror must not silently swallow the caret", () => {
    // A lazily-unmounted neighbour renders a placeholder and no .ProseMirror.
    const wrap = document.createElement("div");
    const ph = document.createElement("div");
    ph.className = "textblock-card-placeholder";
    wrap.appendChild(ph);
    document.body.appendChild(wrap);

    const editor = {
      view: { nodeDOM: () => wrap },
      state: { doc: { resolve: () => ({ parent: { childCount: 2 } }) } },
    };
    const { getByTestId } = render(
      <InstanceTextblockNode
        node={{ attrs: { instanceId: "mod-1", occurrenceId: "occ-1" } }}
        editor={editor}
        getPos={() => 0}
        deleteNode={vi.fn()}
      />
    );
    getByTestId("exit").click();
    // After Task 7 the neighbour must be forced live and focused. Until then this
    // documents the hazard: focus stays on <body>, i.e. the caret went nowhere.
    expect(document.activeElement).toBe(document.body);
  });
});
```

- [ ] **Step 2: Run it**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCaretNav`
Expected: `Tests  3 passed (3)`

**If the first two tests do not pass, the mocked `editor`/`getPos` shape does not match what the real
handlers walk.** Read `handleExitBlock` and `handleNavigateBack` in
`client/src/docs/pills/InstanceTextblockNode.jsx` and widen the mock until the real code path runs —
do **not** relax the assertion. A test that passes because the handler bailed early proves nothing
(this repo has shipped that mistake before).

- [ ] **Step 3: Commit**

```bash
git add client/src/__tests__/textblockCaretNav.test.jsx
git commit -m "test(textblock): pin cross-block caret hand-off + guard the lazy-neighbour hazard"
```

---

### Task 4: Pin the `inline` context — `InstanceTextblockInlineNode`

**Files:**
- Test: `client/src/__tests__/instanceTextblockInlineNode.test.jsx` (create)
- Reads: `client/src/docs/pills/InstanceTextblockInlineNode.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the chip assertions Task 11 must keep green when the two chip implementations unify.

- [ ] **Step 1: Write the test**

Create `client/src/__tests__/instanceTextblockInlineNode.test.jsx`:

```jsx
// Pins the INLINE context — 721 of poms grid's 1036 textblocks, 709 of them link chips.
// This renderer uses NO TipTap: it writes contentRef.current.textContent directly.
// These assertions are the gate on Task 11, where the two chip implementations unify.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InstanceTextblockInlineNode from "../docs/pills/InstanceTextblockInlineNode.jsx";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }) => <span data-testid="nvw">{children}</span>,
}));
vi.mock("../ui/RadialMenu.jsx", () => ({ default: () => <span data-testid="radial" /> }));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({ draggable: () => () => {} }));
vi.mock("../helpers/caretDiag", () => ({ logCaretPointerDown: vi.fn() }));

const jumpToOccurrence = vi.fn();
vi.mock("../helpers/jumpToOccurrence", () => ({
  jumpToOccurrence: (...a) => jumpToOccurrence(...a),
}));

let ctx;
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ctx }));

const props = (occ, mod = { id: "m1", role: "textblock", kind: "inline" }) => ({
  node: { attrs: { instanceId: mod.id, occurrenceId: occ.id } },
  editor: { view: { nodeDOM: () => null } },
  getPos: () => 0,
  deleteNode: vi.fn(),
});

beforeEach(() => {
  jumpToOccurrence.mockClear();
  window.open = vi.fn();
});

describe("InstanceTextblockInlineNode — inline context", () => {
  it("renders the stored text of a plain inline textblock", () => {
    const occ = {
      id: "o1",
      textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello inline" }] }] },
    };
    ctx = { occurrencesById: { o1: occ }, modulesById: { m1: { id: "m1", kind: "inline" } }, dispatch: vi.fn(), socket: {} };
    const { container } = render(<InstanceTextblockInlineNode {...props(occ)} />);
    expect(container.textContent).toContain("hello inline");
  });

  it("shows the enter-arrow only for a link chip", () => {
    const plain = { id: "o2", textmap: { type: "doc", content: [] } };
    ctx = { occurrencesById: { o2: plain }, modulesById: { m1: { id: "m1", kind: "inline" } }, dispatch: vi.fn(), socket: {} };
    const { rerender, queryByTitle } = render(<InstanceTextblockInlineNode {...props(plain)} />);
    expect(queryByTitle(/open/i)).toBeNull();

    const linked = { id: "o3", meta: { link: { kind: "url", url: "https://example.com" } }, textmap: { type: "doc", content: [] } };
    ctx = { occurrencesById: { o3: linked }, modulesById: { m1: { id: "m1", kind: "inline" } }, dispatch: vi.fn(), socket: {} };
    rerender(<InstanceTextblockInlineNode {...props(linked)} />);
    expect(queryByTitle(/open/i)).not.toBeNull();
  });

  it("jumps in-app for an occurrence link rather than opening a tab", () => {
    const linked = { id: "o4", meta: { link: { kind: "occurrence", occId: "target-7" } }, textmap: { type: "doc", content: [] } };
    ctx = { occurrencesById: { o4: linked }, modulesById: { m1: { id: "m1", kind: "inline" } }, dispatch: vi.fn(), socket: {} };
    const { getByTitle } = render(<InstanceTextblockInlineNode {...props(linked)} />);
    fireEvent.click(getByTitle(/open/i));
    expect(jumpToOccurrence).toHaveBeenCalledWith("target-7");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("always renders its own radial menu handle", () => {
    const occ = { id: "o5", textmap: { type: "doc", content: [] } };
    ctx = { occurrencesById: { o5: occ }, modulesById: { m1: { id: "m1", kind: "inline" } }, dispatch: vi.fn(), socket: {} };
    render(<InstanceTextblockInlineNode {...props(occ)} />);
    expect(screen.getByTestId("radial")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- instanceTextblockInlineNode`
Expected: `Tests  4 passed (4)`

The `getByTitle(/open/i)` selector must match the real arrow's `title`. Open
`client/src/docs/pills/InstanceTextblockInlineNode.jsx` around line 288 and use the actual string.

- [ ] **Step 3: A/B**

| mutation | must fail |
|---|---|
| render the arrow unconditionally (drop the `hasLink &&` gate) | arrow-only-for-chips test |
| make the occurrence-link branch call `window.open` | in-app-jump test |

- [ ] **Step 4: Run the full suite and confirm the baseline moved only by the new tests**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: `Test Files 164 passed (164)`, `Tests 2391 passed (2391)`, 0 failed, 0 skipped
(2372 + 6 + 6 + 3 + 4 = 2391).

- [ ] **Step 5: Commit**

```bash
git add client/src/__tests__/instanceTextblockInlineNode.test.jsx
git commit -m "test(textblock): pin the inline chip context"
```

---

# PHASE B — The lazy-editor seam (Stage 1)

This phase is **independently valuable and independently shippable** — it is the measured
performance win and does not depend on the type split.

---

### Task 5: Extract the lazy-editor seam

**Files:**
- Create: `client/src/helpers/lazyEditor.js`
- Create: `client/src/__tests__/lazyEditor.test.js`
- Modify: `client/src/modules/TextblockCard.jsx` (replace its inline IntersectionObserver)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `useLazyEditor({ eager, occurrenceId }) → { live, ref, goLive }` — `live: boolean`,
    `ref: React.RefObject`, `goLive: () => void`
  - `forceLiveNow(occurrenceId) → boolean` — makes a registered, not-yet-live editor live
    **synchronously**; returns `false` if that id is not registered.
  - `LAZY_PLACEHOLDER_CLASS = "textblock-card-placeholder"` — the class every measurer keys on.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/lazyEditor.test.js`:

```js
// The lazy seam. `forceLiveNow` is the load-bearing part: cross-block caret
// navigation focuses a NEIGHBOUR's inner .ProseMirror, so the neighbour has to be
// made live synchronously before the focus call, or the caret silently goes nowhere.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useLazyEditor, forceLiveNow, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";

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

function Probe({ eager = false, occurrenceId = "occ-1" }) {
  const { live, ref, goLive } = useLazyEditor({ eager, occurrenceId });
  return (
    <div ref={ref} data-testid="host" onPointerDown={goLive}>
      {live ? <span data-testid="live" /> : <span className={LAZY_PLACEHOLDER_CLASS} />}
    </div>
  );
}

describe("useLazyEditor", () => {
  it("starts not-live and goes live on intersection", () => {
    render(<Probe />);
    expect(screen.queryByTestId("live")).toBeNull();
    act(() => observers[0].fire());
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("starts live when eager", () => {
    render(<Probe eager />);
    expect(screen.getByTestId("live")).toBeInTheDocument();
    expect(observers.length).toBe(0);
  });

  it("goes live eagerly when IntersectionObserver is unavailable", () => {
    delete global.IntersectionObserver;
    render(<Probe />);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("stays live once live — a later disconnect never unmounts it", () => {
    render(<Probe />);
    act(() => observers[0].fire());
    expect(observers[0].disconnected).toBe(true);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("forceLiveNow makes a registered editor live synchronously", () => {
    render(<Probe occurrenceId="occ-9" />);
    expect(screen.queryByTestId("live")).toBeNull();
    let result;
    act(() => { result = forceLiveNow("occ-9"); });
    expect(result).toBe(true);
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("forceLiveNow returns false for an id nobody registered", () => {
    expect(forceLiveNow("nope")).toBe(false);
  });

  it("unregisters on unmount so a stale id cannot be forced", () => {
    const { unmount } = render(<Probe occurrenceId="occ-8" />);
    unmount();
    expect(forceLiveNow("occ-8")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- lazyEditor`
Expected: FAIL — `Failed to resolve import "../helpers/lazyEditor.js"`

- [ ] **Step 3: Write the implementation**

Create `client/src/helpers/lazyEditor.js`:

```js
// helpers/lazyEditor.js
// ============================================================================
// One decision, one place: "is this textblock's real editor mounted yet?"
//
// A live TipTap/ProseMirror instance per textblock is the app's dominant render
// cost. TextblockCard has carried this optimisation alone since 2026-08; the doc
// BLOCK path (246 of poms grid's 1036 textblocks) mounted eagerly. Extracting it
// here is what lets both share ONE implementation instead of a second copy.
//
// `forceLiveNow` exists for one specific reason, and it is not convenience:
// InstanceTextblockNode moves the caret between adjacent textblocks by focusing
// the SIBLING's inner `.ProseMirror`, behind an `if (innerPM)` guard. A neighbour
// that is still a placeholder has no `.ProseMirror`, so the guard swallows the
// focus and the caret silently stops moving. The neighbour must be made live
// SYNCHRONOUSLY before it is focused.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";

// The class a placeholder paints. Anything that MEASURES rendered text has to
// know it: WrapGroupNode reads `.ProseMirror || .textblock-card-placeholder`,
// because a host below the fold has thousands of characters and no ProseMirror
// at all (measured: 17 of 18 wrap groups reported 0 text with ~3000 real chars).
export const LAZY_PLACEHOLDER_CLASS = "textblock-card-placeholder";

// occurrenceId -> goLive(). Registered while a lazy editor is mounted and NOT
// yet live; removed the moment it goes live or unmounts, so the map only ever
// holds editors that can still be forced.
const pending = new Map();

/** Make a registered, not-yet-live editor live synchronously. */
export function forceLiveNow(occurrenceId) {
  const goLive = occurrenceId ? pending.get(occurrenceId) : null;
  if (!goLive) return false;
  goLive();
  return true;
}

/**
 * @param {object}  opts
 * @param {boolean} opts.eager         mount the real editor immediately
 * @param {string}  opts.occurrenceId  key for forceLiveNow
 * @param {number}  opts.rootMargin    px ahead of the viewport to go live
 */
export function useLazyEditor({ eager = false, occurrenceId = null, rootMargin = 700 } = {}) {
  const [live, setLive] = useState(eager);
  const ref = useRef(null);
  const goLive = useCallback(() => setLive(true), []);

  // Register while forceable. Keyed on `live` so the entry is dropped as soon as
  // it goes live — forcing an already-live editor is a no-op we should not claim.
  useEffect(() => {
    if (!occurrenceId || live) return undefined;
    pending.set(occurrenceId, goLive);
    return () => { pending.delete(occurrenceId); };
  }, [occurrenceId, live, goLive]);

  useEffect(() => {
    if (live) return undefined;
    const el = ref.current;
    // No element or no IntersectionObserver (jsdom, old engines) -> mount eagerly
    // rather than render a placeholder that can never be replaced.
    if (!el || typeof IntersectionObserver === "undefined") { setLive(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: `${rootMargin}px` });
    io.observe(el);
    return () => io.disconnect();
  }, [live, rootMargin]);

  return { live, ref, goLive };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- lazyEditor`
Expected: `Tests  7 passed (7)`

- [ ] **Step 5: Make `TextblockCard` consume the seam**

In `client/src/modules/TextblockCard.jsx`, replace the local lazy block. Delete:

```jsx
  const cardRef = useRef(null);
  const [live, setLive] = useState(eager);
  useEffect(() => {
    if (live) return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setLive(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: "700px" });
    io.observe(el);
    return () => io.disconnect();
  }, [live]);
```

and put in its place:

```jsx
  const { live, ref: cardRef, goLive } = useLazyEditor({ eager, occurrenceId: occurrence?.id });
```

Add the import at the top:

```jsx
import { useLazyEditor, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";
```

Change the placeholder branch's handler and class to use the seam:

```jsx
        onPointerDown={goLive}
```
```jsx
        <div className={LAZY_PLACEHOLDER_CLASS} style={{ cursor: "text" }}>
```

Remove `useState` / `useEffect` from the React import line **only if** nothing else in the file still
uses them — check first with `grep -n "useState\|useEffect" client/src/modules/TextblockCard.jsx`.

- [ ] **Step 6: Verify the card context is byte-for-byte unchanged in behaviour**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCard`
Expected: `Tests  6 passed (6)` — Task 1's characterization tests still pass unmodified. **If any of
them needed editing to pass, the refactor changed behaviour; revert and redo it.**

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/lazyEditor.js client/src/__tests__/lazyEditor.test.js client/src/modules/TextblockCard.jsx
git commit -m "refactor(textblock): extract the lazy-editor seam; TextblockCard consumes it"
```

---

### Task 6: Teach `DocContent` to render lazily

**Files:**
- Modify: `client/src/modules/DocContent.jsx`
- Test: `client/src/__tests__/lazyEditor.test.js` (extend)

**Interfaces:**
- Consumes: `useLazyEditor`, `LAZY_PLACEHOLDER_CLASS` from Task 5.
- Produces: `DocContent` accepts a new prop `lazy = false`. When `lazy` is true and the editor is not
  yet live it renders `<div class="textblock-card-placeholder">` containing one `<div>` per top-level
  block of plain text. Default `false` keeps every existing call site byte-identical.

- [ ] **Step 1: Write the failing test**

Append to `client/src/__tests__/lazyEditor.test.js`:

```js
import DocContent from "../modules/DocContent.jsx";

const doc = (...lines) => ({
  type: "doc",
  content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

vi.mock("../ui/Editor", () => ({ default: () => <div data-testid="tiptap" /> }));

describe("DocContent lazy prop", () => {
  it("defaults to eager so existing call sites are unchanged", () => {
    render(<DocContent occurrence={{ id: "d1", textmap: doc("body text") }} dispatch={vi.fn()} socket={{}} />);
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
  });

  it("renders a measurable placeholder with the real text when lazy", () => {
    const { container } = render(
      <DocContent lazy occurrence={{ id: "d2", textmap: doc("alpha", "beta") }} dispatch={vi.fn()} socket={{}} />
    );
    expect(screen.queryByTestId("tiptap")).toBeNull();
    const ph = container.querySelector(`.${LAZY_PLACEHOLDER_CLASS}`);
    expect(ph).toBeInTheDocument();
    // The text must really be on screen — WrapGroupNode measures it.
    expect(ph.textContent).toContain("alpha");
    expect(ph.textContent).toContain("beta");
  });

  it("mounts the real editor once forced live", () => {
    render(<DocContent lazy occurrence={{ id: "d3", textmap: doc("x") }} dispatch={vi.fn()} socket={{}} />);
    expect(screen.queryByTestId("tiptap")).toBeNull();
    act(() => { forceLiveNow("d3"); });
    expect(screen.getByTestId("tiptap")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- lazyEditor`
Expected: FAIL — the `lazy` prop is ignored, so the placeholder test finds `tiptap`.

- [ ] **Step 3: Implement**

In `client/src/modules/DocContent.jsx`, add the import:

```jsx
import { useLazyEditor, LAZY_PLACEHOLDER_CLASS } from "../helpers/lazyEditor.js";
```

Add a plain-text extractor above the component (mirrors `TextblockCard.textmapBlocks` — one string
per top-level block, so the placeholder is roughly height-matched):

```jsx
// One plain-text string per top-level block. Roughly height-matched, and — just
// as important — REAL TEXT ON SCREEN, because WrapGroupNode measures the rendered
// characters to decide wrap vs stack.
function textmapBlocks(textmap) {
  if (!textmap || typeof textmap !== "object") return [];
  const content = Array.isArray(textmap.content) ? textmap.content : [];
  return content.map((node) => {
    const parts = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(node);
    return parts.join("");
  });
}
```

Add `lazy = false` to the destructured props, and immediately after the existing hooks:

```jsx
  const hasContent = !!(occurrence?.textmap && typeof occurrence.textmap === "object");
  const { live, ref: lazyRef, goLive } = useLazyEditor({
    eager: !lazy || !hasContent,
    occurrenceId: occurrence?.id,
  });
  const lazyBlocks = React.useMemo(
    () => (live || !hasContent ? [] : textmapBlocks(occurrence.textmap)),
    [live, hasContent, occurrence?.textmap]
  );
```

Then, immediately before the component's existing `return`, add the placeholder early-return:

```jsx
  if (!live) {
    return (
      <div ref={lazyRef} onPointerDown={goLive} className={LAZY_PLACEHOLDER_CLASS} style={{ cursor: "text" }}>
        {lazyBlocks.map((b, i) => (
          <div key={i} style={{ minHeight: "1.35em" }}>{b || " "}</div>
        ))}
      </div>
    );
  }
```

- [ ] **Step 4: Run and verify it passes**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- lazyEditor`
Expected: `Tests  10 passed (10)`

- [ ] **Step 5: Confirm no existing call site changed**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: `Tests 2401 passed`, 0 failed, 0 skipped. Every `DocContent` caller omits `lazy`, so all
of them stay eager.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/DocContent.jsx client/src/__tests__/lazyEditor.test.js
git commit -m "feat(textblock): DocContent can render a measurable lazy placeholder (opt-in)"
```

---

### Task 7: Make the block path lazy — and keep the caret working

**Files:**
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx`
- Modify: `client/src/docs/WrapGroupNode.jsx:193, 256`
- Test: `client/src/__tests__/textblockCaretNav.test.jsx` (update the regression guard)

**Interfaces:**
- Consumes: `DocContent`'s `lazy` prop (Task 6), `forceLiveNow` (Task 5).
- Produces: nothing new.

**This is the highest-risk task in the plan.** It is the one that delivers the performance win and
the one that can silently break the caret.

- [ ] **Step 1: Turn the regression guard into a real requirement**

In `client/src/__tests__/textblockCaretNav.test.jsx`, replace the third test's final assertion and
its comment. The neighbour is now expected to be forced live and focused rather than swallowed:

```jsx
  it("forces a lazy neighbour live and focuses it, instead of swallowing the caret", () => {
    // A lazily-unmounted neighbour renders a placeholder and no .ProseMirror.
    // Before this task the `if (innerPM)` guard swallowed the focus silently.
    const wrap = document.createElement("div");
    wrap.setAttribute("data-occurrence-id", "neighbour-1");
    const ph = document.createElement("div");
    ph.className = "textblock-card-placeholder";
    wrap.appendChild(ph);
    document.body.appendChild(wrap);

    // Registering a goLive for the neighbour mimics a mounted-but-lazy sibling;
    // when it is forced, it paints its .ProseMirror.
    const forced = vi.fn(() => {
      const pm = document.createElement("div");
      pm.className = "ProseMirror";
      pm.tabIndex = -1;
      wrap.replaceChild(pm, ph);
    });
    lazyEditor.__registerForTest?.("neighbour-1", forced);

    const editor = {
      view: { nodeDOM: () => wrap },
      state: { doc: { resolve: () => ({ parent: { childCount: 2 } }) } },
    };
    const { getByTestId } = render(
      <InstanceTextblockNode
        node={{ attrs: { instanceId: "mod-1", occurrenceId: "occ-1" } }}
        editor={editor}
        getPos={() => 0}
        deleteNode={vi.fn()}
      />
    );
    getByTestId("exit").click();
    expect(forced).toHaveBeenCalled();
    expect(document.activeElement).toBe(wrap.querySelector(".ProseMirror"));
  });
```

Add at the top of that file:

```jsx
import * as lazyEditor from "../helpers/lazyEditor.js";
```

And in `client/src/helpers/lazyEditor.js`, export the test hook next to `forceLiveNow`:

```js
// Test-only: register a goLive without mounting a component. Not used in app code.
export function __registerForTest(occurrenceId, goLive) { pending.set(occurrenceId, goLive); }
```

- [ ] **Step 2: Run and verify it fails**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCaretNav`
Expected: FAIL — `expect(forced).toHaveBeenCalled()` fails; the node never asks the neighbour to go
live.

- [ ] **Step 3: Implement — force the neighbour live before focusing it**

In `client/src/docs/pills/InstanceTextblockNode.jsx`, add the import:

```jsx
import { forceLiveNow } from "../../helpers/lazyEditor.js";
```

Add this helper above the component:

```jsx
// The neighbour's inner editor may not be mounted (lazy). Force it live, then
// re-query — otherwise `innerPM` is null, the `if` guard below swallows the
// focus, and the caret silently stops moving between blocks.
function innerProseMirror(domNode) {
  if (!domNode) return null;
  let pm = domNode.querySelector?.(".ProseMirror");
  if (pm) return pm;
  const occId = domNode.getAttribute?.("data-occurrence-id")
    || domNode.querySelector?.("[data-occurrence-id]")?.getAttribute("data-occurrence-id");
  if (occId && forceLiveNow(occId)) pm = domNode.querySelector?.(".ProseMirror");
  return pm || null;
}
```

Replace **both** lookups:

At `:154`
```jsx
      const innerPM = editor.view.nodeDOM(nextChildStart)?.querySelector?.(".ProseMirror");
```
becomes
```jsx
      const innerPM = innerProseMirror(editor.view.nodeDOM(nextChildStart));
```

At `:268`
```jsx
      const innerPM = domNode?.querySelector?.(".ProseMirror");
```
becomes
```jsx
      const innerPM = innerProseMirror(domNode);
```

**`forceLiveNow` sets React state, so the re-query must happen after React flushes.** If the re-query
returns null in the browser even though the id was registered, wrap the focus in a
`queueMicrotask`/`requestAnimationFrame` rather than removing the force — and add a test for it.

- [ ] **Step 4: Run and verify it passes**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- textblockCaretNav`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: Turn lazy ON for the block path**

In `client/src/docs/pills/InstanceTextblockNode.jsx`, pass `lazy` to **both** `DocContent` renders
(the `BoundBody`-wrapped one and the plain one):

```jsx
              <DocContent
                occurrence={occurrence}
                dispatch={dispatch}
                socket={socket}
                hideToolbar={true}
                lazy={!isProvisionalTextblock(occurrenceId)}
                onExitBlock={handleExitBlock}
                onDeleteBlock={handleNavigateBack}
                onEmptyBlur={handleEmptyBlur}
              />
```

`lazy={!isProvisionalTextblock(occurrenceId)}` is the trap from the spec: 2026-08-07 records that
deferring alone left a newly minted block **un-editable for 1223 ms**. A block minted a frame ago
must mount its real editor immediately.

- [ ] **Step 6: Teach the measurers about the block placeholder**

In `client/src/docs/WrapGroupNode.jsx` at `:193` the fallback already covers
`.textblock-card-placeholder`, which Task 6 reused deliberately — **verify it, do not assume**:

```bash
grep -n "textblock-card-placeholder" client/src/docs/WrapGroupNode.jsx
```

Expected: a hit at ~193. Then fix `:256`, which has **no** fallback:

```jsx
        const hostPm = els[els.length - 1].querySelector(".ProseMirror");
```
becomes
```jsx
        const hostPm = els[els.length - 1].querySelector(".ProseMirror")
          || els[els.length - 1].querySelector(".textblock-card-placeholder");
```

- [ ] **Step 7: Run the whole suite**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: `Tests 2401 passed`, 0 failed, 0 skipped. In particular Tasks 2 and 3's block tests must
still pass **unmodified except for the third test rewritten in Step 1**.

- [ ] **Step 8: Commit**

```bash
git add client/src/docs/pills/InstanceTextblockNode.jsx client/src/docs/WrapGroupNode.jsx client/src/helpers/lazyEditor.js client/src/__tests__/textblockCaretNav.test.jsx
git commit -m "perf(textblock): the doc block path mounts its editor lazily, caret hand-off forces neighbours live"
```

---

### Task 8: MEASURE the win, in a browser, on real data

**Files:** none modified. This task produces a number, and the number is the deliverable.

**An unmeasured performance claim is not a claim.** This repo's record is explicit: a probe that
samples through the main thread cannot measure a blocked main thread, and a probe reporting zero is a
claim about the probe until you have seen it report non-zero.

- [ ] **Step 1: Confirm the counter exists and reports non-zero BEFORE the change**

`client/src/helpers/loadDiag.js` tallies editor mounts. Read it and confirm how to switch it on:

```bash
grep -n "editor" client/src/helpers/loadDiag.js | head -20
```

Note: `loadDiag`'s state lives on `window`, not module scope, because rollup emits the helper into
more than one chunk — an earlier version reported **0 editor mounts on a grid with 241 rows**
because `Editor.jsx`'s copy had never been started. Verify you are reading the `window` counter.

- [ ] **Step 2: Measure the BEFORE number**

```bash
git stash
```
Load poms grid, open a doc page with many textblocks (the Eminem page is the documented heavy one),
and record the editor-mount count and time-to-first-paint. **Record the actual numbers.**

```bash
git stash pop
```

- [ ] **Step 3: Measure the AFTER number**

Repeat on the same page, same viewport, same throttle setting.

- [ ] **Step 4: Verify behaviour by hand — this is where these break**

- [ ] Click an empty line in a doc → the block mints and is typeable in the **same frame** (not a
      second later).
- [ ] Scroll a long doc → blocks go live as they approach, with no flash and no lost edit state.
- [ ] Put the caret at the end of a textblock and press ↓ / Enter into the **next** block, including
      one far enough down that it is still a placeholder → the caret lands in it.
- [ ] Same backwards with ↑ / Backspace at the start of a block.
- [ ] Open the Eminem page and confirm wrap groups still wrap below the fold (this is the exact
      measurement `WrapGroupNode` records being broken by lazy mounting once already).
- [ ] A `Daily Answer` textblock still reads and writes its bound field.

- [ ] **Step 5: Record the result**

Add a short entry to `client/src/modules/CLAUDE.md` (or `client/src/docs/CLAUDE.md` if the block path
dominates the change) naming the before/after numbers and **what was not measured**. If the win is
smaller than expected, say so — retiring a claim by measuring it is a valid outcome.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/CLAUDE.md
git commit -m "docs(textblock): record the lazy-block measurement, before and after"
```

---

# PHASE C — `ModuleTextblock` owns the `card` context (Stage 2)

---

### Task 9: Introduce `ModuleTextblock` and route the five card sites to it

**Files:**
- Create: `client/src/modules/ModuleTextblock.jsx`
- Create: `client/src/__tests__/moduleTextblock.test.jsx`
- Modify: `client/src/modules/ModuleContainer.jsx:752, 1623`
- Modify: `client/src/modules/pages/PageBoard.jsx:208`
- Modify: `client/src/modules/pages/PageCanvas.jsx:72`
- Modify: `client/src/docs/ModuleEmbedNode.jsx:272`

**Interfaces:**
- Consumes: `TextblockCard`, `ModuleInstance`.
- Produces: `<ModuleTextblock context="card" occurrence module {...instanceProps} />`.
  `context` is required and one of `"card" | "block" | "inline"`. **Every other prop passes through
  to `ModuleInstance` untouched**; the card context supplies `renderBody` and nothing else.

**Design decision, taken deliberately:** `ModuleTextblock` **composes** `ModuleInstance` for the
`card` context rather than reimplementing the shell. That makes this task pure routing, so *"works
exactly the same"* is true by construction. Whether it ever absorbs the shell is left open (spec §7)
— composing forever is a legitimate end state, because the shell is shared with `ArtifactCard`.

> **`floatHandle` MUST pass through — do not hardcode it.** The five call sites do **not** agree:
> `ModuleContainer:785`, `PageBoard:219` and `PageCanvas` pass `floatHandle={!!renderBody}`, but
> **`ModuleContainer:1646` and `ModuleEmbedNode:272` pass no `floatHandle` at all.** Supplying it
> unconditionally inside `ModuleTextblock` would silently change the handle treatment at two of the
> five sites — precisely the class of change this plan forbids. The card context supplies
> `renderBody` **only**.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/moduleTextblock.test.jsx`:

```jsx
// ModuleTextblock is the peer renderer for role:"textblock". It dispatches by
// CONTEXT, because the three contexts have disjoint feature sets and a union
// renderer would silently grant features (e.g. field binding on a card).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ModuleTextblock from "../modules/ModuleTextblock.jsx";

vi.mock("../modules/ModuleInstance.jsx", () => ({
  default: ({ renderBody, floatHandle, embedSourceType }) => (
    <div
      data-testid="shell"
      data-floathandle={floatHandle === undefined ? "absent" : String(!!floatHandle)}
      data-embedsource={embedSourceType || "none"}
    >
      {renderBody?.()}
    </div>
  ),
}));
vi.mock("../modules/TextblockCard.jsx", () => ({
  default: ({ occurrence }) => <div data-testid="card" data-occ={occurrence?.id} />,
}));

const OCC = { id: "occ-1" };
const MOD = { id: "mod-1", role: "textblock", kind: "doc" };

describe("ModuleTextblock", () => {
  it("renders the card context through the instance shell", () => {
    render(<ModuleTextblock context="card" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("card")).toHaveAttribute("data-occ", "occ-1");
  });

  // The five call sites DISAGREE about floatHandle: three pass it, two do not.
  // Hardcoding it here would silently change two of them.
  it("passes floatHandle THROUGH rather than supplying it", () => {
    const { rerender } = render(<ModuleTextblock context="card" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-floathandle", "absent");
    rerender(<ModuleTextblock context="card" occurrence={OCC} module={MOD} floatHandle />);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-floathandle", "true");
  });

  it("forwards embed props the doc-embed site depends on", () => {
    render(
      <ModuleTextblock context="card" occurrence={OCC} module={MOD} embedSourceType="doc-embed" />
    );
    expect(screen.getByTestId("shell")).toHaveAttribute("data-embedsource", "doc-embed");
  });

  it("throws on an unknown context rather than rendering something arbitrary", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<ModuleTextblock context="nonsense" occurrence={OCC} module={MOD} />)
    ).toThrow(/unknown textblock context/i);
    spy.mockRestore();
  });

  it("renders nothing when the occurrence is missing, without throwing", () => {
    const { container } = render(<ModuleTextblock context="card" occurrence={null} module={MOD} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- moduleTextblock`
Expected: FAIL — `Failed to resolve import "../modules/ModuleTextblock.jsx"`

- [ ] **Step 3: Implement**

Create `client/src/modules/ModuleTextblock.jsx`:

```jsx
// modules/ModuleTextblock.jsx
// ============================================================================
// The renderer for role:"textblock" — a peer of ModuleInstance / ModuleContainer
// / ModulePage.
//
// A textblock renders in exactly three MEASURED contexts (poms grid, 1036 occs):
//   card   ~51   a container/page child, or a moduleEmbed in a doc
//   block  246   an `instanceTextblock` node in a doc body
//   inline 721   an `instanceTextblockInline` node in a doc body
//
// They have DISJOINT feature sets — only `block` has the BoundBody field binding
// and the provisional lifecycle; only `card` has listCapRows; the chip exists on
// `card` and `inline` but not `block`. So this component dispatches by context and
// each context keeps its own features. A union renderer would silently GRANT
// features, which is precisely what "works exactly the same" forbids.
//
// The `card` context COMPOSES ModuleInstance rather than reimplementing its shell.
// That shell is shared with ArtifactCard and is not going away, and composing makes
// this routing change behaviour-identical by construction.
// ============================================================================
import React from "react";
import ModuleInstance from "./ModuleInstance.jsx";
import TextblockCard from "./TextblockCard.jsx";

export const TEXTBLOCK_CONTEXTS = ["card", "block", "inline"];

export default function ModuleTextblock({ context, occurrence, module, ...instanceProps }) {
  if (!TEXTBLOCK_CONTEXTS.includes(context)) {
    // Fail loudly. A silent default would render the wrong feature set, which is
    // the failure mode this component exists to prevent.
    throw new Error(`ModuleTextblock: unknown textblock context "${context}"`);
  }
  if (!occurrence) return null;

  if (context === "card") {
    // renderBody is the ONLY prop supplied here. floatHandle in particular must
    // pass through: three of the five call sites set it, two deliberately do not,
    // and forcing it would change the handle treatment at those two.
    return (
      <ModuleInstance
        {...instanceProps}
        occurrence={occurrence}
        module={module}
        renderBody={() => <TextblockCard occurrence={occurrence} module={module} />}
      />
    );
  }

  // `block` and `inline` are owned by their TipTap node views today; Task 10/11
  // move their bodies here. Until then this component is never called with them.
  throw new Error(`ModuleTextblock: context "${context}" is not routed here yet`);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- moduleTextblock`
Expected: `Tests  5 passed (5)`

- [ ] **Step 5: Route the five card sites**

The transformation is the same everywhere and is deliberately **mechanical**: keep the existing
`<ModuleInstance …>` element exactly as it is, swap the component name to `ModuleTextblock` when the
role is `textblock`, add `context="card"`, and **delete only the `renderBody` prop** (which
`ModuleTextblock` now supplies). Every other prop — including `floatHandle` where present — stays
byte-identical. Add `import ModuleTextblock from "./ModuleTextblock.jsx";` (adjust the relative path
per file) to each.

**5a. `client/src/modules/ModuleContainer.jsx` ~751 (canvas card renderer).** Replace the
`<ModuleInstance>` element in the `mod.role === "container" ? … : (…)` ternary with:

```jsx
          mod.role === "textblock" ? (
            <ModuleTextblock
              context="card"
              module={mod}
              occurrence={occ}
              containerId={cid}
              containerOccurrence={containerOccurrence}
              panelId={pid}
              dispatch={dispatch}
              socket={socket}
              floatHandle
            />
          ) : (
            <ModuleInstance
              module={mod}
              occurrence={occ}
              containerId={cid}
              containerOccurrence={containerOccurrence}
              panelId={pid}
              dispatch={dispatch}
              socket={socket}
              renderBody={renderBody}
              floatHandle={!!renderBody}
            />
          )
```
and drop the now-dead `if (mod.role === "textblock")` arm of the `renderBody` assignment above,
leaving only the `artifact` arm.

**5b. `client/src/modules/ModuleContainer.jsx` ~1619 (the list renderer).** Note this site passes
**no `floatHandle`** — do not add one:

```jsx
                node = role === "textblock" ? (
                  <ModuleTextblock
                    context="card"
                    module={instance}
                    occurrence={occurrence}
                    containerId={module.id}
                    panelId={panelId}
                    panel={panel}
                    container={module}
                    containerOccurrence={containerOccurrence}
                    dragOutDisabled={isGraphContainer}
                    dispatch={dispatch}
                    socket={socket}
                    allowedEdges={containerAllowedEdges}
                    onInstanceFocus={null}
                  />
                ) : (
                  <ModuleInstance
                    /* …unchanged, including renderBody={renderBody}… */
                  />
                );
```
and drop the `else if (role === "textblock")` arm of the `renderBody` assignment above.

**5c. `client/src/modules/pages/PageBoard.jsx` ~208.** Replace the `via === "instance"` branch:

```jsx
          const card = via === "instance" ? (
            role === "textblock" ? (
              <ModuleTextblock
                context="card"
                key={containerOcc?.id || container.id}
                module={container}
                occurrence={containerOcc}
                containerOccurrence={occurrence}
                panelId={panelId}
                dispatch={dispatch}
                socket={socket}
                floatHandle
              />
            ) : (
              <ModuleInstance
                /* …unchanged… */
              />
            )
          ) : (
```
and drop the `else if (role === "textblock")` arm of the `renderBody` assignment above.

**5d. `client/src/modules/pages/PageCanvas.jsx` ~72.** Same shape as 5a — read the `<ModuleInstance>`
element inside the `CanvasSlot` and swap it for `ModuleTextblock context="card"` when
`mod.role === "textblock"`, preserving every prop it passes and dropping only `renderBody`. Drop the
textblock arm of the `renderBody` assignment.

**5e. `client/src/docs/ModuleEmbedNode.jsx` ~261.** This branch is *already* role-gated, so it is the
smallest edit — and it passes **no `floatHandle`**:

```jsx
        {mod?.role === "textblock" ? (
          <ModuleTextblock
            context="card"
            module={mod}
            occurrence={occurrence}
            dispatch={dispatch}
            socket={socket}
            embedRadialItems={embedRadialItems}
            embedOnDelete={deleteNode}
            embedSourceType="doc-embed"
          />
        ) : mod?.role === "instance" ? (
```

- [ ] **Step 5b: Confirm no site still imports `TextblockCard` for the card path**

```bash
grep -rn "TextblockCard" client/src --include=*.jsx | grep -v "modules/TextblockCard.jsx" | grep -v "ModuleTextblock.jsx" | grep -v __tests__
```
Expected: only `WrapGroupNode.jsx` (a comment) and `InstanceForm.jsx` (a comment). Any remaining
`renderBody={() => <TextblockCard` is a site you missed.

- [ ] **Step 6: Verify nothing changed**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: `Tests 2406 passed`, 0 failed, 0 skipped. **Task 1's card tests must still pass
unmodified** — they render `TextblockCard` directly, so they stay valid, and the container/page tests
pin the routing.

- [ ] **Step 6b: Pin the convert feature, which now SPANS two renderers**

`CONVERTIBLE_LEAF_ROLES = ["instance", "textblock"]` — a leaf converts between the two from both the
radial and the context menu. After this task those two roles are rendered by *different components*,
so the round trip is no longer covered by construction. Append to
`client/src/__tests__/moduleTextblock.test.jsx`:

```jsx
import { planLeafRoleConversion } from "../helpers/convertOccurrence";

describe("instance <-> textblock conversion still round-trips across the renderer split", () => {
  it("converts a textblock to an instance and back to the same role", () => {
    const mod = { id: "m1", role: "textblock", kind: "doc", label: "A block" };
    const occ = { id: "o1", textmap: { type: "doc", content: [] } };

    const toInstance = planLeafRoleConversion({ occurrence: occ, module: mod, targetRole: "instance" });
    expect(toInstance.modulePatch.role).toBe("instance");

    const back = planLeafRoleConversion({
      occurrence: occ,
      module: toInstance.modulePatch,
      targetRole: "textblock",
    });
    expect(back.modulePatch.role).toBe("textblock");
  });

  it("refuses a role outside CONVERTIBLE_LEAF_ROLES", () => {
    expect(
      planLeafRoleConversion({
        occurrence: { id: "o2" },
        module: { id: "m2", role: "textblock" },
        targetRole: "container",
      })
    ).toBeNull();
  });
});
```

`planLeafRoleConversion` is verified to exist at `client/src/helpers/convertOccurrence.js:88` with
exactly this signature, returning `{ modulePatch, occurrencePatch }` where `modulePatch.role` is the
new role (`instance` → also sets `kind:"list"`; `textblock` → `kind:"doc"`). It is pure, so no mocks
are needed. The imperative `convertLeafRole` at `:124` applies the same plan through CommitHelpers.

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- moduleTextblock`
Expected: `Tests  7 passed (7)`

- [ ] **Step 7: Browser check**

- [ ] A textblock in a board container still shows its drag handle, radial menu and top-right
      universal-fields strip.
- [ ] A textblock on a canvas page still drags and positions.
- [ ] A `moduleEmbed`'d textblock inside a doc still renders.
- [ ] Convert instance→textblock and textblock→instance both still work from the radial menu.

- [ ] **Step 8: Commit**

```bash
git add client/src/modules/ModuleTextblock.jsx client/src/__tests__/moduleTextblock.test.jsx client/src/modules/ModuleContainer.jsx client/src/modules/pages/PageBoard.jsx client/src/modules/pages/PageCanvas.jsx client/src/docs/ModuleEmbedNode.jsx
git commit -m "feat(textblock): ModuleTextblock owns the card context; five sites route to it"
```

---

# PHASE D — Node views delegate their body (Stage 3)

**Read this before starting Phase D.** This is the only phase that can change what the user sees. If
the two chip implementations cannot be reconciled without a visible difference, **the correct outcome
is to stop and leave the inline path alone**, and record why. Shipping a "small" visual change here
violates the one constraint the user actually stated.

---

### Task 10: `block` context — the node view delegates its body

**Files:**
- Modify: `client/src/modules/ModuleTextblock.jsx`
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx`
- Test: `client/src/__tests__/moduleTextblock.test.jsx` (extend)

**Interfaces:**
- Consumes: `DocContent` (`lazy` prop from Task 6), `BoundBody`, `resolveEditorBinding`.
- Produces: `<ModuleTextblock context="block" occurrence module onExitBlock onDeleteBlock onEmptyBlur lazy />`
  renders the `BoundBody`-or-plain `DocContent` body **only** — the node view keeps
  `NodeViewWrapper`, the radial handle, drag registration and `embedDeleteRegistry`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/__tests__/moduleTextblock.test.jsx`:

```jsx
vi.mock("../modules/DocContent.jsx", () => ({
  default: ({ occurrence, lazy }) => (
    <div data-testid="doccontent" data-occ={occurrence?.id} data-lazy={String(!!lazy)} />
  ),
}));
vi.mock("../modules/BoundBody.jsx", () => ({
  default: ({ children, binding }) => (
    <div data-testid="boundbody" data-field={binding?.fieldId}>{children}</div>
  ),
}));
let blockBinding = null;
vi.mock("../state/editorBindings.js", () => ({ resolveEditorBinding: () => blockBinding }));

describe("ModuleTextblock — block context", () => {
  it("renders DocContent alone when there is no body binding", () => {
    blockBinding = null;
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} lazy />);
    expect(screen.getByTestId("doccontent")).toHaveAttribute("data-lazy", "true");
    expect(screen.queryByTestId("boundbody")).toBeNull();
  });

  it("wraps DocContent in BoundBody when a body binding resolves", () => {
    blockBinding = { fieldId: "f-answer", slot: "body" };
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("boundbody")).toHaveAttribute("data-field", "f-answer");
    expect(screen.getByTestId("boundbody")).toContainElement(screen.getByTestId("doccontent"));
  });

  it("never renders the instance shell for the block context", () => {
    blockBinding = null;
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} />);
    expect(screen.queryByTestId("shell")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- moduleTextblock`
Expected: FAIL — `ModuleTextblock: context "block" is not routed here yet`

- [ ] **Step 3: Implement**

In `client/src/modules/ModuleTextblock.jsx` add the imports and replace the `block` throw:

```jsx
import DocContent from "./DocContent.jsx";
import BoundBody from "./BoundBody.jsx";
import { resolveEditorBinding } from "../state/editorBindings.js";
```

```jsx
  if (context === "block") {
    const { lazy, onExitBlock, onDeleteBlock, onEmptyBlur } = instanceProps;
    const bodyBinding = resolveEditorBinding({ occurrence, module, slot: "body" });
    const body = (
      <DocContent
        occurrence={occurrence}
        dispatch={instanceProps.dispatch}
        socket={instanceProps.socket}
        hideToolbar
        lazy={lazy}
        onExitBlock={onExitBlock}
        onDeleteBlock={onDeleteBlock}
        onEmptyBlur={onEmptyBlur}
      />
    );
    return bodyBinding
      ? <BoundBody hostOccurrence={occurrence} binding={bodyBinding}>{body}</BoundBody>
      : body;
  }
```

- [ ] **Step 4: Run and verify it passes**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- moduleTextblock`
Expected: `Tests  10 passed (10)`

- [ ] **Step 5: Point the node view at it**

In `client/src/docs/pills/InstanceTextblockNode.jsx`, replace the whole
`{occurrence ? (bodyBinding ? <BoundBody>…</BoundBody> : <DocContent … />) : …}` expression's first
branch with:

```jsx
        {occurrence ? (
          <ModuleTextblock
            context="block"
            occurrence={occurrence}
            module={instance}
            dispatch={dispatch}
            socket={socket}
            lazy={!isProvisionalTextblock(occurrenceId)}
            onExitBlock={handleExitBlock}
            onDeleteBlock={handleNavigateBack}
            onEmptyBlur={handleEmptyBlur}
          />
        ) : isProvisionalTextblock(occurrenceId) ? (
```

Leave the provisional and em-dash branches exactly as they are. Remove the now-unused `DocContent`,
`BoundBody` and `resolveEditorBinding` imports **only after** confirming nothing else in the file
uses them.

- [ ] **Step 6: Verify the block characterization tests still pass**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- instanceTextblockNode`
Expected: `Tests  6 passed (6)` — Task 2's tests mock `DocContent`/`BoundBody` at their real paths,
so they keep working through the delegation. **If they needed editing, behaviour changed.**

Then: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: `Tests 2411 passed`, 0 failed, 0 skipped.

- [ ] **Step 7: Commit**

```bash
git add client/src/modules/ModuleTextblock.jsx client/src/docs/pills/InstanceTextblockNode.jsx client/src/__tests__/moduleTextblock.test.jsx
git commit -m "refactor(textblock): the block node view delegates its body to ModuleTextblock"
```

---

### Task 11: `inline` context — delegate, or STOP and record why

**Files:**
- Modify: `client/src/modules/ModuleTextblock.jsx`
- Modify: `client/src/docs/pills/InstanceTextblockInlineNode.jsx`
- Test: `client/src/__tests__/moduleTextblock.test.jsx`, `client/src/__tests__/instanceTextblockInlineNode.test.jsx`

**Interfaces:**
- Consumes: Task 4's inline characterization assertions — they are the gate.
- Produces: `<ModuleTextblock context="inline" …>` rendering the chip/text body only.

- [ ] **Step 1: Diff the two chip implementations before writing anything**

The chip exists twice: `TextblockCard`'s link branch (used by the `card` context) and
`InstanceTextblockInlineNode`'s own. **709 of poms grid's 1,036 textblocks are link chips**, so this
is the highest-blast-radius change in the plan.

```bash
sed -n '46,95p'  client/src/modules/TextblockCard.jsx
sed -n '60,140p' client/src/docs/pills/InstanceTextblockInlineNode.jsx
sed -n '270,305p' client/src/docs/pills/InstanceTextblockInlineNode.jsx
```

Write down, explicitly, every difference: the label source, the styling, whether it is an `<a>` or a
`<button>`, the arrow affordance, the click handling, keyboard behaviour.

- [ ] **Step 2: Decide, and record the decision in the plan file itself**

- **If the two can be reconciled with NO visible difference** — proceed to Step 3.
- **If they cannot** — stop. Add a short section to
  `docs/superpowers/specs/2026-08-10-textblock-occurrence-type-design.md` naming the differences and
  why the inline chip keeps its own renderer, then commit that and finish the plan at Task 10. This
  is a legitimate, expected outcome: the constraint is *"works exactly the same"*, and the inline
  path is already independent of `ModuleInstance`, so leaving it alone costs nothing but one
  duplicate.

- [ ] **Step 3 (only if reconcilable): Extract the chip and delegate**

Add an `inline` branch to `ModuleTextblock` rendering the shared chip, point
`InstanceTextblockInlineNode`'s body at it, and keep the node view's `NodeViewWrapper`, radial
handle, drag registration, caret handling and `embedDeleteRegistry`.

- [ ] **Step 4: Verify with Task 4's tests UNMODIFIED**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test -- instanceTextblockInlineNode`
Expected: `Tests  4 passed (4)`.

**If any Task 4 assertion needs changing to pass, the chips were not reconcilable — revert Step 3 and
take the Step 2 "stop" branch.** That is the whole point of having written them first.

- [ ] **Step 5: Full suite + browser check**

Run: `TMPDIR=$HOME/tmp npm --prefix ./client run test`
Expected: 0 failed, 0 skipped.

- [ ] Open a doc with imported link chips (the Eminem page has hundreds) and confirm they look and
      behave identically: same size, same colour, arrow present, click opens, in-app links jump.
- [ ] Drag a chip out of a doc and back.

- [ ] **Step 6: Commit**

```bash
git add -A client/src/modules/ModuleTextblock.jsx client/src/docs/pills/InstanceTextblockInlineNode.jsx client/src/__tests__
git commit -m "refactor(textblock): the inline chip delegates to ModuleTextblock"
```

---

## Final verification

- [ ] `TMPDIR=$HOME/tmp npm --prefix ./client run test` → 0 failed, **0 skipped**
- [ ] `TMPDIR=$HOME/tmp npm --prefix ./server run test` → `666 passed`, 0 failed
- [ ] `npm --prefix ./client run build` → clean, chunk sanity holding
- [ ] `node --env-file=server/.env server/scripts/checkGrid.js --all` → poms grid and test grid 2 at
      **0 integrity errors** (this plan writes no data, so any change here is a probe artifact — sweep it)
- [ ] The editor-mount before/after numbers from Task 8 are recorded in a folder `CLAUDE.md`
- [ ] A `CLAUDE.md` entry states plainly what was **not** verified

## Non-goals

- No data migration; nothing writes to a grid, module or occurrence.
- `ModuleInstance` does not get smaller — `ArtifactCard` still uses `renderBody`.
- No change to the field machinery, universal fields, or `fieldReveal`.
- No layout changes — the layout-UI unification is its own plan and runs after this one.
