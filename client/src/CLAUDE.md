# client/src — Source Root CLAUDE.md

_Updated: 2026-06-12. Check this file before re-reading source._

## Recent Changes (2026-06-28 — 22px margin-top above the image in image occurrences)
- **`index.css`** — `.doc-editor-content .artifact-card[data-kind="image"] .artifact-thumb` gained
  `margin-top: 22px` for breathing room above imported/occurrence images. Client rebuild (deploy)
  required to show on prod (no local dev server runs).

## Recent Changes (2026-06-28 — textblock list bullets now indent past the prose text-indent)
- **`index.css`** — added `.textblock-card:not(.textblock-card--inline) .ProseMirror ul/ol
  { padding-left: 2.5em }` right after the existing `…p { text-indent: 1.5em }` rule.
  Root cause (confirmed by a headless render of the real built cascade): block textblock
  cards indent each paragraph's first line 1.5em (book style), and the default list
  `padding-left: 1.5em` made the li-text align with that indented prose — so the bullet
  markers (rendered OUTSIDE the li) hung ~1em to the LEFT of the prose column and read as
  outdented (user: "the bulletpoints need to be indented", re: the seeded "Anything you do
  can be measured" app-description textblock). 2.5em seats the markers under the prose
  indent. Scoped to block textblock cards — doc-container lists have no prose text-indent
  and are unchanged. Client rebuilt + verified via headless screenshot against the built
  CSS.

## Recent Changes (2026-06-17 — LINE-LEVEL wrap morph shipped)
- Image floats beside a host textblock can now anchor at ANY visual LINE (not just block boundaries):
  new `docs/wrapAnchor.js` (pure, tested) + `anchorOffset` (px) attr on `wrapGroup` → `--wrap-mt`;
  `Editor.jsx detectSideHost` hoisted + picks a side everywhere + returns `anchorOffset`; a per-line,
  side-aware `.wrap-drop-line` highlight shows where it'll land. Plan:
  `docs/superpowers/plans/2026-06-17-line-level-wrap-morph.md`. See docs/ + ui/ CLAUDE.md.

## Recent Changes (2026-06-17 — image neighbor: framed card (border + brighter bg), space-above-image killed)
- **`index.css`** — the wrap IMAGE neighbor `.instance-row` is now a framed card again (per user, asked
  repeatedly): `background: rgba(38,102,132,0.72)` (a teal BRIGHTER than the host column's
  rgba(12,53,70,0.55) → clearly different from the parent) + `border: 1px solid rgba(140,205,230,0.5)`
  + `border-radius:6px` + `overflow:hidden`. Inner `.artifact-card` stays transparent/borderless (the
  row IS the single box).
- **Space above the image** — the label+handle FLEX GROUP (first child of `.instance-content`) was
  reserving a row above the artifact-card. Lifted the whole group `position:absolute; top/left:2px` for
  the neighbor (mirrors the host-handle lift) so the image is flush at the top.
- **OPEN (functional, deferred):** dragging the image to a specific LINE to morph the text around it
  there doesn't work — detectSideHost returns null (plain cross-doc move) AND anchor granularity is
  per-BLOCK not per-visual-line (a single-paragraph host → always anchorIndex 0 → "one big line, always
  same spot"). Needs focused work in `ui/Editor.jsx` detectSideHost/blockIndexAtY + a per-line drop
  indicator. Drop logs show `sideHost null` / `grouped null` → cross-doc insert.

## Recent Changes (2026-06-16 LATE-7 — row alignment, header filter/add swap, container label nudge, caption color)
- **Instance row alignment** (`index.css` + `ModuleInstance.jsx`) — handle + label + fields now vertically
  CENTER in the single-line case (handle was sitting higher; label had `paddingTop:2` pushing it down →
  removed). `.instance-content{align-items:center}` + `.instance-content .module-drag-handle{align-self:
  center;margin-top:0}`; `:has(.instance-body){align-items:flex-start}` keeps the handle TOP-LEFT when the
  instance has a tall custom body (textblock/image) so it doesn't float to the middle.
- **Container header alignment** (`index.css`) — `.container-header{align-items:center}` +
  `.container-header .module-drag-handle{align-self:center;margin-top:0}` (handle was higher than the label).
- **Container label nudged up 1px** (`ModuleContainer.jsx`) — `position:relative; top:-1` on the label span.
- **Filter ↔ Add swapped in headers** (`ModuleContainer.jsx` + `ModulePage.jsx`) — `HeaderChevron` (filter)
  now renders BEFORE `QuickAddMenu` (add) in both. (Panels have no filter chevron — unchanged.)
- **Image caption color** (`index.css`) — `.artifact-thumb-info-name` in doc images `var(--text-muted)` →
  `rgb(170,205,225)` so the caption stands out from the dark column (was ~same color as the bg).

## Recent Changes (2026-06-16 LATE-6 — wrap: STRIP unrequested neighbor chrome; chip eats adjacent spaces; doc word-spacing −1px)
All `index.css`. Per user ("you didn't need to give … i didn't ask for that"):
- **Image neighbor: NO bg, NO border, NO handle backing.** Removed the `rgba(16,64,84,.6)` bg + the
  `hsl(var(--border))` border on the neighbor `.instance-row` AND stripped the inner `.artifact-card`
  border + `input-bg` bg (base `.artifact-card` has both — they'd show through once my override was
  removed). Image is now JUST the image, flush to the top (padding 0). The handle-backing chrome
  (dark pill + green ring + shadow) is gone; the lift is scoped to the IMAGE handle only
  (`.instance-row … .module-drag-handle`) so the infobox `.container-shell` keeps its plain default
  handle (it was getting the lifted/backed treatment it shouldn't have).
- **Mini-block chip eats adjacent spaces** — `.instance-textblock-inline` margin `1px 0` → `1px -3px`
  so the chip pulls over the literal space chars next to it in the prose; its 6px side padding is then
  the sole gap (user: "the spaces are still showing up next to the miniblock").
- **Doc word-spacing −1px** — `.doc-editor-content.ProseMirror { word-spacing: -1px }` tightens every
  word gap in the doc by ~1px (user: "make the spacing of the spaces smaller in general … in the doc").

## Recent Changes (2026-06-16 LATE-5 — mini-block chips render identically in & out of a wrap)
- **`index.css` `.instance-textblock-inline`** `display: inline-block` → `inline`. An inline-block
  reserves the full `line-height: 1.35` as box height → the chip was visibly TALLER outside a wrap
  than inside one (the wrap host forces `display: inline` via the `.wrap-group--on … :last-child`
  rule). Making the base `inline` makes wrapped + non-wrapped chips identical (the wrap path already
  proved `inline` works; long chips line-break like text — the old `max-width:100%` one-pill behavior
  is dropped). The wrap-scoped `inline !important` override is now redundant but harmless.

## Recent Changes (2026-06-16 LATE-4 — wrap image neighbor: on-theme bg, flush-top, matched bottom margin, obvious handle; top-border meets seam)
All `index.css` unless noted:
- **Image neighbor bg** `hsl(var(--surface-2))` (flat gray) → `rgba(16,64,84,0.6)` — on-theme teal
  (occurrence-card scheme), a touch brighter than the host column so it still reads as its own card.
- **No padding above the image** — neighbor `.instance-row` padding `4px` → `0` (image flush to its
  frame) + the neighbor's drag handle lifted out of flow (`position:absolute; top/left:3px`) so the
  in-flow handle row no longer pushes the image DOWN. Handle kept OBVIOUS over the photo via a
  dark-teal rounded backing + green ring + shadow (per user "keep the drag handle obvi").
- **Bottom margin matches the side gap** — the float's `margin-bottom` 8px → 14px (= the
  `margin-left/right` side gap), so prose reclaiming below the neighbor has the same breathing room.
- **`docs/WrapGroupNode.jsx`** — notch extension `+SEAM_GAP` → `+SEAM_GAP/2` (lands exactly on the
  resize-seam line): the host's clipped TOP border now meets the seam (no gap between the textblock
  top border and the resize handle) while the sliver to the RIGHT of the seam still shows parent bg.

## Recent Changes (2026-06-16 LATE-3 — wrap: position-named shapes (top/middle/bottom) + the bottom "upside-down L" + mini-block left padding)
- **Shape vocabulary renamed (per user)** from L/C/hangman/J → POSITION-based `top`/`middle`/`bottom`
  × `side` (left/right = the mirrored forms). Class is `wrap-group--shape-{top|middle|bottom}`.
- **`docs/WrapGroupNode.jsx`** — `measure()` classifies the third shape, `bottom`: when the measured
  neighbor reaches the host BOTTOM (`c.bottom - bottom < 24`) there's no full-width prose below it →
  the host traces an UPSIDE-DOWN L (full-width above + beside, nothing below), distinct from `middle`
  (which has a bottom bar). Stored in `measuredShape` state (render-time is a first guess from
  `anchorIndex`).
- **`index.css`** — `wrap-group--shape-bottom` clip polygons (right + left/mirrored): full top edge
  → down to the notch → down the seam wall to the bottom (no bottom bar). The seam's notch-bottom
  `::after` is hidden for `shape-bottom` (it would double the host's own bottom border).
- **`index.css`** — mini-block chip (`.instance-textblock-inline`) `padding-left` 2px → 6px to match
  the 6px right side (chip text was crammed against the left border). Hover still drops it to 0 for
  the ⠿ handle.

## Recent Changes (2026-06-16 LATE-2 — wrap: gap-sliver shows parent bg + image occurrence distinct bg)
- **`docs/WrapGroupNode.jsx` (`measure`)** — `--notch-w` now adds `SEAM_GAP` (the float-margin gap):
  `c.right - left + SEAM_GAP` (right) / `right - c.left + SEAM_GAP` (left). The host's clip then carves
  the column background OUT of the sliver between the text and the neighbor too, so that sliver (right
  of the resize handle) shows the PARENT background instead of the host's teal tint.
- **`index.css`** — the wrap NEIGHBOR's `.instance-row` (the image occurrence) gets
  `background: hsl(var(--surface-2)) !important` — a slightly-raised neutral surface, distinct from the
  parent page/column behind it, so the image reads as its own card. (Host column keeps its teal
  `rgba(12,53,70,0.55)`; neighbor now differs from both host and parent.)
- **Shapes/sides covered:** all of this is side-aware (right + left) and shape-aware. NEIGHBOR (the
  wrapped thing in the notch) = ANY occurrence (image/artifact/instance/container). HOST (the prose that
  bends into the L) must be TEXTMAPPED — `role:"textblock"` OR `role:"container" kind:"doc"` (gated by
  `Editor.isTextmappedHost`); both host types are handled by the dual `.instance-row`/`.container-shell`
  selectors. Right float → L / C / hangman; left float → their mirrored "backward" forms (a.k.a. J family)
  — driven by `side` (left/right) × `anchorIndex` (top→L, mid→C, lower→hangman).

## Recent Changes (2026-06-16 LATE — wrap: shape-adaptive inner-L borders (col-resize line = the L line) + the "extra textblock on resize" fix)
All `index.css` (+ `docs/WrapGroupNode.jsx` shape class + `ui/Editor.jsx` — see those CLAUDE.md):
- **Clean L top (`.wrap-group--shape-l`)** — the generic host clip polygons keep a FULL-WIDTH
  top edge (right for a C: real prose above the notch), which drew the host's top border ACROSS
  the top over the neighbor → text+image "looked connected at the top." Added shape-l-gated clip
  polygons (right + left) whose top edge STOPS at the text column (`0 0 → calc(100%-notch-w) 0 →
  … notch-h … → bottom`). Higher specificity than the generic rule; C keeps the generic polygon.
- **Notch-bottom line via the seam (`.wrap-seam::after`)** — the host clip can't border the
  notch's INNER walls (they're interior cuts). The draggable seam already draws the vertical
  inner line (`::before`) AND is the col-resize handle; added `::after` = a 1px `hsl(var(--border))`
  horizontal line at the seam bottom, `--notch-w` wide, side-aware (right→`left:50%`, left→
  `right:50%`). So ::before+::after = the L's inner corner and "the col-resize line IS the line
  that's part of the L" + "the top of the bottom line of the L now has a border." Adapts to any
  shape/side (the seam spans the measured neighbor box).
- **Infobox top border now shape-gated** — base rule borders all 4 sides + 6px radius; only
  `.wrap-group--shape-l` drops `border-top` (+ `0 0 6px 6px` radius). So an L keeps no-top (it ran
  into the prose) while a C keeps its top border as the notch-TOP line.

## Recent Changes (2026-06-16 — wrap: L-BORDER on host, image-occurrence frame (incl. handle), border color = textblock's, chip handle compaction)
All `index.css` unless noted:
- **L-shaped host border:** the clipped host `.instance-row`/`.container-shell` now carries a `1px
  hsl(var(--border))` border — the clip-path traces it into the L outline (top-left, left, bottom,
  bottom-right); the top-right notch is cut so no border runs into the neighbor. notch-y snaps to 0 for
  L-shapes (`WrapGroupNode`) so there's no bg/border strip above the neighbor.
- **Border color:** switched from `var(--border-default)` (faint) → `hsl(var(--border))` (= the textblock's
  own border, `hsl(var(--border-1))` ≈ #333) on the host, the neighbor frame, AND the seam line — so the
  wrap border matches a normal textblock's border, not the faint default.
- **Image occurrence framed as a unit:** moved the neighbor image border from `.artifact-card` to the
  neighbor's `.instance-row` (+ `padding:4px`, `!important` to beat the artifact edge-to-edge chrome
  strip) so the border encloses the image AND its drag handle; the inner `.artifact-card` border is
  dropped (no double box). The infobox (container neighbor) keeps its no-top border.
- **Infobox vertical offset** reset to `var(--wrap-mt, 0px)` (no fixed nudge — tweak to taste).
- **Mini-textblock chips:** base `padding-left` 3px→2px; hover `padding-left`→0; and the radial drag
  handle inside `.itbi-handle` is compacted (`.radial-menu`/`.module-drag-handle` → width:18px, no
  margin/padding, justify-start) so the ⊹ glyph sits at the left edge instead of centered in a 32px box.

## Recent Changes (2026-06-15 LATE-5 — host bg CLIPPED to the L (the "image inside the textblock" fix) + image full border)
Root cause of "the textblock background extends behind the image / image looks nested inside it": the
host's visible box is **`.instance-row`** (bg `rgba(12,53,70,0.55)` + 1px border) for a textblock host
(`.container-shell` for a doc host) — which earlier rules never touched (they only hit `.textblock-card`).
So the row's bg + border ran full-width behind the floated neighbor.
- **Host clip (`index.css` + `WrapGroupNode.jsx`):** re-added a measured notch, but now the clip-path is
  on the host's `.instance-row` / `.container-shell` (the element with the bg). It KEEPS the column
  background (the wrapped text needs it) and clips it OUT of the neighbor's footprint (notch-w × notch-h
  at notch-y) so the bg/border never sit behind the neighbor → the neighbor reads as a SEPARATE
  occurrence. Host border set to none (user dislikes it); `.textblock-card` stays transparent (no double
  bg). `WrapGroupNode.measure` sets `--notch-w/--notch-h/--notch-y` measured relative to that outer box;
  `--notch-y` makes the cut sit mid-host for a C (not just the top corner for an L). Left + right
  polygons. The prose never enters the notch (the float reserves it), so the clip removes only empty bg.
- **Image neighbor → full border** (`.artifact-card` all four sides) for the separate-occurrence look
  (was sharing the infobox's `border-top:none`). Infobox **container** neighbor keeps `border-top:none`
  (its top ran into the prose). Nested Info shell still border-less.
- **Neighbor moved LOWER** (`margin-top: calc(var(--wrap-mt,0px) + 4px)`, was −6px).
- The "empty container on load" was the UNCLIPPED bg rectangle behind the image; now clipped. (Note:
  the notch measures via RO + timed re-measures up to 4s, so there can be a brief pre-measure window
  where the clip is a full rect until the neighbor lays out — self-corrects.)
- Verified live (section-image + lead infobox): host row bg kept + clipped, image border 1px all sides.

## Recent Changes (2026-06-15 LATE-4 — wrap polish: nested-shell border fix (the "extra container"), top-border drop, Info tiny, handle cursors)
All `index.css`, scoped to `.wrap-group--on`:
- **"Extra container on resize" BUG (root cause + fix):** the infobox-border rule matched ALL
  `.container-shell` descendants of the neighbor — including the nested "Info" table container — so a
  second bordered box appeared (and showed after a resize re-render). Fix: added
  `.wrap-group--on … :not(:last-child) .container-shell .container-shell { border: none }` so ONLY the
  outer infobox box is bordered. Verified: outer borderLeft 1px, nested 0px.
- **Infobox TOP border removed** (`border-top: none` + `border-radius: 0 0 6px 6px`) — the top edge ran
  horizontally into the prose occurrence; sides/bottom kept.
- **Infobox nudged up** ~6px (`margin-top: calc(var(--wrap-mt,0px) - 6px)`) so its header lines up with
  the prose's first line.
- **Nested "Info" header → 9px** (very tiny), so the page label reads as the larger heading (the
  requested "swap" — I did NOT enlarge `.page-header` itself; making Info tiny achieves the relative
  hierarchy without a risky global change).
- **Mini-textblock hover padding:** `--zoned:hover { padding-left: 1px }` so the drag handle sits near
  the left edge (was a 3px gap before it).
- **Grab cursor on all drag handles** (`.module-drag-handle`, `[data-dnd-handle]`, `.radial-handle`,
  `.itbi-handle`, + the wrap host's lifted handle) with `:active → grabbing`.
- Rebuilt + verified in `client/dist`.

## Recent Changes (2026-06-15 LATE-3 — L-wrap restyle: infobox box + column-rule seam; host border dropped; mini-chip polish)
Per user, the L-border on the TEXT is gone; the chrome now lives on the infobox + a column rule.
- **Host (`index.css`)** — removed the host's border AND the clip-path entirely (no more notch). The
  text column is plain. `margin-top:0` + the host's in-flow drag-handle (first child of
  `.instance-content`) lifted to absolute so the text's top is FLUSH with the infobox top (was ~25px
  lower). `WrapGroupNode.jsx` no longer sets `--notch-w/h` (dead) — keeps the neighbor measure only
  for the seam (+ its timed backstops, now documented as seam-sizing).
- **Neighbor/infobox (`index.css`)** — its own border (`var(--border-default)`) on the
  `.container-shell`/`.artifact-card`, plus `padding-top:6px` on `.container-doc` (top padding inside).
- **Seam column-rule (`index.css` `.wrap-seam::before`)** — a persistent 1px `var(--border-default)`
  line down the seam, separating the text column from the infobox. Spans the seam height (= neighbor
  height, kept correct by the timed re-measures).
- **Mini-textblock chips (`index.css`)** — base `.instance-textblock-inline` left padding 0 → **3px**.
  `.itbi-arrow` (the open-link button) now `display:none` at rest, shown via
  `.instance-textblock-inline--zoned:hover .itbi-arrow` (hover-only, like the drag handle).
- **C/J shapes (`index.css` neighbor rule)** — neighbor `margin-top: var(--wrap-mt, 0px)` (was a fixed
  `margin:0 0 8px 0`). `WrapGroupNode` sets `--wrap-mt` from `anchorIndex` so dropping/dragging the
  neighbor to a mid host line pushes the float down → prose flows full-width above it, beside it, then
  below (C). `side:left/right` gives L↔J. See docs/CLAUDE.md.
- **Drag-drop columns** — already supported: dropping a block on the left/right third of another
  forms a `wrapGroup` (`wrapHostWithNeighbor`/`wrapMoveBeside`, `wrap:true`) → native autowrap, either
  side, any drop line. Verified the wiring is intact + both sides/anchor lines flow correctly.
- Rebuilt + verified live: infobox top 66 / text top 68 (flush), host border 0, seam line spans 1325px,
  chip padding-left 3px, arrow hidden at rest.

## Recent Changes (2026-06-15 LATE-2 — L-wrap: closed chip-drop gap + restored the L-BORDER correctly)
Two follow-ups after the pseudo-float removal below, both verified against the live grid w/ Playwright.
- **Chip-drop gap** (`index.css`): link chips (`.instance-textblock-inline`) are `display:inline-block`,
  and an inline-block's shrink-to-fit width is computed against the CONTAINING BLOCK (full card width),
  NOT the reduced line-box beside the float. So any chip wider than the narrow column couldn't fit
  beside the infobox and dropped BELOW it, dragging every following word down → a tall empty band in
  the column. Fix: `.wrap-group--on … :last-child .instance-textblock-inline { display:inline }` so
  chips line-break like text and wrap inside the column. SCOPED to the wrap host (chips elsewhere keep
  their inline-block 3-zone layout). Measured: biggest in-column vertical jump 850–1155px → 24px.
