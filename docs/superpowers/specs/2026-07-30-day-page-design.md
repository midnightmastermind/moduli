# Day Page — repair + writing sections (2026-07-30)

The poms grid holds exactly **one** day page (`Day Page - 2026-07-28`) and nothing for the two days
since. Its Daily Question is inert and its links are broken. This spec covers making the day page
build every day and turning it into a journal / todo / notetaking surface.

## Ground truth (measured on the live poms grid, not inferred)

| Fact | Evidence |
|---|---|
| One day page ever built | only `18fdcbe1…` under the `Day Pages` folder, dated 2026-07-28 |
| Day page carries no field values | `fields: {}` on the page, the Daily Question container, and the Daily Answer textblock |
| The question pool already exists | **117** occurrences under Library page `VI5z1eAPtFg5` tagged `Library = "question"` |
| `Daily Question` already knows how to offer them | `meta.optionsSource` find-mode + `randomizable: true` |
| `Daily Question` cannot be written | `inputEnabled: false, displayEnabled: true` |
| Day-col children are COPY_LINKed from a master "Day" container | `$dayCont = $allItemsById.9EZL5iXnYhul`; per-day copies carry `meta.copyLinkSource` |
| `Due` / `No timeslot` identity markers are INTACT | all 4 occurrences of each carry their own label in `fields.<timeslotFieldId>` |

## Root causes

### 1. `Day Page: Build` jams permanently after the first page

The op locates its template with:

```
FIND $allOccurrences where meta.templateName IS "Day Page" -> $dayPageTplId
```

`APPLY_TEMPLATE` **copies `meta` onto the clone**, so the minted `Day Page - 2026-07-28` also carries
`meta.templateName: "Day Page"`. From the second day onward the FIND matches two occurrences.
`FIND` returns an **array** on multi-match (`operationActions.js:1216-1229`), `IS_NOT_EMPTY` still
passes, and `APPLY_TEMPLATE templateRef: [id, id]` cannot resolve. One day page, forever.

This is the same failure class as the 2026-07-14 Pomodoro `COPY_LINK` FIND-by-label bug: a clone
that inherits the discriminator its own lookup keys on.

### 2. `defaultFields` never reaches container or textblock clones

`operationActions.js:2793` merges `APPLY_TEMPLATE`'s `defaultFields` **only** onto `role ===
"instance"` clones. Daily Question is a `container`; Daily Answer is a `textblock`. Both get
`fields: {}`, so the date the op meant to stamp is absent.

Their `meta.headerLink` / `meta.bodyLink` join on the date field. With no date, the links have
nothing to match — this is the reported "the Daily Question header has no dropdown / Tasks Completed
shows broken links".

The gate exists for a real reason (slot/page clones don't bind the date, so the key would be dead
weight and `CREATE_ITEM`'s auto-attach would inflate their `fieldBindings`). The fix must preserve
that, not remove it.

### 3. The question dropdown cannot write

`Daily Question` is display-only. `inputEnabled: false` means the bound header renders no writable
control regardless of how good the options source is.

### 4. Tasks Completed writes embeds that point at a literal string

`PUSH_TO_ARRAY` resolved only the TOP level of an object value, but the TipTap node the day-page ops
push carries its id one level down:

```
{ type: "moduleEmbed", attrs: { occurrenceId: "$task.id" } }
```

So `attrs.occurrenceId` was never resolved. The live `Tasks Completed` container holds **21 embeds,
every one of them addressed to the literal string `"$task.id"`** — which is the reported "Tasks
Completed has all of those broken links", root-caused.

*Retracted from an earlier draft of this spec: a claim that the `Due` / `No timeslot` identity
markers were null and Build Schedule's un-slotted sweep was therefore dead. They are intact; the
probe that said otherwise read `scheduleFieldIds.timeslot` instead of `.timeslotFieldId`. Renaming
the container to `Todo` is a user request, not a repair.*

### 5. Nothing re-links a day page built before its day column

`Day Page: Build` only acts at mint time. Both it and `Schedule: Build Schedule` fire on load with
no ordering guarantee, so a day page can be created before the day column that owns its Todo.

## Design

### Layout

Top to bottom — prompt, plan, write, capture, review:

1. `# Day Page - <date>` — existing heading textblock
2. **Daily Question** — existing container; header = question dropdown + 🎲, body textblock = answer
3. **Todo** — the day column's own container, multi-parented in
4. **Journal** — new `role:container kind:doc`, `## Journal`, free body
5. **Notes** — new `role:container kind:doc`, `## Notes`, free body
6. **Tasks Completed** — existing; auto-seeded from Schedule, sorted by timeslot
7. **Highlights** — new `role:container kind:doc`, `## Highlights`, end-of-day reflection

