# DnD / Wrap-Layout / Menus Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs and remove the latency sources found in the 2026-07-06 audit of the Wikipedia-import wrap layout, drag-and-drop (desktop + mobile/tablet), and every menu surface — so drag-and-drop is instant everywhere.

**Architecture:** All changes are client-side except Task 6 (importer attrs). The perf core is Task 10: `useDragDrop`/`useDroppable` currently put `JSON.stringify(data)`/`JSON.stringify(context)` in their registration-effect deps and `ModuleInstance` passes `data: { ...module, occurrence }` (occurrence includes `fields` and, for textblocks, full TipTap `textmap`) — so every render of every instance/container stringifies KBs, and any occurrence write tears down + re-registers Pragmatic DnD targets and touch listeners. Moving payloads into live refs (read at drag/event time) kills both costs. The rest are targeted bug fixes (a crashing import in `InsertGap`), unconditional debug logging in the drop hot path, per-frame DOM scans, and menu polish.

**Tech Stack:** React 18, @atlaskit/pragmatic-drag-and-drop, TipTap/ProseMirror, vitest (+ @testing-library/react in client tests), express/cheerio importer on the server.

## Global Constraints

- All existing tests must stay green: `npm --prefix client run test` and `npm --prefix server run test` (client suite was 1136/1136, server 222+ as of 2026-07-04).
- `npm run dev` must work after every commit (repo rule: always leave the system testable).
- No back-compat shims / alias fallbacks when renaming or removing things (user memory `feedback_no_fallbacks`). One deliberate exception is documented in Task 6 (persisted textmaps carry old node attrs; the TipTap attr definition stays, only the emitter stops writing it).
- When a task touches files in a folder that has a `CLAUDE.md`, update that folder's `CLAUDE.md` in the same commit (repo session rule). Folders in play: `client/src/`, `client/src/ui/`, `client/src/helpers/`, `client/src/docs/`, `client/src/mobile/` (create if missing — only if touched), `server/`.
- Optimistic updates everywhere — never introduce a server round-trip wait into a drop path (user memory `feedback_optimistic_updates`).
- Commit messages follow repo style: `fix(scope): …` / `feat(scope): …` / `perf(scope): …`.
- Debug/diagnostic logging must be gated behind `window.__dragDiag === true` (behavioral tracing) or `window.__dragPerf === true` (timing). Never unconditional in a hot path.

---

## Audit findings this plan implements (summary)

| # | Severity | Finding | Task |
|---|----------|---------|------|
| 1 | **Crash** | `InsertGap.jsx:53` calls `createLeafInstanceAtIndex` but only imports `createChildInContainer` → picking an EXISTING module from an insert-gap throws `ReferenceError` | 1 |
| 2 | Perf/noise | `DragProvider.handleDrop` runs an unconditional `console.log` stopwatch (`_lap` ×6) + `snapshotRenders`/`diffRenders` + `[drop-renders]` log on EVERY drop; `Editor.jsx` has 21 unconditional `DLOG` sites and `detectSideHost` logs a `[detectSideHost] null` line **per dragover event** whenever the pointer isn't over a wrap host | 2 |
| 3 | Cruft | `RadialMenu` `onAddChild`/`addLabel` props are dead (no default item renders them; callers in ModulePanel/ModuleContainer/ModuleInstance pass handlers that can never fire); `Plus` import unused; `key={item.label}` collides for duplicate labels | 3 |
| 4 | UX bug | `ContextMenu` has fixed 168px width and no max-height/scroll — long menus (multi-select bulk items) overflow small screens; long labels clip | 4 |
| 5 | UX bug | `QuickAddMenu` always opens below its anchor (`rect.bottom + 2`) — near the bottom of the viewport (esp. phone + keyboard) the 360px menu goes off-screen; only `left` is clamped | 5 |
| 6 | Cruft | Importer emits `wrap: false, anchor: "top"` on every `wrapGroup`, but `WrapGroupNode` ignores the `wrap` attr entirely (`wrap = neighborCount > 0`) — dead knob contradicting `feedback_no_fallbacks` | 6 |
| 7 | **Bug** | `WrapGroupNode.measure` computes `notchY`/shape from **legacy `anchorIndex` only** — a line-level wrap (`anchorOffset > 0`, `anchorIndex` null) gets `notchY = 0`, so the host-background clip cuts the TOP band instead of the band the neighbor actually floats in (middle/bottom shapes clip wrong for every wrap formed since the 2026-06-17 line-level morph) | 7 |
| 8 | Perf | `Editor.jsx` `onDragOver` runs `nearestDocBoundary` + `detectSideHost` → `offsetFor` (which calls `getClientRects()` on **every block of the host**) on every native dragover event — unthrottled; on imported Wikipedia articles (hundreds of blocks) this is the doc-drag jank source | 8 |
| 9 | Perf | `DragProvider.showDropIndicators` runs `querySelectorAll(".instance-wrap, [data-container-id]")` + a `closest()` filter walk per rAF frame while hovering a container; the identical scan is duplicated in `dragHitTesting.computeInsertIndexFromPointer` (DRY violation) | 9 |
| 10 | **Perf (core)** | `useDragDrop`/`useDroppable` effect deps include `JSON.stringify(data)`/`context`/`accepts`/`allowedEdges`; `ModuleInstance` passes `data: { ...module, occurrence }`, `ModuleContainer` passes `data: { ...containerWithInstances, … }` → per-render stringify of KB-scale objects across ~580 mounted components AND full Pragmatic + touch-listener re-registration on every occurrence write (incl. during the post-drop op cascade) | 10 |
| 11 | Perf | `MobileGridNav` overscroll handler calls `findScrollableAncestor` (a `getComputedStyle` walk) on **every touchmove** during normal scrolling | 11 |
| 12 | UX gap | Touch drag pill shows only the label; the desktop native ghost shows label + action verb (Move/Copy/Copy-link) | 12 |
| 13 | Limitation | On coarse-pointer devices `useDragDrop` never registers Pragmatic `draggable()` — a tablet with a mouse/trackpad cannot mouse-drag at all | 13 |
| 14 | Measurement | Drop→paint tail: 2026-07-03 work got drop→paint to ~1400ms @5x throttle; frame-1 flush ~1.3s remains (documented lever). Re-baseline after Tasks 9–10 land | 14 |

Not in scope (already working, verified in audit): the 2026-07-04 mobile regressions (mosaic pager, compact handles, mosaic reconcile, stale grid) are fixed; wrap channel/page-bg + infobox h-scroll fixed 2026-07-03; touch doc drops, long-press menus, snap zones, offline queue all wired. Known open items tracked elsewhere: Daily Toolkit preview (#15, needs in-browser repro), server-side undo/redo (disabled), Kiwix backend (optional).

---

### Task 1: Fix the InsertGap crash (missing `createLeafInstanceAtIndex` import)

**Files:**
- Modify: `client/src/ui/InsertGap.jsx:16`
- Test: `client/src/__tests__/insertGap.test.jsx` (new)

**Interfaces:**
- Consumes: `createLeafInstanceAtIndex` (already exported from `client/src/helpers/CommitHelpers.js:975`).
- Produces: nothing new — restores the "pick an existing module in an insert gap" path.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/insertGap.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  createChildInContainer: vi.fn(() => ({ moduleId: "new-mod" })),
  createLeafInstanceAtIndex: vi.fn(() => ({ moduleId: "new-mod", occurrenceId: "new-occ" })),
  qam: { props: null },
}));

vi.mock("../helpers/CommitHelpers", () => ({
  createChildInContainer: mocks.createChildInContainer,
  createLeafInstanceAtIndex: mocks.createLeafInstanceAtIndex,
}));
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => ({
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    state: {}, modulesById: {},
  }),
}));
// Capture QuickAddMenu's props so the test can drive onSelect directly.
vi.mock("../ui/QuickAddMenu.jsx", () => ({
  default: (props) => { mocks.qam.props = props; return null; },
}));

import InsertGap from "../ui/InsertGap.jsx";

