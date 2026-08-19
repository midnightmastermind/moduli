# Financial, Nutritional and Fitness trackers — a plan

**User, 2026-08-19:** *"make sure my goals are set up with my meal plan and the goals for working
out match what day we are on and shows if i did each of those workouts (one display field per
workout). so if its a thursday, do the thursday ones etc."* … *"make sure the tracker date isnt
showing up on things that dont need it or should be something else. currently i dont have a filter
set on the financial stuff and it still says Todays financials and the tracker dates say today"* …
*"those trackers are supposed to be total by default for financial"* … *"so we need a plan to look
at financial, nutritional, and fitness trackers."*

Everything below was measured on the live grid on 2026-08-19. Where a number is stated, it came
from the data, not from reading the seed.

---

## 0. What is actually there right now

```
Today's Physical    Sleep · Water · Steps · Fitness Stats · Workout · Nutrition
Today's Financial   Spent · Income · Checking · Savings · Mom's · Cash · Net Worth ·
                    Total Subscriptions · Monthly Bills
```

**Two findings reframe the whole task, and neither is what the ask assumed.**

**(a) The `Workout` and `Nutrition` tiles bind NO FIELDS.** Not "wrong fields" — none. They are two
empty tiles, which is why the goals read as missing rather than as wrong.

**(b) `Workout History` and `Meal History` already RUN and write into fields nothing displays.**
They compute `Workouts`, `Last Workout`, `Meals`, `Last Meal` and `Calories`; no tile on the
Trackers page binds any of them. So the work of aggregating is done and the result is invisible —
which is a much smaller gap than building the aggregation from scratch.

---

## 1. Financial — cumulative by default

**The date prefix is applied BLANKET.** `Trackers: Date-Prefix Labels` walks everything under the
Trackers page (`5zaCM_ScvI7n`) in two loops and unconditionally:

```
loop $allContainers  →  UPDATE $grp.label  = "${$activeDatePossessive} ${$grp.moduleLabel}"
loop $allInstances   →  UPDATE $goal.label = null
                        UPDATE $goal.fields.<Tracker Date>.value = $activeDate
```

So every container becomes "Today's X" and every tile is stamped with today, regardless of what
the tracker measures. **All nine financial tiles bind `Tracker Date`.**

**But most of them are not daily**, read off their own pipelines:

| tracker | date comparators in its op | what it really is |
|---|---|---|
| Net Worth | *none* | all-time |
| Total Subscriptions | *none* | all-time |
| Monthly Bills | *none* | all-time |
| Checking / Mom's / Cash | `DATE_AFTER` + `SAME_DAY` on a `replace` base | a running BALANCE |
| Spent | `DATE_IN_PERIOD` | genuinely daily |
| Income | `DATE_IN_PERIOD` | genuinely daily |

**Proposal — derive the flag, do not enumerate it.** A migration stamps `meta.cumulative` on each
tracker tile's module by INSPECTING the op that writes it: an op with no date comparator against
the active period is cumulative. The date-prefix op then gains one rule per loop
(`$grp.meta.datePrefix IS_NOT false`, `$goal.meta.cumulative IS_NOT true`).

*Why derived rather than a hand-written list:* a list is a second opinion that drifts the first time
a tracker's op changes. This repo has paid for that in `sweepOrphans` vs `gridIntegrity` and in the
Schedule's two identity schemes. The migration reads the same pipelines the executor runs.

**The container label is a separate decision, and it needs the user.** `Spent` and `Income` ARE
daily, so "Financial" is not uniformly cumulative:
- **(A)** Container reads `Financial`; the two daily tiles keep a date on the TILE.
- **(B)** Split into `Financial` (cumulative) and `Today's Spending` (Spent + Income).

**(B) is the more honest structure and the bigger change.** Ask before building.

---

## 2. Nutritional — the plan's own numbers

The meal plan is already in the data and resolves: **40 meal picks across the five cycle templates,
0 dangling**, eight meals a day (Greek Yogurt Bowl · Peanuts & Apple · Mediterranean Chicken Wrap ·
Hard-Boiled Eggs & Pecans · Protein Shake · Grilled Chicken & Roasted Veggies · Peanuts & Apple ·
Protein Shake), each carrying Calories/Protein/Carbs/Fats summed from its ingredients (`0120`,
`0123`).

