# Instant textblock mint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** clicking an empty line puts a usable textblock on screen in **under 100ms** on the real
Day Page, instead of the measured 250–1016ms.

**Architecture:** The mint decision and the two store writes are already free (0.9ms combined,
measured). The entire wait is ONE synchronous `editor.view.dispatch(tr)` that replaces the line and,
inside the host doc's re-render, mounts live TipTap instances. This plan (1) finds out whether that
cost is ONE editor mount or N *re*-mounts of blocks that were already there, then (2) takes the
mount off the click's critical path so the block paints first and becomes editable a frame later,
and (3) removes whichever multiplier Task 1 names.

**Tech Stack:** React 18, TipTap v3 / ProseMirror, Vitest + jsdom (behaviour), Playwright + CDP
(timing — jsdom cannot measure this), `helpers/mintDiag.js` (already shipped).

## Global Constraints

- **Measure before changing.** Every performance fix on this codebase that worked came from numbers;
  every one that came from reading code was wrong (`CLAUDE.md` 2026-08-05). Task 1 gates Tasks 3–4.
- **Probe against `test grid 2`, never `poms grid`.** A probe that loads the live grid writes to it.
  Sweep with `node --env-file=server/.env server/scripts/sweepOrphans.js --grid "test grid 2" --apply`
  and re-check `checkGrid --all` before calling any task done.
- **jsdom cannot measure this and must not pretend to.** Unit tests in this plan pin BEHAVIOUR
  (ordering, caret, no double-mint). Timing claims come only from `_mintprobe.mjs`.
- **The caret contract cannot regress.** After a mint the caret must land inside the new block, and
  typing must go into it — `requestTextblockFocus` / `consumeTextblockFocus` own that.
- **No emit for a provisional block.** The block still must not reach the server until it holds
  content (`helpers/provisionalTextblock.js`). Nothing in this plan may emit earlier.
- **A/B every regression test against the unfixed code.** A test that passes before the fix is not a
  test.

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/helpers/mintDiag.js` | ALREADY EXISTS. Task 1 adds `editor:create` / `editor:destroy` marks fed from `Editor.jsx`. |
| `client/src/ui/Editor.jsx` | Emits the editor lifecycle marks (Task 1). Gains the deferred-mount branch (Task 2) and, if Task 1 says so, a reduced extension set for sub-editors (Task 4). |
| `client/src/modules/DocContent.jsx` | Owns the mint. Task 2 splits the dispatch from the editor mount. |
| `client/src/docs/pills/InstanceTextblockNode.jsx` | The node view. Task 2 renders the block shell before its body; Task 3 memoises it so a sibling insert cannot remount it. |
| `client/src/docs/InstanceTextblockExtension.js` | Node view registration. Task 3 may add an `update` hook so ProseMirror reuses the view instead of recreating it. |
| `_mintprobe.mjs` (repo root, gitignored) | ALREADY EXISTS. Task 1 extends it with the scaling sweep; Task 5 is the before/after. |
| `client/src/__tests__/instantMint.test.jsx` **(NEW)** | Behaviour contracts for Tasks 2–3. |

---

### Task 1: MEASURE what the 1s actually is

**Files:**
- Modify: `client/src/ui/Editor.jsx` (add two marks)
- Modify: `_mintprobe.mjs` (report the editor-lifecycle counts + a doc-size sweep)

**Interfaces:**
- Produces: `mintMark("editor:create", { occId })` and `mintMark("editor:destroy", { occId })` —
  Task 3's regression test counts these.

**The question this task answers, and nothing else:** during the one blocking dispatch, is the app
creating **one** ProseMirror (so a single TipTap mount costs ~1s — implausible but must be ruled
out) or **N** of them (so inserting a node remounts blocks that were already on screen)? The two
have completely different fixes, and guessing between them is what this codebase keeps paying for.

- [ ] **Step 1: emit the marks.** In `client/src/ui/Editor.jsx`, next to the existing
      `useEffect(() => { if (editor) markLoad("editor:mount"); }, [editor]);` add:

```jsx
  // [mint] lifecycle — Task 1 of the instant-mint plan. Counting CREATE vs
  // DESTROY during a single mint is what separates "one expensive mount" from
  // "everything remounted".
  useEffect(() => {
    if (!editor) return;
    mintMark("editor:create", { occId: (occurrence?.id || "").slice(0, 8) });
    return () => mintMark("editor:destroy", { occId: (occurrence?.id || "").slice(0, 8) });
  }, [editor, occurrence?.id]);