### Journal / Notes / Highlights store plain `occurrence.textmap`

No field bindings. The occurrence is minted fresh per day, so the writing is per-day for free.
Daily Answer keeps its binding because that one is *meant* to sync by date with other occurrences;
these three have nothing to sync with, so a binding would be plumbing that buys nothing and adds a
propagation path to reason about.

### Todo is a link, not a copy

The day page splices the day column's Todo occurrence id into its own `occurrences[]` and a
`moduleEmbed` into its textmap — the multi-parent pattern the shared slots already use. Checking an
item off on the day page and on the Schedule are the same write on one occurrence.

**Deliberately not two occurrences.** Same reasoning recorded for `createPageInContainer` on
2026-07-29: state that lives on the occurrence would fork into two independent copies.

### Fixes

1. **Template lookup** — `Day Page: Build` resolves the template by id
   (`$allItemsById.<tplDayPageRootOccId>`) instead of the meta FIND. Picker-direct, the idiom the
   2026-07-16 migration moved 37 call sites onto.
2. **`defaultFields` gate** — merge onto any clone whose **module binds that field**, replacing the
   `role === "instance"` test. Preserves the original intent (slot/page clones don't bind the date,
   so they still get nothing) while stamping Daily Question and Daily Answer.
3. **`Daily Question` → `inputEnabled: true`.** Pool and randomize already work.
4. **Todo rename** — module label `No timeslot` → `Todo`, the Time Slot identity marker set to match
   on the master and every per-day copy, and both `Schedule: Build Schedule` FIND rules updated, all
   in one pass. Renaming the label while leaving the marker reading `No timeslot` would be exactly
   the silent label/marker drift that cost three passes on 2026-07-30.
4b. **`PUSH_TO_ARRAY` deep-resolves object values**, the same way `UPDATE`'s object branch already
   does. Flat rows (every pre-existing caller) resolve identically; nested ones now work.
5. **Idempotent link pass** — `Day Page: Build` gains a tail that runs every load: find the day-col
   for `$dayDate`, find its Todo, splice into the day page if absent. Self-healing, and it covers
   the day pages already built.

## Delivery

- Seed (`liveSystemBuilders.buildDayPageTemplate`, `makeDayPageBuildOp`, `createLiveData`) is the
  spec for new grids.
- **Migration `0011`** carries all of it to the frozen poms grid: repairs masters and per-day copies
  in one pass (2026-07-30 lesson — a master repair propagates into copies minted afterwards).
- One client change (`operationActions.js`, fix 2) with tests.
- Verify on prod that the next rollover mints a complete day page.

## Risks

- Fix 4 rewrites a stored op pipeline **and** live data. Both must land in the same migration run,
  or a half-applied state leaves the sweep broken in a new way.
- Fix 2 touches every `APPLY_TEMPLATE` caller. `Schedule: Build Schedule` uses `defaultFields` for
  slot copies; the new gate must leave those byte-identical. Assert it.
- A probe that loads the live grid can trigger the day rollover (2026-07-30). Keep verification
  probes open, or expect to repair.