- **L-border restored** (`index.css` + `WrapGroupNode.jsx`): user wants the host border to trace an L,
  not a rectangle overlapping the infobox. Re-added the clip-path (right+left polygons) keyed to
  `--notch-w`/`--notch-h`, but `WrapGroupNode` now measures the notch FROM THE HOST CARD (the clip
  origin) against the neighbor's REAL edges: `--notch-w = card.right − neighbor.left`,
  `--notch-h = neighbor.bottom − card.top`. The native float already keeps prose out of the notch, so
  the clip removes only empty space (text right edge 748 < clip line 754 → no clip) and opens to full
  width exactly at the neighbor's bottom. **Reliability:** the old measure read short (notchH 774/802
  vs real 1290) because a Wikipedia infobox TABLE lays out after the ResizeObserver's last fire.
  `WrapGroupNode` now adds timed backstop re-measures (120/400/1000/2200/4000ms). No feedback loop —
  the notch only drives the clip-path (paint, not layout), so re-measuring never changes the neighbor
  (this is the loop account2's `::before`-driven version risked; mine avoids it). Rebuilt + verified
  in `client/dist`: notchW=407, notchH=1290, gap=24px, textClipped=false.

## Recent Changes (2026-06-15 LATE — index.css: L-wrap fixed — deleted redundant `::before` pseudo-float + clip-path)
- **`index.css` `.wrap-group--on`** — removed the `.ProseMirror::before` pseudo-float and both
  `clip-path` polygons (the `--notch-w`/`--notch-h` block). They were the PRE-native-float
  reservation mechanism, left active after the BFC-chain neutralization (`:2587–2613`) made the
  real neighbor float wrap the prose for real → double-reservation. Symptoms (verified w/ a
  Playwright measure on the live grid): pseudo-float stacked below the neighbor and pushed the
  full-width transition ~notch-h px too low (bottom gap + over-long column); clip-path keyed to a
  short-measured notch-h cut the column's right edge + left an empty bordered band (right-of-column
  gap). Host card keeps a transparent bg + plain rectangle border now (no clip). The native
  cross-sibling float does the whole L with NO measurement. See docs/CLAUDE.md for the full
  before/after numbers. Paired `WrapGroupNode.jsx` change (dropped the notch setProperty calls) +
  deleted orphaned `docs/LWrapHost.jsx`. Rebuilt + verified in `client/dist`.

## Recent Changes (2026-06-15 — index.css: imported article images are full-column FIGURES (auto height + caption underneath))
- **`index.css`** — new block after the `.wrap-group` artifact overrides, scoped to
  `.doc-editor-content .artifact-card[data-kind="image"]`. Per user (screenshot review):
  imported photos should "take up the whole col, so height auto" and show "the captions …
  underneath." The base `.artifact-thumb` caps images at `max-height:240px` + `object-fit:cover`
  (crops) and `.artifact-card--with-info` forces the image to `max-width:55%` with the caption
  BESIDE it — both fought the ask. The new rule makes doc images a vertical figure: image
  `width:100%; height:auto; max-height:none; object-fit:contain` (whole image, no crop, fills the
  column) and the caption (the alt, stored as the artifact `label` → `artifact-thumb-info-name`)
  moves UNDERNEATH via `flex-direction:column` + `order` (italic/muted, centered). Specificity
  (0-4-0, the `[data-kind]` attr) beats the `--with-info` side rules AND the `.wrap-group`
  caption-hide, so captions also show on doc-embedded wrap neighbors. SCOPED to `.doc-editor-content`
  so list/compact thumbnails elsewhere keep their 240px-capped look. CSS-only, no re-import; build clean.
  - **Handle gutter (follow-up):** the full-width figure body wrapped BELOW the drag handle
    (`.instance-content` is flex-wrap:wrap + justify-content:space-between, so the wide image
    body dropped to a second line and space-between pinned the handle top-left → "handle on top
    of the content"). Fix: `.doc-editor-content .instance-content:has(.artifact-card[data-kind=
    "image"]){flex-wrap:nowrap!important;justify-content:flex-start!important;align-items:flex-start!important}`
    + `.instance-body:has(...){flex:1 1 0%!important;min-width:0}`. **`!important` is REQUIRED** —
    `.instance-content`'s flex-wrap/justify-content are INLINE styles in ModuleInstance JSX, which
    beat plain stylesheet rules regardless of specificity (the first no-`!important` attempt
    silently did nothing). Handle now sits in a LEFT gutter at top-left beside the image; image
    fills the rest of the row. Top-aligned (keeps `align-self:flex-start`), not vertically centered.
  - **Preview-node cursor:** `.preview-node-card` already had `cursor:pointer`, but the inline
    folder-page preview renders a real ProseMirror editor and `.doc-editor-content.ProseMirror
    {pointer-events:auto;cursor:text}` is more specific than `.preview-node-preview *` AND
    re-enables pointer events on a descendant → its text I-beam leaked through. Made
    `.preview-node-preview *` `pointer-events:none!important; cursor:pointer!important` so the
    whole card reads as one click-to-drill pointer target.

## Recent Changes (2026-06-12 — index.css: `.is-lead-float` (lead aside parent-float prose cards))
- **`index.css`** — new rule right after the `.is-lead-aside` block:
  `.is-lead-float .textblock-card:not(--inline):not(--link){ display:block; background:transparent;
  border-color:transparent; }`. The Wikipedia lead aside is now a **parent-level float** (the
  infobox floats right at the front of the root section, prose flows down the left). For the prose
  to wrap beside-then-under the float across MULTIPLE textblocks, each card must be a non-BFC block
  (the global `.textblock-card{display:flow-root}` just above would shrink it beside the float) with
  transparent chrome (so no tinted box sits behind the floated infobox). Scoped to `.is-lead-float`
  sections (set by `ModuleContainer` from `module.meta.leadFloat`) — every other card keeps its
  flow-root + frame. Pairs with the importer front-float (server/CLAUDE.md) + `alignStyle` plain-block
  default (docs/CLAUDE.md). Headless-validated against the real cascade (`~/.wraptest2/leadfloat.png`).

## Recent Changes (2026-06-12 — index.css: block-wrap is a REAL FLOAT now (no absolute overlay) + seam)
Part of the block-wrap redesign (see docs/CLAUDE.md + spec
`docs/superpowers/specs/2026-06-12-unified-block-wrap-redesign.md`).
- **`index.css` `.wrap-group--on` block** — replaced the `position:absolute` neighbor overlay
  + `--notch-y` rules with a **float layout**: neighbors (`> * > :not(:last-child)`) `float`
  to `side` at `width:var(--wrap-nw,300px)`; the host (`> * > :last-child`) is a full-width
  block whose `.textblock-card`/`.container-shell` is clipped to the L via
  `clip-path:var(--wrap-host-clip,none)` (WrapGroupNode measures + sets the var). Added
  `overflow:visible` on the host card / `.doc-editor-wrapper` / `.ProseMirror` so the host
  stays a non-BFC and its lines wrap around the float (the load-bearing requirement). New
  `.wrap-seam` splitter style (`cursor:col-resize`, blue hover). `--off` mode uses
  `row-reverse` for right-side so host stays left of the neighbor. Validated against the real
  selectors in `~/.wraptest2/contract.html` (headless screenshot).

## Recent Changes (2026-06-11 — index.css: removed wrap `⠿` grip styles)
- **`index.css`** — deleted `.wrap-reposition-grip` rules (the grip is gone — block-wrap is
  now normal-drag only; see docs/ui/helpers CLAUDE.md). Added a `z-index:6` on the wrapped
  neighbor's `.module-drag-handle`/`[data-dnd-handle]` so its NORMAL radial drag handle stays
  grabbable on top of the absolutely-positioned neighbor box.

## Recent Changes (2026-06-10 — mini-textblock hover highlight)
- **`index.css` `.textblock-card`** — added a hover highlight so each mini textblock
  reads as an editable occurrence (user: "for the mini textblocks, give it a
  highlight when i hover over it"). Block variant → soft green tint + inset ring;
  `--inline` variant → brightens its own bg + dotted underline; `--link` chips set
  their bg via inline style so the `a:hover`/`button:hover` override uses
  `!important` + a brightness bump. Base rule got a `transition`. Build clean.

## Recent Changes (2026-06-09 — index.css: tighter instance spacing + insert-gap matches drop indicator)
- **`.instance-wrap`** vertical margins 6/5 → **2/2** — between-instance spacing
  read as too much (esp. with the 4px interleaved `.insert-gap`). Applies to all
  containers (board + list). The insert-gap hover zone provides the breathing room.
- **`.insert-gap-line`** restyled to be visually IDENTICAL to the DnD drop indicator
  (see ui/CLAUDE.md). Retracted-header **lip** + QuickAddMenu scroll/hover fixes also
  this session (modules/CLAUDE.md, ui/CLAUDE.md).

## Recent Changes (2026-06-09 — BSP "mosaic" layout (opt-in per grid), Phase 1)
- **`Grid.jsx`** — `GridInner` reads `grid.meta.layoutTree`; when set it renders
  `<GridMosaic>` (desktop) or `<MosaicMobileStack>` (mobile = a plain vertical
  scroll-stack of panels — tree-nav deferred) instead of the rows×cols
  `GridRender`. The rows×cols path (GridRender + resize handles + MobileGridNav) is
  the untouched fallback when `layoutTree` is null. New helper `helpers/bspTree.js`
  (pure split-tree math: derive/compute/resize/split/remove — 17 tests).
- **Why:** a uniform CSS grid shares a row/col track across the whole axis, so you
  can't resize panes independently on both axes. A binary split tree (BSP, like
  tmux/VS Code panes) gives both-axis independence with perfect tiling. Opt-in per
  grid via a **Grid/Mosaic toggle** in `commandCenter/GridSettingsTab.jsx`
  (converts by `deriveTreeFromPlacements(currentPanels)`; revert deletes the key).
  Renderer + DnD details in `modules/CLAUDE.md` (GridMosaic). Server: `Grid.meta`
  field added (was missing — also un-breaks grid.meta.defaultStyle/localSort);
  **server restart + reseed** to get the seeded mosaic grid.

## Recent Changes (2026-06-08 — #18 keycap/pocket: recessed drop-pocket)
- **`index.css` `.container-list`** — the list container's drop area is now a
  RECESSED pocket (theme-agnostic `rgba(0,0,0,0.22)` darken + inset top shadow +
  `margin:5px` so the raised container frame shows around it). Completes the
  keycap/pocket depth language: `.container-shell` already pops OUT (raised frame),
  `.instance-wrap > .instance-row` already pops out (keycaps) — the pocket they sit
  in was flat and is now sunken. (`.instance-pocket` was the intended-but-unused
  style; the rendered area is `.container-list`, so the recess went there.)
- **Scope**: standalone board-page list containers only. `.doc-editor-content
  .container-list` + `.artifact-markdown .container-list` reset it flat so embedded
  in-prose containers don't get a heavy well. Board/doc/canvas/table kinds render
  via other branches (unaffected). Verified via headless-chromium harness
  (raised frame → sunken pocket → raised keycaps reads at a glance). Build clean,
  1086/1086 tests.


> **Read [`/CLAUDE_CHAT.md`](../../CLAUDE_CHAT.md) at session start** for time-ordered user direction across sessions. New direction goes there first.

## Recent Changes (2026-06-03 — REMOVED hardcoded timeslot-passed coloring #59 — domain logic out of generic renderer)
- The `#59` "timeslot-passed pink tint" below was **ripped out**. It baked
  schedule-domain knowledge (`module.meta.scheduleSlot` / `slotLabel`, time-of-day
  parsing, "is this a slot") into the GENERIC container renderer — the universal
  `ModuleContainer` must not know what a "schedule" or "timeslot" is. Per user:
  "it shouldn't know it's a schedule via the code … it should all be handled
  manually via the operation."
- **Removed:** `ModuleContainer.jsx` `isSlotPassed` memo + `useNowTick`/`isTimeslotPassed`
  imports + the `is-timeslot-passed` className; `index.css` `.container-shell.is-timeslot-passed`
  rule; deleted `hooks/useNowTick.js`, `helpers/timeslotPassed.js`,
  `__tests__/timeslotPassed.test.js`.
- **Correct path (data-driven):** slot coloring is an OPERATION concern. An op
  references the timeslot field BY ID, compares it to the current time, and writes
  a generic visual to the slot occurrence (its `ownStyle`/style-cascade — which the
  container already renders without any schedule knowledge). The renderer stays
  domain-agnostic; the op owns "is a slot, time passed → this color." NOTE: a clean
  op needs a current-time-of-day var + a before/after time comparator (and a time
  trigger, or run on load/filter-change) — verify those exist before authoring.

## Recent Changes (2026-05-23 — Page-within-page #45 + Lock rule + Timeslot-passed #59)
- **`helpers/layoutCascade.js`** — Slice 4 lock rule helper
  `isMoveBlockedByCascadeLock` walks the source's ancestor chain to
  find the outermost ancestor with own `meta.layoutCascade.locked:true`
  and rejects moves whose destination falls outside that ancestor.
  Reorders within the same locked surface stay allowed; copies/links
  are exempt. Wired into `handleInstanceDrop` + `handleContainerDrop` +
  `handleOccurrenceMove` move branches with a toast on block. 6 new
  regression tests.
