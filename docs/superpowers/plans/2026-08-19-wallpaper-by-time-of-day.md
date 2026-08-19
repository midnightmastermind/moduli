# A wallpaper that follows the clock — and the grid write path ops never had

**User, 2026-08-19:** *"lets create a plan to make an operation then in poms-grid to change wallpapers
at certain times. we have a day wallpaper, dusk, and night wallpaper in screenshots for the stardew
valley theme. the op should check the theme and if its stardew valley, checks the time, and applies
the new wallpaper. since the theme stuff is custom and not hard coded, we should be able to change
that easily via operations and ui also."*

---

## What already works — measured, not assumed

```
$grid            READABLE by ops             operationExecutor.js:1602  ($grid: state?.grid ?? {})
$currentHour     a number, 0-23              operationExecutor.js:1445
$currentTime     "HH:MM"                     operationExecutor.js:1446
$now             ISO timestamp               operationExecutor.js:1442
schedule.atTimes fires at HH:MM, once/min    useScheduler.js:60   (the alarms already use it)
schedule.interval                            useScheduler.js:45
skins             DATA, per grid              helpers/skins.js — grid.meta.skin, shipped today
```

So the op can already ask *"is this grid on the Stardew skin, and what time is it?"* — the read half
of the ask is free, and that is a direct consequence of skins being data rather than hardcoded CSS.

## THE ONE THING MISSING, and it is the whole plan

**No operation can write to the GRID.** `applyUpdate` routes `$item.*`, `$display.*` and `$<var>.*`
— all of them RECORD paths. There is no `grid.*` head, and no `UPDATE_GRID` action. The nearest
thing, `UPDATE_STYLE`, writes `ownStyle` onto a **module** (`operationActions.js:2758`).

That is the gap, and it is bigger than this feature: it is why *"we should be able to change that
easily via operations"* is currently false for **every** grid-level setting — the skin, the layout
rules, the filter defaults, `defaultStyle`, `typeStyles`. Building a bespoke `SET_SKIN` action would
close one hole and leave the rest, and would need a sibling every time a new grid setting appears.

**So the plan is: one general write path, then the op is data.**

---

## Design

### The variant, not a fourth skin

The op changes the **wallpaper**, not the whole look — Stardew's own UI does not change colour at
night. Two shapes were considered:

- **Three skins** (`stardew-day` / `stardew-dusk` / `stardew-night`) — zero new concepts, but it puts
  three near-identical entries in the picker and makes "which skin am I on" a moving target.
- **One skin, a variant key** — `grid.meta.skinVariant: "day" | "dusk" | "night"`, with the skin
  declaring what each variant overrides.

**Take the variant.** The picker keeps one Stardew entry, and the same mechanism serves any future
skin that wants day/night art without adding rows to the picker.

A variant overrides **the wallpaper AND its scrim**, not just the image: a night picture is already
dark, so the scrim that keeps text readable over the daytime one would crush it. That is one field,
and leaving it out is how this ships looking wrong at 10pm.

```
skin.variants = {
  day:   { wallpaper: url(...), wallpaperScrim: 0.22 },
  dusk:  { wallpaper: url(...), wallpaperScrim: 0.30 },
  night: { wallpaper: url(...), wallpaperScrim: 0.14 },
}
```

### The three images, already saved

```
day    wp13651525-stardew-valley-mountains-wallpapers.jpg        bright sky, green hills  (shipped)
dusk   stardew-valley-farmhouse-sunset-pixel-art-cozy-…jpg       sunset, hot mid-tones
night  wallpapersden.com_stardew-valley-hd-gaming-…1920x1080.jpg deep blue, stars
```
Each converted to webp the same way the current one was — and **not resampled**: two are already
1920 wide, and the sunset is an exact 2× reduction with a nearest kernel, because a smooth kernel
blurs pixel art into mush.

---

## Tasks

### Task 1 — `grid.meta.<key>` becomes writable by an operation  ← the real work
- `applyUpdate` gains a `$grid` head: `$grid.meta.<key>` → a new `UPDATE_GRID_META` effect.
- `bindSocketToStore` applies it through `CommitHelpers.updateGrid`, the existing chokepoint — not a
  second write path.
