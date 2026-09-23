# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---


> **The log is TRUNCATED.** This file carries only the most recent entries; everything older
> lives in [`CLAUDE.backup.2026-09-18.md`](./CLAUDE.backup.2026-09-18.md) — same content, same order, nothing rewritten.
> It was 1,106,326 characters on 2026-09-18, which is past what any session can read, so the
> narrative below stops at **2026-09-17 (5)** and the archive picks up at **2026-09-17 (4)**.
> **Grep the archive before concluding something was never done** — it holds ~231 entries and
> every recurring-defect war story this project has paid for. The standing rules, the data
> model and the roadmap are still at the BOTTOM of this file, not in the archive.

### 2026-09-23 (2) — A REFUSED DUPLICATE WHOSE HOLDER NOBODY LISTS WAS A PERMANENT DEAD END

The schedule "disappeared" twice — 2026-09-19 and again this morning — and both times the data was
the same shape: the day column was IN MONGO with its `identitySignature`, its 49 slots and a
`parentId` naming the Schedule page, and **the page's `occurrences[]` never learned it.** Every
renderer reads the PARENT's list, so the column rendered nowhere; and `refusedDuplicateCreates`
then correctly refused every rebuild as a duplicate of it.

***The thing blocking the repair WAS the thing that needed repairing.*** That is what makes this
class permanent rather than transient: a missing row heals on the next load, a refused-and-invisible
row never does.

**MEASURED ACROSS EVERY GRID BEFORE WRITING ANYTHING, which is what says the rule is narrow:**
```
25,285 occurrences · 1,776 signed · 76 signatureUnique · 1 listed by nobody
daypage:col:2026-08-26   parent 8gpoqzx32h7   5 children   unreachable since Aug 26
```
So this is not a sweep over the grid; it is one row in a hundred thousand, and the guard only ever
looks at creates the refusal already rejected.

**`isDeadHolder` WAS ALREADY HALF OF THIS, and naming the other half is the whole fix.** That rule
(2026-09-19) says a holder whose MODULE is gone blocks nothing. `adoptableHolders` is its sibling: a
holder whose module is fine but which **no parent lists** is RE-LISTED into that parent, through the
app's own `$ne`-guarded `link_occurrence_to_parent`. **The refusal still stands** — allowing the
duplicate would mint a SECOND column and leave the first as debris, which is the trade the 09-22 (7)
entry already paid for once. Same 5-minute age floor as `isDeadHolder`, same reason: `create_batch`
emits a child before its parent's list write lands, so a holder seconds old may be about to be
listed by a write already in flight.

