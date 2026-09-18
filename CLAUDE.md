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


