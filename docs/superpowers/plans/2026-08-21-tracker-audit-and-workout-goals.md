# Tracker audit · workout goals · weekday tasks — 2026-08-21

Settled with the user in-session. Build order is value-first; each item is independently shippable.

## What the audit MEASURED (before any code)

- **47 of 47 tracker tiles are written by an operation. 0 orphans.** An earlier probe of mine reported
  11 "written by nobody" — a detection artifact: it only matched ops naming a tile picker-direct, and
  several bind by FIND on the field instead (the shape `Monthly Bills` uses).
- **34 of 37 trackers already aggregate ALL-TIME when the date filter is cleared.** All 37 carry
  `periodAllPolicy`'s OR wrapper. So "say Total when no date is set" is mostly a LABEL fix — the
  numbers are already right and the pill is the part that lies.
- **3 trackers do not**: `Completed Tasks`, `Completed Habits`, `Sleep Time`. They still carry the
  `$goalPeriod = $trigger.date` and `= $today` fallbacks, which fire BEFORE the wrapper can matter,
  so clearing the date shows today. These are exactly the three the policy missed.
- **19 trackers scope `HAS_ANCESTOR <Schedule page>`.** Completing a task on the Tasks page therefore
  cannot count — **and the user confirmed that is INTENDED** ("just the schedule"). Not a defect; the
  ask is a separate end-of-day MOVE, not a counting change.
- Already present, so neither needs creating: a **`Completed` container parented to Tasks**, and the
  **`Weekday` field** (`hzkcwybebz`, select Mon-Sun) — today bound only by the 7 weekday templates.

## Decisions

1. **The 3 fallbacks come out** so an empty period means all-time everywhere. Re-run the EXISTING
   `utils/periodAllPolicy.js` rather than writing a second implementation.
2. **`Tracker Date` reads "Total"** when no Date filter is set — on **every** tracker carrying the
   field, not just the workout ones.
3. **Delete 8 tiles and their ops**: `Reps`, the six per-muscle `Volume` tiles, and the OLD
   `Workout Log`. Dump before deleting.
4. **Rename `Workout Goals` -> `Workout Log`**, keeping `Total Workouts` / `Workouts` /
   `Last Workout`, adding `Tracker Date`, and dropping the generic `Workout 1-6` slots.
5. **New `Workouts` tile**: one display field per movement THE WEEKDAY TEMPLATES USE (not the whole
   catalog), plus `Tracker Date`. An op hides the fields not in that day's session, on load and on
   filter change. **Done is DERIVED** from that day's Exercise row having `Completed` ticked.