```

      `mintMark` is already imported in this file.

- [ ] **Step 2: report them.** In `_mintprobe.mjs`, after the CLICK 1 table, add:

```js
const life = first.marks.filter((m) => m.label === "editor:create" || m.label === "editor:destroy");
console.log(`editor lifecycle during the mint: ${life.filter((m) => m.label === "editor:create").length} created, `
  + `${life.filter((m) => m.label === "editor:destroy").length} destroyed`);
```

- [ ] **Step 3: run it on a SMALL doc and a BIG one.** The Day Page's Journal container is nearly
      empty; the "Uses" doc holds ~34 textblocks.

```bash
node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Day Page"
node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Uses"
```

      Record, for each: `replaceLine+mountSubEditor` ms, editors created, editors destroyed.

- [ ] **Step 4: write the verdict into this file** under a `### RESULTS` heading, in the shape:

```
                       block count   dispatch ms   created   destroyed
Day Page (Journal)          ~1           ?            ?          ?
Uses                        ~34          ?            ?          ?
```

      **The decision:** created ≈ 1 and the ms still large → the mount itself is expensive → Task 4
      (lighter sub-editor) is the work and Task 3 is skipped. created ≈ N → every block is being
      remounted → **Task 3 is the work** and Task 4 becomes optional. Either way Task 2 applies:
      the mount does not belong on the click.

- [ ] **Step 5: sweep + commit.**

```bash
node --env-file=server/.env server/scripts/sweepOrphans.js --grid "test grid 2" --apply
node --env-file=server/.env server/scripts/checkGrid.js --all
git add client/src/ui/Editor.jsx docs/superpowers/plans/2026-08-07-instant-textblock-mint.md
git commit -m "perf(mint): measure the editor lifecycle inside the mint dispatch"
```

---

### Task 2: the block PAINTS before its editor exists

**Files:**
- Modify: `client/src/modules/DocContent.jsx` (the `handleCaretMintTextblock` dispatch)
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx` (render the shell, then the body)
- Test: `client/src/__tests__/instantMint.test.jsx` (NEW)

**Interfaces:**
- Consumes: `requestTextblockFocus(occId)` / `consumeTextblockFocus(occId)` from
  `client/src/helpers/pendingTextblockFocus.js` — unchanged, still how the caret is claimed.
- Produces: `InstanceTextblockNode` renders its card chrome on the first commit and its
  `DocContent` body on the next frame. No new exports.

**Why this is the core of the plan:** whatever the mount costs, it does not have to happen inside
the gesture. The user's test of "instant" is that the block APPEARS where they clicked. Painting the
card first turns a 1s freeze into a ~30ms appearance plus a background mount, and it is a strictly
smaller change than making the mount itself cheap.

- [ ] **Step 1: write the failing test.** Create `client/src/__tests__/instantMint.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// The body is what costs; the shell is what the user sees. This test pins that
// the shell renders on the FIRST commit and the body only after a frame.
vi.mock("../modules/DocContent.jsx", () => ({
  __esModule: true,
  default: () => <div data-testid="doc-body" />,
}));

import DeferredBody from "../docs/pills/DeferredBody";