**So this is a DISPLAY gap, not a data gap.** `Meal Nutrition` and `Meal History` already compute
today's totals.

**Proposal:**
1. Bind the empty `Nutrition` tile to `Calories`, `Protein`, `Carbs`, `Fats` (display) plus
   `Meals` / `Last Meal`, which are already being written and shown nowhere.
2. Add the plan's DAILY TARGETS as target values on those display fields, so each renders as
   progress rather than a bare number. **The targets come from `Nutrition Plan.md` /
   `Basic Nutrition Guide` — read the documents, do not derive them.** `0123`'s header records that
   the plan states targets for four vitamins qualitatively and macros numerically; the exact figures
   must be quoted from the file, and anything not stated there is left empty rather than invented,
   the rule `0120` set for prices.

---

## 3. Fitness — today's cycle day, one field per workout

**THERE IS A BLOCKER, AND IT MUST BE FIXED FIRST.** Measured today:

```
Movement picks on the five cycle templates    24, ALL DANGLING
Movement picks on today's column               6, ALL DANGLING
Meal picks                                    40, all resolve
```

This is the class `0114` repaired on 2026-08-13: a pick that names a FEED COPY is valid only until
the next sync re-mints it. **It has recurred, and CLAUDE.md's own note says a reference to a feed
copy is a pointer with a shelf life.** Nothing that reads "which movement was prescribed" can work
until this is repaired — `0114`'s method applies unchanged (repoint from the row's
`identitySignature` to the source the dropdown itself offers), and it should be re-run and then
**re-checked after a feed sync**, which is what caught it being only temporarily fixed last time.

*Worth considering as the durable fix rather than a third repair:* the same `dated-copy-link-source`
lesson from 2026-08-19 (5) — an integrity rule that reports a stored pick resolving to a feed copy,
so the next recurrence is loud rather than discovered by a user.

**Then the feature.** Today's column carries `Cycle Day = "Day 2"` (stored, per `0112`), and the
cycle is a 5-DAY ROTATION, not a weekday:

```
Day 1  Upper Push    6 lifts        Day 4  Core & Cardio   6 core + Run + Stretch
Day 2  Legs          6 lifts        Day 5  Rest            nothing
Day 3  Upper Pull    6 lifts
```

**So "if it's a Thursday do the Thursday ones" needs one decision from the user:** the plan is a
5-day cycle that drifts against the week. Either it stays a cycle (Thursday is whatever day the
rotation reached) or it is re-pinned to weekdays. **Ask — this changes what the op reads.**

**Proposal, assuming the cycle stays:**
1. Six display fields `Workout 1` … `Workout 6` (six is the measured maximum on a lifting day; Day 4
   carries 6 core movements plus Run and Stretch, so confirm whether those two need slots 7-8).
2. One op, `Fitness: Today's Prescription`, triggered like the other trackers:
   - read today's column's `Cycle Day`
   - resolve that cycle template
   - loop its movement rows in order; for each, write `"<Movement name> — done | not yet"` into
     `Workout <n>`, by finding today's Exercise row carrying the same Movement and reading its
     `Completed`
   - blank the unused slots, so a Rest day shows nothing rather than yesterday's list
3. Bind all six to the empty `Workout` tile.

**The completion read is the part to get right:** an Exercise row is matched by its Movement PICK,
not by label — the 2026-08-13 finding that a board row is the option you pick while the routine is
the thing you do.

---

## 4. Order

1. **Repair the dangling Movement picks** (blocks §3 entirely; also makes the existing workout
   trackers honest).
2. **Financial** — derive `meta.cumulative`, guard the date-prefix op. *Needs the (A)/(B) answer.*
3. **Nutrition** — bind the empty tile; add targets quoted from the plan documents.
4. **Fitness** — the six fields and the prescription op. *Needs the cycle-vs-weekday answer.*

## 5. Questions the user has to answer

1. **Financial layout:** one `Financial` container with two still-daily tiles, or split off a
   `Today's Spending`?
2. **Cycle vs weekday:** does "Thursday" mean the 5-day rotation's current position, or should the
   plan be re-pinned so a given weekday always gets the same workout?
3. **Day 4's Run and Stretch:** do they get their own `Workout 7` / `Workout 8` slots, or are they
   routines rather than prescribed workouts?
