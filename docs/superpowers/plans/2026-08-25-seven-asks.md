# 2026-08-25 — live task queue

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked / needs you

| # | Ask | Status |
|---|-----|--------|
| 1 | Folder page previews stall — root folder stops at the Day Pages preview | `[x]` **fixed + A/B'd** |
| 2 | `Day Page: Build` throws `$col is not a record` on every load | `[x]` **fixed** — `0242` applied, 0 errors on a real load |
| 3 | Instance label + input/display fields bigger; filter date pill bigger; all fields one size | `[x]` **done + measured on screen** |
| 4 | Movie tiles: label → image → fields stacked; images not loading; placeholder box squished | `[ ]` |
| 5 | Container fields too big — must match instance field size everywhere | `[x]` **done** — one authority for every field text site |
| 6 | Pages in the Music folder that do not belong (movies, tv shows) | `[ ]` |
| 7 | Folder card: a button opens the folder page; clicking the card expands children | `[ ]` |
| 8 | Delete the Schedule Canvas page and its op | `[ ]` |
| 9 | The `Now` tracker tile lost its time fields — current time + time left | `[ ]` not started |
| 10 | Toggling the `Completed` field true/false has a strong lag | `[ ]` not started |

---

## 2 — `Day Page: Build` throws (ROOT-CAUSED)

`Day Page: Build` step `halYDuDf1LzS` is `UPDATE $col.meta.appliedFromTemplateId`.
`$col` comes from

```
FIND over $allOccurrences
     parentId IS 8gpoqzx32h7            (the Day Page board)
     fields.Eh7oi4HKdbHB.value SAME_DAY $day
  -> itemIdVar $colId  itemVar $col
```

A multi-match FIND binds an ARRAY and `UPDATE` refuses it — the same class as `0240`.
**And the grid really does hold duplicates**, measured on poms grid:

```
2026-07-28 .. 2026-08-23   x1 each      22 dates, all clean
2026-08-24                 x3   created 11:30:22 / 11:30:58 / 11:31:01
2026-08-25                 x3   created 14:34:09 / 14:34:53 / 14:35:11 (UTC)
```

All six carry a correct `{"value":"2026-08-25","flow":"in"}` date and `parentId` = the board,
so the FIND *should* have matched the earlier one. Both bursts land inside a ~60s window on days
this repo was being deployed/pm2-restarted, which is the 2026-08-20 truncated-burst shape.
**Cause of the DUPLICATION is not yet established — the throw is.**


---

## 1 — the preview walk was scanning the WHOLE GRID, per card (FIXED)

`PagePreviewBody` collected each card's subtree with a fixpoint scan repeated until
nothing new was added:

```js
let changed = true;
while (changed) {
  changed = false;
  for (const occ of allOccurrences) {            // <- all 19,966, every pass
    if (occ.parentId && seen.has(occ.parentId)) { seen.add(occ.id); changed = true; }
  }
}
```

O(all occurrences x depth) **per card**, plus a `buildLookup` over the same array per card.
**Its own comment names the grid it was written for: "the 720-occurrence parent grid".**
The media import took that to 19,966.

`helpers/previewSubtreeIndex.js` (NEW) builds ONE `parentId -> children` index per
occurrences array (WeakMap on the array — the reducer swaps it on every write, so array
identity IS the version) and walks the subtree instead of the grid.

**A/B over every folder-page card on poms grid, real data:**
```
cards checked   519
mismatches        0
old            1733ms
new              15ms      115x
```

**THE OBVIOUS VERSION WAS WRONG AND THE EQUIVALENCE CHECK CAUGHT IT.** One worklist
expanding both edges from every node is not what the old code computed — it expanded
`occurrences[]` from the ROOT only, never from folder-seeded nodes. On the root folder that
returned **1564 ids where the old walk returned 1193**: 371 extra containers, i.e. every
card quietly rendering a third more of the grid. The phases stay separate, and the test that
fails if they are merged again is the discriminating one.

11 tests, four mutations A/B'd — merged phases (1 fail), dropped parentId closure (3),
`seen.add` after the lookup (1), no WeakMap reuse (1).

**AND A SECOND, SEPARATE STALL, found by reading rather than measuring.**
`previewAdmission.pump()` calls `next.cb()` and then `pump()`. If `cb` throws, the trailing
`pump()` never runs while `running` is already false — so nothing re-pumps and **every card
behind the thrower waits forever**, which is exactly "it stops". Guarded with `finally`;
A/B'd (reverting fails that one test). Nobody has watched it fire — it is guarded because it
is the one exit that parks the queue permanently.

