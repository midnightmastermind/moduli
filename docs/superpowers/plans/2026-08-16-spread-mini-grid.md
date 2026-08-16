# Spread Mini Grid — Implementation Plan (Phases 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrange a spread's file tiles yourself — drag one and it stays there — using the BSP mosaic the grid already has.

**Architecture:** `helpers/bspTree.js` is already generic (it moves ids around a split tree and never mentions panels); only `GridMosaic`'s React glue is panel-specific. Phase 1 extracts that glue into a shared `MosaicSurface`, behaviour-preserving, pinned by tests first. Phase 2 seeds a tree onto the spread page from the file count and renders the files through that surface.

**Tech Stack:** React 18, Vitest + @testing-library/react, `helpers/bspTree.js`, Playwright for the browser check.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-16-spread-viewer-design.md`. Phase 3 (the shell generalising to any occurrence, panel fold-in, sibling cycling) is a SEPARATE plan — do not start it here.
- **`GridMosaic` renders the entire grid on mosaic grids** and on 2026-07-04 corrupted the seeded layout by reconciling against a transiently-partial panel set. Its behaviour is pinned BEFORE it is touched. **If the pins in Task 1 cannot be written, STOP and switch to a private copy of the glue for the viewer** — the spec authorises that fallback explicitly.
- **`bspTree.js`'s existing exports keep their semantics.** Additions only.
- **No schema change.** The tree lives at `spreadOcc.meta.layoutTree`; `meta` is Mixed.
- **Plain drag re-arranges; only shift-drag-out detaches.**
- **Never reconcile against what is rendered** — always against the authoritative child list. That is the exact mistake that corrupted the grid layout.
- Run tests from `client/`: `npx vitest run <path>`.
- Every A/B: apply the mutation, **grep to confirm it landed**, run, restore. A mutation that fails nothing means the test does not discriminate — fix the test.

---

## Phase 1 — extract the mosaic glue

### Task 1: Pin GridMosaic's current behaviour

Characterisation tests. They assert what it does TODAY, right or wrong, so the extraction has a net.

**Files:**
- Test: `client/src/__tests__/gridMosaicPins.test.jsx`

**Interfaces:**
- Consumes: `GridMosaic` as it currently is.
- Produces: nothing — a safety net for Task 2.

- [ ] **Step 1: Read the source first**

Read `client/src/modules/GridMosaic.jsx` end to end before writing a line. Note especially the reconcile effect (it keys off `grid.occurrences`, NOT the rendered panel set — that is deliberate and load-bearing) and the splitter pointer-drag that persists on pointer-up.

- [ ] **Step 2: Write the pins**

Cover, at minimum:

```jsx
// client/src/__tests__/gridMosaicPins.test.jsx
// CHARACTERISATION tests: these assert what GridMosaic does TODAY so the
// MosaicSurface extraction has a net. They are not a judgement about whether
// the behaviour is right — do not "fix" anything here.
describe("GridMosaic — pinned behaviour", () => {
  it("renders one pane per leaf, positioned from computeLayout", () => {});
  it("renders a splitter between siblings", () => {});
  it("PRUNES a leaf whose panel left grid.occurrences", () => {});
  it("ADDS a new panel by splitting the largest pane", () => {});
  it("does NOT reconcile from a transiently-partial RENDERED panel set", () => {
    // The 2026-07-04 corruption. Render with grid.occurrences holding 3 panels
    // but only 1 resolvable in panelByOccId; assert the tree still has 3 leaves.
  });
  it("persists the tree on splitter pointer-up, not during the drag", () => {});
});
```

- [ ] **Step 3: Run them against UNCHANGED source**

Run: `cd client && npx vitest run src/__tests__/gridMosaicPins.test.jsx`
Expected: **PASS.** A characterisation test that fails on unchanged source is describing something else — fix the test.

- [ ] **Step 4: Commit**

```bash
git add client/src/__tests__/gridMosaicPins.test.jsx
git commit -m "test(mosaic): pin GridMosaic's behaviour before extracting its glue"
```

---

### Task 2: Extract `MosaicSurface`

**Files:**
- Create: `client/src/modules/MosaicSurface.jsx`
- Modify: `client/src/modules/GridMosaic.jsx`
- Test: `client/src/__tests__/mosaicSurface.test.jsx`

**Interfaces:**
- Consumes: `computeLayout` / `resizeSplit` / `splitLeaf` / `removeLeaf` from `helpers/bspTree.js`.
- Produces:
  ```
  MosaicSurface({
    tree,                                   // BSP tree
    onTreeChange: (nextTree) => void,       // called on splitter pointer-UP and on drop-split
    renderLeaf: (leafId, pane) => ReactNode,
    splitterThickness = 6,
    acceptsDropType = null,                 // null = no drop-to-split
  })
  ```
  `GridMosaic` keeps its own public props unchanged.

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/__tests__/mosaicSurface.test.jsx
describe("MosaicSurface", () => {
  it("renders renderLeaf once per leaf with the computed pane rect", () => {});
  it("calls onTreeChange with a resized tree on splitter pointer-UP only", () => {});
  it("knows nothing about panels", () => {
    // renderLeaf returns a plain <div data-testid={id}> — no Panel involved.
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && npx vitest run src/__tests__/mosaicSurface.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Extract**

Move the measuring/ResizeObserver, `computeLayout` call, pane positioning and splitter pointer-drag out of `GridMosaic` into `MosaicSurface`. **Leave in `GridMosaic`:** the reconcile effect, `panelByOccId`, persistence to `grid.meta.layoutTree`, and the drop-to-split panel DnD wiring. `GridMosaic` then renders:

```jsx
<MosaicSurface
  tree={tree}
  onTreeChange={persistTree}
  renderLeaf={(occId, pane) => {
    const panel = panelByOccId[occId];
    if (!panel) return null;           // hidden/filtered panel keeps its pane
    return <Panel mosaic {...panelProps(panel, pane)} />;
  }}
