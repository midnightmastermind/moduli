# 2026-08-25 — live task queue

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked / needs you

| # | Ask | Status |
|---|-----|--------|
| 1 | Folder page previews stall — root folder stops at the Day Pages preview | `[x]` **fixed + A/B'd** |
| 2 | `Day Page: Build` throws `$col is not a record` on every load | `[x]` **fixed** — `0242` applied, 0 errors on a real load |
| 3 | Instance label + input/display fields bigger; filter date pill bigger; all fields one size | `[x]` **done + measured on screen** |
| 4 | Picture row: **picture → label → fields** stacked; placeholder no longer squished | `[x]` **done** — layout + `0245` TMDB posters (1172/1180) + `0246` each poster is a real file the row owns |
| 5 | Container fields too big — must match instance field size everywhere | `[x]` **done** — one authority for every field text site |
| 6 | Pages in the Music folder that do not belong (movies, tv shows) | `[x]` **done** — `0244` |
| 7 | Folder card: a button opens the folder page; clicking the card expands children | `[ ]` |
| 8 | Delete the Schedule Canvas page and its op | `[x]` **done** — `0247` applied; there was no op left to delete |
| 9 | The `Now` tracker tile lost its time fields — current time + time left | `[ ]` not started |
| 10 | Toggling the `Completed` field true/false has a strong lag | `[ ]` not started |
| 11 | Infinite loop — Trackers folder inside Trackers, all the way down | `[x]` **fixed** — `0243` + renderer + mint latch |
| 12 | Auto-marquee off in preview cards · container labels a size smaller · instance-label marquee | `[x]` **done** |
| 13 | Media tiles: a **max width**, laid out as a **row that wraps** | `[ ]` not started |

---

## 4 (continued) — "make it have the fileRef" · "it should able to hold multiple files"

`0245` put each poster on the OCCURRENCE as `meta.cover`, which draws the card. The follow-up
ask was for a real file, and for a row that can hold more than one.

**`fileRef` CANNOT GO ON THE ROW, and that is the whole shape of `0246`.** `fileRef` lives on the
MODULE, and `0238` mints **one shared module per kind** — measured: 993 movie occurrences,
**`movie: 1` module**. Writing the poster there gives all 993 films the same picture: the exact
trap `0245` already hit one level up with `meta.cover`.

So the poster becomes its OWN artifact — a module with a real `fileRef` plus an occurrence of it,
**parented to the row AND listed in the row's `occurrences[]`**. That answers both halves at once.

**Why a child rather than the `Files` field.** `occurrenceMedia.filesOf` collects from THREE
sources — the media field, the `Files` field, and `occ.occurrences`. The child list needs no
field, no binding and no `role:"files"` plumbing on a shared module, and it is already how `0061`
attached a favicon to a bookmark: *"parented to the bookmark AND listed in its `occurrences[]` …
An instance does not render its children, so it stays out of the row while appearing in the
bookmark's own file spread."* Adding a second poster later is one more child.

**Both edges matter.** The delete cascade walks the child LIST, so a parented-only poster is
orphaned the moment the row goes; a listed-only one has no home.

**The card face is deliberately unchanged.** `meta.cover` still draws the thumbnail;
`primaryMediaOf` reads the media-role BINDING, not children, so clearing the cover here would
blank 1,172 cards to buy nothing. The cover is the face, the child is the file.

**Read back out of Mongo, not off the log:**
```
poster modules 1172   all with an https://image.tmdb.org fileRef   all role:artifact kind:image
poster occurrences 1172   parented 1172 · listed by that parent 1172 · BOTH 1172
covered rows with no artifact child   0
rows owning MORE than one poster      0      <- a double-run would show here
```
A forced re-run plans **0**. poms grid **0 errors**, 1 pre-existing `unused-field` warning.

**Verified in a browser, which is the check that matters here:** on the live grid, 80 movie rows
on screen, **80 TMDB images, all 80 loaded**, `1` artifact card per row, and **0 of the 1,172
poster occurrences render as a row anywhere** — attached and invisible, exactly as `0061`
predicted. 0 page errors. The row draws picture → label → fields.

