# Docs render broken — bullets, transparency, and an empty "Day 1-3" — 2026-08-21

User, with a screenshot of the **Nutrition Plan** page: *"add in a fix to make the textblocks kind of
transparent, the bulletpoints arent showing up, and there is an empty container up top that says day
1-3. i assume the meals should be in this container. make sure all our docs are good and not broken
visually like that."*

## Measured first — and it corrects two readings of the screenshot

```
"Day 1-3 (Same Meals for Simplicity)"   container/doc   H3   children: 0
parent "Meal Plan with Recipes & Macros" holds 9 children:
    Day 1-3 …                H3   kids 0
    Breakfast (7 AM) …       H2   kids 1
    Snack 1 (9 AM) …         H2   kids 1
    … six more meals,        H2
"Breakfast" children: ONE textblock, textmap = [bulletList, paragraph, bulletList, paragraph]
```

Two things follow, and neither is what the screenshot suggests at a glance:

1. **The ingredient lines are NOT separate cards.** Each meal has exactly ONE textblock whose textmap
   already contains real `bulletList` nodes. So the bullets are not missing from the DATA — they are
   present and not being PAINTED. That makes this a stylesheet question, not an importer one.
2. **`Day 1-3` is H3 and the meals are H2** — the meals are SHALLOWER than the day header, so by
   ordinary markdown nesting a meal closes `Day 1-3` and becomes its sibling. The importer did the
   correct thing with an oddly-levelled source. "The meals should be in this container" is therefore
   a re-levelling decision, not a bug fix, and it needs the user's call on which way to resolve it.

## The three fixes

### 1. Bullets are not painted (CSS)
Tailwind's preflight resets `ul { list-style: none }`, and the doc editor never restores it, so every
imported `bulletList` renders as unmarked lines. Fix in `index.css`, scoped to doc CONTENT so it
cannot leak into the app's own chrome lists (menus, the manifest tree, QuickAdd). Same for `ol`.
**Verify by looking**, not by asserting the rule exists — a `list-style` that is overridden one
selector later looks identical to one that was never added.

### 2. Textblocks are opaque
They paint a solid surface where every container around them is translucent, so a doc page reads as a
stack of opaque slabs over the wallpaper. Route the textblock card's background through the same
`StyleHelpers` surface alpha the containers use rather than inventing a second number — the
2026-08-19 `surfaceAlpha` / `storedColorAlpha` split is the precedent, and the lesson there was that
ONE number doing two jobs produces exactly this.

### 3. `Day 1-3` is empty — needs a decision, then a migration
Options, to put to the user:
- **Re-parent** the eight meal containers under `Day 1-3` (data-only; the doc keeps its source levels
  but the grid nests correctly).
- **Re-level the source** so `Day 1-3` is H2 and the meals H3, then re-import (fixes it at the source
  and for any future import, but discards anything edited in-app since).
- **Delete `Day 1-3`** and let the meals sit directly under `Meal Plan` — it carries no content of its
  own, so it is a label rather than a section.

## Then the audit the user actually asked for

*"make sure all our docs are good and not broken visually like that."* A doc page can be broken in
ways that render as an empty box, and this repo has shipped several of them. The sweep should report,
per doc page:

- **Empty containers** — a `container/doc` with no children AND no textmap content. `Day 1-3` is one;
  `Dinner (5 PM)` above shows `kids=0` and is a second candidate on this very page.
- **Listed but not embedded** — a child in `occurrences[]` that the parent's textmap never references.
  A doc renders its TEXTMAP, so such a child is present in the data and invisible on screen. This is
  the class CLAUDE.md records from five directions (2026-08-01 (19) is the sharpest).
- **Embedded but missing** — a `moduleEmbed` pointing at an occurrence that no longer exists, which
  paints as a raw `embed: <uuid>` or an empty box.
- **Heading-level inversions** — a container whose declared `headingLevel` is DEEPER than the sibling
  that follows it, which is exactly the `Day 1-3` shape and is what makes an empty section look like
  a mistake rather than a level choice.

Report first, fix second, and **each fix needs its own decision** where content is involved — a doc
page holds the user's writing, and an empty-looking section is not always one nobody wanted.
