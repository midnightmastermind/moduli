# The spread viewer — design

_2026-08-16. Status: approved, ready for an implementation plan._

> "lets make a plan to fuse the full screen mode and the artifact spread viewer. we want to be able
> to full screen any occurance. so when i click on full screen on an instance, i can see its body
> full screen. so instead of artifact spread viewer, it would be just spread viwer." — user

> "thats what i want, why i think i need a mini grid inside the viewer."

## What this is

`ArtifactSpread` stops being artifact-specific. One overlay — the **spread viewer** — hosts any
occurrence, and what it shows depends on how it was opened. `FullscreenOverlay` is absorbed into it.

**Files and fullscreen are separate contents opened by separate gestures.** This was the decisive
answer and it is what stops the viewer becoming a mode-picker:

| Opened by | Content |
| --- | --- |
| Radial → **Full screen** on an occurrence | The occurrence **rendered as itself**, large. Its body is expanded from there with the instance-body button (see the instance-bodies spec). |
| The **media thumbnail** (today's gesture) | That occurrence's **files**, as the mini grid. |
| Radial → **Full screen** on a panel | The panel — today's `FullscreenOverlay` behaviour. |

> "the files is seperate. it would just show the instance by itself and i would expand to see the
> body of it. the file version is clicked a diff way than the full screen."

## Decisions (user, 2026-08-16)

| Question | Decision |
| --- | --- |
| Placement mechanism for the mini grid | **BSP mosaic** (`helpers/bspTree.js`). |
| Share the mosaic glue or copy it? | **Extract a shared `MosaicSurface`**, used by both `GridMosaic` and the viewer. |
| A spread with no tree yet | **Seed a tree immediately** from the file count, matching the current auto layout. |
| Dragging a tile out | **Plain drag re-arranges; only shift-drag-out detaches** — the gesture the spread already uses for leaving. |
| Panel prev/next cycling | **Generalised to cycle siblings**, not only panels. |
| Entry point for fullscreen | **A radial-menu item.** |

## Architecture

### 1. `SpreadViewer` — the shell

`ArtifactSpread.jsx` renamed and widened. It keeps everything it already owns — backdrop, chrome,
Escape, the open-from-origin animation, shift-to-leave ghosting, board⇄canvas switch — and gains a
`content` discriminator (`"files" | "occurrence" | "panel"`). It still **owns no arrangement**;
that stays the whole point of the file.

`ArtifactSpreadHost` becomes `SpreadViewerHost` and keeps the imperative single-mount pattern
(`openSpreadViewer(occurrenceId, { content, originRect })`), because the call sites are still
popovers and rows that unmount on click.

### 2. The mini grid — extract, don't duplicate

`helpers/bspTree.js` is **already generic**: `computeLayout` / `splitLeaf` / `removeLeaf` /
`resizeSplit` / `findLeaf` move an id around a split tree and never mention panels. 17 tests.

What is panel-specific is the React glue in `GridMosaic.jsx` — `panelByOccId` and `<Panel mosaic>`.
That glue is extracted to **`modules/MosaicSurface.jsx`**:

```
MosaicSurface({ tree, onTreeChange, renderLeaf, splitterThickness })
```

`GridMosaic` becomes a thin caller (`renderLeaf = (occId) => <Panel …>`), and the viewer calls it
with `renderLeaf = (occId) => <the artifact tile>`.

**Why extract rather than copy:** two implementations of one concept drift. This repo's own record
has the alarm builders drifting from their server twin, and *"two identity schemes for one concept,
and the one the header documented is not the one that runs"*.

**Why this is the risky task, stated plainly:** `GridMosaic` renders the ENTIRE grid on mosaic
grids, and on 2026-07-04 it corrupted the seeded layout by reconciling against a transiently-partial
panel set. So its current behaviour is **pinned by tests BEFORE the extraction**, and the extraction
is A/B'd against those pins. If the pins cannot be written, the extraction is abandoned in favour of
a copy rather than shipped on hope.

### 3. Seeding the tree

A spread with no `layoutTree` gets one **on first open**, built from the file count to match the
layout shipped on 2026-08-16 (1 → single, 2 → two columns, 4 → 2×2, otherwise 3 across). New helper
`buildBalancedTree(ids, cols)` in `bspTree.js`, beside the existing `deriveTreeFromPlacements`.

Consequence, accepted: every spread that is opened acquires a stored tree. That is the point of the
decision — one layout path rather than two — and it is what makes "drag a tile and it stays there"
work from the first interaction.

Stored at **`spreadOcc.meta.layoutTree`** — same key and shape as `grid.meta.layoutTree`, on the
overlay-only page the spread already mints. `meta` is Mixed, so no schema change.

**The CSS auto-grid shipped today (`data-count` / `--spread-cols`) is retired for the files view**
once seeding lands, because a seeded tree always exists. It stays only as the render path for a
spread whose tree fails to resolve — a fallback, not a second layout.

### 4. Tiles vs the tree — two lists that must not disagree

The spread page lists its files in `occurrences[]`; the tree places ids. These can diverge:

- **A file present in `occurrences[]` but absent from the tree** (a new attachment, or a picture
  replaced by a migration) is **added to the tree** on open — the same additive top-up the host
  already does for the child list.
- **An id in the tree that is no longer a child** is **dropped from the tree**.
- **Collapsing a pane never detaches a file** — it unplaces it, and the reconcile above puts it
  back. Detaching is shift-drag-out only.

This reconcile is the analogue of `GridMosaic`'s own panel reconcile, and it carries the same
warning: reconcile against the AUTHORITATIVE child list, never against what happens to be rendered.

### 5. Sibling cycling

The chevrons generalise. **Siblings = the occurrences listed by the same parent, in parent order.**
For a panel that resolves to the grid's panels, so today's behaviour falls out of the general rule
rather than being special-cased. Cycling preserves the current content mode: cycling from one
instance's files lands on the next instance's files.

An occurrence with no resolvable parent (the spread page itself is parented to nothing) shows no
chevrons rather than cycling through something arbitrary.

### 6. Entry point

A **"Full screen"** item in the occurrence's radial menu, beside the existing "Toggle doc". The
media-thumbnail gesture keeps opening the FILES content, unchanged.

## What is NOT changing

- The board⇄canvas switch stays; canvas remains free x/y.
- Textblock minting, saving, abandoning.
- Linked-group propagation.
- `bspTree.js`'s existing exports and their semantics.
- The instance-bodies work — this spec consumes its button, it does not modify it.

## Verify, do not assume

1. **A BSP pane can host an artifact tile without the two drag surfaces fighting.** A pane splitter
   and a tile's own drag handle are both pointer-drag surfaces. `GridMosaic` already solves the
   equivalent for panels (splitter drag vs panel drag), so the pattern exists — but it must be
   observed here.
2. **`removeLeaf` collapsing a pane does not strand the artifact.** The child list and the tree are
   separate; §4 is the rule, and it needs a real check, not a reading.
3. **Panel fullscreen still cycles after the fold-in.** The generalised rule must reproduce the old
   behaviour exactly for panels.

## Risks

- **`GridMosaic` is load-bearing.** Mitigated by pinning before extracting, and by abandoning the
  extraction for a copy if the pins cannot be written.
- **Every opened spread gains stored state.** Accepted deliberately; it is what the seeding decision
  buys. Worth a note that a spread page is overlay-only, so this state is cheap and invisible
  elsewhere.
- **Two overlays becoming one** means the panel path and the occurrence path share chrome. Panel
  cycling is the behaviour most likely to be quietly lost; it gets its own check.

## Out of scope

- Persisting which content mode an occurrence was last opened in.
- Any change to how files are uploaded, homed, or deleted.
- Making the body itself full-screen-only — the body is expanded inside the viewer with the existing
  button.

## Build order — three phases, not one plan

This spec is too big for a single implementation plan: it contains a risky refactor of a
load-bearing renderer, a new placement surface, and a shell generalisation. Each phase below ends
in working, shippable software and gets its own plan.

**Phase 1 — extract `MosaicSurface`.** Pin `GridMosaic`'s current behaviour with tests, extract the
glue, make `GridMosaic` a thin caller. **User-visible change: none.** That is the point — it is the
de-risking step, and if the pins cannot be written the phase ends by choosing the copy instead.

**Phase 2 — the mini grid in the files spread.** `buildBalancedTree`, seed on first open, the
tree↔child-list reconcile, drag-to-rearrange, shift-drag-out to detach. **User-visible: you can
arrange the tiles and they stay put.** This is the thing that was actually asked for.

**Phase 3 — the viewer generalises.** Rename to `SpreadViewer`, the `content` discriminator, the
"Full screen" radial item, absorbing `FullscreenOverlay`, sibling cycling. **User-visible: any
occurrence can be full-screened.**

Phases 1 and 2 are planned together (Phase 1 ships nothing on its own, so gating a review on it
would be a review of a refactor with no behaviour to check). Phase 3 gets its own plan.
