# Floated lead aside — Wikipedia-style sidebar wrap

_2026-06-11. Status: approved (visual mockup confirmed). Scope: importer + CSS + migration._

## Problem

The imported Wikipedia lead currently folds the **lead image + infobox** into a
`wrapGroup` whose **host is the first prose textblock** (`buildSectionBody`,
`markdownImporter.js:210-222`). Consequences the user flagged:

- The image + infobox read as "inside the same textblock as the first paragraph"
  — they're the notch-neighbor of ONE host block.
- Only that single textblock reflows around them. The article actually has ~5 lead
  paragraphs that should all flow down the left of the sidebar, with the run
  wrapping full-width once it passes the sidebar's bottom — an **automatic,
  height-driven** wrap, not a fixed paragraph count.

## Target

A real **right-side "aside" container** (already minted: `buildAsideContainer`,
`meta.leadAside:true`, a `kind:"doc"` container) holding two children stacked —
**image on top, infobox below** — that **floats right**. The lead prose stays as
**N separate textblock occurrences** in normal flow; they auto-narrow beside the
aside and reclaim full width below it. No fixed count — the wrap-under point is
driven purely by the aside's height.

The existing **in-textblock single-image notch** (`wrapGroup`, one host + image
neighbor) is unchanged — section images keep wrapping in their block. This design
only changes the **lead aside**.

## Mechanism (native CSS — no JS measuring, no clip-path)

- The aside is emitted as a **standalone floated embed** at the top of the section
  body: `moduleEmbed(asideId, { align: "right" })`. The doc editor's existing
  moduleEmbed float (`align:left|center|right|full`) already takes the embed out of
  flow and floats it — verified for image embeds (server/CLAUDE.md 2026-06-06); to
  confirm it applies to a **container** embed too (kind-agnostic moduleEmbed CSS).
- Each prose **textblock card becomes a block-formatting-context** (`display:
  flow-root`). Per CSS, a BFC box beside a float is **shortened to sit beside the
  float** and **expands to full width once below it** — exactly the auto wrap-under,
  with rectangular bordered cards (no border sliding under the float, no clip-path).
- Aside container: fixed width (~300–320px), `margin: 2px 0 10px 16px`, its own
  card chrome (the existing leadAside container styling).

## Changes

1. **`server/services/markdownImporter.js` — `buildSectionBody`**
   - Replace the `wrapGroup([firstTextblock, aside])` branch (lines 210-223) with:
     emit `embed(asideId, { align: "right" })` **once, at the front of `content`**
     (before any textblock), then let textblocks/images/etc. fall through to their
     normal handling. Drop `asidePlaced`'s coupling to the first textblock; keep the
     "no prose host → still emit the aside" safety (line 243) as "emit aside if not
     yet emitted."
   - `asideMemberIds` exclusion from the main flow is unchanged.

2. **`server/services/markdownImporter.js` — `buildAsideContainer`** (verify/fix)
   - Ensure the aside's children render **image first, infobox second**. Adjust the
     member order if it currently stacks infobox-first.

3. **`client/src/index.css`**
   - `.textblock-card` (block variant) → add `display: flow-root` so cards form a BFC
     and flow beside the floated aside. Scope carefully so it doesn't disturb the
     in-notch `--wraphost` clip cards or inline/link variants.
   - Float + width styling for the lead-aside container embed
     (`.module-embed[data-align="right"]` already floats; add the aside width + the
     leadAside container's sidebar look if not already present).

4. **Migration**
   - The persisted Eminem article keeps the old `wrapGroup(firstTextblock, aside)`
     shape. **Re-import** produces the new floated-aside shape (established
     "re-import to apply" pattern). No textmap migration script — re-import is the
     clean path; the section-image notch wrapGroups are unaffected.

## Out of scope

- Multi-image asides / multiple sidebars per section.
- Changing the section-image notch wrap (stays as-is).
- Responsive collapse of the aside under the prose at narrow widths (float already
  degrades acceptably; revisit only if it reads badly in-browser).

## Verification

- Importer unit tests (`server/__tests__/markdownImporter.test.js`): the lead
  section body emits a floated aside embed (not a wrapGroup) followed by ≥1
  textblock; aside members excluded from flow; image-before-infobox in the aside.
- In-browser (headless harness against a fresh Eminem import): the aside floats
  right (image over infobox); ≥2 textblock cards sit beside it and a later one spans
  full width; resize narrows/reflows.
