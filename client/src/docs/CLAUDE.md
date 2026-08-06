# client/src/docs — Docs CLAUDE.md

_Updated: 2026-07-13. Check this file before re-reading source._## Recent Changes (2026-08-06 — wrapping was measuring a host that had not mounted; and the policy was width-inverted)
User, after the oscillation fix: *"now its not wrapping at all"*, then *"why would i want to stack at
large sizes"*. Both were right, and they were **two separate bugs** — measured per group on the
Eminem page, not reasoned about.

- **THE DOMINANT ONE: the host's text was invisible to the measurement.** `TextblockCard` mounts its
  TipTap editor LAZILY (IntersectionObserver, 700px) and paints a plain
  `.textblock-card-placeholder` until then, but `measure()` looked for `.ProseMirror` only. So every
  host below the first screen returned `hostProse = null` → `textArea 0` → `decideWrapStack`'s
  "blank host — nothing to wrap" → **STACK, permanently**. Measured: **17 of 18 groups reported
  textArea 0 while holding 2580-3826 real characters**; the one that wrapped was the only one in the
  viewport at load. The wrap is a fact about the text's geometry, not about which component is
  rendering it, so the lookup now falls back to the placeholder.
- **THE SECOND ONE: `decideWrapStack` was width-inverted.** It compared the predicted beside-prose
  height against a FRACTION of the neighbour's height — and `predicted = textArea / besideW` FALLS as
  the column widens, so the same text beside the same infobox stacked as the panel got WIDER. Real
  numbers, one host, one infobox: beside 584 → 467px → 0.40 → wrapped; beside 1184 → 230px → 0.30 →
  stacked; beside 2000 → stacked. **CLAUDE.md 2026-07-11 recorded this exact inversion in the rule
  the sliver policy replaced** — the replacement kept the shape and only shrank the constant, so it
  inherited the bug. Now WIDTH decides, the way round everyone expects: a column wide enough to read
  wraps, a narrower one stacks (`WRAP_MIN_PROSE_W` + a 20px re-entry margin), plus the two
  non-proportional rules that were never the problem — a blank host stacks, and under ~2 lines of
  prose beside the neighbour stacks. `WRAP_SLIVER_*` are retired (kept as exports, documented).
- The rendered blank-band guard in `WrapGroupNode` carried the SAME inversion
  (`neighborH * WRAP_SLIVER_KEEP` demanded 265px of text beside a 757px infobox, which a wide column
  can never produce) and would have reimposed it through the back door — it is absolute now
  (`WRAP_MIN_BESIDE_H`), which is what its own comment always described.
- **Result on the page, measured: 2 of 18 groups wrapped → 16 of 18**, identical at 2560/2200/1900/
  1600/1300/1000, all 18 at 800, and **0 wrap-class mutations in 3 idle seconds** at every width (the
  oscillation stays fixed). The 2 that still stack have a 182-character host — under two lines beside
  their neighbour, which is the rule working. Narrow viewports (500/390) still stack most groups.
- **A NOTE ON THE INVARIANT NOW PINNED IN TESTS:** `wrapAnchor.test.js` sweeps the beside column from
  the readable floor to 2600px for five neighbour heights and fails if a group that wrapped ever
  stacks again. That property — *wider is never more stacked* — is what both of these bugs violated.

## Recent Changes (2026-08-05 (6) — the wrap group OSCILLATED: a neighbour height projected from the wrong layout)
- **User: the Eminem page "starts flipping out … it doesn't know if the image should be full screen
  or wrap, it keeps switching between the two, rapidly."** Measured on the live page in Firefox:
  **46-64 wrap-class mutations per 3 IDLE seconds** (~20 flips/sec) at every wide width.
- **ROOT CAUSE — `WrapGroupNode.measure()` fed the decision a different neighbour height in each
  state, so the two states disagreed forever.** While WRAPPED the neighbour floats at
  `neighborWidth`, so its height is measured directly. While STACKED it renders FULL WIDTH, and the
  code projected the wrapped height by inverse scale (`measuredH * neighborWidth / measuredW`).
  That assumes height falls as width falls — true for a fixed-ASPECT box like a lone image, FALSE
  for the Wikipedia lead aside, which is an image stacked over an INFOBOX TABLE. **A table gets
  TALLER as it narrows.** Numbers off the page: stacked read 2482×1182 → projected **152** at the
  320px float; the real wrapped height was **757**. Five times out.
- That gap changed the ANSWER, not just the precision: 152 is under `WRAP_SHORT_NEIGHBOR_H` (280),
  so the group took the short-neighbour exemption and wrapped; at 757 the sliver policy stacked it
  again; the flip re-fired the ResizeObserver → wrap/stack/wrap **17ms apart**, forever.
  `decideWrapStack`'s hysteresis could not damp it — hysteresis compares ONE signal against two
  thresholds, and here the signal itself swung 152 ↔ 757 between the states.
- **FIX — `wrapAnchor.resolveNeighborHeight` (NEW, pure).** Remember the height last measured WHILE
  WRAPPED and reuse it while stacked. The float's width does not change with the group's, so that
  height is a fact about the neighbour, not about the current layout. The projection survives only
  to bootstrap a group that has never been wrapped, and the memory is discarded when the seam is
  dragged to a new float width. The remembering side is guarded on `|measuredW - neighborWidth| ≤ 2`
  so a mid-transition read (neighbour still full width, class already flipped) is never stored.
- **A/B, DOM-level (MutationObserver, no instrumentation in the loop): 46/56/64 flips → 0/0/0** at
  2560/2000/1600. 6 tests in `__tests__/resolveNeighborHeight.test.js` pin the real numbers,
  including the disagreement itself (stacked-height says WRAP, wrapped-height says STACK).
- **Behaviour note, not a regression:** at wide widths this page's lead aside now settles STACKED.
  That is the sliver policy's own call (prose predicted 127px beside a 757px infobox = 17%, well
  under the 35% wrap threshold) — before the fix it was flickering, and the "wrapped" frames were
  one half of the flip. If it should wrap there instead, that is a `WRAP_SLIVER_*` threshold
  conversation, not this bug.

## Recent Changes (2026-08-05 (3) — InstanceTextblockNode: empty click-minted blocks remove themselves)
- **`pills/InstanceTextblockNode.jsx`** — new `handleEmptyBlur` (wired to DocContent's
  `onEmptyBlur`): the sub-editor lost focus while still empty → replace the node with a plain
  empty line and drop the data. **Only a PROVISIONAL block vanishes** (`isProvisionalTextblock`) —
  a textblock the user deliberately created via the + menu or a drop and left empty is theirs to
  keep. No `.focus()` in that transaction: the user moved away on purpose.
- **New `dropOccurrenceData`** — one place deciding how a textblock's data goes away:
  `discardProvisionalTextblock` (local, never emitted) when the block has no server row, else the
  normal `removeOccurrence` emit. Used by the radial delete, the backspace collapse and the blur
  removal, so none of them can emit a delete for an id the server has never seen.
- **`handleNavigateBack(deleteIfEmpty)` calls `suppressTextblockMint()`** before collapsing the
  block — the caret lands on the restored empty line, which is what the caret-entry mint watches
  for, so without it backspace re-creates the block it just collapsed (A/B-verified).

## Recent Changes (2026-07-13 — inline chip caret: Firefox fix (round 2 of f2e89136))
- **`pills/InstanceTextblockInlineNode.jsx`** — two changes:
  (1) the Pragmatic mount stamps `draggable="true"` on the chip wrapper; it's now DISARMED at
  rest (`el.draggable = false` right after registration) and the radial drag handle's onPointerDown arms
  BOTH the attribute (Firefox drags key off it) and `-webkit-user-drag: element` (Chromium)
  for the duration of the press.
  (2) new `placeCaretFromPoint` on the content span's onClick: Firefox suppresses native caret
  placement under ANY draggable ancestor (instance-wrap/container-shell — which the chip can't
  disarm), so the chip places its own caret via caretPositionFromPoint. Skipped when the user
  made a RANGE selection (drag-select / double-click word-select survive); no-op on Chromium.
  Verified headless FF: mid-chip click → offset 10, typing inserts mid-text ("Ran ✅ for X25…");
  Chromium regression clean (offset 13).

## Recent Changes (2026-07-12 LATE — simplify-audit: fused prose walk + shared textmapped predicate)
- **`wrapAnchor.js`** — new exported `isTextmappedModule(mod)` (role textblock OR kind:doc
  container): THE "can this host morph" predicate, consumed by Editor.isTextmappedHost AND
  ModuleEmbedNode's wrap-toggle gate (was copy-pasted in both).
- **`WrapGroupNode.jsx`** — `proseTextArea` replaced by `measureProseText(prose, bandTop,
  bandBottom)`: ONE TreeWalker pass returns both the line-box area (sliver prediction) and the
  blank-band reach (rendered guard) — measure() previously walked every text node TWICE per
  ResizeObserver tick. The measure callback reuses the component's `columnsMode` (the local
  `isColumns` re-derivation is gone).

## Recent Changes (2026-07-12 — wrap attr RESTORED: wrap ↔ COLUMNS + seam swap button)
Per user ("we want to be able to set it as a wrap or not; we had all of this and it got removed"):
- **`WrapGroupExtension.js`** — `wrap` attr re-added (default true, `data-wrap-mode`). true = the
  L-float morph; false = plain side-by-side COLUMNS (`.wrap-group--off` flex CSS, which survived).