6. **`Weekday` on tasks**: set it with `Date` empty and the task is placed on that weekday, **every
   week**, as a **FRESH COPY** each week (so last week's tick cannot mark this week done). It lands
   in the day's **Due** area unless the task also carries a `Time Slot`.
7. **End-of-day move**: completed tasks/appointments are swept into `Tasks > Completed` on the FIRST
   LOAD AFTER THE DATE ROLLS OVER — the marker-occurrence mechanism `Grid: Snap Filter To Today`
   already uses, which works whether or not a tab was open at midnight. They are **not counted**
   unless on the Schedule; this move is about the record, not the numbers.

## Open risk, stated

Item 5 is the only one that mints many fields. Keeping it to the movements the templates actually use
(~20 rather than the full catalog) is what bounds it, and it means every field minted can actually
light up. A movement added to a template later needs the migration re-run to gain its field — which
is the `0120`/`0130` class ("every X" means every X that exists when it runs), so the migration must
be idempotent and gap-filling rather than create-once.

---

## Feasibility check on the `Workouts` tile — 2026-08-21, BEFORE building

The user's three answers were: give Run and Stretch fields too (**26** fields, not 24), each field is
**0/1 with a target of 1**, and **the operation mints a field itself** when a movement lacks one.
Checked the executor against those, and two of the three need capability that does not exist:

```
CREATE_FOLDER      exists          CREATE_OCCURRENCE  exists
CREATE             exists          SET_FIELD_VALUE    exists
CREATE_FIELD       DOES NOT EXIST                     <- answer 3 needs this
$occ.fieldVisibility  NOT a writable UPDATE path      <- the hide/show needs this
```

`fieldVisibility` is read by `getEffectiveFieldVisibilityForOccurrence` and written only by
`helpers/fieldVisibilityAutoAppend.js` on the client. No pipeline can set it.

**These are NOT the same size, and that is the useful part:**

- **Writing `fieldVisibility` is small and precedented.** It mirrors `$page.filterOverride.<fieldId>`
  exactly — the path `UPDATE` gained on 2026-07-26, which emits `UPDATE_ITEM_FILTER_OVERRIDE` and is
  applied through the same commit helper the UI uses. One executor case, one effect applier, one
  editor entry, plus the action-coverage test (which asserts the empty set three ways, so a new
  action cannot be added without an editor and a read).
- **`CREATE_FIELD` is a genuinely new capability**: an operation creating SCHEMA on live data. It
  needs a socket write path, an editor, and a decision about what happens when the same movement is
  seen twice (idempotency on a field NAME, which is the one thing the unique-field-names rule makes
  load-bearing). That wants its own reviewed pass, and it is the option's own stated risk.

**Recommended split, so the tile ships without waiting on the bigger half:**
1. `0170` mints the 26 fields and the tile (migration — covers every movement the templates use today).
2. The `fieldVisibility` UPDATE path, with tests and an A/B.
3. The op: per-movement 0/1 from that day's Exercise row's `Completed`, and the visibility write.
4. **Deferred:** `CREATE_FIELD`. Until it exists, adding a 27th movement means re-running `0170`,
   which is idempotent and gap-filling — one command, documented beside the migration.

---

## Progress — 2026-08-21 (2)

**Item 6 (`Weekday` on tasks) is SHIPPED** — `0172` + `0173`, applied to poms grid, pm2 restarted,
14 behavioural tests. See the commit for the reasoning. Two things are worth carrying forward:

- **`0172` was not in the plan and had to come first.** The day column's `Todo` container carried a
  NULL `Time Slot` identity marker, so `Schedule: Place Dated Work` phase 2 could not find it and
  **due placement had been a silent no-op** — 7 due-dated tasks unplaced on today's column. The
  weekday op resolves Todo the same way, so it could not have worked either.
- **Weekday wins over Due.** Phase 2's claim and sweep loops now carry `Weekday IS_EMPTY`, so a task
  scheduled by weekday is invisible to due placement, source and clone alike. Inert today by
  measurement (0 instances carry a Weekday).

## Item 7 (end-of-day move to `Tasks > Completed`) — MEASURED, NOT BUILT

The measurement changes the shape of the work and is recorded rather than guessed at later.

```
Completed container on Tasks     c54c2971-…, 1 child
rows on Tasks with Completed=true                    3
   … carrying a `Completed On` value                 0      <- the obvious discriminator is EMPTY
`Schedule: Stamp Completed On`   onChange on the Completed FIELD, grid-wide, no ancestor scope
                                 — so ticking on the Tasks page DOES stamp it, going forward
```

**Three findings, in the order they matter:**

1. **`Completed On` is the right discriminator and it is blank on every existing row.** A row
   completed BEFORE today is exactly "the day ended after it was done", and it needs no rollover
   marker at all — which is better than the plan's marker-occurrence idea, because a marker shared
   with `Grid: Snap Filter To Today` would already be stamped by the time a later-priority op ran.
   The gap is historical rows: they must be backfilled (or swept once by hand) or they will never
   move.
2. **Two of the three completed rows are PARENTED somewhere they are not LISTED.** `Talk to Angela
   about Vivance` and `Psych appointment with Angela` are listed by `Emotional` while their
   `parentId` says `Occupational`. That matters specifically here: `LINK_OCCURRENCE_TO_PARENT`
   MOVES — it unlists from the old parent, re-parents, and lists under the new — so on these two
   rows it would unlist from the wrong container and leave the visible listing behind. **Repair the
   parentage before building the move**, or the move is the thing that produces the orphan.
3. **The move must not disturb a schedule listing.** The trackers count `HAS_ANCESTOR <Schedule
   page>`, so a row's day-column listing is what makes it count. In practice only past-day rows
   move and their columns are already swept — but the op should be scoped so it can never unlist a
   row from a day column, rather than relying on that.