**Measured and NOT the cause, recorded so nobody re-hunts them:** occurrence count is
**stable at 19,966** across 24s of idle (nothing is being created — no data corruption), and
the DOM growth converges (+286, +203, +123, +109, +49, +8 per 3s) — that is the lazy mount
and render-window filling in, not a leak.


---

## 2 — duplicate day columns (FIXED, `0242` applied)

`UPDATE $col.meta.appliedFromTemplateId` threw because the op's own existence FIND
matched THREE columns for one date and a multi-match FIND binds an array. The `0240`
class — the executor refusing is correct, so the data was the defect.

```
2026-07-28 .. 2026-08-23   x1 each   clean
2026-08-24                 x3   -> 1   keeper 3aa482c4
2026-08-25                 x3   -> 1   keeper 2dcc42f8 (the only one that reached ADD_CHILD of Todo)
```

**All six held ZERO characters of writing**, measured at full depth through
`decompressTextmap` (a raw scan reports "no text" for everything — the `0032` rule), and
the guard re-runs at apply time and refuses the whole group if any loser holds a single
character. Keeper is structural: listed by the board, then most children, then earliest.

**The Emotions Wheel was UNLISTED, not deleted** — it is one occurrence multi-parented into
every day column, and the reachability test excludes the doomed subtree from the set of
possible other parents, which is the exact check `0080` got wrong.

Dry run predicted `delete 32 / unlist 1 / drop 4`, matching the derived expectation
(9+8+8+8 nodes = 33, minus the shared wheel). Applied; read back out of Mongo: one column
per date, **poms grid 0 errors**, 18 orphan modules swept (dump kept).
**Verified on a real hydrated load: `operationExecutor errors: 0`.**

**NOT established, and deliberately not guessed at:** what created the duplicates. Both
bursts land in ~60s windows on days this repo was deploying and pm2-restarting (the
2026-08-20 truncated-burst shape). The population is self-limiting — once two exist the
FIND binds an array and the mint branch never runs again — so this was a bounded mess, not
a growing race. A `duplicate-day-column` integrity rule is the honest follow-up and is NOT
yet written.

## 3 + 5 — one size for every field (code done, NOT yet visible)

The divergence was `compact`: `ModuleInstance` renders fields with `compact={true}` and
`ModuleContainer` does not, and the compact branches picked 10/11 where the full ones
picked 12/13 — so the same field read at four sizes depending on where it sat.

- `FIELD_FONT_PX` stays **13** but now every site uses it: 3 `compact ? 10 : 11` /
  `compact ? 11 : 12` ternaries and 29 inline `12`s routed through it. `compact` governs
  the BOX only, never the type size.
- `FILTER_FONT_PX` 12 -> **13**.
- `INSTANCE_LABEL_PX` **17**, a NEW constant read by both the rendered label and the inline
  edit box — the file's own comment said they must match and it was the same literal twice.

All one step, per *"when i say bigger, i mean one size bigger"*.

**AND THE FIRST PASS DID NOTHING AT ALL, WHICH IS THE ACTUAL FINDING.** Measured after
changing the constants: field text still **12px**, label **15px** — not even the 16 its own
inline style asked for. Two stylesheet rules were the real authority, and both are
Stardew/Blueprint only, which is why this only ever went wrong on the skin the user runs:

```
:root[data-skin="stardew"] .instance-content .auto-marquee-inner { font-size: 15px }
:root[data-skin="stardew"] .field-display *, .field-input *      { font-size: 12px !important }
```

1. **The marquee rule was not the label.** `.auto-marquee-inner` matches ANY marquee'd text
   in an instance row — field text included — so a field that happened to OVERFLOW rendered
   15px while the identical field that fit rendered 13px. Same field, two sizes, decided by
   string length. It was written as the label bump; the label is sized in JS now, so it is
   retired with the reasoning left in its place.
2. **The `!important` rule beat the constant outright.** It is kept — those pill children
   carry their own explicit sizes and nothing else reaches them — but it now reads
   `var(--field-font-px)`, published by `App` from `FIELD_FONT_PX` exactly the way
   `--grid-surface-a` is published from `SURFACE_ALPHA`. One number instead of two that have
   to be remembered as equal.

Also found: the date pill's 12 lives on `NavPickerPopover`'s trigger, not in
`FILTER_FONT_PX` at all — a third place. Now 13, with `HeaderChevron`'s active-filter pill.

**Measured on screen, before -> after:**
```
instance field text   12px (169 sites)  ->  13px      uniform
instance label        15px              ->  17px      declared 17, painted 15 before
date pill             12px              ->  13px
```
The 16 remaining 12px readings inside instance rows are the `alt` text of the broken movie
posters — not fields. That is item 4.
