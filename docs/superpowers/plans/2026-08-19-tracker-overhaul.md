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

## 2. Nutritional — the amount needed in a day, with a goal against each

**User:** *"the nutrition side should be the amount i need in a day"*, *"for cals macros and
vitamins"*, *"i want goals to hit each of those"*, *"and the correct amount of water"*, *"and meal
count"*.

**The numbers exist in the user's OWN documents and must be quoted, not derived.**

`Nutrition Plan.md` — *Daily Macros (Approximate)*:
```
Calories  ~2,900 kcal      Carbs  ~150-180 g
Protein   ~185-200 g       Fats   ~100-120 g
```
`Basic Nutrition Guide.md` — *Daily Nutrient & Hydration Needs*:
```
Water      3-4 litres daily            Fiber   25-38 g
Vitamin D  600-800 IU                  Iron        8 mg
Vitamin C  90 mg                       Zinc       11 mg
Vitamin A  900 mcg                     Calcium  1,000 mg
Vitamin B12 2.4 mcg                    Magnesium 400 mg
Omega-3    250-500 mg                  Sodium 2,300 / Potassium 3,400 mg
```

**THE TWO DOCUMENTS DISAGREE, and that is the user's call, not mine.** The plan says protein
**185-200 g** and fats **100-120 g**; the guide says protein **150-180 g** (1.0-1.2 g/lb) and fats
**70-120 g**. The plan is the bulking programme and the guide is the general baseline, so the plan
is the likelier intent — but picking silently would bake a 35 g/day difference into a goal.

**MEASURED AGAINST WHAT THE GRID CAN ACTUALLY HOLD:**

| target | field today | note |
|---|---|---|
| Calories / Protein / Carbs / Fats | **yes** (+ `Total *` display twins) | no `targetValue` set on any |
| Vitamin A · C · D · B12 | **yes**, 24 rows carry values | the four the guide gives targets for |
| Vitamin E · K · B6 · Folate | **yes**, 24 rows carry values | **no target in either document** |
| Magnesium · Iron · Zinc · Calcium · Omega-3 · Sodium · Potassium | **NO FIELD** | the guide targets them; the grid cannot record them |
| Water | `Daily Water` exists, 1 row with a value | guide is in LITRES, the grid records **oz** — 3-4 L = **101-135 oz** |
| Meal count | no field | the plan is **8 meals/day**, measured off the templates |

**So the work splits three ways, smallest first:**
1. **Set `displayConfig.targetValue` on the macro + four vitamin display fields.** Cheap, and it is
   what turns a number into a goal — the display-rules machinery already renders met/not-met.
2. **Add `Meal Count` and give Water a target in the unit the grid uses.** A conversion, stated in
   the migration rather than left implicit.
3. **Decide about the seven missing minerals.** Adding fields is easy; POPULATING them is not —
   `0123` wrote 182 vitamin values as standard reference figures per ingredient, and seven more
   nutrients across 14 ingredients is ~98 more. Worth doing only if the user wants them tracked
   rather than merely listed.

**A range is not a target.** Every figure above except Calories is a RANGE. A goal field holds one
number, so each needs a rule: the low end (met = "enough"), the midpoint, or a min/max pair the
display rules colour on both sides. **Recommend the LOW end for intake targets** — hitting 185 g of
protein means the 185-200 goal is satisfied — and flagging over-range separately if wanted.

## 3. Fitness — today's cycle day, one field per workout

**A RETRACTION FIRST, because the first version of this plan led with a blocker that does not
exist.** It claimed all 24 Movement picks on the cycle templates were dangling. They are not:

```
Movement values on the grid     42, and every one is an ARRAY
ids resolving                   42
dangling                         0
```

**Movement is a MULTI-select, so its stored value is an array of ids.** My census looked each value
up as a scalar id, every lookup returned undefined, and I reported the whole set as dead — then
wrote it into a plan and a commit message. What caught it was re-running `0114`, the migration built
for exactly this class, which reported "every pick already resolves" and disagreed with me.
*A probe that contradicts a purpose-built tool is the probe's problem until proven otherwise.*

So there is no repair step, and fitness is not blocked.

**What IS true:** today's column carries `Cycle Day = "Day 2"` (stored per `0112`, and the rotation
now advances since the `SET_VAR` fix earlier today), and the cycle is a 5-DAY ROTATION, not a week:

```
Day 1  Upper Push    6 lifts        Day 4  Core & Cardio   6 core + Run + Stretch
Day 2  Legs          6 lifts        Day 5  Rest            nothing
Day 3  Upper Pull    6 lifts
```

**So "if it's a Thursday do the Thursday ones" needs one decision:** a 5-day cycle drifts against a
7-day week, so a given weekday will not keep getting the same workout. Either it stays a cycle, or
the plan is re-pinned to weekdays. **This changes what the op reads — ask before building.**