- **`WrapGroupNode.jsx`** — `columnsMode = attrs.wrap === false`: skips the sliver auto-stack
  policy + rendered band guard (meaningless for non-prose), but still STACKS AT LOW WIDTH
  (`besideW < WRAP_MIN_PROSE_W`, +20px re-enter hysteresis — per user "should also stack at a low
  width"). The seam render gate now includes columns mode (`wrapped || columnsMode`; it was
  `wrapped`-only, which hid the seam in columns). New **`.wrap-seam-swap`** button (⇄, hover-shown,
  mid-seam) flips `side` — per user "a button where the resize col thing is, for swapping the cols".
- **`ModuleEmbedNode.jsx`** — the existing radial "Wrap: on↔off" toggle (it had been writing a
  deleted attr into the void) is now gated on the HOST being textmapped: non-text groups are
  columns-only, no toggle. Host looked up via `operationsBridge.getLocalOcc` (non-subscribing —
  inside the items memo).
- **`ui/Editor.jsx` `detectSideHost`** — non-textmapped hosts NO LONGER bail: edge-third hovers
  return `columnOnly: true` (middle third keeps meaning plain insert so row reordering isn't
  hijacked); wrapHostWithNeighbor/wrapMoveBeside create the group with `wrap: !columnOnly`.
  E2E-verified on the seeded logo group: swap flips sides both ways, radial toggle → real columns
  render (side-by-side, no morph), seam+swap present in both modes, wrap 6/6 formation regression
  clean. Groups: neighbor column stacks N occurrences (schema `moduleEmbed{2,}`); host is one block.

## Recent Changes (2026-07-11 LATE — wrap: SLIVER policy replaces all-or-nothing fill (pure decideWrapStack))
User: "wrap only works between two width points — stacks too late when shrinking AND wrongly
stacks at bigger widths; stack ONLY when the top band is blank or holds just a small amount of
text; bigger should always wrap." Measured root cause: the 2026-07-10 fill rule
(`textArea/besideW ≥ neighborH × 1.0`) is width-inverted — widening the panel SHRINKS the
predicted beside-prose height, so the same text that wrapped at medium width flipped to stacked
at large width; and the 60px `MIN_PROSE_W` floor kept shredded ~84px columns wrapped when
shrinking (the 2026-07-09 21:56 screenshots show both: a hyphen-shredded narrow column, and a
completely BLANK beside band the old prose-box guard missed because the prose element extends
below the neighbor).
- **`wrapAnchor.js`** — new PURE `decideWrapStack({textArea, besideW, neighborH, prevStacked})`
  (8 unit tests): stack when blank, when `besideW < WRAP_MIN_PROSE_W` (160 — was 60, stacks much
  sooner when shrinking), when under `WRAP_MIN_BESIDE_H` (44px ≈ 2 lines) beside the neighbor, or
  when the predicted beside-prose is a SLIVER of the neighbor height (< 35% wrapped / 45% to
  re-enter — hysteresis). Short neighbors (≤280) still always wrap. Long text × tall infobox now
  KEEPS wrapping at large widths (65% fill wraps; the old rule demanded 100%).
- **`WrapGroupNode.jsx`** — `measure` consumes `decideWrapStack`; the empty-band guard is
  rewritten to measure TEXT RECTS inside the [neighbor top..bottom] band (not the prose BOX
  bottom) so the rendered blank-column case actually stacks; fires only while wrapped, skipped
  for short neighbors. Old FILL_WRAP/FILL_KEEP/EMPTY_BAND_TOL/MIN_PROSE_W/SHORT_NEIGHBOR_H
  constants moved/renamed into wrapAnchor (WRAP_*).
- Verified: width sweep (`_wrapsweep.mjs`, now 2-phase incl. a forced-620px tall neighbor) —
  seeded logo wrap ON at besideW 322/226, stacks at 149/84 (was wrapped down to 84); tall+small-
  text stacked everywhere (correct sliver). `_wrap6mouse` 6/6 drops still form/re-morph groups.
  1235/1235 client tests. Thresholds are single constants (WRAP_SLIVER_* / WRAP_MIN_PROSE_W) —
  tune there if the user wants different feel.

## Recent Changes (2026-07-11 — wrap: SHORT-NEIGHBOR exemption (restores the seeded logo⇄description wrap))
- **`WrapGroupNode.jsx`** — the all-or-nothing fill rule had the seeded Viafluere logo⇄description
  group stacked at every normal panel width (measured: fill 0.63 at wrapW 562 — the description
  prose can never fill the 155px logo's height in a wide beside column; it only wrapped in the
  narrow window fill≥1.0 && besideW≥60). User 2026-07-11: "the first occurances in the viafluere
  doc is not wrapped like it was before … i would like the wrap back." New `SHORT_NEIGHBOR_H = 280`:
  a neighbor whose union height ≤ 280px (~a paragraph) skips BOTH the fill prediction and the
  empty-band guard — the band it could leave is bounded by its own height, which reads as a normal
  magazine float, not the "half text / empty text" tall-infobox problem the rule exists for. Tall
  neighbors (Wikipedia infobox) keep the all-or-nothing behavior unchanged. `MIN_PROSE_W` still
  stacks short neighbors when there's no room for a prose column at all. Verified headless
  (probe `_wrapregress.mjs`): logo wraps at viewport 1600 (fill 0.68, previously force-stacked)
  and 1280; stacks only at 331/262px wrap widths where the 260px logo leaves besideW < 60.