**VERIFIED ON PROD BY REPRODUCING THE DEFECT, on test grid 2 (the seed's own target, never poms):**
unlist a real signed day column, then emit the create the rebuild would send. The server's own log
is the evidence, and it names both halves in order:
```
REFUSED (duplicate signature) 1 [ b56cbf6b… ]      <- the rebuild, correctly refused
ADOPTED unlisted holder 38def427… -> Vaau-lsCuQDh  <- and the invisible column re-listed
mongo after   board lists holder true · 6 children · holder alive with its 5 · duplicate created FALSE
```
**A "board lists the holder" read on its own would have proven NOTHING** — it is equally satisfied
by an unlist that never landed. The log line is what distinguishes "the fix ran" from "nothing
happened", and the A/B's control (a holder the parent DOES list must write nothing) is what stops
the fix degrading into a pass that re-pushes every refusal on every load. No debris: the adoption
IS the cleanup.

**A/B'd, five mutations, each asserted to land: 5 of 5 fail exactly one test** — dropping the
reachability check, the age floor, the opt-in check, the refused-only rule or the dedupe.
**One of those tests was VACUOUS on its first pass and the A/B is what said so:** "only considers
creates that were actually refused" passed against the mutation, because the function returns early
on an empty refusal set anyway. It now carries a SECOND, unrefused create in the same batch, so the
rule has something to discriminate against.

**THE USER ASKED WHETHER WE SHOULD BE CLONING FROM THE TEMPLATE RATHER THAN A SIBLING — CHECKED ON
PROD, AND WE ALREADY ARE.** Read out of the live pipelines rather than assumed:
```
Schedule: Build Schedule   COPY_LINK sourceId $tplChildId   <- Schedule Template › Day (49 slots)
                           APPLY_TEMPLATE templateRef $tplInstId
Day Page: Build            APPLY_TEMPLATE templateRef $tplId rootSignature daypage:col:${$day}
```
Both clone from a template in the Templates folder; neither copies yesterday's column. **"Sibling"
is only where the DUPLICATE CHECK looks, never where content comes from:** the check asks *does a
child of this same parent already carry this identitySignature*, and the signature itself is
stamped by the template application (`rootSignature`), so identity is already template-derived.

**AND THE TWO FAILURES ARE NOT ONE FAILURE — the Aug 26 row is a different shape, reported not
fixed.** `Schedule: Build Schedule` finds its column by `_ancestors HAS_ANCESTOR`, which is built
from `occurrences[]`, so it CANNOT see an unlisted holder and falls through to a create — the path
this fix repairs. `Day Page: Build` finds its column by `parentId`, so it DOES see one, takes the
merge branch, and **never lists it either** (its `ADD_CHILD` is only in the create branch). That row
is therefore invisible forever and this fix never fires for it. It holds **no text and no true
fields** — empty scaffolding, not lost writing — so it is left alone rather than re-listed on a
guess; moving `ADD_CHILD` below the if/else is a change to a live op pipeline and wants its own pass.

**A PAPERCUT THAT COST TWO SILENT GREPS, and it is worth knowing about:** `duplicateSignature.js`
held two **literal NUL bytes** in a template literal (`` `${parentId}\0${sig}` ``), so `file` called
it `data` and **grep matched nothing in it while reporting success.** I read "no exports" twice
before noticing. Replaced with the `\u0000` escape — the same character in the resulting string,
and the file is text again. *A grep that returns nothing on a file you can see the contents of is a
claim about the FILE, not the pattern.*

2,450 server tests. Deployed, pm2 restarted (server file).

---

### 2026-09-23 — SAME-NAMED ROWS GET THEIR ANCESTOR CHAIN; and the fix was inert twice before it showed

Rebuild-via-UI. Two areas, and one user request that arrived mid-session and turned out to be the
bigger job.

**TEMPLATES: MERGE IS IDEMPOTENT, and the CONTROL is what makes that mean anything.** The rebuild
grid had 2 templates (my census metric `meta.templateModule` read 0 and was the WRONG PROXY —
`templateHelpers.js` says location is the only marker and the flag is legacy that *"points at
exactly the wrong occurrences"*; checked before filing a defect). Re-applying "Morning Slot":
```
                              before   after
12:00pm (already holds them)     4   ->   4     no duplication
9:00am  (does not)               2   ->   4     Stretch + Breakfast, signed auto:<templateChildId>
```
The second arm is the point: 4→4 alone is equally satisfied by a merge that does nothing. The
template's own children are UNSIGNED, so this exercises the 2026-08-07 auto-signature fallback —
the machinery behind the bug that *"permanently doubled the column"*.

---

**THE USER'S REQUEST: *"in those places where its hard to tell occurances apart due to same name
(diff selects and such), we need to show the occurances ancestor chain"*.** Measured before
designing, and the measurement decided the design:
```
poms   22,479 occurrences · 1,972 labels shared by 2+ · 6,763 rows (30%) carry a shared label
       worst: "Sleep" x158 · "Drink" x105 · "Eat" x94
       101 of 106 find-mode fields key their options by ID, so the collisions REACH the user
```
`helpers/occurrenceCrumbs.js` is the decision once. **Only the options that collide INSIDE THE LIST
are crumbed** — ambiguity is a property of the list you are looking at, not of the grid; crumbing
everything would decorate 15,901 unique labels to help 1,972. It is also what keeps it off a hot
path (`resolveOptions` was 1,381ms of the 2026-08-07 profile): an O(n) count first, the walk only
for duplicates, reading the `_ancestors` the resolver already enriches. And it **reports what it
cannot separate** rather than silently decorating — two rows sharing a label AND a parent get the
same crumb, which is exactly the template picker's shape.

**THEN IT WAS INERT, TWICE, AND ONLY OPENING THE DROPDOWN SAID SO.**
1. `OccurrenceOption` does `const label = card?.label || (... fallbackLabel ...)`. `card.label` is
   re-resolved from the live occurrence and rightly WINS, so the crumbed LABEL was never read. The
   chain is its own muted line now; the live label still wins for the label, so a renamed row still
   shows its new name.
2. Still nothing on screen. `Field.jsx` built `<OccurrenceOption>` in **THREE** places — the shared
   `renderOccurrenceOption` plus an inline `renderOption={(o) => …}` in EACH single-select popover.
   The crumb went to the shared one, so it showed in the MULTI-select picker and silently nowhere
   else; the field I was testing is single-select. **One of the copies had already DRIFTED** (no
   `chipDisplay`, no `onSetImage`) — the duplication was costing something before anyone noticed it
   was also missing a crumb. *"Two implementations of one question, only one ever fixed"* — this
   log's most-repeated class, walked into while fixing something else.

**AND MY FIRST ATTEMPT AT THAT FIX DID NOT COMPILE.** The explanation went in as `{/* … */}`
**between JSX attributes**, which is not a legal position. **All four source guards passed** — they
read the file as TEXT — and only `vite build` said so. The same lesson this file records for a
broken import in `Editor.jsx`: *a source guard cannot see a broken parse.*

**VERIFIED ON PROD BY OPENING THE DROPDOWN** (38 options, **19 chained**, uniques untouched):
```
Schedule › 6:00am   ⏎ Wake Up    ⏎ Logged On: Sep 21 ⏎ Done: false
Schedule › 7:00am   ⏎ Stretch    ⏎ Logged On: Sep 21
Deep Work           ⏎ Logged On: Sep 21        <- unique, no crumb
```
**Then the user: *"you are missing a part of the ancestory"* → *"oh nvm"* → *"and yes full
ancestory"*.** The first version kept the nearest TWO ancestors. On the rebuild grid the chain
really is only two deep, which is why it looked right; on poms a schedule row lives under
`Schedule Template › Schedule: Routine › 6:00am` and the cap hid a level. It shows the whole chain
now, **stopping at the PAGE** — above that is layout chrome, and the panel is called "Panel D".

---

**FOUND ON THE WAY: A UI-MADE OCCURRENCE FIELD STORED A LABEL, NOT A REFERENCE.** The rebuild's only
occurrence field could not show a collision at all, because the Fields tab defaults a new Find
source to `valuePath: "label"` for every type. Of 106 live find-mode fields **101 key by `id`** — the
editor shipped the minority shape. On an occurrence field it is wrong twice: the stored value is a
label STRING, so renaming the row silently breaks every reference; and options de-duplicate BY
VALUE, so a board holding four "Stretch" rows collapses to ONE pickable option. A SELECT keeps
"label" — there the value IS the label, which is why this is per-type and why the select case is a
test rather than an afterthought.

**`deploy.sh` RUNS `git add -A`, and it VOIDED AN A/B.** With three accounts on one checkout,
another account's deploy committed my half-finished files — twice, minutes apart — so
`git checkout --` restored MY OWN work as the "defect" arm and all 11 tests passed in both. That
reads exactly like *"my tests do not discriminate"*. What caught it was **asserting the mutation
landed**: `grep -c isGrid` read 11, not 0. Re-run against the true pre-change commit (found with
`git log -S`) it fails 6 of 8. Saved as memory; nothing in the repo documented it.

Client **4,871 pass / 1 fail** — `stampCompletedOn`, confirmed pre-existing by reverting both fixed
files and seeing it fail identically. Every fix A/B'd with the mutation asserted to land. Grid
integrity **clean**.

**THE REBUILD'S TARGET IS NOW NAMED, at the user's ask (*"i hope we plan on recreating all of poms
with this rebuild"*).** Censused rather than estimated:
```
            poms   rebuild   gap            180 DISTINCT POMS PAGES have no counterpart:
pages        214       20    194            Mind · Money · Home · Social · Creative ·
containers   855       34    821            Ingredients · Grocery List · Meals · Beverages ·
fields       296       14    282            Supplements · Movements · Routes · Readings ·
operations    78        4     74            Verses · Courses · Practices · Prompts · Topics ·
occurrences 22479     314  22165            Skills · Ideas · Wish List · People · …
```
**Scope chosen: STRUCTURE + SAMPLES** — all 180 pages, their containers, the 282 fields and 74
operations, each with a handful of real rows so the ops and trackers have something to compute
over. Deliberately NOT the bulk content (3,558 artifacts, 1,464 bookmarks, 540 quotes, months of
day columns): those came from uploads and importers, not from clicking, and they are not where the
defects have been.

---

### 2026-09-22 (26) — `onAdd` WORKS, AND AN UNSCOPED ONE FIRES ON THE APP'S OWN PLUMBING

Rebuild-via-UI, next area chosen by **census rather than by guess** — which trigger types poms
depends on and this grid has never exercised:
```
onAdd     46 ops        onCreate  2      onGraphSelect 1
onDelete  44 ops        onMove    2      the 4 pomodoro ones
```
`onAdd`/`onDelete` is **90 live triggers with zero coverage here** — the automation gap in concrete
terms.

**BUILT AN `onAdd` OP END TO END BY CLICKING**, which also walks the operations editor's own
surfaces: `+ Operation` -> rename -> trigger `On Add · Module · Container` -> `+ Action` -> the
action picker's drill-down (`Occurrences` -> `Update` -> `Set field`) -> field `Notes`, value
`auto`. Then added a row to the Water container through its `+`:
```
before   Water lists 6
add      "Item 34"
after    179013:Item 34   notes="auto"     <- the op fired and wrote the trigger's own occurrence
```
`Set field` pre-fills its target with `$trigger › occurrenceId`, so the row it stamps is the row that
was added. **The trigger surface is sound on a UI-made grid.**

**AND THE INTERESTING HALF IS WHAT ELSE IT STAMPED.** The trigger was left at `targetId: ""`, and
it fired for adds the app makes for **itself**, not just the one I performed. Minutes later, integrity reported an error:
```
dcc51d7a   folderPage for Files/Images   module *** MISSING ***   listedBy 0   created 02:22:56
  its only field:  Notes = "auto"        <- stamped by my op
```
The app minted a folder-page occurrence, **my op wrote to it**, and its module never landed (the
documented create/disconnect asymmetry, this time losing the module rather than the occurrence — my
probes close the browser seconds after acting).

**WHICH SENT ME LOOKING, AND THE TRIGGER FILTER IS NOT WHAT I THOUGHT — NOR WHAT IT CLAIMS.**
`subjectRole` on a lifecycle trigger is the role of the **created/deleted occurrence**, not the
container it lands in. So an `onAdd · Container` op should NOT have matched an instance at all. Two
ops with the IDENTICAL subject shape, opposite outcomes:
```
onDelete · module · container   delete an INSTANCE   -> did NOT fire   (correct: role filtered)
onAdd    · module · container   add    an INSTANCE   -> FIRED          (wrong)
```
**Proved with a role it could not possibly be**: an `onAdd · module · PANEL` op fired when an
`instance` was added (`Item 34`, role `instance`, one run recorded). Per `matchSubjectFilter` there
is exactly one way that happens — `transaction._occRole == null`, the documented fail-open
("no over-rejection").

**THE MECHANISM IS A MISSING OVERLAY, and the codebase already solved it one entity over.**
`_occRole` resolves as `modulesById[transaction.instanceId]?.role`, and `modulesById` is built from
the store snapshot. The bridge keeps a SYNCHRONOUS local overlay for OCCURRENCES
(`localOccsById` — added precisely because `stateRef.current` lags a fire) and **none for MODULES**.
A create fires in the same tick the module was minted, so the module is not there yet, the role
resolves to null, and every role-scoped `onAdd` matches everything. On the delete path the module
has long been in the store, which is why filtering works there.

**REPORTED, NOT FIXED — and the measurement is why.** The code's comment calls this role check the
fix for the "Wikipedia-import flood". That case still filters: an import's modules arrive by socket
broadcast and ARE in the map by the time occurrence creates fire. What fails is the synchronous
same-tick mint (QuickAdd, `createLeafInstanceInParent`) — one occurrence at a time, so the cost is a
few extra tracker aggregations per manual add, not a flood. Against that:
```
role-scoped, no targetId, ENABLED lifecycle triggers
  poms grid 159   test grid 2 141   test grid 1 148
  poms: onAdd instance 46 · onAdd container 34 · the delete halves 44/34
```
They come in PAIRS — each tracker declares both `instance` and `container` — so tightening the add
path changes the firing behaviour of **159 live triggers on protected data**. That is a hot write
path and wants its own reviewed pass with an A/B over the real trackers, not the tail of this one.

**THEN THE ORPHAN COULD NOT BE SWEPT, BECAUSE MY OP HAD WRITTEN TO IT:**
```
KEEPING module-less dcc51d7a — has field values
```
`sweepOrphans`' guard is exactly right — it protects real writing — and the only "writing" here was
the stamp. *A test op's write can make the janitor refuse to collect the thing the test created.*
Repaired through the app's own `delete_occurrence` on a socket joined to THIS grid (never a raw
Mongo write), behind a guard that re-checks module-less + listed-by-nobody + childless and refuses
otherwise. Integrity back to **clean**; the test op and its row removed through the UI, and the grid
keeps the two real improvements from (22).

**THREE PROBE FAULTS, and the first is the one that matters.** My cleanup probe emitted through
`window.__moduli_socket` — **which does not exist** — and then reported `deleted row: 179013`
because it had successfully *found* the row. Mongo said otherwise. *Report what the write did, not
what the lookup did.* Also: a `+ Action` coordinate measured before `scrollIntoView` was stale by
128px and clicked into the run-history panel (the hit-test assert is what caught it); and the action
picker's rows carry their description in the same element (`"Occurrences Create, update, delete grid
occurrences"`), so an exact-match `^Occurrences$` finds nothing — match the leading title.

**NOT TESTED, said plainly: `onDelete` (44 poms ops).** It is a separate branch of `matchesTrigger`
(`OccurrenceDeleteOp`, not `OccurrenceCreateOp`), so `onAdd` passing says nothing about it.

---

### 2026-09-22 (25) — THE POMODORO DESTINATION COULD NEVER BE SET, ON ANY GRID

Rebuild-via-UI, next area **pomodoro** — picked because the rebuild grid had ZERO of it (poms
runs 4 pomodoro ops; `grid.meta` here was entirely empty), which is the shape (16) found with
alarms.

**THE TIMER ITSELF IS SOUND, driven from the toolbar on a grid with no `meta` at all:** Start ->
`24:56` -> `24:53`, Pause holds, Reset returns to `25:00`. **0 transactions throughout, and that is
correct** — no op here carries an `onPomoStart` trigger, so there is nothing to match and nothing
to write.

**BUT THE DESTINATION PICKER ("Send pomodoros to") DOES NOTHING, AND IT HAS NEVER WORKED.**
`DestinationPicker` is a Radix Popover: its list portals to `document.body`, a **sibling** of the
pomodoro panel rather than a descendant. The panel's own dismiss handler asks
`panelRef.current.contains(e.target)` — a lie for a portalled layer — so pressing a row collapsed
the panel on **MOUSEDOWN**; and `containerOptions` is memoized **on `expanded`** (a deliberate
2026-08-30 perf decision: 156ms of the load spent filling a `<select>` nobody is looking at). The
list therefore emptied BETWEEN mousedown and mouseup:
```
picker open              popover open   rows 33
after MOUSEDOWN only     popover open   rows  0   <- panel collapsed, options gated off
after mouseup            popover open   rows  0   <- the button you pressed no longer exists
```
So `onPick` never fired, the trigger label stayed `None`, and nothing was written. **Two decisions
each correct alone, cancelling each other out — the shape (17) found in the panel stack.**

**IT IS NOT COSMETIC, and one field says so: `pomodoroTargetContainerId` is unset on POMS GRID
TOO.** The feature has shipped for weeks and there has never been a way to set it.

**THE RULE ALREADY EXISTED AND THIS FILE WAS ONE OF EIGHT THAT NEVER ADOPTED IT.**
`helpers/outsideClick.clickedInsidePortalLayer` was written 2026-08-27 for the IDENTICAL symptom
(*"whenever i select anything from the quickadds field value selection, it closes out of the
quickadd menu"*), and its own header says it is safe on every such handler **because it can only
ever prevent a close, never cause one**. Measured: 16 hand-rolled `mousedown` outside-close
handlers, 8 using the rule. The fix is one guarded early return.

**THE WALKER IS THE TEST, not a pin on one file** — the whole defect is that one file was missed
while eight were not. It fails when any component that renders a portalling picker hand-rolls an
outside-close without CALLING the rule. **A/B'd, and the first version of the walker was too weak:
deleting the call left the IMPORT, and an identifier check passed on the import line alone.**
Tightened to require a call, both tests now fail against the unfixed source and the walker NAMES
the offender.

**VERIFIED ON PROD, both directions AND the controls that make the fix safe:**
```
pick a destination   target null -> 45bd85bb…   label "Basic Nutrition Guide › Container"
after a RELOAD       45bd85bb…                  <- persisted server-side
pick None            back to null, survives a reload
ordinary outside click / Escape / re-click the trigger   panel still dismisses (opacity 0)
```
The arbitrary destination was set only to prove the mechanism and was cleared again; the grid ends
as it was found. Integrity **clean**.

**AND THE PROBE FAULT IS THE REUSABLE HALF.** My first click on `+ Attach a field` (in the
operations editor, the same day) matched the element by INNERTEXT and landed on the wrapping
`<div>` — and because a wrapper and its button render the same text, `elementFromPoint` returned
that text and the hit-test guard PASSED. The picker silently never opened, which reads as a broken
control. *Hit-test on element IDENTITY, not on the text it renders.* Also: the pomodoro's own
controls are **icon-only buttons**, so a filter on `innerText` finds none of them ((14) recorded
the same thing on the radial arc) — and the value editor in the operations builder defaults to
**path** mode, which renders a picker and no text box, so "there is no input" is a mode, not a bug.

**REPORTED, NOT FIXED — 7 other hand-rolled handlers do not use the rule** (`TransactionNotification
Stack` ×2, `RadialMenu`, `NavPickerPopover`, `FootnoteNode`, `ActionPicker`, `containerPopups`,
`ManifestTree`). They are NOT blanket-fixed on purpose: the rule treats `[role="dialog"]` as a
portal layer, so applying it to a menu that itself lives inside a dialog (the command center) would
wedge that menu open — the exact inverse defect. Each wants checking against what it actually hosts.

---

### 2026-09-22 (24) — "MODULE HISTORY" WAS EMPTY ON EVERY GRID, and the rows it should have shown said "Unknown operation"

Rebuild-via-UI, next area **the transaction history panel** — the surface that displays everything
this week's undo work produces, reachable from every container's and panel's radial, and never once
opened on this grid.

**IT OPENED CONTRADICTING ITSELF.** From the Mind container:
```
Module History | 98 active, 0 undone | No transactions found | 0 of 100 transactions
```
242 transactions exist on this grid. **The "0 undone" is CORRECT and was checked before being
filed** — the one transaction I undid earlier had since been superseded, and the grid genuinely
holds `applied 234 / superseded 8 / undone 0`. The empty LIST is the defect.

**THE FILTER ASKED FOR IDS THE DATA HAS NEVER CARRIED.** It matched `measure.panelId`,
`measure.containerId`, `occurrence_list.*.containerId` and `entity.moduleId`. Measured on both
grids:
```
rebuild   242 transactions   200 SnapshotOp — operations[] EMPTY, payload in docs[]
                              42 MeasureOp  — measure = { occurrenceId, fieldId, value, flow }
poms     1200 transactions   15,831 measure payloads, ZERO carrying panelId or containerId
                             0 occurrence_list ops · 0 entity ops
```
So the panel could not match a single row **on either grid** — a shipped surface that is always
empty, everywhere. What a transaction actually names is an OCCURRENCE (or the module itself, for a
module write), and `helpers/transactionScope` reads that; the legacy shapes are kept for a grid
whose older rows carry them.

**AND WITH THE ROWS BACK, EVERY ONE OF THEM READ "Unknown operation".** `getDescription` bails on a
missing `operations[0]` — which is every SnapshotOp, i.e. 200 of 242 here and 200 of 1200 on poms.
Nothing had to be guessed: the record carries the label its gesture opened with
(`withAction("Created item", …)`) and the docs it wrote.

**VERIFIED ON PROD, the same panel before and after:**
```
before   No transactions found · 0 of 100
after    Updated occurrence — Mind        Applied
         Created item — Mind +2           Applied     <- the one-action paste from (21)
         Created item — Mind +1           Applied
         5 of 100 transactions            every row carrying an enabled "Undo this transaction"
```
**The overflow counts DOCS, not resolvable names** — a transaction that wrote three rows and can
only name two must not read as if it wrote two. (The unnamed ones here are rows I deleted
afterwards, which is exactly when a count beats a name.)

**NOT PRESSED, and said plainly:** nobody has clicked the panel's own Undo. Each row offers an
enabled button and it goes through the same `undoTransaction` socket path Ctrl+Z uses — which this
session has exercised repeatedly — but pressing it would revert an hour-old transaction on a grid I
want left tidy, so the button's own wiring is unproven.

Client tests green, integrity **clean**, 315 occurrences.

---

### 2026-09-22 (23) — THE FIELD-VISIBILITY CASCADE'S ROOT WAS UNREACHABLE; and a parallel deploy ate my A/B

Rebuild-via-UI, next area **field visibility** — picked from the census: poms carries 9 occurrences
with a `fieldVisibility`, the rebuild grid **0**, and this file already records the semantics going
subtly wrong (2026-09-18 (8): *"a cascade level is a complete answer, not a delta"*).

**THE CASCADE ITSELF IS SOUND, driven end to end by clicking**, on a row carrying all six field
types. The load-bearing step is the third, and the CONTROL is what makes it mean anything:
```
                         page          container      what the ROW shows
baseline                 inherit       inherit        all six
PAGE   hide[Location]    hide[Loc]     inherit        Location gone
CONT   hide[Notes]       hide[Loc]     hide[Notes]    Notes gone, LOCATION BACK   <- REPLACE
CONT   Off               hide[Loc]     off            all six  (page's hide ignored)
reset                    inherit       inherit        all six
```
*Location returning is the proof.* A merge would have hidden both; the nearer level replaced the
page's answer wholesale, exactly as documented.

**BUT THE ROOT OF THAT CASCADE COULD NOT BE SET BY ANY USER.** `grid.meta.fieldVisibility` is the
top of the walk and it is **READ in exactly one place and WRITTEN nowhere in the source**:
```
grids carrying one   1 of 10   — poms: hide[Tags, Date, Kanban Column]
client writers       0
server writers       0         (every createLiveData write is OCCURRENCE-level)
```
Those three fields are verbatim the request the root was added for on 2026-08-11 — *"hide tags
everywhere, and hide date everywhere thats not tasks, schedule, trackers"* — so the only way to
express "everywhere" was a hand write into Mongo, **which this log records going badly on this key's
occurrence-level sibling** (09-18 (8): a hand-written `fieldVisibility` un-hid three fields and named
another grid's field id).

***AND THE ROOT WAS IMPLEMENTED, DOCUMENTED AND UNIT-TESTED THE WHOLE TIME.***
`fieldVisibilityGridRoot.test.js` has 7 tests proving the resolver honours it. A green suite over a
setting nothing can set is the sharpest form of this defect — same shape as the button field whose
`meta.operationId` had no editor (09-21 (3)) and `grid.meta.scheduleFieldIds`, seed-only (16).

**THE CONTROL IS THE EXISTING SECTION, not a second one.** `FieldVisibilitySection` takes an optional
`grid`/`gridId`; `GridSettingsTab` mounts it beside the **style** cascade's root, which was already
sitting there. Two differences at the root are deliberate and are ASSERTED so a later tidy-up cannot
quietly restore them:
- **no "Inherit"** — nothing sits above the grid, and its off state IS "no default", so Off CLEARS
  the key (the resolver already treats absent and `{mode:"off"}` identically);
- **no REVEAL control** — `getEffectiveFieldRevealForOccurrence` walks occurrences only and has no
  grid root, so a control there would write a key nothing reads.

**VERIFIED ON PROD THROUGH THE UI:**
```
Grid tab -> Field Visibility        mode buttons ["Off","Show","Hide"]   <- no Inherit
Hide + tick Notes                   grid = hide[Notes]
the row (nothing nearer set)        Notes GONE — the root reached an instance
Off                                 grid = none, Notes back
```
**The meta-preservation guard is unit-tested and NOT watched, and saying so matters:** the write
spreads the whole `meta` because `defaultStyle` / `scheduleFieldIds` / `autoAppliedFieldIds` live
there — but the rebuild grid's `meta` is **empty**, so live data could not exercise it.

---

**AND THE A/B WAS VACUOUS FOR A REASON WORTH MORE THAN THE FEATURE: `deploy.sh` RUNS `git add -A`.**
It commits the WHOLE working tree, not the deploying session's files. With three accounts sharing one
checkout, another account's deploy committed my half-finished component — twice, minutes apart
(`cd085a36`, then `7c21a121 "deploy: update site"`), and later `d69a0692` took the rest INCLUDING my
test file.

**So the defect arm and the fixed arm were the same bytes, and all 11 tests passed in both.** That
reads exactly like *"my tests do not discriminate"* — and the previous entry in this file had just
spent a paragraph on tests that genuinely did not. What separated them was **asserting the mutation
LANDED**: `grep -c isGrid` read **11** after `git checkout --`, i.e. the arm never changed.
`git checkout --` restores from the INDEX, and `git show HEAD:` from a HEAD that now contained my own
work. Re-run against `99d8ac05` — found with `git log -S` and verified at **0** — it fails 6 of 8.

*The rule: before believing an A/B, print a count of the thing you removed. And in a shared checkout,
find the pre-change commit by SEARCHING for the symbol, never by assuming HEAD predates you.*
Saved as memory; nothing in the repo documented it.

**Probe faults, mine.** The dropdown's field rows sit at **y=1012-1074 in a 1000px viewport** —
`getBoundingClientRect` reports a box for a clipped element, so a coordinate click there silently
misses and the second field I ticked was never ticked; the safe path hit-tests and falls back to
`element.click()`, **reporting which it used**. And a page's chevron is not found by its name: a page
header's first line is the DATE pill, so matching "Tasks" against it finds nothing and reads as *"the
page has no chevron"* — it is found from the ROW via `closest(".page-shell")`.

Grid integrity **clean**; grid meta and all occurrence-level settings back to none. 8 new tests
(A/B'd 6 of 8), 76 across the field-visibility suites.

---

### 2026-09-22 (22) — THE TRACKER WAS RIGHT AND MY PROBE WAS WRONG; and a tracker that went stale without saying so

Rebuild-via-UI, next area **trackers**. The handoff carried a defect from this session's own earlier
half: *"the write lands (5 -> 7 -> 5) but Total Water never moves — even though the op has an
`onChange` trigger."* **That is RETRACTED. The op was correct and the probe was not.**

**THE ROW I EDITED CARRIES NO DATE, and the op sums by date.** `Water Today` is
`LOOP $allInstances -> IF Logged On SAME_DAY $activeDate -> $total += Glasses`, and reading the rows
rather than the totals is what settled it:
```
aa5b92  Glasses 5   Logged On NULL        <- the row I was editing
224e6c  Glasses 3   Logged On 2026-09-21  <- the only row the filter admits
```
So `Total Water = 3` was the right answer all along. Editing the DATED row instead moves it
`3 -> 4 -> 3`, read back out of the store. *A total that does not move is a claim about the rows it
sums, and I never looked at them.*

**THE BUTTON OP WAS HALF-BUILT, AND FINISHING IT BY CLICKING IS THE ENTRY.** `Log a Glass` was a
bare `CREATE instance "Glass" -> Water` with **no `fields` at all** — the 09-21 session verified the
button fired and the row minted, which it did, and a row carrying no Glasses and no date can never
count. Built the rest through the editor: `+ Attach a field` -> Glasses `= 1`, Logged On `= $today`,
Save. Pressed `Log` on the Trackers row:
```
minted  f4dc0a   Glasses "1"   Logged On 2026-09-22      <- $today resolved
```

**AND THE NUMBER DID NOT MOVE, WHICH IS A SECOND DEFECT, NOT THE FIRST ONE AGAIN.** Stepping the
toolbar to Sep 22 left `Total Water` reading **3** — Sep 21's total — beside a Sep 22 row worth 1.
The op's triggers were `onLoad` + `onChange`; **a date change is neither**, so it never re-ran and
the screen showed yesterday's number with nothing to say so. poms' own trackers all carry
`onFilterChange` (`makeTrackerOp` adds it); this grid was built by hand and never got one. Added
`onFilterChange · grid` through the trigger editor:
```
Sep 21   Total Water 3     <- the dated number row
Sep 22   Total Water 1     <- the op-minted row
back     Total Water 3
```
**No code changed this stream — the fixes are DATA (two operations on the rebuild grid), so nothing
was deployed.**

**REPORTED, NOT FIXED — A PIPELINE STORES THE STRING IT WAS HANDED.** The editor's value box is a
text input, so a literal typed there is a string: my `1` reached a `number` field as `"1"`. `CREATE`
coerces **`date` and nothing else** (its own comment explains why that one exists —
*"a resolveExpr leak produces a literal string"*), and **`SET_FIELD_VALUE` coerces nothing at all**;
it never consults `fieldsById`. **The scan is what decides it rather than taste:**
```
227 operations · 23 literal writes into a typed field
  1  would coerce   number "Glasses" = "1"     <- the one I authored 20 minutes ago
 22  must NOT       select / text fields ("day-col", "5:00pm", "Todo")
```
So a write-side coercion would change **zero** existing operations — it is preventive, not
corrective. **And the project already chose the other side, today:** `helpers/duration.js` landed
this morning putting the coercion in the READER precisely because a field holds both types, and the
pipeline language is string-tolerant on purpose (`IS` is `String(a) === String(b)`, the numeric
comparators use `Number()`, and `ADD_TO_VAR` summed my `"1"` to a real `1` — the Sep 22 total above
is that proof). A second defence in the executor is the two-implementations-of-one-question class
this file keeps paying for. **If a renderer is found that breaks on a string, the fix belongs beside
`toMinutes`.** Census across every grid: **9 mismatched cells in 62,030** — 7 of them the `Duration`
strings that entry already documents, and *no operation writes them*, so that writer is still
unidentified.

**TWO PROBE FAULTS, AND THE FIRST IS THE REUSABLE ONE.** Clicking `+ Attach a field` by matching
INNERTEXT hit the wrapping `<div>`, and `elementFromPoint` reported the same text back, so the
refusal guard passed and the picker silently never opened — *hit-test on element IDENTITY, not on
the text it renders; a wrapper and its button read identically.* Targeting
`button[aria-label="Attach a field"]` opened it first try. And the value editor defaults to **path**
mode (a picker, no text box), so "there is no input" reads as a broken row until you switch the mode
select to `text`.

Grid integrity **clean**; 315 occurrences, 4 operations.

---

### 2026-09-22 (21) — SHIFT+CLICK SELECTED THE CONTAINER, NEVER THE ROW; and a paste of two was two undo steps

Rebuild-via-UI, next area **multi-select and the clipboard** — shift-select rows, `Copy N selected`,
paste them somewhere else. Nothing on the rebuild grid had exercised it.

**DEFECT 1 — A ROW COULD NOT BE SELECTED AT ALL.** Shift+click on an instance selected nothing and
toggled the CONTAINER instead. Measured with listeners on both elements rather than guessed:
```
plain click   pointerdown · mousedown · mouseup · click     <- reaches the row
shift+click   pointerdown · mousedown · mouseup · (no click) <- the row never sees one
```
`ModuleContainer` claims shift+click in the **CAPTURE** phase and calls `stopPropagation()`. Capture
runs top-down, so the container fired FIRST and halted the event before it could descend to the
row's own bubble-phase handler. **The capture phase is not the thing to remove** — its comment says
why it exists (*"so inner contentEditable / inputs don't swallow it"*) — so the container now defers
a click that landed on one of its rows, and the row claims it in capture for the same reason.

**WHAT THAT COST IS BIGGER THAN THE GESTURE:** every bulk action lives on a ROW's right-click menu
and is gated on the selection count, so with rows unselectable the entire clipboard was unreachable
for instances. Verified on prod after the fix — two rows selected, container untouched, and the menu
carries `Copy 2 selected · Move 2 selected · Copy-link 2 selected · Delete 2 selected · Clear
selection`.

**THE PASTE IS A LEFT-CLICK DROP, AND THAT IS WHY "Paste N here" NEVER APPEARED.** Three sessions of
probing a container's menu for it would have been wasted: `ui/ClipboardDropOverlay` mounts
document-level listeners while a clipboard is staged, and its `onContextMenu` **clears the
clipboard** — *"right-click anywhere while clipboard is active → clear"*, by design, as the cancel
gesture. So the `Paste N here` items in `ModuleContainer` and `ModulePage` cannot be reached by
right-click while a clipboard exists; the shipped path is to click the destination. **Two
implementations of paste, one of them unreachable — reported, not fixed.**

**DEFECT 2 — PASTING TWO ROWS WAS TWO UNDO STEPS.** The trail, for ONE gesture:
```
seq 2256  action b52c615a  "Created item"  17901252[create] 3dd9f1d9[update]
seq 2257  action 9ea65562  "Created item"  17901252[create] 3dd9f1d9[update]
```
So one Ctrl+Z took back HALF a paste. Each row's create was already grouped with the parent's list
write (the (8) fix); the gesture around the PAIR was missing. `withAction` nests, so wrapping the
loop is the whole fix — and it covers copy / move / copy-link and every caller.
**Verified on prod after deploying:**
```
seq 2258  action 66bd5679  state: undone   17901254[create] 3dd9f1d9[update] 17901254[create]
```
One action, both creates and the parent's list, `undone` after a single press.

**FOUR PROBE FAULTS, and two of them nearly became defect reports.**
```
menu detection    my "find the floating panel" heuristic kept returning the empty
                  panel's "Tap to add a panel" placeholder — the stable hook is
                  `.context-menu-item`, and until I used it every menu read as absent
the container's   its onContextMenu is bound ONLY to the ~20px header row; right-clicking
menu              the body opens the PAGE's menu instead
back-to-back      a right-click issued straight after clicking a menu item is consumed
menus             dismissing that menu, so the next menu never opens
reading too soon  3.5s after a paste the DOM showed ONE of two rows — BOTH were in Mongo
                  and both render on reload. I nearly filed "only one row pastes", twice
```
*A row that has not rendered yet and a row that was never created look identical in the DOM; the
parent's child list is what tells them apart.*

**Debris:** the two rows from the pre-fix paste removed through the app's own `delete_occurrence`.
Grid back to **315 occurrences**, Mind restored to its two children, integrity **clean**.

---

### 2026-09-22 (20) — FIVE FIELD TYPES THIS GRID HAD NEVER HAD; a duration meant four things, an address meant nothing

Rebuild-via-UI, next area **field types** — picked from a census rather than guessed. Eleven types
exist (`helpers/fieldTypes.js`, checked against the server enum); the rebuild grid had exercised six:
```
TYPE        poms   rebuild          TYPE        poms   rebuild
text          71      0   <-        rating        3       0   <-
number       133      3             duration      2       0   <-
occurrence    49      1             address       1       0   <-
select        19      1             markdown      ?       0   <-
date          15      1             boolean/button   exercised
```
**`text` is poms' SECOND most-used type and the rebuild had none.** All five were created through the
Fields tab, bound to a row through its Settings, and filled through the row — and two of them were
broken in ways only filling them could show.

**DEFECT 1 — A `duration` MEANS MINUTES, AND FOUR RENDERERS DISAGREED.** Typing `1` into the compact
pill (what every board row shows) stored the STRING `"1"` and the pill read `1`, while the same value
read `1m` through the display path:
```
Field.jsx case "duration"    120 -> "2h"
useDocFieldValues.js         120 -> "2h 0m"        <- a doc pill and a row pill, same value
Field.jsx compact pill       120 -> "120"          <- never formatted at all
Field.jsx h/m editor         two boxes, writes h*60+m as a NUMBER
```
`helpers/duration.js` is that decision once. **`toMinutes` COERCES, because the type is not
guaranteed:** poms' `Duration` holds **12 numbers and 7 strings**, and `useDocFieldValues` formatted
only `typeof value === "number"`, so those seven rendered as a bare `60` in every doc pill.
**WHAT WROTE THE SEVEN IS NOT ESTABLISHED, and I nearly claimed it was** — the commit message said the
compact editor made them until the data said otherwise: **none carries a `timestamp` or a
`userTouched` row**, which a UI edit leaves behind. What was WATCHED is that the compact editor stores
a string; the provenance of the seven is not mine to assert. *Corrected before it shipped, not after.*
The compact editor is numeric now and gets the narrow centred box **the comment beside it already
promised durations** — that comment was the control.

**DEFECT 2 — PICKING AN ADDRESS STORED NOTHING.** The picker searched fine; clicking the result wrote
a cell with no value:
```
fields["<Location>"]  ->  { "flow": "in" }
```
`handleChange(loc); handleCommit(loc);` — and **`handleCommit` takes NO PARAMETERS**. It reads
`localValue` out of its own closure, so `loc` was ignored and `setLocalValue` had not landed in the
same tick; it committed the previous, empty value.

**WIDENING `handleCommit` IS NOT THE FIX, and that is the load-bearing half.** Measured before
touching it: **one** call site passes an argument and **EIGHT** pass it straight to `onBlur`, where
the first argument is a React SyntheticEvent. A positional value parameter would commit the event
object as the field's value on every blur — worse than the bug. The branch calls `onCommit` directly.
**Corroboration, stated as suggestive rather than proof:** across every grid all 22 stored address
values were written by SEEDS (bulk timestamps milliseconds apart, plain strings). The only entry the
picker itself ever wrote is the valueless one above.

**VERIFIED ON PROD AFTER EACH DEPLOY, by doing the thing:**
```
                  stored                     on screen
duration, rest    "1" (legacy STRING)        1m          <- the coercion, on data already there
duration, editor  type=number, 56px, centred (was a 180px LEFT-aligned text box)
duration, typed   90 (NUMBER)                1h 30m
address           {label, address, lat, lon, osmId}      (was {flow:"in"})
```

**THE INTEGRITY CHECKER CAUGHT ME OVER-CORRECTING.** I first "cleaned up" by unbinding all five from
the row — and `checkGrid` immediately warned **`unused-field: Notes, Focus Rating, Session Length,
Journal, Location`**. It was right, and so was the opposite reading: poms carries these types BOUND
and VALUED, and a task with notes, a focus rating and a session length is this app's own premise
("every task can be a checkbox **or** a measurement"). The fix was to USE them, not delete them.
*A tidy-up that trips an integrity rule is a tidy-up that removed something real.*

**FIVE PROBE FAULTS, all mine, and the first two cost the most.**
```
"+ Field" -> the button's text is "Field"; the "+" is a separate node
the picker row       innerText is "Notes\ntext\ntext field" — the name is its FIRST LINE, not a
                     prefix of the whole string. A startsWith(name + " ") test matched NOTHING
                     while the picker was demonstrably open with 39 rows
the editor covers    after Save, the field editor sits ON TOP of the list; the next row's span is
  the list          unreachable until you walk back via the breadcrumb
the address search   runs on FORM SUBMIT, deliberately not per keystroke (it is a third-party
                     geocoder). Typing alone left STALE results on screen and read exactly like
                     a broken search — I nearly filed it
each probe run       "+ Field" mints a field every time. Two runs left two; they were REPURPOSED
  mints a field      into the first two targets rather than deleted
```
Also: the address picker **seeds its search from the row's label** — clicking it on "Email Sam"
searches "Email" and returns French enamel villages. That is deliberate (the code says so) and is
kept as a control test.

Client **4,817 pass / 1 fail** — `stampCompletedOn`, confirmed pre-existing by re-running it with
both fixed files reverted, where it fails identically. Both fixes A/B'd from `git show <commit>^`:
duration 5 of 13 fail (the wiring cases), address 4 of 7 (three behavioural + the guard); the
remainder pass in both arms and are reported as **contract pins, not coverage**. Two client-only
deploys, `deploy.sh` correctly reporting *"Server unchanged — NOT restarting"* each time. Grid
integrity **clean**, and the row now carries all five types with the right stored types.

---

### 2026-09-22 (19) — SEARCH PUT THE FIVE ROWS YOU CANNOT OPEN ABOVE THE ONE YOU CAN

Closing the item (7) left open this morning: *"the first of six same-named hits opened nothing …
the results are not disambiguated by path in the picking order."* **Reproduced exactly, on poms
grid, searching "Chicken Breast":**
```
1-5   Chicken Breast                                <- no path; none of them open
6     Chicken Breast · Ingredients › Ingredients    <- the only usable one
```
`openOccurrenceInPanel` bails when an occurrence has no page in its ancestry, and the sort's
tiebreak is **ancestor depth ASCENDING** — so a row parented by nobody, having no ancestors at all,
ranked ABOVE the row that is on a page. That is what *"why doesn't search find it"* felt like.

**THE FIRST TIEBREAK IS NOW OPENABILITY, and it uses the index's OWN `pageOccId`** — the same walk
the opener does — so the ranking cannot disagree with what a click does. **The unopenable rows are
still LISTED**: hiding them would be the original complaint in a new form, since the row exists and
search is how you find it. They say **"not on a page"** in the list instead of making you spend a
click to learn it.

**THE APP WAS NEVER SILENT — MY PROBE WAS.** It already answered *"That item isn't on a page yet"*
on the click; the first measurement reported no toast because the selector (`[data-sonner-toast]`,
`[role=status]`) matches nothing here. Watching for ADDED NODES instead caught it at **+400ms**.
*A zero from a selector nobody has seen match is a claim about the selector.* The message was right
and in the wrong place: after the click, about the row you had already picked.

**THE NOTE KEYS ON `pageOccId`, NOT ON AN EMPTY PATH, and a real case proves why:** a PAGE has no
path of its own (the walk skips panels and a page has no non-panel ancestor) and is perfectly
openable — searching "Grocery List" lists the page first with no path, and it opens. Keying the
note on "path is empty" would have libelled every page on the grid.

**Verified on prod, the same search:** `Ingredients › Ingredients` first, the other five reading
*not on a page*, and picking the top hit navigates the panel. A/B: removing the tiebreak fails
exactly the ranking case; the control — a LABEL match outranks a BODY match even when the label
match is unreachable — passes in both arms, pinning that openability does not override match
quality.

**The panel I moved on the user's live grid was put back** through the app (its own search), since
a fresh session has no Back history to the page it started on.

---

### 2026-09-22 (18) — A GRAPH DREW ONE BAR FOR TWO ROWS AND SAID NOTHING; the chart heard half its warnings

Rebuild-via-UI, next area **graph containers** (the last one named untested). The rebuild grid
carried a half-built one from account2: `By Category`, a pie encoded to `Board Category`, with
**`feed: null` and 0 children** — so it correctly showed *"Nothing to chart yet — drop an occurrence
in, or give this graph a feed."* A graph is PULL-ONLY (2026-08-10), so with no feed there is nothing
to draw.

**FINISHED IT BY CLICKING.** The feed editor (header chevron -> Data) offers role filters, a page
scope, a limit and a sort, with a live match count: `36 matches` unscoped -> **3** scoped to the Food
page. The chart painted immediately: a donut, `15.2%` of the canvas inked.

**AND LOOKING AT IT IS WHAT FOUND THE DEFECT** — the pie drew **three slices, two of them labelled
"meal"**. That is correct and honest: the encoding is labelled **"Label"** in the editor (*"which
field NAMES each slice"*), not "group by", and `graphData` builds one node per row. But switching
the same data to a **bar** chart drew **meal = 1** — the second meal row discarded by
`alignedData`'s first-row-wins rule — **with nothing on screen to say so**:
```
drawn            meal = 1, ingredient = 1        <- a whole row gone
warning emitted  'two rows share the name "meal" — only the first is drawn'
chip on screen   .container-graph-warnings  count 0
```
**A CHART HAS TWO LAYERS THAT DISCARD, AND THE SURFACE HEARD ONE.** `buildGraphData` reports a row
that contributed nothing; `buildEChartsOption` reports an ignored encoding, a flattened level, or a
dropped duplicate. `GraphSection` (the editor) merges both and **says why in its own comment**:
*"BOTH HALVES WARN, and the readout is worthless if it only hears one … those are precisely the
failures that still LOOK like a chart."* `ContainerGraph` destructured `option` and dropped
`warnings` on the floor. The merge now lives in `helpers/graphWarnings.js` and BOTH call it — two
copies of "normalise the other layer's shape" is how one drifts back to silence. The chip counts the
two kinds SEPARATELY (`2 rows contributed nothing · 1 chart issue`), because filing a discarded row
under "N rows" is a lie the moment a non-row warning appears.
**Verified on prod:** the bar chart now reads **"1 chart issue"**, tooltip *two rows share the name
"meal" — only the first is drawn*. Restored to pie afterwards; the feed stays (it is real progress —
the graph charts something now).

**TWO THINGS I ALMOST FILED AS DEFECTS, both killed by reading before writing.** (1) The Data tab has
no chart controls — because the chart editor was deliberately MOVED to **Settings -> Chart** on
2026-08-28 at the user's ask (*"the graph config should go in the graph occurances settings, not the
filter dropdown"*); it is there, with 9 chart types, a live `· 3 roots · 3 rows` readout, and each
field annotated by how many rows carry it. (2) The duplicate-name pie looked like a missing group-by
until the editor's own wording settled it.

**MY WARNING PROBE MISSED THE WARNING TWICE, BY KEYWORD.** I grepped the panel for
`/warn|drop|ignor|unused|same|duplicate/` — and the real strings are *"N rows contributed nothing"*
and *"two rows share the name … only the first is drawn"*, which match none of them. *Grep for the
element (`.container-graph-warnings`), not for words you imagine it uses.*

**AND MY FIRST A/B WAS INVALID AND SAID SO LOUDLY:** half-reverting the fix left a dangling
`drawWarnings` reference, so ALL 12 cases failed — "the component crashes" is not "the chip is
missing". Reconstructed faithfully, exactly **2** fail (the behavioural chip case + the wiring
guard) and the other 16 pass in both arms.

---

### 2026-09-22 (17) — PANEL LAYOUT, BY CLICKING; and two rules that cancelled each other out

Rebuild-via-UI, next area **panel layout** (named as untested in the handoff). Every gesture driven
through the UI on the rebuild grid, and the grid put back exactly as it was found.

**THE SURFACE IS SOUND — six gestures, each measured:** tap an empty cell -> a panel minted on the
Root folder page (`0,0`, no empty cells left); drag a panel onto an OCCUPIED cell -> a stack with a
`2` Layers button; drag onto an EMPTY cell -> it moves; **Ctrl+Alt+Arrow snaps** a panel between
cells and back; the **column lane** resizes live (`797/797 -> 629/965`, persisted
`colSizes [0.79, 1.21]`, dragged back to `[1,1]`); and **Remove from grid** takes the panel out —
it is guarded by `window.confirm`, added 2026-09-17 after a stray click deleted a hub panel.

**THE FINDING: `cyclePanelStack` AND `Grid` DISAGREED, AND THE DISAGREEMENT WAS INVISIBLE.** The
cycler cycled **N+1** states — each panel, then "all hidden" — and Grid rendered a cell-level Layers
button *specifically* so you could cycle back out of the empty state. But Grid ALSO carries a
**"Defensive: ensure at least one panel per cell is visible"** effect that force-writes
`display: "block"` the moment a cell goes all-hidden. Measured on prod with two panels stacked:
```
start   A none   B block
press   A block  B none     <- the cycler's math says "all hidden" HERE
press   A none   B block
press   A block  B none
```
A pure A/B toggle. **Predicting that third state and not finding it is what identified the effect as
the cause** rather than leaving "the cycler is a toggle" as a shrug: the hidden state was
unreachable, the cell-level button was dead code, and every attempt cost a wasted `update_module`
write as the two rules fought.

**THE USER'S CALL: always keep one visible.** So the cycle is N states (`helpers/panelStack.js`
`nextStackIndex`, pure and tested), the defensive effect is the ONE authority on the invariant, and
the dead button goes — along with `hasHiddenStack`, which was computed, threaded through GridCell's
props and **read by nothing**. Net **-37/+16** across the two components. A/B: restoring the +1 state
in the helper fails 2 of 8; the source guards pin the wiring with a control that the cycler still
exists and still writes `display`.

**VERIFIED ON PROD BY CLICKING:** a fresh stack, cycled four times — **exactly one panel painted at
every step**, never none, and `button[title="Cycle panels"]` count **0**.

**TWO PROBE FAULTS, BOTH THE SAME SHAPE, AND THE SECOND NEARLY BECAME A BUG REPORT.** Dragging the
column lane at its vertical CENTRE did nothing three runs running — `elementFromPoint` there returns
the seam's **grip `<circle>`**, not the lane, so `onMouseDown` never fired. Aiming at a point the hit
test resolves to the lane itself works first time. Earlier the same day the canvas connect tool
"failed" for exactly this reason. *Before filing a gesture as broken, assert `elementFromPoint`
returns the element whose handler you expect.* And **"Remove from grid" appeared to do nothing**
because Playwright auto-dismisses `window.confirm` — the guard was working; the probe was declining
it.

**REPORTED, NOT FIXED — both pre-existing and neither touched by this change:** a cell can show TWO
panels at once (the invariant is "at LEAST one visible", not "exactly one"), which renders them
overlapping until something cycles; and a cycler press landing ~1s after the previous one is
sometimes dropped (3 of 3 presses land at a 3s settle, 2 of 3 at 1s).

---

### 2026-09-22 (16) — ALARMS RING ON A UI-MADE GRID; the half that files them into the Schedule cannot

Rebuild-via-UI, next area **alarms and scheduled operations** — poms runs 2 alarms (`atTimes`
06:30 / 17:00) and a 5-minute interval op; the rebuild had **none, and no time-triggered op at
all**.

**THE ALARM SURFACE IS SOUND, driven entirely from the toolbar dropdown**, and it was watched
firing twice by two different routes:
```
set 15:53 (3 min out)   fired 20:53:00.301Z          <- its own minute, to the second
set to the CURRENT minute   fired within 4s          <- the scheduler ticks ~5s
notification            toolbar pill "⏰ Alarm — 3:59 PM", title "… is ringing"
retime                  op renamed, schedule.times rewritten, lastFiredAt reset
delete                  gone, and STILL gone after a reload
```

**THE OTHER HALF IS UNREACHABLE ON ANY GRID BUT THE SEEDED ONE, and there are TWO independent
reasons — which is the point, because fixing one would not deliver it.**
1. `alarmScheduleSteps` (the 2026-07-20 feature: a fired alarm also drops an instance onto today's
   Schedule) is built only when `alarm.sched` is set, and the dropdown resolves that from
   `grid.meta.scheduleFieldIds`. **That key is written in EXACTLY ONE place —
   `createLiveData.js:6026`, the seed.** Nothing in the client writes it, while
   `pomodoroTargetContainerId` — the same shape, one field over — IS user-settable from the
   toolbar. So on a UI-made grid `sched` is null and those steps never exist.
2. **Even configured it would find nothing.** The steps FIND a container whose
   `scheduleFormat` value IS `"day-col"` and whose date is `SAME_DAY $today`, under a NAMED
   Schedule page occurrence. That is poms' day-column shape; the rebuild grid's Schedule page
   holds its slots directly, has no day columns and **no Schedule Format field at all**.

**So a settings picker alone would be a config for a pipeline that still cannot land anything** —
the day-column structure has to exist first. Said in that order so the next session does not ship
the picker and conclude the feature works. The same key also gates `PomodoroTimer`'s timeslot.

**A PROPERTY WORTH KNOWING BEFORE SOMEONE CALLS IT A BUG: the scheduler is CLIENT-side and only
runs in an OPEN TAB.** poms' `Schedule: Mark Passed Slots` (every 5 minutes) last fired **215
minutes ago** — exactly consistent with nobody having poms open. "The alarm did not go off" can
simply mean nothing was running.

**THREE PROBE FAULTS, and the first one invented a defect I nearly filed.**
```
the panel OPENS ITSELF when an alarm rings (Stop / Snooze live inside it)
  -> my "open the dropdown" click CLOSED the panel that had just opened
  -> Delete was never found, two runs left an alarm behind,
     and I read that as "the delete does not persist"
```
A clean run (no ring in flight) deletes and the op is **still gone after a reload**; the server's
own `delete_operation` was exercised separately and removes it. *An action that did not happen is
not an action that failed.* Also: the toolbar button's title becomes `"… is ringing"`, so a probe
that finds it by "Alarms & reminders" finds nothing at exactly the moment an alarm is going off;
and **my websocket frame logger attached AFTER the page opened**, so it captured zero frames for a
create that demonstrably persisted — the documented trap, paid again.

**Two things checked and NOT filed.** The row reading `3:56PM` against the clock's `3:58 PM` is an
`innerText` artifact — the row carries `ml-1`, so the gap is there on screen. And
`commandCenter/AlarmsTab.jsx` does not exist; alarms moved to the toolbar dropdown and the
ui/CLAUDE.md line naming that tab is historical, not an orphan file.

**Debris, all removed through the app:** 2 alarm operations and one empty "Board 2" canvas card my
probing minted. The grid ends at **315 occurrences**, the 4 original operations, integrity
**clean**. (A socket's `full_state` reports 307 — the deferred-chunk split, not a discrepancy.)

---

### 2026-09-22 (15) — BOTH LINKED-GROUP UNDO FIXES RE-VERIFIED, and the field you would reach for measures nothing

Entries (11) and (12) each shipped a fix and each claimed a prod check. This pass confirms both
**independently** — different pairs, different evidence — and answers the question neither asked:
*is the running process actually the fixed one?*

**THE DEPLOYED PROCESS WAS PROVEN, not assumed.** `pm2` reports the app under the `deploy` user at
`/var/www/moduli`, and prod HEAD is one commit behind local — a CLIENT-only commit, so no restart
was owed. The decisive pair of facts:
```
server/socketHandlers/occurrences.js   written 18:44:03 UTC
the node process                       started 18:45:09 UTC   <- 66s later
grep, in the deployed file             fan-out recordDoc 1 · "Broke link" 1 · nonsense control 0
```
*A file containing the fix says nothing until you show the process started after it was written.*

**THE FAN-OUT, ON A PAIR THIS SESSION DID NOT CREATE** (Library Oatmeal + its Meals copy, one
`linkedGroupId`, both on the Food page so one screenshot holds both):
```
                     source            copy
BEFORE            ["meal"]          ["meal"]
change source     ["meal","ingredient"]  ["meal","ingredient"]   <- fan-out reached it
ONE Ctrl+Z        ["meal"]          ["meal"]                     <- BOTH reverted
```
**AND THE OBVIOUS CONFOUND IS RULED OUT BY THE TRANSACTION, not by the values.** Both rows reading
`["meal"]` is ALSO what you would see if undo's own write simply fanned out again — which would
make the fix unnecessary and the test worthless. What settles it is the record:
```
1 transaction · 1 actionId 9ef5022c · docs: 2
   SOURCE  before ["meal"] -> after ["meal","ingredient"]
   COPY    before ["meal"] -> after ["meal","ingredient"]
```
The snapshot **names the copy**, so undo had something of the copy's to restore. Before `a8505849`
that array held one entry. *Measure the mechanism, not the outcome, when a broken build produces
the same outcome.*

**BREAK LINK, watched end to end on the non-feed Breakfast pair** (6:00am copy, 7:00am source):
```
                 source.lg    copy.lg    both rows on screen
BEFORE            87a5788a    87a5788a          yes
Break Link        87a5788a    NULL              yes
ONE Ctrl+Z        87a5788a    87a5788a          yes    <- and NOT deleted, which was the bug
```
Mongo agrees on both counts, and the trail carries `desc: "Broke link", state: undone`.

**THE TRAP THAT WOULD HAVE SENT THE NEXT PERSON THE WRONG WAY: `Logged On` IS THIS GRID'S FILTER
FIELD, so it is DELIBERATELY EXCLUDED from the fan-out** (`utils/filterFields.js` — a filter field
describes the PLACEMENT, and two copies in two columns must be free to disagree). It is also the
only field the Breakfast rows bind and the one visibly on every row, so it is exactly what you
reach for — and a copy that correctly does not follow reads as "the fan-out is broken". The test
needs a field the grid does NOT filter on; `Board Category` is one.

**A/B'd, with each arm asserted to land** — the file restored from `git show <commit>^` and the
suite re-run:
```
fan-out fix removed        2 fail   (exactly its own two; break_link's still pass)
both fixes removed         6 fail
shipped                    8 pass
```
**2 of the 8 pass in BOTH arms and are reported as contract pins, not coverage.**

**Three probe faults, all mine.** An occurrence id **prefix is not an id** — `17900892` matched
Oatmeal AND Chicken salad, two different rows, because these ids are timestamps. The row attribute
is **`data-occurrence-id` on `.instance-wrap`**, not `data-occ-id`. And **the radial arc's items are
icon-only**: scanning text AND `title` found nothing on an arc that a screenshot showed wide open —
Break Link is findable by its colour class (`bg-orange-600`). *Looking at the screenshot is what
ended three rounds of querying a DOM that was already correct.*

Grid integrity **clean**; both changes undone, so net data change is zero.

---

### 2026-09-22 (14) — ELEVEN ITEMS ON A RING THAT HOLDS EIGHT: "Settings" WAS A CONVERT BUTTON

Rebuild-via-UI, next area **styles** — the gap the census named: poms carries **468 occurrences
with `ownStyle` and 193 styled modules**; the rebuild grid carried **0**.

**I NEVER GOT TO THE STYLE TAB, BECAUSE OPENING IT CONVERTED THE CONTAINER.** Twice. The radial's
`getAnglesForDirection` spaces items a FIXED 45°, so eight fill a full revolution and the ninth
lands on the first. The container menu had ELEVEN items, and the three that lost are the three you
reach for:
```
Settings     [790,73,28,28]  -> elementFromPoint says "Convert to Canvas"
Set to Copy  [820,61,28,28]  -> "Convert to Table"
Hide Header  [850,73,28,28]  -> "Convert to Graph"
```
Identical boxes, destructive item on top. **A screenshot is what made it undeniable: 8 circles for
11 items.** So Settings was not merely mis-aimed — it was unreachable, and the click where the gear
sits changes what the container IS.

**THE PROBE GUARD IS WHAT FOUND IT, AFTER THE PROBE CAUSED IT.** My first run clicked the rect of
the element titled "Settings" without asking what was under the point — the plain
`querySelectorAll('[title]')` click this repo's probes have used for months. Adding *"hit-test the
point and REFUSE when the element under it is not the one you asked for"* turned a silent
conversion into `REFUSED — "Settings" is covered by "Convert to Canvas"`. *A click that lands is
not a click that hit what you named.*

**THE USER'S CALL IS THE BETTER FIX, and it is also the sizing fix:** *"make a convert submenu so we
dont have 4 convert buttons on the arc menu. one convert button"*. One `Convert` item whose submenu
REPLACES the arc (with `Back`) takes the menu from 11 items to **8** — exactly the ring's capacity —
and keeps one interaction model instead of a second ring.

**AND THE ARC CAN NO LONGER STACK, which is the part that generalises.** `arcAngles` caps the step
to fit the ring and grows the radius until neighbours keep a whole button of room. **Calibrated
from the geometry that already worked** — 45° at r=42 is a 32.1px chord for a 28px button, so
`ARC_ITEM_GAP = 4` leaves every menu that already fit measuring identically. That equality is a
CONTROL TEST, because "items never overlap" is equally satisfied by pushing every ring outward.

**VERIFIED ON PROD BY CLICKING, and the table is the whole claim:**
```
top level   8 items   Settings · Set to Copy · Hide Header · Filter Override ·
                      Apply Template · History · Remove · Convert      each hits ITSELF
Convert ->  Back · Doc · Canvas · Table · Graph                        each hits ITSELF
Back    ->  back to the 8
```

**THEN THE AREA I CAME FOR, and the cascade is sound.** Every level driven through the Style tab
(which opens now), with the two sibling containers as controls:
```
                         Physical            Mind / Social (controls)
module own = orange      paints orange       unchanged
+ placement = blue       paints BLUE         unchanged          <- nearest wins
revert                   back to inherited   unchanged
```
The placement level is the one that matters on poms: its 400 occurrence styles are written by
`Schedule: Mark Passed Slots`, not by hand, so it was exercised through the same `update_occurrence`
the op uses. **A stored `0.28` paints at `0.24`** — the documented `SURFACE_ALPHA` cap, checked
against 2026-08-17 rather than filed as a defect.

**REPORTED, NOT FIXED: the custom-colour field takes any string.** My probe typed into it twice
without clearing and the module stored
`"rgba(255,140,0,0.28)rgba(255,140,0,0.28)rgba(255,140,0,0.28)"` with no complaint. A text input
appending where you put the caret is ordinary; a style value that cannot parse is not, and
`withSurfaceAlpha` returns an unrecognised value UNCHANGED, so a typo can leave a surface unpainted
with nothing said.

**Three more probe faults, all mine:** `.radial-menu button` matches nothing (the arc is portalled
with class `radial-menu-item`) and read "0 items" on a menu that was open; picking a Radix Select
option DISMISSES the settings popover, so the next step must re-open rather than assume; and the
first two "Settings" clicks are the conversions above — **checked, not assumed, to have left
nothing**: Physical came back byte-identical to its untouched sibling on every key.

**Debris, all removed:** both probe styles cleared through the app's own events (grid-wide
`ownStyle` occurrences **0**, modules with `styleMode: own` **0**, Physical vs Mind differing keys
**{}**), and the 3 orphan "New card" modules account3's sweep had held back as too young were swept
with a backup. Integrity **clean**.

Client **4,778 pass**, the 1 failure the documented `trackerValues` OOM family. A/B'd: the fixed-45°
version fails the overlap test; a submenu that never replaces the arc fails the submenu test.
Deployed client-only.

---

### 2026-09-22 (13) — THE FILTER CASCADE: DEACTIVATING ONE WAS NOT UNDOABLE, AND REACTIVATING IT LEFT IT OFF

Rebuild-via-UI, next area **filters** — picked because it was the one major surface with **zero**
coverage on the rebuild grid, measured rather than guessed:
```
                filters  filterOverride  filterNavConfig
poms grid          3           13              65
poms rebuild       0            0               0
```
That is the cascade poms' whole schedule and every day page resolve through.

**THE CASCADE ITSELF IS SOUND, and the control is what makes that mean anything.** Stepping the
toolbar date empties the Schedule and stepping back refills it; turning the inherited date filter
OFF on **7:00am only** keeps its rows while its sibling empties:
```
              Sep 21 (before)                       Sep 22
6:00am        [Breakfast, Wake Up]                  []          <- control, still filtered
7:00am        [Wake Up, Stretch, Breakfast]         [Wake Up, Stretch, Breakfast]   <- overridden
```

**AND THE EMPTY SCHEDULE ON AN UNBUILT DAY IS NOT A DEFECT — checked against poms rather than
assumed.** Every slot child on BOTH grids carries a specific date (`poms 7:00am -> Hygiene
2026-08-10`); poms has **22** "7:00am" slots because its build ops mint one per day. The rebuild
grid has no such op, so tomorrow is empty by construction.

**DEFECT 1 — TURNING A FILTER OFF WAS TWO TRANSACTIONS, AND THE HALF THAT DID SOMETHING WAS NOT
UNDOABLE.** Read out of the `transactions` collection after one click:
```
seq 2125  action 01b43867  filterNavConfig  {} -> {filter_...: {visible:false}}   <- the cosmetic half
seq 2126  action null      filterOverride   null -> {date: null}                  <- the actual change
```
An unstamped write is recorded `derived` and the undo stack skips it, so **Ctrl+Z un-hid the nav
widget and left the filter deactivated.** Same class as 09-22 (8)'s `createPageInContainer`.

**THE STAMP GOES ON THE GESTURE, NOT ON THE COMMITHELPER, and that is the load-bearing decision.**
`updateOccurrenceFilterOverride` is also how an operation moves a page's filter
(`bindSocketToStore` UPDATE_ITEM_FILTER_OVERRIDE) and how a nav arrow steps a date; wrapping it
would make every app-authored filter write an undo step — the failure `actionScope.js` already
records (*one checkbox, 201 action ids, so Ctrl+Z undid the last derived write*). The line that
falls out: **navigating a filter is not an edit — the toolbar's date step writes no transaction at
all — while configuring one is.** `helpers/filterConfig.js` is the three configuration gestures,
each in one `withAction`; deactivate's two writes share it, because undoing half leaves a filter
that is off with its nav missing.

**DEFECT 2, FOUND BY WATCHING THE FIRST FIX WORK: turning a filter back ON left it OFF.** The probe
reported the Active switch still reading `false` after an activate. `selectors.js:335` is why —
`if (Object.keys(override).length === 0) { effective = {} }`: an **empty override object means
"clear every filter at this level"**, a real stored value the seeded Daily Toolkit / Todo / Notes
pages carry on purpose. Deleting the only key left `{}` behind, so the gesture switched the filter
off *and silently cleared every other filter there too*. `null` is the value that means "no opinion
here". Pre-existing — the old `setMuted` deleted the key the same way — and the refactor one commit
earlier preserved it faithfully, which is how it became visible.

**VERIFIED ON PROD THROUGH THE UI, the whole gesture in one table:**
```
                 filterOverride              nav       switches
Active ON        {date: 2026-09-22}          hidden    Active on
Nav ON           {date: 2026-09-22}          visible   Active on · Nav on
Active OFF       {date: null}                hidden    both off        <- ONE action, two docs
ONE Ctrl+Z       {date: 2026-09-22}          visible   both back on    <- both halves
relock           null  (inherit, not {})     -         Active on       <- defect 2 fixed
```

**MY OWN PROBE MISLABELLED ITS STEPS AND THE SWITCH STATE IS WHAT CAUGHT IT.** The first run read
only the STORED value, so it recorded a second *activation* as a "deactivate" and would have
reported the two-write case verified when that path never ran. Reading `aria-checked` beside the
override is what exposed defect 2 at the same time. *A gesture probe that reads only the data has
no way to know the control it clicked did something else.*

**Debris, all removed:** the `filterNavConfig` key my probes left on the 7:00am slot (cleared through
the app's own `update_occurrence`, on a socket joined to this grid), and the 3 orphan "New card"
modules account3's sweep correctly held back as too young to judge — old enough now, swept with a
backup. The grid ends where it started: **315 occurrences, 0 filter keys of any kind, integrity
clean.**

**A/B, both fixes, each mutation asserted to land:** stripping `withAction` fails 4 of 5; wrapping
the CommitHelper instead — the tempting wrong fix — fails exactly the control that keeps an op's
filter write derived; restoring the `{}` write fails both inherit cases while the control (an
override still holding another field) passes in both arms. Client 4,769 pass; the 1 failure is the
documented `trackerValues` OOM family. Deployed client-only, so `deploy.sh` correctly reported
*"Server unchanged — NOT restarting"*.

---

### 2026-09-22 (12) — UNDOING A COPY-LINKED CHANGE LEFT THE COPIES CARRYING THE NEW VALUE

The last of the linked-group undo gaps, open since the account3 handoff (*"undo of a copy-link
fan-out reverts only the SOURCE"*). `update_occurrence` propagates a field write to every member of
the group and recorded **one doc — the row you edited**. So undo put the source back and left every
copy on the new value. **A half-reverted group is worse than no undo:** the members disagree, and
the next edit fans one of them back over the other.

**MEASURED BEFORE WRITING IT, across every grid, because this is the hot write path:**
```
671 linked groups · 1548 members · largest group 16 · members carrying a textmap  0
```
The zero is what made it safe: the fan-out adds FIELD-ONLY snapshots, never a gzip per member. And
`planUndoSync` has no doc-count limit, so even a 16-doc transaction keeps the incremental path.
Each member is recorded under the SAME `__actionId` as the source write, **after** its upsert lands
(recording a write that then failed would put a value in the trail the database never held).

**VERIFIED ON PROD THROUGH THE UI, on a pair minted by a copy-link drag:**
```
before      src=false  copy=false
tick src    src=true   copy=true     <- the fan-out
ONE undo    src=false  copy=false    <- BOTH, read back out of Mongo
transaction 74219f40 "2 changes" [undone]  docs: 9d92f9a2 17901028
```
The transaction label says it: one gesture, two docs, one press.

**A "LOST ROW" THAT TURNED OUT TO BE THIS MORNING'S FIX WORKING.** The drag that minted the pair
reported *"could not settle the pointer inside 9:00am"* and still created a copy with `parentId:
null` **listed by nobody** — the exact signature of the row the 09-22 (2) entry chased. It is not a
defect: scanning every textmap found it **embedded in "How This Grid Works"**, i.e. the pointer
missed the slot and released over the doc page, and `352ff999` correctly minted a LINKED copy and
embedded it. *"Listed by nobody" is only a defect on a surface that renders its list; a doc renders
its textmap.* Checking that before filing it is the whole difference.

**Probe debris, all removed:** the embedded copy (its doc radial says **Remove** — an unlink, because
the doc does not own it — so it was then deleted through the app's own `delete_occurrence`), the lone
group the drag left on the source (cleared with Break Link), and the drag mode cycled back to Move.
`sweepOrphans --grid "poms rebuild" --apply` took one orphan module left by the OTHER account's undo
probe (**undoing a row create deletes the occurrence and leaves the module** — the documented
lifecycle the sweeper exists for) and **correctly KEPT three modules only 32-41 minutes old**,
"placement may be in flight". Grid integrity **clean**.

**FOUND IN THE SAME TRAIL, REPORTED NOT FIXED: a copy-link drop onto a DOC is THREE undo steps.**
```
18:48:20  af3fe439  source[update]     <- three action ids
18:48:20  033cc0a1  copy[create]
18:48:20  1e08c0f3  doc[update]           the textmap that embeds it
```
Same class as (10), but it does NOT yield to the same fix: the doc's textmap write goes through the
editor's DEBOUNCED save, so a synchronous `withAction` around the drop handler cannot contain it.
Grouping it means keeping the action open across the debounce, which is the save path for every
document on the grid — its own reviewed pass, not the tail of this one.

**Two probe faults, both mine, both silent:** `delete_occurrence` takes `occurrenceId`, not `id`, so
my first delete returned early and reported "STILL PRESENT" as if the handler were broken; and
`querySelector('[data-occurrence-id="<prefix>"]')` needs the FULL id — a prefix matches nothing,
which reads exactly like "the embed is not rendered". The doc also has to be SCROLLED first, or its
lazy editors have not mounted the embed at all.

---

### 2026-09-22 (11) — UNDO AFTER "BREAK LINK" DELETED THE ROW, because the break recorded nothing

The other half of what the user said yes to: the **linked-group undo gaps**. `break_link` nulled
`linkedGroupId`, saved and broadcast, and called `recordDoc` **zero times** — the only `recordDoc`
in `socketHandlers/occurrences.js` is inside `update_occurrence`. The 09-22 entry reported this as
*"Break Link is not undoable"*. **It is worse than that, and only doing it on prod showed why.**

**MEASURED ON A PAIR MINTED BY A COPY-LINK DRAG, read out of the `transactions` collection:**
```
fd0bb37f   source[update] + copy[create] + parent[update]   the DRAG, one action
Break Link                                                  NO transaction at all
Ctrl+Z     undid fd0bb37f                                   the ROW was deleted
```
So undo did not fail quietly — **it reached PAST the break to the gesture before it and destroyed
the row the user had just broken out of the group** (the copy gone from Mongo, the source's
`linkedGroupId` reverted with it). *"Not undoable" and "undo does something else" are different
reports, and the transaction log is what tells them apart.*

**BOTH HALVES, because either alone is inert** — the same shape as (10) an hour earlier.
`CommitHelpers.breakOccurrenceLink` opens an action ("Broke link") so the emit carries
`__actionId`; unstamped, the recorder marks the transaction `derived` and the undo stack SKIPS it.
The handler snapshots before/after around the null, so undo's `$set` puts the group id back.
Recording is wrapped so it can never fail the write — the posture `update_occurrence` already takes.

**VERIFIED ON PROD THROUGH THE UI, and the trail names it:**
```
break       group 2 -> 1
ONE undo    group 1 -> 2, the row intact
mongo       both rows carry lg 9ede1fdc-b6e1 again
18:39:13    action 30bfa289  "Broke link"  [undone]   <- its own transaction now
18:39:06    action 175250c2  "Created item" [applied] <- the drag, no longer reached
```

**MY OWN A/B WAS VACUOUS AND THE ASSERT IS WHAT CAUGHT IT.** The "recording must never fail the
write" case passed a `__throw` flag on the socket PAYLOAD — which never reaches `recordDoc`, so the
recorder never threw and the test proved nothing. It drives a real throw through the mock now and
asserts the recorder was actually reached. *Third time this file records a green test that was
measuring nothing; the fix each time was to assert the mutation LANDED.*

**Probe debris, all removed through the app:** the copy-link copy my probe minted (deleted via its
radial), the source row's drag mode cycled back to Move, and the lone one-member group the drag left
on the source — cleared with **Break Link itself**, which is now a recorded, undoable gesture. Five
linked groups on the grid, all 2 members, exactly as before; integrity **clean**.

**STILL OPEN, unchanged and stated again:** undo of a copy-link FAN-OUT reverts only the SOURCE —
the server propagates a field write to every group member but records one doc, so the copies keep
the new value. That is a second recording gap in the same handler, on the hot write path, and it
wants its own pass.

---

### 2026-09-22 (10) — A CARD ADDED ON A CANVAS LEFT AN INVISIBLE ROW BEHIND, and one gesture was not undoable at all

Rebuild-via-UI, next area **canvas** (picked up mid-probe from the other account: it had made the
Canvas page, drawn a pen stroke — persisted, `meta.drawData`, 1 stroke — and was reading how a card
with no `meta.x/y` is placed). Reading that placement code found a bigger thing next door.

**DEFECT 1 — DOUBLE-CLICKING A CANVAS MINTS A CARD, AND ONE Ctrl+Z LEFT THE OCCURRENCE BEHIND.**
Measured on prod through the UI before anything was changed:
```
dblclick     page lists [Board 1, New card @2154,1946]   parented to the page: 1
ONE undo     page lists [Board 1]                        the row is STILL in the store
```
`PageCanvas` hand-rolled `createModule` + `createOccurrence` + `updateOccurrence` — three writes
under **TWO action ids**, so undo popped the newest (the page's list) and left the create applied.
**That is the exact shape of (8) this morning and of the 22 unreachable rows repaired in (7)**, at a
third site. It calls `createLeafInstanceInParent({ occMeta: {x, y} })` now — one action, and the
helper also fires OccurrenceCreateOp and stamps the page's filter fields, which the hand-rolled
version skipped, and omits the junk `kind:"board"` (inert on an instance leaf, and it wins the icon
resolver).

**DEFECT 2 — AND THE OTHER CANVAS GESTURE WAS NOT UNDOABLE BY ANY NUMBER OF PRESSES.**
`createInstanceInContainer` — behind the canvas-CONTAINER double-click, the pool's add box and the
radial's "Duplicate (new instance)" — emitted through raw `safeEmit` with no action open, **and the
server handler called `recordChange` zero times**, so there was no transaction for undo to find.
Stamping the client write alone would have been worthless; *that* is the half worth keeping —
**`break_link` still has exactly this hole** (recorded 09-22). Both halves fixed: `withAction` on
the client, and the handler records the new row (`before: null`) plus the parent's list write under
that one actionId, the same contract `create_occurrence` has at crud.js ~1612.

**THE TRANSACTION LOG IS THE PROOF, and it names the change in one table:**
```
before fix   18:15:36  action 568226c1  4a21b1ae[create]
             18:15:36  action c9926101  page[update]                 <- the list, a SEPARATE action
after fix    18:24:20  action 9adc4f9b  page[update] + 86fb54cc[create]   <- ONE transaction
```
Verified on prod after deploy by repeating the gesture: one undo, the card gone from the page AND
`present: false` in the store; canvas page lists 1 child, **0 rows parented to it**, grid integrity
**clean**.

**MY OWN PROBE DELETED THE TWO PRE-EXISTING ORPHANS, and the log is how I know rather than guessed.**
A "does Duplicate undo?" probe pressed Ctrl+Z **twice with nothing of its own to undo** — the radial
on that row offers Settings · Set to Copy · Hide Header · Toggle doc · Delete · Convert to Textblock
and NO "Duplicate (new instance)", so the gesture never ran. The two presses popped the newest
transactions in the USER's stack, which were the two pre-fix orphan creates (`superseded` in the
table above). The rows are gone and the grid is clean, but nothing about that was intentional.
*Ctrl+Z in a probe is not a no-op when your own gesture did not fire — it undoes someone else's
work.*

**THE REST OF THE CANVAS SURFACE IS SOUND, every part of it driven by clicking:** a card dragged by
its handle persists a real world position (`meta.x/y` `null,null -> 1895,1884`, so the fallback hands
over exactly as its comment claims); the **connect tool** links two cards and the edge persists
(`meta.edges` `ed57ec1d->f8cc67fd`, 2 paths in the DOM); and **deleting a connected card takes its
edge with it** (`edges: []`, read back out of Mongo) — no dangling ref. The pen stroke the other
account drew is still there (1 stroke in `meta.drawData`).

**AND THE "Add container" BUTTON LEAVING NO `meta.x/y` IS NOT A DEFECT — measured rather than
assumed.** A position-less card falls back to a tidy stack near the world CENTRE (`PageCanvas`:
`1760 + col*260 / 1850 + row*110`), and on screen both such containers render INSIDE the viewport,
110px apart. The other two canvas renderers disagree with that fallback — `ModuleContainer`'s
`renderCanvasCard` uses `?? 20` (the corner, off-screen in a 4000px world) and `ModulePanel`'s
canvas-tree panel passes NO `renderCard` at all — but a census says **both paths are dead: 0 canvas
CONTAINERS on any grid (only 3 canvas PAGES), and the one `viewType:"canvas" hasTree` view is an
orphan no occurrence points at.** Reported, not "fixed": writing code for a surface nothing reaches
is how a wrong fallback gets a second home.

**MY CONNECT-TOOL PROBE REPORTED A DEFECT THAT WAS MY AIM.** The first run dragged card-to-card and
produced nothing, which reads exactly like a broken tool. `onWorldPointerDown` bails on
`[data-dnd-handle]` and hit-tests `[data-occurrence-id] / [data-occ-id]` — my points were 20px from
the card's top, i.e. the handle. Aiming at a point the app's OWN hit test resolves makes it work
first time. *Reproduce a UI failure through the handler's own predicate before believing it.*

**A/B, both sides, each mutation asserted to land:** removing the server's `recordChange` block
fails all 4 of `createInstanceUndoable.test.js`; unwrapping the client helper fails exactly the
action-id case; restoring PageCanvas's hand-rolled triple fails exactly the wiring guard. One
existing `CommitHelpers` assertion pinned the literal emit payload and now asserts the stamp.
**Not clicked, and said plainly:** "Duplicate (new instance)" is not reachable from that radial, so
that caller of the fixed helper is unit-tested only.

---

### 2026-09-22 (9) — FOLDERS: AN EMPTY ONE COULD NOT BE RENAMED, AND A RENAME STOPPED AT THE FOLDER

Rebuild-via-UI, next area **folders** (poms files its pages in them: Boards · Library · Day Pages ·
Imports). Built through the tree: **New folder -> rename -> "New page…" inside it -> rename the
page**. The rebuild grid now carries `Boards/Body`, `Library` and `Media`.

**DEFECT 1 — DOUBLE-CLICK, THE DOCUMENTED RENAME, DID NOTHING ON AN EMPTY FOLDER.** A childless
folder has nothing to expand, so its pill NAVIGATES (2026-08-25, deliberate: *"a click that visibly
does nothing reads as broken"*) — and that navigation swapped the panel out from under the second
click, so the row's own `onDoubleClick` never fired. Right-click -> Rename was the only way in.
**The control is what made this a defect rather than a guess:** the same double-click on `Files`
(which HAS children, so its click only expands) opens the rename every time.
```
                        dblclick opens rename
folder WITH children             YES        <- control
EMPTY folder                     NO         -> panel navigated to its page instead
```
The open is deferred one double-click window (260ms) and cancelled when a second click arrives.
**No unit test — it is a timer inside `FolderNode`, which needs the whole tree mounted** — so it was
verified in a browser on prod, BOTH halves: dblclick renames the empty folder, a single click still
opens it.

**DEFECT 2 — RENAMING A FOLDER LEFT ITS OWN PAGE WEARING THE OLD NAME.** Measured: the `Library`
folder's page still read `New Folder`, and that label is what the panel header, the folder card and
the tree's page row all show — so the rename looked applied in the tree and nowhere else.
`helpers/folderRename.planFolderPageRename` is the rule, pure and tested (4 cases): follow the
rename only while the page still wears the folder's OLD name, **never a title the user chose** — the
precedence `addBookmarkOccurrence` already uses for a fetched `<title>`. Verified on prod: rename the
folder, its page follows (`New Folder` -> `Media`).

**PROBE FAULTS, three, all mine:** the tree renders only what is EXPANDED (a collapsed Root shows
none of its folders, which reads as "the new folder is invisible"); a panel-wide text search finds
the PAGE HEADER before the tree row, and I renamed a folder page by accident that way; and opening a
folder page CLOSES the tree, so the next lookup in the same probe throws. *Scope a tree lookup to
the tree, not to the panel.*

---

### 2026-09-22 (8) — A TABLE BUILT BY CLICKING; and ADDING A ROW WAS TWO UNDO STEPS, the second an orphan

Rebuild-via-UI, next areas **table containers** and **undo/redo**.

**THE TABLE SURFACE IS SOUND — every part of it driven by clicking** on the Food page: create
(`Table` tile) · rename the container · add a column · add rows · name the columns (`Item ·
Calories · Protein`) · remove rows · type into cells. Read back out of Mongo:
`meta.table.columns = Item | Calories | Protein`, `rowCount 3`, `cells { 0:0 "Chicken Breast",
0:1 "165", 0:2 "31" }`. **Three probe faults, no app defects:** a table's rows are `.table-row` /
`.table-td` (no `tbody`/`tr`, so a `tr` count reads 0); **a cell mounts its editor only while
HOVERED or focused**, so a click without a hover first lands on static text and the keystrokes go
nowhere; and `renameContainer`'s own verification failed while the rename itself worked.

**UNDO: A FIELD CHANGE AND A DELETE ARE BOTH CORRECT.** Ticking `Done` then Ctrl+Z put it back
(`false -> true -> false`, read from the store); deleting a row then Ctrl+Z restored it **in place
and with its fields** (`Logged On`, `Task Ref` intact). **Redo is deliberately OFF**
(`REDO_ENABLED = false`) and its absence in the toolbar is by design, not a new defect.

**BUT ADDING A ROW WROTE TWO TRANSACTIONS, AND ONE UNDO LEFT AN INVISIBLE ROW BEHIND.**
```
seq 2062  action f2a85827  "Created item"        occurrence:9c9216c8 (create)
seq 2063  action 21d2bb50  "Updated occurrence"  occurrence:fff9474f  (the parent's list)
```
`nextUndoable` takes the newest, so **Ctrl+Z popped the LIST write and left the create applied**: the
row vanished from the board and the occurrence stayed in Mongo, parented to the container and listed
by nobody. **That is exactly the shape of the 22 unreachable rows repaired in (7) hours earlier** —
this session found the mechanism by accident while testing something else.
`createLeafInstanceInParent` + `createLeafInstanceAtIndex` now wrap create-and-list in ONE
`withAction` (it nests, so the inner helpers reuse the id).
**And two more were worse, found by tightening the test rather than by looking:**
`createPageInContainer` and `addBookmarkOccurrence` emitted their first writes through raw
`safeEmit` with **no action open at all** — recorded `derived`, i.e. **not undoable by any number of
presses**. Both wrapped. *An assertion that filters out the unstamped writes cannot see the write
that carries no id.*
**Verified on prod through the UI:** add a row -> ONE transaction carrying both docs -> one undo ->
**0 rows left in Mongo**. The orphan the old behaviour had already made was removed through the app.

---

### 2026-09-22 (7) — THE 22 UNREACHABLE ROWS: 12 RESTORED, 4 WOULD HAVE BEEN DUPLICATES

The user's call on (2)'s finding: *"Just the 16 food rows"*. Re-measured before writing rather than
inherited — 27 rows whose parent does not list them, of which **5 render elsewhere** (multi-parented,
fine) and **22 are listed by nobody**. The 16 food rows (10 Ingredients + 6 Grocery List, all
2026-07-28) were re-attached with the app's own atomic `link_occurrence_to_parent`, on a socket
**joined to poms grid** — the wrong-grid relink earlier today wrote Mongo and left the warm cache
untouched, so the row stayed invisible. Backed up first (`poms-unlisted-food-backup.json`).
```
              listed in mongo   listed in cache   rows present in cache
before              0/16              0/16                16/16
after              16/16             16/16                16/16
```
**VERIFIED ON SCREEN, not just in the data:** the Ingredients board renders Rice · Spinach · Greek
Yogurt · Oats · Salmon · Olive Oil · Sweet Potatoes · Black Beans with their Calories/Protein/Carbs/
Fats chips; Grocery List renders Milk · Bananas · Coffee Beans · Paper Towels.

**AND FOUR OF THE SIXTEEN CAME BACK AS A SECOND COPY — reverted.** The restored rows are the JULY
SEED shape (8 fields); the user has since built richer rows for some of the same items:
```
Eggs · Greek Yogurt      twin has 30 fields              -> unlisted again
Chicken Thighs · Frozen Berries   twin is a 23-field feed copy   -> unlisted again
the other 12             no twin in that board           -> kept
```
Unlisted through `update_occurrence` on the parent (there is no unlink event; a drag-out writes the
parent's list the same way). The 4 rows themselves are untouched and still exist — the board is
exactly as it was this morning. *A row that is missing and a row that is superseded look identical
until you compare FIELD COUNTS against what already renders.*

**AND THE SEARCH FINDS THESE ROWS — my probe was the thing that could not.** `buildSearchIndex`
walks every occurrence in the store, reachable or not, so an unlisted row was always findable;
typing into the page instead of the search input, then reading the wrong markup, reported "no hits"
twice. Picking the hit whose path reads `Ingredients › Ingredients` opens the page; **the first of
six same-named hits opened nothing** — the results are not disambiguated by path in the picking
order, which is a real UX edge, reported not fixed.

---

### 2026-09-22 (6) — BUILDING AN OPERATION BY CLICKING FOUND TWO DEFECTS IN THE EDITOR ITSELF

Rebuild-via-UI, next area **operations**. The rebuild grid already had three (2 onLoad, 1 onButton),
so the untested surface was a TRIGGERED pipeline with branches. Built one by clicking, end to end:
**"Stamp Logged On"** — tick `Done`, and the row's `Logged On` date fills in.

**DEFECT 1 — THE PATH PICKER DESCRIBED `$trigger` AS AN OCCURRENCE.** The Steps header says *"use
$trigger.* directly"* and the trigger row prints what it carries. But `BUILTIN_VAR_SHAPES` mapped
`$trigger: "occurrence"`, so drilling into it offered:
```
id · moduleId · parentId · _ancestors · label · templateId · fields ·
meta.x · meta.y · meta.date · filterOverride · _effectiveFilter
```
**Not one of those is a trigger prop, and `occurrence` — the key the executor really sets and the
one 105 live operations reach through — was MISSING.** So the picker offered paths that resolve to
undefined and hid the only one that works. A picked path is not a typo you can spot: it renders as
a chip chain and reads as correct. New `trigger` shape, its prop list derived from `getTriggerVars`
(the same function the trigger row prints from), which moves to `helpers/triggerTypes.js`.
**A/B'd on the one-line mapping: 5 of 7 fail, 2 controls pass in both arms.** One assertion was
CORRECTED BY THE DATA — `parentId` reads as occurrence-only and is a real trigger prop for
onAdd/onRemove.

**DEFECT 2 — `$trigger.value` WAS ALWAYS UNDEFINED, and the editor DEFAULTS its condition to it.**
With the picker fixed, the op was built and watched:
```
untick Done   Logged On "2026-09-21" -> null    (the ELSE branch)
tick Done     Logged On null         -> null    (the ELSE branch AGAIN)
```
Both took `else`, because `String(undefined) !== "true"`. **Every MeasureOp emitter carries the
change as `fields: { [fieldId]: … }`** — CommitHelpers' two sites and bindSocketToStore's echo — and
nothing lifted it into `$trigger`. Enriched in the EXECUTOR, one place, so all three emitters are
covered; both emitter shapes (raw value / stored `{value, flow}` cell) are read. Scoped to a SINGLE
changed field: with several at once `$trigger.value` cannot mean anything, and taking the first key
would make a guard depend on object key order — that case is a test, not a guess.

**MEASURED OVER ALL 235 LIVE OPERATIONS BEFORE CHANGING IT**, which is what says this is safe:
```
$trigger.occurrence   105 ops   <- the path that works
$trigger.fieldId        2       <- guards that could never pass
$trigger.value          2       (one of them mine)
previousValue / flow / changedField / itemId   0
```
So the enrichment revives what was dead and cannot change an op that was working. **My first scan
reused one `/g` regex across the loop — `lastIndex` carries between iterations — and its counts were
wrong; the numbers above are the re-run.** *A `/g` regex is stateful; a fresh one per test, or the
tally is fiction.*
**NOT fixed, stated plainly:** `$trigger.previousValue` is still undefined. No emitter carries a
before-value (fireOperations runs after the local occurrence is updated), so it needs the three call
sites, not the executor.

**THE OPERATION, BUILT ENTIRELY BY CLICKING AND WATCHED WORKING:**
```
trigger   On Change · Field · Done
if        $trigger.value IS "true"
  then    Set field  Logged On = $today
  else    Set field  Logged On = (null)

untick -> null          retick -> "2026-09-22"        read back out of Mongo
```
**Editor findings worth keeping:** the action-type control is a DRILL-DOWN, not a list — `Update` is
a category and `Set field` is the leaf that commits (clicking `Update` drills in); its rows are
DIVs, not buttons; `Set field` pre-fills its target with `$trigger › occurrenceId`; and **the
editor's state is LOCAL until Save**, so reading the store mid-build shows the last SAVED pipeline —
which misled me twice before I noticed.
**Left in place deliberately:** a leading `INIT_VAR $occ = $trigger.occurrence` that nothing reads —
Set field defaults its own target. Removing it means more blind clicking on a working operation, and
the trigger survived one such click only by luck.

---

### 2026-09-22 (5) — A FEED ON ONE GRID COPIED ANOTHER GRID'S ROWS, and tagged the originals on the way

Picked up the other account's session (limit at 09:36 CDT, mid-repair). Its last finding, continuing
*"we are diagnosing and creating poms grid over using the ui"*: switching the rebuild grid's
**Ingredients** container to Feed On minted **50 copies of POMS GRID rows** under it.

```
Ingredients (rebuild 6ab15587)   50 copies parented here
  copies   gridId 6a690f6f (poms)      sources  gridId 6a690f6f (poms)
  poms rows written 14:27-14:29   50   <- linkedGroupId stamped on rows nobody was editing
```
Invisible in BOTH grids — the parent lives in one and the rows name the other — so nothing on screen
would ever have shown it. **THE LEAK: every occurrence write is broadcast to the USER room, not the
grid room** (`socketHandlers/occurrences.js:443` and ~20 more sites), so every tab of a user holds every
other grid's rows. `_syncAllFeeds` then walked the whole map for `feed.enabled` with no grid check.

**TWO GUARDS, AND NEITHER SUBSUMES THE OTHER** — which the A/B is what established, because the pull
guard alone makes the owner test pass vacuously:
```
pull side  (selectors.js)  a candidate from another grid is never a source    <- today's shape
owner side (feedSync.js)   a feed owner from another grid is skipped whole    <- 2026-09-21's 87
```
The second covers a foreign owner pulling its OWN rows, which the pull guard ALLOWS (owner and sources
agree), minting copies stamped with THIS tab's grid id. A row naming NO grid is a local optimistic mint,
so only an explicit disagreement is dropped — the asymmetry the overlay guard already uses. 6 tests,
**3 fail without the owner guard, 3 controls pass in both arms.** 126 feed + selector tests. Served
chunk sha256-identical to the local build, the guard readable in the minified bytes.
**Reported, not fixed:** the user-room broadcast itself. A tab holding three grids' rows is the root,
and it is a live write path with ~20 call sites — its own reviewed pass.

**THE FIRST SWEEP WAS UNDONE IN 30 SECONDS BY A TAB ON THE OLD BUNDLE.** 86 copies deleted through the
app; by 14:46 all 50 were back, minted by socket `73IwUgNQ…` — the FIRST connection after the morning
restart, i.e. a tab open since before the fix deployed. *A data repair is not finished while a writer
on the old build is still connected.* `disconnect_other_sessions` (closed 1, at the user's go-ahead),
then re-swept in the same script so nothing could race it.

**AND THE SWEEP I ALMOST RAN WOULD HAVE DELETED THE USER'S SCHEDULE.** 32 rebuild-grid rows pointed at
POMS modules — Exercise, Eat, Drink, Wake Up, Hygiene, Go to Bed — listed by **13 poms schedule slots**
and by nothing on their own grid. They read as orphans. They are an APPLY_TEMPLATE
(`meta.appliedFromTemplateId`, 13:45) that ran in a tab whose `state.gridId` was the rebuild grid, so
every mint was stamped with the wrong grid while being placed into poms. **Each one has a correctly
stamped twin in the same slot**, which is the only reason deleting them is a sweep and not data loss:
```
6:00am    4 -> 2   Drink, Wake Up          7:00am   16 -> 8
7:30am    6 -> 3   Take Medication, …      9:00pm    8 -> 4
```
The guard refuses any row with no twin, **A/B'd by blanking one row's moduleId — it refuses, naming
it.** Backed up first. Every slot halved to exactly its real content, all live, 0 dangling.

**A DELETE ON ONE GRID'S SOCKET LEAVES THE ROW IN ANOTHER GRID'S WARM CACHE.** Two swept copies came
BACK on the next load. Measured rather than guessed — a socket joined to the rebuild grid was served
both ids in its `full_state` while Mongo held 0:
```
served by the rebuild grid's cache  [b5uoq623p, krm4xcrr8]     in Mongo  0
```
They were deleted on the POMS socket (the grid they named), but a REBUILD container lists them, so the
rebuild cache had loaded them too and kept serving them. Re-deleted on a socket joined to that grid.
*The rule is not "join the row's grid" — it is "join every grid whose cache can hold it."*

**VERIFIED BY CLICKING, which is also the next step of the rebuild.** Ingredients' feed carried two
conditions with NO field, so the 09-22 half-written-condition fix correctly left it empty. Through the
UI: remove the spare row, set **Board Category / contains / ingredient**, and watch `listed` stay at 0
while the value is still blank:
```
before                 conds [-/IS/, -/IS/ingredient]      listed 0
field + comparator     conds [F/CONTAINS/]                 listed 0   <- still nothing, by design
typed "ingredient"     conds [F/CONTAINS/ingredient]       listed 1
screen                 Ingredients ["Rice"]  Meals ["Oatmeal","Chicken salad"]
mongo                  Rice[RB]              Oatmeal[RB], Chicken salad[RB]
```
Both feeds now persist with the **rebuild** grid's id, and the screen matches Mongo row for row.
Grid-wide afterwards: rebuild **302 occurrences, 0 dangling refs, 0 rows pointing at another grid's
module**; **0 cross-grid feed copies anywhere in the database**, poms included; all **81** stray
`linkedGroupId` tags cleared, **0 sources lost a module**.

---

### 2026-09-22 (4) — "IMPORT THE PAGE" WROTE A WHOLE ARTICLE THAT NO SCREEN COULD SHOW

Rebuild-via-UI, link import continued: paste a Wikipedia link over the Bookmarks container → "Import the
page". The tree was written; nothing appeared. **Two independent defects, both measured on prod:**
- **SERVER — the warm cache never learned the listing.** `markdownToModuli` `$push`es its own root into
  the parent in MONGO; every linker after it (`linkRootIntoParent`, REST `linkIntoParent`) found it
  already listed, returned null, and the callers synced the cache and broadcast only `if (linked)`.
  ```
  mongo Bookmarks.occurrences   [bookmark, 64d6d068]
  cache Bookmarks.occurrences   [bookmark]              <- every tab + full_state reads this
  ```
  Both linkers now return the parent whenever the child ENDS UP listed; `publishLinkedParent` is the one
  cache-merge + broadcast step for `import_text`/`import_url`; four REST import routes that never listed
  their import now call `linkIntoParent`. `markdownToModuli`'s push is KEPT (scripts, migrations,
  `server.js` call it). Verified: a post-deploy import is in the cache immediately.
- **CLIENT — a board container does not render a child CONTAINER** unless its module allows child
  containers, and the import root is a doc container. The doc-page text shape already wrapped its import
  in a page (`createPageInContainer` flips `allowChildContainers`, the page embeds the root);
  `wrapImportInPage` is now that one step, used by "Import the page" when the destination is a container.
  `import_url` replies with the page title so the wrapper is named for the article. **Verified in the
  UI:** "Zazen - Wikipedia" appears in Bookmarks immediately.

**AND DELETING AN IMPORTED PAGE ORPHANED MOST OF IT — fixed.** The importer minted children with
`parentId: null` ("set when added to container.occurrences" — never set), and `delete_occurrence`'s
cascade follows only children whose `parentId` points back: 3 of 4 and 10 of 18 child nodes would have
survived a root delete (the two probe imports were removed node-by-node instead, 24 occurrences).
`mintEntities` now stamps every LISTED child from its lister, and `wrapImportInPage` parents the detached
root to its page. **Verified through the UI:** import "Walking meditation", Delete from its radial menu →
**0 of 11 occurrences, 0 of 11 modules** left. **Still open:** nodes embedded only in a textblock's TEXT
(list chips, quotes, the source link) are listed by no node, so the cascade cannot reach them — that wants
the delete path to follow textmap embeds, its own reviewed pass. **Also not fixed:** `server.js`
`/api/research/wikipedia/import` persists nothing into the warm cache.

---

### 2026-09-22 (3) — A PASTED LINK COULD NOT BECOME A BOOKMARK; and the viewer's browser turned into a picture

Rebuild-via-UI, link import. A **Bookmarks** board page + container made through the UI (poms keeps its
1,464 bookmarks the same way); Ctrl+V of a Wikipedia link over it opened the intake sheet correctly.
- **"Bookmark card" REFUSED on every UI-made grid** (*"this grid has no Title/URL fields — run migration
  0061"*), and where it worked it minted a second SHAPE — an instance record with Title/URL/Notes/Poster
  (2026-08-09) — while the Browser tile, Save bookmark, Jonah and all poms bookmarks mint
  `role:"artifact" kind:"bookmark"` via `addBookmarkOccurrence`. **User chose the one shape.** The route
  calls `addBookmarkOccurrence` and binds + fills the grid's URL field when it has one (`09cf6694`).
- **User, mid-work: *"the browser disappears when i click on the cover photo of a bookmark. it just resolves
  to an image instead"*.** Three defects stacked in the viewer, each measured on prod:
  1. An APP-MADE bookmark's viewer held only its cover — `planSpreadBrowser` read every `from:"fileRef"`
     url as "the url IS the file". Now a fileRef is the file only when the tile SHOWS it;
     `coverAppliesTo` (moved to `helpers/artifactCover.js`) decides. No kind check.
  2. **The browser tile itself was fetched a cover** — the 09-16 enrichment in `addBookmarkOccurrence`
     applied to the 09-11 url tile, whose "open page" rule is *no cover*. **11 of 12 poms viewer tiles
     carried one.** Minted with `enrich:false` now; the planner reports `uncoverId` and the host strips it
     on open, so the 11 heal without a migration.
  3. With the browser back, the row grew to the article's height (items 13,215px in a 947px shell, cover
     centred ~6,600px down). The bounding rule targeted `.container-shell > .container-items--wrap`; the
     row sits inside `.container-list`, so it matched nothing. CSSOM-verified on prod before writing it.
- Also: `openCard` clicked a card scrolled out of its scroller (probe fault, fixed in `_ui.mjs`), and the
  failed run left a `Board 2` container on the Root folder page — removed with the older `Board 1` of the
  same shape (both empty) through `delete_occurrence`.

---

### 2026-09-22 (2) — A COPY-LINK DROPPED ON A DOC WAS A MOVE; the "lost row" account3 hit its limit on

Picked up account3's rebuild-via-UI session (session limit at 06:24 CDT, mid-probe). Its last finding: a
failed copy-link drag of Wake Up (6:00am → 9:00am) left the row with `parentId` → 6:00am and **no parent
listing it**. It re-linked the row and started testing "does a drop outside any zone lose the row?"
(its toolbar-release probe: no).

**THE DROP WAS NOT OUTSIDE ANY ZONE.** The `transactions` collection answered where the server log
could not (it records no writes): at 11:21:44 one gesture wrote exactly two docs:
```
6:00am                occurrences  [Breakfast, Wake Up] -> [Breakfast]
How This Grid Works   textmap      + moduleEmbed(9d92f9a2 = Wake Up's OWN id)
```
The pointer missed 9:00am and released over the doc page. `Editor.jsx`'s block-embed drop branched on
`dragMode === "copy"` only, so **copylink fell through to MOVE** and detached the source. The 09-17 (5)
entry listed the handlers that honour only copy; this editor path was the one it did not name.
`352ff999`: `LayoutHelpers.mintLinkedCopy` is now the one definition of a linked copy
(`copylinkInstanceToContainer` calls it and lists the copy; the doc path calls it and embeds the copy).
Test written first, failed only on the missing branch. **Verified on prod through the UI:**
`block-embed path {dragMode: copylink}` → `COPYLINK done`; Mongo: new row, same module, same
`linkedGroupId`, 6:00am still lists Wake Up.

**ACCOUNT3'S "RESTORE" ONLY REACHED MONGO.** Its re-link script joined the socket on poms grid, and
`link_occurrence_to_parent` writes into `getUc()` — **the socket's active grid's cache, not the
parent's**. Mongo listed Wake Up; the rebuild grid's warm cache (what every browser loads) did not, so the
row stayed invisible. Re-synced through `update_occurrence` on a socket joined to the right grid.
**Reported, not fixed:** the app's own tabs are always on the grid they edit, so only scripts hit it —
but any probe that re-links must join the target grid first.

**Debris, all removed through the app:** the stray embed (doc restored from the transaction's `before`),
and the two linked copies my own verify drags made (the first run's socket logger was attached after the
socket opened and printed nothing, so I misread a successful drop as "no drop"; Mongo showed two).

**ALSO FROM ACCOUNT3'S LOG, still open:** undo of a copy-link fan-out reverts only the SOURCE (probe:
`src true→false`, the 7:00am copy stayed `true`) — the SnapshotOp holds one doc. Together with
`break_link` recording no transaction (09-22 above), linked groups and undo do not compose yet.

---

### 2026-09-21 (4) — A FILE DROPPED ONTO A BOARD MADE A NEW PANEL, and lost its place on reload

Rebuild-via-UI, file upload. Three defects, each found by dropping a real PNG onto the Tasks board:
- **The OS-drop fallback passed the bare store `state`** (no `modulesById`), so `dropView` could not see a
  container under the pointer and `handleFileDrop` minted a new panel + container in the cell (`b8ef0f36`).
  Every existing file-drop test supplied `modulesById` by hand.
- **The placement never persisted.** It is written at drop time, before the server has the file's row, so
  `update_occurrence` dropped it as an unknown child (`dropped 1 unknown child id(s)` on every UI upload);
  the file stayed in Files and left the board on reload. On upload success the client re-links it via
  `link_occurrence_to_parent` (now with `index` + `quiet`) into each parent listing it locally (`7023c042`).
- **`duplicate-template-application` flagged a Merge of a two-row template** ("12:00pm › Stretch ×2") —
  every clone carries the template ROOT id; the key now includes `identitySignature` (`1d8e47b9`).

**Verified on prod through the UI:** drop -> "Image" -> the row appears in This Week, a fresh browser still
shows it, Mongo lists it (home Files/Images). Debris from the probes (2 stray panels + containers, the
hidden Copy stamp) removed through the app's `delete_occurrence`; rebuild grid integrity **clean**.
**FOUND, NOT TOUCHED: poms grid's Schedule Table (`klpjurMStQG8`) lists 328 ids that do not exist** — the
cross-grid feed copies swept this morning; inert (skipped on render, scrubbed on its next save), awaiting
the user's go-ahead to unlink.

---

### 2026-09-21 (3) — A BUTTON PRESS RAN EVERY BUTTON OPERATION; and a button field could not be set up

Rebuild-via-UI, continued. Both ButtonOp fire sites stamp `operationId` and `matchesTrigger` never read it,
so one press ran every enabled `onButton` op whose subject passed, and a field-scoped one never ran from a
widget. A named press now matches exactly that op (`6cac35ce`, A/B'd). The Fields tab had no way to write
`meta.operationId`, so a UI-made button field always read "No operation configured" — its editor now has an
operation picker + label. **Verified on prod through the UI:** Fields tab -> `Log` -> "Log a Glass" -> Save;
pressing `Log` on the Trackers row minted a `Glass` in Water, persisted. The rebuild grid has only one
`onButton` op, so the run-only-the-named-op half is unit-tested, not watched.

---

### 2026-09-21 (2) — A GRID BUILT IN THE UI COULD NOT SAVE A TEMPLATE

Picked up account3's UI rebuild of poms grid (`6ab15587…`, it hit its session limit mid-diagnosis).
"Save as new template" emitted nothing: the protected Templates folder (and Files) were only ever minted
by migrations `0035`/`0049`, which never run on a Toolbar-created grid, so `templatesFolderFor` was null
and the handler returned. `11b3f159`: grid bootstrap find-or-mints both (`utils/protectedFoldersEnsure.js`,
migrations' own rules, 5 tests). **Verified on prod through the UI**: 7:00am saved as "Morning Slot" (2
rows, in the folder); **Merge** into 12:00pm -> `Lunch, Stretch, Breakfast`, persisted. Every grid reads
exactly one protected Templates + Files folder after the restart.
**Copy mode is by design and looks broken:** it stamps the template's WRAPPER as a child, and that wrapper
carries no `Logged On`, so the slot's date filter hides it. One such hidden stamp (`d84ad893`, 2 rows) is
left on the rebuild grid from the probe.

---

### 2026-09-21 — SCHEDULE SLOTS ALTERNATE SHADES, like table rows

User: *"2 diff shades of red and 2 diff shades of whatever color it is when its not red. (green is fine as
just one)"*. The colours are DATA written by `Schedule: Mark Passed Slots` to `ownStyle.bg` (its one
writer), so the stripe went into the op, not a CSS `:nth-child` (the renderer may not know what a slot is).
`0349` flips a per-column `$slotStripe` on every SLOT (a non-slot child does not shift it): passed red
0.10 / 0.20, idle cleared / slate `rgba(148,163,184,0.12)`, current green unchanged. Both new shades sit
under `WASH_ALPHA_MAX`, so no skin re-hues them. The seed calls the migration's own `stripeSlotPaint`.
Test drives the real executor over the live pipeline (fixture), A/B'd against the unstriped one.
**Verified in Mongo after the deploy restart**: today's 49 slots read A/B/A/B red, one green, then
cleared/slate alternating. `ffafb5c4`.
**My slip, repaired:** rehearsing on test grid 2 ran its BACKLOG of never-applied migrations (0001-0004)
before 0005 threw. Restored from the runner's own pre-write snapshot and `--verify`'d exact. *The runner
applies every pending migration, not the one you wrote — dry-run the rehearsal grid too.*

---

### 2026-09-22 — COPY-LINK, VERIFIED BY CLICKING; and the last raw socket.emit in the component tree

Continuing *"we are diagnosing and creating poms grid over using the ui, so we can test everything"* on
the rebuild grid `6ab15587`. The user's own answers set the course: stay on this grid, next area
**copy-link / linked groups**, handle defects **"Fix, test, deploy as I go"**.

**THE IN-GRID-DROP FIX IS CONFIRMED ON PROD.** One copy-link drag, watched on the wire:
```
before (the defect)                      after (deployed e26737f0)
WS 5758 create_occurrence                WS 2616 create_occurrence
DT 5784 drop text="Wake Up"              DT 2639 drop text="Wake Up"
WS 5788 create_module  Wake Up   <-      (nothing)
WS 5816 create_occurrence        <-      (nothing)
```
The stray plain copy is gone. `DragProvider`'s grid-frame `onDrop` now carries the same two guards its
sibling `onDragOver` always had.

**THE DEBRIS WAS REPAIRED THROUGH THE UI, NOT MONGO** — so the warm cache and any open tab stayed
coherent, and the delete path got exercised on the way. 3 strays + 1 duplicate my own verify drag left.
Read back: **0 occurrences, 0 orphan modules, 0 refs in any parent list, 0 dangling child refs
grid-wide, 0 occurrences whose module is missing.**

**AND THE CENSUS SPARED TWO ROWS THE TASK LIST HAD CONDEMNED.** The handoff named *"duplicate
Breakfast/Wake Up rows in 6:00am and 12:00pm"*. Two of the candidates carry
**`meta.appliedFromTemplateId` + `meta.clonedFromModuleId`** — they are an APPLY_TEMPLATE from the
earlier session, not defect debris. The real strays are discriminated by shape, not by label:
```
                         stray (defect)        legit clone            legit UI-created
occurrence id            timestamp-<rand>      uuid                   uuid
module created           same millisecond      01:57:46 (template)    at build time
module fieldBindings     0                     0                      0
occurrence meta          {}                    appliedFromTemplateId  userTouched
linkedGroupId            none                  none                   none
```
*A label that duplicates a sibling is not evidence; the mint's own fingerprint is.*

**COPY-LINK WORKS IN BOTH DIRECTIONS AND SURVIVES A DELETE, measured rather than assumed.** A
3-member group (6:00am source + 7:00am + 12:00pm copies, one shared `linkedGroupId`):
```
                                   6:00am src   7:00am copy   12:00pm copy
before                                true          true          true
untick Done on the SOURCE             false         false         false    <- read back out of Mongo
after deleting a FOURTH member        group intact, 3 members, lg unchanged
```
The earlier session had only proven copy -> source. **Source -> copies is the direction a
one-way fan-out would have silently failed at**, and it is the one nobody had watched.

**BREAK LINK IS PROVEN END TO END, and the control is what makes it mean anything.** Breaking the
12:00pm copy took the group 3 -> 2, left the row alive with its module intact (`linkedGroupId: null`),
and then:
```
                        before   after ticking the SOURCE
6:00am src (group)      false    true
7:00am copy (group)     false    true    <- still follows
12:00pm (BROKEN)        false    false   <- does NOT
```
*A row that stopped following proves nothing unless a row that still follows is measured beside it.*

**A DEFECT FOUND BY READING WHAT ELSE TOUCHES `linkedGroupId`: "Break Link" was the last raw
`socket.emit` in the whole component tree.** It skipped `safeEmit`, which is both the offline queue
and the `__actionId` undo stamp — so a Break Link pressed while the socket is down is dropped with no
queue and no error, and the row silently keeps fanning every later edit out to its group. Routed
through a new `CommitHelpers.breakOccurrenceLink`; a source guard keeps the count at zero.

**THE GUARD'S FIRST VERSION WAS TOO STRICT AND THE DATA NARROWED IT.** It failed on two REQUEST emits
in `BookmarkView` (`import_text`, `import_plan`), both passing an **ack callback** — and
`safeEmit(socket, event, data)` takes no third parameter, so it cannot carry one. A request/response
emit is not something it can replace, and BookmarkView already reports its own failure through that
ack. Scoped to fire-and-forget, with the exemption's reasoning written where the next person will
read it. **MY OWN GREP OVER THAT SAME TREE REPORTED ONE HIT AND MISSED BOTH** — the walker is the
measurement, the hand grep was not.

7 tests, A/B'd against the raw emit: **2 fail** (the walker + the wiring pin). The other 4 pass in
BOTH arms and are **reported as contract pins, not coverage.** Deployed; served app chunk
**sha256-identical** to the local build with `breakOccurrenceLink` present, `break_link` and
`__actionId` non-zero as controls and a nonsense string at 0. **The entry chunk read 0 for the
CONTROLS TOO** — the documented wrong-chunk tell; this code lives in `PagePreviewApp-*.js`.

**AND I OVERSTATED THE DEFECT IN MY OWN COMMIT MESSAGE, which measuring afterwards is what caught.**
It claims an offline Break Link is *"dropped with no queue and no error"*. Measured on prod, with the
app's own status pill as the control (`Disconnected — trying now (attempt 4)`, so the disconnect was
real): the offline click **LANDED** on reconnect. **socket.io buffers `emit` while disconnected by
itself**, and the A/B against the old build was never run — so the raw emit would very likely have
landed too. What the fix is actually worth is the CONTRACT plus `safeEmit` flushing after
`full_state`; not a dropped write. *Verify the failure mode, not only the fix.*

**FOUND WHILE CHECKING THAT CLAIM, REPORTED NOT FIXED: `break_link` records NO transaction.**
`recordDoc` is called exactly once in `socketHandlers/occurrences.js` — inside `update_occurrence`.
So **Break Link is not undoable**, and the `__actionId` stamp reaches a handler that ignores it.
Breaking a link is destructive and silent, which is precisely the gesture you want back. That is a
server change on a live write path and wants its own reviewed pass.

---

### 2026-09-22 (2) — 22 ROWS ON POMS GRID ARE INVISIBLE; and the failed drag was NOT the cause

**A ROW WENT MISSING WHILE PROBING, AND CHASING IT FOUND SOMETHING BIGGER.** A drag of `Wake Up`
(6:00am -> 9:00am) that reported *"could not settle"* left the occurrence with `parentId` still
naming 6:00am and **listed by nothing** — every renderer reads the PARENT's `occurrences[]`, so the
row was invisible. Restored through the app's own atomic `link_occurrence_to_parent` (with `index`,
so it went back to its original position), NOT a raw Mongo write.

**THE OBVIOUS CULPRIT IS INNOCENT, and two measurements say so rather than one.**
```
release OUTSIDE any drop zone (over the toolbar)   7:00am unchanged, row survives
the SAME "could not settle" gesture, wire-logged   after: UNCHANGED   frames: []   errors: []
```
**Zero socket frames.** A drag that does not land writes nothing, which is correct. So the loss is
**NOT REPRODUCIBLE and its cause is UNKNOWN** — said plainly instead of pinned on the drag because
the drag was the last thing that happened. *The last event before a symptom is a suspect, not a
cause.*

**AND THE CENSUS FOR A DETECTOR FOUND LIVE USER DATA THAT IS UNREACHABLE.** Counting occurrences
whose `parentId` names a parent that does not list them, across every grid:
```
parent kind    poms grid   test grid 1   test grid 2   verdict
doc               240          232           232       NORMAL — a doc renders its TEXTMAP, so
                                                       embedded-not-listed is the design
board              27            3             1       REAL — a board renders occurrences[]
table / canvas      0            6+6           0
```
**A naive "parentId but not listed" check would fire 240 times on poms grid and be deleted the
first week.** Narrowed to list-rendering parents it is 27, of which **22 are listed by NOBODY**:
```
Chicken Breast · Rice · Spinach · Oats · Salmon · Olive Oil · Sweet Potatoes · Black Beans
Milk · Bananas · Coffee Beans · Paper Towels          (8 fields each — the macro fields)
Eggs · Greek Yogurt · Chicken Thighs · Frozen Berries (these 4 DO have a visible twin)
+ Last Opened, 2x Journal, a Schedule day, a Day Page, one Occupational task
```
**18 of the 22 have NO visible twin** — so "Chicken Breast" and "Rice" hold their nutrition data in
Mongo and do not render on the Ingredients board. All 22 date to **2026-07-28**, the seed era.

**NOT TOUCHED, and that is deliberate.** poms grid is protected live data, re-listing is a write,
and a bespoke "is this safe to re-attach" predicate is exactly what damaged data in `0035` and
nearly did in `0038`. The repair is one `link_occurrence_to_parent` per row and is the user's call.
**No integrity check was added either** — an ERROR that fires 22 times on the user's live grid is
not something to switch on without them.

---

### 2026-09-19 (11) — PICKER CHAINS, ALARM TIMES, UNDOABLE MOOD PICKS, AND A TOOLBAR THAT STAYS ONE LINE

Five asks in one message, each measured before it was changed.
- **Container picker ("send pomodoros to")**: the chain was already built (`helpers/containerCrumbs.js`);
  the bare "9:00am"s were **325 of 2,107 options that nothing lists and whose parent is gone** — refused-
  build leftovers among them. The picker now offers only containers you can get to (a folder-filed one
  keeps the folder as its crumb). Driven over live data: every 9:00am reads with its full chain.
- **Alarms**: a live `NowClock` in the panel. The test for it found **every alarm ROW's time rendering
  blank** — `AlarmRow` destructured `{ t, ampm }` from `formatAlarmTime`, which returns a STRING.
  `alarmTimeParts` is the one formatter now; `formatAlarmTime` joins it.
- **Undo after a mood pick did nothing**: read out of `transactions` — the pick was 49 `meta.derived` rows
  and the only undoable ones were the day column's text saves. A graph click fired its op with no action
  open. `helpers/graphSelect.fireGraphSelect` wraps it in `withAction` (the CommitHelpers pattern).
  **Unit-tested, not clicked in a browser.**
- **Toolbar**: the date nav's `flexWrap: wrap` stacked it (30 -> 61 -> 79px tall at 700/640/601).
  `nowrap` for the toolbar only, a 108px floor on the date, and the logo + grid picker give way first.
  **Two layout bugs surfaced only by measuring**: the grid picker's `w-full` claimed the whole left group
  and clipped the logo to its minimum at EVERY width; and the first toast fix (a 1200px cutoff) still
  overlapped the filter + date nav at 1024-1200px because the arithmetic left them out. The pills now sit
  IN the flow between the two sides and the stack collapses to its count pill only when its own width
  exceeds the slot the toolbar measures. Probe at 12 widths: 30px, one line, no overlap, no h-scroll.
- `disconnect_other_sessions` (server): closes a user's other tabs; a server-initiated disconnect is the
  one reason socket.io does not reconnect, so they stay down until reloaded onto the current build.

---

### 2026-09-19 (10) — A COLUMN WITHOUT ITS MODULE BLOCKED ITS DAY FOREVER; and my probe made it

User: *"its not spinning up future date col ... it looked like it created it for a second and then
disappeared."* The Sep 20 Schedule column `4a6f77ab` held `schedule:col:2026-09-20` and was listed on the
page, but **its module never reached Mongo**. It was minted at 14:08:46 BY MY PROBE, during the unintended
restart of the `3c88d90d` deploy (the `server/CLAUDE.md` restart rule fixed above). Invisible and
unrecognisable to the builder, it still made `create_batch` refuse every rebuild as a duplicate — the
refusal's `occurrence_deleted` is the "for a second" — and each refused build persisted its ~48 slots
under a parent that never existed.

**Repaired through the app's own `delete_occurrence`, not raw Mongo**, so the warm cache and open tabs
stayed coherent with no restart: 1,450 rows (the column + 49 slots, 771 orphan slots from 16 refused
builds, 629 routine rows under them). Scoped by EXCLUSIVE reachability (09-18 (5)'s rule): 0 listed by a
live parent, all created today, 0 TRUE values, 0 text. Dumped first to
`server/backups/orphans/2026-09-19-refused-schedule-cols.json`. The user's tab rebuilt Sep 20 correctly
seconds later; both columns read back with their modules and 49 slots.

**`4011d8c4`, so it cannot recur:** (1) a signature holder whose module is gone and which is older than
5 minutes blocks nothing — both passes; the age floor is the orphan sweeper's, since a module can be in
flight. (2) `create_batch` remembers refused ids per socket and refuses their children in LATER batches
(APPLY_TEMPLATE sends a column and its slots separately). (3) the op path's `create_module` was the one
raw `socket.emit` among nine sites; it is `safeEmit` now. **Not proven to be how the module was lost** —
a write into a dying socket can be lost either way; (1) is what makes the consequence self-healing.
Each guard A/B'd with controls (module present, just-created holder, sibling under a real parent).
**AND 14 STALE TODOS ON TOMORROW'S DAY PAGE, which the first repair correctly SKIPPED.** Each refused build
also minted a Todo, and `Day Page: Build` LISTED it into the Sep 20 day column, so "listed by a live parent"
excluded it from the orphan sweep. Removed through the app (parent missing, listed only by that column,
0 children, 0 TRUE values; backup `server/backups/orphans/2026-09-19-stale-todos-sep20.json`). All 55 day
columns now hold at most one Todo. The refused-parent cascade stops new ones: the Todo is a refused
column's child.

---

### 2026-09-19 (9) — THE DATE PICKER WAS 9.4s OF PER-SWEEP GRID COPIES; now ~1s

Picked up the other account's perf audit (it hit its spend limit mid-edit, the fix uncommitted). User:
*"lets do an audit on what takes so long with the filters date picker and why it takes so long to spin up or
spin down daypages and schedules."* A date change fires one NavigationOp sweep per inheriting descendant, and
each paid two whole-grid costs even when no op matched: a parent-index rebuild (5.3s, plus 2.7s more in
`_ancestorChain`) and a ~22k-key spread into the sweep's live copy (2.7s). Details in `client/src/helpers/CLAUDE.md`.

**THE DRAFT HAD A LATENT STALE-CACHE BUG, caught before shipping.** It moved `_ancestorChain` onto
`cachedParentMap`, keyed on object identity — but `UPDATE_ITEM_FILTER_OVERRIDE` hands it the live overlay map,
which is mutated in place under ONE identity forever. Built once per call instead. *An identity cache is only
as safe as its least-immutable caller.*

```
prod, _perfaudit.mjs      before       after
Day Page next day         9254ms       966ms visible · blocked 9409 -> 1163ms
Day Page prev day        10903ms       734ms
toolbar prev day   busy 13387ms      2216ms
```
**TOOLBAR STEP, SAME SESSION: an echoed FEED COPY ran the whole OccurrenceCreateOp sweep in every OTHER
tab** (11 x ~145ms per date step). The minting tab uses `fireTrigger: false`; the echo was unmarked
elsewhere. `onOccurrenceCreated` now skips `meta.feedSourceId` (`826722f7`). **THEN FIXED: two tabs each MATERIALISED
the same feeds** — one minted 11, the other's copies arrived as duplicates, each swept the other's (`swept 10`,
`swept 13`, `minted 6` in one step). `a8795323`: the server names ONE feed leader per user+grid
(`server/services/feedLeader.js`, announced as `feed_leader`); the tab in use claims it on focus/visible and
once on joining (ONCE — twice would ping-pong two focused devices); a disconnected tab syncs for itself.
Verified on prod with two headless tabs: A synced alone, B opened and claimed, A went silent, B synced.
**AND A PROBE THAT CLICKS THE TOOLBAR DATE MOVES THE USER'S GRID** — `grid.activeFilterValues` is shared.
A next-day-only run left poms grid on Sep 20 for ~77s; stepped back through the app. Always pair the steps.
**AND EVERY TAB RE-RAN THE DATE-CHANGE OPS.** `onGridUpdated` fired the full NavigationOp sweep in each tab
that RECEIVED a toolbar date change, so every tab rebuilt the same columns and handled the other's echoes
(~5.7s per step with two tabs). `67f45025`: socket-originated `grid_updated` carries `originSocketId`; receivers
skip the ops; an untagged change (REST) runs in the sync leader only — the rule a page's own date change
already followed. Verified with two prod tabs: B fires 0 NavigationOps and follows A's date. **Still open:**
each tab still fires Create/DeleteOp sweeps on the other's echoes (14–26 per step), left alone because
computedValues are tab-local. Also: the REST `grid_updated` (`{ grid: { id } }`) was ignored by clients
entirely; `deploy.sh` restarted on ANY non-root `.md` (fixed); the ancestor-row `[object Object]`
(`3c88d90d`). **The 3 "incomplete" OOM files (`trackerValues`, `balanceFlow`, `accountBalances`) now finish
and pass** — full client run 401/401.
Also fixed a stale `deleteVerb` source guard left failing by `9c43d5b2`. Client 4,631 pass. Prod `8d4842d5`,
served index chunk sha-matched. **Not re-watched by a person.**

---

### 2026-09-18 (8) — MY OWN HAND-WRITE UN-HID THREE FIELDS, and a field name is not unique ACROSS GRIDS

Closing out (7). Its Last Seen half was fixed correctly by `0340` — which hides the **module
BINDING** (`0067`'s mechanism: a container's chips are bookkeeping, the stored VALUE is never
touched). Verified in the pre-`0341` backup: `container:Todo [hidden]`, applied before that snapshot.

**AND I HAD ALSO WRITTEN `fieldVisibility` ON THE DAY PAGE OCCURRENCE BY HAND, straight into Mongo,
with no migration.** That write was debris on top of a fix that already worked, and it did damage:

```
                        Day Page fieldVisibility        what the Todo renders
pre-0341 backup         null                            (grid cascade)  Add new item
after my hand-write     {hide: [AhJGm1Cm5Pka]}          Date: —         Add new item
restored                null                            (grid cascade)  Add new item
```

**`fieldVisibility` IS NEAREST-WINS, so a narrow list at a LOWER level REPLACES the grid's, it does
not add to it.** The grid hides `[Tags, Date, Kanban Column]`; my one-entry list became the complete
list for that page, so all three came back. The Schedule page states the same semantics from the
other side — it carries `[Tags, Time Slot, Last Seen]` in full, and Date deliberately SHOWS there.
*A cascade level is a complete answer, not a delta.*

**AND THE ID I WROTE WAS ANOTHER GRID'S FIELD.**
```
AhJGm1Cm5Pka   Last Seen (date)   grid …5a116b     <- what my script resolved
XeKiw-azlD8_   Last Seen (date)   grid …1a9f3c     <- poms grid, the real one (0340 hid this)
OkRqFsgmcAaw   Last Seen (date)   grid …f43266
```
Three grids each carry a field named `Last Seen`. My script resolved by NAME with **no `gridId`
filter**, and its `!== 1` uniqueness guard passed because it was scoped to nothing. So the hide named
a foreign id — inert as a hide, and destructive only because of the replace-not-merge rule above.
`0340` gets this right (`Field.find({ gridId })` first). **This file has recorded "a label is two
fields on THIS grid" four times; this is the cross-grid form, and the uniqueness guard reads as
protection while checking the wrong set.**

**The tell was in my own verification and I read past it.** The probe reported `todoHasLastSeen:
false` — true, and true for `0340`'s reason, not mine — while the same line printed
`"Todo Date: — Add new item"`. *A pass on the thing you were looking for is not a pass on the line
it is printed in.*

Restored to `null` against the pre-`0341` backup, read back, pm2 restarted (the warm cache is
authoritative for reads). `0340`'s own fix re-confirmed intact on all four Todo container modules.
**Net data change from this session: zero — the grid is back to what `0341` left.**

---

### 2026-09-18 (7) — THE WHEEL REALLY WAS BROKEN, and a ledger entry is not evidence an effect survived

User, with two screenshots: *"id like the daypage todo to have the last seen field hidden and though
the selection of the emotions on the emotion wheel works in creating a checkin occurance, the
emotions arent being shown on the third level and the graph isnt selecting the emotions. it should be
highlighted if selected. also those checkins are showing up in todo but it should be in tasks
completed."*

**THE ENTRY ABOVE RETRACTED A BUG THAT WAS REAL.** It proved the PIPELINE was sound — 128 items, 8
nodes, 0 warnings — and concluded the wheel was fine. Every one of those numbers is still true. What
was never checked is the thing between the data and the screen: **`meta.graph` itself.**

```
                     0046 mints    live wheel    0084/0085/0138 set
dayFieldId               -          ABSENT             yes   (applied)
valueFieldId             -          ABSENT             yes   (applied)
labelFontPx              -          ABSENT             yes   (applied)
labelMinArcPx            -          ABSENT             yes   (applied)
hideTooltipValue         -          ABSENT             yes   (applied)
```

**ONE EVENT EXPLAINS BOTH SYMPTOMS, and `0296` wrote it down at the time:** the wheel was REBUILT on
2026-09-09 by re-running `0046`, which is the authoritative builder and mints exactly
`{type, encoding, literals}`. The four later migrations had written to the occurrence it replaced.
***`grid.meta.migrations[]` still lists all four as applied — a ledger entry records that a migration
RAN, never that its effect survived a rebuild.***

**AND EACH ABSENCE IS EXACTLY ONE OF THE TWO REPORTS.** `ContainerGraph` lights slices only when
`derivesSelection(spec)` — which asks for `valueFieldId` AND `dayFieldId` — so the click recorded a
Check In perfectly while the wheel stayed dark. The labels fall back to `LABEL_MIN_ARC_PX` 15.03px,
and `minArcPx*360/(2*pi*r) <= 4.5deg` needs **r >= 191px, a 416px box**; a day column gives the wheel
~330. All 80 tertiary slices are a FIXED 4.5deg, so the whole ring blanks at once. `0138` measured 6
against the live chart; both numbers are imported from it rather than retyped, and **`0046` now mints
the full spec so the next rebuild carries it.**

**THE CHECK-INS TOOK TWO MIGRATIONS, and the second is the one worth reading.** `Mood: Record
Selection` finds its section by `Time Slot IS "Todo"` — which **8 of 47 day columns have, against 47
with a Tasks Completed**, so on 39 days the `ADD_CHILD` was skipped entirely. Re-pointed at
`identitySignature IS "daypage:Tasks Completed"`: carried by all 50 placements and by nothing else,
measured before choosing it. `meta.clonedFromModuleId` was the obvious anchor and was **rejected —
24 of the 50 predate it**, so July and August would have filed nothing.

**AND THEY STILL VANISHED. A BROWSER POLLING THE CLIENT'S OWN STATE IS WHAT SAID WHY:**
```
t=7.1s   Tasks Completed has 5 children     <- full_state delivers them
t=9.3s   still 5
t=10.4s  0                                  <- load-time operations run
```
**`Day Page: Build Tasks Completed` SWEEPS that board on every load** and re-adds the day's completed
tasks from the Schedule page. It is not a container you put things in; it is one something KEEPS. The
clause that removed them is the third: `_boundFieldIds ARRAY_NOT_INCLUDES <Habit>` — **a Check In
binds Habit**, so it was excluded for being a habit, which it is not. Completed and the Date both
matched. The REMOVE_CHILD is wrapped in the mirror of the rule that failed, and a second ADD loop
re-lists the day's mood rows **from under the DAY PAGE** — a journal carries a Mood and a Date too and
lives under the Schedule page. That loop is what makes it self-healing: one `ADD_CHILD` from the Mood
op is a write nobody repeats.

*The rule: three sessions read this wheel's DATA and pronounced it healthy. A chart is data plus a
SPEC plus a box, and only the box was ever the thing nobody measured.*

**THE DRY RUN CAUGHT A MIGRATION PLANNING TO MOVE NINE REAL TASKS.** `planCheckInMoves` was called
with `checkInSource` where it destructures `checkInSourceId`, so `child.meta?.copyLinkSource !==
undefined` was TRUE for every Todo child that is NOT a check-in — a mistyped key inverted the filter.
The readback assert had the same typo and would have been vacuous. It throws on a missing id now and
a test pins it. *A default that reads as "match everything" is not a default.*

**VERIFIED ON PROD IN A REAL BROWSER, which is the whole point after the entry above.** Screenshot of
the wheel: the outer ring is labelled end to end, and **Judgmental, Bored, Dismayed, Betrayed and
Disappointed carry the thick black ring** — the exact five Check Ins in the user's screenshot. The
Day Page reads `Todo | Add new item` (no Last Seen chip) and `Tasks Completed | Check In | Mood:
Dismayed | ...` five times, and the child count settles at 5 ACROSS the load-time op run rather than
before it. 0 page errors.

**A CLOBBER WAS WATCHED HAPPENING, and it is the reason a data migration is not done when Mongo is
right.** Between the apply and the verify the count went 5 -> 0 -> 2: the server's warm cache was
serving the pre-migration array to clients whose own writes echoed it back. pm2 restarted twice, and
the second restart is what made the measurement stable. **The user's own tab was in the log the whole
time (`Firefox/155.0`, `sinceNav=2598670ms`) — an open tab from before a migration is a writer.**

4 migrations, 4 test files, 50 assertions. Server 2,364 pass; client 4,524 pass (the 3 incomplete are
the documented `trackerValues` OOM family). Both behavioural suites drive the REAL renderer and the
REAL executor and are A/B'd against the shipped-today behaviour, so each control reproduces the
user's report before the fix is asserted — and a completed HABIT is still swept in both arms, which
is what says the sweep was narrowed rather than disabled.

---

### 2026-09-18 (6) — RETRACTION: THE WHEEL WAS NEVER BROKEN, and "0 children" is the design

User: *"yes fix that please"* — the Emotions Wheel showing *"Nothing to chart yet"*. **There is
nothing to fix. The entry below reported a bug that does not exist, and this is the correction.**

**"0 CHILDREN" IS CORRECT, NOT A SYMPTOM.** `feedSync` bails `"pull-only"` for a graph
(`isPullOnlyFeed` → the occurrence carries `meta.graph`) and **sweeps anything it previously
minted**: a chart draws a REPRESENTATION of each row, so owning copies buys nothing.
`helpers/feedPull`'s own header records why — the wheel used to materialise 128 copies and
APPLY_TEMPLATE cloned all of them into every day column, 136 occurrences for one day. *The number I
read as breakage is the fix for a worse bug.*

**AND THE PIPELINE PRODUCES A CHART, driven through the REAL functions over the REAL live data**
(vitest, node environment, so vite resolves the client's own imports):
```
resolveFeedItems(wheel)                    -> 128 items
buildGraphData(wheel, {rows: 128})         -> 8 nodes, 0 warnings
```
Eight nodes is the eight core emotions with their secondary/tertiary children — a sunburst. And
`ContainerGraph` renders the empty state on exactly `nodes.length === 0`. Gate by gate for one row:
`role instance` ✓ · not a feed copy ✓ · `feed.scope` in its ancestors ✓ · `category: null` is
DOCUMENTED as "use the occurrence's label", not a missing setting.

**SO WHERE DID "Nothing to chart yet" COME FROM? MY OWN PROBE.** I measured through
`?previewOcc=`, and `PagePreviewApp` builds its `occurrencesById` **from the SUBTREE, not by
scanning the grid** (its own comment says so) — `getOccMap()` there returns the day column's dozen
occurrences, which cannot contain 128 emotions living on the Emotions board. The preview renders the
container and correctly finds nothing to chart. **The window-level state was a red herring: the
iframe CAN reach the parent's full 22,204 occurrences** (measured), so "it has no state" would have
been the wrong explanation too — it is the CONTEXT map that is narrowed, one layer in.

**THREE PROBE FAULTS IN ONE INVESTIGATION, all mine:**
```
[data-container-id] holds the MODULE id      I searched it for an OCCURRENCE id and read
                                             `present: false` TWICE on a wheel that was there
the preview's getOccMap is subtree-scoped    so an empty chart there says nothing about the app
`bodyHas: "emotions wheel"` = true           it was the SEARCH DROPDOWN's own row, still open
```

**NOT VERIFIED, and it is the honest gap: nobody has watched the chart PAINT in the real app.**
Four navigation attempts failed — the manifest tree's Root and Day Pages folders default closed and
my clicks hit the wrong element, and the occurrence-search result did not navigate (panels stayed on
Tasks / Trackers / the Watts article). What IS established is every input the renderer consumes,
through the renderer's own functions, on the live data. **One look at the Day Page settles the last
step, and no code change is pending on it.**

*The rule this cost: a renderer's empty state measured through a DIFFERENT renderer is a claim about
that renderer. The preview is not the app — its own source says it builds a subtree.*

---

### 2026-09-18 (5) — THE LEAK WAS ALREADY FIXED; and the naive sweep would have DELETED THE EMOTIONS WHEEL

User: *"lets fix that"* — the orphaned Day Page subtrees (4) measured — then, mid-work, *"make sure
the emotions wheel is showing up on the daypage still"*. **That instinct was right, and it is the
entry.**

**THERE WAS NOTHING TO FIX: `6b26dec5` had already fixed it, and the evidence is four independent
facts rather than a reading of the diff.**
```
pm2 restarted          16:52:43Z   AFTER the fix committed at 16:51:22Z -> prod runs it
error log last write   16:42:15Z   BEFORE that -> all 34 `io is not defined` stacks are STALE
new orphan roots       0           since 16:47Z, across an hour of real user traffic
the refusal path       EXERCISED   `🟣 create_batch REFUSED (duplicate signature)` x68, no throw
```
**The positive control is what makes the zero mean anything** — prod's own log carries the user's
`[load]` lines (`Firefox/155.0`, their userId) through the whole window, so loads demonstrably
happened. *A zero from a probe that never ran is not a measurement.* And account2's own commit had
said the refusal path was **unexercised**; it is exercised now, and the ids it names
(`88dea995`, `a393e466`) are the orphan roots the sweeper had refused to delete — the debris was
being correctly rejected as a duplicate of today's real column.

**SO THE WORK WAS THE DEBRIS, AND THE FIRST SCOPE I WROTE WOULD HAVE DESTROYED LIVE DATA.** Walking
each orphan root's subtree by `parentId` OR `occurrences[]` pulled in **`19ed6e9e` — the Emotions
Wheel — and `d508c242`, the shared Todo**, both listed by **31** parents including today's live day
column. They are the ONE shared wheel from `0068` ("one wheel, multi-parented into every day
column") and the Todo container, multi-parenting being the whole design. *A subtree walk that
follows `occurrences[]` does not describe a subtree on this grid; it describes everything the
subtree can see.*

**THE RULE THAT IS CORRECT IS EXCLUSIVE REACHABILITY**, as a fixed point: a node joins the doomed
set only when EVERY parent that lists it AND its `parentId` are already doomed. 281 nodes from 75
roots.
```
                       naive walk        exclusive reachability
Emotions Wheel         DELETED           excluded
shared Todo            DELETED           excluded
outside references     47                0
```
**And the guard is NAMED, not merely implied by the algorithm** — the sweep refuses outright if the
wheel or the Todo appear in the doomed set, because the next person to touch this will reach for the
obvious walk too. **A/B'd by running the naive version through the real guard: it REFUSES, naming
`19ed6e9e` and the live columns that list it.** A guard nobody has watched fail is a guess.

**MEASURED AT FULL DEPTH THROUGH `decompressTextmap`, which is the only honest way** — textmaps are
stored COMPRESSED, so a raw scan reports "no text" for every row on this grid (the `0032` trap).
Across all 281: **0 characters of text, 0 TRUE field values** (a real completion), 0 referenced from
outside. Dumped raw, unlinked from 132 parents BEFORE deleting, then read back.
```
module-less occurrences   75 -> 0        dangling child refs  0
poms grid errors          2 -> 1         (the 1 is the pre-existing container-filtered-empty)
orphan modules            14 swept, 1 correctly KEPT (referenced by an operation)
```

**THE WHEEL IS SHOWING UP, and the proof is what it RENDERS rather than what Mongo holds.** Driven
through a real iframe (`?previewOcc=` on today's column — it pins nothing, so the grid took no
write): *"Emotions Wheel — Nothing to chart yet"*, alongside Todo, Journal, Daily Question, Notes,
Tasks Completed and Highlights. Screenshot `screenshots/daypage-emotions-wheel.png`.
**My first selector read `present: false` and that was the PROBE** — `data-container-id` holds the
MODULE id and I searched it for an OCCURRENCE id. The rendered text is what settled it.

**AND THE EMPTY STATE IS PRE-EXISTING, established against yesterday rather than argued.**
```
                          2026-09-17 21:45Z backup      now
wheel children                     0                     0
wheel listedBy                    12                    13   <- GAINED today's column
rows of the wheel's in my dump                           0
```
So the sweep took nothing of the wheel's and it ends the day listed by one MORE parent. **And the empty state I
reported is RETRACTED one entry down — it was my probe, not the wheel.**

---

### 2026-09-18 (4) — ONE BACKSPACE TAKES THE LINE WITH IT; and the artifact it absorbs is the mint's OWN

Picked up the other account's session at the user's ask (*"continue with the requests i gave the
other account, read its chat logs"*). Its queue, reconstructed from BOTH record kinds — a message
typed while Claude is busy is a `queue-operation`, not a `type:"user"` record, and reading only one
misses most of them (2026-09-12 (4)'s rule, paid again: **9 of the 12 messages that mattered were
queued**). Everything before the last cluster had shipped and deployed; the open item was four
messages in three minutes:

> *"can we delete the line too oif i backspace delete a textblock"* · *"and have the line go up one
> on the first backspace. right now i have to press it twice"* · *"like put it on the next line so
> it creates a textblock there"* · *"without having to press backspace twice"*

**IT TOOK TWO PRESSES BECAUSE THE MINT LEAVES A LINE BEHIND, and that is what makes absorbing it
legitimate rather than reaching into the user's document.** `a1230349` appends a trailing paragraph
when the mint lands on the last line, because a doc must not end with an atom. Backspace then
removed only the block:
```
click the last line   [para("hi"), para("")]
mint                  [para("hi"), block, para("")]   <- the tail the mint added
backspace             [para("hi"), para("")]          <- back where you started
```
So the first press looked like it did nothing to the LINE, and one empty line accumulated per
mint-then-backspace. **The artifact is the mint's; removing it is the mint cleaning up after
itself.**

**THE TWO RULES ANSWER TO THE SAME PREDICATE, so they cannot fight.** `planBlockBackspace` absorbs
the trailing line only when the PREVIOUS sibling can hold a caret — otherwise the doc ends in an
atom again, the exact state the tail paragraph exists to prevent. One rule adds the line, the other
removes it, and both ask `canHoldCaret`.

**AND TWO EARLIER DECISIONS ARE REVERSED WITH THE REASON KEPT, not silently dropped.** The
destination is no longer suppressed and the gesture is no longer consumed: if the line above is
itself empty, the caret landing on it SHOULD mint — that is what makes one press enough. Both guards
were added when a block reappearing one line up read as *"backspace did nothing"*, and **what made
it read that way is that the block's own line SURVIVED, so nothing visibly moved.** With the line
absorbed, the same behaviour is visible progress. The loop suppression really guards is a re-mint on
the VACATED line, and `suppressTextblockMint(pos)` still covers it; the walk up terminates because
each press consumes one line. Both inverted tests keep their old rationale in place.

**THE DESIGN IS THE OTHER ACCOUNT'S AND IT WAS LEFT MID-EDIT — with the file in a state where
NOTHING IN IT HAD EVER RUN.** Its two inversions left the OLD test bodies' tails behind, so
`textblockBackspaceJoins.test.jsx` was a syntax error: `Test Files 1 failed | 7 passed`, and the
failure was esbuild, not an assertion. *A suite that cannot parse is not a suite that passes.*
Removed, then A/B'd with each mutation asserted to land:
```
never absorb the trailing line     fails 2   (both named for it)
re-suppress the destination        fails 1
consume the gesture again          fails 1
```
**A/B 2's FIRST ATTEMPT DID NOT LAND AND THE ASSERT CAUGHT IT** — `suppressTextblockMint(pos);`
appears at THREE call sites, so an exact-once replace refused. The "14 passed" that run produced was
void, not evidence; re-run scoped to the one line, it fails correctly. *The assert is the only reason
that did not become a fourth "the test does not discriminate" conclusion.*

4,510 client tests across 384 of 387 files, **zero failures** (the 3 incomplete are the documented
`trackerValues` OOM family). Lint 0 `no-undef`, build clean. Deployed; client-only, so `deploy.sh`
correctly reported *"Server unchanged — NOT restarting"* — which mattered, because the user was
testing on prod at the time and a restart costs the next load a ~180s cold Atlas read. Prod HEAD
`f36ad88b`, index + entry chunk 200, and **both served chunks sha256-identical to the local build** —
the decisive check, since minification renames `planBlockBackspace` and `canHoldCaret` to nothing
greppable. `keepParagraph`, the planner's return PROPERTY (which minifiers preserve), reads 2 in the
served bytes with `__mintDiag` as a positive control at 1 and a nonsense string at 0.

**CONFIRMED BY THE USER ON THE DEPLOYED BUILD** (*"its working now"*, 12:35 CDT) — which is what
closes this, because the gesture is the one thing no suite here can reach. The planner is pure and
A/B'd and the wiring is pinned, but every earlier round of this bug had passing tests too; the press
itself was the missing evidence and it is no longer missing.

The archive took the four oldest 2026-09-17 entries to make room: 4 headings, live 40 -> 36, archive
229 -> 233, each asserted present in exactly one half. **My first banner edit named the wrong split**
(the move spanned more entries than the anchor implied) and re-reading the file is what caught it.

---

### 2026-09-18 (3) — ONE REFUSED DUPLICATE LOST THE WHOLE CREATE BATCH; and the recreation was never the bug

User: *"im not sure why im getting those warnings or the failed to create occurance server_error
either"*, with `[mint]` tables.

**THE SERVER ERROR IS READ OUT OF PROD'S OWN LOG, NOT INFERRED** — and `pm2 list` as root shows
NOTHING: the app runs as the **`deploy`** user, so the log is
`/home/deploy/.pm2/logs/moduli-error-0.log`. Twenty-one identical stacks:
```
create_occurrence error: ReferenceError: io is not defined
  at handleCreateBatch (.../server/socketHandlers/crud.js:1470:39)
```
**`io` IS NOT IN SCOPE IN `crud.js`.** `registerCrudHandlers` destructures `userRoom`/`gridRoom`,
never the server instance — and **this file's own 2026-08-28 (2) entry records catching exactly
that, in exactly this file**, plus `watchRegion` and `ctxGrid` before it. It came back through a
door nobody had used yet: the duplicate-signature refusal, whose "tell the originator" emit is the
only line in the handler that reached for `io`.

**AND IT THROWS INSIDE THE TRY, BEFORE `upsertRows`.** So a batch containing ONE refused duplicate
loses **every legitimate create beside it** — the rows never persist, the client's optimistic copies
linger, and the user gets `server_error: Failed to create occurrence`. A guard against one bad row
was dropping the other 48.

**THE SAME LINE WAS WRONG A SECOND WAY, which is why it could never have worked even with `io`
bound.** It emitted a bare STRING; the client reads `payload.occurrenceId || payload.id` and returns
early on `undefined`. And `socket.to(room)` **EXCLUDES the sender** — the originator is precisely the
one holding the optimistic copy this message exists to clear, so it needs its own `socket.emit`. The
comment above the line said so; the code did neither. Both emits now, object payload.
**4 tests, A/B'd against the restored bug — all four fail**, the load-bearing one being *"does not
take the rest of the batch down with it"*.

---

**THE `[mint]` TABLES SETTLE THE FOCUS BUG, AND THE ANSWER IS NOT WHAT FOUR SESSIONS ASSUMED.** The
node view really is recreated ~200ms after every mint — but the SAME recreation has two outcomes,
and the discriminator is whether the caret had already landed:
```
BAD  (caret landed, claim spent)          GOOD (caret still in flight)
 31  focus:claimed   content-sync         1332  focus:claimed   content-sync
 35  editor:focus          <- landed        ..  (no editor:focus yet)
223  editor:blur    empty=true            1519  editor:destroy / editor:create
223  editor:focus   b93dc523  <- PARENT    1520  focus:claimed   content-sync  <- SURVIVED
236  editor:destroy / editor:create        1532  editor:focus          <- lands
256  focus:none     onCreate  <- nothing
```
*"Empty textblocks losing focus and having it on the next line after"* is that left column. **So the
recreation was never the thing to fix — the spent claim was**, and the cure needs no theory about
why the view was recreated. `Editor`'s vanish-cancel cleanup re-requests the focus claim, so the
recreated view takes the caret back.

**THE DISCRIMINATOR IS ALREADY EARNED, which is what makes this safe.** A vanish pending at unmount
means this component was focused and empty ONE MACROTASK ago — a user moving away cannot produce
that, only a teardown can. Gated on the block still being PROVISIONAL, so a textblock the user
deliberately made and left cannot snatch the caret when it scrolls back into view. **The control is
what stops the fix degrading into the opposite bug:** a test asserts the claim is still SPENT when
the caret lands, or "the claim survives" is also satisfied by a build that never releases one.

---

**BACKSPACE NOW SPENDS ITS GESTURE, because a position goes stale and a gesture cannot.** User:
*"sometimes, when i backspace delete the empty container (from within), it shows up again."*
**SOMETIMES is the diagnosis** — the same backspace reads `mint:skip suppressed` on one line and
`mint:go` on the next. The positional hold is the right rule and it misses intermittently: the mint
check is deferred AND coalesced, so it reads the caret after the delete transaction AND after the
occurrence drop has re-rendered the doc, by which point a pre-delete position describes a document
that no longer exists. The keystroke that REMOVED a block must not also be the recent input that
mints one. Precedent: the mint already consumes the gesture that caused it.

**DELIBERATELY NOT DONE IN `handleEmptyBlur`, and that restraint is the other half of the user's
report.** There the user clicked AWAY, often onto another empty line — a real gesture that SHOULD
mint (measured: `emptyBlur:collapse` at t=3415 → `mint:go` at t=3627, and it works). Consuming it is
*"it removes the old one but never creates a new one"* written by hand. That is the test's CONTROL.
**Nothing else reads this window — grepped, one consumer** — so the blast radius is exactly the mint.

---

**THE `TextSelection ... (doc)` THROW HAS A CONCRETE SOURCE, and it is an ordinary gesture on an
ordinary document.** A textblock is an ATOM, so a doc ending in one has no inline position at
`doc.content.size` and `focus("end")` throws. It comes from **clicking the padding below the
document**. `Editor.jsx`'s padding-click has caught this for months; `DocContent.jsx`'s
padding-click — the same decision one file over — never did. **Two implementations of one question,
only one ever fixed**, which is this file's most-repeated class. `caretLanding.focusDocEnd` is that
decision once, called by both, reporting WHICH branch ran so a doc that can never take an end-caret
is visible rather than silent.

---

**THE CARET NO LONGER SHOWS ON AN EMPTY DOC LINE** (user: *"id like the input cursor to not show up
on an empty line (before the textblock is created) … this should be for outside textblocks, not
inside of them"*). `caret-color: transparent` HIDES it without moving the selection, so the click
still focuses the line and the mint's own focus/recent-input checks are untouched.

**MATCHED ON PROSEMIRROR'S OWN TRAILING HACK, NOT THE PLACEHOLDER PLUGIN'S `is-empty`** —
`prosemirror-view` appends `<br class="ProseMirror-trailingBreak">` to an empty textblock from CORE
(`dist/index.js:1993`, read rather than assumed), so this cannot be switched off by a Placeholder
config change. `:only-child` is what restricts it to an EMPTY line: a paragraph ending in a hard
break carries the same `br` with a sibling before it.

**VERIFIED AGAINST THE BUILT STYLESHEET IN BOTH ENGINES, WITH THREE CONTROLS** — the user is on
Firefox, and a rule present in a stylesheet is not a rule that matches anything:
```
                    chromium        firefox
doc-empty           transparent     transparent   <- the target
doc-prose           visible         visible       <- prose still shows a caret
doc-hardbreak       visible         visible       <- :only-child does its job
block-empty         visible         visible       <- "inside textblocks, not outside"
chip-empty          visible         visible
```
**AND MY FIRST GREP OF THE BUILT CSS READ AS "THE RULE IS MISSING".** The minifier rewrites
`transparent` -> `#0000`, and `grep -o "caret-color:[a-z]*"` cannot match a `#`. *Grep the built
value VERBATIM, not a token you assumed it would keep* — the same trap this file records for
`flex: 0 0 auto` -> `flex:none`.

---

**RETRACTED THE SAME HOUR: THE CARET RULE BLANKED IT INSIDE TEXTBLOCKS TOO.** User: *"the input
cursor should still be INSIDE the textblock, i specified that. currently thats gone as well."*
The restore was keyed on `.textblock-card` — **and the in-doc block never carries it.**
`ModuleTextblock` routes `context === "card"` (the BOARD ROW) through `TextblockCard`, the only
thing that renders that class; `context === "block"` returns `DocContent` **bare**. So the override
matched nothing, the broad rule reached the nested editor as a descendant, and the caret went out
everywhere.

***AND THE "VERIFICATION" WAS A DOM I WROTE MYSELF.*** The probe's fixture put
`.textblock-card` around the inner editor because that is what I assumed, so it reported five
controls passing against a structure the app does not produce. *A measurement against a fixture you
invented is a measurement of your assumption* — the same class as the 2026-09-16 (3) entry measuring
a different article, reached from the DOM side.

**THE FIX STOPS GUESSING AT DOM AND ASKS THE THING THAT DECIDES.** `onCaretMintTextblock={onExitBlock
? null : …}` is what makes a line mintable, so `DocContent` computes `mintsOnEmptyLine = !onExitBlock`
ONCE and feeds it to the class AND both mint props. The class cannot be wrong about the condition
because it IS the condition. **And the second rule is still required**: a textblock body sits inside
the page editor, so the first rule reaches it as a descendant.

**THE STRUCTURAL ALTERNATIVE — "an editor inside an editor" — WOULD HAVE BEEN WRONG, and only asking
what mints showed it.** A NESTED DOC CONTAINER is also an editor inside an editor, and it DOES mint,
so its empty line must stay hidden. That case is now a control in the probe:
```
                          shipped CSS      fixed
page empty line           hidden           hidden
prose / hard-break        visible          visible
INSIDE a textblock        hidden  <- bug   visible
nested doc container      hidden           hidden   <- the case the structural rule breaks
```
Both engines, against the structure read off the components (`.doc-container[.doc-editor--mints]` >
`.doc-editor-content.ProseMirror` > `.instance-textblock-block` > a second `DocContent`; node views
live in the editor's own DOM, which `index.css:1919`'s `.doc-editor-content.ProseMirror
.container-shell` and the 2026-08-01 (17) nested-editor bug both attest). **The A/B runs the CSS the
user is actually seeing and reproduces their report exactly** — `block-empty: hidden`.

**AND MY FIRST TWO GUARDS FAILED ON THEIR OWN COMMENT.** They grepped for `.textblock-card` and
`caret-color` in `index.css`, and the comment above the rules NAMES both while explaining why
neither belongs there — the `noDomainKnowledge` trap, from the CSS side. They strip comments the way
a parser does now. 7 tests, both halves A/B'd: restoring the shipped pair fails 3, letting a mint
prop re-derive `onExitBlock` behind the class's back fails 2.

**STILL UNEXPLAINED, and said plainly: what recreates the node view.** `nv` incrementing proves
ProseMirror recreated it rather than React re-rendering, and the parent doc logs **no `onUpdate`**
between the mint and the recreation — so it is not a doc transaction. The re-claim makes it
harmless; it does not explain it.

**AND I BROKE `Editor.jsx` PUTTING AN IMPORT IN.** My inserter took "the first newline after the
first `import `", which landed INSIDE a multi-line `import {` — the near-duplicate-anchor class from
2026-09-03, one variant over. Seven test files passed anyway (none import Editor); the eighth failed
on the esbuild transform, and **the source-guard test read the file as TEXT and passed straight
through a syntax error.** A source guard cannot see a broken parse; the build is what says so.

**DEPLOYED AND VERIFIED, prod HEAD `6b26dec5`**, pm2 restarted (a server file changed, so the warm
cache had to go). On the box: the old `io.to(...)` reads **0** and the new pair reads 1. Both served
chunks **sha256-identical** to the local build, with the feature present in `PagePreviewApp` beside a
non-zero control — and `App` reading **0 for the CONTROLS TOO**, which is the documented tell that it
is the wrong chunk rather than a missing feature. The served stylesheet carries both caret rules.
**The refusal path is deployed but UNEXERCISED:** the last refusal in prod's log (`REFUSED (duplicate
signature) 1`) landed at 16:42, on the OLD build, minutes before the restart — so that batch really
did lose its other row. Nothing has refused since.

**NOT VERIFIED, and it is the honest gap: nobody has clicked an empty line since.** Every fix here
is A/B'd with the mutation asserted to land, and the caret rules are measured in two real browsers —
but the focus re-claim only runs on a real teardown, which no test can mount. **And one case is
worse on purpose:** a line whose mint is deliberately suppressed (the one backspace just vacated)
now shows no caret either, so it reads as dead until you type. That is what was asked for; it is one
CSS rule to revert.

---

### 2026-09-18 (2) — THE MINT IS WATCHED WORKING ON PROD, and every page load was minting an invisible day page

Picked up this session's own open gap. Four commits had shipped and been deployed after the entry
below was written — the focus claim surviving a re-mount, a positional backspace hold, a vanish that
a teardown must not trigger, and a doc that must not end with an atom (`cad16186` `2a5b9e11`
`a6df87d0` `a1230349`, prod HEAD verified). **Their own commit messages carry the reasoning; what
none of them had was a single click.** That is what this entry is.

**WATCHED ON PROD, and it is the whole user spec in one table.** Clicking the trailing empty line of
a doc page (`viafluere.com`, the live grid, 0 page errors):
```
t=0      editor:focus b93dc523            the page editor
t=23.3   mint:go                          <- ONCE. the 09-18 gesture-consume fix holding
t=42.8   focus:requested e69b921b         <- the claim, BEFORE the create
t=62.5   editor:create   e69b921b inst=9
t=63.4   focus:claimed   at=content-sync  <- HEARD. this is the defect the entry below fixed
t=64.0   nodeview:mount  e69b921b nv=1
t=64.8   mint:tail-paragraph at=16        <- a1230349, on the LAST line, which is the reported case
t=95.5   editor:focus    e69b921b         <- THE BLOCK TOOK THE CARET
blocks on screen 0 -> 1
```
Then clicking away: `editor:blur empty=true vanishes=true` → `vanish:fire` → `emptyBlur:collapse
pos=15` → **blocks 1 -> 0**, with `nodeview:unmount` arriving 229ms AFTER the collapse — so
`a6df87d0`'s cancel-on-unmount did not swallow a real click-away, which is the control that change
needed. *"each click should negate the last empty textblock … but when clicked off and empty, it
should disappear"* — both halves, measured.

**AND THE ~200ms RE-MOUNT DID NOT REPRODUCE.** Three commits name it as the last unexplained thing
and as upstream of everything they fixed. Across the whole captured window — the table flushes 1200ms
after the last mark, so anything inside ~1.3s would be in it — there is **no `editor:destroy`, no
`nodeview:unmount`, no second `editor:create`.** Said precisely rather than claimed as fixed: this is
one page and one flow, and the user's capture was a different doc. What it does establish is that the
churn is not intrinsic to the mint path.

**NOTHING PERSISTED, WHICH IS THE CONTRACT.** Read back out of Mongo: both provisional occurrences
(`eaa4f793`, `e69b921b`) are **absent**, and the host doc's `updatedAt` predated the run — so the
parent's save was correctly held while a provisional block existed. *A block that is never emitted
leaves no row and does not dirty the doc that hosts it.*

**FOUR MORE PROBE FAULTS, and each cost a run.** The five earlier sessions that "never reached a
clickable empty line" were right about the symptom and the causes are now named:
```
a tagged DOM node          ProseMirror STRIPS unknown attributes on re-render, so
                           `data-probe-line` was gone before the click — carry the target
                           as an (editor index, child index) pair and re-resolve it
getBoundingClientRect      reports a box for a CLIPPED element. The line read y=987 in a
                           1000px viewport and `elementFromPoint` there returned
                           `DIV.page-shell` — verify with elementFromPoint, never the box
"visible prose" filtering  skipped the ONE editor that mints: a page editor's children are
                           big nodes plus a trailing empty line, with no prose paragraph
the trailing line is h=0   it un-collapses on hover — hover its own position first, then
                           RE-MEASURE (the hover moved it 20px and the stale y clicked out
                           of the viewport)
```
**And the mint-wired editor is found BEHAVIORALLY, not by DOM class.** Only `DocContent` passes
`onCaretMintTextblock`, and it passes `null` whenever `onExitBlock` is set. A mint-wired editor marks
`mint:check-scheduled` on EVERY selection update — so clicking each candidate and reading the marks
answers it in one pass. Measured: **8 of 9 editors on that page are not mint-wired**, which is the
documented "clicking prose lands in a body editor" fault with a number against it.

---

**AND THE PROBE FOUND SOMETHING BIGGER THAN IT WENT LOOKING FOR: every page load mints an ORPHANED
DAY PAGE.** Counting what appeared while probing:
```
occurrences created in one hour        96      ~7 per load, 0 feed copies
their shape   1 root with NO MODULE + ~6 sections (Journal, Notes, Daily Question,
              Daily Answer, Tasks Completed), each carrying its daypage:* signature
the root      identitySignature: null   listedBy: 0   <- unreachable, so the next load
                                                        cannot find it and builds another
grid-wide     79 module-less roots · 107 children · 0 of the first 40 listed by anything
by day        07-18: 40 · 07-28: 1 · 07-30: 1 · 09-17: 2 · 09-18: 35
day columns   52, and SIX dates carry two (09-09, 09-12, 09-13, 09-15, 09-16, 09-17)
```
**The mechanism is the documented create/disconnect asymmetry** — `create_occurrence` is queued
server-side and bails at every stage on disconnect while the module write is not — so a load that
ends mid-burst leaves a module with no occurrence or an occurrence with no module. `sweepOrphans`
named the other half in the same run: 68 orphan MODULES labelled *"Friday, September 18th, …"*, i.e.
day columns whose occurrence never landed.

**MY OWN PROBE IS MOST OF TODAY'S 35, and saying so is the point.** Thirteen runs each closed the
browser seconds after the click — *"a probe that loads the live grid can trigger the day rollover.
Keep it open, or expect to repair"* (2026-07-30 (2)), walked into thirteen times in one afternoon.
**The leak is the app's and predates this session** (09-17 has 2, July has 42); the acceleration is
mine.

**SWEPT, with the tool refusing exactly what it should.** `sweepOrphans --apply` removed 4 empty +
unreachable module-less occurrences and 68 orphan modules (72 dumped to `backups/orphans/` first) and
**KEPT every root that would strand a child**, plus the recent day-column modules whose placement may
still be in flight. No pm2 restart: whole unreferenced documents were deleted rather than an
`occurrences[]` array repaired, so the warm cache has nothing stale to re-serve (the 2026-08-01 (18)
distinction). poms grid ends at **2 errors** — 33 module-less roots the sweep correctly declined, and
the 2 pre-existing `container-filtered-empty`.

**NOT FIXED, deliberately: `Day Page: Build` still mints an unreachable subtree on a load that ends
mid-burst.** That is a shared op writing live data, and the honest next step is the one the data
already points at — the root is created without a resolvable module and nothing lists it, so merge's
signature scan cannot see it. It wants its own reviewed pass, not the tail of this one.

74 mint tests across 7 suites green. The archive took the four oldest 2026-09-16 entries to make room
for this one — 4 headings moved, live 43 -> 39, archive 225 -> 229, each asserted present in exactly
one half.

---

### 2026-09-16 (6) — STARDEW NIGHT: the moonlit mountains as a dark skin; and the regex that would have made it light

User: *"lets move on to making a stardew valley darkmode theme using the image i just saved to the
screenshots folder as the background"* (Reddit snapshot tabled by the user the same turn — not built).

**A SIBLING OF DAY STARDEW, NOT A MODE OF IT.** Day Stardew is a LIGHT theme carrying a stack of
parchment-only overrides (near-black `--stardew-ink`, mint headers forced dark) that are exactly wrong on
a night sky. What the two share is the lettering and the type sizes, so those rules now list both skins
and the parchment ones list only day Stardew. New: a `stardew-night` theme block, a
`:root[data-skin="stardew-night"]` token block (parity test covers it), `STARDEW_NIGHT_PALETTE`, and
`public/stardew-night-wallpaper.webp` (the 911 KB png as a q90 WebP, 130 KB — lossless was 725 KB for art
that sits under a scrim).

**EVERY COLOUR WAS SAMPLED OFF THE IMAGE**, not invented: sky #211c28 / #222240 / #22254f → backgrounds
and surfaces, moon #dbd1c1 → the ink, cloud #adb3c5 → secondary ink and grid lines, lit mountain #285c67
(brightened) → primary. The stored-colour band is darker and less saturated than day's, because a
translucent card over indigo at day-Stardew's 70% lightness glows like a sign. Scrim 0.36 against day's
0.52: the art is already dark.

**THE TRAP IT WOULD HAVE WALKED INTO:** `applySkin` set Tailwind's `dark` class with
`!/light|stardew/.test(skin.theme)` — right while "stardew" named one theme, and it reads
`"stardew-night"` as LIGHT, so every `dark:` variant would have rendered its light form over a night sky.
It reads an explicit `LIGHT_THEMES` set now. A/B'd: the old regex fails exactly "Stardew Night is dark".

**VERIFIED ON PROD, and LOOKED AT**, on test grid 2 via `localStorage["moduli-skin"]` — the real
`resolveSkinId` fallback, so no grid's saved skin was written: data-skin/data-theme `stardew-night`,
`dark` on, wallpaper resolving, Silkscreen + VT323 loaded, body rgb(20,18,33) under rgb(241,235,223)
ink, 0 page errors at 1440x900 and 390x844. Screenshots read well at both sizes. The contrast suite now
includes the theme. Client-only deploy (`341a6e95`), no restart.

**Not done: nothing picks it for you.** It is in the Appearance picker (it reads `SKINS`); poms grid's own
skin is unchanged.

---

### 2026-09-16 (5) — JONAH COULD NOT BOOKMARK A LINK OR MAKE A PAGE FROM ONE; and the link importer never learned the lead image

Picked up the other account's session (hit its limit mid-report). The open queue item was the user's:
*"we also need an audit on jonah and make sure he can do all this stuff if i ask (make bookmark
occurances out of a link or make its own page over it ...). we need to make sure any functionality
we added in, jonah can utilize"*.

**THE AUDIT: HE COULD DO NEITHER.** Jonah reaches the app ONLY through `/api/v1` (his tool pack is
thin REST wrappers), and there was no REST route that mints a bookmark at all, while `/import/url`
existed with no tool calling it. Every recent link feature — covers, titles, Reader/Magic shape,
"+ Page" — was socket-only or client-only.

**AND THE ROUTE HE WOULD HAVE USED HAD DRIFTED FROM THE VIEWER.** `/import/url` and the `import_url`
socket handler each carried a private `extractMainContent → wikiHtmlToMarkdown` chain, so neither
got 09-16 (3)'s infobox lead image (Albert Ellis imported with no portrait) and neither took `shape`
(only Magic was possible). Both now read through `utils/linkImport.readLinkForImport` — the viewer's
own `readerFromHtml` — and shape through `buildImportShape`, moved to `services/importShape.js` so a
REST route does not import a socket-handler module. Both also LIST the root: the reader planner does
not push its own, the 09-16 (3) class. `deriveTitleFromHtml` (an undecoded `<title>` twin) is gone.

- **`POST /api/v1/bookmarks`** — server twin of `addBookmarkOccurrence`; `bookmarkRecords` is pinned
  by a test on exactly the keys the renderer reads. It WAITS for `fetchLinkPreview` (no row on screen
  to keep responsive), a dead site still gets a host-named bookmark, a typed label outranks the
  page's title, non-http(s) and missing parents are refused before anything is written.
- **Tools `save_bookmark` + `import_url`** (both confirm-carded, both in the offline allowlist, both
  in the system prompt). `import_url` strips the planned rows from what the model sees — hundreds of
  records a local model cannot use. With no `parentId` the drawer wraps the root in the Imports
  folder like every other import; WITH one it does not (it is already listed — a wrapper would be a
  second home).
- **Three existing tools were rewriting whole `occurrences[]` arrays on top of the server's atomic
  `$push`/`$pull`** — `create_occurrence`, `copy_occurrence`, and `move_occurrence` (which also did its
  own unlink). That is the stale-snapshot clobber this file records repeatedly. A cross-parent move is
  now ONE `parentId` PATCH; only a same-parent reorder writes a list. `create_occurrence` also stopped
  minting the inert `kind:"list"` (2026-07-29).

19 tests, four A/Bs each failing exactly their own case (unlisted reader root, old extraction chain,
inert kind, label precedence). 2,263 server tests, client assistant suites 78, lint 0 `no-undef`,
build clean, deployed, prod HEAD `7350efa5`.

**VERIFIED ON PROD against test grid 2 through the real routes** (a scratch API token, swept after):
bookmark 201 · title "Albert Ellis - Wikipedia" · the dust-jacket cover · listed; reader page 200 ·
2 occurrences · lead image present · listed. Debris read back out of Mongo: 0 modules, 0 tokens.
**Honest gap: the probe's FIRST run crashed on a page response with no `occurrences`, and nothing in
the log says why** — both requests logged, no error line, and it wrote nothing (checked by label,
host label and fileRef). The second run was clean. **Not verified: nobody has asked Jonah in the chat
drawer**, so the confirm card and the model choosing these tools are unexercised.

---

### 2026-09-18 — THE CLAIM WAS MADE TOO LATE TO BE HEARD; and CLAUDE.md was 1.1M characters

Picked up the other account's session, which died on **"Prompt is too long · automatic compaction
failed"** — this file at **1,106,326 characters** was the cause. Archived first, at the user's ask:
`CLAUDE.backup.2026-09-18.md` holds every entry from 2026-09-15 (6) back, VERBATIM. Split, not
summarised, and verified rather than assumed — **305 headings = 49 live + 256 archived, zero lost,
zero in both**, with each half asserted to be a substring of the original. 1,106,326 -> 91,846.
*A log past what a session can read is the same as no log, except it also costs the context it
does use.*

**THE USER GAVE A SPEC, and it is the deliverable:** *"each click should, negate the last empty
textblock, and then focus on a new textblock. but when clicked off and empty, it should
disappear."* Plus two new specifics — the new block is **NOT focused**, and a vanished one **comes
back**.

**THE FOCUS CLAIM WAS MADE AFTER THE TRANSACTION THAT IT HAD TO BE HEARD BY.**
`editor.view.dispatch` runs handlers SYNCHRONOUSLY and the sub-editor claims the caret in its own
`onCreate`, so `requestTextblockFocus(occId)` sitting after the dispatch can arrive too late to be
seen. **And that single ordering explains BOTH halves of the report**: the block mounts unfocused
(*"it creates a textblock (not focused)"*), and the vanish path is `onBlur` — **a block that never
focused never blurs, so it never disappears.** The file already knew the rule and applied it to the
registry entry ten lines up: *"REGISTER BEFORE the transaction ... an entry added afterwards is too
late."* The caret claim has the identical requirement and was left after it.

**AND THE MINT NOW STATES THE INVARIANT RATHER THAN RELYING ON THE BLUR.** A provisional block is
empty and unclaimed BY DEFINITION — typing commits it out of the registry on the first character —
so when a new one is minted every other one is garbage the vanish path failed to collect.
`planStaleCollapses` runs in the **SAME transaction as the insert**, which removes the ordering
hazard rather than managing it: `nodeStart` was computed by the caller against the pre-edit doc, so
collapsing first would invalidate it. Planned against `tr.doc` and applied **DESCENDING** —
replacing at one position shifts everything after it, so a top-down plan invalidates its own later
entries. Back to an empty LINE, never deleted: the user clicked that line.

**ONE OF MY OWN GUARDS WAS VACUOUS AND ONLY THE A/B SAID SO.** The "claimed before the dispatch"
assertion used a bare `src.indexOf`, which matched the **AUTO-CREATE path's** claim earlier in the
file — before every dispatch, so it **passed against the exact defect it exists to catch**. Scoped
to the mint's own body it fails correctly. *An ordering assertion over a whole file is a claim about
which occurrence you matched.* Every other mutation discriminates with the change asserted to land:
ascending order fails 2, collapsing the just-minted block fails 6, and dropping the `isPending`
check — the guard that stops this touching writing the user did — fails EXACTLY its own one test.

**THE DIAGNOSTIC IS ON BY DEFAULT** (`window.__mintDiag = false` mutes) — a report should cost the
person seeing it no setup. Three marks were added for the three things they described, and one of
them exists because the case was **SILENT**: `focus:none` fires when a provisional block mounts with
NO outstanding claim, which is precisely what a late claim produces and which neither existing
branch reported. `focus:requested` dates the claim against `editor:create`; `block:zombie` names a
node whose occurrence resolves from neither the store nor the registry — the shape of *"it will pop
up again randomly"*, i.e. the parent textmap re-synced from a copy that still embeds it.

4,456 client tests across 382 of 385 files, **zero failures** (the 3 incomplete are the documented
OOM family). Deployed; client-only, so `deploy.sh` correctly reported *"Server unchanged — NOT
restarting"*. Prod HEAD `9dbba40f` verified over SSH, index + entry chunk 200, the served
`PagePreviewApp` **sha256-identical** to the local build carrying all five new marks with three
pre-existing controls, and `__mintDiag!==!1` in the served bytes with **zero** of the `=== true`
form — so it really is on.

**NOT VERIFIED, and it is the honest gap: nobody has clicked two empty lines on the deployed
build.** The ordering fix is reasoned from the synchronous dispatch and pinned by a source guard;
the collapse is pinned by a pure planner. Neither has been watched. One click each way with the
console open settles it, and the table prints itself.

---

### 2026-09-17 (6) — A DOC TRACKED EVERY MINTED BLOCK IN TWO SINGLE SLOTS; and the video is still not explained

Picked up the other account's session (limit hit at 22:26, mid-edit, `DocContent.jsx` dirty with
`helpers/provisionalMints.js` + its test untracked). Its last user message was *"you can see it
happening in the video, thats proof that the empty textblocks being created by clicking an empty
line is finicky as hell"* — and it was right to stop demanding its own repro, because the video IS
the measurement.

**WHAT IT FOUND IS REAL AND IS WORSE THAN THE REPORT.** `DocContent` held its click-minted
provisional blocks in **two single slots** — `provisionalOccIdRef` (one id) and `mintWritesRef`
(one cancel) — while the registry they feed (`helpers/provisionalTextblock`) is a MAP. One click is
fine; the user clicks several, and then:
```
unmount cleanup   discards only the LAST id  ->  every earlier block LEAKS in the registry
minting block B   cancels block A's writes   ->  a block still on screen loses its local row
```
**THE LEAK IS SILENT DATA LOSS, not cosmetic.** `Editor.persistContent` returns early while
`hasProvisionalTextblock(json)` is true, and that walk asks whether the doc embeds a node whose
occurrenceId is still in `pending` — so **a leaked entry whose node is still in the document keeps
it true FOREVER and the parent document stops saving.** Verified by reading both ends
(`Editor.jsx:528`, `provisionalTextblock.js:130`) rather than inheriting the claim.

**THE SECOND HALF WAS NEVER NEEDED.** The deferred write already re-checks
`isProvisionalTextblock(occId)` before writing, which is the case the pre-emptive cancel was written
for (an abandoned block). Cancelling a DIFFERENT block was always wrong.

`createMintLedger` is that bookkeeping as a testable unit, out of `DocContent` because mounting it
needs the whole grid store. **A/B'd by rebuilding the old single-slot behaviour INSIDE the ledger** —
the honest shape for new code, since a passing suite otherwise only proves the new code agrees with
itself: 4 of 6 fail, each for its own reason (the leak reads `expected 1 to be 3`). **The other 2
pass either way and are NOT counted as coverage.**

**AND IT DOES NOT EXPLAIN THE VIDEO — said plainly rather than folded into the fix.** A leaked
registry entry and a cancelled local write do not make a block on screen refuse to disappear. The
vanish path is `Editor.onBlur → onEmptyBlur → handleEmptyBlur`, and **a block can only blur if it
focused first**, so the open question is which of those two never happened.

**THREE CANDIDATES RULED OUT BY READING, so the next session does not re-walk them:**
```
double-mint on one line   emptyLineAtCaret requires depth 1 + an EMPTY paragraph — it cannot
                          target a line already holding an instanceTextblock
lazy editor destroying    useLazyEditor is setLive(true) only; `live` is genuinely ONE-WAY
  a live block            (CLAUDE.md asserted this; now verified at the line)
mint firing twice         the check is coalesced, deferred, focus-gated, input-gated,
  per click               empty-line-gated and suppression-gated
```

**THE DIAGNOSTIC COULD NOT HAVE ANSWERED IT, AND THAT IS WHY THIS SESSION SHIPPED ONE.** `[mint]`
**recorded into `window.__mintMarks` and NEVER PRINTED** — using it meant knowing to type
`console.table(window.__mintMarks)`, on a report whose whole value is one click from the person who
can see it. And it only ever covered the MINT: the vanish path had **no marks at all**, which is
precisely the half (5) recorded as unexplained. It prints itself now (1200ms after the last mark, so
a mint and the blur that undoes it land in the SAME table) and names both ends — `focus:claimed`
(with which claim site won), `editor:focus`, `editor:blur` (empty? has a vanish handler?),
`vanish:skip` **with the guard that bailed**, `vanish:fire`, `emptyBlur:skip`/`collapse`.
**OFF is completely inert** — no marks, no timer, no print — and that is the contract under test,
because this runs on every click into an empty line. A/B'd: reverting to record-but-never-print
fails both "prints" tests while the three off-is-inert pins pass either way.

**NOT BUILT, deliberately, and the seam is named so it is one session's work.** The defensible fix
if the measurement confirms a missing blur is *"at most one provisional block"* — minting B discards
any still-provisional A — since a provisional block is empty and unclaimed by definition, and typing
commits it out of that state. `embedDeleteRegistry.get(occId)?.()` is the existing seam that removes
the node. **The hazard is ORDERING**: `handleCaretMintTextblock` is handed `nodeStart` by the
caller, so removing A's node first makes B's position stale. That is surgery on the mint path at the
end of a long session, which this file records going badly.

4,437 client tests across 380 of 383 files; the 3 incomplete are the documented OOM family
(`trackerValues` named in the run) — **zero `FAIL`, zero `×`**, and nothing here goes near the
tracker executor. Deployed, client-only so `deploy.sh` correctly reported *"Server unchanged — NOT
restarting"*. Prod HEAD `d5d29467` verified over SSH, index + entry chunk 200, both served chunks
**sha256-identical** to the local build, and all six new marks present in the SERVED
`PagePreviewApp` with three pre-existing controls — **`App` reading 0 for the CONTROLS too, which is
the documented wrong-chunk tell.**

**THE ONE-MINUTE STEP THAT SETTLES IT:** `window.__mintDiag = true` in the console, then reproduce
the video once. The table prints itself and names which guard bailed.

---

### 2026-09-17 (5) — THE `embed: missing` IS PROSEMIRROR'S OWN FILLER; and 0333 verified the field it WROTE, not the field the RENDERER reads

Picked up the other account's session (monthly spend limit, 20:50, mid-wiring). Its open item was the
user's *"it should be a third option in the radial menu"*; four more arrived from a screen recording.

**COPY-LINK IS THE THIRD RADIAL MODE, and the NARROWING is the load-bearing half.** The handle
toggled two ways (`move ? "copy" : "move"`) so copy-link was unreachable, and it drew the **Move**
icon for a copylink row. Only `handleOccurrenceMove` runs `copylinkInstanceToContainer`;
`handleContainerDrop` and `handleDocEmbedDrop` branch on copy and nothing else, and
**`handlePanelDrop` DESTRUCTURES `mode` and never reads it**. So the cycle is over an ALLOWED list and
an instance is the only surface that opts into three. `dragModeItem` is one definition of the menu
row — RadialMenu's default items and ModuleInstance's copy-linked custom list carried two
hand-written copies of the same ternary. **Reported, not changed:** the panel toggle is ALREADY inert
by that table, and narrowing it would remove a control rather than add one.

**THE `embed: missing` IS NOT A STALE POINTER — IT IS A DEFAULT NODE.** `wrapGroup` content is
`moduleEmbed{2,}`. The delete-scrub handled a group dropping to ZERO and not to ONE, and a one-child
group is a document ProseMirror will not accept: on the next load its schema repair **FILLS the
missing required node with a default `moduleEmbed`, whose `occurrenceId` default is `""`**. Measured
out of Mongo on the Watts article:
```
wrapGroup[ moduleEmbed("e027b531…"), moduleEmbed("") ]
```
That is why no later scrub could clear it — **every scrub matches the ids a delete just removed, and
this node names no id at all.** The client has had the right rule since the wrap work
(`detachGroupMember`: *"a group needs >=2 children … when fewer remain it flattens"*); the server's
scrub is its twin and never learned it. It flattens now, KEEPING the survivor — dropping the group
wholesale would delete an embed the user never deleted. **An existing test pinned the bug**
(`expect(...content).toHaveLength(1)`) and is INVERTED with the reason in place.

**AND ONE PRE-EXISTING FIXTURE WAS A SHAPE THE SCHEMA CANNOT HOLD** — `wrapGroup[paragraph, embed]`,
used to test that the walk reaches DEPTH. It now nests in a blockquote, so it tests one thing.

**`0336` repairs the live document, scoped to an EMPTY id and never to "does this pointer resolve?"**
— that second question is the 2026-08-01 (19) regression, where a scrub removed the only node
rendering a surviving sibling. An empty id names nothing BY CONSTRUCTION. Dry run named exactly the
one document measured independently; applied and read back out of Mongo.

**THE CARET THROW IS THE SAME NODE, AND IT IS NOT COSMETIC.** Backspacing an empty textblock hands
the caret to `pos - 1` — inside the previous sibling — and a wrapGroup holds no inline content, so
ProseMirror throws `TextSelection endpoint not pointing into a node with inline content (wrapGroup)`
**BETWEEN the delete and `dropOccurrenceData()`**: the node leaves the document and the occurrence is
never discarded. `helpers/caretLanding` asks the SCHEMA (`node.inlineContent ?? type.inlineContent`)
rather than listing the block types that fail today, so an image, a table row and whatever is added
next are covered. A/B'd — the discriminating sibling fails alone while the paragraph-join case holds.

**`0333` CLEANED THE WRONG FIELD AND VERIFIED IT.** It stripped markdown from inline chip MODULE
LABELS and reported *"21 cleaned, 0 left"* — still true today (1867 inline modules, 0 dirty labels).
But `InstanceTextblockInlineNode` renders `textmapToInlineText(occurrence.textmap)`, and the raw text
lives THERE:
```
{"type":"text","text":"***The Book: On the Taboo Against Knowing Who You Are***"}
```
***A migration that verifies the field it WROTE rather than the field the RENDERER reads can report
success and change nothing on screen.*** `0337` strips the textmaps with 0333's own `stripInlineMd`.

**AND THE FIRST DRY RUN PLANNED 297 ROWS, WHICH THE BEFORE/AFTER DIFF IS WHAT CAUGHT.** The plan
printed only the AFTER; diffing showed **0 rows where content differs** (all pure marker removal) but
65 whose only change was a leading space — and `textmapToInlineText` already collapses whitespace
before painting, so rewriting the user's prose for no visible change is churn. Compared TRIMMED, it
narrows to **21 — the same 21 `0333` found**, which is independent confirmation it is the same set in
the field that renders. Applied, read back clean.

**THE ERRATIC EMPTY TEXTBLOCKS: TWO SINGLE SLOTS FOR A MAP, and the leak STOPS THE DOC SAVING.**
User: *"you can see it happening in the video, thats proof."* They were right, and my "I could not
reproduce it headlessly" was not a reason to stop — the recording IS the measurement. Five probe runs
never reached a clickable empty line (the article's sit below a scroller that moved `0 -> 3902` while
they moved 6px), and that is a fact about the probe, not the bug.

Reading the mint path with the video's symptoms in hand found it. `DocContent` tracked its
click-minted blocks in **two single slots** while the registry they feed is a **Map**:
```
const provisionalOccIdRef = useRef(null);   // the LAST id
const mintWritesRef       = useRef(null);   // the LAST pending write
```
One empty line is fine. The video shows THREE blocks at once, and then:
- **The unmount cleanup discards only the LAST id**, so every earlier block LEAKS in the registry.
  **That is not cosmetic:** `Editor.persistContent` returns early while `hasProvisionalTextblock(json)`
  is true, and a leaked entry whose node is still in the document keeps it true FOREVER — **the parent
  doc silently stops saving and every later edit is dropped.** That is the "finicky as hell".
- **Minting a second block CANCELLED the first's store writes**, denying a block still on screen its
  server row. The `isProvisionalTextblock` guard inside the deferred write already covers the case
  that cancel was written for (an abandoned block), so cancelling a DIFFERENT block was never needed.

`helpers/provisionalMints.createMintLedger` is that bookkeeping where it can be tested — DocContent's
mint path needs the whole grid store, so a source guard pins the wiring (with a control that the mint
path still exists, or "no single slot" also passes against a file with the feature deleted). A/B'd:
reinstating the last-only slot fails exactly the four cases that describe it.

**AND THEN THE SECOND HALF WAS REPRODUCED AND FIXED (2026-09-18): THE MINT FED ITSELF.**
User: *"the clicking around and empty textblock thing is still happening glitchy wise like the
video"*. Armed `[mint]` on prod and clicked ONE empty line:
```
t=11.1  mint:go              <- block 1
t=28.3  editor:create
t=28.9  mint:check-scheduled <- the mint's OWN transaction
t=46.2  mint:go              <- block 2, SAME CLICK
```
The mint replaces the empty line with an ATOM, the caret moves to the NEXT empty line, that
selection update schedules another check ~17ms later — and the click is still well inside the
1000ms input window, so it mints again. On a run of empty lines it walks down them. That is
*"rapidly being created weirdly"* and *"ones will randomly create it on two lines"*, exactly.

**The window only ever asked "was there a gesture", never "has it already produced a block".** It is
CONSUMED by the mint it caused (`helpers/userInputWindow`), so a second block needs a second
gesture. Consuming rather than widening a window is the point: `provisionalTextblock` already
records a blanket time window going wrong in the OTHER direction (*"it also ate the mint at a
DIFFERENT line"*). Verified on the deployed build, same click, same document: `mint:go` once, then
`mint:skip why:no-recent-input`.

**FOUR PROBE FAULTS COST FIVE RUNS BEFORE ANY OF THIS WAS VISIBLE, and each is reusable.**
- **`mintDiag` prints with `console.table`**, so a console filter on the string `[mint]` matches
  NOTHING. Every earlier run reported "0 logs" and I read it as "no mints ran".
- **The doc GROWS while you scroll** (lazy editors go live), so one scroll-to-bottom lands short —
  measured 4256 of a max that was 3968 when set and 5538 by the time it settled. It has to be
  re-driven until the max stops moving. A loop that breaks on `top >= max` breaks too early.
- **Clicking prose lands in a textblock BODY editor**, which is passed `onCaretMintTextblock: null`
  and returns before the first mark — so it can never mint and never says so. Only an empty line in
  a PAGE or CONTAINER editor mints.
- **Comparing element tops across two RUNS** made a working scroll look broken (`2535 -> 2529`).

***And the user was right that a failed headless repro is not a reason to stop: "you can see it
happening in the video, thats proof."* The recording was the measurement; the probe was the thing
that was wrong, four times over.**

**NOTHING WAS LOST, and that is measured rather than reassuring.**
```
block textblocks 717 · empty 54 · empty AND created today  0
```
So the blocks stacking up in the recording were PROVISIONAL — local-only, never emitted, which is the
design working. The backspace throw above provably strands one; **the click-off case goes through
`handleEmptyBlur`, which writes no selection at all, and is NOT explained.** Said plainly rather than
folded into the fix. The lazy-editor theory was checked and is dead: `live` is one-way, so a focused
block stays live and its `onBlur` fires. Next step is one repro with `window.__mintDiag = true`.

**THE QUOTE MARKS** now sit the same distance from the words (open was 9px against the close's 3px),
derived from the prod geometry recorded that morning. **NOT re-measured on screen** — and the probe
is why: `?previewOcc=` mounts `PagePreviewApp`, which reads `window.parent.__moduli_state__`, so
opened TOP-LEVEL it renders nothing (both arms zero, 0 page errors — the documented tell). Driven
through a real iframe it loads, and still does not reach those cards: the preview walks
`occurrences[]`/`parentId` and under-renders textmap-only embeds (2026-08-23 (2)).

2,310 server + 4,424 client tests. **The 3 files that do not finish are the documented OOM family**
(`trackerValues`, `balanceFlow`, `accountBalances`) — verified by running each ALONE, where each
still exits its worker mid-file. Deployed, prod HEAD verified, served CSS sha-matched with a control
non-zero and the old value at 0. **pm2 restarted, and it mattered:** both migrations wrote straight
to Mongo, so the warm cache was still serving the pre-migration values.

## Claude Session Directives (ALWAYS FOLLOW)

### Token Efficiency — Read Less, Do More
- **Check folder-level `CLAUDE.md` files FIRST** before re-reading source files. Every folder I've touched has a `CLAUDE.md` with a file map and recent changes summary. Use it.
- **Never re-read a file you already touched this session** unless the user explicitly changed it. Track what you've modified.
- **When you touch files in a folder**, update/create that folder's `CLAUDE.md` with the changes made, so future sessions don't re-read the source.
- Key folders with CLAUDE.md: `client/src/`, `client/src/ui/`, `client/src/helpers/`, `client/src/state/`, `server/`
- Memory files are at: `/home/joshpoms/.claude/projects/-home-joshpoms-dndtest2/memory/`

### Pragmatic Programmer Philosophy (ALWAYS APPLY)
- **DRY** — Don't Repeat Yourself. Every piece of knowledge has a single authoritative source. No duplicate logic.
- **Orthogonality** — Keep modules independent. A change in DragProvider shouldn't require changes in ContextMenu.
- **ETC (Easier to Change)** — Design for changeability. Prefer patterns that are easy to modify over ones that are prematurely clever.
- **Tracer Bullets** — Build end-to-end thin slices first, then fatten. Wire Panel → Context → Socket → Reducer before polishing UI.
- **Don't Live with Broken Windows** — Fix bad designs immediately. Don't patch on top of wrong abstractions.
- **The Boyscout Rule** — Leave code cleaner than you found it. Small improvements add up.
- **Contracts (interfaces)** — Each module has a clear public contract. CommitHelpers is the only layer that talks to socket. Components never call socket directly.
- **Power of Plain Text** — Data in plain, portable formats. No magic string formats that only one place understands.
- **Don't Outrun Your Headlights** — Implement one phase at a time. Don't spec Phase 9 while Phase 6 is incomplete.
- **Good Enough Software** — Ship working features before polishing. Don't let perfect block good.

### Session Rules
- Each time you touch files in a folder, update that folder's `CLAUDE.md`
- Start each session by reading `MEMORY.md` and relevant folder `CLAUDE.md` files — not source files
- At 80% context: stop new features, wrap up current task, update MEMORY.md
- At 90% context: only review/cleanup — no new work
- Always leave system in a testable state (`npm run dev` must work)

---

## How the Data Works

### Server (MongoDB via Mongoose)

There are two things stored in the DB for every piece of content: a **Module** and an **Occurrence**.

**Module** is the template — it defines what something is. It has a `role` (panel, container, instance) and a `kind` (list, doc, artifact, board). For file-backed content it also has a `fileRef` path (e.g. `notes/morenotes.md`). Modules don't store position, order, or any per-session state. They are reusable.

**Occurrence** is the placement — it's what actually appears on screen. Every occurrence points at a module via `targetId`. It stores:
- `fields: {}` — field values for this specific placement (e.g. how many reps you did *today* in *this context*)
- `textmap` — TipTap JSON for rich text containers/artifacts
- `parentId` — which parent occurrence or folder this lives inside
- `occurrences: [ids]` — ordered list of child occurrence IDs (this is how ordering works — NOT on the module)
- `viewId` — points to a View record (only when this occurrence needs rendering config)
- `iteration` — time filter + category filter + persistence mode

**View** is a separate record. Occurrences that need rendering config (e.g. a panel showing an artifact file tree) have a `viewId` that points here. View stores `viewType`, `hasTree`, `manifestId`, `activeOccurrenceId`, `layout`. Modules have no viewId — only occurrences do.

**Manifest + Folder** handle the file tree sidebar. A Manifest has a `rootFolderId`. Folders form a tree via `parentId`. Artifact occurrences place themselves in the tree by setting `parentId = folderId`.

**Field** records define what data an instance can collect (number, text, boolean, select, date, duration, rating). Fields are shared templates — instances bind to them via `fieldBindings`.

**Operation** records define automation pipelines. Each has a `pipeline: { sources, steps }` where steps are a top-down code flow: INIT_VAR → LOOP → IF → ADD_TO_VAR → SHOW_VALUE. No black-box aggregations — the math is explicit.

```
Grid
 └── occurrences: [panelOccId, ...]       grid owns the panel occurrence IDs

Panel Occurrence  (viewId → View or null)
 ├── targetId → Module [role: "panel"]
 └── occurrences: [containerOccId, ...]

Container Occurrence  (textmap if kind=doc/artifact)
 ├── targetId → Module [role: "container", kind: "list"|"doc"|"artifact"|"board"]
 └── occurrences: [instanceOccId, ...]

Instance Occurrence
 ├── targetId → Module [role: "instance"]
 └── fields: { fieldId: { value, flow } }

Artifact Panel → View { viewType:"artifact", hasTree:true, manifestId }
  Manifest → rootFolder → Folder children
    └── Artifact Occurrence (parentId = folderId)
         ├── targetId → Module [kind: "artifact", fileRef: "notes/x.md"]
         └── textmap: TipTap JSON  (synced to artifacts/notes/x.md on save)
```

### Client (React + Socket.io)

On connect the server sends `full_state` — a flat dump of all modules, occurrences, views, manifests, folders, fields, operations, computedValues for the user's grid. The client stores these in Redux-like state maps (`modulesById`, `occurrencesById`, `viewsById`, etc.).

**Rendering**: `Grid.jsx` reads the grid's occurrence list, renders a `modules/Panel` for each panel occurrence. Panel reads its child occurrence IDs, renders `modules/Container` for each. Container renders `modules/Instance` for each instance occurrence. If the panel occurrence has a viewId pointing to an artifact view, Panel renders `modules/View` which shows `ManifestTree` sidebar + `modules/Artifact` content.

**Mutations**: Everything goes through `CommitHelpers.js` — the only place that calls `socket.emit`. Components call CommitHelper functions, which dispatch to local state immediately (optimistic) and emit to server. Server persists and broadcasts to other windows.

**Operations**: Triggered by field changes, drops, or iteration changes. `bindSocketToStore.js` catches the trigger event, calls `executePipeline` in `operationExecutor.js`, which runs LOOP/IF/action steps and returns effects. Effects (SET_FIELD_VALUE, SHOW_VALUE, etc.) are applied via CommitHelpers. `computedValues` in state holds display field outputs keyed by `[occurrenceId][fieldId]`. `FieldRenderer` reads from computedValues when `field.displayEnabled`.

**Drag**: `DragProvider.jsx` handles all drag events. Copy = new occurrence with same targetId. Move = update occurrence.parentId + reorder parent.occurrences array. Doc container drop = insert pill at cursor position in TipTap editor.

### Field Values and Flow

Field values are stored as `{ value, flow }` where flow is `"in"`, `"out"`, or `"replace"`. Operations loop over occurrences and aggregate based on flow direction — `"out"` values are negated (expenses, time lost). This lets you have one `amount` field serve both income and expenses in the same operation.

### Module Kinds
| Kind | What it renders | Notes |
|------|----------------|-------|
| `list` | Drag-sortable instance list | Default |
| `doc` | TipTap rich text editor | Field pills, instance embeds |
| `board` | Containers as columns | Kanban-style |
| `artifact` | File content by viewType | Markdown / image / PDF / audio / video |

### Transactions (Audit Trail)

Every change produces a **Transaction** record. Transaction types:

- **MeasureOp** — a field value changed on an occurrence: who (instance), what (field + value), where (container context), when (timestamp)
- **OccurrenceListOp** — an occurrence moved from one container to another: captures source/destination and a field snapshot at the time of move
- **EntityOp** — a module was created, updated, or deleted
- **DocEditOp** — a doc container's textmap changed (TipTap steps)

Transactions have a `state` field: `"applied"`, `"undone"`, or `"redone"`. Undo/redo flips the state and re-applies or reverses the change. The full history is queryable — you can ask "what was the value of this field last Tuesday?" by replaying transactions up to a point.

### Iterations (Time + Category Filtering)

**Iterations** control what data each occurrence "belongs to". Every occurrence has an `iteration` object:

```
iteration: {
  timeFilter: "daily" | "weekly" | "monthly" | "yearly" | "all"
  timeValue:  Date   — specific date/week/month this occurrence is pinned to
  categoryKey: String  — e.g. "context" (optional)
  categoryValue: Mixed — e.g. "work" (optional)
  mode: "persistent" | "specific" | "untilDone"
}
```

**Modes:**
- `persistent` — shows in every iteration (e.g. a recurring habit)
- `specific` — only shows on a particular date/week
- `untilDone` — shows until its `completionFieldId` field goes truthy

**Grid.iterations** defines named iteration configurations (e.g. "Daily Work", "Weekly Personal"). Each has a `timeFilter` and optional `categoryKey`. The grid has a `selectedIterationId` and `currentIterationValue` (the active date/week/month). Panels, containers, and instances can each `inherit` the parent's iteration or set their `own`. This cascades: Grid → Panel → Container → Instance.

**IterationNav** (Toolbar) lets you advance the global time position (prev/next day, week, etc.). Panels with `mode: "own"` show their own local arrows independently.

### Templates

Modules are already templates — the same module can have many occurrences in different places. But there's also an explicit **Templates** feature:

- `grid.templates: [{ id, name, moduleIds, occurrenceIds }]` — saved workspace snapshots
- `save_template` socket event — captures a container (+ its instances) as a reusable template
- `fill_from_template` socket event — stamps a new set of occurrences from the template into a target container
- Templates let you define a "Morning Routine" layout once, then stamp it into any time slot on any day
- Drag a saved template from the Command Center into any container to fill it

---

## Implementation Roadmap

### Phase 1: Occurrences & Core DnD — 98% Complete

| Feature | Status |
|---------|--------|
| Occurrence-based architecture | ✅ Done |
| Pragmatic Drag and Drop integration | ✅ Done |
| Panel/Container/Instance hierarchy | ✅ Done |
| Grid-based cell placement | ✅ Done |
| Copy vs Move modes (per-entity) | ✅ Done |
| Session ref for sync drop handling | ✅ Done |
| RadialMenu with portal z-index | ✅ Done |
| Panel stacking and navigation | ✅ Done |
| Sorting within parents | ✅ Done |
| Drop indicators with edge detection | ✅ Done |
| Live preview during drag | ✅ Done |
| Auto-scroll during drag | ✅ Done |
| Cross-window copy (basic) | ✅ Done |
| Socket.io real-time sync | ✅ Done |
| External file/URL drops | ✅ Done |
| Touch/mobile drag support | ✅ Done |
| Resize touch support | ✅ Done |
| Multi-window sync | ⬜ Not started |

**Remaining (2%)**: Multi-window sync (optional enhancement).

---

### Phase 2: Fields & Calculations — 97% Complete

| Feature | Status |
|---------|--------|
| Field model (input/derived modes) | ✅ Done |
| Field types: number, text, boolean, select, date | ✅ Done |
| Field types: rating, duration | ✅ Done |
| Checkbox inputs (boolean variant) | ✅ Done |
| Toggle switch inputs | ✅ Done |
| Number inputs with increment/decrement | ✅ Done |
| Text inputs | ✅ Done |
| Select dropdowns | ✅ Done |
| Date inputs | ✅ Done |
| Rating inputs (1-5 stars) | ✅ Done |
| Duration inputs (hours + minutes) | ✅ Done |
| Field bindings on instances | ✅ Done |
| Value storage as `{ value, flow }` | ✅ Done |
| Flow-based aggregation (in/out/any) | ✅ Done |
| All 15 aggregations (sum, count, avg, median, mode, etc.) | ✅ Done |
| Scope filtering (grid/panel/container/instance) | ✅ Done |
| Time filtering (today, thisWeek, thisMonth, etc.) | ✅ Done |
| Target scaling across time periods | ✅ Done |
| Progress bar display (in FieldDisplay) | ✅ Done |
| FieldRenderer routing to correct component | ✅ Done |
| FieldPillInput/FieldPillDisplay compact mode | ✅ Done |
| Schema enum for all 15 aggregations | ✅ Done |
| Select field multi-select mode | ✅ Done |
| Select field quick-add options | ✅ Done |
| Select field removeOnComplete | ✅ Done |
| Emotion wheel mood selector | ✅ Done |
| Watchlist/reading list with completion hiding | ✅ Done |
| UI for flow direction selection | ✅ Done |
| UI for configuring allowedFields | ⬜ Not started |
| **Future: Select Field Aggregations** | |
| Count occurrences of each select value | ⬜ Not started |
| "Most common emotion this week" aggregation | ⬜ Not started |
| Select value distribution charts | ⬜ Not started |

**Remaining (3%)**: allowedFields UI.

---

### Phase 3: Transactions & Block System — 88% Complete

**Transaction System** captures WHO, WHAT, WHERE, WHEN for every change:
- Time-travel queries for historical aggregations
- Audit trail with timestamp, previousValue, flow direction
- Undo/redo via transaction state (applied/undone/redone)

**Block System** (Snap!/Scratch inspired visual programming):
- Block types: FIELD, LITERAL, VARIABLE, OPERATOR, COMPARISON, LOGICAL, AGGREGATION, FUNCTION, CONDITION, LOOP
- Block shapes: REPORTER (oval), STATEMENT (rect), C_BLOCK, HAT
- Full visual editor with drag & drop

| Feature | Status |
|---------|--------|
| **Transaction System** | |
| Transaction model (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp) | ✅ Done |
| Undo/redo system (useUndoRedo hook) | ✅ Done |
| TransactionHistory.jsx UI | ✅ Done |
| Server undo/redo socket handlers | 🟡 Partial |
| Undo slide-back animations (FLIP) | ⬜ Not started |
| **Block System** | |
| blockTypes.js (all block types & shapes) | ✅ Done |
| blockEvaluator.js (recursive evaluation) | ✅ Done |
| useBlockDnD.jsx hooks | ✅ Done |
| Block.jsx, Slot.jsx components | ✅ Done |
| BlockPalette.jsx (toolbox) | ✅ Done |
| OperationsBuilder.jsx + OperationsCanvas.jsx | ✅ Done |
| **Notifications & Feedback** | |
| Toast notifications (sonner) | ✅ Done |
| FieldValueIndicator (green/red arrows) | ✅ Done |
| useAnimations hook (FLIP animations) | ✅ Done |
| GridRadialMenu (Undo/Redo/History/Fields) | ✅ Done |
| **Future** | |
| Offline support with sync queue | ⬜ Not started |
| Conflict resolution | ⬜ Not started |
| Achievement badges | ⬜ Not started |

**Remaining (12%)**: Server undo handlers completion, slide-back animations.

---

### Phase 4: Rich Editor, Iterations & Artifact System — Complete

**Rich text with embedded field/instance pills + compound iterations + unified artifact model.**

| Feature | Status |
|---------|--------|
| **Editor (ui/Editor.jsx)** | |
| TipTap editor with @ mentions (FieldPill, InstancePill, DocLink) | ✅ Done |
| DocToolbar (Bold/Italic/Strike/Code, H1-H3, Lists, Unlink, MD export) | ✅ Done |
| FieldPillExtension + InstancePillExtension + DocLinkExtension | ✅ Done |
| Drag instances into doc → inserts pill | ✅ Done |
| **Artifact System (modules/)** | |
| modules/Artifact.jsx — pure content renderer (markdown/image/pdf/audio/video) | ✅ Done |
| modules/View.jsx — layout + ManifestTree sidebar routing | ✅ Done |
| ManifestTree — folder tree, click to set activeOccurrenceId | ✅ Done |
| occurrence.textmap replaces docContent (TipTap JSON in DB) | ✅ Done |
| textmap → artifacts/[fileRef] sync on save | ✅ Done |
| POST /api/artifacts/upload — creates Module + Occurrence + View | ✅ Done |
| artifacts/ static middleware | ✅ Done |
| **Three-Concept Model** | |
| occurrence.viewId → View (separate model, NOT on module) | ✅ Done |
| occurrence.parentId + occurrence.occurrences (tree ordering) | ✅ Done |
| module.fileRef for artifact file reference | ✅ Done |
| Doc.js + Artifact.js deleted (replaced by textmap + fileRef) | ✅ Done |
| panels/ folder deleted (replaced by modules/) | ✅ Done |
| ui/Field.jsx — merged FieldDisplay + FieldPillDisplay | ✅ Done |
| **Iteration System** | |
| IterationNav.jsx, IterationSettings.jsx | ✅ Done |
| Compound iterations (time + category), cascading | ✅ Done |
| Local iteration arrows on panels/containers | ✅ Done |
| **Remaining** | |
| ModuleEmbed TipTap extension (@:(id) universal embed node) | ⬜ Not started |
| Day pages auto-creation operation | ⬜ Not started |
| Live value calculation in field pills | ⬜ Not started |

---

## Compound Iteration System (Phase 4 Enhancement)

### Current State
The system uses `occurrence.iteration` with:
- `key: "time"` - time-based filtering
- `value: Date` - specific date
- `mode: "persistent" | "specific" | "untilDone"`

### Enhanced Design: Compound Iterations

Iterations can be BOTH time-based AND category-based simultaneously. Categories work like tags/contexts that can filter independently of time.

**Enhanced Schema:**
```javascript
// Occurrence iteration
iteration: {
  // Primary axis: time (always present)
  timeKey: { type: String, default: "time" },
  timeValue: { type: Date },
  timeFilter: { type: String, enum: ["daily", "weekly", "monthly", "yearly", "all"] },

  // Secondary axis: category (optional)
  categoryKey: { type: String },    // "context", "project", "area", null
  categoryValue: { type: Mixed },   // "work", "personal", ["health", "fitness"], null

  // Persistence mode (applies to both axes)
  mode: { type: String, enum: ["persistent", "specific", "untilDone"] },

  // Completion tracking (for untilDone mode)
  completedOn: { type: Date },
  completionFieldId: { type: String },
}

// Grid iteration definitions (user-configured)
Grid.iterations: [{
  id: String,
  name: String,                     // "Daily Work", "Weekly Personal"
  timeFilter: String,               // "daily", "weekly", etc.
  categoryKey: String,              // "context", "project", or null
  categoryOptions: [String],        // ["work", "personal", "health"]
}]

Grid.selectedIterationId: String,   // Current iteration definition
Grid.currentTimeValue: Date,        // Current time position
Grid.currentCategoryValue: Mixed,   // Current category filter (or null for all)
```

### Cascading Iterations

Iteration settings can be overwritten as you go down the hierarchy:

```
Grid: Daily + All Categories
  └─ Panel (inherit): Daily + All Categories
      └─ Container (own: Work only): Daily + Work
          └─ Instance (inherit): Daily + Work
  └─ Panel (own: Weekly): Weekly + All Categories
      └─ Container (inherit): Weekly + All Categories
```

**Key Principle**: Each level can either:
- `inherit` - Use parent's iteration settings
- `own` - Override with specific settings

### Local Iteration Navigation

Each panel/container with `mode: "own"` can have its own iteration arrows:

```
┌─────────────────────────────────────────┐
│ Schedule Panel                    [⚙️]  │
│ ◀ Mon, Feb 10  [📅] ▶   [Work ▼]       │
├─────────────────────────────────────────┤
│                                         │
│  • 9:00am Meeting                       │
│  • 10:00am Code review                  │
│                                         │
└─────────────────────────────────────────┘
```

The panel can navigate its own iteration independently of the grid's global iteration.

### Use Cases

1. **Daily Schedule + Work Context**: See only work items for today
2. **Weekly Goals + Personal**: See personal goals for this week
3. **Panel with Different Time**: Grid is daily, but one panel shows weekly view
4. **Category-Only Filter**: Same day, but filtered to "Health" context

---

## Summary: Phase Status

| Phase | Name | Completion |
|-------|------|------------|
| 1 | Occurrences & Core DnD | **100%** |
| 2 | Fields & Calculations | **97%** |
| 3 | Transactions & Operations Pipeline | **100%** |
| 4 | Rich Editor, Iterations & Artifact System | **92%** |
| 5.1 | Cascading Style Overrides | **100%** |

**Phases 1-3, 5.1: Complete. Phase 4: 92% (ModuleEmbed + day-page auto-creation remaining).**

---

## Known Issues

### Priority 1 — Bug Fixes
- [x] ~~**Field schema enum mismatch**: Fixed - all 15 aggregations now in schema~~
- [x] ~~**Panel backgrounds missing**: Fixed - added @config directive for Tailwind v4~~
- [x] ~~**Copy/move drag glitchy**: Fixed - session ref for immediate mode access~~
- [x] ~~**Container fields missing**: Fixed - spread `...obj` in loadUserIntoCache~~
- [ ] **React child error**: forwardRef icon components (intermittent)

### Priority 2 — Polish
- [ ] Touch gesture optimization for mobile
- [ ] Performance optimization for 100+ items

---

## Quick Reference

### Running the App
```bash
# Development (runs client + server)
npm run dev

# Reset sample data
cd server && node scripts/resetData.js
```

### Key Files
| File | Purpose |
|------|---------|
| `client/src/helpers/DragProvider.jsx` | Drag state coordinator |
| `client/src/helpers/CalculationHelpers.js` | All calculation/aggregation logic |
| `client/src/helpers/CommitHelpers.js` | CRUD operations |
| `client/src/ui/FieldRenderer.jsx` | Field display routing |
| `client/src/ui/IterationNav.jsx` | Time navigation controls |
| `client/src/ui/IterationSettings.jsx` | Persistence mode selector |
| `client/src/state/selectors.js` | Occurrence resolution helpers |
| `client/src/blocks/` | Visual block programming system |
| `client/src/docs/` | Rich text editor & pills |
| `server/models/Occurrence.js` | Occurrence schema with iteration |
| `server/models/Transaction.js` | Audit trail schema |

### Architecture Patterns
- **Occurrence-based**: Entities are templates, occurrences are placements
- **Session refs**: Immediate state access during async operations
- **Flow values**: `{ value, flow: "in"|"out"|"replace" }` for aggregation
- **Per-entity drag mode**: `defaultDragMode` on panels/containers/instances
- **Panel placement**: Position stored in `occurrence.placement` (not panel.row/col)
- **Iteration inheritance**: Grid → Panel → Container → Instance cascading
- **Compound iterations**: Time + Category filtering simultaneously

---

## Original Vision (Day Planner Explanation)

### What it is (in plain English)

A **drag-and-drop daily command center** where:
- You plan your day by **dragging tasks into time slots**
- You can also **track what you actually did**
- It can **calculate totals, streaks, progress, and stats automatically** from whatever you log

Think: **calendar + to-do list + habit tracker + budget/nutrition/workout tracker**, all in one.

### The big idea: "Anything you do can be measured"

A normal planner: "I did laundry ✅"

This planner:
- "I ran ✅ **for 25 minutes**"
- "I ate ✅ **42g protein**"
- "I saved ✅ **$20**"
- "I studied ✅ **2 pomodoros**"

Every task can be just a checkbox **or** a checkbox plus numbers/text.

### How scheduling works

**1) Build a "Task Bank"** - Your library of stuff you do (work, gym, meals, finance, routines)

**2) Drag tasks into your day** - Single task, multiple tasks, or preset bundles

**3) The schedule becomes your plan AND your log** - Same slots represent intent and reality

### How calculations work

The app calculates anything based on:
- **What task it was** (Protein vs Savings vs Meditation)
- **What value you entered** (42g, $20, 15 minutes)
- **What time "lens"** (Today, This week, This month)
- **What category filter** (Work only, Personal only, All)

So it can answer:
- "How much protein did I log **today**?"
- "How much did I save **this month**?"
- "How many **work** tasks did I complete **this week**?"
- "What's my streak for journaling?"

### One-liner

A **drag-and-drop day timeline** where every task can be a **checkbox or a measurement**, and the app can **sum/count/track progress across any time window AND category** without needing separate trackers.






##