describe("DeferredBody", () => {
  it("renders nothing on the first commit and the child after a frame", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    render(<DeferredBody><div data-testid="doc-body" /></DeferredBody>);
    expect(screen.queryByTestId("doc-body")).toBeNull();
    raf.mockRestore();
  });

  it("renders the child once the frame runs", async () => {
    const cbs = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cbs.push(cb); return cbs.length; });
    render(<DeferredBody><div data-testid="doc-body" /></DeferredBody>);
    await act(async () => { cbs.forEach((cb) => cb(0)); });
    expect(screen.getByTestId("doc-body")).toBeTruthy();
  });

  it("renders IMMEDIATELY when told to (a block that already existed must not flash)", () => {
    render(<DeferredBody immediate><div data-testid="doc-body" /></DeferredBody>);
    expect(screen.getByTestId("doc-body")).toBeTruthy();
  });
});
```

- [ ] **Step 2: run it and watch it fail.**

```bash
npm --prefix ./client run test -- src/__tests__/instantMint.test.jsx
```

      Expected: FAIL — `Failed to resolve import "../docs/pills/DeferredBody"`.

- [ ] **Step 3: implement `DeferredBody`.** Create
      `client/src/docs/pills/DeferredBody.jsx`:

```jsx
import { useEffect, useState } from "react";

/**
 * Renders `children` one frame late.
 *
 * The card chrome of a textblock is cheap; its body is a live ProseMirror, and
 * mounting one inside the click that created the block is the whole of the
 * measured 250–1016ms wait. Holding the body for a frame lets the browser paint
 * the block where the user clicked and mount the editor after.
 *
 * `immediate` is for every block that was ALREADY on screen: they must not
 * blink through an empty state on an unrelated re-render.
 */
export default function DeferredBody({ children, immediate = false }) {
  const [ready, setReady] = useState(immediate);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    const id = requestAnimationFrame(() => { if (alive) setReady(true); });
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [ready]);
  return ready ? children : null;
}
```

- [ ] **Step 4: run the test.**

```bash
npm --prefix ./client run test -- src/__tests__/instantMint.test.jsx
```

      Expected: PASS (3 tests).

- [ ] **Step 5: use it in the node view.** In
      `client/src/docs/pills/InstanceTextblockNode.jsx`, import it:

```jsx
import DeferredBody from "./DeferredBody";
```

      and wrap BOTH `<DocContent …>` render sites (the `bodyBinding` branch at ~line 322 and the
      plain branch at ~line 339) so the card chrome commits first. The block that was just minted is
      the only one that should defer; every other block renders immediately:

```jsx
        {occurrence ? (
          <DeferredBody immediate={!isJustMinted}>
            {bodyBinding ? (
              <BoundBody hostOccurrence={occurrence} binding={bodyBinding}>
                <DocContent … />
              </BoundBody>
            ) : (
              <DocContent … />
            )}
          </DeferredBody>
        ) : ( … )}
```

      where, near the top of the component:

```jsx
  // A block minted by the caret-entry click is the ONLY one that gains from
  // deferring its body — it is empty, so there is nothing to see yet, and the
  // click that created it is the gesture we are trying to keep instant.
  const isJustMinted = isProvisionalTextblock(occurrenceId);
```

      `isProvisionalTextblock` is already imported in this file.

- [ ] **Step 6: keep the caret.** The sub-editor claims the caret in its own `onCreate`
      (`consumeTextblockFocus`), which now runs a frame later — that is fine, the claim is a
      registry, not a race. **Verify it, do not assume:** run the probe and confirm typing after the
      click lands in the new block.

```bash
npm run build:client && node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Day Page"
```

      Expected: `block:in-dom` well before `subeditor:in-dom`, and `mint:go → block:in-dom` under
      100ms. Record both numbers.

- [ ] **Step 7: full suite + commit.**

```bash
npm run test:client
git add client/src/docs/pills/DeferredBody.jsx client/src/docs/pills/InstanceTextblockNode.jsx client/src/__tests__/instantMint.test.jsx
git commit -m "perf(mint): the block paints before its editor mounts"
```

---

### Task 3: a sibling insert must not remount every other block

**GATED on Task 1 reporting `created ≈ N`.** If Task 1 reported one create, skip to Task 4 and note
here why it was skipped.

**Files:**
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx` (memo + stable props)
- Modify: `client/src/docs/InstanceTextblockExtension.js` (node-view `update`)
- Test: `client/src/__tests__/instantMint.test.jsx` (add cases)