## Recent Changes (2026-07-10 — wrap: direct empty-band guard (fixes "narrow → half/empty text" not stacking))
- **`WrapGroupNode.jsx` `measure`** — the fill PREDICTION (`textArea/besideW ≥ neighborH`) is
  layout-invariant and correct for a static neighbor, but a Wikipedia INFOBOX (image + multi-row
  table) lays out TALLER than an earlier measure predicted, so `fills` stayed true and the wrap kept
  an empty band beside the lower neighbor (user: short textblock beside a taller infobox → "half
  text then empty text; it should just stack"). New **direct empty-band guard**: while already
  WRAPPED (`!prevUnwrap`), read the ACTUAL host prose bottom vs the neighbor union bottom; if the
  prose ends `> EMPTY_BAND_TOL` (24px) ABOVE the neighbor bottom, force `nextUnwrap` (stack). It
  measures the rendered symptom, so it can only ADD a stack — a genuinely-filling wrap has the prose
  reaching PAST the neighbor (negative band) → never fires. Skipped while stacked so the stacked→wrap
  direction stays prediction-driven (no flicker). Verified headless (local server on Atlas): the
  seeded long-host wrap is byte-identical across a width sweep (stacks wide, wraps at besideW=84,
  band −138 → guard silent); forcing the neighbor tall (min-height 900) flips a wrapped group to
  `auto-stacked` and settles (no oscillation). NOTE: the separate "drop a block BELOW a short host →
  it lands at the TOP above the neighbor" is a `detectSideHost` drop-classification issue, NOT this
  guard — still open.

## Recent Changes (2026-07-10 — wrap is ALL-OR-NOTHING (fill-based, replaces the width heuristic))
- **`WrapGroupNode.jsx`** — the auto-unwrap decision is now FILL-based, not width-based (user:
  "all or nothing like nerf" — resizing the Eminem file showed full / mini-filled / empty phases;
  only the full one should wrap). New pure `proseTextArea(prose)` = summed area of the host's text
  line-box client rects (layout-invariant: same total whether the prose wraps beside the float OR
  is full-width when stacked). `measure` computes `predictedProseH = textArea / besideW` (the prose
  height if laid out in the beside column) and STAYS WRAPPED only when it reaches the neighbor's
  full height: `predictedProseH ≥ neighborH × (stacked ? FILL_WRAP 1.0 : FILL_KEEP 0.9)` (hysteresis
  band). `MIN_PROSE_W` is now a 60px floor (a thinner beside column always stacks). Removed the old
  `REWRAP_HYST`. The neighbor union box is measured FIRST (needed for `neighborH`), then the fill
  decision, then the seam/notch. Both inputs are layout-invariant so widening re-wraps (no
  self-lock). Verified in-browser (live grid, 9 wraps): every WRAPPED state has the prose reaching
  past the neighbor bottom (no empty band); short-prose / narrow cases are `stacked`. Class
  `wrap-group--auto-stacked` + `data-wrap: on|stacked|off` (CSS in client/src/CLAUDE.md) unchanged.

## Recent Changes (2026-07-09 LATE — prose keeps PROSE_PAD inside the seam line)
- **`WrapGroupNode.jsx`** — `SEAM_GAP` (14, wall AT the prose edge) split into `FLOAT_GAP = 18`
  (the float's CSS margin toward the prose — index.css updated to match) = `PROSE_PAD = 8`
  (host-bg inset between the text and the seam line) + `CHANNEL = 10` (page-bg between the seam
  line and the neighbor). Per user: prose/link chips were extending INTO the seam / col-resize
  line. The clip wall + seam now sit CHANNEL from the neighbor instead of at the prose edge.

## Recent Changes (2026-07-09 — notch includes the float's bottom-margin band)
- **`WrapGroupNode.jsx` `measure`** — `notchH` now adds `BOTTOM_GAP` (14px): the gap band directly
  UNDER the floated neighbor is carved out of the host background too, so it shows the PAGE bg
  (it used to show the host textblock's tint — per user, "looks off / image looks inside the
  textblock"). Prose reclaims full width only below bottom+BOTTOM_GAP, so nothing clips; the seam
  element already spanned the same band. Paired index.css polish in client/src/CLAUDE.md
  (host prose padding + quieter image-neighbor card).

## Recent Changes (2026-07-06 — doc pills read computedValues via useComputedValuesMap)
- **`hooks/useDocFieldValues.js` + `pills/ExprPillNode.jsx`** — computedValues now come from
  `state/computedValuesStore.useComputedValuesMap()` (whole-map subscription — these consumers
  scan arbitrary keys) instead of `GridLiveContext`. Same re-render cadence as before for
  these files; part of the per-key store migration (client/src/CLAUDE.md).

## Recent Changes (2026-07-06 — line-level (anchorOffset) wraps clip + classify the correct band)
- **`wrapAnchor.js`** — two new pure helpers (unit-tested in `__tests__/wrapAnchor.test.js`):
  `hasMidAnchor({anchorIndex, anchorOffset})` (true when the wrap anchors below the host top —
  line-level `anchorOffset` is authoritative when present; legacy `anchorIndex > 0` fallback) and
  `classifyWrapShape({anchorIndex, anchorOffset, neighborBottom, hostBottom, threshold=24})` →
  `"top" | "middle" | "bottom"`.
- **`WrapGroupNode.jsx` `measure`** — notchY + shape classification now consume those helpers.
  BUG FIXED: the old inline logic read **legacy `anchorIndex` only**, so every line-level wrap
  (`anchorOffset > 0`, `anchorIndex` null — the post-2026-06-17 shape) got `notchY = 0` and
  `shape-top`: the host-background clip cut the TOP band instead of the band the neighbor
  actually floats in. Verified headless against the live-grid Eminem import (wrap flipped to
  `anchorOffset:150`): `notchY 148px` / `shape-middle`, clip band flush with the floated image
  (`screenshots/wrap-midanchor-probe.png`); DB state restored after the probe.

## Recent Changes (2026-07-03 — wrap channel shows PAGE bg: clip wall + seam moved to the prose edge)
- **`WrapGroupNode.jsx` `measure`** — `--notch-w` and the seam `left` both moved from
  `SEAM_GAP/2` (mid-channel) to the FULL `SEAM_GAP`: the host-bg clip wall and the seam's
  column-rule line now sit at the PROSE column's edge, so the ENTIRE 14px channel between
  the wrapped occurrences shows the page background (user: "make the color between the
  wrapped occurances be the background color of the page … right now its the color of the
  wrapped textblock"). Coupled move — the visible line still borders the clipped bg edge
  exactly, and the `::after` notch-bottom line still spans wall→host outer edge (both
  shifted by the same 7px). Pairs with index.css dropping the float's 6px OUTER margin
  (see client/src/CLAUDE.md) so the neighbor's border aligns flush with the host's
  full-width bottom bar (was "overextending past the borders").

## Recent Changes (2026-06-17 — LINE-LEVEL wrap morph: anchorOffset (px) replaces anchorIndex)
- **`wrapAnchor.js` (NEW)** — pure, unit-tested geometry: `sideFromFrac(frac)` (no dead middle —
  `<0.5`→left else right) + `anchorOffsetForDrop({dropY, hostProseTop, lineTops})` (px offset, snapped
  to the nearest visual-line top at-or-above the drop). Tests in `__tests__/wrapAnchor.test.js`.
- **`WrapGroupExtension.js`** — new `anchorOffset` attr (px|null, `data-anchor-offset`).
- **`WrapGroupNode.jsx` `measure`** — `--wrap-mt` now comes from `anchorOffset` (px) directly when set
  (line-level), falling back to the legacy `anchorIndex`→block-top only for old nodes. `measure` dep +
  the `shape` first-guess both consider `anchorOffset`. (`BOTTOM_GAP` extends the seam below the neighbor
  so the bottom-bar's top border has margin above the image.)
- See `ui/CLAUDE.md` for the `Editor.jsx` `detectSideHost` hoist + the per-line drop highlight. Plan:
  `docs/superpowers/plans/2026-06-17-line-level-wrap-morph.md`.

## Recent Changes (2026-06-16 — WrapGroupNode: position-named shape class (top/middle/bottom) for shape-adaptive borders)
- **`WrapGroupNode.jsx`** — adds `wrap-group--shape-{top|middle|bottom}` (+ `data-shape`) to the
  NodeViewWrapper. Naming is POSITION-based (per user) = where the neighbor sits vertically × `side`
  (left/right gives the mirrored forms — no separate "J/backward" name). `top` (anchorIndex 0) notches
  the TOP corner; `middle` notches a mid-edge (prose above AND below); `bottom` = neighbor reaches the
  host bottom → upside-down L (prose above + beside, none below). `top`/`middle` are guessed from
  `anchorIndex` at render; the real classification (esp. `bottom` vs `middle`) is MEASURED in `measure()`
  (`measuredShape` state) by comparing the neighbor's bottom to the host's bottom (`<24px` → bottom).
  Lets index.css draw the inner-L lines per shape (clip + seam `::before`/`::after`). See client/src/CLAUDE.md.

## Recent Changes (2026-06-15 LATE-3 — `WrapGroupNode.jsx`: restyle (no notch) + `anchorIndex`→margin-top C/J shapes)
- **Restyle:** host L-border + clip-path REMOVED (chrome moved to the infobox box + a seam column-rule
  line — see client/src/CLAUDE.md). `WrapGroupNode` no longer measures a notch; the neighbor measure
  now only sizes the resize seam (+ its column-rule line) — timed backstops kept for that.
- **C/J shapes via `anchorIndex`:** `anchorIndex` (set on drop by `Editor.detectSideHost` /
  `blockIndexAtY`, and on re-morph drag via `setNodeMarkup`) was never applied. `WrapGroupNode.measure`
  now computes the float's `margin-top` = `host.blocks[anchorIndex].top − holderTop` and sets it as
  `--wrap-mt` (consumed by the neighbor rule in index.css). anchorIndex 0 → L (float at top); mid-block
  → C (prose full-width ABOVE the float, beside it in the middle, full-width below); `side:"left"`/
  `"right"` gives J. STABLE (no loop): blocks above the anchor are full-width, so the anchor block's top
  doesn't depend on the float position. `measure` deps gained `node.attrs.anchorIndex` so re-morph
  drags re-measure. Verified live: C-shape float lands below the first text line; left-side float puts
  text on its right + reclaims full width below. Drag-drop column FORMATION (`wrapHostWithNeighbor`/
  `wrapMoveBeside`, `wrap:true`) was already wired — both sides + any drop line now flow correctly.

## Recent Changes (2026-06-15 LATE-2 — `WrapGroupNode.jsx`: notch re-added for the L-BORDER (measured from the card) + chip-drop gap fix)
- **`WrapGroupNode.jsx`** — re-added `--notch-w`/`--notch-h` measurement, but now measured FROM THE HOST
  CARD (the clip-path's coordinate origin) against the neighbor's real edges: `notch-w = card.right −
  neighbor.left` (right side) / `neighbor.right − card.left` (left side); `notch-h = neighbor.bottom −
  card.top`. Drives ONLY the clip-path that traces the host border into an L (the wrap itself is still
  the native float — no measurement). Added timed backstop re-measures (120/400/1000/2200/4000ms)
  because a Wikipedia infobox TABLE lays out after the ResizeObserver's last fire (notch read short:
  774/802 vs real 1290). Safe from loops — the notch only drives a clip-path (paint), so re-measuring
  never changes the measured neighbor.
- **Chip-drop gap** (CSS, see client/src/CLAUDE.md) — `.instance-textblock-inline` is `display:inline`
  inside the wrap host so wide link chips wrap in the column instead of dropping below the float.
- Verified vs live grid: gap closed (in-column jump 850→24px), notch correct (407/1290), no text clip.

## Recent Changes (2026-06-15 LATE — L-wrap FIXED: removed redundant pseudo-float + clip-path; `LWrapHost.jsx` DELETED)
The active wrap path is `WrapGroupNode.jsx` + `index.css .wrap-group--on` (the CSS cross-sibling
float), NOT `LWrapHost.jsx`. `LWrapHost.jsx` was orphaned during account2's revert to the
"working-with-gap" state (nothing imported it) — **DELETED**. The entry below claiming it's the
DEFAULT is stale/superseded.
- **Root cause of the two gaps (verified with a Playwright measure against the live grid):** the
  BFC-chain neutralization (`index.css:2587–2613`) had already made the real neighbor float wrap the
  host prose natively (correct L, transition at the float's true bottom, NO measurement). But the
  PRE-native mechanism was never removed — a `.ProseMirror::before` pseudo-float (`--notch-w`×
  `--notch-h`) AND a clip-path were still active, double-reserving space. The pseudo-float stacked
  *below* the neighbor and pushed the full-width transition ~`notch-h` px too far down (the bottom
  gap + "crazy amount of words in the column"); the clip-path — keyed to a `--notch-h` that measures
  short before the infobox lays out — clipped the right edge of the column text and left an empty
  bordered band beside it (the right-of-column gap + "cuts off the right side when I resize bigger").
- **Fix:** removed the `::before` pseudo-float + both clip-path polygons from `index.css`; removed
  the `--notch-w`/`--notch-h` setProperty calls from `WrapGroupNode.jsx` (kept the neighbor measure,
  which the resize seam still needs). The native float now does the whole L with zero measurement.
  Measured before/after: transition y 2247→1445 with neighbor bottom 1434 (exact native wrap-under).
  Client rebuilt (`npm run build:client`) + re-verified in the shipped `client/dist` the server serves.

## Recent Changes (2026-06-15 — native-float "magazine" L-wrap (`LWrapHost`) — SUPERSEDED; LWrapHost deleted)
The L-wrap (longer text flowing beside-then-under a shorter image) is a NATIVE browser thing —
CSS `float` (+ `shape-outside` for non-rectangular shapes) — the same primitive every magazine/
news site uses. No package/measure/split/ghost needed. The ONLY reason the old CSS L was fragile:
the host text rendered as a NESTED editor box (`.ProseMirror` ≈ a BFC) and a float can't wrap a
separate block box. Fix = render the host content as PLAIN inline flow in the SAME container as a
by-reference float of the neighbor.
- **`LWrapHost.jsx` (NEW)** — tiny textmap→React renderer (paragraphs / headings / lists / marks +
  link chips) rendered in one flow with the floated neighbor → browser produces the L and reflows
  natively (window / panel / column resize) with zero layout JS. Both stay separate OCCURRENCES;
  only this display combines them. Handles BOTH neighbor kinds: a bare `artifact/image` (section
  images) AND the Wikipedia lead **aside** `container` (image stacked over an `InfoTable` read of
  the infobox `kind:"table"` occurrence).
- **Editable** — clicking the prose calls `onEditHost` → `WrapGroupNode` flips `editing`, reveals
  the real nested host editor (`NodeViewContent`, hidden behind the L otherwise so ProseMirror keeps
  its doc model) + focuses it; `focusout` of the whole group reverts to the freshly-edited L.
- **Column resize** — `LWrapHost` renders a `col-resize` seam on the figure's INNER edge; drag
  sets the float width live (prose re-wraps natively) and persists via `onResize` →
  `updateAttributes({ neighborWidth })`.
- **Default now** (not flag-gated) — fires on any 2-child wrapGroup whose neighbor is an image OR a
  container; a non-matching neighbor falls back to the old CSS path. **Remaining edge:** multi-
  neighbor groups (childCount > 2 — several stacked section images) still use the fallback.

## Recent Changes (2026-06-15 — inline mini-textblock = 3-zone chip; wrapGroup seam un-gated from `wrap`)
- **`pills/InstanceTextblockInlineNode.jsx` — rewritten to a 3-zone chip** per user spec:
  `[radial drag handle][ editable content (text cursor) ][ ↗ open ]`.
  - **Drag ONLY from the handle** — Pragmatic DnD `draggable({ element: wrapper, dragHandle:
    handleRef })`. The handle span is always in the DOM (stable dragHandle ref) but the
    `RadialMenu` inside it LAZY-MOUNTS only while hovered (`hovered` state) — a doc full of
    chips pays nothing at rest. Radial item: Remove (`deleteNode`).
  - **Middle is always contenteditable** (text cursor) — commits to the occurrence textmap on
    blur / Enter; Escape reverts. `onMouseDown` stopPropagation so a click edits instead of
    ProseMirror node-selecting the atom (that selection scrolled the chip into view = the
    "click moves the doc / have to click twice" bug).
  - **Right ↗ arrow opens the target** in ONE click (`window.open` for URLs, `jumpToOccurrence`
    for in-app targets); `mousedown` preventDefault+stopPropagation so the editor never steals
    the first click. `→` glyph for occurrence links.
  - Corners less round: chip now uses the base `.instance-textblock-inline` 4px radius (was a
    999 pill); long chips stay ONE inline-block pill (wrap internally / move as a unit — no
    mid-word split flush against the column edge, so the old `box-decoration-break` hack is gone).
  - CSS: new `.instance-textblock-inline--zoned` + `.itbi-handle/.itbi-content/.itbi-arrow`
    (+ `itbi--url`/`itbi--occ` tint) in index.css; old `--link`/`-edit`/`-text` rules now dead.
- **`WrapGroupNode.jsx` — column resize seam un-gated from `wrap`.** The draggable seam (the
  COLUMN resize handle) was only rendered/measured when `node.attrs.wrap === true`, but the
  importer emits wrapGroups as `wrap:false` (two-column mode) → the handle was "gone." The
  measure already reads the live neighbor box (works for both the flex two-column layout AND the
  L-float), so dropped the `!wrap` early-return + the `wrap &&` render gate. Seam now shows
  whenever there are ≥2 members + a measurable neighbor, in both modes. `measure` deps `[wrap,
  side]`→`[side]`. (The L-shape `wrap:true` rework is still open — see below.)

## Recent Changes (2026-06-12 — ModuleEmbedNode: alignStyle default reverted flow-root → plain block)
- **`ModuleEmbedNode.jsx` (`alignStyle`)** — the `default` (full-width) case returned
  `{ display:"flow-root", width:"auto" }` (a BFC, added 2026-06-11 so a SINGLE textblock could
  narrow beside a floated aside). But a BFC does NOT wrap a float across MULTIPLE blocks — it
  shrinks each block beside the float instead of letting prose flow under it. The Wikipedia lead
  aside is now a parent-level float (server/CLAUDE.md) with several prose textblocks flowing down
  the left, so the prose embeds must be **plain (non-BFC) blocks**: changed to `{ width:"auto" }`.
  Safe — normal full-width embeds are visually identical (a plain block fills the width with no
  float present), and wrapGroup hosts override via `.wrap-group--on …:last-child{display:block!important}`.
  Pairs with the importer's front-float aside + `.is-lead-float` CSS (client/src/CLAUDE.md +
  modules/CLAUDE.md). Headless-validated against the real card cascade. Build clean.

## Recent Changes (2026-06-12 — block-wrap REDESIGN: real float, no ghost spacer, draggable seam)
Spec: `docs/superpowers/specs/2026-06-12-unified-block-wrap-redesign.md` (account2's approved
design — user said "thats perfect"). Replaces the rejected ghost-spacer / absolute-overlay
model. Mechanism validated in `~/.wraptest2/` against the real CSS selectors + @tiptap DOM.
- **`WrapGroupExtension.js`** — child order FLIPPED: NEIGHBOR(s) are children 0..N-2, HOST is
  the LAST child (`hostOccId = node.lastChild`). **Neighbor-first is load-bearing** — a CSS
  float only wraps content AFTER it; host-second never wraps (proven in the harness). New
  `neighborWidth` attr (px|null) sets the floated column's start width. **Shape is DYNAMIC**
  via `anchorIndex` → the floated neighbor's `margin-top` (= host block offset at that index):
  0 → L, mid block → C/hangman, `side` flip → J; the clip `y` follows the measured float top.
- **`WrapGroupNode.jsx` — rewritten.** DELETED `syncNotch` + the wrapSpacer-write + the
  `--notch-y` absolute-overlay effects. Now: neighbors `float` (CSS) and the host's prose
  wraps natively; the NodeView only (1) measures the float box → sets `--wrap-host-clip` on
  the wrap (CSS applies it to the host `.textblock-card`/`.container-shell`), and (2) renders a
  **draggable seam** (`pointerdown` → rAF-throttled `updateAttributes({neighborWidth})`,
  clamped 120px..70%) — grid-column-resize feel; prose re-wraps live.
- **`WrapSpacerExtension.js` — DELETED** (+ removed import/registration from `ui/Editor.jsx`).
  No more ghost node. Per `feedback_no_fallbacks`, clean cut; re-import strips persisted spacers.
- **`wrapNotch.js`** — reduced to the pure `notchClipPath` polygon helper (consumed by
  WrapGroupNode). The spacer-measure hook `useWrapNotchClip` + `findWrapSpacer` removed; the
  two consumers (`modules/TextblockCard.jsx`, `modules/ModuleContainer.jsx`) dropped their
  calls — the clip is now owned by WrapGroupNode via the CSS var.
- **`ModuleEmbedNode.jsx`** — `unwrapGroupAt`/`detachGroupMember` calls drop their (now-unused)
  commit-args (no spacer to strip). Shared ops in `helpers/wrapGroupOps.js` (host=lastChild,
  `isNeighborMember`, spacer-strip removed) — see helpers/CLAUDE.md. Editor/importer flip the
  emitted group to neighbor-first — see ui + server CLAUDE.md. Build clean, 1113 client tests.
  **In-browser glance still needed** (ResizeObserver + seam pointer-drag aren't unit-testable).

## Recent Changes (2026-06-11 — block-wrap is now pure normal-drag: deleted the ⠿ grip, drop-on-line morph, works for ANY textmapped host)
Per user: the section-image wrap (NOT the infobox aside) must be **two separate
occurrences side by side** ("two columns"), the neighbor **outside** the host, the host
just **morphing the bigger column** into L/C/J — moved with the occurrence's **normal
radial-menu drag handle**, NOT a special layout gesture. Applies to **any textmapped host**
(role:"textblock" OR kind:"doc" container), any neighbor; never board/list/table.
- **`WrapGroupNode.jsx`** — DELETED the `⠿` reposition grip (`onRepositionStart` + the grip
  div). `syncNotch` + the neighbor-measure / `--notch-y` effects + `anchorIndex` stay (the
  morph). `updateAttributes` no longer destructured (grip was its only user). The notch now
  moves only via drops (Editor.jsx), never a grip.
- **`ModuleEmbedNode.jsx`** — the `embedDeleteRegistry` entry is now group-aware: a grouped
  embed dragged cross-container `detachGroupMember`s (keeps the group valid / un-morphs the
  host) instead of a bare `deleteNode` that would leave an invalid 1-child wrapGroup. The
  radial "Unwrap" item now calls the shared `helpers/wrapGroupOps.unwrapGroupAt` (one source
  of truth). Dropped the now-unused `updateOccurrence` import.
- New shared ops in **`helpers/wrapGroupOps.js`** (see helpers/CLAUDE.md): `findGroupMember`,
  `unwrapGroupAt`, `detachGroupMember`. Drop-formation/reposition/unwrap-on-move-out wiring is
  in `ui/Editor.jsx` (see ui/CLAUDE.md). CSS grip rules removed; neighbor drag-handle z-index
  added (client/src/CLAUDE.md). Build clean, 1110/1110 client tests. **In-browser glance
  needed** (TipTap drop + ResizeObserver — not unit-testable).

## Recent Changes (2026-06-11 — moduleEmbed: full-width embeds are BFCs so they flow beside a floated aside)
- **`ModuleEmbedNode.jsx` (`alignStyle`)** — the `default` (full-width) case returned
  `{ width: "100%" }`, which forced every prose/textblock embed to 100% width. Beside a
  right-floated sibling (the new Wikipedia lead aside — image+infobox floated right via
  `align:"right"`) a 100%-wide box can't fit, so it dropped BELOW the float instead of
  beside it. Changed to `{ display: "flow-root", width: "auto" }` — a
  block-formatting-context with auto width NARROWS to sit to the left of the float and
  reclaims full width once past the float's bottom (the magazine wrap-under). Visually
  identical for normal full-width embeds (no float present). Pairs with the importer's
  floated-aside change (server/CLAUDE.md) + the `.is-lead-aside` CSS (client modules
  CLAUDE.md). Verified in headless browser: lead textblock cards narrow beside the aside
  (right edge < aside left), full-width below. Client build clean.

## Recent Changes (2026-06-10 — inline link chip preserves the space when it wraps)
- **`pills/InstanceTextblockInlineNode.jsx`** — the inline link chip (`display:inline`)
  ate the space between it and the adjacent words when it wrapped to a new line (a
  bare inline atom collapses the trailing text-node space at the wrap boundary →
  "wordchip" ran together). Added `margin: 0 0.18em` to the chip style so a gap is
  guaranteed on both sides regardless of wrapping. Per user: "we need that space
  character regardless." Build clean.

## Recent Changes (2026-06-10 — block-wrap host GENERALIZED beyond textblock [CLAUDE_CHAT docket item])
The notch-clip logic (find the host's floated `wrapSpacer`, ResizeObserver-measure it,
compute the L/C/hangman/J `clip-path`) lived inline in `modules/TextblockCard.jsx`, so
ONLY a `role:"textblock"` host could notch. Extracted to a shared hook so any host that
renders its textmap through an `<Editor>` can host the wrap — closes the long-standing
docket TODO "Generalize host beyond textblock (any kind:doc occ)".
- **`wrapNotch.js` (NEW)** — exports `findWrapSpacer(textmap)`, `notchClipPath(n)`, and
  `useWrapNotchClip(textmap, cardRef, enabled) → { clipPath, hasSpacer }`. Pure
  relocation of the TextblockCard formula + an external `cardRef` param so two
  renderers can drive it.
- **`modules/TextblockCard.jsx`** — consumes the hook; deleted the inline
  `findWrapSpacer`/`notchClipPath`/measure-effect. Hook now called BEFORE the link
  early-return → stable hook order (fixes a latent rules-of-hooks bug where the measure
  hooks sat after the link `return`).
- **`modules/ModuleContainer.jsx`** — `useWrapNotchClip(containerOccurrence?.textmap,
  containerRef, isDocContainer)` merged into the container-shell `clipPath`. A
  `kind:"doc"` container's textmap carries the floated `wrapSpacer` and renders it inside
  its doc Editor, so the shared measure finds `.wrap-spacer` and clips the shell border
  into the same notch. No-op when there's no spacer / not a doc container. Measured `y`
  includes the container header, so the notch lands below it.
- Build clean. ResizeObserver→clip isn't unit-testable — **needs an in-browser glance**:
  make a doc container the host of a wrapGroup → its own border should bend into the L/C
  around the neighbor, same as a textblock host. Pairs with the dynamic-mosaic grip
  below (the grip's `anchorIndex` flows through the same shared clip now).

## Recent Changes (2026-06-10 — dynamic MOSAIC wrap: continuous notch + drag-reposition + tighter gaps)
Per user: the wrap should be a "dynamic mosaic" — two occurrences as interlocking
tetris/frame pieces, and dragging the artifact re-wraps continuously (L → C →
hangman; either side → J), not just the two `anchor` presets.
- **`WrapGroupExtension.js`** — new `anchorIndex` attr (number|null): the host
  block index the notch sits before. null → fall back to coarse `anchor`.
- **`WrapGroupNode.jsx`** — `syncNotch` inserts the spacer at `anchorIndex` when
  set. New **reposition grip** (⠿, top corner of the neighbor, hover-revealed):
  pointer-drag calls `updateAttributes({ anchorIndex, side })` live — Y maps to the
  nearest host text block (notch follows → L/C/hangman), crossing the group's
  horizontal midpoint flips `side` (L ↔ J). `NEIGHBOR_GAP` 6→3.
- **`WrapSpacerExtension.js`** — float gap 14→6 (tighter text-to-image fit).
- **`index.css`** — `.wrap-reposition-grip` styles (faint at rest, brightens on
  group hover). Needs in-browser interaction test (drag isn't unit-testable).

## Recent Changes (2026-06-10 — ROOT CAUSE: block-wrap notch never rendered in-app (@tiptap/react content wrapper))
**The notch never worked in the real app** (prior sessions fell back to side-by-side
`wrap:false`). Diagnosed in a live headless browser against the imported Eminem page:
all 9 wrapGroups rendered but **0 host textblocks ever got a `wrapSpacer`** → no
reflow, no clip. Root cause: `@tiptap/react`'s `NodeViewContent` nests the child
embeds inside a `[data-node-view-content-react]` holder, so the host/neighbor
moduleEmbeds are **grandchildren** of `.wrap-group-content`, not direct children.
Both the measure JS (`contentEl.children.slice(1)`) and the CSS
(`.wrap-group-content > :nth-child(n+2)`) looked one level too shallow → the
neighbor was never measured, never observed by the ResizeObserver, never positioned
absolutely → `syncNotch` never fired. The prior standalone HTML harness had no such
wrapper, so it "passed" while the app failed.
- **`WrapGroupNode.jsx`** — new `embedEls(contentEl)` resolves the real embeds via
  `:scope > [data-node-view-content-react]` (falls back to `contentEl`). Both the
  neighbor-measure effect and the notch-y effect use it. Also: added an `img.load`
  listener per neighbor so an async-loading image (h=0 until load) re-measures.
- **`index.css`** — wrap-group `:nth-child` selectors now go through the holder:
  `.wrap-group-content > * > :nth-child(n)` (both `--on` notch and `--off` flex).
- **VERIFIED in-browser:** after the fix, 9/9 wrapGroups write a spacer and 9/9 host
  cards clip into the L-notch with the neighbor image positioned in it (was 0/9).
  Two interlocking occurrences: the textblock card clips to the L/C tetris shape; the
  artifact image is its own box in the notch. No re-import needed — the client writes
  the spacer on load. `anchor:"top"`→L, `anchor:"middle"`→C is the drop-position
  dynamic-wrap surface.

## Recent Changes (2026-06-09 — WrapGroup grows to N neighbors; importer now USES it)
The block-wrap primitive held EXACTLY two embeds (host + 1 neighbor). It now holds
a host + ONE OR MORE neighbors that stack down the side, so a bigger block can wrap
around multiple smaller ones. **This also reverses the prior note below that "the
importer intentionally does NOT emit wrapGroups"** — the Wikipedia importer now
folds images into wrapGroups (host = the adjacent prose textblock), including the
lead image wrapping the intro paragraph. See server/CLAUDE.md.
- **`WrapGroupExtension.js`** — `content: "moduleEmbed{2}"` → `"moduleEmbed{2,}"`.
- **`WrapGroupNode.jsx`** — `neighborOccId` (lastChild) replaced by `neighborCount`
  (`childCount - 1`). The neighbor-measure effect now measures the WHOLE neighbor
  stack: it sets each neighbor's inline `top = notchY + cumulativeHeight` (stacking
  them with a 6px gap) and sizes the host notch via `syncNotch(maxWidth,
  totalHeight)`. Single-neighbor behaviour is unchanged (one neighbor → its own box
  at `top:notchY`). The notch-y measure effect's deps swapped `neighborOccId` →
  `neighborCount`.
- **`index.css`** — wrap-group `:nth-child(2)` rules → `:nth-child(n+2)` so EVERY
  neighbor is absolutely positioned on the side (host stays child 1, static); the
  per-neighbor `top` is set inline by WrapGroupNode.
- **`ModuleEmbedNode.jsx` Unwrap** already iterates all children (`grp.forEach`), so
  it splices a host + N neighbors back to siblings without change.
- Build clean. Geometry needs an in-browser glance (TipTap sub-editor +
  ResizeObserver timing isn't unit-testable — consistent with how block-wrap has
  always been verified).

## Recent Changes (2026-06-08 — Block-wrap C-shape (anchor:"middle") + measured notch offset)
Wired the second notch shape (the user's "C" — drop a smaller block at the MIDDLE
of a bigger one → text flows full-width above + below, beside in the middle band,
border traces a C). Also fixed the L's top-padding misalignment by MEASURING the
spacer instead of assuming `y=0`.
- **`ui/Editor.jsx` (`detectSideHost`)** — now also reads the vertical drop zone:
  `vfrac < 0.4` → `anchor:"top"` (L), else `anchor:"middle"` (C). Plumbed through
  `wrapHostWithNeighbor` into the wrapGroup's `anchor` attr.
- **`docs/WrapGroupNode.jsx` (`syncNotch`)** — anchor-aware placement: top → spacer
  at index 0; middle → spacer at `~floor(strippedLen/2)`. Finds/strips the spacer
  ANYWHERE (was index-0 only). New effect measures the spacer's real offset within
  `.wrap-group-content` and sets `--notch-y` so the absolutely-positioned neighbor
  sits exactly over the notch (0 for L, mid-flow offset for C).
- **`modules/TextblockCard.jsx`** — the clip is now MEASURED (ResizeObserver on the
  card + spacer → `{w,h,y,side}`), and `notchClipPath` is ONE unified formula that
  cuts a `[y .. y+h]` notch on `side` (y≈0 → L, y>0 → C). This makes the BORDER
  notch line up with the actual text reflow + the neighbor, padding included.
- **`docs/ModuleEmbedNode.jsx` (Unwrap)** — strips the host spacer wherever it is
  (C puts it mid-content, not at index 0).
- **`index.css`** — `.wrap-group--on` neighbor `top: var(--notch-y, 0px)` (was 0).
- **VERIFIED via headless-chromium harness** (`~/.wraptest/`): all four cases
  (L/C × left/right) render correctly with the exact measure-then-clip logic the
  React code uses — full rows above/below the C notch, border traces the C, neighbor
  centered over the reserved hole. Build clean, 1086/1086 client tests pass. Still
  worth an in-APP glance (TipTap sub-editor timing on first drop) but the geometry
  is confirmed.
## Recent Changes (2026-06-08 — Block-wrap "L-shape": two side-by-side embeds, bigger reflows around smaller [project_block_wrap_l_shape])
User goal (long design back-and-forth): drop one block beside a bigger one in a
doc and have the bigger block's text/border bend into an **L** (notch at top) or
**C** (notch mid-block) around it — WITHOUT nesting. The two stay SEPARATE,
independently-draggable occurrences; this only gives them a shared positioning
context. NOT image-specific — works for any two embeds (textblocks/artifacts/
instances). All client-side:
- **`WrapGroupExtension.js` + `WrapGroupNode.jsx` (NEW)** — TipTap block node
  `wrapGroup`, `content:"moduleEmbed{2}"` — child 0 = HOST (bigger, reflows),
  child 1 = NEIGHBOR (smaller, sits in the notch). `attrs: side / anchor / wrap`.
  The NodeView ResizeObserves the neighbor's box and writes a sized `wrapSpacer`
  to the FRONT of the HOST occurrence's `textmap.content` (host flow reserves the
  notch); strips it when `wrap` is off. `MIN_DELTA=2px` guards write-storms.
- **`WrapSpacerExtension.js` (NEW)** — invisible atom block `wrapSpacer`
  (`{w,h,side}`) rendered as a floated div with `shape-outside:inset(0)` so host
  prose hugs the rectangular notch.
- **`ModuleEmbedNode.jsx`** — radial items: a NEIGHBOR embed offers **Wrap on↔off**
  + **Unwrap** (splices the two embeds back to siblings + strips host spacer); a
  plain embed with a previous-sibling embed offers **Wrap behind previous**.
- **`ui/Editor.jsx`** — drop-beside (`detectSideHost`): a block dropped over the
  LEFT/RIGHT third (frac ≤0.4 / ≥0.6) of an existing top-level moduleEmbed forms
  a wrapGroup (`wrapHostWithNeighbor`) instead of a plain sibling. Routed through
  all three copy/new-embed paths. `WrapSpacer`+`WrapGroup` registered.
- **`modules/TextblockCard.jsx`** — leading `wrapSpacer` in host textmap → card
  clips to an L/C `clip-path` polygon (`notchClipPath`) so the BORDER traces the
  notch.
- **`index.css`** — `.wrap-group` positioning (`--on` overlays neighbor over the
  reserved notch; `--off` plain flex side-by-side).
- **NOTE — importer intentionally does NOT emit wrapGroups.** `markdownImporter.js`
  this session was a comment-only cleanup recording that decision (each imported
  image is its own sibling embed → can't reflow prose beside it; renders
  full-width, user opts into wrap per-embed via the radial menu).
- Verified: build clean, **1082/1082 client + 202/202 server tests pass.** Needs
  in-browser verification (ResizeObserver→spacer sync + clip polygon aren't
  unit-testable). Also this session: **Wikipedia-import flood fix** in
  `client/src/helpers/operationExecutor.js` — unscoped `subjectRole:"instance"`
  onAdd/onDelete triggers now require `_occRole === subjectRole`, so an import's
  many occurrence-creates no longer re-run every tracker per node ("reprints every
  millisecond"). `_occRole == null` falls through to old match-any.

## Recent Changes (2026-06-06 — CRASH FIX: renderBody contract — "(destructured parameter) is undefined")
- **`ModuleEmbedNode.jsx`** — the textblock + artifact embed branches passed the
  BARE component as `renderBody={TextblockCard}` / `renderBody={ArtifactCard}`.
  But `ModuleInstance` invokes `renderBody()` with NO arguments (it's a zero-arg
  closure — see `ModuleContainer.jsx` `renderBody = () => <TextblockCard
  occurrence={occ} module={mod} />`). So `TextblockCard(undefined)` destructured
  `{ occurrence, module }` off `undefined` → React crash "(destructured parameter)
  is undefined", which took down the whole panel during Wikipedia import (the
  imported prose/media render through these embed branches). Both sites now pass
  the closure form `renderBody={() => <TextblockCard occurrence={occurrence}
  module={mod} />}` / `renderBody={() => <ArtifactCard module={mod}
  label={mod.label} occurrence={occurrence} />}`. Build clean.

## Recent Changes (2026-06-06 — embedded textblock/artifact drag handles + inline link chips)
- **`ModuleEmbedNode.jsx`** — embedded `role:"textblock"` now renders through
  `ModuleInstance` (renderBody=TextblockCard) instead of bare `<TextblockCard>`,
  so imported/embedded textblocks get the GripVertical drag handle + radial menu
  (they had none before). Also: imported media artifacts are `role:"artifact"`
  with a media `kind` (image/audio/…) and NO view, so the old
  `mod.kind === "artifact"` branch never matched and they fell to the
  `<Container>` fallback (rendered nothing — the image bug). New routing:
  `occView.viewType === "display"` → ArtifactContent; else `role === "artifact"`
  → ModuleInstance(renderBody=ArtifactCard) (renders + drag handle); else
  Container.
- **`pills/InstanceTextblockInlineNode.jsx`** — when the occurrence carries
  `meta.link`, the inline node renders a clickable CHIP (url → `<a target=_blank>`,
  occurrence → `→` chip) instead of editable text. Chip is `display:inline;
  white-space:normal` so it WRAPS across lines; the whole node is the drag handle
  (existing `wrapperRef` draggable, `canDrag` false while editing). The markdown
  importer emits these for prose `[text](url)` links (see server/CLAUDE.md).

## Recent Changes (2026-05-20 — InstanceTextblockNode body binding gate)
- **pills/InstanceTextblockNode.jsx**: new `bodyBinding` memo at component
  top, computed via `resolveEditorBinding({ occurrence, module, slot:
  "body" })` (from `client/src/state/editorBindings.js`). When set, the
  inner `<DocContent>` is wrapped in `<BoundBody hostOccurrence={occurrence}
  binding={bodyBinding}>` so the textblock body reads/writes the host's
  own `fields[selfField].value` (TipTap JSON for text fields) instead of
  `occurrence.textmap`. Auto-sync via `propagateBoundFieldWrite` fans
  writes out to any sibling occurrence sharing the host's link-field
  value with selfField present. When `bodyBinding` is null the textblock
  falls through to the existing raw `DocContent` path — fully backward
  compatible with every textblock that hasn't opted into a binding.
- **Binding cascade**: `occurrence.meta.bodyLink` →
  `module.meta.bodyLink` → null. The literal string `"clear"` on the
  occurrence opts out of a module-level binding without re-setting it.
  Same shape that `ModuleContainer.jsx` uses for `headerBinding`.
- **Picker UI** lives in `ui/EditorBindingSection.jsx` (mounted in
  `InstanceForm.jsx` Fields tab inside `BodyBindingPicker`,
  textblock-role only). BoundHeader / BoundBody also render a small
  Link2/Unlink2 badge top-right with the bound field's name (linked when
  host's link value has matching siblings; broken otherwise).

## Recent Changes (May 18 2026 — CellEmbedContext fieldFilter → fieldVisibility)
- **CellEmbedContext.js**: `fieldFilter` key renamed to `fieldVisibility` (default null). Semantics unchanged: `{ mode:"show"|"hide", fieldIds:[] }` is the table column's LOCAL override; null = no column override (ModuleInstance falls back to the occurrence's ancestor `fieldVisibility` cascade). Consumed by ModuleInstance.

## Recent Changes (May 15 2026 — HeadingFocus gated on editor focus)
- **HeadingFocusExtension.js**: `decorations(state)` now returns `DecorationSet.empty` unless `editor.isFocused`. Was applying `.heading-focused` (and the `# ` ::before marker) to whatever heading the *default* selection sat in — every textblock sub-editor's doc is just `[heading]`, default selection is inside it, so an unfocused day-page textblock always showed a stray `#`. Added `handleDOMEvents.focus/blur` that dispatch a no-op tx so the marker appears/clears immediately (a pure blur doesn't otherwise re-run decorations). Captures `const extension = this` to read the live editor. General improvement — affects all doc editors (no stray markers when unfocused), matches the extension's stated "only while editing" intent.

## Recent Changes (May 11 2026 — InstanceTextblockNode drag-out)
- **pills/InstanceTextblockNode.jsx**: Wired Pragmatic DnD `draggable({ element: wrapper, dragHandle: handleDiv, getInitialData: () => ({ type: "module", sourceType: "doc", role: "textblock", id: instanceId, occurrenceId, data: instance || …fallback }) })`. Mirrors the InstancePillNode pattern (Apr 6) — pill drags out, copies to target container/grid cell. Drag init is scoped to the `.module-drag-handle` pill so clicks inside the inner DocContent editor still go to text-editing instead of starting a drag. Removed the `draggable={false}` attribute on the outer wrapper that was blocking native drag entirely.
- **index.css (`.textblock-card`)**: Updated to match `.instance-textblock-block` — same `rgba(134,239,172,0.04)` background, 6px radius, identical inner ProseMirror padding. A textblock now looks the same whether it was minted by typing in a doc (renders via InstanceTextblockNode) or by clicking + Textblock in the QuickAddMenu (renders via TextblockCard inside ModuleInstance). Visual parity, same data shape, same drag-out behavior.

## Recent Changes (Apr 15 2026 — Drag-Out from Doc Embeds)
- **ModuleEmbedNode.jsx**: Imports `embedDeleteRegistry`. Registers `deleteNode` keyed by `occurrenceId` on mount (useEffect with cleanup). Passes `embedSourceType="doc-embed"` to both `ModuleInstance` and `Container` children — tells DragProvider the drag source is a TipTap embed node.
- **helpers/embedRegistry.js**: (existing) Simple `Map<occurrenceId, deleteNode>` — DragProvider calls `embedDeleteRegistry.get(occurrenceId)?.()` to remove the embed node on move.

## Recent Changes (Apr 12 2026 — InstanceTextblock: Separate Node Type)
- **InstanceTextblockExtension.js** (NEW): Dedicated TipTap block node `instanceTextblock` for auto-created typing surfaces. NOT a pill. `group: "block"`, `atom: true`, `draggable: false`. `stopEvent` returns `true` for all events from inside `.instance-textblock-block` — prevents outer ProseMirror NodeSelection on atom click (root cause of cursor-to-beginning bug). `insertInstanceTextblock` command.
- **pills/InstanceTextblockNode.jsx** (NEW): NodeView for `instanceTextblock`. Renders only a `DocContent` sub-editor — no pill badge, no radial menu, no drag handle. `handleExitBlock` moves outer editor cursor to after the node via `editor.chain().setTextSelection(pos + nodeSize).focus().run()`. `handleDeleteBlock` removes TipTap node + calls `CommitHelpers.removeOccurrence`. `draggable={false}`, `onMouseDown={e => e.stopPropagation()}`.
- **InstancePillExtension.js** (REWRITTEN — inline-only): Stripped `bodyContent`, `headerLevel`, `showHeader` attrs. Kept `pillDisplay` in `parseHTML` only (backward compat reading old DB data) — not written on new saves. Removed `stopEvent` override.
- **pills/InstancePillNode.jsx** (REWRITTEN — ~185 lines, was 470): Removed block-mode branch entirely (`isBlockMode`, `handleExitBlock`, `handleDeleteBlock`, `blockOcc`, drag handle choreography, `renderTipTapNode`/`renderTipTapContent`, `HEADING_STYLES`, `showHeader`). Now inline-pill only: label badge, Box icon, field value badges, radial menu (5 items), inline label editing, Pragmatic DnD drag-out.

## Recent Changes (Apr 10 2026 — Block Pill Click Position Fix)
- **InstancePillExtension.js**: Broadened `stopEvent` to return `true` for ALL events from inside `.doc-instance-block` (was only stopping events from inside `.doc-instance-block .ProseMirror`). Root cause: clicks on block pill padding/header (outside sub-editor) reached outer ProseMirror → NodeSelection on atom → stole focus → reset sub-editor cursor to position 0 ("beginning of element" bug).

## Recent Changes (Apr 9 2026 — Drag & Cursor Fix)
- **ModuleEmbedExtension.js**: Changed `draggable: true` → `draggable: false`. ProseMirror was treating moduleEmbed nodes as draggable blocks, causing node selection + drag behavior on click. Embeds are still movable via alignment controls and radial menu.
- **InstancePillNode.jsx**: Block pill drag handle cleanup now also intercepts `dragstart` on the wrapper — prevents text-selection drags from hijacking. Added `drop` listener for more robust `draggable` attribute cleanup.

## Recent Changes (Apr 6 2026 — Pill/Embed Conversion)
- **InstancePillNode.jsx**: Added `editor` + `getPos` props (from TipTap NodeView). Added "Convert to Embed" radial menu item (`Maximize2` icon) — replaces the pill with a `moduleEmbed` block node at the same position. Added to `radialItems` array.
- **ModuleEmbedNode.jsx**: Added `editor`, `getPos`, `deleteNode` props. When selected, toolbar now shows "Pill" button (converts embed back to `instancePill` inline node) and "×" remove button alongside alignment controls.

## Recent Changes (Mar 30 2026 — Uniform Module Rendering in Docs)
- **ModuleEmbedNode.jsx**: Now role-aware. Renders `<ModuleInstance>` for instances, `<ArtifactContent>` for artifacts, `<Container embedded>` for containers (was container-only). Added `ModuleInstance`, `ArtifactContent` imports. Reads `viewsById` from context for artifact detection.
- **Impact**: All modules (instance, container, artifact) dropped into docs now render as their real component, not pills.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DocEditor.jsx` | TipTap editor with @ mentions, drag+drop pills, right-click context menu. Extensions: FieldPill, InstancePill, DocLink, PillBackspace, HeadingFocus. | Feb 22 |
| `DocToolbar.jsx` | Formatting toolbar. Buttons: Bold/Italic/Strike/Code, H1-H3, BulletList/OrderedList/Blockquote/HR, Undo/Redo, `@ Field`, `Pill` (text→instancePill), `Unlink` (pill→text), `MD` (export markdown). | **Feb 22 Session 2** |
| `DocContainer.jsx` | Drop target for instances → inserts pills. Debounced save. Occurrence-based doc storage. | Stable |
| `FieldPillExtension.js` | TipTap extension: fieldPill atom node. attrs: fieldId, fieldName, fieldType, occurrenceId, displayMode. | Stable |
| `InstancePillExtension.js` | TipTap extension: instancePill atom node. attrs: instanceId, instanceLabel, occurrenceId. | Stable |
| `DocLinkExtension.js` | TipTap extension: [[brackets]] doc links. | Stable |
| `hooks/useDocFieldValues.js` | Hook: extracts fieldPill IDs from doc JSON, computes live values. **Mar 20: computedValues migrated to GridLiveContext** (was incorrectly reading from GridActionsContext which no longer provides it). Both `useDocFieldValues` and `useFieldValue` hooks fixed. | **Mar 20** |

## Recent Changes (Mar 20 2026 — C4 Context Split Fix)
- **pills/ExprPillNode.jsx**: Migrated `computedValues` from GridActionsContext to GridLiveContext. Was reading empty default (`{}`) since C4 split removed computedValues from GridActionsContext. All expression pills were evaluating field references to `0`.
- **hooks/useDocFieldValues.js**: Same fix — both `useDocFieldValues()` and `useFieldValue()` hooks now read `computedValues` from GridLiveContext. Fixes field pills in docs showing stale/empty computed values.

## Recent Changes (Mar 17 2026 — Editor UX + CommandPalette Close)
- **Editor.jsx**: Block handle ⋮ menu now closes on Escape or any printable keypress, then refocuses editor. Added `blockMenuOpen` to the popup key-handling useEffect condition and dep array.
- **CommandPalette.jsx**: `Enter` with no matching commands now calls `onClose()` (was a no-op). User can now press Enter to dismiss palette when query has no match and continue typing normally.

## Recent Changes (Mar 14 2026 — D3 Doc Pill Drag Out)
- **pills/InstancePillNode.jsx**: Changed Pragmatic DnD payload from `{ type: "instance", fromDoc: true }` → `{ type: "module", sourceType: "doc", role: "instance", id, data: instance, occurrenceId }`. DragProvider's module handler (command-center/pool path) now also accepts `sourceType: "doc"`. Dragging an instancePill out of the TipTap editor onto a container creates a copy occurrence.

## Recent Changes (Mar 14 2026 — D4 Backspace + D10 Turn Into Instance)
- **PillBackspaceExtension.js**: Rewrote backspace handler. All inline pills convert to text on backspace: `fieldPill` → `#FieldName`, `instancePill` → label, `docLink` → label, `exprPill` → `=expr`. `moduleEmbed` (block embed) moves cursor before the node — does NOT delete or convert (use radial menu to remove).
- **Editor.jsx**: Added "Turn into instance" to right-click context menu (shown only when text is selected + dispatch/socket available). Creates a new `role: "instance"` module via `CommitHelpers.createModule`, replaces selection with `instancePill` node pointing to the new module. New module appears as "Unsorted" in Entity Tree. Added `Box` icon import.

## Recent Changes (Mar 14 2026 — D7 Table + D2 Embed + R3 Lock)
- **Editor.jsx**: Added `{ Table, TableRow, TableCell, TableHeader }` from `@tiptap/extension-table`. Registered in extensions array. Table CSS in index.css.
- **Editor.jsx**: Added `showEmbedPicker`/`embedQuery`/`embedPos` state. `handleEmbedTrigger()` fires when `:` is typed after `@`. `filteredEmbedContainers` builds list of container occurrences. `handleSelectEmbed(occurrenceId)` calls `insertModuleEmbed`. Popup renders below cursor.
- **CommandPalette.jsx**: Added `insertTable` command (3×3 table with header row) and `embedContainer` command (inserts `@:` to trigger picker).
- **Container.jsx DocEditorShell**: Changed `editable={true}` → `editable={!isLocked}`. Added lock/unlock button (hover-to-show, 11px). `handleToggleLock` calls `CommitHelpers.updateOccurrence({ locked: !locked })`.
- **server/models/Occurrence.js**: Added `locked: { type: Boolean, default: false }`. Existing `update_occurrence` handler already persists any fields via `{ ...prev, ...occurrence }`.

## Recent Changes (Mar 13 2026 — S6 Expression Pill UX Polish)
- **Editor.jsx**: Added `exprActiveIndex` state + `exprListRef` ref for keyboard nav in expr popup. Added ArrowUp/Down/Enter handling in the popup keydown listener. ArrowUp/Down moves through field list. Enter with active item → inserts that field name; Enter with no selection → inserts full `exprQuery` as formula (multi-field support, e.g. `protein * 4`). `exprActiveIndex` resets to -1 on query change (useEffect). Active item auto-scrolls into view.
- **Editor.jsx**: Updated expr popup UI. Header now shows `= {formula}  ↵ insert` when query is non-empty. Field items highlight on hover/keyboard nav (`data-expr-item` attr for scroll-into-view). "No matches — press ↵ to insert formula" message when no fields match (allows entering raw math directly).
- **evalExpr in ExprPillNode.jsx** was already multi-field capable (regex replaces all word tokens). No changes needed there.

## Recent Changes (Mar 12 2026 — S6 Expression Pills)
- **ExprPillExtension.js** (NEW): TipTap inline atom node `exprPill`. Attrs: `{ expr: "" }`. Commands: `insertExprPill({ expr })`.
- **pills/ExprPillNode.jsx** (NEW): Renders as yellow pill (rgba(250,204,21)). Shows `=expr = result`. Double-click to edit formula inline. `evalExpr()` resolves field names against `computedValues + fieldsById`, then safe-evals arithmetic. Whitelist check before Function() call. Radial menu with Remove action.
- **Editor.jsx**: Added `ExprPill` extension. `=` key triggers expr suggestion popup. Shows filteredExprFields list. Click inserts `exprPill` with `expr: field.name`. Backspace closes. Escape closes.

## Recent Changes (Mar 2026 — Session 3 InstancePillNode Updates)
- **InstancePillExtension.js**: Added `showHeader` attr (default: false). Controls whether block pill shows a label header row.
- **InstancePillNode.jsx**: Added `updateAttributes` prop. Added TipTap JSON → React renderer (`renderTipTapNode` / `renderTipTapContent`) — supports headings (smaller sizes 11→9.5px), bold/italic/strike/code, lists, blockquote, codeBlock, hardBreak, hr. Added `showHeader` toggle via radial menu ("Show Header"/"Hide Header" with Eye/EyeOff icons). Block mode header: shows when `showHeader=true` — compact teal row with label + radial menu, double-click to rename. Radial dot (no-header mode) still shows on hover. Content area: uses `renderTipTapContent` instead of plain text extraction.
- **Editor.jsx**: `stickyToolbar` fix — `overflow-auto` moved from root `doc-editor` div to `doc-editor-wrapper` (content area below toolbar). Root div no longer creates scroll context that breaks `position: sticky`.
- **Container.jsx (DocEditorShell)**: Removed `overflow-auto` from Editor `className` prop (was breaking sticky toolbar).

## Recent Changes (Mar 2026 — InstancePillNode Block Mode Textblock)
- **InstancePillNode.jsx**: Block mode completely redesigned as "textblock" — no label, no icon header. Just: radial dot handle top-left (opacity 0, shows on hover via `showMenu` state), plain text content extracted from `occurrencesById[occurrenceId].textmap` via `extractPlainText()`. Background: `rgba(134,239,172,0.06)` teal-green, border `rgba(134,239,172,0.16)`, borderRadius 6. Padding `6px 10px 6px 20px` (left pad for radial handle). Added `extractNodeText()` + `extractPlainText()` helpers at top of file. Removed block mode header row (icon + label + field pills). `doc-instance-block` className on outer div.

## Recent Changes (Mar 2026 — FieldPillNode Visual Unification)
- **FieldPillNode.jsx**: Completely restyled to match `Field.jsx` compact display pills. Replaced Tailwind PILL_COLORS (mode-based blue/teal/indigo/purple) with a single inline style object (`PILL_STYLE`/`PILL_STYLE_HOVER`) using the neutral teal-green pill: `rgba(134,239,172,0.08)` bg, `rgba(134,239,172,0.25)` border, `rgba(134,239,172,0.85)` text, `borderRadius: 999`, `fontSize: 10`, `fontFamily: "var(--font-mono)"`. Removed mode icon (Pencil/BarChart2). Format is now `name: value` matching Field compact. Unused imports (Pencil, BarChart2) and `resolvedMode` memo removed.
- Field drops into TipTap heading nodes already work via `posAtCoords` + `insertContentAt` in Editor.jsx — no changes needed.

## Recent Changes (Mar 2026 — Doc Instances as Cards)
- **DocContainer.jsx**: Instance drops now default to `pillDisplay: "block"` — instances appear as doc-instance cards, not inline pills.
- **InstancePillNode.jsx**: Block mode completely redesigned. `isBlockMode` is now just `pillDisplay === "block"` (no longer requires `bodyContent`). New design: compact card row matching list-instance visual style — dark background (`rgba(12,53,70,0.38)`), rounded border, instance icon + label + field value pills + radial menu on hover. Double-click label to rename (shared with inline). Field pills in block mode show `fieldName · value` with blue styling. Removed body textarea (old block full-edit UI). Removed unused state: `fullEdit`, `headerDraft`, `bodyDraft`, `headerInputRef`, `bodyTextareaRef`, `editFocusTarget`, `blockWrapRef`, `isTextOnly`.
- **index.css**: Added `.doc-instance-card` class — sets background + shadow. `.doc-instance-card:hover` slightly brightens.
- **Fields remain as inline pills** — no change to FieldPillNode.jsx.

## Recent Changes (Mar 2026 — DocContainer Display Mode)
- **DocContainer.jsx**: `editable` is now always `true` (TipTap always accepts edits/drops). `showToolbar` prop passes `isEditing` (not `editable`) — toolbar only shows when user clicks to edit. Drops work without switching to edit mode. `cursor: isEditing ? "text" : "default"`.

## Recent Changes (Feb 22 Session 2)

### DocToolbar.jsx
- Added `Unlink` button (N15): appears inline when cursor is on a `fieldPill` or `instancePill`. Replaces the atom node with `#FieldName` text (for fieldPill) or `instanceLabel` text (for instancePill).
- Added `MD` export button (S5): downloads TipTap JSON as `.md` file. `tiptapToMarkdown(node)` recursive converter handles:
  - `paragraph` → `text\n\n`
  - `heading` → `##` × level + `text\n\n`
  - `bulletList/listItem` → `- text`
  - `orderedList/listItem` → `1. text`
  - `blockquote` → `> text`
  - `codeBlock` → ` ``` text ``` `
  - `horizontalRule` → `---`
  - Text marks: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``
  - `fieldPill` → `#FieldName`
  - `instancePill` → label text

## Architecture Notes
- Pills use `atom: true` — cursor cannot enter them; they select as units
- `onContextMenu` handler in DocEditor prevents browser default; shows ContextMenu with formatting + "Insert field" options
- DocLinkSuggestion uses `[[` trigger → shows docs picker
- Pills stored in TipTap JSON as custom node types (not HTML)
