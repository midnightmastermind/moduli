# Decisions taken, work not yet started — 2026-08-19

Answered by the user at the end of the session; recorded here so they are not
re-asked.

## 1. poms grid → 2×2 mosaic, 3 panels  ✅ DONE — migration `0143`, 2026-08-19

**User:** *"top left should be routines, bottom left should be trackers, right
should be schedule."*

```
┌─────────────┬─────────────┐
│  Routines   │             │
├─────────────┤  SCHEDULE   │   ← spans both rows
│  Trackers   │             │
└─────────────┴─────────────┘
```

Current state, measured: poms grid is **2×3 and already mosaic**
(`meta.layoutTree` set), with five panels —

| panel | page today | placement |
|---|---|---|
| A | Routines | r0 c0 |
| B | Tasks | r1 c0 |
| C | Day Page | r0 c1, spans 2 rows |
| D | Trackers | r0 c2 |
| E | Ingredients | r1 c2 |

**Both open questions were answered and the work shipped:**

- **Close** Tasks (Panel B) and Ingredients (Panel E). The PAGES are untouched
  and still in the tree — verified before and after: all three tabs (Tasks,
  Boards, Food) are parented to folders, not to the panels.
- **Re-point Panel C** at the Schedule. It turned out to already CARRY the
  Schedule as a tab, so this was one field on its View rather than a page move
  or a new panel — the note above assumed otherwise.

Ended at: 2×2, three panels, Routines r0c0 · Trackers r1c0 · Schedule r0c1
spanning both rows. Ratios preserved rather than invented, so the left column
keeps the split the user dragged for it. **Trackers ends up at 36% of the left
column's height** (it inherited the row Tasks had) — one splitter drag if that
reads short.

## 2. Promo restructure  ✅ DONE — 2026-08-19

- Charts is **not** a top-level section — fold it in **with tables**.
- Widen the capability list toward: boards, docs, tables, canvases, charts,
  fields, themes, filters, intake, data visualisation and organisation.
- **The AI assistant gets NO section.** User picked "leave it out for now": the
  deck-vs-now audit rates it the thinnest thing that ships (48 tools against a
  local Ollama, not wired to most flows, not the coordinator the deck
  describes), so a section would promise more than the product does.
- Already done: the hero leads with the workspace, `build` leads the nav, and
  the measured figures are off the landing-page cards.

## 3. poms-grid operation testing  ✅ DONE — 2026-08-19

`server/scripts/exportGridFixture.js` writes brotli now, and
`client/src/__tests__/fixtures/pomsGrid.json.br` is committed at **292 KB**
(5.7 MB raw, 19.7x). `client/src/__tests__/pomsGridOps.test.js` drives it.

**It found a live defect on its first real use** — see the SET_VAR entry in
CLAUDE.md. The day's schedule was empty because `Schedule: Place Cycle Day`
exited at its first gate; the fixture's run log named the exact step in one
run, where reading the pipeline had already produced two wrong theories.

Worth doing because the existing behavioural suite boots from `server/seed/*.json`
— i.e. what a FRESH grid looks like — and poms grid has diverged by ~120
migrations, so **not one of its stored pipelines has ever been covered**. The
empty Daily Question found this morning is the kind of thing it would catch.


---

## Still open after 2026-08-19 (3)

- **The AI-assistant grid-build plan** the user asked for — using the assistant
  to reproduce `claude-grid`, as a test of whether it can construct a workspace.
  Not started. Worth stating up front what the deck-vs-now audit found: the
  assistant is the thinnest thing that ships.
- **Re-export the fixture after any migration that rewrites an op**, or
  `pomsGridOps.test.js` pins pipelines the grid no longer has. It is a snapshot,
  not a connection. (Re-exported 2026-08-19 after `0143`-`0145`: 3,185 modules /
  3,322 occurrences / 68 enabled ops, 294 KB.)
- **Trackers sits at 36% of the left column** in the new mosaic — it inherited
  the row Tasks had. One splitter drag if that reads short.

- **The other two LIGHT themes are unmeasured.** `moduli-light` and
  `vintage-light` have the same shape as Stardew did — a mid-tone signal ink over
  a pale signal fill — but nobody has put a contrast number on them. Stardew was
  fixed because it is what the user runs and what the screenshot showed. The
  measurement is one probe run per theme; the fix, if needed, is the same
  `color-mix` line.
