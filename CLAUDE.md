# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---

### 2026-08-08 (5) — measuring a "build this" task retired it AND found a live defect the queue never mentioned

Two queue items — "Build the artifact spread viewer" and "Media prefill Tasks 4-5" — turned out to
be **the same remaining work** (only one plan mentions `planMediaConversion`), and most of it was
already shipped. Measured the tree instead of the status lines, per that plan's own rule:

```
occurrenceMedia.js 154 lines · ArtifactSpread.jsx 159 · ArtifactSpreadHost.jsx 210
host mounted in App.jsx · 3 openArtifactSpread call sites in Field.jsx · 33 tests green
migration 0043-media-fields-to-artifacts.mjs  EXISTS, 11 tests, APPLIED to poms grid
```
**Task 4 was done and applied; the plan header already said so** (it had been corrected on
2026-08-07). That is the third status line in this repo wrong in this direction.

**BUT MEASURING DID NOT JUST RETIRE WORK — IT FOUND A LIVE DEFECT NOBODY HAD FILED.** `0043` had
only ever run against `poms grid`, and `primaryMediaOf` deliberately carries **no legacy-string
fallback** (its own header: *"a passthrough would render an unmigrated grid correctly and hide the
fact that it was never migrated"*). Every thumbnail site — Field's media pill, `resolveOccCard`,
`ModuleInstance`, `RepresentationView` — goes through it. So:

```
                             poms grid (migrated)     a FRESHLY SEEDED GRID
media values resolving            215 / 215                 0 / 187
Files field                       present                   MISSING
modules binding role:"files"      192                       0
```

**A fresh grid rendered NO posters, NO covers and NO avatars anywhere, and the artifact spread had
nothing to open.** Proven by driving the REAL `primaryMediaOf` over both grids' live data, not by
reading the seed.

**THE FIX IS THE SEED CALLING THE MIGRATION, not a second implementation.** `createLiveData.js` now
invokes `0043.up()` before its export. It is idempotent by construction — skips a value already
naming an artifact, set-unions the Files entry, binds only a module that lacks the binding — and it
creates the Files field when absent, which on a fresh grid it always is. **Because the seed IS the
migration, the two cannot drift**, which is the rule this repo keeps paying for when the halves are
written separately. Reseed: `0/187 → 187/187`, Files field created, 187 modules bound; poms grid
untouched at 215/215.

Server-only change, so **no deploy** (the same call `cc66d2cf` made). 601 server tests; poms grid
and test grid 2 at 0 integrity errors.

**The lesson, and it is the opposite of the usual one:** the standing rule is *measure before
building, because the premise may be stale*. Here the premise was stale AND the measurement exposed
something worse than the task described. **Retiring a task is not the end of the measurement — ask
what the same probe says about the surfaces the task did not name.**

---

### 2026-08-08 (4) — feeds get OR and NESTED GROUPS, and the evaluator already knew how

User picked the faithful option over the cheap one: **one Completed container holding both kinds**,
not a second container. Shipped `feed.conditionOperator` + nested condition groups, migration `0060`,
the seed half, and a recursive editor. **Deployed and verified**; poms grid at 0 errors.

**THE EVALUATOR WAS NEVER THE GAP, and finding that out is what kept this small.**
`evalGroupAgainstRecord` has handled AND/OR and arbitrary nesting since 2026-05-03, and detects a
sub-group by `Array.isArray(entry.rules)`. What was missing was a feed SHAPE that could express one —
so the work is a translator (`helpers/feedPredicate.js`, pure, 13 tests) plus an editor, and
`resolveFeedItems` got *shorter*: its hand-rolled rule loop became one `evalGroupAgainstRecord` call.

```
feed.conditionOperator : "AND" | "OR"        ABSENT MEANS AND
Entry = { id, fieldId, comparator, value }         // leaf
      | { id, operator, conditions: Entry[] }      // group
```
A group is recognised by carrying `conditions`, so a leaf can never be mistaken for one; the OUTPUT
uses `rules`, because that is the key the evaluator looks for.

**BACK-COMPAT WAS THE ENTIRE RISK AND IS PROVEN RATHER THAN ARGUED.** 77 enabled feeds across three
grids, all flat AND lists. Drove the REAL resolver over LIVE data on both code versions —
**77 feeds, 208 rows, byte-identical**. (Same probe as (3); it paid for itself twice.)

**THREE DROP RULES, each reproducing the old inline loop, each with a reason it matters:**
- a leaf with no `fieldId` stays inert — `+ condition` mints exactly that, so a half-configured row
  must not empty the feed;
- **a group with no usable children is DROPPED, because an empty AND evaluates TRUE** and inside an
  OR would make the whole feed match EVERYTHING;
- past the depth cap it degrades to "unconfigured" rather than walking an unbounded tree on the sync
  path.

**`0060` — the predicate, and the proxy it rests on, stated plainly:**
```
Completed IS true   OR   ( Date DATE_BEFORE $today  AND  Time Slot IS_NOT_EMPTY )
```
The second arm is a GROUP and **the nesting is the point** — a bare date rule would sweep every
past-dated row on the page. But `Time Slot IS_NOT_EMPTY` is a **PROXY for "is an appointment"**: the
precise test is the MODULE (what `Schedule: Place Dated Work` matches on), and a feed condition's
left is always `fields.<id>.value`. Measured exact on real data before choosing it — of 100 dated
occurrences, 96 are not appointments and **0 of those are in Tasks-page scope**; due tasks carry
`Due`, never `Date` + `Time Slot`. If it ever needs to be exact by construction that is a
module-matching leaf (`resolveRecordPath` already resolves `moduleId`), not a different predicate.

**VERIFIED BY DRIVING THE STORED PREDICATE THROUGH TIME, on real rows:**
```
as of 2026-08-08   []                                            ← nothing past, nothing ticked
        08-11      [Therapy with Keith]                          ← the Aug 10 one
        08-12      [+ Psych appointment with Angela]
        08-14      [+ Peer Support Group - Froedtert]
        08-20      [all four]
```
The two due-dated tasks never appear. **Honest limit: on today's data they are excluded because they
carry no `Date` at all, so it is the UNIT TEST — a past-dated row that was never scheduled — that
proves the nested AND constrains, not this probe.**

**The editor is ONE RECURSIVE control set**, so a nested group offers exactly what the top level does
and there is no second implementation to drift. The operator reads **"match all / match any"**, which
is correct to someone who has never written a predicate; AND/OR is not. 10 component tests, **A/B'd —
a no-op operator write and a zero depth cap each fail exactly one test**.

**A TEST BUG WORTH KEEPING: React does not fire `onChange` when the value is unchanged.** The first
version of the `$today` round-trip test re-typed the value that was already there, so the mock was
never called and the assertion **threw instead of failing** — a green-looking path that proved
nothing. Change the value, or you are testing the framework's dedupe.

**And the deploy probe lied first, exactly as documented.** My chunk regex matched
`PagePreviewApp-…` as `App-…` and reported the feature absent — **the CONTROL string came back 0
too, which is the tell.** Correct answer: all three chunks sha256-identical to the local build, and
`conditionOperator`/`$today`/`match any` present in the SERVED `PagePreviewApp` chunk (feed and
selector code lands there, so grepping App.js reads as a missing feature — the same trap the
2026-08-08 (2) entry records).

2148 client + 601 server tests (the same 3 pre-existing `liveOpsBehavioral` failures). Prod HEAD
`c90b4178`, index 200, bundles 200.

---

### 2026-08-08 (3) — the handoff named the WRONG FUNCTION, and the real blocker was never filed

Carried the other two accounts' queue over — the working queue is in the jsonl `TaskCreate`/
`TaskUpdate` entries **and in `~/.claude*/tasks/<session>/N.json`**, which is the authoritative
rolled-up form and is far cheaper to read than replaying the log. account3 hit its session limit on
the FIRST read of its own task #14; account2 hit its monthly spend limit seconds later. 14 items, 5
completed there, 9 carried here.

**THE HANDOFF NOTE POINTED AT THE WRONG FUNCTION, and it had the risk backwards.** It said feed
conditions are evaluated by `isOccurrenceVisible` (selectors.js:568) and warned in bold that the fix
sits on the **hot render path** where "a mistake breaks 37 boards at once". It does not. Feed
CONDITIONS are evaluated in **`resolveFeedItems` (selectors.js:462)**; `isOccurrenceVisible` is a
SECOND, later stage that applies the owner's date filter to the matches (`feedSync.js:55-56`). The
note's individual facts were all true — empty `$vars`, the dead `filterOverride: {}` fallback — they
were just attached to the wrong half. The fix landed in the resolver, which runs from the debounced
feedSync and the editor's match count, **not per render**. *A handoff's diagnosis is a claim; check
which function actually does the thing before inheriting its risk assessment.*

**ADDITIVE BY MEASUREMENT, then PROVEN BY A/B.** Before writing anything: **71 feed conditions across
the three grids, 35 plain strings + 1 boolean per grid, and NOT ONE beginning with `$`** — so a
resolver gated on a leading `$` cannot change any existing feed. Then proven rather than argued:
drove the REAL `resolveFeedItems` over LIVE data on both code versions — **77 feeds, 208 rows,
byte-identical row sets**.

**Rules are now built ONCE per pass, and that is correctness before it is speed:** a sync straddling
midnight must not classify two rows against two different "todays".

**It fails CLOSED, and the A/B says which direction matters.** An unknown token passes through
verbatim → the comparator gets an unparseable date → `DATE_BEFORE` answers false. Resolving an
unknown token to `null` instead reads as *"no filter set"* downstream and would match **everything**;
that variant fails its test. Also A/B'd: `$today → null` fails the presence test while the two
absence tests still pass — **those two do not discriminate on their own**, said plainly rather than
counted as coverage (the 2026-08-01 (16) trap).

**AND THE REAL BLOCKER WAS NEVER IN THE TASK.** The token was the filed obstacle; it does not finish
the user's ask. **`resolveFeedItems` ANDs every condition**, so adding `Date DATE_BEFORE $today` to
the Completed container yields "completed AND past", not "completed OR past" — and the correct
predicate is NESTED (`Completed IS true OR (past AND is-an-appointment)`), because an unqualified
date rule sweeps every past-dated row on the page. `evalGroupAgainstRecord` already does AND/OR and
nesting; what is missing is that feeds flatten to a list and `FeedSection` can only edit a flat one.
Filed with three options rather than guessed at — one container needs real predicate groups; two
containers need nothing.

**A one-line UI hint, because a token nobody can find is not shipped.** The value coercion already
left a `"$"` string intact, so `$today` was reachable and undiscoverable — the 2026-08-01 (16)
"my fix was inert" failure seen from the other side.

**`0059` — the psych appointment, and THREE THINGS WERE ASKED RATHER THAN GUESSED.** User, mid-turn:
*"i have a psych appointment with Angela at sixteenth street clinic at 9am."* The message carries a
time but **no day**; the duration is unstated; and a psych visit is arguably `Doctor` **and** arguably
`Therapy`, with Keith already occupying Therapy. Inventing any of the three on a real medical
calendar is the class of error `0052` (phone numbers) and `0054` (addresses) exist to prevent, so the
user picked: **Aug 11, 30 minutes, and a NEW `Psych` type.**
- **The two dropdown options are OCCURRENCES, not strings** — both fields resolve by find over
  `$allInstances` on a board-category tag. **Nothing in the migration hardcodes the tag, its value,
  or a board id**: all three are read out of the FIELD's own stored predicate and `addNew` config.
- **The tag value's ARRAY shape is copied from an exemplar read at use time**, because `CONTAINS`
  matches a scalar too — the wrong shape would resolve fine in the dropdown and be wrong for anything
  reading the field as a list. Reading the exemplar *at use time* is `0054`'s own defect avoided.
- **The clinic gets NO ADDRESS.** Sixteenth Street has several Milwaukee sites, and a plausible
  address on a medical appointment is indistinguishable from one the user entered.
- **Verified by reading the RESULT back, not the log:** 7 fields dereferencing to the right labels,
  the row LISTED by its parent, the shared Appointment template (what the placement op matches on),
  and both new options **resolving through their dropdown's real predicate** — 8 types, 9 locations.
  Force re-run skips all three. Seed half added; a reseeded test grid 2 produces the identical lists.

601 server + 2122 client tests (the 3 `liveOpsBehavioral` Daily-Question failures are pre-existing —
**A/B'd against stashed source, identical 3**). Build clean, chunk sanity holding. poms grid **0
errors**; test grid 1's 1 error is the frozen archive, still deliberately untouched.

**NOT VERIFIED, and it is the honest gap:** no feed on any grid uses `$today` yet, so the token has
never resolved in a browser — only against live data through the real resolver. And the appointment
has not been watched land in its 9:00am slot; that happens when the user navigates to Aug 11.

---

### 2026-08-08 (2) — an ADDRESS field type; the design shrank three times, and THREE tasks were retired by measuring

Carried the other account's queue over (14 items; it shipped #1/#3 then hit its spend limit one grep
into the Location work). Shipped **`address` as a first-class field type** with a map search, plus
migration `0054`. Deployed twice, verified both times; poms grid at **0 errors**.

**THE USER RESHAPED THIS SIX TIMES MID-BUILD AND EVERY TURN MADE IT SMALLER.** Recorded because the
reflex is to defend the bigger design:
- *"location should be a location type field"* → then *"address field type i mean too"* → the
  searchable thing is the ADDRESS, so that is the type; **Location needs no type at all**, it stays
  the occurrence dropdown `Place` already was.
- *"make location an artifact type too"* → then *"i feel like mixing it into files is dirty"*.
  **They were right, and it dodged a bug I had already measured:** an artifact is `role:"artifact"`,
  the dropdown resolves options over `$allInstances`, and that slice is **role-filtered
  (`operationExecutor.js:1543`)** — every Location dropdown would have silently resolved to ZERO
  options.
- *"we dont need an image for it"* → deleted `slippyMap.js` + a `sharp` tile compositor, already
  written and tested.
- *"i will navigate to the board … and prefill the address there"* → deleted the whole add-new
  integration. The last piece of scope removed itself.

**A FALLBACK CHAIN THAT COULD NEVER FIRE, and only the real API showed it.** I wrote Photon-primary
/ Nominatim-fallback. **Photon returns eight hits for essentially any query**, so the Nominatim
branch was unreachable dead code. Probing the user's own places:
```
Froedtert                       photon OK    nominatim OK
2010 W Wisconsin Ave Milwaukee  photon MISS  nominatim OK    <- exact house
Dewey Center Milwaukee          photon MISS  nominatim MISS  <- in neither
```
**"Returns results" is not "returns the right results."** Now both run in PARALLEL and merge, ranked
by whether the query starts with a house number. Per-provider rate limits, not one shared queue —
Nominatim's policy is a hard 1/sec and sharing it made every lookup a 2.2s wait for no reason.

**AND THE LIVE ENDPOINT CAUGHT WHAT 17 TESTS DID NOT.** Curling prod after deploying:
`W/282412131` (Photon) and `way/282412131` (Nominatim) — **the same building, two spellings**, so
the cross-provider dedupe never fired and every shared result appeared twice. The tests only ever
compared identical id strings. *Probe the deployed thing, not just the built thing.*

**DEWEY CENTER IS IN NEITHER GEOCODER, so hand entry is a TAB, not a fallback.** A search box that
cannot express "I know where this is, the database doesn't" makes that place unenterable — and it is
one of the addresses the user actually needs. **`0054` therefore seeds Dewey Center and Froedtert
with NAMES ONLY.** Froedtert Hospital *does* resolve, but the appointment is a peer support group
and Froedtert has several campuses: **a plausible address on a medical appointment is
indistinguishable from one the user entered and could send them to the wrong building.** Same rule
`0052` applied to phone numbers.

**THREE TASKS RETIRED BY MEASURING RATHER THAN BUILT** — the (4)/(6) discipline again:
- **"what fields get shown in the dropdown … like in the settings for that field"** — already
  exists. `optionsSource.chipDisplay` (2026-05-19), editable per field in the Command Center,
  ordered by explicit `fieldIds`. `0054` only turns it on.
- The **mini-map image** and the **add-new map flow**, both deleted by the user's own reframing
  after being built.

**VERIFYING CAUGHT A DEFECT IN MY OWN MIGRATION.** Step 8 copied the exemplar's `fieldBindings`
**read before step 6 bound Address**, so the two new locations went in unable to hold the one thing
they exist for — the `0047` trap exactly. **The log even said it** (*"copying the shape of Farmers
Market — 2 bindings"*) and reading it would not have caught it; reading the RESULT back did. The
re-run self-healed both, which is also the idempotency proof.

**Existing string addresses are left ALONE, deliberately.** 12 People modules bind the field and 10
hold real street addresses; `readAddress` accepts both the bare string and the picker's object.
Geocoding them to "upgrade" them would be rewriting the user's own data on a guess.

Verified the 2026-08-07 (3) way: prod HEAD over SSH, index 200, bundles 200, sha256 byte-identical,
and the feature present in the SERVED chunk — **with `images/search` as the control, because the
address code lands in `PagePreviewApp` and a grep of `App.js` would have read as a missing
feature** (and because minification renames functions, so only STRING literals are greppable).
Rehearsed on test grid 2, force-re-run, then RESEEDED to prove a fresh seed and a migrated grid
produce the same shape. 601 server + 2081 client tests (3 pre-existing `liveOpsBehavioral` failures,
unrelated — they reproduce on unmodified source).

**NOT VERIFIED, and it is the honest gap:** no address has been picked in a real browser. The
picker is only reachable from an address-typed field, which only exists as of this migration.

---

### 2026-08-08 — appointments span their slots, due work repeats until done; and the PROBE was wrong again

Picked up the previous session's interrupted sentence (*"I'll take the seed builder first"*). It had
shipped the two pure decision layers — `slotSpan.js`, `dueSpan.js` — and stopped before anything
consumed them. Shipped the consumer: **`Schedule: Place Dated Work`** (one op, two phases) plus
**`Schedule: Stamp Completed On`**, wired into the seed, migrated to poms grid as `0053`, deployed
and verified.

**A CENSUS CONTRADICTED THE DOCS BEFORE ANY CODE WAS WRITTEN — twice.**
```
poms grid   Due containers 2, each listed by exactly ONE parent   ← PER-DAY, not shared
            96 slots, each listedBy 1                             ← per-day copies too
            occurrences carrying a due DATE: 0                    ← clean slate
            Appointment binds: Completed, Type, Place, People, Duration, Date(h), Habit(h)
```
CLAUDE.md's 2026-05-21 entry says Build Schedule *"multi-parents the SHARED Due"*. It does not any
more — Due and all 48 slots are per-day copies, which is what makes "a task in every day's Due" a
real placement problem rather than something that falls out for free. **And the Appointment action
carried NO start time at all** — so "Therapy at 2:00pm" had nowhere to put the 2:00pm and the whole
spanning feature had no input. Binding `Time Slot` was step one, and only the census found it.

**MULTI-PARENT, NOT COPIES — and the user's own word was the wrong one.** They said *"so copied"*.
A copy per day forks completion state, so ticking Monday's copy leaves Tuesday's unticked and *"if
its completed we can stop displaying it"* can never be true. ADD_CHILD appends to a parent's
`occurrences[]` without touching `child.parentId`, which is the Schedule's own existing pattern.

**THE DECISIONS STAYED IN THE TESTED HELPERS.** Two new pipeline actions — `SLOTS_COVERED` and
`IS_DUE_ON` — are thin wrappers over `slotSpan.js` / `dueSpan.js`. The alternative was re-expressing
both rules as predicate JSON, which is two sources of truth where the JSON copy is the one nobody
tests. The Due rule *is* expressible with existing comparators; that is exactly why it was tempting.

**EVERY PHASE SWEEPS WHAT IT NO LONGER CLAIMS, using its own placement as the keep-test** so the two
cannot drift. Both sweeps are deliberately NARROW — phase 1 only unlinks Appointment occurrences,
phase 2 only children carrying a due date — so a Pay Bill copy or a hand-dragged row survives.
REMOVE_CHILD unlinks and never deletes, which matters because these rows are multi-parented.

**THE OP WAS DRIVEN THROUGH THE REAL EXECUTOR, NOT ASSERTED AS SHAPE — and that is what caught
everything.** This repo's builder tests assert pipeline structure, and structure has repeatedly been
right while behaviour was wrong. 15 behavioral cases against a hand-built Schedule found two things
reading the JSON never would: **`UPDATE` needs a var bound to a RECORD with `.id`, not an id string**
(it throws *"not a record"*), and my own probe had **`executePipeline(operation, CONTEXT,
TRANSACTION)` backwards** — which emptied `$allItems` and failed 8 tests in a way indistinguishable
from a broken op. *Check the probe before believing the failure*, for the Nth time.

**TWO A/Bs, AND ONE OF THEM CAUGHT A VACUOUS TEST.** Disabling the phase-1 sweep fails exactly one
test. Disabling the phase-2 sweep failed NOTHING: the "swept the day after" case asserts the task is
absent from tomorrow, and it was never placed there to begin with. Rewritten to place it first, then
stop it being due. **An assertion of absence proves nothing until you have proven the thing can be
present** — the same trap 2026-08-01 (16) records, arrived at from a new direction. (Two other tests,
both "writes no effects", are honestly vacuous and kept only as contract pins.)

**`0053` IS PURELY ADDITIVE, AND THAT IS THE DESIGN.** One field, two ops, one binding — it moves no
occurrence and rewrites no value, so unlike every migration that has damaged this grid there is no
selector that can match the wrong thing. Both halves import the SAME builders the seed uses, so a
reseeded grid and a migrated grid cannot drift. **Fields resolve by name AND TYPE because this grid
has TWO fields called "Due"** — a display-only number tile (`bKIKDURV5WTU`) and the real date
(`GVKdfbbkUEwW`); name alone picks whichever Mongo returns first. Dry run reported against a NAMED
expectation and every value matched what had been measured independently beforehand.

**Checked the one thing that could have lost data before applying:** poms grid's single Appointment
occurrence is the CATALOG SOURCE in Routines/Planning, not under a day column, so the phase-1
sweep's `HAS_ANCESTOR $dayColId` guard skips it.

**I APPLIED THE MIGRATION BEFORE DEPLOYING THE CLIENT — the wrong order, stated plainly.** The two
new actions are CLIENT code, so for a few minutes prod had ops naming actions its bundle did not
know. It degrades to a no-op (the switch falls through, the var never binds, the LOOP coerces to
`[]`) and was provably inert on today's data — 0 due-dated occurrences, the one appointment outside
any day column — but that was luck, not design. **Builder → client deploy → migration is the order.**

**NOT VERIFIED, and it is the honest gap:** no real appointment has ever been placed by this op. It
is inert on poms grid until task #4 enters the user's actual data, which is what will exercise it.

Deploy verified the 2026-08-07 (3) way: prod HEAD over SSH, index 200, both referenced bundles 200,
sha256 byte-identical, and both new action names present in the SERVED bundle — with `REMOVE_CHILD`
as the control, since they land in a chunk named `PagePreviewApp` and "not in App.js" would otherwise
have read as a missing feature. 2084 client + 580 server tests; all three grids at their documented
baselines (test grid 2's reseed also cleared its 22 date-nav probe-debris rows).

---

### 2026-08-07 (6) — the Files folder gets its RULES; and THREE things were already done

Picked up the other account's queue from the chat logs again (12 open items, recovered the same
way as (5) — `TaskCreate`/`TaskUpdate` in `~/.claude*/projects/-home-joshpoms-moduli/*.jsonl`).
**Deployed twice, verified both times**; poms grid at 0 integrity errors.

**A CENSUS CONTRADICTED THE PLAN BEFORE ANY CODE WAS WRITTEN, and reshaped the rule.** Task 4
Step 5 says placement-delete is decided PER KIND (media copies, markdown multi-parents). Measured:
```
poms grid  234 artifacts · 223 homed in Files · 10 ALSO listed by a doc container
           0 markdown artifacts · 0 artifact modules with >1 occurrence
```
Those 10 are the imported **Eminem images** — `0051` gave them a Files home while their section
container already listed them. **So deleting one off the page deleted the file out of Files**, on
live data, today. And they are `image` (copy semantic) living in the multiparent shape, which means
**the discriminator cannot be the kind — it is WHERE THE DELETE CAME FROM.** `classifyFileDelete`
takes `fromParentId`; a missing one means "the file", because a caller that cannot say where it is
deleting from has not told us it meant a placement.

**THREE TASKS WERE RETIRED BY MEASURING RATHER THAN BUILT.** Same discipline as (4)'s two:
- **The link-relink MIGRATION.** Step 2 had already measured it: 709 chips → 10 would relink →
  **all 10 FALSE POSITIVES** (`Shady Records` and `Shade 45` are section HEADINGS at depth 2 inside
  the Eminem page). With the corrected selector it drops to ONE — `Eminem → Eminem`, a jump to the
  top of the page you are reading. **Title matching is a guess, and on real data it was wrong every
  time.** Built the thing with nothing to guess instead: relink AT CONVERT TIME, where both ends are
  in hand and the match is URL equality against a URL the user personally acted on.
- **Intake finding 4** ("an empty-cell FILE drop is filed nowhere while TEXT gets a folder"). True
  when written, false now — `homeFolderForUpload` files it in `Files/<kind>`, and
  `handleFileDrop`'s `persist` returns null on that branch so the client cannot re-stamp over it.
  What still differs is CORRECT: an import is a document, a file is a file.
- **Files field Step 1** — already existed on both grids, bound by ~188 modules.

**TWO LIVE BUGS FOUND BY READING A WRITE PATH WHILE EXTENDING IT, both silent:**
1. **The media drop had been INERT.** It resolved a dragged artifact to `mod.fileRef` — a STRING —
   and wrote that into a field whose resolver accepts only occurrence ids and deliberately has no
   legacy-string fallback. So dropping an artifact on a row wrote a value the resolver refuses and
   the picture never appeared.
2. **`showMedia` gated on the media binding**, so a row binding only `Files` had no drop target and
   nowhere to show a picture it was perfectly able to hold.

**`main` ON THE FILES FIELD — additive by measurement.** 213 occurrences carry a Files value and
**zero** carry a `main`, so `primaryMediaOf` preferring it changes nothing today and lights up as
faces get marked. **The order cannot be reversed** (rows carry BOTH a Poster binding and Files, so
preferring the binding would make marking a face silently do nothing) — A/B'd: reversing fails
exactly the discriminating test while the 213-row regression still passes.
`attachFile` encodes the one decision that matters: **the FIRST attachment becomes the face, later
ones never steal it.**

**LOOKING AT IT CAUGHT WHAT THE NUMBERS DID NOT — again.** The main-picture drag affordances
measured correct (`::after` 3px line / 2px ring) and the SCREENSHOT showed the line drawn straight
through "Drop media here", and the ring around the BOX rather than the picture (the box is
full-width, the picture is centred and narrower). Both fixed. **The probe ALSO reported
`position: static` and no `::after` on its first run — a STALE BUNDLE**, because `dist` predated the
CSS edit. A zero there would have been a claim about the probe.

**A SURFACE WAS DELETED RATHER THAN IMPROVED.** User: *"we should remove the files tab if we have a
folder now for them."* The audit's own words are that the tab scrapes `modulesById` **because there
is no folder to read** — there is one now, so a flat tab is a second surface for one concept, and
the one that cannot say where anything lives. The half-built "teach it to read the folder" helper
went with it rather than sitting caller-less. **Checked before deleting that its upload was not the
only upload** (QuickAdd's artifact tile, `artifactUpload`, ConnectionsTab).

**Also shipped:** dragging out of Files lands a placement per kind (the other half of Step 5 —
until it existed nothing created a SECOND placement, so the delete distinction could not be
exercised); a link dropped on an option board mints a real tagged option, with the identity DERIVED
from the board's own feed (34 of 37 feeds, matching the documented count, with nothing knowing the
word "boardCategory"); a photo of a list becomes a checklist, where the SPLIT is the feature and
each refusal is a test (it deliberately does not dedupe, merge wrapped lines, or drop the header —
dropping debris is safe, rewriting is not); and **Keith and Angela** on the People board via `0052`,
which **invents nothing** about them — 4 fields written, the other 20 bound and empty, because a
plausible-looking phone number in a real contact list is indistinguishable from one you entered.

**Two probe traps, both mine, both would have read as "the code does nothing":** `vi.spyOn` on an
ESM namespace import does not intercept; and a drop fixture fed `dropTarget` when `dropView` reads
`target` + `state.modulesById`, reporting zero emissions. Assert on **the writes that leave**, not
on which helper was called.

**NOT VERIFIED, and stated plainly:** no drag/drop path shipped today has been exercised by a real
drag. The decisions are A/B'd and were driven against LIVE data (213 posters still resolve, 34 of 37
feeds are option boards, the invariant holds on a real row), but drag MECHANICS are untested —
`DragProvider` resolves the hovered container from a `pointerRef` a synthetic drag never moves, so a
green synthetic result would be a claim about the probe.

---

### 2026-08-07 (5) — the queue lives in the CHAT LOGS, not the repo; and three intake shapes land

**The most useful thing this session did was find the actual task list.** Asked to continue the
other account's work, I rebuilt it from the repo — plan checkboxes, CLAUDE.md — and got a SUBSET.
The user: *"i think there was more tasks too"* → *"check the chat logs"*. The working queue lives
in `~/.claude*/projects/-home-joshpoms-moduli/*.jsonl`, reconstructable from `TaskCreate` /
`TaskUpdate` tool_use entries. **Plan-file checkboxes go stale and CLAUDE.md is a narrative, not a
queue.** Recovered 12 open items (Files folder, Files field, relink chips, audit loose ends,
artifact spread, snap-filter range, graph labels on a phone, date-nav cost, the external pipes).
Saved as memory `feedback-check-account-chat-logs`, per the user's ask. **Reconcile the recovered
list against the repo** — several entries were still `pending` in the log and already retired here.

**TASKER IS THE LIVE PATH FOR THE SOURCES THAT HAVE NO API, and the guide said the opposite.**
User: *"im gonna use tasker to grab alot of data from push notifications … new friend requests and
new messages from facebook and instagram and sms."* `docs/data-ingestion-guide.md` marked FB/IG
**❌ backfill only** and filed phone-side notification capture as a one-line aside ("noisy").
Rewritten (600 → 826 lines): a first-class Tasker section with the profile shape per source, a
**"which producer for which source"** rule (*where does the data live* — cloud → IFTTT, phone-only
→ Tasker, retired trigger → Tasker), and the four filters that make a notification listener usable
(group summaries, `ongoing`, package+text discriminators, and the derived `externalId`).
- **The `externalId` is the load-bearing part.** A notification carries no stable id, so it must be
  derived deterministically (`sha1(package + title + text + minute)`) or a retry mints a duplicate.
  `/ingest`'s dedupe is only as good as the key it is given.
- **A friend request and a message are different occurrences, and Tasker must not create the
  person.** The phone cannot tell one "Mike Anderson" from another; a producer that mints People
  rows fills that board with near-duplicates in a month. Resolution is the app's job.
- **The friend-export parse, specified — with the trap.** Facebook's DYI JSON **double-encodes
  UTF-8** (`JosÃ©`), so names need a latin-1→utf-8 repair; Instagram's export does NOT, and running
  the repair over it corrupts clean text. One needs it, one doesn't — check both against a known
  accented name before the full run.
- **Step 0 of the build order is: log what actually arrives for a day before writing any filter.**
  FB and IG reword notification strings regularly; matching a string you guessed is how the pipe
  dies silently.

**THREE INTAKE SHAPES SHIPPED — `.md` → tree, `.csv` → table, link → chip.** All three route to
code that already existed; the plan's point is that intake was a decision layer, not a second
implementation.
- **The CSV becomes a MARKDOWN PIPE TABLE first**, because `buildTable` already mints the real
  `kind:"table"` container from one. **The constraint nobody would guess:** `parseBlocks` only
  detects a table whose separator has TWO column groups, so a **single-column CSV cannot be a
  table** — it now fails out loud instead of silently importing as prose.
- **The doc arm had to EMBED the imported root.** The server appends an import to its parent's
  `occurrences[]` and nothing else; a doc renders its TEXTMAP, so a tree imported into one would be
  present in the data and invisible on screen — the 2026-08-01 (19) listed-but-not-embedded class,
  arrived at from a new direction and caught before shipping rather than after.
- **The link chip is the CLIENT TWIN of the importer's `buildInlineLink`** — same `meta.link` on
  both halves, so a dropped link and an imported page's prose link are the same thing (which is
  what will let Task 6's relink find both). **Two errors the build caught:** the first draft
  invented `kind: "block"` (the app's non-inline textblock kind is `"doc"` — it would have rendered
  fine right up until something read the kind), and the first `deriveLinkLabel` returned
  `"www.example.com"` for a bare domain because it matched a "last path segment" against the whole
  URL, host included.
- **The shape helper deliberately mints NO ids and no parentage** — the write goes through
  `createTextblockInContainer`, which stamps the destination's filter values. A parallel mint path
  would have produced a link invisible to the date filter, the exact class fixed for artifacts the
  day before.

**A BEHAVIOUR FLIP, and a test had pinned the old state on purpose.** A dropped link now
pre-selects the CHIP rather than the raw-URL card. `linkDropAsks.test.js` asserted the card, and
its own comment named Task 5 as what would change it — the classifier always preferred the chip;
`filterToImplemented` was re-pointing it while the chip had no route. The plain card is still
offered, one keystroke away. **Verified the no-host fallback still WRITES** (a preview iframe has
no sheet host) — it mints a chip with the right `meta.link` rather than the drop vanishing.

1946 client tests, build clean with the chunk sanity check holding. **Both new suites A/B'd against
the unfixed source** — removing the two file routes fails 6 tests; the link tests fail against the
invented `"block"` kind. Nothing deployed and no migration: all of it is shared client code.

---

### 2026-08-07 (4) — TWO TASKS WERE ALREADY FIXED, and measuring said so before I wrote any code

Carried over the 17-item task list from the other account and worked it. **The most useful thing
this session did was retire two tasks whose premises were stale** — both would have been days of
work aimed at bugs that no longer exist.

**Task "Day Page: Build still mints duplicate day columns, RECURRING":**
```
poms grid    10 columns,  9 distinct dates, 1 duplicate
test grid 2  25 columns, 25 distinct dates, 0 duplicates
```
and the duplicate pair was created **08-04T11:56 and 08-05T02:04 — both BEFORE migration 0039
landed on 08-05**. Every day since got exactly one column, and test grid 2 takes the heaviest probe
navigation of any grid with zero duplicates. **A recurring bug is a claim about TIMESTAMPS; date the
damage before believing it still recurs.** The two Aug 4 columns both hold writing, which is why
0038 refused to merge them — a human call, still open, still not a bug.

**Task "sweepOrphans vs gridIntegrity — one predicate is wrong":** neither is. They answer different
questions — one asks *would this render?*, the other *is this safe to delete?* A row that cannot
render but holds content is correctly an error in one and correctly declined in the other. What WAS
wrong was the message: 22 flagged, and **21 of them carried no `moduleId` at all**, so "references a
module that does not exist" described a pointer that was not there. Split into
`module-less-occurrence` and `missing-module`. `sweepOrphans` now carries an explicit **do not
loosen this predicate** — deleting a subtree because its root lost a pointer is the trade that
damaged real data in `0035`.

**What the measuring DID find, in the same op:** the Daily Question lookup still used
`$allContainers` in the builder and in `0040`. Same defect `0039` fixed one FIND over, and its
failure is silent — a question container whose module is missing drops out of the role-filtered
collection, the `$dqId IS_NOT_EMPTY` gate fails, and the day's question is never filled ("14
containers, 12 EMPTY"). **No migration was needed, and that is the interesting part: `0039`'s
selector had already patched it.** `isRebind` tests for the string `"right":"$colId"`, and the
Daily Question FIND uses `$colId` as an ANCESTOR SCOPE — so it matched, and 0039 patched **three,
not the two its header claimed**. Benign, even correct. Recorded in that file rather than tightened,
because a migration's ledger has to describe what executed. **The 0035 lesson from a new direction:
a selector matching "the thing that mentions `$colId`" matches every USE of it.** The test asserting
"and nothing else" had a fixture that omitted the only FIND that over-matches — which is how it
stayed invisible.

**Intake Task 3 Steps 2-3 shipped.** One `withAction` scope per intake (four writes → one undo
step), and `createArtifactPlaceholders` now stamps the destination's filter fields — it set
`fields: {}`, so a file dropped on today's column was born with no date, invisible to the filter,
indistinguishable from a lost upload.

**The intake drops are VERIFIED IN A BROWSER at last** — the plan's own pass condition, which the
unit suites structurally cannot cover (they mount the sheet host directly and never exercise the
wiring). File drop asks with the right shape preselected AND focused; Escape writes nothing (58 →
58, asserted on the write); Enter commits (58 → 59); doc-body and HTML/long-text arms both ask; the
sheet is a full-width bottom drawer at 390px. **The link arm is reported UNVERIFIED, never FAIL** —
a short plain-text drop, the LEGACY branch this work never touched, also writes nothing under a
synthetic drop, so the branch they share is unreachable that way and a zero there is a claim about
the probe.

**THREE PROBE TRAPS, all mine, recorded in `_intakeverify.mjs`'s header:** dropping at the CENTRE of
a 13950px-tall container resolves to y≈7000, off screen, on an SVG header icon — it reported FAIL on
three paths that work; `DragProvider` resolves the hovered container from a `pointerRef` that a
synthetic drag never moves; and the drawer's own `padding-bottom: max(12px, env(safe-area-inset-
bottom))` makes the inner dialog measure 12px short of the edge, so measure the DRAWER.

**And the test A/B caught one of my own:** "groups every write under a SINGLE action id" was
**vacuous** — two `null`s also form a set of size 1, so it passed against the unfixed code until a
`toBeTruthy` went in front of it. Every new test here was A/B'd against the unfixed source.

Five deploys, each verified the 2026-08-07 (3) way — prod HEAD over SSH, index 200, the hashed
bundle it references 200, and the served bundle's sha256 against the local build. 1880 client + 523
server tests. Probe debris swept (1 module, 3 occurrences, dumped first); all three grids back to
their documented baselines.

**`0048` MERGED THE LAST DUPLICATE DAY COLUMNS — and 0038 had been wrong about why it couldn't.**
User's call: *"merge"*. 0038 skipped this pair judging that both columns "hold writing"; re-measured
at FULL DEPTH through `decompressTextmap`, **both subtrees are empty — 20 nodes, 0 characters**. The
only non-date values are three Daily Questions written by `Day Page: Build`/`0040`'s backfill, and
every Daily Answer is blank. **0038's guard scored the app's own footprint as the user's writing —
the identical failure its own header records about its FIRST attempt, which counted field values and
fired on `0037`'s date stamp.** Twice, in one migration's history, by the same mistake: *a
writing-guard has to distinguish what the USER typed from what the app wrote, or it refuses
forever.* The new guard is text-only and fails CLOSED. poms grid is now at **0 errors** — the
dropped column also carried the last `duplicate-template-section`.

**CTRL+V NOW GOES THROUGH THE INTAKE CLASSIFIER — and the obvious veto was WRONG in a way only a
browser could show.** User: *"yes use control v"*. The rule that decides whether a paste is ours
carries all the risk: it is a document-level listener on a key pressed constantly, so the failure
mode is broken typing, not a missing feature. The first rule — `closest(".ProseMirror, .doc-editor")`
— made **all three probe cases bail**, because a doc container renders its body as a ProseMirror and
embeds occurrence cards as NODE VIEWS, so most of the visible grid sits inside an editor's subtree.
`_pastemap.mjs` measured the split across the viewport: **808 points plain chrome · 78 node-view
cards inside an editor · 34 genuinely editable text**. So the rule is **"editable text", not "inside
an editor"** — walk up, take the NEAREST explicit `contenteditable` answer, which ProseMirror
already sets to `false` on an atom node view. *When a veto rejects everything, question the
predicate, not the feature.*

**And the probe mislabeled its own targets, twice.** Its first two runs disagreed with each other
because "row" and "doc body" were guessed by selector: one point was editable text and the other a
node view, exactly backwards from their names. The probe now CLASSIFIES each point with the same
walk the code uses, so it cannot mislabel again. Third time this session a probe had to be fixed
before its failure meant anything.

**A DEPLOY VERIFICATION READ 502 AND THE SITE WAS FINE — the false alarm is worth recording,
because it is indistinguishable at a glance from the real outage.** `curl` immediately after
`deploy.sh` returns can land inside the pm2 restart window: nginx has no upstream yet and answers
502 for the app route while still serving the hashed bundle straight off disk (bundle 200 + index
502 is the tell). Diagnosed rather than assumed — `dist/index.html` was present and freshly built,
`localhost:5000` answered 200 on the box, and the ENOENT in the pm2 error log was **78 minutes
stale**, from a different window. **Verify with a short retry, and check the error log's TIMESTAMP
before believing it is yours.**

---
### 2026-08-07 (3) — I TOOK PROD DOWN FOR ~3 MINUTES: the deploy said ✅ and there was no `dist`

A deploy reported `✅ Deployed.`, prod HEAD matched local exactly — **and the site was 502**. The
server was online and crash-free; it simply had no `client/dist/index.html` to serve
(`ENOENT` in the pm2 log). Rebuilding on the server and restarting pm2 restored it; the second
deploy of the same commit worked fine.

**WHY the first build produced no dist is UNKNOWN, and that is my fault twice over:** I piped the
deploy output through `tail -2`, so the build's own log — the only place the answer could have been
— is gone. Do not pipe a deploy to `tail` (the 2026-07-11 entry says exactly this about `set -e`
and masked pipe exits, and I did the modern version of it anyway).

**THE VERIFICATION LESSON, which the existing rule did not cover.** The standing rule is *verify
prod HEAD over SSH, not script output* — and I did, and **HEAD matched while prod was down**. HEAD
proves the code arrived; it says nothing about whether the app is being served. **Verify the SITE:
`curl` the index for a 200 AND the hashed bundle it references for a 200.** A missing `dist` passes
every git-level check there is.

**Found while reading the pm2 log during the outage, and unrelated to it:**
`update_occurrence` was throwing `TypeError: Assignment to constant variable` **repeatedly** —
`occurrence` was destructured `const` and reassigned in the field-conflict branch, so any two writes
racing on one field **dropped the whole write**, silently, with nothing surfaced to the user. One
word. It had been live since the undo/redo work landed; no unit test exercises that path and a
single-window session rarely produces a clash, so the server's own stderr was the only witness.
**An outage is a good time to read the error log you would not otherwise have opened.**

---

### 2026-08-07 (2) — "the schedule isnt being created when i navigate": the window that navigates was the ONLY one that never fired the op

User, on the deployed build. **Two separate faults, and the first thing worth recording is that
neither was caused by this session's changes** — the A/B settled it in one run: the failure
reproduces identically with `window.__noStaging = true`, so staged loading is not implicated.

**FAULT 1 — the day column was never built on navigation.** Console during a date change:
**no ops fired at all.** The only NavigationOp fire for a grid-filter change lives in
`bindSocketToStore.onGridUpdated`, which runs on the SERVER ECHO — and the server broadcasts
`grid_updated` with `socket.to(userRoom())`, which **excludes the sender**. So every other window
would build the day; the window that actually navigated was the one that never did. Reloading
appeared to fix it because the onLoad sweep builds it, which is exactly why this reads as "it
doesn't create the schedule" rather than "an op is missing".
`CommitHelpers.updateGrid` now fires it whenever the patch carries `activeFilterValues` — the same
shape the echo handler uses, so both paths agree.

**FAULT 2, found because fixing 1 was not enough — the op fired and built NOTHING**
(`UPDATE_ITEM_META=1 UPDATE_ITEM_FIELD=2`, no CREATE). The executor resolves
`$schedPage._effectiveFilter` from `stateRef.current`, which **React has not committed yet** at that
point in the write, so the ops ran against the date the user had just LEFT and the target day
already existed → no-op. Deferring the fire by one task fixes it: same navigation now reports
**`CREATE_ITEM=57`** and the column renders live. This is the same ordering trap
`updateOccurrenceFilterOverride` documents from 2026-04-30 (it calls `updateLocalOcc` BEFORE firing
for exactly this reason) — the grid-level path never got the equivalent.

**Also repaired, and NOT the same bug:** poms grid's Schedule page occurrence had
`occurrences: []` while the Aug 6 day column sat there with `parentId` pointing AT the page and 51
children of its own — the documented created-but-unlinked class, from the parent's side. The page
renders `occurrences[]`, so it showed nothing. Relinked from `parentId` (dumped to
`backups/orphans/` first) and pm2 restarted, since the warm cache is authoritative for reads.
**What emptied it is still unknown** — a load does NOT reproduce it (verified: the list survives a
reload), and there is no transaction log because undo/redo was never deployed. If it recurs, that
is a separate hunt.

1796 client + 467 server tests.

---

### 2026-08-07 — the textblock mint is INSTANT: 1121ms → 30ms, and it was never the editor

Continued the audit from 2026-08-06 (5) as a plan
(`docs/superpowers/plans/2026-08-07-instant-textblock-mint.md`). **The plan's own two candidate
causes were both wrong, and the measurement killed them before a line was written for either.**

**Task 1 marked the editor lifecycle and the outer `onUpdate` span, then read the clock:**
```
createModule / createOccurrence     0.9ms    ← execute in under a millisecond
editor.view.dispatch(tr)         1121.6ms    ← the whole wait
   ~1010ms  before any node view exists
   editor:create x2 @ 1117.8               ← React committed at the END
   onUpdate start→end  0.1ms
