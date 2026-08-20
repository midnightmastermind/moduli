# Weekday templates — SHIPPED 2026-08-20 as a REPLACEMENT

> **STATUS: BUILT.** The plan below was written as an additive third layer. The user read it and
> said ***"i dont want a cycle, i just want 7 day templates"***, then ***"give the templates weekday
> fields"***. What shipped therefore RETIRES the cycle rather than layering on it — see §6 at the
> bottom for what actually landed and where the plan was wrong.

# Weekday templates — the original plan (a THIRD layer)

**USER, 2026-08-20:** *"we also need to look into making a template for each of the days of the week
and not just a cycle of 4 days. that way i can put specific appointments certain days that are
repeatable."*

Measured before designing. Nothing below is built; this is what it would take and what it must not
break.

---

## 1. What is there today — three facts that shape the whole design

**THE CYCLE IS FIVE DAYS, NOT FOUR.** `Schedule - Day 1..5` = Push · Legs · Pull · Core & Cardio ·
Rest. The user asked to *"keep the 5-day cycle"* on 2026-08-19, so this ask is **additive**: a
weekday layer for repeatable commitments, on top of a rotation that deliberately does not align to
the week.

**THE BUILD IS ALREADY TWO LAYERS, and they compose cleanly because they place different things:**

```
Schedule: Build Schedule     mints the day column and COPY_LINKs the 49 slots + daily routines
                             from the ONE `Day` template.   Identity: meta.copyLinkSource
Schedule: Place Cycle Day    stamps `Cycle Day` on the column (marker occurrence JVWuhNa0HPkN
                             advances Day1→…→Day5→Day1), resolves one of five template ids, and
                             MERGES its rows into the matching slots.  Identity: identitySignature
```

A third op in the same shape — resolve a template from the column's WEEKDAY, merge its rows into the
matching slots — is the whole feature. It needs no change to either existing op.

**THE ONE MISSING PRIMITIVE IS A WEEKDAY TOKEN.** `operationActions.js` has `dateLong:`,
`daysUntil:` and `${...}` interpolation; `dateLong:` computes the weekday name internally and throws
it away inside a long label. There is **no `weekday:expr`**, so a pipeline cannot ask what day of the
week a date is.

