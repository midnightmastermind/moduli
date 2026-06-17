# Unified block-wrap redesign — real-float "tetris" wrap with a draggable seam

_2026-06-12. Status: IMPLEMENTED (design confirmed by user "thats perfect"; code landed
2026-06-12 — 216 server + 1113 client tests pass, build clean, mechanism validated in a
headless-chromium harness; **in-app glance still pending** for the live ResizeObserver +
seam pointer-drag). Supersedes `2026-06-11-floated-lead-aside-design.md` (the ghost-spacer /
absolute-overlay / floated-aside approach the user rejected). Scope: client wrap rendering
rework + importer neighbor shape + CSS + re-import migration._

## Implementation notes (what actually landed)

- `WrapGroup` child order flipped to **neighbor-first, host-last** (the load-bearing fix —
  CSS floats only wrap following content; verified host-second never wraps).
- `WrapGroupNode` rewritten: floats the neighbors, measures the float → `--wrap-host-clip`
  CSS var on the host card, renders a draggable seam writing `neighborWidth`. `syncNotch` +
  the spacer/overlay effects deleted.
- `WrapSpacerExtension` deleted; `wrapNotch` reduced to the pure `notchClipPath` helper;
  `TextblockCard`/`ModuleContainer` dropped the spacer-measure hook; `wrapGroupOps` host =
  lastChild + `isNeighborMember`; `Editor` + importer emit `[neighbor, host]`; importer sets
  `neighborWidth` (320 lead / 260 section).
- **The shape is DYNAMIC (not just L).** `WrapGroupNode` pushes the floated neighbor DOWN by
  `margin-top` = the host's block offset at `anchorIndex`, so the prose runs full-width ABOVE
  the notch, wraps beside it, and reclaims full width below — continuously L → C → hangman as
  `anchorIndex` rises; `side` flips left↔right for J. The clip `notchClipPath({...,y})` traces
  whichever shape (the measured float top = `y`). Validated for L/C/J in `~/.wraptest2/shapes.html`.
  `anchorIndex`/`side` change by dropping the neighbor on a host line — `Editor.detectSideHost`
  handles the in-group re-morph (drop lands inside the isolating wrapGroup → recompute
  side + the host line via `blockIndexAtY`).


## Why the old mechanism was rejected

Today's wrap (`wrapGroup` + `wrapSpacer` + `useWrapNotchClip`) produces what the user
called "a picture frame with multiple frames on it" — frame-in-frame, not two
interlocking tetris pieces. Three causes, all stemming from the ghost-spacer model:

1. **Ghost-spacer in the host's data.** `WrapGroupNode.syncNotch` measures the
   neighbor and writes a sized `wrapSpacer` node INTO the host occurrence's
   `textmap.content`. The host's prose reflows around that invisible float — so the
   neighbor's footprint is duplicated into the host's persisted data, and the host's
   text vacates a hole.
2. **Absolute-overlay neighbor.** The real neighbor card is then `position:absolute`
   placed OVER that reserved hole (`.wrap-group--on … :nth-child(n+2)` → `position:
   absolute; top: var(--notch-y)`). So the neighbor sits *on/inside* the host
   rectangle rather than *beside* it.
3. **No live resize.** Width is whatever the neighbor renders at; there's no seam to
   drag, so the user can't tune the split the way they tune grid columns.

The user's instruction: *"rethink how we do it if the way we are doing it with the
ghost spot is blocking this."* It is. Throw out the ghost-spacer + absolute overlay.

## Target (confirmed, with the user's final ASCII)

```
┌─────────────────┐┃┌───────────┐
│ prose prose pr  │┃│   IMAGE   │
│ prose prose pr  │┃│  artifact │
│ prose prose pr  │┃│  caption  │   ← caption lives INSIDE the image artifact
│ prose prose pr  │┃└───────────┘
│ prose prose pr  │┃
│ prose prose pr  └╂──────────────┐  ← seam ends where the neighbor ends;
│ prose prose prose prose prose   │     below that it's full-width prose
└─────────────────────────────────┘
                   ┃
          grab the ┃ and drag ← → to resize the two columns;
          prose re-wraps live as it moves
```

Locked decisions (from the design dialogue):

- **Two separate occurrences, never nested.** Host = a textblock (the prose). Neighbor
  = a container holding an image artifact (+ an infobox table, for the lead case) —
  OR, for a plain section image, just the bare image artifact. Both stay independent,
  separately-draggable occurrences.