/>
```

- [ ] **Step 4: Run BOTH suites**

Run: `cd client && npx vitest run src/__tests__/mosaicSurface.test.jsx src/__tests__/gridMosaicPins.test.jsx`
Expected: both PASS. **The pins passing unchanged is the whole point of Task 1.**

- [ ] **Step 5: Full suite + build**

Run: `cd client && npx vitest run && npm run build`
Expected: all pass; chunk sizes at documented values (tiptap ~435 / highlight ~969 / CommandCenter ~204 / PagePreviewApp ~1049).

- [ ] **Step 6: Verify a real mosaic grid still renders**

`GridMosaic` is only exercised on grids with `meta.layoutTree`. Load one in a browser (poms grid is mosaic) and confirm the panels are where they were, splitters still drag, and the layout persists across a reload. **Unit tests cannot see a corrupted layout tree** — that is exactly how it shipped last time.

- [ ] **Step 7: Commit**

```bash
git add client/src/modules/MosaicSurface.jsx client/src/modules/GridMosaic.jsx client/src/__tests__/mosaicSurface.test.jsx
git commit -m "refactor(mosaic): extract MosaicSurface; GridMosaic becomes a thin caller"
```

---

## Phase 2 — the mini grid in the spread

### Task 3: `buildBalancedTree`

**Files:**
- Modify: `client/src/helpers/bspTree.js`
- Test: `client/src/__tests__/bspTree.test.js` (extend)

**Interfaces:**
- Produces: `buildBalancedTree(ids: string[], cols: number) => Node | null` — a BSP tree laying `ids` out in row-major order at `cols` per row. `[]` → `null`; one id → a bare leaf.

- [ ] **Step 1: Write the failing test**

```js
import { buildBalancedTree, allPanelOccIds, computeLayout } from "../helpers/bspTree.js";

