# A third grid mode: canvas — panels anywhere on the screen

**User, 2026-08-19:** *"we need to make a plan to add one more grid mode. we have like regular and
mosaic right now but next we need canvas grid. where we can move a panel anywhere on the screen."*

---

## What exists — measured

```
MODE SELECTION   grid.meta.layoutTree present or absent          Grid.jsx:572, 920
rows x cols      occurrence.placement { row, col, width, height } Occurrence.js:78 (typed schema)
mosaic (BSP)     grid.meta.layoutTree                             helpers/bspTree.js, GridMosaic.jsx
mobile           MobileGridNav (cells) / MosaicMobileNav (1xN)    mobile/MobileGridNav.jsx
panel drag       drop onto a CELL, or drop-to-split on a pane     dropHandlers.handlePanelDrop
free positioning ALREADY EXISTS one level down — a canvas PAGE
                 positions its children by occ.meta.x / meta.y    CanvasContent.jsx
```

### The one decision the existing code already made for us

Converting to mosaic **derives** its tree from the current placements and **never mutates them** —
`GridSettingsTab.jsx:74` reverts with a bare `delete meta.layoutTree`, and its own comment says why:
*"placements were never mutated → rows×cols resumes"*.

**That is the rule this plan follows.** A mode owns its own state and reads the others' as a starting
point only. Get that wrong and switching modes becomes lossy, which is the difference between a mode
people try and a mode people avoid.

---

## Design

### 1. The mode becomes a NAME
`grid.meta.layoutTree ? mosaic : grid` cannot express three. `grid.meta.layoutMode:
"grid" | "mosaic" | "canvas"`, with **the absence of it plus a present `layoutTree` still meaning
mosaic** — every existing grid keeps working without a migration, and the migration that adds the
name is then optional rather than load-bearing.

### 2. Where a free position lives
`placement.x / y / w / h`, added to the existing typed `placement` sub-schema beside
`row / col / width / height`.

- **Not `meta.x/y`**, even though a canvas PAGE already uses exactly that for its children. Those are
  two different owners at two different levels; `placement` is already the answer to "where does this
  panel sit", and it is typed rather than Mixed.
- **Never writes row/col.** Same trick mosaic uses: canvas mode reads them once to seed a layout, and
  from then on writes only x/y/w/h. Switching back to rows×cols is `layoutMode = "grid"` and nothing
  else.
- Stored in **percent of the grid frame**, not pixels. A layout laid out on a 2560px monitor and
  opened on a laptop must not put half the panels off screen. (The graph view already made this
  choice for its own centre/radius and the reasoning is recorded there.)

### 3. What canvas mode has that neither existing mode does: OVERLAP
rows×cols and mosaic both tile — two panels can never occupy the same pixel. Canvas can, and that is
the point of it. So it needs two things neither has:
- **A z-order** (`placement.z`), with click-to-front. Without it, "my panel disappeared" is a support
  question rather than a bug.
- **A bring-to-front that does not fight drag.** Clicking a panel to raise it and clicking inside it
  to use it are the same gesture; raise on pointer-DOWN on the panel chrome, not on any click within.

### 4. Snapping, and why it is not optional
Free positioning produces 3px misalignments that look like bugs. A soft snap (to a coarse grid and to
other panels' edges) with a modifier to defeat it is what makes a canvas layout look deliberate. The
existing `helpers/gridSnap.js` is CELL snapping for the keyboard and is not reusable here — this is a
new pure helper, which is where the tests go.

### 5. Mobile
A phone cannot show a free canvas. The honest options, in order of preference:
- **Canvas is a desktop mode.** On a phone the grid falls back to the existing cell pager, ordering
  panels by their canvas position (top-to-bottom, then left-to-right). Nothing is lost and nothing
  new has to be learnt.
- A pannable/zoomable viewport — the canvas PAGE already has zoom and pan, so the machinery exists,
  but a whole workspace at phone scale is a different problem from one page.

**Pick the fallback.** It reuses a shipped, tested surface; the second option is its own project.

---

## Tasks

### Task 1 — Name the mode
`resolveLayoutMode(grid)` — one function, one place, so no component decides for itself. Legacy
`layoutTree` with no name still resolves to mosaic; a test pins that.

### Task 2 — `placement.x/y/w/h/z` on the schema
Additive and optional, so every existing occurrence is untouched and strict mode stops dropping the
keys (the `Operation.priority` failure this repo already paid for: the seed passed it for months and
Mongoose silently dropped it because it was not declared).

### Task 3 — `helpers/canvasLayout.js` (pure)
Seeding a canvas from placements, percent↔pixel conversion, snapping, clamping into the frame, and
z-order. **Pure, because this is where the arithmetic lives and the arithmetic is what will be wrong.**
Includes the one guard that matters: a panel can never be positioned entirely outside the frame.

### Task 4 — `GridCanvas.jsx`
Absolutely-positioned panels in a relative frame, mirroring `GridMosaic`'s prop contract exactly so
`Grid.jsx` gains one branch rather than a second architecture. Drag by the panel's existing handle;
resize by the existing `ResizeHandle`.

### Task 5 — Drag and drop
`handlePanelDrop` gains a canvas branch: a panel dropped anywhere writes x/y instead of row/col.
**The other drop paths must keep working** — dropping a container or a file onto a panel is unchanged,
and the cell-based drilldown that mints a panel from an empty cell has no meaning here, so canvas mode
needs its own "add panel" affordance (drop on empty canvas → mint there).

### Task 6 — The mode picker
The existing Grid/Mosaic segmented control in `GridSettingsTab` gains a third option, and the convert
path seeds x/y from the current layout so switching in is not a scramble.

### Task 7 — Verification
- Convert grid → canvas → grid and assert **row/col are byte-identical** afterwards. That is the
  whole safety property, and it is the one worth a test more than a screenshot.
- Drive a real drag and a real resize in a browser and **look at it** — this is a visual, gestural
  feature and the unit suite cannot see either.
- Two panels overlapping, click-to-front, at 1440×900 and 390×844.
- `checkGrid` unchanged: this touches placement only, never occurrence structure.

---

## Risks

- **Lossy mode switching** — the one that makes the feature unusable. Task 7's round-trip test is the
  guard.
- **Panels lost off screen** on a smaller monitor. Percent storage plus a clamp; the clamp is the
  belt, since a percent can still be 98%.
- **Drag conflicts.** DragProvider already owns panel/container/instance drags and has been the source
  of several documented regressions; a new free-drag must go through it rather than beside it.
- **Mobile.** Decide the fallback before building, not after — mosaic shipped its mobile story late
  and it took two sessions.

---

## Worth noting

Canvas mode shows far more of the grid's own background than either tiling mode, because gaps are
everywhere rather than only in the gutters. That makes it the mode where the skin work from earlier
today actually reads — and it means the wallpaper scrim may want to be a per-mode value.
