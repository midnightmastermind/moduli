# Line-Level Wrap Morph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a wrap neighbor (e.g. an image) beside a host textblock and have the prose morph around it at the EXACT VISUAL LINE the pointer is on — with a per-line drop highlight that shows where it will land — instead of only snapping to whole-block (paragraph) boundaries.

**Architecture:** Replace the block-index anchor (`anchorIndex` → `blockIndexAtY` → `host.blocks[i].top`) with a **pixel offset anchor** (`anchorOffset`, px from the host prose top) stored on the `wrapGroup` node. The float's `margin-top` is then set directly to that offset, so the neighbor can start at any visual line. A new pure helper (`wrapAnchor.js`) does the drop-point → line-top math (unit-testable). `detectSideHost` is made reliable (it currently returns `null` on valid side drops → the drop falls through to a cross-doc move, "it stays in the same place"). The drop indicator gains a per-line, side-aware highlight.

**Tech Stack:** React, TipTap/ProseMirror (`view.posAtCoords`, `view.coordsAtPos`), CSS floats (the existing `--wrap-mt` / `--wrap-nw` model), Vitest.

---

## Background (read before starting)

- **Wrap model** (`client/src/index.css` `.wrap-group--on`, `client/src/docs/WrapGroupNode.jsx`): the NEIGHBOR is `float:right|left` at `--wrap-nw` width with `margin-top: var(--wrap-mt)`; the HOST is the last child, a plain block whose prose wraps around the float. `--wrap-mt` is what moves the float DOWN the column (0 = top of the column).
- **Current anchor** (`WrapGroupNode.measure`, ~line 88-98): reads `node.attrs.anchorIndex`, finds `host .ProseMirror`'s child block at that index, sets `--wrap-mt = block.top - holderTop`. So a single-paragraph host has exactly one block → `anchorIndex` is always 0 → "one big line, always the same spot."
- **Drop detection** (`client/src/ui/Editor.jsx`):
  - `detectSideHost(input)` (~line 1369): `posAtCoords` → `$p.before(1)` → top node. If it's a `wrapGroup` → re-morph branch (recompute side + `anchorIndex` via `blockIndexAtY`). If it's a `moduleEmbed` whose occurrence is textmapped → compute `frac = (x - rect.left)/rect.width`; `side = frac>=0.6?"right":frac<=0.4?"left":null`; returns `null` when `side` is null (middle third) → NO wrap forms.
  - `blockIndexAtY(hostDom, clientY)` (~line 1358): returns the host block index whose mid-Y the pointer is above — block granular.
  - `nearestDocBoundary` (~line 94): drop indicator snaps to the nearest TOP-LEVEL block top/bottom. `dragGap` state renders `.doc-insert-gap--drag` (`client/src/ui/Editor.jsx:1948`).