**Interfaces:**
- Consumes: `mintMark("editor:create")` from Task 1 — the probe assertion counts it.

**What is being fixed:** `ReactNodeViewRenderer` destroys and recreates a node view whenever
ProseMirror decides the old view cannot represent the new node. Inserting a sibling should not
change any existing node — if the counts say otherwise, either the views are being recreated (fix in
the extension's `update`) or React is remounting the subtree because its props change identity (fix
with `React.memo` + stable callbacks).

- [ ] **Step 1: write the failing test** — add to `client/src/__tests__/instantMint.test.jsx`:

```jsx
import { isSameTextblockNode } from "../docs/InstanceTextblockExtension";

describe("node view reuse", () => {
  it("treats a node with the SAME occurrenceId as reusable", () => {
    const a = { type: { name: "instanceTextblock" }, attrs: { occurrenceId: "o1", instanceId: "m1" } };
    const b = { type: { name: "instanceTextblock" }, attrs: { occurrenceId: "o1", instanceId: "m1" } };
    expect(isSameTextblockNode(a, b)).toBe(true);
  });

  it("does NOT reuse a view for a different occurrence", () => {
    const a = { type: { name: "instanceTextblock" }, attrs: { occurrenceId: "o1", instanceId: "m1" } };
    const b = { type: { name: "instanceTextblock" }, attrs: { occurrenceId: "o2", instanceId: "m2" } };
    expect(isSameTextblockNode(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: run it and watch it fail.**

```bash
npm --prefix ./client run test -- src/__tests__/instantMint.test.jsx
```

      Expected: FAIL — `isSameTextblockNode` is not exported.

- [ ] **Step 3: implement.** In `client/src/docs/InstanceTextblockExtension.js`, export the
      predicate and hand it to the node view:

```js
/**
 * Can an existing node view keep serving this node? A textblock view is
 * identified by WHICH OCCURRENCE it renders — nothing else about the node can
 * change without the occurrence changing. Returning true here is what stops
 * ProseMirror tearing down (and TipTap re-mounting) every block on the page
 * when a sibling is inserted.
 */
export function isSameTextblockNode(oldNode, newNode) {
  if (!oldNode || !newNode) return false;
  if (oldNode.type?.name !== newNode.type?.name) return false;
  return oldNode.attrs?.occurrenceId === newNode.attrs?.occurrenceId
    && oldNode.attrs?.instanceId === newNode.attrs?.instanceId;
}
```

      and in `addNodeView()`:

```js
    return ReactNodeViewRenderer(InstanceTextblockNode, {
      update: ({ oldNode, newNode }) => isSameTextblockNode(oldNode, newNode),
      stopEvent: ({ event }) => { /* unchanged */ },
    });
```

- [ ] **Step 4: memoise the React side.** At the bottom of
      `client/src/docs/pills/InstanceTextblockNode.jsx`, replace the default export:

```jsx
// A node view that survives a sibling insert at the ProseMirror level must also
// survive it at the React level — otherwise the editor inside is torn down and
// re-created anyway, which is the cost this is here to remove.
export default React.memo(InstanceTextblockNode, (prev, next) =>
  prev.node.attrs.occurrenceId === next.node.attrs.occurrenceId
  && prev.node.attrs.instanceId === next.node.attrs.instanceId
  && prev.getPos === next.getPos
  && prev.editor === next.editor);