- **Host = one L-shaped occurrence.** Its border traces the L (turns the corner around
  the notch). The neighbor is its OWN box, OUTSIDE the host's L border, sitting in the
  notch. The **seam is where the two borders meet.** Do NOT encapsulate the neighbor
  inside the host's border.
- **Native wrap.** The host's prose wraps around the neighbor for real (the neighbor is
  a `float` in the host's own flow), so the prose reclaims full width once past the
  neighbor's bottom. No fixed paragraph count — purely height-driven.
- **Caption inside the artifact.** Image + its centered caption are one box (the image
  artifact occurrence), not a separate textblock.
- **One mechanism, used everywhere** — the lead image+infobox case and every section
  image use the exact same wrap. The only difference is what's in the notch (a bare
  image artifact vs. a container of image+infobox).
- **Draggable seam = grid-column resize, repurposed.** Same splitter-drag interaction
  as the mosaic/grid column resize: grab the vertical bar, drag ←→, live update. The
  only difference is *what the drag writes* — instead of a grid track ratio it sets the
  **neighbor's float width**, and the prose re-wraps natively as it moves.

## Mechanism — real float, no ghost, no overlay

The `wrapGroup` NodeView co-renders the host's prose and the neighbor in **one block
formatting flow** so the neighbor can `float` and the host's prose line-boxes shorten
beside it natively (and reclaim full width below it). Concretely:

- The neighbor embed renders as a **`float:<side>` box of width `W`** as the FIRST
  child of the wrap flow; the host embed renders after it. The host card is a normal
  block box (NOT a BFC / not `flow-root`), so its inline line-boxes wrap around the
  float while its border-box stays full width — then we **clip the host card's border
  to the L** (reuse `wrapNotch.js`, but measure the *float's* box, not a spacer).
- The neighbor keeps its **own border** (its card chrome) and sits in the notch
  outside the host's clipped L edge. The visible seam is the gap between the host's
  clipped edge and the neighbor's border.
- **No `wrapSpacer` is ever written to the host's textmap.** The float lives in the
  wrapGroup's render layer only; the host occurrence's data is untouched ("data
  decoupled"). The width `W` is a wrapGroup attr (see below), not host data.

### Width / seam

- New `wrapGroup` attr **`neighborWidth`** (number px, nullable → default e.g. 300).
  `WrapGroupNode` applies it as the float's width.
- A **splitter element** rendered on the seam (between the prose column and the
  neighbor). Pointer-drag updates `neighborWidth` live via `updateAttributes` (throttled
  to animation frames). Min/max clamp (e.g. 120px … 70% of the wrap width). The host's
  prose re-wraps natively on each width change — zero measuring races.
- Reuse the existing column-splitter feel; the drag handler is small and local to
  `WrapGroupNode` (it writes one attr). It does NOT need `bspTree` — that's grid-track
  math; here the drag writes a single px width.

### Anchor (L vs C) stays

`anchorIndex` / `anchor` still position the notch down the host (L at top, C mid-flow,
J on the other side). With a real float this is just *where in the host flow the float
is inserted* — the float at block-index `k` makes the prose above it full-width and the
prose from `k` onward wrap. Keep the drop-to-reposition + side-flip wiring in
`ui/Editor.jsx` unchanged in spirit; it now writes `anchorIndex`/`side` to the group,
and the NodeView inserts the float at that index instead of writing a spacer there.

## Changes

### Client

1. **`docs/WrapGroupExtension.js`** — add the `neighborWidth` attr (number|null,
   `data-neighbor-width`). Keep `side` / `anchor` / `anchorIndex` / `wrap`.

2. **`docs/WrapGroupNode.jsx`** — the core rework:
   - DELETE `syncNotch` and everything that writes a `wrapSpacer` into the host
     textmap. DELETE the neighbor ResizeObserver→spacer measure effect and the
     `--notch-y` measure effect (the float needs no JS positioning).
   - Render the neighbor stack as `float:<side>` boxes of width `neighborWidth`
     inserted into the host's flow at `anchorIndex` (top→front, middle→mid, null→coarse
     `anchor`). The host embed renders in the same flow after/around the float.
     *(Implementation note: because host + neighbor are separate sub-editors today, the
     float must share the host's containing block. Render the floated neighbor as a
     sibling INSIDE the same `.wrap-flow` block as the host card, with the host card as
     a non-BFC block box so its line boxes wrap. Verify in-browser — this is the load-
     bearing CSS assumption.)*
   - Add the **seam splitter** (pointer-drag → `updateAttributes({ neighborWidth })`,
     rAF-throttled, clamped). Splitter only renders when `wrap` is on and there's ≥1
     neighbor.

3. **`docs/wrapNotch.js`** — keep `notchClipPath` (the L/C/J polygon formula is
   correct). Change the measure source in `useWrapNotchClip`: measure the **floated
   neighbor's** box within the host card's containing block (its offset + `neighborWidth`
   + measured height) instead of `.wrap-spacer`. The clip formula is unchanged; only
   what feeds `{w,h,y,side}` changes.

4. **`docs/WrapSpacerExtension.js`** — DELETE the extension and its registration in
   `ui/Editor.jsx` (extensions array + import). No more ghost node. Per
   `feedback_no_fallbacks`: remove it cleanly, no back-compat shim. (Re-import / load
   strips any persisted spacers — see migration.)

5. **`helpers/wrapGroupOps.js`** — `unwrapGroupAt` / `detachGroupMember` currently also
   strip the host's `wrapSpacer`. With the spacer gone, drop that branch (collapse to
   plain sibling embeds only). `findGroupMember` is unchanged.

