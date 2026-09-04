# Mosaic Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Mosaic (BSP) layout Windows-style panel snapping — `Ctrl+Alt+Arrow` from the keyboard and a perimeter drop band with the mouse — so a panel can take a half or a quadrant of the grid.

**Architecture:** One pure module, `client/src/helpers/mosaicSnap.js`, decides everything: it derives a panel's current region from the tree and returns a new tree for a pressed direction. Two thin call sites use it — the keyboard handler in `Grid.jsx` and a new perimeter drop target in `GridMosaic.jsx`. `helpers/bspTree.js` is untouched; snap is policy layered over its existing primitives.

**Tech Stack:** React 18, Vitest + @testing-library/react, Pragmatic drag-and-drop (`@atlaskit/pragmatic-drag-and-drop`), plain ESM.

**Spec:** `docs/superpowers/specs/2026-09-04-mosaic-snap-design.md`

## Global Constraints

- All commands run from `client/`. Tests: `./node_modules/.bin/vitest run <path>` (there is no global `npx` on this machine).
- Tests live in `client/src/__tests__/`, named `<subject>.test.js` (or `.test.jsx` when they render).
- `npm run lint` must report **0 `no-undef` errors** — a build resolves imports but not undefined locals, and no test mounts `Grid.jsx` or `GridMosaic.jsx`.
- Every guard added must be **A/B'd**: mutate it, assert the mutation actually landed, confirm the intended test fails, restore.
- `bspTree.js` must not be modified. Its exports are sufficient: `makeLeaf`, `makeSplit`, `removeLeaf`, `findLeaf`, `isLeaf`.
- Tree node shapes (from `bspTree.js`): `Leaf = { id, panelOccId }`, `Split = { id, dir: "v" | "h", ratio: number[], children: Node[] }`. `dir: "v"` lays children out LEFT→RIGHT (columns); `dir: "h"` lays them TOP→BOTTOM (rows).
- Persisting a tree always spreads the whole `meta`: `CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: { meta: { ...(grid?.meta || {}), layoutTree: next } }, emit: true })`. A partial `meta` write drops every other key on it.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/helpers/mosaicSnap.js` (create) | The whole snap decision: `regionOf` + `snapLeaf`. Pure — no React, no writes. |
| `client/src/__tests__/mosaicSnap.test.js` (create) | All snap coverage. |
| `client/src/Grid.jsx` (modify, ~line 800) | Keyboard: branch on `layoutTree` instead of returning early. |
| `client/src/modules/GridMosaic.jsx` (modify) | Perimeter drop band; both gestures end in `snapLeaf`. |
| `client/src/index.css` (modify) | Focus outline + perimeter zone preview. |

---

### Task 1: `regionOf` — derive a panel's region from the tree

A region is a *recognition of the shapes `snapLeaf` produces*. Anything else reads as `full` on that axis. Deriving it (rather than storing it) is what keeps the arrows honest after someone drags a seam.

**Files:**
- Create: `client/src/helpers/mosaicSnap.js`
- Test: `client/src/__tests__/mosaicSnap.test.js`

**Interfaces:**
- Consumes: `findLeaf`, `isLeaf` from `./bspTree`
- Produces: `regionOf(tree, panelOccId) → { col: "left"|"right"|"full", row: "top"|"bottom"|"full" } | null`

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/mosaicSnap.test.js
import { describe, it, expect } from "vitest";
import { makeLeaf, makeSplit } from "../helpers/bspTree";
import { regionOf } from "../helpers/mosaicSnap";

const A = () => makeLeaf("a");
const B = () => makeLeaf("b");
const C = () => makeLeaf("c");

describe("regionOf", () => {
  it("is full on both axes for a lone leaf", () => {
    expect(regionOf(A(), "a")).toEqual({ col: "full", row: "full" });
  });

  it("reads the right half off a root column split", () => {
    // v[ B | A ]  →  A is the last child of a column split
    expect(regionOf(makeSplit("v", [B(), A()]), "a")).toEqual({ col: "right", row: "full" });
  });

  it("reads the left half", () => {
    expect(regionOf(makeSplit("v", [A(), B()]), "a")).toEqual({ col: "left", row: "full" });
  });

  it("reads the top half off a root row split", () => {
    expect(regionOf(makeSplit("h", [A(), B()]), "a")).toEqual({ col: "full", row: "top" });
  });

  // The shape a top-right snap produces: h[ v[B, A], C ]
  it("reads a top-right quadrant", () => {
    const tree = makeSplit("h", [makeSplit("v", [B(), A()]), C()]);
    expect(regionOf(tree, "a")).toEqual({ col: "right", row: "top" });
  });

  it("reads a bottom-left quadrant", () => {
    const tree = makeSplit("h", [C(), makeSplit("v", [A(), B()])]);
    expect(regionOf(tree, "a")).toEqual({ col: "left", row: "bottom" });
  });

  // A middle child is neither edge — claiming one would make the arrows lie.
  it("is full when the panel is a MIDDLE child", () => {
    expect(regionOf(makeSplit("v", [B(), A(), C()]), "a")).toEqual({ col: "full", row: "full" });
  });

  it("answers null for a panel that is not in the tree", () => {
    expect(regionOf(makeSplit("v", [B(), C()]), "a")).toBe(null);
    expect(regionOf(null, "a")).toBe(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: FAIL — cannot resolve `../helpers/mosaicSnap`.

- [ ] **Step 3: Write the module**

```js
// client/src/helpers/mosaicSnap.js
// ============================================================
// Windows-style region snapping for the Mosaic (BSP) layout.
//
// THE SIBLING OF `helpers/gridSnap.js`, which is this same policy for rows×cols
// grids. `bspTree.js` stays split-tree MATH; "what does right mean" is policy
// and lives here.
//
// A panel's region is DERIVED from the tree, never stored. Stored region state
// would drift the moment someone drags a seam, and the arrows would then act on
// a state that no longer matches what is on screen.
//
// Spec: docs/superpowers/specs/2026-09-04-mosaic-snap-design.md
// ============================================================
import { findLeaf, isLeaf } from "./bspTree";