```

      (add `React` to the existing import if it is not already there).

- [ ] **Step 5: run the tests.**

```bash
npm --prefix ./client run test -- src/__tests__/instantMint.test.jsx
```

      Expected: PASS.

- [ ] **Step 6: prove it on the real doc — this is the number that matters.**

```bash
npm run build:client && node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Uses"
```

      Expected: `editors created` during the mint drops to **1** (was N). Record before/after.
      **A/B it:** revert the `update` hook alone, re-run, confirm the count goes back up. If it does
      not, the remount is coming from somewhere else and this task's premise is wrong — say so in
      the RESULTS section rather than keeping the change.

- [ ] **Step 7: full suite + commit.**

```bash
npm run test:client
git add client/src/docs/InstanceTextblockExtension.js client/src/docs/pills/InstanceTextblockNode.jsx client/src/__tests__/instantMint.test.jsx
git commit -m "perf(mint): reuse textblock node views instead of remounting every block"
```

---

### Task 4: a lighter editor for textblock bodies

**GATED on Tasks 2–3 not reaching the 100ms target**, or on Task 1 reporting that ONE mount is
expensive. If the target is already met, skip this task and record that — an unnecessary change to
the extension set is a large blast radius for nothing.

**Files:**
- Modify: `client/src/ui/Editor.jsx` (extension list)
- Test: `client/src/__tests__/instantMint.test.jsx` (add cases)

**What is being fixed:** every `Editor` mounts the full extension set — StarterKit plus ~20 custom
nodes (FieldPill, InstancePill, InstanceTextblock, ModuleEmbed, WrapGroup, ExprPill, Table, Image,
TaskList, …). A textblock BODY cannot legally contain a nested textblock, a wrap group, or a
module embed; it is prose with pills. Building schema and plugins for nodes that can never appear is
pure cost paid per block.

- [ ] **Step 1: write the failing test:**

```jsx
import { extensionsForRole } from "../ui/Editor";

describe("extensionsForRole", () => {
  it("a textblock body drops the block-level nodes it can never contain", () => {
    const names = extensionsForRole("textblock").map((e) => e.name);
    expect(names).not.toContain("instanceTextblock");
    expect(names).not.toContain("wrapGroup");
    expect(names).not.toContain("moduleEmbed");
    expect(names).toContain("fieldPill");   // pills ARE legal in a body
  });

  it("a primary doc editor keeps everything", () => {
    const names = extensionsForRole("doc").map((e) => e.name);
    expect(names).toContain("instanceTextblock");
    expect(names).toContain("wrapGroup");
    expect(names).toContain("moduleEmbed");
  });
});
```

- [ ] **Step 2: run it and watch it fail** (`extensionsForRole` is not exported).

- [ ] **Step 3: implement.** In `client/src/ui/Editor.jsx`, lift the array currently passed inline to
      `useEditor({ extensions: [...] })` (it starts `StarterKit.configure({ heading: …, dropcursor:
      false })` and ends with `Table.configure({ resizable: true })`) into a module-scope function,
      changing nothing about the entries themselves:

```js
// A textblock BODY cannot legally contain another textblock, a wrap group, a
// module embed or a table — those are block structures the PARENT doc owns.
// Registering them anyway costs schema + plugin construction on every block, and
// there is one editor per block. `doc` keeps the full set unchanged.
const BODY_EXCLUDES = new Set(["instanceTextblock", "wrapGroup", "moduleEmbed", "table"]);

export function extensionsForRole(role) {
  const all = [ /* the existing array, moved verbatim */ ];
  if (role !== "textblock") return all;
  return all.filter((e) => !BODY_EXCLUDES.has(e.name));
}
```

      then in the component:

```js
  // `onExitBlock` is the gate this file already uses to tell a sub-editor from a
  // primary doc editor (it is only passed by InstanceTextblockNode).
  const extensions = useMemo(() => extensionsForRole(onExitBlock ? "textblock" : "doc"), [onExitBlock]);