6. **`ui/Editor.jsx`** — drop the `WrapSpacer` import + registration. `detectSideHost` /
   `wrapHostWithNeighbor` / drop-reposition wiring stay, now passing `neighborWidth`
   through on group create (default when null). Remove any spacer-strip on unwrap.

7. **`index.css`** — replace the `.wrap-group--on … position:absolute` overlay rules
   with the float layout: `.wrap-flow` containing block, neighbor `float:<side>` at
   `neighborWidth`, host card non-BFC. Keep the neighbor's own-border rule and the
   "drop the side-info in a narrow notch" rules. Add `.wrap-seam` splitter styling
   (`cursor: col-resize`, thin bar, hover/active states — mirror the grid splitter).

### Server (importer)

8. **`server/services/markdownImporter.js`**
   - **Neighbor shape:** the wrap neighbor for the LEAD is a container of
     **[image artifact (caption inside) + infobox table]**; for a section image it's
     the **bare image artifact**. Today `buildAsideContainer` already mints the
     lead container (`meta.leadAside`) — keep it but ensure **image-first, infobox-
     second** and that the caption is set on the image artifact (not a sibling
     textblock). `buildSectionBody` already folds a section image into a `wrapGroup`
     with the adjacent prose as host — keep that; it now just needs the new
     `neighborWidth` default on the emitted group (or leave null → client default).
   - The lead: emit a `wrapGroup` with host = the lead prose textblock and neighbor =
     the aside container (instead of the floated standalone embed the rejected spec
     introduced). Same `wrapGroup` shape as section images — one mechanism.
   - Do NOT emit any `wrapSpacer` (the importer never did; just confirm).

### Migration

9. **Re-import** is the clean path (established pattern). Persisted articles carry the
   old shape (possibly a `wrapSpacer` in a host textmap from a prior load). On load,
   the client simply ignores unknown `wrapSpacer` nodes once the extension is removed —
   they won't render (TipTap drops unknown nodes) — and a re-import produces the new
   shape. No textmap migration script.

## Out of scope

- Multi-image asides / multiple neighbors stacked is already supported by the
  `moduleEmbed{2,}` content model; the seam resizes the shared `neighborWidth`.
- Responsive collapse of the neighbor under the prose at very narrow widths (float
  degrades acceptably; revisit only if it reads badly in-browser).
- Per-occurrence persisted width (width lives on the wrapGroup node attr in the host's
  doc, which is where the wrap relationship lives — sufficient).

## Verification

- **Importer unit tests** (`server/__tests__/markdownImporter.test.js`): lead emits a
  `wrapGroup` whose host is the lead prose textblock and neighbor is the aside container
  (image-first, infobox-second, caption on the image); section image emits a `wrapGroup`
  (host = adjacent prose, neighbor = bare image); no `wrapSpacer` anywhere; aside members
  excluded from main flow.
- **Client build + existing test suite** stays green after deleting `WrapSpacer` /
  `syncNotch`.
- **In-browser glance** (ResizeObserver + float + clip-path + pointer-drag aren't
  unit-testable — block-wrap has always been verified this way): fresh import of a
  Wikipedia article → host prose wraps the neighbor as an L (full width below it);
  host border traces the L; neighbor is its own bordered box in the notch, outside the
  host border; caption centered under the image inside the artifact; **drag the seam →
  neighbor widens/narrows and prose re-wraps live**; flip side (L↔J) still works; unwrap
  (drag neighbor out) returns both to plain rectangles.