7 editors created, 0 DESTROYED
```
- **`0 destroyed`** → nothing was being remounted → the "sibling insert remounts every block" task was
  **dropped**.
- **The new editor is created in the last ~100ms** → the "trim the sub-editor's extensions" task was
  **dropped** (it would have chased a tenth of the cost while risking stored nodes being dropped from
  a changed schema).
- **The save path is 0.1ms.**

**The A/B that named it — same click, store writes skipped: `1121.6ms → 9.8ms`.** The insert costs
**10ms**. The other 1111 is the app-wide re-render those two writes provoke, sharing the task — and
the browser cannot paint until the task ends. **The fix was ORDER, not weight.**

**Shipped:** `helpers/afterPaint.js` (rAF **then** a macrotask — a rAF callback still runs before the
paint, the same trap the staged-loading work hit the day before) defers the writes past the paint;
and `getProvisionalOccurrence` lets the node view render from the object the write will carry.
**That second half is what made it usable rather than merely visible:** deferring alone put the block
on screen in 30ms and left it **un-editable for 1223ms** — the original wait, moved.

```
mint:go → block on screen      ~1000ms → 30ms
the block is EDITABLE          ~1000ms → the SAME frame as the block
```

**Verified rather than assumed:** typing straight after the click leaves focus in the textblock and
the text lands there (the risk this change created); the 2026-08-06 second-click fix is unregressed;
1796 client tests; nothing to sweep and `checkGrid --all` unchanged on all three grids.

**Still open, unchanged:** the store write's ~1s app-wide re-render. It no longer stands between the
user and their block, but every occurrence write still pays it — the frame-1 storm docket.

---

### 2026-08-06 (5) — the click-to-mint textblock, AUDITED: 1s of it is mounting a ProseMirror

User: *"why creating a textblock via clicking an empty line takes so long. it should be instant and
if i click on a diff empty line it should create it there as well. right now, it just makes the
first one disappear"* → *"really audit what takes so long for it."*

**MEASURED on the real app (test grid 2, Day Page), never read off the code.** New opt-in
`[mint]` marks (`helpers/mintDiag.js`) name every step of the path on one clock:

```
   0ms   click
  16     pointerdown            ← the browser's own handling
  26     mint check scheduled
  99     mint:go                ← the decision is fast
 100     createModule            0.2ms
 101     createOccurrence        0.7ms   ← the store writes are NOT the cost
1084     replaceLine+mountSubEditor   982.8ms   ← THIS is the cost
1085     block in the DOM
```

**The two store writes cost 0.9ms combined.** The entire wait is ONE synchronous
`editor.view.dispatch` that replaces the line and, inside the host doc's re-render, mounts a fresh
live TipTap instance for the new block. On this page (34 textblocks, each already carrying its own
ProseMirror) it measures **250ms–1016ms** depending on what else the thread is doing. **That is the
"editor static-until-focus" docket item, arriving from a new direction** — the cost is not the mint,
it is that every textblock is a live editor. Fixing it is that docket entry's own session; nothing
in the mint path can shorten it.

**THREE defects found on the way. Two are fixed; both were invisible without the marks.**
1. **The suppression window was BLANKET.** Abandoning the first block arms a 600ms no-mint window
   so backspace cannot re-create the block it just collapsed — but it also swallowed the mint at
   the line you just clicked (`[mint] skip why:suppressed`, measured). That is exactly the reported
   "it just makes the first one disappear". Suppression is **per-LINE** now: scoped to the position
   it was armed for, so backspace is still safe and a different line mints immediately.
2. **The deferred check outlived its own gesture.** With (1) fixed the second click STILL skipped —
   `why: no-recent-input`. The mint check is deferred and coalesced, and minting the *previous*
   block blocks the thread for ~1s, so the check ran after the 1s user-input window had closed.
   `userInputRecently` now measures from **when the question was asked**, not when it is answered.
3. **NOT FIXED, and named:** the ~1s sub-editor mount above.

Verified by re-running the same probe: the second click now reaches `mint:go` and lands a block at
the new line (it never did before). 1791 client tests.

**Probe lesson, and it cost four attempts.** Every DOM-sampling approach failed in a way that LOOKED
like an answer: no doc editors on the default page; an "empty trailing line" that is `height:0`
until hovered; a doc whose blocks are all node views with no empty paragraph at all; and a
`page.evaluate` count that reported the state whenever the blocked main thread got round to it. The
measurement only worked once the probe **made an empty line the way a user does** (Enter, then click
away) and read the app's own marks instead of the DOM.

---

### 2026-08-06 (4) — staged loading: the shape paints in 0.2s, and the docket's load theory was WRONG

User task list: *"Staged loading: grid shape first, per-panel spinners, one circular loader."* Plan +
every number: `docs/superpowers/plans/2026-08-06-staged-loading.md`. Measured on **test grid 2**, not
poms grid.

**MEASURED FIRST, and the measurement retired the standing theory.** The docket had assumed the
on-load OP SWEEP dominated the load (556ms, 58 ops) and that "7.8s to content" was the drain. It is
not. Split four ways from `full_state` arrival at 1× / 4× CPU:

```
reducer dispatch      0.1ms  /    1ms      ← free, and always was
content RENDER      1265ms  / 6000ms      ← the cost, one unbroken task
op sweep             552ms  / 2247ms      ← a third of it, and it runs AFTER the rows exist
editor mounts        none on this grid    ← UNMEASURED, not zero (poms grid is where they live)
```

**The finding the plan did not expect: the grid shape was never missing.** Panel CHROME already
commits on its own at 125ms (504ms throttled) — a full second, six throttled, before its content.
Nobody sees it because **the first paint was at 2.5s / 11.8s**: React keeps rendering in the same
task and the browser is never handed a frame. So the work was YIELDING, not inventing staging.

**Three defects on the way, each caught by a different instrument, and the probe was wrong first.**
- **A rAF is not a paint.** Releasing content on a double `requestAnimationFrame` renders it in the
  very frame meant to paint the chrome — a CDP screencast showed **zero painted frames between 2.0s
  and 9.7s**. `setTimeout(…, 0)` after the rAF was still not enough: on a saturated main thread
  Chrome runs a due timer rather than painting. It takes a real idle window (50ms).
- **The sweep jumped the queue.** Once the paint was fixed, the sweep ran before any content, so the
  shape sat empty for its whole 3.8s and first rows went from 8.1s → 11.7s. It now waits for the
  NEAREST panel's content (`whenStagedFirstRelease`).
- **THE PROBE ITSELF LIED, and this is the reusable lesson.** The first screenshot probe sampled with
  `page.screenshot()` + `page.evaluate()` at fixed offsets and reported the whole throttled load
  finishing in 1.5s — contradicting the marks by six seconds. **Both APIs wait on the renderer**, so
  a blocked main thread delays the sample past the thing it is sampling. Only `Page.startScreencast`
  — frames pushed as the compositor produces them — can see a mid-load frame. *A probe that samples
  through the main thread cannot measure a blocked main thread.*

**Result, same instrument before/after:**
```
                          desktop 1x        phone 390px 4x
