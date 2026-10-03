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

### 2026-10-02 (8) — UNDO OF A DOC DROP: three steps, half-applied, and never on screen

Continuing the docs pass (*"please continue with the ui testing"*). Move Charlie from Wrap Lab into its
nested container, then ONE Ctrl+Z:
```
before   3 transactions (Charlie's parent · nested text · outer text), one action each;
         Ctrl+Z undid the two texts in Mongo and NEITHER changed on screen; the parent stayed moved
after    1 transaction "3 changes", undone by one press; screen restored within 1s; parent restored
```
- **One step:** the drop runs inside `withAction("Dropped block")`, and `persistContent` carries the action
  open when a save was SCHEDULED past its 500ms debounce (`captureAction`/`retainAction`/`runInAction`).
  The 09-22 (12) entry called this "keeping the action open across the debounce" and left it open.
- **On screen:** two defects in the FAST undo path, each enough alone. The restored rows went out with
  their textmap still COMPRESSED (snapshots keep the `$set` form), so the store took a base64 string as the
  doc's text — `wireRestoreDocs` decompresses, as `patchCache` already did for the cache. And
  `onUndoApplied` requested the force-sync and never committed it (only `full_state` did), so open editors'
  guards refused the revert. Typing undo had gone through the slow path when it was verified (08-01).
- **Watched, each one press:** cross-doc move (above), same-doc reorder via the top edge, and a drop into the
  wrap group's float side (group back to `fc1`, exact). Wrap Lab ends as it began; Charlie's parent, which
  the first pre-fix run left on the nested container, was put back through `update_occurrence`.

---

### 2026-10-02 (7) — AN OPEN EDITOR CAN NO LONGER SAVE OLD TEXT BACK; a gap-clicked block left empty goes

User: *"handle those please"* — the open items from (6).

