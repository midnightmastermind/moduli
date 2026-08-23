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
- **The three DARK themes are STILL unmeasured — and the attempt on 2026-08-20 (6)
  failed its own calibration, which is worth reading before the next one.**
  `midnight` and `vintage-dark` were LOOKED AT on test grid 2 and are legible:
  headers, row labels and value pills all read cleanly (amber-on-brown for
  vintage-dark, near-white on near-black for midnight). That is an eyeball
  judgement, not the number this item asks for.

  **What went wrong, so the next attempt starts ahead:**
  - The probe read rendered PIXELS (ink = the pixels furthest in luminance from
    the box's modal colour) and reported *29 of 45 value pills under 4.5:1 on
    `moduli-light`* — a theme 2026-08-19 (7) measured at **6.05-6.09 after its
    fix**. **The calibration case is what caught it.** Without a theme whose
    answer is already known in the same run, the dark-theme numbers (15 of ~42
    under 4.5) would have read as a real finding and been acted on.
  - The failure signature is the documented one: ink ≈ fill (e.g.
    `rgb(183,146,126)` on `rgb(185,148,127)` = 1.02:1) — **the sampled box held
    no text.** Cause: the value text lives in `.auto-marquee-inner`, and a
    `Range` rect over it covers the marquee TRACK rather than the visible
    glyphs, so the clip is mostly empty track.
  - **And the premise for picking test grid 2 was wrong.** It was chosen because
    it carries no SKIN, so the background would be uniform and pixel sampling
    sound. It still gets the base `:root` retro rainbow — the screenshots show
    coloured rays straight through the panels — so the surface behind a
    translucent pill is *not* uniform, which is the same thing that defeated the
    2026-08-19 (6) probe behind a wallpaper.
  - An earlier iteration of the same probe reported pure white ink at 13-16:1 for
    **60 of 60** samples, all of them the word "Completed": the selector matched
    one repeated element and the ink-picker took the toggle KNOB rather than the
    text. *Sixty identical samples is not sixty measurements.*

  Next attempt: keep the light-theme calibration, sample glyph boxes rather than
  marquee tracks, and use a surface with no rainbow behind it.

  **ATTEMPT 3 (2026-08-23) also failed its calibration, and found three things
  that make attempt 4 much cheaper. Nothing was changed; no grid was written.**
  - **`resolveSkinId` is `grid?.meta?.skin || storedPreference`, so THE GRID WINS.**
    Setting `localStorage["moduli-skin"]` on **poms grid** does nothing — it pins
    `stardew`. The first run reported four skins with BYTE-IDENTICAL numbers, which
    is the tell: it had measured stardew four times. **test grid 2 and test grid 1
    pin no skin, so there the browser value is honoured** — and it is browser-local,
    so measuring costs no write to any grid.
  - **The ink-picker still grabs the field NAME, not the value.** Samples came back
    reading `"Completed"`, `"Meal"`, `"Calories"` — the 0.7-opacity labels, exactly
    the 2026-08-19 (6) failure. Walking to the FIRST text node inside
    `.field-display` finds the label. It has to target the value node specifically.
  - **THE TASK AS FILED IS UNDER-SPECIFIED, and this is the useful part.** Under
    `moduli-light` on test grid 2, sampled backgrounds came back BROWN and ORANGE —
    not a theme colour and not a bug: `.container-shell` computes
    `rgb(179,79,36)`, a STORED container colour, painted at full opacity because
    every plain skin sets `storedColorAlpha: 1`. So "the dark themes' contrast" and
    "the contrast of a container the user coloured orange" are different questions
    with different owners, and a single number mixes them. **The 6.05-6.09
    calibration figure is from poms grid; test grid 2 has different stored colours,
    so it is not comparable across grids.** Attempt 4 should either measure only
    surfaces the THEME paints (no stored colour in the ancestor chain), or say up
    front that it is measuring stored colours too — and it needs a calibration on
    the SAME grid it measures.
  - Verified along the way that the theme itself applies correctly on test grid 2:
    `data-theme=moduli-light`, `dark` class off, `--grid-wallpaper: none`,
    `--grid-surface-a: 1`, `bodyBg rgb(243,244,247)`. The surface is flat there, so
    the rainbow problem from attempt 2 is solved by using a plain skin.

  **ATTEMPT 4 (2026-08-23, same day) — THE METHOD NOW WORKS AND CALIBRATES. The
  remaining blocker is the DATA, not the probe.** Scope decided rather than asked:
  the filed item asks whether the THEMES are readable, and a container the user
  painted orange is their own choice, so each sample is classified by comparing
  its sampled background against the theme's own resolved surface tokens.
  ```
                  THEME SURFACES                 stored colours
  moduli-light    n=18  med 14.05  under4.5 0    n=35  med 2.10  under4.5 33
  moduli-dark     n=20  med 15.65  under4.5 1    n=33  med 5.73  under4.5 11
  midnight        n=20  med 16.12  under4.5 1    n=33  med 4.91  under4.5 12
  vintage-dark    n=21  med 12.11  under4.5 1    n=32  med 4.86  under4.5 11
  ```
  **The calibration PASSES for the first time** — `moduli-light` comes back
  legible where attempt 3 called it 1.8:1.

  **But read the breakdown before believing the counts.** Of each skin's ~20
  theme-surface samples, **18 are container HEADERS with one identical colour
  pair** — one measurement repeated 18 times, not 18 measurements. Only ONE
  `value` sample per skin lands on a theme surface at all, because nearly every
  value pill on this grid sits inside a user-coloured container. So what attempt 4
  actually establishes is: **dark-theme HEADERS are legible (12–16:1)**, and value
  pills remain unmeasured.

  **THE ONE SUB-4.5 SAMPLE IS THE SAME ELEMENT ON ALL THREE DARK THEMES** — text
  reading `"Completed"` at 3.15–4.13. It may still be a field NAME rather than a
  value: the `.opacity-70` filter did not exclude it, and a boolean pill renders
  its label as its own text. Do not act on that number without identifying the
  element first.

  **WHAT ATTEMPT 5 NEEDS IS A GRID WITH NO STORED COLOURS**, and there is exactly
  one — `claude-grid`, 0 stored-colour rows — but it belongs to a **different
  account** (`6a84761b…`, registered on prod 2026-08-18), so this session's token
  cannot open it: requesting its id silently falls back to poms grid, which pins
  stardew. Either get that account's credentials, or make a fresh grid on this
  account with a few uncoloured containers and measure there. Every other grid
  (poms 424, test grid 1 78, test grid 2 87) paints its containers.

## Nutrition / fitness build — state at 2026-08-19 end

Shipped: `0146` (Macros / Intake / Workout Goals tiles + macro targets) · `0147` (five dead display
fields removed) · `0148` (Financial cumulative) · `0149`+`0151` (six Workout slots + the
prescription op) · `0152` (seven minerals, 98 per-serving values) · `0153` (eleven micronutrient
totals + targets + Meal Count).

**Every one is verified through the real executor over the grid's own fixture**, and each has a
CONTROL — the reading that proves a zero is a reading rather than a broken op.

Still open, in the order I would take them:
- ~~**Vitamin E / K / B6 / Folate have fields and values but no target**~~ **— STALE, and measuring
  it found two live defects instead (`0165`, 2026-08-20).** All four had targets all along
  (15 · 120 · 1.3 · 400) and all fourteen totals are bound and written. What was actually wrong:
  **Vitamin D's target was 600 — the IU figure — while every ingredient value was in mcg**, so the
  tile compared mcg against IU and a fully met day read as 2.5% of goal; and **sodium's 2300 mg
  ceiling was a goal to REACH**, so the tile went green once you exceeded your limit. Both fixed,
  plus units on 15 unit-less fields and magnesium 400 → 420 for the user's reference profile
  (adult male 31-50, their pick). The reference figures were LOOKED UP rather than waited for —
  public values are lookupable, which is the rule `0123` already applies to a food's content.
- ~~**`Total Subscriptions` and `Monthly Bills` bind `Amount`, an INPUT field**~~ **— LOOKED AT
  2026-08-20 (6), NOT A DEFECT.** `Total Subscriptions` is no longer on the grid at all. `Monthly
  Bills` does write a sum into an input-enabled field, and the reason that is safe is the thing
  worth recording: **its loop is scoped to the `Bills` container while the tile lives under
  Trackers**, so it is not inside its own summation scope and cannot feed on its own output. Driven
  over the live data: 10 rows, sum **2040.97**, which is exactly what the tile reads. The only
  consequence of the input binding is that the tile renders an editable control the next run
  overwrites. Also confirmed it resolves no `$goalPeriod`, so `0164` correctly left it alone.
  *Of the 13 ops writing an input-capable field, the other 12 are legitimate stamps (Date, Time
  Slot, Cycle Day, Pomodoro Minutes) — so a `gridIntegrity` rule for this class would be noise on
  the day it shipped.*
- **The micronutrient op double-counts a repeated ingredient across meals**, which is correct for a
  day's intake but means a template with the same meal twice inflates a preview. Only matters if the
  tile is ever pointed at a template.
- `unused-field` is at 14 on poms grid — worth one pass now that the audit tooling exists.