- **It must MERGE `meta`, never replace it.** `grid.meta` carries `skin`, `typeStyles`,
  `defaultStyle`, `layoutRules`, `scheduleFieldIds`, `autoAppliedFieldIds`, `migrations`… Writing the
  whole object is how a one-key op silently deletes the migration ledger. `createPageInContainer`
  already has this exact latent clobber recorded on 2026-08-08; do not add a second.
- **Refuse a protected key.** `meta.migrations` and `meta.frozenAt` are the system's own bookkeeping;
  an op that can rewrite the applied-migration ledger can make a migration run twice.
- Same shape in the reverse direction: `$grid.meta.skinVariant` is READ by `resolveSkinId`, so the op
  can read what it last wrote and skip a no-op write (see Task 3).

### Task 2 — Skin variants
- `skin.variants`, resolved by `useSkin` from `grid.meta.skinVariant`, defaulting to the skin's base.
- A skin with no `variants` behaves exactly as it does now — the back-compat case, and the test.
- An unknown variant name falls back to the base rather than to no wallpaper: failing to today's
  appearance beats a blank grid.

### Task 3 — The operation
Seeded by a builder (`makeWallpaperByTimeOp`) rather than hand-written JSON, so the poms-grid
migration and a fresh seed cannot drift — the rule `0053` and `0064` both paid for.

```
IF   $grid.meta.skin IS "stardew"          ← the user's own guard: only this skin
  IF   $currentHour >= 21 OR < 6   → night
  ELSE IF $currentHour >= 18       → dusk
  ELSE                             → day
  IF   $grid.meta.skinVariant IS_NOT <chosen>      ← the write is CONDITIONAL
     UPDATE $grid.meta.skinVariant = <chosen>
```

- **The no-op guard is not an optimisation, it is the whole safety of the op.** It fires on load AND
  on a schedule; without the guard every load writes the grid, every write broadcasts `grid_updated`,
  and `grid_updated` is what `CommitHelpers.updateGrid` fires NavigationOps from (2026-08-07 (2)).
  An unconditional write is a loop.
- **Triggers: `onLoad` AND `atTimes` at 06:00 / 18:00 / 21:00.** `atTimes` only fires if the app is
  open at that minute, so onLoad is what makes opening the laptop at 11pm correct. Neither alone is
  enough, and the guard is what makes running both free.
- Boundaries are op CONFIG, not code. "Dusk at 18:00" is a preference, and the whole point of this
  being an operation is that the user can move it in the editor.

### Task 4 — The UI half
*"…and ui also."* The Appearance tab's skin picker gains a variant row for a skin that declares
variants — Day / Dusk / Night plus **Auto**, where Auto simply means "an operation owns this".
Picking a fixed variant while the op is enabled would fight it every hour, so choosing one offers to
disable the op, and says so rather than silently losing.

### Task 5 — Migration for poms grid
`grid.meta.skinVariant` seeded from the current hour so the first paint after the migration is
already right, plus the op. Additive: one new key and one new operation, nothing moved.

### Task 6 — Verification
- The op driven through the REAL executor at 05:59 / 06:00 / 17:59 / 18:00 / 20:59 / 21:00 — the
  boundaries are where an off-by-one lives, and a test at noon proves nothing about them.
- **A/B the guard**: with it removed, a second fire must produce a write (i.e. the test discriminates).
- Screenshot all three variants at 1440×900 and **look at them** — a wallpaper is a visual claim, and
  the day variant already had to have its scrim re-measured once.
- The `noDomainKnowledge` guard still passes: the renderer must not learn what "dusk" is.

---

## Risks

- **The write loop** (Task 3's guard). The one that can take the grid down rather than look wrong.
- **`meta` clobber** (Task 1). Silent, and it eats the migration ledger.
- **Three wallpapers is three more image fetches.** Only the active one is referenced, but switching
  at 18:00 fetches an unseen 250KB image mid-session — preload the next variant, or the swap flashes.
- **Timezone.** `$currentHour` is the BROWSER's local hour, which is what a person means by "night".
  Nothing to fix, but worth stating: a grid open on two machines in two zones will disagree, and the
  last write wins.