**THE STALE EDITOR (open since 2026-10-01 (4)).** The stale-write check compares TIMESTAMPS, the restart's
full_state had handed the tab a fresh one, and the check is skipped outright while only ONE tab is open —
so nothing could stop a mounted editor saving pre-migration text. A text save now carries a fingerprint of
the server text its editor was built on (`server/utils/textmapDigest.js`, shared; sorted keys so key order
never reads as a change). `update_occurrence` refuses a text save whose basis is not the stored text —
**including with one tab open**, because a migration is not a tab (`textSaveIsStale`, checked before any
await; an in-flight mark lets an editor's next save build on its previous one). The refused editor is told
to SHOW the server copy past its focus/typed guards (`editorSyncSignal.requestEditorAdopt`), with a toast.
Field and child-list writes move `updatedAt` but not the fingerprint, so they never make a text save stale.
**Watched on prod:** focused block, typed A, a second socket rewrote the text, typed B → `REFUSED stale
text` in the log, Mongo kept the other writer's text, the editor showed it with the toast. Control: the same
typing with no other writer saved, 0 new refusals. **Found by watching, fixed:** the adopt was first spent
on the render that still carried the refused text (the split-render class `editorSyncSignal` documents) —
it is spent only when the server copy is applied now.

**THE GAP-CLICKED BLOCK.** It is a real row from the start (it becomes the wrap's host), so the doc mint's
provisional vanish never covered it. `helpers/gapMints` marks it; `TextblockCard`'s editor gets an
empty-blur that runs the embed's own Delete; the mark ends once it holds text. **Watched:** gap click →
click the picture → block gone from the doc AND Mongo; typed "kept" → click away → stays.

**NOT done: Firefox extension signing** — `extension/.sign.env` does not exist yet (the AMO keys go there,
never in chat). Server 3,001 · client 5,600. Wrap Lab restored from its saved JSON; test rows deleted.

---

### 2026-10-02 (6) — A DROP ON A BLOCK'S EDGE WRAPPED IT; Firefox crashed the panel on a drop; a block moved doc to doc kept its old owner

Continuing the docs/DnD pass, now in **Firefox** (the user's browser), checked in Mongo afterwards.
```
top/bottom-edge drop wrapped   detectSideHost picked a side for ANY point over a block, so dropping on its
                               top edge to reorder formed a wrap instead. A band of EDGE_INSERT_PX (12px,
                               capped at a third of the block's height) at the top and bottom is a plain
                               insert above/below; the middle still wraps.
panel crashed on a drop (FF)   "[tiptap error]: The editor view is not available" — my data-host-occ
                               effect read `editor.view.dom`, and TipTap's `view` GETTER throws while the
                               view is unmounted. `embedRegistry.editorDom(editor)` answers null instead,
                               and hostOccurrenceIdOf uses it too.
doc -> doc move kept its owner  only the board->doc branch re-parented. A block whose parent is the doc it
                               left (that doc's textmap embeds it) now takes the new doc as parent, so its
                               Delete there deletes instead of unlinking. Placed-from-elsewhere rows keep
                               their parent.
```
**Watched in Firefox:** top/bottom-edge drops reorder and survive a reload, a middle drop still wraps, no
crash. **Charlie (Wrap Lab → its nested container): parentId 74fe9426 → 939b4a7a; dragged back out →
74fe9426.** The nested container's textmap ends identical to its pre-test transaction. Probe note: a drop
point near the viewport top auto-scrolls during the drag, so the block can land one slot off.

---

### 2026-10-02 (5) — ON A DOC PAGE, DELETE NEVER DELETED; and copies dropped into a doc belonged to nobody

Continuing the docs/DnD pass (*"keep going with testing please"*). Each found by doing it on Wrap Lab and
reading Mongo afterwards, not the screen.
```
Delete on a doc page only unlinked  `hostOccurrenceIdOf` reads the nearest [data-occ-id] above the editor —
                                    a doc PAGE has no card around it, so it found nothing and every
                                    owned-row Delete (09-19's Check In rule) became an unlink there. The
                                    editor now stamps `data-host-occ` on its own root and the lookup reads
                                    that first.
a textblock's radial only unlinked  the textblock branch of ModuleEmbedNode passed `deleteNode`; it uses the
                                    ownership rule now (owned -> Delete, placed from elsewhere -> Remove).
                                    Before: a minted, typed, removed block left its row behind (2 found).
a copy / copy-link in a doc         stored with parentId null — owned and listed by nobody, so its Delete
                                    could only unlink. Owned by the doc now (a copy's children by the copy).
```
**Watched:** mint on the last line → type → drag onto the text side as a lead → radial reads **Delete** →
gone from the doc AND Mongo, group `floatCount` intact after reload. Copy-mode drag → copy's parentId is the
doc → Delete removes it. Debris from the pre-fix runs (2 scratch rows, 1 ownerless copy) deleted through the
app; Wrap Lab ends as it began. **Also found the other session had already fixed the radial that "fled the
pointer"** (57c2f31f) while my `overflow-anchor` attempt was going on; my commit `333aaa9e` carries only a
test, removed in `1a7dfd8d`.

---

### 2026-10-03 (3) — BILLS PAID COUNTS THIS MONTH'S PAY BILLS (0387); week/month/year compared a UTC day

User's answer: Bills Paid = *"Paid Pay Bills this month"*. **0387** — `Bills: Paid This Month` sums the Amount
of completed Pay Bills (by the Pay Bill module) whose Date is `SAME_MONTH $activeDate`; its triggers drop the
bill's Day and add a Pay Bill's Completed and Date. `Bills: Mark Paid` (ticked the BILL) is deleted. After the
restart: Monthly Bills 24, **Bills Paid 0** (was 24 — DigitalOcean's own August tick). Executor test drives the
real pipeline (the 1st of the month counts, Sep 30 and unpaid do not, a ticked bill does not).
**Found writing it:** `SAME_WEEK` / `SAME_MONTH` / `SAME_YEAR` parsed both sides with `new Date()` — a
date-only `2026-10-01` is Sep 30 evening in US time, so the 1st of a month was "last month", a Monday "last
week", Jan 1 "last year". They use `parseLocalDate` now (SAME_DAY already normalised). 3 new tests fail on
the old code. Full client suite 541/541. The DigitalOcean bill itself still holds Completed = true from
August; nothing reads it now.

---

### 2026-10-03 (2) — BILLS ON THE REBUILD, BY CLICKING: board, Bill field, Pay Bill, `Bills: Into Schedule`

- **0386 (poms)** — 0385's reference check skipped the FIELDS collection: Bill and Subscription still listed
  Cadence in `addNew.fieldIds`, so adding a bill from their dropdown would have bound a deleted field. Pruned;
  nothing on poms names the four retired fields now (checked across every collection).
- **Built by clicking on the rebuild:** Boards › Money › **Bills** (board page + container, `_area.sh` recipe;
  Board Category option `bill`), **DigitalOcean** (Amount 24, Day 2, Completed — attached through Settings and
  set through its chips; its Board Category chip is hidden by the grid's field visibility, so it has no
  category), a **Bill** occurrence field (Fields tab, Find: `_ancestors HAS_ANCESTOR` the Bills page — preview
  1 match), Routines › **Admin** › **Pay Bill** (Bill, Amount, Completed, Date), and **Bills: Into Schedule**
  — 20 steps, the same pipeline as poms' 0384 (minus Completed=false, which the rebuild's source never holds)
  with the same seven triggers at p6.
- **Editor gap, fixed:** the copy step could not set `linked:false`, the copy's `fields` or their
  `fieldHidden` (live usage 1 / 7 / 6). `COPY_LINK` now declares `linked` (bool, default on) and `fields`
  (new schema kind `fieldMap`, drawn by the CREATE step's `FieldsMapEditor`). Used to build the step above.
- **Watched:** DigitalOcean's Day 2 → 3 through its chip put a Pay Bill in Oct 3's Todo (Bill = DigitalOcean,
  Date Oct 3, Amount 24, unlinked, listed); back to 2 removed it (unpaid, so swept).
- **Probe notes:** the copy step's attach picker is the button `+ Attach a field` and opens straight onto the
  field list; the loop collection picker lists `$activePeriodDates` / `$allInstances` at the top level (not
  under Built-ins, which is where the CONDITION picker keeps `$trigger`). A DATE_FORMAT's output box has the
  placeholder `(default: $formatted)` — typing into "the first input" overwrote its date.

---

### 2026-10-03 — POMS: three ops read a hand edit, Next Due retired (0385); text → MINI TEXTBLOCK

The user's answers (asked, *"asl the questions you need"*): fix poms' Route by Timeslot + Status Router ·
delete Compute Next Due + Due: Seed · the toolbar's text→pill should make *"minitextblock occurances, not
just something in line"* · next rebuild area: Bills.
- **0385** — Route by Timeslot gets the rebuild's shape (the item's own day column, then the slot); Status
  Router and its sibling Sync To Todo List (same trigger, same read) read `$trigger.value` instead of
  `$trigger.fields.<Status>.value` (undefined for a hand edit). Compute Next Due + Due: Seed deleted; fields
  Next Due, Cadence, Every N Days, Anchor Date deleted after the migration proved nothing else names them.
  Monthly Bills summed `Cadence IS monthly`, which would have dropped every bill — it sums bills WITH A DAY now,
  and both bill tiles re-run on a Day edit. **After the restart: Monthly Bills reads 24 (DigitalOcean).**
  Not exercised live on poms: Route and the Project ops would move the user's real items (tests drive the
  real executor; the Route shape was watched on the rebuild).
- **Text → mini textblock** — DocToolbar's selection button minted an `instancePill` with a random instanceId
  and NO module (its stored `instanceLabel` was its only content). It now makes an `instanceTextblockInline`
  occurrence, through `CommitHelpers.createInlineTextblock` — the one creator the right-click "Make inline
  textblock" and "Split into inline textblocks" now share, each ONE undo step (the hand-rolled mints had none).
  Full client suite 538/538. Not clicked in a browser yet.
- **Found, for the Bills pass:** "Bills Paid" reads 24 too — Paid This Month counts a bill whose own
  Completed is true, and DigitalOcean has been Completed since August. It is not month-scoped.

---

### 2026-10-02 (8) — `Schedule: Route by Timeslot` BY CLICKING — and an operation's MOVE had never moved anything

Built on the rebuild by clicking, in the shape that can work with day columns (poms' own cannot — see below):
```
IF $trigger.value IS_NOT_EMPTY
  $item = $trigger.occurrence
  FIND $allContainers: under Schedule · Schedule Format IS day-col · Date SAME_DAY $item.Date  -> $dayColId
  IF $dayColId:  FIND $allContainers: under $dayColId · Schedule Format IS slot · Time Slot IS $trigger.value -> $targetSlotId
    IF $targetSlotId:  MOVE_OCCURRENCE $trigger.occurrenceId -> $targetSlotId
trigger onChange · field Time Slot · p3
```
**THE RUN LOG SAID `MOVE_OCCURRENCE=1` AND THE ITEM STAYED PUT.** The client applied the effect by emitting a
`move_occurrence` socket event — **no server handler for it has ever existed** (`git log -S` finds none), so in a
tab every op move was a no-op. It is the only move action the editor offers and five live poms ops carry it
(Project: Status Router, Project: Sync To Todo List, Schedule: Route by Timeslot, Schedule: Build Day; Share:
pdf runs it server-side, where it works). The effect now shares `UPDATE_ITEM_PARENT`'s reparent (unlist from the
old parent, set parentId, list in the new one); the dead `CommitHelpers.moveOccurrence` is gone; and the action
refuses a destination or subject that is an ARRAY (`singleOccurrenceId`, like ADD_CHILD) instead of writing a
parentId nothing has. `moveOccurrenceEffect.test.js` (6) drives the real effect handler and executor.
**Watched after the deploy:** Book dentist in Oct 2's Todo, Time Slot set to 10:00am through its chip → it is
in Oct 2's 10:00am slot (parent + listing, kept on reload); dragged back to Tasks → Date and Time Slot cleared.
**poms' own `Route by Timeslot` is still inert, reported not changed:** its gate reads `$trigger.fields.<Time
Slot>.value` (undefined for a UI edit) and its FIND matches the slot of that name in EVERY day column, which
the new refusal now names in the run log rather than moving anything. `Status Router` gates on the same read.
**Also reported:** `CREATE_OCCURRENCE` ("Create occurrence — for existing module" in the picker) emits
`create_occurrence_in_container`, which has no server handler either; 0 live operations use it.
**Probe notes:** `$trigger` lives under **Built-ins** in the path picker. `localVarsFromSchema.test.js` needed
the jsdom pragma since OperationsBuilder imports FieldSelect (`window` at import). Rebuild ops: 17.

---

### 2026-10-02 (7) — TWO MORE OPS BY CLICKING: `Schedule: Clear Date on Move-Out`, `Schedule: Stamp Completed On`

Both pipelines are step-for-step poms' (ids mapped; a typed `true` is the string, which `IS` compares equal).
```
Clear Date on Move-Out   INIT $schedPageId · FIND id IS $trigger.occurrenceId -> $movedItem ·
                         IF $movedItem._ancestors NOT_HAS_ANCESTOR $schedPageId -> UPDATE Date = null, Time Slot = null
                         trigger onMove · module · p2
Stamp Completed On       INIT $occ = $trigger.occurrence · IF $occ.id IS_NOT_EMPTY ·
                         IF Completed IS true -> UPDATE Completed On = $today  ELSE -> null
                         trigger onChange · field Completed · p0
```
**Watched on the rebuild:** Book dentist dragged Tasks › Today → Schedule › Todo: `Stamp Date & Time Slot` set
Date Oct 2; dragged back out: `Clear Date on Move-Out UPDATE_ITEM_FIELD=2`, Date null. Drink's Completed
switch on → Completed On 2026-10-02, off → null. Rebuild ops: 16.
**Editor gap, fixed:** poms' six move triggers store subject `occurrence`, which the trigger editor never
offered — a `<select>` showed them as "Module". `triggerTypes.subjectOptions(stored)` adds a stored subject the
list lacks (the `priorityOptions` rule). With no target, `occurrence` and `module` match the same moves
(`matchSubjectFilter` returns true on an empty targetId), so the rebuild op uses `module`. Unit-tested; the
poms row was not opened to look at it.
**Probe notes:** a new op is born with an `onLoad` trigger — on a move-only op it must be removed (it ran on
load and logged `$movedItem not bound`). An IF's else list does not exist until its `+ else` button is pressed.
The FIND output inputs are placeholders `myId` (id var) and `myItem` (item var).

---

### 2026-10-02 (6) — `Days Until Due`, BUILT BY CLICKING; a date 7 days out read 6

Picked up the main account's operations pass (it had made the eight field-id step settings a searchable
picker, `c76d5ab2`, and hit its limit before using it). On the rebuild grid, by clicking: `+ Operation` →
"Days Until Due" → `+ Action` → Variables › Dates › 📐 difference → **date field = Due, write to field = Days
Until Due through the new pickers** (stored ids correct) → triggers onChange Due · onFilterChange filterNav ·
onFilterChange grid (+ the default onLoad). Same step and triggers as poms' (priority 5 here, 4 there).
Due + Days Until Due attached to Tasks › Today › Email Sam through its Settings.
**Watching it found the defect:** Due = Oct 9 on Oct 2 showed **6**. `DATE_DIFF`, `COUNT_DATE_OVERDUE` and
`COUNT_DATE_UPCOMING` read the field with `new Date("2026-10-09")` — UTC midnight, the previous evening in
US timezones. They use the file's own `parseLocalDate` now (`dateDiffLocalDay.test.js`; the old code fails 3).
**After the deploy:** load → 7; Due changed to Oct 10 through its chip → 8 live. Rebuild ops: 14.
**Also:** the eleven example bills on poms' Bills page were deleted through the app at the user's ask
(backup `server/backups/orphans/2026-10-02-example-bills.json`); only DigitalOcean remains.
**Probe note:** a date chip is a `<label title="Due: …">` wrapping an `input[type=date]` — set the input's
value (native setter + input/change); clicking the label opens a native picker a headless browser cannot drive.

---

### 2026-10-02 (5) — `Bills: Into Schedule` (0384): a Pay Bill in the day's Todo on each bill's day of the month

User: *"make an op on poms grid quick that takes bills, checks its reoccurance day … and add a copy to my
schedule on the given day"* · *"start with Digital Ocean on the 2nd of every month"* · *"its 24 dollars"* ·
*"dont use due date cause its suppose to be a 1-30 thing"* · *"make it a pay bill occurance added to schedule
with that bill selected and completed set to off"*.

No new field: every seeded bill already binds `Day` (number, day of the month). The op mirrors `People:
Birthdays` (0367): per `$activePeriodDates` day → the day column → its Todo → each instance under the Bills
page whose `Day` IS `DATE_FORMAT(day,"d")` gets a `COPY_LINK linked:false` of the Routines "Pay Bill" item
with Bill = the bill, Amount/Account from the bill, Date = the day, Completed = false. Dedup by (Todo, Pay
Bill module, Bill); an UNPAID op-made card whose bill left the day is swept, a paid or hand-made one never.
`Next Due` / `Due` are not read. Triggers: Build Schedule's + onAdd/onDelete under Bills + onChange Day/Amount.
DigitalOcean (it bound nothing) now binds Amount, Day, Completed — Amount 24, Day 2 — set through the app's
socket events. Test `billsIntoSchedule.test.js` drives the real executor (7 cases).
**Watched after the restart:** Oct 2's Todo holds one Pay Bill — Bill DigitalOcean, 24, not completed, no
linkedGroupId, listed. **To know:** the other ten seeded bills (Rent on the 1st, Electric the 5th, …) have a
Day too and will get a Pay Bill on their days; clearing a bill's Day stops it. The older `Due: Seed` /
`Compute Next Due` pair (Next Due based) is untouched and looks dead — every Next Due is still in August and
its Todo FIND matches every day's Todo.

---

### 2026-10-02 (4) — TYPING BESIDE A PILL TORE THE PAGE APART; "To pill" on a textblock read "Item"

User: *"why does pills and textblocks have labels? fix the other thing too and continue"*.
```
"To pill" on a textblock -> "Item"   it made an instancePill from `mod.label`; a textblock has no label,
                                     its words are its body. It becomes the inline textblock chip now
                                     (docs/toPill.js `pillNodeFor`) — only for a plain one-line body, since
                                     the chip writes its body back as one text paragraph. An instance pill is
                                     named by its PLACEMENT (occurrenceDisplayLabel), at insert and at render.
no way back from the chip            the chip's menu was Remove only. "To block" added; it and the pill's
                                     "Convert to Embed" go through `liftInlineToBlock` — the pill's version
                                     replaced the WHOLE paragraph, deleting the sentence around the pill.
typing beside the chip (my probe)    the strict-block sweep's rule was "every top-level node that is not an
                                     instanceTextblock becomes one": it minted five textblocks, put the
                                     page's container embed inside one and tore the wrap group in two.
                                     `helpers/strictBlockSweep.looseTextBlocks` is an ALLOWLIST of text
                                     blocks now. (The 2026 "textChanged" gate had patched one trigger of
                                     this — a seam resize — and left the rule.)
the first character dropped the pill single-char auto-create rebuilt the line from its textContent. A line
                                     holding inline nodes moves whole (nodeJson).
the next character deleted a picture replacing a line with an atom leaves a NODE selection on the next block
                                     (the wrap group's float); a keystroke before focus reached the new
                                     sub-editor replaced it and split the group. `typingWouldReplaceBlock`
                                     swallows a character typed over a selected block.
```
**Watched on prod:** To pill -> chip reads "Charlie three"; type inside the chip -> saved, kept on reload;
type beside it -> one new textblock holding chip + text, container embed and wrap group untouched; chip menu
`To block | Remove` -> block again, kept on reload. **The Wrap Lab page was damaged twice by the probe and
restored through the app's events** from the transaction snapshot (`_wlrestore.mjs`, backup
`server/backups/orphans/2026-10-02-wraplab-autowrap.json`); nothing was deleted — the originals were only
unlinked from the doc. **Open, the user's call:** a pill still STORES `instanceLabel` in the doc. It is a
fallback when the instance is not loaded, the text for markdown export, and — the reason it cannot simply
go — DocToolbar's "pill from selection" mints a pill with no module at all, so the attr is its only content.
**Probe notes:** every editor's root has the same class, so `activeElement.className` cannot tell the page
editor from a block's; the chip's handle has no box until the chip is hovered.

---

### 2026-10-02 (3) — WRAP RADIALS: a handle that fled the pointer, a menu frozen at first render, commands that minted textblocks, side-by-side in two columns

Picked up the docs/wraps UI pass (main account at its limit mid-bisect, account2 at its weekly limit).
```
a lead's radial would not open      At the bottom of a doc PAGE the page's trailing line collapsed whenever
  (Chromium, bottom of the page)    the pointer entered a nested block, clamping the scroll; Chromium then
                                    RESTORED the lost offset when the line came back, so the handle moved
                                    11-19px as the pointer reached it. `overflow-anchor: none` on the line
                                    (e33b4bc2) was inert — the line was never the anchor; every bisect arm
                                    "fixed" it only by forcing a fresh anchor. The page's OWN trailing line
                                    is never collapsed now (`.page-scroll > .doc-container …`).
host menu offered only Unwrap       ModuleEmbedNode's items memo read the doc + other occurrences' modules
  (Firefox)                         with none of them as deps. Keyed on `wrapRoles.wrapMenuKey` (group pos,
                                    members, wrap/floatCount, host/next block text-ness), re-read on doc
                                    transactions and module arrival.
"Continue wrap" minted a textblock  the menu click counted as a click on a line. A press on a button / menu
  on the line after the group       item no longer stamps the mint's input window (`isOnCommandControl`,
                                    nearest of {editable, control} decides).
```
```
"Side by side" on float+leads+host  a flex row with a column PER MEMBER (written for two-block groups): the
                                    leads were squeezed to ~90px, Bravo broke mid-word. Two columns now —
                                    floats stacked on the group's side, leads + host stacked on the other
                                    (floats + a margin on the text side, so a tall picture leaves no gaps).
Ctrl+Z after Unwrap minted a block  undo restores the caret onto the empty line below the group and the
                                    keystroke counted as input. Undo/redo chords AND a bare modifier's
                                    keydown (Ctrl arrives before Z — excluding only the Z changed nothing)
                                    no longer stamp the mint window (`isUndoRedoChord`).
```
**Also watched:** Side by side ↔ Wrap text around (current one marked, both persist), two columns with the
picture on either side (seam swap), Unwrap → Ctrl+Z restores the group with its roles; typing, Enter and
Ctrl+Z inside a lead and inside the host — 0 wrap/stack flips, kept on reload; Position left/center/right/
full on a plain block (40% float / centred / full, kept on reload); "Wrap behind previous" then Unwrap, both
kept on reload; "To pill" then Ctrl+Z. **Reported, not fixed:** "To pill" on a TEXTBLOCK makes a pill reading
"Item" — it takes `mod.label`, and a textblock's words live in its textmap. Alpha's paragraph keeps one extra
trailing space from the probe.

**Watched on prod, Chromium + Firefox:** every member's radial opens at the page bottom (scroll steady);
Move out of wrap → Continue wrap, twice in a row with no reload (the menu follows the doc), no mint,
persists; the stray empty line the pre-fix run left was removed through the UI (click → mint → Backspace).
**Probe notes:** two probes on the Wrap Lab at once corrupt each other's lookups — one at a time. A probe's
`scrollIntoView` right after load can itself create the clamped offset (content was 11px taller then).
`pomsGridOps` timed out in its `beforeAll` in the full run and passes alone.

---

### 2026-10-02 (2) — DRAG AND DROP IN DOCS, TESTED BY DRAGGING: seven defects, all fixed

User: *"lets switch back to the ui testing … drag and drop in docs"*, and on wraps: *"the last occurance on one
side must be a text block … so i should in theory have an image and textblock on one side, and 2 images on the
other side"*. Every item below was found by dragging on the rebuild grid's `Wrap Lab` page, and each fix was
re-watched after deploying.
```
a typed textblock could not host a wrap   detectSideHost rejected `instanceTextblock`; it is stored in the
                                          group as a moduleEmbed of the same occurrence (asWrapMember)
only a textblock could join the text side any block may be a LEAD; only the block that ends up LAST (the
                                          host) must be a textblock (textSideDrop)
a picture dragged out of a wrap landed    the target was re-measured after the unwrap, before React had
  nowhere / at the top                    rendered it; now re-found BY OCCURRENCE (refind)
edits made in full screen never saved     FullscreenOverlay's ModulePanel had no dispatch/socket (Grid.jsx)
two floats wrap/stack-flipped 240x in 4s  floats sat side by side; `clear` stacks them in one column
one float dragged out unwrapped the group extractGroupMember for floats too; only the HOST leaving unwraps
a picture lead stacked the group          the blank-band guard counted only TEXT beside the float; a lead
                                          with no text now counts its own box (WrapGroupNode measure)
```
`window.__wrapDiag = true` logs each wrap/stack flip's inputs (`band: 0` is what named the last one).
**Watched:** float, lead (picture), lead (textblock), host wraps at 1300/1600/1920 with 0 flips and survives a
reload; float, float, lead, host also wraps. **Then, at the user's ask (*"drop join the text side"*):** a group's own
float, dropped on its text side, joins it as a lead (only with 2+ floats — the last float leaving would
leave nothing to wrap; a drop over the float column still re-morphs). A lead dropped on the float column
becomes a float. **And a row moved from a board into a doc kept the board as its `parentId`** — deleting
the board would have cascaded into the doc. The doc becomes the parent when the board owned it (a file
homed in Files keeps its home). Also watched: seam resize 300→380→300 and the swap button, both persisted;
a host dragged into another doc leaves its group wrapping with the next textblock as host. And when the block left
LAST is not a textblock (a picture after the host is dragged out), the group shows two plain columns —
derived at render from the last block's module (`WrapGroupNode` `hostIsText`), so every path that can
leave a non-text last block is covered; an unloaded host counts as text. Watched: Bravo then Alpha dragged
out → `off :: float, host(picture)`, kept on reload.
**Probe faults:** a drop point near a panel's top or bottom edge auto-scrolls or lands in the NEXT panel
(one picture landed in Routines › Physical); centre the target first. A picture in COPY mode makes a copy
on every drag; two stray copies were removed with their embeds (`delete_occurrence`).

---

### 2026-10-01 (5) — THE GAP UNDER A SHORT TEXT SIDE TAKES A CLICK

User: *"click under a wrapped textblock (a shorter one that doesnt end up wrapping) and add more textblocks.
right now theres just a large space there that i can do nothing with"*. While wrapped, the group's box
reaches the float's bottom, so the band beside the picture under a short text side belongs to the GROUP,
not to any member. `wrapRoles.textSideGap` (pure, 5 tests) says whether a press is in that band (text side
of the float column, below the last text block, above the group's bottom); `WrapGroupNode` shows a dashed
"Click to add text" hint on hover and, on the press, creates a textblock with `createTextblockInContainer`
(parent = the doc that owns the editor, `hostOccurrenceIdOf`), appends it as the LAST text-side child with
`floatCount` stored — so it becomes the host that wraps and the old host a lead — and claims the caret.
**Watched on the rebuild grid** (fixture page `Wrap Lab`, built through the socket — kept for the docs/wraps
UI pass): hint on hover · click → `float,lead,host` · caret in the new host · typed text survives a reload.
Not done: an empty block left by clicking away stays (the doc mint's vanish-on-blur is instanceTextblock-only).

---

### 2026-10-01 (4) — PHILOSOPHER'S STONE SHOOK, AND A STALE EDITOR PUT THE OLD TEXT BACK

User: *"the page shakes when i scroll all the way to the bottom"* · *"its the nigrido section"* · *"there are
duplications of images in that document"*.

**THE SHAKE WAS TWO RULES OVERRULING EACH OTHER, measured in Firefox:** "1. Nigredo — The Breakdown Phase"
flipped wrap↔stack **43 times in 4 idle seconds** at 1600 and 1920 wide, shoving the section below 53px each
time. Its host holds a TABLE: wrapped, the table cannot fit beside the picture and drops below it, so the
rendered blank-band guard stacks; stacked, `decideWrapStack` counts the table's text as prose and wraps.
`wrapAnchor.holdGuardStack` latches a guard-forced stack at the width it fired at (±24px). After: **0
mutations, 0px movement** in all three bottom sections at 1366/1600/1920/2560, and one stable height/scroll
state at the bottom. The "images not resolving" did not reproduce once it stopped: 0 failed image requests
in either engine (my first probe's "FAIL" counted `<img>`s with no src yet — complete + naturalWidth 0 is
also what an unmounted lazy image reads as).

**THE DUPLICATES WERE A STALE EDITOR, NOT THE MIGRATION.** 0379 wrote "2. Albedo — The Clarifying Phase"'s
first textblock as `[paragraph, table]` at 19:59; at 20:04 the user's tab saved its PRE-migration content
over it (heading + 4 picture embeds) as a user action. The server's stale-write check passed because the
restart's `full_state` had refreshed the row's `updatedAt` in the tab while the MOUNTED editor kept its old
doc. **Open defect, not fixed: a mounted editor does not adopt a textmap that arrives with `full_state`.**
Any migration that rewrites a doc someone has open can be undone this way.

**"STILL NOT RESOLVING" WAS HOTLINK PROTECTION, which my headless probe could not see** (it sent no Referer).
Testing all 28 with a viafluere Referer: Saatchi (the vortex painting) and UPI (Newton's manuscript) answer
**403** to a request from another site; the shop blog's yin-yang is a 404. Both blocked images now live in
prod's `uploads/user/2026-10/` and their modules point there (`meta.mirroredFromUrl` keeps the original);
the dead yin-yang is Wikimedia's public-domain taijitu, also local. Changed through `update_module` on a
socket so open tabs hear it. Verified in Firefox: every picture on the page LOADED, 0 failed requests.
*Probe rule: an image check that does not send the app's Referer cannot see hotlink blocking.* Scan of all 223 textblocks under
the Notes pages: that was the only one. Repaired through `update_occurrence` on a socket (so open tabs hear
it).

---

### 2026-10-01 (3) — A WRAP'S TEXT SIDE HOLDS SEVERAL BLOCKS; the Notes pages became sections; four deleted tasks restored

**MULTI-BLOCK WRAPS** (user: *"multiple textblocks on that side with the last one wrapping … only textblocks
can do the wrapping"*). `wrapGroup.attrs.floatCount` — null keeps every existing group's meaning (every child
but the last floats). With a count, the children between the floats and the last are LEADS: `flow-root`, so
they sit beside the float as one box and only the host wraps under it (`docs/wrapRoles.js`, pure). The CSS
addressed members by `:last-child`/`:not(:last-child)`, which cannot tell a lead from a float — 71 selectors
now read a `data-wrap-role` the node view stamps in a layout effect + MutationObserver. The host's notch is
measured from where the HOST starts (`wrapAnchor.hostNotchBand`; without leads it is the old rule exactly).
Gestures: a textblock dropped beside the float joins the text side (only within the float's band, only on a
wrapping group, only a textmapped block); radial "Continue wrap into next block" on the host; "Move out of
wrap" on a lead; a lead dragged out is lifted out (`extractGroupMember`) instead of unwrapping the group.
Server scrub keeps the count right when a delete shrinks a group. **Watched on prod:** Eminem 18/18 groups
wrapped, 0 unstamped, every float floating — the existing groups survived the selector rewrite.

**THE NOTES PAGES (`0379`)** — *"doc containers going downward like the eminem article … a textblock and image
wrap underneath"*. Every Documents/Notes doc page: one root doc container named for the page, an H2 textblock
→ a container named by its heading (heading leaves the text), H3 nests, title-only and heading-only textblocks
go (15). A picture-holding textblock splits at its inner headings (External (Lab) / Internal (Psyche)). Each
of the 28 pictures was LOOKED AT and placed by hand in `PLACEMENT` and captioned in `CAPTIONS` (no more
section headings as captions). **`BlackSun.svg` was the Wewelsburg sunwheel, not the alchemical sun** — the
user: *"remove it and find the alchemical sol niger one"*: replaced in place by the Splendor Solis black sun
(Wellcome, CC BY 4.0). Unviewable and left plain at the end of their section: a 404 yin-yang and a
Cloudflare-blocked Ambix figure. Watched: Philosopher's Stone 19 wraps, all wrapping, all captions new.

**IMPORTS INSIDE FILES (`0380`)** — the client found Imports only at the ROOT (`ensureImportsFolderAndPage`),
so moving it would have minted a second Imports on the next import. It now finds the PROTECTED one anywhere
and creates a new one inside Files. Deployed before any import could run.

**FOUR TASKS DELETED BY ACCIDENT (14:52), RESTORED.** Deleting a task deletes its MODULE, so its linked copy on
the Completed page went too (3 modules + 8 placements across 6 lists). Every list was unchanged since, so the
transactions' `before` snapshots were written back newest-first (what `applySnapshots` does — the undo
handler itself refuses anything but the top of the stack and all derived writes), the 12 transactions
marked undone, pm2 restarted; verified in the live app: all listed where they were. **`0381` adds a `Done`
board container at the bottom of Tasks** — a drag there is a move and keeps the Completed copy, because the
Completed container is a FEED scoped to the whole Tasks page on "Completed is ticked". Two pages are named
Tasks; 0381 picks the one the feed scopes.

---

### 2026-10-01 (2) — THE CLIENT SUITE: 4:48 → ~2:20, and the "OOM pair" was the run log holding every test's grid

User: *"before you run the failing test, please shorten the time it takes, 4 minutes is a long time"*.

**THE WALL CLOCK WAS ONE FILE, AND THAT FILE WAS LEAKING.** Per-file timings (8 workers): `balanceFlow`
273s, `trackerValues` 227s, everything else under 80s. A full poms sweep is 2.5s, yet balanceFlow
averaged 8.8s a case — and alone, without the 4GB heap flag, it died at case 12 with *"Ineffective
mark-compacts … heap out of memory"*. The executor's `runHistory` (20 runs per op) holds references into
the occurrence map each run read: one grid in the app, but a fresh 21k-row world PER CASE in these
files, so up to 20 whole worlds stayed reachable. `clearOpRunHistory()` runs after every test, reached
through `globalThis.__moduliClearOpRunHistory` — importing the executor from `setup.js` loaded the REAL
module before `txToastLookups`' `vi.mock`, silently un-mocking it (7 failures; caught by running the 5
mocking files). **This is the documented `trackerValues`/`balanceFlow`/`accountBalances` "OOM family".**

**THEN LESS WORK PER CASE, each proved equivalent rather than assumed:**
```
balanceFlow     sweeps only the ops that write the tiles it asserts — DERIVED from the
                first full sweep, not listed. BALANCE_FLOW_AB=1 runs both per case: 31/31
                agree. (A prefix match first caught Accounts.Tracker Date — exact keys now.)
                alone 80s -> 24s
trackerValues   the "before" of a fresh world is one cached sweep per file: a sweep does not
accountBalances mutate its world (fixture serialises identically) and two sweeps agree on every
                tile (only a random Daily Question on a NEW row differs).  90 -> 51s · 40 -> 26s
```
**AND `.js` TESTS RUN UNDER NODE.** Every file booted jsdom (771 CPU-s). `vite.config.js` now has two
projects — `dom` (.jsx, jsdom) and `logic` (.js, node); the 73 `.js` files that failed under node carry
`// @vitest-environment jsdom`. **A root `include` is MERGED into each project under `extends: true`** —
the first try ran all 1,026 and every .jsx under node; the globs live only on the projects now.
Environment 771 -> 224 CPU-s.

**The failing test was `wireProjection`** — my own paste-to-artifact line read `ctxGridRef.current?._id`,
which the guard's Grid-model exemption cannot see through `.current`; named `ctxGridNow`. `_replay3` was
my gitignored scratch replay, deleted. **Result: 513 files, 5,470 pass, 0 fail, no OOM, ~2:20-2:35
wall** (CPU ~1,280%, so it is CPU-bound now; 29 fixture files are ~90% of what is left).

---

### 2026-10-02 — THIRDS, A LAYOUT PICK ADDS/REMOVES PANELS, FIREFOX; and the Lookup rows become textblocks

User: *"it should be in firefox and allow 3rds"* · *"make it so it will dynamically add/remove panels based on
the layout change. so if we have 3 open panels, and we drag to a 4 grid layout, it adds an extra panel"* ·
*"look at the lookup page and see how all those textblocks still are labels and not body"* · *"all plain
labelled items (if they are not instances) should be migrated to textblocks"* → *"i said not instances"*.

**THIRDS** — three more layouts (thirds, 2/3+1/3, 1/3+2/3). A region may carry `span` (a full-height column
of that width); `buildColumnSpan` keeps the complement's columns as columns. The preview is now read off the
resulting tree's own pane (`paneFraction`), so it can draw any shape exactly as it lands.

**A PICK APPLIES THE WHOLE LAYOUT** (`mosaicSnap.planSnapLayout` + `treeFromZones`, a guillotine build from
the zone picture). The dragged panel takes its zone, the others fill the rest in reading order, missing zones
become new panels and surplus panels are removed from the grid — after a confirm naming them (their pages
stay). `App.resizePanelSet` adds/removes in ONE pass, threading `grid.occurrences` through each step (two
`addNewPanel` calls in a tick would have the second write drop the first). **The confirm runs after the drop
event** (`setTimeout 0`): opened inside the drop handler it broke Firefox's drag session.
**Watched in Firefox on test grid 2:** bar shows 9 layouts · middle third previews at x .33/w .33 · thirds on
5 panels asks to remove Panel C and D, dismiss changes nothing, accept → 3 columns · quadrants on 3 → 4
panels. Restored through the app (panels re-created, grid list and layout identical). The added panel's
module is left for the orphan sweeper. *Probe note: Playwright's Firefox driver cannot run a second drag on
the same page ("session is null") — one drag per browser.*

**INDENTS ARE OPTIONAL NOW.** `0383` sets `meta.textIndent:false` on the Lookup container; `ModuleContainer`
stamps `.text-flush` and the textblocks inside lose the book-style first-line indent (new lookups too). And
Tab in any editor inserts a real tab (`tab-size: 4`), Shift+Tab removes one from the line start — before,
the browser moved focus OFF the textblock. Lists (nesting) and table cells (next cell) keep their Tab.
Watched in Firefox: caret stays in the editor, the line reads `\tThough…`, Shift+Tab restores it.

**`0382` — the Lookup board's 244 rows** were plain instances from the Raindrop import (`raindropId` "l:…",
0 bindings, 0 values, each module placed once); they are textblocks with the text as the body now. Census
afterwards: apart from instances, NO other label-only rows exist on poms grid — every other leaf is an
artifact, a textblock or a container. Server restarted for the warm cache.

---

### 2026-10-01 (8) — DRAG A PANEL TO THE TOP OF A MOSAIC GRID AND PICK A LAYOUT

User, from a Windows 11 screenshot: snap layouts for the mosaic grid, then *"i dont like that its a
hover though (unless its drag and drop to the top like the windows one)"*. So the bar exists ONLY
during a panel drag that reaches the top-middle of the grid — never on hover.

`helpers/mosaicSnap.js` gains `SNAP_LAYOUTS` (halves ×2, big-left/right/top, quadrants) and
`opensSnapLayouts(zone)`. **Every zone in a picture is an existing region** (`{col,row}` of
left/right/full × top/bottom/full), so a drop goes through `snapLeafToRegion` — no new tree math, and
thirds are deliberately not offered (they would need it). `GridMosaic`'s top strip opens the bar
instead of snapping; corners and the other edges snap directly as before. The bar is a drop target
that closes when the drag leaves it; each zone is its own target, previews its region, and drops into
it. Tests `__tests__/snapLayouts.test.js` (4): every picture tiles the grid exactly once, and a drop
on each of its zones changes the tree (guarded against passing vacuously).

**Watched on prod (test grid 2):** dragging a panel to the top → bar at the top centre with 6 layouts;
hovering big-left's left zone → preview half width, full height; dropping → the panel is the left leaf.
The grid's layout was put back afterwards through `update_grid`, read back identical.
**Not covered:** rows×cols grids (they have no regions), and the Firefox engine was not driven.

---

### 2026-10-01 (7) — A SHARED CLIP CAN BECOME A TEXTBLOCK'S BODY

User: *"if i clip some text and do create choose, its not letting me put the text anywhere … if its a
textblock, label shouldnt be an option but Body should, and it should default there"*. In New mode a
textblock shape now shows a **Body** mapping row (default: the selection, else the page title) and no
Label. `buildSharePayload` sends `placement.body`; `manualPlacement.bodyToTextmap` turns it into the
textmap (a paragraph per blank-line block, a single newline as a hard break) and a textblock borrows no
label from the share; the server `CREATE` and `mintOccurrence` take a `textmap` (stored compressed,
mirrored raw). Presets keep the body mapping. **Found on the way:** `mintOccurrence`'s re-share branch
had no `{ new: true }`, so it mirrored the PRE-update row (and a compressed textmap) into the warm cache.
**Verified on prod:** staged a selection, placed it into the rebuild grid's Ideas board → a textblock
with label "" and both paragraphs, rendered as one frame; deleted through `delete_occurrence`. The
window, driven headless: picking textblock swaps the rows to `Body=selection`.

---

### 2026-10-01 (6) — A JUST-MINTED TEXTBLOCK HELD THE WHOLE DOC'S SAVE; one frame per textblock; the host handle clears a left picture

**WRAP EDITS WERE NOT SAVED while a provisional (clicked, never typed) textblock sat in the doc.**
`Editor.persistContent` returned early on `hasProvisionalTextblock(json)` so a doc never persisted an
embed of an occurrence nobody created — and that held every OTHER edit too (a swap, "Continue wrap").
It now saves the doc with each pending block written as the empty line it came from
(`provisionalTextblock.withoutProvisionalTextblocks`, nested groups included). The block's own first
keystroke still writes the parent with it in. **Verified on Wrap Lab:** seam swap → reload → kept.
**Probe note:** `.wrap-seam-swap` has a zero box until the seam is HOVERED; a probe clicking its
stale coordinates swaps nothing and reads as "the swap does not save".

**ONE FRAME PER TEXTBLOCK.** A textblock row carried the row's border AND the inner `.textblock-card`'s
own border + tint at a shrunk width — the "separate border inside" the user saw. Inside an
`.instance-row` the card is now plain and full width. **A host whose handle is moved right of a LEFT
picture** gets `data-host-handle="shifted"` and a 28px band above its text, so the handle no longer
sits on the first line. Measured in Chromium AND Firefox on Philosopher's Stone: 25 textblock rows,
0 double-framed; 5 shifted hosts, handle bottom above the first line; hover outline on the row.
`.wrap-gap-hint` read an undefined `--muted-foreground` (the CSS token test caught it) — `--text-muted`.

---

### 2026-10-01 — THE MANIFEST, REORGANIZED AND TESTED; and last night's cross-build broke six Schedule columns

**`0373` REORGANIZED poms grid's manifest** at the user's ask, from a proposal they approved:
Interfaces (Schedule, Schedule Table, Day Page, Trackers, Schedule Types, Tasks/{Tasks, Completed,
Routines}) · Boards · Projects · Library (Lookup, Interests, Reading) · Documents (Notes,
Archive/Codex — untouched) · Files (Images by area) · Imports · Templates. Deleted only emptied
folders + their folder pages and 2 duplicate Watts pages; every target found by exact path, throws
on a missing one. Snapshot in `backups/poms-grid/2026-10-01T14-10-33-232Z_pre-migration-0373-…`.

**LAST NIGHT'S DAMAGE, found by the integrity check while verifying 0373.** At 04:19 UTC one load
with a 14-day range ran 0372's cross-build: 14 day page columns + Schedule columns at 49 slots each.
Six Schedule columns reached Mongo WITHOUT their modules — 556 rows of template scaffolding (0
userTouched, 0 true values), deleted through the app with a backup
(`server/backups/orphans/2026-10-01-broken-schedule-cols.json`). `0374` limits the cross-build to
`$activePeriodCount <= 7`. **Why the modules were lost is NOT established**: replaying the run gives
every column its template, safeEmit sends while connected, the server logged no create_module error,
no transaction or delete touched them, and there is no socket rate limiter. Ruled out, not found.

**THE MANIFEST, TESTED END TO END ON THE REBUILD GRID — five defects, all fixed and re-verified:**
```
indentation compounded       marginLeft depth*8 INSIDE the parent's wrapper → 8,24,48,80px;
                             one 10px step per level now (prod: 589→599→609→619→629)
cover popup off-screen       opened at the click point; clamped to the viewport (helpers/clampToViewport)
container click (board page) only a DOC page read view.scrollAnchor; now jumpToOccurrence, panel-scoped
folder delete                reparented its OWN folder page into the parent — a stray page named
                             after the deleted folder; the folder page is deleted now
```
PASSED as built: expand/collapse, open page, open folder page, new folder, rename (dblclick and
menu), new page (menu, hover +, header +), set/clear cover, close/reopen pinned, delete page
(confirms), delete folder (no confirm — contents move up, so nothing is lost), DnD page→folder,
folder→folder, page and folder reorder, both persisting across a reload.

**PROBE NOTES — every DnD "failure" was the probe until the drop line was read at release.** Native
HTML5 drag DOES work headless here (dragstart/dragover/drop logged). A row lookup that scrolls the
tree moves the OTHER row's coordinates — use a 1600×3000 viewport so the expanded tree fits, and read
the `2px` drop indicator before releasing. A fixed popup at z-index 1200 can be the POMODORO panel —
find the cover editor by its own "Color" tab.

---

### 2026-09-30 (6) — THE SCHEDULE AND THE DAY PAGE BUILD EACH OTHER'S MISSING DAY

User: *"tomorrows daypage doesnt even show a todo container"* → (option 1 of 3) *"and vice versa, schedule
should create a daypage as well"*. A day page's Todo IS that day's Schedule column's Todo slot, and a
Schedule column only existed once the Schedule had shown that date.

**`0372`: each builder's per-date body moves UNCHANGED into its own trigger-less op** — `Schedule: Build Day`
and `Day Page: Build Day` (the builder's INIT_VARs + the body behind `$day IS_NOT_EMPTY`) — and each
builder's loop runs its own day and, when the other side's column is missing, the other side's. The
"is there a column" FINDs are each body's OWN first FIND, copied. No recursion: Build Day ops never call.

**It needed two executor changes, each found by a failing test rather than by reading:**
- `RUN_OPERATION` takes `vars` (arguments resolved in the caller); the editor shows/edits them.
- A callee could not see what an earlier callee CREATED in the same run. Creates land in the shared
  overlay at once, but a callee builds collections from the sweep's cached read model — so it is dropped
  when the overlay holds rows the model does not (`updates` in an action is THAT STEP's list, so an
  "any structural effect so far" check was always false). And CREATE's overlay row carried no `role`,
  with its module not yet in `modulesById`, so it sat in no `$allContainers` slice.

**VERIFIED BY REPLAY, NOT LIVE** — the real executor over a fresh Mongo snapshot, writing nothing: the day
page's own NavigationOp (Oct 1, a date with no Schedule column) creates `schedule:col:2026-10-01`, and
Oct 1's day page embeds THAT column's Todo slot first; the Schedule moved to Oct 2 creates
`schedule:col:2026-10-02` AND `daypage:col:2026-10-02` with its sections. Probe note: a filterNav trigger
scoped to a page needs `_ancestorIds` to include the page, or nothing matches.

---

### 2026-09-30 (5) — TOMORROW'S DAY COLUMN: TODAY'S TODO, THEN GONE AFTER A RELOAD

User: *"Birthday - Laura Mostowik shows up on both. it should just show up for day of the birthday"* →
*"on reload, the filter is set to both days but only today shows up"*.

**THE BIRTHDAY WAS A STALE LOOP VAR.** `Day Page: Build` loops over the dates on screen and FINDs a date's
Todo only inside `if ($dayColId)` — but embeds `$todoId` OUTSIDE it. Oct 1 has no Schedule column, so the
Todo FIND never ran and `$todoId` still held TODAY's. (FIND does clear its var on no match — it just never
ran.) `0371` resets `$todoId` per date; tested against the live pipeline as a fixture, with a control
that the embed really sits outside the `if`.

**THE RELOAD WAS THE WARM CACHE HOLDING A PARTIAL ROW.** A bare socket's `full_state` sent tomorrow's column
as `{ id, meta, occurrences, textmap, updatedAt }` — no moduleId, parent or date — while Mongo held the
whole row. `update_occurrence` on a row the cache did not hold merged onto `prev = {}` and cached that
(Mongo survived because its update is a `$set`). A cache miss is now HYDRATED from the stored row before
the merge. *Why* the cache lacked the row is not established (a create_batch rollback is the suspect);
the hydrate makes it irrelevant. Restart + readback: the row now arrives whole.

---

### 2026-09-30 (4) — NOTES/HIGHLIGHTS WOULD NOT MINT; every share opens the window; a day column came in through the side door

**NOTES AND HIGHLIGHTS: TWO BUGS, THE SECOND FOUND BY WATCHING THE FIRST FIX.** Reproduced on prod: the
click read `mint:skip why:no-recent-input`. `isInNonEditableIsland` refused a pointerdown under ANY
`contenteditable=false` ancestor (for the Emotions Wheel) — and an embedded doc container is an editor
INSIDE the host's non-editable node view. The NEAREST contenteditable decides now. Then, on the real
day page: click Notes (mints), click Highlights → `mint:skip suppressed`. Notes' collapse held position
0, and Highlights' empty line is also position 0 of ITS editor. Holds are (editor, position) pairs now.
**Probe fault worth knowing: `?previewOcc=` renders with `socket={null}`, so a mint there returns at
once — it can prove the guard passed (`mint:go`), never that a block appears.** And my own probe left the
user's Tasks panel on the Day Page TEMPLATE (search's first "Day Page" hit) — restored through search.