*The alternative — parsing "Thursday" out of the column's label `Schedule - Thursday, August 20th,
2026` — is the exact trap the 2026-07-26 de-schedule sweep removed `SCHEDULE_LABEL_PREFIX` for. A
label is one rename from wrong. Add the token.*

---

## 2. What to build, in order

1. **`weekday:expr`** in `operationActions.js`, beside `dateLong:` and reusing its local-midnight
   parse (a `YYYY-MM-DD` read as UTC is the previous day in CDT — the bug my own probe hit today).
   Returns `"Monday"`…`"Sunday"`. ~6 lines, pure, unit-testable, no other caller affected.
2. **Seven templates** under `Schedule Template`, named for the weekdays, minted EMPTY. They are
   filled by dragging, the same way the cycle templates were.
3. **`Schedule: Place Weekday Template`**, mirroring `Place Cycle Day` step for step: same source
   guard, same `$activePeriodDates` loop, same slot match on the `Time Slot` VALUE, same
   `APPLY_TEMPLATE mode:"merge"`. It differs in exactly two places — the template is chosen by
   `${weekday:$day}` instead of a stored rotation position, and it needs its own row filter (below).
   Trigger surface mirrored from `Place Cycle Day` at run time, at a LOWER priority so it always
   follows it.

---

## 3. THE ONE REAL RISK, and it is not the templates

**`Place Cycle Day` is idempotent by accident of its filter.** It only places rows carrying a Meal or
Movement PICK, and every such row is signed `cycle:<pick label>` so a merge skips one already there.
A weekday template holds **arbitrary** rows — an appointment, a recurring call, a bin night — with no
pick to filter on and no natural signature.

**Without a signature scheme, every load re-clones the whole weekday template into the column.** That
is the 23-duplicate-wrappers bug (2026-07-31 (3)) and the 8-meals-per-day bug (`0108`) waiting to
happen for a third time.

The fix is the one `0112` already proved: sign every template row `weekday:<label>` when the
templates are created, and sign anything the op places. **Signing the template without signing what
the op mints just moves the duplication one level down** — the exact lesson `0023` records.

**Second risk, smaller:** a row on both a weekday template and a cycle template would be placed
twice, since the two ops sign differently and neither can see the other's marker. Worth deciding
up front whether the weekday layer is allowed to carry routines at all, or is strictly for
commitments the cycle never places.

---

## 4. What it does NOT replace

`Schedule: Place Dated Work` already multi-parents an appointment onto the day it is dated for, and
repeats a due task until it is done. That is the ONE-OFF path and stays. The weekday layer is for
things that repeat *every* Tuesday — which today can only be expressed by dating a copy per week.

---

## 5. Why this wants its own session

It adds an op to the schedule build path, which is the create path this repo has been damaged by
repeatedly, and the failure mode is silent duplication that compounds on every page load. It wants:
the behavioural harness driving the real executor over the poms grid fixture, a test that a SECOND
run places nothing, and a dry run read against a named expectation before it goes near live data.


---

## 6. WHAT ACTUALLY SHIPPED, and where §1-§5 were wrong

**The user did not want a layer.** `Schedule: Place Cycle Day` is disabled; `Schedule: Place
Weekday` replaces it. The five cycle templates were RENAMED to Mon-Fri rather than left beside seven
new ones — four of them already WERE the day the user asked for, and minting seven fresh templates
would have re-created ~340 slot occurrences to arrive at content the grid already held.

```
Day 1 Push  -> Monday      Day 4 Core & Cardio -> Thursday (keeps Run + Stretch)
Day 2 Legs  -> Tuesday     Day 5 Rest          -> Friday   (+ Run and Stretch)
Day 3 Pull  -> Wednesday   clone of Friday     -> Saturday, Sunday
```

**§1's "one missing primitive" was right, and §2's shape for it was wrong.** `weekday:expr` shipped
— but the template is NOT resolved by name. Each template carries a **`Weekday` FIELD** and the op
FINDs the one whose field matches, which is what the user asked for and is the better shape anyway:
baking seven ids into the pipeline would have made the field decorative, and matching on a NAME
would have made a rename break the schedule.

**§3's risk was real and the mitigation was wrong.** The plan proposed signing every template row
`weekday:<label>`. Unnecessary: `mergeSubtreeInto` already falls back to `auto:<sourceId>`, so an
unsigned row matches ITSELF on the next merge. Verified in the code and then measured — a second
pass over the same state creates **0**. That fallback is what lets a user drag an appointment onto
Tuesday's template with no signature ceremony, which is the whole feature.

**What the plan missed entirely: the daily routines have to come OFF the weekday templates.** The
cycle op could carry them harmlessly because it only placed rows holding a Meal or Movement pick.
The weekday op cannot keep that filter — an appointment carries neither — so it places everything,
and a routine left on the template would be placed a second time on every load. `0161` strips them
structurally (slot time AND module label both matching a row on `Day`): **35 = 7 rows x 5
templates**, with Day 4's 7:00am Run and Stretch correctly surviving, which is the discriminating
case and the reason the rule tests the slot as well as the label.

**Measured through the real executor over a fresh export, one run per weekday:**

```
Mon  6 movements  Push        Thu  8 creates  6 core + Run + Stretch
Tue  6 movements  Legs        Fri  2 creates  Run + Stretch only
Wed  6 movements  Pull        Sat/Sun  0      rest — meals and routines only
second pass on the same state: 0 creates      no template claims the day: 0, fails closed
```

**MY OWN PROBE WAS WRONG TWICE, and the op's run log is what settled it.** It reported 0 effects on
every weekday, which reads exactly like the op being broken. `computeTriggerMatch` said the op
matched, so the log was the next place to look, and one line named it: every run iterated
`$day = 2026-08-20` regardless of the date I faked. **`$activePeriodDates` is resolved from
`operation.targetOccurrenceId`'s effective filter — the op's OWN page — not from the clock and not
from `grid.activeFilterValues`.** Faking either of those moves nothing. *A probe that reports zero
is a claim about the probe until the callee's own log agrees with it.*