7 planner tests, **4 A/Bs, every mutation asserted to LAND first** — dropping the already-owns
guard, dropping the no-cover refusal, counting any child rather than an artifact child, and
preferring the shared module's label each fail EXACTLY one test.

**The 8 rows with no poster keep none** — comedy specials, lecture series and one `_FAILED_`
download name. TMDB does not have them, and an empty file is worse than no file.

**No client code changed, so no bundle is owed** (the `git diff --name-only` rule); pm2 was
restarted because the warm cache is authoritative for reads.

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


---

## 11 — a folder page listed ITSELF, endlessly (FIXED)

User: *"we have an infinite loop going with trackers. theres a trackers folder with trackers
inside the trackers folder and its like that all the way down."*

`ModulePage.folderChildOccs` excluded the folder's own card with
`occ.id === occurrence.id` — **a SINGLE-ID check**. A folder's card IS a
`role:"page" kind:"folder"` occurrence parented to that folder, so with TWO of them page A
excludes A and renders B; clicking B opens the same folder, which excludes B and renders A.
Every level looks legitimate.

```
poms grid   70 folders · 31 folder-page occurrences · 8 folders with TWO
  Day Pages · Library · Files · Interests · Lookup · Projects · Trackers · Documents
  every pair created 14:35:01 and 14:35:12 — 11 seconds apart
test grid 1  0     test grid 2  0     contrast scratch  0
```

Same 14:35 window as `0242`'s duplicate day columns. `ensureFolderPageOcc` decides "does one
exist" from the occurrence map it is HANDED, so two callers resolving that map before either
write lands both mint — two panels on one folder page do it in a single commit.

**All three halves ship, because none is sufficient alone:**
- `0243` removes the 8 duplicates (all empty; refuses any copy holding children, listed
  elsewhere, carrying text, or named by an operation). Applied — 0 duplicates, poms grid
  **0 errors**, 8 orphan modules swept.
- `ensureFolderPageOcc` gains a per-folder/per-grid latch, closing the same-tick window.
  A/B'd: removing it fails exactly the same-tick test.
- **`folderChildOccs` now drops folder pages of its OWN folder by KIND, not by id** — the
  durable one. A duplicate that arrives from another tab can no longer loop.

## 6 — Movies/TV/Games/Comics were filed under Music (FIXED, `0244`)

`0238` parented all five new boards beside the Spotify boards. Now:

```
Root/Boards/Media        Bookmarks · Movies · TV Series · Games · Comics
Root/Boards/Media/Music  Songs · Artists · Albums
```

Only `parentId` moves — rows hang off the board CONTAINER, so nothing else changes. No
folder invented and `Music` not renamed: the ask was about misfiled pages, not a taxonomy.


---

## 12 + 4 — the field strip was floating OVER the title (FIXED)

The marquee complaint and the movie-tile complaint were **one defect**.

`.instance-fields--under-body` is `position: absolute`, applied whenever a row `renderBody`. Its
own comment says what the float is for — 2026-08-10, *"make sure anything without a heading
(textblocks) shows up in the top right"*: a body-rendered card with **no heading** has no label row
for the fields to sit under. The gate was `renderBody` alone, which is true for any row carrying a
body **including one that also has a label**. A Movies row is exactly that — a title AND a poster.

```
.instance-label               left 123 -> right 271   (box 247, text 245)
.instance-fields--under-body  left 196 -> right 334   position: absolute
                                       ^^^ 75px of overlap
```

Being absolute it is OUT OF FLOW, so the label never learned it had less room and never shrank —
**which is also why it never marqueed.** AutoMarquee measured 245px of text in a 247px box,
correctly found no overflow, and stayed static. The label was never clipped; it was painted
underneath the pills. Two symptoms, one cause.

`fieldsFloatTopRight = renderBody && !labelRowRendered`, where `labelRowRendered` mirrors the
label's own render gate rather than restating it. Verified on the real row: strip
`absolute -> static`, label 986–1001, strip 1052–1102, vertically separated.