- **`helpers/layoutCascade.js` (#45 page-within-page)** — Split the
  hardcoded page rule: `nestedInContainer` stays forced representation
  (containers don't have room to host a full nested page) but
  `nestedInPage` now defaults to representation with
  `navAllowChange:true` + `navOptions:["representation", "actual"]`.
  Per-occurrence `meta.layoutCascadeOverride.dragInView:"actual"`
  survives the cascade walk. 3 new tests for the page-in-page
  semantics.
- **`modules/ModulePage.jsx`** — When `classifyOccurrenceContext`
  returns `nestedInPage` AND the resolved view mode is `actual`, the
  page renders with a `page-shell page-shell--nested` modifier:
  `flex: 0 0 auto`, slim border (`var(--border-subtle)`), transparent
  background, smaller radius. One component, three render shapes:
  top-level → full page chrome, nested+representation → chip,
  nested+actual → inline page-as-container.
- **`ui/LayoutCascadeEditor.jsx` + `ui/LayoutCascadeSection.jsx`** —
  Editor + HeaderDropdown section + form-tab mounts for every level
  of the cascade. Wired into ContainerForm Style tab (push-down),
  InstanceForm Style tab (per-placement override), LayoutForm Style
  tab (panel push-down), GridSettingsTab (cascade root), plus the
  three per-occurrence HeaderDropdown sites
  (ModuleContainer / ModulePage / ModulePanel).
- **`blocks/OperationsBuilder.jsx` + `helpers/operationActions.js` +
  `helpers/operationIntrospection.js`** — Pool key migration (BUGS.md
  #21): UI now writes `cfg.poolId` (was `cfg.poolContainerId` which
  never matched the executor's reader). Executor + introspection
  accept legacy `poolContainerId` as a fallback.
- **`helpers/timeslotPassed.js` (NEW, task #59)** —
  `parseSlotLabel("9:00am")` + `isTimeslotPassed({ slotLabel,
  containerDate?, now })`. Pure check, no I/O. YYYY-MM-DD container
  dates parse as LOCAL midnight (not UTC) so timezone drift doesn't
  flip the same-day comparison. 11 regression tests covering am/pm
  boundary, 12am/12pm edge, 30-minute slots, containerDate scoping.
- **`hooks/useNowTick.js` (NEW)** — Returns a `Date` snapped to a 5-
  minute boundary; updates on the boundary so all consumers share
  the same wall-clock minute. Aligns the first interval to the next
  boundary so consumers mounted at different times still tick
  together.
- **`modules/ModuleContainer.jsx`** — Uses `useNowTick` + checks
  `module.meta.scheduleSlot && module.meta.slotLabel` against now.
  When the slot's start time is before now (today), appends
  `is-timeslot-passed` to the container shell className. Re-renders
  every 5 min so the class flips as the day advances. Date scoping
  is loose (any view that includes today shows the tint on past
  slots) — multi-day views correctly convey "we're past 2pm" via
  tinted 9am-1pm slots.
- **`index.css`** — `.container-shell.is-timeslot-passed` rule:
  `rgba(248,113,113,0.08)` bg + `rgba(248,113,113,0.25)` border,
  subtle enough to read as a status indicator rather than competing
  with selection / clipboard outlines (which still win when active).

## Recent Changes (2026-05-21 — Audit continuation: download / multi-file / OCR / wiki op / sample artifacts)
- **`client/src/modules/ArtifactContent.jsx`** — Page-level artifact
  viewer now carries a download badge for image / pdf / audio / video
  branches AND an inline Download link in the CodeViewer header. Uses
  `module.meta.originalName` so the saved file isn't the timestamp-
  randomized server filename. Docket §8 gap #20.
- **`client/src/modules/ArtifactContent.jsx`** — Image branch gained
  an `OcrButton`: click → lazy-imports `tesseract.js` → recognizes
  text → mints a `role:"textblock"` occurrence with the OCR'd content
  as its textmap, appended to the image occurrence's `occurrences[]`.
  Below the image, every child textblock renders in an editable
  `<Editor>`. Multi-OCR is fine (each run appends a new textblock).
  Per user request.
- **`client/src/helpers/dropHandlers.js`** — `handleFileDrop` now
  iterates `payload.data.files` (was `files[0]`). Container drop:
  one batched occurrences[] update with all new ids. Artifact-panel
  drop: all uploads share the panel/view, last becomes active.
  Grid-cell drop: one stacked panel per file. Toast batches progress
  ("Uploading 3 files…" → "Uploaded 3 files"). Server is idempotent
  on `moduleId` so parallel uploads are safe. Docket §8 gap #6.
- **`server/server.js`** — New `POST /api/research/wikipedia/import`
  route mirrors `/api/v1/research/wikipedia/import` but uses
  `{userId, gridId}` from the body (same pattern as
  `/api/artifacts/upload`). Lets the in-app "Import from Wikipedia"
  op call it via CALL_API without needing an API token.
- **`server/scripts/createLiveData.js`**:
  - New `Examples` folder under root + 5 seeded artifact occurrences
    (3 Wikimedia images, 1 Big Buck Bunny mp4, 1 W3C dummy.pdf).
    `fileRef` is the absolute URL — `resolveFileRef` passes those
    through verbatim, so no upload is needed on re-seed.
  - New "Examples" board page pinned to the Notebook hub panel as a
    4th tab, surfacing the artifacts as ArtifactCards on the grid +
    in the full-page viewer.
  - New "Import from Wikipedia" manual operation. Pipeline:
    GET_USER_INPUT (query) → GET_USER_INPUT (mode: create / append /
    replace) → IF create: name + folder picker + CALL_API → SHOW_VALUE
    results. Append/Replace branches collect input and SHOW_VALUE a
    TODO note (the markdown→textmap merge endpoint doesn't exist
    yet). Folder picker options bake in the per-grid folder ids at
    seed time.
- **`client/package.json`** — `tesseract.js` 7.x added (lazy-loaded
  for OCR).
- Verified: 809/809 client tests, 144/144 server tests, build green.
  Re-seed required to pick up the artifact + op seeds:
  `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-05-21 — File/artifact/media audit: §8 quick wins + syntax highlighting)
- **`server/server.js`** — `/api/upload` (legacy duplicate) deleted.
  `/api/connections/:id/import` rewritten to mirror
  `/api/artifacts/upload`: mints Module + Occurrence + View, writes
  the file under `uploads/user/<ts>.<ext>`, records `uploadSize` +
  `originalName` on `module.meta`, broadcasts `module_created` +
  `occurrence_created` + `artifact_created`. Now accepts the same
  `parentFolderId` and `manifestId` body params as the canonical
  endpoint. Docket §8 gap #2.
- **`server/models/Module.js`** — `meta` field gained a JSDoc
  `@typedef ArtifactMeta` documenting the shape used by artifact
  modules (`mimeType` / `originalName` / `uploadSize` /
  `uploadStatus` / `folderId` + optional `exif`/`width`/`height`).
  Mentions the two other documented variants (template:
  `meta.templateModule`, schedule slot: `meta.scheduleSlot`).
  Docket §8 gap #23.
- **`client/src/helpers/CommitHelpers.js`** — `uploadFile` now hits
  `/api/artifacts/upload` (was `/api/upload`) and forwards optional
  `parentFolderId` / `manifestId` to the canonical endpoint.
- **`client/src/ui/commandCenter/ConnectionsTab.jsx`** — `importFile`
  body uses `parentFolderId` (matches the canonical schema);
  `handleUpload` posts to `/api/artifacts/upload` and reads
  `d.module` (was `d.artifact`).
- **`client/src/modules/ArtifactContent.jsx`** — `CodeViewer` got
  real syntax highlighting via `highlight.js` + the `atom-one-dark`
  theme. JS module is dynamic-imported (lazy chunk); CSS theme is
  eager (~3KB). Extension → highlight.js language map covers the
  ~30 most common file types; unknown extensions fall back to
  `highlightAuto`. Plain `<code>` shows while the module loads or
  if highlighting throws. Header reads
  `<filename> · .<ext> · <lang>`. Docket §8 gap #14.
- **`client/package.json`** — `highlight.js` 11.x added.
- **`client/src/CLAUDE.backup.2026-05-21.md` (NEW)** — Archive of
  every dated "Recent Changes" section from 2026-05-20 and earlier
  that used to live in this file (1950 → 1684 active lines).
- Verified: 806/806 client tests, 144/144 server tests, client build
  exit 0. `highlight.js` lives in the lazy chunk so first-load cost
  is zero for users who never open a code artifact.

## Recent Changes (2026-05-21 — CSS cascade editor extends to Grid + per-kind controls)
- **`helpers/StyleHelpers.js`** — Added `STYLE_FIELDS_BY_KIND`
  whitelist (grid / panel / page / container / instance / textblock /
  artifact) telling the editor which controls to surface per entity
  type. Added `resolveStyleCascade(ctx, leafKind)` — walks Grid →
  Panel → Page → Container → Instance and returns
  `{ levels: [{kind,label,contribution,source}], resolved }` so the
  editor can render every ancestor's contribution as a read-only
  inheritance row. Added `buildStyleCascadeContext({leafOccurrence,
  occurrencesById, modulesById, grid})` — walks an occurrence's
  parent chain via the shared `buildParentMap` reverse map and
  buckets ancestors by role, returning the `ctx` shape
  `resolveStyleCascade` expects. Pure data layer; no React deps.
- **`ui/StyleEditor.jsx`** — Now kind-aware. New props `kind`
  (drives field filter) + `cascade` (the `resolveStyleCascade`
  output, renders as "Inherited cascade" read-only row stack at the
  top). Granular border controls (`borderColor` / `borderWidth` /
  `borderStyle`) and full font family / weight / line-height
  controls added; legacy `border` shorthand kept for back-compat
  seeds. Each control renders only when its key is in the kind's
  field whitelist.
- **`ui/commandCenter/GridSettingsTab.jsx`** — New "Grid default
  style" section (between dimensions and Sort panels) using a
  `kind="grid"` StyleEditor that writes to `grid.meta.defaultStyle`.
  This is the cascade root that panels / pages / containers /
  instances inherit from. `inherit` mode = no default; `own` mode
  persists the style object onto `grid.meta`.
- **`ui/LayoutForm.jsx`** — Panel "Container Defaults" and "Instance
  Defaults" StyleEditors now pass `kind="panel"` / `kind="instance"`
  + clarified inherit labels ("Grid default").
- **`ui/ContainerForm.jsx`** — Both container-level StyleEditors
  (container style, child-instance defaults, per-placement
  occurrence overlay) now pass `kind` + a memoized
  `resolveStyleCascade` output via the new `cascade` prop. The
  child-instance editor includes the container itself in the chain
  so the user sees what an instance dropped into this container
  would inherit.
- **`ui/InstanceForm.jsx`** — Instance StyleEditor: `kind` derives
  from the instance role (`textblock` / `artifact` / `instance`)
  and a memoized cascade walks all the way from this occurrence up
  through Container → Page → Panel → Grid.

## Recent Changes (2026-05-21 — Multi-date filter cascade wiring)
- **`helpers/operationActions.js` (`evalRule DATE_IN_PERIOD`)** — new
  short-circuit branch BEFORE the period/span path: if rightVal is an
  object with `kind:"multi"` + `Array.isArray(dates)`, normalize
  leftVal to a day-key and OR-match against each entry. Empty
  `dates[]` always fails. Existing day/week/month/year/span paths
  unchanged. Driven by the `DrilldownDatePicker`'s non-consecutive
  selection now landing in `grid.activeFilterValues[fid]` as
  `{kind:"multi", unit:"day", value:firstISO, dates:[...]}`.
- **`state/selectors.js` (`isOccurrenceVisible`)** — `hasPeriod`
  detection in the condition-based path AND the legacy direct-equality
  path widened to also match `(rightVal.kind === "multi" &&
  Array.isArray(rightVal.dates))`. Without this, multi-shape values
  (whose `unit === "day"`) were falling through to bare SAME_DAY,
  passing an object as rightVal and silently failing every match.
  Both paths now route multi shapes through `evalRule
  DATE_IN_PERIOD`, which OR-matches across `dates[]`.
- **`ui/HeaderChevron.jsx` (`formatFilterValue`)** — multi-shape
  detection added BEFORE the period branch: a value with
  `kind:"multi"` and `Array.isArray(dates)` renders as
  `"N day" / "N days"`. Was previously falling into the period branch
  (since `"value" in object` is true) and rendering only the FIRST
  date. Empty `dates[]` returns null (no pill).
- **`$activePeriodDates` already enumerates multi shapes** — the
  executor's `expandPeriod` (operationExecutor.js ~line 935) already
  short-circuits on `kind:"multi"` and returns the flat dates list, so
  trackers / Build-Schedule ops that consume `$activePeriodDates`
  ingest multi-day selections without any changes here. `$activeDate`
  still resolves to the anchor (first date) for ops that want one
  representative day.
- **`NavPickerPopover.formatSummary`** already handles multi via its
  `kind === "multi"` branch ("Date1, Date2, Date3" / "FirstDate +N");
  no change needed for the trigger-button summary.
- **Regression coverage** — 4 new cases in
  `__tests__/operationActions.unified.test.js` (evalRule multi OR-
  match across dates / non-match / ISO normalization / empty dates[])
  + 3 new cases in `__tests__/filterCascade.test.js` (visibility on
  match / non-match / legacy direct-equality path with multi shape).
  108/108 in the two relevant suites; 733/738 client-wide (the 5
  unrelated failures are masterReducer's pre-existing
  `SET_COMPUTED_VALUES` test drift from the prior session's
  `color/icon/suffix/replaceValue` defaults — not touched here).

## 2026-05-22 session-added tasks (see [`/CLAUDE_CHAT.md`](../../CLAUDE_CHAT.md) for full user-direction context)

Mid-session 2026-05-22 the user dumped a large direction set + several follow-ups. Tasks #29-#52 in the session task list capture these. Highest-leverage open items:

- ~~**#45 Page-within-a-page primitive**~~ ✅ Shipped 2026-05-23. ONE component (`modules/ModulePage.jsx`) renders three ways based on `classifyOccurrenceContext` + the layout cascade's `pageViewMode`:
  - **top-level** (panel content) → full page chrome, navAllowChange=false (forced actual)
  - **nestedInPage + representation** → `<RepresentationView>` chip
  - **nestedInPage + actual** → page-shell with `--nested` modifier (slim border, transparent bg, no outer card chrome — visually inlines as a container while remaining a real page module). User can toggle representation ↔ actual via the cascade's `navOptions: ["representation", "actual"]` + `navAllowChange: true` (set by `resolveDefaultLayout` `context === "nestedInPage"`).
  - **nestedInContainer** → forced representation chip, navAllowChange=false (containers don't have room for a full nested page).
  Cascade rule + render branch tested in `__tests__/layoutCascade.test.js`: 3 new cases (page-in-page changeable, override survives, page-in-container locked). Prerequisite cleared for #46 People profile-card.
- **#46 People library + profile card view** — Seed 10 people in Library, table-of-people page with profile fields as columns (mirror Schedule Table). Above the table: a page-as-container (depends #45) rendering the selected person via APPLY_TEMPLATE from a "Profile Page" template. Bidirectional copy-link people-row ↔ Library entry ↔ profile-card. Multiselect "people" field type usable on tasks (Call/Email/Text).

  **Status (verified 2026-05-23):** Most of the data layer is already seeded in `createLiveData.js`. What's done vs what's left:
  - ✅ **5 profile fields** — `personName / personEmail / personPhone / personGender / personNotes` (line ~1086)
  - ✅ **`peopleAssigned` field** — type:"occurrence", multiSelect:true, find-mode optionsSource scoped to library="person" (line ~1121)
  - ✅ **10 person occurrences** — parented under `libraryContOccId` with all 5 fields stamped + pravatar profile pictures (line ~3892)
  - ✅ **Library tag** — `libraryFieldId` enum extended to include "person" (line ~867)
  - ✅ **addNew patch** — `peopleAssigned` field's optionsSource.addNew.parentOccurrenceId points at `libraryContOccId` so the picker's "+ Add" mints new person occurrences (line ~3975)
  - 📋 **People page** — IDs declared (`peoplePageModId / peoplePageOccId`, line 259) but NOT yet wired. Add at end of STEP 5 / start of STEP 6: `Module` with `role:"page" kind:"board"`, label "People", parentId = `libraryFolderId`. Occurrence carries `filterOverride:{}` so it ignores the date filter.
  - 📋 **People table** — IDs declared (`peopleTableModId / peopleTableOccId`, line 261) but NOT wired. Mirror `Schedule Table` shape: `role:"container" kind:"table"`, parented inside the People page. `meta.table.columns` should be `[{id, title:"Photo", fieldVisibility:{mode:"show",fieldIds:[posterUrlFieldId]}, hideLabel:true}, {title:"Name", fieldVisibility:{mode:"show",fieldIds:[personNameFieldId]}}, {title:"Email", ...}, {title:"Phone", ...}, {title:"Gender", ...}, {title:"Notes", ...}]`. `rowCount: 0`, `cells: {}` — a `People Table: Build` op fills cells via COPY_LINK loop over all person occurrences. Use the existing `Schedule Table: Build` as the template.
  - 📋 **Profile-card page (page-within-page)** — IDs declared (`profileCardModId / profileCardOccId`, line 263) but NOT wired. `role:"page" kind:"doc"`, parented inside the People page above the table. Textmap is the profile-card layout: media row at top + 5 field rows. The page-within-page primitive (#45) renders it as a container when nested inside the People page; cascade rules force `representation` mode by default (already shipped in #36).
  - 📋 **Profile-card template** — IDs declared (`profileTemplateModId / profileTemplateOccId`, line 265) but NOT wired. Lives in the Templates manifest. APPLY_TEMPLATE op runs on click of a person row, with `replacements: { "{name}": $person.fields.<personNameFieldId>.value, "{email}": ..., ... }` to fill the profile card with the clicked person's values.
  - 📋 **Click-row → fill-card op** — `People: Show Profile` op. Trigger: onChange on a hidden "selected person" field, OR onClick on a person row. Pipeline: FIND person by id → APPLY_TEMPLATE the profile template into the profile-card slot with replacements.
  - ✅ **Demo task with `peopleAssigned`** — verified 2026-05-23: `Call a Friend` task in toolkitInstances (createLiveData.js:2019) binds `peopleAssignedFieldId` as input field at order 2.
  - ✅ **"Call 2 people" goal + Phone Calls tracker** — shipped 2026-05-23. New fields: `phoneCallsFieldId` (array display with columns Person/Slot/Date) + `totalPhoneCallsFieldId` (number display, target=2/daily). Both bound to `socialSummary` goal instance. New `Tracker: Phone Calls` op (priority 3, mirrors Moods tracker shape) loops `$allInstances` for completed Call-a-Friend tasks in `$goalPeriod`, then inner-loops `peopleAssignedFieldId.value` array, resolves each id via `$allItemsById.${$personId}`, and PUSH_TO_ARRAY's `{name, timeslot, date}` rows + increments a scalar count. Writes rows + count to `socialSummary` goal. **Re-seed required** to surface: `node --env-file=.env server/scripts/createLiveData.js`.

  Estimated effort: one focused session, all seed surgery in `createLiveData.js`. No new client-side primitives needed — every piece composes from what's already shipped (#5 link tools, #36 layout cascade, #45 page-within-page, #31 value manipulator, table container, APPLY_TEMPLATE).
- ~~**#36 Layout cascade**~~ ✅ Fully shipped 2026-05-23 (Slices 1-6). See `docs/superpowers/specs/2026-05-22-layout-cascade-spec.md`. Helper layer (`helpers/layoutCascade.js`) with `DEFAULT_LAYOUT_BY_KIND`, `mergeLayoutRules`, `resolveLayoutCascade`, `buildLayoutCascadeContext`, `resolveEffectiveLayout`, `resolveDropInViewMode`, `resolveEffectiveViewModeFromCascade`, `isMoveBlockedByCascadeLock` — 34 regression tests. Drop integration: new occurrences inherit destination's `dragInView`. Switcher integration: `ViewModeSwitcher` reads `allowedModes` + `allowChange`. Lock rule: cross-surface moves blocked when outermost ancestor sets `locked:true` (wired into `handleInstanceDrop` + `handleContainerDrop` + `handleOccurrenceMove`). Editor: `LayoutCascadeEditor` + `LayoutCascadeSection` mounted at HeaderDropdown (Container / Page / Panel) + ContainerForm Style tab + InstanceForm Style tab + LayoutForm Style tab + GridSettingsTab (cascade root). Slice 7 `dropAccepts` deferred until a consumer needs it.
- ~~**#35 Canvas pill → merged into Representation view**~~ ✅ Verified shipped 2026-05-23. `ui/RepresentationView.jsx` is the universal small-view: leading thumbnail (from any `role:"media"` field binding) OR module type icon, breadcrumb, label, inline field chips (configurable via `meta.representationFieldIds` or the layout-cascade `representationFieldIds` rule — populated by `LayoutCascadeEditor`), trailing type icon when a thumb is shown. Hover popup mounts the full `ModuleInstance` (lazy-loaded) with optional `fieldVisibilityOverride` for which fields appear. No standalone CanvasPill — every canvas representation is this one component.
- ~~**#31 Value manipulator action tree**~~ ✅ Verified shipped 2026-05-23. `ui/actionTree.js` declares the canonical multi-level tree: Variables (assign / arithmetic / collections / strings / type) → Find → Occurrences (create / update / delete / move) → Display → Control → Outbound. `ui/ActionPicker.jsx` is the DrilldownPicker-styled tree picker; mounted in `blocks/OperationsBuilder.jsx:769` as the canonical action-type selector on every action step. Variables category exposes `INIT_VAR / SET_VAR / ADD_TO_VAR / SUBTRACT_FROM_VAR / MULTIPLY_VAR / DIV_VAR / INCREMENT_VAR / DECREMENT_VAR / PUSH_TO_VAR / PUSH_TO_ARRAY / MERGE_ARRAY / SORT_VAR / REPLACE_IN_VAR / REMOVE_FROM_VAR / ARRAY_LENGTH / SPLIT_STRING / JOIN_ARRAY / TYPE_OF` — every JS-equivalent value manipulator the user requested. 9 regression tests in `__tests__/actionTree.test.js`.
- ~~**#30 createMultiple + multiple-variant switch on every action**~~ ✅ Verified shipped 2026-05-23. Per user direction "just have a switch", a single `multiple` boolean cfg flag now lives on CREATE / DELETE / REMOVE_OCCURRENCE / MOVE_OCCURRENCE in both the UI (`blocks/OperationsBuilder.jsx:1005-1009, 1160-1169, 1266-1268, 1312-1321`) and executor (`helpers/operationActions.js:749 / 1373 / 1623 / 1642`). No separate `_MULTIPLE` action variants. The actionTree node descriptions surface "+ multiple switch" on each Title.
- **#29 Last-X + Array-X display field pairs** — For every "last mood / last X" display field, add a paired array-display capturing all. Spots: mood, workouts, food intake, purchases, media consumed, pomodoros, +best guess. Array values must include timeslot + (multiday only) date. "Most recent" = by timeslot, not creation time. All via ops.

  **Recipe (primitives ready 2026-05-23 in this session):** the value-manipulator action tree shipped (#31) makes #29 fully authorable as ops without new executor work. Pattern per source field:
  1. Create a "Last X" display field + an "Array of X" display field.
  2. New op `Tracker: Last <X>` (priority 3, onChange + onLoad triggers):
     - INIT_VAR `$rows = []`
     - LOOP `$allInstances` filtered by source-field-exists + date predicate
     - PUSH_TO_ARRAY into `$rows` with shape `{label, value, timeslot, date}` (use `field.id` field reads + `$item.fields.<dateFid>.value`)
     - SORT_VAR `$rows` direction:"asc" by:"timeslot" (or "desc" — by:"timeslot" works because slot labels sort lexically when zero-padded; otherwise add a numeric sortKey)
     - ARRAY_LENGTH → if zero, SHOW_VALUE last = null / array = []
     - Else: INIT_VAR `$lastRow = $rows.<lastIndex>` (or REPLACE_IN_VAR shape with `at: length-1`)
     - SHOW_VALUE on "Last X" with `$lastRow.value` (suffixed with " · " + `$lastRow.timeslot` via template interpolation)
     - SHOW_VALUE on "Array of X" with `$rows`
  3. The Array-X display field needs a `displayConfig.columns: [{path:"timeslot",header:"Slot"}, {path:"value",header:"Value"}, {path:"label",header:"Item"}]` to render as a table per the May 17 docket entry.
  4. Multi-day case: include `date` in the row + add a "Date" column to displayConfig.columns; the col renders only when the active filter is multi-day (frontend already handles per-column visibility via `fieldVisibility`).

  Apply per source: mood (one row per mood-field log), workouts (one row per workout instance), food intake (one row per meal occurrence), purchases (label/account/amount), media consumed (label/type/timeslot), pomodoros (slot completed). Seed surgery only — no new executor primitives needed.
- ~~**#51 Canvas tool additions**~~ ✅ Fully shipped 2026-05-23. `CanvasContent.jsx` already exposes all four pieces: marker tool (separate from pen, semi-transparent multiply-blend stroke) + fill tool (paint-bucket canvas wash via the `fill` stroke kind) + layers system (`containerOccurrence.meta.layers` with per-layer visibility toggle + rename + active-layer radio + delete; new strokes land on the active layer; layer-less legacy strokes still render) + a "richer color picker" via the native `<input type="color">` overlay (conic-gradient swatch → opens the OS color picker with hex/HSL/eyedropper). Eight-preset palette stays for one-click switching. #37 Mona Lisa drawing is unblocked — pure manual-draw task whenever the user wants to demo.
- **#40 External I/O spec** — Browser extension, BangleJS, Windows right-click, voice (Google Home + Assistant + BangleJS), voice OCR (audio → text), YouTube/Spotify link capture (Representation occurrence + OCR text), YT/Spotify download.
- **#43 Image lifting + line extraction** — On Image artifact, alongside OCR button: extract subject (alpha-cut), extract outline (coloring-page mode, vector strokes), future blueprint conversion.
- **#38 Type review spec** — Deep audit of board/doc/canvas/table + container/instance/artifact/textblock — refine tools, write spec.
- **#39 Future plans + docs/ reconciliation checklist** — Original vision vs current state, identify gaps.
- **#34 Account split** — Each account has its own field (was netBalance shared across Checking + Savings + Net Worth). **DONE 2026-05-22.**
- **#33 Glide animation on panel header + command center** — Slower, shift-from-above. **DONE 2026-05-22.**
- **#41 BUG: Schedule day-column header missing date** — **DONE 2026-05-22.**
- **#42 BUG: Page-already-open notification** — Flash other panel when opening a page that's already active there. **DONE 2026-05-22.**
- **#44 Picker-direct migration sweep** — Replaced all FIND-by-label sites in createLiveData custom pipelines with `$allItemsById.<id>` direct binding. **DONE 2026-05-22.**
- **#32 Rename CategoryPathPicker → DrilldownPicker + DrilldownDatePicker → DrilldownTimePicker** — **DONE 2026-05-22.**
- **#8 Goals restructure Stage 2** — All trackers + custom pipelines now pass `goalOccurrenceId` and use picker-direct goal binding. **DONE 2026-05-22.**
- ~~**#47 BUG: Daily Question header chevron**~~ ✅ Resolved 2026-05-23: BoundHeader.jsx now always renders the dropdown affordance when an `optionsSource` is configured (was gated to `type === "select"` OR `hasOptions`). Shows a `(no options — check pool predicate)` placeholder when the pool resolves empty — gives the user a visible affordance + diagnostic instead of silently falling to the text branch.
- ~~**#48 RepresentationView.onJump cross-page wiring**~~ ✅ Verified shipped 2026-05-23. `RepresentationView.onJump` is wired at every consumer site: `modules/ModulePage.jsx:437` + `modules/ModuleInstance.jsx:453` + `modules/ModuleContainer.jsx:545` all pass `() => jumpToOccurrence(occurrence?.id)` (uses the shared `helpers/jumpToOccurrence.js` — scroll + flash + page-activate retry). `modules/PreviewNode.jsx:176` uses `onDrillDown` instead since the chip is already inside the folder context (correct per spec). Canvas-mounted cards don't render `RepresentationView` directly — they render full `ModuleInstance` / `ModuleContainer` which themselves switch to representation mode via `meta.viewMode`, picking up the same `onJump` wiring.
- ~~**#49 FIND single-result vs multiple-results switch**~~ ✅ Verified shipped 2026-05-23. `helpers/operationActions.js:702` FIND auto-detects: single match → bare item bound to `itemVar`/`itemIdVar`, multiple matches → array. `cfg.multiple === true` (line 722) forces array shape even on a single match for downstream shape consistency. `blocks/OperationsBuilder.jsx:948-996` FIND ActionConfig surfaces the `multiple` checkbox in the UI. Distinct from CREATE/DELETE/REMOVE_OCCURRENCE/MOVE_OCCURRENCE which all have their own `multiple` switches (task #30).
- **#50 Picker level review across all uses** — **DONE 2026-05-23.** Audited every `<DrilldownPicker>` call site: ConditionGroup (2× — `ctx={pickerCtx}`), OperationsBuilder (8× — 6 use memoized `*PickerCtx`, 2 use inline `{fields, sources:[], localVars:[]}` paired with `buildAttachFieldPickerConfig` which is config-driven so ctx is unused), InstanceForm (1× pickerCtx), ContainerTable (1× pickerCtx), SelectOptionsSourceEditor (4× — all use `COLLECTION_PICKER_CONFIG` or `buildRecordKeyPickerConfig(over)` which are recordShape-driven and ignore ctx), ShortcutsTab (config-driven). Every site provides ctx that matches the picker's mode requirement; no fix needed.
- ~~**#52 Triage docs/BUGS.md Open list**~~ ✅ User confirmed 2026-05-23 that the BUGS.md Open list is already resolved by recent refactors. The doc still lists historical items with strikethrough + recovery notes for future searchability.
- **#37 Mona Lisa drawing** — LAST, after #51 ships.

- **#63 Search field type** (deferred 2026-05-23 — "save for a full feature, at the end of list") — New field type `"search"` that renders as a search box. On input, fires a search-style operation that filters / surfaces matches across the grid (probably FIND over `$allItems` with a contains-string predicate). Use cases: searching People by name, Library entries by label, etc. Pairs naturally with the button-field primitive (#46 polish) — a search field's results could surface as a list of click-to-show buttons. UX needs design: dropdown of matches? Below-field list? Modal? Reserved for a focused session.

Lower priority (saved for after the prioritized set): #5 Month view page, #23 mobile touch optimization, #24 100+ item perf, #25 offline sync queue polish, #26 conflict resolution — medium + heavy levels (see below), #27 multi-window sync — echo-race + ack-aware fade (see below), #38 type review, #39 docs reconciliation, #40 external I/O, #43 image lifting, **#53 Connections tab review + external connections + Spotify widget (see below)**, **#54 Occurrence type additions review (see below)**.

### #26 Conflict resolution — heavier levels (deferred 2026-05-24)
**Cheapest level (timestamp + reject-stale) shipped 2026-05-24.** Server's `update_occurrence` handler now compares `expectedUpdatedAt` from the client against the cached `updatedAt`; if stored is newer, emits `occurrence_stale` to the originator with current state + skips the broadcast. Client toasts "Refreshed — another window had a newer edit." and syncs. Foundation works; the cost is that the second writer's edit is lost (not merged).

**Medium level (deferred — bundle with #23 + #24 perf work):**
- Version vectors per occurrence: `{ value, baseVersion }` on every write; server bumps version on accept, rejects on mismatch.
- Client-side auto-merge for trivial conflicts (different fields on same occurrence) — only prompt user on actual collisions (same field).
- UI: "diff modal" showing local vs server when a conflict needs manual resolution.
- Requires per-field version tracking (not just per-occurrence) for the trivial-conflict auto-merge to work without prompting.

**Heavy level (deferred — multi-user collaborative editing prereq):**
- Real OT (Operational Transforms) or CRDT for textmap docs. TipTap has plugins; consider Y.js / Automerge.
- Field-grained CRDTs for occurrence.fields (last-write-wins per field with vector clock).
- Server-side merge logic for the OT/CRDT data structures.
- Only needed if Moduli moves to multi-user collaborative editing. Single-user-multi-window use case is fine with the cheapest level shipped today.

### #27 Multi-window sync — polish (deferred 2026-05-24)
Most of the work is already done — `safeEmit(socket, …)` broadcasts to `userRoom(userId)` via `socket.to()` which excludes the originator, so own-echo races are mostly handled on update paths. `offlineQueue.js` buffers writes when disconnected; `useSocketStatus.js` + `SocketStatusBanner.jsx` show the user a "Disconnected / Reconnected" pill. **Edge cases that aren't bulletproof — defer until a real issue surfaces:**

- **Echo race on CREATE events.** Server uses `io.to()` (broadcasts to all sockets including originator) for `module_created` / `occurrence_created` / `artifact_created` so the originator clears its placeholder state. If the originator already has the data optimistically and re-applies the echo, no harm — Redux reducer is idempotent. But a future originSocketId-based filter would let the originator skip the redundant dispatch.
- **Ack-aware "Reconnected" pill fade.** Current 3s fixed fade ignores whether the server actually ack'd the offline queue replay. Tighten: (a) capture pre-flush queue length, (b) listen for next N entity-updated events from server, (c) hold pill green until all acks land OR 10s upper cap fires.
- **Per-window active grid.** `grid_updated` broadcasts to all sockets in `userRoom`. If Tab A is on Grid 1 and Tab B is on Grid 2, both receive both grids' updates. Local store keeps every grid's modules so this is functionally correct — but `currentGridId` resolution gets confused if you switch grids in one tab while events fly in for the other. Adding a `gridId` filter to `bindSocketToStore.onGridUpdated` would isolate cleanly.
- **Doc / textmap concurrent edits.** Two tabs typing the same textmap → last-write-wins on the full blob. With #26 cheapest level shipped, the second writer now gets `occurrence_stale` + toast — but their typing IS lost. Real fix is the heavy-level OT/CRDT (see #26 above).

### #54 Review occurrence type additions plan (LOW priority — DO NOT list yet)
- The 2026-05-22 type-review spec (`docs/superpowers/specs/2026-05-22-type-review-spec.md`, 203 lines) drafted refinements and "make-it-pop" examples per type (board / doc / canvas / table + container / instance / artifact / textblock). User wants to walk that list together with me and answer per-item Qs before any of the additions land.
- **Don't enumerate the list yet.** When the user comes back to this, surface each proposed addition one-by-one with the question the spec implied (the user explicitly asked: "list those out to me with questions"). For each, the answer drives whether it ships, what shape it ships in, and what depends on it.
- Cross-references: many ideas in the spec compose with the layout cascade (#36 done), the value-builder (#31 done), and the External I/O surface (#40 / #53). Hold on adding any of those compositional pieces until the user picks which to advance.

### #53 Connections tab review + external connections + Spotify widget (LOW priority)
- **Review the Connections tab** in Command Center (`commandCenter/ConnectionsTab.jsx`). The current shape: it lists user-configured external file storage / notebook connection records. It does NOT surface internal APIs.
- **APIs section** — add a "Mounted APIs" list at the top of the tab that enumerates the server endpoints actually exposed under `/api/v1` + the public ones (`/api/artifacts/upload`, `/api/research/wikipedia/import`, …). For each row, surface: method + path, one-line description, current state (always on / token-gated). If feasible (probably via a per-grid `grid.meta.apiOverrides` map), expose an **on/off** toggle per endpoint. "Add more" might not be possible (endpoints are code-defined), but at least surface the catalog.
- **External connections section** — below the API list, a new "External connections" group. Start with **Spotify**:
  - Form for the user's Spotify connection (OAuth client id / authorize button → token storage on the user record under `user.externalConnections.spotify = { accessToken, refreshToken, expiresAt, scope }`).
  - Server route to refresh the token + a `/api/v1/spotify/now-playing` (and pause / play / skip if scope allows) endpoint.
  - **Toolbar widget** — when the connection is live, render a compact Spotify pill in the grid toolbar showing the current track (icon + title • artist, click → expand controls). Polls /now-playing on an interval (probably 15-30s) + invalidates on play/pause clicks.
- Plays naturally into the broader External I/O spec (#40) — Spotify is the simplest concrete external integration that exercises the full token-storage + polling + toolbar-widget surface, so it's a good first one to land. YouTube / others can follow the same pattern.

## Open docket (work still pending — handed off 2026-05-21)

### 🔴 BUGS — fix soon

- **~~Canvas occurrence snap-back on drag-across.~~** FIXED
  2026-05-21 by rewriting the `Canvas: Build` op's ELSE branch in
  `server/scripts/createLiveData.js:6948` from clean-then-rebuild
  to a true diff: orphan sweep (delete only canvas copies whose
  source task is gone from Schedule for `$schedDate`) + per-task
  existence check via `linkedGroupId IS $task.linkedGroupId`
  (skip COPY_LINK + stamp when copy already exists). Manually-
  dragged cards retain their `meta.x/y` across every op fire;
  add/remove from Schedule still propagates. Re-seed required to
  apply: `node --env-file=.env server/scripts/createLiveData.js`.

  Diagnostic notes from the inspection that drove the fix
  (kept in case a related regression appears):
  Root cause was at `server/scripts/createLiveData.js:6936`.
  Idempotency gate:
  ```
  if children > 0 AND triggerType IS_EMPTY AND missingPositions IS 0
    then no-op
    else delete-all + rebuild-all
  ```
  The `triggerType IS_EMPTY` clause only matches bulk onLoad (no
  transaction). Every explicit trigger (onAdd / onDelete / onChange
  / onFilterChange) sets `$trigger.type`, bypasses the gate, and
  runs the ELSE branch — which is `5a. delete every existing copy
  parented under $canvas` (line 6948) followed by `5b/6. COPY_LINK
  + stamp meta.x/y at column (60, $r*80+60)`. Result: any
  date-filter change OR schedule task add/remove silently wipes the
  user's drag positions across the entire canvas. Linked-group
  fanout was ruled out — server doesn't propagate `meta`. Same
  pattern is in `Schedule Table: Build` at ~line 6790 but it only
  positions cells, not free-form x/y, so it's less visible.

  **Fix direction (proper diff, requires careful test):** rewrite
  ELSE branch to a true diff:
    1. For each task on `$schedDate` under Schedule: FIND existing
       canvas copy via `linkedGroupId IS lg-$task.id` (deterministic
       group id per COPY_LINK contract). If MISSING → COPY_LINK +
       stamp seed position. If PRESENT → skip (preserve drag).
    2. For each existing canvas copy: FIND source task; if source
       gone → DELETE; if present → keep.
  Keeps drag-positioned cards intact while still propagating
  add/remove from Schedule. Same `Schedule Table: Build` clean-
  rebuild flow is acceptable there (cells are positional, not
  free-form), so leave it.

  **Quick non-fix:** dropping the `triggerType IS_EMPTY` clause
  ALONE is tempting but sticky-skips: once `missingPositions == 0`
  the op never rebuilds, so new schedule tasks never appear on
  canvas. Diff approach is the right fix; reseed required.
- **~~Bring back the full-screen button on panels.~~** DONE
  2026-05-21 (commit `102a96c6`). `ModulePanel.jsx` page-header
  action cluster (right of QuickAddMenu + stack cycler) now hosts
  a `Maximize2`/`Minimize2` toggle that flips
  `fullscreenPanelId === module.id` via the existing
  `setFullscreenPanelId` prop. Renderer-side fullscreen plumbing
  (lines 275, 505, 704-716) was unchanged.

- **~~Slow initial connection / app freezes during load.~~** PARTIAL
  FIX 2026-05-21 (commit `b3446c48`): folder-page preview was the
  main culprit — every PreviewNode mounted an iframe immediately on
  page open, freezing the parent app for several seconds while 20+
  iframes polled state in parallel. PreviewNode now lazy-mounts
  iframes via IntersectionObserver (200px rootMargin). The pure-
  socket reconnection delay is a separate concern; if reload is
  still slow after this fix, investigate `useSocketStatus.retryInMs`
  + server-side `loadUserIntoCache` warm-up.
- **~~Folder page preview — instances don't render inside containers.~~**
  FIXED 2026-05-21 (commit `b3446c48`). Root cause: `PagePreviewApp`
  built `instancesById` from `parentState.modules.filter(m => m.role
  === "instance")` (too narrow — the new architecture infers role
  from hierarchy) AND never built `leafModulesById` (which the
  current `ModuleContainer` reads from context to look up children
  via `getContainerItems`). Fixed by rebuilding the lookup maps with
  the correct role filters + merging instances/artifacts/textblocks
  into `leafModulesById` + exposing it on the preview's
  `actionsValue`.
- **~~Canvas occurrences overlapping~~** PARTIAL FIX 2026-05-21
  (commit `3a991fbd`). The `Schedule Canvas: Build` op already
  positioned cards in a tidy column (meta.x=60, y=$r*80+60) but its
  idempotency guard would short-circuit on bulk onLoad even when
  existing cards lacked meta.y stamps (from older versions of the
  op). Added a probe loop that counts descendants with IS_EMPTY
  meta.y; if any are present, the full rebuild fires. Re-seed will
  also clean things up via the existing DELETE-orphans phase.
- **Daily Question header chevron `<>` doesn't open question picker.**
  Code inspection (2026-05-21) shows the wiring IS correct:
  - Template's Daily Question container module carries
    `meta.headerLink = { selfField: journalQuestionFieldId,
    link: dateFieldId }` (liveSystemBuilders.js:289).
  - `BoundHeader.jsx:107` renders an inline `<select>` whenever
    `field.type === "select"` OR `hasOptions` (i.e. the field
    resolves options via `optionsSource`). journalQuestion has a
    `find`-mode optionsSource pointing at library instances with
    `fields.<libraryFieldId>.value === "question"`.
  - The `<>` glyph the user clicked is probably the **filter
    chevron** (`HeaderChevron.jsx`), not the question picker. The
    question picker is the `<select>` inside the header label
    itself.
  Most likely root cause: `options` is resolving to `[]` because
  the predicate `fields.<libraryFieldId>.value IS "question"`
  isn't matching anything. Verify by:
  1. Open Command Center → Fields → journalQuestion → check that
     `meta._resolvedOptions` has entries after a re-seed.
  2. If empty, check that the question instances in the Library
     container have `fields[libraryFieldId].value === "question"`
     (they should, but the seed may have changed).
  3. If options resolve, the dropdown should render — if it
     doesn't, the binding lookup is failing somewhere.
  Until verified in-browser, this stays open.
- **~~"Tasks Completed" on day page has broken links.~~** FIXED
  2026-05-21 (in `server/utils/liveSystemBuilders.js`
  `makeDayPageBuildTasksCompletedOp`). Trigger surface widened from
  `onAdd/onDelete subjectRole:"container"` only → also
  `subjectRole:"instance"`. The prior session only added container
  triggers, but the actual task occurrences Build Day mints/clears
  are instance-role — so any instance-level deletion (drag out of
  Schedule, manual remove) left moduleEmbed refs orphaned at ids no
  longer in the store. The op now rebuilds the moduleEmbed array
  whenever Schedule's instances change, so stale ids self-heal on
  the next op fire. Re-seed required:
  `node --env-file=.env server/scripts/createLiveData.js`.
- **~~Schedule on load doesn't seed instances — just shows
  "daycontainer".~~** FIXED 2026-05-21 in
  `server/utils/liveSystemBuilders.js makeScheduleBuildScheduleOp`.
  Root cause was idempotency hygiene in PHASE 4b: the `ADD_CHILD`
  loops (multi-parent slots into the day-col + multi-parent the
  shared Due) lived inside the `IF $dayColId IS_EMPTY` THEN
  branch. A partially-completed prior run that created the
  day-col but bailed before populating it (slot template
  missing, server timeout, anything) left the day-col present
  but empty — and subsequent runs found the day-col, took the
  ELSE branch, and never `ADD_CHILD`'d the slots in. `ADD_CHILD`
  is idempotent (no-op when child is already in
  `parent.occurrences[]`), so it should never have been gated.
  Now: the `IF $dayColId IS_EMPTY` block only wraps `CREATE` of
  the day-col itself; the slot-multi-parent loop and the Due
  multi-parent IF sit as direct siblings of the IF and run on
  every per-day pass. Self-heals half-built day-cols on the
  next op fire. PHASE 4c (shortened mode) wasn't affected — it
  has no `ADD_CHILD` (shortened day-cols are flat by design).
  Re-seed required: `node --env-file=.env server/scripts/createLiveData.js`.
  Regression: 1 new test in `server/__tests__/liveSystemBuilders.test.js`
  walks the pipeline tree and asserts every `ADD_CHILD`-of-`$dayColId`
  loop sits outside the day-col-empty gate (vs. an earlier
  too-coarse check that also tripped on PHASE 4b's outer
  `$activePeriodCount <= 7` IF — that one is supposed to be
  there, since the mode switch is intentional).
- **~~Date-stamp bug on goal/tracker occurrences — RESOLVE BY
  REMOVING.~~** ALREADY DONE in `server/scripts/createLiveData.js`
  (confirmed 2026-05-21). Goal containers (`goalContainerMods`) have
  no `fieldBindings` at all (just styling). Goal display instances
  (`goalInstances`) never had `dateFieldId` in their bindings —
  only display-role bindings on totals fields. The "Stamp Filter
  Date" op at line 5760 is already `enabled: false` with the
  in-file comment "Date field is no longer bound to goal / account
  instances." `ensureDateBinding` is only called on
  `nutritionInstances.scrambledEggs/greekSaladChicken` — task
  sources, not goals. No further code change needed; if a live grid
  still shows stale state, a re-seed
  (`node --env-file=.env server/scripts/createLiveData.js`) will
  push the cleaned shape.

### 🟡 Small / structural fixes

- **~~Blue field text color.~~** DONE 2026-05-21 (commit `4d397445`).
  `rgb(103,232,249)` → `rgb(180,225,245)` in Field.jsx, dark theme
  `--accent-blue-text` → `rgb(190,215,255)`.
- **~~Board container padding +2px top + bottom.~~** DONE 2026-05-21
  (commit `4d397445`). `5/5/7/5` → `7/5/9/5` in ModuleContainer.jsx
  board-kind branch.
- **Schedule canvas + the other canvas should be the SAME page.**
  **Answered 2026-05-21**: KEEP the Schedule Canvas, DELETE the
  standalone Canvas page. Schedule Canvas is the canonical home
  for the mind-map demo content (see big-feature #6).
- **~~Local tree default-open main folder node.~~** PARTIAL 2026-05-21
  (commit `aeca989d`). Took the simpler render-only path: synthetic
  `Local` chevron + pill wrapper around the existing folder groups
  + root pages in `ManifestTree.jsx`'s local tree (no seed change,
  no folder record). Pure visual grouping; collapses defaults open.
  The seed-based variant (real `Local` folder per panel + panel
  default-page wiring) is still queued if/when the user wants the
  folder to back a folder-page card grid.

### 🟢 Big features (in priority order — implement in this order)

#### 1. Module type icons everywhere — **LANDED 2026-05-21**
Shared helper at `client/src/helpers/moduleIcons.js`. Exports:
`getModuleTypeIcon(module, field?) → LucideIcon`,
`getModuleTypeColor(module, field?) → string`,
`getModuleTypeBadge(module, field?) → {Icon, color}`, plus the raw
maps `KIND_ICONS / ROLE_ICONS / FIELD_TYPE_ICONS / KIND_COLORS /
ROLE_COLORS`. Resolution order: `field.type` → `module.kind` →
`module.role` → File catch-all.

Migrated consumers (2026-05-21):
- `modules/NodePill.jsx` — was a local KIND_ICON + ROLE_ICON map.
- `modules/PreviewNode.jsx` — same.
- `modules/ModulePage.jsx` — KIND_ICONS now re-exports from shared.
- `modules/ManifestTree.jsx` — PAGE_KIND_ICON now re-exports from
  shared.

Future consumers (still TODO — add when those features land):
- `CategoryPathPicker` tiles + closed-state chips
- `QuickAddMenu` add-menu tiles
- `ValueBuilder` row breadcrumb cards (the spec'd value-builder)
- Mind-map representation nodes (big feature #5–#6)
- AssistantDrawer when surfacing entities

Spec for the original curated icon set:
- **page** — `FileText` or `LayoutPanelLeft`
- **container** (list / doc / board / canvas / table) — distinct per
  kind: `List`, `FileText`, `Kanban` or `LayoutGrid`, `PenTool`,
  `Table`
- **instance** — `Box`
- **textblock** — `Type` or `AlignLeft`
- **artifact** (image / pdf / audio / video / md / code) — `Image`,
  `FileText` (pdf), `Music`, `Video`, `FileCode`
- **field** — `Hash` (number), `Type` (text), `ToggleLeft` (boolean),
  `ChevronDown` (select), `Link2` (occurrence), `Calendar` (date)
- **operation** — `Zap`
- **template** — `Stamp`
- **folder** — `Folder`

Single shared helper `getModuleTypeIcon(role, kind, type?) → LucideIcon`
+ constant `MODULE_TYPE_COLORS` map. Consume from: `CategoryPathPicker`
tiles + closed-state chips, `QuickAddMenu` add-menu tiles,
`ValueBuilder` row cards (the breadcrumb card spec'd above), the
mind-map representation nodes, and anywhere else an occurrence
type is shown.

#### 2. Representation module / view-toggle for occurrences — **PARTIAL 2026-05-21**
Foundation landed this session:
- `helpers/viewMode.js` — pure resolver. `getEffectiveViewMode(occ,
  contextTag)` reads `occ.meta.viewMode` and falls back to context
  defaults. Contexts: `default` (allows preview / representation /
  actual / actual-converted), `folderPage` (no Actual — per spec),
  `valueBuilder` (representation only). The layout cascade now owns
  the per-kind allowed-modes list (see `helpers/layoutCascade.js`);
  these context constants are the non-cascade fallback.
  `isViewModeIllegal(occ, contextTag)` lets callers detect + coerce
  stale modes.
- `ui/RepresentationView.jsx` — compact `[Icon] Label` chip using
  the shared `helpers/moduleIcons`. Three sizes (sm/md/lg).
  `onJump(occId)` callback hook for the clickable-jump pattern
  (the jump-to-source helper itself still pending — see #3).
- `ui/ViewModeSwitcher.jsx` — 3-button segmented control. Reads
  the allowed list from the context tag so disallowed modes never
  render. Two sizes (sm/md).
- `modules/PreviewNode.jsx` — wired to both: representation mode
  renders a single `RepresentationView` chip + switcher; preview
  mode keeps the existing iframe + adds the switcher inline in the
  title row. Folder-page constraint enforced — Actual button is
  never shown. Writes mode changes via `CommitHelpers.updateOccurrence`
  patching `meta.viewMode`.
- 14 regression tests in `__tests__/viewMode.test.js`.

Status — feature is functionally complete 2026-05-21:
- ✅ ModuleInstance / ModuleContainer / ModulePage all honor
  `meta.viewMode === "representation"` and render a compact
  RepresentationView chip with a jumpToOccurrence onJump handler
  (commits `51a6267e`, `8b5fa12d`).
- ✅ Switcher exposed in container + page HeaderDropdowns via the
  new `ui/ViewModeSection` component (commit `f25006bc`) — wraps
  ViewModeSwitcher with the CommitHelpers.updateOccurrence(
  {meta.viewMode}) write. PreviewNode's inline switcher stays for
  folder-page cards.
- ✅ Clickable-jump helper landed earlier (`helpers/jumpToOccurrence.js`,
  commit `c822e2c0`).

Original spec retained below:
Each occurrence rendered as a "node" elsewhere (mind-map canvas,
folder preview, value-builder card, search results, etc.) needs a
THREE-WAY view-toggle:
- **Preview** — current folder-page-preview rendering (small
  thumbnail / first-N-fields).
- **Representation** — just the **label + module type icon** (from
  the curated icon set above). Compact, ~24px tall, no field
  values. The "node-in-a-graph" view.
- **Actual** — the full occurrence render (whatever the parent
  context normally shows — full ModuleInstance / ModuleContainer
  / page board / etc.).
The view choice is per-occurrence-PLACEMENT (not per-template) — so
the same instance can render Preview in one spot and Actual in
another. Store as `occurrence.viewMode: "preview" | "representation"
| "actual"` (default `"actual"` everywhere except mind-map nodes
which default to `"representation"`). Switcher is a small 3-button
segmented control in the occurrence's radial menu / header.

**Context constraint**: the **Actual** view is NOT offered on the
**folder page** (PageFolder.jsx). Folder pages exist to give a
grid-of-cards drilldown — rendering the full occurrence inline
would defeat the purpose. The switcher on a folder-page card
shows only `Preview / Representation`. The user can drill in
(click the card) to see Actual at its native page. Any other
container that's structurally a "preview grid" should follow the
same rule (mind-map canvas cards: Preview / Representation only;
schedule slot row: all three).
**Folder page default**: when a card lands on a folder page,
**auto-set its viewMode to `"preview"`** (override the global
`"actual"` default). The author can flip to `"representation"`
via the switcher, but never to `"actual"` from inside the folder
page. Same auto-set rule for mind-map canvas cards but defaulting
to `"representation"` (per #5).

#### 3. Clickable representation → jump-to + highlight — **PARTIAL 2026-05-21**
Foundation landed:
- `helpers/jumpToOccurrence.js` (NEW) — shared `jumpToOccurrence(id,
  {onActivatePage?})` helper. If the target's DOM element is already
  mounted (queried via `[data-occ-id]` with `[data-occurrence-id]`
  fallback), it scrolls + flashes the `.anchor-highlight` CSS
  animation. If not mounted, calls `onActivatePage` to swap the
  active page, then retries after a 220ms grace window. Exports
  `findOccurrenceElement` + `scrollAndFlash` as primitives.
- `modules/ManifestTree.jsx` `AnchorChip.onClick` — refactored from
  ~20 lines of inline scroll/flash code to a single
  `jumpToOccurrence(contOcc.id, { onActivatePage: () => onOpenPage?.(pageOccId) })`
  call. Behavior-preserving.
- 12 regression tests covering canonical/legacy DOM marker lookup,
  UUID hyphen escaping, scroll/flash class toggling, retry-after-
  activation, and null-safe paths.

Still TODO:
- Wire `RepresentationView.onJump` to use the helper when the chip
  lives OFF the source's page (mind-map nodes, value-builder cards,
  search results). For folder-page `PreviewNode` cards in
  representation mode, the existing `onDrillDown` is the right
  action (the user IS inside the folder context) — those don't need
  the helper. The other surfaces don't exist yet (mind-map, value-
  builder); when they do, pass `jumpToOccurrence` as the onJump
  callback.
- Activate-page wiring needs to know which panel hosts the target.
  Today's `onActivatePage` is generic — the consumer decides what
  "activate" means. ManifestTree consumers know `onOpenPage`
  already; mind-map consumers will need a per-occurrence page
  resolver.

Original spec retained below:
When the user clicks a Representation node, the app:
- Opens the page the source occurrence lives on (in the current
  panel — switch active page if needed, OR switch tab if it's in a
  different panel).
- Scrolls to the occurrence within that page.
- Briefly highlights the occurrence using the SAME highlight
  treatment that ManifestTree drilldown uses when you click a
  granular anchor (existing mechanism — find it, extract as shared
  `flashOccurrence(occId, { highlightMs: 1200 })` helper).
This uniform "jump + highlight" pattern should be used by every
representation node, every breadcrumb crumb in the value-builder
card that resolves to an occurrence, and ManifestTree drilldown.

#### 4. Multi-select shift+drag with Q-modifier (cross-panel)
Extend the existing shift-click multi-select to support
**shift-click+drag rectangle** spanning multiple panels.
- **Drag rectangle**: dynamic (NOT aspect-ratio-locked) — same as
  the canvas square/circle DRAWING tools should also become
  (drawing-tool rectangle/circle currently aspect-locked — fix).
- **Rule with just Shift**: selects every CONTAINER whose bounding
  box is FULLY inside the rectangle, PLUS every INSTANCE inside
  those containers. Containers partially outside the rect are NOT
  selected.
- **Rule with Shift+Q**: selects only INSTANCES whose bounding box
  is at least 1/3 inside the rectangle. Containers excluded.
- **Q is a momentary modifier (the "light switch" metaphor)** —
  during an in-flight drag, pressing Q toggles instance-only mode
  ON, releasing Q toggles it OFF. So the user can switch rules
  mid-drag without restarting. Also works when starting:
  Shift-drag → press Q (instances-only) → release Q (containers
  back in). The rectangle's selection updates live.
- **Scope**: cross-panel — instances/containers inside any panel
  on the grid count. Pages and panels themselves are NEVER
  selected by this — they're scaffolding, not data.
- Wire into `state/SelectionContext.js` clipboard so the existing
  copy / move / copy-link / paste-here works on the rectangle
  selection too.
- **Visual**: dashed-line rectangle during drag (similar to the
  canvas drawing tools' preview), live-tinting included
  containers/instances as the rect is dragged.

#### 5. Mind-map / link tools for canvas
Mind map is NOT a separate page kind — it's the **linked variant of
the existing canvas drawing tools**. The system never knows "this
is a mind map", it's just a canvas with link tools.
- **Drawing toolbar additions**: each existing drawing tool (line /
  square / circle / pen) gets a **link variant** alongside it.
  Icon: same shape with a small chain-link badge in the corner.
  The plain drawing version is purely visual (no occurrence
  semantics); the link version creates draggable/grabbable nodes
  with occurrence-semantic behavior.
- **Drag-handle reposition**: move the Select/Hand tool to the
  **right side of the toolbar next to the center** (per user spec).
- **Link line behavior**:
  - Two endpoint balls (snap to occurrences on the canvas).
  - Draggable along its length to reposition.
  - Endpoint balls draggable to snap to a different occurrence.
  - Drag-handle radial menu (shown on hover with select tool only)
    — contains Delete + any future actions.
- **Link circle / link square**:
  - Same primitive shape as drawing variants BUT dynamic (not
    aspect-locked).
  - **Everything geometrically inside** the linked shape becomes
    its "children" — auto-connect each child to the shape with
    fainter connection lines.
  - Slight tint in the middle of the linked shape so the author
    sees it's the linked variant.
  - **Group-drag**: dragging the linked shape moves its children
    with it (like a multi-select).
  - Other link-line endpoint balls can snap onto a linked shape's
    perimeter (not just onto occurrences).
- **Drawing-mode shapes (non-link variant)**:
  - Erase-only (no drag-handle, no radial menu, no grab).
  - Eraser tool removes them.
- **Delete-from-select**: with the select tool, drawn lines + shapes
  on the grid are selectable; selected ones can be deleted.
- **Data semantics**: at this phase, link lines/shapes do nothing
  data-wise — they're just visual links between modules + the
  grouped-linked tools (square/circle + their auto-children). Data
  options later (see "After AI" below).

#### 6. Schedule canvas mind-map seed (operation) — **CORE SHIPPED** (verified 2026-05-23)
Verified that `Canvas: Build` op (createLiveData.js:7411, priority 8) already mirrors Schedule tasks onto the Schedule Canvas page: per-task COPY_LINK with meta.x/y stacking, orphan sweep, position-preservation across re-fires. The link-tool primitives shipped this session (#5 — linked-rect / linked-circle / endpoint drag / midpoint curve / edge labels) compose on top — users can now add linked shapes to group timeslots manually. Remaining polish (deferred):
- "# Mindmap" textblock auto-stamped at canvas top on first build
- Auto-create linked-circle around each timeslot's slot containers (using the linked-shape primitive now in place)
- "Canvas-toolbar shortcut for new textblock" — quick new-textblock button (the existing canvas DnD already accepts textblocks dropped from elsewhere)

(Original spec retained below for reference.)
#### 6. Schedule canvas mind-map seed (operation) — ORIGINAL SPEC
Once #1–#5 land, seed the Schedule canvas with a demo mind map via
operation:
- **Canvas-toolbar shortcut for "new textblock"** — add it. Click
  the shortcut → drop a textblock at the canvas center.
- **Operation seeds**:
  1. A textblock at the top with `# Mindmap` heading (H1).
  2. Underneath (NOT connected to the textblock): a **preview**
     node of today's Schedule container (the column/day).
  3. From the day container: link-lines to a **representation**
     node of each timeslot.
  4. From each timeslot representation: **linked circles** that
     contain the timeslot's child containers inside (so each
     timeslot circle group-drags as a unit).
- Demonstrates that the canvas, the representation toggle, and
  the link tools all compose into a working mind-map editor
  without the system ever calling it a "mind map".
- **Per-day + bidirectional with Schedule** (added 2026-05-21):
  - **Remove the canvas's `filterOverride: {}`** so it joins the
    date-filter cascade (currently the Schedule Canvas page opts
    OUT of the date filter; for per-day canvases it must opt IN).
  - **Schedule Canvas template** — a `meta.templateName:"Schedule
    Canvas Daily"` subtree saved in the Templates manifest. Mirrors
    Daily Routine: a root canvas occurrence carrying the seeded
    mindmap layout (textblock heading + day-container preview node
    + per-slot representation crumbs + per-slot linked circles).
    Identity signatures on every node so re-apply on a date nav
    doesn't duplicate.
  - **`Schedule Canvas: Build Day` op** — mirror of `Schedule:
    Build Day`. Triggers: onLoad / onFilterChange (ancestorLabel:
    "Schedule Canvas") / onAdd / onDelete. `$canvasDate` resolves
    via `$trigger.date` → `$canvasPage._effectiveFilter.<dateFid>`
    → `$today`. APPLY_TEMPLATE the Schedule Canvas Daily template
    onto the canvas page, then stamp `$canvasDate` on the cloned
    nodes' date field bindings.
  - **Bidirectional flow with the Schedule** — every canvas node
    representing a Schedule task is COPY_LINKed to the Schedule
    page's task occurrence (same `linkedGroupId`). Drag a task in
    the Schedule → its representation node on the canvas updates;
    edit on the canvas → reflects on the Schedule. Same mechanism
    as the kanban + Todo List bidirectional pattern (item #7),
    reused. Server's `update_occurrence` linked-group fan-out
    already handles propagation.
  - **Position deltas stay canvas-local** — `meta.x/y` only writes
    to the canvas's copy, NOT to the Schedule's copy (the canvas
    is the layout owner; Schedule doesn't care about x/y). Done by
    excluding `meta.x` and `meta.y` from the linked-group fan-out
    allowlist on the server (need a tiny server-side check —
    `socketHandlers/occurrences.js:91-124`).

#### 6.5. Drag-to-import: paste/drop text → native doc tree (Wikipedia smoke test) — **PHASE A SHIPPED 2026-05-21**
**End-to-end drop pipeline now wired.** Drag selected HTML / markdown
/ plain text from another tab into ANY container in the grid →
server materializes the subtree → entities broadcast to all
connected tabs. Wikipedia article smoke test (drag a full article
selection into a container) should now produce a Moduli subtree
with headings as containers, paragraphs as textblocks, images as
artifact modules, lists as instances, and tables as raw-HTML
preview textblocks.

**Landed 2026-05-21:**
- **`server/services/wikipediaTools.js` `htmlToMarkdown` is now
  exported + configurable** via opts: `keepImages` / `keepTables` /
  `keepFigures` / `stripClasses`. Defaults preserve the existing
  Wikipedia-summary stripping behavior (legacy callers byte-
  identical); the drop pipeline opts ALL ON to keep media.
  - Image conversion: `<img>` → `![alt](src)` with independent
    attribute regexes (HTML attr order isn't guaranteed).
  - Figure conversion: `<figure><img><figcaption>` → image markdown
    + italic caption paragraph.
  - Table conversion: raw `<table>` HTML stashed as a placeholder
    BEFORE later inline-mark / tag-stripping passes (which would
    otherwise mangle the raw HTML inside the fence), then restored
    as a fenced ```html block at the very end. markdownImporter
    renders fenced code as a textblock codeBlock node — a faithful
    preview until the user/AI promotes it to a `kind:"table"` container.
- **`POST /api/v1/import/html`** wraps the above in a REST endpoint:
  body `{ gridId, parentId?, html, title?, keepImages?, keepTables?,
  keepFigures?, stripClasses?, dryRun? }` → runs htmlToMarkdown →
  markdownToModuli → broadcasts `module_created`/`occurrence_created`
  to the user's socket room (no broadcast when `dryRun`). Returns
  `{ rootOccurrenceId, stats, modules, occurrences, markdown }`.
  Image markdown lands in the importer but currently passes through
  as inline alt text — see "still ahead" below.
- **16 regression tests** in `server/__tests__/htmlToMarkdown.test.js`
  covering default stripping, each option's positive case, image src/alt
  attribute-order robustness, the table-fence-doesn't-get-stripped
  property, custom `stripClasses`, and the combined Wikipedia-shape
  document smoke test.

**Still ahead (Phase B, in order):**
1. ✅ **markdownImporter image handling** — DONE 2026-05-21
   (commit `3209e151`). Block-level `![alt](src)` mints a
   `role:"artifact" kind:"image"` module with `fileRef:<src>`.
   Inline images inside prose stay as alt text for Phase B.
2. ✅ **markdownImporter table fast-path** — DONE 2026-05-21
   (same commit). `` ```html ``` fenced blocks become textblocks
   with `meta.htmlPreview:true` + a TipTap codeBlock node holding
   the raw HTML. Phase B promotes to a real `kind:"table"` container.
3. ✅ **Client drop entry point** — DONE 2026-05-21 (this commit).
   `handleExternalDrop` in `dropHandlers.js` detects substantial
   HTML / multi-paragraph text / markdown-structured plain text
   and emits an `import_text` socket event with the dropped
   content + the destination container as `parentId`. The server
   handler at `server/socketHandlers/import.js` runs the converter
   + importer and broadcasts the resulting entities via the
   existing `module_created` / `occurrence_created` events. Short
   single-line text drops still fall through to the legacy
   "one instance with this label" path.
4. ✅ **Remote image rendering** — DONE 2026-05-21 (same commit).
   New `client/src/helpers/fileRef.js` `resolveFileRef(fileRef)`
   passes absolute URLs (`http(s)`/`data:`/`blob:`/leading `/`)
   through verbatim; relative refs prepend `/uploads/`. Wired into
   `ArtifactCard`, `ArtifactContent`, `Field.jsx`. Wikipedia
   images now render via plain `<img src>` without upload.
5. ✅ **Drop UX polish (Phase B)** — DONE 2026-05-21:
   - **Floating preview pill** lives next to the cursor during
     a native external drag — `helpers/DragProvider.jsx`
     `ExternalImportPreview` rendered when `dragover` on
     `.grid-frame` carries `Files`/`text/html`/`text/plain`.
     Labels per source: "Upload file" / "Convert HTML → modules"
     / "Convert text → modules". Cleared on `drop`, document
     `dragend`, or `dragleave` of the window (relatedTarget null).
   - **Drop on empty grid cell → mint panel + container** is wired
     in `handleExternalDrop.resolveImportParent` (3-mode resolver:
     container > page > grid-cell) via `LayoutHelpers.create*`.
   - **Loading toast** swaps to success/fail on
     `import_text_result` (sonner is now a top-level ESM import in
     `dropHandlers.js`; the previous Claude's `require("sonner")`
     would have thrown in vite's ESM bundle).
   - **Native drop reaches the importer** — `DragProvider.jsx`'s
     `.grid-frame` `onDrop` builds a `dropContext` with the right
     `sourceKind` (`"file"` or `"external"`) and routes through
     `routeDrop`. Previously the file fallback called the unimported
     `handleFileDrop` directly (broken since the May 8 cd1b3423
     refactor); HTML/text drops from browser tabs were dropped on
     the floor entirely.
6. ✅ **markdownImporter pipe-table → `kind:"table"` container** —
   DONE 2026-05-21. `parseBlocks` recognizes a header row + `---`
   separator + body rows; `buildTable` mints a
   `role:"container" kind:"table"` module whose occurrence carries
   `meta.table = { columns:[{id,title,width,…}], rowCount, cells }`.
   Cells store TipTap docs (paragraph with a text node, or just
   a paragraph for empty cells). The ```html``` fence fallback
   stays for tables `htmlToMarkdown` couldn't convert. Helper
   `splitTableRow` tolerates leading/trailing `|` omission and
   escaped `\|`. 5 new tests cover the canonical shape,
   alignment-marker separators, escaped pipes, defensive
   non-promotion of stray `|` in prose, and empty-cell shape.
7. ✅ **Inline image marks (Phase B)** — DONE 2026-05-21. New
   `paragraphToBlocks(text)` in markdownImporter splits prose
   paragraphs on `![alt](src)` patterns, emitting a sequence of
   `[paragraph, image-block, paragraph, ...]` TipTap nodes per
   imported textblock. Image is configured `inline:false` in the
   editor (`client/src/ui/Editor.jsx:291`), so block-level is the
   right shape. Whitespace-only chunks around an image are dropped
   so we don't mint empty paragraphs. Inline images do NOT mint
   artifact modules (that's still block-only); they become editor
   image nodes only. 3 new tests cover canonical inline,
   start-of-paragraph (no leading empty paragraph), and two
   inline images in the same paragraph.
8. **AI refinement hook** — see the original docket entry above
   for the registry of element handlers + site adapters the AI
   plugs into.

**Original docket text (unchanged below):** First-class drop-target conversion of arbitrary
external content into our `container / instance / textblock`
hierarchy. The AI assistant will lean on this same pipeline later
for document refinement; this is the deterministic starting point
the AI can incrementally improve.

**Acceptance smoke test:** open a Wikipedia article in another
window, select all body content (headings, paragraphs, lists,
images, infobox, tables), drag the selection into the grid. The
result should be a Moduli page that visually replicates the
article's layout using our modules — headings become nested
containers, prose paragraphs become textblocks, list items become
list-kind instances, embedded images become artifact occurrences
parented inline, and tables become a table-kind container (or, if
that's heavy, a textblock with a TipTap table node — fall back per
the importer's existing capability surface).

**Why this is tractable now:** the deterministic half already
exists server-side and just needs a client-side drop entry point.
What's built:
- `server/services/markdownImporter.js` (Phase A) — markdown →
  containers (kind:list, nested by heading depth) + instances
  (kind:list per `*`/`-`/numbered list item) + textblocks (kind:doc
  for prose with TipTap JSON, codeBlock node for fenced blocks).
  Inline `**bold**` / `*italic*` / `` `code` `` / `[text](url)`
  preserved as TipTap marks. Verified live: a 4-heading doc lands
  as 5 containers + 5 instances + 3 textblocks.
- `server/services/wikipediaTools.js` — HTML→markdown converter
  tuned for Wikipedia output (currently strips
  infobox / navbox / refs / images; keeps headings, paragraphs,
  lists, inline marks). The strip-by-default is intentional for
  AI research summaries; the drop-import flow wants the OPPOSITE
  — keep images + tables.
- `POST /api/v1/import/markdown` — already exposes the importer
  with `dryRun` support. Broadcasts `module_created` +
  `occurrence_created` to the user's socket room on real imports.
  Idempotency-Key middleware applies, so a repeated drop won't
  double-import.
- `DragType.TEXT` + `DragType.URL` are already in the enum
  (`client/src/helpers/dragSystem.js:83-84`) so the drag detection
  is in place; the handler branch is missing.

**Pipeline (deterministic Phase A — the starting point):**
1. **Drop entry point** — extend `handleFileDrop`/external drop in
   `client/src/helpers/dropHandlers.js` to ALSO process
   `dataTransfer.types` containing `text/html` (richer than
   `text/plain`). Browsers expose the highlighted content's
   `outerHTML` in `text/html` on drag from another tab — that's
   the only way to capture structure (headings, image src, table
   markup). Fall back to `text/plain` when HTML is absent (plain
   selection drop).
2. **HTML → intermediate markdown** — extract a new
   `convertHtmlToMarkdown(html, { keepImages: true, keepTables: true })`
   from `wikipediaTools.js`'s converter, configurable to KEEP
   images and tables (the AI-summary variant strips them). Image
   tags become `![alt](src)`; tables become pipe-table markdown
   or, if the converter can't produce clean markdown, a raw
   `<table>` chunk wrapped in a literal textblock for now.
3. **markdownImporter (Phase A) — extend** to handle:
   - `![alt](src)` image markdown → mint an `artifact`-role module
     with `kind: "image"` and `fileRef: <src>` (or, for absolute
     URLs, a hosted-image module that displays via `<img src>`
     without uploading). Place inline as an instance occurrence
     parented under the surrounding container.
   - markdown tables (`|...|`) → either a `kind:"table"` container
     with one `meta.table.columns` per column + cell embeds (the
     full thing) OR a textblock with a TipTap `table` node (the
     fast path). Pick fast path for Phase A.
4. **Drop UX** — same overlay behavior as native file drop: when
   `text/html` + a parsable selection is detected, light the
   highlighted-cell drop zone, show a preview pill ("Convert →
   Doc tree"), commit on drop. Empty grid cell → mint a new
   page+container. Existing container → append as siblings.

**Capacity for the AI to refine over time:**
- Pluggable `siteAdapter(html, hostname)` step BEFORE markdown
  conversion — site-specific HTML cleanup (Wikipedia: strip
  reference superscripts + edit buttons; New York Times: pull
  out paywalled markup; etc.). The AI fills these adapters in
  per-host as it observes drop sources.
- `convertHtmlToMarkdown` becomes a registry of element handlers
  (`<table>`, `<figure>`, `<blockquote>`, etc.) that the AI can
  extend by writing more handlers without touching the core
  pipeline.
- A post-import "Refine" prompt — the AI sees the imported
  subtree + the original HTML, suggests structural improvements
  (merging short textblocks, splitting heading levels differently,
  promoting a textblock to a container, etc.) which the user can
  one-click apply.

**Out of scope for Phase A:** semantic understanding ("this article
is about a person — turn the infobox into a Person instance with
fields"), cross-article linking, image upload to local storage
(use external `<img src>` for now), JavaScript-rendered SPA
content (Wikipedia is static HTML so the smoke test is safe).

**Why this docket is here, not just done now:** the HTML→markdown
extension + the image / table importer additions are each a
focused chunk of code — not impossible, but they need the test
fixture (a known Wikipedia article snapshot) to validate against,
and the UX feedback loop (dropzone overlay, conflict resolution
when dropping onto an existing container vs. a page) needs to be
designed alongside. Land in a dedicated session.

#### 6.55. IMPORT_HTML / IMPORT_MARKDOWN operation actions — **SHIPPED 2026-05-21**
Two new pipeline action types fronting the same `import_text` socket
handler the drag-to-import flow uses. Both suspend the pipeline
(same primitive `CALL_API` uses), await the server ack, and bind
`{ rootOccurrenceId, stats, detectedFormat }` to `cfg.resultVar`.
Downstream pipeline steps can then `MOVE_OCCURRENCE id:$page.rootOccurrenceId`
or stamp fields on the imported root.

**Wiring (as shipped, differs from original spec):**
- New `IMPORT_HTML` / `IMPORT_MARKDOWN` cases in `helpers/operationActions.js`
  return `{_suspend: true, _importText: true, request, resultVar, errorVar, onError}`.
- `_handleSuspend` in `helpers/operationExecutor.js` gained an
  `_importText` branch that calls `operationsBridge.importText(req)`
  and `resumeContinuation`s with the result (or smuggles the error
  envelope to `errorVar` when `onError === "continue"`).
- `state/bindSocketToStore.js` wires `operationsBridge.importText`
  to a Promise wrapper around the existing `import_text` /
  `import_text_result` socket events. Default 60s timeout, max 120s.
- **Fixed in passing**: the suspend-wrapper at `executeSteps` (lines
  ~1567) was stripping the `_callApi` / `_importText` / `errorVar` /
  `onError` props from the action's return — so every suspend was
  silently falling through the GET_USER_INPUT branch by default
  (would have crashed on shape mismatch). The wrapper now spreads
  `...result[0]` so type discriminators survive. CALL_API benefits
  from this too (the bug was latent — no tests exercised it).
- Server-side `import_text` socket handler (untouched) broadcasts
  `module_created` + `occurrence_created` for every minted entity,
  which the existing store handlers absorb — pipeline callers don't
  need to apply effects themselves.

**Action cfg:**
- `html` / `markdown` — source content ($var interpolation supported)
- `parentExpr` — destination parent occurrence id ($expr); null/missing → server creates as grid-level
- `title` — root container label (default "Imported")
- `htmlOpts` — `{ keepImages, keepTables, keepFigures, stripClasses }` (IMPORT_HTML only)
- `timeoutMs` — default 60000, max 120000
- `resultVar` — default `$importResult`
- `errorVar` — default `$importError` (only set when `onError === "continue"`)
- `onError` — `"fail"` (default; drops rest of pipeline) | `"continue"` (route error to errorVar)

**Tests:** 7 cases in `__tests__/importTextAction.test.js` cover
sentinel shape (HTML + markdown), missing-content no-op,
end-to-end suspend/resume with bridge invocation, `onError:"continue"`
error envelope routing, default-`fail` no-crash, and missing-bridge
warn-and-drop.

**Original docket (now obsolete) follows:**
**Added 2026-05-21.** Mirror the `/api/v1/import/markdown` +
`/api/v1/import/html` REST endpoints as new pipeline action types
so operations can feed arbitrary text or HTML through the importer
and route the resulting subtree wherever they want.

**Why:** the AI assistant + future op-driven workflows want to
take a chunk of content (from `$trigger.value`, from `CALL_API`'s
response body, from a `GET_USER_INPUT` paste field, etc.) and
materialize it as a real Moduli subtree without going through the
REST round-trip. Same Phase A importer; just exposed inside the
pipeline language.

**Action shapes:**
- `IMPORT_HTML` —
  cfg: `{ html, parentExpr?, title?, keepImages?, keepTables?,
  keepFigures?, stripClasses?, resultVar? }`
  Runs `htmlToMarkdown(html, ...) → markdownToModuli(...)`. Pushes
  one CREATE_ITEM effect per minted module + one UPDATE_OCCURRENCE
  per occurrence wire-up (mirrors how APPLY_TEMPLATE already fans
  out). Binds `cfg.resultVar` to
  `{ rootOccurrenceId, stats, markdown }` so downstream steps can
  MOVE the root under a destination, set a field on it, etc.
- `IMPORT_MARKDOWN` —
  cfg: `{ markdown, parentExpr?, title?, resultVar? }`
  Same effect emission, just skips the HTML conversion stage.

**Wiring:**
1. New cases in
   `client/src/helpers/operationActions.js executeActionItem` —
   route to a thin client wrapper that calls
   `services/markdownImporter.js`'s logic in-process (it's pure
   JS, no Mongoose dependency at the planning layer) and emits
   CREATE_ITEM effects. Alternative: send a `RUN_OPERATION_IMPORT`
   socket event to the server which calls the real REST handler
   and broadcasts on the user room. The pure-client path is
   simpler + side-steps the socket roundtrip; verify the
   markdownImporter module is importable from the client bundle.
2. New cases in `executor`'s effect handler to apply the imports
   atomically.
3. New IDs visible in `$vars.$allItems` overlay so the SAME
   pipeline can do `MOVE_OCCURRENCE` on the rootOccurrenceId
   right after.

**Caller patterns:**
- AI: `CALL_API` to an LLM that returns a markdown response →
  `IMPORT_MARKDOWN markdown:$llmResp.text resultVar:$page` →
  `MOVE_OCCURRENCE id:$page.rootOccurrenceId to:<projects folder>`.
- Drag-to-import flow: client posts `/import/html` directly (faster),
  but the SAME content can be hand-fed through an op via this
  action when triggered from a different surface.

**Status:** scoped for next session — landing alongside Phase B of
the drag-to-import work. Tests + dry-run mode mirror what
markdownToModuli already exposes.

#### 6.6. Word-level draggable textblocks (magnetic-poetry primitive)
**Added 2026-05-21.** A new ultra-fine textblock variant where each
WORD (or short chunk) renders as its own draggable token rather than
flowing as continuous prose. Dragging rearranges word order;
right-click on a word opens the existing radial menu (edit / delete
/ duplicate / wrap-in-link); selecting multiple tokens and
shift-dragging moves the whole group.

**Why:** several user flows want word-granularity manipulation
that the current TipTap textblock doesn't expose well:
- magnetic-poetry composition (UI primitive)
- sentence re-ordering for editing / outlining drills
- AI prompt building (drag tokens from a pool into a slot)
- learning aids (vocabulary, language drills, sentence diagrams)

**Shape:**
- A new module `kind: "word-token"` under role:"textblock" (or a new
  role "word-token" if we want to bucket separately — TBD).
- Each word is its own `kind:"word-token"` occurrence so it can be
  dragged independently. Parent container groups them into a flowing
  row.
- The parent container would be a new `kind: "word-flow"` (or just a
  list container with a horizontal-wrap layout — re-use existing
  list with `display: flex; flexWrap: wrap; gap`) so dragging
  reorders within `occurrences[]`.
- An `auto-tokenize` action on a regular textblock that splits its
  textmap into word-token children and replaces the textblock with
  the word-flow container.
- Reverse `flatten` action that joins word tokens back into a
  single textblock.

**Acceptance:**
- Right-click a textblock → "Convert to word tokens" → each word is
  now an independent draggable chip.
- Drag a word from one spot to another → order updates in
  `occurrences[]`.
- Shift-select multiple words → drag as a group via the existing
  multi-select clipboard.
- Right-click a word → radial menu with delete / duplicate /
  edit-inline / wrap-in-link.
- Reverse "flatten" rebuilds a textblock from the current word order.

**Implementation sketch:**
- Word token module shape mirrors textblock but with `kind:"word-token"`.
  Label IS the word. No textmap. Renders as a compact pill — reuse
  `.instance-textblock-block` styling at a smaller scale.
- New container kind `word-flow` registers a flex-row-wrap layout.
- Auto-tokenize: parse the textmap's text nodes, split on whitespace
  + punctuation boundary (keep punctuation as its own tokens), mint
  a token per word, then replace the textblock occurrence with the
  word-flow container occurrence in the parent's `occurrences[]`.
- All drag is just the existing instance-drag system (which already
  handles reorder via `useDragDrop` + `dropHandlers.handleInstanceDrop`).
  No new drag primitive needed — the only new thing is the rendering
  shape and the tokenize/flatten ops.

**Out of scope (Phase A):**
- Cross-textblock word drag (out of one flow into another) — the
  generic drag-handlers should already cover this, but verify.
- Semantic grouping (noun phrases, named-entity-recognized chunks).
  Phase B can offer "Smart tokenize" that uses the AI to chunk by
  grammatical unit.

#### 7. Project kanban example in live data — **PARTIAL 2026-05-21**
Foundation landed (commit pending):
- New **`Projects` folder** under root manifest, sortOrder 6. Starts
  EMPTY in the seed — the user mints projects via the
  `Project: Create` op (mirrors how Day Pages folder fills up via
  `Day Page: Build` over time).
- **Project Page template** in the Templates manifest, built by
  `buildProjectTemplate(...)` (new helper in `server/utils/
  liveSystemBuilders.js`). Uses the SAME bracket-token replacement
  technique as the Day Page template:
  - Root page module: label `Project: {ProjectName}`,
    `meta.templateModule: true`, `meta.templateName: "Project Page"`.
  - Kanban board container (`role:"container" kind:"board"`) holding
    6 empty column sub-containers in spec'd order: Backburner /
    Docket / Working On / In Review / Test / Complete. Each column
    carries `meta.identitySignature: "kanbanCol:<key>"` so
    APPLY_TEMPLATE merge-mode treats re-apply as identity (no dupe
    columns).
  - Project Scope textblock below the kanban with TipTap doc
    containing skeleton sections (Overview / Goals / Milestones /
    Risks / Success Criteria). The `{ProjectScope}` token in the
    Overview paragraph gets replaced at instantiation; the
    `{ProjectName}` token in the H1 too.
  - All columns empty — user adds tasks after instantiation. NO
    hardcoded tasks per user direction.
- **`Project: Create` op** (`makeProjectCreateOp` in the same file).
  `triggerType: "manual"` — fires only on explicit user invoke.
  Takes optional `$projectName` + `$projectScope` vars (defaults
  `"Untitled"` / `"—"`), then APPLY_TEMPLATEs the Project Page
  template into the Projects folder with `replacements: {
  "{ProjectName}": "$projectName", "{ProjectScope}": "$projectScope" }`.
  Idempotency: skips if a page named `Project: <name>` already
  exists in `$allPages`.
- **New fields** (in the regular fields block, available for any
  module to bind):
  - `status` — select (6 manual options matching the kanban column
    labels). Input-enabled, no display.
  - `project` — occurrence-ref with find-mode optionsSource scoped
    to `$allPages` filtered by `label STARTS_WITH "Project:"`.
    Lets the Todo List page surface project-scoped tasks
    unambiguously.

Status:
- ✅ **GET_USER_INPUT integration** (commit `56a78368`) — Project:
  Create now branches on trigger type. onLoad seeds the "Moduli v1
  Launch" example project (idempotent); manual invoke chains two
  GET_USER_INPUT prompts (name then scope) before APPLY_TEMPLATE.
- ✅ **Project: Status Router op** (commit `0c907e9a`) — onChange
  statusFieldId trigger; walks task → currentColumn → kanbanBoard,
  FINDs the sibling column whose label matches the new status, and
  MOVE_OCCURRENCEs the task there. Same-project guarantee via the
  anchored kanban-board parent. Idempotent + silent on misses.

Still TODO (next session):
- **Cross-page COPY_LINK** from kanban tasks to Todo List
  Backburner/Docket containers (so tasks show up in both places
  with shared state). Likely a `Project: Sync To Todo` op that
  COPY_LINKs the task on creation when status is Backburner/Docket
  and the Status Router fans the move via the shared
  linkedGroupId. Cross-page bidirectional sync is the missing piece
  — the kanban-internal move now works.

Original spec retained below:
A made-up example project to demonstrate kanban + cross-page
linked tasks + bidirectional state ops. Lives in the live-data
seed.
- **New "project" page** (doc kind) titled something like
  *"Project: Moduli v1 Launch"* (made-up). Layout, top-to-bottom:
  1. **Kanban container** — a board-kind container with **6 columns**
     (confirmed 2026-05-21):
     `Backburner` · `Docket` · `Working On` · `In Review` ·
     `Test` · `Complete`.
  2. **Project scope** (BELOW the kanban container, per user
     follow-up) — a long-form textblock with a detailed scope:
     overview, goals, milestones, risks, success criteria. Make
     up plausible content for the made-up project (e.g. "v1
     Launch: ship the assistant drawer to all users by EOQ, with
     ≥99% uptime on the /api/v1/operations/:id/run endpoint…").
- **Make the project page a template** so the user can spin up
  new project pages with the same kanban-scope layout.
- **Example task instances** seeded across the 6 columns (so the
  kanban isn't empty on first load).
- **Cross-page copy-link** — each kanban task is COPY_LINKed to a
  task occurrence in the Todo List page's Backburner + Docket
  containers. **Direction confirmed 2026-05-21: BIDIRECTIONAL** —
  edits on either side propagate. Use the existing `linkedGroupId`
  fan-out (already bidirectional via server's `update_occurrence`
  handler at `socketHandlers/occurrences.js:91-124`).
- **Project select field on every kanban task** (confirmed
  2026-05-21). Add a new `project` field — type:
  `occurrence` with `meta.optionsSource = find` mode scoped to
  `_ancestors HAS_ANCESTOR <project-page-id>` (or simpler: scoped
  to all instances whose label matches project-page labels). Every
  kanban task instance gets this field STAMPED at seed time with
  the example project's name (or id). The select picker lets the
  user re-assign a task to a different project later. Operations
  that need to filter to "this project's tasks only" check this
  field instead of relying on container ancestry. Lets a single
  Todo List page show tasks across multiple projects without
  ambiguity.
- **Status field** — every kanban task gets a **select-type
  `Status` field** with 6 options matching the 6 kanban columns.
  Hidden binding on the source so it doesn't render inline (the
  column placement IS the visual indicator). Editable via the
  task's radial / header.
- **Day-filter field stamps** — every container in the project's
  schedule-bound spots gets a hidden `Date` input field (same
  pattern as the rest of pages/ops) so the day filter cascade
  works.
- **Operations** (status-driven movement, bidirectional):
  - User drags task → Schedule slot → **moves the kanban copy to
    `Working On`** AND stamps Date/timeslot. Schedule slot
    placement is canonical "you're doing it now".
  - User changes a task's Status field → `Backburner` → kanban
    copy lands in Backburner column AND the schedule/todo-page
    copy moves into the **Backburner container** on Todo List
    (mirror in both places).
  - Status → `Docket` → same pattern, into Todo List Docket
    container.
  - Status → `Working On` → moves into Schedule's Due (no
    timeslot) OR keeps the existing slot if one is already set
    on the task.
  - Status → `In Review` / `Test` / `Complete` → stays in
    Schedule, kanban copy moves to the matching column.
  - Implement as a single `Project: Status Router` op that fires
    on Status field change (onChange), reads `$trigger.value`,
    and routes the kanban copy + the schedule/todo copy via
    MOVE_OCCURRENCE / LINK_OCCURRENCE_TO_PARENT effects.
- Open question: where does the `Date` field live for kanban
  tasks (on the task instance or on a wrapping container)? And
  what's the project's name so I can write the scope textblock?

#### 8. Files, uploads, artifacts, media — focused audit + polish pass
The whole file-handling surface (upload endpoints, artifact storage,
media renderers, per-kind viewers, file management UI) has grown
piecemeal and deserves a dedicated session to flush out. Capture of
current state + known gaps below; priorities at the end.

**What exists today:**

*Upload endpoints (server/server.js):*
- `POST /api/artifacts/upload` (~line 370) — the canonical path.
  Accepts `multipart/form-data` `{file, userId, gridId, parentFolderId?,
  manifestId?, moduleId?, occurrenceId?}`. Idempotent on `moduleId`
  (the optimistic drop flow pre-mints IDs). Mints a `role:"artifact"`
  module + an occurrence pointing at it; creates a `View` with the
  right `viewType`/`artifactType` for the standalone artifact-panel
  display path. Saves the file to `uploads/user/<timestamp-rand>.<ext>`,
  served at `/uploads/user/<ref>` AND `/artifacts/<ref>` (two mount
  points — see gap #1). 50MB cap via multer.
- `POST /api/upload` (~line 458) — **legacy duplicate**. Creates a
  module only (no occurrence). Saves flat in `/uploads/` (not under
  `user/`). Only the connection-import flow uses it. Should be folded
  into `/api/artifacts/upload` or deleted (see gap #2).
- `POST /api/connections/:id/import` — imports a file from a
  pre-configured external storage path (`/home/joshpoms/files`,
  `/home/joshpoms/notebook`). Copies the file into `/uploads/` and
  creates a module. Same legacy code path as `/api/upload`.

*Kind classification (`server/server.js mimeToKind`):*
- image / video / audio / pdf — from MIME type
- code — from extension (`.js / .jsx / .ts / .py / .json / .yaml / ...`
  whitelist; `CODE_EXTENSIONS` set at the top of server.js)
- markdown — fallback

*View dispatch (`viewFieldsForKind`):*
- `display` viewType for image/video/audio/pdf
- `code` viewType for code files
- `markdown` viewType otherwise

*Client-side renderers:*
- `client/src/modules/ArtifactCard.jsx` — inline card in a container.
  Thumbnail mode (compact) + click-to-expand mode (full media).
  Per-kind dispatch: `<img>` / `<video>` / `<audio>` / `<iframe>` for
  pdf. Shows spinner during `meta.uploadStatus === "pending"`,
  AlertCircle during `"error"`.
- `client/src/modules/ArtifactContent.jsx` — page-level viewer.
  Routes by viewType: `markdown` → TipTap editor; `code` → CodeViewer
  (a `<pre><code>` of the fetched file, NO syntax highlighting);
  `display` + artifactType → `<img>` / `<video>` / `<audio>` /
  `<iframe>`. Also handles legacy `viewType === "image"|"pdf"|"audio"|"video"`
  values.
- `client/src/modules/pages/PageDisplay.jsx` — thin page wrapper
  around ArtifactContent.
- `client/src/helpers/fileRef.js resolveFileRef(ref)` — the one
  authoritative URL resolver. Absolute URLs (`http(s)://`, `data:`,
  `blob:`, leading `/`) pass through; relative refs prepend `/uploads/`.
  This was the fix that made Wikipedia drops work without uploading.

*Drop flow (`client/src/helpers/dropHandlers.js handleFileDrop`):*
- Optimistic — mints client-side `moduleId` + `occurrenceId`, dispatches
  a placeholder module with `meta.uploadStatus: "pending"`, wires it
  into the destination container/view, then fires `/api/artifacts/upload`
  in the background. Server upserts using the same IDs. On error,
  flips `uploadStatus` to `"error"`.
- Single-file only — `dt.files[0]` taken; the rest dropped silently
  (gap #6 below).

*Markdown importer artifact integration:*
- Block-level `![alt](src)` in imported markdown mints
  `role:"artifact" kind:"image"` with `fileRef:<src>`. Remote URLs
  (Wikipedia) pass through verbatim via the `resolveFileRef`
  absolute-URL branch — no upload, no rewrite, no mirror.
- Inline `![alt](src)` (Phase B shipped 2026-05-21) splits the
  paragraph into TipTap image nodes (block-level, since the editor's
  Image extension is `inline:false`). Also no upload.

*ManifestTree affordances:*
- `+New Doc` button on folder hover — mints a markdown artifact
  inside the folder.
- Drag artifact from ManifestTree → another panel / container /
  grid cell. Routed via `helpers/dropHandlers.js handleArtifactDrop`.
- `data-occ-id` / `data-page-occ-id` attributes are read by
  scroll/flash + drop-target resolution.

**Known gaps + improvement opportunities:**

1. **Two static mount points for the same files** — `/uploads/<ref>`
   AND `/artifacts/<ref>` both serve `uploads/`. Pick one (probably
   `/uploads/`) and remove the other; update `resolveFileRef` if
   needed.
2. **`/api/upload` is a legacy duplicate** of `/api/artifacts/upload`.
   Either delete it + migrate the connection-import flow, or keep
   only as an internal alias. Right now both exist and behave
   differently (the legacy one doesn't create an occurrence).
3. **~~No content-hash dedup~~** DONE 2026-05-22. `/api/artifacts/upload`
   in `server/server.js` now streams the temp file through
   `crypto.createHash("sha256")` BEFORE the rename. If a module
   already exists for this user with the same `meta.sha256` AND a
   LOCAL fileRef (external-URL refs are filtered out), the dedup
   branch runs: temp file unlinked, the optimistic-flow placeholder
   module deleted (and `module_deleted` emitted so the client clears
   it), occurrence (re)wired to point at the existing module +
   `occurrence_updated`/`occurrence_created` emitted, response
   returns `{ module: existing, occurrence, fileRef: existing.fileRef,
   dedup: true }`. Non-dedup path stamps `meta.sha256` on every new
   module so subsequent uploads can dedup against it. Helper
   `sha256OfFile(filePath)` is a streaming hash so 50MB files don't
   load to RAM. 144/144 server tests still green.
4. **~~No image optimization / responsive variants~~** DONE
   2026-05-22. `generateImageThumbnails(srcPath, sha256, mimeType)`
   helper in server.js runs against every image upload via the
   sharp pipeline (auto-rotate, withoutEnlargement, WebP encoded
   at q78/q82). Writes `<sha256>-256.webp` + `<sha256>-1024.webp`
   into `uploads/thumbnails/`. Filename is content-hash-keyed so
   dedup'd uploads automatically reuse existing thumbs — no
   regeneration, no duplicates. Skipped silently for non-image
   mime types AND for unsupported raster formats (SVG / GIF —
   sharp's pipeline doesn't preserve vector / animation
   semantics). Stamped on `module.meta.{thumb256, thumb1024}`.
   Client wiring: `ArtifactCard` picks `thumb256Src` for compact
   thumbnail mode + `thumb1024Src` for expanded mode (falls back
   to original `src` when meta refs are missing — covers external
   URLs + pre-sharp uploads). Smoke: 649 KB PNG → 78 KB at 1024px
   (88% smaller) → 17 KB at 256px (97% smaller).
5. **No file size displayed anywhere** — store `meta.uploadSize` on
   the module (the placeholder already does this) and surface it
   in: ArtifactCard expanded mode header, the artifact viewer page,
   the ManifestTree tooltip. Helps users notice oversize uploads.
6. **No multi-file drop** — `dt.files[0]` only; remaining files
   silently dropped. Loop `dt.files` and mint one module +
   placeholder per file; upload in parallel. UX should batch the
   toast (`"Uploading 5 files…"` → `"Uploaded 4 of 5"` →
   `"Done"` or `"1 failed"`).
7. **No upload progress** — spinner is all-or-nothing. Use a
   `XMLHttpRequest` (or `fetch` with a custom progress stream) to
   surface byte-level progress and render a determinate progress
   bar inside the placeholder card.
8. **No upload cancellation** — once `/api/artifacts/upload` is
   in flight, the only way to bail is to delete the placeholder.
   Wire an AbortController + a cancel button on the placeholder
   card.
9. **PDF viewer is a bare `<iframe>`** — works on every browser
   that has a built-in pdf renderer but lacks page nav, search
   integration, text selection extraction (for citations later),
   thumbnails. Consider PDF.js for a richer in-app viewer; iframe
   stays as the fallback for very large PDFs.
10. **Video has no transcoding** — large MOVs / HEVC / unsupported
    codecs play raw and may fail to decode. Add an on-upload
    detection step (probe via `ffmpeg`/`fluent-ffmpeg`) and either
    transcode in the background or surface a clear "unsupported"
    state with a download link.
11. **~~Audio is `<audio controls>` only~~** DONE 2026-05-22. New
    `AudioWaveform` component in `ArtifactContent.jsx` lazy-loads
    `wavesurfer.js` on first audio open (matches the lazy-load
    pattern used for highlight.js + tesseract.js). Renders a
    moduli-themed waveform (96px tall, blue progress on muted
    grey unplayed) with click-to-seek built in, a Play/Pause
    button, and a "Loading waveform…" placeholder while the
    module loads. Native `<audio controls>` stays inline as a
    fallback for right-click → save / playback-speed control;
    each owns its own MediaElement so they don't fight. Cleans
    up via `ws.destroy()` on unmount. Chapter markers not yet —
    needs metadata source.
12. **~~No EXIF / metadata extraction~~** DONE 2026-05-22. New
    `extractImageMetadata(filePath, mimeType)` helper in server.js
    runs against every image upload via the rename branch in
    `/api/artifacts/upload`. Uses `exifreader` (no native bindings;
    handles JPEG/PNG/TIFF/HEIC/WebP). Stamps
    `module.meta.{width, height, exif}` with a curated tag subset
    (DateTimeOriginal / Make / Model / FNumber / ExposureTime / ISO
    / FocalLength / Orientation / GPSLatitude / GPSLongitude /
    GPSAltitude). Sanitized to plain `{tagName: description}` so
    Mongo persists cleanly under the existing `meta` Mixed field;
    non-image uploads keep their meta unchanged. Failure is silent
    (returns null) — upload itself never fails for metadata reasons.
13. **No in-place image edit affordance** — crop, rotate, brightness
    have to be done in an external tool then re-uploaded. Even a
    minimal `cropperjs` "Crop" radial menu item on image artifacts
    would be valuable.
14. **CodeViewer has no syntax highlighting** — just
    `<pre><code>{text}</code></pre>` (see
    `ArtifactContent.jsx CodeViewer`). Add `highlight.js` or
    `shiki` and choose theme from CSS vars. Language picked from
    file extension or `language` field on the module.
15. **No per-user storage quota** — unlimited uploads. Track
    `User.usedBytes` (or compute on demand from a `Module.size`
    aggregation), enforce a soft cap, surface "X MB of Y MB used"
    in user settings.
16. **No virus / content scan** — accepts any file. Probably out of
    scope for personal-use but worth flagging if Moduli ever opens
    to multi-tenant.
17. **No CDN / signed-URL serving** — Express serves `/uploads/`
    statically. Fine for single-tenant; would need rework for
    multi-tenant. Capture as a future concern.
18. **~~Upload directory is flat~~** DONE 2026-05-22. New uploads
    via `/api/artifacts/upload` AND `/api/connections/:id/import`
    now land in `uploads/user/YYYY-MM/<file>` via the new
    `yearMonthShard()` helper. `fileRef` stamped as `user/YYYY-MM/<file>`
    (POSIX-style separator for URL safety). Existing files unaffected;
    `helpers/fileRef.resolveFileRef` and the Express static mount
    both serve nested paths so legacy flat refs keep working. New
    migration script `server/scripts/shardExistingUploads.js` walks
    `uploads/user/` top-level files, derives YYYY-MM from the
    leading timestamp in the filename (or mtime fallback), moves
    them into the right shard, AND updates `Module.fileRef` in one
    pass. Dry-run by default; `--apply` actually moves. Skips files
    with no Module ref (those are orphans for the cleanup script);
    skips files when the target already exists.
19. **~~No file lifecycle / trash~~** PARTIAL 2026-05-22. New
    `server/scripts/cleanupOrphanArtifacts.js` script walks
    `uploads/user/` (and optionally `uploads/md/` via
    `--include-md`), cross-references against every artifact
    Module's `fileRef`, reports / deletes files no Module references.
    Safe by default: dry-run unless `--delete` passed; even with
    `--delete`, only files older than `--age=N` days (default 7) are
    removed (covers in-flight uploads / race windows where the
    Module row hasn't persisted yet). External-URL fileRefs (Wikimedia
    drops etc.) never appear in `uploads/` so they're naturally
    skipped. Smoke-tested in dry-run on dev DB: 31 orphans = 44.39 MB.
    Run: `node --env-file=.env server/scripts/cleanupOrphanArtifacts.js`.
    Still pending: the soft-delete / `meta.trashedAt` lifecycle —
    the user has to manually run this script for now; a periodic cron
    or post-delete cleanup hook would close the loop.
20. **No "download" / "open externally" affordance** — viewer pages
    show the media inline but offer no way to grab the original. A
    download button (with the original filename, not the
    timestamp-randomized one) in the artifact viewer header.
21. **External + internal artifact types have different shapes** —
    Wikipedia drops mint `kind:"image"` with `fileRef:"https://..."`
    (no upload). Local uploads mint `kind:"image"` with
    `fileRef:"user/<timestamp>.png"`. Renderers handle both via
    `resolveFileRef`, but other code paths (deletion, dedup, size
    display) need to special-case the absolute-URL form. Document
    + audit the distinction.
22. **~~No "mirror remote → local"~~** DONE 2026-05-22 as a
    migration script (`server/scripts/mirrorRemoteImages.js`). Walks
    every artifact Module whose `fileRef` is `http(s)://`, downloads
    via global `fetch` (25MB cap, 30s timeout, 250ms polite delay
    between requests), writes to `uploads/user/YYYY-MM/`, recomputes
    SHA-256, dedups against existing local modules (skips the write
    + repoints to existing fileRef), stamps `meta.external:false` +
    `meta.sha256` + `meta.uploadSize` + `meta.mirroredFromUrl`.
    Dry-run by default; `--apply` actually downloads; `--max=N` caps
    how many to mirror per run. Idempotent: already-mirrored modules
    (`meta.external === false`) skipped on rerun. No on-import
    automatic mirroring yet — has to be invoked manually; the
    docket's "Optional on-import step" framing means this can stay
    as a periodic admin job rather than slowing every import.
23. **No file metadata field schema** — `module.meta` is Mixed.
    There's no documented contract for what keys an artifact
    module's meta may carry (`mimeType`, `originalName`,
    `uploadSize`, `uploadStatus`, `folderId`, `exif?`, `width?`,
    `height?`). Document the schema in `models/Module.js` as a
    comment + add a TypeScript-style JSDoc typedef.
24. **No drag-out-to-OS** — drag an artifact from Moduli onto the
    desktop and... nothing. HTML5 native drag-out (via
    `setData("DownloadURL", ...)` in Chrome) would let users
    quickly extract files. Browser-quirky but worth scoping.

**Suggested ordering of work:**
1. **Quick wins** (small, isolated): ~~dedup endpoint mount points
   (#1)~~ ✅ 2026-05-21, ~~delete `/api/upload` after migrating
   connection-import (#2)~~ ✅ 2026-05-21, ~~add file-size display
   (#5)~~ ✅ 2026-05-21, add download button (#20), ~~document
   metadata schema (#23)~~ ✅ 2026-05-21.
2. **High-impact UX**: multi-file drop (#6), upload progress (#7),
   upload cancellation (#8), ~~code syntax highlighting (#14)~~ ✅
   2026-05-21.
3. **Storage hygiene**: ~~content-hash dedup (#3)~~ ✅ 2026-05-22,
   ~~date-partitioned upload dir (#18)~~ ✅ 2026-05-22,
   ~~orphan-file cleanup pass (#19)~~ ✅ 2026-05-22.
4. **Media depth** (per-kind viewer polish): image optimization +
   thumbnails (#4), EXIF extraction (#12), in-place image crop/rotate
   (#13), PDF.js viewer (#9), waveform for audio (#11), video
   transcoding (#10).
5. **External / multi-tenant prep** (defer until needed): per-user
   quota (#15), CDN (#17), drag-out-to-OS (#24), remote-image
   mirroring (#22), virus scan (#16).

**Out of scope (probably never):** in-app video editing, OCR for
PDFs, AI-generated alt text for images (these are separate
projects that would warrant their own roadmap).

**Followups added 2026-05-21**:
- Review every drag-in / drop place end-to-end to confirm
  multi-file desktop drag actually surfaces all N files in
  `dt.files`. `handleFileDrop` now handles N files (gap #6), but
  upstream parsing (DragProvider native-file branch, ConnectionsTab
  upload, etc.) may still grab `files[0]` somewhere — audit needed.
- Build an op that, when run on the user's main grid (NOT live or
  test), seeds 4 panels — one each of canvas / board / doc / table
  — pre-filled with sample occurrences of every kind. Should be
  idempotent (re-runnable without duplicating). Lets a fresh grid
  show a complete reference of the system without manual setup.

**Shipped 2026-05-22** (orphan cleanup + dedup + sharding + remote mirror + EXIF + audio waveform + sharp thumbnails + displayRules):
- Gap #4 (DONE) — Sharp image thumbnails (256px + 1024px WebP)
  generated on every image upload, sha256-keyed under
  `uploads/thumbnails/`. Dedup'd uploads reuse existing thumbs.
  `ArtifactCard` picks the right variant per render mode (compact
  → 256, expanded → 1024, falls back to original `src` for
  external URLs / pre-sharp uploads). Smoke: 649 KB PNG → 17 KB
  at 256px (97% smaller).
- Gap #11 (DONE) — Audio waveform via wavesurfer.js. New
  `AudioWaveform` component in `ArtifactContent.jsx`, lazy-loaded
  (~150KB chunk, only paid for when user opens an audio artifact).
  Themed waveform + Play/Pause + click-to-seek; native
  `<audio controls>` retained inline as fallback. 815/815 client
  tests + production build clean.
- Gap #12 (DONE) — EXIF + dimensions extraction on image upload.
  `extractImageMetadata` helper in server.js using `exifreader`
  (no native bindings; handles JPEG/PNG/TIFF/HEIC/WebP). Stamps
  `module.meta.{width, height, exif}` with a curated tag subset on
  every image upload via `/api/artifacts/upload`. Silent failure
  mode (returns null); non-image uploads unaffected.
- Gap #22 (DONE) — `server/scripts/mirrorRemoteImages.js`. Walks
  artifact modules with `http(s)://` fileRef, downloads (25MB cap,
  30s timeout, 250ms polite delay), writes to
  `uploads/user/YYYY-MM/`, recomputes SHA-256, dedups against
  existing local modules, stamps `meta.external:false` +
  `meta.sha256` + `meta.mirroredFromUrl`. Dry-run by default;
  `--apply` + `--max=N`. Re-run safe (already-mirrored modules
  skipped via `meta.external === false`). Dev DB has 0 remote
  modules right now (live data not re-seeded), so script just
  reports "Remote artifact modules: 0"; ready when needed.

- Gap #18 (DONE) — Year-month upload sharding. Both
  `/api/artifacts/upload` and `/api/connections/:id/import` now
  write into `uploads/user/YYYY-MM/<file>` via the new
  `yearMonthShard()` helper. `fileRef` carries `user/YYYY-MM/<file>`.
  Legacy flat refs keep working (resolveFileRef + Express static
  both serve nested paths). New migration script
  `server/scripts/shardExistingUploads.js` (dry-run by default,
  `--apply` to execute) moves existing flat files into shards
  derived from the filename's leading timestamp (mtime fallback)
  AND updates Module.fileRef. Dev DB smoke: all 31 flat files
  classified as orphans (no Module ref), correctly skipped.
- Gap #3 (DONE) — SHA-256 content-hash dedup in
  `/api/artifacts/upload`. Streaming hash + lookup before file
  rename; on hit, temp file is unlinked, optimistic-flow placeholder
  module is deleted (`module_deleted` emitted), occurrence rewires
  to the existing module (`occurrence_updated`/`_created` emitted),
  response carries `dedup: true`. Non-dedup path stamps
  `meta.sha256` on every new module so future uploads can dedup
  against it. External-URL refs filtered out (they can't dedup
  against local bytes). 144/144 server tests still green.
- Gap #19 (partial) — `server/scripts/cleanupOrphanArtifacts.js`
  new script. Reports / deletes upload files no Module references.
  Dry-run by default; `--delete --age=N` deletes orphans older than
  N days (default 7); `--include-md` also scans `uploads/md/`.
  Smoke: 31 orphans = 44.39 MB on dev DB. See docket §8 gap #19.
- Existing docket #24 (displayRules) — all 11 remaining scalar
  numeric trackers in createLiveData.js now carry `displayRules`
  (Steps / Completed / Protein / Carbs / Fats / Total Reps /
  Net Balance / Mom's Account Balance / Total Workouts / Total
  Reading Time / Time Spent This Week / Completion Rate). 22
  trackers total are now rule-decorated; only PUSH_TO_ARRAY
  row-builders + the deferred Pomodoro state-rule remain unhandled
  per the documented limitations. Re-seed required:
  `node --env-file=.env server/scripts/createLiveData.js`.

**Shipped 2026-05-21** (7 audit items + 3 user-asked features):
- Gap #2 — `/api/upload` deleted; `/api/connections/:id/import`
  rewritten server-side to mirror `/api/artifacts/upload` (mints
  Module + Occurrence + View, broadcasts both). `CommitHelpers.uploadFile`
  + `ConnectionsTab.handleUpload`/`importFile` migrated to the canonical
  endpoint; bodies now send `parentFolderId` and read `d.module`.
- Gap #23 — `server/models/Module.js` `meta` field now carries a JSDoc
  `@typedef ArtifactMeta` documenting the shape artifact modules use
  (`mimeType`, `originalName`, `uploadSize`, `uploadStatus`, `folderId`,
  optional `exif`/`width`/`height`) + notes on template/scheduleSlot
  module variants.
- Gap #14 — `client/src/modules/ArtifactContent.jsx` `CodeViewer` now
  uses `highlight.js` with the `atom-one-dark` theme. JS module is
  dynamic-imported (lazy), CSS is eager (~3KB). Extension→language
  map covers ~30 common file types; everything else falls through to
  `highlightAuto`. Plain `<code>` shown as fallback before hljs
  finishes loading or if highlighting throws. Header now shows
  `<filename> · .<ext> · <lang>`. `highlight.js` 11.x added to
  client dependencies.
- Gap #20 — Page-level artifact viewer now carries a download badge
  on every display branch (image / pdf / audio / video) plus inline
  Download in the CodeViewer header. `<a download={originalName}>`
  ensures the saved file uses the user-visible name, not the
  timestamp-randomized server filename.
- Gap #6 — `handleFileDrop` now iterates all files. Toast batches
  progress; uploads run in parallel; idempotent on server side.
- **User-asked: OCR on images** — image-viewer branch gained an OCR
  button. Recognizes text via `tesseract.js` (lazy-loaded), mints a
  textblock occurrence appended to the image occurrence, renders
  the textblock in an editable Editor below the image. Multi-OCR is
  fine; each run appends a new textblock.
- **User-asked: example artifacts on grid** — `createLiveData.js`
  now seeds an `Examples` folder with 3 image + 1 video + 1 PDF
  artifact occurrences, surfaced via a new `Examples` page pinned
  to the Notebook hub panel. `fileRef`s are Wikimedia / GCS / W3C
  absolute URLs — no upload needed.
- **User-asked: Wikipedia import op** — "Import from Wikipedia"
  manual op with a GET_USER_INPUT chain (query → mode → branch),
  CALL_API to a new no-auth `/api/research/wikipedia/import` server
  route. Create branch fully wired; Append/Replace branches collect
  input + SHOW_VALUE a TODO (the markdown-merge endpoint isn't
  built yet).
- Verified: 809/809 client tests, 144/144 server tests, client build
  green. Lazy chunks hold highlight.js + tesseract.js; no first-load
  cost. Re-seed required for the new seed data + op:
  `node --env-file=.env server/scripts/createLiveData.js`.

### Existing docket — DO NOT IMPLEMENT until the above ship

- **~~Author more `$displayRules` in live data.~~** DONE 2026-05-22.
  Twenty-two trackers now rule-decorated covering every scalar
  numeric tracker in the live grid. Original six (Water / Pages /
  Spent / Time Spent / Pomodoros Today / Earned / Pomodoro Time)
  plus four added 2026-05-21 (**Monthly Bills** — commit
  `b2b02277`, **Net Worth** — same commit, **Task Countdown** —
  commit `1a3d2c3d`, **Total Subscriptions** — commit `3b80e03c`)
  plus the eleven added 2026-05-22: **Steps** (Water+value pattern),
  **Completed** (Water+value pattern), **Protein / Carbs / Fats**
  (target met/notMet + value-fallback), **Total Reps** (Water+value),
  **Net Balance** (negative/zero/positive — red ArrowDown / blue /
  green ArrowUp), **Mom's Account Balance** (same negative-aware
  pattern), **Total Workouts / Total Reading Time / Time Spent This
  Week** (Pages-style neutral counters), and **Completion Rate**
  (percentage catch-all blue). Re-seed required to apply:
  `node --env-file=.env server/scripts/createLiveData.js`. Deferred
  per the same docket entry:
  - **Pomodoro Time state-based rules deferred.** The docket spec'd
    blue-on-null / red-on-`state:"paused"` / green-on-`state:"running"`,
    but the Pomodoro instance carries `pomodoroPhase` with `"work"`/
    `"break"` values, not a `state: "running"|"paused"` sibling field.
    Authored a Pages-style neutral rule instead so the tracker still
    decorates. Adding the state-based rule needs either a new
    `pomodoroState` field on the Pomodoro template (and Pomodoro:
    Start / Pause / Resume ops to write it) OR rewiring the rule
    predicate to read `pomodoroPhase` with different colour
    semantics.
  - **Percentages without targets** — single catch-all rule
    `{ when: {}, color: "rgb(96,165,250)" }`. No percentage trackers
    exist yet.
  - **Books Read / Movies Watched / Podcasts / Courses** — these
    are PUSH_TO_ARRAY row-builders that write an array of
    `{label, date}` objects to a multi-column display field, NOT a
    numeric scalar. Display rules only meaningfully decorate
    scalar values (color/icon ride on the value); array writes
    have no "value: zero" semantic at the rule layer. If the user
    wants per-row colour coding, that's a different mechanism
    (column-level styling on the display field's
    `displayConfig.columns`, not `$displayRules`).
- ~~**Date-stamp bug on goals/trackers.**~~ ✅ Verified 2026-05-23:
  `Stamp Filter Date` op at `createLiveData.js:6186` is now
  `enabled: false` (line 6227). Goal containers carry no
  `dateFieldId` binding; trackers no longer attempt date stamping
  on goal occurrences. The symptom is gone with the current seed
  shape. Re-seed only needed if the live grid still carries stale
  bindings from an earlier version.
- **Goals restructure Stage 2 (handoff item from 2026-05-20).**
  ✅ Executor + picker work landed 2026-05-21 (commits `7c8e336e`,
  `f1c087c7`): `$allItemsById` and `$allOccurrencesById` are now
  $vars (id-keyed maps), and CategoryPathPicker surfaces them under
  Built-ins with an `occurrenceMap` shape that lists occurrences by
  label and commits the id as the path segment. The path resolver
  walks UUIDs as single keys via `.`-split — no bracket-notation
  hack needed.
  Still pending: actually splitting the single
  "Physical Wellness" / "Intellectual Growth" / etc. instances
  into per-goal occurrences and updating tracker call sites in
  `createLiveData.js` to reference each via
  `$allItemsById.<goalOccId>` (or via the picker).
- **~~Folder page renders no instances.~~** FIXED 2026-05-21 in
  `modules/ManifestTree.jsx FolderNode.handleNewDoc` (line ~414).
  The "+New Doc" button on a folder hover mints an occurrence with
  `targetId: modId` only — `moduleId` was omitted. PageFolder's
  card grid (and pagesList, role lookups, etc.) reads
  `modulesById[occ.moduleId]`, which resolved to `undefined`, so
  the new doc's PreviewNode rendered blank in the folder-page grid
  even though the doc was correctly parented under the folder.
  Same bug the `handleFolderClick` comment at line 441-443 of the
  same file warns about — `handleNewDoc` was the one site that
  hadn't been updated. Fixed by adding `moduleId: modId` alongside
  the existing `targetId: modId`. No re-seed required; new docs
  created via the folder's "+New Doc" button will land correctly.
  Pre-existing docs created via this path before the fix still need
  a one-off `moduleId` backfill if they should appear in folder
  pages — easiest is to delete + recreate them via the same UI.
- **Value builder — typed array/object editor with CategoryPathPicker per row.**
  The current `ui/JsonStructureEditor.jsx` is a generic JSON editor
  (str / num / bool / null / [ ] / { } cycle). Grow it into a **value
  builder** where each row's "type" dropdown ALSO includes
  occurrence / template / field / module / operation / category path
  — picked via the same `CategoryPathPicker` that the operations
  editor already uses. The picked id becomes the row's stored value;
  the row chrome displays the resolved **label + breadcrumb / spot +
  type icon** so the author isn't staring at raw UUIDs. Distinct from
  the JSON primitive types — primitives stay as today; the new types
  store an id (or a dotted path like `$allItems.<id>.fields.<fid>.value`)
  and render a chip.
  - Replaces label-based matching everywhere. Today
    `helpers/displayRules.js` keys rules by occurrence **label**; many
    seed ops similarly FIND-by-label. Authoring against ids via the
    picker makes those comparisons stable across renames and
    duplicates. Migration is a one-pass — existing label-keyed rule
    objects keep working until rewritten.
  - **Row "card" display when the value is an id-path** (not a JSON
    primitive): resolve the id and render a *small two-line card*,
    not the raw type. Same card whether the picked thing is the
    whole occurrence (id) or a sub-path on it (e.g. `id`,
    `fields.<fid>.value`, `label`, `meta.X`). Anatomy:
    The entire card IS one continuous breadcrumb whose sections
    are a 1:1 visual representation of the **CategoryPathPicker's
    drilldown chain** — same levels the user walked to commit the
    pick, rendered after the fact so they can read back what
    they picked. Each picker level becomes one card crumb,
    separated by `›` glyphs. The crumb's rendering varies by what
    kind of thing the picker drilled into at that level (category
    badge / source pill / occurrence box / field crumb / sub-path
    crumb). The middle level that lands on an OCCURRENCE is the
    focal/expanded one (multi-row box with title + fields) because
    that's where the meat lives; surrounding levels are thinner
    inline crumbs. Reading the card left-to-right replays the
    picker's chain.

    **Crumb rendering, by picker-level type** (one section per
    level; separators `›` between them):
    - **Category crumb** (level 1 of picker — `Occurrences /
      Sources / Fields / Local Variables / Built-ins`): a small
      coloured pill with the category name and its icon. Matches
      the colour the picker tile uses.
      e.g. `[● Occurrences]`.
    - **Source / variable crumb** (level 2 — `$allItems` /
      `$schedPage` / etc.): plain text crumb showing the variable
      name (and friendly subtitle when there is one — e.g.
      `$schedPage  (Source: Schedule page)`).
    - **Ancestor crumbs** (any number of levels — picker walks
      `parent › grandparent › …`): plain text labels for each
      ancestor occurrence with its role/kind chip prefix.
      e.g. `[panel] Daily Toolkit › [container] Physical`.
    - **Occurrence crumb (the focal box)** — the level where the
      picker lands ON the target occurrence. Multi-row block with
      a thin border:
      - **Title (bold)**: occurrence label. e.g. `Drink Water`.
      - **Fields list UNDER the title** (rows, binding order, no
        highlight):
        ```
        water → 2
        completed → false
        timeslot → 6:00am
        date → May 21
        ```
      Date/datetime via `Field.jsx` formatters; arrays show
      `N selected`; nulls render as `—`. Caps at 8 fields with
      `+N more` tail. Hidden bindings excluded. NO field is
      highlighted here — the "you picked X" callout is the next
      crumb.
    - **Sub-path crumb** (final level — `fields › <fid> › value`
      / `_ancestors` / `meta.X` / `id`): rendered as a single
      `name → value` crumb. For the common
      `fields.<fid>.value` pattern, just `fieldName → value`.
      For `id`, `id → <shortId>`. For deeper paths like
      `meta.scheduleSlot`, `meta.scheduleSlot → true`. Slightly
      bolder than ancestor crumbs so it reads as the destination.
    - **More than one sub-path level** (rare — e.g. `fields ›
      <fid> › value` shows as ONE sub-path crumb collapsing the
      `fields › <fid> › value` chain into `fieldName → value`).
      The picker exposes the intermediate `fields` / value
      drilldown for navigation only; the card collapses them
      back into a meaningful single crumb.

    Whole-card flow example for picker chain
    `Occurrences › $allItems › <occId> › fields › <fid> › value`:
    ```
    [● Occurrences] › $allItems › [panel] Daily Toolkit › [container] Physical › ┌──────────────┐ › water → 2
                                                                                 │ Drink Water  │
                                                                                 │ water → 2    │
                                                                                 │ completed → … │
                                                                                 │ timeslot → … │
                                                                                 │ date → May 21│
                                                                                 └──────────────┘
    ```

    Card chrome: thin border around the occurrence box only — all
    other crumbs are inline. Whole row wraps if the parent context
    is narrow (< 320px); on wrap, each crumb sits on its own row
    with `›` preserved as a leading glyph (`› water → 2` for the
    bottom crumb).

    **Implementation hook**: the shared `resolvePickedRef(path,
    maps)` helper returns the level breakdown as
    `{ levels: [{ kind, label, sublabel?, role?, occurrence?,
    field?, value? }, ...] }` so the card just iterates. The
    picker's existing `CategoryPathPicker.segmentDisplay` already
    derives most of this — extract + return the structured form
    instead of a flat string.
    - **Leading swatch (12×12)**: type icon — page / container /
      instance / textblock / artifact / field — color matches the
      manifest tree's iconography so authors recognize it
      immediately.
    - Card chrome: thin border, rounded corners, ~2px vertical
      padding. Compact enough to live inside a ValueBuilder row
      (~320px wide max — bumped from 280 to fit the field strip).
      Wraps to extra lines if narrow.
    - Raw id + full resolved path stay in the `title` attribute for
      debug-hover.
    - Same resolution logic already exists in
      `CategoryPathPicker.segmentDisplay` for path segments —
      extract into a shared `resolvePickedRef({maps, path}) →
      {label, breadcrumb, role, kind, fieldName, value, icon}`
      helper consumed by both the picker's closed-state chip AND
      ValueBuilder row cards. One source of truth for "how a picked
      reference renders."
  - **Per-row controls**: `+` and `−` on every row. `+` underneath
    the container adds a new sibling at the end. The `+` opens a
    small menu: **"Insert one"** (single row, picks type + value as
    today) and **"Insert many via FIND"** (opens a mini-Find editor
    — pick collection + predicate via the existing
    `COLLECTION_PICKER_CONFIG` + `buildRecordKeyPickerConfig` shapes
    — and fans the matches out into N rows, one per match).
  - **Renames**: rename `JsonStructureEditor` →
    `ValueBuilder.jsx`. The `OperationsBuilder.jsx` `structured`
    mode in `ExprOrPath` now drives the ValueBuilder instead of the
    JSON-only editor. Wherever else an operation cfg accepts an
    array or object today (PUSH_TO_ARRAY's `value`, CREATE's
    `fields`, FIND's predicate rule lists, APPLY_TEMPLATE's
    `replacements`, every UPDATE object cfg, $displayRules), surface
    the same ValueBuilder. Where the cfg expects a SPECIFIC
    collection (e.g. `fields:{[fid]:val}`), seed the type dropdown
    to that picker scope so the author can't pick the wrong thing.
  - **Mongo-style feel** is the target: each row reads as
    `[type ▼] [key (if obj)] [value chip / picker]  [−] [+]`,
    container has a trailing `[ + add row ]`. Nested objects/arrays
    collapse/expand with the existing chevrons.

### 🔵 AI assistant work (LAST on docket — do these only after the
### above are done)
The Jarvis assistant drawer + REST API + tool catalog is merged into
master (commits `41f35175`, `33ab8222`, `cb2bc474`, `48b15832`,
`a3f533dc`, `0c18352f`). Open items:
- Plan + spec the in-app assistant per `docs/aispecs.md` — offline
  LLM stack (Ollama + qwen2.5-coder), tool router, sandboxed
  command executor, OCR, "frog Jeeves" persona, etc. See item 10
  in the Session 2026-05-20 handoff at the top of this file.
- The API layer (already started in `server/routes/apiV1.js`) should
  be first-class — each Jarvis tool maps to a `/api/v1/*` endpoint
  that wraps the corresponding CommitHelpers / operation-action
  call so the LLM has no special privileges.
- Confirmation UX before destructive actions.
- Prompt caching on the static system prompt + tool catalog.

### 🟣 LATER docket (after AI ships)

- **Link data semantics.** The mind-map link tools (line / linked
  shapes) currently carry no data — they're purely visual. Future
  work: give each link a typed data payload (e.g. "depends on",
  "blocks", "spawned by", "rolls up to") and surface those as
  predicates in operations + filterable in the canvas + queryable
  in the value-builder picker. Out of scope for now — comes after
  the AI assistant lands.

## Recent Changes (2026-05-21 — Display-rules system + filter pill + canvas TDZ + recursion cap + AM/PM)
- **NEW `helpers/displayRules.js`** — Pure rule evaluator. Operation
  pipelines INIT_VAR `$displayRules` (an object keyed by occurrence
  label, each value an array of `{ when, color?, icon?, suffix?,
  replaceValue? }` rules). `executePipeline` post-processes every
  computed-value update AND `UPDATE_ITEM_FIELD` value effect: looks
  up rules for the occurrence's label, evaluates the first-matching
  `when` clause against the value + target + sibling fields,
  attaches the rule body to the update. Predicate keys: `value`,
  `target` (`met`/`notMet`/`none`), or any sibling field's short
  name (case-insensitive). Expected value: keyword (`negative` /
  `zero` / `positive` / `null` / `met` / `notMet` / `filled` /
  `empty`) OR literal scalar (equality) OR `{comp:LT|LTE|GT|GTE|EQ|NEQ|CONTAINS, right}`.
- **`helpers/operationExecutor.js`** — imports `applyDisplayRules`;
  post-process pass right after `executeSteps`. Handles both write
  paths: (a) inline-decorates computed-value updates; (b) emits a
  parallel computed-value update alongside each
  `UPDATE_ITEM_FIELD` (the path trackers use) so Field.jsx's
  computedValues-first preference picks up the rule decorations
  while the persistent occurrence field write still lands. Targets
  for rule matching are resolved from the field's `displayConfig.targetValue`
  when not on the update.
- **`state/masterReducer.js`** — `SET_COMPUTED_VALUES` now carries
  `color / icon / suffix / replaceValue` on each computed-value
  slot. Always overwrites with explicit `?? null` defaults so a
  rule that no longer matches clears prior decorations.
- **`ui/FieldRenderer.jsx`** — extracts `computedDisplayRule` from
  the computed slot; threaded as `displayRule` prop to all three
  `<Field>` render sites (display-only, role=="display", both-mode
  display half).
- **`state/bindSocketToStore.js`** — **defensive recursion cap** on
  `fireOperations`. `_FIRE_DEPTH_LIMIT = 8`; past that the next
  recursive fire logs a `console.warn` and bails instead of
  blowing the stack. Triggered by op chains where an
  `UPDATE_ITEM_FIELD` effect calls `setOccurrenceFieldValue`,
  which fires `MeasureOp`, which re-matches the same op, etc.
  Surfaces the transactionType in the warning so cycles can be
  identified without a hard crash.
- **`modules/CanvasContent.jsx`** — fixed TDZ crash
  (`can't access lexical declaration 'ce' before initialization`):
  the stale-edge cleanup `useEffect` referenced `saveEdges` in its
  deps array before `saveEdges` was declared. Moved the
  `useEffect` to right after `saveEdges`'s declaration. Existing
  `classifyEdges` comment at line ~387 already documented this
  exact pattern — same trap, different hook.
- **`modules/ModulePanel.jsx`** — folder breadcrumb crumbs are now
  clickable. New `openFolderCrumb(folderId)` callback finds-or-
  mints a folder-page occurrence under the folder (mirrors
  `ManifestTree.openFolderAsPage`) and calls `openPage(occId)`.
  Wired onto the non-last folder breadcrumb spans. Resolves the
  prior "breadcrumb pointer cursor with no handler" dead-end.
- **`hooks/useSocketStatus.js`** — fixed a boot-race where the
  hook's `useState` initializer read `socket.connected === false`
  and seeded status="disconnected", then the `connect` event
  fired BEFORE the `useEffect` attached its listener (no one
  heard it), leaving the pill stuck on red forever. Now re-reads
  `socket.connected` inside the effect after attaching listeners
  and reconciles to `connected` if it became true in the gap.
- **NEW `ui/JsonStructureEditor.jsx`** + **`blocks/OperationsBuilder.jsx`**
  — generic recursive array/object/primitive editor wired into
  `ExprOrPath` as a new `structured` mode (alongside path / text /
  array / null). Any `INIT_VAR` (or other pipeline cfg) holding
  a `json:{...}` value defaults to the visual editor on open.
  The `array` raw-textarea mode is still in the dropdown for
  power users who want to type JSON by hand. Used for authoring
  `$displayRules` in tracker ops.
- **`ui/Field.jsx`** — Now field display switched from 24-hour to
  12-hour with AM/PM suffix. Compact / non-compact value colors
  now follow the rule: target-met colors when there's a target,
  value-direction colors (red <0 / blue 0/null / green >0/filled)
  when there's no target. Amount input's prior flow-arrow button
  is removed. New `displayRule` prop renders rule color (overrides
  default), lucide icon (before value), suffix (after), and
  replaceValue (substitute) when a tracker authored
  `$displayRules` and the post-processor matched.
- **`ui/HeaderChevron.jsx`** — inline filter-value pill next to the
  filter button in occurrence headers. Shows currently-applied
  filter values; formatted per unit (Thu, May 21 / wk May 19 /
  May 2026 / 2026). Multi-day shows "N selected". Click opens the
  same dropdown the filter icon does.
- **`ui/DrilldownDatePicker.jsx` (NEW)** + **`ui/NavPickerPopover.jsx`**
  — Calendar drilldown picker (day/week/month/year zoom, multi-
  select, step-shift arrows, increment input at day/week levels)
  replaces the prior `react-multi-date-picker` UI inside
  `NavPickerPopover`. The shared `classifySelection` /
  `formatSummary` exports + persisted shape (`{kind, value, span,
  dates, unit}`) are unchanged — only the picker chrome swapped.
- **`Toolbar.jsx`** — `SocketStatusBanner` moved from the left
  section to a center-of-toolbar absolutely-positioned overlay so
  the disconnected pill sits visually centered when shown.

## Recent Changes (2026-05-21 — Jarvis assistant drawer + socket retry countdown (branch: assistant-jarvis))
- **`ui/AssistantDrawer.jsx` (NEW)** — bottom-right floating "J"
  button, click → 380×560 slide-in chat drawer. State all local:
  `token` (Bearer, in localStorage `moduli_api_token`), `messages`
  (chat history, in localStorage `moduli_assistant_history`), `input`.
  POSTs `{ messages, gridId }` to `/api/v1/assistant/chat` and
  renders assistant + tool transcript bubbles. Settings (⚙) panel
  in the header for pasting the API token. Mounted in `App.jsx`
  alongside `<TransactionHistory>`.
- **`hooks/useSocketStatus.js`** now exposes `retryInMs` — a live
  countdown to the next socket.io reconnect attempt. Decremented
  every 100ms by an internal ticker. Reset to the predicted backoff
  delay on every `connect_error`; parked at 0 while an attempt is
  actively in flight (`reconnect_attempt` event); cleared on success.
  Computed from `socket.io.opts.reconnectionDelay` /
  `reconnectionDelayMax` (matches socket.io's actual backoff formula,
  minus jitter).
- **`ui/SocketStatusBanner.jsx`** label updated to show
  `"Disconnected — retry in 2s (attempt 3)"` while waiting, and
  `"Disconnected — trying now (attempt N)"` during an active attempt.


## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `App.jsx` | Root component. Socket.io setup, GridActionsContext/GridDataContext providers, undo/redo lifted here. Filter handlers. **Mobile: isMobile + activeCell + zoomedOut state lifted here, passed via actionsValue context.** | Mar 18 |
| `Grid.jsx` | Main grid layout. Panel placement via CSS grid. **Mobile: wraps GridRender in MobileGridNav, hides resize handles, clamps activeCell on dimension change. StackOverlay component renders AFTER panels for z-index stacking.** | Mar 18 |
| `modules/Module.jsx` | **PRIMARY RENDERING COMPONENT.** Unified Panel/Container/Instance/Canvas in one file. Replaces old Panel.jsx, SortableContainer.jsx, SortableInstance.jsx. Has context menus (right-click) for all entity types. | Mar 2026 |
| `modules/` | Module.jsx + supporting files. Active rendering system for all entity types. | Mar 2026 |
| `ResizeHandle.jsx` | Panel resize corner handle | Stable |
| `Toolbar.jsx` | Top toolbar: logo, `+Panel` button, grid select, filter nav, Pomodoro, Clock (history), CC button, EyeOff hide, account avatar. **Mobile: MiniGridMap SVG in left section — click toggles zoomed-out mode.** | Mar 18 |
| `GridActionsContext.js` | Context: dispatch, socket, all entity maps (modulesById, occurrencesById, fieldsById, manifestsById, viewsById, operationsById, foldersById, computedValues) | Mar 2026 |
| `GridDataContext.js` | Context: read-only state for components that don't dispatch | Stable |
| `index.css` | Global CSS. Semantic tokens. **Section 14: Mobile Grid Nav CSS (viewport, slider, lip buttons, edge glow, zoom-out overlay). Section 15: Responsive (was 13).** | Mar 18 |
| `hooks/useMobileDetect.js` | **NEW** — `useMobileDetect()` hook. Returns `{ isMobile }` via `matchMedia(max-width: 600px)`. Exports `MOBILE_BREAKPOINT`. | Mar 18 |
| `mobile/MobileGridNav.jsx` | **NEW** — Zelda-style viewport wrapper. Transform-based cell navigation with lip buttons. **Zoomed-out mode**: scales grid to fit viewport with CellOverlay for selection, animated transition. Desktop passthrough. | Mar 18 |
| `mobile/MiniGridMap.jsx` | **NEW** — Tiny SVG grid indicator for toolbar. Click toggles zoomed-out mode. Returns null for 1x1. | Mar 18 |
| `ui/FilterNav.jsx` | Named filter dropdown + conditional date nav. Replaces old IterationNav.jsx. compact=true for toolbar. | Mar 2026 |
| `ui/CommandCenter.jsx` | **11-tab** command center: Fields/Operations/Filters/Grid/Appearance/Components/Files/Connections/Lists/UserSettings/Shortcuts. | Mar 16 |
| `ui/ContextMenu.jsx` | Right-click context menu portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={...} onClose={...} />` | Mar 2026 |
| `ui/Editor.jsx` | General-purpose TipTap editor. FieldPill/InstancePill/DocLink/ExprPill/ModuleEmbed extensions. Drop reformat dialog. Block handles. Click-to-focus. | Mar 14 |

## Architecture Rules
- **modules/Module.jsx** is the primary rendering component — NOT the old Panel.jsx/SortableContainer.jsx/SortableInstance.jsx (those files are DELETED).
- Panel/Container/Instance drag handles = the RadialMenu wrapper div (ref=handleRef). NOT separate GripVertical for panels/containers.
- Instance drag handle = GripVertical at `left: 0` inside `.instance-wrap`. Shows on hover via CSS, hidden during `.dragging`.
- Context menus use `<ContextMenu>` portal. Pattern: `useState(null)` + `onContextMenu` + `<ContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />`.
- No component calls socket directly — all mutations go through CommitHelpers.
- Filter system (not iteration): `grid.namedFilters`, `grid.activeFilterId`, `grid.activeFilterValues`. FilterNav.jsx is the nav component.

## Archived — older Recent Changes

All dated "Recent Changes" sections from 2026-05-20 and earlier have been
moved to [`CLAUDE.backup.2026-05-21.md`](./CLAUDE.backup.2026-05-21.md) to
keep this file workable. New session work should consult that backup only
if the active sections above don't cover something.