**Proposal, assuming the cycle stays:**
1. Six display fields `Workout 1` … `Workout 6` — six is the measured maximum on a lifting day.
   Day 4 adds Run and Stretch, hence open question 3.
2. One op, `Fitness: Today's Prescription`, on the same trigger surface as the other trackers:
   read the column's `Cycle Day` → resolve that cycle template → walk its movement rows in order →
   for each, find today's Exercise row carrying the same Movement and read its `Completed` → write
   `"<name> — done | not yet"` into `Workout <n>`. **Blank the unused slots**, so a Rest day shows
   nothing rather than yesterday's list.
3. Bind all six to the `Workout` tile, which today binds nothing.

**Match on the Movement PICK, never the label** — a board row is the option you pick; the routine is
the thing you do (2026-08-13).

## 4. Order

**SHIPPED 2026-08-19 (`0146`), the part that needed no new operation:** tiles `Macros` (Total
Calories/Protein/Carbs/Fats) and `Intake` (Daily Water, Meals, Last Meal) inside the `Nutrition`
container, `Workout Goals` (Total Workouts, Workouts, Last Workout) inside `Workout`, and daily
targets on all five goal fields. Six fields that were being computed every load and displayed
nowhere are now on screen. `Workout` and `Nutrition` turned out to be empty CONTAINERS rather than
tiles, so the tiles went inside them.

1. **Financial** — derive `meta.cumulative` from each tracker's own op, guard the date-prefix op.
   *Needs question 1.*
2. **Nutrition step 1** — targets on the macro and four vitamin fields. No decisions beyond
   question 2; the numbers are quoted from the documents.
3. **Nutrition step 2** — meal count, water target in oz.
4. **Fitness** — the six fields and the prescription op. *Needs questions 4 and 5.*
5. **Nutrition step 3** — the seven missing minerals, only if wanted. *Needs question 3.*

## 5. Questions — ANSWERED 2026-08-19

1. **Financial layout** → **one `Financial` container, cumulative by default.** `Spent` and `Income`
   keep a date on the TILE so it stays clear those two are for today.
2. **Protein and fats** → the **meal plan's** numbers (185-200 g / 100-120 g), per the user's own
   "goals set up with my meal plan". Shipped in `0146` at the low end.
3. **The seven minerals** → **track all of them.** 7 fields plus ~98 per-ingredient reference
   values, the same way `0123` added the vitamins, and with the same provenance line: these are
   standard reference figures, not values from the user's documents.
4. **Cycle vs weekday** → **keep the 5-day cycle.** The op reads the column's stored `Cycle Day`;
   a given weekday legitimately moves through the rotation.
5. **Day 4's Run and Stretch** → not asked in the end; defaulting to **their own slots**, since the
   plan lists them as that day's work and a Core & Cardio day with no cardio shown would be wrong.
   Say if they should be routines instead.
6. **The five dead display fields** → **drop them** (`Now`, `Time Left`, `Overdue Tasks`,
   `Due This Week`, `Task Count`), and **bind `Days Until Due`**, which already computes and is
   shown nowhere.

---

## 6. Every display field, audited  (user: *"look at all my display fields and make sure they are
being used by an operation or updated in some way"*)

Measured on the live grid: **54 display fields**, cross-referenced against every ENABLED operation's
pipeline and every module's `fieldBindings`.

**FIVE ARE WRITTEN BY NOTHING, and four of them are bound to a tile — so they render as permanently
empty pills on the Trackers page.** None carries a value on any occurrence, which is the
confirmation rather than a guess:

| field | bound to a tile | rows with a value |
|---|---|---|
| `Now` | yes | 0 |
| `Time Left` | yes | 0 |
| `Overdue Tasks` | yes | 0 |
| `Due This Week` | yes | 0 |
| `Task Count` | no | 0 |

*A display field with no writer is the same defect class as the inert `--font-display` token and the
two picker actions with no executor case: a surface that promises a value nothing will ever
produce.* CLAUDE.md 2026-08-11 (3) states it directly — **"a binding that promises a value nothing
will write is worse than no binding."**

**ONE IS COMPUTED AND DISPLAYED NOWHERE:** `Days Until Due` is written by its own op and bound by no
module. That is the cheaper defect — the number exists and simply is not shown.

**Each needs a decision, and they are not the same decision:**
- `Now` and `Time Left` read like Pomodoro/clock readouts — either wire them to the timer or drop
  the tiles.
- `Overdue Tasks`, `Due This Week`, `Task Count` are task aggregates the Tasks page could feed;
  `Days Until Due` already computes and only needs binding, so it is the one-line case.
- **Dropping is a legitimate outcome.** An empty pill on a dashboard is worse than no pill.

**This audit should be a TEST, not a one-off.** `gridIntegrity` already reports `unused-field` for
fields never bound, never valued and referenced by no operation — it does NOT catch a field that is
BOUND but written by nobody, which is exactly the shape of all five above. That rule is a few lines
and would have caught these the day they were created.
