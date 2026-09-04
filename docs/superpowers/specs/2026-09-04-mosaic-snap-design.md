# Mosaic snap — Windows-style panel snapping for the BSP layout

_Design, 2026-09-04. Approved in conversation; not yet implemented._

## The problem

A grid in **Mosaic** mode (`grid.meta.layoutTree` present) has two gaps the
rows×cols mode does not:

1. **No keyboard path at all.** `Grid.jsx:801` reads
   `if (isMobileLayout || layoutTree) return;`. This is not a preference — the
   only snap implementation we have, `helpers/gridSnap.js`, operates entirely on
   `occurrence.placement` (`{row, col, width, height}`), and Mosaic does not use
   placements. Its arrangement lives in the tree; the placements sit frozen from
   before the conversion. An ungated handler would read and write numbers nothing
   renders.

2. **No grid-level drag target.** Every drop is resolved against whichever *pane*
   the pointer is over (`MosaicPane`'s `attachClosestEdge`), so you can say "put
   this below Routines" but never "give this the whole right side."

User, 2026-09-04:

> i expect that if i drag a panel (the browser), all the way to the right side in
> the middle, it would change it to the way i described. if i drag it right top,
> it would open it up there, right bottom, open it down there, etc. […] keyboard
> should follow suit with the arrows […] it should work kinda like how the
> windows key movement works on windows.

## What this is not

The corner `ResizeHandle` is **not** coming back in Mosaic. It drives
`panel.width` / `panel.height` in whole cells, measured against
`gridRect.width / cols` — quantities Mosaic does not have (its Rows and Cols
inputs are hidden for the same reason). Snapping is the Mosaic equivalent, and it
subsumes what the handle did: "extend this panel to the full right side" becomes
one keystroke instead of a drag across cells.

## Model: region snap

The focused panel is snapped to a **region of the whole grid** — a half or a
quadrant. Everything else is packed into the complement, keeping its relative
arrangement.

Two models were considered. **Tiling move** (i3-style: an arrow moves the panel
one position through the tree, with growing on separate keys) is more predictable
at eight panels, but it does not deliver the thing that was asked for — `Right`
would shuffle a panel one slot rather than give it the right half. **Region snap**
matches the described behaviour and, as shown below, makes the user's own example
a consequence of one rule rather than a special case. Its honest weakness is many
panels: past four or so, "the right half" stops uniquely describing an
arrangement and the complement packing becomes a judgement the code makes for
you. If that ever bites, the growth path is to keep the arrows as region snap and
put tree-move on `Shift+Ctrl+Alt+Arrow`, so both verbs exist without overloading
one key.

### Regions are derived, never stored

A panel's current region is computed from the tree — where its leaf sits relative
to the root — and is never written to the grid. Stored region state would drift
the moment someone drags a seam, and the arrows would then act on a state that no
longer matches what is on screen.

```
region = { col: "left" | "right" | "full",
           row: "top"  | "bottom" | "full" }
```

`full` on an axis means "unconstrained on that axis" — the panel spans it.

### What each arrow does

**Left / Right always set the column.** One press crosses to the other side and
pushes the rest over.

**Up / Down set the row, with one addition:** pressing the arrow *opposite* to
your current row constraint **releases** it back to `full` rather than crossing —
but only when you are in a **quadrant** (that is, the column axis is also
constrained). From a plain top half, `Down` sets the bottom half, because
releasing there would leave the panel with no region at all and the press would
read as broken.

```
full-height right  + Up    → top-right           set the row
top-right          + Down  → full-height right   release the row
top-right          + Up    → (nothing)           already there
top-right          + Left  → top-left            axes are independent
full-height right  + Left  → full-height left    walks across
```

Bottom-right is therefore `Down` twice from top-right — release, then set. This
is the one place the two axes read differently. It is deliberate: it is what the
user described, and it means the common "give me my whole column back" is a
single keystroke rather than a trip through the opposite corner.

Pressing a direction you already occupy is a **no-op**, not an error and not a
maximise.

### Building the tree for a region

Let `REST = removeLeaf(tree, panelOccId)` — `removeLeaf` already collapses splits
left with a single child, so the remaining panels close the gap on their own.

**Halves** are direct:

| region | tree |
|---|---|
| `col: right` | `makeSplit("v", [REST, leaf])` |
| `col: left`  | `makeSplit("v", [leaf, REST])` |
| `row: bottom`| `makeSplit("h", [REST, leaf])` |
| `row: top`   | `makeSplit("h", [leaf, REST])` |

**Quadrants** need the complement divided, and the rule is that **`REST`'s own
top-level split supplies the partition.** For a quadrant with `row: top`,
`col: right`:

- If `REST` is an `h` split (rows), its **first child** becomes the top-left
  neighbour and the **remainder** becomes the full-width bottom:
  `makeSplit("h", [ makeSplit("v", [REST.children[0], leaf]), <rest of REST> ])`
- If `REST` cannot be divided that way — it is a leaf, or a split on the wrong
  axis — the quadrant **degrades to the half the panel already had**: the
  newly-pressed axis is dropped, the existing constraint is kept, and `snapLeaf`
  returns `null` (nothing moves). It does **not** fall back to the half for the
  axis just pressed — that would silently discard the column the user had
  deliberately set. No split is ever invented to make a quadrant fit.

The user's own case is exactly the first branch:

```
before   v[ h[Routines, Trackers] , Browser ]      Browser full-height right
press    Ctrl+Alt+Up
after    h[ v[Routines, Browser] , Trackers ]      Browser top-right,
                                                   Trackers full width below
```

Ratios for a newly created split are even — `makeSplit` defaults to
`children.map(() => 1)` when no ratio is passed. Existing ratios inside `REST`
are preserved, since `REST` is carried as a subtree rather than rebuilt.

## Components

### `helpers/mosaicSnap.js` (new, pure)

The sibling of `helpers/gridSnap.js`, which is the same policy for rows×cols.
`bspTree.js` stays what it is — split-tree math — and snap sits above it, because
"what does *right* mean" is policy, not geometry.

```
regionOf(tree, panelOccId) → { col, row } | null
snapLeaf(tree, panelOccId, direction) → tree | null
```

`direction` is `"up" | "down" | "left" | "right"`. **`null` means nothing
changed** — an unknown panel, a no-op press, or a tree of one leaf — so neither
caller has to decide what a no-op looks like, and neither writes to the grid.

It builds only from existing `bspTree` exports (`makeSplit`, `makeLeaf`,
`removeLeaf`, `findLeaf`, `isLeaf`). No new primitives are required.

### `Grid.jsx` — the keyboard path

The early return becomes a branch: `layoutTree` → `mosaicSnap.snapLeaf` and
persist; otherwise the existing `gridSnap.snapPanelInDirection`. Everything else
about the handler is kept, including the guard that ignores the chord while focus
is in an `INPUT` / `TEXTAREA` / `contentEditable` — a chord that hijacks arrow
keys mid-sentence is worse than no chord.

The target is `lastPanelIdRef`, which already exists (a capture-phase
`pointerdown` on anything carrying `data-panel-id`) and already drives the
rows×cols path. Nothing new is needed to know which panel is focused — only to
show it.

Persisting reuses `GridMosaic`'s existing path shape:
`CommitHelpers.updateGrid({ grid: { meta: { ...meta, layoutTree: next } } })`.
The whole `meta` is spread, because a partial write would drop every other key on
it.

### Focus outline

Holding `Ctrl+Alt` outlines the panel that is about to move; it clears on keyup
or once an arrow fires. This is the entire "select a panel" mechanism — no
picker, no numbering. A picker would add a step to every snap for the common case
of "I just clicked this thing and now I want to move it," and Windows does not
ask either.

### `GridMosaic.jsx` — the perimeter zones

A band inset from the grid's outer edge, three zones per side: the middle third
gives the half for that side, the two ends give the quadrants. Release **inside**
the band and today's behaviour is unchanged — `handlePaneDrop` resolves the
closest edge of whichever pane is under the pointer and splits it.

Both gestures survive, and that is deliberate: perimeter snap can say "the right
half" but never "below Routines specifically," which is the gesture that builds
nested layouts and the one that fixes the layout this conversation started with.

The four corners of the band belong to two sides at once — the top zone of the
right band and the right zone of the top band. Both resolve to the same quadrant,
so the overlap needs no tie-break.

The band previews the region it would produce, in the same spirit as the existing
`EdgeHint` on panes. Drop → `snapLeaf` → `persist`, the same two calls the
keyboard makes.

A pane-relative drop and a perimeter drop must never both fire for one release.
The perimeter band is a sibling drop target that sits above the panes and
`canDrop`s the same `DragType.PANEL`; when the pointer is inside it, it is the
innermost target and wins.

## Testing

`mosaicSnap` carries the coverage, because it is pure and it is where being wrong
is invisible:

- every direction from every starting region (`full/full`, each half, each
  quadrant), asserting the resulting tree shape;
- the quadrant partition — that `REST`'s first child becomes the neighbour and
  the remainder spans;
- **degrade-to-half** when `REST` is a leaf or splits on the wrong axis — the
  case that would otherwise invent a split;
- the release rule: opposite arrow on a constrained axis returns to `full`;
- no-ops return `null` — pressing a direction you already occupy, an unknown
  panel id, a single-leaf tree;
- ratios inside `REST` survive a snap.

Each guard is A/B'd with the mutation asserted to land before the result is
believed.

**Stated rather than implied:** the two wirings — the `Grid.jsx` branch and the
`GridMosaic` perimeter target — are a few lines at seams no test mounts, the same
call this repo makes for `canHaveBody` and `dropEdgeAttr`. They will need a
browser to verify, and the honest gap will be recorded as such.

## Out of scope

- Touch. `snapPanelToEdge` already gives tablets a drag-to-edge variant for
  rows×cols; whether Mosaic wants the same is its own question.
- Mobile. `MosaicMobileNav` pages one panel at a time and has no notion of
  regions.
- `Shift+Ctrl+Alt+Arrow` tree-move. Named above as the growth path if region snap
  proves too blunt at high panel counts; not built.