describe("buildBalancedTree", () => {
  it("returns null for no ids", () => {
    expect(buildBalancedTree([], 3)).toBe(null);
  });

  it("a single id is a bare leaf, not a split", () => {
    const t = buildBalancedTree(["a"], 3);
    expect(t.type ?? (t.children ? "split" : "leaf")).toBe("leaf");
    expect(allPanelOccIds(t)).toEqual(["a"]);
  });

  it("keeps every id, in order", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(allPanelOccIds(buildBalancedTree(ids, 3))).toEqual(ids);
  });

  it("lays 4 ids out as 2x2 at cols=2", () => {
    const t = buildBalancedTree(["a", "b", "c", "d"], 2);
    const { panes } = computeLayout(t, { x: 0, y: 0, w: 400, h: 400 }, 0);
    const byId = Object.fromEntries(panes.map((p) => [p.panelOccId, p]));
    expect(byId.a.y).toBe(byId.b.y);            // same row
    expect(byId.c.y).toBe(byId.d.y);
    expect(byId.c.y).toBeGreaterThan(byId.a.y); // second row below
    expect(byId.a.x).toBeLessThan(byId.b.x);
  });

  it("a ragged last row still tiles without gaps", () => {
    const t = buildBalancedTree(["a", "b", "c", "d", "e"], 3);
    const { panes } = computeLayout(t, { x: 0, y: 0, w: 300, h: 200 }, 0);
    const area = panes.reduce((n, p) => n + p.w * p.h, 0);
    expect(Math.round(area)).toBe(300 * 200);   // perfect tiling, no dead space
  });

  it("cols greater than the id count yields ONE row", () => {
    const t = buildBalancedTree(["a", "b"], 5);
    const { panes } = computeLayout(t, { x: 0, y: 0, w: 400, h: 100 }, 0);
    expect(panes[0].y).toBe(panes[1].y);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && npx vitest run src/__tests__/bspTree.test.js -t buildBalancedTree`
Expected: FAIL — `buildBalancedTree is not a function`.

- [ ] **Step 3: Implement**

```js
/**
 * Lay `ids` out row-major at `cols` per row as a BSP tree: a horizontal split
 * of rows, each row a vertical split of its ids. Used to SEED a spread's
 * arrangement so the first drag has something to rearrange (a spread with no
 * tree would otherwise render nothing).
 *
 * Ragged last rows are fine — each row splits its own width evenly, so the
 * result always tiles perfectly even when the last row is short.
 */
export function buildBalancedTree(ids, cols) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.length === 0) return null;
  const n = Math.max(1, Math.floor(cols) || 1);
  if (list.length === 1) return makeLeaf(list[0]);

  const rows = [];
  for (let i = 0; i < list.length; i += n) rows.push(list.slice(i, i + n));

  const rowNodes = rows.map((row) =>
    row.length === 1
      ? makeLeaf(row[0])
      : makeSplit("v", row.map((id) => makeLeaf(id)), row.map(() => 1 / row.length))
  );

  if (rowNodes.length === 1) return rowNodes[0];
  return makeSplit("h", rowNodes, rowNodes.map(() => 1 / rowNodes.length));
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd client && npx vitest run src/__tests__/bspTree.test.js`
Expected: PASS — the 17 existing plus the 6 new.

- [ ] **Step 5: A/B**

Mutate `makeSplit("h", ...)` → `makeSplit("v", ...)` for the row container (verify it landed) — the 2×2 test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/bspTree.js client/src/__tests__/bspTree.test.js
git commit -m "feat(bsp): buildBalancedTree — seed a row-major arrangement from a list of ids"
```

---

### Task 4: Seed and reconcile the spread's tree

**Files:**
- Modify: `client/src/ui/ArtifactSpreadHost.jsx`
- Create: `client/src/helpers/spreadTree.js`
- Test: `client/src/__tests__/spreadTree.test.js`

**Interfaces:**
- Consumes: `buildBalancedTree`, `allPanelOccIds`, `removeLeaf`, `splitLeaf` from `bspTree.js`.
- Produces:
  - `columnsForCount(n: number) => number` — 1→1, 2→2, 4→2, else 3. **This is the same rule the CSS shipped on 2026-08-16; the two must agree, so the CSS becomes the fallback only.**
  - `reconcileSpreadTree(tree, childIds) => Node | null` — adds ids present in `childIds` but missing from the tree, drops ids no longer children, returns the SAME tree object when nothing changed (so callers can skip the write).

- [ ] **Step 1: Write the failing test**

```js
describe("reconcileSpreadTree", () => {
  it("seeds from the child list when there is no tree", () => {});
  it("ADDS a newly attached file to the tree", () => {});
  it("DROPS an id that is no longer a child", () => {});
  it("returns the SAME object when nothing changed (no pointless write)", () => {
    const t = buildBalancedTree(["a", "b"], 2);
    expect(reconcileSpreadTree(t, ["a", "b"])).toBe(t);
  });
  it("an empty child list yields null, not a broken tree", () => {});
});

describe("columnsForCount", () => {
  it("matches the CSS rule", () => {
    expect([1, 2, 3, 4, 5, 9].map(columnsForCount)).toEqual([1, 2, 3, 2, 3, 3]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && npx vitest run src/__tests__/spreadTree.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement, then wire into the host**

Write `spreadTree.js`, then fold the reconcile into the host's EXISTING single "keep the page in step" effect — the one that already tops up the child list and heals the layout. **It must stay one write:** all three patches spread the same `spreadOcc` snapshot, and as separate effects whichever lands second drops the others.

- [ ] **Step 4: Run and watch it pass**

Run: `cd client && npx vitest run src/__tests__/spreadTree.test.js src/__tests__/ArtifactSpreadHost.test.jsx`
Expected: PASS.

- [ ] **Step 5: Add a host test for the seeding**

Assert the minted/healed occurrence carries `meta.layoutTree` whose ids equal its `occurrences`. A/B by returning `null` from `reconcileSpreadTree` — it must fail.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/spreadTree.js client/src/__tests__/spreadTree.test.js client/src/ui/ArtifactSpreadHost.jsx client/src/__tests__/ArtifactSpreadHost.test.jsx
git commit -m "feat(spread): seed and reconcile a BSP tree on the spread page"
```

---

### Task 5: Render the files through MosaicSurface

**Files:**
- Modify: `client/src/ui/ArtifactSpreadHost.jsx`
- Modify: `client/src/index.css` (demote the auto-grid to a fallback)

- [ ] **Step 1: Render**

In the FILES content, when a tree resolves, render `<MosaicSurface tree renderLeaf={…} onTreeChange={persist} />` instead of `<Container>`. `renderLeaf` renders the artifact tile for that occurrence id.

- [ ] **Step 2: Demote the CSS auto-grid**

The `data-count` / `--spread-cols` rules stay for the no-tree fallback only. Add a comment saying so, so nobody "cleans up" a rule that is still the safety net.

- [ ] **Step 3: Persist on change**

`onTreeChange` writes `spreadOcc.meta.layoutTree` through `CommitHelpers.updateOccurrence`, MERGING meta (the page also carries `spreadFor` and `layoutCascade`).

- [ ] **Step 4: Full suite + build**

Run: `cd client && npx vitest run && npm run build`

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/ArtifactSpreadHost.jsx client/src/index.css
git commit -m "feat(spread): files render through the BSP mosaic; the CSS grid is now the fallback"
```

---

### Task 6: Plain drag re-arranges; shift-drag-out detaches

**Files:**
- Modify: `client/src/ui/ArtifactSpreadHost.jsx` / `client/src/ui/ArtifactSpread.jsx`
- Test: extend `client/src/__tests__/ArtifactSpreadHost.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
it("a plain drop onto another pane RE-ARRANGES and detaches nothing", () => {});
it("shift-drag-out detaches, and only then", () => {});
```

- [ ] **Step 2–4: Implement, run, verify**

The shell already tracks `shiftHeld` for its leave-the-overlay gesture — reuse it rather than adding a second modifier listener. A plain drop calls `splitLeaf`/`removeLeaf` on the tree only; the child list is untouched.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(spread): drag re-arranges tiles; only shift-drag-out detaches a file"
```

---

### Task 7: Browser verification

**Files:**
- Create: `_spreadmosaic.mjs` (repo root; `_*.mjs` is gitignored)
- Modify: `client/src/ui/CLAUDE.md`, `client/src/modules/CLAUDE.md`

- [ ] **Step 1: Probe on live data**

Model on `_spreadgrid.mjs` (takes `CREDS_FILE`, `PAGE`, `SEL`, `NTH`; mint a fresh JWT — probe tokens last 7 days). Report:
1. a 4-file spread opens as 2×2 with no gaps;
2. dragging a tile re-arranges it, and it is still there after a reload;
3. a pane splitter drags without the tile's own drag handle hijacking it (**spec verification #1**);
4. collapsing a pane does not detach the file — it comes back (**spec verification #2**);
5. shift-drag-out does detach;
6. zero page errors.

- [ ] **Step 2: Screenshot and LOOK**

A tiling layout is a visual claim. This surface has now been settled by looking four times; do not skip it.

- [ ] **Step 3: Sweep and check integrity**

`cd server && node --env-file=.env scripts/checkGrid.js --grid "poms grid"` → expect **0 errors**. Probing opens spreads, which mints spread pages — confirm no other debris.

- [ ] **Step 4: Record honestly**

Update both CLAUDE.md files with what was measured AND anything not verified. If verification 3 or 4 fails, file it rather than absorbing the fix.

- [ ] **Step 5: Commit and deploy**

```bash
git add client/src/ui/CLAUDE.md client/src/modules/CLAUDE.md
git commit -m "docs(spread): browser verification of the BSP mini grid"
npm run deploy
```

Then verify the deploy the documented way: prod HEAD over SSH, index 200 **with a short retry** (a 502 immediately after `✅ Deployed.` is the pm2 restart window, not an outage), the served bundle's hash matching the local build, and a feature string present in the SERVED asset **with a control that reads non-zero**.

---

## Self-review

**Spec coverage.** BSP mechanism → Tasks 2–5. Shared `MosaicSurface` → Tasks 1–2 (plus the stated abandon-to-copy fallback). Seed from file count → Tasks 3–4. Tree↔child reconcile (§4) → Task 4. Shift-drag-out only → Task 6. CSS grid demoted to fallback → Task 5. Spec verifications 1 and 2 → Task 7. **Not covered here, by design:** the shell generalisation, the "Full screen" radial item, panel fold-in and sibling cycling — Phase 3, its own plan, as the spec's build order states.

**Placeholders.** Tasks 1, 5, 6 give test *names* rather than full bodies, because mounting `GridMosaic` and the spread host requires a context double whose surface the implementer discovers. Each names the exact assertion and the A/B that proves it discriminates. Every step that ships code shows the code.

**Type consistency.** `buildBalancedTree(ids, cols)`, `columnsForCount(n)`, `reconcileSpreadTree(tree, childIds)` and the `MosaicSurface` prop names are spelled identically wherever they appear.