**EVERY SHARE OPENS THE PLACEMENT WINDOW, FILES INCLUDED** (*"i dont want anything going through auto
unless i express that in the dropdown"*). The phone's last share was a PHOTO, and files skipped the window
because a stage held JSON. `POST /share/stage` takes multipart; the file is parked in `server/share-stage/`
(NOT the static `uploads/`), served only by stage key, swept past the stage TTL. On Clip it takes the same
path an uploaded file takes; placing it by hand MOVES the stored Files row (`MOVE_OCCURRENCE`, written for
exactly this) rather than creating a second. Not exercised from a real phone yet.

**A SECOND DAY COLUMN FOR TODAY — create_batch REFUSED IT, `update_occurrence` WROTE IT.** Prod log:
two `update_occurrence ed222a56` (the build's textmap / template stamp) BEFORE `create_batch REFUSED
(stored sibling) [ed222a56]` — and that handler UPSERTS. An update that would INSERT a unique-signed row
now gets the same refusal. **The other 7 dates that looked duplicated are one day page PER GRID**
(parents `8gpoqzx3` / `Vaau-lsC`) — today was the only real one. Repaired via `delete_occurrence`
(backup `server/backups/orphans/2026-09-30-dup-daypage-col.json`); **the delete cascade does NOT reach
sections embedded only in a column's textmap** — 7 were left and deleted one by one. Their modules await
the sweeper. Still open: sections created before a refused root arrives land under a parent that never
exists (the 09-19 orphan class).

**THE FIREFOX TOOLBAR BUTTON:** Firefox kept the icon dimmed after a reload. Temporary add-ons are not
recorded in the profile; the only other copy found is the stale `.claude/worktrees/share-place/extension`
(v0.1.0). Load `\\wsl.localhost\Ubuntu-24.04\home\joshpoms\moduli\extension\manifest.json`.

Server 2,947 · client 5,423. A/Bs: any-ancestor island (1), unscoped hold (1), old SharePending (1),
disabled insert guard (1).

---

### 2026-09-30 (3) — THE FIRST SEARCH NEVER LANDED; one jump grew 2,017 rows; op notifications get rows and a trigger

User: *"the first search is still not scrolling to the correct one, it lags for a few seconds and does
nothing"* · *"6 seconds is way too long"* · *"theres a two second pause and then it flashes"* · a 1s
double flash · rows + the trigger in the notifications dropdown · the Firefox toolbar button.

**THE FIRST SEARCH MISSED BY CONSTRUCTION.** A row past a long list's 80-row window: `jumpToOccurrence`
dispatched render-all and looked again IN THE SAME TICK — the event only sets state, React mounts later,
so the look always missed. Measured on prod, Movies row #600: board 80 -> 994 rows (the lag), target
mounted at y=50,968, never scrolled to, no ring. The SECOND search worked because the first had mounted
the rows. Now it looks until the row mounts (a 10s DEADLINE, not a poll count — 16 x 120ms ran out
before a big mount finished).

**AND ONE JUMP OPENED EVERY LONG LIST ON SCREEN, which was most of the 6s.** Four passes, each measured:
```
                                 grid-wide rows   row in view
untargeted render-all                 2,017          ~6s / never
targeted, 1.2s TIME grace             1,279          5.6s   <- the mount outlasted the grace
claimed synchronously                 1,279          ~4.8s  <- Movies is open in TWO panels
+ scoped to the jump's panel            734          3.0s
+ instant scroll when >2 screens        734          2.4-2.7s, ring 25-85ms after it lands
```
`requestRenderAll(occId, root)`: only a window whose list HOLDS the row, inside the jump's panel,
grows — to the row + 24 (`countForRequest`, pure). It CLAIMS the request during dispatch (sync), and the
jump opens every window only when nobody claimed it (a row nested below a window's direct children).
**A time grace was the wrong test: a busy main thread makes every wait look like a miss.**

**THE RING WAITS FOR THE ROW TO BE IN VIEW** (IntersectionObserver). Started at the click, a long smooth
scroll played the whole blink off screen and the user saw only the settle's re-blink ~2s later.

**WHAT IS LEFT is mounting the ~545 rows ABOVE the target (~2.3s headless).** Cutting that needs rows
above to render as seeded placeholders — a renderer change, not done.

**OP NOTIFICATIONS: ROWS AND A TRIGGER.** `opResultRows` is the one structured view of a run (the pill
text is those rows joined, so the two cannot disagree); `describeOpTrigger` names the event the executor
matched (`computeTriggerMatch` now returns `eventType`) plus what it was about — `On Change · Completed on
"Drink"`, `On Move · "Drink" → 3:30pm`, `On Load`. The dropdown card: title, `⚡ trigger`, one row per
change (item left, `field → value` right), up to 40 rows. **Watched on prod.** `menuTheming` caught my
literal border colours — tokens now.

**SCROLL REPAINT — MEASURED, NOT CHANGED.** `content-visibility: auto` on/off, interleaved, Chromium AND
Firefox, three panels: **0 frames with an unpainted cv row in view in either arm**, frame times equal
within noise (Chromium's right Movies panel: 18-19 slow frames ON vs 7-10 OFF). So cv is neither the
blanking nor a measurable win. The blanking is the compositor scrolling ahead of a busy main thread
(checkerboarding); the long list mounting its next 80 rows mid-scroll is the prime suspect. Not proven.

**THE EXTENSION HAD NO TOOLBAR BUTTON.** The manifest declared no `action`, so Firefox said "cannot
change anything on this webpage". A popup now offers the page's two menu items by their REAL ids —
one code path (`handleClip`) with the right-click menu. `activeTab` added (Firefox MV3 host permissions
are opt-in). v0.2.0; reload the temporary add-on to get it.

**PHONE SHARE "ALWAYS AUTOMATIC" — IT WAS AN IMAGE.** The share log's last android entry (17:45Z) is
`1561269119.jpg`. Files skip the placement window by design (a stage holds JSON only); links from the
phone DO get it. No reinstall needed. Making a file stageable is the open item.

Client 5,416 pass (2 errors = the OOM pair). A/Bs, each mutation asserted to land: same-tick look (2),
ignoring the target (3), blinking at the click (1), dropping the panel scope (1). Six client deploys.

---

### 2026-09-30 (2) — ENTER FELL INTO THE SEARCH'S DEBOUNCE WINDOW

User: *"so the first time i do a search and press enter, it doesnt work, after that it works fine"*.

**REPRODUCED AND MEASURED BEFORE THEORISING, and the measurement named it exactly.** Pressing Enter at
four delays after the last keystroke, on prod:
```
   0ms   nothing happens, the search stays open
  60ms   nothing happens, the search stays open
 130ms   navigates
 400ms   navigates
```
The list waits **120ms** before it searches at all, and Enter inside that window read `hits.results`
for a query that had not run yet — an empty list — so it picked nothing and did nothing, **silently**.
**There is no "first time" about it:** by the second try the results are already on screen, so Enter
lands outside the window. My own first probe used a 900ms pause and reported the feature WORKING —
*a repro that does not reproduce is a fact about the gesture you chose.*

**Pressing Enter IS the decision, so a stale query is run right now rather than dropped** — through
`runSearch`, the same function the debounce calls, so there is no second search path to drift. **Index
0 with it**, because the highlighted row belongs to the list on screen and that is not the list this
query produces. An empty box still does nothing: the control, or a stray Enter would open whatever
happened to rank first.

**WATCHED ON THE DEPLOYED BUILD** — the search now closes at every delay (it stayed open at 0 and
60ms), and the jump ring appears on the target at **0ms** just as at 900ms, which is the proof the
pick landed rather than merely closing.

**TWO OF MY OWN EXPECTATIONS WERE WRONG BEFORE THE CODE WAS.** The flush worked on its first run and
the test still failed: *"Water Bottle" outranks "Drink Water" for "water"* — a label match at the START
ranks first — so the assertion was wrong, not the fix. And that failing test never reached its own
`vi.useRealTimers()`, leaving fake timers armed so the NEXT test's `waitFor` hung to its 5s timeout —
one wrong expectation reading as two broken tests. An `afterEach` disarms them now.

4 tests; A/B with the mutation asserted to land (`runSearch(term)` refs 0): 2 fail. Client **5,396
pass**, one client-only deploy.

---

### 2026-09-30 — THE SEARCH MARKED ONE WORD, AND THE JUMP RING WAITED TWO SECONDS

Two cosmetic reports, both real, both in the search path. *"I type A Guide and it does pop up with the
right results but the 'A' is only highlighted"* and *"after selecting the result, it scrolls to the
correct spot, but the highlight on the actual occurance is super late … like 2 seconds later"*.

**THE LIST WAS MARKING THE FIRST WORD OF THE QUERY, LITERALLY.** `OccurrenceSearch` derived
`firstTerm = query.split(/\s+/).filter(Boolean)[0]` and marked that alone — so "A Guide" lit a bare
"A" on every row. `helpers/searchHighlight.highlightSegments` is the rule now, and it took **three
passes, each one driven by looking at prod rather than at the tests:**
```
1  mark the whole query           "A Guide"  ->  [A Guide] …                 the report, fixed
2  …and per-term when apart       "An FBI agents [guide]" was ["A","a","guide","a"]  -- static
3  …phrase needs a word boundary  "Mang[a Guide] to Physics"  ->  "Manga [Guide]"
```
- **The PHRASE wins when it is there** — "A Guide" is ONE run, which is also what stops a one-letter
  word lighting up every matching letter.
- **A one-letter term marks nothing in the per-term fallback**, unless the whole query is that short:
  marking every "a" said LESS about why the row matched than marking "guide" alone, and marking
  nothing reads as a row that matched for no reason.
- **A multi-word phrase must start on a word boundary**, scoped to multi-word because a single word is
  how partial typing works ("uide" must still mark on "A Guide" as you type).
- **A query is typed text, never a pattern** — no regex, so "(2006)" searches literally.

**AND THE RING WAS GATED ON THE PAGE SETTLING.** `scrollAndFlash` keeps re-centring while lazy rows
mount and images load — correct, and it was holding the feedback hostage to it: the smooth scroll gets
two 250ms checks before the first correction, so the earliest ring was ~1s and ~2s was typical. **The
ring is up in the same tick now and HELD** (a steady `.anchor-highlight-hold`) until the element lands,
then swapped for the existing 1.2s fade-out. The ring rides ON the element, so it moves with it — the
failure the wait was written for was the flash ENDING before the element arrived, which holding fixes
directly.

**WATCHED ON THE DEPLOYED BUILD, by typing:**
```
"A Guide"    A Guide to Recognizing Your Saints   [A Guide]      <- the user's own row
             A Bug Hunter's Diary: A Guided Tour  [A Guide]
             An FBI agents guide to …             [guide]        (no phrase; the "a" is noise)
             Manga Guide to Physics               [Guide]        (phrase crosses a word)
picked a row   ring first seen at 17ms            (was ~2000ms)
```

**PROBE FAULTS, three, and two are ones this file already pins.** The search is a COLLAPSED trigger
until clicked, so a probe looking for an input reported *"no search on this page"*. An expired token
showed up as a 90s `waitForFunction` timeout. And my test-file import inserter landed **inside a
multi-line `import {`** — the 2026-09-18 near-duplicate-anchor trap, paid again; the file then parsed
as nothing and vitest reported *"no tests"* rather than a failure.

**A test expectation of mine was wrong before the code was** — `"x y"` against `"x y z"` IS a phrase, so
it marks as one run; corrected the test, not the rule. 19 tests. A/B, each mutation asserted to land:
restoring the first-word term fails the wiring guard; removing the immediate ring fails 4; deleting the
CSS rule fails the paint guard (a class with no rule is invisible, not immediate); the one-letter and
word-boundary rules fail exactly their own cases. Client **5,392 pass**; four client-only deploys.

---

### 2026-09-29 (6) — A ROW IS NAMED BY ITS PLACEMENT; the share window scrolls and a preset can be overwritten

User: *"can you fix all the movies and shows and whatever to have the correct labels. currently it just
says movie for each"* → *"in poms grid"* → *"for the label of each movie it doesnt have the movie name,
it just says Movie"*. Then: *"fix the share window to be scrollable and allow you to overwrite presets"*.

**MY FIRST SCAN SAID THE DATA WAS FINE, AND IT WAS — the DOM said otherwise.** Reading `o.label ||
m.label` out of the store gave "John Wick" for all 994 rows, so I nearly reported nothing to fix.
Reading what the CARD RENDERS instead:
```
occLabel "John Wick"   modLabel "Movie"   shows "Movie"     x80 of 80 mounted rows
```
**13 shared type-modules cover 12,265 rows** — 993 movies point at ONE module labelled "Movie", 5,484
songs at "Song", plus Album · Artist · Book · Author · TV Series · Comic · Game. So a renderer reading
the module first does not get a name wrong occasionally; **it shows the SAME name for every row of a
kind.** *A store read is a claim about the store; only the DOM is a claim about the screen.*

**`helpers/occurrenceLabel.occurrenceDisplayLabel` is that rule once. NINE sites had it, EIGHT were
wrong:**
```
ArtifactCard (x2)   the card name — the report. It read a `label` PROP that every call site fills
                    with `mod.label`, so the occurrence was never consulted at all
Field.jsx (x2)      the occurrence PICKER card, and the image-search query — which was searching
                    "Movie movie poster"
confirmDelete       asked  Delete "Movie"?  when you were deleting John Wick
RepresentationView (x2) · tableCells · containerCrumbs · PageFolder · bindSocketToStore (x2)
```
`meta.originalName` stays ahead of it — that is an upload's own file name, on a module with exactly one
placement, shown beside its dimensions and size.

**THE WALKER IS THE FIX, not the nine edits: it found FOUR sites my own grep had missed.** And it
cannot see ArtifactCard's shape (module-first order is never written there), so that file has its own
guard — which is what discriminates that half. A/B, each mutation asserted to land: reverting
ArtifactCard fails its 2 guards, reverting the picker card fails the walker. **Watched on the deployed
build: 80 of 80 movie rows show their titles, 0 still showing the type.**

**THE SHARE WINDOW COULD NOT SCROLL, AND THAT IS MOST OF WHY OVERWRITING LOOKED IMPOSSIBLE.**
`index.css` locks the page — `html, body, #root { height: 100%; overflow: hidden }` — correct for a grid
workspace and wrong for a 520x700 popup rendered inside that same `#root`: content ran to 894px and
everything past the fold was unreachable, **including the preset controls**. The Shell owns its own
scroller now, and `minHeight: 0` is the load-bearing part — a flex child refuses to shrink below its
content, so without it no scrollbar appears however much overflow there is.

**AND `withPreset` ONLY EVER MATCHED ON THE NAME**, so changing a preset meant retyping its name
exactly. A saved preset now offers **Update "<name>"** (same id, same name, in place, no prompt) and
**Delete preset**. A SUGGESTED one gets neither — it is computed per request and has no stored row, so
there is nothing to overwrite. Watched end to end on prod:
```
content 894px in a 700px popup · overflowY auto · scrollTop 0 -> 194 · Clip reachable at y=654
Save -> "Saved preset" + the Update/Delete pair appears
Update -> "Updated"  ·  Delete -> "Deleted", pair gone      saved presets back to 0
```
Client **5,370 pass**; two client-only deploys, `deploy.sh` reporting *"Server unchanged"* each time.
**No debris:** Clip was never pressed, so nothing was filed and the staged clips expire unconsumed.

---

### 2026-09-29 (5) — TESTED BY CLICKING: the suggested presets were EMPTY on the grid they were built for

User: *"can you test that stuff with ui"* — the tokens screen, the cover picker and the share
placement window from (4), every one of which shipped with *"NOT watched in a browser"* against it.

**THE TOKENS SCREEN WORKS, AND DRIVING IT FOUND A LEAK.** Create → the secret shows once with its
warning (`moduli_8Ka3Pdx4oiC…`); the minted token authenticates (200, 5 grids); it **cannot mint a
successor** (403 — the session guard, live); revoke through the UI → the row reads revoked and the
token answers 401. **And the list rendered 2,795 rows.** Measured on prod: **3,110 live
`assistant (auto)` write-scoped tokens, 4 ever used, none in a week**, accumulated 08-21 → 09-24 —
`GET /assistant/bootstrap-token` mints one whenever the env token is stale and the chat drawer asks
on EVERY mount that finds no saved token. Each acts as the user in full. With the user's go-ahead:
the mint now RETIRES its predecessors (a raw token cannot be re-derived, so reuse is impossible and
retiring is the only bound), the rows were cleaned to 7 with a backup, and prod's env token was
rotated. A/B (updateMany 0): exactly *"ten asks leave exactly ONE live auto token"* fails.

**THE COVER PICKER, WATCHED ON A REAL ROW** — and it is on the row's RIGHT-CLICK menu, not the radial.
`ModuleInstance` renders ONE `RadialMenu` whose items are RadialMenu's DEFAULT set (Settings · Drag
mode › · Hide Header · Delete); the rich list at ~1471-1650 is the context menu. Three runs went into
the arc first. Then:
```
right-click a movie row   Duplicate · Open in Panel A/D/C · Change cover image… · Clear cover · Delete
click it                  picker "Cover — John Wick", query "John Wick movie poster", 24 results
```

**THE HEADLINE: THE PLACEMENT WINDOW'S PRESET DROPDOWN WAS NOT THERE AT ALL.** It renders only when a
saved OR suggested preset exists, and `GET /share/presets` answered `suggested: []` on **poms** — the
grid the feature was built for. **Not the 2.5s race** (463ms). Three rules were wrong, each measured
against live data rather than reasoned about:
```
q:"" ranked by LABEL      60 biggest destinations -> `"We Say We're Exactly the Same"` + 59 empty
                          "10:00pm" slots; Movies (994 rows), Bookmarks, People sat past the cut.
                          sharePresetSuggest sorts biggest-first but only WITHIN what it is handed.
a "board" is any shape    the first fix then offered FOUR Schedule day columns — 49 children each,
                          whose children are time SLOTS. Each displaced a real board at the cap.
a board must be TYPED     and that rejected People (1,181 rows, 27 bound fields) and Appointments —
                          the two the user named alongside movies — while suggesting three imported
                          article sections that bind NO fields, i.e. presets with nothing to reuse.
```
Fixed as three derived rules, never a list of names: **an empty query ranks by how much is filed
there** (an aggregation — Mongo cannot sort by array length in a `find()`; `userId`/`gridId` are plain
Strings on the schema, checked, because an aggregate does not cast), **a suggestion's rows must BE
rows** (`instance`/`artifact`/`textblock` — a destination holding containers is a layout), and **a
kind OR bound fields** (the mappings are the thing you reuse). A typed query still searches labels —
ranking a type-ahead by size would bury an exact match.

**WATCHED END TO END ON THE DEPLOYED BUILD, which is the whole point of this pass:**
```
Preset ▾  "From your boards"  Songs · Albums · Artists · Bookmarks · People · Movies · Books ·
                              Authors · TV Series · Library · Emotions · Reflection Questions
pick "Movies — movie"      ->  Where: Movies · Shape: artifact/movie · a COVER row appears
Pick…                      ->  "Cover — …", tabs FROM THE PAGE · Search · Upload · URL,
                               opening on 3 tiles read off the page itself
```
**AND IMDb — the user's own case — RETURNS NOTHING** (`cover: null`, 0 candidates, 200 in 221ms): it
refuses the server fetch. That is not a code defect and it explains why their shared IMDb row arrived
with no picture at all. A Wikipedia link gets its og:image plus 3 candidates. Reported, not worked
around. Also still true: only the **60 biggest** destinations are considered, so Appointments (3 rows)
is not offered.

**PROBE FAULTS, four, and two are ones this file already pins.** A coordinate measured in
`page.evaluate` went STALE while posters finished loading, so the click landed on a CONTAINER's handle
and the arc read *"Hide Header"* — Playwright's own click re-resolves the box. The window's modes are
RADIOS (`aria-label="Auto|New|Preset"`), not buttons, so *"click the Preset button"* reported the mode
never opened. Two containers are named "Movies" and the probe took the 1-row one, got
`shape: instance/plain item`, and read *"no cover row"* as a defect. And `[object Object]` in my own
console was my print, not the payload — the candidate shape `{url, alt}` is exactly what the picker
reads.

Server **2,929 pass** (294 files); three deploys, each with a restart (server code), prod HEAD matched
and the process started after the files were written. **No debris:** Clip was never pressed, so 0
occurrences were created on poms, the share log is untouched, the 4 stages expire unconsumed, and
saved presets stay 0 — a suggestion is computed per request and stored nowhere.

---

### 2026-09-29 (4) — TOKENS IN THE APP; the share window offers the page's OWN photos and the grid's OWN boards

Four asks in one message: *"lets do the tokens thing"* · *"finish up this share (with images), and cover
picker stuff"* · *"give it that image search thing we have as well to choose from (or photos we get from
the share)"* · *"give the share window a bunch of presets based on my system … like movies, appointments,
bookmarks, etc. based on where they go"*.

**TOKENS ARE MINTED FROM THE APP, AND THE 09-24 CONSTRAINT IS INTACT.** That entry deliberately left
minting out of the API: *"a token that can mint tokens makes a leak permanent"* — a leaked bearer issuing
itself a successor makes revoking it worthless. What that forbids is minting WITH A TOKEN, not minting
from a signed-in session, which grants nothing the session did not already have over the socket.
`POST /tokens` takes `allowSessionJwt` and then **refuses anything but a session** (`apiAuth` marks one
`session: true` — the whole discriminator). So the extension's own setup hint, *"Command Center →
Connections"*, is true for the first time instead of pointing at a screen with no tokens on it.
`TokensSection` lists / creates / revokes; the secret is shown ONCE because only its bcrypt hash is
stored, and the copy button falls back to selecting the text (`navigator.clipboard` is refusable, and
this is the one value that cannot be fetched again). **The load-bearing test is not "does it mint" but
"does it refuse a valid write-scoped API token"** — A/B: removing that one guard fails exactly it.

**THE COVER PICKER OPENS ON THE SHARE'S OWN PHOTOS.** The picker already had Search / Upload / URL; it
gained an optional `suggestions` tab that is offered ONLY when the caller has some and is then the tab it
OPENS on — a picture from the thing you are filing beats a web search for its name, and Search is one
click away either way. `GET /share/stage/:id/cover` now returns `candidates` beside the suggestion:
`utils/pageImages.imagesFromHtml` reads the page's declared pictures first, then every `<img>` **through
`bestImageSrc`, not `src`** (2026-09-15: badgerherald.com's `src` is an alias that 404s while the srcset
holds the real uploads — one definition of "which URL does this img mean", shared with the importers).
Refused: `data:` URIs (tracking pixels, inline spinners), anything the page DECLARES under 64px, and
icons — a favicon stretched into a poster slot is worse than the title text it replaces.
**ONE outbound fetch for both answers**, by wrapping the `fetchPageHtml` handed to `fetchLinkPreview`;
that test was vacuous until the mock was made to call its injected fetcher like the real one does.

**THE PRESETS ARE DERIVED FROM THE GRID, NOT A LIST OF NAMES.** `sharePresetSuggest` knows nothing about
movies: a suggestion is a destination's OWN shape (role, kind, bindings, and the values its rows agree on
— the same `autoFields` the window computes when you pick it by hand) plus a mapping per bound field
chosen from that field's name and type. So poms gets Movies / Bookmarks / People, and a grid with a
Recipes board gets Recipes, with no migration and nothing to keep in step. Ordered biggest-board-first,
capped at 12, computed per request and **stored nowhere** — rename a board and its preset renames; saving
one is what makes it the user's. A test builds a board this file has never heard of and asserts the same
rules apply; that is what fails if anyone hardcodes a name.
```
Year   number + /\byear\b/   -> title, extract year   (empty on no match, never the film's name)
Date   date   + added/saved  -> today
URL    url|link|website…     -> linkUrl   (falls back to the page URL, so it is right for both clips)
Notes  notes|description…    -> selected text
Title  title|name|label      -> title, strip site suffix      <- LAST, so the four above never reach it
an auto value the rows agree on always beats a guess from a field's name
```

**AND THE SUGGESTIONS ARE BOUNDED, WHICH THE SUITE IS WHAT FOUND.** They ride on `GET /share/presets`,
which the window BLOCKS on, and they cost a destination search over every module on the grid. A `try`
already survived a throw; a SLOW query would have held the window open with nothing on screen — the
existing presets test hung at 5s. Raced against 2.5s, and that case is now pinned by name: the saved
presets are what was asked for, the suggestions are a bonus.

Server **2,912 pass** (293 files); client **5,346 pass / 504 of 506**, the 2 errors the documented
`trackerValues` OOM pair; build clean. Five A/Bs, each mutation asserted to land: the mint route (6 of 7),
the session-only guard (exactly 1), the srcset read (1), the tiny-image refusal (1), the auto-value
precedence (1), the board filter (1), and opening on suggestions (3 of 6, with the no-suggestions control
passing both ways). **NOT watched in a browser** — nobody has minted a token, opened the cover picker on a
real share or picked a suggested preset.

---

### 2026-09-29 (3) — A ROW'S PICTURE COULD BE SET FROM NOWHERE; four surfaces now share one picker

User: *"how would i grab image and place that. im trying to add A Guide to Recognizing Your Saints and i
cant add a new image to it via the share or via the app ui. it just shows a blank image that i cant open
or change (just says A Guide to Recognizing Your Saints, as the image)."*

**WHY THE POSTER IS PER-PLACEMENT, and it is the whole reason nothing could set it.** A media row draws
`occurrence.meta.cover`; the MODULE is shared by every row of a kind (993 movies, one "Movie" module —
`ArtifactCard`'s own comment says a module-level cover would give every film the same poster). So the
cover belongs to the placement, and **the only surface that could write one was a PAGE card's
`window.prompt` for a URL.** An instance card had nothing: a share of an IMDb link arrived with no
picture and rendered its own title where the picture goes.

**`helpers/coverPick.js` IS THAT DECISION ONCE** — `openImagePicker` (Search / Upload / URL) seeded with
the title plus a kind hint (`coverQuery.js`, pure and dependency-free so the share window can use it
without dragging in CommitHelpers). Four surfaces call it: an instance card's radial (`Set cover image…`
/ `Change cover image…` + `Clear cover`), an artifact card with **nothing to draw** (a `Set cover…`
button where the picture belongs — the case the user hit), a page card (its bare URL prompt is gone), and
the share placement window's new **Cover** row.
```
read at PICK time    the picker is open as long as you like; a snapshot taken when it opened
                     would overwrite meta that changed meanwhile  (getOccurrence, not a value)
clearing REMOVES     a stored null still reads as "has a cover key" to `"cover" in meta`
```

**THE SHARE WINDOW SUGGESTS THE PAGE'S OWN og:image AND NOTHING ELSE.** New key-authorized
`GET /share/stage/:id/cover` (the stage key, like the stage read — the window may have no Moduli
session). An image clip IS its picture, so it is returned without a fetch. A link goes through
`fetchLinkPreview` — the same function that gives app-made bookmarks their covers — and **only its
`coverVia === "og"` is offered**: that function falls back to a declared icon and then the site favicon,
which is right for a bookmark tile and wrong for a poster, and a 16px favicon stretched into a poster
slot is worse than the title text it replaces. A cover the user picks or clears is never overwritten by
the suggestion (`coverTouched`). `manualPlacement` writes it as `meta: { cover: literal:… }` — a literal,
like every other value there, so a URL carrying `${` is not interpolated.

**THE HALF THAT WAS MISSING WAS A CALLER.** `coverPick` had its own green suite; nothing pinned that any
surface used it — the `grid.meta.fieldVisibility` shape (09-22 (23): implemented, documented,
unit-tested, settable from nowhere). `coverPickWiring.test.js` is a source guard over all four, with a
control that it is reading real files and that stripping comments leaves code (or every `not.toMatch`
passes on an empty string). Its first version asserted PreviewNode has no `window.prompt` — **it still
renames a page with one**, so the assertion is scoped to a cover prompt.

**A/B, each mutation asserted to land:** reverting the four surfaces fails 4 of 5 wiring cases; removing
`manualPlacement`'s cover line fails 2 of 3 (the "no meta when no cover" case is a contract pin, passing
both ways); removing the cover route fails 6 of 7 (the 404 case passes vacuously with no route — named
as a pin, not coverage). Server **2,874 pass**; client **5,340 pass / 503 of 505 files**, the 2 errors
the documented `trackerValues` OOM pair. **NOT watched in a browser** — nobody has opened the picker on
a real row or shared a link with a cover; every layer is asserted and the suites are green, and that is
the honest gap.

