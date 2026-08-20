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

- **The AI-assistant grid-build plan** ✅ WRITTEN 2026-08-19 —
  `docs/superpowers/plans/2026-08-19-assistant-grid-build.md`. Measured before
  planned, and both premises moved: the catalog is **43** tools (not the 48 the
  audit quotes) and the deployed ollama backend shows the assistant **19**, with
  `create_view`, `create_operation` and every update/move/delete hidden. Driven
  end to end, the configured 3B model took **207s** for one read-only tool call
  and answered wrong. The plan is therefore what must change first, in order —
  the allowlist is an env var, so step 1 is config, not code.
- **Re-export the fixture after any migration that rewrites an op**, or
  `pomsGridOps.test.js` pins pipelines the grid no longer has. It is a snapshot,
  not a connection. (Re-exported 2026-08-19 after `0143`-`0145`: 3,185 modules /
  3,322 occurrences / 68 enabled ops, 294 KB.)
- **Trackers sits at 36% of the left column** in the new mosaic — it inherited
  the row Tasks had. One splitter drag if that reads short.

- **The other two LIGHT themes** ✅ MEASURED AND FIXED 2026-08-19. Both were
  worse than Stardew (21 of 21 rows under 4.5:1; `moduli-light`'s green ink was
  `--signal-pos` exactly). `vintage-light` needed a DIFFERENT fix — it
  deliberately re-hues, so its inks are darkened rather than re-derived. See
  CLAUDE.md 2026-08-19 (7).
- **The three DARK themes are unmeasured**, and are the remaining gap of this
  kind: `midnight` and `vintage-dark` have never had a number put against them
  (`moduli-dark` was measured via Blueprint at 7.5-11:1 and is fine). The
  failure mode there is the inverse — an ink too DARK on a dark fill — and it is
  one probe run each.

## Nutrition / fitness build — state at 2026-08-19 end

Shipped: `0146` (Macros / Intake / Workout Goals tiles + macro targets) · `0147` (five dead display
fields removed) · `0148` (Financial cumulative) · `0149`+`0151` (six Workout slots + the
prescription op) · `0152` (seven minerals, 98 per-serving values) · `0153` (eleven micronutrient
totals + targets + Meal Count).

**Every one is verified through the real executor over the grid's own fixture**, and each has a
CONTROL — the reading that proves a zero is a reading rather than a broken op.

Still open, in the order I would take them:
- **Vitamin E / K / B6 / Folate have fields and values but no target** — the guide gives none.
  Either find figures the user trusts or drop them from the tile; they currently do not appear on it.
- **`Total Subscriptions` and `Monthly Bills` bind `Amount`, an INPUT field**, rather than a display
  twin. They classify as cumulative correctly, but the binding is odd and worth a look.
- **The micronutrient op double-counts a repeated ingredient across meals**, which is correct for a
  day's intake but means a template with the same meal twice inflates a preview. Only matters if the
  tile is ever pointed at a template.
- `unused-field` is at 14 on poms grid — worth one pass now that the audit tooling exists.