describe("InsertGap", () => {
  beforeEach(() => {
    mocks.qam.props = null;
    mocks.createLeafInstanceAtIndex.mockClear();
  });

  it("picking an EXISTING module splices it at the gap index (regression: unimported createLeafInstanceAtIndex threw)", () => {
    render(<InsertGap parentOccurrence={{ id: "occ-parent", moduleId: "m-parent" }} index={2} />);
    expect(mocks.qam.props).toBeTruthy();
    // This threw `ReferenceError: createLeafInstanceAtIndex is not defined` before the fix.
    mocks.qam.props.onSelect({ id: "mod-1" });
    expect(mocks.createLeafInstanceAtIndex).toHaveBeenCalledWith(expect.objectContaining({
      existingModuleId: "mod-1",
      index: 2,
      parentOccurrence: expect.objectContaining({ id: "occ-parent" }),
    }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix client run test -- src/__tests__/insertGap.test.jsx`
Expected: FAIL with `ReferenceError: createLeafInstanceAtIndex is not defined` (thrown from `insertExisting`).

- [ ] **Step 3: Fix the import**

In `client/src/ui/InsertGap.jsx`, change line 16:

```js
import { createChildInContainer } from "../helpers/CommitHelpers";
```

to:

```js
import { createChildInContainer, createLeafInstanceAtIndex } from "../helpers/CommitHelpers";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix client run test -- src/__tests__/insertGap.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 5: Update `client/src/ui/CLAUDE.md`** — add a Recent Changes entry noting the regression fix (the existing-module pick path in InsertGap crashed since the 2026-07-01 `createChildInContainer` refactor dropped the import) and that it now has test coverage.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/InsertGap.jsx client/src/__tests__/insertGap.test.jsx client/src/ui/CLAUDE.md
git commit -m "fix(insert-gap): import createLeafInstanceAtIndex — picking an existing module crashed"
```

---

### Task 2: Gate all drop-path debug logging behind `__dragDiag` / `__dragPerf`

**Files:**
- Modify: `client/src/helpers/DragProvider.jsx:797-909` (handleDrop stopwatch + render diff)
- Modify: `client/src/ui/Editor.jsx:1312` (`bail`), `client/src/ui/Editor.jsx:1436` (`DLOG`)

**Interfaces:**
- Consumes: existing globals `window.__dragPerf` (timing) and `window.__dragDiag` (behavior tracing) — same flags dragPerf.js and the existing `[dragDiag]` logs already use.
- Produces: zero console output on drops/dragovers unless a flag is set.

- [ ] **Step 1: Gate the DragProvider drop stopwatch**

In `client/src/helpers/DragProvider.jsx`, `handleDrop` currently opens with:

```js
    const _dropT0 = performance.now();
    const _lap = (label) => console.log(`[drop] +${Math.round(performance.now() - _dropT0)}ms ${label}`);
    const _renders0 = snapshotRenders();
    _lap("handleDrop entry");
```

Replace with:

```js
    const _diag = typeof window !== "undefined" && window.__dragPerf === true;
    const _dropT0 = _diag ? performance.now() : 0;
    const _lap = _diag
      ? (label) => console.log(`[drop] +${Math.round(performance.now() - _dropT0)}ms ${label}`)
      : () => {};
    const _renders0 = _diag ? snapshotRenders() : null;
    _lap("handleDrop entry");
```

And wrap the trailing paint-measure block (the `requestAnimationFrame` pair ending with the `[drop-renders]` log) in the same flag:

```js
    if (_diag) {
      requestAnimationFrame(() => {
        _lap("rAF #1 (pre-paint of next frame)");
        requestAnimationFrame(() => {
          _lap("rAF #2 (next frame painted)");
          const d = diffRenders(_renders0);
          console.log(`[drop-renders] panel=${d.panel} container=${d.container} instance=${d.instance} page=${d.page} field=${d.field || 0}`);
        });
      });
    }
```

- [ ] **Step 2: Gate Editor's `bail` and `DLOG`**

In `client/src/ui/Editor.jsx` line ~1312, change:

```js
    const bail = (why, extra) => { console.log("[detectSideHost] null —", why, extra || ""); return null; };
```

to:

```js
    const bail = (why, extra) => {
      if (typeof window !== "undefined" && window.__dragDiag === true) console.log("[detectSideHost] null —", why, extra || "");
      return null;
    };
```

In `client/src/ui/Editor.jsx` line ~1436, change:

```js
        const DLOG = (...a) => console.log(`[DROP ed=${occurrence?.id || "?"}]`, ...a);
```

to:

```js
        const DLOG = (...a) => {
          if (typeof window !== "undefined" && window.__dragDiag === true) console.log(`[DROP ed=${occurrence?.id || "?"}]`, ...a);
        };
```

(The 21 `DLOG(...)` call sites stay — they're now free when the flag is off.)

- [ ] **Step 3: Verify no ungated hot-path logs remain**

Run:
```bash
grep -n "console.log" client/src/helpers/DragProvider.jsx client/src/ui/Editor.jsx | grep -v "__dragDiag\|__dragPerf\|window.__"
```
Expected: no lines from `handleDrop`, `detectSideHost`, or `handleDocDrop` (other matches, if any, must be inside already-gated blocks — inspect each survivor).

- [ ] **Step 4: Run the client suite + build**

Run: `npm --prefix client run test` → all pass.
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 5: Update `client/src/helpers/CLAUDE.md` + `client/src/ui/CLAUDE.md`** with a one-entry note (drop stopwatch + DLOG + detectSideHost bail now behind `__dragPerf`/`__dragDiag`).

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/DragProvider.jsx client/src/ui/Editor.jsx client/src/helpers/CLAUDE.md client/src/ui/CLAUDE.md
git commit -m "perf(dnd): gate drop stopwatch + doc-drop DLOG + detectSideHost bail logs behind __dragPerf/__dragDiag"
```

---

### Task 3: RadialMenu cleanup — dead add props, unused import, key collisions

**Files:**
- Modify: `client/src/ui/RadialMenu.jsx:29,35-37,361,466`
- Modify: `client/src/modules/ModulePanel.jsx:788-794`, `client/src/modules/ModuleContainer.jsx:912-913,975-976,1085-1086`, `client/src/modules/ModuleInstance.jsx:574` (remove now-dead prop passing)
- Test: existing `client/src/__tests__/RadialMenu.test.js` must stay green

**Interfaces:**
- Consumes: nothing new.
- Produces: `RadialMenu` no longer accepts `onAddChild`/`addLabel` (they were never rendered — no default item used them, so no behavior is lost). Adding items is exclusively QuickAddMenu (+ buttons) and the long-press/right-click "Add item…" row.

- [ ] **Step 1: Remove the dead props from RadialMenu**

In `client/src/ui/RadialMenu.jsx`:
- Delete lines 36–37 (`onAddChild,` and `addLabel = "Item",`) from the props destructuring.
- In the `menuItems` `useMemo` dep array (line 361) remove `addLabel` and `onAddChild`.
- In the imports (line 29) remove `Plus` (verify first: `grep -n "Plus" client/src/ui/RadialMenu.jsx` — the only hit should be the import).

- [ ] **Step 2: Fix key collisions**

In the portal render (line ~466), change:

```js
              <button
                key={item.label}
```

to:

```js
              <button
                key={`${item.label}-${index}`}
```

- [ ] **Step 3: Remove the dead prop passing at the call sites**

- `client/src/modules/ModulePanel.jsx:788-794` — delete the `onAddChild={(e) => { … }}` block and the `addLabel="Container"` line from that `<RadialMenu …>`.
- `client/src/modules/ModuleContainer.jsx` — delete `onAddChild={onAdd}` + `addLabel="Item"` at all three sites (912-913, 975-976, 1085-1086). If `onAdd` becomes unused in that component after this, leave it (it's also used by QuickAddMenu wiring) — verify with `grep -n "onAdd" client/src/modules/ModuleContainer.jsx`.
- `client/src/modules/ModuleInstance.jsx:574` — delete `addLabel="Item"` (and any adjacent `onAddChild=` if present at that site).

- [ ] **Step 4: Run tests + build**

Run: `npm --prefix client run test -- src/__tests__/RadialMenu.test.js` → PASS.
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 5: Update `client/src/ui/CLAUDE.md`** (RadialMenu: dead add-props removed — QuickAddMenu is the sole add affordance; keys de-duped).

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/RadialMenu.jsx client/src/modules/ModulePanel.jsx client/src/modules/ModuleContainer.jsx client/src/modules/ModuleInstance.jsx client/src/ui/CLAUDE.md
git commit -m "fix(radial-menu): drop dead onAddChild/addLabel props, unused Plus import, de-dupe item keys"
```

---

### Task 4: ContextMenu — scroll on overflow, flexible width

**Files:**
- Modify: `client/src/ui/ContextMenu.jsx:41-63`

**Interfaces:**
- Consumes: existing `ctx={x, y, items}` API — unchanged.
- Produces: menus that never exceed 70vh (scroll instead) and size to their labels between 168–240px.

- [ ] **Step 1: Implement**

In `client/src/ui/ContextMenu.jsx`, replace lines 41–45:

```js
  // Keep menu inside viewport
  const W = 168;
  const approxH = ctx.items.length * 30 + 8;
  const x = Math.min(ctx.x, window.innerWidth - W - 6);
  const y = Math.min(ctx.y, window.innerHeight - approxH - 6);
```

with:

```js
  // Keep menu inside viewport. Width is content-sized within [168, 240];
  // height caps at 70vh with internal scroll (bulk multi-select menus were
  // overflowing small screens).
  const MAX_W = 240;
  const approxH = Math.min(ctx.items.length * 30 + 8, window.innerHeight * 0.7);
  const x = Math.min(ctx.x, window.innerWidth - MAX_W - 6);
  const y = Math.min(ctx.y, window.innerHeight - approxH - 6);
```

and in the portal `style` object replace `width: W,` with:

```js
        width: "max-content",
        minWidth: 168,
        maxWidth: MAX_W,
        maxHeight: "70vh",
        overflowY: "auto",
```

- [ ] **Step 2: Run tests + build**

Run: `npm --prefix client run test` → all pass (ContextMenu has no dedicated suite; the full run guards against import breakage).
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 3: Update `client/src/ui/CLAUDE.md`**, then commit:

```bash
git add client/src/ui/ContextMenu.jsx client/src/ui/CLAUDE.md
git commit -m "fix(context-menu): cap height at 70vh with scroll + content-sized width (168-240px)"
```

---

### Task 5: QuickAddMenu — flip above the anchor when it would overflow the bottom

**Files:**
- Modify: `client/src/ui/QuickAddMenu.jsx:85-90` (`reposition`)
- Test: `client/src/__tests__/quickAddMenu.test.js` (append a describe block)

**Interfaces:**
- Produces: exported pure helper `menuPosition(rect, vw, vh, { width = 260, height = 360 }) → { top, left }` in `client/src/ui/QuickAddMenu.jsx` (exported for tests; `reposition` consumes it).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/__tests__/quickAddMenu.test.js`:

```js
import { menuPosition } from "../ui/QuickAddMenu.jsx";

describe("menuPosition (anchor-relative placement)", () => {
  it("opens below the anchor by default", () => {
    const rect = { top: 100, bottom: 120, left: 50 };
    expect(menuPosition(rect, 1280, 800)).toEqual({ top: 122, left: 50 });
  });
  it("clamps left so the 260px menu stays on-screen", () => {
    const rect = { top: 100, bottom: 120, left: 1200 };
    expect(menuPosition(rect, 1280, 800).left).toBe(1280 - 260 - 8);
  });
  it("flips ABOVE the anchor when the menu would overflow the bottom", () => {
    const rect = { top: 700, bottom: 720, left: 50 };
    const pos = menuPosition(rect, 1280, 780);
    expect(pos.top).toBe(700 - 2 - 360);
  });
  it("never goes above the top edge when flipping", () => {
    const rect = { top: 40, bottom: 60, left: 50 };
    const pos = menuPosition(rect, 400, 300); // too small either way
    expect(pos.top).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix client run test -- src/__tests__/quickAddMenu.test.js`
Expected: FAIL — `menuPosition` is not exported.

- [ ] **Step 3: Implement**

In `client/src/ui/QuickAddMenu.jsx`, add above the component (module scope):

```js
// Anchor-relative menu placement. Opens below the anchor; flips above when the
// menu would overflow the viewport bottom (phone + on-screen keyboard). Pure —
// unit-tested in __tests__/quickAddMenu.test.js.
export function menuPosition(rect, vw, vh, { width = 260, height = 360 } = {}) {
  const left = Math.max(0, Math.min(rect.left, vw - width - 8));
  let top = rect.bottom + 2;
  if (top + height > vh) top = Math.max(4, rect.top - 2 - height);
  return { top, left };
}
```

and rewrite `reposition` (lines 85–90) to:

```js
  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos(menuPosition(rect, window.innerWidth, window.innerHeight));
  }, []);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm --prefix client run test -- src/__tests__/quickAddMenu.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Update `client/src/ui/CLAUDE.md`**, then commit:

```bash
git add client/src/ui/QuickAddMenu.jsx client/src/__tests__/quickAddMenu.test.js client/src/ui/CLAUDE.md
git commit -m "fix(quick-add): flip menu above the anchor when it would overflow the viewport bottom"
```

---

### Task 6: Importer — stop emitting the dead `wrap`/`anchor` wrapGroup attrs

**Files:**
- Modify: `server/services/markdownImporter.js:239,256` (+ surrounding comments 225-253)
- Modify: `server/__tests__/markdownImporter.test.js` (tests at lines ~497 and ~575 whose names/assertions reference `wrap:false`)

**Interfaces:**
- Consumes: client behavior as-is — `WrapGroupNode.jsx` computes `wrap = neighborCount > 0` and never reads `node.attrs.wrap`; `anchor` is likewise unread (only `anchorIndex`/`anchorOffset` are).
- Produces: importer `wrapGroup` attrs become `{ side, anchorIndex, neighborWidth }`. **Deliberate compat exception:** `WrapGroupExtension.js` KEEPS its `wrap`/`anchor` attr definitions because persisted textmaps from old imports still carry them (removing the definition breaks `nodeFromJSON` for existing docs); re-import strips them naturally.

- [ ] **Step 1: Update the two emit sites**

In `server/services/markdownImporter.js` line 239, change:

```js
        attrs: { side: "right", anchor: "top", anchorIndex: 0, wrap: false, neighborWidth: 320 },
```

to:

```js
        attrs: { side: "right", anchorIndex: 0, neighborWidth: 320 },
```

Line 256, change:

```js
        attrs: { side: "right", anchor: "top", anchorIndex: 0, wrap: false, neighborWidth: 260 },
```

to:

```js
        attrs: { side: "right", anchorIndex: 0, neighborWidth: 260 },
```

Rewrite the stale comments above both sites (lines ~225-230 and ~251-253) — they still claim `wrap:false` means "plain side-by-side mode, no L-shape". Replace with (lead-aside site):

```js
  // Lead aside (main image stacked over the infobox) pairs with the FIRST prose
  // textblock in a `wrapGroup` — neighbor-first `[aside, firstTextblock]`,
  // `side:right`. The client always wraps when a neighbor exists (the real-float
  // L; WrapGroupNode ignores any legacy `wrap` attr), and the draggable seam
  // owns column width (neighborWidth is just the start).
```

and (section-image site):

```js
      // Section image(s) fold in front of the following prose textblock —
      // neighbor-first so the float wraps the host's prose (L-shape, reflows
      // natively). neighborWidth is the floated column's start width.
```

- [ ] **Step 2: Update the two tests**

Run `grep -n "wrap" server/__tests__/markdownImporter.test.js` and update:
- The test at ~497 (`"the lead aside (image over infobox) sits in a two-COLUMN wrapGroup beside the first textblock (wrap:false, no L-morph)"`): rename to `"the lead aside (image over infobox) pairs with the first textblock in a neighbor-first wrapGroup"`; delete any `expect(attrs.wrap).toBe(false)` / `expect(attrs.anchor).toBe("top")` assertions; assert `attrs.side === "right"`, `attrs.anchorIndex === 0`, `attrs.neighborWidth === 320`, and that `wrap`/`anchor` are absent: `expect(attrs).not.toHaveProperty("wrap")`.
- The test at ~575 (plain lead image, no infobox): same treatment with `neighborWidth: 260` where applicable.

- [ ] **Step 3: Run server tests**

Run: `npm --prefix server run test`
Expected: all pass (importer suite was 39 tests).

- [ ] **Step 4: Update `server/CLAUDE.md`** (importer no longer emits `wrap`/`anchor`; client always wraps when neighbors exist; extension keeps attr defs for persisted docs; server restart + re-import to apply).

- [ ] **Step 5: Commit**

```bash
git add server/services/markdownImporter.js server/__tests__/markdownImporter.test.js server/CLAUDE.md
git commit -m "fix(importer): stop emitting dead wrap/anchor wrapGroup attrs (client always wraps neighbors)"
```

---

### Task 7: Wrap — line-level (`anchorOffset`) wraps clip/classify the correct band

**Files:**
- Modify: `client/src/docs/wrapAnchor.js` (add two pure helpers)
- Modify: `client/src/docs/WrapGroupNode.jsx:143-154` (`measure` notchY + shape classification)
- Test: `client/src/__tests__/wrapAnchor.test.js` (append)

**Interfaces:**
- Produces (in `client/src/docs/wrapAnchor.js`):
  - `hasMidAnchor({ anchorIndex, anchorOffset }) → boolean` — true when the wrap anchors below the host top (line-level `anchorOffset > 0` wins; legacy `anchorIndex > 0` fallback).
  - `classifyWrapShape({ anchorIndex, anchorOffset, neighborBottom, hostBottom, threshold = 24 }) → "top" | "middle" | "bottom"`.
- Consumed by: `WrapGroupNode.measure` (Task step 3) — replaces its inline `anchorIdx`-only logic.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/__tests__/wrapAnchor.test.js`:

```js
import { hasMidAnchor, classifyWrapShape } from "../docs/wrapAnchor.js";

describe("hasMidAnchor", () => {
  it("top anchor: no offset, no index", () => {
    expect(hasMidAnchor({ anchorIndex: 0, anchorOffset: null })).toBe(false);
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 0 })).toBe(false);
  });
  it("line-level offset wins (anchorIndex null — the post-2026-06-17 shape)", () => {
    expect(hasMidAnchor({ anchorIndex: null, anchorOffset: 120 })).toBe(true);
  });
  it("anchorOffset 0 with a legacy anchorIndex set: offset is authoritative", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: 0 })).toBe(false);
  });
  it("legacy nodes: anchorIndex > 0, no offset", () => {
    expect(hasMidAnchor({ anchorIndex: 2, anchorOffset: null })).toBe(true);
  });
});

describe("classifyWrapShape", () => {
  const geo = { neighborBottom: 400, hostBottom: 900 };
  it("top: anchored at the very top", () => {
    expect(classifyWrapShape({ anchorIndex: 0, anchorOffset: null, ...geo })).toBe("top");
  });
  it("middle: line-level offset with prose below the neighbor", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, ...geo })).toBe("middle");
  });
  it("bottom: mid-anchored neighbor reaching the host bottom (within threshold)", () => {
    expect(classifyWrapShape({ anchorIndex: null, anchorOffset: 150, neighborBottom: 890, hostBottom: 900 })).toBe("bottom");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix client run test -- src/__tests__/wrapAnchor.test.js`
Expected: FAIL — `hasMidAnchor` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `client/src/docs/wrapAnchor.js`:

```js
// Whether the wrap anchors BELOW the host top (middle/bottom shape family).
// Line-level nodes carry `anchorOffset` (px — authoritative when present);
// legacy nodes only carry `anchorIndex` (host block index).
export function hasMidAnchor({ anchorIndex, anchorOffset }) {
  if (anchorOffset != null && Number.isFinite(Number(anchorOffset))) return Number(anchorOffset) > 0;
  return (Number(anchorIndex) || 0) > 0;
}

// Classify the measured wrap shape from the anchor + measured boxes:
//   top    — notch at the very top corner (prose beside + full width below)
//   middle — prose full-width ABOVE and BELOW the neighbor
//   bottom — neighbor reaches the host bottom (no prose below → upside-down L)
export function classifyWrapShape({ anchorIndex, anchorOffset, neighborBottom, hostBottom, threshold = 24 }) {
  if (!hasMidAnchor({ anchorIndex, anchorOffset })) return "top";
  return hostBottom - neighborBottom < threshold ? "bottom" : "middle";
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm --prefix client run test -- src/__tests__/wrapAnchor.test.js` → PASS.

- [ ] **Step 5: Consume them in `WrapGroupNode.measure`**

In `client/src/docs/WrapGroupNode.jsx`:
- Add to the import from wrapAnchor (there is no wrapAnchor import yet — add one): `import { hasMidAnchor, classifyWrapShape } from "./wrapAnchor";`
- Replace lines 143–154:

```js
      // L (anchorIndex 0): notch starts at the very top (0) so no bg/border strip is
      // left above the neighbor. C (anchorIndex > 0): notch sits at the neighbor's top.
      const anchorIdx = Number(node.attrs.anchorIndex) || 0;
      const notchY = anchorIdx > 0 ? Math.max(0, Math.round(top - c.top)) : 0;
      const notchH = Math.round(bottom - top);
      wrapEl.style.setProperty("--notch-w", `${Math.max(0, notchW)}px`);
      wrapEl.style.setProperty("--notch-y", `${Math.max(0, notchY)}px`);
      wrapEl.style.setProperty("--notch-h", `${Math.max(0, notchH)}px`);
      // Classify the shape from the measured boxes: `top` (notch at top), else `bottom`
      // when the neighbor reaches the host BOTTOM (no full-width prose below → upside-down
      // L), else `middle` (neighbor mid-column, prose above AND below).
      const reachesBottom = (c.bottom - bottom) < 24;
      setMeasuredShape(anchorIdx <= 0 ? "top" : (reachesBottom ? "bottom" : "middle"));
```

with:

```js
      // Top-anchored wraps cut from the very top (no bg strip above the neighbor);
      // mid-anchored ones (line-level anchorOffset OR legacy anchorIndex — see
      // wrapAnchor.hasMidAnchor) cut the band the neighbor actually floats in.
      const anchorAttrs = { anchorIndex: node.attrs.anchorIndex, anchorOffset: node.attrs.anchorOffset };
      const notchY = hasMidAnchor(anchorAttrs) ? Math.max(0, Math.round(top - c.top)) : 0;
      const notchH = Math.round(bottom - top);
      wrapEl.style.setProperty("--notch-w", `${Math.max(0, notchW)}px`);
      wrapEl.style.setProperty("--notch-y", `${Math.max(0, notchY)}px`);
      wrapEl.style.setProperty("--notch-h", `${Math.max(0, notchH)}px`);
      setMeasuredShape(classifyWrapShape({ ...anchorAttrs, neighborBottom: bottom, hostBottom: c.bottom }));
```

- [ ] **Step 6: Run the full client suite + build**

Run: `npm --prefix client run test` → all pass. `npm --prefix client run build` → exit 0.

- [ ] **Step 7: In-browser glance (required — ResizeObserver geometry isn't unit-testable)**

Using the local probe workflow (root-level playwright probe against the live grid — see memory `project_local_probe_workflow`): open the imported Eminem page, drag a section image onto a mid-paragraph line of its host (line-level middle wrap), screenshot, and confirm the host background/border clip band lines up with the floated neighbor (before this fix the clip cut the TOP band). Save the screenshot path in the commit message body.

- [ ] **Step 8: Update `client/src/docs/CLAUDE.md`**, then commit:

```bash
git add client/src/docs/wrapAnchor.js client/src/docs/WrapGroupNode.jsx client/src/__tests__/wrapAnchor.test.js client/src/docs/CLAUDE.md
git commit -m "fix(wrap): line-level (anchorOffset) wraps clip + classify the correct band, via pure wrapAnchor helpers"
```

---

### Task 8: Editor — rAF-throttle the dragover boundary/wrap-host math

**Files:**
- Modify: `client/src/ui/Editor.jsx:1379-1402` (the `onDragOver`/`onDragLeaveNative` block in the drop-target effect)

**Interfaces:**
- Consumes: existing `nearestDocBoundary`, `detectSideHost` (accepts any `{clientX, clientY}` object), `setDragGap`, `setWrapDrop`.
- Produces: same visual indicators, computed at most once per frame and only after ≥4px pointer movement.

- [ ] **Step 1: Implement**

In `client/src/ui/Editor.jsx`, replace the current block (lines ~1379-1400):

```js
    let lastNativeEvent = null;
    // Live drop indicator: on every dragover, resolve the nearest top-level block
    // boundary and surface a glowing line there so the user sees where the block
    // will land (was a blind guess → finicky). Mirrors the gap-hover math.
    const onDragOver = (e) => {
      lastNativeEvent = e;
      if (!editor?.view) return;
      const b = nearestDocBoundary(editor.view, editor.state.doc, el, e.clientY);
      setDragGap((prev) => (b && prev && prev.pos === b.pos ? prev : b));
      const sh = detectSideHost(e);
      if (sh && sh.anchorOffset != null) {
        const pm = el.querySelector(".ProseMirror");
        const proseTop = pm ? pm.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
        setWrapDrop({ top: Math.round(proseTop + sh.anchorOffset), side: sh.side });
      } else {
        setWrapDrop(null);
      }
    };
    const onDragLeaveNative = (e) => {
      // Only clear when the drag actually left the editor (not entering a child).
      if (!el.contains(e.relatedTarget)) { setDragGap(null); setWrapDrop(null); }
    };
```

with:

```js
    let lastNativeEvent = null;
    // Live drop indicator math (nearestDocBoundary + detectSideHost → offsetFor,
    // which getClientRects()-walks EVERY block of the hovered host) is throttled
    // to one rAF per frame and skipped while the pointer sits still (<4px) — on
    // long imported articles the per-dragover version was the doc-drag jank.
    let dragOverRaf = 0;
    let lastGapX = -Infinity, lastGapY = -Infinity;
    const onDragOver = (e) => {
      lastNativeEvent = e;
      if (!editor?.view) return;
      const x = e.clientX, y = e.clientY;
      const dx = x - lastGapX, dy = y - lastGapY;
      if (dragOverRaf || dx * dx + dy * dy < 16) return;
      dragOverRaf = requestAnimationFrame(() => {
        dragOverRaf = 0;
        lastGapX = x; lastGapY = y;
        const b = nearestDocBoundary(editor.view, editor.state.doc, el, y);
        setDragGap((prev) => (b && prev && prev.pos === b.pos ? prev : b));
        const sh = detectSideHost({ clientX: x, clientY: y });
        if (sh && sh.anchorOffset != null) {
          const pm = el.querySelector(".ProseMirror");
          const proseTop = pm ? pm.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
          setWrapDrop({ top: Math.round(proseTop + sh.anchorOffset), side: sh.side });
        } else {
          setWrapDrop(null);
        }
      });
    };
    const onDragLeaveNative = (e) => {
      // Only clear when the drag actually left the editor (not entering a child).
      if (!el.contains(e.relatedTarget)) {
        if (dragOverRaf) { cancelAnimationFrame(dragOverRaf); dragOverRaf = 0; }
        setDragGap(null);
        setWrapDrop(null);
      }
    };
```

and in the effect's cleanup function (line ~1691), add before `el.removeEventListener("dragover", onDragOver);`:

```js
      if (dragOverRaf) cancelAnimationFrame(dragOverRaf);
```

- [ ] **Step 2: Run tests + build**

Run: `npm --prefix client run test` → pass. `npm --prefix client run build` → exit 0.

- [ ] **Step 3: In-browser glance** — drag an image over an imported article: the per-line wrap highlight and the block-boundary gap line must still track the pointer (one-frame latency is expected and fine); drops must land where the line showed.

- [ ] **Step 4: Update `client/src/ui/CLAUDE.md`**, then commit:

```bash
git add client/src/ui/Editor.jsx client/src/ui/CLAUDE.md
git commit -m "perf(editor): rAF-throttle dragover boundary + wrap-host math (getClientRects walk was per-event)"
```

---

### Task 9: Extract + cache the container member-card scan (DragProvider ↔ dragHitTesting DRY)

**Files:**
- Modify: `client/src/helpers/dragHitTesting.js` (new export `collectMemberCards`; `computeInsertIndexFromPointer` consumes it)
- Modify: `client/src/helpers/DragProvider.jsx:113-167` (`showDropIndicators` consumes a cached variant)
- Test: `client/src/__tests__/dragHitTesting.test.js` (append)

**Interfaces:**
- Produces (in `client/src/helpers/dragHitTesting.js`): `collectMemberCards(containerEl) → Element[]` — the direct member cards (leaf `.instance-wrap` rows + nested `[data-container-id]` shells whose owning container is `containerEl`). Pure DOM read, jsdom-testable.
- Consumed by: `computeInsertIndexFromPointer` (same file) and `DragProvider.showDropIndicators` (via a 150ms module-level cache).

- [ ] **Step 1: Write the failing test**

Append to `client/src/__tests__/dragHitTesting.test.js`:

```js
import { collectMemberCards } from "../helpers/dragHitTesting.js";

describe("collectMemberCards", () => {
  it("returns direct leaf rows and nested container shells, not grandchildren", () => {
    document.body.innerHTML = `
      <div id="outer" data-container-id="outer">
        <div class="instance-wrap" id="leaf1"></div>
        <div>
          <div data-container-id="nested" id="nestedShell">
            <div class="instance-wrap" id="grandchildLeaf"></div>
          </div>
        </div>
      </div>`;
    const outer = document.getElementById("outer");
    const ids = collectMemberCards(outer).map((el) => el.id);
    expect(ids).toContain("leaf1");
    expect(ids).toContain("nestedShell");
    expect(ids).not.toContain("grandchildLeaf"); // owned by the nested shell
    expect(ids).not.toContain("outer");
  });
  it("returns [] for a null container", () => {
    expect(collectMemberCards(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix client run test -- src/__tests__/dragHitTesting.test.js`
Expected: FAIL — `collectMemberCards` not exported.

- [ ] **Step 3: Implement in dragHitTesting.js**

Add above `computeInsertIndexFromPointer`:

```js
// ------------------------------------------------------------
// collectMemberCards
// ------------------------------------------------------------
// The direct member cards of a container element: leaf rows (.instance-wrap)
// AND nested container shells. A shell carries [data-container-id] itself, so
// its owner is the nearest such ancestor ABOVE it. Shared by the drop-indicator
// renderer (DragProvider) and the pointer→index resolver below — one scan
// definition, two consumers.
export function collectMemberCards(containerEl) {
  if (!containerEl) return [];
  return Array.from(containerEl.querySelectorAll(".instance-wrap, [data-container-id]")).filter((el) => {
    if (el === containerEl) return false;
    const owner = el.classList.contains("instance-wrap")
      ? el.closest("[data-container-id]")
      : el.parentElement?.closest?.("[data-container-id]");
    return owner === containerEl;
  });
}
```

In `computeInsertIndexFromPointer` (same file), replace its inline `const cards = Array.from(containerEl.querySelectorAll(...)).filter(...)` block (lines ~215-221) with:

```js
  const cards = collectMemberCards(containerEl);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm --prefix client run test -- src/__tests__/dragHitTesting.test.js` → PASS (existing + 2 new).

- [ ] **Step 5: Consume with a cache in DragProvider**

In `client/src/helpers/DragProvider.jsx`:
- Add `collectMemberCards` to the existing import from `./dragHitTesting` (line 34).
- Add at module scope (below `hideDropIndicators`):

```js
// Per-frame member-card scan cache: while the drop-area box stays on the same
// container, reuse the card list for 150ms instead of re-running
// querySelectorAll + a closest() walk per rAF tick (rects are still read fresh
// each frame — only the LIST is cached; a drop mid-cache re-resolves via
// computeInsertIndexFromPointer at drop time, so staleness can't misplace a drop).
const _cardScan = { el: null, cards: null, at: 0 };
function memberCardsCached(containerEl) {
  const now = performance.now();
  if (_cardScan.el === containerEl && _cardScan.cards && now - _cardScan.at < 150) return _cardScan.cards;
  const cards = collectMemberCards(containerEl);
  _cardScan.el = containerEl;
  _cardScan.cards = cards;
  _cardScan.at = now;
  return cards;
}
```

- In `showDropIndicators`, replace the inline scan (lines ~132-139):

```js
  const cards = Array.from(containerEl.querySelectorAll(".instance-wrap, [data-container-id]"))
    .filter((c) => {
      if (c === containerEl) return false;
      const owner = c.classList.contains("instance-wrap")
        ? c.closest("[data-container-id]")
        : c.parentElement?.closest?.("[data-container-id]");
      return owner === containerEl;
    });
```

with:

```js
  const cards = memberCardsCached(containerEl);
```

- In `hideDropIndicators`, append cache invalidation so a new drag starts fresh:

```js
  _cardScan.el = null;
  _cardScan.cards = null;
```

- [ ] **Step 6: Run the client suite + build**

Run: `npm --prefix client run test` → pass. `npm --prefix client run build` → exit 0.

- [ ] **Step 7: Update `client/src/helpers/CLAUDE.md`**, then commit:

```bash
git add client/src/helpers/dragHitTesting.js client/src/helpers/DragProvider.jsx client/src/__tests__/dragHitTesting.test.js client/src/helpers/CLAUDE.md
git commit -m "perf(dnd): share + cache the container member-card scan (drop indicators / insert-index DRY)"
```

---

### Task 10: dragSystem — live-ref payloads (kill JSON.stringify deps + re-registration churn)

**Files:**
- Modify: `client/src/helpers/dragSystem.js:407-547` (`useDroppable`), `client/src/helpers/dragSystem.js:552-1038` (`useDragDrop`), `client/src/helpers/dragSystem.js:382-401` (`_findDropTarget` registry read)
- Test: `client/src/__tests__/dragSystemRegistration.test.jsx` (new)

**Interfaces:**
- Consumes: unchanged public hook APIs — `useDroppable({ type, id, context, accepts, disabled })`, `useDragDrop({ type, id, data, context, disabled, nativeEnabled, accepts, allowedEdges, dragHandleRef })`. No call-site changes anywhere.
- Produces: registration effects keyed ONLY on `[type, id, disabled(, nativeEnabled), acceptsKey, edgesKey, dragCtx, handleNode]` where `acceptsKey = accepts.join("|")` and `edgesKey = (allowedEdges || []).join("|")`. `data`/`context` live in refs read at event time. Touch-registry entries carry `contextRef`/`acceptsRef` (live) instead of frozen `context`/`accepts`.

**Why:** `ModuleInstance.jsx:944` passes `data: { ...module, occurrence }` and `ModuleContainer.jsx:566` passes `data: { ...containerWithInstances, … }`. `occurrence` includes `fields` and (for textblocks) full TipTap `textmap` — imported articles carry multi-KB textmaps. Today's deps `JSON.stringify(data)` mean (a) every render of every one of ~580 mounted instances/containers stringifies that, and (b) every occurrence write (including the whole post-drop op cascade) tears down and re-registers Pragmatic adapters + touch listeners. This is the single biggest remaining "instant drag" lever.

- [ ] **Step 1: Write the failing tests**

Create `client/src/__tests__/dragSystemRegistration.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const adapters = vi.hoisted(() => ({
  draggable: vi.fn(() => () => {}),
  dropTargetForElements: vi.fn(() => () => {}),
  dropTargetForExternal: vi.fn(() => () => {}),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: adapters.draggable,
  dropTargetForElements: adapters.dropTargetForElements,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/external/adapter", () => ({
  dropTargetForExternal: adapters.dropTargetForExternal,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: (...fns) => () => fns.forEach((f) => typeof f === "function" && f()),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-auto-scroll/element", () => ({
  autoScrollForElements: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview", () => ({
  setCustomNativeDragPreview: vi.fn(),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: (d) => d,
  extractClosestEdge: () => null,
}));

beforeAll(() => {
  // jsdom has no matchMedia; force the DESKTOP path (_isTouch → false).
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

import { useDragDrop, useDroppable } from "../helpers/dragSystem.js";

function DragProbe({ data, context, accepts = ["instance"] }) {
  // `accepts` gets a NEW array identity every render on purpose — the
  // stringified key must keep it registration-stable.
  const { ref } = useDragDrop({
    type: "instance", id: "m1", data, context, accepts,
  });
  return <div ref={ref} />;
}
function DropProbe({ context }) {
  const { ref } = useDroppable({ type: "container-list", id: "c1", context, accepts: ["instance"] });
  return <div ref={ref} />;
}

describe("dragSystem registration stability", () => {
  it("useDragDrop does NOT re-register when data/context identity changes", () => {
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{ containerId: "c1" }} />);
    const before = adapters.draggable.mock.calls.length;
    rerender(<DragProbe data={{ label: "b", big: { fields: { x: 1 } } }} context={{ containerId: "c1", panelId: "p" }} />);
    rerender(<DragProbe data={{ label: "c" }} context={{ containerId: "c2" }} />);
    expect(adapters.draggable.mock.calls.length).toBe(before);
  });

  it("getInitialData reads the LATEST data/context at drag time", () => {
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{ containerId: "c1" }} />);
    rerender(<DragProbe data={{ label: "b" }} context={{ containerId: "c9" }} />);
    const cfg = adapters.draggable.mock.calls.at(-1)[0];
    const payload = cfg.getInitialData();
    expect(payload.data.label).toBe("b");
    expect(payload.context.containerId).toBe("c9");
  });

  it("useDragDrop DOES re-register when accepts actually change", () => {
    // Same component type (no remount) — only the accepts CONTENT changes.
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{}} />);
    const before = adapters.draggable.mock.calls.length;
    rerender(<DragProbe data={{ label: "a" }} context={{}} accepts={["instance", "module"]} />);
    expect(adapters.draggable.mock.calls.length).toBeGreaterThan(before);
  });

  it("useDroppable does NOT re-register on context identity churn, and getData reads the latest context", () => {
    const { rerender } = render(<DropProbe context={{ containerId: "c1" }} />);
    const before = adapters.dropTargetForElements.mock.calls.length;
    rerender(<DropProbe context={{ containerId: "c1", extra: 1 }} />);
    expect(adapters.dropTargetForElements.mock.calls.length).toBe(before);
    const cfg = adapters.dropTargetForElements.mock.calls.at(-1)[0];
    expect(cfg.getData().context.extra).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix client run test -- src/__tests__/dragSystemRegistration.test.jsx`
Expected: the two "does NOT re-register" tests FAIL (registration count grows — today's stringified deps change), the others may pass.

- [ ] **Step 3: Rewrite `useDroppable` to live refs**

In `client/src/helpers/dragSystem.js`, inside `useDroppable`:

Add after `stateRef`:

```js
  // Live refs — every handler reads these at EVENT time, so context/accepts
  // identity churn never tears down + re-registers the Pragmatic targets.
  const contextRef = useRef(context);
  contextRef.current = context;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const acceptsKey = accepts.join("|");
```

Then in the effect:
- Registration: `_registerDrop(el, { type, id, contextRef, acceptsRef, allowedEdges: null, stateRef });`
- `canAccept`: read `const list = acceptsRef.current;` instead of the closed-over `accepts` (same for `canAcceptExternal`).
- Every `context` read becomes `contextRef.current`: `getData: () => ({ type, id, context: contextRef.current })`, both `onDrag` handlers (`dragCtx.handleDragOver?.({ type, id, context: contextRef.current, clientX, clientY })`), both `onDragLeave` handlers (`if (contextRef.current.containerId) dragCtx.handleDragOver?.({ type, id, context: { ...contextRef.current, containerId: null } });`), both `onDrop` handlers (`context: contextRef.current`).
- Dep array (line 536): `[type, id, acceptsKey, disabled, dragCtx]` (the two `JSON.stringify` entries deleted).

- [ ] **Step 4: Rewrite `useDragDrop` to live refs**

Inside `useDragDrop`:

Add after `stateRef` (line ~573):

```js
  // Live refs (see useDroppable) — data can be KB-scale ({ ...module, occurrence }
  // with fields/textmap), so neither stringify-diffing it per render nor
  // re-registering listeners on every occurrence write is acceptable.
  const dataRef = useRef(data);
  dataRef.current = data;
  const contextRef = useRef(context);
  contextRef.current = context;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const edgesRef = useRef(allowedEdges);
  edgesRef.current = allowedEdges;
  const acceptsKey = accepts.join("|");
  const edgesKey = (allowedEdges || []).join("|");
```

In the effect:
- Delete `const payload = createPayload(type, id, data, context);` and add:

```js
    const buildPayload = () => createPayload(type, id, dataRef.current, contextRef.current);
```

- `canAccept`/`canAcceptExternal`: read `acceptsRef.current`.
- Registration: `_registerDrop(el, { type, id, contextRef, acceptsRef, edgesRef, stateRef });`
- **Touch branch:** declare `let payload = null;` next to `let clone = null;`. At the threshold-cross block in `onMove` (where `dragging = true` is set), build it:

```js
          payload = buildPayload();
          const liveData = dataRef.current;
          clone = _createDragPill(liveData?.label || liveData?.name || type, type);
          // …
          const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
```

  (`_findDropTarget(t.clientX, t.clientY, payload.type, el)` and `dragCtx.handleDrop({ …, source: payload })` keep using the captured `payload`.) In `onEnd`, after `dragging = false`, add `payload = null;`. Where the touch handlers read the TARGET's context (`curTarget.context` in `onMove`'s `handleDragOver` call and `onEnd`'s `handleDrop`), switch to:

```js
          const targetContext = curTarget.contextRef.current;
```

(Both hooks register `contextRef` in this same task, so read it directly — no `|| curTarget.context` fallback; the registry is private to this file.)

- **Desktop branch:** `getInitialData: () => buildPayload()`; `getInitialDataForExternal` reads `const data = dataRef.current;`; `onGenerateDragPreview` label/mode read `dataRef.current`; `onDragStart` mode reads `dataRef.current`; each drop-target `getData` becomes:

```js
        getData: ({ input, element }) => {
          const d = { type, id, context: contextRef.current, instanceId: id };
          return attachClosestEdge(d, { input, element, allowedEdges: edgesRef.current });
        },
```

  and every `context` in `onDrag`/`onDrop` handlers becomes `contextRef.current` (e.g. `context: { ...contextRef.current, instanceId: id, closestEdge: edge }`).
- Dep array (line 1022) becomes: `[type, id, disabled, nativeEnabled, acceptsKey, edgesKey, dragCtx, handleNode]`.

- [ ] **Step 5: Update `_findDropTarget` + `_computeClosestEdge` consumers for the live registry shape**

In `_findDropTarget` (line ~393), the accepts check becomes:

```js
      if (config) {
        const accepts = config.acceptsRef.current;
        if (accepts.length === 0 || accepts.includes(dragType)) {
          return { el: node, ...config };
        }
      }
```

Touch `onMove`'s edge block reads `const edges = curTarget.edgesRef?.current;` and gates on `edges` instead of `curTarget.allowedEdges` (`onEnd`'s edge read the same) before calling `_computeClosestEdge`. The optional chain is a shape difference, not a fallback: `useDroppable` entries register no `edgesRef` (they have no closest-edge behavior), `useDragDrop` entries always do.

- [ ] **Step 6: Run the new tests + the full client suite**

Run: `npm --prefix client run test -- src/__tests__/dragSystemRegistration.test.jsx` → PASS (4 tests).
Run: `npm --prefix client run test` → all pass (DragProvider.test.js, dragHitTesting.test.js, mobile suites especially).
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 7: In-browser verification (desktop + tablet emulation, local probe workflow)**

- Desktop: drag instance→container (move/copy/copylink via radial toggle), container→panel, panel→cell, page→panel, external text drop. All land as before; native ghost shows label+verb.
- Touch (playwright iPhone-13 + 1280×800 touch tablet emulation, per the 2026-07-04 session's method): long-press-drag an instance between containers; drop into a doc editor (wrap-beside must still work — the touch payload is now built at threshold-cross); check `[dragPerf]` summary shows fps ≈ 60 and lower `onMove_avgMs` than the pre-change baseline (capture baseline BEFORE starting Step 3 by running the same probe on the unmodified build; record both numbers in the commit body).
- Regression focus: edit a field while hovering mid-drag (occurrence write during drag) — the drop must still resolve with the fresh data.

- [ ] **Step 8: Update `client/src/helpers/CLAUDE.md`**, then commit:

```bash
git add client/src/helpers/dragSystem.js client/src/__tests__/dragSystemRegistration.test.jsx client/src/helpers/CLAUDE.md
git commit -m "perf(dnd): live-ref drag payloads — no JSON.stringify deps, no re-registration on occurrence writes"
```

---

### Task 11: MobileGridNav — stop re-resolving the scrollable ancestor per touchmove

**Files:**
- Modify: `client/src/mobile/MobileGridNav.jsx:155-305`
- Test: existing `client/src/__tests__/MobileGridNav.test.jsx` must stay green

**Interfaces:**
- Consumes/produces: no API change. `findScrollableAncestor` now runs once per touch gesture (plus once after any visualViewport resize), not per move.

- [ ] **Step 1: Implement**

In `client/src/mobile/MobileGridNav.jsx`:
- In `onTouchStart`, add `scrollEl: undefined,` to the `touchRef.current = { … }` object.
- In `onTouchMove`, replace:

```js
      // Re-find scrollable ancestor each move — keyboard show/hide changes dimensions
      const scrollEl = findScrollableAncestor(t.touchTarget || e.target, viewport);
```

with:

```js
      // Resolve the scrollable ancestor ONCE per gesture (getComputedStyle walk
      // — too hot for every touchmove). Keyboard show/hide correctness is kept
      // by the visualViewport resize handler below, which resets the touch
      // state (including this cache) when dimensions change.
      if (t.scrollEl === undefined) t.scrollEl = findScrollableAncestor(t.touchTarget || e.target, viewport);
      const scrollEl = t.scrollEl;
```

- In `onTouchEnd` and `onResize`, add `scrollEl: undefined,` to both reset objects.

- [ ] **Step 2: Run tests + build**

Run: `npm --prefix client run test -- src/__tests__/MobileGridNav.test.jsx` (and `src/__tests__/MobileGridNav.test.js`) → PASS.
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 3: Device check** — on the tablet/phone emulation probe: normal scrolling inside a cell still works; overscroll-past-boundary still navigates cells; opening the keyboard (focus an input) then swiping still behaves (the resize reset re-resolves).

- [ ] **Step 4: Update `client/src/CLAUDE.md`** (there is no mobile/CLAUDE.md — the mobile pager notes live in client/src/CLAUDE.md), then commit:

```bash
git add client/src/mobile/MobileGridNav.jsx client/src/CLAUDE.md
git commit -m "perf(mobile): resolve the overscroll scrollable ancestor once per gesture, not per touchmove"
```

---

### Task 12: Touch drag pill shows the action verb (parity with the desktop ghost)

**Files:**
- Modify: `client/src/helpers/dragSystem.js:46-68` (`_createDragPill`) and its call site in the touch `onMove` threshold-cross block

**Interfaces:**
- Produces: `_createDragPill(label, mode)` — second arg is now the drag mode (`"move" | "copy" | "copylink"`), rendered as a small sub-line (Move / Copy / Copy-link), mirroring `attachDragPreview`'s desktop card.

- [ ] **Step 1: Implement**

Replace `_createDragPill` (lines 46-68):

```js
// Create a small pill element for mobile drag ghost — label on top, the action
// verb (Move / Copy / Copy-link) underneath, mirroring the desktop native ghost.
function _createDragPill(label, mode) {
  const pill = document.createElement('div');
  Object.assign(pill.style, {
    position: 'fixed', left: '0', top: '0',
    maxWidth: '140px',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, monospace)',
    color: '#fff',
    background: 'rgba(30,60,90,0.92)',
    border: '1px solid rgba(100,160,255,0.4)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex: '2147483646',
    willChange: 'transform',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  });
  const title = document.createElement('div');
  title.textContent = label || 'item';
  Object.assign(title.style, { overflow: 'hidden', textOverflow: 'ellipsis' });
  const action = document.createElement('div');
  action.textContent = mode === 'copy' ? 'Copy' : mode === 'copylink' ? 'Copy-link' : 'Move';
  Object.assign(action.style, { fontSize: '9px', opacity: '0.7', letterSpacing: '0.02em' });
  pill.appendChild(title);
  pill.appendChild(action);
  return pill;
}
```

At the touch threshold-cross call site (post-Task-10 shape), reorder so `mode` is computed BEFORE the clone and passed in:

```js
          payload = buildPayload();
          const liveData = dataRef.current;
          const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
          clone = _createDragPill(liveData?.label || liveData?.name || type, mode);
          clone.style.transform = `translate3d(${t.clientX - offsetX}px, ${t.clientY - offsetY}px, 0)`;
          document.body.appendChild(clone);
          // …
          dragCtx.handleDragStart(payload, startX, startY, { mode });
```

- [ ] **Step 2: Run tests + build**

Run: `npm --prefix client run test` → pass. `npm --prefix client run build` → exit 0.

- [ ] **Step 3: Device glance** — touch-drag a copy-mode item: pill reads label + "Copy".

- [ ] **Step 4: Update `client/src/helpers/CLAUDE.md`**, then commit:

```bash
git add client/src/helpers/dragSystem.js client/src/helpers/CLAUDE.md
git commit -m "feat(touch-drag): pill shows the action verb (Move/Copy/Copy-link) like the desktop ghost"
```

---

### Task 13: Mouse drags on touch-primary devices (tablet + mouse/trackpad)

**Files:**
- Modify: `client/src/helpers/dragSystem.js` touch branch of `useDragDrop` (line ~614)

**Interfaces:**
- Produces: on coarse-pointer devices that ALSO report a fine pointer (`matchMedia("(any-pointer: fine)")`), the Pragmatic `draggable()` is registered alongside the touch listeners, so a mouse can drag. A capture-phase `dragstart` guard cancels native HTML5 drags initiated by TOUCH input (the Android long-press → OS split-screen problem the touch system exists to avoid).

- [ ] **Step 1: Implement**

In the touch branch (`if (_isTouch()) { … }`), after the touch listeners are attached and before `dropCleanup`, add:

```js
      // A tablet with a mouse/trackpad reports pointer:coarse (primary) AND
      // any-pointer:fine. Register the desktop draggable too so MOUSE drags
      // work — HTML5 drag events never fire from touch on our elements because
      // the capture-phase dragstart guard below cancels touch-initiated ones
      // (Android can start a native drag from a long-press, which is exactly
      // the OS-intercept path the touch system bypasses).
      let lastPointerType = null;
      const onPointerDownType = (e) => { lastPointerType = e.pointerType; };
      const onNativeDragStart = (e) => {
        if (lastPointerType === 'touch' || lastPointerType === 'pen') {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      let mouseDragCleanup = null;
      if (window.matchMedia("(any-pointer: fine)").matches) {
        el.addEventListener('pointerdown', onPointerDownType, { capture: true });
        el.addEventListener('dragstart', onNativeDragStart, { capture: true });
        mouseDragCleanup = draggable({
          element: el,
          ...(handleEl ? { dragHandle: handleEl } : {}),
          getInitialData: () => buildPayload(),
          getInitialDataForExternal: () => ({ [NATIVE_DND_MIME]: serializePayload(buildPayload()) }),
          onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
            const liveData = dataRef.current;
            const label = liveData?.label || liveData?.name || liveData?.occurrence?.label || "item";
            const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? "move";
            const action = mode === "copy" ? "Copy" : mode === "copylink" ? "Copy-link" : "Move";
            attachDragPreview(el, location, nativeSetDragImage, { label, action });
          },
          onDragStart: ({ location }) => {
            setIsDragging(true);
            const liveData = dataRef.current;
            const mode = liveData?.occurrence?.dragMode ?? liveData?.defaultDragMode ?? 'move';
            dragCtx.handleDragStart(buildPayload(), location.current.input.clientX, location.current.input.clientY, { mode });
          },
          onDrag: ({ location }) => {
            dragCtx.handleDragMove(location.current.input.clientX, location.current.input.clientY);
          },
          onDrop: () => {
            setIsDragging(false);
            setTimeout(() => dragCtx.handleDragEnd(), 0);
          },
        });
      }
```

and in the touch branch's cleanup function add:

```js
        el.removeEventListener('pointerdown', onPointerDownType, { capture: true });
        el.removeEventListener('dragstart', onNativeDragStart, { capture: true });
        mouseDragCleanup?.();
```

- [ ] **Step 2: Run tests + build**

Run: `npm --prefix client run test` → pass (the registration test from Task 10 mocks matchMedia `matches: false`, so this branch stays untested there — fine).
Run: `npm --prefix client run build` → exit 0.

- [ ] **Step 3: Device verification (REQUIRED before merging this task)**

- Tablet emulation (touch): finger drags still work; long-press on a drag handle does NOT start a native ghost (the guard preventDefaults it).
- Desktop with touch emulation off: unchanged.
- Real/emulated hybrid (playwright: touch-enabled context + mouse events): mouse-drag an instance by its handle → native ghost + drop lands.
- If the Android long-press guard proves insufficient on the real tablet (native drag still initiates), revert THIS task only (`git revert`) — it's isolated by design — and note the finding in `client/src/helpers/CLAUDE.md`.

- [ ] **Step 4: Update `client/src/helpers/CLAUDE.md`**, then commit:

```bash
git add client/src/helpers/dragSystem.js client/src/helpers/CLAUDE.md
git commit -m "feat(dnd): mouse drags on touch-primary devices (any-pointer:fine) with a touch-dragstart guard"
```

---

### Task 14: Re-baseline drop→paint and record the numbers

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-dnd-wrap-menus-audit-fixes.md` (this file — fill in the results table below)
- No product code unless the numbers demand a follow-up (file it as a new docket item, don't scope-creep here)

**Interfaces:** none — measurement task.

Context: 2026-07-03 got drop→paint from 2855ms → ~1400ms @5x CPU throttle (per-id selector migration + endDropBatch chunk/dedup, see `client/src/CLAUDE.md`). The documented remaining lever was "frame-1 flush ~1.3s@5x — needs component-level React profiling". Tasks 9–10 attack exactly the costs that profile pointed at (per-render stringify + listener re-registration during the cascade), so measure before profiling further.

- [ ] **Step 1: Capture the baseline (pre-plan build)**

`git stash` any working tree, `git checkout` the commit before Task 1, build, and run the drop probe from the local probe workflow (memory `project_local_probe_workflow`: local server on prod Atlas DB + vite + root-level playwright probe) with `window.__dragPerf = true` and 5x CPU throttle. Drop a Daily Toolkit item into a Schedule slot 3×; record the median `[drop]` stopwatch lines and `[drop-renders]` counts.

- [ ] **Step 2: Measure the post-plan build**

`git checkout` the branch tip, rebuild, repeat the identical probe. Record the same numbers.

- [ ] **Step 3: Fill in this table (edit this plan file) and decide**

| Metric (@5x throttle) | Before plan | After plan |
|---|---|---|
| drop → routeDrop returned (ms) | | |
| drop → rAF #2 painted (ms) | | |
| [drop-renders] instance count | | |
| [dragPerf] touch fps / onMove_avgMs | | |

Decision rule: if "drop → rAF #2 painted" is now under ~600ms @5x (≈ instant at 1x), close the item. If not, file a new docket entry in `client/src/CLAUDE.md` titled "drop frame-1 flush profiling" with the captured numbers and the top-3 components from a React DevTools profiler pass — that work is a separate session, not this plan.

- [ ] **Step 4: Commit the measurements**

```bash
git add docs/superpowers/plans/2026-07-06-dnd-wrap-menus-audit-fixes.md client/src/CLAUDE.md
git commit -m "chore(dnd): record drop->paint before/after numbers for the audit-fix batch"
```

---

## Final verification (after all tasks)

- [ ] `npm --prefix client run test` — full suite green.
- [ ] `npm --prefix server run test` — full suite green.
- [ ] `npm --prefix client run build` — clean.
- [ ] `npm run dev` boots; manual smoke: import a Wikipedia article (wrap channel/seam/infobox render right), drag items between containers on desktop + tablet emulation, open every menu (radial / context / quick-add near the screen bottom / insert-gap existing-module pick).
- [ ] Update the root `CLAUDE.md` handoff section with a dated entry summarizing what shipped.