**And the row now stacks picture → title → fields** (`order: -1` on the body, scoped by
`:has(> .artifact-card)` so a textblock's prose still sits BELOW its title). The width half is the
squashed-placeholder report: `.instance-body` carries an inline `flex: 1` which in a COLUMN sets
the HEIGHT, so the card shrank to its content — and with an unloaded poster "its content" is the
alt text. Measured **27px -> 343px**.

**STILL NOT FIXED, and it is data not layout:** the posters do not load because the media.md import
carries no cover art (the same gap the Spotify and Calibre imports have). The box is now the right
shape for one. Fetching covers is the `0201` bookmark-cover job, one board over.

---

## 8 — the Schedule Canvas goes, and "the op for it" was already gone (`0247`)

User: *"you can get rid of the schedule canvas and the op for it btw"*

**THERE IS NO OP, AND THE SEED SAYS SO IN ITS OWN COMMENT.** `Canvas: Build` was retired on
2026-07-07 in favour of an occurrence FEED. Measured rather than trusted — on poms grid **no
operation mentions the canvas at all**:

```
"Schedule Canvas" -> (none)     z9lntG03zNIP -> (none)
module 9ROzuzrNcw7Q -> (none)   any of its 29 children -> (none)
```

So the thing that still RAN for this page was the `feed`, and a feed is a FIELD ON the occurrence.
**Deleting the page deleted the op.** Worth stating plainly, because hunting for an Operation
record and finding none reads exactly like a missed step.

**DELETING 29 CHILDREN DESTROYS NOTHING, and that is measured on both edges:**
```
parented children 29   feed copies 29   NOT copies 0
sources outside the canvas 29   inside 0   missing 0
copies having children 0
copies whose fields MATCH their source exactly   29 / 29
```

**AND THAT LAST ZERO ONLY MEANT SOMETHING ONCE THE PROBE WAS SHOWN REPORTING NON-ZERO.**
Comparing each copy to its own source read "0 differ", and so did the Schedule Table control —
both arms zero is the documented tell. Re-run with each copy paired against the NEXT copy's
source: **27 differ**. The comparator works, so the 29/29 is a finding rather than a blind spot.

**IT REFUSES RATHER THAN ORPHANS.** A child that is not a feed copy is something a person put
there, and deleting the page under it would strand it — so the migration refuses the whole
removal and reports. Zero such children exist today; the guard is for the next grid.

**BOTH PANELS ARE UNLISTED, AND NEITHER IS LEFT EMPTY** — Panel C 17 -> 16, Panel D 4 -> 3. The
unlist is a `$pull`, not a whole-array write: a read-modify-write on `occurrences[]` is exactly
what a connected client's stale echo clobbers (2026-08-13 (2)).

**AN A/B RETIRED A GUARD I WROTE ON REFLEX.** `orphanModuleId = placements === 1 ? ... : null`
fails **0 of 11** tests when removed — it is provably subsumed, since any second placement of that
module is itself a `page/canvas` labelled "Schedule Canvas" and the ambiguity refusal returns
first. Gone, with the reasoning left in its place. The other five mutations each fail exactly
their own tests (dropping the feed-copy refusal fails 2 — it also disables the `else` branch that
catches a source living inside the canvas, which is the honest explanation rather than a flaw).

**Read back out of Mongo, not off the log:**
```
canvas occurrence / module   gone      children still parented   0     anyone still listing it   none
Panel C 16 · Panel D 3       dangling ids 0 / 0
sources of the deleted copies   29/29 still present
Schedule Table untouched     29 children
```
poms grid **0 errors**, 1 pre-existing `unused-field` warning. 1,678 server tests.

**THE SEED HALF SHIPS IN THE SAME PASS** — `createLiveData.js` minted the page, its feed and a
panel pin, so migrating alone would let a reseeded grid mint it straight back (the `0043`/`0064`
drift rule). Three stale summary lines that still advertised `Schedule Canvas: Build` went with
it. **No client code changed, so no bundle is owed;** pm2 restarted, since the warm cache is
authoritative for reads.