/**
 * Where does this panel sit, in half/quadrant terms?
 *
 * This RECOGNISES the shapes `snapLeaf` produces and calls everything else
 * `full`. That is deliberate: a panel wedged as a middle child of a three-way
 * split is not on either edge, and claiming an edge would make the next arrow
 * press move it somewhere the user did not predict.
 *
 * Only the outer two levels are inspected, because that is the deepest shape a
 * snap ever builds (a quadrant is a split inside a split).
 */
export function regionOf(tree, panelOccId) {
  if (!tree || !panelOccId) return null;
  if (!findLeaf(tree, panelOccId)) return null;

  let col = "full";
  let row = "full";
  let node = tree;

  for (let depth = 0; depth < 2 && node && !isLeaf(node); depth++) {
    const idx = node.children.findIndex((c) => !!findLeaf(c, panelOccId));
    if (idx === -1) break;
    const first = idx === 0;
    const last = idx === node.children.length - 1;
    // A two-child split makes its child both first AND last; that is still an
    // edge. A middle child of three is neither, and stays `full`.
    if (node.dir === "v" && col === "full") {
      if (first && !last) col = "left";
      else if (last && !first) col = "right";
    } else if (node.dir === "h" && row === "full") {
      if (first && !last) row = "top";
      else if (last && !first) row = "bottom";
    }
    node = node.children[idx];
  }
  return { col, row };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: A/B the middle-child guard**

Change `if (first && !last) col = "left";` to `if (first) col = "left";` and re-run. Expected: the "is full when the panel is a MIDDLE child" test FAILS. Restore.

- [ ] **Step 6: Lint and commit**

```bash
cd client && npm run lint 2>&1 | grep -c "no-undef"   # expect 0
git add client/src/helpers/mosaicSnap.js client/src/__tests__/mosaicSnap.test.js
git commit -m "feat(mosaic): derive a panel's snap region from the tree"
```

---

### Task 2: `snapLeaf` — halves, no-ops, and the release rule

**Files:**
- Modify: `client/src/helpers/mosaicSnap.js`
- Test: `client/src/__tests__/mosaicSnap.test.js`

**Interfaces:**
- Consumes: `regionOf` (Task 1); `makeLeaf`, `makeSplit`, `removeLeaf` from `./bspTree`
- Produces: `snapLeaf(tree, panelOccId, direction) → tree | null`, where `direction` is `"up" | "down" | "left" | "right"`. **`null` means nothing changed** — so no caller has to decide what a no-op looks like, and no caller writes to the grid.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/__tests__/mosaicSnap.test.js` (and add `snapLeaf` to the existing import from `../helpers/mosaicSnap`):

```js
import { snapLeaf } from "../helpers/mosaicSnap";   // add to the existing import line

// Compare shape only — makeSplit mints a fresh random `id` per node.
const shape = (n) =>
  !n ? null
  : n.panelOccId ? n.panelOccId
  : { dir: n.dir, children: n.children.map(shape) };

describe("snapLeaf — halves", () => {
  // A panel with NO constraint on either axis is a middle child (regionOf calls
  // an edge child of a two-way split a half already). Pressing left/right from
  // there is the only press that produces a plain half rather than a quadrant.
  it("takes the right half, complement on the left", () => {
    const tree = makeSplit("h", [B(), A(), C()]);     // A is a middle row: col+row full
    expect(shape(snapLeaf(tree, "a", "right")))
      .toEqual({ dir: "v", children: [{ dir: "h", children: ["b", "c"] }, "a"] });
  });

  it("takes the left half", () => {
    const tree = makeSplit("h", [B(), A(), C()]);
    expect(shape(snapLeaf(tree, "a", "left")))
      .toEqual({ dir: "v", children: ["a", { dir: "h", children: ["b", "c"] }] });
  });

  // THE DEGRADE RULE, pinned so it is deliberate rather than accidental: from a
  // plain TOP half, Right targets the top-right QUADRANT, and with only one
  // panel left there is no row split to partition — so nothing moves. Falling
  // back to the right half would discard the row the panel already held, which
  // is exactly what the spec refuses. Two panels have no quadrants.
  it("does nothing when the perpendicular press cannot build a quadrant", () => {
    expect(snapLeaf(makeSplit("h", [A(), B()]), "a", "right")).toBe(null);
  });

  it("walks across in ONE press: right half → left half", () => {
    const tree = makeSplit("v", [B(), A()]);          // A is right
    expect(shape(snapLeaf(tree, "a", "left")))
      .toEqual({ dir: "v", children: ["a", "b"] });
  });

  it("sets the bottom half from a plain top half — it does NOT release", () => {
    // Releasing here would leave the panel with no region at all, and the
    // press would read as broken.
    const tree = makeSplit("h", [A(), B()]);          // A is top, col is full
    expect(shape(snapLeaf(tree, "a", "down")))
      .toEqual({ dir: "h", children: ["b", "a"] });
  });
});

describe("snapLeaf — the release rule (quadrant only)", () => {
  it("releases the row from a quadrant, keeping the column", () => {
    // top-right + Down → full-height right
    const tree = makeSplit("h", [makeSplit("v", [B(), A()]), C()]);
    expect(shape(snapLeaf(tree, "a", "down")))
      .toEqual({ dir: "v", children: [{ dir: "h", children: ["b", "c"] }, "a"] });
  });
});

describe("snapLeaf — no-ops answer null", () => {
  it("returns null when already in that region", () => {
    expect(snapLeaf(makeSplit("v", [B(), A()]), "a", "right")).toBe(null);
  });

  it("returns null for a panel that is not in the tree", () => {
    expect(snapLeaf(makeSplit("v", [B(), C()]), "a", "right")).toBe(null);
  });

  it("returns null for a lone leaf — there is no complement to place", () => {
    expect(snapLeaf(A(), "a", "right")).toBe(null);
  });

  it("returns null for an unknown direction", () => {
    expect(snapLeaf(makeSplit("v", [B(), A()]), "a", "sideways")).toBe(null);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: FAIL — `snapLeaf is not a function`.

- [ ] **Step 3: Implement halves + the release rule**

Add to `client/src/helpers/mosaicSnap.js`:

```js
import { findLeaf, isLeaf, makeLeaf, makeSplit, removeLeaf } from "./bspTree";  // replace the existing import

const AXIS = { left: "col", right: "col", up: "row", down: "row" };
const EDGE = { left: "left", right: "right", up: "top", down: "bottom" };
const OPPOSITE = { left: "right", right: "left", top: "bottom", bottom: "top" };

/**
 * Snap a panel one step in `direction`. Returns a NEW tree, or null when
 * nothing changed.
 *
 * Left/Right always SET the column — one press crosses you to the other side.
 * Up/Down set the row, except that pressing the arrow opposite your current row
 * RELEASES it back to full — and only from a QUADRANT. From a plain top half
 * there is no column constraint to fall back on, so releasing would leave the
 * panel with no region and the press would read as broken.
 */
export function snapLeaf(tree, panelOccId, direction) {
  const axis = AXIS[direction];
  if (!axis) return null;

  const cur = regionOf(tree, panelOccId);
  if (!cur) return null;

  const edge = EDGE[direction];
  if (cur[axis] === edge) return null;             // already there

  const next = { ...cur };
  const inQuadrant = cur.col !== "full" && cur.row !== "full";
  if (axis === "row" && inQuadrant && cur.row === OPPOSITE[edge]) {
    next.row = "full";                             // release
  } else {
    next[axis] = edge;
  }

  const rest = removeLeaf(tree, panelOccId);
  if (!rest) return null;                          // the tree was just this leaf
  return buildRegion(rest, makeLeaf(panelOccId), next);
}

/** Place `leaf` in `region` with `rest` filling the complement. */
function buildRegion(rest, leaf, { col, row }) {
  if (row === "full") {
    return col === "right" ? makeSplit("v", [rest, leaf])
                           : makeSplit("v", [leaf, rest]);
  }
  if (col === "full") {
    return row === "bottom" ? makeSplit("h", [rest, leaf])
                            : makeSplit("h", [leaf, rest]);
  }
  return null;   // quadrant — Task 3
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: PASS — EXCEPT `"does nothing when the perpendicular press cannot build a quadrant"`, which
already passes here for the right reason (`buildRegion`'s quadrant branch is a `return null` stub in
this task) and keeps passing in Task 3 for the real reason (the degrade guard). The release-rule test
passes because releasing produces a HALF.

- [ ] **Step 5: A/B the quadrant gate on the release rule**

Drop `inQuadrant &&` from the release condition and re-run. Expected: "sets the bottom half from a plain top half" FAILS (it returns a release instead). Restore.

- [ ] **Step 6: A/B the already-there guard**

Delete the `if (cur[axis] === edge) return null;` line and re-run. Expected: "returns null when already in that region" FAILS. Restore.

- [ ] **Step 7: Lint and commit**

```bash
cd client && npm run lint 2>&1 | grep -c "no-undef"   # expect 0
git add client/src/helpers/mosaicSnap.js client/src/__tests__/mosaicSnap.test.js
git commit -m "feat(mosaic): snapLeaf takes halves, walks across, and releases from a quadrant"
```

---

### Task 3: `snapLeaf` — quadrants, and degrade-to-half

The complement's own top-level split supplies the partition. When it cannot, **nothing moves** — the newly-pressed axis is dropped and the panel keeps the half it had. Falling back to the half for the axis just pressed would silently discard the column the user deliberately set.

**Files:**
- Modify: `client/src/helpers/mosaicSnap.js`
- Test: `client/src/__tests__/mosaicSnap.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-2. No signature changes.

- [ ] **Step 1: Write the failing tests**

```js
describe("snapLeaf — quadrants", () => {
  // The user's own case, 2026-09-04:
  //   v[ h[Routines, Trackers] , Browser ]  + Up
  //   → h[ v[Routines, Browser] , Trackers ]
  it("builds the top-right quadrant from the complement's first row", () => {
    const tree = makeSplit("v", [makeSplit("h", [A(), B()]), C()]);   // C full-height right
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({ dir: "h", children: [{ dir: "v", children: ["a", "c"] }, "b"] });
  });

  it("builds the top-LEFT quadrant with the leaf first in its row", () => {
    const tree = makeSplit("v", [C(), makeSplit("h", [A(), B()])]);   // C full-height left
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({ dir: "h", children: [{ dir: "v", children: ["c", "a"] }, "b"] });
  });

  // Bottom pairs with the complement's LAST row, not its first.
  it("builds the bottom-right quadrant from the complement's last row", () => {
    const tree = makeSplit("v", [makeSplit("h", [A(), B()]), C()]);
    expect(shape(snapLeaf(tree, "c", "down")))
      .toEqual({ dir: "h", children: ["a", { dir: "v", children: ["b", "c"] }] });
  });

  it("keeps the remaining rows grouped when the complement has three", () => {
    const D = () => makeLeaf("d");
    const tree = makeSplit("v", [makeSplit("h", [A(), B(), D()]), C()]);
    expect(shape(snapLeaf(tree, "c", "up")))
      .toEqual({
        dir: "h",
        children: [{ dir: "v", children: ["a", "c"] }, { dir: "h", children: ["b", "d"] }],
      });
  });

  // DEGRADE: nothing to partition → nothing moves, and the column survives.
  it("does nothing when the complement is a single leaf", () => {
    const tree = makeSplit("v", [A(), C()]);      // C right, complement is one leaf
    expect(snapLeaf(tree, "c", "up")).toBe(null);
  });

  it("does nothing when the complement splits on the wrong axis", () => {
    const tree = makeSplit("v", [makeSplit("v", [A(), B()]), C()]);
    expect(snapLeaf(tree, "c", "up")).toBe(null);
  });

  it("carries the complement's existing ratios into the grouped remainder", () => {
    const D = () => makeLeaf("d");
    const inner = makeSplit("h", [A(), B(), D()], [1, 3, 2]);
    const out = snapLeaf(makeSplit("v", [inner, C()]), "c", "up");
    expect(out.children[1].ratio).toEqual([3, 2]);   // A's weight left with A
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: FAIL — quadrant cases get `null` from the Task 2 stub.

- [ ] **Step 3: Replace the quadrant stub**

In `buildRegion`, replace `return null;   // quadrant — Task 3` with:

```js
  // QUADRANT. The complement's own top-level ROW split supplies the partition:
  // one of its rows becomes our neighbour, the remainder becomes the other row.
  // Nothing is invented — if the complement cannot be divided that way, the
  // caller gets null and nothing moves.
  if (isLeaf(rest) || rest.dir !== "h" || rest.children.length < 2) return null;

  const takeFirst = row === "top";
  const mate = takeFirst ? rest.children[0] : rest.children[rest.children.length - 1];
  const others = takeFirst ? rest.children.slice(1) : rest.children.slice(0, -1);
  const otherRatio = takeFirst ? rest.ratio.slice(1) : rest.ratio.slice(0, -1);
  const otherRow = others.length === 1 ? others[0] : makeSplit("h", others, otherRatio);

  const myRow = col === "right" ? makeSplit("v", [mate, leaf])
                                : makeSplit("v", [leaf, mate]);
  return takeFirst ? makeSplit("h", [myRow, otherRow])
                   : makeSplit("h", [otherRow, myRow]);
```

- [ ] **Step 4: Run and watch them pass**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: PASS, all cases.

- [ ] **Step 5: A/B the degrade guard**

Change `if (isLeaf(rest) || rest.dir !== "h" || rest.children.length < 2) return null;` to `if (isLeaf(rest)) return null;` and re-run. Expected: "does nothing when the complement splits on the wrong axis" FAILS (it would build a bogus split). Restore.

- [ ] **Step 6: A/B the bottom-pairs-with-last rule**

Change `const takeFirst = row === "top";` to `const takeFirst = true;` and re-run. Expected: "builds the bottom-right quadrant from the complement's last row" FAILS. Restore.

- [ ] **Step 7: Run the whole suite, lint, commit**

```bash
cd client
./node_modules/.bin/vitest run                       # expect no new failures
npm run lint 2>&1 | grep -c "no-undef"               # expect 0
git add client/src/helpers/mosaicSnap.js client/src/__tests__/mosaicSnap.test.js
git commit -m "feat(mosaic): quadrant snap, partitioned by the complement's own rows"
```

---

### Task 4: Ctrl+Alt+Arrow reaches Mosaic

**Files:**
- Modify: `client/src/Grid.jsx` — the `useEffect` beginning `if (isMobileLayout || layoutTree) return;` (~line 800)

**Interfaces:**
- Consumes: `snapLeaf` (Task 2/3)
- Produces: nothing new. `lastPanelIdRef` and the existing typing guard are reused as-is.

- [ ] **Step 1: Add the import**

At the top of `client/src/Grid.jsx`, beside `import { snapPanelInDirection } from "./helpers/gridSnap";`:

```js
import { snapLeaf } from "./helpers/mosaicSnap";
```

- [ ] **Step 2: Replace the early return with a branch**

Change the guard from:

```js
    if (isMobileLayout || layoutTree) return; // rows×cols desktop only
```

to:

```js
    if (isMobileLayout) return;   // mobile pages one panel at a time; no regions
```

and, inside `onKey`, replace the single `snapPanelInDirection(...)` call with:

```js
      e.preventDefault();
      // MOSAIC has no placements — its arrangement is the tree — so it needs a
      // different snap entirely. `gridSnap` writes `occurrence.placement`, which
      // a mosaic grid does not render; that is why this handler used to bail
      // rather than run.
      if (layoutTree) {
        const next = snapLeaf(layoutTree, occ.id, direction);
        if (!next) return;                       // no-op: write nothing
        CommitHelpers.updateGrid({
          dispatch, socket, gridId,
          grid: { meta: { ...(grid?.meta || {}), layoutTree: next } },
          emit: true,
        });
        return;
      }
      snapPanelInDirection({ direction, panelOcc: occ, grid, occurrencesById, dispatch, socket });
```

Add `layoutTree` and `gridId` to the effect's dependency array.

- [ ] **Step 3: Verify the module resolves**

Run: `cd client && npm run build 2>&1 | tail -3`
Expected: `✓ built in …`. A build resolves imports; it will fail loudly if `mosaicSnap` is misspelled.

- [ ] **Step 4: Confirm nothing regressed**

```bash
cd client && ./node_modules/.bin/vitest run 2>&1 | tail -4
npm run lint 2>&1 | grep -c "no-undef"               # expect 0
```

- [ ] **Step 5: Commit**

```bash
git add client/src/Grid.jsx
git commit -m "feat(mosaic): Ctrl+Alt+Arrow snaps panels on a mosaic grid"
```

**Note for the reviewer:** no test mounts `Grid.jsx`, so this wiring is covered only by the build resolving and by `snapLeaf`'s own tests. Say so rather than implying otherwise.

---

### Task 5: Holding Ctrl+Alt outlines the panel that will move

**Files:**
- Modify: `client/src/Grid.jsx`
- Modify: `client/src/index.css`

**Interfaces:**
- Consumes: `lastPanelIdRef` (already in `Grid.jsx`)
- Produces: a `data-snap-target="true"` attribute on the focused panel's element while the chord is held.

- [ ] **Step 1: Add the hold listener**

In `Grid.jsx`, beside the keyboard effect:

```js
  // Holding Ctrl+Alt marks the panel that an arrow would move, so you can see
  // what is about to happen before committing. Stamped as a DOM attribute
  // rather than React state: this fires on every keydown repeat, and a state
  // flip there would re-render the whole grid on a key the user is holding.
  useEffect(() => {
    if (isMobileLayout) return;
    const mark = (on) => {
      const id = lastPanelIdRef.current;
      document.querySelectorAll('[data-snap-target]').forEach((el) => el.removeAttribute("data-snap-target"));
      if (!on || !id) return;
      document.querySelector(`[data-panel-id="${CSS.escape(id)}"]`)?.setAttribute("data-snap-target", "true");
    };
    const onKeyDown = (e) => { if (e.ctrlKey && e.altKey) mark(true); };
    const onKeyUp = (e) => { if (!e.ctrlKey || !e.altKey) mark(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => mark(false));
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      mark(false);
    };
  }, [isMobileLayout]);
```

- [ ] **Step 2: Add the outline**

Append to `client/src/index.css`:

```css
/* The panel Ctrl+Alt+Arrow would move. Outline, not border — a border would
   change the panel's box and shift every pane beside it while the chord is
   held. */
[data-snap-target="true"] {
  outline: 2px solid var(--accent-blue, #38bdf8);
  outline-offset: -2px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Verify the CSS reached the BUILT stylesheet**

```bash
cd client && npm run build >/dev/null 2>&1
grep -c "data-snap-target" dist/assets/*.css        # expect >= 1
grep -c "grid-line" dist/assets/*.css               # control: expect >= 1
```

A CSS insertion is verified by grepping the built stylesheet for the new rule AND one beside it; the compiler will not tell you.

- [ ] **Step 4: Commit**

```bash
git add client/src/Grid.jsx client/src/index.css
git commit -m "feat(mosaic): holding Ctrl+Alt outlines the panel an arrow would move"
```

---

### Task 6: The perimeter drop band

**Files:**
- Modify: `client/src/modules/GridMosaic.jsx`
- Modify: `client/src/index.css`
- Test: `client/src/__tests__/mosaicSnap.test.js` (the zone maths only)

**Interfaces:**
- Consumes: `snapLeaf` (Tasks 2-3)
- Produces: `zoneAt({ x, y, w, h, band }) → { direction, quadrant } | null` exported from `mosaicSnap.js` — pointer position to the arrow-equivalent it means.

- [ ] **Step 1: Write the failing zone test**

```js
describe("zoneAt — perimeter drop zones", () => {
  const box = { w: 900, h: 600, band: 48 };

  it("is null well inside the grid — the pane keeps the drop", () => {
    expect(zoneAt({ x: 450, y: 300, ...box })).toBe(null);
  });

  it("the middle of the right band means the right half", () => {
    expect(zoneAt({ x: 880, y: 300, ...box })).toEqual({ direction: "right", quadrant: null });
  });

  it("the top of the right band means the top-right quadrant", () => {
    expect(zoneAt({ x: 880, y: 40, ...box })).toEqual({ direction: "right", quadrant: "up" });
  });

  it("the bottom of the right band means the bottom-right quadrant", () => {
    expect(zoneAt({ x: 880, y: 560, ...box })).toEqual({ direction: "right", quadrant: "down" });
  });

  it("the middle of the top band means the top half", () => {
    expect(zoneAt({ x: 450, y: 10, ...box })).toEqual({ direction: "up", quadrant: null });
  });

  // A corner sits in two bands and both mean the same quadrant, so the overlap
  // needs no tie-break — but it must not answer null.
  it("a corner resolves to that quadrant", () => {
    const c = zoneAt({ x: 890, y: 8, ...box });
    expect(c).not.toBe(null);
    expect(new Set([c.direction, c.quadrant])).toEqual(new Set(["right", "up"]));
  });
});
```

Add `zoneAt` to the existing `../helpers/mosaicSnap` import.

- [ ] **Step 2: Run and watch it fail**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: FAIL — `zoneAt is not a function`.

- [ ] **Step 3: Implement `zoneAt`**

Append to `client/src/helpers/mosaicSnap.js`:

```js
/**
 * Which snap does a drop at (x, y) mean? Null means "not in the perimeter" —
 * the drop belongs to whichever pane is under the pointer, which is the gesture
 * that builds nested layouts and must keep working.
 *
 * Each side is three zones: the middle third is the half, the outer thirds are
 * the quadrants. A corner is inside two bands, and both resolve to the same
 * quadrant, so the overlap needs no tie-break.
 */
export function zoneAt({ x, y, w, h, band = 48 }) {
  const nearLeft = x <= band;
  const nearRight = x >= w - band;
  const nearTop = y <= band;
  const nearBottom = y >= h - band;
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;

  const third = (v, extent) => (v < extent / 3 ? "start" : v > (2 * extent) / 3 ? "end" : "middle");

  if (nearLeft || nearRight) {
    const direction = nearLeft ? "left" : "right";
    const t = third(y, h);
    return { direction, quadrant: t === "start" ? "up" : t === "end" ? "down" : null };
  }
  const direction = nearTop ? "up" : "down";
  const t = third(x, w);
  return { direction, quadrant: t === "start" ? "left" : t === "end" ? "right" : null };
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `./node_modules/.bin/vitest run src/__tests__/mosaicSnap.test.js`
Expected: PASS.

- [ ] **Step 5: Mount the band in `GridMosaic`**

Add to the imports: `import { snapLeaf, zoneAt } from "../helpers/mosaicSnap";`

Add a sibling drop target inside the mosaic root, rendered AFTER the panes so it sits above them, and a handler beside `handlePaneDrop`:

```js
  // PERIMETER SNAP. A band around the grid's outer edge means "give this panel
  // a region of the WHOLE grid". Inside the band, drops keep resolving against
  // the pane under the pointer — that is how you say "below Routines
  // specifically", and it is the gesture that builds nested layouts.
  const handlePerimeterDrop = useCallback((draggedOccId, zone) => {
    if (!draggedOccId || !zone) return;
    const cur = treeRef.current;
    if (!cur) return;
    // A quadrant is the half followed by the perpendicular press — the same two
    // steps the keyboard takes, so there is one definition of a quadrant.
    let next = snapLeaf(cur, draggedOccId, zone.direction) || cur;
    if (zone.quadrant) next = snapLeaf(next, draggedOccId, zone.quadrant) || next;
    if (next === cur) return;
    setTree(next);
    persist(next);
  }, [persist]);
```

Render the band as an absolutely-positioned overlay that is a `dropTargetForElements` with the same `canDrop` as a pane (`d?.type === DragType.PANEL`), computing `zoneAt` from `input.clientX/Y` minus the container rect. It must have `pointer-events: none` on its interior so only the band itself intercepts.

- [ ] **Step 6: Add the band styling**

```css
/* The perimeter snap band. Only visible while a panel is being dragged — at
   rest it must not read as a frame. */
.mosaic-snap-zone {
  position: absolute;
  pointer-events: none;
  background: var(--accent-blue-bg, rgba(56, 189, 248, 0.18));
  border: 1px solid var(--accent-blue, #38bdf8);
  border-radius: 3px;
  transition: opacity 90ms ease-out;
}
```

- [ ] **Step 7: Verify build, suite, lint, and the built stylesheet**

```bash
cd client
npm run build 2>&1 | tail -3                        # expect ✓ built
grep -c "mosaic-snap-zone" dist/assets/*.css        # expect >= 1
./node_modules/.bin/vitest run 2>&1 | tail -4       # expect no new failures
npm run lint 2>&1 | grep -c "no-undef"              # expect 0
```

- [ ] **Step 8: Commit**

```bash
git add client/src/modules/GridMosaic.jsx client/src/helpers/mosaicSnap.js \
        client/src/__tests__/mosaicSnap.test.js client/src/index.css
git commit -m "feat(mosaic): a perimeter band snaps a dragged panel to a region"
```

---

### Task 7: Verify in a browser, then document

Everything above is unit-tested logic plus wiring at seams no test mounts. This task is where the honest gap gets closed or recorded.

**Files:**
- Modify: `CLAUDE.md`, `client/src/CLAUDE.md`, `client/src/helpers/CLAUDE.md`

- [ ] **Step 1: Deploy**

```bash
cd /home/joshpoms/moduli && bash deploy.sh 2>&1 | tail -6
ssh root@142.93.5.142 "cd /var/www/moduli && git log --oneline -1"    # must match local HEAD
```

Client-only changes, so `deploy.sh` should report **"Server unchanged — NOT restarting"**. If it restarts, something outside `client/` was staged — check before proceeding.

- [ ] **Step 2: Exercise both paths by hand and record the result**

On the live grid: click a panel, hold Ctrl+Alt (outline appears on that panel), press Right (it takes the full right side), Up (top-right, the rest fills the width below), Down (back to full height), Left (walks to the left side). Then drag a panel into the middle of the right edge and into the top-right corner.

Record what actually happened — including anything that did not work. Do not write "verified" for a path you did not press.

- [ ] **Step 3: Document**

Add a dated entry to the root `CLAUDE.md` covering: why the keyboard was dead in Mosaic (gridSnap is placement-based, Mosaic has no placements), the region model and the one asymmetry between the axes, degrade-to-half, and each A/B with what it failed. Add file-level notes to `client/src/helpers/CLAUDE.md` (the new module) and `client/src/CLAUDE.md` (the two wirings).

- [ ] **Step 4: Commit and push**

```bash
git add CLAUDE.md client/src/CLAUDE.md client/src/helpers/CLAUDE.md
git commit -m "docs: record the mosaic snap pass"
git push origin master
```

---

## Self-Review

**Spec coverage:** region model → Tasks 1-3. Arrow semantics incl. release and independence of axes → Task 2. Quadrant partition and degrade-to-half → Task 3. Keyboard path and the `Grid.jsx` branch → Task 4. Focus outline → Task 5. Perimeter zones, corner overlap, both-gestures-survive → Task 6. Testing posture and the stated wiring gap → Tasks 1-6 plus Task 7. Out-of-scope items (touch, mobile, `Shift+Ctrl+Alt+Arrow` tree-move) are correctly absent.

**Type consistency:** `snapLeaf(tree, panelOccId, direction)` and `regionOf(tree, panelOccId)` are used with those names and argument orders in Tasks 2, 3, 4 and 6. `zoneAt` returns `{ direction, quadrant }` and Task 6's handler consumes exactly those keys. `null` means "no change" at every call site.

**Known softness, stated rather than hidden:** Task 6 Step 5 describes the drop-target mounting in prose rather than a full code block, because the exact JSX depends on the current shape of `GridMosaic`'s root element, which the implementer will have open. The handler it calls is given in full, and the `canDrop` predicate is specified verbatim.