---

### 2026-09-29 (2) — SHARE PLACEMENT WINDOW: a clip can be told WHERE to go and WHAT to become

Picked up the other account's share work (plan `docs/superpowers/plans/2026-09-28-share-placement-window.md`,
ledger `.superpowers/sdd/2026-09-28-share-placement-window/progress.md`). Every extension menu item has a
**"…choose where"** twin: it STAGES the clip (10 min, one-time 32-byte key) and opens `/share-place`, a
520×700 popup. Phone/Windows link+text shares stage and redirect there too; files still post straight.
```
Auto     runs the share rules; previews the type (classifyShare) + where the rule lands
New      pick a destination -> the row takes its siblings' SHAPE (role/kind/bindings) and the
         values >=2 sampled rows agree on (destinationSearch autoFields); map title/url/year…
Preset   save a mapping per grid (meta.sharePresets); an edited box is NEVER saved into it
```
Manual placement is ONE `CREATE` run through `runOperationServerSide` — the writer the rules use.

**FOUR GAPS THE PLAN WOULD HAVE SHIPPED:** the window's reads carried no auth and the routes did not
take the session JWT (`/grids`, `/fields` now do; presets have their own `GET/PUT /share/presets`
writing ONLY `meta.sharePresets` — the plan's whole-`meta` PATCH would have clobbered every other key);
Auto classified the extension's GESTURE (`shape`) as the share type; **a stage key could write any
body** — the clip's content keys now always come from the STAGE, never the request; a pre-write
refusal RELEASES the stage so a retry works. Also: a link clip was titled by the host tab, and auto
values were stringified (`["movie"]` -> "movie").

Server 2,859 pass · client 5,315 pass (the 2 unfinished files are the OOM pair). A/B'd: stage content
override, shape-as-type, the auth header. `FieldSelect` is lazy in the window (chunk 18 KB, was 1.1 MB).

---

### 2026-09-29 — THE APP STOPS STAMPING DATES; an op does it for the Schedule. And "+ Item" and a drag both used the wrong placement

User: *"stamping something with the date and using the date filter are two diff things"* · *"the autodate
stamp should just be on things dragged or added to the schedule"* · *"keep going … they are instances"*.

**THE STAMP IS GONE FROM THE APP.** `computePageFilterFields` copied the active filter's date onto every
typed, dropped, copied, moved and uploaded occurrence under a dated page. Removed from all of them, plus
`findFilterOverrideAncestor`, `stampPageFilterFields`, `parentFilterFields` and last session's
`isInsideTemplate` exception (which existed only for it). **Safe for visibility, read from the code:**
`isOccurrenceVisible` passes an instance with no value for the filter field ("persistent"). 3 dead test
files deleted; the tests that pinned the stamp are INVERTED with their reason (2 fail on the stamping
code; the container case passes both ways and is a contract pin). **My first A/B of those was VACUOUS** —
I stashed CommitHelpers but not the trimmed `filterFieldStamp`, so the old arm's stamp was undefined and
silently caught. Re-run with every file restored.

**THE SCHEDULE'S DATING IS AN OPERATION — `Schedule: Stamp Date & Time Slot`.** poms already had it
(onCreate, Panel C). Built on the rebuild by clicking: onAdd + onMove, instance, scoped to the Schedule,
priority 2; Date = `$item._effectiveFilter.<Date>`, Time Slot = the parent slot's. poms' op was edited by
clicking to read the slot from the INSTANCE'S parent (`$item.parentId`, `$destContainer.label`) instead of
the create event — a move carries no `containerLabel`, so with a move trigger its else-branch would have
CLEARED Time Slot — and got the onMove trigger (priority 2, in Schedule).

**TESTING IT FOUND THREE PLACEMENT DEFECTS, all the module-vs-placement class:**
```
"+ Item"     App.addInstanceToContainer found "the" container occurrence by MODULE id; every day
             column's slots are copy-links of the template's → 6 of 6 adds from today's 3:00pm
             landed in the Schedule TEMPLATE's 3:00pm (nothing dates it, nothing "in Schedule"
             fires, and the next build clones it into every day). Passes the placement id now.
a move       moveInstanceBetweenContainers rewrote the LISTS only: instance listed by 3:30pm,
             parentId still 3:00pm. And the branch HAND-ROLLED its OccurrenceMoveOp with no
             _ancestorIds (every "in Schedule" move trigger failed closed) and ran ops BEFORE
             updating the overlay. Now: persist parentId, overlay first, the shared fireMoveTrigger.
sameContainer compared MODULE ids — a move between two days' copies of one slot reordered in place.
```
4 move tests (all fail on the old code); a source guard for the add path.
**AND I SHIPPED A CRASH FOR ~3 MINUTES** (14:34–14:37 UTC): the first "+ Item" fix read
`containerOccurrence` in `onAdd`'s deps BEFORE its `const` — a TDZ ReferenceError in every container.
The full suite passed because no test mounts ModuleContainer. Fixed; the guard now pins declaration
order. No real-user loads in that window (server log).

**WATCHED ON THE REBUILD WITH NO APP STAMP:** add to today's 3:00pm → Date 2026-09-29, Time Slot 3:00pm;
drag to 3:30pm → Time Slot 3:30pm, parentId 3:30pm; op ran once each. `Completed Tasks` renders on every
day now: Sep 27 **2 → 1 (untick) → 2**, Sep 29 0. Cleared the stale dates on the Water + Completed Tasks
tiles and the Routines bank Drink (backup `instances-date-backup.json`); kept Last Opened (op marker) and
the two Work shifts (real dates). Test debris deleted through the app. poms renders clean.

**BEHAVIOUR CHANGE TO KNOW:** anything added OUTSIDE the Schedule (e.g. the Day Page's shared Todo) is now
undated, so it shows on every day. poms has 3 such dated instances on the Day Page. If a page other than
the Schedule should date what's added, that's the same op scoped to it — data, not app code.
Client 5,243 pass; the 2 worker errors are the OOM pair, identical before these changes.

---

### 2026-09-28 (9) — A CONTAINER IS NOT STAMPED WITH ITS PAGE'S DATE; and the rebuild's slot lookup read a stale date

User, on (8)'s tile finding: *"stamping something with the date and using the date filter are two diff
things"* · *"the autodate stamp should just be on things dragged or added to the schedule, idk why
trackers are stamped"* · *"clear the date stamped on containers"*.

**WHERE THE STAMP LIVES:** `helpers/filterFieldStamp.computePageFilterFields`, called by every create and
drop path (`CommitHelpers.parentFilterFields` + four sites in `dropHandlers`). It copies the active named
filter's nav value onto the new row. Its only opt-out, `meta.skipFilterStamp`, is written by NOTHING —
no UI, seed or migration. poms already does the Schedule's dating as data: `Schedule: Stamp Date & Time
Slot` (onCreate, scoped to the Schedule panel).

**SHIPPED:** `createContainerInContainer` no longer stamps. The test that pinned *"a container is stamped
too"* is INVERTED with its reason; HEAD fails it (A/B). Dated containers — day columns and day-page
sections — are dated by the ops that build them and are untouched.

**CENSUS FIRST:** poms: 573 builder-dated day-page sections + 66 day columns (kept, ops FIND them by Date)
and 61 unsigned. Rebuild: 3 day columns (kept) + **50 stamped**: Routines › Nutrition and the Sep 28
column's 49 slot copies — the latter left over from (7)'s template bug (COPY_LINK copied the template's
stale date), not new stamping. **Cleared through the app's events** (backup
`containers-date-backup.json`): 0 stamped containers left.

**AND THE REBUILD'S `Place Dated Work` NEEDED THOSE STALE DATES** — its slot FIND read the SLOT's own Date,
so it could only ever match the Sep 28 slots. Rebuilt by clicking in poms' shape (the editor only
appends, so the old inner loop was removed and re-added in order): FIND the day column by Schedule
Format `day-col` + Date SAME_DAY the shift, then per covered label the slot under that column by Time
Slot. **Watched live:** Work 330 → 360 min added **12:30pm**; the Sep 28 column renders 49 slots.

**OPEN (the user's call):** row stamping itself. The rebuild's Completed Tasks and Water TILES are rows,
not containers, and still carry Date; the plan on the table is to stop app-level stamping entirely and
build `Stamp Date & Time Slot` on the rebuild so only Schedule adds get a date — after checking which poms
rows depend on the automatic stamp. Probe note: an expired auth token shows as a 90s `waitForFunction`
timeout in `_build.mjs open()` — re-mint with `_mkauth.mjs`. Client 5,251 pass; the 2 worker errors are
the OOM pair, identical on the pre-change code.

---

### 2026-09-28 (8) — `Completed Tasks`, BUILT BY CLICKING; and a tracker tile made in the UI hides itself on every other day

Rebuild-via-UI, next op after Build Schedule (its poms tail runs it). **No code changed.**

**BUILT END TO END BY CLICKING, and the condition came out byte-for-byte poms' shape:**
```
Trackers › Stats (board container, via the page's quick-add) › Completed Tasks (binds Tasks Completed)
$acc = 0 · $scopePageId = <Schedule> · $goalItem = $allItemsById.<tile> · $goalPeriod = $goalItem._effectiveFilter.<Date>
LOOP $allInstances  IF  Completed IS true · _ancestors HAS_ANCESTOR $scopePageId · meta.feedSourceId IS_EMPTY ·
                        _boundFieldIds ARRAY_NOT_INCLUDES <Habit> · (Date DATE_IN_PERIOD $goalPeriod OR $goalPeriod IS_EMPTY)
  then ++ $acc          UPDATE $goalItem.fields.<Tasks Completed>.value = $acc
triggers  onLoad · onChange Completed · onAdd/onDelete instance in Schedule · onFilterChange grid
```
Build Schedule now runs it beside `RUN Water`, inside the gate (a first attempt put it at the top level — removed).
poms' Tags category rule is left out: the rebuild has no Tags.

**WATCHED WORKING, from real clicks:**
```
Sep 28   0        (correct: the only completed rows are dated Sep 27)
Prev     2        Coffee + Drink, Sep 27 — onFilterChange
untick   1        the Coffee row's Completed switch — onChange
re-tick  2
Next     0
```

**THE FINDING — REPORTED, NOT FIXED: THE TILE IS INVISIBLE ON SEP 27.** A row created on a date-filtered
page is stamped with the filter field (`computePageFilterFields`), so the tile carries `Date = 2026-09-28` —
an UNBOUND value, shown nowhere and clearable from nowhere — and the Trackers page hides it on every other
day. The rebuild's Water tile has the same stamp. poms' tiles never had it (seed-made): they carry
`Tracker Date` + `Aggregation` instead of `Date`, so the filter passes them. For a task the stamp is the
design (it is what files a row under its day); for a tracker tile it is wrong, and the app cannot tell the
two apart. The user's call.

**PROBE NOTES:** the trigger's field target is now the searchable `FieldSelect` (09-28), not a `<select>` —
click `[aria-label="Specific field"]`, type, click the row. A new op arrives with an `onLoad` trigger already.
`__moduli_state__.occurrences` can hold a non-string id — `String(o.id)` before `startsWith`.

---

### 2026-09-28 (7) — BUILD SCHEDULE, BUILT BY CLICKING: eleven editor gaps, a template that dated itself, and a day column that moves its page

The user's asks, in order: build `Schedule: Build Schedule` on the rebuild grid (49 slots like poms; move
the old slots' rows into day columns), and *"if i change the filter on today's schedule container or
daypage container, the op would change it there as well"* → **"that day's column, same spot"**, with
*"it shouldnt be any page level filter change anyway. just the page schedule and daypage are on"*.

**GROUNDWORK BY CLICKING:** Time Slot's 49 options in poms' order (plus Todo), a `Schedule Format`
field (`slot · day-col · flat`), `Templates › Schedule Template › Schedule: Layout` and its 49 slots, each
bound and valued. The slot pass found a real defect on the way: **a popover was capped at the VIEWPORT,
not the space it opened into** — a 49-option pill opening mid-screen ran to y≈1300, every option after
~1:00pm unreachable (`--radix-popover-content-available-height` now). Also a probe fault worth knowing:
the Layout list is WINDOWED — a child outside the render window has an EMPTY header, so address rows by
`data-occ-id` from state, never by header text (a blank-looking `Todo` read as "unnamed").

**THE PIPELINE (~70 steps) IS STRING-EQUIVALENT TO POMS'** (19 diffs, all representation — "7" vs 7,
`literal:flat` vs `flat`, a `json:` object vs a real one — plus poms' tail `RUN_OPERATION "Completed
Tasks"`, not rebuilt yet). Built with `_opb.mjs`, which addresses every block through new editor hooks
(`data-steps-of="<stepId>:then|else|body"`, `data-step-id`). **Eleven things could not be authored in the
UI and were fixed, each measured across every grid first, each A/B'd, all client-only:**
```
CREATE          meta 12 · identitySignature 3 · filterOverride 1         (editor inputs)
APPLY_TEMPLATE  defaultFields 6 · replacements 3 · rootParent 6 · rootLabel 2 · rootIdVar 2 ·
                rootSignature 1 — and a template picked BY VARIABLE ($tplInstId)
FIND            143 of 174 steps look in $allContainers/$allInstances/$allPages: a picker's chosen
                value had NO click handler and FIND turns "" back into $allOccurrences
MOVE            16 of 20 steps use a computed target; the toggle could never enter expression mode
$trigger        10 props live ops read, never offered (sourceOccurrenceId 12, occurrenceId 23 …);
                NOT `fields` — its cell shape depends on the emitter (see below)
built-ins       $activePeriodDates / $activePeriodCount / 5 more date vars (3 of 10 offered)
record picker   role / kind (16 rules), meta.layoutCascadeOverride (3 UPDATEs)
json: literals  39 of 40 object values carry $var leaves; json: resolved none — now $-leaves only
                (0 of 89 live json: payloads held a $-string; server mirror PENDING, see below)
checkboxes      COPY_LINK "include children" showed OFF for 16 of 19 steps that copy children
```
**AND ONE DEPLOY WENT OUT WITH A RED TEST** (`loopCollectionPicker` pinned 9 collections) — my
command did not gate the deploy on the suite; fixed one commit later, gated since.

**A TEMPLATE THAT DATED ITSELF — the finding that mattered most.** Every create is born carrying its
parent's filter values (2026-08-05), so building the template under a date-filtered page stamped all 49
slots `Date = 2026-09-28`; day columns copy-link them, so **stepping to Sep 29 minted a column that
rendered 0 slots.** Poms never hit it only because its seed cleared its template page's filters.
`computePageFilterFields` (the one function typed creates AND drops share) now never stamps inside the
Templates folder (`templateHelpers.isInsideTemplate`); the 49 stored values were cleared through the app's
own events with a backup (`tpl-slots-backup.json`). **Sep 29: 0 → 49 slots.**

**YOUR DAY-CONTAINER BEHAVIOUR — built as a SEPARATE op, after two designs that could not work.**
1. *In-run redirect inside Build Schedule:* worked on the rebuild, but poms' version needs steps ABOVE its
   gate, the editor only appends, and step drag-reorder could not be driven headless (pragmatic's native
   HTML5 drag never started — **UNVERIFIED whether reordering works for a real user**).
2. *Let the page write re-run the builder:* the page's navigation never fired, for TWO reasons. The
   cycle breaker (`operationExecutor.js:1110`) rightly stops an op re-triggering ITSELF — **and a real
   defect: the UPDATE_ITEM_FILTER_OVERRIDE effect passed `modulesById: state.modulesById`, undefined in
   store state (modules is an array), so `updateOccurrenceFilterOverride` returned before building the
   cascade. EVERY op-driven page-filter move persisted and ran nothing.** Fixed with
   `byIdCached(state.modules)`; `opFilterMoveCascades.test.js` drives the real effect (HEAD fails). Only
   `Grid: Snap Filter To Today` writes page overrides, so its pages now also cascade (idempotent).
3. **Shipped:** a small priority-0 op per page — `Schedule: Day Column Moves Page` /
   `Day Page: Day Column Moves Page` — scoped to its page (filterNav `ancestorId`): if a day column's own
   date differs from its Date field, move the PAGE there and put the column back. The page's navigation
   then runs the builder normally (the write came from a different op). Build Schedule stays IDENTICAL to
   poms'; the in-run prelude was removed from the rebuild. **Watched on the rebuild:** stepping the Sep 30
   column → `NavigationOp occ=<page>` → Build Schedule `CREATE_ITEM=50` → Oct 1's column in the same spot.
   **On poms:** both ops built by clicking (one session, save-only-on-success), both builders' filterNav
   triggers scoped to their page, and both ops REPLAYED in Node over a poms snapshot with the column date
   changed in memory: page → 09-29, column → back to 09-28, and nothing when the page itself is the
   source. **Not stepped live on poms** — that moves the user's real dates; the replay + the rebuild run
   cover the same code.
   Noted, not changed: the op-effect path turns a null value into `{}` when it removes the last key, which
   the cascade reads as "clear every filter here" (filterConfig guards this; the effect does not).

**Coordination:** account2 picked up this op while I was at a usage limit, added the two filter triggers,
set the priority ladder, and fixed ADD_CHILD's multi-match (entry (6)). My later trigger pass duplicated
its rows; removed, and its filterNav row is the one now scoped.

**THE OLD SLOTS, MIGRATED (the user's call), and two more defects on the way.** The rebuild's Schedule
page held 4 slots directly with dated rows. Sep 21's 11 legacy rows went into a Sep 21 column by
"Move N selected" (bulk needs >1 selected, by design) — **and every row but the last in each group stayed
listed by its old slot too: `_pasteInto` wrote each source list from one pre-loop snapshot**, re-listing
the row moved just before. Fixed with a running copy of each list the loop has rewritten
(`bulkMoveSameParent.test.js`, HEAD re-lists). One row had also missed its destination list and would have
gone invisible — re-listed with `link_occurrence_to_parent` (its key is `parentOccurrenceId`; a probe that
sent `parentId` "succeeded" and changed nothing). Coffee and Drink (Sep 27) needed single drags: a far
drag's auto-scroll overshot every way I tried (one release landed Coffee on the PAGE itself; recovered),
so they went by short hops between adjacent slots, which land exactly. **The Sep 21 column then turned
out listed by NOBODY** — no recorded transaction ever added or removed it (the build lists a column
through an op effect, which the log does not carry), the 09-23/09-26 class; re-listed, and the build
re-lists its column every run. Then the 4 old slots deleted through their radial: **14 of 14 rows alive
and listed**, the page holds only day columns (Sep 21 · 27 · 28), integrity down to the one stale rule.

**STILL OPEN:** ONE server deploy for the `json:` mirror in `serverExecutor.js` (headless runs; no live
payload has a `$` leaf yet) and the `unsigned-template-node` rule (it predates the 2026-08-07
auto-signature fallback and flags the 49 template slots — but retiring a rule with six tests pinning the
07-31 duplicate shape wants per-path proof the fallback covers every apply, not a late-night call); both
need a server restart. 3 live onChange ops read `$trigger.fields.<id>.value`, undefined for a UI edit
(raw value) — reported, not changed. Step drag-reorder in the op editor: unverified for real users.

---

### 2026-09-28 (6) — `Schedule: Build Schedule` IS TRIGGERED AND PRIORITISED; and an array reached the server as an occurrence id

Picked up account3's session (limit at 16:11 CDT). Its 72-step pipeline was complete — including the
`redirect` branch for the user's 13:12 ask — and **it had no triggers at all**. Added the two
`onFilterChange` triggers by clicking, which is what makes the op fire on anything but a load:
```
onFilterChange · grid       the TOOLBAR only (matchSubjectFilter refuses a sourced transaction)
onFilterChange · filterNav  a page's or a day column's own override — the redirect's entry point
```

**THE PRIORITY LADDER COULD NOT BE AUTHORED, AND IT IS THE ORDER THE WHOLE LOAD DEPENDS ON.** The
trigger editor offered P1..P10 while `Grid: Snap Filter To Today` runs at **0** — and the executor's
own `_LIVEOCCS_MUTATING` comment records what that ordering is worth: *"today's column was not
created until the NEXT load"* when Build Schedule read the date before Snap moved it. Measured
across every grid: **4 triggers store 0**, and a `<select>` cannot even DISPLAY a value it does not
offer, so those four read blank. `TRIGGER_PRIORITIES` is 0..10 now, plus `priorityOptions(stored)`
for anything outside the band. Set by clicking, mirroring poms:
```
Snap Filter To Today 0 · Build Schedule 1 · Place Dated Work 2 · Coffee/Water/Water Today/Tasks Done 3
```

**THEN THE DATE STEP WAS WATCHED, AND IT WROTE 102 MALFORMED WRITES NOTHING SURFACED.** Stepping the
toolbar built tomorrow's column and rebuilt today's on the way back — while the console filled with
`server_error: Failed to update occurrence`. Only prod's log said why:
```
update_occurrence error: CastError: Cast to string failed for value "[
  '34ea189f…' (the loose 12:00pm),  '3c4cb4cf…' (the day column's 12:00pm)
]" (type Array) at path "id"
```
`FIND` binds an ARRAY when its predicate matches several records — its documented contract — and the
rebuild's `Place Dated Work` finds its slot **by label under the Schedule page**, which was
unambiguous until Build Schedule created a column carrying a second container named "12:00pm".
`ADD_CHILD` then emitted `update_occurrence { id: [ … ] }`. **`SET_FIELD_VALUE` has refused exactly
this since it was written** (*"matched N records — bind one"*); ADD_CHILD and REMOVE_CHILD never
adopted it — the two-implementations-of-one-question class, again. One `singleOccurrenceId` now, and
the refusal NAMES the step, the expression and the count in the op's own run log instead of dying in
a server log nobody reads. The op itself was narrowed by clicking (slot format + same-day as the
appointment), which is the discriminator poms uses.

**AND THE SAME CLASS WAS LIVE ON POMS, TODAY, WHILE THE USER WAS IN THE APP.** Tracing the array
above turned up their own Schedule column for today, created 16:53 CDT:
```
e53c453b  sig schedule:col:2026-09-28  module *** MISSING ***  listedBy 1  kids 49
```
Listed on the page, rendering nothing, and refusing every rebuild as a duplicate — the 2026-09-19
(10) failure repeating. The module is absent from Mongo AND from the warm cache (checked, because a
cache-only module would make deleting it the wrong move). Its 49 slots and 43 grandchildren carry
**0 ticks, 0 text, 0 shared listings**, so the column was deleted through the app's own
`delete_occurrence` behind a guard that re-checks all of that (93 rows backed up first), and the next
load rebuilt it: `ea49ef89`, module present, 49 slots, listed. **What LOSES the module is still not
explained** — the create/disconnect asymmetry is the standing suspect and this is the second sighting
in ten days.

**THE USER'S OWN CLIP QUESTION, ANSWERED FROM THE SHARE LOG RATHER THAN GUESSED:**
```
21:51-21:54Z  type=link  source=extension  "A Guide to Recognizing Your Saints (2006) IMDb"
  grid TEST GRID 2   rule "Share: anything else"   created 67207c1f  kind=bookmark  -> Files folder
```
So the clip WORKED and links DO become bookmarks; the extension's options box still holds test grid
2 from the 09-24 testing, and Firefox's `storage.sync` carried it to the Windows machine. No window
is supposed to pop up — the extension has no popup, only a system notification. **Reported, not
fixed:** that options page asks for a raw grid id, which is exactly how it sat on the wrong grid for
four days.

**EVERY FIELD PICKER IS THE SEARCHABLE ONE** (user: *"i wanted to add a filter on the bookmarks page
and it was incredibly hard to find the field … any place that selects a field should be using that
one"*). `ui/FieldSelect.jsx` WRAPS `DestinationPicker`, which wraps `OptionSearchList` — the same
list every occurrence dropdown opens, and the same complaint that picker was built for one surface
earlier. Eight native `<select>`s swapped: local filters, the layout cascade's "Order by", a feed's
condition field AND its sort, the grid's named-filter conditions, a trigger's target field, both
prefill rows, and the import field map. **The test is a WALKER**, because the failure mode is the
NEXT one someone adds — and its first regex was too narrow: it passed against an un-swapped
`FilterEditor` whose `.map` is parenthesised across lines. A/B'd after tightening: reverting three
surfaces fails 2 of 4.
**Watched on prod by clicking:** Add filter -> the picker reads `— field —`, opens **227 fields with
their types**, typing `comp` narrows to 6, picking sets the trigger to `Company`. Cancel left 0
filters behind.

Client **5,245 pass**; the one full-run failure is the documented `accountBalances` timeout (passes
alone, checked). Three client-only deploys, `deploy.sh` reporting *"Server unchanged"* each time.
Rebuild ops **8 of 88**; the grid ends with one healthy day column and no debris.

---

### 2026-09-28 (5) — `Schedule: Place Dated Work` FIRES; its gate had always passed

Picked up the op (5) of 09-27 left open: *"built entirely by clicking and it produces nothing … the
gate never passes for ANY of the 166 instances."* **The gate was never the problem — it passes.**

**MEASURED IN NODE OVER A LIVE DUMP, as that entry recommended** (the real `executePipeline`, the
grid's own rows): each of the four gate rules evaluated alone on the enriched `Work` item —
`_boundFieldIds ARRAY_INCLUDES Duration` PASS · `Time Slot IS_NOT_EMPTY` PASS · `meta.feedSourceId
IS_EMPTY` PASS · `Date SAME_DAY $today` FAIL, correctly: Work is dated Sep 27. Re-dated in memory, the
real pipeline ENTERS the THEN for Work. The "never passes" read was almost certainly a Work row not
dated the day it ran, which the 50-iteration log cap hid.

**WHAT PRODUCED NOTHING WAS DOWNSTREAM, TWO AUTHORING SLIPS:**
```
SLOTS_COVERED  slotLabels "$slotId"            <- unset at that point, so $covered was empty
ADD_CHILD      childId    "literal:GATE PASSED" <- a diagnostic left in place
```
Both corrected in memory first (the pipeline then emits two list writes, 7:00am and 9:00am), then
**repaired through the editor by clicking** — `$slotLabels` is an array var, so a body click DRILLS it
and the field saved EMPTY on the first try; it commits through its chevron (`pickThis`). The stale
`expr` key on the ADD_CHILD is left; the executor reads `childId`.

**WATCHED ON PROD:** today's shift added as a row in Tasks › Today (the picker pre-ticked the sibling's
9 fields; Date stamped 2026-09-28 from the filter), Time Slot 7:00am, Duration 180 from its chips ->
reload -> **7:00am and 9:00am list Work**, once each, persisted, idempotent on a second load. Then the
triggers poms carries (`onFilterChange` grid + filterNav, `onChange` Time Slot / Duration / Due /
Completed On) added by clicking, and **Duration 180 -> 330 put Work into 12:00pm live, no reload.**
Left at 330: the op only ADDS placements (as poms' does), so shrinking it would strand 12:00pm.
Yesterday's Sep 27 `Work` row is kept — it is history, not debris. Integrity 0 errors. **No code
changed** — the fixes are data, made in the UI.

**Probe notes:** a Date chip hidden by the grid's field visibility cannot be re-dated in place — a new
row in a dated container IS the date gesture. A scratch vitest over a JSON dump is the way to see an
iteration past the log cap; vitest's setup swallows `console.log`, so write the result to a file.

---

### 2026-09-28 (4) — THE SNAP WATCHED; WATER BUILT BY CLICKING; and "filter off" on a page never reached inside it

**`Grid: Snap Filter To Today` DID ITS JOB ON THE FIRST LOAD OF THE DAY** — the gap (3) left open:
```
marker Last Opened 2026-09-27, grid date 2026-09-27  ->  first load: grid 2026-09-28, marker 2026-09-28
second load                                          ->  marker timestamp unchanged (the guard held)
```

**THE WATER TRACKER, BUILT BY CLICKING** — a goal row `Trackers › Physical › Water` (the item picker
pre-ticked the sibling's `Daily Coffee`; unticked, `Daily Water` ticked) and a `Water` op in seven
saved phases. **Its pipeline and six triggers are string-identical to Coffee's once ids are mapped.**
Watched: drag the Routines Drink into 12:00pm, Beverage = Water, 16oz -> **Daily Water 0 -> 16** on
Completed (0 while Completed was off), **-> 0 on a radial delete** — (4)'s tombstone fix, live.
Rebuild ops **8 of 88**.

**AND THE TEST WAS BLOCKED BY A DESIGN RULE, NOT A BUG IN THE OP.** The Routines bank Drink — built
yesterday, dated 2026-09-27 — had VANISHED today, with the Routines page's Date filter switched OFF.
A `filterOverride[fid] = null` mute was LOCAL-ONLY unless the muting occurrence declared the filter in
its own `filters[]` (May 16). A page is not itself filtered, so "Active: off" on a page changed nothing
a user could see while its toggle read OFF.
```
across every grid   non-leaf null mutes   1   <- the rebuild's Routines, made through the UI
                    `{}` clears      12,405 on poms alone, all seed-written; no UI gesture writes one
```
So poms' "show everything under here" existed only because a seed wrote it. **The user's call: the mute
REACHES EVERYTHING INSIDE, and any level inside can turn the filter back on by setting a value, which
cascades in turn** — nearest wins, like every other override value (FiltersSection's Active-on already
force-writes a value when an ancestor cleared it). `_ownsLocalFilter` and the leaf/non-leaf split it
needed are gone; the memoized resolver serves leaf and ancestor from one cache. Two tests that pinned
the old rule are INVERTED with the reason; a control pins the re-enable-inside case; the old rule fails
exactly the two. **The change moved exactly one row in the database.** Client 5,184 pass / 0 fail,
client-only deploy. The Drink is back on Sep 28.

**Probe notes:** `BEV` referenced inside `page.evaluate` is a ReferenceError in the browser, not the
Node scope — pass it as the argument. A store read right after load can miss a row whose chunk has not
arrived (`coffee: null` while Mongo held `"0"`); read it again before calling it a defect. **Known
wrinkle, not fixed:** the ops built from a typed `0` store the total as the STRING `"0"` when nothing
matches (a number once anything is summed) — the reader-coerces decision of 09-22 (22) covers it.

---

### 2026-09-27 (5) — FIVE MORE AUTHORABILITY GAPS, and one op BUILT BY CLICKING THAT DOES NOT FIRE

Picked up my own session after a limit reset; account3 had meanwhile finished `Grid: Snap Filter To
Today` and the delete-recount fix (entries (3) and (4)), **including the `descendShape` class I was
one edit away from** — my uncommitted `filterValue` shape and its test were swept into its commit by
`deploy.sh`'s `git add -A`, the documented shared-checkout hazard, and properly superseded.

**FIRST, BOTH FLAGS FROM (2) CLOSED.**
- **The stale `Logged On` value is gone AND cannot accrue again.** `Toolbar.handleToolbarNav` spread
  the whole `activeFilterValues` and set only the nav fields, so a key never left it. Measured across
  every grid: **exactly one orphan key exists anywhere** — the rebuild's — so the prune risks nothing
  elsewhere. It **FAILS CLOSED** (a grid declaring no named filter prunes nothing; an empty reference
  set would wipe every value) and is scoped to ANY named filter, not the active one, because switching
  filters has to keep each one's date. Repaired live through the app's own path: one toolbar date step
  writes the pruned map, one step back leaves the date where it was.
- **Then the rebuild continued**, and building `Schedule: Place Dated Work` by clicking found five
  more gaps of the shape (2) is about. Each measured first:
```
the action picker offered 70 of the executor's 86 actions      7 of the 16 run in live pipelines
  15 of those 16 then had NO config editor                     `if (!schema) return null`
a loop could iterate only the 9 built-in collections           76 loops · 27 ops
$var.occurrences had no picker entry                           45 strings · 8 ops
a step's OUTPUT var was invisible to later steps               6 keys · `to` alone is 25 actions
```
- **`SET_FILTER` is the one that started it** — it is how `Snap Filter To Today` moves the date, and
  it could not be picked. **The 76 loops are the sharper find:** they are the schedule and day-page
  builders, the ops the rebuild needs most, and `$dayCol.occurrences` / `$covered` were unreachable.
- **`collectLocalVars` is the subtlest.** It read `name`/`itemIdVar`/`itemVar`; a schema action names
  its output with its own key, so a SLOTS_COVERED step's result could not be chosen as the next loop's
  collection — the only thing that step is for. A BLANK optional field now contributes its documented
  DEFAULT, because that is the var the executor writes; treating blank as "produces nothing" is what
  made the gap visible. All of it DERIVED from the schema, so the next action needs no second edit.

**AND I SHIPPED ONE OF THOSE FIXES INCOMPLETE, WHICH THE REPO'S OWN TEST CAUGHT AFTER I DEPLOYED.**
Adding the 16 actions to `actionTree.js` made them selectable; 15 had no config shape, so the step
rendered with nothing to configure. `actionEditorCoverage.test.js` exists for exactly that and was RED
on the deployed build — **I ran the action-tree suites and not that one.** Every full run since has
been the whole suite.
**Its key-read detector was then STRENGTHENED, not loosened, to admit them:** it matched `cfg.<key>`
only, so it was blind to a case that DESTRUCTURES (`const { dateFieldId } = cfg`) — which would
equally have passed a key that genuinely was not read. A/B'd with a deliberately bogus key.

**THE OPERATION IS BUILT ENTIRELY BY CLICKING AND IT PRODUCES NOTHING. Said plainly, because every
part I can observe is correct:**
```
LOOP $allContainers as $slot → IF ancestor of Schedule → PUSH $slot.label     $slotLabels Array(4) ✓
LOOP $allInstances as $appt → IF (4 rules) → SLOTS_COVERED → LOOP $covered
                              → FIND the slot by label → IF → ADD_CHILD
run:  0 changes · 4ms        Work stays listed only by Tasks › Today
```
- **The gate never passes for ANY of the 166 instances** — a NOTIFY placed in its THEN never fired,
  which is what splits "the gate fails" from "something downstream fails".
- **And every rule holds on the data**, checked outside the executor: `Work` binds Duration (9
  bindings, the id matches), `Time Slot` is "7:00am", `Date` is today, `meta.feedSourceId` is empty.
  `_boundFieldIds` IS enriched (the trail shows Array(0)/(1)/(2)/(3)/(4)/(7) across records), the
  slot-label loop works, and `slotsCovered(7:00am, 180, [4 labels])` returns `7:00am, 9:00am` by
  reading its source.
- **What blocks the diagnosis is the log's own cap:** `LOOP_LOG_ITER_CAP = 50` against 166 instances,
  so Work's iteration is among the 118 omitted and no logged snapshot shows `Array(9)`.
  **The next step is therefore to raise that cap or drive the pipeline in Node over the live state** —
  not another UI probe, which cannot see the iteration that matters.

**PROBE FAULTS, and the first two are ones this repo had ALREADY pinned as probe faults.**
```
a rule row holds TWO identical "+ Pick path" placeholders, so a global "last
  match" put every picked LEFT into the RIGHT — which `conditionRuleSides.test.jsx`
  exists to record as a PROBE fault. Walked into it anyway.
`__moduli_state__` carries `occurrences` as an ARRAY; there is no
  `occurrencesById`, so every read printed a convincing `stored: null` and I
  reported "the write did not land" until MONGO said 20.
`clickIn` clicked the box a CLIPPED element reported and returned true for having
  FOUND it — a Fields-tab row at y=6088 in a 1000px window. It scrolls, hit-tests
  and explains the miss now; returning true for a missed click makes every later
  step read as the app being broken.
rule rows are indexed DOCUMENT-WIDE, so the rule of a nested IF is the LAST row,
  not row 0 — row 0 is the OUTERMOST IF's, and I overwrote its same-day check.
a compact field pill is a BUTTON titled "<Field>: Click to edit" — not a div, and
  click-to-edit rather than hover. Four locators missed it on a row that plainly
  showed the value.
`Find` and `Add as child`: a category and its leaf share a title, and a leaf's
  title is not its enum name. One drill left the step as the default INIT_VAR.
a drillable row COMMITS via its chevron, not a body click (`$slotId`).
```
***And a fifth thing that nearly became a false debris report:*** my own scan found *"20 occurrences
created today, parented but listed by nobody"*. All 20 are **board pages homed in FOLDERS**, the
designed shape — `checkGrid`'s 0 errors was right and the heuristic was the trap 09-22 (2) warns about.

**Rebuild: 7 of 88 operations · 225 fields (203 still unbound) · integrity clean, 0 real orphans.**
Client **5,173 pass / 0 fail** (the 2 worker errors are the documented OOM family). Six client-only
deploys, `deploy.sh` correctly reporting *"Server unchanged"* each time.

---

### 2026-09-27 (4) — COFFEE DRAGGED IN FROM ROUTINES; and deleting a row never lowered a tracker

The user's queued ask from account3: *"we want to test dragging in from routines for stuff like
coffee"*. Account3 had dragged `Routines › Physical › Nutrition › Drink` (copy mode) once, before the
Coffee op existed — it aimed at 7:00am and **landed in 9:00am** (probe aim), and that copy is the `12`
in `Daily Coffee = 8 + 12`. So the tracker reacting to a dragged-in drink had never been watched.

**WATCHED, by clicking, with the drop point hit-tested before release:**
```
drag Drink -> Schedule 12:00pm      lands in 12:00pm, Date auto-stamped Sep 27, bank Drink untouched
Beverage = Coffee, Liquid = 4       Daily Coffee 20   <- Completed is bound and off: the gate works
tick Completed                      Daily Coffee 24
delete (radial)                     Daily Coffee 24   <- THE DEFECT
```
**THE OP FIRED ON DELETE AND WROTE THE OLD TOTAL** (`[op-effects] "Coffee" UPDATE_ITEM_FIELD=1`, value
24). `deleteOccurrence` evicts from the local overlay and fires in the same tick as its dispatch;
`stateRef.current` is assigned on RENDER (App.jsx:85), so the base still held the row — and
`occOverlay.drop` removed only the OVERLAY entry, so `merged()` fell back to the base copy. **Every
tracker's onDelete recount has counted the row it was deleting.** It hid because the next `onLoad`
recomputes (the following load read 20). The July "delete-recount" behavioural test drives the executor
with a map it deletes from itself, so it never passed through this layering.

`drop` records a TOMBSTONE that `merged()` strips; `set` (undo restore, re-create — both verified to
go through `setLocalOcc`) and `reset` clear it; a tombstone the base no longer holds is pruned. No
version bump, so the unheld-echo cache guard stands. **An existing test asserted "a drop falls back to
base" — the defect — and is inverted with its reason.** A/B (mutation asserted, 0 -> 8 `tombstones`):
the old overlay fails exactly the 3 delete cases. Client 5,158 pass; the one full-run failure
(`accountBalances`, 61s timeout) passes alone in both arms. **Verified on the deployed build: 20 -> 24
-> 20** from a real radial delete, stored 20 in Mongo.

Debris: none — three probe rows deleted through the app, none listed, copies share the Drink module so
no orphan module. Integrity clean.

---

### 2026-09-27 (3) — `Grid: Snap Filter To Today`, BUILT BY CLICKING; and three picker shapes that drilled to nothing

Picked up account2's session (limit at 16:17 CDT, mid-edit on `DrilldownPicker.jsx`). It had fixed the
action picker (16 executor actions never offered, 15 of them with no config shape) and made
`filterOverride` drill per field, and was one layer short of finishing the op.

**THE LAST LAYER WAS A CLASS, NOT A SHAPE.** It had added a `filterValue` shape (the date nav's range
object `{value, unit, span, kind, dates}`) and pointed each filter-map entry at it — and the new test
read `[]`. `descendShape` HAND-LISTED which shapes it descends into, so a shape could sit in `SHAPES`,
be named as a row's `childShape`, and drill to nothing. **Two more already did: `tableColumn` and
`tableCellsMap`, unreachable since they were written.** It falls through to `SHAPES[shape].keys` now,
and the test WALKS every `childShape:"…"` in the source — A/B: the hand-listed dispatch fails exactly the
4 unreachable cases. Client **5,156 pass / 0 fail**; client-only deploy.

**THE OP, FINISHED BY CLICKING, IS IDENTICAL TO POMS' ONCE IDS ARE MAPPED** (asserted by a string
compare, not by eye): the three OR arms (`.value IS_NOT_EMPTY` · `.unit IS_EMPTY` · `.dates
IS_NOT_EMPTY`), the loop's `UPDATE $pg.filterOverride.<Date> = $today`, and the marker stamp.
```
load 1          marker Last Opened Date  null -> 2026-09-27     (the else branch ran)
toolbar Prev    grid date 2026-09-26
load 2, same day   date STAYS 2026-09-26, marker timestamp unchanged   <- the guard held
toolbar Next    restored 2026-09-27
```
**NOT WATCHED: the snap itself moving a stale date to today.** It needs a marker from an earlier day,
i.e. tomorrow's first load. Integrity clean; unused fields 205 -> 204 (Last Opened Date is used now).

**Probe notes:** a row that HAS children drills on a body click, so committing at `filterOverride.<Date>`
takes its chevron (`pickThis` in `_ops.mjs`); `clickInThen` takes the FIRST `then:` — the OUTER if's —
so the loop's then needs `clickInLoopThen`; the outer else's own footer is the LAST `+ Action` in it.

**Rebuild ops: 6 of 88.** 82 enabled poms ops have no counterpart.

---

### 2026-09-27 (2) — THE COFFEE TRACKER, BUILT BY CLICKING; and 56% of live operations used a comparator no editor could offer

Picked up the other account's rebuild-via-UI session (limit at 12:21, mid-build: it had just
created and named the `Coffee` operation and gone no further). The task was to recreate poms'
Coffee tracker end to end through the UI. **It works — `20 → 8 → 20` on screen and in the stored
field, driven by a real click** — and getting there found four gaps of one shape.

**THE HEADLINE: THE CONDITION EDITOR COULD NOT EXPRESS WHAT LIVE OPERATIONS RUN ON.** Building the
op's IF needed `DATE_IN_PERIOD` and `ARRAY_NOT_INCLUDES`, and the `<select>` carried neither.
Measured across every grid before touching anything:
```
248 operations · 3,475 condition rules
138 operations (56%) use at least one comparator NO editor could offer
DATE_IN_PERIOD 390 rules · ARRAY_NOT_INCLUDES 107 · DATE_AFTER 35 ·
DATE_ON_OR_BEFORE_PERIOD 14 · ARRAY_INCLUDES 12 · TIME_BEFORE 6 · TIME_AFTER 5 ·
NOT_HAS_ANCESTOR 4 · DATE_BEFORE 3
```
Every one of those 576 rules was written by a seed or a migration. **There were THREE
hand-maintained comparator lists** — `helpers/comparators.js`'s 12, `ConditionGroup.jsx`'s 20,
`evalRule`'s 34 — and the two UNARY sets had drifted in OPPOSITE directions, so a value box
appeared on a comparator that ignores it. One catalog now; `comparatorCatalog.test.js` **WALKS
`evalRule`'s own source** and fails when the evaluator learns a comparator the list does not carry.
**A stored comparator the list lacks gets its own `<option>`** — a `<select>` whose value is absent
renders blank or shows the first entry, so all 576 rules read as something they were not.

**THE SAME SHAPE, THREE MORE TIMES, each measured rather than guessed:**
```
_boundFieldIds as a rule LEFT        113 rules · 38 ops   no picker entry
ancestor-scoped onAdd/onDelete       364 triggers · 43 ops  editor rendered the inputs
                                                            for onFilterChange ALONE
"Run now"                            computed every effect and DROPPED it
```
- **`_boundFieldIds`** is how a tracker says *"this row never bound Completed, so scope membership
  alone counts it"*. The executor has enriched it since 2026-07-11. One line, same gap as
  `meta.feedSourceId` got that morning. (Same scan: `_ancestors` 299 · `meta.feedSourceId` 177.)
- **The ancestor scope is NOT cosmetic** — 09-22 (26) records an UNSCOPED `onAdd` firing on the
  app's own plumbing, so the scope is what keeps a tracker off every create on the grid, and poms'
  whole tracker set depends on it. **`matchAncestorScope` gates EVERY trigger type**; only the
  editor was hardcoded. `isAncestorScopable` DERIVES the set from the transaction types that
  actually carry `_ancestorIds` (traced to the call sites), so a new event mapping to one is
  scopable without anyone remembering to flag it. **And the readout now names the scope** — before,
  a page-scoped trigger and an unscoped one both read `onAdd · Instance · Any`.
- **"Run now" is the third hand-run surface and it was the one missed.** `applyManualOpUpdates` has
  existed since 09-21 for this exact defect on the trigger widget and the `button` field. **The
  confirm is derived from what the run PRODUCED** — an entry carrying `_effect` is a write, one
  without is a display value, `_suspend` is a continuation — so a tracker that only shows a number
  applies silently and anything that creates or deletes asks. The user's call was apply-with-confirm
  over renaming the button. **6 operations had no invoke path at all** until this.

**AND `$activeDate` WAS READING AN ABANDONED FILTER.** `grid.activeFilterValues` is keyed by field id
and nothing prunes it; the executor took the FIRST date-shaped value in insertion order. The rebuild
grid's Daily filter had moved from `Logged On` to `Date`:
```
activeFilterValues   Logged On = 2026-09-21   Date = 2026-09-27
the toolbar navigates            Date
$activeDate resolved to          2026-09-21   <- read out of the app's own var panel
```
So every date-dependent op on that grid computed against a date the user could not see or change.
`pickActivePeriod` asks the filter which field it navigates. **Measured across every grid: exactly
ONE resolves differently — the one whose field moved** — and that equality is the control test.

**THE PIPELINE, BUILT ENTIRELY BY CLICKING** (4 INIT_VARs → a loop over `$allInstances` → a 6-rule
IF with a nested OR group → `$acc +=` → an UPDATE), then six triggers, then watched:
```
Daily Coffee   20      8 + 12, on screen and stored in Mongo
untick the 9:00am drink's Completed    ->  8     the onChange trigger, from a real click
re-tick                                -> 20
```
`onAdd · Instance · Any · in Schedule` on the deployed build, `$activeDate` now `2026-09-27`.

**FOUR PROBE FAULTS, and TWO of them are ones this file already pinned as probe faults.**
```
the rule row has TWO identical "+ Pick path" placeholders — left and right (an
  empty right defaults to PATH mode). Addressing them globally put every picked
  LEFT path into the RIGHT side — which is EXACTLY what
  `conditionRuleSides.test.jsx` was written to pin as a probe fault, not a
  component bug. I walked into it anyway. Scope to the ROW, take its FIRST.
`__moduli_state__` carries `occurrences` as an ARRAY — there is no
  `occurrencesById`. Every read through that key returned undefined and printed
  as `stored: null`, and I reported "the write did not land" until MONGO said 20.
  helpers/CLAUDE.md records the identical trap for `viewsById`.
the loop body's footer renders BEFORE the top-level one, so the LAST "+ If" is
  the TOP-LEVEL one — the whole IF landed outside the loop. Scope to the loop.
the Completed control is a `button[role="switch"]` whose naming TITLE is on its
  WRAPPING div, so a filter on the button's own title finds nothing on a row
  that plainly shows a toggle.
```
***And a fifth that nearly became a false debris report:*** my own scan found *"20 occurrences
created today, parented but listed by nobody"*. All 20 are **board pages homed in FOLDERS**, which is
the designed shape — `checkGrid`'s **0 errors** was right and my ad-hoc heuristic was the exact trap
09-22 (2) warns about (*"a naive parentId-but-not-listed check would fire 240 times on poms grid"*).
**Debris: none.** 0 module-less occurrences, 0 dangling refs, integrity clean (its one warning is the
205 unbound fields the previous session created in bulk).

Client **5,112 pass / 0 fail** (the 2 worker errors are the documented `trackerValues` OOM family).
Every fix A/B'd with the mutation asserted to land: the old comparator catalog fails 3, the old unary
set 1, deriving the simple-filter order 1, `ConditionGroup`'s local literal 4 of 5, dropping Run now's
results 4 of 6, removing its confirm 2, re-hardcoding `onFilterChange` 1, hand-listing
`isAncestorScopable` 2, the `_boundFieldIds` entry 1, and the old `$activeDate` guess 2. **Reported
honestly: several cases pass in BOTH arms and are contract pins, not coverage** — including Run now's
"still records the run", which also asserts the apply and so is not an independent control. Four
client-only deploys, each with `deploy.sh` correctly reporting *"Server unchanged — NOT restarting"*,
and the served chunk sha256-identical to the local build with the feature present beside a non-zero
control and a nonsense string at 0.

**Left for the next pass:** the stale `Logged On` value is inert now but still stored (pruning it is a
write to grid data, not a fix); `Grid: Snap Filter To Today` and the rest of poms' 74 operations are
unbuilt; fields stand at 205 created and unbound.

---

### 2026-09-28 (2) — THE WIRE STOPS REPEATING TWO CONSTANTS 25,525 TIMES; and the load is NOT bytes-bound

User's question, and it was the right instinct: *"for initial load. can we send like a lighter version
of those modules? like to ref for the operations and whats on the screen"*. Measured per KEY before
answering, which is what decided the shape:
```
DEFERRED artifact occurrences  17,160 rows  17.95MB
  meta              3.64MB 20%      fields            3.54MB 20%
  userId + gridId   1.24MB  7%   <- the SAME two strings, 17,160 times
  timestamp         0.67MB  4%   <- 0 client readers
  _id               0.57MB  3%   <- duplicates `id` (non-empty 17,160/17,160)
```
`server/utils/wireProjection.js` strips the dead keys and lifts the constants onto the envelope; the
client restores them at the socket boundary, so all 34 reader sites are untouched. **Verified on prod:
25,590 occurrences and 10,823 modules, 0 missing gridId, 0 missing userId, 0 rows still carrying
`timestamp`.** Payload **36.2MB -> 32.63MB (-10%)**.

**AND IT DID NOT MOVE THE WALL CLOCK, which is the finding.** Three runs before and after, same probe:
blocked time unchanged inside noise. Per chunk the effect is real but proportional and small —
`8.08MB/4,063ms -> 7.28MB/3,787ms`, `3.72/1,786 -> 3.27/1,482`, `3.93/1,900 -> 3.49/1,942`. So halving
a freeze needs halving the bytes, not trimming a tenth. **The load is not bytes-bound.** The remaining
7.2MB is artifact `fields`+`meta`, and those are NOT droppable: `Trackers: Media Owned` iterates
`$allItems` and reads `fields.<id>` + `meta.feedSourceId` — 61 of 84 enabled ops iterate a collection
that includes artifacts, and that one is the counter-example proving they are not inert.

**THE SINGLE WORST FREEZE IS NOT A CHUNK AT ALL, and it had never been isolated:**
```
at  2,632ms  froze 7,501ms   <- the app's OWN BOOT, before the first frame arrives at 4,162ms
at 17,135ms  froze 3,787ms   <- chunk 2
```
The 15MB `full_state` now lands DURING boot and merges into the same uninterrupted block. Different
problem from the catalogue, and the bigger one.

**RETRACTED BEFORE IT WAS BUILT: "dispatch the deferred half once, not per chunk" ALREADY SHIPPED**
(`bcd57ee4`) — the chunks are held and dispatched together with a fail-open fallback. Reading the code
is what stopped me re-implementing it; it also reframes each chunk's freeze as arrive+parse, which is
what made the byte measurement worth making even though it came back negative.

**A REGRESSION I INTRODUCED, AND THEN DISPROVED MY OWN FIX FOR.** The first `rehydrateWireRows` spread
a fresh object per row — 25,590 clones on the main thread inside the socket handler. Making it assign
IN PLACE changed **nothing measurable**, so the clone was not the cause and this says so rather than
claiming the fix. The in-place version is kept because it is strictly cheaper, not because it helped.

**THE GUARD EARNED ITS KEEP TWICE, and both were my own greps being too narrow.** The omit list is a
fact about the CLIENT, so it can only be a named list; `wireProjection.test.js` WALKS the client for a
reader of every omitted key.
- **`updatedAt` nearly shipped as dead weight.** A grep for `occurrence.updatedAt` read ZERO. The real
  readers address it differently and one is load-bearing: `localPrev?.updatedAt` — the **stale-write
  conflict guard** — plus `occ?.updatedAt || mod?.updatedAt` and `occ?.updatedAt || occ?.createdAt`.
- It then caught `ctxGrid?._id` / `gridNow?._id` that a `head -12` had truncated away, and
  `normalizeId`, whose `_id` read is a fallback behind `id`.
Its CONTROL asserts the detector still finds `updatedAt`/`createdAt`, or "zero readers" is equally
satisfied by a detector matching nothing. A/B'd with a planted `occ._id + occ.timestamp`: both fail.

*The reusable rule: a grep shaped like the name you expected is a claim about your expectation.*

Server 2,782 pass · client 5,183 pass. Deployed with a restart (server code).

---

### 2026-09-28 (3) — THE BOOT BLOCK, MEASURED: not the bundle, not the log, not the catalogue

Following (2)'s finding that the single worst freeze is the app's own boot (7.5-8.2s at t~2.5s,
before the first payload frame). Profiled at 390x844 / 4x throttle, prod, poms grid.

**THE CPU PROFILER CALLS IT `(program)` — 5,900ms — SO THE TRACE TIMELINE IS THE INSTRUMENT.**
```
EvaluateScript        2ms     <- the BUNDLE IS NOT THE COST. Rules out code-splitting.
RunTask   4,209ms at +3,221ms <- the full_state message: JSON.parse 15MB + onFullState + reducer
FunctionCall react 2,314ms    <- first render
FunctionCall react 1,053ms    <- second render
UpdateLayoutTree      1,370ms
```
So boot = **one 15MB message + the first render of the whole grid**. That is the 2026-08-06 staged
-loading finding from a new direction ("rendering the content tree costs ~1265ms, ~6000ms at 4x").

**A NEGATIVE RESULT WORTH MORE THAN A FIX: `onFullState` reads 1,538ms of SELF time, and it is my
instrument.** 98% self with no JS child is the signature of a native call, and it is
`console.log("[socket] full_state received:", payload)` — logging the whole 15MB object. Wrapping
`console.log` at init (no app change) prices it at **1,451-1,696ms across 3 calls**. But muting it
moves NO milestone, over four interleaved runs:
```
logging ON     rows +10,318ms · thread quiet after 38,570ms
logging MUTED  rows +10,639ms · thread quiet after 38,877ms
logging ON     rows +10,152ms · thread quiet after 38,552ms
logging MUTED  rows +10,098ms · thread quiet after 38,559ms
```
**It is CDP serializing the console argument — a cost a real device with no inspector never pays.**
Reporting it as a 1.5s win would have been a fix for the probe. *A profiler frame is part of the
measurement apparatus until an A/B says otherwise.*

**AND THE FIRST METRIC WAS WRONG IN A WAY WORTH NAMING.** "Blocked ms in a fixed window" could not
show the difference either way (12,120 vs 12,328ms) because a 14s window is **saturated**: removing
work does not shorten the block, it lets more of the backlog run inside it. The honest metrics are
MILESTONES — time to rows on screen, and time until the thread goes quiet.

**WHAT THIS RETIRES:** the tail-pass idea from (2) (ship artifact `fields`+`meta` behind the
skeleton) would not touch boot at all — artifacts are already in the DEFERRED half. It shrinks the
1.5-3.8s chunk freezes only. Boot's 15.22MB is the CORE half (8,430 occurrences + 5,917 modules;
`fields` 2.38MB, `textmap` 1.38MB), and deferring textmaps was already tried and reverted
(2026-04-11).

**Current state, for the next pass:** rows on screen **+10.2s**, thread not quiet until **~38.5s**.
The remaining weight is compute, not payload: op sweep 4.5s, effect application 2.1s,
FieldRenderer/`resolveOptions` 1.9s (the documented 2026-08-07 hotspot), first render ~3.4s + 1.4s
layout.

---

### 2026-09-28 — MOBILE SCROLL: the op table named a different culprit every run, because it was measuring WHEN

User: *"could you pause on this and switch over to looking at mobile scroll. its laggy as hell (tested
on routines), and paint lags as well on it (bunch of empty containers for a hot second and then loads
the records)."* Measured at 390x844 with 4x CPU throttle, against poms grid on prod.

**STEADY-STATE SCROLL IS FINE, AND THAT IS WHAT NARROWED IT.** Nine interleaved arms (no-shadow,
no-marquee, no-skip, no-radius, no-filter, no-transition, no-bg-image, plus a NULL arm) **all read
16.6ms** — 60fps — as did a second baseline pass. Only the FIRST scroll is slow, and a cold first
scroll creates nothing (editors 0->0, rows 176->176, heap flat). So it is not paint, not CSS, and not
mounting: the thread is simply busy.

**THE FIX THAT SHIPPED: `occOverlay.merged` was copying the whole grid, once per write.**
```
merged (self)                    2,442ms   ~57 rebuilds of a 25,525-key object
applyOperationEffect (incl)      4,444ms -> 2,063ms after
```
The local map ALREADY covers the base on the load sweep — `runLoadSweep` fills its own
`occurrencesById` and calls `setLocalOcc` for the SAME rows in the SAME pass — so the merge IS the
local map and there is nothing to copy, exactly as `merged(null)` already concludes on every other
path. **Coverage cannot be lost** (`set` only adds; `drop` removes while recording a tombstone whose
job is to hide the base copy too), so it is probed once per base identity, not per call. Full
reasoning + the A/B in `client/src/helpers/CLAUDE.md`.

**AND THE MEASUREMENT THAT MATTERED MOST WAS THE ONE THAT SAID MY ATTRIBUTION WAS WRONG.**
`[op-timing]` reported one op at 3.6-4.1s on every load — **a DIFFERENT op each run**:
```
run 1   3849ms  0fx  Schedule: Place Weekday Tasks     run 3   4129ms  0fx  Schedule: Fill Day
run 2   3615ms  1fx  Cash Balance                      run 4   3709ms  1fx  Completion Rate
```
Three of the four produce ZERO effects. That is not an op being slow, and chasing the named op (I had
already sized its loop: 2,897 instances walked for the 16 rows carrying a Weekday value) would have
been chasing a coincidence. Correlating rAF gaps against websocket frames says what it really is:
```
+4,095ms   16.53MB  full_state        ->  froze 2,614ms
+17,831ms   8.08MB  full_state_rest   ->  froze 4,063ms   <- "the 4s op"
+21,299ms   3.72MB  full_state_rest   ->  froze 1,786ms
+23,157ms   3.93MB  full_state_rest   ->  froze 1,900ms
+30,035ms   3.37MB  full_state_rest   ->  froze 1,534ms
```
**~36MB of JSON in six messages, each freezing the main thread 1-4s.** The sweep is SLICED and
interleaved with those arrivals, so whichever op is mid-slice when a chunk lands is charged the
parse. *An attribution table that names a different culprit every run is measuring WHEN, not WHAT.*
End to end: **30,207ms blocked, worst gap 4,311ms, thread not quiet until ~48s** (3 runs, medians).

**REPORTED, NOT FIXED — the payload is the dominant cost and both remedies are design calls.**
`server/socketHandlers/state.js` sends the deferred half at `CHUNK = 4000`, and chunk 1 carries EVERY
deferred module (why it is 8.1MB and the worst freeze). Smaller chunks shorten each freeze but
MULTIPLY the reducer's **O(total)-per-chunk** work — `FULL_STATE_REST` rebuilds a 25k-row `Set` and
copies the whole occurrences array on every chunk, and `App.jsx` re-derives `occurrencesById` off it.
Sending less needs the 19 ops that walk `$allItems` audited one by one, which `splitFullState.js`
already names as "a separate, larger piece of work". Either is a server change plus a restart on the
user's live grid, so it is theirs to pick.

**Probe fault, and it cost a run:** a 120s timeout read as a performance problem; the auth token had
expired and the page was showing Login. Mint a fresh one (`_mkauth.mjs`) before believing a slow load.
Also: interleaved arms cannot see a first-scroll-only cost — the first arm absorbs the one-time work
and every later arm reads identical.

### 2026-09-27 — REBUILD-VIA-UI: EVERY BOARDS AREA BUILT; and the options editor accepted duplicates

Continuing *"keep going testing the ui by recreating poms grid"*. The Social recipe is now GENERIC:
`_ph1…_ph4.mjs` + `_area.sh` (repo root, gitignored) take one `SPEC` env —
`{ area, boards: { Page: [category, [rows]] } }` — and build an area end to end by clicking:
options → folder under Boards → board pages → a container per page → rows, each tagged. Read back
with `server/_verify.mjs` (AREA=…), which checks each row is VALUED, not just bound.
```
Money 13/13 · Creative 9/9 · Body 7/7 · Media 12/12 · Food 17/17 valued   (+ Home 9/9 on 09-26)
rebuild: 51 pages · 71 containers · integrity clean     poms: 164 pages · 304 fields · 88 ops
```
**APP DEFECT, FIXED: the manual options editor appended ANY value**, so re-adding `movie` gave Board
Category two `movie` options. `SelectOptionsSourceEditor.addManualOption` refuses a value already
there (case/space-insensitive) and says so. The four duplicates were removed through the editor's ✕.

**PROBE FAULTS, each cost a run — all in tree/editor lookups:**
- Past ~30 options the editor's **Save sits below the fold**; clicking its reported box saved nothing
  (Creative's first run tagged 0 of 9). Scroll in + hit-test.
- A **clipped tree row** (Media, far down) — the right-click landed on the PANEL's menu.
- **Existence read from a collapsed tree** reads as "absent" → a second Media folder was minted
  (deleted through the tree). Step 2 now asks the app's STATE.
- **A folder and a page share a name** (root "Food" page vs Boards/Food folder): the page row got the
  right-click. Folder rows carry `data-drop-target-for-element`; page rows do not.

**Left, by the agreed scope (structure + samples):** Library/Projects pages outside Boards, and the
big one — **fields (14 of 304) and operations (4 of 88)**.

---

### 2026-09-26 — people board, birthdays, radial menu, and why day columns kept getting unlinked

- **Deleting a person froze the tab ~17s and reloaded every photo — three causes.** (1) The on-load
  `SCROLL_TO` poll called `jumpToOccurrence` 24×; each miss fired render-all, so with the Schedule
  closed the 1,202-row People board was fully mounted (~194k nodes). `expandWindows:false` for it.
  (2) Rows re-rendered on any sibling change (memo compared `containerOccurrence` by identity) —
  `rowPropsEqual`. (3) The tab then dropped its socket with **"parse error"**: `txRecorder.snapshotDoc`
  structuredClone'd subdoc ObjectIds into `{buffer}` → a BINARY `transaction_created`. Now hex strings.
  Found with two new diagnostics, kept: server logs the disconnect reason; the client reports its own
  reason + last 5 emits after reconnecting (`📉 [socket] reconnected after …`).
- **Day columns unlinked from the Schedule.** Found-but-unlisted is permanent: the build finds a column
  via `_ancestors` (which falls back to parentId), so it never recreates or relists it. `0369` makes
  Build Schedule `ADD_CHILD` its column every run (as 0350 did for the Day Page). And child-list writes
  can now carry `occurrencesBase` → server `mergeChildListWithBase` applies only that writer's
  removals/additions (stale whole-array writes erased columns other tabs/ops had just added). A single
  field write sends only `{id, fields}`. The base is EXPLICIT per caller — ADD_CHILD/REMOVE_CHILD mutate
  the local copy before emitting, so an inferred base would turn every removal into a no-op.
- **People:** 0365 one Birthday field (year-less = 1900, rendered without a year); 0366 merged 11 groups
  of duplicates (references repointed); 0368 97 handle-names → real names (hand-written list, outside
  git); 0370 appointments get a People field. **0367 "People: Birthdays"** — a "Birthday - Full Name -
  turns N" card in each Schedule day's Todo, re-run on People board changes, stale cards swept.
- **Radial menu:** no cycles (drag mode / position / wrap are submenus with the current one marked),
  like-minded items share a submenu (`groupItems`), no 5s auto-close, portal stops event bubbling.
- **Other:** a picked occurrence past a dropdown's 100-option window still shows (`withSelectedOptions`);
  a "go to" segment on occurrence picks; a toolbar filter change carries down to pages that pinned their
  own value (`helpers/filterFollow.js`, pages only — day columns keep their structural date).
- **Rebuild-via-UI:** Home built (Areas/Equipment/Plants, 9 rows, all tagged). Left: Creative, Money,
  Body, Food, Media.

---

### 2026-09-24 (2) — REAL INVITES TITLED "[object Object]"; and the phone read a mosaic by stale placements

From the user's own tests on devices. Merged as PR #7; **not deployed from here** (the cloud session has
no SSH) — the calendar fix is SERVER code, so it needs `./deploy.sh` and its restart.
- **Invite titles.** Clinic invites write `SUMMARY;LANGUAGE=en-US:…`; node-ical returns a property with
  parameters as `{ params, val }`, and `String()` on it gave `[object Object]`. `icsImport.icsText` reads
  `val` (summary, location, description). Every earlier fixture had a bare `SUMMARY:` — *a fixture you
  wrote cannot carry the parameter a real sender adds.*
- **Schedule Type (data, poms).** The calendar rule attached the field with no value. There was no generic
  row, so `Appointment` was added to Schedule Types (tagged `appointment` like its siblings) and the rule's
  CREATE sets it; the three test rows were patched. Their labels heal when each invite is re-shared after
  the deploy (`ics:<UID>` updates in place). **Confirmed from the stored files** (each shared .ics is kept
  as an artifact, linked from `shareLog[].fileOccurrenceId`): every one has `DTEND == DTSTART`. Such an
  event now stores **no** duration (null, not 0); the Schedule places both in the start slot. The three
  rows were then repaired directly — real titles on module AND occurrence label (the occurrence's
  `[object Object]` override outranked the module), Duration cleared — so no re-share is needed.
- **"No share grid is configured" on Windows.** `/share` now falls back to `fallbackGridId` (the grid the
  device last had open) after an explicit grid and the saved share grid; ownership still checked.
  `/me/share` takes the session JWT and the Imports tab has a "Shares land in" picker.
- **Phone swapped Schedule and Tasks on poms.** `MosaicMobileNav` navigated by `occurrence.placement`,
  which only the rows×cols editor writes — stale once a mosaic is rearranged (tree: D right, full height;
  placement: D below A). `bspTree.treeToCells` turns the tree into rows×cols; placements are the fallback.
- **Date nav on the phone** moved into the Filters popover (not removed — a phone once had no way to
  change the date).

---

### 2026-09-24 — SHARE → IMPORT ROUTING BUILT (Plans 1–3); and poms' Schedule vanished because a tab was on another grid

Share routing, all three plans (`docs/superpowers/plans/2026-09-23-share-import-routing-*.md`, each with
a progress table of where the code departs from the plan). Worked from the Claude app, merged via PRs #1–#4,
the rest on #5. **Browser extension clips verified on prod** (page/selection/link/image into test grid 2's
Files; a re-clip left one row). Everything else — the Imports tab, file shares, calendar invites, the phone
and Windows share target — is tested but **not yet exercised on prod or a device.**

**THE INCIDENT, and the defect under it.** The user switched a tab to test grid 2 (to look at clips).
Every write is broadcast to ALL of a user's tabs (09-22 (5)), so that tab held poms pages, and its
load-time date ops rewrote their `filterOverride`. `update_occurrence` resolved `prev` from the ACTIVE
grid's cache, missed, and fell back to `socket.data.activeGridId`:
```
poms Schedule / Trackers / Day Page / a Sep 24 day column   gridId -> test grid 2   12:04:02–05 UTC
```
They vanished from poms. Switching back re-stamped them — but wrote each into poms' warm cache as a
PARTIAL row: **the Day Page as 5 fields, no module**, so it still rendered nothing. Mongo was intact
throughout. Repaired by a no-op REST PATCH (which mirrors the full doc into the cache); the Day Page build
had meanwhile minted a second Sep 24 column, and the unlisted original (template scaffolding, no writing)
was removed with a backup. **Fix:** a row the active cache does not hold is looked up in Mongo and written
against ITS grid (`updateKeepsRowGrid.test.js`, 4 fail without it). **Still open:** the user-room broadcast
itself — the fix makes those foreign writes harmless, it does not stop them.

**Found on the way, fixed:** `GET /operations` and `PATCH /operations/:id` returned webhook secrets in plain
text; REST writes to operations/folders/views/manifests never reached the warm cache (an API-made rule ran
but was invisible in the tab until a restart); a CREATE built in the operations editor
(`name/parent/role/kind`) did nothing on the server executor (it read `label/parentId/…`); an image clip of
a `data:` URL collapsed every such clip onto one identity; the extension's notification icon never existed,
so no clip outcome was ever shown; Firefox loads only `manifest.json` (the separate Firefox manifest never
worked).

---

### 2026-09-23 (7) — SOCIAL, BY CLICKING; and a card's top strip is not its click target

Rebuild-via-UI, next area **Social**, built the same way as Mind and against the
same recipe. Six board pages (`Wins · Gratitude Log · Leisure · Locations ·
People · Events`) under `Boards/Social`, their containers and 22 rows.

**THE RECIPE HELD, AND THAT IS THE POINT.** Everything (6) learned applied
unchanged: the six new `Board Category` options added through the Fields tab
(10 -> 16); the folder minted at root, renamed by double-click and DRAGGED into
`Boards`; the field picker LEFT ALONE so each row inherits its siblings'
bindings; the option scrolled into view before the click. **22/22 bound and
22/22 valued**, integrity clean.

**THREE NEW PROBE FAULTS, and the first is a real property of the UI.**

**1 — A CARD'S TOP STRIP IS NOT ITS DRILLDOWN TARGET.** `_ui.mjs openCard` clicked
`r.y + 10`, and every Social page sat empty for four minutes while the build
"ran". Measured by trying three points on the same card:
```
click top (y+10)   header stays "Social"   <- does nothing
click mid          header becomes "Wins"   <- opens
```
A card's top band is its DATE PILL, and on a card whose page is still empty that
pill is most of what is rendered — so the click lands on chrome. The Mind cards
only worked because their pages already had content by the time they were
reopened. Fixed in `_ui.mjs` for every future probe: click the CENTRE.

**2 — THE TREE CHEVRON TOGGLES, so expanding an already-open tree COLLAPSES it**
and every later row lookup reads as "the folder is not there". The Mind run
survived only because the tree happened to start collapsed. The helper now
expands *only what is missing* (`ensureVisible`).

**3 — AND I TURNED A VALUE OFF WHILE TRYING TO SET IT.** The last untagged row
read `null` in Mongo, so I clicked its option — and the chip had ALREADY said
`place`:
```
chip before my click   "Board Category:|place"    <- the sweep had set it
after                  "Board Category:|—"        <- a multiSelect option TOGGLES
```
My Mongo read was simply older than the screen. *Read the control before acting on
a stale snapshot of the data behind it* — the probe now checks the chip's own text
and only clicks when the value is absent.

**A FOLDER PAGE WITH NO CARDS HAS NOTHING TO ANCHOR A MENU ON.** The page-creation
script drives `New * page` from an EXISTING card's context menu, so the first page
of a new folder has to come from the TREE (`folder row -> New page… -> Board page`).
Mind hid this because its seed page was created in an earlier step.

**THE SOCIAL AREA, READ BACK OUT OF MONGO:**
```
Boards/Social   6 board pages · 6 containers · 22 rows · 22/22 bound · 22/22 valued
Wins win · Gratitude Log gratitude · Leisure leisure · Locations place ·
People person · Events event
```
Rebuild grid **360 -> 395 occurrences · 29 -> 36 pages · 42 -> 48 containers ·
58 -> 80 instances**, integrity **clean**. Two areas done of the ~50-page target;
**no code changed** — `_ui.mjs` is probe tooling, not the app.

---

### 2026-09-23 (6) — THE MIND AREA, BY CLICKING; and the picker that pre-ticks was never a bug

Rebuild-via-UI, next area **Mind** — the first of the areas the coverage report
named. Eight board pages (`Verses · Practices · Topics · Skills · Ideas ·
Courses · Readings · Prompts`), their containers and their rows, every one
created through the app.

**AND THE COVERAGE NUMBER WAS WRONG, WHICH IS THE FIRST THING TO FIX.** Entry (3)
reported *"180 of 197 distinct poms page names have no counterpart"* and read
that as the work remaining. Broken down by FOLDER rather than counted, most of it
is explicitly out of the agreed scope:
```
Root/Documents/Codex (+ its 8 subfolders)   84   imported documents
display pages (bookmarks, articles)         21   importer output
Root/Boards/* · Library · Projects         ~50   the STRUCTURE — the actual scope
```
So the honest target is **~50 pages, not 180** — the rest came from uploads and
importers, which the scope decision already excluded. Mind is 8 of that 50.

**THE OPTIONS CAME FIRST, through the Fields tab's manual options editor** — the
rebuild grid offered `meal · ingredient`, poms has 48. The eight Mind values were
typed into `Add option (Enter)` and saved, read back out of state AND Mongo. That
is what makes a Mind board a materialized view over its tag rather than a list of
names.

**A SUBFOLDER CANNOT BE CREATED IN PLACE — reported, not fixed.** `Mind` belongs
under `Boards`, and the tree offers no way to put it there directly:
```
the folder's own right-click   New page… · Open folder page · Rename ·
                               Set cover… · Delete folder      <- no "New folder"
the tree header's + button     handleCreateFolder, which HARDCODES
                               parentId: manifest.rootFolderId
```
Every folder is therefore born at the root. The workaround is the designed one and
it works — create at root, rename by double-click (the 09-22 (9) empty-folder fix),
then DRAG the row onto `Boards` (`Mind parent = Boards`, read back). On a grid whose
target is poms' four-deep folder tree that is a per-folder detour.

---

**THE HEADLINE IS A RETRACTION OF MY OWN: THE FIELD PICKER PRE-TICKS, AND THAT IS
A FEATURE.** A row is `+ → Item → (pick fields) → Create`, and only the FIRST row
of each page came out carrying `Board Category`; 24 rows had no chip at all. I
chased it as a scroll-timing fault, shipped that, and **it changed nothing.**

What the DOM said, once I read the picker's own header instead of my assumption:
```
first Item    "Pick fields to attach to the new instance (0 selected)"
every later   "Pick fields to attach to the new instance (1 selected)"  <- already ticked
```
`QuickAddMenu` says why in its own comment — `siblingFieldBindings` pre-ticks
whatever the row's SIBLINGS already bind, *"so the common case is one Enter and
the uncommon case is unticking."* **My probe clicked `Board Category`
unconditionally, so from row two onward it was UN-TICKING it.** The app was right;
every row would have been bound had I done nothing. The probe reads the
`(N selected)` count now and only clicks when it is 0.

*A plausible fix that moves no number is evidence you have the wrong cause* — and
this log's most-repeated shape, paid again: a mystery is a strong hint that
something you believe is broken is not.

**THE REPAIR IS THE SAME GESTURE DONE RIGHT:** each unbound row deleted through its
radial and re-added through the container's `+` with the picker left ALONE, then
tagged with its board's value. The rows carried nothing but a label, so nothing was
lost.

**AND THE LAST TEN VALUES FAILED FOR A DIFFERENT REASON, which the probe's own log
named rather than my guessing.** Five boards tagged; `Courses · Readings · Prompts`
reported `0/N` with **no "unhittable" line** — so the chip opened and the OPTION was
not reachable. Those three values are the LAST THREE of ten in the list, below the
popover's fold: `getBoundingClientRect` still reports a box, `elementFromPoint`
returns whatever is on top, and the click silently misses. Scroll the option in,
then measure:
```
before   Courses 0/3 · Readings 0/4 · Prompts 0/3
after    Courses 3/3 · Readings 4/4 · Prompts 3/3
```
*The clipped-element trap this file records for dropdown rows and day-page cards,
one layer further in — inside a portalled popover's own scroller.*

**THE MIND AREA, READ BACK OUT OF MONGO:**
```
Boards/Mind   8 board pages · 8 containers · 29 rows
bound to Board Category   29/29        valued   29/29
Verses verse · Practices practice · Topics topic · Skills skill · Ideas idea ·
Courses course · Readings reading · Prompts prompt
```
Rebuild grid **314 -> 360 occurrences · 20 -> 29 pages · 34 -> 42 containers ·
29 -> 58 instances**, integrity **clean**. poms unchanged at its 2 pre-existing
errors. **No code changed this session** — it is all data, built by clicking.

**ONE STALE SIGNAL NEARLY BECAME A DEFECT REPORT.** prod's error log ends with five
`ENOENT: /var/www/moduli/client/dist/index.html` stacks. The mtime settles it:
```
error log last write   17:56:59 UTC
dist/index.html        written 23:07 UTC   <- a LATER deploy
https://viafluere.com/ 200
```
Stale, from a window mid-deploy. *Check a log's mtime against the deploy before
reading its tail as current* — the discipline 2026-09-18 (5) used on the
`io is not defined` stacks.

**FOUND ON POMS, NOT TOUCHED:** today's 5 PM alarm minted its Schedule instance
(`⏰ 5 PM · Date 2026-09-23 · Time Slot 5:00pm`) with `parentId` naming today's
5:00pm slot, and **the slot does not list it**:
```
alarm:* rows 11 · listed 10 · UNLISTED 1     <- today's
the slot   lists 3 children · includes it FALSE · listed by 0
```
Same created-but-never-listed class as the day columns, on the alarm→schedule
path — and one `adoptableHolders` cannot reach, because no rebuild ever retries
that create, so nothing is refused and nothing is adopted. Almost certainly one of
my own probe tabs firing the alarm and closing mid-burst (the documented
create/disconnect asymmetry). It holds no writing; the repair is one
`link_occurrence_to_parent` and is the user's call.

**AND A SHELL TRAP THAT COST THREE SHELLS:** `pkill -f "<script>"` matches the
command line of the shell RUNNING it, so it kills its own parent. Use a
self-excluding pattern — `pgrep -f "node _mind[X].mjs"` — and kill by PID.

---

### 2026-09-23 (5) — THE EMPLOYER IS DATA NOW; and a PAGE could not be renamed from the UI at all

Four decisions, answered by the user and then built by clicking. The two that
produced code are the two the UI could not do.

**A PAGE HAD NO RENAME.** Carrying out *"rename the Appointments page to Schedule
Types"*, the CONTAINER renamed the way every container does — double-click its
header label. The PAGE had nothing:
```
double-click the page header   nothing opens
the page header's radial       "Settings" is the PANEL's  (BOTH handles in
                               .page-header resolve to it — measured)
right-click its card           New * page · Set cover image… · Delete
  hit-tested on the TITLE,     ^ no Rename
  so not a missed click
```
Only a FOLDER page could ever change name, and only by following its folder
(`planFolderPageRename`). **214 pages on this grid were stuck with the name they
were created with.** `modules/pageCardRename.js` puts it on the card's context
menu — the one surface that already treats a page as an object — and writes
through `CommitHelpers.updateModule({ label })`, the SAME call a container's
inline rename makes. The MODULE's label, not the occurrence's: `occurrence.label`
overrides one PLACEMENT, and a page's name is a property of the page. **Then used
it for the thing that surfaced it:** page and container both read `Schedule Types`.

**AND THE SAME TILE READ THREE WAYS.** User: *"it should use quick add, not a
dedicated add container button"* — and every affordance on a board page ALREADY
was QuickAddMenu (three of them: header + two insert gaps, all `.quick-add-btn`,
all titled "Add container"). What differed was the WORDING, which is also what
made my own probe fall through and click a different trigger:
```
from a CONTAINER   Board container · Doc container · Table container
from a PAGE        Board · Document · Canvas · Table
from a PANEL       Board · Document · Canvas · Table · Folder
```
The disambiguation existed — scoped to `targetRole:"instance"`, on the reasoning
that a container's menu is the only AMBIGUOUS one. Sound about the menu, wrong
about the person: *a palette is learned once, not once per surface.* A tile is
named for what it CREATES now. Only the label moved — `tileKindsForRole`'s own
comment records that a `page-folder` KIND persists as an invalid kind, and that
hazard is about the value. **The test that pinned the short labels is INVERTED
with its old reasoning kept.** Verified on prod: the page's menu reads
`Board container · Doc container · Canvas container · Table container`.

---

**THE EMPLOYER IS A FIELD NOW, and the user's correction is what shaped it.** I
first built `Mr Brews Taphouse` as a row on the schedule-types board. *"mr brews
taphouse should not be an appointment type, the appointment type is employment
and mr brews taphouse is one of the employments"* — two levels, not one:
```
Schedule Type   Doctor · Dentist · … · Employment    the TYPE (the op's gate)
Job             Mr Brews Taphouse                    WHICH employer, multiSelect
```
Built end to end by clicking: `Boards › Money › Employers › Employers` (board +
container), `Mr Brews Taphouse` tagged `Board Category: employment`, and a `Job`
field — occurrence, multiSelect, bound to **Work only**, as asked. The example
shift now reads
`Work · Employment · Sep 23 · 3:00pm · 6h 30m · Job: Mr Brews Taphouse`
and is still placed in all 13 slots. **The operation was not touched**, per
*"it shouldnt do anything else but that"* — it gates on BINDING Schedule Type,
whatever the value, so Work was eligible the moment it bound the field.

**THE PREDICATE IS `parentId IS <the Employers container>`, AND THAT IS A
WORKAROUND, NOT A PREFERENCE.** The convention on this grid is Board Category,
and I could not author it: **drilling `fields` in the find-predicate's record
picker returns "Nothing to drill into here."** The rule the board's own field
carries (`fields.<Board Category>.value CONTAINS appointment`) RENDERS correctly
and cannot be BUILT — every such predicate on this grid was written by a seed.
`fieldsMapItems(ctx)` reads `ctx.fields`, and the same editor's chip-display list
(same `fieldsById`) is fully populated, so the maps are there and the drill still
comes back empty. **Reported, not fixed** — it is a picker bug, not a data one,
and `parentId IS <board>` is exactly as correct for "the options are this board's
rows" (preview: **1 match**).

**`Day Page: Build` NOW LISTS ITS COLUMN FROM BOTH BRANCHES** (`0350`, the user's
pick). It finds a column by `parentId`, so unlike the Schedule build it DOES see
an unlisted one — and merged into it without ever listing it, leaving it
invisible for good. Moving the `ADD_CHILD` below the if/else makes both paths
run it; it is idempotent, so the create path is unchanged and healthy columns are
untouched. Dry run named exactly the intended move, applied and read back, and
the structure is confirmed in Mongo:
```
if  then APPLY_TEMPLATE(create) · FIND   else APPLY_TEMPLATE(merge)
ADD_CHILD parent=8gpoqzx32h7 child=$colId    <- below the branch, both paths
ADD_CHILD parent=$colId child=<the wheel>    <- untouched, and it is the control
```
**NOT OBSERVED HEALING THE LIVE ROW, and that is the honest gap.** The op runs
over `$activePeriodDates`, so reaching 2026-08-26 means moving the grid's date —
and **`Grid: Snap Filter To Today` fires on every load** (measured, 0 effects,
so it did not undo my change either). My date probe therefore left the grid on a
multi-selection `[Aug 26, Aug 30]`; **restored to `Wed, Sep 23` through the
picker's own Today**, verified in Mongo. The Aug 26 column is empty scaffolding —
no text, no true fields — so nothing is lost while it waits for a real visit.

**PROBE FAULTS, five, and every one is a selector reading the DOM I imagined:**
```
the "+ Add" in a dropdown   an ICON-ONLY <Plus>; I scanned for a text "Add"
picker rows                 "parentId / string / Parent occurrence ID" — match
                            the FIRST LINE, never the whole innerText
an occurrence option        a rich card (label + chips + the ancestor chain I
                            shipped this morning) — first line again
the rule's VALUE box        defaults to PATH mode: a picker, no input. There is
                            a path/text toggle. "No input" is a mode.
a settings TAB              needed a REAL mouse press; the synthetic .click()
                            left the panel on the previous tab
```
Debris: none. Grid integrity is its two pre-existing errors, and poms'
module-less occurrences still read **17, all dated 2026-09-22, 0 from today**.

---

### 2026-09-23 (4) — RETRACTION: ALL THREE "GAPS" I REPORTED WERE MY PROBE; and the drop highlights are watched working

User: *"fix those things and let me know if you finished those other requests along with the
highlights."* **There was nothing to fix. Every one of the three defects entry (3) reported is
withdrawn, and the evidence is the app doing the thing I said it could not.**

```
reported                                          actual
"+ Add new never renders"                         it does — the add control is an ICON-ONLY
                                                  <Plus> button beside a "Search or add…" box.
                                                  My scan looked for a TEXT-labelled Add.
"a UI-created board row gets no Board Category"   the DESIGNED path stamps it: adding through
                                                  the dropdown minted `ZZ Probe Type` with
                                                  BC ["appointment"] already on it.
"the search finds a row and does not navigate"    it navigates. The row fires on MOUSEDOWN
                                                  (`onMouseDown` + preventDefault, so the search
                                                  input does not blur first) and my probe used
                                                  synthetic el.click(), which never dispatches
                                                  one. A real press: Appointments -> Routines.
```
***Three reports, one root cause: I was asserting against the DOM I imagined instead of the one the
app builds.*** The icon-only-button trap is already written down in this file from the pomodoro work
(14) and from the radial arc (15). It cost a whole entry anyway.

**AND IT EXPLAINS THE ROW I COULD NOT ACCOUNT FOR.** Entry (3) records a `Mr Brews Taphouse` row
appearing with a uuid id and `BC ["appointment"]` already stamped, which I could not attribute. It
was the add-new flow working — one of my "failed" clicks had landed. *A mystery row is a strong hint
that something you believe is broken is not.*

---

**THE DROP HIGHLIGHTS ARE VERIFIED BY DRAGGING, which is what they never had.** They shipped earlier
today A/B'd against their tests and never watched. All three pieces, on poms' Routines page:
```
page-level insert gaps      187 on the page, one BEFORE the first container;
                            hovering one reveals exactly 1 line
container drag, IN THE GAP  #__moduli_insert_line  display:block  701x3px, no box
container drag, OVER a box  page line correctly NULL — it already defers
nested container dragged    Environmental [Cleaning, Chores, Upkeep, Container]
  OUT to page level         ->  top level [... Environmental, Container, Creative]
                            and it landed exactly where the line showed
```
The nested drag-out is the user's own bug report (*"i cant drag new containers outside of containers
in routine"*), and it was exercised on a THROWAWAY container created for the purpose, then removed —
their three real nested containers were never touched.

**AND I SHIPPED A FIX FOR A NON-PROBLEM, THEN REVERTED IT — recorded because the revert is the
lesson.** Mid-drag I measured **2 insertion lines** over a container against **1** for an instance
drag, concluded the new page line was stacking on `useDragDrop`'s closestEdge bars, wrote a guard,
tested it, deployed it. Then I measured again with the RIGHT element and the story collapsed:
```
the two lines      BOTH closestEdge bars — container:Environmental and container:Upkeep
                   (an outer box and the box nested inside it)
the page line      #__moduli_insert_line, which is NOT a .drop-indicator at all
                   and reads display:none over a container
```
So the code already deferred, my guard changed nothing observable, and — worse — it keyed on
`rawContainerEl`, which would have SUPPRESSED the gap line in exactly the place the user asked for
it. Reverted the same session. ***A fix that is inert is not harmless: this one was one measurement
away from removing the feature it claimed to protect.***
**Two nested containers each drawing an edge bar is pre-existing and is left alone** — an outer
container and an inner one are both real drop targets, and nothing in this week's work created it.

**THE SCAN THAT WAS WRONG THREE TIMES, stated so the next session stops paying for it:** the page
line is the singleton `#__moduli_insert_line` written by `showDropIndicators`; the per-container bars
are `.drop-indicator` from `useDragDrop`. They are different mechanisms and a probe that greps one
class reports the other as absent. *Ask which element DRAWS it before measuring whether it drew.*

**Debris: none.** The throwaway container was removed through the container radial's **Remove**
(which is a full delete here — 0 leftover modules read back out of Mongo), the probe option row was
deleted, and poms' module-less occurrences still read **17, all dated 2026-09-22, 0 from today**. The
`Work` template now carries `Schedule Type = Employment` so every shift dragged from the bank arrives
already typed.

---

### 2026-09-23 (3) — A WORK SHIFT REACHES THE SCHEDULE WITH NO CHANGE TO THE OPERATION; and the field editor had two data-loss defects

User: *"the occupational should have a container called employment, and inside should be an instance
that shows work … so I can start adding my work schedule to mr brews taphouse container in tasks
page (dragging work). so then i can add it to my opration that grabs appointments"*.

**THE OPERATION WAS NEVER EDITED, and reading it first is why.** `Schedule: Place Dated Work` does
not select rows by container or by label — it gates on a **field binding**:
```
$appt._boundFieldIds ARRAY_INCLUDES <Appointment Type>
AND Date SAME_DAY $day  AND Time Slot IS_NOT_EMPTY  AND meta.feedSourceId IS_EMPTY
  -> SLOTS_COVERED(Time Slot, Duration) -> ADD_CHILD into every covered slot
```
So anything that BINDS that field is eligible. The user's own answer — *"make it Schedule type and
have employment and appointment be the thing for it"* — turns that into a rename, and **a rename
keeps the field's id**, which is what the op gates on. Zero pipeline edits, and zero migration of
the 7 modules / 18 occurrences already binding it.

**AND THE USER CORRECTED MY MODEL, twice, which is the part worth keeping.** I first built
`Mr Brews Taphouse` as a row on the schedule-types board. *"mr brews taphouse should not be an
appointment type, the appointment type is employment and mr brews taphouse is one of the
employments"* — two levels, not one:
```
Schedule Type   Doctor · Dentist · … · Employment   <- the TYPE
the employer    Mr Brews Taphouse                   <- WHICH one
```
The row was renamed to **Employment**; the employer is expressed by the container the shift is
dragged into, which is exactly what the original message described.

**BUILT BY CLICKING, END TO END, and watched working on prod:**
```
Routines › Occupational › Employment › Work     binds Schedule Type · Date · Time Slot · Duration
drag (COPY mode, so the bank keeps its template) -> Tasks › Mr Brews Taphouse
set   Employment · Sep 23 · 3:00pm · 6h 30m
LOAD  Schedule: Place Dated Work runs
```
```
slots now listing the shift   13
3:00pm 3:30pm 4:00pm 4:30pm 5:00pm 5:30pm 6:00pm 6:30pm 7:00pm 7:30pm 8:00pm 8:30pm 9:00pm
```
3:00pm + 6h30m, to the slot. **`Duration: 6h 30m` on screen is this morning's `helpers/duration`
fix rendering its stored 390.**

---

**TWO DEFECTS IN THE FIELDS EDITOR, BOTH FOUND BY TRYING TO USE IT, AND BOTH WORSE THAN COSMETIC.**

**1 — OPENING AN OCCURRENCE FIELD WHITE-SCREENED THE WHOLE APP.** Clicking the `Appointment Type`
chip threw `ReferenceError: fieldType is not defined` and `document.getElementById("root")` measured
**0 bytes of HTML** afterwards. `FindBody` called `findValueDefaults(fieldType)` while `fieldType`
is a prop of the PARENT. **My probe reported it as "the Command Center closed"** — the `pageerror`
listener is the only reason it was not filed as a UI quirk.

**2 — THE EDITOR SHOWED AN EMPTY QUERY FOR 98 OF 107 FIELDS, AND SAVE WOULD HAVE WRITTEN IT.** With
the crash fixed, the Find editor rendered **no rule rows** and previewed **1548 matches** — the whole
instance pool — for a field whose predicate matches 9. Measured before fixing:
```
find-mode fields 107 · FLAT 98 · nested 9        poms 48/2 · test grid 2 41/2
```
`FindBody` read `source?.find`; the grid stores it FLAT. **`optionsResolver` has read both since
2026-05-17 (`src.find || src`) — only the editor was left behind**, and that same split is what hid
defect 1 (only the flat shape reaches the fallback that threw). It now writes back the SHAPE IT
READ: converting on save would silently rewrite 98 fields the first time anyone opened one.

***THE TWO ARE ONE STORY: the editor could not read the data the app actually stores, and the two
consequences were a white screen and a silent overwrite.*** Neither is reachable by a test that
builds its own fixture — the shapes only diverge in live data. 8 tests, A/B'd 5 of 8; the nested
cases pass in both arms and are the controls.

---

**THREE MORE GAPS, REPORTED NOT FIXED** — each blocked a step and each was worked around:
- **"+ Add new" never renders on the Schedule Type dropdown** although `optionsSource.addNew` is
  configured (`parentOccurrenceId`). Typing a new name reads *"No matches"* with no add row. The
  2026-07-25 entry says single-select occurrence fields were given this; it is not appearing.
- **A UI-created board row gets no Board Category**, so it is invisible to the very dropdown whose
  board it sits on. The rows that DO carry it were either seeded or minted by the add-new flow,
  which stamps the predicate's fields.
- **The occurrence search finds a row and does not navigate to it** — clicking the hit left the
  panel where it was. (Its ancestor chains render correctly, which is this morning's fix live.)

**PROBE FAULTS, and the first is the reusable one.** `scrollIntoView({block:"center"})` on a
container that is TALLER than the viewport puts its HEADER off-screen — the quick-add button
measured `y = -102` in a 1000px window and `elementFromPoint` returned **null**, which reads as
"the button is covered". *Scroll the header, not the container.* Also: `input[type=text]` does not
match an input with no `type` attribute (the field NAME box); the Command Center **drills down**, so
reopening it shows the last field's detail rather than the chip list and every later lookup fails;
and the `Date` chip carries **no `title`**, so a title-based finder misses a chip that is plainly on
screen.

**Debris: none.** The rows my wrong first model created were removed through the app's own radial
Delete, and the board reads exactly its 9 original types + `Employment`, with no duplicate listings.
All 17 module-less occurrences on poms date to **2026-09-22** — **0 from today**.

---

**THE REBUILD COVERAGE REPORT, re-measured rather than quoted:**
```
             poms   rebuild     gap   done
pages         214        20     194    9%
containers    857        34     823    4%
instances    1019        29     990    3%
fields        296        14     282    5%
operations     78         4      74    5%
occurrences 22484       314   22170    1%

180 of 197 distinct poms page names have no counterpart:
Mind · Money · Home · Social · Creative · Ingredients · Grocery List · Meals · Beverages ·
Supplements · Movements · Routes · Readings · Verses · Courses · Practices · Prompts · Topics ·
Skills · Ideas · Wish List · Savings Goals · Charities · Gift Ideas · Areas · Equipment · Plants ·
People · Locations · Events · Leisure · Gratitude Log · Wins · Projects · Mediums · Songs · …
```
Against the agreed scope (**structure + samples**, not the 3,558 artifacts / 1,464 bookmarks / 540
quotes / months of day columns) the honest read is **~5% done by structure**. The percentages are
not equally meaningful: `occurrences` at 1% is dominated by bulk content that is deliberately out of
scope, while **pages 9% / fields 5% / operations 5%** are the numbers that describe the work left.

---

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