- **Drag is NOT unit-testable** (ProseMirror DOM + native DnD). Strategy: extract the math into pure helpers with Vitest coverage; verify the DnD glue manually in-browser with the steps in each task.
- **The reported bug** (from the user's drop log): dragging the image gives `sideHost (wrap-beside detect) null` + `grouped-member? null` → `MOVE cross-doc insert → true` (a plain move, image stays put). Two causes: (A) `detectSideHost` returns null on the drop; (B) even when it works, anchoring is block-granular.

---

## File Structure

- **Create** `client/src/docs/wrapAnchor.js` — pure helpers: `sideFromFrac`, `lineTopAtY`, `anchorOffsetForDrop`. One responsibility: drop-geometry → `{ side, anchorOffset }`. Fully unit-tested.
- **Create** `client/src/__tests__/wrapAnchor.test.js` — Vitest unit tests for the helpers.
- **Modify** `client/src/docs/WrapGroupExtension.js` — add an `anchorOffset` attr (px|null) to the `wrapGroup` node.
- **Modify** `client/src/docs/WrapGroupNode.jsx` — `measure()` uses `anchorOffset` (px) for `--wrap-mt` instead of `anchorIndex`→block math. Keep `anchorIndex` read as a fallback for legacy nodes.
- **Modify** `client/src/ui/Editor.jsx` — `detectSideHost` returns `{ side, anchorOffset, ... }`; widen side detection; the formation/re-morph paths write `anchorOffset`; the drop indicator (`onDragOver`) shows a per-line, side-aware highlight when over a wrap host.
- **Modify** `client/src/index.css` — a side-aware per-line drop highlight style (`.wrap-drop-line`).

---

## Task 1: Diagnose why `detectSideHost` returns null (instrument, then read one live drop)

**Files:**
- Modify: `client/src/ui/Editor.jsx` (`detectSideHost`, ~line 1369-1415)

- [ ] **Step 1: Add a single structured log at every `return null` in `detectSideHost`**

In `client/src/ui/Editor.jsx`, inside `detectSideHost`, replace each bare `return null;` with a logged one. Example for the existing early guards:

```js
const detectSideHost = (input) => {
  const bail = (why, extra) => { console.log("[detectSideHost] null —", why, extra || ""); return null; };
  if (!editor?.view || !input || input.clientX == null) return bail("no editor/input");
  const res = editor.view.posAtCoords({ left: input.clientX, top: input.clientY });
  if (!res) return bail("posAtCoords miss", { x: input.clientX, y: input.clientY });
  const $p = editor.state.doc.resolve(res.pos);
  if ($p.depth < 1) return bail("depth<1", { pos: res.pos });
  const topPos = $p.before(1);
  const topNode = editor.state.doc.nodeAt(topPos);
  if (!topNode) return bail("no topNode", { topPos });
  // ... wrapGroup branch unchanged ...
  if (topNode.type.name !== "moduleEmbed") return bail("top not moduleEmbed", { type: topNode.type.name });
  const hostOccId = topNode.attrs?.occurrenceId || null;
  if (!isTextmappedHost(hostOccId)) return bail("host not textmapped", { hostOccId });
  // ... rect/frac ...
  const side = frac >= 0.6 ? "right" : frac <= 0.4 ? "left" : null;
  if (!side) return bail("middle third (no side)", { frac: Math.round(frac * 100) / 100 });
  // ...
};
```

- [ ] **Step 2: Build the client**

Run: `npm run build:client`
Expected: `✓ built in …` (no errors)

- [ ] **Step 3: Manual — capture the null reason**

In the running app, drag an image to the side of a wrap host and read the console. Note which `[detectSideHost] null — <why>` fires. Expected most-likely cause: `"top not moduleEmbed"` (the drop resolves to the wrapGroup or a sub-editor) or `"middle third (no side)"` (the prose fills the column so there is no left/right third to hit).

- [ ] **Step 4: Commit the instrumentation**

```bash
git add client/src/ui/Editor.jsx
git commit -m "chore(wrap): log detectSideHost null reasons for diagnosis"
```

> The fix in Task 4 depends on the reason found here. The plan below assumes the two most likely causes and fixes both; if a different reason appears, adjust Task 4's widening accordingly.

---

## Task 2: Pure anchor helper (`wrapAnchor.js`) with tests

**Files:**
- Create: `client/src/docs/wrapAnchor.js`
- Test: `client/src/__tests__/wrapAnchor.test.js`

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/wrapAnchor.test.js
import { describe, it, expect } from "vitest";
import { sideFromFrac, anchorOffsetForDrop } from "../docs/wrapAnchor.js";

describe("sideFromFrac", () => {
  it("left for the left ~half, right for the right ~half (no dead middle)", () => {
    expect(sideFromFrac(0.1)).toBe("left");
    expect(sideFromFrac(0.49)).toBe("left");
    expect(sideFromFrac(0.51)).toBe("right");
    expect(sideFromFrac(0.9)).toBe("right");
  });
});

describe("anchorOffsetForDrop", () => {
  it("returns the drop Y minus the host prose top, clamped to >= 0", () => {
    // host prose top at 100, drop at 250 -> offset 150
    expect(anchorOffsetForDrop({ dropY: 250, hostProseTop: 100 })).toBe(150);
    // drop above the prose top -> clamp to 0
    expect(anchorOffsetForDrop({ dropY: 80, hostProseTop: 100 })).toBe(0);
  });
  it("snaps to a provided line top when lineTops are given (nearest at-or-above)", () => {
    // lines at prose-relative tops 0, 20, 40, 60; drop offset 33 -> snap to 20
    expect(anchorOffsetForDrop({ dropY: 133, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(20);
    // drop offset 58 -> snap to 40
    expect(anchorOffsetForDrop({ dropY: 158, hostProseTop: 100, lineTops: [0, 20, 40, 60] })).toBe(40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --silent -- run client/src/__tests__/wrapAnchor.test.js`
Expected: FAIL — "Cannot find module ../docs/wrapAnchor.js"

- [ ] **Step 3: Write the helper**

```js
// client/src/docs/wrapAnchor.js
// Pure geometry helpers for the line-level wrap anchor. No DOM/React — so they're
// unit-testable; the Editor/WrapGroupNode call them with measured numbers.

// Which side the neighbor floats to, from the horizontal fraction across the host.
// No dead "middle third" — every drop picks a side (split at the midline) so a drop
// anywhere over the host forms/keeps a wrap (fixes "drop in the middle = no wrap").
export function sideFromFrac(frac) {
  return frac < 0.5 ? "left" : "right";
}

// The float's margin-top (px from the host prose top) for a drop at `dropY`.
// When `lineTops` (prose-relative tops of each visual line) is supplied, snap to the
// nearest line top AT OR ABOVE the drop, so the neighbor starts cleanly on a line.
export function anchorOffsetForDrop({ dropY, hostProseTop, lineTops = null }) {
  const raw = Math.max(0, Math.round(dropY - hostProseTop));
  if (!Array.isArray(lineTops) || lineTops.length === 0) return raw;
  let snapped = 0;
  for (const t of lineTops) { if (t <= raw) snapped = t; else break; }
  return snapped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --silent -- run client/src/__tests__/wrapAnchor.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/docs/wrapAnchor.js client/src/__tests__/wrapAnchor.test.js
git commit -m "feat(wrap): pure line-anchor geometry helpers + tests"
```

---

## Task 3: `wrapGroup` carries an `anchorOffset` attr; WrapGroupNode uses it for `--wrap-mt`

**Files:**
- Modify: `client/src/docs/WrapGroupExtension.js` (attrs block)
- Modify: `client/src/docs/WrapGroupNode.jsx` (`measure`, ~line 88-98)

- [ ] **Step 1: Add the `anchorOffset` attr**

In `client/src/docs/WrapGroupExtension.js`, in `addAttributes()`, add alongside the existing `anchorIndex` / `side` / `neighborWidth`:

```js
      anchorOffset: {
        default: null, // px from the host prose top → the float's margin-top (line-level anchor)
        parseHTML: (el) => {
          const v = el.getAttribute("data-anchor-offset");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.anchorOffset == null ? {} : { "data-anchor-offset": String(attrs.anchorOffset) },
      },
```

- [ ] **Step 2: Use `anchorOffset` (px) in `WrapGroupNode.measure` for `--wrap-mt`**

In `client/src/docs/WrapGroupNode.jsx`, replace the `anchorIndex` → block-top computation (the `let mt = 0; if (anchorIndex > 0) { … }` block, ~line 88-98) with:

```js
    // Line-level anchor: `anchorOffset` (px from the host prose top) is the float's
    // margin-top directly, so the neighbor can start at ANY visual line — not just a
    // block boundary. Falls back to the legacy anchorIndex→block-top for old nodes.
    const holderEl = contentEl.querySelector(":scope > [data-node-view-content-react]") || contentEl;
    const holderTop = holderEl.getBoundingClientRect().top;
    const anchorOffset = node.attrs.anchorOffset;
    let mt = 0;
    if (anchorOffset != null && Number.isFinite(Number(anchorOffset))) {
      mt = Math.max(0, Math.round(Number(anchorOffset)));
    } else {
      const anchorIndex = Number(node.attrs.anchorIndex) || 0; // legacy fallback
      if (anchorIndex > 0) {
        const hostPm = els[els.length - 1].querySelector(".ProseMirror");
        const blocks = hostPm ? Array.from(hostPm.children) : [];
        const idx = Math.min(anchorIndex, blocks.length - 1);
        if (idx > 0 && blocks[idx]) {
          mt = Math.max(0, Math.round(blocks[idx].getBoundingClientRect().top - holderTop));
        }
      }
    }
    wrapEl.style.setProperty("--wrap-mt", `${mt}px`);
```

- [ ] **Step 3: Add `node.attrs.anchorOffset` to the `measure` useCallback deps**

In `client/src/docs/WrapGroupNode.jsx`, the `measure` `useCallback` dep array (currently `[side, node.attrs.anchorIndex]`) → `[side, node.attrs.anchorIndex, node.attrs.anchorOffset]` so a re-morph re-measures.

- [ ] **Step 4: Update the shape classifier to keep working**

In `WrapGroupNode.jsx`, the `measuredShape` logic uses `anchorIndex` to decide top vs middle/bottom. Update the first-guess line so a non-null `anchorOffset` of 0 still reads as `top`:

```js
  const shape = measuredShape || (((Number(node.attrs.anchorOffset) || Number(node.attrs.anchorIndex) || 0) > 0) ? "middle" : "top");
```

(The MEASURED shape in `measure()` already classifies from the neighbor's box vs the host bottom — unchanged.)

- [ ] **Step 5: Build the client**

Run: `npm run build:client`
Expected: `✓ built in …`

- [ ] **Step 6: Run the full client test suite (no regressions)**

Run: `npm run test --silent`
Expected: `Test Files  60 passed` / `Tests  1116 passed` (1113 prior + 3 new from Task 2)

- [ ] **Step 7: Commit**

```bash
git add client/src/docs/WrapGroupExtension.js client/src/docs/WrapGroupNode.jsx
git commit -m "feat(wrap): anchorOffset attr drives a line-level float margin-top"
```

---

## Task 4: `detectSideHost` is reliable + returns a line-level `anchorOffset`

**Files:**
- Modify: `client/src/ui/Editor.jsx` (`detectSideHost` ~1369, the formation/re-morph drop paths ~1466-1492 & ~1544-1565)

- [ ] **Step 0: Hoist `detectSideHost` (and its helper closures) to component scope so BOTH `onDrop` and `onDragOver` can call it**

`detectSideHost`, `isTextmappedHost`, `blockIndexAtY`, and the new `offsetFor` are currently defined INSIDE the `onDrop` callback — `onDragOver` (Task 5) can't reach them. Lift them to component scope as a `useCallback` declared before the `dropTargetForElements` effect (alongside `resolveInsertPos`):

```js
const detectSideHost = useCallback((input) => {
  // … full body (Step 1) …
}, [editor]); // reads editor + the *Ref.current maps (refs, so stable)
```

`isTextmappedHost` / `blockIndexAtY` / `offsetFor` become plain module-scope or component-scope helpers (they only need `editor` + the ref maps). Inside the `onDrop` handler, DELETE the now-duplicate local definitions and call the hoisted ones. Verify the page editor still forms wraps after the move (`npm run build:client`, then a quick manual drag) before continuing.

- [ ] **Step 1: Make `detectSideHost` return `{ side, anchorOffset }` and never dead-zone the middle**

In `client/src/ui/Editor.jsx` `detectSideHost`, for BOTH the `wrapGroup` re-morph branch and the `moduleEmbed` branch:
- Compute `side` via `sideFromFrac(frac)` (import from `../docs/wrapAnchor`) instead of the `frac>=0.6 / <=0.4 / else null` thresholds — so a drop anywhere over the host picks a side (no null from "middle third").
- Compute `anchorOffset` from the drop Y and the host prose top:

```js
import { sideFromFrac, anchorOffsetForDrop } from "../docs/wrapAnchor";

// helper used in both branches: hostEl is the host's .ProseMirror (or its wrapper)
const offsetFor = (hostEl, clientY) => {
  const pm = hostEl?.querySelector?.(".ProseMirror") || hostEl;
  if (!pm) return 0;
  const proseTop = pm.getBoundingClientRect().top;
  // visual line tops: top of each top-level block (good enough; line-accurate snap
  // comes from the block's client rects — see Step 2)
  const lineTops = [];
  Array.from(pm.children).forEach((b) => {
    const rects = b.getClientRects?.();
    if (rects && rects.length) {
      for (const r of rects) lineTops.push(Math.round(r.top - proseTop));
    } else {
      lineTops.push(Math.round(b.getBoundingClientRect().top - proseTop));
    }
  });
  lineTops.sort((a, z) => a - z);
  return anchorOffsetForDrop({ dropY: clientY, hostProseTop: proseTop, lineTops });
};
```

In the `moduleEmbed` branch return:

```js
  const frac = (input.clientX - rect.left) / rect.width;
  const side = sideFromFrac(frac);
  const hostDom = dom; // the moduleEmbed DOM
  const anchorOffset = offsetFor(hostDom, input.clientY);
  return { hostPos: topPos, hostOccId, side, anchorOffset, anchorIndex: null };
```

In the `wrapGroup` re-morph branch return (host is `topNode.lastChild`, `hostEl` already resolved there):

```js
  const frac = (input.clientX - rect.left) / rect.width;
  const side = sideFromFrac(frac);
  const anchorOffset = offsetFor(hostEl, input.clientY);
  return { hostPos: topPos, hostOccId, side, anchorOffset, anchorIndex: null };
```

- [ ] **Step 2: Write `anchorOffset` when forming / re-morphing the group**

In `client/src/ui/Editor.jsx`:
- `wrapHostWithNeighbor` (~line 1416) and `wrapMoveBeside` (~line 1446): in the `groupType.create({...})` attrs, add `anchorOffset: sideHost.anchorOffset ?? null` (keep `anchorIndex` for back-compat).
- The in-group re-morph branch (~line 1469-1479, `setNodeMarkup`): set `anchorOffset: sideHost.anchorOffset ?? g.attrs.anchorOffset` in the new attrs (and drop reliance on `anchorIndex` for positioning).

- [ ] **Step 3: Build the client**

Run: `npm run build:client`
Expected: `✓ built in …`

- [ ] **Step 4: Manual — verify form + re-morph at a line**

In the app: (a) drag an image onto the RIGHT side of a multi-line textblock near its 1st line → image floats top-right, prose wraps. (b) Drag the SAME image down to the 5th line → image now starts at the 5th line, prose above is full-width, beside it from line 5. (c) Drop on the LEFT side → image floats left (mirror). Console shows a non-null `sideHost` with an `anchorOffset` each time, NOT `MOVE cross-doc insert`.

- [ ] **Step 5: Remove the Task 1 diagnostic logs** (keep one concise `DLOG` of the resolved `sideHost`), then commit

```bash
git add client/src/ui/Editor.jsx
git commit -m "feat(wrap): detectSideHost picks a side everywhere + returns line-level anchorOffset"
```

---

## Task 5: Per-line, side-aware drop highlight

**Files:**
- Modify: `client/src/ui/Editor.jsx` (`onDragOver` ~1279, render of the drag indicator ~1948)
- Modify: `client/src/index.css` (new `.wrap-drop-line`)

- [ ] **Step 1: Compute a wrap-drop highlight in `onDragOver` when over a wrap host**

In `client/src/ui/Editor.jsx` `onDragOver` (the existing `lastNativeEvent = e; … setDragGap(b)` handler, ~line 1279), also compute a side-aware line highlight via `detectSideHost(e)`. Add a new state near `dragGap`:

```js
const [wrapDrop, setWrapDrop] = useState(null); // { top, side } | null
```

In `onDragOver`:

```js
    const sh = detectSideHost(e);
    if (sh && sh.anchorOffset != null) {
      // anchorOffset is prose-relative; convert to wrapper-relative for absolute render
      const pm = el.querySelector(".ProseMirror");
      const proseTop = pm ? pm.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
      setWrapDrop({ top: Math.round(proseTop + sh.anchorOffset), side: sh.side });
    } else {
      setWrapDrop(null);
    }
```

Clear it in `onDragLeaveNative` and in `onDrop` (next to the existing `setDragGap(null)` calls).

- [ ] **Step 2: Render the highlight**

In `client/src/ui/Editor.jsx`, next to the `{dragGap && (…)}` block (~line 1948), add:

```jsx
      {wrapDrop && (
        <div
          className={`wrap-drop-line wrap-drop-line--${wrapDrop.side}`}
          style={{ top: wrapDrop.top }}
        />
      )}
```

- [ ] **Step 3: Style it (a short line on the side where the image will float, at the target line)**

In `client/src/index.css`:

```css
/* Wrap-beside drop affordance: a bright segment on the SIDE where the neighbor will
   float, at the exact VISUAL LINE the pointer is on (so the user sees which line the
   prose will morph around). */
.wrap-drop-line {
  position: absolute;
  height: 2px;
  width: 46%;
  background: rgb(50, 150, 255);
  border-radius: 1px;
  pointer-events: none;
  z-index: 30;
  box-shadow: 0 0 6px rgba(50, 150, 255, 0.6);
}
.wrap-drop-line--right { right: 0; }
.wrap-drop-line--left  { left: 0; }
```

- [ ] **Step 4: Build the client**

Run: `npm run build:client`
Expected: `✓ built in …`

- [ ] **Step 5: Manual — verify the highlight differentiates lines**

Drag an image over a multi-line textblock and move the pointer up/down its right side: a blue segment hugs the RIGHT edge and JUMPS line-to-line as the pointer moves (not one static bar). Move to the left side → it snaps to the LEFT edge. Drop → the image lands where the highlight was.

- [ ] **Step 6: Run the full test suite + commit**

Run: `npm run test --silent`
Expected: `Tests  1116 passed`

```bash
git add client/src/ui/Editor.jsx client/src/index.css
git commit -m "feat(wrap): per-line, side-aware drop highlight"
```

---

## Task 6: Update folder docs

**Files:**
- Modify: `client/src/docs/CLAUDE.md`, `client/src/ui/CLAUDE.md`, `client/src/CLAUDE.md`

- [ ] **Step 1: Add a dated "Recent Changes" entry to each** summarizing: `anchorOffset` (px) replaces `anchorIndex` as the wrap anchor (line-level), `detectSideHost` picks a side everywhere + returns `anchorOffset`, the new `wrapAnchor.js` pure helper, and the `.wrap-drop-line` per-line highlight.

- [ ] **Step 2: Commit**

```bash
git add client/src/docs/CLAUDE.md client/src/ui/CLAUDE.md client/src/CLAUDE.md
git commit -m "docs: record line-level wrap morph changes"
```

---

## Manual Verification Checklist (whole feature)

- [ ] Drag an image to the RIGHT side of a multi-paragraph textblock, near the top → floats top-right, prose wraps (an L / "top" shape).
- [ ] Drag it down to a mid line → image starts at THAT line; prose above is full-width, beside it below (a "middle" shape). Granular per visual line, not per paragraph.
- [ ] Drag it to the LEFT side → mirrors (floats left).
- [ ] The blue drop highlight tracks the pointer line-by-line and hugs the correct side; dropping lands the image where the highlight was.
- [ ] Re-morphing an already-wrapped image (drag it up/down) moves the float — it does NOT "reset the page" or cross-doc move (verify no `MOVE cross-doc insert` in console; DragProvider's `.doc-editor` guard already prevents the monitor from double-handling).
- [ ] Window/panel/column resize keeps the wrap correct (the float is pure CSS; `--wrap-mt` is a stored px offset, re-measured by `WrapGroupNode`).
- [ ] `npm run test --silent` → all green (1116).

## Notes / Risks

- **`anchorOffset` is a stored pixel offset**, so it does NOT track text reflow (if the host text above the float grows/shrinks, the float stays at the original px). This matches today's behavior closely enough and avoids a measure→layout feedback loop. If reflow-tracking is later wanted, store an `anchorPos` (ProseMirror position) instead and resolve it via `view.coordsAtPos` in `measure` — a follow-up, not this plan.
- **Single-line hosts**: `lineTops` will have one entry (0); the offset snaps to 0 → top shape, as expected (there are no other lines to morph at).
- Task 1's diagnostic may reveal a THIRD null cause (e.g. the drop resolving into a sub-editor). If so, the existing `.textblock-card / .instance-textblock-block / .table-td` registration guard + the DragProvider `.doc-editor` guard already route the drop to the page editor; confirm `detectSideHost` runs on the page editor's coords.
