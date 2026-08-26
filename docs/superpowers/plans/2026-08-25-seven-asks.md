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
| 7 | Folder card: a button opens the folder page; clicking the card expands children | `[x]` **done** — both folder rows |
| 8 | Delete the Schedule Canvas page and its op | `[x]` **done** — `0247` applied; there was no op left to delete |
| 9 | The `Now` tracker tile lost its time fields — current time + time left | `[x]` **done** — `0249`; they were never minted on this grid |
| 10 | Toggling the `Completed` field true/false has a strong lag | `[x]` **fixed** — the tick paints in ~30ms (was ~2333ms); ops run after |
| 11 | Infinite loop — Trackers folder inside Trackers, all the way down | `[x]` **fixed** — `0243` + renderer + mint latch |
| 12 | Auto-marquee off in preview cards · container labels a size smaller · instance-label marquee | `[x]` **done** |
| 13 | Media tiles: max width, row+wrap; **same size as trackers**; Games+Comics tiled too | `[x]` `0248`+`0250`+`0251` — see the height note under 13c |

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

---

## 13 — the media boards become poster tiles, and `childMaxWidth` was INERT

User: *"could you also make the media tiles have a max width and layout row with wrap"*

**THE MECHANISM ALREADY EXISTED — `mode: "wrap"` has laid children out as a wrapping row of
tiles since 2026-08-10**, driven by the same layout cascade the Layout menu edits. So this is a
DATA change plus one real code gap, not a new feature.

