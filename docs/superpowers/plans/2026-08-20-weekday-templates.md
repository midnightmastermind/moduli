# Weekday templates — a THIRD layer, not a replacement for the cycle

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