first PAINT            2542 → 199ms        11966 → 737ms
20+ rows in the DOM    1532 → 1373ms        8109 → 7181ms
main thread blocked    3688 → 2935ms       13101 → 15327ms   ← the honest cost
```
Paint 12.8× / 16× earlier, content slightly EARLIER too; the price is ~2.2s more total blocked time
on a throttled phone from the extra render passes. **Looked at, not just asserted:** at 3s and 5s the
staged build shows the toolbar, the panel and its header, the rails and one small loader; the
unstaged build shows a full-screen spinner and nothing else.

**Two things kept the instrument honest.** `loadDiag`'s state lives on `window`, not module scope —
rollup emits the helper into more than one chunk, and the first version reported **0 editor mounts on
a grid with 241 rows** because `Editor.jsx`'s copy had never been started. And staging is OFF unless
`App.jsx` switches it on, so a unit test still renders panel content synchronously.

1775 client tests, build clean. Probe debris swept (41 `missing-module` on test grid 2 → 2, the two
the sweep refuses because they have children); poms grid and test grid 1 untouched.

---

### 2026-08-06 (3) — the graph occurrence is FINISHED: a wheel you can zoom, click, and edit as data

Picked up the previous account's run of `docs/superpowers/plans/2026-08-06-graph-occurrence.md`
(Tasks 1-6 shipped there, plus migrations 0044/0045). Tasks 7-9 here. **Applied to test grid 2
only — poms grid and the deploy are the user's call.**

**FIVE defects shipped-and-caught in one session, and NOT ONE was visible to a unit test.** They
are worth listing together because the pattern is the point: a chart is a CANVAS, and almost
nothing about it is observable from the DOM.
- **`label.minAngle: 8` blanked all 80 outer labels.** 80 tertiary leaves are 4.5° each, so the
  whole outer ring rendered as unlabelled colour — while every metric said fine (8 roots, 0
  warnings, 540k painted pixels). Caught by a SCREENSHOT.
- **`setPointerCapture` on pointerdown ate every click.** Capturing a pointer retargets the
  compatibility mouse events it generates, so mouseup/click went to the wrapper `div` instead of
  the canvas and **ECharts never saw the click — a stationary click selected NOTHING, at every
  width, with 99 unit tests green** (jsdom stubs `setPointerCapture`). Capture now waits until a
  drag exceeds the slop.
- **A feed and a parent-field hierarchy did not compose.** A feed materializes each match as a COPY
  with a NEW id, and the copy's parent field still names the SOURCE — so every fed row looked
  parentless and the 3-ring wheel drew as **50 flat roots at depth 1**. Found by driving the
  PERSISTED grid through the real feed resolver and the real `buildGraphData`.
- **`limit: 0` on a feed means FIFTY** (`resolveFeedItems` reads `> 0 ? … : 50`) — the wheel
  silently drew a third of itself.
- **The op never fired.** `triggerObjects` says WHICH graph; `triggerTypes` says it responds to
  events at all — absent, `computeTriggerMatch` takes the legacy no-config path and only fires on
  LOAD. Plus: **an `if` step reads `step.condition`, not `step.predicate`, and an unrecognised key
  falls back to an EMPTY AND, which evaluates TRUE** — a mis-keyed guard does not fail closed, it
  runs its branch unconditionally.

**The user corrected a risk I had inherited, and they were right.** The plan carried a
"feed-vs-drag collision" in two places and I put it to them twice as a decision. *"i thought you
could have feed items and other occurances."* One grep settled it: `feedSync` only ever collects
children carrying `meta.feedSourceId`, so a hand-placed child cannot be swept — and a test has
pinned that since July. **A risk written from reading a DESIGN is a hypothesis, not a finding**,
and carrying one as an open question costs real time.

**Zoom, because the user chose one wheel over two.** *"the graph should be the size of the
container (so the size of the page), and have it be zoomable."* The whole view model is
`{ zoom, cx, cy }` with the centre in PERCENT — ECharts already resolves percent radius/centre
against the host box, so zoom and pan never need the container's size. `zoomAt` holds the point
under the pointer fixed, and the pan clamp is derived from the radius so at zoom 1 the range
collapses to exactly [50,50]: "panning requires zoom" falls out of the geometry rather than a flag.
Measured in a browser at 1400/900/390: anchor colour identical to the byte before and after
zooming, a click reports the full ancestor path, a drag never selects. A 390px phone needs 2.8×
to make a tertiary a 40px thumb target — inside the 12× cap, which is what makes one wheel enough.

**A guard nobody has watched FAIL is a guess.** The new `noDomainKnowledge` case for the graph
surface passed immediately — then a planted `EMOTION_RINGS` constant slipped straight through it,
because `\b` does not fire inside an identifier (`_` and camelCase are word characters). Substrings
now. And "wheel" was REMOVED from the banned list: it only ever matched `WheelEvent`/`wheelFactor`,
and a guard that cries wolf is one someone weakens later.

1763 client + 467 server tests, build clean, test grid 2 at 0 integrity errors.

---

### 2026-08-05 (4) — the wrap group OSCILLATED: a height projected from the wrong layout

User: the Eminem page *"starts flipping out … it doesn't know if the image should be full screen or
wrap, it keeps switching between the two, rapidly."* **Measured on the live page in Firefox: 46-64
wrap-class mutations per THREE IDLE SECONDS** (~20 flips/sec) at every wide width — nothing
happening on screen but the layout thrashing.

**ROOT CAUSE: `measure()` fed the stack/wrap decision a DIFFERENT neighbour height in each state, so
the two states disagreed forever.** Wrapped, the neighbour floats at `neighborWidth` and its height
is measured directly. Stacked, it renders FULL WIDTH, and the code projected the wrapped height by
inverse scale. That assumes height falls as width falls — true for a fixed-ASPECT box like a lone
image, **false for the Wikipedia lead aside, which is an image over an INFOBOX TABLE, and a table
gets TALLER as it narrows.** Stacked read 2482×1182 → projected **152** at the 320px float; the real
wrapped height was **757**. Five times out — and it changed the ANSWER: 152 is under
`WRAP_SHORT_NEIGHBOR_H`, so the group took the short-neighbour exemption and wrapped; at 757 the
sliver policy stacked it again; each flip re-fired the ResizeObserver. **17ms apart, forever.**

**Hysteresis could not have saved this, which is the lesson.** `decideWrapStack` carries a 35%/45%
band precisely to stop flapping — but hysteresis compares ONE signal against two thresholds, and
here the signal itself swung 152 ↔ 757 depending on which state was measuring it. *When a control
loop oscillates, check whether the two states are even measuring the same thing before tuning the
thresholds.* Fixed by remembering the height last measured WHILE WRAPPED and reusing it while
stacked — the float's width does not change with the group's, so that height is a fact about the
neighbour, not about the current layout.

**Four probe rounds, three of them wrong, all my own fault — recorded because the pattern repeats.**
(1) Cleared the diagnostic log AFTER the resize, so the decisions I was hunting were wiped before I
counted; (2) took the "mark" 150ms after the resize — same bug, second form; (3) swept only
1600→640 and concluded "no oscillation" when the trigger was WIDER than my viewport. Each looked
like a clean negative result. **A probe that reports zero is a claim about the probe until you have
seen it report non-zero.** The final A/B used a DOM MutationObserver with no instrumentation inside
the loop at all: 46/56/64 → 0/0/0.

**Behaviour note, not a regression:** the lead aside now settles STACKED at wide widths. That is the
sliver policy's own call (prose predicted 127px beside a 757px infobox = 17%, well under the 35%
threshold); before the fix it was flickering and the "wrapped" frames were half of a flip. Wanting
it wrapped there is a `WRAP_SLIVER_*` conversation, not this bug.

---

### 2026-08-05 (3) — every floating menu is a bottom DRAWER on mobile; and a wrong hypothesis killed by measurement

**`ui/MenuSurface.jsx` (NEW) is the one way a floating menu presents itself.** Desktop: the
portal-at-a-fixed-anchor each of them already was. Mobile: a full-width sheet pinned to the bottom
edge, sliding up over a backdrop, grab bar and safe-area inset included (user: *"any dropdown menu
opened on mobile should slide up as a drawer from the bottom of the screen"*). An anchored dropdown
on a phone is cramped, gets clipped by panel overflow, and **opens under the thumb that opened it**.
Five copies of `createPortal(<div style={{position:"fixed",top,left,…}}>, document.body)` became
one: ContextMenu, QuickAddMenu, HeaderDropdown, NavPickerPopover, AlarmDropdown.

**It deliberately does NOT own the desktop anchor math** — four different real behaviours with their
own tests (click-point clamp, flip-above via the unit-tested `menuPosition`, measure-and-flip,
right-edge anchoring). Folding them into one clamp would be a rewrite of four positioning strategies
to ship a drawer; callers pass the position they already compute and the drawer ignores it.

**Two things had to be chosen in JS rather than CSS, both the same trap this file has recorded five
times:** the drawer's sizing is INLINE (the surfaces it wraps set their own `width`/`maxWidth`
inline, and a stylesheet rule loses to an inline style every time), and ContextMenu's row padding is
inline, so the thumb-sized rows are picked in the component. Only the backdrop, the slide-up and the
grab bar live in CSS. **And `maxHeight` is computed, not `min(72vh, 560px)`** — a CSS function
inside an inline style is dropped WHOLE by an engine that cannot parse it (jsdom does exactly that;
the test caught it), and a dropped maxHeight is a full-height sheet with no scroll cap.

Measured in a real browser at both sizes against a harness, no live data: mobile 390×844 → x=0
w=390 bottom=844, content-height 218, 14px radius on the top corners only, backdrop one z-level
below, tap-off dismisses. Desktop 1440×900 → unchanged.

**A HYPOTHESIS I WAS SURE OF, AND IT WAS WRONG.** The mini-calendar's remaining desktop failure had
one suspect left: the picker mounted inside a `HeaderDropdown`. The calendar portals to
`document.body`, so it is OUTSIDE the dropdown's ref — I expected the dropdown's outside-mousedown
to close everything the instant you touched a day, which would look exactly like "the calendar
won't open". **Harnessed it: it does not.** The calendar opens inside the dropdown (66 days) and
clicking a day closes nothing. So BOTH surfaces are now ruled out by measurement and that bug is
genuinely unreproduced — it needs the user to say which control they click and what they see.
*Recorded because the discipline is the whole point: the hypothesis was specific, mechanical, and
plausible, and it cost one harness run to find out it was fiction.*

---

### 2026-08-05 (2) — click-to-mint textblocks; the Daily Question fills itself; page clicks stop opening folders

Picked up the previous session's task list (13 items, 7 shipped there). Three more shipped here,
all deployed — prod HEAD `db420ae8`, new bundle served.

**A line you click into becomes a textblock.** User: *"we should just have all new lines be
textblocks if im on it … if i move away from it with it still empty, it disappears."* The
first-textblock save lag was never a slow save — it was the create RACING the first keypress, with
a merge window and a rAF focus poll built to survive that race. Minting on caret ENTRY removes the
race outright. **The hard part is not the mint, it is that most lines you click into are abandoned
empty** — and deleting a row the server was only just told about is exactly the
create-is-queued / delete-is-not asymmetry behind the recurring dangling child refs. So a
provisional block is **NEVER emitted**: it lives in local state until it earns a row by holding
content, and abandoning it is a purely local removal that cannot race anything. The parent doc's
textmap is held back for the same window (a tab closed mid-window would leave the parent embedding
an occurrence that never gets created — a permanent "—"). **Three guards, each from an observed
failure, not caution:** register the block BEFORE dispatching the replace transaction (that
transaction fires onUpdate synchronously — measured 2 stray emits before, 0 after); defer and
coalesce the caret check (selection and focus land in either order, so reading `hasFocus()` in
whichever hook fired first misses half the cases — Shift+Enter-exit did not mint until this was
deferred); and a suppression window after a collapse (A/B: without it backspace re-mints the block
it just dismissed, 2→2 instead of 2→1). Verified in a browser harness driving the real
DocContent/Editor/InstanceTextblockNode against a fake store — **no live grid touched** — 8/8 steps
including zero emits while provisional.

**The Daily Question fills itself — and the template never carried it.** Measured first: **14
question containers on poms grid, 12 EMPTY**. `Day Page: Build` now writes a random question from
the pool per day, at BUILD time and only when the field is empty (a render-time pick reshuffles
every load, and the answer written underneath would end up attached to a question that is no longer
there). Two defects surfaced on the way, both by measurement: **(1) the day-page TEMPLATE never
carried the Daily Question at all** — the section was `parentId: Journal` and *nothing else*, so
APPLY_TEMPLATE (which walks `occurrences[]`) cloned a day with no question container, and Journal
being `kind:"doc"` meant an unembedded child would have been invisible anyway. Only a FRESH seed was
broken — the live template was wired by `0027` — which is precisely why nobody had seen it.
**(2) `applyEffectsToLiveOccs` dropped `identitySignature`**, so any rule looking up a just-cloned
node by signature found nothing until the server echo landed. `0040` applied to poms grid (11 empty
containers backfilled, distinct questions); integrity unchanged at the one pre-existing error.

**Clicking a page in the sidebar opens the page.** It used to open the page's FOLDER and animate a
drilldown into the card — the folder-first navigation from 2026-04-02. That reveal is worth it
exactly once; every time after it is a detour on the way somewhere you already named by clicking it.

**The audit half of the tree task did NOT match the report.** User: *"tons of pages are in folders
of the same name where they are the only pages in that folder."* Measured on poms grid: **2**
(Trackers, Examples), plus 4 folders holding one page under a different name. A migration written
against the wrong reading would move real pages — `0035` already did that once — so it is waiting on
a screenshot of the rows actually meant. **Recorded because the discipline is the point: measure the
claim before writing the fix, even when the claim comes from the person who can see the screen.**

---

### 2026-08-05 — the templates switch stopped stamping DATES; four mobile fixes; and four wrong diagnoses

**The date regression, and it is the templates switch as the user said.** `APPLY_TEMPLATE` stamped
`defaultFields` only on clones whose role was `"instance"`, or on other roles whose MODULE BOUND the
field. That rule was written when the Schedule's slots WERE instances. **They are containers now, so
the gate silently stopped covering the case its own comment described** — and only **1 of 48** slot
modules still bound the date, so the binding fallback caught almost nothing. Measured: **40 of 50
children of today's Schedule column had no date at all**.

It is a **DENYLIST** now — everything is stamped except page/panel wrappers, which carry their date
in `filterOverride`. *Enumerating roles is exactly how this broke*, and the user's framing is the
rule to keep: **any occurrence can carry fields**, and a textblock added to a day needs the date or
the filter cannot see it. `0037` backfilled 93 containers so today was correct, not just tomorrow.

**`0038` de-duplicated day columns — and the safety rule caught MY OWN mistake.** poms grid grew a
SECOND column for 08-04 (same label, date and parent; 4 children vs 8). **The signatures were
innocent** — template and every column read `daypage:Journal` etc., identical — so the integrity
message pointed at the wrong layer; the failure is `Day Page: Build`'s COLUMN-level existence check
missing a column that already exists. **Still unfixed, still recurring.** The repair's first
`writingScore` counted field VALUES, and the dry run refused to delete anything because every
container scored 10 — **the date `0037` had just stamped on all of them. The guard fired on its own
footprint** and would have protected empty clones forever. Narrowed to textmap; 3 empty duplicates
removed, 2 SKIPPED because they hold writing (both 08-04 columns do — merging those is a human call).

**Four mobile fixes, each a different layer than the one blamed:**
- **Horizontal scroll** — not the `soloColumn` change. `.panel-scroll` carried `touch-action: pan-y`,
  and **touch-action composes as the INTERSECTION down the ancestor chain**, so it vetoed horizontal
  panning before the board's own `overflow-x: auto` ever saw the gesture.
- **The "drag handle" swallowing left taps** — the handle was INNOCENT: measured 22×22, identical to
  its button, and a tap 12px left already missed it. The **side rails are 22px inset 4px**, far under
  a thumb. Hit area widened to ~40px via a transparent pseudo-element; visuals unchanged.
- **The mini-calendar "not opening" on mobile** — it did not EXIST there. The whole filter nav was
  gated behind `!isMobileLayout` (probe: 1 trigger desktop, 0 mobile). The desktop half is still
  unreproduced: under probe the toolbar picker opens fine, 66 days, no errors.
- **Mobile Routines scroll ~40× faster** — see `client/src/CLAUDE.md`.

**FOUR WRONG DIAGNOSES IN ONE DAY, each killed by measurement.** Recorded because the pattern matters
more than any of them: a marquee leak that was not leaking (animations flat at 10-11); a **RASTER**
verdict **my own tool invented from an API Firefox does not implement** (no Long Tasks API → zeros →
verdict fell through by construction); a DOM-node leak that was a **stale bundle**; and an op drain
that never ran (`ops={runs:0}`). **An absent signal is not a measurement of zero — check
`supportedEntryTypes` before believing one.** Every fix that actually worked came from numbers off
the user's device; every one that came from reading code was wrong. **And twice I nearly rebuilt what
already existed** (`content-visibility` was already shipped AND was the cause; `renderProbe.js`
already tallied renders) — the standing "read the folder CLAUDE.md first" rule, paid for twice.

**Also: a diagnostic that degrades what it measures is worse than none.** The `[scroll]` tool armed a
2s rAF loop per tap with no latch, so rapid tapping stacked loops and the app froze. Fixed with a
real one-at-a-time latch, and it is opt-in on desktop / silent on touch.

---

### 2026-08-04 — the recurring `dangling-child-ref` is ROOT-CAUSED: a phantom in the WARM CACHE

User: *"can you fix the dangly ones"*. They have been swept five times (2026-07-29, 07-30, 07-31,
08-03, 08-04) and always came back. **They came back because the sweep cleaned MONGO while the
thing causing them sat in MEMORY.**

`handleCreateOccurrence` writes the new row into `uc.occurrencesById` **before** the disconnect
check and **before** the upsert. An abrupt disconnect bails the handler — Mongo never gets the row,
and nothing removes the cache entry. On its own that is harmless. Two other facts weaponise it:
1. **The warm cache SURVIVES a disconnect** (server.js deliberately stopped evicting it; 30-min
   TTL), so the next connection reuses it instead of reloading from Mongo.
2. **`update_occurrence`'s dangling-ref guard decides whether a child id is real by looking in that
   same cache.**

So the phantom **launders itself**: the guard sees the id, concludes the child exists, and persists
a parent listing an occurrence that does not. The guard added on 2026-07-29 was right about needing
the server to settle it — it just trusted a source that could be wrong.

**Fixed** by rolling the cache back on every path that does not reach Mongo, tracking `persisted`
so an aborted parent `$push` (row IS real → keep) is distinguished from an aborted occurrence
upsert (row is not → drop). Identity-checked so a newer write for the same id is never dropped.
The **generic CRUD create has the identical shape**, which is the sibling **`missing-module`**
error (a module present in cache but not Mongo lets its occurrence reference nothing) — fixed too.

**Evidence, in the order it actually mattered:**
- **34 of 36 feeds are consistent; only Schedule Table + Schedule Canvas ever break.** Those two are
  the only feeds whose SOURCES turn over daily, so they are the only ones minting on every load.
  That 2-vs-34 split is what said "mint path", not "feed engine".
- **Prod pm2 logs settled it**: `🧹 update_occurrence z9lntG03zNIP: dropped 11 unknown child id(s)`
  — the guard was firing on exactly those parents, catching phantoms that had already aged out
  while still-cached ones sailed through.
- **A/B on the test**: 2 fail without the fix, 3 pass with it.

**PARTIAL RETRACTION, same day.** The phantom is real and the fix is correct hardening — but it is
**NOT what produced the refs observed on 08-04.** Probing again after deploying it reproduced 15
fresh dangling refs on test grid 2, and prod logs for those exact ids show `create_occurrence START`
→ **`DONE`**: they PERSISTED, then were deleted afterwards while the parent kept listing them. So
the cause is on the DELETE path, not the create path. `delete_occurrence` is not queued, its parent
cleanup was a whole-document read-modify-write with one await PER PARENT against a single snapshot,
and a sweep across the two feed pages runs many handlers at once — the stale-second-parent write is
the candidate. Changed to an atomic `$pull` (`2a269f17`) — but **that is explicitly UNPROVEN**: the
test does not reproduce the race (it passes against the unfixed code too), so it is hardening, not a
demonstrated fix. **Do not record this class as solved.**

**Also found, NOT chased:** `sweepOrphans.js` and `gridIntegrity.js` **disagree** — the sweep reports
zero dangling refs while `checkGrid` reports 2, because those children exist as documents carrying
`gridId: null` (the 48 the sweep deliberately refuses to touch as possibly mid-flight). A global
lookup says they exist; a grid-scoped one says they do not. One predicate is wrong. Reconcile them
before trusting either for this error class.

**A wrong theory, recorded because discarding it was the useful step.** I first blamed a lost update
in `delete_occurrence`'s parent cleanup (a read-modify-write of the whole document, with concurrent
deletes). Plausible, and the code really is shaped that way — but the test did NOT reproduce it: the
cache write sits synchronously between the read and the await, which serializes the handlers. Writing
the test is what killed the theory; reading the code would have kept it alive.

**And the vacuous-pass trap caught me again, mid-session.** My first end-to-end test PASSED before
the fix — because the `io` mock had no `sockets.adapter.rooms`, so `update_occurrence` THREW and
returned early. The assertion was true because the code never ran. **A test that passes before the
fix exists is not a test.** Always A/B a regression test against the unfixed code — that is the only
thing that proves it discriminates.

---

### 2026-08-03 — templates are a FOLDER; and `cloneSubtree` had been dead for a month

Continued account3's subagent-driven run of `docs/superpowers/plans/2026-08-02-templates-folder.md`
(it shipped Tasks 1-5, then hit a session limit and a login expiry). Tasks 6-9 here, plus a
**Task 5.5 the plan never scoped** — without it 6 and 7 could not work at all.

**`utils/cloneSubtree.js` read `src.targetId`. The schema field is `moduleId`.** The 2026-07-29
rename dropped `targetId`; **0 of 3926 live occurrences carry it**. So `walk()` bailed on the first
node and returned a null root — meaning `apply_template`, `clone_subtree_as_template` AND
`save_over_template` have ALL silently failed since that rename. Every template button in the app
was dead, including the create-page-from-template flow shipped in Task 4/5 the same day.
**Why nobody caught it: the test fixture set BOTH `moduleId` and `targetId`, and the whole suite
was DB-gated (`if (readyState !== 1) return`) so it passed VACUOUSLY with no Mongo running** — the
1ms runtime was the tell. Persistence is injectable now (`persist`), so the traversal is genuinely
exercised without a database; 15 tests that actually run.

**The plan assumed a server that didn't exist.** `socketHandlers/templates.js` still required a
`manifestType:"templates"` manifest — which 0035 retires — so after the migration every save/
save-over would have answered "Invalid template folder". And `apply_template` only supported
`append`/`replace`: **`merge` existed ONLY in the pipeline action**, so the plan's
`DEFAULT_APPLY_MODE = "merge"` would have silently appended. Task 5.5 adds
`utils/templatesFolder.js` (location is the marker), stops stamping the retired
`templateName`/`templateModule`, and ports identitySignature merge into `mergeSubtreeInto`
(unwrap root = contents-not-wrapper, `auto:<id>` signature fallback so an unsigned node still
matches itself — the rule that stops the 23-duplicate-wrappers bug).

**A template is named by its MODULE LABEL now.** 0035 unsets `meta.templateName`, and both
`TemplatesSection` and `QuickAddMenu` still read it — every template rendered "(unnamed)".
`templateLabelOf` is the one source. **Two test fixtures were still encoding the pre-0035 marker
shape**, which is the same trap as the cloneSubtree one, twice in one session: *a fixture that
carries both the old and new shape cannot fail when the old shape dies.*

**Verified against a REAL database on test grid 2** (never poms grid), diffing persisted state:
merge cloned 8 occurrences and PERSISTED them (+8 in Mongo), applied CONTENTS not wrapper (the
child is `Day Page[container]`, not the page wrapper), a second merge cloned **0** and wrote
nothing, and save-as-template left the source in place pointing at its own new module. Scratch
docs removed after; integrity **0 errors**. Both build ops still bind picker-direct
(`ktMxTVErceWq` / `9EZL5iXnYhul` present and referenced) — which is why wrapping Day Page in a
page was safe. **Probe lesson, again:** my first "applied contents not wrapper" assertion FAILED
falsely because the wrapper page and the container inside it are BOTH labelled "Day Page" —
discriminate by role/id, never by a label that legitimately repeats.

**APPLIED + DEPLOYED (user's call, asked first).** `0035` ran on poms grid, pm2 restarted, master
fast-forwarded (13 commits) and deployed; prod HEAD verified over SSH at `4f7cd493`. **A second
deploy at the end of the session carried the rest** — the integrity rule scoping, the ops
TEMPLATE_PICKER fix, the seed's page-shaped template root, and Build Schedule's slot re-link:
prod HEAD verified at `e0a353ac`, new bundle served (200), 413 server + 1547 client tests green.

**The deploy probes cost a sweep, again.** Loading prod three times to measure mobile scroll left
12 dangling child refs on Schedule Table / Schedule Canvas — the documented feedSync class, ids
timestamped to the probe runs. `sweepOrphans.js --apply` repaired them; poms grid and test grid 2
end at **0 errors**. `test grid 1`'s 6 `unsigned-template-node` is the frozen archive, still
deliberately untouched (2026-07-31 (4)). **The standing rule earned its keep for the third time:
a probe that loads the live grid writes to it — sweep before calling the session done.**

**`0035` MOVED A REAL PAGE AND HAD TO BE REPAIRED — the selector was wrong.** Its filter was
`occ.meta.templateName || module.meta.templateModule`. **APPLY_TEMPLATE COPIES `templateName` onto
every clone**, so `Project: Moduli v1 Launch` — the user's actual project page, `templateModule:
false` — matched and was swept out of its Projects folder into Templates. Restored by reading the
old `parentId` out of the runner's own pre-migration snapshot (that auto-snapshot is why this was a
one-command fix), and the selector now keys on `templateModule === true` ONLY, which apply_template
strips from what it mints. Re-run is a no-op. **CLAUDE.md 2026-07-31 (2) records this exact trap
and I walked into it anyway — when a migration selects "things that look like templates", the
copied marker is not evidence.** Lesson for any future migration: *verify what a selector matched
against a NAMED expectation before applying, not just the count.*

Also swept 12 pre-existing dangling child refs on Schedule Table / Schedule Canvas (the documented
feedSync `<epoch-ms>-<rand>` class, timestamped BEFORE the migration — not caused by it). Both
grids end at **0 integrity errors**.

**Open, flagged not fixed:** ~15 modules keep `meta.templateModule` on NESTED template nodes (0035
only unsets it on roots) and `utils/gridIntegrity.js:141` still uses that marker to identify
template roots — integrity reports 0 errors today, but the rule is now looking at the wrong nodes.
The ops editor's `TEMPLATE_PICKER_CONFIG` also still filters on `meta.templateName`, so the
APPLY_TEMPLATE action's picker lists nothing; fixing it needs `foldersById`+`gridId` threaded into
the deep prop-drilled picker ctx, which is its own pass.

---

### 2026-08-01 (21) — undo/redo: the SNAPSHOT layer was fine, the STACK was broken (5 defects, all measured)

User: *"review the undo and redo transaction feature, its buggy"* → then the decisive repro:
*"that works if im already in the textblock but when i type something, click off the textblock,
and control z, it wont undo the typing."* Plan + full evidence:
`docs/superpowers/plans/2026-08-01-undo-redo-stack-repair.md`. Pass 1 built; pass 2 (grouping,
labels, pruning) is scoped and not started.

**Entry (20)'s snapshot design is sound and is NOT what was broken.** Every defect sat one layer
up: which transaction Ctrl+Z targets, what counts as a step, and what order redo replays in.
Found by reading the LIVE transaction log, not the code.

1. **Ctrl+Z undid an OLD transaction, not the last one.** `useUndoRedo` cached `lastUndoableId`
   from `undo_state` and always sent it explicitly; the server honours an explicit id verbatim,
   so its own `nextUndoable` stack resolution was never reached from the keyboard.
   `refreshUndoState` ran on mount / gridId / undo result / sync_state — **never on
   `transaction_created`**. After N edits it still pointed at whatever was newest when the hook
   last synced, so undo restored a document several steps back while the newer transactions
   stayed `applied`. Fixed by sending NO id (server resolves the top) + re-syncing on every
   transaction, debounced 150ms. `undoTransaction`'s own `if (!transactionId) return` guard was
   the hidden second half — **a test caught that**, not inspection. The explicit-id path stays
   for the history panel, which legitimately targets one entry.
2. **No-op writes were undo steps.** The change filter compared whole snapshots and the server
   bumps `updatedAt` on every write, so nothing was ever filtered. **4 of the last 14 recorded
   docs differed ONLY by a timestamp** — roughly a third of undo steps did nothing on screen.
   Now compared with volatile keys (`updatedAt`/`createdAt`/`__v`/`_id`) excluded and top-level
   keys sorted; snapshots still STORE the timestamps.
3. **Redo replayed backwards.** `nextRedoable` sorted `sequence: -1`. Undo walks high→low, so the
   most-recently-undone transaction is the LOWEST-sequenced undone one — redo must sort ASCENDING.
   Descending re-applied the older `after` snapshot on top of state where the newer one was still
   reverted.
4. **The redo branch was never truncated.** Undo → fresh edit → Ctrl+Y replayed a stale `after`
   over the newer work. New `superseded` transaction state, set when a NON-derived transaction
   flushes. **Gating on non-derived is load-bearing:** the op sweep that runs right after an undo
   (sync_state → full_state → onLoad) is derived, and if that killed the branch, redo would be
   dead the instant you pressed undo.
5. **`flushAction`/`flushAll` had ZERO call sites** — the 1500ms idle timer was the only flush
   path, so an undo within 1.5s of an edit targeted the previous transaction and a reload inside
   that window lost the record entirely (write persisted, unundoable). Client now signals
   `close_action` when the outermost scope closes; server flushes after a **250ms** grace window
   — NOT zero, because socket.io preserves message order but each write handler awaits before it
   reaches `recordDoc`, so the close can be processed before the write it belongs to. `flushAll`
   on disconnect.

**THE USER'S REPRO, and the bug it exposed that the log could not have.** In-editor Ctrl+Z never
reaches our code — it is ProseMirror's own history, and `useKeyboardShortcuts` returns on
`e.defaultPrevented`. Click off and the app stack should take over. It didn't, because
**`setContent` in the content-sync effect had no `addToHistory: false`** (`Editor.jsx`), so every
server echo and every `full_state` pushed an entry onto that editor's local undo history. Each
textblock mounts its OWN nested `<Editor>` inside the parent doc's editor, so clicking off a
textblock moves focus to the PARENT — which now had history, consumed Mod-Z, called
`preventDefault`, and blocked app undo entirely. **And what it actually undid was the parent's
textmap reverting to a previously-synced state, which the debounce then persisted — a silent data
regression, not just a dead shortcut.** The same file already used
`tr.setMeta("addToHistory", false)` for its migration transaction; it was simply never applied to
the sync path. **Lesson: a remote sync is not a local edit. Any setContent driven by the server
must stay out of the editor's undo history — otherwise "did the editor handle this key?" stops
being a truthful signal.**

**Verified end-to-end against REAL Mongo on test grid 2** (never poms grid), driving the actual
socket handlers and asserting by DIFFING persisted state — the discipline entry (20) paid for:
undo ×3 reverts `2,1,0`, redo ×3 replays `1,2,3` (the old descending sort would have produced
`3,2,1`, so the assertion discriminates), an `updatedAt`-only write records nothing, and
undo-then-new-edit supersedes the branch and refuses the redo. Scratch occurrence + its 4
transactions removed after; test grid 2 back to 0, both protected grids untouched. 1504 client +
371 server tests, build clean.

**NOT DONE, deliberately:** clearing an editor's local ProseMirror history on a forced sync
(TipTap v3 exposes no supported reset; the routes are plugin re-registration or importing a
transitive `prosemirror-history` — not worth shipping unverified inside a correctness pass), and
pass 2 (one editing burst = one undo step, action labels, pruning the 6256 doc-less legacy
transactions on a dead grid). **Nothing deployed** — same call as entry (20): undo/redo records a
transaction on every write to live data.

---

### 2026-08-01 (20) — undo/redo REBUILT on document snapshots; and text in textblocks is selectable again

Two user asks, planned then built: `docs/superpowers/plans/` equivalent lives at
`~/.claude-account2/plans/parallel-gliding-wind.md`.

**Undo/redo was disabled (`UNDO_REDO_ENABLED = false`) because it silently did nothing. FIVE
separate defects, each verified before touching anything:**
1. **There was almost no history to undo.** Transactions were written in ONE place
   (`occurrences.js:212`) and only when `occurrence.fields` was non-empty. Creates, deletes, moves,
   **textmap edits**, and all module/field/operation/folder/view CRUD recorded NOTHING — so the undo
   handler's `occurrence_list` / `entity` / `doc_edit` branches could never fire.
2. The move inverse wrote `containerId`/`panelId` — **not fields on Occurrence** (placement is
   `parentId` + the parent's `occurrences[]`) — so strict mode dropped them and undoing a move did
   nothing.
3. Soft-delete toggled a `_deleted` flag in no schema, which no read path filters on.
4. Field restore wrote a raw scalar into `fields[fid]`, whose shape is `{value, flow}`.
5. The re-sync broadcast went to `io.to(userId)`, but sockets join `user:${userId}` — it reached an
   EMPTY ROOM, so even a correct DB write would never have repainted.

**Design (both decisions the user's):** before/after document **SNAPSHOTS**, and **one user action
= one undo step**. An inverse-op design fails SILENTLY for any mutation type nobody wrote an
inverse for — which is precisely how this broke, three times over. A snapshot is one code path for
every entity type and textmaps need no special design.

**Capture is nearly free** — every write handler already holds the prior state in the warm cache
(`setupGenericCRUD` merges `{...uc[cacheKey][id], ...entity}`; `update_occurrence` loads `prev`).
New `server/utils/txRecorder.js` buffers `{model, id, before, after}` per `actionId`; the client
mints the id (`helpers/actionScope.js`) and `safeEmit` — the single write chokepoint — stamps it on
every outbound write. A drop and its ~40 tracker writes become ONE transaction. Repeated writes to
one doc collapse to the **first `before` + latest `after`** (else undo restores a mid-cascade
value). Action-less writes (scheduler, feed sync) are marked `derived` and skipped by the stack.

**THE BUG THE END-TO-END CAUGHT, and the lesson.** Every unit test passed and the feature was
still broken: **Mongoose's `minimize` defaults to TRUE and strips empty objects on save — and it
does NOT inherit from the parent schema.** A snapshot of an occurrence whose `fields` is `{}`
persisted with no `fields` key at all, so undo's `$set: before` had nothing to clear the field
with and **the value the user had just added survived the undo.** Silent, partial, and invisible to
any test that never round-trips through Mongo. Fixed with `minimize: false` on the docs
subdocument; `transactionSchema.test.js` now pins it. **A persistence layer can drop data your
in-memory tests will never miss — verify undo against a real database, and verify by DIFFING state
before and after, not by watching it "look right".**

Verified on **test grid 2** (never poms grid — frozen): textmap restored byte-identical, added
field removed, textmap still stored compressed like every other row, redo re-applies, original
state restored after. 363 server + 1485 client tests, build clean.

**Text selection in textblocks — same family as the 2026-07-13 caret bug, one layer over.**
User: "i cant highlight text at all inside textblocks so i couldnt copy and paste it." Firefox
refuses caret placement AND text selection anywhere inside an element carrying the `draggable`
ATTRIBUTE. Pragmatic stamps it on everything it registers, and `InstanceTextblockNode` registers
the wrapper around the textblock's whole editable body. A disarm for exactly this already existed
in `dragSystem.js` — but that node calls Pragmatic **directly** instead of through `useDragDrop`,
so it never inherited it. Extracted as `disarmDraggableUntilHandle()` (the third copy of the
pattern) and applied; also closed the same gap in dragSystem's touch-branch mouse registration,
which had no disarm at all. **CSS was never the cause** — `index.css:1366` already forces
`user-select: text`; checking that first saved a wrong fix.

**NOT VERIFIED, and it can't be here:** jsdom cannot reproduce a browser's selection suppression
(it also silently drops `-webkit-user-drag`, so those assertions test jsdom, not the code). Only a
real Firefox confirms it. **Nothing deployed** — undo/redo starts recording a transaction on every
write and is a real behaviour change to live data, so that is the user's call.

---

### 2026-08-01 (19) — the Daily Question was never deleted; scrubbing a dangling embed REMOVED THE ONLY THING RENDERING IT

User: "theres stuff written in the journal container, a textblock, and no daily question container"
→ "right i accidentally deleted the daily question i think so just bring it back."

**Nothing was deleted.** Every day column still holds a Daily Question that its Journal lists as a
child. A Journal is `kind: "doc"`, so it renders its **textmap**, NOT its `occurrences[]` — and the
`moduleEmbed` node pointing at the Daily Question was missing. Listed but not embedded = present in
the data, invisible on screen. Same class as 2026-07-31 (2) ("you got rid of my trackers"), from a
new direction, and the screenshot matched the DB exactly.

Measured across all four columns before writing anything:
```
Jul 28  [moduleEmbed->Daily Question, paragraph]              ✅
Jul 31  [moduleEmbed->Daily Question, paragraph]              ✅
Jul 30  [paragraph]                                           ❌
Aug 1   [instanceTextblock->(the user's writing), paragraph]  ❌
```

**TWO different causes — confirmed against the pre-migration snapshots, not inferred:**
- **Jul 30 — `0032` caused it.** That Journal's textmap embedded a DETACHED Daily Question wrapper
  (`d4mix7d3`) while `occurrences[]` listed a different, healthy one. 0032 deleted the detached
  wrapper and correctly scrubbed the now-dangling embed — but that embed was the ONLY Daily
  Question being rendered, and the listed survivor had never been embedded. **The lesson, and it is
  a sharp one: removing a dangling reference is not automatically safe. If the reference was the
  only thing rendering a surviving sibling, the scrub IS the regression.** A dangling-ref cleanup
  should ask what the parent will render afterwards, not just whether the pointer resolves.
- **Aug 1 — NOT 0032, and the snapshots are what proved it.** The embed was already absent in the
  13:39:27 snapshot, taken before either 0032 run. Today's Daily Question was created 13:22:03 and
  linked into `occurrences[]` without ever being embedded.

**Migration `0033`** re-embeds any child CONTAINER a day-column Journal lists but does not reference
anywhere in its body. Append-only — nothing removed or reordered, the user's writing preserved
verbatim below the restored question. Idempotent. Verified: dry run named exactly the 2 broken days
and left the 2 healthy ones alone; after applying, all four match the healthy shape. **pm2
restarted** — the warm cache serves textmaps, so without it the user reloads into the old body.

**STILL OPEN — the durable half.** Today's column shows the build/merge path that mints a Daily
Question adds it to `occurrences[]` without writing the parent's `moduleEmbed`, so **tomorrow's
column will arrive broken the same way**. 0033 repairs data; it does not fix the builder. That is
the next thing to look at, and the place to start is whatever minted `62f81790` at 13:22:03.

**Probe note, cost one wrong conclusion:** my first tree dump printed `*** MISSING ***` for the
question wrappers and I nearly believed the grid was full of module-less occurrences — the modules
exist with an EMPTY-STRING label, and `modById.get(id)?.label || "*** MISSING ***"` renders `""`
as missing. The integrity check was right and the probe was wrong. **Falsy-coalescing on a label
is a lie whenever "" is a legal value** — and the standing rule applies to your own probe first:
check the probe before believing a failure.

---

### 2026-08-01 (18) — closing out (17): migration `0032` committed, and the recurring `missing-module` debris now has a TOOL

Picked up the previous session's uncommitted work. Two things, both verified against the live grid.

**`0032-detached-daily-question-answers` was already APPLIED but never committed.** Re-ran it as a
forced DRY RUN and it reports `nothing detached to remove` — so it converged and is idempotent, and
the file is now in git where the runner's applied-ledger (`grid.meta.migrations`) already claims it
is. Its own header records the important part: detached Daily Question wrappers / Daily Answer
textblocks are measured through `decompressTextmap`, never a regex over the raw document, because
raw reads store textmap COMPRESSED and a naive scan reports "no text" for everything — it would
have deleted journal entries. Nothing containing writing is ever dropped.

**The `missing-module` integrity error had no fix, only a fresh ad-hoc script each time.** poms grid
was carrying 2 module-less occurrences created at 13:21/13:22 that day — the documented
create/disconnect asymmetry one level UP from the dangling-ref case: the occurrence's own
`create_occurrence` survived the server queue and its MODULE's did not, so it renders as nothing,
forever. This is at least the third recorded round of the same cleanup (2026-07-30, 07-31, now), so
it went into `sweepOrphans.js` as a third pass instead of a fourth throwaway script.

The predicate is the conservative one the rest of that file already commits to — an occurrence is
swept only when it is **empty AND unreachable**: no text, no field values, no children, listed by no
parent's `occurrences[]` and embedded in no textmap. Anything failing any one of those is logged
with the reason and LEFT ALONE. Module lookup is keyed `${gridId}::${moduleId}` to match
`gridIntegrity`'s rule exactly, so a clean sweep actually clears the error rather than half of it.
Dumped RAW (textmap still compressed) to `backups/orphans/` before deleting — a restore has to be
byte-for-byte what was removed.

**Verified, in this order:** dry run reported exactly the 2 the integrity check named and **zero
false positives across all three grids** (that is the check that matters — the predicate is the
whole risk); applied; poms grid **1 error → 0**. `test grid 1`'s remaining
`unsigned-template-node` is the frozen archive, still deliberately untouched (2026-07-31 (4)).
347 server + 1472 client tests, build clean with the chunk sanity check holding.

**Not done, deliberately:** no pm2 restart. The documented restart rule is for `occurrences[]`
ARRAY repairs, where the warm cache is authoritative for reads and would re-serve the old array —
here whole documents were deleted that nothing references, so a cache still holding them changes
nothing observable, and it ages out on its own TTL.

**Pre-existing, NOT introduced here and NOT chased:** both poms grid and test grid 2 warn
`duplicate-field-name` on `due, calories, protein, carbs, fats`. It reproduces on the seed's own
target grid, so it is a SEED issue, not live-data drift — and it contradicts the standing
unique-field-names rule (2026-07-14 (5), which swept 11 duplicates and evidently missed these 5).
Worth a pass; it was out of scope for finishing someone else's migration.

---

### 2026-08-01 (17) — SOLVED. It was an empty LINE, and the user's "look at the heights" ended it.

User: "just look at the heights when you hover over todo. look at journal and daily question and
daypage container height changes." That reframing solved a six-round hunt in one probe — the thing
on screen was never something *appearing*, it was a **layout shift**.

**Measured first, hovering Todo** (`_heights.mjs`, real pointer input, console.table):
```
day column  592 -> 661  (+69)      Journal  195 -> 241  (+46)
Daily Question 142 -> 165 (+23)    Todo itself: 0        Notes/Tasks/Highlights: pushed down 46
```
+23 per nesting level, accumulating upward — and Todo, the thing being hovered, never moved.

**Root cause — `index.css:1734`, a plain DESCENDANT combinator:**
```css
.doc-editor-wrapper:hover .doc-editor-content.ProseMirror > p:last-child…{height:auto}
```
Every doc occurrence ends with a collapsed empty paragraph (`height:0`) that un-collapses on hover
so you can click and keep typing (2026-07-25, per user). But a NESTED doc container renders its
editor INSIDE its parent's `.doc-editor-wrapper` — so hovering anywhere in a day column matched the
COLUMN's wrapper and then reached **every nested editor's** trailing paragraph. Journal, Daily
Question and the column all un-collapsed at once, and all vanished on leaving the COLUMN. That is
the report, verbatim, from the very first round.

**`:focus-within` had the identical leak** in the same rule, accumulating UP the chain — a caret in
Daily Question also un-collapsed Journal's and the column's lines. Fixed in the same pass.

**Fix** — the guard the cog handle and empty-gap label already use, plus a child path pinning the
match to the wrapper's OWN ProseMirror (`.doc-editor-wrapper > div > .doc-editor-content`):
`:hover:not(:has(.doc-editor-wrapper:hover)) > * > …`. Exactly one trailing line can ever be lit.

**Verified on the live DOM** by swapping the rule in via CSSOM and re-measuring the same gesture:
```
                 dDay  dJournal  dDq   trailing lines lit
prod (leaking)   +69     +46     +23         3
fixed            +23       0       0         1
```
The remaining +23 is the INTENDED affordance (the innermost editor reveals its own line). `npm run
build` clean.

**Follow-up polish on that revealed line, same session, all deployed + measured on prod:**
- **Gap was too tall for an 11px line** — dropped the paragraph's `0.25em` top+bottom margins
  (= 5.5px, the user's "drop it like 5px"): reveal now adds **+18px**, was +23.
- **Caret sat flush against the container above** — the line is nudged down with
  `position: relative; top: 3px` rather than padding/margin, because the ask was explicitly "dont
  make the gap bigger tho, just shift the text down a little". Relative offset moves the PAINTED
  box only, so the gap keeps its (now smaller) height. Measured: text sits **3px** below the
  container above, container growth still exactly +18.
- **REGRESSION I CAUSED, then fixed:** keying the reveal to `.doc-editor-wrapper:hover` made a
  container's own trailing line UNREACHABLE once nested children filled its body — measured,
  Journal had **3px** of its own wrapper left to hover and the day column **0px**, so Journal's
  line never lit at ANY pointer position and there was no way to click a new line in (user: "i
  cant make a new line anymore and theres no gap"). The hover target is now the innermost
  `.container-shell` (header + padding included = always reachable), with a direct-child chain
  pinning the match to that card's OWN editor so it still cannot reach a nested one. Verified:
  hovering Journal anywhere lights Journal's line, hovering the column lights the column's, never
  two at once. **Lesson: an affordance revealed on hover must have a hover target that survives
  the element being full — check reachability, not just correctness.**
- **Placeholder text removed** (user: "dont write click to edit") — `Editor.jsx`'s default
  `placeholder` is now `""` instead of `"Click to edit…"`. Only the generic default is dropped;
  call sites that deliberately prompt keep theirs (ArtifactContent's "Start writing…"). Verified on
  prod: zero occurrences of the string anywhere on the page, both remaining `data-placeholder`
  attributes empty.

**The lesson, and it is the expensive one.** Entry (12) wrote *"idk if its a gap or an empty line"*
and entry (14) concluded from evidence that it was **not a gap** — both were RIGHT, and the next
round still went looking at gap/placeholder components. Rounds 4, 5, 9, 12, 15 all failed the same
way: each measured whether a suspected COMPONENT was lit, and never measured the one thing the user
kept describing — that **things MOVED**. A report about position or size is a layout question;
diff the geometry of the whole subtree before reaching for any component's state. And when the user
tells you which numbers to look at, look at those numbers first.

Retro on (16): removing the dead `.empty-placeholder-inline` was still correct, but it was not this
bug — it was noise cleared on the way.

---

### 2026-08-01 (16) — RETRACTION: entry (15)'s fix was INERT. The class it guarded is never rendered.

Went to verify the one thing (15) flagged as unchecked — the positive case, "hovering an empty
container directly should still reveal its own placeholder." It cannot be checked, because
**`.empty-placeholder-inline` is not rendered by anything.**

Proof, not inference:
```
grep empty-placeholder-inline  client/src/**  →  index.css only (+ two .md files)
grep empty-placeholder-inline  dist/assets/*.js  →  0 hits
grep empty-placeholder         dist/assets/*.js  →  3 hits   ← the method works
```
The sibling class proves the grep would have found it. The class died in the `Module.jsx` split
into ModuleRouter/ModuleContainer/ModuleInstance (it was introduced by that file, per the
2026-05-21 backup notes); the CSS was orphaned and nobody noticed for months.

**So entry (15) is wrong on both halves.** The rule it "fixed" styles nothing, so it could not have
been the cause of the user's extra lines, and it cannot have fixed them. Its "Verified: hovering the
column shows zero placeholders" was **vacuously true** — there was never an element there to light
up. That is exactly the failure mode this file keeps warning about, arrived at from a new direction:
I verified an ABSENCE and read it as a fix. **An observation that a thing is not visible proves
nothing unless you have first proven the thing can be visible.** Check the positive case FIRST.

**What actually renders an empty container's "Add new item":** `.insert-gap-empty-label` inside
`.insert-gap--empty` — `ui/InsertGap.jsx:98`, mounted from `ModuleContainer.jsx:1615` on the
`items.length === 0` branch. Its reveal rule is `index.css:2145`
(`.container-list:hover > * > .insert-gap--empty …`), already direct-child scoped back on
2026-07-26. That scoping is why it cannot bleed into a nested container — and it is the ONLY
selector worth touching if the placeholder misbehaves.

**Done:** dead rules deleted (a pointer comment left in their place); `npm run build` clean with
the documented chunk sanity check holding (tiptap 435 / highlight 969 / CommandCenter 203 /
PagePreviewApp 916). CSS-only removal of an unreferenced class, so the build IS the verification.

**STILL OPEN — the user's report is NOT fixed and never was.** Five rounds have now gone into it
(entries 4, 5, 9, 12, 15) and the element on screen has still never been identified. Entry (14)'s
probe found zero doc gaps and zero mismatch, which combined with this retraction means every
component blamed so far has been ruled out. **Do not write another fix.** The next action is the
one (12) and (14) both asked for and nobody has done: get `document.elementFromPoint(x, y)` — or a
right-click → Inspect — on the actual lines while they are visible, and report the class list.
Everything else is guessing.

---

### 2026-08-01 (15) — [RETRACTED by (16) — the guarded class is never rendered] it WAS a CSS issue: an unscoped descendant hover (user was right)

User: "they disappear when i hover off of the daypage container. are you sure its not a css issue."
It was, and that detail — vanishing on leaving the PARENT — is what identified it: the reveal was
keyed to the parent's `:hover`, not the element's.

`.container-shell:hover .empty-placeholder-inline` was a plain DESCENDANT selector, so hovering
anywhere in a day column revealed the "Add new item" placeholder in EVERY empty container nested
beneath it — Journal, Daily Question, Notes, Highlights simultaneously. Those faint strips are what
had been reported as stuck gaps all along. Fixed with the SAME
`:not(:has(.container-shell:hover))` guard the empty-gap label and the cog handle already use —
that guard was added to both of those in July (2026-07-26, same symptom, same cause) and simply
missed here.

**What this costs, recorded honestly:** four rounds of gap-state work (JS-owned hover, global
exclusivity, the doc-gap watcher, orphan-only sweeps) chased a component that was never involved.
Each was a real improvement and none of them could have ended the report. The tells were there
early — no `[gap] OPEN` lines, no reproduction under synthetic hover, and the user twice describing
behaviour keyed to the PARENT — and I kept fixing the thing I had already built instrumentation
for. **When a report survives three fixes to one component, the component is the wrong suspect;
re-derive from the user's description of WHEN it appears and disappears.**

**Verified:** hovering the column, mid-column, and at rest all show zero placeholders (was: every
empty descendant lit at once). **NOT verified:** the positive case — hovering an empty container
DIRECTLY should still reveal its own placeholder. The guard permits it (an empty container has no
nested shell to match), but it was not exercised; worth an eyeball.

---

### 2026-08-01 (14) — could NOT reproduce the nested-gap complaint; evidence says it is not a gap

Drove the pointer down eight points of a day column's own body and recorded, at each stop, which
container the pointer was in and which container (if any) was showing a doc gap:

```
pointerIn: Todo / Daily Question / Tasks Completed / …    gapShownIn: null    mismatch: false
```

**Zero doc gaps opened at any point, and no mismatch anywhere.** So the reported behaviour — gaps
popping up in Journal and Daily Question while hovering the parent — does not reproduce under
synthetic hover on the current build.

Combined with the user's own "idk if its a gap or an empty line", the weight of evidence now says
the thing on screen is **not a `.doc-insert-gap` at all**. Candidates worth checking first: an empty
paragraph / trailing empty line in a doc body, or the `is-empty is-editor-empty` placeholder (which
this probe DID find under the pointer inside the question container).

**Do not write more gap-state code until the element is identified** — entries (4), (5), (9) and
(12) all improved gap handling and none of them ended the report. The next move is
`document.elementFromPoint` / Inspect on the actual thing, not another state fix.

---

### 2026-08-01 (13) — a LONE column fills the panel; the width caps apply only to several

User: "if its 1 daypage or 1 schedule, it takes up the panel width wise, once we get multiple, we
want to cap it."

`flex-row` always applied `childMinWidth`/`childMaxWidth`, so a single day column sat at 560px in a
900px panel with dead space beside it. Now `soloColumn` (flex-row + exactly one visible child)
takes `flex: 1 1 auto; width: 100%; max-width: none`, and the row switches from `width: max-content`
to `100%` — max-content is what lets SEVERAL columns overflow into the horizontal scroll, and a
single one should stretch instead. Two or more keep the caps and the scroll exactly as before.

Generic to the renderer, so the **Schedule** gets the same behaviour for free — the user asked for
both and neither needed naming in code.

Verified live: one column now measures **877px inside an 891px panel** (was capped at 560).
NOT verified: the multi-column path, because only one day exists today — the caps are unchanged
code, but the two-column case has not been re-measured since.

---

### 2026-08-01 (12) — the first real capture said "healthy", and the target may not be a gap at all

The `[gap]` sweep finally fired on the user's screen:

```
where: Tasks Completed   why: hover   pointerInside: TRUE   hovered: true   hostThinksOpen: false
```

`pointerInside: true` means the pointer WAS inside that gap — it was behaving correctly. My watcher
labelled every lit gap "forced-open", which made a healthy capture read as a bug. It now reports
only ORPHANS (lit with the pointer elsewhere); a lit gap under the pointer logs as
`clean (N lit, all under the pointer)`.

**And the target may not be an insert gap at all** — user: "idk if its a gap or an empty line".
That reframes the hunt: an empty paragraph / trailing empty line in a doc body looks very similar
to a gap's highlight strip, and NONE of the gap instrumentation would ever see it. Before chasing
gap state again, identify the element: `document.elementFromPoint(x, y)` over the thing on screen,
or right-click → Inspect. If it has no `.insert-gap` / `.doc-insert-gap` ancestor, every fix in
entries (4), (5), (9) is aimed at the wrong component.

**Logging style — standing preference (also saved to memory):** use `console.table` for any
diagnostic with repeated fields, one row per candidate, columns chosen to DISCRIMINATE between the
competing explanations. The user called it out unprompted: the table above answered the question at
a glance where prose lines would have buried it.

---

### 2026-08-01 (11) — [SETTLED — see the note at the end] why today's day column never appears: a RANGE filter + an already-stamped marker

Root-caused from live data (the user's log kept showing `Grid: Snap Filter To Today` firing with
**0fx** on Aug 1):

```
marker "Last Opened"        = 2026-08-01      ← already stamped TODAY
Day Page board filterOverride = { value: "2026-07-30", unit: "day", span: 2, kind: "range" }
```

Two facts together explain it:
1. The board is pinned to a two-day **RANGE** (Jul 30-31), not a single day. `Snap Filter To Today`
   advances date-carrying pages on a new day, but this page's value is a `kind:"range"` shape.
2. The marker is ALREADY stamped 2026-08-01, so the op believes it has done its job for today and
   will not retry — which is why every subsequent load logs 0 effects rather than an error.

So the op ran once this morning, did not move the range, stamped the marker, and now no-ops
forever. `Day Page: Build` then builds for the days the filter names — Jul 30-31 — and today never
gets a column.

**NEEDS A PRODUCT DECISION, not a guess.** When a new day starts and a page is showing a multi-day
RANGE, it should either (a) shift the whole range forward by the elapsed days, (b) collapse to
today, or (c) stay put — which is what it does now, and is arguably correct, since a range is a
window the user deliberately chose and the op's whole design goal (2026-07-26) is that "a date you
navigated to survives a refresh". Picking (c) means the real fix is elsewhere: Day Page: Build
should ALWAYS ensure today's column exists regardless of the filter window.

Do not "fix" the marker or force the snap without settling that first — the same rule protects
every other date-carrying page on the grid.

**SETTLED (recorded 2026-08-01 (18) — the decision was made the same day but never written down
here, so this entry read as still-open for a while).** The user picked **(b), collapse to today**.
Migration `0031-collapse-day-page-range-to-today` carries it, and it shipped inside a
`deploy: update site` commit, which is why it left no trace in this file. Verified on the live grid:
the Day Page board's override is now the single day `2026-08-01` and today's column exists.

**The durable half is STILL OPEN, by the migration's own explicit scope.** `0031` un-stuck the grid
that was stuck that day; it did NOT teach `Grid: Snap Filter To Today` to collapse a range when a
new day starts, so **this recurs the next time a multi-day range is picked and left overnight**.
That fix changes a SHARED op governing every date-carrying page on the grid, which is exactly why
it was held back for its own reviewed pass. Start there, not at the marker.

---

### 2026-08-01 (10) — the Daily Question select expands on hover (absolutely)

A native `<select>` truncates its selected option and cannot marquee, so the long question was
unreadable. Hovering it now expands it to `width: max-content` (capped at `min(60vw, 560px)`)
**absolutely positioned**, so nothing around it reflows — the user was explicit that it must not
push anything, and that this is the SELECT only, not the randomize button (the rule targets
`.bound-header-select:hover > select`, so the segment beside it is untouched).

Hover cannot flicker: the expanded select is still a DESCENDANT of the hovered span, so `:hover`
on the parent stays true even though the select leaves the flow. `.bound-header-select` gained
`position: relative` as the positioning context. A `title` also carries the full text for the
keyboard/no-hover case.

**Verified only as far as the CSS** — confirmed present in the served stylesheet
(`index-BYEDAd4w.css`). The headless hover did NOT reproduce the expansion (the select reported
`position: static` under the probe's pointer, most likely because a doc-gap overlay sits over that
point and takes the hover), so the on-screen behaviour is UNCONFIRMED. If it does not expand in a
real browser, the first thing to check is whether the gap overlay is intercepting the pointer —
not the rule, which is definitely deployed.

---

### 2026-08-01 (9) — gaps stuck open because each editor owned its own, with nothing coordinating

User: "if i visit a gap, it will stick whenever i highlight a diff gap… gaps from the daily
question container and journal container are autoopening even if i hovered at the bottom of the
daypage container."

**Every doc editor holds a SEPARATE `docGap` state.** Per-editor clearing can never fix this,
because the editor that ought to clear is precisely the one no longer receiving pointer events —
it has no idea anything happened. So the claim is now GLOBAL (`claimExclusiveGap` in
`helpers/gapHover.js`): opening a gap anywhere closes whichever was open before. At most one gap
exists on screen, by construction, regardless of which of the several code paths set it.

Verified by travelling the pointer down a whole day column (11 stops, then resting at the bottom):
**max 1 open at any moment**, 1 while resting, 0 after leaving. Before, each editor left its own.

**OPEN — the Daily Question text still needs a marquee.** A native `<select>` truncates its
selected option internally and cannot marquee: `AutoMarquee` measures overflow, and a select with
`max-width:100%` never reports any. The fix is the pattern the Alarms tab already uses — render the
selected question as a real marquee span and lay the native select over it transparently for
interaction (`opacity:0`, absolutely positioned). Deliberately NOT attempted at the end of a long
session: it restructures a header that is one of the most-touched surfaces here, and I had already
shipped one ReferenceError today.

---

### 2026-08-01 (8) — the `####` header was 11px because of an INLINE style (the 5th time)

Traced by walking the computed chain from the `<select>` upward, which named the culprit in one
run: the select carried **`style={{ fontSize: 11 }}` inline** in `BoundHeader.jsx`. Its parent span
measured 13px — so the heading level had been applying correctly the whole time, and every
`HEADING_SIZES` bump was landing on the right element while an inline style on the CHILD overrode
it. An inline style beats any stylesheet rule regardless of specificity, so the `font: inherit`
added earlier never had a chance either.

Removed the inline size (padding kept); `font: inherit` now supplies family/size/weight from the
heading. Verified: select **11px → 13px**, matching its `####` level and sitting above the 11px
body text.

**This is the FIFTH recorded instance of the same trap** (AutoMarquee `display:block`,
ModuleInstance flex-wrap, the empty-pocket height, the instance label group's alignItems, now this).
The standing rule already in this file earned its keep again: **when a size or layout rule silently
does nothing, look for an inline style BEFORE anything else** — and note that two of the five were
found only by walking computed styles up the chain, not by reading source.

---

### 2026-08-01 (7) — type scale inverted at the bottom; trailing room for the last gap

- **Body text was BIGGER than the deepest heading** (13px body vs a `####` rendering 11), so the
  hierarchy read upside-down at the bottom. One step down was not enough — body is 11 now, and the
  heading scale is even 2px steps: **18 / 16 / 14 / 13**. Verified live: column 18, Journal 16,
  Daily Question 14, body 11.
- **Trailing room at the end of a doc container** (`.container-shell .container-doc` padding-bottom
  10px) so the last insert gap has somewhere to live instead of sitting flush against the bottom
  edge, PLUS a pointer grace band in `gapHover.js` (6px, **14px at the BOTTOM** — the worst case,
  since there is nothing below the last gap to re-enter). The two are complementary: the padding
  gives the gap a place to be, the grace band stops it releasing while you travel toward the "+".

**OPEN — the `####` question header does not follow the heading scale.** It renders 11px whether
its level declares 12 or 13, so it currently TIES body text instead of sitting above it. `font:
inherit` on the select is not winning against something that fixes 11px; the parent chain has not
been traced. Everything else in the scale is correct. Next step: computed-style walk from the
`<select>` up to find what sets 11px — do NOT keep bumping HEADING_SIZES, the level is not what
this element reads.

---

### 2026-08-01 (6) — I shipped a ReferenceError: `watchRegion is not defined`

Hovering the day page crashed the panel. My edit added the `watchRegion(...)` CALL to `Editor.jsx`
but the import line was inserted with a `.replace()` whose anchor string did not exist — and unlike
every other edit in that script, that one had **no assert**. The self-check I did print
(`"watchRegion" in s`) was satisfied by the call I had just added, so it reported success while the
import was missing.

**Two rules this cost, both cheap:**
1. **Assert every replace, including the import.** A silent no-op replace is indistinguishable from
   success at the string level.
2. **Run `npm run build` before deploying a cross-module edit.** The test suite passed — Editor.jsx
   is not directly unit-tested — but a build resolves imports and would have failed instantly. Tests
   green is NOT evidence that a module resolves.

Verified after the fix by driving the pointer down the whole day column (14 positions, the exact
gesture that crashed): 5 panels still rendered, ZERO page errors.

---

### 2026-08-01 (5) — it stuck again: the DOC gap is a second, separate implementation

The user's screenshot put the stuck bars inside DOC BODIES (the answer area, the Notes body).
Those are not `InsertGap` at all — `.doc-insert-gap` is a SEPARATE implementation living in
`ui/Editor.jsx` (`docGap` state), which happens to paint the same `.insert-gap-line`. So the
2026-08-01 (4) JS-hover fix, which only covered `.insert-gap`, could not have helped them — and my
watcher could not even SEE them, because it queried `.insert-gap--open` only.

- `helpers/gapHover.js` gained `watchRegion(el, onLeave)` — the same rect re-test, reusable.
  `Editor.jsx` clears `docGap` through it instead of trusting `mouseleave`, which cannot fire when
  the layout shifts under a stationary pointer.
- The sweep now queries `.insert-gap--open, .insert-gap--hot, .doc-insert-gap` and labels each row
  `why: DOC gap | menu-open | hover`, plus `pointerInside` — so the next report says which
  implementation and whether the pointer was even over it.

**NOT VERIFIED.** The probe could not raise a doc gap to test against (it only appears in the
gutter BETWEEN blocks; `isOverTopBlock` suppresses it over content), so the reflow case was never
actually exercised for this path — "0 lit" in that run means the probe failed to set up, not that
the fix works. Treat this as deployed-but-unproven until either the user confirms or a probe lands
a real doc gap first.

**Standing lesson, now paid for three times:** two different components render the same-looking
blue line. Before fixing "the highlight", identify WHICH element is lit — the sweep now reports it.

---

### 2026-08-01 (4) — the stuck highlight was a STALE `:hover`, not a state leak

The user's log settled it: **zero `[gap] OPEN` lines** — no menu ever opened — plus "if i go back
over the highlight, it disappears again". So it was never the forced-open state fixed on 07-31.

**A browser only re-computes `:hover` when the POINTER MOVES.** Moduli reflows constantly under a
stationary pointer — the on-load op drain in the user's own log is 580ms / 124 effects — so a gap
that was hovered keeps `:hover` after the layout shifts out from under the cursor, and stays lit
until the user moves back over it and away. That is exactly the reported behaviour, and nothing in
CSS can correct it: `:hover` is the browser's to own.

**Fix — hover is JS-owned now** (`helpers/gapHover.js`, NEW). `.insert-gap--hot` drives the reveal
instead of `:hover`; a gap claims hover on pointerenter, and one shared document listener re-tests
the pointer against the claimant's CURRENT rect on pointermove, on scroll, and on any
ResizeObserver hit — the layout-change case `:hover` cannot see. A 1s sweep also strips `--hot`
from anything left orphaned by an unmount.

**Reproduced, finally** — hover a gap (1 lit) → force a reflow with the pointer STATIONARY → 0 lit.
Before the fix that middle step stayed lit. That reproduction is the thing three earlier rounds
lacked; the earlier probes all moved the mouse, which is precisely what hides this bug.

**Lesson worth keeping: the absence of a log line was the evidence.** No OPEN lines meant the whole
forced-open theory was wrong, which is what pointed at `:hover`. Instrument the thing you believe,
then believe the silence.

---

### 2026-08-01 (3) — the question header: #### and actually sized; gap logs made visible

- **The inner question container carried NO headingLevel**, so it fell to the level-1 default and
  printed a single `#` four levels deep. It is `####` now (`0030` + the builder): column `#` ›
  Journal `##` › Daily Question `###` › the question `####`.
- **"It doesn't even look like a heading" was a `<select>` quirk** — a select does NOT inherit
  font, so the bound header rendered at the UA's 11px regardless of the level it declared.
  `font: inherit` on `.bound-header-select > select` makes the declared level apply. Measured
  after: hash `####`, question 11px / weight 500 against the 9px "Answer", so the question reads
  above its answer as asked. (The 11 vs the level's 12 is an intermediate wrapper's size — visible
  hierarchy is right, the 1px is not worth another round.)
- **The `[gap]` logging printed NOTHING in a quiet session** and read as broken (user: "i didnt see
  logs for the gap"): it only spoke on open/close. It now announces itself on load and watches on a
  3s timer, reporting ONLY when something is actually stuck — a stuck line can appear without a
  close ever firing, which is exactly the case being hunted.

**OPEN — today's day column did not build.** User: "daypage didnt open for today (once) like
schedule." The board still shows Jul 30-31 on Aug 1. NOT investigated yet. First place to look:
the board's own `filterOverride` is pinned to a MULTI-day selection (Jul 30-31), and
`Grid: Snap Filter To Today` moves date-carrying pages forward on a new day — check whether it
skips multi-day shapes, since a multi selection is exactly "a date the user navigated to", which
that op deliberately preserves. Verify against the live filterOverride before changing the op.

---

### 2026-08-01 (2) — wider columns, weekday names, a readable heading step, question marquee

- **Column width is a cascade rule now** (`childMinWidth`/`childMaxWidth`, `0028`) instead of
  PageBoard's hardcoded 280/360. That matters because the SCHEDULE uses the same flex-row renderer
  — bumping the constant would have widened it too. Day Page is 420-560; the default is unchanged
  for everything else, and the width is settable from the page's Layout menu.
- **`##` vs `###` were 15px and 14px** — indistinguishable, so a nested section looked identical to
  its parent (user: "looks like the same size despite diff headings"). Every level now drops at
  least 2px AND loses weight: `{1:18/700, 2:15/650, 3:13/550, 4:12/500 …}`.
- **The Daily Question header marquees** (`meta.labelOverflow: "marquee"`). Bound headers truncate
  by DEFAULT on purpose (2026-07-31, "a control is not prose") — but the question IS prose, reading
  it is the whole point, and it rarely fits a column. Set per-module as data, so the default stands
  for every other bound header.
- **Columns are named "Friday, July 31st, 2026"** (`0029`) via the `dateLong:` token — the same one
  the Schedule's day-columns already use, so both surfaces name a day identically. Renamed by DATE
  rather than by parsing the old label, and a column the user has since renamed by hand is left
  alone.
- Verified live: 560px columns, weekday names, Journal 15/650 holding Daily Question 13/550,
  marquee present, zero page errors.

---

### 2026-08-01 — `[gap]` diagnostics for the stuck insert lines; Daily Question nests under Journal

**Diagnostics (`helpers/insertGapDiag.js`, NEW).** The stuck blue insert lines still happen "a
bit" after the unmount-close fix, so this instruments the three ways it can happen instead of
guessing a fourth time. ON by default (`window.__gapDiag = false` mutes), same posture as
`caretDiag` — a user-facing bug needs zero setup to capture.
- `[gap] OPEN <container>#<index>` / `[gap] CLOSE … via transition|UNMOUNT-while-open` with how
  long it was held, so a stuck line shows as an OPEN with no matching CLOSE.
- `[gap] SWEEP` runs 900ms after every close, and `window.__gapStuck()` runs it on demand. **The
  sweep is what separates the causes**, because it reports each stuck element with BOTH facts:
  `hostThinksOpen` (React still believes the menu is open → a state leak) vs a forced-open class
  with no host claim (→ the class outlived the state) vs a line lit with NO class at all (→ a
  `:hover` that never released). The answer is in the log line, not in a follow-up round trip.
- Ask for the `[gap]` lines plus one `__gapStuck()` at the moment a line is stuck.

**Daily Question now lives INSIDE Journal** (`0027` + the builder), at `###` — it sits in a `##`,
so it is a level deeper. The load-bearing part is `allowChildContainers` on Journal, set BEFORE
anything is re-parented: a container renders child CONTAINERS only with that flag, and moving the
question in without it would have made it vanish while sitting perfectly well in the data — the
exact failure that read as "you got rid of my trackers" on 2026-07-31. Verified live: Journal `##`
15px holding Daily Question `###` 14px, nothing left at column top level.

---

### 2026-07-31 (8) — the frozen quick-add lines: a menu that UNMOUNTS while open never reports its close

User, with a screenshot showing five blue insert lines pinned at once: "do you see all the frozen
highlight quick add buttons. they get stuck".

**`QuickAddMenu.onOpenChange` fired on open/close TRANSITIONS ONLY — which the transition effect
can only observe WHILE MOUNTED.** Unmount an open menu and the host never hears the close.
`InsertGap` holds `insert-gap--open` for exactly as long as it believes the menu is open, and that
class FORCES the blue line visible (it exists so the gap can't collapse out from under an open
menu). So every menu that got unmounted while open pinned its line permanently — and a doc/board
list re-render is enough to unmount one, which is why they ACCUMULATE over a session and why
hovering never reproduces it. The menu now reports `false` from its unmount cleanup.

**Method note, worth keeping:** the `:hover` reveal was ruled OUT by probe first (hover five gaps,
move away → zero lines visible), and the culprit was then identified from the screenshot's
GEOMETRY — the bars are ~50% container width, centered, which is the `.insert-gap-line` strip
(2026-07-24) and not a drag indicator or a doc gap. Measuring what it ISN'T is what made the
remaining explanation findable without a repro.

**Honest limit:** I never reproduced the original stuck state end to end — I found and closed a
leak that produces exactly that symptom. If lines still stick, the next thing to check is whether
`InsertGap`'s host is remounting for another reason, not the menu contract.

---

### 2026-07-31 (7) — day columns: content height, bare date names, horizontal scroll

- **Full content height** (`0026`): the 420px `childMaxHeight` is cleared, so a column is as tall as
  its day. That cap was my remedy for a hover-expansion shove; the user would rather see the whole
  day on load, and the Layout menu can put a cap back if it ever bites. Verified: wrap 667 ≥ shell
  663, nothing clipped.
- **Names lose the "Day Page - " prefix** — the BOARD is already called Day Page, so every column
  repeated it. Renamed the existing columns AND patched `rootLabel` in the stored Build op (and the
  builder): without the op change the prefix returns on the next new day. Columns now read
  "2026-07-30" / "2026-07-31".
- **Horizontal scroll needed no code** — `mode:"flex-row"` already gives the board a
  `width:max-content` row inside an `overflow-x:auto` scroller, so picking a week in the filter
  widens the board instead of squashing the columns. Measured: scrollWidth 742 > clientWidth 542.
  The migration ASSERTS the board is still flex-row and throws otherwise, so a regression surfaces
  as a failed migration rather than a squashed page.

---

### 2026-07-31 (6) — the day-column header was overflowing its own row

From the screenshot: headers unpadded, text too big, columns not lining up. All ONE cause, found by
measuring rather than eyeballing — **the header row is locked to `height: 20px`, but the 22px
heading label rendered 35px tall STARTING 9px ABOVE the row**. It overflowed its own header, which
is why the text read as unpadded, why the rows looked cramped, and why the two columns didn't
align (the overflow interacts with the marquee, so each column settled differently).

- A container with `meta.headingLevel` no longer takes the fixed-height branch: it sizes to its
  text with real padding on all four sides (`6px 10px`), and the label drops the `-1px` nudge that
  exists only for the small fixed-height headers.
- `HEADING_SIZES[1]` 22 → **18** (bold, as asked); level 2 → 15 so the step is still legible.
- Nested/embedded section header top padding 6 → **3px**.
- Day column `childMaxHeight` 600 → **420**.
- Verified on prod: both columns identical (wrap y=87, header y=92 h=36, body y=128), label now
  INSIDE its header (y=98 h=23, was y=83 h=35), 18px/700, padding `6px 10px`.
- **Still open, unasked:** at 18px the title still overflows a 360px column, so it marquees
  continuously. Truncating would read calmer — say the word.

---

### 2026-07-31 (5) — the layout MENU wrote a key the renderer never read

User: "do a full sweep on the layout view menu and make sure thats hooked up so i can change the
boards layout."

**Two independent breaks, both silent.**
1. **Nothing to change.** `LayoutCascadeEditor` exposed only the six VIEW-MODE rules. The layout
   shape PageBoard actually consumes — `mode` / `columns` / `childGap` / `sortChildrenByField` —
   had NO control at all. The Schedule is side-by-side only because Build Schedule stamps
   `mode:"flex-row"` from an op. Editor now has Arrangement (Stack/Columns/Grid), grid columns,
   gap, max height, order-by.
2. **The write went to the wrong key.** For a page/container the menu writes `meta.layoutCascade`
   (the push-DOWN slot), but a page rendering ITSELF resolves as the LEAF — and the leaf layer
   only ever read `meta.layoutCascadeOverride`. So a layout set from the header menu was stored
   somewhere its own renderer never looked.
   **Fix: `SURFACE_SHAPE_KEYS` + `pickSurfaceShape`** — shape keys describe how a surface arranges
   its OWN children, so they apply to the surface that declares them. View-mode keys deliberately
   still push down only: a container saying "my children render as chips" must not become a chip.
   That distinction is the whole fix; 8 tests pin both halves.

- **Day page is side by side** (`0025`): `flex-row`, ordered by the date field, `childMaxHeight:
  600` so a column scrolls inside itself. Written to the SAME slot the menu writes, so changing it
  in-app replaces this instead of fighting an op. Verified on prod: same y, distinct x, 360px each,
  chronological.
- **`#` now reads as `#`.** The STANDARD container header ignored `meta.headingLevel` entirely and
  rendered a fixed ~15px, while an EMBEDDED `##` section renders 16 — so a day COLUMN was
  SMALLER than the sections nested inside it. Standard headers size by heading level now, and
  `HEADING_SIZES[1]` 18 → 22 so the gap between `#` and `##` is the widest in the scale.
  Container labels also got the 2px of air above them that was asked for.
- **OPEN — the sticky hover button.** Measured, not fixed: hovering inside the Daily Question grows
  that box ~76px (an empty add-pocket at y=623 jumps to 699 and back), and that reflow is what
  makes the hover target slip. The height cap bounds the damage; WHICH element grows is still
  unidentified. Don't guess at it — reproduce with the hover probe and find the growing node first.

---

### 2026-07-31 (4) — the signature invariant is now a GATE, and it caught a second armed bug immediately

`gridIntegrity` gained two rules so the 07-31 (3) duplication class cannot go silent again:
- **`unsigned-template-node` (error)** — any occurrence inside a TEMPLATE subtree with no
  `identitySignature`. Template roots are found from `meta.appliedFromTemplateId` on clones plus
  modules carrying `meta.templateModule`. The ROOT is exempt (it is matched by the apply target).
- **`duplicate-template-section` (error)** — the damage rule: a template-applied page holding the
  same section container twice, ignoring anything multi-parented in (its `parentId` points
  elsewhere), so the Schedule's Todo is never counted or "deduped".

**Deliberately NOT checked: the clones' own children.** Merge only ever duplicates TEMPLATE nodes;
a column's other children are whatever the user typed, which has no template counterpart and is
rightly unsigned. A blanket clone-side rule would have flagged every journal entry — the check
would have been noise on day one. Scope came from asking what merge actually matches on.

**It found a second armed duplicate-bomb the moment it ran.** `buildProjectTemplate` wrote each
kanban column's `identitySignature` into the **MODULE's `meta`** — but `identitySignature` is a
TOP-LEVEL field on the OCCURRENCE (schema, 2026-05-14). So those signatures had never done
anything, and re-applying the Project template would have cloned all six columns exactly the way
the Day Page cloned its sections. It just had not gone off yet, because projects are created
rarely. Builder fixed (columns + the Kanban container + the scope textblock), migration `0024`
signs the template on the frozen grid.

- **The seed is the enforcement point**: it already fails on a structurally invalid grid, so this
  is a gate, not a report. Proven by RESEEDING test grid 2 (the seed's own target) and getting a
  clean run — that is what shows the builder fix is right, not reading the diff.
- **`test grid 1` still reports 12 unsigned nodes and is left alone on purpose** — it is the frozen
  ARCHIVE of the old live grid, holding the pre-fix shape. Migrations target `poms grid`; mutating
  an archive to quiet a checker would be the wrong trade.
- Probe debris swept again (6 dangling refs on Schedule Table + Schedule Canvas, all
  `<epoch-ms>-<rand>` client-minted ids from this session's loads — the documented feedSync source).
  poms grid + test grid 2: **0 errors**. 347 server tests (9 new).

---

### 2026-07-31 (3) — the day page duplicated because merge matches on a SIGNATURE, and children need one too

User: "the daypage for yesterday added all the sections twice" — and today's Daily Question had
quietly collected **23** empty question wrappers, one per app load.

**`APPLY_TEMPLATE mode:"merge"` decides "this already exists" by `identitySignature`, and it
RECURSES into whatever it matched.** Two separate gaps, both fixed:
- **Sections** (`0022`): migration `0018` converted the old per-day PAGES into columns and kept
  their sections as they were — with NO signature. Every merge since looked for `daypage:Journal`,
  found nothing, and cloned a second Journal beside the user's. Signing the existing sections is
  the actual fix; deleting the clones is cleanup. 07-28 was unsigned too and would have duplicated
  on its next build.
- **The section's CHILDREN** (`0023` + the builder): signing the section only stops the SECTION
  being re-cloned. Merge then walks inside it, finds the question container unsigned, and clones
  that — every single load. The template now signs `daypage:Daily Question/question` and
  `/answer`. **Signing a node without signing its subtree just moves the duplication one level
  down.**
- **Repair safety, both migrations:** the keeper is whichever copy holds writing, and anything
  containing text is NEVER deleted (it logs and keeps both instead) — a duplicate section is a
  nuisance, a deleted journal entry is not. Todo is skipped entirely: it is the Schedule's own
  container multi-parented in, so its `parentId` points elsewhere, which is the discriminator used.
- **Verified by REPEATING the trigger, not by reading the code**: two full app loads (each runs the
  build op) left every column at exactly one of each section and one wrapper. That is the only
  proof that matters for an idempotency bug.

**Artifact occurrences look like objects again** (user: "it needs to look like a draggable thing.
right now it just blends with the background"). The 2026-06-11 rule stripped the row's card chrome
so the picture alone was the visual box; with the frame gone the occurrence dissolved into the
surface. The row keeps normal instance chrome now, and `.instance-content:has(.artifact-card)`
top-anchors the drag handle (a row with no field pills was being centred by the single-line rule —
an artifact row is never a single line).

---

### 2026-07-31 (2) — "you got rid of my trackers" was a RENDER flag, not deleted data

**Nothing was deleted.** The user reported Workout Log and other trackers gone; the DB had every
one of them (Workout Log, Reps, the six Volume tiles, Meal Log, Meal Nutrition) correctly parented.
**A container only renders child CONTAINERS when its module carries `meta.allowChildContainers`** —
and when the tracker tiles were nested (Workout+Nutrition→Physical, Media→Intellectual,
Planning→Occupational), the re-parenting landed but the flag didn't. So the nested groups and every
tile inside them dropped off the page while the data sat untouched. The Routines dimensions carry
the flag, which is why the identical nesting works there. Migration `0021` sets it on any Trackers
container that HOLDS a container (structural, so it can't drift as more groups get nested).
**The lesson is the one this file already records, from the other direction: the DOM is ground
truth. A tree that reads correctly in Mongo can still render nothing.**

- **Day-page heading levels + colours** (`0020` + `0021`): the day COLUMN is `#` (it holds the
  date), every section is `##`, and the heading TEXTBLOCK that repeated the column's own title is
  deleted — verified to hold only the date string before removing any. Sections take the nine-
  dimension vintage palette (Todo rust · Daily Question plum · Journal teal · Notes avocado ·
  Tasks Completed green · Highlights mustard). The renderer prints one hash per `meta.headingLevel`,
  so no code learns which containers these are.
- **TWO migration selectors were wrong and the DRY RUN caught both** — worth repeating because both
  markers look authoritative and neither is: `meta.appliedFromTemplateId` sits on every Schedule
  ROUTINE CLONE too (the first dry run was about to make 30 workout instances heading level 1), and
  `meta.templateName` is COPIED onto every clone by APPLY_TEMPLATE (so it resolved to a day column,
  not the template). **The template is the one whose MODULE still has `meta.templateModule: true`** —
  apply_template strips that from what it mints. Resolve day columns as the board's children.
- **`$set: { "ownStyle.bg": … }` throws when `ownStyle` is null** ("Cannot create field 'bg' in
  element {ownStyle: null}") — write the whole object.
- **Instance rows: the inline-style trap, for the FOURTH recorded time.** "The people's names still
  aren't aligned at the top" after a CSS fix that looked right — the label group's
  `alignItems: "center"` is an INLINE style in `ModuleInstance.jsx`, which beats any stylesheet rule
  regardless of specificity. Fixed at the source (`hasInlineThumb`), not with `!important`.
  **When a rule silently does nothing, check for an inline style before anything else.**
- **Artifact cards: filename UNDER the image** (user reversed the earlier "above"). The info block
  already had `order: 1`; the name just had to stop being hidden, and the row label above it is
  suppressed so the name reads once. That then exposed a second rule — `.instance-body:has(
  .artifact-card){flex:unset}` sizes the body to content, and `.instance-content` is
  `space-between`, so the card was shoved to the right edge leaving the gutter the caption used to
  fill. `--with-info` cards now take the row width (same specificity, so it must stay AFTER that
  rule in source order).
- 1462 client + 338 server tests, deployed, all four verified on prod with measurements AND
  screenshots (label delta 0px from the image top, filename below the image, nested trackers
  rendering, six distinct section colours).

---

### 2026-07-31 — the day page is DAY COLUMNS, template-driven; Tasks Completed is a board

**The day page works like the Schedule now** (user: "make daypage work like the schedule. with
containers being the days. these would be doccontainers with other containers inside of it").
Migration `0018`, applied to poms grid, deployed, verified live.

```
Day Page  (board page — pinned ONCE)
  └─ Day Page - 2026-07-31    day COLUMN, kind:doc, carries the Date field
       ├─ Daily Question → the question → Daily Answer
       ├─ Todo                the Schedule day-col's OWN container, multi-parented
       ├─ Journal / Notes / Tasks Completed / Highlights
```
- **This retires the ADD_CHILD pinning bug by construction** — there is no per-day page to pin, so
  the hub keeps one tab instead of gaining one every morning (it had three plus a junk
  `[object Object]` module by day three; the module is deleted).
- **It answers filters like the Schedule**: the column carries the Date field and the op targets
  the BOARD page, so an on-page date switch (which never touches the grid filter) builds and shows
  the days you are looking at. Verified live: only today's column renders under `Fri, Jul 31`.
- **TEMPLATE-DRIVEN, both directions** (user: "id also like to change the template on the fly so it
  updates" / "add to it and save the template so i can save my daily routine"):
  the column body is rebuilt from the column's OWN children (the op no longer owns a hardcoded
  section list — that is why a section added to the template used to be cloned but never rendered);
  every template section carries an `identitySignature`, so `mode:"merge"` tops up days that ALREADY
  exist with sections the template has gained and leaves what the user wrote alone; and each column
  is stamped `appliedFromTemplateId`, which is what lights up **"Save over Day Page"** in the header
  dropdown.
- **Where the templates live** (asked directly): `Schedule Template` is a real `page/board` at
  **Library › Templates**; `Day Page` (`ktMxTVErceWq`) is in the separate **Templates manifest**,
  reachable from Command Center → Templates. Both are ordinary modules + occurrences.

**`Tasks Completed` is a BOARD like Todo** (user: "it says click to edit instead of add new item") —
its tasks are CHILDREN now, not moduleEmbeds painted into a doc body. That needed a new pipeline
verb: **`REMOVE_CHILD`**, the exact inverse of ADD_CHILD. It matters because these children are the
SCHEDULE's own occurrences multi-parented in — tidying the list with `REMOVE_OCCURRENCE` would
delete the user's task out of their Schedule. The sweep's keep-test is the add predicate verbatim
with the unlink on its ELSE, so the two cannot drift.

**Also fixed:** habits (Sleep) no longer fill Tasks Completed (module-BINDING discriminator, `0013`);
Sleep's Duration binding was BACK after `0007` and is unbound again — found structurally (the Sleep
module carrying the Habit marker; there are two "Sleep" modules and the other legitimately binds
Sleep Time); **Daily Question resolved zero options because the FIELD WAS TYPE `text`** —
`resolveOptions` returns nothing for any type but select/occurrence on its FIRST line, so the
117-question pool never had a chance (everything the previous session ruled out was genuinely fine);
the question is a section wrapping a bound question container so it renders ONCE; a bound header
truncates instead of marqueeing (a control is not prose); Examples' three dead sample links
repointed after checking each for a 200 (`0014`); image cards stack with the caption under them.

**Two traps worth keeping:**
- **Replacing a function by SPAN swallows its neighbours.** Rewriting `makeDayPageBuildOp` by
  index-slicing the file also deleted `makeProjectCreateOp` + `makeProjectStatusRouterOp`; the seed
  caught it on import. Restored verbatim, then *diffed the exported function and const lists against
  HEAD* to prove nothing else went. Do that diff after any span surgery.
- **A migration that asks "who links X?" will match the thing that OWNS X.** The unpin step matched
  the board itself (it lists day pages — they are its columns), stripped its columns and made it its
  own child. Caught by reading the board's children back after applying. Always read the result back.

---

### 2026-07-30 (8) — the day page CRASHED the app: a LOOP iterated the whole grid

User: "the daypage is crashing the app." Not an exception — a **dead renderer**. Today's
`Tasks Completed` container held a `moduleEmbed` for **every one of the grid's 1280 occurrences**,
the day page that contains it included, so painting the page was unbounded work and Chromium killed
the tab. That page is the hub panel's ACTIVE tab, so the whole app died on load (the probe saw
`page.on("crash")` with zero `pageerror` lines — a crash, not a throw).

**Two executor gaps in the LOOP step, both fixed (`operationExecutor.js:2083`):**
- **`over: "$allInstances"` iterated everything.** That is FIND's spelling for a collection and the
  Tasks Completed builder used it on a LOOP; LOOP only resolved `overExpr`, so the step fell through
  every `gatherLoopItems` branch to its `let occs = Object.values(occurrencesById)` default. A
  `$`-led `over` now resolves as an expression — a legacy typed collection is a bare word
  (`field_occurrences`, `occurrences`, `templates`), so the two spellings cannot collide.
- **`predicate` on a loop step was ignored outright** — the three rules narrowing the pool to
  today's completed tasks never ran. It now filters via `evalGroupAgainstRecord`, exactly as FIND's
  predicate does (rule lefts are RECORD paths, not `$var` expressions).
Either gap alone yields garbage; together they wrote the whole grid into a document. 2 tests.

**This is the SECOND time this class has bitten** (see 2026-07-30 (7): "a LOOP whose `over` is a
nested var path silently iterates EVERYTHING"). Same silent default, different spelling. The
executor now handles both — but the standing rule stands: **a LOOP's `over` is not FIND's `over`;
check what the step actually iterated before trusting a pipeline that "looks right."**

**Migration `0012`** empties any Tasks Completed body embedding something other than a task
occurrence (the honest test — a real busy day has many embeds; ONE embed of the page itself is
enough to hang the tab). Applied to poms grid (679/1280 embeds bad) and test grid 1 (864/864).
**Order matters: deploy, THEN migrate** — a tab on the old bundle re-poisons the container on its
next load; pm2 restarted after the write so the warm cache re-reads it.
1451 client + 329 server tests, all three grids 0 errors, deployed (`aff4142e`), prod-verified: 5
panels render, day page paints heading · Daily Question · Todo · Journal · Notes · Tasks Completed
(11 real entries, all instances) · Highlights. **Items 2 and 3 below are still open.**

---

### 2026-07-30 (7) — the day page builds daily + journal/notes/todo sections. THREE ITEMS STILL OPEN

User: "make sure the daypage is working on poms grid … add in writing sections in the necessary
spots. like a journal todolist notetaking daypage." Spec:
`docs/superpowers/specs/2026-07-30-day-page-design.md`. Migration `0011`, applied to poms grid.
Page order: `# Day Page - <date>` · Daily Question · **Todo** · Journal · Notes · Tasks Completed ·
Highlights. 1449 client + 329 server tests, all three grids 0 errors, deployed.

**START HERE — three things are OPEN, in priority order:**
1. **`ADD_CHILD` does not pin the new day page to the hub panel.** The page IS minted and complete
   in the DB, but never joins the hub's tab strip — so the user correctly reported "that was the
   only day page created" while I kept reporting success from DB queries. Repaired 07-30 by hand
   (`$push` into `rkN14S6dVkeG.occurrences`); **it will recur tomorrow.** The `ADD_CHILD
   parentId=<hub> childId=$newDayPageId` sits in the mint branch — suspect `$newDayPageId`
   (`APPLY_TEMPLATE`'s `rootIdVar`) comes back empty and ADD_CHILD silently no-ops. Verify the
   binding.
2. **Daily Question header shows "(no options — check pool predicate)".** RULED OUT already, do not
   re-check: the field IS `inputEnabled`; `meta._resolvedOptions` is undefined (so BoundHeader:56's
   early return is NOT short-circuiting); BoundHeader passes a correct ctx; `$allInstances` is a
   valid COLLECTION_KEY; `conjunction:"AND"` is harmless (operator defaults to AND);
   `buildCollection` DOES merge the module label — which matters, because the 117 question
   occurrences carry `label: null` and the text lives on the MODULE. Config and call site both look
   right and it still resolves empty. **Stop reading the code — run `resolveOptions` against the
   live field.**
3. **The Examples / sample-files page was never looked at** (user asked 3×): broken links, and an
   image that should be STACKED rather than beside its text. Ask for a screenshot of that page.

**Eight defects fixed, each root-caused from live data:**
- **The build jammed after the FIRST page.** `FIND meta.templateName IS "Day Page"` also matched
  every CLONE (APPLY_TEMPLATE copies meta); a multi-match FIND returns an ARRAY that APPLY_TEMPLATE
  can't resolve. Now picker-direct by id; the builder THROWS without one.
- **`APPLY_TEMPLATE defaultFields` was gated to `role === "instance"`,** so the Daily Question
  (container) and Daily Answer (textblock) never got the date their header/body links join on. The
  gate now asks whether the clone's module BINDS the field — slot/page clones still get nothing.
- **`PUSH_TO_ARRAY` resolved only the TOP level of an object,** so every TipTap node it pushed kept
  the literal `"$task.id"` one level down in `attrs`. It deep-resolves now (as UPDATE already did).
  This was the "Tasks Completed has broken links" report.
- **The page name came from the picker's period OBJECT** → a page literally named
  `Day Page - [object Object]`. Both day-page ops use `$activeDate` + `targetOccurrenceId` now.
- **A LOOP whose `over` is a nested var path silently iterates EVERYTHING.**
  `LOOP over "$dayPage.textmap.content"` wrote 1278 occurrence records into a live page's textmap as
  if they were nodes. **There is no splice in the pipeline language** — the op writes the whole
  content array from FINDs instead, so it owns the section ORDER (add a section to the template →
  add it here too).
- **TWO ancestor-scoped FINDs broke once Todo had a second parent.** `_ancestors` is derived from the
  parent map, so multi-parenting Todo into the day page let its chain resolve through the PAGE:
  Build Schedule's slot dedupe re-minted a duplicate every load, and the op's OWN Todo lookup found
  nothing and stopped rewriting its embed (it sawed off its own branch). Both key on `parentId` now
  — the precise test for a direct child.
- **`Daily Question` was display-only** → its bound header rendered no writable control.
- **Past day pages kept (and kept APPENDING) unresolved embeds** — 1086 on the 07-28 page — because
  Tasks Completed only ever rewrites the CURRENT day's page. Migration clears them.

**Design notes:** Todo is the day-column's OWN container multi-parented in, NOT a copy — one
occurrence, two parents, so a tick here and on the Schedule are the same write (two copies would fork
the state; same reasoning as `createPageInContainer`). `No timeslot` → `Todo` renames the label AND
the Time Slot identity marker in one pass. Journal/Notes/Highlights store plain per-day
`occurrence.textmap` with NO field bindings — the occurrence is minted per day, so the writing is
per-day for free; a binding would only matter if the text had to sync elsewhere (which is why Daily
Answer has one).

**RETRACTED:** an earlier claim that the `Due`/`No timeslot` identity markers were null and Build
Schedule's un-slotted sweep was dead. They are intact — the probe read
`scheduleFieldIds.timeslot` instead of `.timeslotFieldId`.

**The lesson of this session:** three separate times a DB query said "working" while the user's screen
disagreed — the malformed page name, the dead Todo embed, and the unpinned hub tab. **The DOM and the
tab strip are ground truth for "is it working," not the collection.** Also: migrations read RAW
documents, where `textmap` is COMPRESSED — a bare `page.textmap.content` is undefined, which silently
turned a damage check into a no-op.

---

### 2026-07-29 (4) — the add menu creates EVERY occurrence type; two ops bugs found (NOT fixed)

**Shipped — `tileKindsForRole("instance")` is now 12 tiles** (user: "pretty much its to create any
occurance type"). Item · Textblock · Artifact · Image · **4 nested CONTAINERS** (Board/Doc/Table/
Canvas) · **4 PAGES** (Board/Doc/Table/Canvas). Confirmed with the user that table + canvas
containers do exist (`ModuleContainer.jsx:668-671` dispatches all four kinds), so their first list
("board container, doc container") was widened.
- Page tiles use new `page-<kind>` keys — the bare kinds keep meaning CONTAINERS, so no existing
  call site changes meaning. `tileMeta(kind, targetRole)` labels the bare kinds "… container" ONLY
  in the instance menu (where both exist); the page/container-role menus keep short labels.
- **`CommitHelpers.createPageInContainer` (NEW)** — ONE module, ONE occurrence: `parentId` = the
  manifest ROOT FOLDER (so the tree lists it as a real page) and spliced into the container's
  `occurrences[]` (the multi-parent pattern the Schedule uses for shared slots). **Do not "fix"
  this with two occurrences, one per home: `textmap` lives on the OCCURRENCE, so a doc/canvas page
  would carry two independent bodies and the in-container copy would render permanently empty.**
- The cascade defaults a page-in-container to `actual-converted` — for a brand-new empty page that
  is an empty inline box, indistinguishable from just adding a container. So the occurrence carries
  `meta.layoutCascadeOverride.dragInView = "representation"` (the per-occurrence override that
  survives the cascade walk); the header switcher still flips it. NOTE: "preview" proper (the iframe
  card) is a folder-page-only mode — `representation` is the compact view available in a container.
- `folderId` is resolved IN QuickAddMenu (the only layer holding `manifestsById`) and threaded
  through `onCreateNew` → `createChildInContainer`; hosts stay ignorant of folders.
- 1441 client tests (7 new), deployed, prod-verified: all 12 labels render, and "Canvas page" mints
  a `role:page kind:canvas` homed in Root, listed by the container, in representation view, with a
  textmap. **The verification probe wrote to the frozen grid — the page it created was swept and
  pm2 restarted.** `ALLOWED_KINDS_BY_ROLE` was deliberately NOT widened (it filters the
  existing-matches list, not the create tiles) — placing an EXISTING page/table/canvas as a preview
  is a separate ask.

### 2026-07-30 (6) — workout movements count as habits

User: "workouts is a habit but the completed tasks is okay." The 0008 rule made every Routines
action a habit and left everything else a task, which put the 30 workout MOVEMENTS on the tasks side
— they live on the Movements board, not in the Routines catalog. Seed (`makeWorkout`) + migration
`0010` bind the same hidden Habit marker on them, so logging a lift moves Completed Habits.
Identified STRUCTURALLY (whatever the Movements board holds, feed copies skipped), not from a label
list, so it can't drift as movements are added. 33 modules marked.
Completed Tasks reading 0 until the Tasks page has content is CONFIRMED FINE by the user — don't
"fix" it.

---

### 2026-07-30 (5) — Routines split into sub-categories; feed pages are a dangling-ref source

`ROUTINE_GROUPS` (seed) + migration `0009` group all **97 actions into 31 sub-category containers**
under the nine dimensions — Physical → Nutrition/Fitness/Rest/Care, Financial →
Earning/Spending/Saving/Admin, and so on. Dimension modules gain
`meta.allowChildContainers`. The seed THROWS if a dimension's `instKeys` isn't fully placed, so a
future action can't silently fall off the page; the migration keeps any unlisted action at top level
and logs it rather than dropping it. Applied to poms grid, 0 leftovers.

**Finding worth keeping:** the post-migration integrity check caught 12 dangling child refs — on
**Schedule Canvas** and **Schedule Table**, the two FEED-backed pages, from client-minted ids ~7
minutes earlier. So the recurring dangling-ref source is the FEED engine (feedSync mints copies
client-side; the create is queued server-side and bails on disconnect while the parent-list write is
not), NOT just headless probes as assumed on 2026-07-29. Swept; all three grids 0 errors. A feed
resync that reconciles the parent list would close it for good.

---

### 2026-07-30 (4) — mobile: the grid rendered off-centre because a HIDDEN viewport was scrolled

User: "switching grid cells is glitching out, making the screen off center and viewing the wrong
cells/side bar buttons being off." Measured on prod at 390×844: the `.mobile-grid-viewport` computed
`overflow: hidden` **and** sat at `scrollTop 439 / scrollLeft 370`.

- **`overflow: hidden` does NOT make a box unscrollable** — it only hides the scrollbars. Anything
  that reveals a descendant (the scroll-to-current-slot pass, an occurrence-search jump, focusing a
  freshly minted label editor) scrolls every scrollable ancestor, this viewport included. That
  offset then rides on top of the cell transform permanently: the grid paints off-centre, you see a
  slice of the neighbouring cells, and the rails point at the cell `activeCell` says you are on
  rather than the one on screen.
- The mode-off branch already reset scroll to 0, but only ONCE at effect time — the offending
  scroll happens later. It now **pins** the viewport with a scroll listener for as long as the
  panel-native-scroll mode is off. Verified on prod: 439/370 → **0/0**.
- Multicell panels are untouched (that branch owns the scroll deliberately). 23 mobile tests pass.
- **Probe note:** the same run printed "MISMATCH" on every rail tap — that was the PROBE reading a
  non-existent `moduli-activeCell` localStorage key, so its expectation was always `?`. Don't chase
  it; find the real key before re-testing rail↔transform agreement.

---

### 2026-07-30 (3) — Routines catalog de-duplicated; Sleep loses Duration. TRACKERS RESTRUCTURE IS QUEUED

Shipped (seed + migration `0007`, applied to poms grid, deployed): the catalog went **104 → 97
actions with ZERO duplicate labels**. Dropped Nap (Sleep covers it), Lift (bindings were IDENTICAL
to Exercise), Emotional Meditate (Spiritual keeps it), Spiritual Reflect (Emotional keeps it),
Occupational Write (Creative keeps it), Financial Review (Reconcile already covers reviewing
accounts, so Occupational keeps the one Review), and a duplicate Check In placement (the mood-wheel
demo row — Emotional listed it twice).
**Verified before deleting anything**: none of the seven was referenced by any op pipeline, trigger,
or template textmap, and each removed module had exactly ONE occurrence (no Schedule copies), so
nothing was orphaned. The migration still guards per-module at run time and refuses any entry with
children.
**Sleep no longer binds Duration** (user: "the operation should just count each one as 30 min") — a
slot IS 30 minutes, so sleep is measured by how many half-hour slots it fills. The 12 stored
Duration values were CLEARED, which matters beyond tidiness: the "Time Spent" tracker sums Duration
across every completed schedule item, so leaving them would have double-counted sleep.

**QUEUED — approved by the user, designed, NOT yet built** (kept here so nothing is lost):
1. **New "Stats" container, first on the Trackers page** (the date-prefix op will render it
   "Today's Stats"), holding **Completed Tasks · Completed Habits · Now · Streak** — the first three
   moved out of Physical, Completed Habits new.
   *Useful finding: the existing Completed tracker is ALREADY grid-wide* (`trackerArgs` carries
   `scopePageOccId: schedPageOccId`); it only READS as physical because of where it sits. Moving it
   satisfies "should be all, not just physical" with no scope change.
2. **Habit vs task discriminator (user-approved):** bind a hidden marker field on every Routines
   action module. `Completed Habits` = completed AND carries it; `Completed Tasks` = completed AND
   does NOT. Use the module-BINDING form (`_boundFieldIds ARRAY_INCLUDES/ARRAY_NOT_INCLUDES`), not a
   stored value — the 2026-07-11 idiom, and it survives copies for free. Sleep counts as a HABIT
   (user's pick), so it drops out of the tasks count automatically. Note: Completed Tasks will read
   0 until the Tasks page has content, and workout MOVEMENTS dragged from the board count as tasks
   under this rule — flag if that should change.
3. **Sleep = 30 min per completed occurrence** — needs a destination tile; fold into the Stats build.
4. **Nest tracker containers (user-approved):** Workout + Nutrition → Physical, Media →
   Intellectual, Planning → Occupational. Parent container modules need
   `meta.allowChildContainers: true`. Re-parenting is invisible to ops (they target tiles by id —
   same lesson as the 2026-07-25 account-container merge).
5. **Sub-categorize the Routines page the same way** ("nutrition should be in physical in its own
   container etc") — ~35 sub-containers across the 9 dimensions. Deliberately NOT bundled with the
   above: it is the one open-ended piece and a big live-grid change, so it wants its own reviewable
   migration.

---

### 2026-07-30 (2) — today's Schedule was missing its first 11 slots (MY probe caused it)

User: "we dont have the full schedule … 6am to 1130pm with a random 130 am at the end." Exactly
reproduced: today's day-col listed 37 children — 6:00am→11:30pm plus a 1:30am appended last.

- **Not a build failure — a LINK failure.** All 48 slot copies for today existed, and the missing 11
  already carried `parentId` pointing at the day-col. What was missing was their id in the day-col's
  **`occurrences[]`**, which is what the renderer reads. Same asymmetry the 2026-07-29 audit
  documented from the other side: `create_occurrence` is QUEUED server-side and survives, while the
  parent-list write is a separate `update_occurrence` that does not — so a client that goes away
  mid-build leaves created-but-unlisted children. The stray 1:30am was a second copy added by a
  later pass, which is why it sorted last (the array is the render order).
- **I caused this instance**: my `_slotgate.mjs` probe was the first client to load after midnight,
  so IT ran the new-day Build Schedule, and the probe closes its browser seconds later — mid-burst.
  **A probe that loads the live grid can trigger the day rollover. Keep it open, or expect to
  repair.**
- Repaired by relinking the 11, deleting the duplicate 1:30am, and rewriting `occurrences[]` in
  clock order (parse `h:mm am/pm` → minutes; non-slot children preserved after the slots). The
  script REFUSED to drop any duplicate carrying children. Verified live: 48 children, 12:00am first,
  11:30pm last, none missing, none out of order, all 48 painted.
- **Same failure took out today's `Due` + `No timeslot` too** (user reported separately). Both
  copies existed with `parentId` = today's day-col but were unlisted, AND their Time Slot identity
  marker was `""` — because my first too-blunt migration run nulled the MASTERS at 10:22 and the
  build COPY_LINKed them at 10:23, carrying the emptied value through. Restored both markers and
  rebuilt the child list to the convention the correctly-built Fri/Sat day-cols use:
  **[Due, No timeslot, …48 slots in clock order] = 50 children.** All three day-cols now match, 50
  painted each. Lesson: a data repair on a MASTER propagates into every per-day copy minted
  afterwards — repair the masters and the copies in the same pass, or rebuild the copies.
- **Still fragile (not changed):** `Schedule: Build Schedule` self-heals a day-col that is EMPTY,
  but not one that is PARTIALLY linked — nothing re-links a child whose `parentId` already points at
  the day-col but is absent from its array. That covers the slots AND the Due / No timeslot heads.
  Worth an idempotent relink pass in the op.
- **The stale tab kept re-minting the fixed bug, with timestamps to prove it:** 12 more
  `kind:"doc"` instance modules appeared at 11:44 (the Fri/Sat routine clones) — after the
  `operationActions` fix deployed at 10:36. An open tab runs the OLD bundle, whose CREATE still
  defaults `kind` to "doc". Cleared; **it recurs until the tab reloads**. Don't re-investigate a
  fix that "didn't take" before checking the client's vintage.
- **Separately: a stale TAB can re-introduce fixed bugs.** The 6:30 AM alarm fired at 11:30Z and
  STILL minted `kind:"list"` even though the stored pipeline had been stripped at 10:22 and the
  builders were fixed — because the browser tab had been open since before the migration and fired
  from its in-memory pre-migration copy of the op (its `lastFiredAt` never reached the DB either).
  Data cleared; **a reload is the remedy**. When a fix "didn't take", check whether the client
  predates it before re-opening the investigation.

---

### 2026-07-30 — both ops bugs FIXED (and a third, which was the real root of one)

- **Time Slot only gets stamped when the destination IS a slot.**
  `makeStampDateTimeSlotOp` gained an optional `scheduleFormatFieldId`: it now FINDs the
  destination off `$trigger.containerId` and writes `$trigger.containerLabel` ONLY when that
  container carries `Schedule Format IS "slot"`, else writes null. **The ELSE matters as much as
  the gate** — a COPY carries the source's fields, so a slotted item copied onto a canvas would
  otherwise keep a slot it no longer sits in. Grids without the field (createTestGrid) keep the
  ungated stamp byte-identically. Proven in `liveOpsBehavioral` (3 new): gated on the field, a real
  slot stamps "6:00am", a non-slot container stamps null and NEVER its own name. Verified live too
  (created under the day-col → null).
- **`kind` — my first fix was HALF the bug.** Dropping `kind:"list"` from `alarmOps.js` just moved
  the value: `operationActions.js` CREATE defaulted **every** op-minted module to `kind: "doc"`
  regardless of role, so instances kept getting an inert kind (today's 6 routine clones proved it).
  Now `KINDLESS_CREATE_ROLES` (instance/panel) get no kind; an explicit `cfg.kind` is honoured and
  container/page keep the "doc" default. 3 tests.
- **Migration `0006`** carries all of it to the frozen grids. **The data repair took three passes
  because "not a valid slot label" is NOT the same as "wrong":**
  1. Blunt null-everything ALSO nulled the `Due` / `No timeslot` CONTAINERS, which carry their OWN
     label in Time Slot as an **identity marker** — `Schedule: Build Schedule` FINDs them by
     exactly that (`fields.<timeslot>.value IS "No timeslot"`). Restored from the pre-migration
     snapshot.
  2. It also nulled the per-day SLOT COPIES, whose correct value is their own time — Alarm and
     Pomodoro: Start FIND their slot by `fields.<timeslot>.value IS "5:00pm"` and Mark Passed Slots
     compares it `TIME_BEFORE` now. Nulling those silently breaks all three.
  - **The rule that actually separates them:** a value equal to the occurrence's OWN label is an
    identity marker (leave it); a value equal to a PARENT's label is the mis-stamp — reset it to
    the occurrence's own slot time when it has one, else clear. Live grid now: 97/97 slots carry a
    valid time, today's 5:00pm findable, both markers intact, 0 mis-stamped.
- **Probe debris is a real hazard on the frozen grid.** Closing a browser mid-create leaves the
  documented pathology (`create_occurrence` is queued server-side and bails on disconnect; the
  parent-list update is not) — 24 dangling child refs + 2 module-less occurrences, integrity went
  to 2 ERRORS. Swept scoped strictly to the `17854*` client-minted ids. **Sweep probe writes and
  re-check integrity before calling a session done.**
- 1447 client + 325 server tests, all three grids 0 errors, deployed, prod-verified.

---

**Found, root-caused (both now FIXED above — kept for the reasoning trail):**
1. **Time Slot gets a CONTAINER LABEL, not a time** (user: "in workouts, time is set to schedule
   canvas and not a time"). `makeStampDateTimeSlotOp` writes `value: "$trigger.containerLabel"`
   into the Time Slot field with **no check that the destination is a slot at all** — Time Slot is a
   select of 48 time labels, so anything else is out of range. Live grid holds 3 Exercise
   occurrences reading `"Schedule Canvas"` (two under the Schedule Canvas / Schedule Table pages,
   one under a real `12:00am` slot) plus `"Due"`×2 and `"No timeslot"`×2. The Workout History row's
   `timeslot` reads that field verbatim, which is why the tile shows it. **Fix**: gate the UPDATE on
   the destination being a slot — `$trigger.containerId`'s occurrence has `Schedule Format IS
   "slot"` (96 slots + 1 day-col carry it; the canvas/table pages and Due carry null). The
   discriminator is already the one `makeAlarmOp` and Pomodoro: Start use. Then null the 7 bad
   values via migration.
2. **Every fired alarm mints an instance with `kind: "list"`** → `getModuleTypeIcon` prefers kind
   over role, so it draws the BOARD icon (exactly the class of bug the 2026-07-29 kind removal
   fixed). Surfaced as a NEW `inert-kind` integrity warning after today's 5 PM alarm fired
   ("⏰ 5 PM", 22:00Z). `client/src/helpers/alarmOps.js:89` still emits `kind: "list"`; the server
   twin `makeAlarmOp` (liveSystemBuilders.js:2754) already dropped it — **the twins have drifted**.
   The frozen grids' two stored alarm pipelines still carry it, so the fix is both the client
   builder AND a migration over `Alarm: 5 PM` / `Alarm: 6:30 AM`.

---

### 2026-07-29 (3) — empty pocket actually clickable; the Appointment occurrence

Picked up the two items account2's session left open.

- **The empty-pocket fix (`0d1b390a`) did not work, and prod proved it.** Clicking anywhere in an
  empty container's pocket still did nothing below the top 20px. Cause: the CSS marked
  `width: 100% !important` but left `height: 100%` unmarked — QuickAddMenu sets **both** as INLINE
  styles (20px each), and an inline style beats a stylesheet rule regardless of specificity. So the
  trigger stretched full-width but stayed a 20px band at the top of the 44px pocket. One word
  (`!important` on height) fixed it. **This is the third time this exact trap has been recorded**
  (AutoMarquee's `display:block`, ModuleInstance's inline flex-wrap) — when a rule silently does
  nothing, check for an inline style before anything else. Verified on prod by clicking 14px in
  from a pocket's left edge: `elementFromPoint` now returns the BUTTON and the menu opens.
- **Appointment occurrence added** (user: "we need an appointment occurance if we dont already have
  one"). Nothing modelled a scheduled commitment — the nearest things were Social's Meet/Visit/Host
  (people you choose to see) and the Events board (Game Night, Book Club). Added the same noun/verb
  pair the rest of the grid uses: an **Appointments board** (Doctor/Dentist/Therapy/Optometrist/
  Haircut/Car Service/Vet) under the Social board group, feed-backed on `boardCategory:"appointment"`;
  an **Appointment Type** dropdown scoped to that tag; and an **Appointment** action binding
  Completed · Appointment Type · Place · People · Duration · Date(hidden), so it drags onto a slot
  and stamps date + timeslot like any other action.
  **Placed in OCCUPATIONAL, not Social** — the obligations/admin dimension — so Social keeps reading
  as chosen contact. Trackers aggregate by FIELD, not by container, so the dimension is purely where
  you go to find it; moving it is a one-line change with zero tracker consequence.
- **Migration `0005-appointment-occurrence`** carries it to the frozen grids; the seed produces the
  same thing. **The dry run earned its keep:** `Board Category` stores its tag list in
  `meta.optionsSource.values` (manual mode) on poms grid but in `meta.options` in the seed — a blind
  `$set` on `meta.options` would have left a stray one-element list on a field whose real options
  live elsewhere. The migration now appends to whichever list the grid actually uses. Everything is
  resolved BY NAME at run time (no baked ids); the Occupational ROUTINES container is disambiguated
  from the same-labelled tracker container by finding the parent of the unique "Network" action.
  Rehearsed on `test grid 2` (stripped first so the CREATE path ran for real), re-run to prove
  idempotency, then applied to poms grid + **pm2 restarted** (the warm cache would otherwise re-serve
  the old grid).
- 1434 client + 323 server tests, all three grids integrity-clean (0 errors, the same 2 pre-existing
  warnings), deployed, verified live on prod.
- **Probe lesson:** the first verification probe reported the Appointment missing — it read
  `state.modulesById`, but the client store holds FLAT ARRAYS (`modules`/`occurrences`/`fields`).
  The DOM disagreed with the probe, which is what caught it. Check the probe before believing a
  failure.

---

## Handoff — 2026-07-29 (full-site audit: 5 real bugs found and fixed; integrity gate added)

Audited the live grid's data, schema and runtime (not just the code). Findings + fixes, all
deployed. **My initial headline was WRONG and is retracted**: the feed engine is NOT broken — it
resolves 10 matches for Grocery List, all visible, and mints correctly; boards with `matches=0`
legitimately have nothing to pull. What was real:

- **Dangling child refs (the big one).** A parent's `occurrences[]` listed 42 ids naming
  occurrences that do not exist. Cause is an asymmetry: `create_occurrence` is QUEUED server-side
  and bails at every stage on disconnect, `update_occurrence` is neither — so a client that went
  away mid-burst persisted a parent listing children that were never created. Worse, they were
  **self-restoring**: the client holds whatever the last full_state gave it and echoes the whole
  array back, so sweeping the DB fixed nothing (42 refs survived four repairs). Fixed at BOTH
  ends — the client no longer emits its own parent-list write (the create carries `parentId` and
  the server `$push`es it atomically, only if the create persisted), and **the server now drops
  child ids that name no occurrence**. Proven: 4 abrupt sessions → 0 dangling.
  **Operational note: a DB-level `occurrences[]` repair needs a server restart** — the warm
  per-user cache is authoritative for reads and will re-serve the old array otherwise. That cost
  three misleading regression runs.
- **`targetId` was still read in live code paths** — and not just as a dead fallback. The schema
  dropped it and no occurrence carries it, yet `layoutCascade.js` used it in 3 of 4 module
  lookups (so the WHOLE layout cascade resolved role/kind to undefined and silently defaulted),
  ManifestTree's page-child filter matched nothing, and the assistant's `list_pages` came back
  empty. 34 dead fallbacks + 9 broken sole-lookups removed. The test fixtures encoded the same
  pre-rename shape, which is why none of it was caught.
- **Two enabled ops wrote the same target.** `Mark Passed Timeslots` (30 min) and
  `Schedule: Mark Passed Slots` (5 min) both wrote `$slot.ownStyle.bg`, so the slower stomped the
  newer op's green current-slot tint twice an hour. Removed from the seed, and removed from the
  frozen `poms grid` via **migration `0002-drop-duplicate-slot-painter`** — the first real use of
  the migration runner.
- **`Operation.priority` was missing from the schema** while the seed had passed it since
  2026-04-27 — strict mode dropped it, all 68 ops persisted `priority: null`, and the documented
  ordering silently fell back to `triggerObject.priority`. Added.
- **`server/utils/gridIntegrity.js` (NEW) + `scripts/checkGrid.js`** — the seed now FAILS on a
  structurally invalid grid. Checks: dangling child refs, module-less occurrences, two enabled
  ops writing one PRESENTATION target (deliberately narrow — several ops writing one FIELD is
  normal and flagging it made the check noise), unused fields, duplicate field/op names,
  unfireable ops. Every defect above is representable; each had been silent for months.
- Remaining warning on all grids: 14 fields never bound/valued/referenced. Some are deliberate
  palette fields (Tags was seeded for the feed field-check), so they were NOT deleted — worth a
  pass to decide which are leftovers from the 2026-07-25 media retarget.
- 1430 client + 314 server tests, build clean, prod verified desktop + mobile, zero page errors.

---

### 2026-07-29 (2) — kind removed from leaves; media trackers folded into a builder

- **`kind` dropped from instance + panel modules** (user: "get rid of kind if we arent using it").
  It IS used — kind is the sub-type WITHIN a role, and container/page/artifact/textblock all
  render by it (board vs doc vs canvas vs table; image vs video vs pdf; the inline chip vs the
  block textblock). So it was removed only from the roles with no sub-types. **Not cosmetic:**
  `getModuleTypeIcon` resolves kind BEFORE role, so 519 instances + 5 panels carrying
  `kind:"board"` drew the BOARD icon everywhere an icon appears. Seed strips it at the single
  chokepoint every instance passes through (the bulk `insertMany`) so it can't be forgotten;
  migration `0003` cleared 525 on poms grid + 369 on test grid 1, leaving the kind-bearing roles
  untouched; `gridIntegrity` gained an `inert-kind` rule. **There is no "list" container kind —
  it is BOARD everywhere** (the Module.js comment briefly said otherwise; corrected).
- **`makeMediaHistoryOp`** — Movies Watched / Books Read / Podcasts Listened were three
  hand-written Operation literals with an identical 19-node pipeline: ~12KB of duplicated JSON
  over 409 seed lines, now 52. **Provable no-op:** the regenerated pipelines were diffed against
  the pre-change `server/seed/operations.json` and are byte-identical once per-reseed ids are
  normalised — which is why loop-var names are PARAMETERS (not derived from a prefix) and row
  extras have before/after-label slots. New callers pass `varPrefix` and take the defaults.
  6 tests. The remaining bespoke clusters (Workout/Meal/Purchase History, the Pomodoro quartet)
  are the same opportunity and the same method.
- **Field pills on an instance row now share one box** — the multi-select occurrence dropdown
  rendered a completely different control (full-width, square, fixed 24px) from the single-select
  pill (21px, rounded), and neither lined up with the boolean/number pills. All now 21px at one
  y. `!important` was REQUIRED on the centring: AutoMarquee sets `display:block` INLINE, which
  beats a stylesheet rule — the first attempt silently did nothing.
- 1433 client + 323 server tests, all three grids integrity-clean, prod verified desktop+mobile.

---

## Handoff — 2026-07-28 (poms grid is PROTECTED live data; backups + migrations shipped)

Plan: `docs/superpowers/plans/2026-07-28-poms-grid-live-data-freeze.md`. **ALL EIGHT TASKS DONE —
`poms grid` is FROZEN** (`meta.frozenAt`, `frozenAtCommit=ecac1069`, new id
`6a690f6fb8e785df961a9f3c`, 975 occurrences). Rebuilt once from the seed via a one-shot script
that was deleted immediately after; snapshots either side. **The seed must never touch it again —
content changes happen in the app, structure changes go through `server/migrations/`.**

- **Three grids now.** `poms grid` = permanent live data, `meta.protected: true`, the seed must
  NEVER write it. `test grid 1` = the frozen old live grid. `test grid 2` = `DEFAULT_GRID_NAME`,
  the seed's target, overwrite freely. The stray 1×1 is deleted.
- **`server/utils/protectedGrids.js` is THE rule.** `assertNotProtected` throws (a boolean someone
  forgets to check is not a guard). Honoured by `dropExistingLiveGrid` (name AND the found
  document), `sweepStaleGrids`, `clearAllUserGrids`, `resetData.js`, `clearUserData.js`, and the
  runtime `delete_grid`; Grid Settings hides the delete button for a protected grid.
- **Backups: `npm run backup:poms`**, nightly cron on the droplet at 04:17 (14 kept, labelled ones
  never prune). Restore is VERBATIM (same ids — `Occurrence.id` is globally unique and ids are
  woven through parentId/textmap embeds/op pipelines), so rehearse with `--into-db <scratch>`.
  `--verify` compares CONTENT HASHES, not counts. Full drill + refusal table:
  `docs/backup-restore.md`.
- **Changing the live grid from now on:** `server/migrations/` + `npm run migrate:poms`. Content
  changes happen in the app; migrations are only for structure the UI cannot express.
- **`delete_grid` now CASCADES** (it deleted the Grid row only — that stranded 186 documents
  across six dead grids, since swept via `scripts/sweepOrphans.js`, which dumps to
  `backups/orphans/` first and leaves null-gridId docs alone).
- **HARD-LEARNED, recorded so it doesn't repeat:** verifying the guards by running them against
  the LIVE database dropped the live grid — the guard refused `"poms grid"` but the grid was
  still named `"Poms"` (the rename was a later task), so nothing matched. Restored byte-identical
  from the Task 1 backup in one command. **Land the rename/stamp BEFORE any check that exercises
  a name-matched rule, and verify guards on a MOCKED model** — a test that guards the live data
  must not be able to destroy it.
- Also this session: **occurrence search highlights the copy in the panel it opened** (the lookup
  was document-wide, so a copy in another cell stole the flash — prod-reproduced), and **instance
  rows align label/handle/fields on one centreline** (fields sat 3px low; the lift is paid back in
  the row gap when they wrap, and inline-media rows take a smaller lift).
- 296 server + 1429 client tests, build clean, deployed (`920b7917`), prod verified.

---

## Handoff — 2026-07-27 (the 2026-07-26 batch is DEPLOYED; mobile rail taps switch instantly)

Everything from the 2026-07-26 handoff below plus the six follow-up commits (mobile toolbar/page
header, container label size, container menu occurrence types, boards copy-link, hover-label leak,
scroll-to-current-slot) is **deployed** — prod HEAD `a714a037`, verified by SSH + a byte-identical
sha256 on the served `App-*.js` chunk. 1416 client + 246 server tests, build clean.

- **Mobile cell-switch lag FIXED** (user: "the side buttons have a delay on the switch").
  `activeCell` lives in App state, so a rail tap re-rendered the whole grid BEFORE the slider
  transform moved — that commit is the delay. `mobile/MobileGridNav.jsx` now paints the target
  transform **imperatively in the tap's own frame** (`cellTransform(row,col)`, the same string the
  render computes) and holds the target in `pendingCellRef` until the state catches up, so an
  unrelated re-render in between can't snap the cell back. The pending cell is compared **by
  value** — `MosaicMobileNav` passes a fresh `{row,col}` object every render, so identity
  comparison would clear it instantly; it clears when the state reaches the target OR moves
  anywhere else on its own (the silent sub-cell scroll sync). `navigate` clamps against
  `activeCellRef` (the optimistic cell) so back-to-back taps compose. Rail buttons fire on
  **pointerup** with a 12px tap-slop guard (a swipe that starts on the rail doesn't navigate) and
  drop the trailing synthesized click; `touch-action: manipulation` on `.mobile-rail-btn`.
  5 tests. **Prod probe (390×844): transform moves 0.9ms after the tap, settles unchanged, no
  page errors.**
- **Still open from below:** "food is outside the boards folder" — unreproduced (seed parents Food
  under Boards; the rendered root tree shows it indented under Boards). Need the surface it's
  wrong on.

---

## Handoff — 2026-07-26 (occurrence SEARCH in both headers; the de-schedule sweep; snap-to-today)

Spec `docs/superpowers/specs/2026-07-26-occurrence-search-design.md`, plan
`docs/superpowers/plans/2026-07-26-occurrence-search-and-deschedule.md` (15 tasks; 14 shipped,
one dropped on purpose — see below). 1411 client + 246 server tests, build clean, RESEEDED.

- **Occurrence search, two surfaces, one engine.** `helpers/occurrenceSearch.js` (pure, 25 tests)
  indexes every occurrence's label (`occurrence.label ?? module.label` — no other rule), its
  ancestor PATH, field NAMES + VALUES (occurrence refs resolve to the referenced LABEL, never an
  id), textmap/table body text (capped 10k chars), and **date aliases** (`2026-07-25` / `jul 25` /
  `july 25th` / `saturday`) drawn from the occurrence's own date field or `filterOverride` **AND
  from every ancestor's** — that last part is what makes `water july 25` and `9pm july 25` work
  (the date lives on the CONTAINER, not the item; the first implementation missed it and a test
  caught it). Query is **AND-of-terms** across all haystacks, so extra terms narrow by location;
  ranking is tiered label-prefix > label-substring > field > path/date > body, without which a
  paragraph mentioning "water" outranks Drink Water itself. Non-label hits carry the fragment
  that matched, rendered as a third row line.
- **`ui/OccurrenceSearch.jsx`** — magnifier that expands in place, portalled dropdown (repositions
  on scroll, never closes on it), ↑/↓/Enter/Escape. Mounted in the PANEL header left of the
  Root-tree button (whole grid; picking opens the result's page in THAT panel via the new shared
  `helpers/openOccurrenceInPanel.js`, which AssistantDrawer now also uses) and in the PAGE header
  left of the filter funnel (`scopeRootId` = that page; picking just scrolls). A match that is
  filtered out of the DOM says so instead of silently doing nothing.
- **Index caching:** entries are cached per occurrence OBJECT (a write swaps only what changed) —
  and the cache record holds the ancestor objects it was built from, because a PARENT rename
  doesn't touch the child object and would otherwise leave a stale path.
- **Page header also gained the × close button** (unpins the page from the panel via the panel's
  existing `closePage`).
- **DE-SCHEDULE SWEEP (user: "there shouldnt be anything schedule specific in the code").** Four
  violations found and removed, with `__tests__/noDomainKnowledge.test.js` guarding each:
  (1) `ModuleContainer` `SCHEDULE_LABEL_PREFIX` + `computeScheduleColLabel` — the header
  string-matched a `"Schedule - "` label prefix to recompute its title; (2) `PageBoard`
  `WEEKDAY_RAINBOW`/`weekdayColor` — hardcoded Mon-red…Sun-violet tints from a date field, same
  class as the timeslot-passed tint deleted 2026-06-03; (3) `PomodoroTimer.currentSlotLabel()`
  baked the `"9:00am"` format to string-match slots — now `pickTimeOptionForNow` picks the latest
  elapsed option from the timeslot FIELD's own options; (4) `alarmOps` + its server twin
  `makeAlarmOp` found the destination page by `label IS "Schedule"` — now `id IS
  <pageOccurrenceId>`, seeded onto `grid.meta.scheduleFieldIds`. Seed files stay exempt (they
  author the schedule as DATA). `dropHandlers`' `dayColOcc` locals renamed `filterAncestorOcc`.
  **DELIBERATELY NOT DONE:** the planned day-column label-stamping op. The day-col module label is
  already minted as `"Schedule - ${dateLong:$day}"` per day, so the op would rewrite the identical
  string while looping every container on every load. Accepted loss: changing ONE day column's own
  date override no longer retitles it (only the deleted label-sniffing supported that).
- **`SET_FILTER` was half-wired** — `SET_FILTER_NAV` writes only `filterNavState` (the nav WIDGET);
  the cascade reads `grid.activeFilterValues`. So an op could move the date on screen without
  filtering anything. Now patches both + persists, decision extracted as pure
  `applySetFilterEffect` (6 tests) keeping the unchanged-value guard that stops onLoad loops.
- **`Grid: Snap Filter To Today`** (new seeded op, onLoad, trigger priority 0): a page's date is
  persisted in its OWN `filterOverride` and the full_state bootstrap deliberately never overwrites
  an explicit value — so the grid still showed yesterday the next morning. The op compares a hidden
  **"Last Opened Date"** marker occurrence to `$today` and, on a new day only, moves every
  date-carrying page forward and stamps the marker; same-day reloads write nothing, so a date you
  navigated to survives a refresh. **To express that as data, `UPDATE` gained
  `$page.filterOverride.<fieldId>`** → `UPDATE_ITEM_FILTER_OVERRIDE`, applied through
  `updateOccurrenceFilterOverride` so the NavigationOp cascade fires for the page + inheriting
  descendants (null clears the key). Any op can navigate a page's date now.
- **Finding, not fixed:** `op.priority` is NOT in the Operation schema — Mongoose strips it, so
  every seeded op exports `priority: null` and the executor's sort falls back to
  `triggerObject.priority` (which does persist). Op-level priority values in the seed are inert.
- Also this session: **alarms stop instantly on Stop** (`alarmSound.stopAlarm()` ramps each live
  gain to zero over 10ms then stops the oscillator — `ringAlarm` scheduled the whole burst on the
  audio timeline, so clearing the interval let it play out); empty-container **+ stays centered**
  (the hidden "Add new item" label was `opacity:0` but still held its width); inline instance
  images 18px → 22px.
- **NOT done:** no deploy (`./deploy.sh` + verify prod HEAD), and no on-device check of either
  search surface.

---

## Handoff — 2026-07-25 (Poms grid: nine dimensions of wellness — NEW grid, boards, one Routines page)

Per user (CLAUDE_CHAT 2026-07-25), a whole new seeded grid built beside the old one. Plan:
`docs/superpowers/plans/2026-07-25-poms-grid-nine-dimensions.md` (Tasks 1-8, all shipped).

- **The old Live Grid is now `test grid` and is UNTOUCHABLE.** The seed targets a new grid named
  **`Poms`** (`DEFAULT_GRID_NAME`), so `dropExistingLiveGrid` / `sweepStaleGrids` / the seed
  export never see the old data. One late fix: the `meta.defaultGrid` clear was an unscoped
  `Grid.updateMany({ userId })` that bumped `updatedAt` on EVERY grid each reseed (a pure no-op
  write to test grid) — now filtered to grids that actually carry the flag. Verified: test grid's
  `updatedAt` no longer moves on reseed and its 859 occurrences / 803 modules are untouched.
- **34 option BOARDS** (`Boards` folder → 7 life-area sub-folders → one `kind:"board"` page each).
  A new hidden **`Board Category`** select is THE scoping tag: every option instance carries it,
  every board dropdown's find predicate matches on it (always `AND meta.feedSourceId IS_EMPTY` —
  feed copies carry their source's tag and would otherwise double-list), and every board
  CONTAINER occurrence carries its OWN tag value + a `feed` on that tag. So the tag is the source
  of truth and the board is the materialized view: an option tagged anywhere gets pulled in.
  31 new occurrence-dropdown fields; 8 of them query SEVERAL boards via an OR-group predicate
  (Purchase Item, Ingredient, Media, Skill, Reading, Savings Goal, Creative Work, Idea).
  Recipe boards bind other dropdowns (a Meal carries its Ingredients, a Program its Movements,
  an Event its People + Place).
- **`addNew.targets` — "select an occurrence" (the one client change besides themes).** New
  `helpers/addNewOption.js`: `targets` is a plain list of candidate PARENT OCCURRENCE ids; when
  there's more than one the picker asks which, rendering each by its LIVE label. The new option's
  identity fields are copied from the CHOSEN PARENT at run time (`buildStampFields` reads the
  dropdown's own predicate fields off that occurrence) — nothing in the code knows what a "board"
  is. `addNew.fieldIds` additionally prompts for field values through the EXISTING GET_USER_INPUT
  modal. **Found a latent bug doing this:** Field.jsx read `s.gridId`/`s.userId` off the actions
  context, which never carried them (they live on `s.state`), so `createLeafInstanceInParent`
  silently bailed and "+ Add new" had never minted anything. Fixed with `s.state` fallbacks.
- **Pages restructured**: ONE **Routines** board page (9 dimension containers, vintage colors,
  ~103 granular action instances) replaces the 11 wellness pages; **Tasks** (the same 9
  containers, EMPTY, `meta.todoListContainer` kept) replaces Todo List; **Trackers** (all goal
  containers + the account containers, 18 children) replaces Goals AND Accounts.
  `goalsPageOccId`/`accountsPageOccId` are now aliases of `trackersPageOccId` so every
  HAS_ANCESTOR-scoped tracker rule kept working; a post-save pass rescopes the 20 ops whose
  `ancestorLabel` was baked as "Goals"/"Accounts" by `makeTrackerOp` (builders untouched — the
  project is data-only apart from the two permitted client changes).
- **People is a BOARD** (Social folder, feed-backed, the 10 person occurrences parent under it).
  The standalone People page + table + profile-card page + their two ops are DELETED.
- **Trackers retargeted, same goals**: workouts key on the **Movement pick** (muscleGroup lives on
  the picked movement OPTION now, so the per-muscle Volume trackers resolve the pick and read ITS
  muscleGroup, and Workout History rows read "Bench Press", not "Exercise"); the 4 per-meal
  Nutrition trackers collapse to ONE Eat-scoped `Meal Nutrition`; media history reads the new pick
  fields (Media/Reading became multiSelect so the trackers' pick-array loops still apply);
  **Track** is the universal money occurrence (flow toggle in/out/**replace**) superseding Set
  Account Balance; **Earn** carries Income (the Checking Balance NET agg is Income minus Amount,
  so the two money fields must stay distinct).
- **Verified**: 1352/1352 client + 245/245 server, build clean. Headless on the reseeded grid:
  Routines 9 colored containers · Tasks 9 empty · Trackers 18 children with live tiles · Schedule
  builds with the new routine clones (Drink/Hygiene/Eat/Walk/Exercise/Journal) · 34 feed-backed
  board pages · Pomodoro intact · zero page errors · multi-target addNew E2E (add "Tortillas" via
  Ingredient → pick Grocery List → lands there, tagged `grocery`, tag binding hidden).
- **NOT done / deliberate**: no deploy yet (see Task 8 Step 4 — `./deploy.sh` + verify prod HEAD).

---

## Handoff — 2026-07-25 (2) (tracker containers carry the date; account containers merged; mobile scroll reaches the end)

Follow-on batch to the Poms rebuild, all shipped + deployed (`f06bbddf`, prod HEAD verified) and
verified live on prod with a mobile probe:
- **The date phrase moved from the tracker TILES to their CONTAINERS.** `Trackers: Date-Prefix
  Labels` now stamps `"Today's <Dimension>"` on each container under the Trackers page and CLEARS
  `occurrence.label` on the tiles inside, so a tile reads as the bare metric ("Connection Time").
  Reading `moduleLabel` — not `label` — is what stops the op re-prefixing its own write.
- **The five "account" containers are gone.** Finances / Fitness / Learning / Productivity /
  Wellness were a second taxonomy beside the nine dimensions, which is what produced the user's
  "Today's Financial next to Today's Finances". Their tiles now live in the dimension they belong
  to (`acctKeys` on each `goalMappings` entry): Finances→Financial, Fitness→Physical,
  Reading→Intellectual, Productivity→Occupational, Wellness→Emotional. Tracker ops target tiles by
  occurrence id, so re-parenting them changed nothing else.
- **Mobile Schedule "stops at 9:30pm" ROOT-CAUSED and fixed.** Not the clamp (that fix was already
  live and correct) — the page scroller INSIDE a multicell panel sets `overscroll-behavior: contain`
  inline, so on reaching its end it never chained into the viewport and the panel's lower half was
  unreachable. Driving the scrollers by hand proved it: inner-at-max stopped at 9:00pm, and
  `viewport.scrollTop = 814` then showed 11:30pm. The viewport now stamps
  `data-panel-native-scroll` while the mode is live and CSS flips descendants to
  `overscroll-behavior-y: auto !important` (the viewport keeps `contain`, so nothing chains out to
  the document).
- Container header labels one size up (they matched the instance labels); occurrence-dropdown
  option rows drop the "Set image" overlay once an image is set.
- 1352/1352 client + 245/245 server, build clean, reseeded, deployed.
- **Probe lessons (cost two runs each):** a text check ("is 12:00am on screen") proves nothing about
  which mobile cell is ACTIVE — every panel's DOM sits in the slider, just translated off-screen;
  detect a multicell panel by the viewport flipping to `overflow: auto`. And synthetic `TouchEvent`s
  do not drive native scrolling at all — drive the scrollers directly and assert on geometry.

---

## Handoff — 2026-07-24 (drag autoscroll feel + multicell panels scroll natively on mobile + smaller insert gap)

Per user (CLAUDE_CHAT 2026-07-24), three UX asks, all shipped + headless-verified:
- **Drag-over autoscroll** (any scrollable, mobile priority): new pure `helpers/autoscrollMath.js`
  — zone = quarter-height clamped [56,150] (was fixed 80px), speed RAMPS 6→32 px/frame toward the
  edge (was flat 10), 70px GRACE band keeps the last scrollable scrolling when the finger
  overshoots its rect (the old dead-stop = the "finicky"), and the scan hands off from an inner
  scrollable at its end to the one behind it. Verified with a REAL drag session (probe lesson:
  a Playwright drag from an off-viewport handle never starts — selection-autoscroll mimics it).
- **Multicell panels (h or w ≥ 2) on mobile scroll CONTINUOUSLY** (user picked native viewport
  scroll): the mobile viewport becomes an overflow:auto scroller clamped to the panel's row/col
  range; transform anchors to the panel ORIGIN; activeCell silently tracks the nearest sub-cell;
  cell-snap (overscroll + rails, edge sub-cells only) survives ONLY for crossing to a different
  panel. Publishes `data-scroll-max-top/left` so drag autoscroll respects the clamp.
  MobileGridNav pure helpers exported + tested.
- **InsertGap declawed**: 8px hit zone (was 14) + centered 50% line/click strip (was
  edge-to-edge) — stops eating clicks/drag-starts meant for the rows around it.
- 1336/1336 client tests (33 new), build clean. No reseed needed (client-only).

---

## Handoff — 2026-07-20 (alarm → schedule op: fired alarms drop an instance onto today's Schedule)

Per user (chose Option A — per-alarm op step, "like the pomodoro"). A fired alarm/reminder now
also drops an instance onto TODAY's Schedule:
- **`makeAlarmOp` (server) + `buildAlarmOperation` (client) gained `sched`** ({ date, timeslot,
  scheduleFormat field ids }). When set, the pipeline appends `alarmScheduleSteps` after the
  NOTIFY: FIND Schedule page → today's day-col (`scheduleFormat="day-col"` + date SAME_DAY today)
  → the slot matching the alarm's TIMESLOT (`alarmTimeslotLabel`: 17:00→"5:00pm"; :15 stamps
  "5:15pm" but skips the slot FIND → lands in the day-col) → de-dupe on the timeslot FIELD (one
  instance per timeslot per day) → CREATE the alarm instance stamping date + timeslot (hidden).
  The two builders are twins — **keep in sync**. Fires via useScheduler (executePipeline).
- **Per user mid-build**: match/de-dupe on the timeslot FIELD not the label; slot containers +
  the created instance carry that field (any occurrence can). Pomodoro: Start already matched +
  stamped the timeslot field — unchanged, now consistent.
- **`grid.meta.scheduleFieldIds` seed-stamped** — AlarmDropdown reads it to bake `sched` into
  alarms it mints; the seeded 5 PM / 6:30 AM alarms pass it too. **RESEED REQUIRED** (the live
  grid has no scheduleFieldIds yet, so alarms stay plain NOTIFY until reseeded).
- Verified: 245/245 server + 1306/1306 client (6 new tests) + build clean. Deploy + reseed next.

---

## Handoff — 2026-07-14 (4) (unique field names — standing rule; all 11 seed duplicates renamed)

Per user: "there shouldnt be duplicate field names." Swept the seed (`7c46256a`, reseeded):
display twins renamed — Total Protein/Calories/Carbs/Fats, Total Workouts, Total Phone Calls,
Movie/Book/Podcast/Course History, Person Notes. INPUT fields keep the natural names (what users
and `[Field]` label tokens reference). Zero duplicate names verified post-reseed; 1289/1289.
Recorded as memory `feedback-unique-field-names` (with `feedback-no-abbreviations` from the same
session). FieldsTab now ENFORCES it (`42c56c21`): Save rejects colliding names (case-insensitive, inline
error), "+ Field" mints unique defaults; labelTokens' carried-field tiebreak stays as a last net.

---

## Handoff — 2026-07-14 (3) (label [Field] tokens; 4-macro meal tiles; per-set weights; full headers)

Third batch (CLAUDE_CHAT 2026-07-14 (3)). Deployed + reseeded:
- **`[Field]` / `{Field}` label tokens (NEW `helpers/labelTokens.js`)** — an instance label
  containing `[Water]` renders the bare LIVE value ("16"); `{Water}` renders name + value + unit
  ("Water 16oz" — the user's "display the field name too" form). Display sites: ModuleInstance
  labels + RepresentationView chips. **Colon write-back (same-day extension)**: double-click
  rename materializes the current value into every token (`Drink {Water:16oz}`); typing a new
  value writes the FIELD on commit (triggerField per write → trackers fire) and the label
  re-stores value-STRIPPED, so stored labels never go stale. Carried-value wins over duplicate
  field names; unknown brackets/braces stay literal ({ProjectName} template tokens safe). Fills
  the INSTANCE gap in the editor↔field binding system — BoundHeader/BoundBody remain the
  whole-slot binding path with linked-sibling sync. 16 tests.
- **Per-meal Nutrition tiles carry all four macros** — new "Calories" display field; the 4
  per-meal trackers accumulate calories/protein/carbs/fats in one loop and write 4 goal fields
  (protein FIRST — trackerValue() reads the first write); tiles bind all four. Behavioral test.
- **Workouts: per-set weights** — Weight 1/2/3 fields bound PAIRED with their sets on all 30
  exercises; Workout History rows carry s1/w1/s2/w2/s3/w3; headers are the FULL names
  (Set 1/Weight 1/… — per user, no abbreviations; the table marquee owns the width).
- **Verified**: 1280/1280 client + 237/237 server, reseeded (73+ ops? — see export), deployed.

---

## Handoff — 2026-07-14 (2) (pomodoro = elapsed time; multiples per slot; bare "None"; 3 set counts; table marquee)

Second batch of the session, per user directive (CLAUDE_CHAT 2026-07-14 (2)). All deployed +
reseeded (72 ops now):
- **Pomodoro sessions track RUNNING time**: start at 0 minutes; new `PomoTickOp` (timer fires it
  each running minute + on pause) → new **"Pomodoro: Update Time"** op writes elapsed minutes
  onto the open session. Timeout → Pomodoro: Complete writes the full phase minutes + Completed;
  completing the occurrence EARLY (checkbox) keeps the shorter ticked time. Pause→resume no
  longer mints a second session (Start fires only on a fresh phase).
- **Multiple pomodoros per slot exposed a real bug, fixed**: Start's COPY_LINK source was
  FIND-by-label "Pomodoro" — session copies inherit the module label, so the 2nd start of a day
  matched template + session #1 → array → broken create. Source is picker-direct now
  (`$allItemsById.<template occ id>` captured at seed wiring).
- **Dropdown "None" is bare** — no explanatory wording; where "none" routes is the operation's
  business (user: "the system doesnt know what it is. its just none").
- **Workout History rows carry all 3 set counts** (s1/s2/s3 columns replacing the single "Reps"
  = Set 1 only) and **both array-column tables (compact + full) marquee the WHOLE table box** via
  AutoMarquee when the columns overflow (static when they fit).
- **Verified**: 1272/1272 client (4 new/updated behavioral + display) + 237/237 server, build
  clean, deployed, prod HEAD verified, reseeded (dev=prod Atlas).

---

## Handoff — 2026-07-14 (workout history + pomodoro stale-slot orphan FIXED; timeslot language dropped)

Continuation of account3's interrupted session (its systematic-debugging pass on the user's
2026-07-14 report — see CLAUDE_CHAT 2026-07-14). All three parts shipped, deployed + live grid
reseeded (same Atlas DB as prod, so the local reseed IS the live reseed; deploy restarts pm2):
- **Workout History (Workouts display) fixed** — account3's root cause confirmed + shipped: the
  tracker's loop gated on `workoutType` (bound only by the generic "Morning Workout" task), but
  exercise instances (Bench Press…) carry `muscleGroup` → every exercise was excluded and the
  Exercise/Reps/Wt history stayed `[]` forever. Gate is `muscleGroup IS_NOT_EMPTY` now
  (createLiveData.js ~8597). Behavioral test asserts history rows land.
- **Pomodoro "nothing created in the timeslot" — REAL bug, prod-verified:** the session WAS
  created (05:02:32Z, fields all correct) but parented to a slot that no longer exists. The
  Pomodoro: Start slot FIND matched by LABEL ONLY (any `scheduleFormat:"slot"` under Schedule);
  started at 12:02am it grabbed the PREVIOUS day's "12:00am" per-day slot copy — invisible under
  that day-col's date cascade, then orphaned when the 12:01am new-day rebuild swept the old
  day-col (day-col + 48 fresh slot copies mint per day; prod timeline: rebuild 05:01:19Z, session
  05:02:32Z). FIX: the FIND now resolves TODAY's day-col first (`scheduleFormat IS "day-col"` +
  `date SAME_DAY $today`) and only accepts a slot `HAS_ANCESTOR $dayColId`; empty $dayColId
  fails closed (HAS_ANCESTOR vs empty right matches nothing) → op no-ops instead of wrong-day
  writes. 2 behavioral tests: session lands under today's day-col; a stale-day-col slot whose
  label exists nowhere else NEVER matches (no-op).
- **Timeslot language removed from the Pomodoro UI** (PomodoroTimer.jsx): dropdown option now
  "Automatic (today's schedule)"; comment reworded. Slot-matching behavior itself stays (user:
  "the issue is not decoupled — the schedule is up when i did this").
- **FOLLOW-UP (same session, user live-tested): "last workout works but not Workouts"** — the
  muscleGroup fix put the rows in the DB (verified: prod goal occ carries the Bench Press row),
  but the tile still showed "—": a DISPLAY bug previously masked by the always-empty data.
  `Field.jsx` (a) `rawDisplayValue` nuked bare arrays to undefined (the display-path twin of the
  2026-07-12 extractValue fix) and (b) the compact pill branch returned before the columnar-table
  branch, so compact tiles could never render `displayConfig.columns` rows. Both fixed — ALL
  array-history tiles (Workouts/Meals/Moods/Purchases) now render their tables on goal tiles.
  3 tests in Field.arrayValue.test.jsx.
- **Verified**: 1268/1268 client (6 new) + 237/237 server, build clean, prod HEAD checked
  post-deploy, live headless probes: Workout Log tile renders its Exercise/Reps/Wt rows.
- **Probe lesson (recorded)**: the behavioral harness proved the op pipeline GREEN on a fresh
  seed — the live failure only surfaced from prod DB ground truth (orphan session row). When a
  harness repro passes but the user sees failure, diff LIVE STATE against the harness world
  before touching the pipeline.

---

## Handoff — 2026-07-13 EVE (audit follow-through: categoryKind SHIPPED; caret diag now opt-in)

Continuation of the PM audit ("keep going"). Finished the remaining audit surfaces (image
routes, ContainerTable child-rows sort, PageCanvas fallback, ModuleInstance under-body fields,
OpDisplayPill — all clean), then shipped the deferred altitude fix (`f64a9c9a`, deployed +
reseeded + verified headless):
- **`Folder.categoryKind` ("field" | "op")** — the field-vs-op category axis is now DATA stamped
  at creation (seed: 9 field + 7 op categories; both tabs' "+ Category" stamp their kind).
  FieldsTab/OperationsTab column filters read it first; the contents inference survives ONLY as
  the fallback for legacy null folders. Fixes both symptoms: op categories no longer render as
  empty FieldsTab columns, and deleting a category's last op can't flip its axis.
- **[caret] diagnostics flipped to OPT-IN** (`window.__caretDiag = true` re-enables) — the
  Firefox caret fix is deployed + verified, so per-click console logging no longer ships on.
- Verification-probe lesson (recorded so the next session doesn't chase ghosts): innerText
  substring checks against the Command Center match TAB LABELS and OP NAMES ("Alarms" the tab,
  "Breakfast Nutrition" the op) — assert against the folder stamps / DOM structure instead.

---

## Handoff — 2026-07-13 PM (correctness audit of the whole since-Monday range; alarm-at-load bug FIXED)

Per user: audit everything shipped since Mon 2026-07-06 (103 commits, `b8fb96bd^..HEAD`) for
correctness + optimization. Subagents were unavailable (account spend limit) → ran the review
INLINE: line-by-line over the fresh runtime surfaces (feedSync engine, useScheduler adaptive
tick, server models/handlers incl. update_grid no-upsert + ensureUserManifest, Field.jsx value
paths, dragSystem payload round-trip, NOTIFY), cross-checked removed behaviors (QuickAddMenu
trigger matrix across all 5 hosts, artifact-page legacy views, manifest core semantics), plus
live probes. Two findings, both FIXED + deployed (`1e2a042f`, prod `2d11b72f`):
- **Alarms rang/toasted on EVERY page load (real bug, user-visible):**
  `computeTriggerMatch` treated `triggerTypes: []` as "no config → fire on load", but explicit
  `[]` is the seed's schedule-only declaration (atTimes alarms, interval slot painters). The
  onLoad sweep executed both alarms' NOTIFY inline (60s ⏰ toast + ringAlarm — the paired
  AudioContext warnings in the user's 2026-07-13 console log; 0fx because NOTIFY pushes no
  effect). Explicit [] now never event-fires; legacy no-config ops keep the load back-compat;
  ops that want a load fire declare "onLoad" (Project: Create already does). Verified live:
  onLoad sweep 59→55 ops, no toast/ring; scheduler firing untouched. Old test locking the buggy
  semantics corrected + 2 new cases; 1264/1264.
- **parseExternalDrop dropped the normalized payload `occurrenceId`** on cross-window drops
  (serializePayload carries it; the parse branch rebuilt the payload without it) — round-trips now.
- Clean on inspection: feedSync (scan-diff + accumulated parent ref), cadenceMs (Infinity for
  atTimes → clamps to the 5s tick, no NaN interval), server model additions (declared-key fixes
  for fieldBindings.role/display strict-mode stripping), update_grid zombie guard, image-picker
  write path. `.gitignore` probe pattern UNANCHORED (`_*.mjs`) — deploy.sh's add -A swept
  client/-rooted probe scripts into deploy commits twice.
- Still-open (unchanged, deliberate): Folder `categoryKind` stamp (own session), the user's
  doc-open perf repro, "copies when it should move" repro, [caret] diagnostics removal once the
  user confirms.

---

## Handoff — 2026-07-13 (caret round 2 FIXED: Firefox draggable-ancestor suppression; deployed `837e4542`)

The user's [caret] logs closed the case in one round-trip: caretAtPoint resolved the mid-chip
click at offset 8, the selection SETTLED at 0, and there were ZERO INTERFERE lines — no JS moved
it; the BROWSER refused placement. The user is on FIREFOX (AudioContext wording + `user-drag=-`
in the drag-source chain), and a discrimination probe (headless FF) proved the mechanism:
**Firefox suppresses native caret placement in an editable that has ANY `draggable="true"`
ANCESTOR** — stripping every draggable attr made the identical click land at offset 10; a bare
nested-editable island works fine. Round 1 (f2e89136) only fixed Chromium's CSS vector.
Fix (`837e4542`, deployed + prod HEAD verified + reseeded):
- **Chip** (InstanceTextblockInlineNode): wrapper's draggable ATTRIBUTE disarmed at rest (armed
  with the CSS hint only while the radial drag handle is pressed) + the content span places its own caret
  from the click point on click (ancestors can't be disarmed — they're real drag sources).
  Range selections are left alone.
- **Editor.jsx**: the mousedown posAtCoords fix-up (the thing that rescues BLOCK textblocks from
  the same suppression) is gated to the editor that OWNS the click — it used to fire in every
  ancestor editor per click (4 competing setTextSelection writes; now 1).
- Verified headless FF + Chromium: chip mid-click → caret mid-text + typing inserts there; FF
  block textblock → offset 64; handle drags arm; wrap 6/6 on a fresh seed; 1262/1262 tests.
- **[caret] diagnostics are still in** (helpers/caretDiag.js, ON by default, once per click) —
  remove or default-off once the user confirms on-device. Probe lesson re-confirmed: a failing
  wrap probe on a dirty grid (`on=false` 6/6) went green after a reseed.

---

## Handoff — 2026-07-12 NIGHT-2 (caret round 2: [caret] diagnostics deployed → FIXED above)

User: "clicking on mini textblocks in the middle is still not putting the writing cursor there —
it puts it at the start; put in logs." Round 1 (f2e89136) fixed the inline chips' user-drag
suppression; desktop headless still places mid-text (chip SETTLED offset 13), so round 2 ships
INSTRUMENTATION instead of a guess (`09d0f7b7`, deployed, prod HEAD verified):
- **`helpers/caretDiag.js` (NEW)** — `[caret]` console lines, ON by default (once per click;
  `window.__caretDiag = false` mutes): DOWN (target, coords, pointerType, caretFromPoint = what
  the browser WOULD place, drag-source ancestor chain = the round-1 signature), SETTLED at
  100/400ms (where the selection actually ended up), INTERFERE (selection writers inside the 2s
  click window: Editor's posAtCoords fix-up + rAF setTextSelection, setContent sync,
  the two padding-click focus('end') sites). Wired into Editor.jsx / DocContent.jsx /
  InstanceTextblockInlineNode.jsx.
- **Early signal from the baseline run:** mousedown BUBBLES through nested editors, so EVERY
  ancestor editor runs the wrapper's posAtCoords caret fix-up against ITS OWN doc and schedules
  its own rAF setTextSelection — the outer editor resolves the click to the atom boundary
  (pos 0/1 = the START). Two competing selection writes per click; likely the winner differs on
  the user's device/geometry. **Next session: get the user's [caret] console lines** (which host:
  block-mini-textblock vs chip vs card; which INTERFERE line lands last before a SETTLED-at-0)
  and fix the losing layer — probably gate the fix-up to the INNERMOST editor only
  (e.g. skip when `e.target.closest('.doc-editor') !== el`).

---

## Handoff — 2026-07-12 NIGHT (simplify-audit APPLIED + spinner fix; the queued full audit is DONE)

Continuation session (account2): picked up account3's session-limited audit + account2's
spend-limited perf thread via the jsonl logs. The queued "/simplify full audit over the past
couple days" had its 4 review agents FINISHED but unapplied (results recovered from
/tmp task outputs); this session applied them all. Shipped (3 commits + docs, deployed):
- **Spinner fix committed** (`4911c9f8`) — account3's uncommitted `viafluere_mark.png` re-crop
  (mark's visual center = rotation pivot; re-verified bbox center within 0.5px) — the infinity
  logo now spins like a top, not a train on a track. Queue item CLOSED.
- **Server dedupe** (`10d99928`) — `makeAlarmOp` (seeded alarms derive from one builder; the
  hand-typed 6:30 AM literal had ALREADY drifted), shared `completionGateOrRule`, one
  `ensureManifestOfType` core behind templates/user manifests.
- **Client audit fixes** (`9ed82dd9`, 19 files) — reuse: openPanelOnRootFolderPage /
  createPagePinnedToPanel / spliceChildIntoParent / isTextmappedModule / arrayIncludes /
  DeltaBadge + one FLOW_TINTS source; altitude: artifact pages mint a REAL View (ModulePage's
  synthesized-view branch deleted), ensureArtifactPageOcc owns the role gate, **QuickAddMenu
  contract fixed at the root** (positive openTrigger opens at MOUNT; onOpenChange on transitions
  only → the 50ms deferrals + gapMenuWasOpenRef workarounds are deleted, ModulePanel's hidden
  menu mounts lazily), createPayload normalizes occurrenceId; perf: dragover uses e.target (no
  per-frame elementFromPoint), detectSideHost depth<1 identity fast-path, ONE shared dragend
  registry, WrapGroupNode single fused prose walk, _boundFieldIds per-template WeakMap cache.
- **Verified**: 1262/1262 client + 237/237 server + build; headless E2E — panel "Add page…"
  (lazy menu opens), doc "Add occurrence here…" (pinned gap palette, no deferral), tree artifact
  click → display page renders via the real View, wrap 6/6 drops re-verified.
- **Deferred (filed, not done)**: OperationsTab/FieldsTab field-vs-op category classification is
  still contents-inference — the altitude fix (stamp `categoryKind` on the Folder record at
  creation + one-time migration) needs schema + seed + both tabs in one session. Also still
  open from the last session: the user's "2 seconds to open a doc page" (measured 287ms
  unthrottled headless; needs the user's device context — likely the eager-TipTap docket).

---

## Handoff — 2026-07-12 LATE (2-col gating + depth fallback + doc-DnD audit; deployed `63fc5dd1`)

All deployed + prod reseeded, HEAD/tree verified. On top of the morning batch:
- **2-col side gating** (per user): NO left/right side points on an existing wrapGroup for outside
  drags — EXCEPT directly over the NEIGHBOR COLUMN, which stacks the drop into that column
  (columns hold N occurrences; host side is one block). Group members always pass (drag = re-morph
  side/anchor). Dragged occ id: threaded into detectSideHost at drop time; `body.dataset.dragOccId`
  (DragProvider stamp) covers dragover indicators.
- **detectSideHost depth<1 fallback**: posAtCoords resolves to the DOC gap at block edges (always,
  for a single-block nested section) — now falls back to the top-level block whose Y-band contains
  the pointer. This was silently killing side drops in single-block sections.
- **Under/above a wrapped image**: exactly ONE honest indicator now (was "2 above, none below").
- **Doc-DnD audit (mouse, headless)**: columns form beside non-text embeds ✓, swap button flips
  sides ✓, wrap↔columns toggle ✓, wrap 6/6 form + 6/6 member re-morph ✓, neighbor-column stacking
  gate ✓, boundary lines honest around wrap groups ✓, 1241/1241 + 237/237. NOT re-run: TOUCH
  parity for the new columns/gating paths (same handleDocDrop/getDocTouchDropZone code, but
  unverified on-device this round).
- **Description v3**: generic-first (the system doesn't know what a "schedule" is — it's a use
  case; the workspace/blocks story leads). Probe note: `_wrap6mouse.mjs` now anchors on the "Most
  apps decide in advance" textblock and measures PLAIN-host wraps (group-adds are gated now).
- **#9 mini-textblock caret FIXED** (`f2e89136`, deployed): the bug was ONLY on the INLINE chips
  (`.itbi-content` — e.g. "Read ✅ 30 pages" in the viafluere doc), not the big textblock cards.
  Root cause: the chip sat in the `user-drag: element` CSS rule → the whole chip was a native
  drag source → Chromium suppresses caret placement in drag sources → click-to-edit landed at
  offset 0. Chip removed from the rule; the wrapper arms `user-drag:element` ONLY while the radial
  drag handle is pressed (InstanceTextblockInlineNode onPointerDown). Verified live: click at 60% of
  the chip → caret offset 10, typing inserts mid-text; handle drag-out still works.
- **Queued**: #13 — doc right-click menu needs an "Add occurrence" item opening the QuickAddMenu.

---

## Handoff — 2026-07-12 (wrap↔columns restored; side drops beside ANYTHING; ops categories; alarms ×2)

All deployed (`8f0b3ccf`) + prod reseeded, tree clean, HEAD verified. Shipped this session:
- **wrap↔columns restored** (docs/CLAUDE.md 2026-07-12 entry): wrapGroup `wrap` attr is back —
  textmapped hosts default to the L-morph with a radial Wrap on/off toggle; side drops beside
  NON-text occurrences (edge thirds) form side-by-side COLUMNS (wrap:false — no morph, no
  auto-stack, but stacks at low width). Seam renders in both modes + new ⇄ swap-sides button ON
  the seam. Neighbor column stacks N occurrences; host is one block.
- **Ops tab categories fixed**: field-only category folders no longer render as ops columns
  (data-driven: has fields + no ops = field category); the 8 uncategorized seed ops got homes
  (Moods/Phone Calls→Trackers, Rotator→Day Page Ops, Project ×3→new Projects, People ×2→Library).
- **Seed**: Viafluere description rewritten (layman + depth, same wrap); 6:30 AM alarm added
  beside the 5 PM one; Schedule hides Date/Time Slot/Last Seen (fieldVisibility, prior commit).
- **Caret-at-click investigated**: NOT reproducible on the current build (doc cards, section
  blocks, inline chips all place the caret at the click point headless — offsets 21/35 verified).
  The user's repro was on the stale prod build. If it recurs: get WHICH textblock + mouse/touch.
- **Probe discipline reminder**: two "regressions" this session (caret offset-0, wrap 0/6) were
  BOTH probe artifacts — stale coords after a second scrollIntoView, and dirty grid state from a
  prior probe run. Reseed + fresh coords before trusting a failing probe.

---

## Handoff — 2026-07-11 NIGHT (deploy pipeline fixed after a MASKED stale deploy; edge bar; field hiding)

**A deploy silently failed and shipped stale code** (user: "flow buttons the same / still no cash
account"): prod reseeds regenerated `server/seed/*.json` IN THE PROD WORKTREE, the next `git pull`
aborted on the churn, and piping the pull through `tail` masked the non-zero exit (`set -e` only
sees the pipe's last command) — so the old build was rebuilt and the OLD seed script reseeded.
Fixed at the root (`09b17a3a`): `deploydata.sh` reseeds with `--no-export` (exports are the
DEV-side fixture) and `deploy.sh` syncs prod via `git fetch + reset --hard origin/master`.
**Lesson: after every deploy, verify prod HEAD (`ssh … git log --oneline -1`), not script output.**

Also shipped (`06a7a9c7`, deployed + reseeded): **doc side-drop edge bar** — the wrap-beside
affordance was an invisible 2px horizontal sliver; detectSideHost now returns the host rect and a
full-height 3px vertical `.wrap-drop-edge` bar paints on the targeted side ("dropping to the
LEFT/RIGHT of this block"). **Schedule field hiding** — the Schedule page occ seeds
`fieldVisibility {mode:"hide", [date, timeslot, lastSeen]}`; rows show Completed only.
**Open:** (a) side-drop beside NON-text occurrences (nonwrapped column) — designed, task filed:
needs a wrapGroup variant that doesn't auto-stack for non-prose hosts; (b) "can't click into a
mini textblock" — NOT reproduced on current build (doc card / section block / inline chip all
take the caret headless); likely the stale build — awaiting user retest after hard reload.

---

## Handoff — 2026-07-11 EVE (deployed to prod; new-grid manifest + zombie-grid fixes; 3 tasks queued)

Account3 session. **Everything through the queue is DEPLOYED** (`6cfa64de` code + docs, then
`e20b92f3`): viafluere.com serves the new build, prod data reseeded TWICE (second time after the
grid fixes), origin current. Probe scripts + screenshots are now gitignored (`/_*.mjs`,
`screenshots/`) so `deploy.sh`'s `git add -A` can't sweep them.

**User's "4 columns to start" + "adding panels didn't work on a new grid / No content" — both
root-caused and shipped (`e20b92f3`):**
- The 4-column grid was a **ZOMBIE duplicate Live Grid**: `update_grid` upserted, so a stale
  connected tab's layoutTree write RESURRECTED the grid doc a reseed had just deleted (panel occs
  already gone → 4-child tree over missing panels + the user's "Board 6" test panel). Upsert
  removed; zombie + a dead skeleton swept from Atlas; fresh default grid verified pristine
  (5 panels, 3-col mosaic [0.8,1,0.8], single copy).
- New grids had **no user manifest** → the manifest tree, folder pages, and empty-cell panel-add
  were silently dead. New `server/utils/userManifest.js` (ensureUserManifest, called in
  request_full_state) + shared client `ensureRootFolderPageOcc` (importsFolder.js): the Toolbar
  + button AND empty-cell tap now open new panels on the ROOT folder page. E2E-verified headless
  (fresh grid → manifest present → both add paths → zero "No content" panels).
- Missed-task audit of all account session logs: everything shipped except one open repro ask —
  **"copies when it should move"** still needs a concrete repro from the user. The stale-chunk CC
  crash is a non-issue on prod (index.html no-cache + immutable assets verified live).

**All three queued items SHIPPED same session:** (a) **flow restyle** — FlowToggle is now a
divided leading segment INSIDE the pill/input (randomizer pattern) and the whole control tints
green/blue/red by flow (compact pills + full number/duration inputs; FLOW_TINTS in ui/Field.jsx).
(b) **Alarms tab** — new CC tab (AlarmClock icon): Android-style rows (tap the big time to edit,
label inline, alarm↔reminder chip, preview sound, enable switch). Each row IS an Operation —
`op.alarm` config + `schedule:{kind:"atTimes"}` + one NOTIFY step (now supports `sound`/`duration`;
`helpers/alarmSound.js` rings synthesized WebAudio beeps). `helpers/alarmOps.js` derives
name/schedule/pipeline from the alarm so they can't drift; the Operations tab renders alarm ops
READ-ONLY ("Managed by the Alarms tab" banner). Seeded **"Alarm: 5 PM"** (rings + notifies,
Alarms op category). Along the way the **hourly-chime lastFiredAt race is FIXED** (useScheduler
now dispatches the stamp locally before the socket emit) — E2E: an alarm fires exactly ONCE in
its minute. (c) **Cash account** — cashBalance field + Cash instance in Finances + gated
supportsReplace "Cash Balance" tracker (sum-of-amount like Mom's). 1241/1241 client + 237/237
server; live grid reseeded.

---

## Handoff — 2026-07-11 LATE (queued tasks shipped: flow button, image search, doc-DnD lines, Tasks Left red)

Reconstructed the cleared task queue from the other accounts' session logs and shipped 4 of 5
items, all on master (**DEPLOYED to prod 2026-07-11** by account3 at `6cfa64de` — origin current,
viafluere.com serving the new build; prod's local seed-export churn stashed as
`prod-local seed export churn (pre 6cfa64de deploy)`):
- **`f3755fde` flow side-button** — finished account3's in-flight work: compact number/duration
  pills opt in via `field.meta.flowToggle` (FieldsTab checkbox; Amount seeded). E2E-verified: the
  popover click that ended the last session works; picking a flow persists `{value, flow}`.
- **`bf616b90` image search everywhere** — audit found 2 gaps: NON-compact media-role fields were
  a raw URL text box (now the same thumbnail + Set-image → ImagePicker as the compact pill), and
  QuickAddMenu had no image path (new "Image" tile → ImagePicker search/upload/URL → new
  `CommitHelpers.addImageArtifactFromUrl` mints a remote-ref `kind:"image"` artifact, no upload
  round-trip; InsertGap threads `url` too). E2E-verified incl. reload persistence.
- **`7904de41` doc-DnD hover lines** — user: "3 hover lines, 2 white dead + 1 blue works; can't
  drag to the right of anything". Root causes: StarterKit's PM Dropcursor per editor instance
  (white, dead — custom handler owns drops) → disabled; DragProvider's inst edge indicators inside
  docs (dead — it bails on `.doc-editor`) → hidden via CSS; and detectSideHost only ran on the
  PAGE editor, whose posAtCoords returns pos 0 over NESTED section-container content → the
  wrap-beside affordance never showed there (drops wrapped via delegation, invisibly). Delegate-only
  nested editors now paint their own indicator lines; the page editor yields via the same zone
  lookup; wrap line and gap line are mutually exclusive. Verified: exactly ONE honest line at every
  position, L/R side flips, 6/6 wrap drops still form.
  **NOT reproduced:** "copies when it should move" — handle drags MOVE+detach correctly in-doc,
  panel→doc, wrap→doc, AND doc→panel (both page-level and nested-container embeds; probes
  `_copymove.mjs`/`_bodydrag.mjs`). The briefly-suspected drag-OUT no-op was a probe artifact
  (stale drop coords). Need a concrete repro from the user if copies persist.
- **`a5e2436a`+`7caec5a8` Tasks Left red until 0** (user directive this session) — root cause was
  SERVER-side: `Field.displayConfig` was a structured sub-schema that silently STRIPPED
  `targetOp`/`startValue`/`columns` on save, so the seeded `"<="` countdown op defaulted to ">="
  and 10/0 read as met (green). displayConfig is now Mixed. Verified live: red at 10/0.
- 1231/1231 client + 237/237 server, build clean, **live grid reseeded** (probe writes swept, seed
  exports current). Probe scripts still at repo root (`_dnddiag/_copymove/_imagetile/_flowprobe…`).

**Wrap width thresholds SHIPPED same session (`2ed6f734`)** — sliver policy replaces the
all-or-nothing fill rule: new pure `decideWrapStack` in docs/wrapAnchor.js (8 tests). Stack only
when the beside band is blank / under ~2 lines / under 35% of the neighbor height (45% to
re-enter), or the prose column is under a readable 160px (was 60 — stacks much sooner when
shrinking). Long text × tall infobox now keeps wrapping at LARGE widths (the old 100%-fill rule
was width-inverted). The rendered guard measures TEXT RECTS in the neighbor band (the old
prose-BOX check missed the fully blank column in the 2026-07-09 screenshots). Thresholds =
`WRAP_SLIVER_*`/`WRAP_MIN_PROSE_W` constants — tune to taste. Queue is EMPTY; all 5 tasks shipped.
**Deployed to prod 2026-07-11** (`6cfa64de`); probe scripts + screenshots are now gitignored
(`/_*.mjs`, `screenshots/`) so `deploy.sh`'s `git add -A` can't sweep them.

---

## Handoff — 2026-07-11 (tracker gating + Set Account Balance shipped; executor log-cap OOM/perf fix)

Finished account2's in-flight work on the 2026-07-11 directives (`e9778bc9` + `9c3e19b5`, master).
**Gating policy shipped:** an item moves trackers/goals only when IN THE SCHEDULE **and** COMPLETE;
an item whose module never binds Completed counts on schedule membership alone. The discriminator is
the module BINDING (new executor `$item._boundFieldIds` enrichment + `ARRAY_NOT_INCLUDES`
comparator), never the stored value — account2's `IS_EMPTY` OR-form counted bound-but-unchecked
items (caught by the behavioral suite). accountRef trackers ALSO scope to Schedule now (toolkit
money items no longer move balances). countTrue/completionRate-done stay strict `IS true`;
`utils/completionGate.js` migrated to the same binding form. **Set Account Balance:** new Financial
Tasks task; its amount is `flow:"replace"` — `makeTrackerOp supportsReplace` (Checking + Mom's)
treats the latest completed in-Schedule replace entry as the balance BASE, with only
same-day-or-later non-replace transactions stacking on top. Verified end-to-end in
`liveOpsBehavioral` (23 tests): reset 500 + same-day ±in/out = 575; replace entries never hit
Spent/Earned. **Executor perf/OOM root-caused:** per-iteration run-log entries (loop_iter +
resolved if-snapshot × ~2500 items × loops × ops × 25 retained runs) OOM'd an 8GB heap and cost
~2-3s/fire — PRE-existing on master (A/B-probed via stash). Loops now log 50 iterations then a
`loop_truncated` marker + mute (FIND candidates stay uncapped per the 2026-05-06 decision).
Measured: onLoad sweep 6.5→1.2s, add-fire ~2.8→0.8s, heap 5GB→1.2GB. 1217/1217 client + 237/237
server, build clean, **live grid reseeded** (seed exports current). **Queued (user, this session):
(a)** image SEARCH in every image-upload spot (image fields / profile pics / dropdown-picker
thumbnails) — Calibre-style one-click; audit which spots miss the existing ImagePickerMenu;
**(b)** the flow side-button on value inputs — green/blue/red = in/replace/out — so ops read the
stored flow (Set Account's UI).

---

## Handoff — 2026-07-07 LATE-3 (occurrence FEEDS shipped — Table:/Canvas: Build ops replaced)

**Feeds are live.** `occurrence.feed = { enabled, conditions, roles, scope, sort, limit }` on any
container or page = a declarative materialized FIND: matching sources (filter-menu conditions +
the owner's effective date cascade) are minted as COPY-LINKED children (`meta.feedSourceId`,
drag-locked to copy), alongside the owner's own children. Engine: `helpers/feedSync.js`
(scan-based self-healing diff, mint/sweep/re-link, accumulated parent ref, fireTrigger:false +
markDerivedOcc echo suppression), scheduled debounced from bindSocketToStore. Trackers exclude
feed copies (`meta.feedSourceId IS_EMPTY` in makeTrackerOp + inline trackers) so feeds can't
double-count. UI: `ui/FeedSection.jsx` in container/page header menus. `Table: Build` +
`Canvas: Build` seed ops DELETED (68 ops now) — Schedule Table (child-occurrence ROWS, new generic
ContainerTable rendering; Goal column dropped) + Schedule Canvas (center-stacked fallback
positions) carry seeded feeds and now INHERIT the date cascade. Verified headless: both pages
materialize today's 6 tasks; reload = zero-write no-op; orphan/dupe self-heals. 12 engine tests;
1212/1212 client + 227/227 server; reseeded. Spec + as-built record:
`docs/superpowers/specs/2026-07-07-occurrence-feed-plan.md` (v1 limits listed there).

---

## Handoff — 2026-07-07 LATE-2 (trackers fixed both orders + notifications overhaul + behavioral test suite + delete-recount fix)

Continuation of the `.claude`-account session (hit its limit mid-edit of createLiveData). All on
`audit-fixes-dnd-wrap-menus`, 4 commits. **Root cause shipped**: tracker ops only had
container-role onAdd/onDelete triggers — instance drops into Schedule slots never re-aggregated.
Every makeTrackerOp now registers the instance-role pair; the `isTask` marker field is REMOVED
(no-hardcoding rule) in favor of the generic `presenceFieldId` (IS_NOT_EMPTY) discriminator
(Pomodoros→pomodoroNumber, Total Workouts→muscleGroup — Workouts was counting water logs).
Verified BOTH orders headless + as tests (complete→drop bumps on the DROP; drop→complete on the
toggle). **Second real bug found & fixed**: deletes never decremented trackers — the delete
snapshot rode `occurrencesOverride` back into executor state (recount still counted the deleted
item). Now the snapshot rides ON the transaction (`_occurrenceSnapshot`, trigger-context only);
override plumbing removed end-to-end.

**Notifications**: op pills carry actual results ("Monthly Bills: Amount→2040.97", "+2 Stretching",
per-item Days Until Due) via `helpers/opResultSummary.js`, shared across all three fire sites
(the drop-move site previously swallowed successes AND failures). Drag toasts name the destination
with page context ("Moved X: Finance & Admin → Schedule › 3:00am (#1)") via a structural
page-ancestor walk; doc-embed drag-outs toast too.

**Behavioral audit is now a test suite** (`client/src/__tests__/liveOpsBehavioral.test.js`, 18
tests): boots the executor on the exported seed (server/seed/*.json), replays the onLoad sweep,
fires real transactions for EVERY input type (boolean/number/duration/select/amount+flow/reps) +
drops/deletes + a multi-day picker selection rebuilding the Schedule (3 day-cols), asserting
tracker VALUES read from each op's own pipeline targets. `datePickerSelection.test.js` locks the
single/range/multi/week/month/year classifier rules. Picker: today-hint is now much lighter than
selection (user ask). Quote artifacts render 13px = doc body. **DnD matrix audit** delivered:
`docs/dnd-matrix-2026-07-07.md`. **Feed plan** (occurrence-menu feed pulling occurrences by
filter-menu conditions) written + soundness-reviewed, NOT implemented — awaiting user review:
`docs/superpowers/specs/2026-07-07-occurrence-feed-plan.md` (3 open questions at the bottom).
1200/1200 client + 227/227 server, build clean, live grid reseeded (probe writes swept).

---

## Handoff — 2026-07-08 (feeds deployed; wrap-beside DnD fixed for cross-doc + wrapped hosts)

Account3's session shipped FEEDS (materialized copy-links, `helpers/feedSync.js`) + behavioral op
tests + notifications, merged to master and deployed. Its last in-flight task (wrap DnD
verification, user directive in CLAUDE_CHAT 2026-07-08) was completed by account2:
**`15883a67 fix(wrap)`** — dropping anything beside a textblock now wraps in ALL cases: cross-doc
MOVEs (was plain-insert-at-top-of-page) and hosts already inside a wrapGroup (new neighbors stack;
schema was already `moduleEmbed{2,}`). Verified headless: 6/6 L/R × top/middle/bottom positions,
persistence across reload, responsive at 4 widths, tablet rotation + rail cell-nav. 1227/1227
client tests. **Deployed to prod + live grid reseeded.** Probe scripts `_wrap6probe.mjs` /
`_wrap1diag.mjs` / `_wrapresp.mjs` / `_tabletrot.mjs` at repo root (token creds expire ~Jul 14).

---

## Handoff — 2026-07-07 LATE (image picker shipped + options-resolver fix + grid sweep)

Continuation of account2's session (hit spend limit mid-verify). **ImagePickerMenu** (Calibre-style
Search/Upload/URL image lookup) shipped and wired into occurrence-dropdown option rows, media-role
field pills, and the artifact image viewer; server proxy routes `/api/images/search` (DDG+Wikipedia)
+ `/api/images/upload` (bare upload). Verification surfaced + fixed two latent optionsResolver bugs
that had EVERY ancestor-scoped occurrence dropdown resolving to zero options (`$record.` prefix not
stripped in `resolveRecordPath`; `_ancestors` never enriched in `buildCollection`). 1162/1162 client
+ 222/222 server tests, build clean, e2e verified headless (Account dropdown → options → Set image →
URL commit). **Live grid reseeded + probe writes surgically removed.** Also per user: stale unnamed
2×3 skeleton grid deleted (again — recurrence of 2026-07-04) and `createLiveData` now auto-sweeps
dead skeleton grids on every default reseed (`sweepStaleGrids`); exactly 2 grids remain (Live Grid +
the 1×1 empty scratch grid). Queued (from account2, user notes mid-session): **goals overhaul —
"full representation of everything tracked/goaled, trackers included; extreme granularity is the
bar"** (task #9 successor).

---

## Handoff — 2026-07-06 (branch `audit-fixes-dnd-wrap-menus`, all 14 plan tasks shipped)

The full 14-task audit-fix plan (`docs/superpowers/plans/2026-07-06-dnd-wrap-menus-audit-fixes.md`)
is implemented and committed on `audit-fixes-dnd-wrap-menus` (not merged to master yet).
1154/1154 client + 222/222 server tests, build clean, **live data reseeded** after the perf probes.

Shipped: InsertGap crash fix (Task 1) · drop-path debug logs gated behind `__dragPerf`/`__dragDiag`
(2) · RadialMenu dead-prop cleanup (3) · ContextMenu 70vh scroll + flexible width (4) · QuickAddMenu
flip-above (5) · importer drops dead `wrap`/`anchor` attrs (6) · **line-level wraps clip/classify the
correct band** via new `wrapAnchor.hasMidAnchor`/`classifyWrapShape` (7) · Editor dragover math
rAF-throttled (8) · member-card scan shared + cached (9) · **dragSystem live-ref payloads — no
JSON.stringify deps, no listener re-registration on occurrence writes** (10, the perf core) ·
MobileGridNav scrollable-ancestor once per gesture (11) · touch pill shows Move/Copy/Copy-link (12) ·
mouse drags on touch-primary devices with a touch-dragstart guard (13 — **needs a real-tablet check**;
revert just that commit if Android long-press still starts a native ghost) · drop→paint re-baselined
(14): median 1742ms → 1378ms @5x throttle; still >600ms, so a **"drop frame-1 flush profiling"
docket entry** is filed in `client/src/CLAUDE.md` (separate session).

**2026-07-06 LATE-3 (`b6a98e14`):** computedValues moved off GridLiveContext to a per-key
`state/computedValuesStore` (all consumers migrated, 1159/1159 tests). A/B drop probe proved the
frame-1 flush is **NOT computedValues-driven** (pre 1750ms / post 1831ms median @5x, identical
render counts) — that hypothesis is closed; component-level profiler attribution is the remaining
frame-1 lever (docket updated). Migration kept for the drain-wave render win. Live grid reseeded.

**2026-07-07:** frame-1 flush ATTRIBUTED (new gated `__RENDER_ATTR` probe) and largely fixed —
drop→paint median **1750ms → 1066ms @5x**, renders 183/156/535 → 54/~10/~2. Three causes:
preview cards re-rendering inside every write's commit (PreviewNode now polls the state snapshot,
500ms deduped), `addInstanceToContainer` identity churn (now stateRef at call time), and
**use-context-selector phantom renders** — GridActionsContext rewritten to a per-provider store +
`useSyncExternalStoreWithSelector` (public API unchanged; 1159/1159 tests; headless field-edit +
drag/drop smoke verified). Docket stays open for the residual (~54 slot-container renders, op
drain). Live grid reseeded after probing.

~~Queued next (CLAUDE_CHAT 2026-07-06): "look into dropping in a doc, and doc container, especially
nested ones. the drop was reloading the entire page"~~ — **DONE 2026-07-06 LATE.** Traced with
`__dragDiag` probes: not a reload, not double-handling — the page editor owned every doc drop and
its nearest top-level boundary hoisted the item to the TOP of the page (source list lost it =
"the page reset"). Fixed: nested doc-container editors register delegate-only drop zones; the page
editor + touch routing hand them drops landing inside (`getDocTouchDropZone`). Verified headless on
desktop + touch; embeds persist in the NESTED container's textmap. See ui/ + helpers/ CLAUDE.md.
Follow-up polish: page-level gap indicator still draws during dragover over a nested container.

---

## Test checklist — 2026-05-20

Re-seed live data first: `node --env-file=.env server/scripts/createLiveData.js`.
Test results last refresh: **37 files / 731 tests passing** (see `test-results.txt`).

### Multi-day Schedule (carryover from earlier this session)
- [ ] Single-day view renders byte-identical to the pre-refactor single-day Schedule
- [ ] Pick a 3-day range in the date picker → 3 day-columns appear, shared slot containers multi-parented into each
- [ ] Pick week / month / year via picker → format flips between `timeslot` (≤7 days, columns side-by-side) and `shortened` (>7 days, wrapped grid)
- [ ] Drag a task into one day's column → task appears only in that day, slot persists
- [ ] Switch back to single-day → no data loss; instances still on their original dates
- [ ] Tracker totals aggregate across the active period (`$activePeriodDates` / `$activePeriodCount`)

### Editor↔field bindings (BoundHeader / BoundBody)
- [ ] Container header bound to a select field with options → dropdown renders inline; pick value → fires write + propagates via link field
- [ ] Textblock body bound to a text field → typing in editor debounce-commits + syncs siblings
- [ ] Link badge in top-right of bound editor shows the bound field name; tooltip reads `Linked: <field name>`
- [ ] Daily Question container in day-page template → click 🎲 dice → random question loads; answer textblock writes back to today's instance

### Multi-select + paste (shipped this session)
- [ ] Shift+click an instance → selection chip overlay highlights it
- [ ] Shift+click more instances → count grows; right-click any selected one shows bulk items at top
- [ ] Choose "Copy N selected" → right-click target container → "Paste N here" mints fresh occurrences with same moduleId → **toast "Pasted N items"** appears for 2s
- [ ] Choose "Move N selected" → right-click target → "Move N here" re-parents (no fresh occurrences; originals move) → **toast "Moved N items"** appears
- [ ] Choose "Copy-link N selected" → right-click target → "Paste linked N here" mints fresh occurrences sharing `linkedGroupId`; toggling a field in one ticks the others → **toast "Linked N items"** appears
- [ ] Paste-here also surfaces on a page right-click (destination is the page occurrence)
- [ ] Self-paste (target = source) is silently skipped
- [ ] **Delete N selected** prompts `confirm(...)` with the count; cancel aborts; confirm deletes

### Canvas connect tool (shipped this session)
- [ ] Open any canvas page → toolbar shows new chain-link icon between Hand and Pen
- [ ] Click connect → cursor switches to crosshair
- [ ] Press on card A, drag a dashed bezier, release on card B → solid bezier persists
- [ ] Reload → connection still there (persisted to `pageOccurrence.meta.edges`)
- [ ] Move either card → bezier follows
- [ ] In connect mode, click on an edge → deletes it
- [ ] **Delete a card connected by an edge** → on the next canvas paint, the orphaned edge is cleaned from `meta.edges` (lazy persist)
- [ ] Switching to any other tool → edges still render but become click-through (no accidental deletion)
- [ ] Drawing tools, drop targets, world pan, mobile toolbar, autoscroll still all work in their respective modes
- [ ] **Undo (Undo button)** undoes both edge additions AND edge deletions (mixed with strokes — most recent action regardless of type)
- [ ] **Redo** replays the undone action

### Multi-select deep-paste (added in review fixups)
- [ ] Shift-select a CONTAINER with children → Copy → paste into another container → new container appears with copies of all its children (not an empty shell)
- [ ] Pasted children preserve fields + iteration mode from source
- [ ] **Copy-link a container with children** → paste into another container → toggling a field in the new linked container's child propagates back to the source's matching child (per-pair linked groups)
- [ ] Move-mode on a container still re-parents the existing container (children come along because they're parented to it)
- [ ] **Shallow paste preserves iterationMode** — copy a persistent leaf instance; the new occurrence is still persistent (not silently demoted to specific)
- [ ] **Canvas edges anchor at card center** even for tall containers — edges land mid-card instead of 30px below the top

### Socket status pill (shipped this session)
- [ ] Throttle Network → Offline in DevTools → red pulsing pill appears right of logo: "Disconnected — retrying (N)" with N incrementing
- [ ] Hover the pill → tooltip explains writes are buffered locally
- [ ] Edit a field / drag a card while offline → no error toasts, no UI freeze
- [ ] Throttle back to Online → green "Reconnected" pill for ~3s → fades to nothing
- [ ] Buffered changes have synced server-side after the pill fades

---

## Handoff — Session 2026-05-20 → Next session

Multi-day Schedule shipped (hybrid architecture: shared slots persist under Schedule, day-col wrappers come/go via multi-parent — zero data loss). New picker (react-multi-date-picker) supports single/range/multi/week/month/year. `$activePeriodDates` + `$activePeriodCount` available in op pipelines. Container-in-container primitive via `module.meta.allowChildContainers`. Test grid byte-identical to before (uses original `makeScheduleBuildDayOp`); live data uses new `makeScheduleBuildScheduleOp`. **Re-seed live data required to test:** `node --env-file=.env scripts/createLiveData.js`.

### Testing feedback fixes (in progress this session)

User tested the multi-day Schedule and reported:
- ✅ Hourly chime disabled (was firing every second — `lastFiredAt` sync race; see `state/useScheduler.js` debug TODO).
- ✅ **Build Schedule perf (d)** — Phase 4 was `LOOP $allContainers` PER day. Refactored to Phase 4a (one-time slot ID collection via PUSH_TO_VAR) + Phase 4b (per-day ADD_CHILD from precomputed list). Cuts from O(days × containers) to O(containers + days × slots).
- ✅ **(a) Multi-day rendering polish** — `client/src/modules/pages/PageBoard.jsx` now detects `meta.scheduleDayColumn` children and (1) hides `meta.scheduleSlot` / `meta.scheduleDueContainer` from page-level render (they're multi-parented into day-cols), (2) switches to horizontal `flex-direction: row` with 280-360px min/max width per column when ≥2 day-cols exist. Single day-col still renders vertically (looks like the original single-day Schedule).
- 🟡 **(b) Goals restructure — Stage 1 done, Stage 2 pending.**
  - **Stage 1 (done):** `makeTrackerOp` in `server/utils/liveSystemBuilders.js` accepts a new `goalOccurrenceId` param. When provided, the goal-lookup step replaces FIND-by-label with `INIT_VAR $goalId = literal:<id>` + `FIND $allItems where id IS $goalId → $goalItem`. Back-compat: legacy `goalLabel`-only callers still work (test grid + currently-unique-label goals in createLiveData).
  - **Stage 2 (pending — user direction needed):** User said "i dont like label compare", "use the category picker to pick a specific occurrence", "i just dont want to write out the id in the operation", "we have grab direct ref" — the seed should use whatever the UI's CategoryPathPicker outputs for an occurrence pick, NOT a literal id baked into the op. CategoryPathPicker outputs are dotted paths like `$<var>.<path>` resolved via `resolveExpr`. For occurrences, no id-indexed map exists in the executor today — there's `$allItems` (array), `$allInstances`, etc. but no `$allItemsById`. Two paths forward:
    - (a) **Add `$allItemsById` to executor** — plain object `{ [id]: item }` exposed in $vars. Reference syntax `$allItemsById.<id>`. Picker emits that path. Tracker's $goalItem = `$allItemsById.<id>` via INIT_VAR with expr. Note: UUIDs contain `-` which probably trips dot-notation path resolver — may need `["<id>"]` bracket-notation support or use a hash-friendly id format.
    - (b) **Deterministic IDs** for seed-stable occurrences (goal items, schedule slots) — generate via hash of stable key like `goalOcc("physical-water")` instead of random `uid()`. Op embeds the deterministic id as literal; survives re-seed because same key → same id. More invasive but eliminates the resolver question.
  - Recommendation: (a) is the smaller change. Implement `$allItemsById` in `operationExecutor.js:1172` area, verify path resolver handles UUIDs (probably needs bracket notation: `$allItemsById["abc-123-def"]`). Then Stage 3: actually split the multi-field goalInstances entries + update tracker call sites in createLiveData.
  - **Why deferred this session:** This needs careful integration with the picker UI's existing output format. Picking the wrong reference shape means an executor change AND a picker change later. Best done in a focused session that touches `CategoryPathPicker.jsx`, `operationExecutor.js`, `liveSystemBuilders.js`, and `createLiveData.js` together.
- ⏳ **(c) Picker redesign** — user wants calendar-style with zoom drilldown (month grid → year grid). Current `react-multi-date-picker` UX doesn't match. See memory `project-pending-features` for options.

Other already-queued items below (folder-page defaults, Pomodoro, GET_USER_INPUT, multi-select, mindmap) remain valid.

### Next steps (in order)

1. **User re-seeds + verifies multi-day Schedule end-to-end** — open Schedule, try single-day (should look exactly like before), then pick a 3-day range / week. Day-cols should appear; instances persist across view changes; trackers aggregate over the period.
2. **D1(a) op rename** — strip "Tracker:" prefix from local createLiveData ops (now redundant with `opCategoryIds.trackers` folder). About 27 ops. Update `waterTrackerName` + `completedTrackerName` params passed to `makeScheduleBuildScheduleOp`. Test grid untouched.
3. **Folder-page defaults for Daily Toolkit + Center Hub panels** — see memory `project-pending-features`. Set the panels' default view to a folder-page (card grid of child pages) instead of a single tab. ~30 lines per panel in createLiveData.
4. **Pomodoro → Schedule** — see memory `project-pending-features`. Pomodoro template instance in Daily Toolkit, Pomodoro goal (3/day), trackers (current pomo + time + history), 3 ops (Start / Complete / Stop) firing from PomodoroTimer.jsx.
5. **Month view page** — see memory `project-pending-features`. Separate page kind with 30 day-containers, no slots. Own `Build Month` op constrained to month-unit filter. Bidirectional with Schedule (drag-into-month creates task w/ null timeslot, picks slot later via select).
6. **GET_USER_INPUT op action** — see memory `project-pending-features`. General-purpose action that opens a modal asking the user for input; chained THENs ask follow-up questions; each step's result lands in `$vars` for downstream steps.
7. **Multi-select system** — see memory `project-multiselect-plan`. Shift+click, shift+arrow tree-walking, rubber-band drag, ContextMenu with copy/move/edit/copylink, paste-here on empty space, radial menu mode icon. Multi-session implementation.
8. ~~**Canvas mindmap (React Flow)**~~ — **DONE 2026-05-20** as a tool added to the existing canvas (not a new page kind, no React Flow). New `connect` tool in `CanvasContent.jsx` lets the user drag from one card to another to draw a bezier edge. Edges persist on `containerOccurrence.meta.edges = [{ id, from, to }]`. SVG overlay sized to the world (4000×4000); clicking an edge in connect mode deletes it. Plays clean with every existing canvas feature (drawing tools, drop targets, world pan, autoscroll, mobile toolbar, filters). `@xyflow/react` removed from package.json. See memory `project-canvas-mindmap-plan` (now slightly out of date — edges live on the page occurrence the same way, but no separate kind exists).
9. ~~**Socket connection status indicator in grid header**~~ — **DONE 2026-05-20**. `hooks/useSocketStatus.js` subscribes to `connect` / `disconnect` / `connect_error` / `reconnect_attempt` and returns `{ status: "connected" | "disconnected" | "recovered", attempts }`. `ui/SocketStatusBanner.jsx` renders an inline pill in the toolbar (right of the logo) — red w/ pulsing dot + "Disconnected — retrying (N)" while down, green + "Reconnected" briefly when restored, nothing when normal. Tooltip on the red pill spells out that writes are buffered (offline queue already handles the buffering — this is just visibility). Pulse keyframe `socket-status-pulse` added to `index.css`. Tied through socket lifecycle events; queue replay continues to happen elsewhere (App.jsx-level on full_state).
9.5. **Offline-queue-aware "Reconnected" fade** — the green pill currently fades after a fixed 3s regardless of whether buffered writes have been server-acknowledged. `flushOfflineQueue` empties the local queue synchronously on reconnect, but the server-roundtrip ack is unknown. Tighten by: (a) capturing pre-flush queue length, (b) listening for the next N entity-updated events from the server, (c) holding the pill until those land or a 10s upper cap fires. Cosmetic — the existing 3s works for typical session lengths.

10. **Assistant LLM chatbox (last item)** — design + spec out an in-app assistant that can perform real actions through a conversational chatbox: create operations (full pipeline w/ trigger + steps), create occurrences/modules/containers/pages, attach fields, navigate filters, save templates, run ops on demand, explain why an op didn't fire, etc. **Read `docs/aispecs.md` first** — the user has a written-out spec there covering the offline LLM stack (Ollama + qwen2.5-coder / deepseek-coder), tool router pattern, sandboxed command executor, OCR layer, and a "frog Jeeves" persona. The plan should incorporate (or supersede) that doc, not duplicate it. The API layer should be a first-class part of the plan — likely a thin Express/route layer on the server that the local LLM (or a hosted Anthropic SDK fallback) calls through, with each tool mapping to a CommitHelpers function or operation-action effect (CREATE, UPDATE, APPLY_TEMPLATE, RUN_OPERATION, etc.). Probably a side-drawer or floating panel that wraps the tool-use loop. Will need: (a) a curated tool catalog with JSON schemas mirroring our pipeline action shapes, (b) state snapshotting so the LLM sees the current grid/modules/fields/operations, (c) confirmation UX before destructive actions, (d) prompt caching against the static system prompt + tool catalog. This is the BIG ticket — full plan to be drafted at the end of the queue.

---

## Older handoffs

Sessions earlier than the past week are archived in [`docs/handoffs/`](./docs/handoffs/):

- [`2026-05-11.md`](./docs/handoffs/2026-05-11.md) — drag-and-drop punch-list
- [`2026-05-11-late.md`](./docs/handoffs/2026-05-11-late.md) — textblock/canvas thread + carryover (all resolved 2026-05-12)

Consult the archive only if the active sections above don't cover something. New session work should treat the latest dated handoff as authoritative — older direction is superseded.

---

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