**WHICH BOARDS IS A MEASUREMENT, AND `0245` CHANGED THE ANSWER.** 2026-08-25 refused to tile the
music and book boards on a rule worth keeping — *"a tile with no picture is a taller row"*. The
TMDB posters changed that fact for exactly two boards. Re-measured counting a picture through
**every** route that can draw one (occurrence `meta.cover`, module `meta.cover`, module
`fileRef`, an artifact CHILD carrying one — `0246`'s shape — and a media-role field value):
```
Movies      993   989 pictured  100%   <- tiled
TV Series   187   183            98%   <- tiled
Games         4     0             0%   <- REFUSED
Comics        5     0             0%   <- REFUSED
Songs      5489     5             0%   ·  Albums 3027  0%  ·  Artists 1679  0%  ·  Books 877  0%
```
**Games and Comics are the discriminating case.** Same import, same `0238` mint, same folder,
and the word "media" describes them perfectly — but TMDB is a film/TV database, so neither has a
poster. Selecting on the WORD would have turned 9 rows into empty boxes; selecting on PICTURES
does not. The selector is structural (media KIND + measured coverage), so a rename cannot break
it and a board that gains art later qualifies on its next run.

**AND `childMaxWidth` WAS AN INERT KEY — the ask names the exact gap.** It is a declared cascade
key, the Layout menu offers it as "Col max width", and **only `PageBoard` ever read it**: set it
on a container's wrap tiles and nothing moved. `ModuleContainer` publishes `--child-max-w` now.
Its default is `100%` rather than the fixed `--child-w`, which also fixes a case nobody had
configured around — a 150px tile inside a narrower panel column used to OVERFLOW it instead of
shrinking. That default is what makes "max width" true at every panel width.

**REPORTED, NOT DONE — Bookmarks.** All 1,467 carry a `meta.cover`, so by coverage alone the
board qualifies. It is not a media-import kind, it was not what the ask named, and 2026-08-23
measured those covers as mostly FAVICONS — "a wall of favicons" reads very differently at tile
size than a poster does. Reshaping a 1,467-row board nobody mentioned is the user's call.

Every number (`childMinWidth` 150 · `childMaxWidth` 150 · `childMaxHeight` 320 · `childGap` 10)
is a cascade key the Layout menu already edits, written to `meta.layoutCascadeOverride` — the
slot `0237` used — and MERGED over whatever the board already carries, so a re-run is a no-op.

10 tests, 5 A/Bs each failing exactly its own cases — dropping the coverage gate (2), the
media-kind gate (1), counting `meta.cover` only (2), the min-rows floor (1), replacing instead
of merging (1). 3,330 client tests pass; **the 8 failures in `weekdayTasks` + `trackerFollowsPageFilter`
are PRE-EXISTING and A/B'd against stashed source this session — identical 8.**

---

## 9 — the `Now` tile gets its clock back, and nothing had been deleted (`0249`)

User: *"what happened to my time fields as well"* / *"those are gone from the now tracker tile"* /
*"like current time"* / *"and time left"*

**NOTHING WAS DELETED — THEY WERE NEVER MINTED ON THIS GRID, and the contrast with a fresh grid
is the whole diagnosis:**
```
test grid 2   183 fields   carrying meta.liveSource: 2   "Now" · "Time Left"
poms grid     290 fields   carrying meta.liveSource: 0   <- none, at all
```
The seed authors two LIVE-CLOCK fields and binds both to the `Now` module. poms grid's `Now`
(`sUy5zKLg9O31`) is **not the seed's** — it was minted by the 2026-07-30 Stats restructure — and
carried only the two bindings later passes gave every tracker tile (`Category`, and `Tracker
Date` from `0072`). So it has been a `Now` with no time in it since the day it was made. A
migration was owed, not a repair.

**THEY ARE NOT INERT, AND THAT WAS CHECKED BEFORE MINTING ANYTHING** — a field carrying a key
nothing reads is this repo's most-repeated defect. `Field.jsx:497 useLiveFieldValue` implements
both sources, ticks on a `setInterval` (1s, or 30s at "minutes" granularity) and overrides the
displayed value with no operation, no socket write and no stored value.

**RESOLVED BY `meta.liveSource`, NOT BY NAME** — the field is called "Now", and so are the module
and the occurrence. A decoy field named "Now" carrying no `liveSource` satisfies nothing, which
is its own test.

**THE CLOCK BINDS FIRST AND THE EXISTING BINDINGS SURVIVE.** Binding order is render order and
the clock is what the tile is FOR, so it takes orders 0 and 1 — but `Category` and `Tracker Date`
shift down rather than being replaced: *an instruction about two fields is not permission to drop
the others*. A clock field the tile somehow already had is never double-bound.

10 tests, 6 A/Bs each failing its own cases — resolving by name (1), dropping the ambiguity
refusal (1), replacing instead of keeping bindings (2), appending the clock last (3), skipping the
dedupe (1), minting the clock as an INPUT field (1).

**Read back out of Mongo:** poms grid now matches a fresh grid — 2 `liveSource` fields, both bound
to `Now`, 4 bindings total. **And verified TICKING on the live grid, which is the check that
matters**, behind a control proving the probe can see anything at all:
```
control  80 instance labels on screen
Now         2:41:15 PM  ->  2:41:18 PM     counting up
Time Left   09:18:44    ->  09:18:41       counting down
Tracker Date  Aug 25 · today                preserved
0 page errors
```
**My first probe read `labels: []` and that was the probe** — I had restarted pm2 seconds earlier,
so the load hit the cold Atlas read. A zero is a claim about the probe until it has been shown
reporting non-zero.

**No client code changed, so no bundle is owed;** pm2 restarted, since the warm cache is
authoritative for reads.

---

## 7 — the folder pill expands; a button opens the page

User: *"we should make a button on the folders that opens up that folder page instead of clicking
the full thing. clicking on it should go back to expanding the children again."*

**IT WAS EXACTLY INVERTED.** In the tree, the whole folder pill called `handleFolderClick` (open
the folder page) while expansion lived on a **chevron 8px wide at 0.35 opacity** — so the common
action was a pixel-hunt and the rare one fired on any stray click.

Now the pill toggles and a `Layout` button opens the page. **A folder with NO children falls back
to opening the page**: there is nothing to expand, its chevron is hidden by `hasChildren`, and a
click that visibly does nothing reads as broken.

**THE BUTTON IS ALWAYS VISIBLE, unlike the `+` beside it** — it is now the ONLY route to a folder
page, and a hover-only control is unreachable on a touch device. The `+` stays hover-gated because
it is a secondary action with other routes.

**BOTH folder rows changed, not just the obvious one.** `LocalFolderGroup` (the Pinned section
header) has its own copy of this handler, and its own comment says it *"mirrors
FolderNode.handleFolderClick so the local tree behaves the same as the root tree"*. Two folder rows
behaving differently is worse than either behaviour on its own.

---

## 10 — the `Completed` lag: MEASURED and ROOT-CAUSED, deliberately NOT fixed

User: *"hitting the completed field and switching it to true or false has a very strong lag to it"*

**REPRODUCED ON THE LIVE GRID, and it is worse than it sounds:**
```
click -> paint        4117ms / 6425ms
total blocked         6653ms / 6055ms
long tasks            104, summing 10547ms — ONE of 3605ms, then ~103 of 60-200ms
DOM mutations         4163, for toggling one checkbox
```

**THE TRIGGER LAYER IS ALREADY CORRECT — that was the first suspect and it is exonerated.**
Every `onChange` trigger on the grid is field-scoped, and **zero** ops fire without a target:
```
27  field:Completed      7  field:Amount      4  field:Duration      3  field:Protein …
 0  NO TARGET -> fires on every field change
```
So the 27 ops that run are exactly the 27 that declare an interest in `Completed`. They are
legitimate work — every tracker that counts completed things must recompute — and they are **only
1225ms of the ~6500ms**. Roughly 80% of the cost is NOT operations.

**WHERE IT ACTUALLY GOES — mutations attributed by panel:**
```
mounted: 148 instance rows · 80 TMDB images · 3 panels
toggling ONE checkbox in panel U18hAEwP mutates
   U18hAEwP  2337     <- the panel that owns the row
   _PkuNAJp  1458     <- an unrelated panel
   u07qnz_n  1123     <- another unrelated panel
```
**52% of the work happens in panels that have nothing to do with the row.** This is the documented
"frame-1 storm" / app-wide re-render docket item (2026-08-07: *"every occurrence write still pays
it"*), now with numbers — and the media import made it materially worse, because an open media
board keeps 80 image tiles mounted that re-render on every unrelated write.

**NOT FIXED, AND THAT IS DELIBERATE.** A real fix is batching effect application into one commit
and cutting the cross-panel render fan-out — a change to the shared write path this repo has
"repeatedly been damaged by", which wants its own reviewed pass with A/Bs rather than the tail of a
long session. The next probe to run is render attribution (`window.__RENDER_ATTR`, already in
`helpers/renderProbe.js`) to name which components re-render in the unrelated panels.

**PROBE DEBRIS, REPORTED NOT HIDDEN:** the first measurement ticked two live schedule rows
(`Hygiene` 7:30am and `Drink` 6:00am) because the untick re-queried the DOM after a re-render and
found a *different* switch. Both were put back through the UI so the tracker ops reversed, and read
back out of Mongo: `Completed=false`, `Completed On=null` on both. *A probe that edits is a probe
that can damage.*

---

## 10 (continued) — one toggle did O(grid) work 51 times, and that is now gone

**THE CHAIN, MEASURED END TO END.** One `Completed` toggle on poms grid:
```
outbound  26 update_occurrence
inbound  127 frames — 76 transaction_created · 26 occurrence_persisted · 25 occurrence_updated
           of the transaction_created: MeasureOp 51 · SnapshotOp 27
spread over 3699ms .. 10468ms
```

**AND EVERY ONE OF THOSE 51 MeasureOps RAN THE TOAST BLOCK, which is O(GRID).** Before it knew
whether a toast would even be shown it built `fieldsById`, `modulesById` (**6,557** modules), a
**full 21,000-key spread** of `occurrencesById`, and a **21,000-occurrence parent reverse map** —
millions of operations and 51 large short-lived objects of GC churn, per click.

**The handler's own comment had already diagnosed it** — the `SnapshotOp` early-return above it
says in as many words that *"the toast machinery below is O(grid) per transaction … that work
would run on every keystroke-debounced doc save"*. MeasureOps simply went straight through it.

The lookups are LAZY now (built only when a toast is actually written), `fieldsById` and
`modulesById` are cached on **the identity of the array they came from** (the reducer swaps those
arrays on every write, so identity IS the version — `previewSubtreeIndex`'s trick), and the 21k
spread is **gone entirely**: it was only ever used for single-id lookups.

```
                  BEFORE          AFTER
click -> paint    4117ms          3468ms       -16%
long tasks        104 / 10547ms   33 / 9492ms  -68% by count
longest task      3605ms          3392ms       barely moved
DOM mutations     4163            3275         -21%
```

**SAID PLAINLY: THIS IS NOT THE FIX FOR THE COMPLAINT.** It removes real waste — two thirds of the
long tasks — and the user still waits ~3.5s. Offering the 68% as if it solved the lag would be a
lie.

**AND TWO OF MY OWN THEORIES DIED ON THE WAY, both by measurement rather than reasoning:**
- *"the 51 echoes each re-fire the op sweep"* — they do not. Instrumented: **2** sweeps per toggle,
  979ms + 102ms. The executor's cycle breaker already handles it.
- *"a hot-path component subscribes to a slice that churns"* — `ModuleInstance`, `ModuleContainer`,
  `Field`, `FieldRenderer` and `ArtifactCard` are all already on per-slice selectors, and the
  suspicious `s.getOccMap || (() => …)` fallbacks never fire because `App` provides a stable
  `useCallback([])` getter.

**WHAT IS ACTUALLY LEFT, named precisely for the next pass:** the longest task is ~3.4s of which
~1.1s is legitimate operations, so **~2.3s is React render + effect application in ONE synchronous
task**. The lead is `ModulePanel`, which subscribes to **`occurrencesById`** — rebuilt on every
occurrence write — so all three mounted panels re-render on each of the ~26 writes, which is what
put 52% of the DOM mutations in panels unrelated to the toggled row. It genuinely needs occurrence
data to render, so the fix is narrowing that subscription to the panel's own subtree (the shape
`previewSubtreeIndex` used for preview cards), not swapping in a non-reactive getter.

3 `byIdCached` tests + 3 strict toast tests — the label is asserted to still carry the module
label, the field name AND the walked parent chain, which is the positive control for the two
"pushes nothing" cases. Four A/Bs, each failing exactly one test.

---

## 13b — the media tiles take the HOUSE tile shape (`0250`), and Games + Comics join (`0251`)

User: *"make sure the media tiles are tiles though. same size as trackers"*, then *"games and
comics should be tiles too"*.

**THE SIZE IS READ OFF THE TRACKER TILES, NOT RESTATED.** `0248` used numbers I picked for a 2:3
poster (150 x 320), which made the media boards the only tiles on the grid with their own
dimensions. `0250` groups every wrap-mode container by its size keys and takes the largest group —
on poms grid that is the **15 `Today's …` tracker containers at `childMinWidth: 184`** (height and
gap unset, so the renderer's 200 / 8). **A media board cannot vote for its own shape**, or the two
being rewritten would elect themselves; that exclusion is its own test. It REFUSES if no shape has
a clear majority rather than guessing.

`childContentDirection: "column"` is deliberately NOT copied from the trackers — it is what stacks
picture -> title -> fields, and a tracker tile has no picture to put on top. The ask was size
parity, not composition parity.

**GAMES AND COMICS ARE TILED AT THE USER'S EXPLICIT INSTRUCTION (`0251`), overriding `0248`'s
measured refusal.** The concern was raised (`0/4` and `0/5` rows have cover art — TMDB is a film/TV
database) and the user's answer was explicit, so it is theirs. **The coverage rule is NOT deleted**:
`0251` names the two KINDS the user asked for rather than dropping the threshold, which would have
swept in Songs (5,489 rows) and Albums (3,027) with it.

**Verified on the live grid** — all four boards read `mode=wrap · w=184 · maxw=184 · h unset->200 ·
gap unset->8 · dir=column`, and the Movies board renders `flex-direction: row`, `flex-wrap: wrap`,
tiles measuring **184 x 200** with `max-width: 184px` — identical to the tracker tiles beside them.
0 page errors.

## 13c — the tile grows to fit its fields (`0252`)

At exact tracker size (184 x 200) a media tile showed **only a cropped poster**. Measured on the
live board:
```
tile height   200px        actual content   432px       overflow: hidden
poster        top  12,  h 218   -> clipped
title         top 261          -> below the cap, invisible
fields        top 288,  h 144  -> invisible (Owned · Drive · Size)
```
A tracker tile has no picture, so 200px holds its label and fields comfortably; a media tile's
poster alone is taller than the whole tile. And `overflow: hidden` sits on the tile, so the fields
could not be scrolled to either — **unreachable, not merely cramped.**

User: *"make it larger than to see the fields"*. `childMaxHeight` is now **440** — the tiles' own
rendered `scrollHeight` on the live Movies board (p90 and max both **432**) plus slack, so the
number is measured rather than picked. It is an ordinary cascade key the Layout menu edits.

**ONLY THE PICTURED BOARDS.** Games and Comics are tiled too (`0251`) but carry no cover art, so
their rows are title + fields and already fit the 200 the trackers use — raising them would leave
two boards of two-thirds-empty tiles. The split is `0248`'s coverage rule, IMPORTED rather than
restated so the two cannot disagree.

**Verified on the live grid** — 184 x 437, content 437 (nothing clipped), 2 per row, and the
screenshot shows the full poster, `John Wick`, and every field: `Owned · Drive: Odin ·
Size: 45.0 GB · File Path · Year · Board Category`. **0 page errors.**

**Not seen on screen:** Games and Comics. Their tree rows were not reachable from the Media folder
under Boards, so their tiling is confirmed in the DATA (`mode=wrap · w=184`) and has not been
looked at. Their rows carry no picture, so they compose exactly like a tracker tile.

---

## 10 (final) — the tick paints in a third less time, and TWO of my own conclusions were wrong

**THE REAL COST WAS THE CLICK'S SYNCHRONOUS PATH.** `setOccurrenceFieldValue` dispatches the
optimistic value and then calls `fireOperations` **synchronously**, so the browser cannot paint the
tick until every matching operation has run. Deferring past the paint is what
`helpers/afterPaint.js` was built for (the textblock mint went 1000ms -> 30ms the same way).

**MEASURED LIKE-FOR-LIKE, four runs each on ONE row:**
```
no deferral        paint 3333ms · longest 3308ms · ops 79/3040ms · blocked ~6800ms
top-level only     paint 3403ms · longest 3269ms · ops 80/2999ms · blocked ~7300ms
nested too         paint 2333ms · longest 2296ms · ops 80/3018ms · blocked ~6600ms
```
So the win comes from deferring the **nested** fires, and gating on `_fireDepth === 0` buys
nothing.

**MISTAKE 1 — I REVERTED THIS ON A CROSS-ROW COMPARISON.** I measured "30 sweeps / 2047ms" without
the deferral and "80 / 3108ms" with it, concluded the deferral tripled the work, and reverted. The
two numbers were taken on **different rows** — a cheaper row simply fires fewer operations. On one
row the op count is unchanged (79 vs 80). *A before/after is a claim about the change only if both
halves ran against the same thing.*

**MISTAKE 2 — MY DEPTH-CAP TEST WAS VACUOUS, and the A/B is the only reason I know.** Deferring
nested fires is exactly what makes it unsafe: `_fireDepth` is incremented synchronously around each
fire, so a deferred nested fire restarts at 0 and `_FIRE_DEPTH_LIMIT` can never accumulate — a
self-triggering op spins forever in separate tasks instead of tripping the guard. The deferral now
saves and restores the depth. My first test of that asserted `fired.length < 40` and **passed
against the broken version**. Measured through the real handler:
```
depth CARRIED   -> 8    exactly _FIRE_DEPTH_LIMIT, the cap tripping
depth RESET     -> 23   and still climbing
```
It asserts `<= 10` now and fails against both mutations (dropping the depth carry, and dropping the
deferral).

**WHAT IS LEFT, unchanged:** ~3.0s of operation time still runs, now off the click's critical path.
The next lever is the ~80 sweeps a single toggle provokes — most of them driven by server echoes
rather than by the write itself — and batching those is its own pass.

**Probe debris: none.** Every toggle was reverted by occurrence id and read back: **0 rows carry
`Completed = true`** out of 2,389 occurrences touched in the last six hours. Two rows an earlier
probe stranded (`Hygiene`, `Drink`) were reverted the same way. poms grid **0 errors**.

---

## 10 (fixed) — the tick paints in 30ms, because the CONTROL now repaints before the write

User: *"even if it does, it should mark the toggle as complete before running the ops"* — and they
were right, it did not.

**WHY MOVING THE OPS OFF THE CLICK WAS NOT ENOUGH.** `Field.handleChange` sets the control's LOCAL
state, so the switch is ready to paint immediately. But React batches that setState with
`FieldRenderer.handleCommit`'s store dispatch, and that dispatch re-renders the app — so the
browser still could not paint the tick until the re-render finished. Deferring the OPERATIONS
(the previous pass) took the sweep off the critical path and left this behind:
```
before   switch flips with the batch · first paint 2333ms
after    switch flips at 1ms         · first paint 28-32ms
```

`handleCommit` defers its body past the paint now. The control repaints from its own state, then
the occurrence write and its operation cascade run a frame later. `afterPaint` is FIFO, so writes
are not reordered.

**UNDO IS UNAFFECTED, and that was the thing worth checking rather than assuming.**
`CommitHelpers.updateOccurrence` opens its OWN scope via `withAction`, so the action id is minted
when the deferred write runs and still groups that write with its whole cascade into one undo step.
An AMBIENT scope would have been lost across the deferral and the write recorded as `derived` —
i.e. silently un-undoable.

**AND MY OWN EDIT HAD THE TDZ TRAP THIS REPO ALREADY RECORDS.** `handleCommit`'s dep array named
`_commitNow`, which was declared below it — and a `useCallback` dep array is evaluated at RENDER
time, so it throws before the callback ever runs. `no-undef` cannot see it (the const exists).
Reordered so `_commitNow` is declared first.

**VERIFIED END TO END ON THE LIVE GRID — the deferred write still lands AND still fires its ops:**
```
tick    "Walk"  ->  Completed = true   ·  Completed On = "2026-08-25"   <- the op stamped it
untick  "Walk"  ->  Completed = false  ·  Completed On = null           <- the else branch fired
```
3 runs, 0 page errors, and the row was restored by occurrence id.

**WHAT REMAINS:** ~3.0s of operation work per toggle, now entirely off the critical path — the
grid keeps responding while it runs. Attributed for the next pass: **80 sweeps per toggle, 52 at
depth 1 and 28 at depth 2**, so the depth-1 fires (echo-driven, one per occurrence the cascade
writes) are where a batching pass should start.

---

## 10 (verified) — the deferral checked across field types, and the remainder re-measured

**THE DEFERRAL APPLIES TO EVERY FIELD, not just the checkbox, so it was verified that way** — a
commit that silently stopped landing for text or number fields would be a far worse bug than the
lag it fixed. Driven on the live grid and read back out of Mongo each time:
```
boolean  "Walk"   tick   -> Completed = true  · Completed On = "2026-08-25"   (the op stamped it)
                  untick -> Completed = false · Completed On = null           (the else branch)
text     "Drive"  edit   -> "Odin" -> "OdinPROBE"  persisted, then restored to "Odin"
click-to-edit still opens an input · 0 page errors throughout
```

**AND THE REMAINING COST IS RE-MEASURED, because my earlier filing was wrong about its shape.** I
had filed it as "~80 sweeps per toggle, batch them". Attributed properly:
```
52 depth-1 fires · 51 of them emit NOTHING and cost ~30ms in total
 1 sweep does the real work: 27 ops, 71 effects, 1514ms
 5 redundant runs of `Schedule: Place Dated Work`, ~110ms each, 0 effects every time
```
So the sweep COUNT was never the cost — one sweep is. **Batching the fires would have bought
~30ms.** The real targets, in order:

1. **`Schedule: Place Dated Work` runs 5x per toggle for nothing** (~550ms). It triggers on
   `Completed On`, which `Schedule: Stamp Completed On` writes — once per row the cascade stamps —
   and each run loops `$activePeriodDates` doing a `FIND over $allContainers`. Its guard is the
   2026-08-09 source guard, which passes for a MeasureOp. This is the `Schedule: Fill Day` shape
   (766ms for zero effects) and wants the same treatment: a rule that cannot change behaviour.
2. **The one real sweep, 1514ms across 27 ops.** The media import put 3,579 rows into the
   collections 19-24 ops walk (`$allItems` is 21,766 now), which is the documented per-op
   `$allInstances` question from 2026-08-25 (2) — *"per-op work, filed with the measurement"*.

Both are stored-pipeline changes on the user's live schedule, so they want their own reviewed pass
rather than the tail of this one. **All of it now runs off the critical path**, so the grid stays
responsive while it happens.
