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

## 2. Promo restructure  (NOT STARTED)

- Charts is **not** a top-level section — fold it in **with tables**.
- Widen the capability list toward: boards, docs, tables, canvases, charts,
  fields, themes, filters, intake, data visualisation and organisation.
- **The AI assistant gets NO section.** User picked "leave it out for now": the
  deck-vs-now audit rates it the thinnest thing that ships (48 tools against a
  local Ollama, not wired to most flows, not the coordinator the deck
  describes), so a section would promise more than the product does.
- Already done: the hero leads with the workspace, `build` leads the nav, and
  the measured figures are off the landing-page cards.

## 3. poms-grid operation testing  (NOT STARTED — the oldest open item)

`server/scripts/exportGridFixture.js` ships and works: poms grid exports as
**68 enabled operations / 3,171 modules / 3,280 occurrences**, 5.7 MB with
textmaps stripped, **292 KB brotli**. The fixture itself is deliberately NOT
committed yet — it needs compressing first, and a test that drives all 68
pipelines through the real executor the way `liveOpsBehavioral` drives the seed.

Worth doing because the existing behavioural suite boots from `server/seed/*.json`
— i.e. what a FRESH grid looks like — and poms grid has diverged by ~120
migrations, so **not one of its stored pipelines has ever been covered**. The
empty Daily Question found this morning is the kind of thing it would catch.