```

      and pass `extensions` to `useEditor`. **`useMemo` is required** — a fresh array identity per
      render is exactly the kind of churn that recreates the editor, which would cost more than the
      trim saves.

- [ ] **Step 4: run the tests, then re-measure.**

```bash
npm --prefix ./client run test -- src/__tests__/instantMint.test.jsx
npm run build:client && node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Uses"
```

- [ ] **Step 5: check what you removed is really impossible.** Open a textblock on a real page and
      confirm: an `@` mention still inserts a field pill, a link chip still renders, and dragging an
      occurrence onto a textblock still wraps it (the wrap lives in the PARENT doc, which keeps
      `WrapGroup`). **If any of those break, revert this task** — the mount cost is not worth a
      capability.

- [ ] **Step 6: commit.**

```bash
npm run test:client
git add client/src/ui/Editor.jsx client/src/__tests__/instantMint.test.jsx
git commit -m "perf(mint): a textblock body mounts only the extensions it can legally use"
```

---

### Task 5: verify, and say what it cost

**Files:**
- Modify: `docs/superpowers/plans/2026-08-07-instant-textblock-mint.md` (RESULTS)
- Modify: `client/src/CLAUDE.md`, `client/src/docs/CLAUDE.md`, root `CLAUDE.md`

- [ ] **Step 1: before/after on both docs**, three runs each, medians:

```bash
node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Day Page"
node _mintprobe.mjs --tokenFile /tmp/token.txt --page "Uses"
```

      Report exactly these: `click → mint:go`, `mint:go → block:in-dom`, `block:in-dom →
      subeditor:in-dom`, editors created. **The headline number is `mint:go → block:in-dom`** — that
      is what the user calls "instant".

- [ ] **Step 2: the second-click case still works.** The probe's CLICK 2 must still reach `mint:go`
      and leave a block at the new line. This is the 2026-08-06 fix; it must not regress.

- [ ] **Step 3: type into it.** After the mint, type five characters and assert they land in the new
      block (`document.activeElement.closest(".instance-textblock-block")` is the new block, and its
      text is what was typed). A block that appears instantly and eats the first keystrokes is
      worse than a slow one.

- [ ] **Step 4: sweep + integrity.**

```bash
node --env-file=server/.env server/scripts/sweepOrphans.js --grid "test grid 2" --apply
node --env-file=server/.env server/scripts/checkGrid.js --all
```

- [ ] **Step 5: write it down.** RESULTS in this file; a docket update in `client/src/CLAUDE.md`
      (the "editor static-until-focus" entry — say whether this plan closed it or only scoped it);
      a session entry in the root `CLAUDE.md`. State the residual honestly: if the body still takes
      ~1s to become editable on a 34-block doc, that is the remaining work, not a footnote.

- [ ] **Step 6: commit.**

```bash
git add -A && git commit -m "docs(mint): instant-mint results and what is left"
```

---

## Risks

- **Deferring the body could eat the first keystrokes.** The caret is claimed by the sub-editor's
  `onCreate`, which now runs a frame later; anything typed in that frame has nowhere to go. Task 5
  Step 3 exists for exactly this. If it bites, the fallback is to keep a plain `contentEditable`
  shell that absorbs the first characters and hands them to the editor on mount — more machinery,
  and only worth it if the measurement says the gap is long enough to type into.
- **`update: () => true` on a node view can mask real attr changes.** The predicate is deliberately
  keyed on the two attrs that identify the block. If a future attr needs to re-render the view, it
  must be added to `isSameTextblockNode` — otherwise the change will silently not appear.
- **`React.memo` on a node view hides prop bugs.** If a callback that should change is captured, the
  block will keep calling a stale one. The comparator deliberately checks `editor` and `getPos`
  identity for this reason.
- **Trimming extensions changes the schema of existing content.** A textblock whose stored textmap
  contains a node the trimmed schema does not know will have that node DROPPED on load. Before Task
  4 ships, grep the live grid for textblock textmaps containing `moduleEmbed` / `wrapGroup` /
  `instanceTextblock` / `table` — if any exist, the trim is unsafe as written and must keep those
  nodes registered.
- **The op cascade after the mint is NOT in scope.** A 1256ms long task was measured *after* the
  block landed (the parent doc's save path plus the op sweep). It makes typing feel bad right after
  a mint, and no task here touches it. If Task 5 shows the block is instant but the app still stalls
  after, that is the next plan, not a failure of this one.
