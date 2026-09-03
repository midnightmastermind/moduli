# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---

### 2026-09-03 — THE OP HOLD WAS BROKEN TWICE, AND ONE FIX WAS THE DEPTH IT GATED ON

User: *"okay i did a few really choppy drags cause of the ops. everytime i
dragged a new op started running too"*. The hold shipped the day before and
their own capture said it was catching almost nothing.

```
[drag] 38342ms  hold=5268ms via=move-late  paint=586ms
  opSweeps=30 opMs=1663
  opBy=[MeasureOp:kg860us2nhc:13x570ms/0fx
        MeasureOp:1ve8fwc6c7k:11x506ms/0fx  NavigationOp:1x370ms/26fx]
  longTasks=156(34138ms)   <- 89% of a 38-second drag
  renders=2954(field:1222,container:1035,panel:372)
```

**DEFECT 1 — THE GATE WAS `_fireDepth === 0`, AND THESE FIRES ARE ALWAYS AT
DEPTH 1.** A MeasureOp written by an op's own effects is DEFERRED past the
paint, and its continuation restores `_fireDepth = savedDepth` — 1, not 0. So
24 of the 25 sweeps were invisible to the hold. **This file has recorded
`[op-fire] depth=1 MeasureOp occ=1ve8fwc6` since 2026-08-31 and I gated on the
one depth they never have.**

The hold intercepts at the DEFERRAL now and takes the **continuation** rather
than the transaction. That is what makes it safe rather than merely narrower:
the closure restores its own depth, action scope and cycle-guard marks, so
`_FIRE_DEPTH_LIMIT` still accumulates and the depth-1 cascade dedup behaves
exactly as it does synchronously — the three things the carry-across was
written to preserve.

**AND A CONTINUATION MAY NEVER BE DROPPED AS A DUPLICATE**, which is the one
real hazard in that change. A deferral retains an undo action and parks an
entry in `_pendingMeasure` BEFORE offering itself; only running it releases
either. The queue's key dedup would have left the action buffer open forever
AND left a pending entry that later writes merge into and nothing ever fires —
**a tracker that silently stops recomputing.** Deduping is already done
upstream (one entry per occurrence+context, later writes MERGE into the very
object that will run) and downstream (the drain's shared cascade set).

**DEFECT 2 — THE 6-SECOND CAP *ENDED* THE HOLD, AND DRAGS RUN 16-38 SECONDS.**
`onCap?.(release())`, and `release()` nulls the queue. So 10 to 32 seconds of
every drag ran completely unprotected. The fail-safe only ever had to stop work
being hidden FOREVER — the promise `stagedMount`'s HARD_RELEASE_MS makes — and
it does not have to abandon the gesture to keep it. It drains and **re-arms**
now, in the drain's own one-fire-per-macrotask chunks, and only ever hands back
work (re-arming unconditionally would wake the tab every 6s for the life of a
quiet hold).

**The narrower leak it still guards was checked rather than assumed:** `onEnd`
is bound to `touchcancel` as well as `touchend` and calls `endInteraction`
first, so an abandoned gesture is covered. What is not is a handle UNMOUNTING
mid-drag, which strips the listener before it can fire.

**MEASURED ON THE DEVICE, before and after, settled grid either side:**
```
                        before              after
op sweeps             30 / 1663ms         1 / 37ms   <- the drop's OWN move op
renders                    2954                 75
long tasks       156 (34138ms) 89%    56 (3556ms) 28%
onMove avg/max        6 / 220.4ms         2.7 / 12.8ms
attributed renders   field:470 s_modulesById      NONE
hold (lift timer)   5268ms via=move-late   151ms via=lift
start -> pill paint        748ms               176ms
```
**`hold=151ms` against a 150ms timer is zero starvation**, and `causes=` is
absent entirely — nothing re-rendered for an attributable reason during the
whole drag.

**ONE CAPTURE STILL SHOWED 9 SWEEPS AND IT IS THE CAP WORKING, not a leak.**
That drag was **6,179ms** against a 6,000ms cap, so its held work drained 179ms
before the drop. The two longer drags (11.4s, 12.9s) crossed the same cap and
show `opSweeps=1`, because by then there was nothing held to drain. The cap
surfaces work only when there is work.

**STILL OPEN, and it is the remaining named cost: the LOAD SWEEP bypasses the
hold entirely.** `bindSocketToStore.js:384` calls `runMatchingOperations`
DIRECTLY rather than through `fireOperations`, so `load:1x2544ms` can neither
be held nor interrupted — a 2.5-second synchronous task with a finger on the
screen, which is what `via=move-late` reports. `runSliced` covers the effect
loop and not the sweep. That is a change to the shared execute path and wants
its own reviewed pass.

**And what is left in a clean drag is OUR OWN PER-FRAME WORK, not ops and not
renders:** `raf avg=10ms x 174 frames` is ~1.7s of a 3.5s long-task total, of
which `hit avg=4.8ms x 221` is ~1.1s. `over32=0` on both settled captures.

---

**AND THE CLIENT SUITE HAD BEEN RED FOR REASONS NOBODY HAD READ.** 31 tests
across 42 files died on their first `beforeEach` with `localStorage.clear is
not a function`. **Node 25 ships its own Web Storage** and takes
`globalThis.localStorage` before jsdom does; without a valid
`--localstorage-file` it hands back an EMPTY PLAIN OBJECT. The warning prints
on every run.

Four probes, each killing a cheaper explanation: the global is an ACCESSOR
(Node's, not a copied jsdom value); `sessionStorage` is untouched, which is
exactly why only these suites broke; jsdom's is not on the prototype chain;
and **deleting Node's leaves `undefined`** rather than revealing one
underneath. There is nothing in that realm to recover.

**The whole risk in a shim is FIDELITY** — a Map with four methods passes every
consumer test in this repo and is still wrong in a browser. Pinned instead:
keys AND values stringify (`setItem("n", 1)` reads back `"1"`), a miss is
`null` and not undefined, `key(i)` walks insertion order, and entries are
exposed as PROPERTIES, because this codebase documents
`localStorage["moduli-haptics"] = "off"` as a user-facing mute that a
methods-only shim would make silently inert here while it works on the device.

**It is guarded, so it removes itself the day the environment is fixed** —
nothing is installed when the global already answers the Storage interface.
```
before   42 files / 31 tests failed   3500 passing
after   320 files /  0 failed         3821 passing
```

Every A/B fails exactly its own cases: deduping continuations fails 2 (the drop
case AND the control proving plain fires still dedupe), restoring `release()`
at both caps fails 4, and commenting out the storage install brings back 43
files / 32 — the original 31 plus that file's own positive control, which
exists so the shim silently not installing can never read as a pass.

Deployed, prod HEAD verified, both served chunks sha256-identical to the local
build with the continuation dispatch present in the SERVED bundle.

---

### 2026-09-02 (4) — THE DOM IS NOT THE LEVER: three A/Bs, and my own audit's ranking was wrong TWICE

User: *"can we look into the next parts"*. The next part was the DOM audit's
action list — insert gaps 15%, icons 34%, marquee wrappers 11%. **Measuring what
those nodes COST retired almost all of it, and the audit's own metric was the
mistake both times.**

**ROUND 1 — node count is not layout cost.** Invalidate the whole document,
force a synchronous style+layout, take the median of 25:
```
baseline    94.5ms      null_arm    95.2ms  +1%   <- control lands on baseline
no_gaps     86.7ms  -8%     no_icons    95.4ms  +1%
                            no_marquee  96.2ms  +2%
```
**`.lucide { display:none }` removes 34% of the document's nodes and moves
layout by 1% — inside the null arm's own noise.** SVG internals (4,418 paths,
1,896 svgs) never participate in CSS layout at all, so a third of the audit's
census was invisible to the cost it was being ranked for. *I would have spent a
session on it.*

**ROUND 2 — count BOXES, not nodes, and remove boxes rather than hiding
subtrees.** `display: contents` takes an element's own box out of layout while
leaving its children in place, which is the only arm that can price a WRAPPER:
```
baseline           18,728 boxes   99.6ms       null_arm  18,728  101.5ms  +2%
gaps_none          16,432          92.5ms  -7%
marquee_contents   17,325          97.4ms  -2%   <- retired
fields_none         9,785          60.0ms -40%
rows_none           5,906          37.3ms -63%   <- ceiling
```
That reads as "layout is linear in boxes, ~5-6us each" — **and round 3 proves
that reading wrong too.**

**ROUND 3 — the wrappers are FREE, and the change they justified is dead.**
Every field pill is 8 boxes, four of them wrappers before the control:
`span.auto-marquee > span.auto-marquee-inner > div > div > div.field-input`.
The two bare divs are `FieldRenderer`'s, and they exist only to stack a display
Field above an input Field — **a case that occurs 0 times in 791 pills on this
grid**, so both are always pure pass-throughs. Simulated with `display:
contents` rather than argued:
```
boxes   18,728 -> 17,147  (1,581 removed, 8% of every box on the page)
layout  98.4ms -> 100.4ms (+2%)          <- NOTHING
pills that MOVED: 0 of 660               <- safe, and worthless
```
**Removing 8% of the layout boxes cost nothing and bought nothing.** The
difference from `gaps_none` is what names the real driver: a gap is a FLEX ITEM
in one of 105 container lists and its removal changes the flow; a wrapper's
children are simply promoted, so the same leaves are laid out either way. **The
cost is the participating leaves and their TEXT, not the boxes around them.**

**SO THE DOM AUDIT'S ACTION LIST IS RETIRED EXCEPT THE GAPS**, and the levers
that remain are all "render less", not "restructure":
```
fewer field pills per row   -40% ceiling
fewer rows                  -63% ceiling
the insert gaps              -7%, and it is a real feature
wrapper divs / icons / marquee wrappers    0%
```
That points at virtualisation — `renderWindow` exists and engages only above 120
rows with a 600px lookahead, while a day column is 49 slots and the page holds
193 instance rows. **Not built here: it is a change to what the grid renders,
and this session has now twice had a plausible DOM fix die on its own A/B.**

**AND THE HEADLINE NUMBER IS THE ONE TO KEEP: ~95-100ms for ONE style+layout
pass**, on a desktop, at the tablet's viewport. Every invalidation during a drag
pays it. That is what `DROP paint=5001ms`, the 37-61%-blocked drags and a 220ms
lift timer arriving at 1213ms are made of — and it is not fixable by trimming
the tree.

**ROUND 4 — A THIRD OF EVERY LAYOUT IS FOR PANELS THE USER CANNOT SEE.** The
mobile grid renders every panel into a slider and TRANSLATES the inactive ones
off screen; they stay in the DOM and stay laid out. At 820x1180:
```
ON   _PkuNAJp  x=  6 y=  36  10,050 nodes      <- the one on screen
OFF  u07qnz_n  x=  6 y=1182   2,830 nodes
OFF  U18hAEwP  x=822 y=  36   7,066 nodes

baseline                          93.7ms
content-visibility: auto  -34%    61.3ms
display: none             -35%    61.3ms       <- the CEILING
```
**`content-visibility: auto` reaches the `display:none` ceiling exactly.** It
captures the whole available win with no DOM change, no React change and the
panels still mounted — state, scroll position and editors all intact — and it is
SELF-ADJUSTING, skipping only while a subtree is off screen and un-skipping as
it enters. It is also the mechanism this codebase already ships for
`.container-list--long`.

**AND THE `contain-intrinsic-size` TRAP IS AVOIDABLE HERE, which is why this is
not 2026-08-31 (4) again.** That entry records the seed being wrong in both
directions on ROW heights, because a row's height is not knowable in advance. A
mobile CELL's size is exactly the viewport cell — measured, not picked.

---

### 2026-09-02 (3) — THE FAN-OUT FIX, VERIFIED ON THE DEVICE: 120 effects, ZERO follow-up sweeps

The coalescing shipped with an honest gap — *"the extracted decision is covered;
the WIRING is not. No unit test mounts `bindSocketToStore`, so disabling the
coalescing leaves all 3,736 green. The live capture is what verifies it."* Two
drops later, it does.

```
BEFORE   OccurrenceCreateOp:1x435ms/14fx    MeasureOp:...:12x523ms/0fx
                                            MeasureOp:...:7x306ms/0fx
         opSweeps=21  opMs=2512             19 sweeps for 14 effects

AFTER    OccurrenceCreateOp:1x1492ms/120fx  ScheduleOp:1x52ms/0fx
         opSweeps=2   opMs=1544             ZERO follow-up sweeps for 120
```
**A create emitting 120 effects produced no MeasureOp fan-out at all**, where 14
effects previously produced nineteen sweeps. `opMs` is now almost entirely the
create's own 1,492ms — real work, not the same work repeated.

**AND THE MECHANISM IS NOT MERELY SWALLOWED, which is the check that matters
for a change that removes fires.** The other drop still shows
`MeasureOp:1ve8fwc6c7k:7x422ms/0fx` — seven sweeps at ~60ms, spread across a
21-second drag. Those are writes arriving SECONDS apart, after each pending
continuation has already run, so there is nothing to merge and they correctly
stay separate. **Coalescing collapsed the fan-out and left genuinely distinct
events alone**, which is exactly the line the context key draws.

**The discarded `options` argument is a non-risk, checked rather than assumed:**
`fireOperations(transactionType, transaction)` takes two parameters and has
always ignored the third.

**AND THE HOLD NOW LIFTS: `via=lift` on BOTH drops** (`hold=289ms`, `687ms`),
against `via=move-late` before. Per-frame work is good — `onMove avg=4.1ms`,
`hit avg=11.1ms`, **`over32=0`** on both.

**WHAT IS NOW THE LARGEST USER-VISIBLE NUMBER: `DROP paint=5001ms`** behind 131
renders, from that 120-effect create. Copying one row into a schedule slot
recomputes 120 values; the sweep is 1.5s and the paint that follows is five.
The op work is no longer duplicated — it is simply large, and the paint is a
20,095-node document. Both are named, both are their own pass, and neither is
guessed at here.

---

### 2026-09-02 (2) — THE DOM AUDIT: a THIRD of the document is icon internals, and 383 invisible insert gaps cost 15%

User: *"ok continue with the effect fan out and then lets create an audit of the
dom nodes"*. The fan-out is fixed above; this is the census, taken on prod at
the tablet's own 820x1180 viewport, 30s after load so it measures the grid
rather than the load.

```
DOM AUDIT — 19,874 elements, max depth 39      (21,190 occurrences in state)

REPEATED STRUCTURES (subtree totals OVERLAP by nesting — do not sum)
  count   total   median   max   what
    105   36142      178  6819   div.container-shell
    105   32557      146  6786   div.container-list
      3   19781     6899 10051   div.panel-shell
    193   12670       63   142   div.instance-wrap
    193    8833       46   121   div.instance-fields
    383    3064        8     8   div.insert-gap

BY TAG   div:6554  path:4418  span:4118  button:2001  svg:1896  input:492
         line:246  rect:129  circle:10
BY CLASS lucide:1894  auto-marquee:1087  auto-marquee-inner:1087
         instance-field-mq:783  field-input:652
```

**ICONS ARE THE LARGEST SINGLE COST AND NOBODY HAD COUNTED THEM.**
`path + svg + line + rect + circle = 6,699 nodes — 34% of the document`, from
**1,894 lucide icons at ~3.5 nodes each.** Every session this week has said
"a 20k-node document" as though it were rows of user data; a third of it is
glyphs.

**383 INSERT GAPS FOR 193 ROWS, 3,064 NODES (15%), INVISIBLE AT REST.**
`ModuleContainer` interleaves one between every pair of items plus one at each
end, and each is 8 nodes — a gap, a line, a button, a QuickAddMenu trigger and
its icon — sitting at `opacity: 0` until hovered. **They also account for 383
of the 2,001 buttons and 383 of the icons above.**

**AND A ROW IS 73% FIELD PILLS.** `instance-wrap` median **63** nodes, of which
`instance-fields` is **46**. 1,087 AutoMarquee instances add **2,174 wrapper
divs (11%)** — the same component 2026-08-26 (6) measured at 46% of Layerize,
reached from the node side.

**ONE CONTAINER IS A THIRD OF THE PAGE:** `Schedule - Wednesday` at **6,818
nodes**, inside a panel holding 10,050. That is 2026-08-26 (5)'s hand
measurement (`5,871 nodes, 29%`) reproduced by a repeatable instrument rather
than by hand.

**THE AUDIT COUNTS AND DOES NOT JUDGE**, deliberately: every threshold would be
a guess, since what a row *should* cost depends on what it renders. It reports
the count, the total and the **median cost of one** — which is the number that
separates *"too many rows"* from *"too heavy a row"*, two different fixes a
total cannot tell apart. And it says its subtree totals **overlap by nesting**,
because summing them against the total is the obvious mistake and would read as
a bug in the audit rather than a property of trees.

**NOT FIXED, and ranked by what the census actually says:** the insert gaps
(3,064 nodes for an affordance nobody can see until they hover — one shared
element positioned on hover would return 15%); the icons (34%, and the gap
glyphs are the cheapest slice of them); the marquee wrappers (11%, and that
component already has a measured history). **No change was made on the strength
of this — it is a measurement, and the fixes are each their own pass.**

3,745 client tests, lint 0 errors.

---

### 2026-09-02 — THE DROP LANDED WHERE YOUR FINGER HAD BEEN, and a SHORT drag dropped nothing at all

User, three reports in four minutes: *"i try to drop to the left side of an
empty container ... and it doesnt drop, i have to drop it in the middle of
it"*, *"i drop to the last spot of a container (an instance) and it puts it
after the container"*, and their own reading — *"the rect are off i think"*.

**ALL THREE ARE ONE LINE.** `onEnd` dropped on `curTarget`, which is whatever
the THROTTLED hover hit-test last resolved. That throttle is derived from its
own cost (2026-09-01 (2)), so on this tablet at `hit avg=21ms` it backs off to
**~85ms**, and the worst captures show 120ms+ hits. The drop was decided by
where the finger had been up to a tenth of a second before the user let go.

**AND A SHORT DRAG DROPPED NOTHING, which is the literal complaint.** Two facts
compose: the touchmove that ACTIVATES returns before hit-testing, and
`activateDrag` ARMS the throttle (`lastHitTestTime = performance.now()`). So
the first two moves of every drag resolve no target — a quick lift-move-release
reaches `onEnd` with `curTarget === null` and drops nowhere.

**THE EDGE COMPOUNDED IT RATHER THAN ABSORBING IT.** `_computeClosestEdge` ran
with FRESH coordinates against the STALE element, and **a point outside an
element's rect still yields a confident "closest" edge** — which is exactly
*"it puts it after the container"*: right point, wrong box, plausible answer.
The user's phrasing is precise about the symptom: the rect is fresh, the
element it belongs to is not.

**ONE HIT-TEST AT THE RELEASE POINT**, against ~900ms of drop paint. The
throttle now does only what a throttle should: the highlight may lag the
finger, it can no longer decide where the thing lands. The `else` branch had
already re-read the point with its own `elementFromPoint` for doc drops — **the
drop path had stopped trusting `curTarget` for half its cases and nobody
noticed the other half.**

**AND THE TESTS CAUGHT A REGRESSION I SHIPPED THE NIGHT BEFORE.** A drag begun
by the lift timer **could never drop**: `movedPastThreshold` was set only on the
pre-activation branch, so `onEnd`'s tap guard (`liftedByHold &&
!movedPastThreshold`) threw the whole gesture away. Hold to lift, drag
somewhere, let go, nothing lands. Both paths share one definition of *"the
finger moved"* now. *A guard reads correctly right up until you ask which path
sets the flag it depends on.*

**THE FIXTURE WAS WRONG THREE TIMES, EACH IN THE FLATTERING DIRECTION, and the
A/B is the only reason I know.** The hover-clear test was **vacuous** —
`useDroppable` keeps `isOver` in React state, so `data-drop-over` was never
written and the assertion was true either way (fixed with `overAsAttribute`).
Then the two staleness tests never exercised staleness: the activating move
returns before hit-testing, so the *"throttled"* move was really the first
hit-test. Then activation arms the throttle, so even the corrected sequence
needed a timer advance to let one hover through. **Every version passed.** Only
mutating the code and watching which tests failed said otherwise.

Three A/Bs, each failing exactly its own cases: the stale target fails 3, the
shared moved-flag fails 1, the hover-clear fails 1.

**THE PROBE GAINED THE TWO FIELDS THAT WOULD HAVE SHORTENED YESTERDAY.**
`via=lift|move` names WHICH path started the drag — `hold` alone is two numbers
wearing one name (the wait we IMPOSE against the wait until the user happened
to move), and reading the second as the first is what let a *"still like a
second"* complaint survive a fixed startup for a day. And `opBy=` prints the
sweep-by-trigger breakdown `diffOps` has collected since the scroll work and
the report **dropped on the floor** — so ~1s of operation sweeps landing
mid-drag (`opSweeps=24 opMs=1016` on one capture, `18x943`, `17x1199` on
others) stopped reading as unattributable noise.

3,710 client tests, lint 0 errors, deployed, prod HEAD verified, served chunk
sha256-identical, **pm2 uptime unmoved** (client-only, no cold read).

---

**AND `opBy` ANSWERED ITS FIRST QUESTION THE SAME MORNING.** User: *"what ops do
we have thats triggered by the drag itself, shouldnt they be triggered by the
drop"*. On a 22-second drag, **`opBy=[MeasureOp:20x974ms]` — ZERO sweeps were
triggered by the drag or the drop.** A drag emits `OccurrenceMoveOp` and a drop
an `OccurrenceListOp`; neither appears. All 20 were FIELD-VALUE WRITES, ~one a
second, on a grid nobody was typing into.

**TWO CANDIDATE CAUSES DIED IMMEDIATELY, one of them the user's own.**
- *"ahh thats the time ... maybe i should just put the time up by the alarm icon
  instead if its taking up that much power"* — `useLiveFieldValue` keeps its
  tick in local state and reads `Date.now()` AT RENDER. **It writes nothing**,
  so it mints no MeasureOp and triggers no sweep: one component re-render per
  second. Moving it would buy nothing, and the change was not made.
- A second connected tab echoing writes in (`onOccurrenceUpdated` is the
  MeasureOp path, and `occurrence_updated` EXCLUDES the sender). The server log
  is strictly sequential — connect → disconnect → connect, **never two at
  once**. Dead.

So this tab is writing field values once a second during a drag, and **which**
occurrence is now in the report: the label carries the occurrence id, the way
the `[op-fire] depth=1 MeasureOp occ=1ve8fwc6` console line already did for the
load path — and the tablet has no console. Capped at 200 keys, falling back to
the bare trigger, because *a diagnostic must not become the leak it was added
to find.*

**AND THE GRID NOW SAYS WHEN IT IS BUSY.** User: *"is there any way we can have
a notification where the reconnected message is, to say that ops are still
running. that way i dont try to drag during it"*. The grid PAINTS long before
it is idle, and every session chasing "it's jittery" has had to work out
afterwards, from `sinceLoad`, whether the capture was taken on a settled grid.
The person holding the tablet had no way to know at all. `helpers/opActivity.js`
is fed from the one sweep chokepoint; an amber pill sits beside the socket
status. **A BURST THRESHOLD, NOT "a sweep is running"** — a checkbox fires one
~30ms sweep, and a pill that flashes on every interaction is wallpaper by the
load that matters. The quiet window (1200ms) is deliberately longer than the
~1s gap measured between cascade sweeps, or it would blink through the very
thing it reports.

**AND THE NEXT TWO CAPTURES SETTLED THE OP QUESTION — the two new fields each
earned their keep on their first run.**
```
A  settled grid (sinceLoad=139s)   hold=318ms via=lift        opSweeps=0  opMs=0
B  22.6s after load                hold=754ms via=move-late   opSweeps=21 opMs=2512
   opBy=[OccurrenceCreateOp:1x1509ms MeasureOp:kg860us2nhc:12x612ms
         MeasureOp:1ve8fwc6c7k:8x391ms]
```
**A is the control and it is the answer: on a settled grid a whole drag and
drop fires ZERO op sweeps.** So no op is triggered by the drag, and the ~1s of
sweeps seen all morning was the grid still settling — which is exactly what the
pill now says out loud.

**AND `via` SEPARATED THE TWO HOLDS IT WAS BUILT FOR, in one pair of captures.**
`via=lift hold=318ms` is the timer doing its job (220ms plus a blocked thread);
`via=move-late hold=754ms` is the lift being STARVED and the queued touchmove
winning the race. Under the old single word both read as *"the hold took a
second"*, which is what kept the complaint alive after the startup was fixed.

**THE WRITERS ARE NAMED, and they are two tracker tiles in one container** —
`kg860us2nhc` = **Workout Log** (9 display fields) and `1ve8fwc6c7k` =
**Workouts** (27 display fields), both under `Today's Workout < Today's
Physical`. The second is the same occurrence 2026-08-31 (5) recorded firing
`[op-fire] depth=1 MeasureOp occ=1ve8fwc6` ten times on a load. A create fires
them, they write 36 display values between them, each write is a MeasureOp, and
each MeasureOp fires another sweep.

**WHAT IS LEFT IS NOT OURS AND NOT OPS, and the settled capture is what makes
that a measurement rather than a shrug:** 5,020ms of long tasks in an 11.5s
drag with **0 op sweeps and 158 renders**. Our own work is ~2.25s of it
(163 moves x 6.2ms + 130 frames x 9.5ms). `moves=163` over 11.5s is ~14/s
against a finger's 60-120, so touch delivery is starved too. The largest named
candidate is the browser painting a 21,235-node document — the same root as
`DROP paint=950ms` behind only 72 renders, and as the Sunday scroll-repaint
complaint. **Not proven, and deliberately not claimed.**

**AND `/Nfx` SETTLED IT ON ITS FIRST RUN — 19 OF 20 SWEEPS DO NOTHING.**
```
1 (28.8s)  MeasureOp:1ve8fwc6c7k:12x523ms/0fx  OccurrenceCreateOp:1x435ms/14fx
                                               MeasureOp:kg860us2nhc:7x306ms/0fx
2 (54.3s)  MeasureOp:mlj5fp3hu1:6x282ms/0fx    MeasureOp:b5c19ea4-...:1x73ms/0fx
                                               ScheduleOp:1x50ms/0fx
3 (79.9s)  opSweeps=0   via=lift
```
**EVERY MeasureOp sweep emitted ZERO effects.** So it is not a self-sustaining
loop — that hypothesis is dead, and it is the one I would have built a cycle
guard for. The only thing that emitted anything is the CREATE: `1x435ms/14fx`.

**THE CHAIN, END TO END:** a copy-drop creates an occurrence -> the create
sweep emits **14 effects** (the tracker tiles recomputing) -> each effect is a
field write -> each write mints a `MeasureOp` transaction -> each transaction
fires a **full sweep over ~68 operations** that finds nothing to do. **19
sweeps x ~44ms = 829ms of pure waste per drop**, with 782 renders behind it.

That is 2026-08-29 (4)'s docket item reached from a fourth direction — *"195
effects are 195 dispatches and 195 fan-outs; applying them as one batched write
would COLLAPSE the renders rather than redistribute them"* — and it now has a
name, a count and an effect tally against it. **The fix is not another cycle
guard** (there is no cycle); it is that applying N effects mints N transactions.

**AND THE THREAD STALLS WITH NO OPS AND ALMOST NO RENDERS, which is the part
none of this explains.** Capture 3, settled, `opSweeps=0`, 136 renders:
```
via=lift hold=1213ms      <- a 220ms TIMER, nearly a second late
firstTask=645ms@146ms     <- one 645ms task, 146ms into the drag
longTasks=44(5756ms)      <- 44% of a 13s drag
```
A lift timer arriving a second late is direct evidence of starvation rather
than an inference from it. Ours is ~2s of that (200 moves x 5.3ms + 120 frames
x 11.3ms). The largest named candidate remains the browser laying out and
painting a ~19,900-node document — the same root as `DROP paint=766ms` behind
72 renders. **Still not proven, still not claimed.**

**STILL OPEN, all measured and none guessed at:** the ~3s of long tasks in a
settled drag that neither our work nor ops account for; the
hit-test at ~13-21ms x 130-180 calls, ~2s of a long drag, where geometry-only
shortcuts are proven unsound (2026-09-01 (6)); and ~15s of a 22-second drag
inside long tasks that the op sweeps (974ms) and our own work (~1.6s) together
do not account for.

---

### 2026-09-01 (6) — THE HIT-TEST INDEX WAS WRONG 41% OF THE TIME, and shadow mode is the only reason nobody found out in production

With the startup second gone, `document.elementsFromPoint` was the largest
attributable during-drag cost — `hit avg=12.9-13.6ms` x ~130-180 calls, ~2s of
a 12-18s drag, and `raf avg=13.3ms` says the rAF callback IS the hit-test.
Every drop target is already in a registry, so scanning their rects instead of
asking the engine is the obvious fix. It does not work, and BOTH reasons are
worth more than the change would have been.

**THE CHEAP VERSION DIED ON MY OWN BENCHMARK FIRST.** `elementFromPoint`
(singular) measured **1,616x** cheaper than the plural on a 21,006-node
synthetic document, which is the kind of number that ends an investigation.
Re-run with JITTERED COORDINATES — what a drag actually does — it is **1.1x**:
the first run was a repeated hit-test at ONE point served from a cache. *A
microbenchmark that never moves is measuring the cache, not the call.* One
control survived and is worth keeping: `elementFromPoint ===
elementsFromPoint[0]` held on all 400 points.

**THEN THE REAL VERSION SHIPPED IN SHADOW — both run, the ENGINE's answer is
used, the disagreement is counted — and the first real drag retired it:**
```
idx=73/123  miss=0  BAD=50  idxAvg=11ms     (engine efp avg=10.3ms)   280 moves
idx=5/5     miss=0  BAD=0   idxAvg=3.8ms                               24 moves
```
**BAD=50 of 123.** The index named a DIFFERENT drop target on 41% of
hit-tests. Shipped as the answer, two of every five drops would have landed in
the wrong container — silently, on live data, in the code path this file
records being damaged before.

**AND THE CAUSE IS STRUCTURAL, NOT A BUG TO FIX.** `.insert-gap` is
`height: 8px; margin: -2px 0; z-index: 3` — it OVERLAPS the rows either side
of it ON PURPOSE (2026-07-24, so a fat band stops stealing clicks) and wins on
PAINT ORDER. Both the gap and the row are registered drop targets, so along
every row boundary two targets contain the point. The engine orders them by
paint; a rect index can only order by DOM DEPTH, and the gap is a SIBLING of
the row rather than a descendant — so depth picks the row, wrongly, at every
boundary. Ordering by paint means re-implementing stacking contexts.

That also explains the split above without appealing to noise: 280 moves
crossing many boundaries, against 24 moves that barely left one row.

**IT WAS NOT EVEN FASTER, WHICH IS THE SECOND INDEPENDENT KILL.** `idxAvg=11ms`
against the engine's 10.3ms. The premise was "read the rects ONCE per drag",
and that is false: any scroll invalidates them (autoscroll moves everything
under the finger), and each rebuild is a forced layout over ~534 targets. Even
a correct index would have bought nothing.

**REVERTED, NOT PARKED** — a mechanism measured wrong is removed, with the
reason left at the call site so the next reader does not rebuild it. The
finding is the deliverable: **drop targets on this grid overlap by design and
are ordered by z-index, so any geometry-only hit-test is unsound here.**

*Shadow mode cost one deploy and one drag. It is the whole reason this is a
paragraph instead of an incident.*

3,698 client tests, lint 0 errors.

---

### 2026-09-01 (5) — THE DRAG'S SECOND WAS `touch-action` ON `<html>`, AND EVERY DEPLOY COST THE USER THREE MINUTES

Picked up the other account's session, which hit its limit at 11:45 with the
user's *"its still choppy though. even worse at times now"* unanswered and a
half-written `handleDragStart` split uncommitted.

**FIRST, THE QUESTION IT OWED THEM: the hover fix landed.** Container renders
per drag **1,681 → ~100**. But the choppiness was real and elsewhere:
`work=1012ms [handleDragStart:1011]` with `onMove avg=2.3ms` — our own per-move
work was already fixed, and a flat second of startup was not.

**FOUR ROUNDS, EACH ONE KILLING THE PREVIOUS HYPOTHESIS.** Every step is a
measurement that made the next one cheaper, and three of the four killed a
theory I had written into a commit message.

```
1  split handleDragStart      hds:getCellFromPoint:1436   the other 3 segments 1ms each
2  read the rect FIRST        1036 · 1051                 unchanged -> NOT our write order
3  touchRect + holdScrolls    0.1ms · 0                   clean at touch, and the page never scrolled
4  bill each write            f:t0:0  f:touchAction:903  f:overscroll:3  f:bodyAttrs:46
```

**ROUND 2 IS THE ONE WORTH KEEPING.** Moving the rect read above our own DOM
writes changed nothing, which retired the reordering fix I was about to ship
AND the ancestor-attribute CSS theory behind it. A negative result that costs
one deploy and saves a wrong fix.

**AND `f:bodyAttrs:46` RETIRED MY OWN LEAD.** `body.dataset.dragKind` — named
in three consecutive commit messages as the likeliest document-wide
invalidation, because `index.css` matches it with
`body[data-drag-kind="panel"] .container-shell` — costs 46ms, not 1.1s. The
pill, the four edge barriers and both React setStates are 0-4ms. **Four
suspects cleared by their ZEROS**, which is why an attribution pass has to
print them: filtering a zero renders an exoneration and a mark that never ran
as the same thing.

**IT IS `touch-action`, NOT "AN INLINE STYLE ON `<html>`".** `overscroll-behavior`,
written on the same element in the very next statement, costs 3ms. Changing
`touch-action` makes Chrome rebuild the touch-action hit-test regions for the
whole document — 21,282 nodes. Same Chrome/Firefox split as that morning's
hit-test finding: **890-1446ms on Chrome across twelve captures, 10-26ms on
Firefox**, same grid and same gesture.

**AND IT WAS CHARGED TWICE PER DRAG.** Set in `dragSystem` and again in
`DragProvider` (a duplicate, free — Chrome skips an unchanged value), and
RESET on drag end in both. The reset is the same invalidation again, inside
the drop's paint — which is why removing it halved a drop cost nothing had
touched.

**WHAT IT GUARDED WAS ALREADY COVERED, EARLIER AND CHEAPER**, and
`dragTouchGuards`' own header lists the three jobs: the gesture that becomes a
drag is claimed by `.module-drag-handle`'s CSS before the touch begins; the
dragging finger cannot scroll because `dragSystem`'s `touchmove` is
non-passive and calls preventDefault (touch events retarget to the element the
touch STARTED on, so it keeps receiving them wherever the finger goes); and OS
edge gestures are the edge barriers, four fixed 40px divs with capture-phase
preventDefault, spawned synchronously for 3ms. The only window given up is a
second finger landing mid-screen inside the first frame.

**MEASURED END TO END, clean captures with the attribution off and the sweep
quiet (`opSweeps=1 opMs=39`):**
```
                       morning        now
startup work         890-1446ms       2ms
start -> visible       ~1970ms      ~220ms
onMove avg              19.1ms    3.4-4.6ms
hit avg                 30.3ms  12.9-13.6ms
container renders   2004-3383       75-103
DROP paint          1842-5302ms   809-923ms
long tasks        206 (29,835ms)  42-58 (5,203-5,824ms)
```

**THE FOUR TESTS THAT "COVERED" THIS NEVER IMPORTED DragProvider.** Each set
`documentElement.style.touchAction` itself and asserted it had been set — so
they passed before the feature existed and stayed green after I deleted it.
Replaced with a source scan that forbids the write in CODE while ignoring it
in the COMMENTS explaining the removal, because that explanation is the only
thing stopping the next reader reinstating a line that reads as a one-line
safety guard and costs a second. It also asserts what REPLACED it is still
present, so deleting the neighbouring `overscroll-behavior` cannot pass as a
success. A/B'd both directions.

**THE ATTRIBUTION IS OPT-IN NOW (`window.__dragAttr`)**, because forcing eight
flushes changes WHEN the paint happens — leaving it armed would corrupt the
one number still unexplained. Kept rather than deleted: same course as
`caretDiag` and `scrollDiag` once their fixes were verified.

**A CAPTURE THAT COULD NOT SETTLE ANYTHING, said so rather than read as a
result:** one drag came back `opSweeps=22 opMs=2343 renders=755` against
`opSweeps=0` on its neighbour — 2.3s of unrelated op work on the main thread,
so its `onMove avg=14.3ms` and `longTasks=78` describe the sweep, not the drag.

---

**AND THE USER'S THREE-MINUTE SPINNER WAS MY OWN DEPLOY LOOP.** User: *"why
does it always take like 3 min before anything loads after you put your stuff
in. its been doing this all day."*

A `pm2 restart` empties the warm per-user cache and the next load re-reads
~15MB of occurrences through a bandwidth-throttled Atlas connection at
~100 KB/s — the documented ~180s cold read. **All six of that day's deploys
were client-only**, and `express.static` reads from disk per request with
`index.html` served `no-cache`, so a fresh bundle is live the moment the build
finishes. ~18 minutes of somebody watching a spinner for a restart that
changed nothing.

**THIS FILE HAD RECORDED THE COLD READ FOUR TIMES — always as a caveat on
someone else's measurement (*"a load number taken right after a deploy
measures the cache, not the code"*), never as a cost being charged to the
person watching.**

The restart is conditional and FAIL-SAFE: it restarts unless every changed
path is provably client-side or documentation. Unrecognised path, empty diff
or stopped process all restart.

**AND THE FIRST VERSION FAILED OPEN, WHICH IS THE HALF WORTH KEEPING.** A
client-only deploy still restarted, and pm2's uptime counter is the only thing
that said so:
```
BEFORE pm2_uptime=1788297002289   AFTER 1788297706475
```
The predicate was correct and never ran. The remote script was one big
double-quoted `ssh` argument with every variable escaped `\$VAR` and every
quote `\"`; my edit inserted bare `"`, which TERMINATED the argument early, so
the remote received an UNQUOTED script — `[ -n $CHANGED ]` with a multi-line
value word-split into `test`'s arguments, `test` errored, the `&&`
short-circuited, and RESTART stayed 1. **A guard that fails open is
indistinguishable from a guard nobody wrote**, and recording the uptime either
side is the only reason it was caught rather than the script's own output —
the 2026-07-11 rule, paid again.

Rewritten as a `<<'REMOTE'` heredoc: no local expansion, no escaping, values
crossing the gap as positional arguments. That removes the class, not the
instance. **Its own trap closed in the same pass:** with `bash -s` the SCRIPT
is stdin, so a command that reads stdin eats the rest of it and the deploy
ends early looking like success — every npm and pm2 call is `< /dev/null`.

**PROVEN LIVE, which is the only thing that counts here:** a later client-only
deploy shipped a new bundle (`PagePreviewApp-CM2xZ4MR` → `BShphzCD`,
sha256-identical to the local build) with **pm2's uptime unmoved**.

**STILL OPEN, both measured and neither guessed at:** the hit-test is now the
during-drag cost — `hit avg=13.6ms` x ~130-180 calls is ~2s of a 12-18s drag,
all of it `document.elementsFromPoint` over 21,454 nodes, and the fix is to
stop asking the browser (cache the drop-target rects at drag start). And
~850ms of drop paint remains with only 75 renders behind it, which is the
browser painting a 21k-node document rather than anything React does.

3,698 client tests, lint 0 errors, deployed, prod HEAD verified, served
chunks sha256-identical with positive and zero controls in both.

---

### 2026-09-01 (4) — THE CELL-NAV RAIL WAS INSIDE THE SCROLLER, and my probe checked the wrong thing twice

User, twice: *"i scroll down on schedule, it takes me to the bottom panel, and
no side button exists to go left."* **The diagnosis was theirs, not mine** —
*"the rail button for the one next to schedule must be rendering in the wrong
spot or scrolled up or something."*

**`.mobile-grid-viewport` BECOMES `overflow-y: auto` for a panel taller than
one cell**, and the rails are `position: absolute` against it. Inside it they
are CONTENT. Measured on prod at 820x1180 portrait, scrolled to the bottom of
the 2-high Schedule:
```
before   left "Untitled"  top=-1114  22x1146      up-left  top=-1114  OFF SCREEN
after    left "Untitled"  top=   32  22x1146      up-left  top=   32  ON SCREEN
```
A 1,146px-tall rail sitting 1,114px above the viewport leaves a **32px sliver**
at the very top of the screen — which is why it read as absent. The rails, the
boundary hints and the zoom overlay now live in a `.mobile-grid-shell` that
does not scroll; the viewport keeps its class, its ref and its
`data-panel-native-scroll` stamp, so the scroll clamp and drag autoscroll are
untouched.

**AND MY PROBE MISSED IT TWICE, WHICH IS THE HALF WORTH KEEPING.** It asked
`querySelectorAll` whether the button existed — it did, a thousand pixels above
the fold — so I twice reported *"the rail renders and targets the right cell"*
to someone who could see that it did not. **PRESENCE IS NOT VISIBILITY.** The
probe reads `getBoundingClientRect` now, and the tell is `top`: a naive
"does its box overlap the viewport" test still called that 32px sliver ON
SCREEN, so even the corrected check needed the raw number beside it.

*Three times this week the user's own description of a symptom — "you scroll
too fast and you are waiting for an entire repaint", "it could have to do with
highlighting… on drop points", and this — has been a better lead than the
hypothesis I brought. All three were checkable; two were right.*

**AND THE LABEL WAS HONEST WHILE THE DATA WAS WRONG — now fixed too.**
That panel's `activeOccurrenceId` points at
`role:"container" kind:"artifact"`, an EMPTY artifact container with no
children — the `FolderNode` "+" defect class from 2026-08-28 (2), which mints a
shape nothing can open or render. The rail reads "Untitled" because that is
genuinely what the panel has open. Its own listed pages are Root, Trackers, Day
Page, Documents and "Untitled (.md)" — **no Tasks among them**, though two
pages named Tasks exist elsewhere on the grid. Which page it should open on was the
user's call and was asked rather than guessed: *"i meant its supposed to be
Trackers"* — which is one of the panel's own listed pages. Chosen from that list
BY NAME, refusing on ambiguity or on a target that is not `role:"page"`, rather
than baking the id into a script.

Verified together, at the bottom of the 2-high Schedule:
```
before   left "Untitled"  top=-1114   (off screen, and the wrong page)
after    left "Trackers"  top=   32   ON SCREEN
```
The stray artifact container is now referenced by nothing — 0 parents, 0 views
— and `sweepOrphans` still declines it, which is its guard working rather than
failing: it deletes only what is empty AND unreachable, and would rather leave
an invisible row than take one that something might still hold.

3,681 client tests, lint 0 errors, deployed, prod HEAD verified.

---

### 2026-09-01 (3) — THE OPTION POOL: a dropdown re-resolved because something, somewhere, made a row

The audit's last named item, and the one that was a design change rather than a
subscription gate.

**`FieldRenderer` used the grid-wide occurrence COUNT as the dep for option
resolution** — 756 field renders on an idle load, and `dropRenders=707
(field:615)` on ONE drop, because a drop creates an occurrence and the count
moves. **It moved for the wrong reason.** Of the 49 find-mode fields:
```
30   fields.<Board Category> CONTAINS <tag>  AND  meta.feedSourceId IS_EMPTY
 8   an OR-group of the same                 AND  meta.feedSourceId IS_EMPTY
 5   fields.<Library> IS <value>
 3   _ancestors HAS_ANCESTOR <id>
```
**38 of 49 select by a tag that lives on BOARD ITEMS**, and a schedule
placement — what a drag actually creates — carries none.

**NOTHING LEARNS WHAT A BOARD IS.** The scoping fields are derived from the
grid's own find predicates, so a dropdown scoped by some other field is picked
up automatically and `noDomainKnowledge` stays satisfied. Computed in `App`
beside `instancesById`: inside a selector it would walk 21,000 occurrences on
every store notification, per field.

**VERIFIED ON LIVE DATA, NOT ARGUED:**
```
total occurrences    21,149
in the pool key      12,795   (60% — the board catalogue, stable)
schedule placements      50
  counted by the key      0   <- a drop cannot move it
```

**AND THE IDLE A/B BARELY MOVED — 865 → 848 — WHICH LOOKS EXACTLY LIKE A
FAILURE.** It is not: during a LOAD the catalogue is arriving (15,708 artifacts,
every one carrying `Board Category`), so the pools genuinely change and
re-resolving is right. The change targets the DROP, and the idle probe cannot
exercise a drop. *A probe that cannot reach the case is not evidence about it* —
which is the same shape as the two guards on 08-31 that moved nothing, read
from the opposite side.

**SAME INVALIDATION SEMANTICS AS THE COUNT IT REPLACES**, which is what makes it
safe rather than merely narrower: a count cannot see an EDIT either — moving an
item from `meal` to `grocery` leaves `occurrences.length` unchanged exactly as
it leaves this unchanged. Strictly narrower on creates and deletes, identical
elsewhere.

**THE AUDIT, END TO END:**
```
              start     now
field         3,065      848    -72%
instance        604      258    -57%
container       652      542    -17%
```
Five changes, every one a subscription wider than what read it, and **not one
findable by reading code** — there is nothing wrong with any individual line.
`instancesById` in `ModuleInstance` was selected and read by *nothing*.

8 tests, both A/Bs failing exactly their own case. 3,681 client tests, lint 0
errors, deployed, prod HEAD verified.

---

### 2026-09-01 (2) — THE DRAG, FIXED IN TWO PLACES; and the render audit, executed

User: *"fix the 3 you said first, then the plan."*

**1 — THE HIT-TEST INTERVAL IS DERIVED NOW.** The split shipped that morning
answered the user's own hypothesis: `walk avg=0ms` in EVERY capture, so the
~510 registered drop points cost nothing. The whole hit-test is
`document.elementsFromPoint` over a ~20,000-node document — **0.6ms on Firefox,
17.8-30.3ms on Chrome, same grid, same gesture.** At the shipped fixed 32ms
that is 55-95% of the frame budget, which is the reported *"jittery… like its
freezing up"* and why portrait is worse than landscape. A bigger CONSTANT would
be wrong on the other browser, so the interval is derived: spend at most a
quarter of the time hit-testing, floored at the old value so nothing fast gets
slower.

**2 — A HOVER RE-RENDERED THE WHOLE CONTAINER, FOR FOUR 2px BARS.**
`isOver`/`closestEdge` are React state, so one crossing re-rendered a
1,900-line component plus every row and field inside it: **2,004-3,383
container renders in ONE drag.** They now drive a DOM attribute and CSS shows
the bar. Opt-in, because `blocks/` reads `closestEdge` for its own indicator,
and the CSS is scoped by an explicit class for the same reason.

**AND MY FIRST TEST FOR THAT WAS VACUOUS** — it asserted `isOver === false`,
which was true before the change, while the writes went through an internal ref
it never touched. Extracted to `dropEdgeAttr.js` and A/B'd.

**MEASURED ON THE DEVICE, before and after:**
```
before   onMove avg=19.1/max=115ms  hit avg=30.3ms  over16=17  longTasks=206 (29,835ms)
after    onMove avg= 0.5/max= 13ms  hit avg= 0.7ms  over16= 0  longTasks=  0 (0ms)
```
**Zero long tasks, in all four captures.**

**3 — THE DROP IS NOT FIXED, IT IS ATTRIBUTED.** `handler=102-177ms` then
`paint=1,842-5,302ms`. The probe now splits the drop window:
`dropRenders=707(field:615)`. Those 615 are the option-resolving fields
re-running on the occurrence count — the same `occSetKey` thread, and narrowing
it further is a design change (a pool-scoped key) rather than another
subscription gate.

---

**THE RENDER AUDIT, EXECUTED** (user: *"i feel like we have alot of things on
the site thats rerendering when its doesnt need to"* — they were right, and it
is measurable):
```
              before   after
field          1,759   1,247   -29%
instance         452     257   -43%
container        652     540   -17%
```
Over two days, from the first measurement: **field 3,065 → 1,247 (-59%),
instance 604 → 257 (-57%)**. Three changes, each a subscription wider than what
read it — `modulesById` in FieldRenderer (read by a memo that mostly does not
run, and by a callback), `instancesById` in ModuleInstance (**read by
NOTHING**), `modulesById` in ModuleInstance (one render call whose other
argument was already a non-reactive read).

**A COMPOUND ATTRIBUTION KEY LISTS EVERY INPUT THAT CHANGED, NOT THE CAUSE —
and that cost a commit.** `s_instancesById+s_modulesById` at 194 looked like
one problem; deleting `instancesById`, a subscription with genuinely no reader,
moved the count from **456 to 453**, because the other term still fired on the
same commits. Only fixing both moved it. *Read a compound key as a conjunction
and expect nothing until every term is gone* — the second time this week a
correct fix changed no number, and both times only the A/B said so.

Plan and full method: `docs/superpowers/plans/2026-09-01-render-audit.md`.

3,670 client tests, lint 0 errors, deployed, prod HEAD verified.

---

### 2026-09-01 — THE DRAG AUDIT; and I CLOBBERED A CHILD LIST WITH MY OWN REPAIR

User: *"dragging an instance is taking forever to start up and then is just
jittery around the grid … the drop takes a bit too. get a full audit."* Then a
correction worth keeping: I said the middle phase was *"already covered"*, and
they replied *"i called out the entire performace of the drag so during too its
terrible."* **`dragPerf` did measure the during phase — and logged only to a
console on the one device that has the problem, so nobody had ever read it.
INSTRUMENTED IS NOT MEASURED.**

**THE PROBE NOW COVERS ALL THREE PHASES** — the hold delay we IMPOSE separated
from our own startup work, the during numbers plus renders/op-sweeps/long
tasks, and touchend → handler → the frame after — as one line, to the console
AND the server.

**TWO SUSPECTS THE USER NAMED, BOTH CHECKED.** The drag PREVIEW is exonerated:
desktop's JS-followed pill (which really was *"a per-frame setState re-rendering
the whole provider"*) was removed in July, touch uses a DOM clone moved by
`transform`, and `setClosestEdge` returns a STRING so React bails on an
unchanged value. **Drop-point HIGHLIGHTING is a fair reading and not yet
proven**: `DragStateContext` has two consumers, and `setIsOver` is local to the
hovered target — but `_findDropTarget` runs every 32ms and does two unrelated
things under one timer (`elementsFromPoint` over a 20,416-node document, and a
Map.get per ancestor). Split, with the registry size and stack depth, because
those have opposite fixes.

**AND THE FIRST CAPTURE EXPOSED A BUG IN MY OWN PROBE.** Two reports came back
with byte-identical START figures and durations two orders of magnitude apart —
which two real drags cannot do. The report waits a frame for the drop's paint
and then read every number from the LIVE state inside that callback, so a
second gesture rewrote them underneath. Snapshotted synchronously now. *A
number that survives that bug is only `dur`; everything else from that capture
was discarded rather than reasoned from.*

---

**THE REPAIR, AND THE PART I GOT WRONG.** User: *"could you revert my changes to
the grid today (my drags cause they were all tests), and then make sure that
routines are all set to copy cause i accidentally moved a bunch away."*

**PARENT-ID DIFF REPORTED ZERO CHANGES, and that nearly closed the
investigation.** Scope was measured against the 04:17Z nightly backup rather
than `updatedAt` (the op sweep rewrites tracker values on every load, so
updatedAt says almost nothing). **Placement on this grid is the PARENT'S
`occurrences[]`, not the child's `parentId`** — it multi-parents by design — so
a drag re-lists without re-parenting and a parentId diff sees nothing. The
child-list diff found it: `Nutrition` had LOST `Drink` and `Visited`, both
re-listed under schedule slots, both still claiming Nutrition as their parent
and therefore rendering nowhere.

**THEN MY OWN REPAIR CLOBBERED THE LIST IT WAS FIXING.** Three restores shared
one parent, and I built each `next` array from a single pre-loop snapshot and
wrote three times — so each write overwrote the previous and the last one won.
Nutrition came out with **2 children instead of 4**. Rebuilt from the backup's
list in ONE write, ordered by the backup and unioned with anything live-only,
because dropping a child that is merely absent from a snapshot is how a repair
becomes the damage. *This is the read-modify-write race this file records the
server hitting on `occurrences[]`, committed by hand, in a loop, by me.*

**AND A THIRD ROUTINE WAS ALREADY STRANDED BEFORE TODAY** — `Eat`, listed by
NOBODY, so it rendered nowhere. Restored and reported separately rather than
folded into "today's changes", because it is not one.

**THE COPY FIX IS WRITTEN ON THE OCCURRENCE, NOT THE MODULE, and the measurement
is the reason.** 91 of 102 catalog routines already resolved to copy; the 11
that did not are exactly the ones that went missing (Drink, Visited, Eat,
Exercise, Stretch, Run, Go to Bed, Wake Up, Hot Tub, Pay Bill, Cancel
Subscription). **Every one of those modules has other placements — `Exercise`
has 22** — so `module.defaultDragMode = "copy"` would have made every schedule
row of them un-draggable to another time slot, which is a thing the user does
daily. `occurrence.dragMode` is per-placement: the catalog copies, the placed
row still moves.

Read back: 3 routines restored, **0 parented-but-unlisted under Routines** (was
3), **0 of 102 catalog routines still not copy**, pm2 restarted so the warm
cache stops serving the old values. poms grid: 1 pre-existing error, 1
pre-existing warning.

**STILL OPEN:** the user reports it *"working alot better now, still a little
stuttering and the drop still takes a second"*. The last trustworthy drop
figure is `handler=301ms paint=1250ms`, and no capture yet distinguishes a
drag's own cost from the post-load cascade — which is why the line now carries
`sinceLoad`.

---

### 2026-08-31 (6) — THE RENDER STORM, ATTRIBUTED AT LAST: two subscriptions nobody was reading

(5) ended with the real number — 208 effects producing ~3,800 field renders —
and the assumption that BATCHING the writes was the fix. **Measuring first
killed that too**: the effects apply in 13-16 slices, and React batches within
a task, so the dispatches were already collapsing. The cost was never the
number of commits; it is **how much re-renders inside each one**.

**THE TOOL FOR THAT ALREADY EXISTED AND WAS UNREACHABLE.**
`useRenderAttribution` has answered *"which subscribed value changed identity"*
since the frame-1 work, wired into field / container / instance — and
`snapshotAttrs` was reachable only from inside DragProvider's drop stopwatch.
So the storm could be COUNTED and never EXPLAINED. Three lines put it on
`window` beside `__renderTally`, and it named both causes in one run.

**CAUSE 1 — EVERY FIELD PILL SUBSCRIBED TO THE GRID-WIDE OCCURRENCE COUNT.**
```
field renders 3,065
   2,217  s_occSetKey
     739  s_modulesById+s_occSetKey          = 96% of every field render
top payers: Completed 572 · Duration 256 · Tracker Date 133
```
`occSetKey` is the occurrence COUNT, and it is the reactive dep for
`resolveOptions`. So anything creating an occurrence anywhere re-rendered every
pill on screen — the four deferred catalogue chunks, feedSync's mints, every
CREATE the sweep emits. **The three biggest payers are a boolean, a duration
and a date: none of them resolves options.** The `wantsResolve` test already
existed one scope down, inside the useMemo that consumes the value.

**CAUSE 2 — EVERY INSTANCE ROW SUBSCRIBED TO THE WHOLE OPERATIONS MAP**, for a
widget almost none of them has. `operationsById` is read only to build
`operationWidgets` (empty without `operationBindings`) and by
`handleRunOperation`, which is reachable ONLY from one of those widgets. Any
write to any operation re-rendered every row — and `lastFiredAt` is stamped on
every fire, so the load sweep rewrites that map once per op that runs.

**THE FIX IS THE SAME SHAPE BOTH TIMES, and it is not "call the hook
conditionally".** Hooks must be called; what becomes conditional is the value
SELECTED, which is the part that decides whether the component re-renders. A
field that resolves nothing, and a row with no operation widget, now select a
constant and stop hearing about the rest of the grid. `EMPTY_OPERATIONS` is
module-level — a fresh `{}` in the selector would re-render on every store read
instead of every op write, which is worse than what it replaced.

**MEASURED ON PROD, IDLE, SAME PROBE EITHER SIDE:**
```
field     3,065 -> 1,663   (-46%)     s_occSetKey 2,956 -> 1,100  (-63%)
instance    604 ->   421   (-30%)     s_operationsById 183 -> GONE
Completed   572 ->   143 · Duration 256 -> 64 · Tags 404 -> 404 (a select, correctly unchanged)
```
*Tags staying put is the control: a field that genuinely resolves options still
refreshes on every count change, so no option list can go stale.*

**WHAT IS LEFT, NAMED RATHER THAN GUESSED:** `s_modulesById` (464 field, and in
every container/instance bucket) — the modules map changes identity during a
load, and `UPDATE_ITEM_FIELD`'s auto-attach of a missing `fieldBindings` entry
calls `updateModule`, which would do exactly that. `s_occSetKey` 1,100 on the
fields that DO resolve is real work that could be narrowed to *"which
occurrences could this predicate match"* — a bigger claim than this pass made.

**AND TWO PROBE FAULTS, BOTH DOCUMENTED IN THIS FILE ALREADY.**
`page.waitForFunction(fn, { timeout })` passes options as the ARGUMENT — the
signature is `(fn, arg, options)` — so a stated 300s wait was the 30s default
(2026-08-25 (6), paid again). And a post-deploy run died on
`ENOENT: client/dist/index.html` — the 2026-08-07 (3) outage shape, here just
the build window, with the site 200 either side. **A wait keyed on "prewarm
done appears in the last 30 lines" also exits immediately after a deploy,
because the PREVIOUS deploy's line is still there** — it has to be anchored to
the latest restart.

3,652 client tests, lint 0 errors, deployed, prod HEAD verified.

---

### 2026-08-31 (5) — TWO GUARDS SHIPPED, NEITHER MOVED THE NUMBER, and the sweeps they targeted emit nothing

User: *"yes"* — go after the op sweeps firing during a scroll. What follows is
two wrong hypotheses, each measured rather than argued, and the reframe the
measurement forced.

**FIRST, THE CASCADE WAS REPRODUCED WITHOUT THE USER AND WITHOUT SCROLLING.**
A headless probe against prod, sitting perfectly still:
```
op sweeps : 29 (1127ms)   by { load:1x739ms, MeasureOp:27x375ms, ScheduleOp:1 }
renders   : field:3826 container:655 instance:608 panel:180
[op-fire] depth=1 MeasureOp occ=1ve8fwc6   <- the Workouts tracker tile, x10
[full_state-client] applied 208 effects in 2738ms across 16 slice(s)
```
*A scroll was never required to see it, which is what made the rest cheap.*

**HYPOTHESIS 1 — the load path lacked the cycle guard.** True, and it is fixed:
`fireOperations` marks every op that produced effects in a batch so their own
writes cannot re-trigger them, and the LOAD path — the biggest batch the app
ever applies — never had it, twenty lines away in the same file. **It changed
nothing:** 27 MeasureOp sweeps became 22, field renders 3,826 became 3,787.

**HYPOTHESIS 2 — the guard did not survive the deferral.** Also true, and also
fixed. A MeasureOp fire is deferred past the paint, and that deferral already
carries `_fireDepth` and the ambient action across the gap — each added after a
defect caused by NOT carrying it. The guard is the third thing that has to
travel and nobody had added it, so the marks were released a task before the
fire they were meant to stop. That made the guard ineffective for MeasureOps
everywhere, not only on the path I had just wired. **It changed nothing
either:** 22 sweeps, renders 3,794.

**AND THE THIRD MEASUREMENT RETIRED BOTH.** `[op-fire-done]` logs only when a
fire emitted something. Across the whole cascade there are **ZERO** of them —
so every one of those 23 MeasureOp sweeps produces **no effects at all**. They
are not a cycle, there is nothing for a guard to break, and at 322ms of a
~3,900ms cascade they were never the cost. *Two correct fixes for a problem
that was not happening.*

**WHERE THE TIME ACTUALLY IS, from the same capture:**
```
load sweep            818ms
23 MeasureOp sweeps   322ms      <- what I spent the session on
208 effects applied  ~2,200-2,700ms across 13-16 slices
renders               3,794 field · 649 container · 604 instance
```
**~18 component renders per effect, 208 effects, one dispatch each.** That is
2026-08-29 (4)'s docket item reached from a third direction — *"195 effects are
195 dispatches and 195 fan-outs; applying them as one batched write would
COLLAPSE the renders rather than redistribute them"* — and it is now the
largest item with a number against it.

**THE TWO GUARDS ARE KEPT, and the reason is not that they helped.** The cycle
they prevent is documented as having caused exponential fan-out, and the nested
path has carried a guard against it since it was written; the deferral simply
made that guard inert. Keeping a correct guard that is currently unexercised is
a different call from keeping one nothing has ever needed — but it must be said
plainly that **neither moved the measured number**, or the next reader will
believe the cascade was addressed.

**AND THE PROBE'S OWN TIMEOUTS WERE SILENTLY THE DEFAULT.**
`page.waitForFunction(fn, { timeout })` passes the options as the ARGUMENT —
the signature is `(fn, arg, options)` — so a stated 300s wait was the 30s
default and the run died mid-measurement. **This file already records that
exact trap from 2026-08-25 (6)** and it cost a run anyway.

**A/B'd AGAINST A COLD SERVER, TWICE, AND BOTH READINGS WERE VOID.** A deploy
restarts pm2 and the next load pays a **215-second** Atlas read, so the probe's
fixed window measured a page that had never received `full_state` — reporting
`renders=none` and zero sweeps, *which reads exactly like a fix that worked.*
The probe waits for the grid to render and then for the cascade to go quiet
now, instead of guessing at a window.

3,652 client tests, lint 0 errors, deployed, prod HEAD verified.

---

### 2026-08-31 (4) — RETRACTION: the repaint wait is NOT the off-screen skip, and the tally was counting SWEEPS

(3) concluded the *"waiting for an entire repaint"* was `content-visibility`
un-skipping, and retargeted the whole A/B at it. **The user's next capture
retires that**, and it is worth recording because the reasoning looked sound:
```
#1 baseline  skipped at start 0 · un-skipped while scrolling 0 · scrolled 0px
#2 no-skip   skipped at start 0 · un-skipped while scrolling 0
             ops ms:2563, runs:2 · long tasks 5 (3187ms of 14056ms)
             193 renders (container 104 · instance 45 · field 20)
```
**Nothing was being skipped on either arm.** Those containers each hold fewer
than `LONG_LIST_MIN` rows, so `.container-list--long` is never applied and the
skip does not engage on that surface at all — the arm added an hour earlier is
neutralising a rule that is not running. *The earlier bursts DID show
`unskipped=17/30/34`, which is what made the hypothesis plausible; they were
taken on a different surface and a different device.*

**WHAT IS LEFT IS 2,563ms OF OPERATIONS INSIDE A 14-SECOND GESTURE** — and the
number was being read wrong in two ways at once.

**`bumpOpRun` FIRES ONCE PER `runMatchingOperations` — A WHOLE SWEEP OVER EVERY
OPERATION, NOT ONE OP.** So `runs: 2` is two full sweeps at ~1.28s each, which
reads as trivial while the overlay calls them *"op fires"*. Renamed to sweeps.

**AND THE OVERLAY WAS ITERATING `{ runs, ms }` AS THOUGH THOSE WERE OP NAMES**,
rendering `ops runs:2, ms:2563` — the two fields of the total, presented as the
top two culprits. That is the line the user read back.

**NOTHING SAID WHAT TRIGGERED THE SWEEPS, and the candidates take different
fixes**: the documented post-paint load tail, a write echo, a navigation, or a
scheduler tick landing mid-gesture. Sweeps are tallied BY TRIGGER now
(`opBy=[load:2x2563ms]`), which is the one fact that separates them.

**The surface is dense with triggers, which is the shape of the problem:** of
68 enabled ops, **51 match `onLoad`, 48 `onFilterChange`, 47 `onChange`** — so
any field write anywhere fires a sweep evaluating ~47 pipelines. Three ops are
timer-driven (two alarms, plus `Schedule: Mark Passed Slots` every 5 minutes).

**THE BASELINE ARM SCROLLED 0px AGAIN**, so the A/B is void for a third
distinct reason — first four incomparable arms, then a 65x rate spread, now a
baseline that never moved. The comparability flag catches it every time; what
it cannot do is make the capture happen.

**THE SEED FIX SHIPPED SEPARATELY AND IS EXPLICITLY NOT THIS BUG.**
`contain-intrinsic-size` is measured from the list's own rows now (median of up
to 8) rather than picked, because the constant has been wrong in both
directions — 60px over-estimated on a Samsung A15, 44px under-estimates 2-2.5x
on this phone (`seed=44 real=81 / 109 / 110`). It matters where the skip
engages, which is the 993-row media boards, not the surface being reported.

3,642 client tests, lint 0 errors, deployed, prod HEAD verified.

---

### 2026-08-31 (3) — THE DAY PAGE HAD ITS OWN DUPLICATES, and the op had been throwing into a catch since they appeared

Continuing (2) at the user's *"keep going"*, plus a new report: *"the scroll is
worse."*

**THE FIX IS HOLDING IN PRODUCTION, and the log is the proof:** five
consecutive loads at **21,268 occurrences — zero growth**, where this morning
it was +49 every load.

**`Day Page: Build` WAS THROWING ON EVERY SWEEP, and it is a SECOND
duplication.** The Day Page board carries its own columns, and they had
duplicated independently of the Schedule's:
```
2026-08-26  x17          2026-08-30  x2          2026-08-31  x2
every other day in August: exactly 1
```
Two columns make its FIND (`parentId IS <board> AND date SAME_DAY $day`) match
BOTH, bind an **ARRAY**, and the `UPDATE` below it throw `$col is not a record
(no .id)` — the multi-match class this file records from three previous
directions. The throw lands in the sweep's per-op catch, so it has been silent;
everything after it (the daily question, the Todo embed, the page-body rebuild)
never ran. **A/B'd in the harness: with the duplicates it throws, with one
column per date NO ERRORS.** So *this* is the user's *"daypage col is rendering
twice"* — two literal columns — while the Schedule's three were the
*"duplicating occurrences"*.

**THE GUARD FOR THIS ALREADY EXISTS AND COULD NOT SEE IT.** `pomsGridOps`
asserts the load sweep runs with no op erroring — against the COMMITTED
FIXTURE. The defect lived in live DATA, not in a pipeline, so a snapshot taken
before it appeared passes forever. *A behavioural guard bound to a snapshot
only covers the half of the system the snapshot captures.*

**145 occurrences removed, and the guard measured TEXT THROUGH
`decompressTextmap`** at full subtree depth — these columns hold Journal /
Notes / Highlights, and a raw scan reports "no text" for every row on this grid
because textmaps are stored compressed (the `0032` rule). All 21 duplicate
columns read **0 characters, 0 unreadable**, so nothing of the user's was at
risk. Unlinked before deletion, dumped first, 19 orphan modules swept, pm2
restarted. Read back: **30 columns on the board, no date with more than one.**

**THE ROOT CAUSE OF THE DAY PAGE DUPLICATES IS NOT ESTABLISHED** and is not
guessed at. Today's pair was minted 13:04:28 / 13:04:59 — inside the same
three-load burst that produced the Schedule's three — so (2)'s fix plausibly
removes the pressure, but most days already had exactly one and nothing here
proves the mechanism. Watch the board.

---

**THE SCROLL REPORT, and the instrument fix from (1) earned its keep on the
first capture:**
```
baseline    rate=454px/s  cmp=baseline        638ms  16 long tasks  renders=4697  ops=2301
no-marquee  rate=  7px/s  cmp=not comparable   50ms  44 long tasks  renders=1563  ops= 614
no-backdrop rate=182px/s  cmp=not comparable   17ms   2 long tasks  renders=1147  ops=   0
no-shadow   rate=225px/s  cmp=not comparable  263ms  40 long tasks  renders=2628  ops=2849
```
**A 65x spread in gesture speed — void again, but the LOG now says so** instead
of leaving the division to whoever reads it. The arms are still not an A/B.

**What the new columns show is more interesting than the arms: the one burst
with `ops=0` scrolled at a 17ms median with 2 long tasks**, while every burst
with ops firing was 15-40x worse. A scroll measured **0 renders** on
2026-08-26 (5); these show thousands.

**AND `ops` ADDED A COUNT TO A DURATION.** `opsInBurst` sums the VALUES of
`{ runs, ms }`, so `ops=2301` is either 2,301 runs or one run taking 2,300ms —
different findings, indistinguishable. Split into `opRuns`/`opMs`. Also
reporting `verbose`, because verbose mode injects the A/B arm's CSS and paints
an overlay while silent mode does neither: a burst from each is measuring a
different page, and without it *"the diagnostic was left on"* is
indistinguishable from a real regression — which is exactly the question a
report of "the scroll is worse" raises.

**AND THEN THE USER RE-FRAMED IT, correctly:** *"it seems fine scroll wise. the
issue is the repaint. you scroll too fast and you are waiting for an entire
repaint."* Not a frame-rate complaint at all — and the diagnostic's own
verdicts had been saying so for three days. **`added=0` on every burst**, so
`renderWindow` is not mounting rows; what moves is `unskipped`, and the verdict
is literally **SKIPPED**. The mechanism is `content-visibility: auto` on
`.container-list--long`, whose whole bargain is to defer layout+paint until you
reach it.

**NO ARM HAD EVER TESTED IT.** The arms are marquee / backdrop / shadow — run
three times, shown nothing — while the one mechanism that matches the reported
symptom was not in the set. Replaced with `baseline` + `no-skip`.

**AND FOUR ARMS IS THE OTHER HALF OF WHY EVERY A/B WAS VOID.** Each arm is a
separate hand-scroll that has to match the others; the last capture spread
7-1,061px/s across four. **Two arms is a comparison a person can actually
perform twice at the same speed.** `MAX_SESSIONS` is derived from `ARMS.length`
now, so adding an arm can never leave the capture ending before that arm runs —
which would read as a suspect tested and exonerated.

The arm's selector is checked against `index.css` itself, because an arm that
neutralises nothing is worse than no arm: it reads as *"this suspect is not the
cause"* and sends the next session elsewhere. A/B'd — a stale selector and a
missing `!important` each fail exactly their own case.

**HELD BACK DELIBERATELY: the seed is measurably wrong.** `contain-intrinsic-size:
auto 44px` against a measured `real=56` and `58` on this tablet — a 21-24%
under-estimate, which the diagnostic's own `seedBad` check flags above 15%. The
44px was *"the midpoint of the 36-60px range actually measured on device"* on a
Samsung A15; this tablet sits at the top of that range, so no single constant
is right for both and it wants deriving rather than re-picking. **Not fixed
yet, on purpose: there is no point tuning the seed of a mechanism the next
capture may say to switch off for these lists.**

**THE REMAINING INTEGRITY ERROR IS NOT TODAY'S SCHEDULE, and the tell is the
label.** `container-filtered-empty` names *"7:30am"* and *"9:00pm"* — the
MODULE label, and this grid has many of each. The two it flags carry NO parent
date and hold rows stamped **2026-08-29**; today's two are correct, every child
dated 2026-08-31 against a filter of 2026-08-31. *A label is two fields on this
grid, and reading the wrong one invents a bug* — the 2026-08-23 (9) lesson,
paid from the reader's side this time. Pre-existing, two days old, and it is
the 2026-08-19 (5) family (a slot holding dated rows) rather than anything from
today.

3,628 client tests, lint 0 errors, deployed, prod HEAD verified. poms grid:
**1 pre-existing error, 1 pre-existing warning.**

---

### 2026-08-31 (2) — THE SCHEDULE RE-COPIED ITSELF ON EVERY LOAD, and the overlay lost the one key that would have stopped it

User: *"todays schedule is duplicating occuramces and the daypage col is
rendering twice"* → *"look for the fix, i didnt do anyting on todays stuff."*
Both symptoms are ONE defect, and it was **unbounded growth on live data**.

```
21,509 -> 21,558 -> 21,607 -> 21,656      +49 on EVERY page load
```
The loads are strictly sequential (connect → build → disconnect), so this is
not a race: **each load's `full_state` CONTAINED the previous load's column and
built another anyway.** Three day columns for today, minted 33 seconds apart;
one held **245 children — 49 distinct `copyLinkSource` values with EXACTLY 5
copies each** — while carrying the correct `parentId` and the correct
`meta.copyLinkSource` on all 245. So the persisted data satisfied the dedupe
FIND's predicate perfectly and the FIND missed it anyway.

**`applyEffectsToLiveOccs` BUILDS ITS OVERLAY ROW FROM AN EXPLICIT FIELD LIST,
AND `meta` WAS NOT ON IT.** COPY_LINK stamps `meta.copyLinkSource` for exactly
one purpose — so an idempotency FIND can match the copy — and the Schedule's
slot dedupe is precisely that (`meta.copyLinkSource IS $tplChildId AND parentId
IS $dayColId`). Dropping it made every fresh copy invisible to the FIND written
to stop it being copied again, so the next sweep in the same session re-copied
all 49. **The server persisted every round, which is why the live rows all look
right: only the OPTIMISTIC state was wrong**, and that is the state the next op
reads.

**THIRD TIME THIS BLOCK HAS LOST SOMETHING A CLONE IS IDENTIFIED BY, and its
own comments record the other two** — `role`/`kind`/`label` (*"so the NEXT op's
`$allContainers` filters see this occurrence"*) and `identitySignature` (*"the
OTHER thing a clone is identified by"*). There are THREE, and the third was
missed. It now matches `bindSocketToStore`'s CREATE_ITEM verbatim, because the
overlay's whole job is to predict what will persist — that file's own header
says any divergence is *"an op reading something that will never be true."*

**REPRODUCED AND A/B'd over the live grid through the real executor:**
```
before   children 49 -> 98 -> 147   grid 21,323 -> 21,415 -> 21,507
after    children 49 -> 49 -> 49    grid 21,323 -> 21,323 -> 21,323
```

**AND I MEASURED THE WRONG COUNTER FIRST, then wrote down the wrong
conclusion.** Counting day COLUMNS across three sweeps read 1/1/1 and I
reported *"the op is idempotent — the column FIND is not the bug."* The columns
were fine; the children underneath were multiplying. *A convergence claim is a
claim about the counter you happened to print.*

**FIVE TESTS, every one failing against the unfixed code** — four on the seam,
and one INTEGRATION guard asserting the sweep **converges**: a second identical
pass must create nothing. That guard is the general form and would have caught
this without anyone knowing the word `copyLinkSource`. Growth is asserted
BETWEEN two passes rather than as an absolute, because the sweep is
date-dependent and pass 1 legitimately builds a column on a fresh day.

---

**THE REPAIR'S GUARD FIRED ON THE APP'S OWN FOOTPRINT — TWICE — which is
0038's mistake, paid again.** First it counted every field value, and every row
carries **`Last Seen`**, written by an op each sweep with `flow:"replace"` and
a timestamp: all three columns read as *"holds user data"* and the repair
refused. Narrowed, it then counted the **op-PLACED** `Exercise`/`Eat`/`Drink`
rows that `Place Cycle Day` drops in carrying Meal/Movement picks and the
catalog's prescribed sets — and refused again. The discriminator this repo
already uses for op-placed schedule rows (2026-08-20) is the right one: the row
is the USER's if `Completed` was **ticked**, or it holds prose. *A
writing-guard has to tell what the user typed from what the app wrote, or it
protects empty clones for ever.* Read back: **`userTouchedRows=0` on all three
columns**, which independently confirms the user's own account.

**AND `maxCopiesPerSlot` READ 0 ON EVERY COLUMN because the probe never
selected `meta`** — a clean zero that would have hidden the duplication
entirely had the child counts not disagreed with it.

**Read back out of Mongo after the repair:** 383 occurrences dumped raw then
deleted (**unlinked from their parent BEFORE deletion**, or the repair mints
the dangling-child-ref class swept five times here), 4 orphaned modules swept,
pm2 restarted because the warm cache is authoritative for reads. **1 day column
· 48 slots · 49 distinct sources · exactly 1 copy each · grid 21,705 → 21,323.**

3,628 client tests, lint 0 errors (2 pre-existing warnings, confirmed present
at HEAD), build clean, deployed, prod HEAD verified.

**REPORTED, NOT FIXED — `Day Page: Build` throws on EVERY sweep**: `$col is not
a record (no .id)`. It does so from a clean day with exactly one column, so it
is independent of this and of the duplicates, and it has been failing silently
inside the sweep's per-op catch. Its own pass.

**AND THE CELL-SWITCH HYPOTHESIS IS NOT RETIRED.** +49 creates per load is a
plausible source of the 6,486ms post-paint block measured that morning, but the
capture recorded `ops runs=0` during the tap itself, so the link is unproven.
Re-measure now the growth has stopped.

---

### 2026-08-31 — THE TABLET ANSWERED AND THE INSTRUMENT LOST HALF THE ANSWER

Picked up the other account's session, which hit its **weekly limit** one command
after confirming the capture was in the log and before it could report what the
capture said. Its uncommitted `scrollDiag` edit was two behaviours from done.

**THE USER'S REPORT WAS ABOUT THE TOOL, NOT THE APP** — *"nothing is popping up
for capture"* — and the tool had in fact recorded **all four arms plus a
cell-switch**. `MAX_SESSIONS` is 4, and the fifth scroll `return`ed silently: on
a tablet, with no console, a spent capture and a diagnostic that never armed are
the same thing on screen. It re-shows the results now and names the one thing
that starts a fresh run (reload).

**AND THE A/B WAS VOID AGAIN — the exact failure 2026-08-29 (5) built
`comparability` to catch.**
```
arm           verdict       rate      frameMedian  missed  long tasks
baseline      MAIN-THREAD    285px/s    418ms        3      6 (2891ms of 3608ms)
no-marquee    RASTER          97px/s     82ms        7      4 (1143ms)
no-backdrop   MAIN-THREAD      0px/s    114ms       18      0
no-shadow     SKIPPED       1061px/s    635ms        2      7 (1917ms)
```
An **11x spread** among the three that moved; `no-backdrop` **never moved at
all** (0px in 12s, which that entry's own rule says must read *unknown* rather
than 114ms); and `no-shadow` ran on a **different surface** — rows 43 against
101, `unskipped=40` — so `content-visibility` engaged there and nowhere else.
**Nothing is attributable from the four arms.**

**THE GUARD EXISTED AND WAS INVISIBLE WHERE THE CALL GETS MADE.** The overlay
has flagged non-comparable arms since 2026-08-29 — but the overlay is on the
tablet and the decision is made from the **pm2 log**, which printed `scrolled`
and `dur` as two separate numbers and left both the division and the verdict to
whoever read it. The client already computed the rate and shipped it; it ships
the verdict now, and the log prints both. `renders`/`ops` were collected per
burst and **silently dropped from the line** as well. *A guard that does not
reach the surface the decision is made on is not a guard.*

**WHAT IS ATTRIBUTABLE, from baseline alone:** 6 long tasks totalling **2,891ms
of a 3,608ms gesture — 80% of the scroll inside a long task**, median frame
418ms (~2.4fps). The 2026-08-29 (5) reading was 86% at 109ms. Chronic, not a
fluke, and still main-thread.

---

**THE CELL-SWITCH IS THE REAL FIND, and it needs no A/B — it is one
decomposition.**
```
tap -> React commit       16ms     (Grid's own render body 8ms · scheduling 8ms)
commit -> first paint    184ms
THEN                   6,486ms     <- ONE unbroken block, AFTER the paint
total blocked          7,684ms     over THREE rAF frames
ops runs=0 · editors=0 · animations=3 · domNodes=18,656
renders  field 739 · container 210 · instance 183 · panel 24 · page 9
```
**GRID'S OWN RENDER IS EXONERATED AT 8ms, and that retires the standing
hypothesis this instrument was written to test** — its own comment says *"if the
~450ms is anywhere in React it is inside Grid's own render — its useMemos
recompute over the whole grid state."* It is not. The op sweep is out too
(`runs=0`), and so is TipTap (`editors=0`). The screen is **painted at ~200ms**
and then the main thread is gone for six and a half seconds.

**AND THE TALLY COULD NOT SAY WHICH SIDE OF THE COMMIT ITS 1,165 RENDERS FELL
ON — which is two different bugs with two different fixes.** In-commit is the
tap's own re-render cascade (narrow what subscribes); after-commit is work that
lands once the user is already looking at the result (fix whatever schedules
it). `markCellSwitchCommit` runs in a **`useLayoutEffect`**, i.e. after the
whole subtree has committed, so a snapshot taken there splits the tally exactly.
That split is the next capture's answer and is deliberately NOT guessed at here.

`subtractTally` is pure and **A/B'd with each mutation asserted to land**:
dropping the missing-key fallback fails exactly the absent-counter case,
reversing the subtraction fails exactly the two attribution cases. **The
zero-window control and the halves-sum-to-the-total pin pass either way** and
are kept as contract pins rather than counted as coverage — reversing BOTH
halves keeps the sum consistent, so that test cannot speak to direction.

3,623 client + 2,042 server tests, lint 0 errors on every edited file, build
clean, deployed, **prod HEAD verified** with both halves present in the served
`server.js` and the served bundle.

**NOT DONE, and it is the whole point of the change:** nobody has taken a
capture on the fixed instrument. The four arms want re-running **at the same
gesture speed** (the log now says whether they were), and the cell-switch wants
one more tap to say where those 1,165 renders live.

---

### 2026-08-30 — THE RUN LOG WAS THE SWEEP'S LARGEST REMAINING FRAME, and its only reader was a closed panel

Continuing the op sweep at the user's pick. The source-mapped profile's new top
app frame was `collectFindCandidates` — the per-record *"why didn't this FIND
match"* breakdown the operations log panel shows.

**IT RUNS ON EVERY FIND OF EVERY OP FIRE, AND NOBODY WAS READING IT.** Measured
by driving the real load sweep over the fixture:
```
94 calls · 1,349ms      87 x $allContainers · 3 x $allInstances · 3 x $allOccurrences
```
`recordRunLog` writes to an in-memory ring of 25 runs per op, and the ONLY
consumer is `OperationLogPanel`. Everything above was being computed, held, and
discarded unread.

**THREE KINDS OF DUPLICATE WORK, and the first one is the tell.** It rebuilt a
private **21,000-entry label Map per call** — even for a FIND over the 202 pages,
where that was **3.8ms of a 4.2ms call**. The identical index already existed,
memoised on the pool's identity, as the `byId` map `$allItemsById` is built
from. It also re-resolved each rule's RIGHT side once per record although a
right resolves against `$vars` alone and cannot depend on the record, and walked
each record path TWICE — once for display, once again inside the match.
```
$allOccurrences x2 rules   63.7 -> 38.8ms per call
$allContainers  x3 rules   10.4 ->  3.3ms
$allPages       x1 rule     4.2 ->  0.1ms
```
**THE OUTPUT IS BYTE-IDENTICAL**, which is what makes that half a pure
optimisation rather than a trade: the 2026-05-06 decision to leave the candidate
list UNCAPPED so a large pool can still be audited is untouched.

**AND MY FIRST OPTIMISED VERSION WAS SLOWER ON THE BIGGEST POOL — 72 -> 91ms.**
It spread `$vars` per rule per record to bind the resolved left; `$vars` holds
the 21k `$allItems` array and a dozen other keys, so 42,000 spreads cost more
than the work removed. The shipped form mutates one key in place and restores
it, which is what `evalRuleAgainstRecord` already did. *An optimisation is a
claim until the A/B runs; mine was negative and I would have shipped it.*

---

**THEN THE USER'S CALL: build it only while someone is looking.** Asked directly
— always-on, or only while the panel is open — and they picked the panel.
`OperationLogPanel` subscribes to the op it is showing, so a live subscriber IS
*"the panel is open on this op"*. No flag to remember, no console incantation.
```
ops harness load sweep, interleaved, 3 passes each
  no gate   2932 / 2685 / 2655 ms
  gated     1742 / 1866 / 1772 ms      -35%, no overlap
```

**I GATED TOO MUCH FIRST, AND THE EXISTING TESTS CAUGHT IT.** Re-resolving the
predicate against the MATCHED record sits in the same block and is O(rules) on
ONE record — it is what makes the log's `mod_dw IS mod_dw ✓` row readable at
all. Nine tests went red; seven were the breakdown and **two were that**. Only
the O(pool x rules) half is gated. *A gate drawn around a block instead of
around the cost takes the cheap half with it.*

**AND THE RECOVERY PATH WAS BROKEN BEFORE THIS COULD SHIP.** The panel's **"Run
now"** button — tooltip *"Run pipeline now and append to history"*, empty state
*"Click Run now for a live preview"* — called `executePipeline` directly, and
**only `runMatchingOperations` ever called `recordRunLog`**. It executed the
pipeline and recorded NOTHING; it has been inert since it was written. New
`runPipelineForLog` records the run. **Deliberately NOT done by making
`executePipeline` record whenever it owns its logger:** three other callers (the
scheduler, the ops-tab node-input preview, the alarm/pomodoro fire path) would
start writing history as a side effect of a tooltip fix.

**THE COST, stated rather than buried:** a run recorded BEFORE the panel was
opened carries no per-record breakdown. Its step entries — `resolvedPredicate`,
`boundVars`, the matched record's own values — are all still there, and
re-triggering the op produces a full one.

**TWO BEHAVIOURS THE OPTIMISATION HAD TO PRESERVE, both A/B'd.** A `$var` on a
FIND rule's LEFT still DISPLAYS the resolved var while MATCHING on the record
path — that asymmetry is the whole point of the row for the defect class `0276`
was written for, and unifying the two walks would have hidden the very mismatch
it exposes. And the shared index is a PLAIN OBJECT, so a dangling `parentId`
naming a prototype key (`constructor`) resolves to `Object.prototype`'s — a
function whose `.name` is a real string — and would render an ancestor called
"Object". A dangling child ref is not hypothetical here; this file records
sweeping them five times.

**MEASURED ON PROD, WARM, and the outliers are reported rather than dropped
quietly:**
```
session start          ~2,270ms   51 ops
after resolveExpr + the 4th merge   ~1,500ms
after the index fix     1022 · 1125 · 1067 · 1151 · 1217 ms
after the gate           754 ·  757 ·  769 ·  772 ·  786 ms      -66% overall
```
Two runs out of ~14 came back at 3,100ms and 3,507ms with a DIFFERENT op
dominating each time (`Fill Day`, then `Pages`) — machine noise, not a bimodal
code path, and the same shape 2026-08-29 (10) records for a single sample.

**VERIFIED IN THE SERVED CHUNK WITH A CONTROL, and the first check read 0 for
BOTH** — the documented tell. The executor lands in `PagePreviewApp`, not `App`;
`App`'s single `ancestorLabels` hit is `_ancestorLabels` on the drag
transaction, an unrelated string. Scoped correctly: `PagePreviewApp` carries
`op-timing` 1, control `ancestorLabels` 3, new `wantsCandidates` 2; `App`
carries `op-timing` **0**.

7 tests (4 on the optimisation, 3 on the gate and the button), **every mutation
asserted to land and each failing EXACTLY its own case** — and the gate is
pinned in BOTH directions, so it cannot degrade into *"never collect"*, which is
how this tool would go silently missing. 3,618 client tests, 300 files, all
green; lint 0 errors on every edited file. poms grid 21,297 occurrences, **0
page errors**.

**REPORTED, NOT FIXED:** scheduled fires (alarms, pomodoro, interval ops) go
through `executePipeline` directly and therefore leave **no run log at all** —
the same gap "Run now" had, from a path nobody has looked at. Whether a
scheduled fire should record is its own question.

---

### 2026-08-29 (12) — THE SAME 42,000-KEY MERGE, FOURTH SITE — and this one was in a CALLBACK

Re-profiling after (11) promoted a new top app frame, and it is the defect this
day has now paid for four times.
```
before (11)   598ms  resolveExpr             <- fixed
after  (11)   470ms  bindSocketToStore.js:371  <- the new leader
```
Line 371 is the load sweep's own notification getter:
`() => ({ fieldsById, occurrencesById: Object.assign({}, occurrencesById, localOccsById), modulesById })`.

**A CALLBACK, WHICH IS WHAT MAKES IT WORSE THAN IT LOOKS.** At load both maps
hold all 21,207 occurrences, so that is a 42,414-property copy — rebuilt EVERY
TIME the toast machinery asked for a lookup, not once. The `overlay` two lines
above it is the same merge, paid once.

**FOURTH SITE TODAY, one helper.** 2026-08-25 (9) cached this merge in
`_fireOperationsInner`; (6) found the seven rebuilds in `applyOperationEffect`
and the third copy in `getAncestorChain`; this is the fourth, in the file that
already exports the fix. *A shared helper only stops the drift at the call sites
that actually call it — grepping the SHAPE is what finds the rest.* There are
now zero `Object.assign({}, occurrencesById, localOccsById)` left in the client.

**SHARING THE CACHED INSTANCE IS SAFE, AND THAT WAS CHECKED RATHER THAN
ASSUMED** — the previous three sites are reads, and this one hands the map to
the EXECUTOR, which is a different question. `executePipeline` takes its own
copy before mutating anything (`const liveOccs = { ...(context.occurrencesById
|| {}) }`, operationExecutor.js:975) and the toast lookups are reads, so no
caller can write through the shared object.

3,611 client tests, lint 0 errors.

---

### 2026-08-29 (11) — SOURCE-MAPPED THE PROFILE, and the pipeline language checked its rare shapes first

(10) closed saying the prod profile was unreadable — minification turned the
app's own frames into `pe` / `xS` / `Mo`, and *"ranking mangled names would be
guessing with a decimal point on it."* User's call: source maps.

**RESOLVED AGAINST THE PRODUCTION BUNDLE, not a dev build.** Profiling an
unminified dev bundle would name the frames and change the code being measured;
the local `dist` is byte-identical to what is served (sha256-checked on every
deploy), so its `.map` files resolve the real profile offline. `source-map-js`
was already a dependency.
```
 598ms  7.6%  resolveExpr            src/helpers/operationActions.js:120   <- largest APP frame
 460ms  5.8%  (anon)                 src/state/bindSocketToStore.js:371
 253ms  3.2%  collectFindCandidates  src/helpers/operationExecutor.js:302
 182ms  2.3%  get scrollWidth        (vm)                                  <- forced layout
 160ms  2.0%  executeSteps · 155ms resolveRecordPath · 144ms executePipeline
```
`resolveExpr` alone is ~26% of the ~2,270ms sweep.

**IT CHECKED THE RARE SHAPES FIRST.** Every call ran eight `startsWith` probes
and an `includes` before reaching what the string actually was. Counted across
poms grid's OWN enabled pipelines — 9,991 strings:
```
7,018  plain literal   <- fell through EVERY check to `return expr`
2,869  $path
   44  literal:  ·  34  ${}  ·  26  json:
```
**The two shapes that are 99% of the traffic were the two paying the most.**
Both are identifiable from the first character plus one scan, and none of the
prefixed forms begins with `$`.

**AND THE REORDERING WAS ONLY A THIRD OF IT.** At the measured mix:
```
before                          62ms / 400k calls
+ first-character dispatch      53ms      -15%
+ memoised path split           23ms      -63% overall
```
The `split(".")` per `$path` was the larger half — an array allocated on every
call for a string drawn from a fixed set. Bounded at 5,000 entries because `${}`
substitution can mint new expression strings at run time, so the set is *small
and fixed* only for authored pipelines.

**PURE REORDERING, WHICH IS WHY THE TESTS CANNOT DISCRIMINATE — and the A/B is
against PLAUSIBLE WRONG VERSIONS instead.** Every shape must resolve exactly as
before, so a passing suite proves equivalence rather than vigilance. Three
mutations that a careless reordering would actually produce, each caught by
exactly the right test: the `$` fast path skipping the `${` check (an
interpolation like `"$allItemsById.${$childId}"` walked as a literal path)
fails 1; the literal fast path skipping `${` fails 1; the literal fast path
skipping the COLON check fails 2. *When a change is a no-op by construction, the
A/B has to mutate toward the bug, not away from the fix.*

The colon guard is the load-bearing one: this grid is full of `"9:00am"`, a
plain literal that CONTAINS a colon, so the fast path must bail on it and let it
fall through to the prefix checks it will not match.

12 tests, including the two that pin the shared parts array — a repeat call must
give the same answer, and crossing the cache bound must lose speed and never
accuracy.

3,611 client tests, lint 0 errors.

---

### 2026-08-29 (10) — THE OP SWEEP, PROFILED: no easy win, and one of my own numbers retracted

User's pick after (9). Measured rather than optimised, and the useful output is
the distribution plus two named leads.

**A SINGLE SAMPLE SENT ME AT THE WRONG SIZE OF PROBLEM.** The first capture read
`Schedule: Fill Day 1280ms — 39% of the sweep`, which is the kind of number that
starts a migration. Three more loads:
```
Fill Day     305 · 298 · 311ms          <- 1,280 was an outlier
Build Sched  528 · 558 · 563ms
sweep total 2268 · 2273 · 3315ms        <- the VARIANCE is in the other 48 ops
```
*A number worth acting on is worth sampling more than once* — and note the third
run's total is 1,000ms higher while the top two are flat, so the spread is
machine noise spread across the tail, not any one op.

**THE STABLE DISTRIBUTION, 51 ops, ~2,270ms:**
```
 ~550ms  3fx   Schedule: Build Schedule
 ~305ms  0fx   Schedule: Fill Day
 ~215ms  2fx   Day Page: Build
 ~13-30ms each x 48                     ~1,200ms — the tail is as big as the head
7 ops produce ZERO effects, costing ~500ms
```

**AND `Schedule: Fill Day` HAS NOT REGRESSED — checked rather than assumed.**
2026-08-23 (9) took it 766ms -> 127ms by adding `$tSlot.occurrences
IS_NOT_EMPTY`; that guard is still in the stored pipeline. Today's ~305ms against
that entry's 127ms is a different machine and a grown grid, not a lost fix.

**ITS REMAINING WIN IS THE ONE THAT ENTRY DELIBERATELY REFUSED**, and the refusal
still stands: hoisting the day's 49 slots into a var is ~27x and *"depends on
`$dayCol.occurrences` being populated in the overlay at that moment, and if it
ever is not, Fill Day silently stops filling the schedule."* A guarded
fall-back-to-the-scan form would answer that risk precisely — but expressing
"use the var if it is populated, else scan" in the pipeline language means
duplicating a 27-step body in both branches, which is its own defect surface.
**Still filed, still not built.**

**THE EXECUTOR'S SHARED CACHES ARE INTACT**, which is worth recording because
three of them turned out to be broken elsewhere today. `_allItemsCache` is
per-sweep and its invalidation is already surgical — `patchAllItemsCache`
refreshes touched entries for a VALUE-only write and only a structural effect
discards the read model, so the ~48 read-only ops after the two builders share
one build.

**A CPU PROFILE NAMED TWO COSTS THE OP TIMINGS CANNOT SEE**, taken on prod over
the post-paint window:
```
 201ms   get scrollWidth        <- FORCED SYNCHRONOUS LAYOUT
 355ms   tiptap updateStateInner + eq
```
The first is `AutoMarquee` (`ui/AutoMarquee.jsx:90`), whose own comment already
names the reflow. It is otherwise well-tuned — mount-once, a ResizeObserver for
later changes, an IntersectionObserver only when there is something to animate —
so the residual is that each of hundreds of marquees mounting in one burst forces
its own layout read. Batching the reads into one pass is the standard remedy and
is contained, but it touches a component rendered ~1,039 times on this grid and
the marquee surface has already cost several sessions. The second is the
long-standing *"editor static-until-focus"* docket item, arrived at from a third
direction.

**THE PROFILE IS MINIFIED, so the app's own frames read as `pe` / `xS` / `Mo`
and are NOT attributable.** Only the two named above are, because they are
platform and library frames. Source-mapped profiling — or the local dev bundle
against the prod database — is what the next pass needs; ranking mangled names
would be guessing with a decimal point on it.

No code changed. 51-op distribution, three samples, one retraction.

---

### 2026-08-29 (9) — 44 FEEDS WALKED 21,207 ROWS TO FIND 1,206; and a test disproved my safety argument

Continuing (8). The remaining cost in `resolveFeedItems` — and the first
measurement was against a grid whose shape I had invented.

**MY OWN BENCHMARK'S PREMISE WAS FALSE, AND IT POINTED AT THE WRONG TARGET.**
The synthetic grid made every one of 21,207 occurrences an `instance`, so every
candidate reached the predicate and the profile read:
```
bare walk + role filter                227ms
+ ancestorsOf (cached)                 286ms
+ two ancestors.includes()             326ms      <- my suspicion; 40ms, not it
+ the { ...occ, _ancestors } spread    909ms      <- looked like the prize
resolveFeedItems x37                  1849ms
```
Read off the live grid instead:
```
occurrence roles   artifact 15,708 · textblock 2,434 · container 1,654
                   instance 1,206 · page 202 · panel 3
enabled feeds      46   (CLAUDE.md's "37" was stale)
their roles        44 x ["instance"] · 2 x ["artifact"]
```
**Instances are 5.7% of the grid, and 44 of the 46 feeds want only instances.**
At that mix `resolveFeedItems x46` is **490ms, not 1,849** — so the spread was
never worth 583ms, and *the earlier entry's "~1,780ms still inside
resolveFeedItems" is corrected here rather than left standing.*

**THE WASTE IS A FACT ABOUT THE DATA, NOT ABOUT THE MODEL.** 44 feeds each
walked 21,207 rows to reach the 1,206 that could possibly match — 94% of every
walk rejected by one property read: **975,522 candidate visits per pass to
evaluate 84,480 real ones.** Bucketing by role once per pass: `490ms -> 155ms`.
The same shape applies to feedSync's own step-2 scan, which walked the whole
map to find the children of ONE parent, 46 times.

**ORDER IS LOAD-BEARING AND ALMOST GOT LOST.** With no `feed.sort` the result is
`out.slice(0, limit)`, so the walk order decides which rows survive. Bucketing
keeps insertion order WITHIN a role — byte-identical for a single-role feed, and
all 46 are single-role — but a MULTI-role feed is interleaved in a full scan and
grouped by role in a concatenation, which is a different 50 rows. So multi-role
keeps the full scan rather than being quietly re-ordered for a speed-up nothing
is asking for.

**AND MY ORDER TEST DID NOT DISCRIMINATE — the A/B is the only reason I know.**
It passed against the very mutation it existed to catch, because the fixture
added all instances BEFORE all artifacts, so concatenating the buckets happened
to reproduce the walk order. Interleaved, it fails correctly. *A guard is
untested until the fixture isolates the case only that guard covers* — this
file's line, paid again, and the A/B is what surfaced it.

**THEN A TEST DISPROVED THE SAFETY ARGUMENT I HAD REASONED MY WAY TO.** I
memoised the copy index on the map's identity, on the grounds that
`scheduleFeedSync` builds a fresh map per pass and never writes to it — checked
by grep, and true of that caller. `feedMixedClientChurn` went red: it drives
`syncFeed` twice over ONE map whose store applies the dispatches IN PLACE, so
pass 2 got a stale index, could not see the copies pass 1 had minted, and
re-minted them. **An idempotent engine turned into a churning one — which is
the exact defect that suite was written for after it cost a revert.**

The remedy is not a better argument, it is a correct lifetime: the index belongs
to ONE PASS, so `syncAllFeeds` builds it and hands it down, and a direct caller
gets a fresh one. Identity was a *proxy* for the pass, and a proxy that holds for
today's callers is not the same as the thing itself. A/B'd: reintroducing the
memoisation fails exactly those 3 tests.

**`occurrencesByRole` and `cachedAncestorsOf` KEEP identity memoisation**, and
that is a different call rather than an inconsistency: their callers are the
render path, where `occurrencesById` is
`useMemo(() => buildLookup(state.occurrences), [state.occurrences])` and the
reducer swaps that array on every write, plus feedSync's own read-only map.
Neither is mutated in place.

7 tests on the role index, **both A/Bs failing exactly one case** (bucketing the
multi-role path fails the order test; ignoring `modulesById` identity fails the
rebuild test — an occurrence with no role of its own inherits its MODULE's, so a
module edit changes the answer without the occurrence map moving).

3,599 client tests, lint 0 errors.

---

### 2026-08-29 (8) — feedSync REDID THE SAME WALK 37 TIMES, and the comment already said it shouldn't

With the effect loop gone, the post-paint window re-measured on prod as three
blocks. `feedSync` was the least examined — it logs nothing at all — so it went
first, at the user's pick.

```
 2-6s   ~4,370ms   initial render + progressive catalogue merge (occ 5,499 -> 21,207)
 9s     ~2,620ms   the op sweep (2,402ms of it)
11s     ~1,630ms   feedSync — nothing logs here; it lands where scheduleFeedSync(400) fires
        ~   51ms   effects (was ~1,648ms)
```
**An alignment error worth recording:** I first read the 9s block as unattributed
and reached for the catalogue. It is the op sweep — loadDiag's `t0` is
*full_state arrived* and the sampler's is *page load*, and the offset between
them is seconds. *Two clocks in one chart is how a block gets blamed on the
wrong thing.* Capturing ALL console in the window named it in one run.

**BENCHMARKED AT LIVE-GRID SCALE rather than guessed at** — 21,207 occurrences,
37 feeds, `CommitHelpers` mocked so nothing writes:
```
buildParentsMap  ONCE                       11ms
buildParentsMap  x37   (what ran)          454ms
cachedParentsMap x37   (the memoised twin)   0ms
Object.values(occs) x37                    184ms
ancestor walk, PER-FEED cache (what ran)   629ms
ancestor walk, ONE cache for the pass       33ms
resolveFeedItems x37                      2956ms   <- 94% of the pass
syncAllFeeds — the WHOLE pass             3083ms
```

**THE COMMENT ASSERTED THE FIX AND THE CODE DID THE OPPOSITE.**
`resolveFeedItems` says in as many words *"Memoised per map identity"* — and
called **`buildParentsMap`**, the uncached one, with `cachedParentsMap` sitting
six lines away in the same module. It also built its ancestor cache PER CALL, so
each of 37 feeds redid all 21,207 DAG walks the previous feed had just done. *A
comment asserting an invariant is not the invariant — this file's own line, paid
from the perf side this time.*

**THE ANSWER CANNOT DIFFER BETWEEN FEEDS**, which is what makes this a hoist
rather than a trade: the ancestor set of X is a fact about the grid, not about
who is asking. `cachedAncestorsOf` memoises both halves on the map's identity,
the same key and the same caveat as `cachedParentsMap`.
```
resolveFeedItems x37   2956ms -> 1782ms   -40%
the whole pass         3083ms -> 1955ms   -37%
```

**IDENTITY IS ONLY A SOUND VERSION IF NOTHING MUTATES THE MAP, so all three
callers were checked rather than assumed.** `feedSync` builds a fresh map every
pass and never writes to it (grepped); the feed editor's match count and the
graph's pull both read
`useMemo(() => buildLookup(state.occurrences), [state.occurrences])`, and the
reducer swaps that array on every write. **No executor caller**, which is the
one `cachedParentsMap`'s own doc warns about.

6 tests, **both A/Bs discriminating**: keying the cache on one global entry fails
exactly the invalidation case, and removing the memo fails exactly the two
caching cases. The invalidation test is the one that matters — it re-parents a
child between two DIFFERENT map objects and asserts the second answer follows,
so a cache keyed on something stable-but-wrong cannot pass.

**WHAT IS LEFT, measured and not taken:** ~1,780ms still inside
`resolveFeedItems` — 37 x 21,207 candidate evaluations, each doing an
`ancestors.includes()` twice (array scan, not a Set) and a full
`{ ...occ, _ancestors }` spread before the predicate runs. Both are reachable,
and both change what `evalGroupAgainstRecord` is handed, so they want their own
pass rather than the tail of this one.

3,592 client tests, lint 0 errors, build clean.

---

### 2026-08-29 (7) — THE TODO LIST KEEPS GETTING RE-DATED, and it is the COPY-LINK FAN-OUT

`gridIntegrity` reported `dated-copy-link-source` again — on the SAME occurrence
`0271` cleared 24 hours earlier. Chased, root-caused, reproduced, fixed.

**IT IS NOT PROBE DEBRIS, and that was the first thing to establish** since I had
loaded the grid ~20 times today:
```
stamped at   2026-08-29T13:14:05Z = 08:14 CDT
my session   started 11:04 CDT
```
Three hours before I touched anything.

**THE FIRST SUSPECT DIED ON A CONTROL.** `APPLY_TEMPLATE`'s `defaultFields`
became a DENYLIST on 2026-08-05 and now stamps containers, which looks exactly
like the cause. It is not: of the `Day` template's **49 children, exactly ONE
carries a Date** — and a template-wide stamp would have dated all 49. *The same
control shape 2026-08-28 used: 48 siblings carry no date and one does.*

**THE LIVE DATA THEN NAMED THE MECHANISM.**
```
linked group lg-LnLC5V1KIMt_    8 members (the source + 7 copies)
distinct Date values            1  ->  "2026-08-29"
one member's parent             "Wednesday, August 26th, 2026"
```
**A copy sitting in the AUG 26 column carrying AUG 29.** No per-column stamp can
produce that. `update_occurrence` fans EVERY field of a write out to every other
member of a copy-link group (`socketHandlers/occurrences.js:439`) — and the grid
FILTERS on `Date`, so the field that decides *which column a placement is in* was
being shared across placements. Grid-wide: 327 linked groups, 114 carry a filter
value, and only **3** still disagree — the rest are already flattened.

**REPRODUCED THROUGH THE REAL HANDLER, not asserted from the pipeline.** Three
linked members across two day columns; writing `Date` on one overwrites the
others and the template source. **The control is what makes it a measurement:**
`Completed` fans out correctly in the same test, so this is not "nothing
propagates" — it is one field class that must not.

**WHICH IS WHY `0145` AND `0271` COULD NEVER HOLD.** They repair the data; the
next morning's stamp fans straight back in. Two migrations, ten days apart, on
one occurrence, each correct and each temporary. *A repair that the write path
undoes is not a fix, and the third one would have been the tell.*

**THE FIX READS THE GRID, NOT A LIST.** `utils/filterFields.js` derives the
filter fields from `activeFilterValues` + `namedFilters[].conditions[].fieldId`
— the same source `gridIntegrity` uses for the rule that CATCHES this — so
nothing learns the word "Date". Only those fields are withheld; everything else
still syncs, which is what the feature is for.

**IT FAILS OPEN, AND THE DIRECTION IS A DECISION.** An unknown filter set
propagates everything, i.e. today's behaviour. The inverse — withholding
everything when the set is unknown — would silently stop a copy-link group
sharing `Completed`, which is a worse failure than the one being fixed and an
invisible one. Pinned by its own test.

**AND THE THREE FILTER WRITERS GO THROUGH ONE DOOR.** `update_grid`,
`update_grid_filter` and `update_grid_named_filters` can all change what the grid
filters on, and the write path reads the answer out of the user cache. Refreshing
it at each of the three is the *"eighth caller forgets"* trap this file keeps
paying for, so they share one `writeGridPatch`. The set itself is derived ONCE in
`state.js`, where the grid document is already in hand — so the occurrence write
path never pays a query for it.

**`0283` DELEGATES TO `0271`** rather than repeating its remedy (CLEAR, never
re-stamp — *"stamping works today and goes stale tomorrow"*) or its safety
discriminator (a copy is cleared only when its value EQUALS its source's; one
that differs was set deliberately and is KEPT and REPORTED). A separate migration
because `0271` has executed and a ledger entry has to describe what ran — the
`0276`→`0274` pattern. Dry run named exactly what was measured independently:
1 source, 7 inherited copies, no keepers.

**A GUARD CAUGHT MY OWN TYPO, AND I HAD COPIED IT OUT OF THIS FILE.**
`touches = ["occurrance"]` — the exact misspelling 2026-08-28 (6) records itself
making — was rejected by `partialBackup`'s check that every scoped migration
names real collections. *A war story in a CLAUDE.md entry is also a copy-paste
hazard; the mechanical guard is what caught it both times.*

13 tests (6 driving the real handler, 7 on the extracted helper), **A/B'd:
restoring the unguarded fan-out fails exactly 4** — the three defect cases plus
the filter-only write — while the CONTROL and the fail-open case still pass.
2,042 server tests, lint 0 errors.

---

### 2026-08-29 (6) — THE EFFECT LOOP WAS COPYING 21,000 KEYS PER EFFECT, and it was the 08-25 (9) fix applied to one of three places

The docket item, taken. The lever it named — batch the 195 effects into one
store write — turns out **not to be where the time was**, and measuring is what
said so before a line of the shared write path was touched.

**THE HYPOTHESIS I BROUGHT DIED FIRST, CHEAPLY.** The load path applies its
effects WITHOUT the `setOpApplyingEffects` cycle guard the nested fire path
wraps its own effects in, so the obvious suspicion was that each effect
re-fires operations. Counted:
```
effects applied           195
fireOperations calls        0        <- at any depth, for the whole load
positive control          0 -> 1     <- a deliberate fire DOES move the counter
```
**Zero, and the control is what makes the zero mean anything.** The load sweep's
effects fire nothing. (Most field writes hit the existing no-op guard: on a
settled grid the trackers recompute the value already stored.)

**THEN TIMING BY EFFECT TYPE NAMED IT IN ONE RUN.** Every effect cost the same
~10ms no matter what it did — which is the tell, because these do wildly
different amounts of work:
```
UPDATE_ITEM_FIELD             142   1452ms   10.2ms each
UPDATE_ITEM_LABEL              48    469ms    9.8ms each
UPDATE_ITEM_META                2     19ms    9.6ms each
UPDATE_ITEM_FIELD_VISIBILITY    1     10ms   10.1ms each
UPDATE_ITEM_TEXTMAP             1      0ms    0.1ms each   <- builds no overlay
SCROLL_TO                       1      0ms    0.0ms each   <- builds no overlay
```
**The last two lines ARE the measurement.** `applyOperationEffect` rebuilt
`{ ...state.occurrencesById, ...localOccsById }` in SEVEN of its cases, and the
only two cases that do not build one are the only two that are free.

**AND ON THE LOAD PATH BOTH MAPS HOLD THE WHOLE GRID.** `runLoadSweep` seeds
`localOccsById` from the full payload, so each rebuild is ~42,000 property
copies: **8.3 million per load**, plus 195 short-lived 21k-key objects. It is
invisible everywhere else, which is why it survived — the reducer keeps
`occurrences` as a flat ARRAY and carries no `occurrencesById`, so on every
other path that spread is a copy of a small map and costs nothing.

**THIS IS 2026-08-25 (9), APPLIED TO ONE OF THE THREE PLACES THAT NEEDED IT.**
That session found and cached the identical merge in `_fireOperationsInner`
(*"it copies 21,766 keys… ~1.7M property copies"*) and never touched the seven
rebuilds one function over, nor the third copy in `getAncestorChain`. *Two
implementations of one decision and only one of them was ever fixed — this
file's most-repeated class, paid again by the entry that named it.*

**THE FINGERPRINT WAS THE RIGHT CAUTION AND THE WRONG REMEDY.** 08-25 (9)
compared the local map's key list and value identities rather than counting
writes, because ~20 scattered assignment sites made a missed bump *"a
correctness bug, not a perf one"*. The risk is real; the answer to it is a
CHOKEPOINT, not a scan. All **22** mutation sites now go through
`setLocalOcc` / `dropLocalOcc` / `resetLocalOccs`, and a test greps this file
for the raw form so the twenty-third cannot be written by hand. It also matters
that the scan was not cheap where it counted: the fingerprint's own premise —
the overlay is *"tiny, a couple of dozen entries during a cascade"* — is FALSE
during the load sweep, where it is O(21,207) **per call**, spent deciding
whether to avoid a copy.

**MEASURED WITH THE BUNDLE SWAPPED BETWEEN EVERY RUN**, three interleaved
passes, because a before/after only measures the change if both halves ran
against the same thing:
```
arm     op sweep   effects   effects applied   slices
base      2001ms    5004ms         195           51
fixed     2038ms      44ms         195            2
base      2033ms    5171ms         195           51
fixed     2017ms      43ms         195            2
base      2045ms    5171ms         195           51
fixed     2021ms      45ms         195            2
```
**-99%, with no overlap.** The two controls are what make it a measurement: the
**op sweep is unchanged in both arms** (this touched the cost of applying
effects, not the work), and **the effect count is identical at 195** — the shape
a cost A/B has to have. `getAncestorChain`'s copy of the same scan went with it:
it runs once per `occurrence_updated`, ~80 times for one toggle, so that was
~1.7M key comparisons a toggle spent deciding whether to rebuild.

**AND IT RETIRES THE DOCKET ITEM RATHER THAN DOING IT.** The named next lever
was batching 195 dispatches into one to collapse the render fan-out. The render
tally barely moves (field 1,329 either way) — but those renders no longer sit
behind five seconds of blocking work, and the 3,178ms that was NOT inside
`applyOperationEffect` was the yields between 51 slices, which is now 2. *The
slicing from 08-29 (4) is untouched and still correct; it simply has almost
nothing left to slice.* Whether the render fan-out is worth attacking on its own
is now an open question with a much smaller number against it.

**HONEST LIMITS.** These are LOCAL numbers against the prod database; the local
baseline (5,004ms) is ~3x prod's last recorded 1,648ms, so the ratio and the
mechanism transfer and the absolute figures do not — prod is re-measured after
the deploy. The headless context reports no `longtask` entries at all, so the
long-task columns are omitted rather than printed as zeros (*an absent signal is
not a measurement of zero*). And the win is data-dependent by construction: a
load where many trackers genuinely change costs more rebuilds. It can never be
worse than before, because a cache MISS does exactly what the old code did
unconditionally.

16 tests across the extracted helper and the chokepoint guard, **four A/Bs each
failing exactly its own cases** — ignoring the write counter fails 5 (the
correctness ones), never caching fails 4, ignoring the BASE identity fails 1,
and one raw write smuggled back into the consumer fails 1. The controls carry
the weight: one proves the merge is rebuilt when a write lands *between two
reads* (in-batch visibility is the property the load sweep depends on), one
proves the guard's grep actually matches a planted raw write, and one proves the
writes were **not simply deleted** — an absence only counts once the thing has
been shown able to appear.

3,586 client tests, lint 0 errors, build clean. No server code changed, so no
migration and nothing owed there.

---

### 2026-08-29 (5) — THE DEVICE ANSWERED AGAIN, and the INSTRUMENT misread two of its four arms

Four `scrollDiag` arms off the tablet. The app's numbers are useful; the
diagnostic's own verdicts are not, and that is the finding.

```
arm           verdict    median  missed   blocked   scrolled        px/s   vs base
baseline      MOUNT       109ms  14/23      86%   15365 of 15374    2932     1.0x
no-marquee    MOUNT        17ms  11/179     40%    1946 of 17250     348     8.4x
no-backdrop   PAINT        17ms  24/340     42%    2580 of 17616     207    14.2x
no-shadow     RASTER       16ms   2/72       4%     425 of 18112     310     9.5x
```

**THE A/B IS VOID, AND NOTHING ON SCREEN SAID SO.** The arms exist to neutralise
one suspect each and compare frame medians — but **baseline scrolled 8-14x
faster than every other arm**, and it is the only one that flung the WHOLE page.
Read naively the table says the marquee costs 92ms a frame. It says nothing of
the kind: gesture velocity is the only variable big enough to explain the gap.
*This file has recorded "a before/after measures the change only if both halves
ran against the same thing" since 2026-08-25 (7), and the previous entry's own
capture failed the same way (two arms at 266px and 0px). The instrument had
never been taught to notice.*

**AND `MOUNT` FIRED ON ONE ROW.** `verdictFor` crowned MOUNT on `rowsAdded > 0`,
so the baseline arm — a textbook main-thread block, **16 long tasks, 4,481ms of
a 5,240ms gesture, 14 of 23 frames missed** — was reported as *"1 rows entered
the DOM DURING the scroll — they really were missing."* One row is not why a
five-second fling stuttered, and crowning it sends the next round after the
mount path. **The row is explained**: the scrollable height grew 15,374 →
17,250 → 17,616 → 18,112px ACROSS the four arms, so the progressive catalogue
load was still landing content under every one of them.

**THE FLOOR IS DERIVED, NOT PICKED.** "Rows were missing as I scrolled" means at
least a screenful arrived late, and the session already records the row height
and the viewport — so `mountFloor` is `clientHeight / realPx` (≈4 here) and
follows the device instead of a constant that is wrong on the next screen. A
sub-threshold mount is **reported inside whatever verdict wins** rather than
hidden, and `MAIN-THREAD` stops asserting *"nothing added to the DOM"*, which
was a flat lie whenever a row had landed.

**WHAT IS ATTRIBUTABLE WITHOUT A CLEAN A/B, said plainly:**
- **A full-page fling runs at ~9fps** — 23 frames in 5,240ms, median 109ms,
  **86% of the gesture inside a long task.** That is the "sticky" complaint with
  a number on it.
- **Even the gentle arms are ~40% blocked** (2,234ms/5,597 and 5,284ms/12,450),
  so this is chronic, not fling-only.
- **`content-visibility` is contributing NOTHING here** — `skipped at start 0`
  and `un-skipped 0` on all four arms, so the `.container-list--long` gate never
  engaged and the `seed ?px` reading is moot for these rows.
- **Every arm ran inside the documented post-paint load tail**, which is what the
  growing scroll height proves. So all four measure *scrolling against a main
  thread already committed to the load sweep* — not steady-state scroll cost.
  **The next capture is only worth taking after the grid goes quiet**, and the
  overlay now prints the rate so the arms can be checked before they are trusted.

**THE LEVER IS UNCHANGED and is the previous entry's docket item**: the block is
main-thread JavaScript during the load tail, and the measured next wall is the
195 effects becoming 195 dispatches and 195 render fan-outs (field 1,329 ·
container 359 · instance 307 on a load with nothing clicked). Batching them into
one write collapses the renders rather than redistributing them. Not built here
— it is the shared write path this file records being damaged repeatedly.

11 tests on the two pure helpers, **both A/B'd with the mutation asserted to
land**: restoring the unconditional MOUNT fails exactly 2, making
`comparability` always agree fails exactly 1. The positive controls matter more
than usual — one asserts a real screenful of late rows STILL reports MOUNT (or
the fix degrades into "never report MOUNT"), one asserts an arm CAN read
"comparable" (or the flag is a label nailed to every row), and one pins that a
0px arm reads "unknown" rather than dividing by zero into a finding. **Honest
gap:** the branch printing the long-task figure is unreachable under jsdom
(`PerformanceObserver.supportedEntryTypes` is unimplemented), so it is verified
only on the device; the reachable fallback — which must never let an absent API
read as zero long tasks — is the one under test.

3,570 client tests, lint 0 errors, build clean at the documented chunk sizes.

---

### 2026-08-29 (4) — SWEEP CHUNKING: the first attempt made it WORSE, and the measurement is the entry

User: *"keep going with the sweep chunking."* Shipped, reverted, re-shipped
corrected — and the useful output is the attribution, not the code.

**FIRST, THE ATTRIBUTION NOBODY HAD.** Long tasks on the page's own clock, with
the app's milestones on that same clock, warm:
```
@ 2097ms   801ms   bundle eval + mount
@ 3221ms   843ms   initial render (5,499 occurrences)
@ 6370ms  3606ms   <- the catalogue merge + op sweep + effects, ONE task
@10376ms  1090ms   feedSync
                   20 tasks, 8,468ms total
```
The ~9 seconds is not one thing. **The dominant block is a single 3.6s task**, and
the sweep's own log splits it: `runMatchingOperations 1,958ms` then
`applied effects 1,648ms`, back to back with nothing between them.

**ATTEMPT ONE MADE IT WORSE, AND THE TELL WAS IN ITS OWN LOG LINE.** Slicing the
effect loop at an 8ms budget:
```
before   ops 2076ms · effects 1766ms · 9 seconds >200ms after paint
after    ops 1962ms · effects 4807ms across 194 slice(s) · 11 seconds >200ms
```
**194 slices for 195 effects.** Every effect measures ~9ms, so every one blew an
8ms budget and the loop yielded after each — ~3s of pure scheduling, for nothing.
Reverted, helper included: a mechanism nothing has been shown to need is removed,
not parked for later.

**A BUDGET IS ONLY USEFUL STRICTLY BETWEEN ONE ITEM'S COST AND 50ms** — above the
item cost so a slice batches several, below the threshold a browser calls a long
task so no slice becomes the thing it was meant to prevent. At ~9ms an item, 32ms
batches three or four. Re-applied:
```
longest task   3606ms -> 2028ms     (and 2,028 IS the op sweep — the floor)
total          8468ms -> 8852ms     (+380ms of yields, the honest price)
```
Both the useful budget AND the pathological one-slice-per-item degeneracy are
pinned by tests, so that failure is recognisable rather than mysterious next time.

**AND THE RE-MEASUREMENT NAMES THE NEXT WALL, which slicing cannot reach.** Three
~1,000ms tasks survive AFTER the sweep. A 32ms slice becoming a 1,000ms task means
**the budget measures the effect APPLICATION and not the React render each one
provokes** — the render is synchronous at dispatch, so it is outside the loop's
control entirely. The tally on a load with NOTHING clicked:
```
field 1,329 · container 359 · instance 307 · panel 81 · page 33
```
195 effects, ~7 field renders each. **That is 2026-08-25 (5)'s docket item reached
from a new direction** — *"`ModulePanel` subscribes to `occurrencesById`, rebuilt
on every occurrence write, so all three mounted panels re-render on each"* — and
it is now the largest remaining cost with a number against it.

**SO THE NEXT LEVER IS FEWER STORE WRITES, NOT MORE YIELDS.** 195 effects are 195
dispatches and 195 fan-outs; applying them as one batched write would COLLAPSE the
renders rather than redistribute them. That is a change to the shared write path
and it wants its own pass.

**THE DERIVED SCOPE IS CARRIED ACROSS THE YIELDS**, via `captureAction` taken
synchronously while the scope is still live and `runInAction` per item. Without it
the continuation resumes at derivedDepth 0 and every write opens an undo action —
the 2026-08-27 (3) defect where a page load pushed 26 undo steps and Ctrl+Z
reverted a tracker recomputation instead of the user's last edit.

Verified on prod after: 21,207 occurrences · 7,816 modules · 71 ops · 70
containers · 105 rows · **0 page errors**. 3,558 client tests.

**A MEASUREMENT NOTE THAT COST TWO RUNS, TWICE:** first paint read 197,998ms and
then 3,096ms for the same build. A deploy restarts pm2, so the next load pays the
documented ~180s cold Atlas read. *Every load number here is from a warmed server;
one taken right after a deploy measures the cache, not the code.*

---

### 2026-08-29 (3) — THE DEVICE ANSWERED: 9 seconds of blocked main thread after the grid paints

The tablet ran the diagnostic and settled what no probe here could. Two arms
scrolled far enough to count:
```
#1 baseline    PAINT — main thread blocked 8680ms of 12117ms · 11 long tasks · 25/90 frames missed
#3 no-backdrop        blocked 9829ms · 26 long tasks · 28/67 frames missed
#2 / #4        scrolled 266px and 0px — samples too small to compare, and said so
```
**Not raster, not the DOM: JavaScript.** And invisible from here — 12 wheel steps
at 4x CPU throttle cost 71ms of script. *A desktop cannot measure this class; the
2026-08-04 entry said so and it is true again.*

**THEN THE CULPRIT, MEASURED HEADLESSLY BECAUSE IT IS A LOAD PHENOMENON RATHER
THAN A SCROLL ONE.** Sampling the main thread once a second after first paint:
```
1s 984ms · 2s 923 · 3s 692 · 4s 1021 · 5s 1001 · 6s 1004 · 7s 1001 · 8s 690 · 9s 580
10s 8ms  — quiet
```
**Nine consecutive seconds at ~100% blocked, and only THEN does it go quiet.**
The client's own log names it:
```
+176348ms  reducer dispatched (5499 occs, 4362 mods)     <- the core, painted
+182061ms  [op-timing] total=2076ms ops=51
+183826ms  applied effects in 1766ms
```
The onLoad sweep and its effects are ~3.8s of that, inside a ~9s tail. **The grid
LOOKS ready and is saturated.** A user who scrolls in that window — which is the
natural thing to do, because it has painted — is scrolling against a main thread
that is already fully committed. That is the 8,680ms the device reported.

**AND MY OWN CHANGE MAKES THAT WINDOW LONGER, which is worth stating plainly.**
The progressive load moved first paint 6.69s → 4.33s without changing the ~9s of
work that follows, so the "looks ready but is busy" gap GREW by the amount the
paint improved. The change is still right — the grid is usable sooner and the
catalogue no longer competes with the first frame — but it did not touch the
thing that makes scrolling choppy, and it slightly enlarged the trap.

**THE FIX IS THE SHAPE OF THE SWEEP, NOT ITS SIZE.** 51 ops run as ONE 2,076ms
task and the effects apply as another 1,766ms one. Long TASKS are what block a
frame; the same work spread across frames would not. The levers, in order:
yield between operations (they are already priority-sorted, so slicing preserves
order — but each slice's effects must be applied before the next runs, since the
in-batch overlay is what lets a later tracker see an earlier create); and pause
the drain while the user is interacting, for which `window.__moduli_interacting`
already exists and is already honoured by the op-run-log drain.

**NOT BUILT HERE, deliberately.** This is the shared write/execute path this file
records being damaged repeatedly, and it wants its own reviewed pass rather than
the tail of a long session — the same call 2026-08-25 (5) and 2026-08-27 (2) both
made about it.

**AND THE DIAGNOSTIC NOW NAMES THE CULPRIT, not just the layer.** `__renderTally`
has counted React renders per component and op fires per op all along, reachable
only from a console — which the reporting device does not have. `scrollDiag`
diffs it across each burst and prints it in its own overlay, so the next capture
says whether those seconds are rendering, ops, or neither, and which ones.

**A note on the load measurement that follows a deploy:** first paint read
183,451ms and then 176,585ms on two runs — both the documented COLD ATLAS READ,
because a deploy restarts pm2 and the probe raced the prewarm. Warm, the same
probe reads 4.3s. *A load number taken right after a deploy is a measurement of
the cache, not of the code.*

---

### 2026-08-29 (2) — the audit's SECOND pass: still choppy, and the load is 29 MB

User, after the listener fix shipped: *"its still kinda choppy, especially
swiping back up. also the load times are terrible on tablet. but it could be my
internet."*

**THE UP-VS-DOWN ASYMMETRY DOES NOT REPRODUCE HERE, and that is a real result
rather than a shrug.** Ten wheel steps each way at 4x CPU throttle, warmed in both
directions first so neither pays a one-time cost the other avoids:
```
DOWN #1  Task 614ms · Script 57 · Layout 3 · Recalc 0 · layouts 1
UP   #1  Task 556ms · Script 46 · Layout 3 · Recalc 0 · layouts 2
DOWN #2  Task 579ms · Script 31 · Layout 3 · Recalc 0 · layouts 2
UP   #2  Task 552ms · Script 36 · Layout 1 · Recalc 0 · layouts 1
```
Identical inside noise, and **0 long lists · 0 content-visibility nodes** on that
view — so the classic "scrolling up re-lays-out skipped content" asymmetry is not
what is happening on the surfaces measured. `content-visibility` is correctly
gated to `.container-list--long` and carries `contain-intrinsic-size: auto 44px`.

**WHICH MEANS I HAVE HIT THE WALL THIS FILE ALREADY NAMES.** 2026-08-26 (5): *"a
desktop GPU at 4x CPU throttle is not a tablet, and paint is the one cost that
does not scale with the CPU knob."* Script and layout are cheap; what is left is
raster, and this environment cannot measure it — the same reason
`helpers/scrollDiag.js` was written in the first place, and the 2026-08-04 mobile
scroll bug was solved by *"the user's own device"*.

**SO THE DIAGNOSTIC IS REACHABLE FROM A TABLET NOW.** Its overlay required setting
a global from a console — which the one device it exists for does not have.
`?scrollDiag=1` enables it and is remembered for the tab so the app's own
navigation cannot silently drop it mid-investigation; `?scrollDiag=0` clears it.
It discriminates MOUNT / SKIPPED / PAINT / RASTER, which is exactly the question
left open. Verified on prod: the flag sticks and the overlay hook is installed.

---

**AND THE LOAD COMPLAINT IS NOT THEIR INTERNET.** Measured at a tablet viewport:
```
full_state over the socket   28.74 MB decompressed   (5 frames)
all HTTP for the whole app    1.85 MB                (34 requests)
hydrated 6.5s · painted 6.7s · settled 12.7s   — on a datacentre connection
permessage-deflate            NEGOTIATED — the wire is far smaller than 28.74
```
So the bundle is not the problem; **the grid state is**, and the tablet pays it
twice — once to decompress, once to `JSON.parse` ~29 MB on the main thread. That
cost is there whatever the network does.

**THE OBVIOUS LEVER IS THE WRONG ONE, AND MEASURING IS WHAT SAID SO.** Textmaps
look like the weight and are not:
```
occurrences 21,207 — everything except textmap   20.22 MB
             textmap, decompressed                1.20 MB   <- 4%
modules      7,816                                7.42 MB
```
Lazy-loading textmaps would save 4%. **That is also why the 2026-04-11 revert
("All Textmaps Upfront") was right**, which is worth recording: the reverted
optimisation was never where the bytes were.

**WHERE THEY ACTUALLY ARE — 80% of the payload is a catalogue nobody has open:**
```
artifact   15,708 occurrences   16.15 MB   <- of 20.22 MB
   song 5,484 (6.08)  album 3,027 (3.14)  bookmark 1,467 (1.70)
   artist 1,679 (1.46)  movie 993 (1.14)
textblock   2,434   2.57 MB
container   1,654   1.65 MB
instance    1,206   1.07 MB
page          202   0.16 MB
```
The surfaces the user actually works on — Tasks, Trackers, Schedule, Projects —
are the instance/container/page rows: **~3,000 occurrences, ~2.9 MB.** The Spotify
and Calibre imports are shipped in full on every load of every device.

**REPORTED, NOT BUILT, and deliberately so.** Sending artifacts on demand is an
architectural change with a known constraint already measured on 2026-08-25 (2):
19 ops walk `$allItems` over all 21,766 rows and 4 walk `$allOccurrences`, so
withholding artifacts changes what those ops see. That entry filed the per-op work
"with the measurement rather than done hastily", and this is the same call. It is
now quantified: **the prize is ~16 MB of every load.**

---

### 2026-08-29 — SCROLL AUDIT: every swipe on every touch device waited on the main thread

User: *"start an audit on scroll behavior. it runs very sticky on tablet at
least. i want it smooth and slidy. like it keeps moving after the swipe"* ->
*"this is more swipe scroll down lists"*.

**THE CAUSE IS A LISTENER, NOT A PAINT COST — and that inverts where four
previous sessions looked.** `DragProvider` attached `touchmove` and `touchstart`
to `document` with `{ passive: false }` **for the whole session on any touch
device**. The handlers are cheap and only `preventDefault()` while a drag is
running, but that is irrelevant to the browser: **a non-passive touch listener
means it cannot know whether preventDefault will be called until JavaScript has
run**, so it may not hand the gesture to the compositor. Every swipe was
main-thread-gated. It is precisely why Chrome made document-level
`touchstart`/`touchmove` default to PASSIVE; this code opted back out.

**MEASURED DIRECTLY — the listeners themselves, not a symptom.** CDP
`DOMDebugger.getEventListeners` over the scroll chain on prod at 820x1180:
```
document  touchstart  passive=false   App bundle   <- ours, always on
document  touchmove   passive=false   App bundle   <- ours, always on
document  wheel       passive=false   App bundle   <- wheelScroll, mouse-only, deliberate
window    touchstart  passive=false   (unknown)    <- see below
```

**THE OTHER SUSPECTS DIED BY MEASUREMENT, which is what makes this the answer
rather than the next guess.** A scroll frame is CHEAP now — 12 steps at 4x CPU
throttle cost **71ms script · 3ms layout · 0ms recalc**; the marquee work of
2026-08-26 (6) did its job. At a tablet viewport there are **0**
content-visibility nodes, **0** will-change nodes and **0** running animations,
against the 50 animations and 46-off-screen that entry found. Chaining is not it
either: of 4 scrollers only 2 are nested, and those are 22px and 236px
`instance-fields` blocks. `renderWindow` is not it for ordinary lists — it
engages only above 120 rows and looks ahead 600px, and the lists in question hold
20-40.

**SCOPED TO AN ACTIVE DRAG, AND EVERY CASE THE GUARDS EXISTED FOR IS COVERED BY
SOMETHING THAT FIRES EARLIER.** The gesture that BECOMES a drag always starts on
a handle already carrying `touch-action: none !important` in CSS — set before the
touch begins, precisely because *"JS handleDragStart is too late"*.
`handleDragStart` then sets `touch-action: none` on `documentElement`
SYNCHRONOUSLY, so any touch beginning after that is blocked. Edge/OS gestures
during a drag are `preventEdgeTouch`'s job, and by then the guards are attached.
The only window lost is the drag's own opening gesture, which CSS already owns.
**`dragover`/`dragenter` deliberately stay always-on:** an OS or HTML5 drop
arrives unannounced and must be claimed whether or not an in-app drag is running
— and neither blocks scrolling.

**I COULD NOT MEASURE MOMENTUM, AND SAY SO RATHER THAN DRESSING IT UP.** Both A/B
arms read `MOMENTUM = 0px` — the documented both-arms-zero tell. A clean CONTROL
page named it: `synthesizeScrollGesture` with a TOUCH source scrolls **0px even on
a bare page with one tall div**, while the wheel source scrolls 600px. **Headless
Chromium here produces no touch fling at all**, so the instrument cannot answer
the question and the zeros were facts about the probe. What IS measurable is the
listener set, and that is measured before and after.

**AND THE ONE REMAINING BLOCKER WAS MY OWN PROBE.** After the fix the audit still
reported a non-passive `touchstart` on WINDOW. Tracing the registration stack
rather than filing it: `at addHitTargetInterceptorListeners … InjectedScript` —
**Playwright's own instrumentation**, which does not exist for the user. Reporting
it as an app defect would have sent the next session after a library that is not
there. *Check the probe before believing the finding, even when the finding
survives your fix.*

**VERIFIED ON PROD AFTER THE DEPLOY:** at rest the app now registers **zero**
scroll-blocking touch listeners; only the deliberate mouse-only `wheel` one
remains. 10 tests on the extracted helper, the gate pinned in BOTH directions so
it cannot degrade into *"never attach"*, and the detach test carries the same
capture flag — `removeEventListener` without it silently keeps the listener,
which would read as *"the fix did nothing"*. 3,543 client tests, lint 0 errors.

**REPORTED, NOT FIXED:** a fast fling on a **>120-row** list (the 993-row media
boards) can still outrun `renderWindow`'s 600px lookahead and stall at the seam.
Not measured — the same instrument gap — and not what the user is scrolling
today, so it is written down rather than tuned on a guess.

**WHETHER IT NOW GLIDES IS FOR THE TABLET TO SAY.** The block is removed and that
is measured; the feel is not something this environment can judge.

---

### 2026-08-28 (8) — the alarm rang with its OFF SWITCH behind a click

User: *"make sure the alarm dropdown opens when the alarm is going."*

**STOP AND SNOOZE LIVE INSIDE THE PANEL, AND NOTHING OPENED IT.** A ringing alarm
shook the toolbar button and turned it red; the two controls that actually
silence it sat behind a click the user had to know to make. An alarm interrupting
what you are doing is the entire point of an alarm.

**KEYED ON THE RING'S IDENTITY, NOT ON "is it ringing", and that difference is
the whole design.** Opening while `ringing` is truthy would re-open the panel on
every render — a user who closed it during a long ring could never keep it
closed. One open per ring: close it and it stays closed, with the shaking button
still saying the alarm is going. A snooze re-ring mints a new id, so it opens
again, which is what a snooze is for.

**WHICH EXPOSED THAT `startAlarmRing` WAS NOT IDEMPOTENT — though its own comment
had always said it was** (*"Idempotent while already ringing the same alarm — it
just keeps the loop going"*). It reassigned `_ringing` with a fresh `startedAt`,
restarted the loop (re-triggering a burst) and emitted, on EVERY call. Inert
while nothing watched the identity, and **not** inert once the panel opens itself:
a repeat NOTIFY would re-open a panel the user had just closed on the same alarm.
*A comment asserting an invariant is not the invariant — this file's own line,
paid again.*

**`ringId` IS A COUNTER, NOT THE TIMESTAMP.** Two rings inside one millisecond
share a `startedAt` and read as the same ring; the A/B deriving the id from the
clock fails three tests, the snooze re-ring among them.

**AND THE AUDIO CAN NO LONGER COST US THE BANNER.** `startAlarmRing` called
`ringAlarm` before `_emit()`. `alarmSound` promises it is *"safe to call from
anywhere … the notification still shows"* and returns false rather than throwing
for the case it knows about — but it schedules WebAudio nodes, and the banner is
now the only thing putting Stop and Snooze on screen. A throw would have silenced
the alarm AND hidden the way to dismiss it. Both the first burst and the loop tick
are isolated. A/B'd: removing the guard fails exactly its own test.

**VERIFIED END TO END ON PROD, with the closing done BY HAND** — which is the
half that matters, since the risk is a panel that re-opens forever:
```
armed a temporary alarm for 17:16 · CLOSED THE PANEL BY HAND
+18s   panelOpen true · "Ringing…" · Stop present · Snooze present
Stop   banner gone
```
Screenshotted. Then cleaned up: both probe alarms deleted through the UI, leaving
exactly the user's own two (`5 PM`, `6:30 AM`), read back out of Mongo.

**MY PROBE LEFT DEBRIS AND I SWEPT IT.** A fired alarm drops an instance onto
today's Schedule (2026-07-20, by design), so three probe rings left three
`⏰ Alarm` rows on the user's real day column. Removed — **unlinked from the
parent BEFORE deletion**, or the repair mints the dangling-child-ref class this
file has swept five times — dumped to `backups/orphans/` first, pm2 restarted so
the warm cache stopped serving them. **Their three FEED COPIES needed no pass:**
`feedSync` is a scan-based self-healing diff, so a copy whose source is gone is
swept on the next client load — measured, one load later all six were gone.
**Left alone deliberately: the `⏰ 5 PM` row from the user's OWN alarm firing at
5 PM.** That is a true record of a real alarm at its real time; deleting it to
tidy my own mess would be the damage, not the fix.

**FOUR PROBE FAULTS BEFORE ONE NUMBER WAS TRUSTWORTHY, and every one is the
documented shape.** (1) Setting only `moduli-token` mounts the app — `hasSession`
needs only the token — but leaves it on the LOGIN gate, so the toolbar was absent
and I nearly filed it as "the grid does not render for a probe". It needs
`moduli-userId` and `moduli-gridId` too. (2) I counted alarms off
`state.operationsById`; **the client store holds FLAT ARRAYS** (`operations`,
73 of them) — the exact trap recorded on 2026-07-29 (3) and again on 2026-08-26
(3), read for the third time. It reported `0 alarms` while the panel rendered four
rows. (3) The first live run aborted after creating an alarm and left it behind.
(4) My "other containers still show their filter pill" control read 0 for the
wrong reason. *A zero is a claim about the probe until it has been shown
reporting non-zero.*

**AND IT CLOSED THE OTHER OPEN ITEM BY ACCIDENT.** The screenshot shows the Via
Fluere kanban behind the alarm panel, its cards reading `Project: Via Fluere` — a
resolved LABEL, not the raw occurrence id the PREVIEW shows. (5)'s *"reported, not
fixed"* preview-scoping diagnosis is confirmed **by looking**, which is what it
was missing.

8 tests on the ring store, all three guards A/B'd — and the same-alarm guard has
its own inverse beside it (a DIFFERENT alarm mints a new id and does open) so it
cannot degrade into *"never open twice"*. The component seam is not mounted:
`AlarmDropdown` needs the whole grid store, so the decision lives where it can be
tested and the effect is three lines. 3,532 client tests, lint 0 errors, build
clean, deployed, prod HEAD verified, poms grid **0 errors**.

---

### 2026-08-28 (7) — a DRAG wrote nothing: the Status Router had no inverse

The open item (5) left and (6) measured, now built. User's call, asked directly:
*"drag sets Status, and + does too."*

**MEASURED FIRST, WHICH IS WHAT MADE IT A NAMED DEFECT RATHER THAN A FEATURE:**
```
ops that mention Status    2   Status Router · Sync To Todo List
their trigger              onChange · field · Status   (BOTH)
ops triggering on a MOVE   1   Schedule: Clear Date on Move-Out
```
A drag emits `OccurrenceMoveOp` and **nothing listened for one on a kanban card.**
The card moved on screen, `Status` stayed stale, and the Router yanked it back to
the column its Status named the first time anything touched it — which is exactly
what (4)'s *"0 status/column mismatches"* control was quietly protecting.

**THE GATE IS A MARKER FIELD, AND BOTH OBVIOUS ALTERNATIVES ARE TRAPS.** Matching
the destination's LABEL against the status options is one rename from wrong. And
the tempting shortcut — putting the STATUS value on the column itself — is
actively DANGEROUS: `Sync To Todo List` fires on ANY Status change and would try
to COPY_LINK the column onto the Tasks page as though it were a task. So a column
carries its own `Kanban Column` marker, exactly as a schedule slot carries
`Time Slot` and a day column carries `Schedule Format`. The op then knows nothing
about kanbans or projects: **a container carrying a status marker defines the
status of whatever is dropped into it.**

**ONE OP, TWO GESTURES:** a drag carries `toContainerId`, a card created with the
column's "+" carries `containerId`. Both resolve, so a new card is born with its
column's status instead of starting blank and never mirroring.

**AND THERE IS NO ELSE BRANCH, DELIBERATELY.** `makeStampDateTimeSlotOp` CLEARS
its field off a non-slot destination — a copied row would otherwise keep a time it
no longer sits in. The opposite is right here: a task dragged out of the board and
onto the schedule is still at whatever stage it was, and clearing Status would
drop it out of the Todo mirror silently. **The A/B proves it is a decision rather
than an omission:** adding the clearing ELSE fails exactly the two tests that
describe it.

**DRIVEN THROUGH THE REAL EXECUTOR over the real fixture**, not asserted from the
pipeline — the discipline (4) paid for. 6 behavioural cases, including the two
carrying the risk (a destination with no marker writes NOTHING; an existing Status
survives a drag out of the board), plus one running the op **alongside the grid's
own 80+ ops**, because a pipeline that only works when nothing else runs is not
shipped.

**THE COLUMN HEADERS GET THEIR LABELS BACK (`0282`).** At 260px they read
*"Backburn"*, *"Working I"*, *"In Revie"* — truncated by a filter pill printing
the same INHERITED date six times, in the six places with the least room for it.
`hideFilterPill` suppresses the value and keeps the funnel, which matters: the
icon is the only route into a column's own menu. A VIEW key rather than a shape
key, so one setting on the board reaches all six columns. **`0282` DELEGATES to
`0279`** rather than repeating it — one definition of what a project kanban looks
like — and is a separate migration because `0279` has executed and a ledger entry
has to describe what ran (the `0276`→`0274` pattern).

**Read back out of Mongo:** 18 columns marked, marker == own label on all 18, all
18 BOUND (a value with no binding renders nowhere — the `0047` half), 0
non-containers marked, hidden grid-wide, the op live and referencing both fields,
both forced re-runs report *"already converged"*, poms grid **0 errors**. On prod:
six headers reading their full labels, **6 of 6 funnels surviving** — the control
that says the pill was suppressed rather than the chevron deleted.

**A CONTROL OF MINE PROVED NOTHING AND I SAY SO RATHER THAN COUNTING IT.** The
"other containers still show their pill" check read 0 on the scope sections AND 0
on the Tasks page — the preview renders no pills at all, so a zero there is a
statement about the probe. What stands is a before/after on the same probe (the
earlier screenshot shows the truncated labels and the pills) plus the funnel
count. *An absence is only evidence once the thing has been shown able to appear.*

**The seed CALLS `0281`** rather than reimplementing it, the way it already calls
0064 / 0067 / 0164 — the seed IS the migration, so a fresh grid and a migrated one
cannot drift on the marker, its bindings or the op.

3,525 client + 2,020 server tests, every guard A/B'd, lint 0 errors, build clean,
deployed, prod HEAD verified. `partialBackup`'s `loadMigrations` budget went
20s → 45s: it imports every migration (292 now), takes ~6s alone and crosses only
under parallel load — the same call as 2026-08-25, raise the budget rather than
trim what it checks.

**STILL NOT VERIFIED, and it is the honest gap: nobody has dragged a card with a
mouse.** The op is proven through the real executor over the real fixture and the
columns are proven to paint, but the gesture itself is unexercised — a drag probe
writes to live data, and `DragProvider` resolves its target from a `pointerRef` a
synthetic drag never moves, so a green synthetic result would be a claim about the
probe. One real drag settles it.

---

### 2026-08-28 (6) — the kanban STACKED its columns, because `flex-row` was inert on a container

Picked up the other account's session, which hit its limit at 15:20 one grep into
the last open item of (5). Its shipped work (`0277`/`0278`) was already at HEAD.
Then the user redirected, four times in four minutes, and that is what shipped:
*"make the projects kanban look more like a kanban ... columns going across fixed
height, no wrap"* -> *"right now they are stacked"* -> *"then make the container a
certain min width with scroll for layout"* -> *"switch the kan ban and project
scope around"* -> *"make the project scope textblocks fit our doc container ->
doc container -> textblock type schema. instead of one big textblock"*.

**THE COLUMNS STACKED BECAUSE A DECLARED MODE WAS NEVER CONSUMED, and that is
the `childMaxWidth` class of 2026-08-25 one mode over.** `mode: "flex-row"` has
been in the layout-cascade vocabulary all along — `PageBoard` has laid the
Schedule's day columns out with it since 2026-07-31, and `layoutToSurfaceShape`
already maps the rich Layout editor's *"flex, no wrap"* straight onto it. But
**only PageBoard ever read it**, so on a CONTAINER it was inert: set it and
nothing moved. `0278` had just made the six columns render; they rendered as six
full-width strips down the page.

```
                      reads mode        wrap    flex-row
PageBoard (a PAGE)    yes               n/a     day columns since 07-31
ModuleContainer       wrap ONLY         tiles   INERT   <- the whole defect
```

**`wrap` AND `flex-row` ARE OPPOSITES ON EXACTLY ONE AXIS, which is why their
defaults cannot be shared.** Both lay children out across; a wrap tile flows onto
the next line and a kanban column must not. The tile default is 132px, and a
132px column is useless — `flex-row` takes PageBoard's own 280/360 instead. The
decision is a pure `resolveContainerChildLayout`, because mounting
`ModuleContainer` needs the whole grid store and the per-mode defaults are
exactly where a bug would hide. **The regression guard that matters most is that
an unconfigured container returns no class and no vars** — 539 nested board
containers, every schedule time slot among them, go through this.

**THE SELECTOR NAMES NO LABEL AND NO SIGNATURE, AND MEASURING IS WHY.** The
obvious key is `identitySignature: "project:Kanban"`, and it is WRONG here:
```
project: signatures on poms grid   4
  Project: {ProjectName}   kanban + scope   signed
  Paul's Clown Website     kanban + scope   signed
  Via Fluere               NOTHING          <- cloned by the CLIENT, long ago
```
A signature selector reads clean and **silently skips a real project**. Matching
the label `"Kanban"` is the other trap — one rename from wrong, and this file
records a migration that moved a real page because a copied marker looked
authoritative. So a kanban is identified by WHAT IT IS: a board container whose
child containers' labels are the **Status field's own option set**, read off the
field rather than restated. A/B'd — the signature selector fails exactly the
unsigned case.

---

**THE SCOPE WAS A DOCUMENT PRETENDING TO HAVE STRUCTURE (`0280`).** One
`role:"textblock"` occurrence carrying eleven nodes: an H1, then five H2 headings
each followed by its body. The sections were HEADINGS, so **nothing could address
one** — not reorder it, style it, filter it, embed it elsewhere or give it a
field. They are `doc container -> doc container -> textblock` now, the shape
`Journal -> Daily Question -> the answer textblock` already uses.

**NO TEXT IS LOST AND THE MIGRATION PROVES IT BEFORE IT WRITES.** Every character
of non-heading prose must reappear in some section body, or that scope is
REPORTED AND SKIPPED rather than converted — this is the user's own writing, and
a migration does not get to tidy it. The H2 text moves into the container LABEL,
so the words survive as identity rather than as prose; the guard is written to
know that, or it would refuse every scope on the grid. **A title is dropped only
when the preamble is nothing but headings** — anything else above the first
section is carried into it WHOLE rather than guessed at, and my own test asserted
the clever behaviour before the conservative one. The code was right.

**Read back out of Mongo:** Via Fluere's 392 characters verbatim in its Overview
textblock, 15 section containers each holding its own textblock, both forced
re-runs report *"already converged"*, poms grid **0 errors**.

**AND IT IS VERIFIED BY RENDERING, on prod, with the template as the control:**
```
6 columns · distinctY 1 · distinctX 6      <- ACROSS, not stacked
flex-direction row · flex-wrap nowrap      <- the "no wrap" ask
overflow-x auto · scrollWidth 1816 > clientWidth 1359   <- the scroll is real
every column 260 wide · 420 tall           <- fixed width AND height
order: Project Scope @36 · Kanban @620     <- swapped
0 dead embeds · 0 page errors
TEMPLATE still shows {ProjectScope} unreplaced          <- the control
```
Screenshotted (`screenshots/2026-08-28-project-kanban.png`) — a layout claim is a
visual claim.

**A GUARD CAUGHT MY OWN TYPO BEFORE IT WROTE ANYTHING:** `touches = ["occurrance"]`
was rejected by `backupGrid` with *"unknown collection(s)"*. That check exists
because a typo there would capture NOTHING and still write a manifest that looks
like a backup (2026-08-25 (2)); it earned its keep on the first apply.

Seed and migrations are twins written in one pass — `PROJECT_KANBAN_LAYOUT` and
`scopeSectionKey` are EXPORTED and read by both, so a fresh grid and a migrated
one cannot drift on the shape or on the signatures merge matches on. 3,519 client
+ 2,020 server tests, every guard A/B'd, lint 0 errors, build clean at the
documented chunk sizes, deployed, prod HEAD verified, the new CSS rule present in
the SERVED stylesheet with the wrap rule as the positive control.

**REPORTED, NOT FIXED — and it is the item (5) left open, now measured.**
*"Nobody has dragged a card between columns."* Doing so writes **nothing**:
```
ops that mention Status        2   Project: Status Router · Sync To Todo List
their trigger                  onChange · field · Status   (BOTH)
ops triggering on a MOVE       1   Schedule: Clear Date on Move-Out
```
A drag emits `OccurrenceMoveOp`; **no op listens for one on a kanban card**, so
dragging a card to another column moves it on screen and leaves `Status` stale.
The board and the field then disagree, and the Router yanks the card back to the
column its Status names the first time anything touches it — which is what
2026-08-28 (4)'s *"0 status/column mismatches"* control was quietly protecting.
The precedent for the fix already exists (`makeStampDateTimeSlotOp` stamps a
field from `$trigger.containerLabel` on a drop into a schedule slot); it wants
its own pass rather than the tail of a long session. **The 12 live cards are all
consistent today** — measured, not assumed.

---

### 2026-08-28 (5) — I OPENED IT, and the trello board had NEVER rendered its columns

Continued (4) by closing its own honest gap: *"nobody has clicked a card in a
browser."* Opening it found two defects, and **the DATA was correct in every
check anyone would run for both of them.**

**FIRST, MY OWN PROBE WAS WRONG THREE TIMES, and the tell is the documented one.**
`?previewOcc=` read `painted=false containers=0` on all three project pages —
including the one whose data was demonstrably fine and the TEMPLATE. *Three arms
zero is the both-arms-zero tell.* `PagePreviewApp` says so in its own second line:
**"Reads state from `window.parent.__moduli_state__` (same origin) — no socket
needed."** It only works INSIDE AN IFRAME whose parent is the loaded grid; opened
top-level there is no parent state, so it renders nothing. The working probe loads
the grid, then injects an iframe at `/?previewOcc=<id>` and reads inside it.

---

**DEFECT 1 — A CLONED PAGE EMBEDDED THE TEMPLATE'S CHILDREN (`0277`).** A
`page/doc` renders its TEXTMAP, not its `occurrences[]`:
```
"Project: {ProjectName}"   children Kanban(4v_m43IA) Scope(hZG80mJ-)
                           embeds   Kanban(4v_m43IA) Scope(hZG80mJ-)   ok
"Project: Via Fluere"      children Kanban(5951c745) Scope(d501a168)
                           embeds   Kanban(5951c745) Scope(d501a168)   ok
"Project: Paul's Clown…"   children Kanban(fcfb85e1) Scope(1acf5093)
                           embeds   Kanban(4v_m43IA) Scope(hZG80mJ-)   <- THE TEMPLATE'S
```
`cloneSubtree` regenerates the child list with fresh ids and carried the textmap
over verbatim.

**THE ROOT CAUSE IS A DRIFTED TWIN, AND IT IS NOT MINE.** The CLIENT's
APPLY_TEMPLATE has carried `remapEmbeddedRefs` since it was written, with a
comment stating the consequence exactly — *"else it still references the
template's textblock (renders the original or nothing)"*. The SERVER's
`cloneSubtree` never had it. So **everything that clones through the server** —
`apply_template`, `clone_subtree_as_template`, `save_over_template`, the v1 API
route and every cloning migration — has been producing pages whose embeds name
the SOURCE's children. `Via Fluere` is intact only because the CLIENT cloned it,
long ago. *Two implementations of one decision, and only one of them was ever
fixed — the class this file records repeatedly, found here from the render side.*

**THE REPAIR IS POSITIONAL AND MUST NOT BE A SWEEP.** "Embeds something that is
not its child" is a LEGITIMATE, common shape: 2026-08-23 (2) measured **474
embeds across 233 hosts reachable only through a textmap**. So it fires only on an
occurrence carrying `meta.appliedFromTemplateId`, and REFUSES when the two child
lists differ in length, because then position is not identity. Scope: **45 clones
carry a textmap, exactly 1 was broken.**

---

**DEFECT 2 — THE TRELLO BOARD HAS NEVER RENDERED ITS COLUMNS (`0278`).** With the
embeds fixed all three pages painted — and the Kanban drew EMPTY, offering
"Add new item", on the template, on the pre-existing project and on the new clone
alike. **`ModuleContainer` draws child CONTAINERS only when the module carries
`meta.allowChildContainers`, and the six kanban columns ARE containers.** The flag
has never been on the Kanban module. The board this whole feature is named for has
been blank since `buildProjectTemplate` was written; nobody noticed because nobody
had a project with tasks in it to look at.

This is the defect that read as *"you got rid of my trackers"* on 2026-07-31 (2),
where the tiles were correctly parented and simply did not draw.

**THE SCOPE IS STRUCTURAL AND THE CONTROL IS WHAT MAKES IT SAFE.** Containers that
HOLD container children:
```
board, WITH the flag       22      <- the healthy shape, 22 times over
board, WITHOUT             3       <- all three are "Kanban"
doc,   WITH               127
doc,   WITHOUT             89      <- correctly untouched
```
**The 89 doc containers are excluded on purpose, and that is the whole safety of
the migration:** a `kind:"doc"` container renders its TEXTMAP, so the flag is
meaningless there and setting it would change how 89 live containers behave to fix
a problem they do not have. The rule names no module and no label. The SEED is
fixed in the same commit, so a fresh grid is born right.

---

**VERIFIED BY RENDERING, on prod, with a control that had to fail differently:**
```
Via Fluere   painted 7 containers · 6 rows · 0 dead embeds · 0 page errors
Paul's       painted 7 containers · 8 rows · 0 dead embeds · 0 page errors
TEMPLATE     painted 7 containers · 1 row  · six EMPTY columns   <- the control
```
Each page shows its OWN scope prose; **the template still shows `{ProjectScope}`
unreplaced**, which is what makes the token replacement a measurement rather than
an assertion.

**A MUTATION THAT SILENTLY DID NOT LAND, and it was the guard that mattered
most.** A/B-ing `0278`, the arm removing the board-only scope reported
`8 passed` — reading as "the doc-container exclusion is untested". The Python
replacement had a broken escape and never applied. Re-run with an `assert` that
the mutation landed, it fails exactly its own test. *This file already says to
check that the mutation landed before believing an A/B; I paid for it again, and
the cheap remedy is to make the mutation script ASSERT rather than eyeball it.*

**AND `0274` REPORTED A REWRITE ON EVERY RUN** until `shapeOf` stripped generated
step ids — the builders mint a fresh `uid()` per step, so a raw JSON compare can
never match and the migration would churn every step id forever.

16 + 8 tests, every guard A/B'd. 3,513 client + 2,000 server tests. Deployed, prod
HEAD verified, site 200 after the documented restart window (index 502 + bundle
200 is that tell, not an outage), poms grid **0 errors**.

**REPORTED, NOT FIXED:** in the PREVIEW the `Project` field renders a raw
occurrence id, because `readableValue` resolves it straight out of
`occurrencesById` and the preview scopes its state to the page's own subtree —
the Projects BOARD row lives outside it. The full app holds every occurrence, so
it resolves there; **that has not been watched on the real page.** And nobody has
dragged a card between columns with a mouse: the ops are proven through the real
executor over live data, and the columns are proven to paint, but the gesture
itself is still unexercised.

---

### 2026-08-28 (4) — TWO PROJECTS, and every op behind the trello board was UNREACHABLE

Picked up the other account's session, which hit its limit at 11:42 one command
into the Projects measurement. Its three shipped items (`0273`, the field-reorder
arrows, the wheel-scroll multiplier) were already deployed; the queued ask was
not started. User: *"set up a plan to use the Project template and make a project
for Pauls Clown Website and Via Fluere. make sure to include the ops and adding
the tasks to schedule (set up starter tasks). we have a trello board in the
template"* -> *"they should go in a Projects folder"* -> *"in root"*.

**MEASURING THE OPS FIRST TURNED "WIRE UP TWO PROJECTS" INTO "THE WIRING IS
DEAD", TWICE OVER — and neither defect is visible from reading a pipeline.**

**`Project: Create` HAS BEEN INERT SINCE 2026-08-03, and the data says so
exactly.** It resolved its template with
`FIND $allOccurrences where meta.templateName IS "Project Page"`:
```
occurrences carrying meta.templateName == "Project Page"   0
occurrences carrying ANY meta.templateName                 6   <- all "Day Page", stale day columns
the template root FZ-uqepntDle carries instead             meta.templateModule: true
```
`0035` **unset** `meta.templateName` on template roots. So the FIND bound
nothing, the guard failed, APPLY_TEMPLATE never ran — and the op is `onLoad`, so
it fired on every page load for 25 days and emitted nothing. **A FRESH SEED WAS
FINE**, because `buildProjectTemplate` still writes the key: only a MIGRATED grid
was broken. That is the `0043` / `0064` class exactly — a key one side retired
and the other kept writing.

**The remedy was already written one op over.** `makeDayPageBuildOp` THROWS
without `dayPageTemplateOccId`, with a comment saying a `meta.templateName` lookup
matches every CLONE (APPLY_TEMPLATE copies meta) and a multi-match FIND binds an
ARRAY that APPLY_TEMPLATE cannot use. `Project: Create` never got the treatment.
It is picker-direct now. **Its onLoad arm goes with it, and that is not
cosmetic:** it stamped a hardcoded `Moduli v1 Launch`, so fixing the lookup ALONE
would wake a 25-day-dormant op that MINTS A PAGE on the next load. It converged
only because of the label-collision guard below it — luck, not design.

**AND NOTHING BOUND `Status`, SO BOTH ROUTING OPS WERE UNREACHABLE.**
```
modules binding Status (OWQdY4aV7o5v)   0
```
`Project: Status Router` and `Project: Sync To Todo List` both trigger on
`onChange · field · Status`. No occurrence could carry it, so **neither had ever
fired.** The kanban was six containers you could drag between with nothing behind
them.

**THREE DECISIONS WERE THE USER'S, asked before anything was written**, because
each produces materially different data: Via Fluere **RENAMES** the existing
`Moduli v1 Launch` rather than minting a second overlapping project; the Todo
mirror gets **one container per project**; `Work on Paul's website` is
**copy-linked** into the kanban.

**THE RENAME IS SAFE BECAUSE IT WAS MEASURED — all six of its kanban columns were
EMPTY**, and the migration REFUSES if any column holds a task. Labels live on the
MODULES here (`occurrence.label` is null on both the page and the board row), so
it is two module labels plus the scope textmap, not an occurrence write.

**THE MIRROR CONTAINER IS KEYED, NOT LABELLED.** `Sync To Todo List` finds a
task's Tasks-page container by that container's own `Project` VALUE — not its
label (one rename from wrong) and not a per-project id baked into the pipeline
(which needs editing for every new project, the "eighth caller forgets" trap). It
FAILS OPEN to `Occupational`, the old hardcoded destination, because dropping a
mirror reads as the sync silently breaking.

**AND `Sync To Todo List` WAS EXTRACTED FROM THE SEED INTO A BUILDER.** It lived
INLINE in `createLiveData`, which is exactly how a stored pipeline and its author
drift; a migration could not share it. `makeProjectSyncToTodoOp` now, so the seed
and the migration regenerate from one source.

**NO STARTER TASK IS STAMPED WITH A `Date` VALUE.** The grid filters on `Date`, so
a row carrying one is visible on exactly one day of the year — the
1,467-invisible-bookmarks defect of 2026-08-23 (3), and a project board is
precisely where it would go unnoticed. The FIELD is bound (so a task dragged onto
the schedule behaves like every other task); the VALUE is absent. **A `Due` is
what puts a task on the schedule** — `Place Dated Work` phase 2 already does it,
and no new mechanism was invented.

---

**THEN THE OPS WERE DRIVEN THROUGH THE REAL EXECUTOR FOR THE FIRST TIME IN THEIR
LIVES, AND TWO OF THE THREE THINGS `Sync To Todo List` CLAIMS TO DO DID NOT
HAPPEN.** The mirror minted into the FALLBACK container although its project's
own container existed, and it was never deleted when Status advanced.

**A FIND RULE'S `left` IS A RECORD PATH, NOT AN EXPRESSION.** Isolated with a
three-arm probe over live data, only the rule set changing:
```
A  [_ancestors HAS_ANCESTOR <tasks>, fields.<proj>.value IS $projKey]      MATCHED
B  A + [$projKey IS_NOT_EMPTY]                                             NO MATCH
C  [fields.<proj>.value IS "<literal>", _ancestors HAS_ANCESTOR <tasks>]   MATCHED
```
B is A plus one guard rule. `$projKey` on the LEFT looks for a record key
literally named `$projKey`, finds none, and `IS_NOT_EMPTY` is false for every
candidate — **so the whole FIND matches nothing.** A `$var` on the RIGHT resolves
fine, which is what makes this so easy to write: the same var two rules apart
behaves completely differently.

**ONE OF THE TWO WAS PRE-EXISTING, in the seed from the day it was written** — the
`$lgId` guard, which is why the mirror was never found and never deleted.
**Nobody knew because the op could not fire.** *A pipeline that has never run is
not a pipeline that works; it is one nobody has checked.* The guards are real —
without `$lgId IS_NOT_EMPTY`, `linkedGroupId IS $lgId` with a null `$lgId` matches
every unlinked occurrence on the grid — so each MOVED into an `if`, where `left`
IS evaluated against `$vars`. **`0276` is a second migration rather than an edit
to `0274`, because `0274` has executed and a ledger entry has to describe what
ran; it delegates to `0274`'s own `up`.**

**A CLASS GUARD SHIPPED WITH IT:** a test walks both builders' pipelines and fails
on any `$var` sitting on a FIND rule's `left`, **with a control proving the walker
finds a planted one** (and two proving it does NOT flag a `$var` on the RIGHT, or
on an IF condition, where it belongs).

**READ BACK OUT OF MONGO rather than off the log:**
```
2 project pages · 6 columns each · 12 tasks · 12 binding Status (was 0)
0 tasks carrying a Date value        <- the control that matters
0 status/column mismatches           <- a mismatch is a card the Router moves on first touch
the copy-linked pair: one module, one linkedGroupId, both at Docket
the TEMPLATE untouched — 0 tasks, still carrying its {ProjectName} token
0 occurrences still labelled "Moduli v1 Launch"
```

**THE REHEARSAL FOUND TWO LEFTOVERS NO TEST WOULD HAVE.** Applied for real
against `test grid 2` and read back: the renamed page still carried
`meta.templateModule` — so a LIVE project read as a template root, which is what
`gridIntegrity` keys on — and its poster ARTIFACT was still labelled
`Moduli v1 Launch`. Both fixed, and the poster is found through the row's own
media BINDING rather than by matching the old NAME, which would also hit anything
else called that. *A dry run prints what it intends; only the applied state shows
what it left behind.*

**AND `0274` REPORTED A REWRITE ON EVERY RUN until `shapeOf` stripped generated
step ids** — the builders mint a fresh `uid()` per step, so a raw JSON compare can
never match and the migration would churn every step id forever. Stripping ids is
what makes *"already converged"* mean something.

**TWO FIXTURE TESTS WENT RED ON THE REFRESH AND WERE NOT MINE — proven, not
asserted.** Re-exporting the fixture (mandatory after any migration that rewrites
an op) turned `mealTrackers` and `routineLayerMerge` red. The discriminator:
**0 of the 92 rows under the day column carry `Status`**, so nothing these
migrations wrote is in there. Both premises were calendar-dependent —
`mealTrackers` required SEVERAL meals on *today's* column (today has one) and
`routineLayerMerge` required exactly **7** merged rows (`auto:` is `signatureOf`'s
FALLBACK, stamped on ANY unsigned merged node, so the count grows with every
layer — it read 23). Both now measure the durable fact instead: meals span more
than one module GRID-WIDE, and the sweep puts back what you strip. **My first
rewrite of the meal fact was wrong too** — I asserted one module per row and
measured **29 rows over 3 modules**, because `pickReusableModuleId` reuses a
clone's module. That is the third time this file has paid the 2026-08-20 (6)
lesson: *any assertion whose premise is one day of one grid is a coin flip on
export timing.*

10 behavioural tests driving both ops over the live grid's own pipelines, **A/B'd:
restoring the `$var` guards fails exactly the 2 mirror tests.** 32 + 22 unit
tests, every guard A/B'd. 3,513 client + 1,976 server tests, lint clean, build
clean **with every chunk hash unchanged — no client source moved, so no bundle
was owed**; the deploy was for the pm2 restart, since the warm cache is
authoritative for reads and would otherwise re-serve the old pipelines. Prod HEAD
verified, served chunks sha256-identical, poms grid **0 errors** with the one
documented `unused-field` warning.

**A PROBE OF MINE REPORTED A DEFECT THAT WAS NOT THERE, and it is the usual
shape:** the mirror test read `u.parentId` / `u.occurrence.parentId`, but
`COPY_LINK` emits `CREATE_ITEM` whose home is on **`instance.parentId`**. It
reported an empty set, which looks exactly like *"the mirror never landed"*. The
fix carries a control asserting some `CREATE_ITEM` carried a parent at all.

**REPORTED, NOT FIXED:** the starter tasks are placeholders — the user asked for
starters, not their real backlog. And the fixture is now **1.9 MB brotli** (21,089
occurrences, up from 292 KB / 3,280 when it was introduced); it is committed, but
it is worth deciding whether a fixture that grows with the grid is still the right
artifact.

---

### 2026-08-28 (3) — TWELVE TASKS A PROBE TICKED, and the page was never broken

Picked up the other account's session, which hit its limit at 10:22 one grep
into *"did you ever find those tasks, they still arent showing up for me"*. Its
inherited diagnosis was that the DATE filter hid them — 22 shown, 11 hidden.
**The screen said otherwise, and that disagreement is what solved it.**

**THE HARNESS AND THE BROWSER DISAGREED, AND SOCIAL IS THE DISCRIMINATOR.** The
inherited measurement drove the real `isOccurrenceVisible` over a dump and read
`Physical 3 shown`, `Social 5 shown`. The user's screenshot shows **Physical 1**
and Social starting at its THIRD child. The date filter cannot produce that:
every Social row carries no `Date` at all, so it passes for all five. What is
skipped is exactly the two completed rows above `Text Terrell`.
*Driving the selectors proves what the selectors do; the DOM is what the user
has.*

**THE PAGE IS WORKING AS AUTHORED, and establishing that FIRST is what stopped
this becoming a hunt through the filter cascade.** Every dimension container
carries its own local filter:
```
hide-completed-43e3jgcueai   active:true  hides:true
  rule  $occ.fields.tZWiPDQUDP74.value IS_NOT true      (tZWiPDQUDP74 = "Completed")
```
and `Completed` is a feed on `Completed IS true`, holding 15 feed copies. So a
ticked task LEAVES its dimension by design. **Measured across every backup, not
assumed: those filters have been on all ten containers since 2026-08-22.**

**THE DEFECT IS THAT TWELVE OF THEM WERE NEVER TICKED BY THE USER, and the
backups date it to the minute:**
```
every snapshot 08-25 .. 08-27T15:59Z    21 rows in page,  3 dimension tasks complete
08-28T01:25Z snapshot                   33 rows in page, 15 dimension tasks complete
```
All twelve flips land between **17:28Z and 19:13Z on 2026-08-27** — inside the
probe session recorded two entries below, which hit its limit at 19:04Z. **That
entry's own debris sweep found and restored `Text Terrell` (19:02Z) and
`Text Shelly` (19:09Z) — THE LAST TWO ROWS IT TOUCHED.** The dozen ticked
earlier in the same session were never audited. Two independent probe signatures
confirm the shape: `Text Shelly` toggled **eight times at ~2-minute intervals**
that evening, `Organize files` the same way on 08-22 and 08-23.

*A probe that edits is a probe that can damage — and a debris sweep that only
checks the rows you remember touching is a sweep of your memory, not of the grid.*

**`actionId` LOOKS LIKE THE DISCRIMINATOR AND IS NOT, which cost a pass.** A
user gesture mints an action id and a derived write does not (`derived =
!actionId`), so `actionId: null` reads as *"an op did this"*. But these are
**MeasureOps, and a MeasureOp carries no `actionId` at all** — the null is a
property of the RECORD TYPE. Every flip on the grid reads null, the user's own
included. *A field that is constant across both arms cannot separate them* —
the same shape as the `createdAt` probe that could not work (2026-08-27 (4)).

**THREE INDEPENDENT CONDITIONS GATE EVERY RESTORE (`0273`), and any row failing
one is KEPT and REPORTED:** the pre-damage snapshot says the row was not
complete, the row is complete NOW, and `fieldUpdatedAt[Completed]` falls inside
the window. **The third is the one that matters** — it protects a task the user
has genuinely ticked SINCE, whose value would otherwise look identical to the
damage. Deleting a real completion to tidy a report is the damage, not the fix.

**IT RESTORES RATHER THAN CLEARS.** An absent key is `$unset`; a stored `false`
is written back as `false`. Clearing both alike would erase the difference
between *never touched* and *explicitly un-ticked*, which is a live distinction
here — `Text Shelly` carries a deliberate `false` from the previous sweep.

**ONE ROW THE SNAPSHOT MISSES BY SIX MINUTES, and the guard correctly refused to
guess.** `Appointment with Physical Therapist` was created at 16:05:01Z, after
the 15:59:02Z snapshot, so the snapshot has nothing to say about it. The pruned
transaction log states its prior value outright:
```
17:09:24Z  Date, Location, Type, Time Slot, 60m set    — no Completed
17:32:58Z  tZWiPDQUDP74 = true   prev=undefined        <- the tick
17:34:03Z  "Completed On" = 2026-08-27                 <- the op's stamp
```
So it gets an **explicitly-cited exception rather than the guard being loosened
for everything** — a strict guard with one documented exception is auditable, a
widened one is not, and three tests pin that the exception bypasses NEITHER of
the other two guards. (Its `Date` is 2026-08-28: marked complete the day BEFORE
the appointment, which is its own tell.)

**THE FEED COPIES NEED NO PASS OF THEIR OWN.** `Completed` is a materialized
feed and `feedSync` is a scan-based self-healing diff, so a copy whose source
stops matching is swept on the next client load. Minting a removal here would
fight the engine that already owns it — the 2026-08-13 lesson about pushing into
a feed's `occurrences[]`.

**Read back out of Mongo rather than off the log:**
```
                 before -> after (visible)
Physical            1  ->  4      Emotional   0 -> 3     Social  2 -> 5
Environmental       0  ->  2      Paul's Web  0 -> 1
33 rows in the page, unchanged · 0 rows carrying a `Completed On` with no `Completed`
KEPT: Talk to Angela · Psych appointment · Sign up for foodstamps  (complete BEFORE the window)
```
A forced re-run reports *"already converged"*. 16 tests, **each guard A/B'd —
the window guard fails exactly 3, already-complete 2, snapshot-absent 1**, and
the CONTROL (a mixed set of probe rows, a since-ticked row, an already-complete
row and an untouched one) separates cleanly. 1,922 server tests, poms grid **0
errors** with the one documented `unused-field` warning, pm2 restarted.

**THE QUEUED GRAPH ITEM ONE ENTRY BELOW IS BUILT, and that note is now stale.**
`0e583eca` gave `ModuleContainer`'s header dropdown the same `MenuTabs`
structure the page already had (Filter / Sort / Data / Fields / Layout) and
moved `GraphSection` out of it into the graph occurrence's own settings sheet
(`ContainerForm`, a 4th "Chart" tab gated on `kind === "graph"`), at the user's
instruction. Deployed and prod HEAD verified this session.

**No client code changed here, so no bundle is owed** — `git diff --name-only`
against prod HEAD is two server paths (the 2026-08-13 (3) rule). The **pm2
restart is still owed and was done**, because the warm cache is authoritative
for reads and would otherwise re-serve the ticked rows.

---

### 2026-08-28 (2) — "NONE OF MY DOCUMENTS ARE SHOWING UP": a folder with no CARD is invisible

User, on the live grid. Nothing was lost — and the shape of the report is what
named it: *"they show up just not on folder page."*

**A SUB-FOLDER RENDERS ONLY IF IT CONTAINS A CARD.** That card is a
`role:"page" kind:"folder"` occurrence parented to the sub-folder. The sidebar
reads `foldersById` DIRECTLY, so the tree shows every folder while the page shows
only carded ones. **That asymmetry is the entire reason this reads as data loss**,
and the user's own correction proves it: *"Documents dont have empty folders
though Notes and Codex both should be full."* They are —
```
Notes  8 doc pages        Codex  37 board pages + 8 sub-folders
Media  5 board pages      Codex's children: 3, 13, 2, 4, 5, 7, 2, 2
```
`0272` minted the 15 missing cards: **52 non-category folders, 37 carded -> 52**,
`Documents` 0 -> 2, `Codex` 0 -> 8, `Interests` 11 of 11. **The control that
matters is 0 folders carrying MORE than one card** — two cards make each render
the OTHER as a sub-folder, the infinite drill-down of 2026-08-25.

**AND THE PREDICATE IS THE RENDERER'S, NOT THE MINT HELPER'S.**
`ensureFolderPageOcc` identifies a card by `meta.folderPage === true`; the
renderer identifies it by the MODULE's kind+role. Minting off the helper's test
would DUPLICATE a card for any folder whose occurrence lacks the flag — a test
pins that an unflagged occurrence still counts.

**THEN THE USER ASKED FOR THE CAUSE, NOT THE DATA — and they were right.** The
client mints a card on view, but only for the DIRECT children of the folder on
screen, so a grandchild stays card-less and its parent's PREVIEW renders empty:
*"empty folders inside of another folder requires me to open up the parent folder
to see those in the preview."* **Fixed at the CHOKEPOINT — the server's
`create_folder` — because there are SEVEN client call sites plus the assistant's
`create_folder` tool**, and adding a mint to each is the "the eighth caller
forgets" trap this file keeps paying for. That handler already stamps
`userId`/`gridId` for exactly that reason (2026-08-18). A folder created by a
MIGRATION bypasses the socket, which is why the mint-on-view stays as the net.

**`io` IS NOT IN SCOPE IN `crud.js`** — my first draft used `io.to(...)` and
would have thrown a ReferenceError at runtime, the class this file records twice
(`watchRegion`, `ctxGrid`). Caught by reading what `registerCrudHandlers`
destructures instead of assuming. **Both emits are needed**: `socket.to(room)`
EXCLUDES the sender, so without a self-emit the tab that made the folder never
learns about its card — the same exclusion behind the 2026-08-07 navigation bug.

**THE UNOPENABLE, UNDELETABLE ROW.** *"theres a random Untitled.md inside of
Documents that I cant open or delete … i clicked the add new on the manifests
tiles."* `FolderNode`'s "+" minted `role:"container" kind:"artifact"`, and
**nothing can open that** — `ensureArtifactPageOcc` owns the drill-in and gates on
`role === "artifact"`, so the click fell through in silence. The shape was STALE,
not chosen: `migrateArtifactRole.js` moved artifacts off container roles long ago
and this call site was never updated. The data says it was unique:
```
inside folders:  artifact/image 336 · page/board 131 · page/folder 52 · page/doc 15
                 container/artifact 1     <- the row that button had just made
```
**So the "+" ASKS now instead of guessing** (user: *"that should open up the quick
add menu"*) — `QuickAddMenu` with `targetRole="page"`, which is already the right
palette for a folder. A button that does not pick a shape cannot pick a wrong one.
And `PreviewNode`'s context menu gains a confirmed **Delete**, routed through
`CommitHelpers.deleteOccurrence` so it cascades and unlinks from the parent's
`occurrences[]` — skipping that is the dangling-ref class swept five times here.

**"IM MISSING MOST OF MY TASKS TOO" — NOTHING WAS DELETED, and the pre-migration
snapshot is what settles it rather than my own reasoning.** Diffed live against
this morning's 01:25 snapshot:
```
TASKS PAGE   before 33   now 33     Physical 4->4 · Emotional 5->5 · Social 5->5
                                    Financial 1->1 · Completed 15->15
```
Identical, container by container. The 148 occurrences deleted since then are
**yesterday's day column and its 49 timeslots** — the daily rebuild, which is the
design (2026-08-07: *"the op deletes the previous day column and rebuilds it"*).
**Where they are missing FROM is still unanswered**, and the two candidates need
different fixes, so it is not guessed at here.

**QUEUED, at the user's instruction:** *"configuring the graph should not live in
filters, it should go in the graph occurances settings."* Diagnosed but NOT built.
`ModulePage` already separates these into `MenuTabs` (Filter / Sort / **Data** /
Fields / Layout) with `GraphSection` under Data — but `ModuleContainer`, and a
graph IS a container, renders every section in one flat `HeaderDropdown` opened
from `HeaderChevron`, the FILTER chevron (`ModuleContainer.jsx:1453`). That is why
it reads as living in filters. The fix is to give the container the same tabbed
structure the page already has; `MenuTabs` is imported by ModulePage today and
would need importing there.

3,448 client + 1,906 server tests, 0 lint errors on every edited file, build clean.
Four deploys, prod HEAD verified each time, and **prod's error log has not been
written since 2026-08-26** — no server error from any of them.

---

### 2026-08-28 — "FIX ALL THE BUGS": the Todo list had been invisible for ten days, and two red tests were never a defect

Inventory first, because "all the bugs" is not a list until it is measured:
`checkGrid --all`, both suites, and the standing open items.

**THE LIVE ONE: THE USER'S TODO LIST WAS HIDDEN ON EVERY DAY BUT AUG 18.**
`gridIntegrity`'s `dated-copy-link-source` rule — added alongside `0145` so a
recurrence would be LOUD rather than silently costing somebody a morning —
fired again ten days later:
```
SOURCE LnLC5V1KIMt_ "Todo" (container/board) in "Schedule: Layout"
  Date = 2026-08-18                <- the grid FILTERS on Date
  6 copies, and ALL SIX inherited it
```
**THE CONTROL IS WHAT MAKES IT UNAMBIGUOUS:** of the source's 48 siblings under
the same slot template, **48 carry no date and exactly one does.** The healthy
shape is no date at all — which is why the remedy is to CLEAR rather than
re-stamp with something better; stamping works today and goes stale tomorrow,
the trade 2026-08-11 (2) already refused.

**WHY `0145` DID NOT COVER IT, and it is a general shape.** `0145` clears the
SOURCE, so the next copy is not born wrong. The copies that already exist were
`0144`'s job — and `0144` was written against ONE specific day's column. **The
pair only ever repaired one day.** `0271` does both in one pass, which is the
rule 2026-07-30 (2) states outright: *"repair the masters and the copies in the
same pass, or rebuild the copies."*

**THE DISCRIMINATOR IS THE WHOLE DESIGN:** a copy is cleared ONLY when its value
EQUALS its source's — that is what "inherited" means. A copy whose value differs
was set deliberately, and is KEPT and REPORTED. Without it this migration is data
loss; the A/B removing it fails exactly that test. Read back out of Mongo: 0 of 7
still dated, **Time Slot identity marker intact on all 7** (Build Schedule, Alarm
and Pomodoro: Start all FIND by it), 571 -> 564 dated occurrences — exactly the 7
cleared, no collateral.

**THE TWO RED TESTS WERE NEVER A DEFECT, and thirteen sessions carried them as
"pre-existing".** `trackerFollowsPageFilter` went red when the fixture was
refreshed on 2026-08-25. Measured on the fixture's own day column:
```
column 2026-08-24 · 49 children · 87 rows in the subtree
Eat rows 8 · Eat rows COMPLETED 0 · anything completed at all 1

Meal Nutrition                       4 writes, every value onDay=0 offDay=0
Nutrition: Today's Micronutrients   16 writes, every value onDay=0 offDay=0
```
**Both trackers summed ZERO on the built day and zero on the empty day** — nothing
can move from 0 to 0, so "does it follow the filter" was unanswerable. The
exporter simply ran on a day the user had ticked nothing; the Eat rows already
carry their macros. **And both failures were `moved: 0`, not `wrote: 0`** — reading
the ASSERTION that failed rather than the test's name is what solved it, after I
first went looking for a renamed or disabled op.

That is 2026-08-20 (6) inverted (*"any test whose premise is 'this column starts
empty' is a coin flip on export timing"*), and it takes the same remedy: **the
harness now constructs the condition it measures** — it ticks the built day's Eat
rows itself, at BOTH dates so the only difference between the sweeps is still the
filter, with a **new control asserting the tick landed**. A setup that silently
matched nothing would put every assertion straight back at the mercy of the
exporter's clock. A/B'd: breaking the matcher fails 3 — the control AND both
tracker tests.

**3,448 client tests, 285 files, 0 failures — the first fully green client run
since 2026-08-25.** 1,874 server tests.

**WHAT WAS DELIBERATELY NOT "FIXED", each with its reason.** `sweepOrphans`
REFUSED test grid 2's 3 module-less occurrences — *"has field values, a parent
lists it"* — which is the guard working, not a failure; a reseed is the user's
call on the seed's own target grid. test grid 1's 6 unsigned template nodes are
the frozen ARCHIVE, left alone on purpose since 2026-07-31 (4). The 34
`unused-field` warnings are the deliberate palette fields. **poms grid ends at
0 errors.**

**AND THE TRANSACTION LOG IS BOUNDED AT LAST** (user: *"we should prune those
after a certain period"* / *"do it after a week"*). It was **87.7 MB — twice the
size of the grid** — because `pruneLater` keys on `sequence`, which only the
snapshot rows carry; `MeasureOp` has none, so the prune could never see them.

**A WINDOW ALONE DOES NOT BOUND IT, and the distribution is what said so:**
```
older than  1 day   22,547     <- 8,738 rows landed in ONE day
older than  3 days   4,986     <- 17,561 of them are 1-3 days old
older than  7 days   3,373
older than 30 days       0     <- a 30-day window would prune NOTHING
```
The long-run rate is ~746/day; an ACTIVE day is 8,000-22,000. So there are two
limits and the tighter wins: a **7-day window** (the retention promise) and a
**1,000-row per-grid cap** (which bounds a burst the window will not touch for a
week). My first attempt shipped the window alone and pruned 324 rows — the user
said *"thats too little to prune"*, and they were right.

**THE PREDICATE IS "THE UNDO STACK CAN NEVER USE THIS" — no `docs` — not
`type: "MeasureOp"`.** Keying on the capability covers a future doc-less type
without anyone remembering, and it mirrors `STACK_FILTER`, which a test pins so
the two cannot drift. Safe because nothing computes from them: grepped, the only
readers are the history panel (limit 100) and the undo stack.

**PLUS 6,299 ROWS WHOSE GRID NO LONGER EXISTS** — 6,256 from one dead grid, the
exact figure this file flagged on 2026-08-01 and never actioned. A per-grid prune
can never reach them and nothing can read them.
```
37,840 docs · 87.7 MB  ->  1,814 docs · 5.8 MB
snapshots (undo) still present  800   <- untouched, by construction
poms grid ON THE UNDO STACK       1   <- unchanged
```
**29,471 rows DUMPED before deletion**, and deleted by explicit id from the
dumped list rather than by a "not in this list" query — that shape is one bad
list away from erasing a live grid's trail. **Honest limit: after a heavy day the
1,000-row cap reaches back about five hours; on an ordinary day ~32.**

**EVERY GRID IS AT 0 ERRORS** — the first time this file records that. `0024` was
re-run on test grid 1 (the frozen archive), signing the 8 Project-template nodes
whose unsigned state would have cloned six kanban columns on the next merge; and
test grid 2's 3 module-less occurrences were cleared — module gone, no children,
so nothing could ever render them — **unlinked from their parents BEFORE deletion**,
or the repair would have minted the dangling-child-ref class this file has swept
five times.

**WHAT IS STILL NOT "FIXED", and is not a bug:** The transaction log is **87.7 MB — twice the size
of the grid itself** — and growing without bound:
```
37,840 documents across 49.6 days
  prunable (sequenced / SnapshotOp)     812
  NEVER pruned (unsequenced MeasureOp) 37,028   ~746/day  -> ~272,000/year
```
the 34 `unused-field` warnings on poms grid are the deliberate palette fields
(`Tags` was seeded for the feed field-check), and deleting a user's fields to
quiet a report is the damage, not the fix.

---

### 2026-08-27 (4) — EVERY WRITE `$set` MONGO'S `_id`, AND THE REJECTED WRITE LOST THE EDIT

User: *"chase it"* — the four `update_occurrence` errors in prod's log that the
deploy check turned up. Root-caused, reproduced, fixed, deployed.

**THE STACK NAMED THE LINE AND THE CODE EXPLAINED ITSELF.**
`loadUserIntoCache` stores `{ ...leanDoc, id }` (`server.js:344`) and a lean
document carries `_id`. The write handlers build
`next = { ...cachedDoc, ...clientPayload }` and hand `next` to
`findOneAndUpdate` **as the update** — Mongoose casts a plain object to `$set`,
so **every occurrence and module write was `$set`ting `_id`**:
```
update_occurrence error: MongoServerError: Plan executor error during
findAndModify :: caused by :: Performing an update on the path '_id' would
modify the immutable field '_id'          (code 66, ImmutableField)
  at Socket.<anonymous> (server/socketHandlers/occurrences.js:377)
```
**Inert while the cached `_id` matches, and the moment they diverge Mongo
rejects the ENTIRE write — the user's edit is LOST**, because the handler throws
before the parent `$push` and everything after it. The same class the E11000
fallback three lines below already guards against.

**REPRODUCED IN ISOLATION BEFORE ANYTHING WAS CHANGED**, against a scratch
database that was dropped afterwards — same code and message as prod:
```
dbDoc carries _id  -> ImmutableField (code 66)
_id stripped       -> WROTE OK
```
**And my first repro proved nothing:** it used the raw driver, which rejects a
non-atomic update outright, so BOTH arms failed with the same error. It has to
go through `$set` the way Mongoose does. *An A/B whose arms fail identically is
a broken probe, not a result.*

**TWO HYPOTHESES DIED, AND THE THIRD IS THE KEEPER.** Duplicate documents
sharing one app id: impossible, `id_1` is UNIQUE, 0 duplicates collection-wide.
Undo writing a stale `_id` back through `patchCache`: 400 stored snapshots
examined, **0 carry `_id`** — because **`txRecorder.js:80` already documents this
exact hazard** (*"`_id`/`__v` stripped: `$set: { _id }` on restore is rejected by
Mongo"*) and strips it. *The undo path learned this lesson; the write path never
did.*

**FIXED AT THE ROOT AND ONE LAYER OUT, because they cover different inputs.**
The cache loader no longer stores `_id` — one place, every consumer, cannot be
forgotten by a call site that does not exist yet. The occurrence and module
handlers strip it from the payload too, which the loader fix CANNOT reach: **a
tab opened before this shipped still holds `_id` from its own `full_state` and
echoes it back on every write.** Measured, prod against local on the same data:
```
                  occurrences carrying _id    modules carrying _id
prod, old code        21055 / 21055              7734 / 7734
local, fixed              0 / 21055                 0 / 7734
```
Identical counts, so nothing was dropped — only `_id` went.

**`Grid` IS DELIBERATELY UNTOUCHED, and that is the reason this is not a global
strip:** a grid's identity IS its `_id`, and `update_grid` passes
`{ _id: gridId, ... }` on purpose so an upsert creates the document with that
id. A blanket rule would have broken grid creation.

**THE TRIGGER FOR THE DIVERGENCE IS NOT ESTABLISHED, and the reason is worth
more than the answer would have been.** `id` is unique, so a mismatch means the
document was REPLACED. Chasing that:
- **An ObjectId-vs-`createdAt` gap finds nothing, and the probe CANNOT work** —
  Mongoose stamps `createdAt` on insert, so a re-inserted document gets a fresh
  one and the gap I searched for cannot exist. Wrong instrument, not a clean zero.
- **The `_id` mint histogram DID find something:** exactly **one** document minted
  at `2026-08-26T21:00Z` — the same second as the first failure — a new
  `role:instance` "Visited" under Physical > Nutrition. No mass re-insert
  anywhere, so no restore ran.
- **AND MY OWN "no undos, no deletes in that window" IS RETRACTED.** It read 0
  SnapshotOps and I nearly filed it as evidence. **`pruneLater` keeps only
  `KEEP_PER_GRID = 200` snapshots** and prunes by `sequence` — which only
  SnapshotOps carry — so 2026-08-26's were long gone while all 30,383
  unsequenced MeasureOps survived from July. The count is **exactly 200**, which
  is what named it. *A zero from a capped log is a claim about the cap.*

**TWO FACTS ABOUT THE SYSTEM THAT FELL OUT OF THAT, neither previously written
down: undo can only reach back 200 transactions per grid, and MeasureOps are
never pruned at all** (30,383 and counting, since 2026-07-28).

4 tests driving the REAL handlers, **two of them controls asserting the mock
rejects a CHANGED `_id` and accepts an unchanged one** — without those the tests
pass against the bug. A/B'd: each handler layer fails exactly its own case.
1,874 server tests. Deployed; prod HEAD verified, index + bundles 200, and the
served chunks **sha256-identical to the local build — which is the check that
matters for a SERVER-only change**: the bundle must not move. Confirmed live on
prod afterwards: 21,055 occurrences and 7,734 modules, **0 carrying `_id`**, 647
rows, 0 page errors.

---

### 2026-08-27 (3) — UNDO WAS BROKEN A SECOND WAY: every page LOAD pushed 26 steps

Picked up the other account's session, which hit its limit **one command before
its live proof**. Its diagnosis, its tests and its A/B were intact; what was
missing was the measurement — and taking it found a bigger defect than the one
it was written for.

**THE INHERITED FIX IS SOUND AND ITS LIVE READING IS A CONTROL, NOT A WIN.**
`closeAction` debounces 250ms and `flushAction` then DELETES the buffer, so the
next write carrying the same action id became a SECOND transaction. A flush for
an action that already produced one now MERGES into it. Measured same build,
same page, the merge stashed out and back, one tick through the real UI:
```
                              merge OFF     merge ON
distinct action ids               1            1
transactions on the undo stack    1            1
contains the toggled row        YES          YES
Ctrl+Z                       reverts it   reverts it
```
**IDENTICAL — because that row's whole cascade fits ONE buffer, so the merge
path never executes.** That is exactly what the fix must do to the single-flush
case, so it is the control rather than a failure. The multi-flush arm rests on
the unit tests (4 discriminating / 4 controls). **The 29-transaction row it was
written for is not tickable on this grid today: of 592 switches only 3 are OFF,
and none is tracker-bearing** — said plainly rather than dressed up.

**AND CHASING WHY MY COUNTS KEPT DRIFTING FOUND THE REAL BUG.** A page load with
NOTHING clicked, twice, the second immediately after the first:
```
                              load A    load B      after the fix
transactions written            55        52            38
ON THE UNDO STACK               29        26             0
derived                          0         0            20
distinct action ids             29        26             0
occurrences touched              6         2             0
```
**So after any reload, Ctrl+Z reverted a tracker recomputation instead of the
last thing the user did.** The writes are the op sweep recomputing `Workout Log`
and `Workouts`. **Load B is the control that killed the obvious explanation** —
a second load on a settled grid still wrote 26, so this is not the sweep
catching up on stale state.

**THE MECHANISM IS ONE LINE.** `derived = !actionId` (`txRecorder.js:162`) is
the only rule keeping a write off the stack, and every write helper opens its
own action — so the app's own bookkeeping minted action ids and became undo
steps. `runDerived` suppresses `beginAction` rather than clearing the ambient
id, so a helper's `withAction` becomes a pass-through, and it is **carried
across the paint deferral by `captureAction`/`runInAction` for exactly the
reason the action id is**: the load sweep defers its cascade, so without that
the guard would cover only the synchronous half of the very sweep it was
written for.

**THIS SUPERSEDES THE RETRACTION ONE ENTRY BELOW.** That entry reverted
`runDerived` as *"a guard nothing has been shown to need"*, having measured a
load at 0 undoable / 30 derived. Today the same query reads **26 undoable / 0
derived**. The retraction was right about the evidence it had; the evidence
moved. *An open item is a claim about today\'s code — and so is a closed one.*

**THE ZERO IS ONLY MEANINGFUL BECAUSE A REAL GESTURE STILL MAKES A STEP.** Same
build, one tick through the UI, read back out of Mongo: **1 transaction on the
stack, 3 docs, containing the toggled row, and Ctrl+Z moves the switch back.**
Verifying an absence without first proving the thing can be present is the trap
this file records; here the positive control ran in the same session.

**ADDITIVE BY CHOICE, and the failure modes are asymmetric.** Suppressing an
action can only ever move a write OFF the stack, so a site that forgets the
scope keeps today\'s noise. The inverse design — undoable only inside an explicit
gesture — fails the other way, silently making a real edit un-undoable, which
reads as data loss. **Redo stays off at the user\'s own instruction** (*"can we
disable redo for the moment"*), so it was not in scope.

**FOUR PROBES LIED BEFORE ANY NUMBER WAS TRUSTWORTHY, and each is reusable.**
(1) A switch tagged once with a data attribute reads `undefined` after the
cascade — the row re-renders and the attribute goes with it, which looks exactly
like "undo did nothing". Re-resolve by occurrence id every read. (2) The row is
FILTERED OFF SCREEN once ticked, so a DOM-only probe reports `present:false` for
a row that is fine; the STORE is the witness that does not depend on painting.
(3) Discovering the bound field BEFORE the tick finds nothing — the field does
not exist until it is ticked. (4) A restore tool compared documents with
`JSON.stringify(obj, keyArray)`, whose key filter applies RECURSIVELY, so it
compared two near-empty objects and would have reported differences that do not
exist while hiding ones that do.

**PROBE DEBRIS: NONE.** `Text Terrell` was toggled and undone repeatedly and
reads back with no `Completed` and no `Completed On` — its exact pre-probe
state. `Text Shelly` was never touched.

3,445 client tests (the 2 failures are the documented pre-existing
`trackerFollowsPageFilter` pair, **A/B\'d against stashed source — identical 2**),
1,870 server tests, 0 lint errors on every edited file, build clean with chunks
at their documented sizes.

**NOT DEPLOYED, deliberately and at the user\'s call.** The merge fix alone
changes nothing a user can see; the two ship together now that undo works end to
end. **The cold Atlas read is also worth watching: 353-443s for 21k occurrences
this session, against the ~180s this file records.**

---

### 2026-08-27 (2) — ONE CHECKBOX TICK WROTE FOREVER, every 2.2 seconds, and the data was never wrong

Picked up the other account's session, which hit its 5-hour limit at 14:04
mid-probe. It had shipped the undo PERF work (26s -> 3s) and was chasing what it
called "the bigger half of undo is broken": one toggle minting 40-54
transactions. **That symptom had a much larger cause than action grouping.**

**MEASURED TO REAL QUIET RATHER THAN TO A CAP, which is what found it.** One
tick of a task with trackers:
```
                                  before        after
writes for one tick               136           32
distinct undo actions             106           2
writes to the "Completed" board   104           1
settled after                     NEVER*        23.8s
   * still writing at the 240s probe cap, one write every 2.174s
```
**AN IDLE CONTROL SAYS IT IS THE TICK:** with no toggle at all, 60 seconds of
idle produced **0 writes**. And unticking converges — only the ON direction
loops, which is exactly why it read as intermittent.

**THE OVERLAY DOES NOT GO STALE, IT OVERRULES.** `scheduleFeedSync` merges
`Object.assign(occs, localOccsById)` — the local overlay WINS over Redux. So an
entry nothing refreshes is not a missing update, it is a **wrong answer that
beats the right one**:
```
[feedDiag] RELINK copy=1787860129457-8ndxm8uxj
           parentOccUsed=15   reduxParent=16   reduxListsCopy=true
```
Redux held the correct 16-entry child list. The overlay's frozen 15 won, so
feedSync's re-link step concluded a copy it had just minted was unlisted and
re-linked it — and `_updateOccurrence` refreshed the overlay by spreading
`{ ...localPrev, updatedAt }`, **the timestamps only**, so the next pass reached
the identical conclusion. Nothing else ever corrects it either:
`occurrence_updated` is broadcast with `socket.to(userRoom())`, which EXCLUDES
the sender, so the originating tab gets a timestamp-only ack forever.

**THE DATA WAS NEVER DAMAGED, WHICH IS WHY THIS SURVIVED.** Mongo read
16 listed / 16 children / 0 mismatch throughout — the server's own
`mergeStaleChildArray` restored the child on every pass while logging
`dropped 1 unknown child id(s)`, **104 times, matching the 104 writes exactly**.
*Two correct guards fighting: the client re-attacking a list the server kept
repairing, with the write rate as the only symptom.*

**THE MERGE IS THE SERVER'S, deliberately** — `{ ...prev, ...payload }` is a
SHALLOW spread, so a partial patch replaces the keys it carries and leaves the
rest. A deep merge would keep fields the server has already dropped. Both
directions are pinned, and the control that matters most is that an ABSENT
overlay entry is not seeded: a partial would then start overruling Redux's
complete one.

**AND I INHERITED A HYPOTHESIS THAT WAS WRONG, which is the reusable half.**
The handoff said the cascade was "echo-driven — the server echoes each write
back and the client fires ops from that echo". One grep retires it:
`occurrence_updated` excludes the sender and `occurrence_persisted` fires no
ops. Measured on the wire, 30 seconds of the steady-state loop: **13 outbound
writes, 13 inbound `occurrence_persisted`, ZERO inbound `occurrence_updated`.**
The loop was entirely client-side. *A handoff's diagnosis is a claim; the
symptom it explains is not evidence that it is the cause.*

**THE ACTION-SCOPE HALF: ONE GESTURE IS ONE UNDO STEP — and my first number
was my own probe's fault.** The other account's in-flight fix carries the
ambient action across the deferred cascade, the same omission the deferral
already fixed for `_fireDepth`. I first reported it as `59 -> 34` and
"partial". **Both arms were counting the page-LOAD sweep's writes**, because
the probe armed after a fixed websocket-quiet window and the sweep was
sometimes still draining. Re-run with the probe waiting for the sweep's own
`[full_state-client] applied effects` line, and the carry toggled at RUNTIME so
both arms are the SAME BUILD and the same page:
```
                            carry OFF       carry ON
mutating writes             33              33
distinct undo actions       32              2
setOccurrenceFieldValue     0 join/29 mint  29 join/0 mint
deferrals that captured     0 of 30         30 of 30
```
**The write count is IDENTICAL in both arms**, which is the shape a grouping
A/B has to have — it changed how the writes are grouped, not how many there
are. *A before/after measures the change only if both halves ran against the
same thing, and "the app is quiet" is not the same as "the load sweep has
finished".*

**AND "ONE GESTURE IS ONE UNDO STEP" IS STILL WRONG — I measured the wrong
UNIT.** An `__actionId` is not an undo step; a TRANSACTION is, and that is what
Ctrl+Z pops. Counted against the transaction log, one toggle is:
```
distinct action ids                    1     <- the client groups perfectly
transactions created                  31
  of them UNDOABLE                    29     (28 holding ONE doc, 1 holding 3)
```
**So the client is not the problem any more and the SERVER is.**
`closeAction` debounces 250ms and then `flushAction` **deletes the buffer** —
so the next write carrying the same action id opens a fresh buffer and becomes
a SECOND transaction. A tracker cascade runs ~30 seconds with pauses far longer
than 250ms, so one gesture flushes ~29 times.

**REPRODUCED THROUGH THE UI, which is what makes it the user's bug rather than
a number:** tick a row, press Ctrl+Z, and the switch does not move —
```
undo_result  transactionId=da5PaA4uPimd  docs=1  occurrence 1ve8fwc6c7k
                                         contains the toggled row? NO
```
`1ve8fwc6c7k` is the **Workouts tracker tile**. Undo popped the last fragment
of the cascade — a derived-looking tracker write — instead of the thing the
user did. Redo then answered `Nothing to redo`, because a later write had
already `superseded` that branch.

**THE SERVER MECHANICS THEMSELVES ARE FINE, and that is worth stating because
the previous session recorded redo as broken.** Driven directly through the
real handlers on live data, a full round trip is clean:
```
write -> true    undo -> false (state "undone")    redo -> true (state "redone")
```
Same transaction id both ways. **Redo is not broken; it is starved** — by the
time you press it, the fragment you meant to redo has been superseded. The
`REDO_ENABLED = false` gate is therefore hiding a working feature whose input
is wrong, not a broken one.

**NOT FIXED, and specified rather than guessed at.** The fix belongs on the
server: a flush for an action id that has already produced a transaction must
MERGE into it (same docKey collapse — first `before`, latest `after`) rather
than insert a second one, so the grouping cannot depend on how long the cascade
runs or how many closes arrive. Raising `CLOSE_FLUSH_MS` is the tempting
version and is wrong: it is a picked constant racing a cascade whose length is
data-dependent. This is the write path this file records being damaged
repeatedly, so it wants its own reviewed pass rather than the tail of a long
session.

**AND I BUILT A FIX FOR A DEFECT THAT DOES NOT EXIST, then reverted it.** I
read the transaction log as `t.derived` — **a field that does not exist**; it
is stored at `meta.derived` (`txRecorder.js:217`) — saw `derived=false` on the
~30 transactions a page load creates, and concluded every load pushed 30
undoable steps on top of whatever the user last did. It does not. Queried on
the right key, a load produces **0 undoable and 30 derived**, and did so before
any change. A `runDerived` scope and its 10 tests were written, wired at the
load sweep and the scheduler, measured to change nothing, and **reverted rather
than shipped as a guard nothing has been shown to need** — the same call this
file records twice for guards written on reflex.

*This file already says a ZERO is a claim about the query until the shape it
searched for has been shown to exist. A `false` is the same claim, and I paid
for the inverse.*

**THE TILE TITLE GETS ITS ROOM** (user: *"put a little bit of padding below the
label for those media tiles"* — asked of the other account, interrupted by a
data-loss report, never landed). Measured first: **31px above the title, 2px
below**, so it read as attached to the fields rather than heading them. Derived
rather than picked — `0.35em`, so it follows `--instance-label-px` through both
breakpoints — and TILES ONLY, because in a ROW the label shares one centreline
with its field pills. A/B'd in ONE run with the rule removed via CSSOM so both
arms are the same page: tile label `0 -> 5.95px`, **ROW label 0 -> 0 (the
control)**, tile height 440 -> 440 with 0 clipped.

**PROBE DEBRIS, FOUND AND RESTORED — including the other account's.** Both
`Text Terrell` (19:02, its probe) and `Text Shelly` (19:09, mine) were left
carrying `Completed` + `Completed On`. The transaction log recorded only one of
the two transitions, so the **10:59 pre-migration backup** settled it: both rows
had NEITHER field before today. Cleared, read back, and the pm2 restart cleared
the warm cache that was still serving them. *A probe that edits is a probe that
can damage — and toggling a row twice does not restore it, because the op stamps
a date the untick does not always clear.*

3,432 client tests (the 2 failures are the documented pre-existing
`trackerFollowsPageFilter` pair), 0 lint errors on every edited file, deployed,
prod HEAD verified, served CSS **sha256-identical** to the local build with the
new rule present.

**A DEPLOY THAT REPORTED SUCCESS AND SHIPPED NOTHING, for the second time in
this file:** `deploy.sh` ssh'es to the server, which runs
`git pull --ff-only origin master` — so committing without PUSHING rebuilds and
restarts prod on the OLD code, with `✅ Deployed.` printed. Prod HEAD was the
only thing that said so. *Verify prod HEAD, never the script's output.*

---

### 2026-08-27 — FOUR BUGS, THREE OF THEM MINE FROM THIS MORNING; and an inline style beats CSS for the SIXTH time

Picked up the other account's session, which hit its limit mid-fix on the book
tile. Its queue plus three new reports.

**THE ADD-FIELD MENU LOST BY EXACTLY ONE.** User: *"add field button to add a
field to an occurance is opening an unreachable menu behind the instance
settings menu."* Two numbers in two files:
```
settings sheet (components/ui/popover.jsx)   z-[10000]
the menu it opens (DrilldownPicker)          zIndex 9999
```
The Radix popper wrapper carries `z-index: auto`, so it creates NO stacking
context and the content's 10000 competes in the ROOT one. A direct comparison,
and nothing subtle happens.

**GREP THE TOKEN, NOT THE CALL SITE** — surveying every portalled surface found
two more: `ContainerKindSelector` at 9999 (the same defect, unreported) and
`ActionPicker` at **10000, TIED**, surviving only on portal insertion order.
`helpers/zLayers.js` states the rule the numbers were violating —
`PORTAL_MENU = POPOVER + 10` — so a menu opened FROM a popover is above it by
construction. The guard greps source TEXT and fired on my own comment quoting
the old value; **reworded rather than narrowed**.

---

**THE VIEWER EMPTIED ITSELF FOR 10,795 ROWS, AND MY OWN CRASH FIX DID IT.**
User: *"images arent loading at all when focused in the artifact viewer."*
Reproduced with the control built in — clicked a cover whose picture was
demonstrably loaded on the board, and got `0 files · 0 imgs`. Not the network:
every one of the 92 image hosts answers 200.

**`504fc3ca` PICKED THE WRONG SIDE OF A DISAGREEMENT.** `filesOf` decides
whether the owner is one of its own files, carefully: self is pushed when the
owner CARRIES a src, **or when nothing else would render** — that second arm
exists so a row whose only picture is its own cover opens onto something.
`planSpreadSync` then stripped the owner unconditionally. Both stop the React
#185 loop; only one keeps the picture:
```
artifact rows whose only file is THEMSELVES   11,559
  of those, carrying a cover to draw          10,795   <- opened onto "0 files"
  genuinely blank                                764
```
And the row that crashed this morning — `A Theory of Human Motivation` — is a
book with `fileRef: null` and NO children, so it fired the `!othersExist` arm.
That commit's note about "carrying a src" named the wrong arm. **Two tests
INVERTED rather than deleted**, with the reason in place.

---

**THE DROPDOWN SEARCH REACHED 15 FIELDS AND MISSED 33.** User: *"the adding new
item to select isnt giving me the location search."* The config was right and
nothing rendered it — the merged grid+provider search lives in
`MultiSelectWithAdd`, and a SINGLE-select occurrence dropdown is a different
control that kept a type-a-plain-value row:
```
occurrence fields   48      multi 15     single 33
single WITH a provider  2   Song, Location   <- unreachable, always
single with addNew     31                    <- no search box at all
```
`OptionSearchList` is the shared body now; the import handler was written INLINE
inside each multi branch and is hoisted, which is *why* the single branches could
not have it. **The test suite was blind to exactly the half that was broken** —
written to catch inert wiring, it read only `<MultiSelectWithAdd>` sites.

---

**AND THE TILE FIX WAS INERT BECAUSE OF AN INLINE STYLE — the SIXTH time.**
The other account's uncommitted CSS gave `.instance-textcol` `flex: 1 1 auto;
min-height: 0` and its comment correctly said basis 0 is what collapses a media
tile. It changed nothing: the element carried `style={{ flex: "1 1 0" }}`, and
an inline style beats every stylesheet rule regardless of specificity.
```
before   wrapH 10 · textcol computed `1 1 0px` · fieldsH 0 · collapsed 128 of 128
after    wrapH 440 · textcol `1 1 auto`        · fieldsH 182 · collapsed 0
```
That is the 10px sliver of 2026-08-26 (4) reproduced exactly. **My first attempt
was a CSS scope change that could never have won, and the browser is what said
so: `hits: []` — no stylesheet rule matched the element at all.** Basis zero is a
ROW-axis decision (the inline comment argued it from WIDTH); the axis is knowable
in CSS and not in `ModuleInstance`, so the decision moved to the stylesheet.

**Option A stated as a measurement:** scrolling the fields moves the fields
(`scrollTop 0 -> 52`) and NOT the cover (`img top 161 -> 161`), 0 unreachable.
**The control is the row tile**, where `handleTop === labelTop` (659/659) — the
wrap defect basis-0 exists to prevent has not returned.

**The field picker gets a search** (user: *"there should be a search for adding
new fields onto an occurance too"*), with the threshold DERIVED —
`SEARCH_MIN_ITEMS = DROPDOWN_MAX_H / ROW_H`, so a level that fits grows no box —
and a first level offering ONE category is skipped rather than shown.

3,416 client tests (the 2 failures are the pre-existing `trackerFollowsPageFilter`
pair), 0 lint errors, deployed, prod HEAD verified, served CSS **sha256-identical**
to the local build. Every fix re-measured against PRODUCTION afterwards, not just
locally.

---

### 2026-08-26 (7) — the tablet sidebar full-screened because ONE FLAG ANSWERED TWO QUESTIONS

Three asks on the manifest sidebar, one root cause worth writing down.

**`isMobileLayout` IS NOT "IS THERE ROOM".** The sidebar chose overlay-vs-push
from that flag, and the flag is:
```
(isTouch && (isPortrait || width < 980)) || width <= 600
```
So a **TABLET IN PORTRAIT is "mobile layout" at 800-1180px wide** — and the
sidebar rendered `position:absolute; width:100%; maxHeight:50%`, a full-width
half-height slab dropped over the page it was meant to sit beside. User:
*"on tablet, make the manifest tree sidebar open in the same way as desktop.
right now it full screens and makes it look weird."*

*"Is this session phone-shaped"* and *"does a fixed 222px box fit"* are two
different questions. Answering the second with the first is the whole defect,
and it is the same shape as the 2026-08-24 `flex-direction: column` bug — a
condition that was true for its original reason and kept being asked after the
reason moved.

**THE THRESHOLD IS DERIVED FROM THE SIDEBAR, NOT PICKED.** The page keeps at
least TWICE what the sidebar takes, so the minimum viewport is `ROOT_TREE_W * 3`.
Change the sidebar width and the rule follows instead of quietly becoming wrong
— the same trick as `LABEL_MIN_ARC_PX = LABEL_FONT_PX * 1.8`. It lives in
`helpers/rootTreeLayout.js` because mounting `ModulePanel` needs the whole grid
store and this predicate is where the bug was.
```
measured at 820x1180, the viewport that broke:
  before   position absolute · width 100%
  after    position relative · width 220 · fullWidth false
```

**PINNED IS FLAT NOW** (*"remove the folders from the pinned tree. just show a
flat list of the pinned files"*). It had been building folder subtrees for
pinned folder pages and folder headers grouping the rest — **a second, shallower
copy of the manifest that renders directly beneath it.** A pinned FOLDER page
STAYS, as one flat row: dropping it would make a pinned page unreachable from
the sidebar, which is a bigger surprise than a row you can ignore. What is gone
is its SUBTREE, which is what the ask is about and what made Pinned redraw the
manifest in the first place. `LocalFolderGroup` had no callers left and is
deleted rather than left to rot. Verified live: **`distinctIndents [0, 12]`** —
the PINNED header at 0 and all 13 pages at ONE indent, 0 page errors.

**THE OPEN PAGE WAS HIGHLIGHTED, JUST NOT VISIBLY — and the numbers are why
this was worth measuring rather than "adding" a highlight.** Read off the live
sidebar, the active row differed from its neighbours only in the HUE of a tint
too faint to carry it:
```
active    bg rgba(167,139,250,0.08)   border rgba(167,139,250,0.9)
inactive  bg rgba( 90, 58,28,0.08)    border rgba( 90, 58,28,0.34)
```
**Same lightness.** On a wallpapered sidebar that reads as no highlight at all,
which is exactly what the user reported (*"make the one thats open be
highlighted if it isnt"* — the conditional was well founded). The FILL carries
it now (0.08 -> 0.22) with the weight agreeing rather than the border doing the
work alone. After: exactly ONE row in the section is distinct and every other is
byte-identical, **which is the control** — "the active row has a border" means
nothing until the inactive ones are shown not to. Weight rather than a darker
colour, because the label already renders in the module's own colour and
darkening it collides with the light-theme contrast work from 2026-08-19.

**AND THE FLATTENING HAS A COST, reported rather than buried:** folder grouping
was also DISAMBIGUATION. This grid pins two pages called `Examples` and two
called `Tasks`; grouped under different folders they read as different rows, and
flat they are visually identical. The user asked for flat, so it is flat — but
if that bites, the fix is a parent-folder suffix on the row, not the folders
coming back.

11 tests, both A/Bs discriminating (re-picking the threshold as a literal fails
the tablet widths; "always push" fails the phone control). 3,383 client tests —
the same 8 pre-existing in `weekdayTasks` + `trackerFollowsPageFilter`. Deployed,
prod HEAD verified, served `App` chunk **sha256-identical** with `PINNED` as the
positive control and the retired `LocalFolderGroup` at 0.

**A PROBE NOTE THAT COST TWO COMMITS:** `pkill -f "server/server.js"` matches
the SHELL RUNNING IT, so the command dies before its own next statement. Twice
this session a commit silently did not happen for that reason. Use the repo's
own `fuser -k 5000/tcp`.

---

### 2026-08-26 (6) — THE SCROLL PAINT IS ATTRIBUTED AT LAST: 46 of 50 running animations were OFF SCREEN

Entry (5) left the scroll complaint measured and unfixed, and named what the
next pass needed: *"a real paint trace (tracing with paint records) rather than
`Performance.getMetrics` deltas."* That trace was taken, and it named a cause
the fps A/B could never have found.

**THE ANIMATIONS NEVER STOP, AND ALMOST NONE OF THEM ARE ON SCREEN.** On the
live grid at 1280x800:
```
running CSS animations            50      of them OFF SCREEN   46
.auto-marquee-inner on screen   1039      running               49
Layerize, over a 60-step scroll   1766ms of a 3834ms main thread    <- 46%
```
Every running transform animation is its own compositing reason, so the
compositor never goes quiet at rest — **still 50 after four idle seconds.**
`AutoMarquee` only animates when a label overflows, so 1,039 marquees produce
49 animations; what nothing checked was whether the label was in view.

**THE FIX DOES NOT PAUSE — IT DOES NOT EMIT.** `animation-play-state: paused`
keeps the layer AND the compositing reason, which is most of the cost. The
animation is simply absent from the style while the box is out of view. The
IntersectionObserver is created only when there is overflow to scroll, so a
static label still costs nothing, and it fails OPEN: with no
IntersectionObserver the marquee behaves exactly as it did before.

**THE MEASUREMENT NEEDED THE BUNDLE SWAPPED BETWEEN RUNS, and that is the half
worth keeping.** The first before/after put the two builds in separate server
sessions and reported **-26%**. A drift check — re-running the CEILING arm on
the new build — showed the whole machine had moved: `no-marquee` went
2010 -> 2284ms and the fixed build 2776 -> 3460ms between sessions, 14-25% for
free. Rebuilt both bundles once, swapped `client/dist` between every run, three
interleaved passes against ONE server:
```
                    baseline                 fixed
main-thread task    3834ms [3823,4258]       3355ms [3125,3525]    -12%, NO overlap
Layerize            1766ms                   1290ms                -27%
RecalcStyle          239ms                     74ms                -69%
running animations      50                        4
off-screen ones         46                        0
```
**-12%, not -26%.** *A before/after measures the change only if both halves ran
against the same thing* — this file has recorded that rule since 2026-08-25 (7),
and here it was worth half the reported win.

**AND THE INSTRUMENT WAS SHOWN TO DISCRIMINATE BEFORE ANY ARM WAS BELIEVED.**
(5) abandoned its A/B because a NULL MUTATION won by 24%. So a null arm — a CSS
rule matching no element on the grid — ran interleaved with the others: it read
**3288ms against baseline's 3750ms**, inside baseline's own spread, while the
ceiling arm sat at 2010ms with no overlap at all. *An arm that changes nothing
must be in the set, and this time it behaved.*

**THE FEATURE IS PROVEN ALIVE, WHICH IS THE CHECK A PERF PASS SKIPS.** A fix
that silently stopped every label scrolling would improve every number above.
```
on screen      3 animating   transform moved -151.192px -> -194.392px over 1.2s
off screen     0 animating
scrolled in    1 animating       <- re-entry re-arms
```
The middle line alone proves nothing — an always-dead marquee passes it. The
first and third are what make it a measurement, the `0206`/`(16)` rule about
verifying an absence, applied to a perf change.

**WHAT REMAINS — AND I GUESSED IT WRONG TWICE IN ONE AFTERNOON, WHICH IS THE
REUSABLE HALF.** Killing marquee animation outright still reaches ~2334ms
against the shipped build's ~3446ms, so **three visible marquee animations cost
about 1,100ms across the gesture** and two thirds of the headroom is untaken. I
filed a hypothesis for it — *"the layer CHURN of arming and disarming
animations as rows cross the viewport edge"* — and docketed three fixes against
it. **Counting the transitions killed it: 3 arms, ZERO disarms, peak 3
concurrent.** There is no thrash, so a hysteresis band, a shared observer and a
class-toggle would all have been built for a mechanism that does not exist.
Second guess, same fate: `translateX(var(--mq-shift))` in a keyframe is a known
way to lose the compositor thread, and an arm using a literal `translateX`
instead read **[3381, 3936, 3246] against the shipped [3446, 3132, 3712]** —
fully overlapping, costs nothing.

**AND IT IS NOT `Layerize`,** which is what makes it strange, since that WAS the
mechanism for the 46 off-screen ones: shipped 1197ms vs ceiling 1163ms. Ranking
every trace event, the named children account for ~167ms of the ~708ms gap;
**~540ms sits inside `RunTask` attributed to nothing.** **Then the confound turned out to be
the whole story.** Measured as FRAME INTERVALS rather than task totals — which
is what "scroll is too slow" actually means — the marquee is worth **12%, not
32%**: median frame 31.1ms against a 27.5ms ceiling, i.e. ~3.6ms per frame at
4x throttle and **under 1ms at normal speed**, with a null arm reading 32.4ms,
WORSE than baseline. *Task total counted a cheaper frame twice, because it also
shortens the gesture.* A third guess — `will-change: transform`, the hint every
marquee library reaches for — was tested and buys nothing (31.4ms). **And the
blanket form is a 3x REGRESSION: 31 -> 88ms median frame, all 60 frames over
50ms**, which is `index.css:2791` reproducing and is also the answer to "should
we just use a package": one that sets `will-change` per instance would be far
worse than what we have. Closed in `client/src/CLAUDE.md`; the marquee stays. *A docketed hypothesis is a guess with a citation.*
Entry (5)'s other lead — the day column at 5,871 nodes — is untouched and still
stands.

3,379 client tests (the same 8 pre-existing in `weekdayTasks` +
`trackerFollowsPageFilter`), lint clean on the edited file, poms grid **0
errors** with the one documented `unused-field` warning.

**A probe note, because it cost a rebuild:** the session scratchpad was wiped
mid-run and took the auth token with it. A token is mintable locally with the
server's own `JWT_SECRET` — `server/scripts/apiDemoClient.js` already does
exactly that — so a lost probe token is a one-line recovery, not a re-login.

---

### 2026-08-26 (5) — delete had four names; the undo button that never existed; and a scroll probe that measured nothing

**"HOW DO WE DELETE OCCURANCES ATM" / "I CANT FIND THE DELETE IN THE RADIAL
MENU."** It was there under another word. `CommitHelpers.removeOccurrence`
dispatches a delete, emits `delete_occurrence`, and the server cascades
everything parented to the row — and four surfaces offered it:
```
radial menu       "Remove"
row context menu  "Remove from container"
settings sheet    "Remove from container"  + "The module will remain…"
bulk selection    "Delete N selected"      <- the SAME function, named right
```
So the honest name already existed and had never reached a single row. **Worse
than undiscoverable, the wording was backwards where the damage is**: "remove
from the container" reads as unlinking a placement, and a container row deleted
under that sentence takes its whole subtree with it.

**IT IS A PROP, NOT A RENAME, and that is the load-bearing part.** On a doc PILL
or an embed the same handler really does only take the node out of the prose —
the occurrence lives on — so "Remove" is correct there. One static word cannot
be true for both, which is presumably how the vague one won. `RadialMenu` takes
a `deleteLabel` defaulting to "Remove" (every existing caller unchanged) and the
row passes `embedOnDelete ? "Remove" : "Delete"`.

**REPORTED, NOT BUILT:** nothing in the UI can UNLIST a multi-parented row from
one container without deleting it everywhere — the action the old label
described. `REMOVE_CHILD` exists in the pipeline; no control reaches it.

---

**THE UNDO BUTTON: THE FEATURE HAD SHIPPED AND THE CONTROL NEVER HAD.** User:
*"put a back undo button in next to the command center"*. `App` has held
`undo`/`canUndo`/`isProcessing` since the undo/redo rebuild and Ctrl+Z is bound
— **but a tablet has no Ctrl+Z, so on the surface this grid is most used on,
undo could not be reached at all.** Disabled rather than hidden when there is
nothing to undo (a control that appears and disappears shifts every button
beside it, which on a thumb-sized toolbar means mis-taps), and deliberately NOT
inside the `!isMobileLayout` block its neighbours live in.

**AND I CLAIMED DELETES WERE NOT UNDOABLE, WHICH WAS WRONG.** I queried the
transaction log for a `type`/`actionLabel` shape that does not exist, got zero,
and reported that deletes are never recorded. They are: `crud.js` snapshots
every node of a cascade BEFORE deleting it and calls `recordChange(… after:
null)`, which lands as a **`SnapshotOp` whose `docs[].after` is null** — 100 of
them on this grid. *A zero is a claim about the QUERY until the shape it
searched for has been shown to exist.*

---

**A RESTORE, AND THE BACKUP THAT MADE IT EXACT.** The user deleted the
**`Physical` dimension off the Routines page** at 12:27 — Nutrition, Fitness,
Rest and Care with every routine under them. Recovered by diffing the 09:50
pre-migration snapshot against live and **subtracting the 755 documents I had
swept myself**, which left 21 real rows (44 feed copies excluded as churn). The
7 missing modules came from the 04:17 nightly; **0 were missing anywhere**.
Re-listed at index 0, where it had sat. Verified live: nine dimensions, Physical
first, Cook · Nutrition 3 · Fitness 5 · Rest 3 · Care 4, **0 integrity errors**.

**The debris sweep either side of it was scoped and guarded.** 755 documents
(two stranded day columns — one mine, 73 rows whose module and parent never
persisted; one a 49-slots-x-12-copies duplicate that predated the session).
Guards: nothing shared with the live column (checked — **0 overlap**), nothing
carrying a textmap, the Schedule page not in the set, and one survivor's
`parentId` repointed at its live lister rather than left dangling.

---

**THE SCROLL COMPLAINT IS PAINT-BOUND, AND MY ATTRIBUTION PROBE MEASURED
NOTHING.** User: *"scroll is too slow on mobile tablet … and the painting is too
slow for scroll"*. Measured on a 1280x800 tablet viewport at 4x CPU throttle,
60 rAF scroll steps:
```
Task total   3459ms
RecalcStyle   412ms (118 recalcs)     Layout 173ms (53)     Script 177ms
                                      -> ~2.7s is paint / raster / compositing
React renders during the scroll   0        op runs   0
on screen  ~20,400 nodes · 105 containers · 184 rows
heaviest single container: "Schedule - Wednesday" at 5,871 nodes (29%)
```
So it is NOT the app's JavaScript — `__renderTally()` reports **zero** renders
across the whole gesture, which rules out the render path outright.

**AND THEN THE A/B PROVED ONLY THAT THE INSTRUMENT IS NOISE-DOMINATED.** Six
arms (content-visibility, wallpaper, shadows, images, radii) all landed INSIDE
the gap between two baseline runs (31.6 -> 28.5 fps). Interleaved with three
passes each it looked like signal — until the census said **there was exactly 1
image on screen**, which makes "no images" a NULL MUTATION, and it "won" by 24%.
*An arm that changes nothing must be in the set, and when it moves as much as
the real ones the run is over.* Nothing is attributed, and no fix was shipped on
a guess.

**WHAT THE NEXT PASS NEEDS:** a real paint trace (tracing with paint records)
rather than `Performance.getMetrics` deltas, and ideally the user's own device —
a desktop GPU at 4x CPU throttle is not a tablet, and paint is the one cost that
does not scale with the CPU knob. The lead worth starting from is the day column
at 5,871 nodes, not the media boards.

3,375 client tests (the same 8 pre-existing), four deploys, prod HEAD verified
each time, poms grid **0 errors**.

---

### 2026-08-26 (4) — pictures appear whole; and I SHIPPED A REGRESSION that collapsed every media tile

The other account's last four UI items, all on one surface. Two of them turned
out to be the same defect, one of my fixes broke a second surface in
production, and the debris sweep at the end REFUSED — correctly.

**"HAVE THEM JUST APPEAR INSTEAD OF LAGGING THROUGH THE LOAD."** A remote JPEG
paints AS ITS BYTES ARRIVE, so a visible `<img>` mid-fetch prints down the frame
under its own spinner. `LoadingImage` holds it at `opacity: 0` until `decode()`
resolves — **opacity rather than not rendering it**, for the same reason the
status is an overlay: the element must keep its box or every row reflows the
moment a picture lands. `decode()` and not just `onLoad`, because onLoad fires
when the BYTES are in and the decode still happens at first paint.

**MEASURED ON PROD, SAME PROBE AND URL, EITHER SIDE OF THE DEPLOY** — a 120 KB/s
throttle applied the INSTANT the grid hydrates, which is the only window in
which posters can be watched arriving (throttling later is useless, they are
already decoded):
```
                        before      after
images on screen           160       3358
painted while loading       80          0      <- the defect
caught mid-load, hidden      0       1589      <- the positive control
```
That second row is the claim; the third is what makes it mean anything.

---

**"LONG INSTANCES ARENT SCROLLING DOWNWARD" AND "THEIR BODY THAT EXPANDS OPEN
ISNT SHOWING AN AREA TO TYPE" ARE ONE DEFECT.** The pocket is a SIBLING of the
row inside `.instance-wrap`, and a wrap tile caps that wrapper and hides its
overflow — so opening a body on a tile put the whole typing area past the clip:
```
tile   wrap h 155 · max-height 200px · overflow hidden
       pocket top 840 · wrap bottom 840   -> 30px PAST the edge, invisible
row    wrap h  98 · max-height none  · overflow visible
       pocket bottom 580 · wrap bottom 585 -> visible        <- the control
```
**A page-wide scan for genuinely unreachable content (overflow hidden AND taller
than its box) reads 0 with no body open and exactly 1 the moment a tile body
opens** — so that was the only thing being cut off, and the tile's own
`.instance-fields` scroll never covered it because the pocket is not inside the
field block. The cap is about the FIELDS; a body the user just opened is let out
of it, bounded at 160px and scrolling instead.

**AND THE FIELD BLOCK NEVER SCROLLED EITHER.** The tile promises "the scroll
lives on the field block", and `.instance-textcol` sat at `min-height: auto`:
```
wrap 200 hidden · row 198 · content 192 · textcol 466 AUTO · fields 439 auto
```
The bounded height never reached the fields, so `overflow-y: auto` had nothing
to do and 269px of a tracker tile was unreachable. **`align-self: stretch` is
NOT the bound, and only measuring shows it** — `.instance-content` is
`flex-wrap: wrap`, and in a MULTI-LINE flex container an item stretches to its
own LINE's cross size, a line this column itself sets. A/B'd: without the two
properties the same three tiles read **123 / 34 / 270px unreachable and 0
scrollable**; with them, 0 unreachable, 3 scrollable, and the block moves
(`scrollTop 0 -> 116`).

---

**THEN I SHIPPED IT AND EVERY PICTURE TILE COLLAPSED TO 10px.** Caught by
probing prod after the deploy, not before it:
```
wrap rectH 10 (was 276) · content 0 · textcol 0 · fields 0
the poster, 182px, overflowing a 10px tile        — 34 of 37 tiles in view
```
**THE TWO TILE SHAPES NEED OPPOSITE THINGS FROM THAT ELEMENT.** A tracker tile
lays out as a ROW, so the column's cross axis is height and `min-height: 0` is
what lets the cap reach the fields. A media tile is `--content-column`, so the
SAME column is `flex: 1 1 0` along the MAIN axis inside a wrap whose height is
auto — there `min-height: 0` lets it fall to its zero basis with no free space
to grow back into. Scoped to `:not(.container-items--content-column)` now.

**WHY I DID NOT CATCH IT LOCALLY, and this is the reusable half: my dev server
had been up since Aug 25 and its WARM CACHE was serving a stale
`activeOccurrenceId` per panel** — so every local probe rendered the tracker
boards and never mounted a single media board. Two tile shapes exist; I verified
one and shipped for both. *A local server holding a warm cache is a claim about
the grid AS IT WAS WHEN IT STARTED.* Restarting it put the media boards back on
screen and the regression reproduced in one run.

Re-verified on prod after the correction: picture tiles **276 / 302 / 276 —
byte-identical to the pre-change baseline**, 0 collapsed, 0 unreachable; the
tall tracker tile at 0 unreachable with its field block scrolling `0 -> 34`;
schedule rendering 49 slots; **0 page errors** on every load.

**THE BORDER ABOVE THE BODY** is in the container's own accent rather than a
neutral rule, so the pocket still reads as this row opening rather than a slab
parked under it — which is what the square top corners and the missing top
margin were written for.

---

**AND MY OWN PROBES LEFT DEBRIS I DELIBERATELY DID NOT SWEEP.** ~15 grid loads
stranded one container (`z9lntG03zNIP`, 73 routine rows) whose module and parent
never persisted — the documented create/disconnect asymmetry, from closing a
browser mid-burst. It is unreachable (no module, no parent, listed by nobody,
and no child listed anywhere else), so it renders nowhere, and it is the only
`missing-module` on a 22,019-occurrence grid.

**THE SWEEP REFUSED, AND IT WAS RIGHT TO.** One of the 73 is a `Drink` carrying
`Completed: true` with `Completed On` stamped **07:48 — before this session
started**: a completion the USER made this morning, copied into a row a later
rebuild minted. Deleting a real completion to clear an integrity warning is the
damage, not the fix (the `0038` rule from the other direction). Left in place
and reported. If it is ever swept, the guards that matter are: the root's module
AND parent both absent, nothing listing it, and no child that has children, is
listed elsewhere, carries text, or holds a TRUE field — that last one is the
guard that fired here.

**Separately, and NOT mine: a second column carrying today's label**
(`f1d45c40`, created 06:35, **588 children = 49 slots x 12 copies each**) is
parented to the Schedule page and listed by nobody, so it is already invisible.
It predates this session. The column the page DOES list is clean at 49 slots.

6 tests, 3 A/Bs each failing exactly its own cases (revealing on onLoad without
awaiting decode fails 2, dropping the src guard fails 1, forcing opacity 1 fails
1). 3,364 client tests — the same 8 pre-existing in `weekdayTasks` +
`trackerFollowsPageFilter`. Two deploys, prod HEAD verified, served CSS
**sha256-identical** to the local build with both new rules present.

---

### 2026-08-26 (3) — THREE folders called Templates, and deleting two would not have STUCK

User: *"also move the more inner templates folder contents to the boards section and delete that
templates folder"*, then the correction that reshaped it: *"i meant the library templates but there
shouldnt be two templates in the root folder either. they should be merged"*.

**MEASURING TURNED A MOVE INTO A DELETION.** There are three:
```
Root/Library/Templates   mAif5lIvNpXI       0 occ · 0 sub · not protected
Templates (TOP LEVEL)    PLySXSQBJrGx       0 occ · the ROOT of a manifestType:"templates"
Root/Templates           tpl-folder-<grid>  4 occ · PROTECTED   <- the real one
```
**Both strays are EMPTY**, so "move the contents" moves nothing — the whole ask is the deletion.

**AND DELETING THE TOP-LEVEL ONE WOULD NOT HAVE STUCK, which is the half worth recording.**
`socketHandlers/state.js` called `ensureTemplatesManifest` on **every grid bootstrap**, and that
helper find-or-mints the manifest AND its root folder. Delete it, load the page, and it is back —
a repair that reads as a migration silently failing. The call is removed here, so the two halves
**cannot ship apart**.

**NOTHING READS THAT MANIFEST, and that is grepped rather than assumed.** `0035` retired it and
both ends resolve templates by LOCATION now — `utils/templatesFolder.js` says so in its own header
(*"Location is the ONLY marker … There is no templates manifest"*), and `findTemplatesFolder`
plus the client's `templatesFolderFor` both key on `meta.protected` + the name.

**The survivor is chosen by `meta.protected`** — the marker both ends already use, not "the first
one found" — and the migration REFUSES to delete a folder that holds an occurrence or a
sub-folder, is protected, or is a user manifest's root. 7 tests, **4 A/Bs each failing exactly one**
(deleting a non-empty folder, keeping the first-named instead of the protected one, deleting the
user manifest root, deleting every templates manifest rather than the doomed one).

**VERIFIED BY LOADING THE GRID, which is the only check that could see the bootstrap:**
```
after a REAL page load   manifests ["user"]   Templates folders 1   0 page errors
Mongo, after that load   exactly 1
the 4 templates          Schedule Template · Project: {ProjectName} · Day Page · Templates
```
**My first probe read `templateChildren: 0` and it was the PROBE** — the client store holds FLAT
ARRAYS (`occurrences`/`modules`/`fields`), and I read `occurrencesById`. That exact trap is
recorded in this file from 2026-07-29 (3), and the server saying 4 is what caught it.

---

### 2026-08-26 (2) — ARTWORK: 24 albums become 2,423, and an abort guard that could not see a 403

User: *"can you look into giving the rest of the media images"* -> *"they need artwork wtf"*.

```
            before   after
album           0 -> 2,423 / 3,027   80%
song            0 -> 4,952 / 5,484   90%
book            0 ->   222 /   877   25%
artist          0 ->   161 / 1,679   10%
movie/series        989/993 · 183/187   (already done by 0245)
```

**EXACT IDS FIRST (`0254`), because an id cannot fetch the wrong picture** — a Spotify URL
(oEmbed, no key) and an ISBN. That covered only 731 rows: the Spotify import stored a URL on 199
of 3,027 albums, and 369 of 877 books have an ISBN.

**AND OPEN LIBRARY WILL HAND YOU SOMEONE ELSE'S BOOK.** Probed before writing: a bogus all-zeros
ISBN returns **HTTP 200, a real 19,683-byte jpeg, and a real book record**. So "the ISBN resolved"
is no evidence the cover belongs to this book. Every book must clear a normalised title match —
**it refused 13 covers on live data.**

**THE SEARCH FALLBACK NEEDED THE ARTIST, and the album already knew it.** 2,707 uncovered albums
carry an `Artist` reference, so the query is "<album> <artist>" and BOTH sides of the answer are
checked. Sampled 30 first: **22 matched on title+artist, and ZERO matched on title alone** — which
is what says the double check is not decoration.

**THEN `0257` WROTE 37 OF 2,707, AND THE SOURCE WAS NOT THE PROBLEM.** The hit count froze inside
the first thousand rows. Checked immediately: `itunes.apple.com -> HTTP 403`, three times. iTunes
throttled after ~40 requests and the run walked the remaining 2,670 albums against a closed door.

**IT DID THAT BECAUSE THE ABORT GUARD KEYED ON *THROWN* ERRORS.** A 403 does not throw — `res.ok`
is false, the helper returns `null`, and `null` is the SAME VALUE a genuine "nobody made that
album" produces. Every refusal was counted as a miss, so the guard could never fire. `0201` records
this class from the other direction (*"counting MISSES made the guard UNFIREABLE"*); the sharper
statement is that **a refusal and a miss must be different VALUES, not both null**. `0258` throws
on a non-ok response, and on Deezer's error payload — which arrives with HTTP 200.

Deezer was measured before switching (12 rapid requests, 12x 200, and it returns the artist
alongside the title so the same double check applies) and took albums to 80%, songs to 90% by
inheritance — **a song's art is its album's, so 4,952 songs cost zero requests.**

**LEFT BLANK, DELIBERATELY:** 1,516 artists — iTunes' `musicArtist` returns **no artwork at all**,
and using one of their album sleeves as an artist photo is the plausible-and-wrong trade `0201`
already refused. 508 books have no ISBN and Open Library's title search returned 0 for a real one.
308 albums have no confident Deezer match.

**AND I ANSWERED THE WRONG QUESTION FIRST.** Asked *"did you do books too / and tv shows"* I went
off and measured legacy seed rows instead of coverage. Recorded because the correction cost a whole
exchange: **when a follow-up names a noun already in play, it is almost always about the thing just
done, not a new investigation.**

**Probe debris, found and swept:** deleting the 5 seeded song rows (`0256`, the user's call) left
their 5 one-off MODULES orphaned — deleting an occurrence never removes its module, the same thing
`0108` left behind. `sweepOrphans` took them with a dump; poms grid back to **0 errors, 1
pre-existing warning**. 1,760 server tests.

---

### 2026-08-26 — `getAncestorChain` rebuilt a 6,557-entry map to walk 20 links

A CPU profile is what found this one, and it is the third instance of the same
shape in two days: **work the surrounding code had already decided to cache, rebuilt on every
call.**

`operationsBridge.getAncestorChain(occId)` walks at most 20 ancestors. To do it, it rebuilt a
FULL module map (**6,557 entries** on poms grid) and a parent-by-child map over the whole local
overlay — **every call**. It runs once per `occurrence_updated`, ~80 times for one `Completed`
toggle: ~524k iterations for the module map alone. A CDP `Profiler` run over one toggle put it at
**440ms**, and `_cachedModulesById` was already sitting in the same closure.

Modules are now keyed on the array identity; the overlay is fingerprinted exactly like the
occurrence merge, and for the same reason — its ~20 mutation sites all ASSIGN A NEW OBJECT, so key
list + value identity catches every write without hooking twenty call sites and hoping none is ever
missed.

**BOTH GUARDS NEEDED A SECOND ATTEMPT TO TEST HONESTLY, which is the reusable half.**
- The re-parent test first ADDED a key, so the cheap length comparison rebuilt the cache and the
  value-identity bug was masked. Isolated by moving a child between two parents that BOTH already
  exist — same key set, different values.
- The modules-map guard was covered by nothing at all: no test swapped the modules array. It needed
  a rename, asserting the chain's LABELS follow.

*A guard is untested until the test isolates the case only that guard covers* — twice in one pass.

**MEASUREMENT, AND THE HONEST CAVEAT.** Across this and the two previous passes, on comparable
runs: operation time ~3,270ms -> ~2,500ms, and the main 27-op sweep 1,514ms -> ~850ms. **Run-to-run
variance is large because which row the probe picks changes the op set** (a cheap row fires ~30
sweeps, an expensive one ~80), so these are ranges rather than a precise percentage — the
like-for-like figure I trust most is the main sweep, which is the same 27 ops every time.
Click-to-paint stays 30-250ms.

3,358 client tests (the same 8 pre-existing), poms grid **0 errors**.

**Two `Drink` rows read Completed on the live grid and are NOT probe debris** — that occurrence id
appears in no probe run this session, and every probe restored the row to the state it found. Left
alone: deleting a real completion to tidy a report is the damage, not the fix.

---

### 2026-08-25 (9) — the ops get 2x faster: work that was CACHED PER SWEEP was rebuilt PER OP

User: *"theres got to be a way to speed up these ops so its more instant"*. There was — two
rebuilds that the surrounding code had already decided to cache, and then didn't.

**FIND 1 — `$allItems` WAS CACHED; EVERYTHING DERIVED FROM IT WAS NOT.** The sweep context has
cached the enriched `$allItems` read model since the onLoad-sweep work. But `executePipeline` —
which runs **once per operation** — rebuilt everything derived from it: four full `.filter()` passes
(`$allContainers`, `$allPages`, `$allPanels`, `$allInstances`) plus **two separately-built
21,766-key maps** (`$allItemsById` and `$allOccurrencesById`, byte-identical contents). ~130k
operations per op, **27 times** for one `Completed` toggle — ~3.4M operations and 52 large
short-lived objects per sweep, before a single predicate ran. Now one pass, cached on the identity
of the `allItems` array (which IS the version — the sweep discards `_allItemsCache` the moment an
op mutates structure), and the two id maps are one object.

**FIND 2 — AND THE BIGGER ONE WAS HIDING OUTSIDE `[op-timing]` ENTIRELY.** Every fire ran
```js
const occurrencesById = Object.assign({}, _cachedBaseOccsById, localOccsById);
```
Every other map on that path is keyed on an array identity; this last merge was not, and it copies
**21,766 keys**. One toggle produces ~80 fires — ~1.7M property copies. It never appeared in a
per-op total, which is why it survived: I had subtracted the logged sweeps from the tally and
concluded the empty sweeps "cost ~30ms". They cost ~1.9s, and the arithmetic only worked once
`window.__renderTally()` gave a figure the `[op-timing]` lines could be checked against.
```
main sweep (27 ops)   1514ms -> ~850ms
total op time        ~3270ms -> ~1640ms      (the 1628ms drop matches the measured merge overhead)
click -> paint         27-46ms               (unchanged — already instant)
```

**THE MERGE CACHE IS FINGERPRINTED, NOT VERSION-COUNTED, and that is the load-bearing decision.**
`localOccsById` has ~20 mutation sites; bumping a counter at each means a missed bump serves
operations a STALE occurrence map — a correctness bug, not a slow one. Instead the cache compares
the base map's identity plus the key list and value identities of the LOCAL overlay, which is tiny
and whose every mutation site assigns a NEW object.

**BOTH STALENESS GUARDS ARE A/B'd, and the second one took three attempts to test honestly.**
Ignoring value identity fails immediately. Ignoring the BASE identity passed every test I had —
because an occurrence event mutates the local overlay too, so its fingerprint rebuilt the cache and
masked the bug. It needed a fire that touches NO local occurrence: a `NavigationOp` from a grid
filter change. *A guard is untested until the test isolates the case only that guard covers.*

3,356 client tests (the same 8 pre-existing), poms grid **0 errors**, 0 rows left ticked.

---

### 2026-08-25 (8) — the toggle is FIXED: 2333ms -> 30ms, because the CONTROL repaints before the write

User: *"even if it does, it should mark the toggle as complete before running the ops"*. They were
right — moving the operations off the click (entry (7)) was necessary and not sufficient.

**WHY.** `Field.handleChange` sets the control's LOCAL state, so the switch is ready to paint at
once. React then batches that setState with `FieldRenderer.handleCommit`'s store dispatch, and that
dispatch re-renders the app — so the browser still could not paint the tick until the re-render
finished. `handleCommit` defers its body past the paint now: the control repaints from its own
state, then the write and its cascade run a frame later (`afterPaint` is FIFO, so nothing is
reordered).
```
before   switch flips with the batch · first paint 2333ms
after    switch flips at 1ms         · first paint 28-32ms      (3 runs)
```

**UNDO IS UNAFFECTED, checked rather than assumed** — and this was the one thing that could have
made the change silently destructive. `CommitHelpers.updateOccurrence` opens its OWN scope via
`withAction`, so the action id is minted when the deferred write runs and still groups it with its
whole cascade into ONE undo step. An AMBIENT scope would have been lost across the deferral and the
write recorded as `derived`, which the undo stack skips.

**VERIFIED END TO END ON LIVE DATA — the deferred write lands AND its ops still fire:**
```
tick    "Walk"  ->  Completed = true   ·  Completed On = "2026-08-25"   <- the op stamped it
untick  "Walk"  ->  Completed = false  ·  Completed On = null           <- the else branch fired
```

**AND MY OWN EDIT CARRIED THE TDZ TRAP THIS FILE ALREADY RECORDS.** `handleCommit`'s dep array
named `_commitNow`, declared below it — and a `useCallback` dep array is evaluated at RENDER time,
so it throws before the callback ever runs. **`no-undef` cannot see it**, because the const does
exist; only reading the diff catches it. Reordered.

**WHAT REMAINS, attributed for the next pass:** ~3.0s of operation work per toggle, now entirely
off the critical path — the grid keeps responding while it runs. One toggle is **80 sweeps: 52 at
depth 1, 28 at depth 2**, so the depth-1 fires (one per occurrence the cascade writes, echo-driven)
are where a batching pass should start.

3,349 client tests (the same 8 pre-existing). poms grid **0 errors**, every probe row restored by
occurrence id and read back out of Mongo.

---

### 2026-08-25 (7) — the tick paints 30% sooner; and TWO of my own conclusions were wrong

Continued item 10. `setOccurrenceFieldValue` dispatches the optimistic value and then fires
operations **synchronously**, so the browser cannot paint the tick until the whole sweep finishes —
the user watches a frozen checkbox. `helpers/afterPaint.js` already exists for exactly this (the
textblock mint went 1000ms -> 30ms).

**MEASURED LIKE-FOR-LIKE, four runs each on ONE row:**
```
no deferral        paint 3333ms · longest 3308ms · ops 79/3040ms
top-level only     paint 3403ms · longest 3269ms · ops 80/2999ms
nested too         paint 2333ms · longest 2296ms · ops 80/3018ms   <- shipped
```
The win is in deferring the **nested** fires; gating on `_fireDepth === 0` buys nothing.

**I REVERTED THIS ONCE, ON A CROSS-ROW COMPARISON.** I had "30 sweeps/2047ms" without the deferral
against "80/3108ms" with it, concluded it tripled the op work, wrote the revert commit, and shipped
it. Those two numbers came from **different rows** — a cheaper row fires fewer ops. Same row, the
count is unchanged. *A before/after measures the change only if both halves ran against the same
thing* — and I had even printed the occurrence id in both logs.

**AND THE GUARD I ADDED TO MAKE IT SAFE WAS UNTESTED BY MY OWN TEST.** Deferring nested fires
resets `_fireDepth`, so `_FIRE_DEPTH_LIMIT` can never accumulate and a self-triggering op spins
forever in separate tasks rather than tripping the cap — the guard stops working precisely when it
is needed. The deferral carries the depth now. My first test asserted `fired.length < 40` and
**passed against the broken version**; driven through the real handler:
```
depth CARRIED -> 8     exactly _FIRE_DEPTH_LIMIT
depth RESET   -> 23    and still climbing
```
`<= 10` now, and it fails against both mutations. *A loose bound is how a test about a runaway loop
becomes a test about nothing.*

**STILL OPEN:** ~3.0s of operation work per toggle, now off the critical path. The next lever is
the ~80 sweeps one toggle provokes — mostly server-echo driven — which wants its own pass.

3,348 client tests (the same 8 pre-existing). poms grid **0 errors**; every probe toggle reverted
by occurrence id and read back — **0 rows left `Completed = true`** out of 2,389 touched.

---

### 2026-08-25 (6) — the tiles take the HOUSE shape; and a CORRECTION to (4)'s "unrelated panels"

**A CORRECTION I OWE, and it is the reusable half.** Entry (4) reported that toggling `Completed`
put *"52% of the DOM mutations in panels that have nothing to do with the row"*. That framing was
wrong, and naming the panels is what showed it:
```
panels open   _PkuNAJp "Routines" (216 inputs) · u07qnz_n "Trackers" (70) · U18hAEwP "Schedule" (180)
```
The toggle happened in **Routines**; the two panels that "had nothing to do with it" were
**Trackers** — displaying the very tracker tiles the write had just changed — and **Schedule**,
which holds the same routine rows. *They were not unrelated; they were showing affected data.*

**THE WASTE THAT IS REAL, measured rather than asserted.** The mutations in those panels are
**1,701 attribute writes on `<input>`**: `name` 1134 + `type` 567, an exact 2:1 — React's
controlled-input update path, which blanks and restores `name`. So **~567 inputs updated**, roughly
3 passes over every input in the panel, when only a couple of values changed. Almost no `childList`
churn, so nothing is remounting. *A count of "unrelated work" is a claim about the WORD unrelated
until the panels have been named.*

**AND THE HOT-PATH COMPONENTS ARE ALREADY MEMOIZED** — `ModuleInstance`, `Field`, `FieldRenderer`,
`ModuleContainer`, `ModulePage` are all `React.memo`, and all on per-slice selectors. `ModulePanel`
does subscribe to `occurrencesById` (rebuilt every write), but it needs occurrence data to render,
so narrowing it is a real refactor of a 1,200-line component rather than the one-line swap (4)
implied. Still the lead; still not done.

---

**THE TILES TAKE THE HOUSE SHAPE (`0250`).** User: *"make sure the media tiles are tiles though.
same size as trackers"*. `0248` had sized them with numbers I picked for a 2:3 poster (150 x 320),
making the media boards **the only tiles on the grid with their own dimensions**. `0250` groups
every wrap-mode container by its size keys and takes the largest group — the **15 `Today's …`
tracker containers at `childMinWidth: 184`**. **A media board cannot vote for its own shape** (its
own test), and it REFUSES if no shape has a clear majority rather than guessing.
`childContentDirection: "column"` is deliberately not copied: it stacks picture -> title -> fields,
and a tracker tile has no picture to put on top. **Size parity, not composition parity.**

**GAMES AND COMICS ARE TILED AT THE USER'S EXPLICIT INSTRUCTION (`0251`)** — *"games and comics
should be tiles too"* — overriding `0248`'s measured refusal (`0/4` and `0/5` rows have cover art;
TMDB is a film/TV database). The concern was raised, the answer was explicit, so it is theirs.
**The coverage rule is NOT deleted**: `0251` names the two KINDS asked for rather than dropping the
threshold, which would have swept in Songs (5,489 rows) and Albums (3,027).

**AND EXACT SIZE PARITY BROKE THE TILES, WHICH ONLY MEASURING THE INSIDES CAUGHT (`0252`).** At
184 x 200 a media tile showed **only a cropped poster**:
```
tile height 200px      actual content 432px      overflow: hidden
poster  top  12, h 218  -> clipped     title top 261 -> INVISIBLE
fields  top 288, h 144  -> INVISIBLE (Owned · Drive · Size)
```
A tracker tile has no picture, so 200px holds its label and fields; a media tile's poster alone is
taller than the whole tile — and `overflow: hidden` meant the fields were **unreachable, not merely
cramped**. Reported to the user, who chose *"make it larger than to see the fields"*.
`childMaxHeight` is now **440**, taken from the tiles' own rendered `scrollHeight` (p90 and max both
**432**) rather than picked — and **only the pictured boards are raised**, because Games and Comics
have no artwork and already fit the tracker height. That split IMPORTS `0248`'s coverage rule
rather than restating it.

**Verified by looking, which is what a layout claim needs:** 184 x 437, content 437 with nothing
clipped, 2 per row, and the full poster, `John Wick`, and every field on screen — `Owned · Drive:
Odin · Size: 45.0 GB · File Path · Year · Board Category`. **0 page errors.**

**A PROBE BUG OF MY OWN, worth recording:** `page.waitForFunction(fn, { timeout })` passes the
options object as the **ARGUMENT** — the signature is `(fn, arg, options)` — so every "240s
timeout" in these probes had silently been the 30s default. It only bit once a pm2 restart put the
grid into a cold Atlas read. And a tree walk clicked the *pinned* "Media" folder instead of the one
under Boards, which is why three boards read "no tree row" before the walk was indexed.

**NOT SEEN ON SCREEN, and stated plainly:** Games and Comics. Their tree rows were not reachable
from Boards/Media, so their tiling is confirmed in the DATA (`mode=wrap · w=184`) and has not been
looked at. Their rows carry no picture, so they compose exactly like a tracker tile.

1,719 server tests, poms grid **0 errors**, pm2 restarted.

---

### 2026-08-25 (5) — ONE TOGGLE DID O(GRID) WORK 51 TIMES, and the fix is real but is NOT the fix

Continued item 10. The lag was root-caused further, a genuine cause was removed, and **the
complaint is still not fixed — said plainly rather than dressed up.**

**THE AMPLIFIER, MEASURED OVER THE WIRE.** One `Completed` toggle:
```
outbound  26 update_occurrence
inbound  127 frames — 76 transaction_created · 26 occurrence_persisted · 25 occurrence_updated
           of those transactions: MeasureOp 51 · SnapshotOp 27
```
**Every one of the 51 MeasureOps ran the toast block, which is O(GRID)** — `fieldsById`,
`modulesById` (**6,557** modules), a **21,000-key spread** of `occurrencesById` and a
**21,000-occurrence parent reverse map**, built BEFORE the code knew whether a toast would be
shown at all. Millions of operations and 51 large short-lived allocations of GC churn per click.

**THE HANDLER HAD ALREADY DIAGNOSED ITSELF.** Its `SnapshotOp` early-return says *"the toast
machinery below is O(grid) per transaction … that work would run on every keystroke-debounced doc
save"* — and MeasureOps went straight through it. *A guard written for one type is a guard for one
type; the comment naming the cost is not the fix.*

Lookups are LAZY now, `fieldsById`/`modulesById` are cached **on the identity of the array they
came from** (the reducer swaps those arrays per write, so identity IS the version —
`previewSubtreeIndex`'s trick), and the 21k spread is **gone**: it only ever served single-id
lookups.
```
                  BEFORE          AFTER
click -> paint    4117ms          3468ms       -16%
long tasks        104 / 10547ms   33 / 9492ms  -68% by count
longest task      3605ms          3392ms       barely moved
DOM mutations     4163            3275         -21%
```
**THE USER STILL WAITS ~3.5 SECONDS.** Two thirds of the long tasks are gone and the thing they
complained about is not fixed. Offering the 68% as the answer would be a lie.

**TWO OF MY OWN THEORIES DIED BY MEASUREMENT, and recording them saves the next session the trip:**
- *"the 51 echoes each re-fire the op sweep"* — **2** sweeps per toggle (979ms + 102ms).
  The executor's cycle breaker already handles it.
- *"a hot-path component subscribes to a churning slice"* — `ModuleInstance`, `ModuleContainer`,
  `Field`, `FieldRenderer`, `ArtifactCard` are all already on per-slice selectors, and the
  suspicious `s.getOccMap || (() => …)` fallbacks never fire, because `App` provides a stable
  `useCallback([])` getter.

**WHAT REMAINS, NAMED PRECISELY:** the longest task is ~3.4s, of which ~1.1s is legitimate ops — so
**~2.3s is React render + effect application in ONE synchronous task**. The lead is `ModulePanel`,
which subscribes to **`occurrencesById`** (rebuilt on every occurrence write), so all three mounted
panels re-render on each of the ~26 writes — which is exactly why 52% of the DOM mutations landed
in panels unrelated to the toggled row. It genuinely needs occurrence data, so the fix is narrowing
that subscription to the panel's own subtree, not swapping in a non-reactive getter.

6 tests (3 cache, 3 strict toast — the label still carries the module label, the field name AND the
walked chain, which is the positive control for the two "pushes nothing" cases). Four A/Bs, each
failing exactly one test. 3,336 client tests; the same 8 pre-existing failures. Deployed, prod HEAD
verified.

---

### 2026-08-25 (4) — the op that was already gone, tiles the data earned, a clock that never existed, and a lag that is not the ops

Picked up the other account's session, which hit its limit mid-probe on item 8 with an audit
script written and never run. Four queue items closed, one filed with numbers.

**ITEM 8 — "get rid of the schedule canvas AND THE OP FOR IT", and there was no op.** `Canvas:
Build` was retired 2026-07-07 for an occurrence FEED, and the seed still says so in its own
comment. Measured rather than trusted: **no operation on poms grid mentions the canvas at all** —
not by name, not by occurrence id, not by module id, not by any of its 29 children's ids. The
thing that still RAN for that page was the `feed`, and **a feed is a field ON the occurrence**, so
deleting the page deleted the op. Worth stating plainly, because hunting for an Operation record
and finding none reads exactly like a missed step.

**DELETING 29 CHILDREN DESTROYED NOTHING, and the control is what makes that claim worth
anything.** All 29 are feed copies whose sources live outside the canvas, and every copy's fields
are byte-equal to its source — but comparing copies to their own sources read `0 differ`, and so
did the Schedule Table arm. **Both arms zero is the documented tell.** Re-run with each copy paired
against the NEXT copy's source: **27 differ**. Only then did the 29/29 mean anything.

**AND AN A/B RETIRED A GUARD I WROTE ON REFLEX.** `orphanModuleId = placements === 1 ? … : null`
fails **0 of 11** tests when removed — provably subsumed, since any second placement of that module
is itself a `page/canvas` labelled "Schedule Canvas" and the ambiguity refusal returns first. Gone,
with the reasoning left in its place. Panels unlisted with `$pull`, never a whole-array write.

**ITEM 13 (new, mid-session) — media tiles, and the DATA had changed the answer.** `mode: "wrap"`
has laid children out as a wrapping row since 2026-08-10, so this was data plus one real gap.
2026-08-25 refused to tile the music and book boards on a rule worth keeping — *"a tile with no
picture is a taller row"* — and `0245`'s posters changed that fact for exactly two boards:
```
Movies 993 · 989 pictured 100%   TV Series 187 · 183  98%   <- tiled
Games    4 ·   0            0%   Comics      5 ·   0   0%   <- REFUSED
```
**Games and Comics are the discriminating case.** Same import, same folder, and the word "media"
describes them perfectly — TMDB is a film/TV database, so neither has a poster. Selecting on the
WORD would have turned 9 rows into empty boxes; selecting on PICTURES does not.

**AND `childMaxWidth` WAS INERT — the ask named the exact gap.** A declared cascade key the Layout
menu offers as "Col max width", read by **`PageBoard` only**: set it on a container's wrap tiles
and nothing moved. Published now, defaulting to `100%` rather than the fixed `--child-w`, which
also fixes a case nobody had configured around — a 150px tile in a narrower panel column
OVERFLOWED it instead of shrinking. Verified live: `flex-direction: row`, `flex-wrap: wrap`,
`max-width: 150px`, 160/160 posters loaded, 0 page errors.

**ITEM 9 — "what happened to my time fields" — NOTHING WAS DELETED, THEY NEVER EXISTED HERE.**
The contrast with a fresh grid is the whole diagnosis:
```
test grid 2   183 fields   carrying meta.liveSource: 2   "Now" · "Time Left"
poms grid     290 fields   carrying meta.liveSource: 0   <- none, at all
```
poms grid's `Now` module is **not the seed's** — it was minted by the 2026-07-30 Stats restructure
— so it only ever carried the bindings later passes gave every tracker tile. **The renderer was
read BEFORE minting anything**, because a field carrying a key nothing reads is this repo's
most-repeated defect: `Field.jsx:497 useLiveFieldValue` implements both sources and ticks on a
`setInterval`. Resolved by `meta.liveSource`, **not by name** — the field, the module and the
occurrence are all called "Now". Verified ticking on the live grid: `2:41:15 PM -> 2:41:18 PM`,
`Time Left 09:18:44 -> 09:18:41`. **My first probe read `labels: []` and that was the probe** — I
had restarted pm2 seconds earlier, so the load hit the cold Atlas read.

**ITEM 10 — THE LAG IS NOT THE OPERATIONS, and the trigger layer is exonerated.** Reproduced:
```
click -> paint 4117ms / 6425ms    total blocked ~6.5s
104 long tasks summing 10547ms — ONE of 3605ms, then ~103 of 60-200ms
4163 DOM mutations, for toggling one checkbox
```
The first suspect was spurious op fires. It is wrong: **every `onChange` trigger is field-scoped
and ZERO fire without a target**, so the 27 ops that run are exactly the 27 that declare an
interest in `Completed` — and they are only **1225ms of ~6500ms**. Attributing the mutations by
panel names the real cost:
```
toggling ONE checkbox in panel U18hAEwP mutates
  U18hAEwP 2337   <- owns the row      _PkuNAJp 1458   u07qnz_n 1123   <- unrelated panels
```
**52% of the work lands in panels that have nothing to do with the row.** That is the documented
frame-1 / app-wide re-render docket item with numbers on it at last, and the media import made it
worse: an open media board keeps 80 image tiles mounted that re-render on every unrelated write.
**Filed, not fixed** — batching effect application and cutting the render fan-out is a change to
the shared write path this repo has repeatedly been damaged by.

**AND MY PROBE DAMAGED LIVE DATA, reported rather than hidden.** The untick re-queried the DOM
after a re-render and found a DIFFERENT switch, so two schedule rows were left ticked. Both were
put back through the UI so the tracker ops reversed, and read back out of Mongo: `Completed=false`,
`Completed On=null`. *A probe that edits is a probe that can damage* — and the fix is to target the
occurrence id, never "the first matching switch".

**ITEM 7 — the folder pill was exactly inverted.** The whole pill navigated to the folder page
while expansion lived on a chevron **8px wide at 0.35 opacity**, so the common action was a
pixel-hunt and the rare one fired on any stray click. The pill toggles now and a `Layout` button
opens the page; **a folder with no children falls back to opening the page**, since there is
nothing to expand and a click that visibly does nothing reads as broken. The button is **always
visible** unlike the `+` beside it — it is the only route to a folder page and a hover-only control
is unreachable on touch. **Both folder rows changed**: `LocalFolderGroup`'s own comment says it must
mirror `FolderNode`.

`0247` · `0248` · `0249` applied, each read back out of Mongo. 1,678 server tests; 3,297 client
(**the 8 failures in `weekdayTasks` + `trackerFollowsPageFilter` are PRE-EXISTING and A/B'd against
stashed source — identical 8**). poms grid **0 errors**, 1 pre-existing warning. Deployed twice,
prod HEAD verified, `--child-max-w` present in the served CSS with `--child-w` as the control.

---

### 2026-08-25 (3) — `fileRef` LIVES ON THE MODULE, and there is one module for 993 films

User, after the TMDB posters landed: *"make it have the fileRef"* and *"it should able to hold
multiple files"*.

**THE OBVIOUS PLACE IS IMPOSSIBLE, AND MEASURING IS WHAT SAID SO.** `fileRef` is a MODULE field,
and `0238` mints ONE SHARED module per kind:
```
occurrences   movie 993 · series 187          artifact modules by kind   movie 1 · series 1
```
Writing the poster there gives all 993 films the same picture — the exact trap `0245` hit one
level up, which is why the cover went on the OCCURRENCE. So the ask cannot be answered by putting
a value on the row; it needs a per-row thing to put it ON.

**SO THE POSTER BECOMES ITS OWN ARTIFACT, and that answers BOTH halves at once** (`0246`): a module
with a real `fileRef`, plus an occurrence of it **parented to the row AND listed in the row's
`occurrences[]`**. A real file, and a row that holds N of them.

**IT IS A CHILD RATHER THAN THE `Files` FIELD, and reading the resolver is what decided that.**
`occurrenceMedia.filesOf` collects from THREE sources — the media field, the `Files` field, **and
`occ.occurrences`**. The child list needs no field, no binding and no `role:"files"` plumbing on a
module 993 rows share — and it is already how `0061` attached a favicon to a bookmark:
*"parented to the bookmark AND listed in its `occurrences[]` … An instance does not render its
children, so it stays out of the row while appearing in the bookmark's own file spread."*

**BOTH EDGES ARE WRITTEN, and neither is decoration.** The delete cascade walks the child LIST, so
a parented-only poster is orphaned the moment the row goes; a listed-only one has no home.

**THE CARD FACE IS DELIBERATELY UNTOUCHED.** `meta.cover` still draws the thumbnail —
`primaryMediaOf` reads the media-role BINDING, not children, so clearing it here would blank 1,172
cards to buy nothing. **The cover is the FACE; the child is the FILE.** Two questions, two answers.

**READ BACK OUT OF MONGO RATHER THAN OFF THE LOG:**
```
poster modules 1172   every one an https://image.tmdb.org fileRef, role:artifact kind:image
poster occurrences    parented 1172 · listed by that parent 1172 · BOTH 1172
covered rows with no artifact child   0
rows owning MORE than one poster      0      <- where a double-run would show
```
A forced re-run plans **0**. poms grid **0 errors**, 1 pre-existing warning.

**AND A BROWSER IS WHAT CHECKS THE PART THAT MATTERS — the row must not GROW.** Attaching a file to
every row is only safe if nothing renders it inline. On the live grid: 80 movie rows on screen, **80
TMDB images all loaded, exactly 1 artifact card per row, and 0 of the 1,172 poster occurrences
rendering as a row anywhere.** Attached and invisible, which is what `0061` predicted and what no
assertion in the suite could have seen.

**MY FIRST TWO PROBES BOTH READ ZERO, AND BOTH WERE THE PROBE.** `?previewOcc=` mounts
`PagePreviewApp` — a different app that never sets `__moduli_state__` — so "0 movie rows" was a
statement about which bundle I had loaded. *A zero is a claim about the probe until it has been
shown reporting non-zero*, for the Nth time.

**THE 8 ROWS WITH NO POSTER KEEP NONE** — comedy specials, lecture series, one `_FAILED_` download
name. TMDB does not have them, and an empty file is worse than no file.

The selection rule is an exported pure planner (the `0048` shape) rather than inline in `up()`, and
the extraction was verified faithful by re-running the dry run to the same 0 / 8 / 1172. 7 tests,
**4 A/Bs with every mutation asserted to LAND first** — dropping the already-owns guard, dropping
the no-cover refusal, counting any child rather than an artifact child, and preferring the shared
module's label each fail EXACTLY one. 1,667 server tests. **No client code changed, so no bundle is
owed** (the 2026-08-13 (3) rule); pm2 restarted, since the warm cache is authoritative for reads.

---

### 2026-08-25 (2) — media.md becomes boards; and the ops question found a bug the import did not cause

Picked up the other account's session, which hit its limit mid-edit on
`parseMediaMd.mjs` under the standing instruction *"use the ~/media.md file to fill
in the remaining medias"*. **Its in-flight edit was two lines from done and inert
until finished:** it had declared an `IGNORE` symbol and written the comment
explaining why three states are needed — and never assigned it. So 73 "unparsed
tables" were really the DATA ROWS of tables it correctly skipped. Assigned, and the
parse now matches the document's own totals exactly: 994 movies, 192 series, 147
artists, 4 games, 1,849 documentaries, 0 unknown tables.

**MY FIRST OVERLAP PROBE WAS WRONG BY 442 ROWS, AND IT WAS CONFIDENT.** It reported
**44** of media.md's 676 books already on the grid. media.md truncates book titles
at ~34 characters and appends a `(NNN)` count:
```
grid  "Watchmen"                              media.md  "Watchmen (217)"
grid  "Become What You Are: Expanded Edition"  media.md  "Become What You Are_ Expanded Editi (152)"
```
Re-measured with a truncation-aware prefix match: **227 exact + 237 prefix = 464
present, 212 new.** Importing on the first number would have doubled a board that
already holds a clean catalogue. *A count is a claim about the NORMALISER until both
sides have been read side by side.*

**AND THE OBVIOUS FIX WAS WORSE THAN THE BUG — the test caught it.** Stripping the
trailing parenthetical everywhere deletes the YEAR:
```
movie titles ending in a year   865 of 994      grid movies  none exist
album titles ending in a year   298 of 299      grid albums  0 of 2,757
book titles with a trailing (N) 869 of 1,108    grid books   0 of 666
```
A blanket strip merges `The Ring (2002)` into `The Ring (1927)`. **So the LABEL and
the MATCH KEY are different things** — which is also what the user's *"dont put the
year in the title in our system"* needs. The title loses the suffix (and that
matches what the Books and Albums boards already look like); films keep it in the
KEY because there the year is identity; and it lands in a `Year` field rather than
being deleted off 1,163 rows. Four A/Bs, each failing exactly its own tests.

**3,579 ROWS, AND WHAT MERGES IS AS DELIBERATE AS WHAT DOES NOT.** Movies, TV
Series, Documentaries, Games and Comics get boards; books, artists and albums merge
into the boards that already hold them, because a second Books board beside the
Calibre one splits one library in two. `artifact`, not `instance`, inheriting
`0222`'s measured decision. **`Files` and `Location` are NOT reused despite the
names** — both are `occurrence` fields, so a path written there stores a string
where a row reference belongs.

**READ BACK OUT OF MONGO, NOT OFF THE LOG — and that is what found the defect.**
18,177 -> 21,766 occurrences: 3,579 rows plus exactly the 10 occurrences of five
boards; 0 unlabelled, 0 unparented, 0 duplicate keys; 3 of 3,579 labels still end in
a number and all three are genuine title text. **And 8 documentary rows carried a
`Year` on a module that does not bind Year** — stored, reported as written,
rendering nowhere. `0238` now writes Year only where it is bound, and `0239` sweeps
the CLASS rather than patching the 8.

**THE TRACKER IS ONE PASS, NOT SEVEN** (`0239`, user: *"put how much media i own of
what"*). Seven counts as seven ops is the shape `Schedule: Fill Day` had — 198,009
evaluations for zero effects. One loop, seven counters, gated on `Owned IS true` so
the tag checks only run for rows that already qualify, and **onLoad only**: a media
count is a fact about the library, not about the date on screen.
```
Movies 749 · TV Series 103 · Documentaries 1822 · Games 4 · Comics 5 · Books 878 · Albums 271
```
**Albums counts the 271 local rips, not the 2,757 Spotify rows** — those are a
streaming library rather than files, and the field name is what keeps that honest.
The 666 Calibre books ARE backfilled, because `0226`'s source was the same kind of
thing: a survey of files on disk.

---

**"MAKE SURE THE OPS STILL WORK FOR IT" — MEASURED, AND IT FOUND A LIVE BUG THE
IMPORT DID NOT CAUSE.** Regenerating the fixture and running the suite failed with
`Daily Question Rotator: $journalingInst is not a record (no .id)`.

**The import provably cannot be the cause**, and the reason is the artifact
decision: the op FINDs over `$allInstances`, which is ROLE-FILTERED.
```
occurrences of the "Journal" module    committed fixture 1 -> binds a record
                                       today             2 -> binds an ARRAY, UPDATE throws
```
The second is `9:00pm < Routine < Schedule Template` — the Routine layer. **So the
op was always wrong:** `FIND templateId IS <module>` unscoped asks *"THE occurrence
of this module"* of a RECURRING ROUTINE. `0240` pins it to the occurrence it already
resolved to for as long as it worked, picker-direct, resolved STRUCTURALLY and
refusing if ambiguous. **It restores rather than chooses** — which Journal should
carry the question is the user's call.

**WHICH OPS ACTUALLY PAY FOR THE IMPORT, measured rather than asserted:**
```
collection        sites  ops   rows walked   media rows in it
$allInstances        66    34          1168   0      <- unaffected
$allContainers       61    16          1381   5      <- just the new boards
$allItems            24    19         21766   3,579  <- 143,160 extra iterations/sweep
$allOccurrences      16     4         21766   3,579
```
**THE OBVIOUS OPTIMISATION IS WRONG, AND CHECKING IS WHAT SAID SO.** Switching those
23 ops to `$allInstances` would drop the media rows AND the ~13,000 pre-existing
artifacts, leaving the sweep faster than before. But under one scope **50 of 77
matched rows are `container`** — the swap would silently stop those loops seeing
containers. Per-op work, filed with the measurement rather than done hastily.

**AND A TEST ASSERTED THE WRONG INVARIANT**, found by `0240` failing it.
`partialBackup` required every scoped migration's `touches` to CONTAIN `"fields"` —
true only because every migration so far happened to. `0240` rewrites an operation
and touches no field. It now checks what `backupGrid` actually requires, which is
STRICTLY STRONGER: the old form passed `["fields","occurrance"]`, the new one
rejects it.

**THE REFRESHED FIXTURE IS RED IN TWO SUITES, AND THAT IS REPORTED RATHER THAN
HIDDEN.** The committed fixture predated ~30 migrations (`0219`-`0237`), so
refreshing it surfaced drift unrelated to this work: `weekdayTasks` (6) and
`trackerFollowsPageFilter` (2). **Ruled out as mine three ways** — the imported rows
are artifacts while those ops walk `$allInstances`/`$allContainers`; the failures
reproduce on a fixture built BEFORE `0239`/`0240` ran; and the source row, day
column, ancestry, roles, named filters and the `weekday:` token are identical or
correct across both. `Schedule: Place Weekday Tasks` emits **0 effects** with no
error, and every gate checks out individually — that is where it stands, and it
wants its own session. Committing the stale fixture instead would have been a green
suite over a grid that no longer exists.

**AND THE COLD READ DID NOT GET WORSE — the projection was worst-case.** I predicted
~225s from the ~100 KB/s throttle. Prod's own boot log, same day:
```
Occurrence query: 178396ms (18177)   an earlier boot, BEFORE the import
Occurrence query:   2816ms (21849)   this boot, AFTER it
```
The throttle is bursty rather than constant. `🔥 prewarm done and PINNED`.

1,652 server tests, poms grid ops suite **16/16**, poms grid **0 errors** (1
pre-existing `unused-field` warning), pm2 restarted. **No client code changed, so no
bundle is owed** — the `git diff --name-only` rule from 2026-08-13 (3).

---

### 2026-08-25 — the column layout was never a TILE; and the media with no pictures

**THE AUDIT THE USER ASKED FOR, and it found the option present and its meaning
broken.** `childContentDirection` is a `SURFACE_SHAPE_KEYS` cascade key, the
Layout menu edits it ("Title beside fields" / "Title above fields"), and
`ModuleContainer` publishes `--instance-content-direction`. But since
`b165d33c` the row is `[handle][textcol: label over fields]` — so "title above
fields" IS the default, and choosing `column` stacked the DRAG HANDLE above the
text. Third time in two days that CSS outlived the DOM it was written for.

**A STACK IS NOT A TILE, and both gaps are CSS rather than DOM.** The media block
is authored LAST (in a row it is a full-width band under the fields), so stacking
put the picture at the BOTTOM — `order: -1` lifts it; and the handle is the first
flex child, so in a column it eats a line — it floats to the corner, which is
what `floatHandle` already does for canvas cards. Measured against the BUILT
stylesheet, with the row arm as the control:
```
ROW     label -> handle -> media   labelW 172     (unchanged)
COLUMN  media -> handle -> label   labelW 194     picture on top ✓
```

**WHICH BOARDS GET TILES IS A MEASUREMENT, NOT THE WORD "MEDIA".** A tile with no
picture is a taller row:
```
Readings   9 rows   7 with artwork  -> tiled      song   5490   5 -> NO
Courses    4        4               -> tiled      album  2757   0 -> NO
                                                  artist 1595   0 -> NO
                                                  book    666   0 -> NO
```
The Spotify and Calibre imports carry NO cover art, so tiling them would be ten
thousand empty boxes. **And the Library board is excluded too, which looks like an
omission and is not:** it holds the 8 movies and 5 podcasts, all with artwork —
beside **117 reflection questions**. One board, one layout.

**MOVIES DO NOT LIVE WHERE THEY LOOK LIKE THEY LIVE.** They are not a board
category at all: they are `Library = "movie"`, the same field podcasts use.
`"tv show"` is a declared option with ZERO rows. So "books, tv shows, movies,
music" spans two different systems, and only part of it is tileable today.

**THE TAGS GET THEIR OWN FIELD** (`Media Tags`, 25 options). `Tags` is MIXED — 45
live values, nine wellness dimensions and the rest board categories driving real
pickers — so "sci-fi" would swell every one of those dropdowns. Same call the
Codex import made on 2026-08-23. **Authoring the values is allowed here for a
reason that does not generalise:** a genre is a stable public property OF THE
WORK, the class `0123` used to justify a food's vitamin content while refusing
its price. Never overwrites, so a re-run fills gaps only.

**Read back out of Mongo:** 39/39 tagged, **39/39 modules BIND the field** (a
value with no binding renders nowhere — the `0047` half), **0 stored values
absent from the option list** (which would render blank and be written away), and
the Library control still reads `mode=-`.

**A TEST FAILED AND IT WAS A TIMEOUT.** `loadMigrations` imports every migration —
245 now — and crossed the 5s default under parallel load when 0236/0237 landed. It
passes in isolation, so the budget was raised rather than the assertion trimmed.
*A red test is a claim about the test until you have read WHY it went red.*

**AND `0236` CLOSED THE PROVIDER GAP — one mapping would have shipped INERT.**
iTunes' `Rating` is `contentAdvisoryRating` ("Clean"/"Explicit"), not stars, so
pointing it at the 1-5 `Rating` field would be refused on every pick while reading
as configured. A/B'd through the real mapper against the live config:
```
SHIPPED (Content rating)   wrote=1  -> "Explicit"
NAIVE  (star Rating)       wrote=0  -> SKIPPED: "Explicit" is not a number
```
**I proposed the naive mapping myself**, in the question I asked the user. The
key's NAME is not evidence about its VALUE.

**AND THE COLD READ IS OFF THE CRITICAL PATH.** The prewarmed grid is PINNED
against eviction (user: *"keep it warm indefinitely"*), so the ~184s Atlas read
happens once per PROCESS rather than once per idle gap — the 12h TTL still meant
most mornings paid it. Verified on prod: `🔥 prewarm done and PINNED`.

**REPORTED, NOT DONE — the user's call:** movies and podcasts need boards of their
own before they can be tiles, and the music/Calibre boards need cover art fetched
before tiling them means anything.

---

### 2026-08-24 (3) — CSS that outlived its DOM, twice; and 39 folders that could not draw a card

Four user reports on one surface, picked up from the other account's session.
**Two of them are the same class of defect: a stylesheet still describing the DOM
that this morning's instance restructure replaced.**

**THE PHONE WAS UNUSABLE BECAUSE `flex-direction: column` NOW MEANS SOMETHING
ELSE.** The `max-width: 600px` block flipped `.instance-content` to a column so
fields would stack under the label — correct when the row was
`[handle][label][fields]`. `b165d33c` made it `[handle][textcol]`, so stacking is
the default at every width and that override now stacks the **DRAG HANDLE above
the text**. Measured against the BUILT stylesheet at 390px, with the deleted rule
re-injected as the control:
```
BEFORE (live)   dir=column   label 22px BELOW handle   rowH=72
AFTER  (fixed)  dir=row      same line                 rowH=50
```
Every row 44% taller, a whole line spent on the handle. **This is the third place
today CSS outlived its DOM** — `549e779b` fixed the wrap tile's header, `3040cf4b`
fixed tracker tiles, and this is the same defect on every phone row.
`.instance-content:has(> .instance-fields)` went with it and had ALREADY stopped
matching: the fields are inside the textcol now, not a direct child.

**"NOT SEEING THE DOCUMENTS OR MEDIA FOLDERS" WAS NOT DATA LOSS.** A sub-folder
renders as a card only if it CONTAINS a `kind:"folder" role:"page"` occurrence —
that occurrence IS the card. Measured on poms grid:
```
folders 54   with a folder-page occurrence 15   MISSING one 39
```
Root/Documents, Boards/Media, Media/Music, Media/Books, all 11 Interests, all 8
Codex subfolders. **The sidebar reads `foldersById` directly, so the tree showed
all 54 while the folder page showed 15** — which is exactly why it read as loss.
Minted on view now, the pattern `handleFolderClick` and `ensureArtifactPageOcc`
already use. **The gap is computed with the RENDERER's predicate, not
`ensureFolderPageOcc`'s** — that helper keys on `meta.folderPage`, the renderer on
module kind+role, and minting off the helper's test would duplicate a page for
any folder whose occurrence lacks the flag.

**THE FOLDER PAGE FROZE BECAUSE AN INERT PROP WAS NEVER WIRED.** The
IntersectionObserver fires for every card above the fold in ONE tick, so all of
them mount a full `PagePreviewBody` in one synchronous task and nothing can paint
or take a click. `loadIndex` had been passed by `PageFolder` and read by nothing.
**A shared queue, not a per-card `setTimeout(index * N)`**: a per-card delay is a
GUESS at how long the card ahead takes — guess low and the mounts overlap again.
The first version shifted the entry off the queue at SCHEDULE time, so a card
that scrolled away could never give up its turn; its own test caught it.

**A BARE `<img>` LAYS OUT AT THE SIZE OF ITS ALT TEXT.** That is both halves of
*"placeholder text instead of a loading circle"* and *"the loading box should be
the size of the image"* — one line of markup. `LoadingImage` already existed and
`ArtifactCard` already used it; the image PICKER and the full-size VIEWER never
adopted it. The viewer reserves the real box from `meta.width`/`meta.height`
(stamped by the server's EXIF pass) and **falls back to a square floor rather than
guessing an aspect** — a guessed ratio jumps just as badly, the other way.

**THE ATLAS THROTTLE IS BYTES, NOT DOCUMENTS — and that has a code fix after
all.** `a5ef85aa` left "a tier upgrade or a `full_state` that ships less" as the
only remedies. Two theories died on the way to a third: cursor BATCHING is not it
(ping 31ms, total flat across batchSize 101 / 1000 / 5000), and the throttle is
not per-document either — throughput is flat in KB/s and scales with payload:
```
full documents        107 docs/s      projection (8 keys)   246 docs/s   2.3x
projection (id only) 2404 docs/s      countDocuments        39ms / 18,177 (covered)
```
~100 KB/s in every arm. 18,177 x 849B = 15.4MB, i.e. ~180s. **Measured FROM THE
DROPLET too — 99 docs/s, 102 KB/s, projected 184s — which is what rules out a
laptop's network and pins it on the cluster.** Prod's own log agrees to the
second: `Occurrence query: 178139ms (18177)`.

**PROJECTION IS NOT THE LEVER, and measuring said so before any was written.**
The weight is `fields` 28% + `meta` 18% + `textmap` 10%, all needed to render;
the keys the client provably never reads (`_id`, `timestamp` — grep 0 sites,
while `userId`/`gridId`/`createdAt` ARE read) are ~8%. 180s to 165s is not a fix.

**SO THE FIX IS WHEN THE READ HAPPENS.** `full_state` is served entirely from the
warm cache, so the cold read only happens when that cache is empty — and both
ways it empties were avoidable. The server now PREWARMS the most recently updated
grid at boot, and the TTL went **30 minutes -> 12 hours**. That second half is the
bigger one for daily use: the old value meant coming back from lunch cost a full
cold read, to reclaim 15MB.

**THE DEDUPE IS WHAT MAKES PREWARM SAFE, and prod demonstrated it live** — a tab
reconnected first and the prewarm JOINED its in-flight load rather than starting a
competing read: `loadGridIntoCache START` appears exactly **once** since boot,
followed by `🔥 prewarm done`. For that grid a prewarm can never be slower.

**Said plainly: this does not make the read faster.** 184s of Atlas time is still
spent — spent while nobody waits on it. A genuinely cold, urgently wanted grid
still waits, and THAT still wants an un-throttled tier or a lighter `full_state`.

**LINT CAUGHT A MISSING `useEffect` IMPORT before it shipped** — the 2026-08-23 (6)
guard earning its keep: a build resolves imports but not undefined locals, and no
test mounts these components. TDZ checked too (the deps are declared at 99-101,
the effect at 329).

**THE 4 UNMAPPED SEARCH PROVIDERS ARE UNMAPPABLE TODAY, and measuring is what
says so.** All 11 are enabled; Supplement (DSLD), Podcasts Listened (iTunes),
Song (MusicBrainz) and Purchase Item (Open Food Facts) carry no field map — and
authoring one for any of them would ship something inert or wrong:
```
Song           MB gives Artist/Released/Type      Artist + Album are type OCCURRENCE
Purchase Item  OFF gives Brand/Categories/Quantity Quantity is a NUMBER; OFF sends "454 g"
Supplement     DSLD gives Brand/Form/Ingredients…  none of those fields EXIST on the grid
Podcasts       iTunes gives Publisher/Genre/…      none of those fields EXIST on the grid
```
**`occurrence` is not in `WRITABLE_TYPES`** (text/number/duration/select/rating/
address/date), so mapping MusicBrainz's `Artist` — a NAME STRING — onto the Song
board's Artist field would produce a map `mapProviderFields` silently SKIPS. And
OFF's `Quantity` is the case 2026-08-24 already refused: a package size where ours
is the shopping total, into a number field that cannot hold `"454 g"` anyway.
**Two of the four need fields MINTED before a map means anything**, which is a
product decision rather than a migration's — the `Latitude`/`Longitude` call from
2026-08-24, reached from the other side.

**AND MY FIRST PROBE ANSWERED THE WRONG QUESTION CONFIDENTLY** — it matched every
occurrence that merely CARRIES `Board Category` and hit its own 400-row cap on
Books, so all four boards came back reporting `Author, ISBN, Series`. The tell was
`modules=1` on four unrelated boards. Read the dropdown's real predicate
(`CONTAINS "supplement"`, `IS "podcast"`, an OR of seven for Purchase Item) and
the counts became 7 / 5 / 5490 / 61.

**A PROBE THAT LIED, and the control is what said so.** The served-CSS check read
"fix gone" AND "control missing" — both absent is the documented tell. Two faults:
the shell cwd had persisted into `client/`, and **the minifier rewrites
`flex: 0 0 auto` to `flex:none`**, which the control regex never matched.

3312 client tests, build clean, deployed and verified — prod HEAD matched, index
and bundle 200, served CSS **sha256-identical** to the local build with the fixed
rule absent and two controls present.

**AND THE 12px FLOOR SHIPPED IN THE SAME SESSION — 138 SITES** (105 inline, 33
CSS), scoped to the grid surface and NOT to Command Center / editor chrome, which
is not writing on the grid. **The single most important one is a CSS rule:**
`.doc-editor-content.ProseMirror` was 11px — the body text of every doc and
textblock on the grid, i.e. the literal subject of the request.

**A BLANKET BUMP FLATTENED A TYPE SCALE, caught by reading the diff.**
`RepresentationView`'s variants went `sm: 9 → 12` and `md: 11 → 12`, so the three
sizes stopped being a type scale and became a padding scale. The floor is a
FLOOR, so the upper steps moved with it: 12 / 13 / 14.

**THE HEADING SCALE IS DELIBERATELY UNTOUCHED** — `{1:18 … 5:12, 6:12}` has
nothing BELOW 12, so it already satisfies the rule. Clearing h5/h6 off body text
would mean pushing h1 back toward 22, which 2026-07-31 (6) lowered to 18 because
it marqueed continuously in a 360px column. Trading a known regression for a rule
already met is a bad trade; the flattening is recorded rather than fixed silently.

**THREE RULES LEFT AND NAMED:** `.toolbar *` (8px), `.panel-header button` (8px),
`.mobile-rail-label` (10px) — app chrome, and the first two live in the 390px
block whose job is fitting the toolbar, where a 50% type increase risks
overflowing the thing it compresses. The user's call, not a silent widening.

**VERIFIED WITH A CONTROL THAT PROVES THE PROBE CAN FAIL:** 13 grid surfaces read
12px against the BUILT stylesheet at 390px while the excluded toolbar button read
**8px** in the same run. Its first pass mislabelled that control (keyed on
`className`, the control carried an `id`), so a correct 8px reading was filed as
a grid failure — the number was right and the classification was wrong.

---

### 2026-08-24 (2) — I ran the user's OWN DATA through a provider that was only meant for new adds

User, after `0232` shipped: *"wait you didnt have to run my stuff through there.
this was just for future adds."* **They are right and the call was mine.**

The ask was to wire a provider so a NEWLY picked medication arrives filled.
`0232` did that — and then went further and wrote openFDA's answer onto three
rows they had entered by hand. The values were correct; that is not the point.
**Reaching into existing data is a different act from configuring what happens
next**, and nothing in the request covered it. `0234` clears the values and the
bindings and **keeps the fields and the map**, so tomorrow's pick still arrives
filled and the board carries only what the user put there.

*The reusable half: when a request is "wire this up", the blast radius is the
NEXT thing that happens — not the rows already sitting there.*

**AND "idk why vitamin d isnt in there though" WAS A CATEGORY MISMATCH.** `0219`
paired Supplement with openFDA, which indexes FDA-regulated **DRUG** labels.
Dietary supplements are regulated as FOOD, so they have no drug label and are
not in that database at all. The answers were not noise — they were correctly
indexed drugs answered to a supplement query:
```
"Creatine"  -> Colotox                 a homeopathic remedy
"Vitamin D" -> Silicea                 a homeopathic remedy
"Fish Oil"  -> Benzalkonium Chloride   antibacterial hand soap
"Magnesium" -> Esomeprazole Magnesium  an acid reducer
"Zinc"      -> Zinc Oxide              diaper cream
```
**Open Food Facts was measured as the alternative and is only HALF right** —
Creatine is perfect there, Vitamin D returns fruit juice and protein bars. So
the answer was a third database rather than either of the two already wired:
the NIH Dietary Supplement Label Database, free and keyless.

**TWO DECISIONS IN THE NEW PROVIDER, BOTH FROM MEASURING 25 HITS PER QUERY:**
```
query        hits   on-market   after dedupe
creatine       25      14           12
vitamin d      25       4            3
fish oil       25      15            9
```
**DSLD is an archive as much as a catalogue** — most of what it returns is
discontinued, and offering a supplement nobody sells is worse than offering
nothing because it looks exactly like a real answer. **It FAILS OPEN**: if the
filter empties the list the archived rows come back flagged `discontinued`,
because a niche product that exists only in the archive is still the right
answer and silence is not. And **the same product is listed twice** — `Creatine
Alkaline · BPI Sports` is both a current label and an archived one — so rows are
deduped on brand + name, which collapses `fish oil` from 15 to 9.

**THE UNIQUE-FIELD-NAME RULE IS RETIRED IN BOTH PLACES IT WAS ENFORCED.** User:
*"fields dont have to be unique name based by the way"*. `FieldsTab` rejected a
colliding name on Save; `gridIntegrity` warned `duplicate-field-name` — and that
one had been firing on every grid for weeks **on the intended state**. *A checker
that reports what you meant is one people learn to scroll past.* The EMPTY-name
check stays: a nameless field renders as a blank label. What the warning was
really protecting is unchanged — resolving a field BY NAME still matches on name
AND TYPE and refuses when ambiguous.

**The test was INVERTED rather than deleted** (`fieldsTabUniqueName` ->
`fieldsTabNameSave`): the collision case now asserts the save goes through, and
the integrity test gained the discriminating pair — a duplicate OPERATION name
is still an ERROR, because `RUN_OPERATION` resolves by name and that one IS
identity. *A test file that quietly disappears takes the contract with it.*

**The macro-tracker question from 08-22 is answered and needed no code:** it
keeps counting only TICKED meals, so the number keeps meaning "what I ate".

**A TWO-DAY AUDIT ACROSS ALL THREE ACCOUNTS produced the open list**, and
measuring retired most of it: the weekday multi-select, the `Routine` layer and
`Time 1-3` on planks had all already shipped. **And my first probe reported
`Schedule - Saturday` claiming all seven weekdays** — the exact false defect
2026-08-23 (9) records itself making, for the same reason: it printed the MODULE
label where the renderer uses the OCCURRENCE label. The row is `Meals`. *The only
reason I caught it is that this file had written the correction down.*

**REPORTED, NOT DIAGNOSED — one probe, worth a look:** no occurrence on the grid
carries a `meta.fieldVisibility` override any more. `0071` put them on Tasks,
Trackers and Schedule so `Date` would show there while hidden grid-wide. Only
the grid-level rule survives. Stated as a lead rather than a finding.

**Also worth recording: every migration now costs ~10 minutes of pre-migration
snapshot** — the grid is 43MB since the Spotify and book imports. Run them in
the background.

1576 server + 3308 client tests, 0 lint errors on every edited file, prod HEAD
verified with the served chunk sha256-identical and controls non-zero, poms grid
**0 errors**.

---

### 2026-08-24 — the 503 was THEIRS, and `address` was writable all along

Picked up the other account's session, which hit its **monthly spend limit**
mid-probe with two threads open. `0229` had shipped the first field maps and
closed with a list of what it deliberately did not map. **Measuring retired one
of its stated reasons and REVERSED the other.**

**THE OPEN FOOD FACTS 503 IS THEIR SERVICE, NOT OUR REQUEST SHAPE.** `0229`
recorded Ingredient as unmappable because *"Open Food Facts is answering 503 — no
key list to map from"*, and the session was checking whether we were asking
wrongly when it ran out. Six identical curls of the URL our own provider builds:
```
503 200 200 200 503 503        node's fetch behaves identically
```
So the query was always fine and the same one succeeds on the next attempt. Half
of every grocery search was reaching the user as `openfoodfacts 503`.

**MUSICBRAINZ HAD ALREADY GROWN THIS RULE THREE TIMES BY HAND**, which is the tell
that it was never provider-specific — the 2026-08-08 (10) rule applied before a
fourth copy exists rather than after. One `withRetry`, and **its `run` seam is
load-bearing**: MusicBrainz retries THROUGH its 1.1s gate, because an immediate
retry against a 1/sec limit is the very thing that produced the 503. Sleep is
injected, so the tests do not wait.

**A 500 IS DELIBERATELY NOT RETRYABLE.** 429/502/503/504 mean *ask again*; an
ambiguous server error is not a promise of a different answer, and retrying one
triples the load we put on someone else's service for the same reply.
```
live, 8 grocery searches:  7 ok / 1 failed      was ~50%
```
The residual is honest rather than dressed up: the service can be down for a
stretch, and three attempts is the cap because this runs at a keystroke.

**AND `address` WAS NEVER UNWRITABLE — THAT WAS OUR OWN ALLOWLIST.** `0229`'s
other exclusion read *"`Address` is type `address`, which the mapper cannot
write"*. The field can: `readAddress` documents a bare STRING as one of its two
legal shapes, and **ten People rows on poms grid have carried exactly that shape
since long before any provider existed** — that header even says so. A missing
entry in `WRITABLE_TYPES` had been written down as a property of the field.
*A reason recorded in a migration header is a claim about today's code.*

**THE COORDINATES ARE DROPPED, AND THAT COSTS NOTHING TODAY** — the mini-map was
deleted at the user's own request (*"we dont need an image for it"*) and no
surface reads lat/lon. Composing the object would mean this mapper reading
SIBLING keys of the one it was handed: an implicit contract between two files.

**ONLY `Address` IS MAPPED, out of the provider's four keys.** poms grid has no
`Latitude` / `Longitude` / `Kind` field, and minting fields to hold numbers
nothing renders is authoring a feature nobody asked for.

**END TO END OVER LIVE DATA — real provider, the STORED config, the shipped
mapper:**
```
Froedtert Hospital        -> Address = 9200 West Wisconsin Avenue, Milwaukee…
Sixteenth Street Clinic   -> Address = 2906 South 20th Street, Milwaukee…
Milwaukee Public Library  -> Address = 2566 South Kinnickinnic Avenue…
```
**The second one is the point.** 2026-08-20 (2) left that address deliberately
blank because *"Sixteenth Street has several Milwaukee sites, and a plausible
address on a medical appointment is indistinguishable from one the user
entered."* It arrives now because a person PICKED that clinic — which is exactly
the difference between a guess and a choice.

`0230` **imports `0229`'s authoring loop rather than copying it** — that loop
carries the refusals that matter (a field configured for another provider is
skipped, an existing map is never overwritten) and two copies would drift.
Rehearsed on test grid 2, where `Location` carries no provider and it correctly
**skipped**, which is the fail-closed case.

**A whitespace-only provider answer is now refused for EVERY type**, not just
address: writing it produces a field that renders empty while REPORTING as
written — the inert-token class, from the write side. A/B'd; so is the allowlist
entry, each failing exactly its own tests.

**REPORTED, NOT BUILT — and it is the user's call.** Ingredient's map stays empty
and **the reason has changed from "the API is down" to a measured one**: Open
Food Facts answers **per 100g** and the Ingredients board's Calories / Protein /
Carbs / Fats describe **a SERVING** (2026-08-13 (7): *"keep ingrediants at the
quantity of what it needs for a meal. so half cup for brown rice"*). Mapping them
is the vitamin-D IU/mcg mismatch again — plausible on screen and wrong. Its
`Quantity` is a package size (`"454 g"`) where ours is the shopping total, so
that one is wrong too. What would make it mappable is per-100g fields on the
board, which is a product decision rather than a migration's.

**THE STANDING UNIQUE-FIELD-NAMES RULE IS RETIRED BY THE USER** — *"fields dont
have to be unique name based by the way"*, superseding 2026-07-14 (4). **Two
surfaces still enforce it and now contradict them:** `FieldsTab` rejects a
colliding name on Save, and `gridIntegrity` warns `duplicate-field-name`. Flagged
rather than ripped out, because removing a guard is its own decision.

1532 server + 3291 client tests, lint clean on every edited file (one
**pre-existing** unused import cleared on the way), build clean, prod HEAD
verified, served chunk **sha256-identical** to the local build with the new
strings present, two positive controls non-zero and a zero-control at 0. poms
grid **0 errors**, 1 pre-existing warning.

**NOT LOGGED HERE, and worth saying:** the other account's whole 2026-08-24 —
Spotify (8,428 rows), the book library, migrations `0219`-`0229` — left no
CLAUDE.md entries. The commits carry the reasoning; this file does not.

### 2026-08-23 (9) — the freeze was ONE op scanning 1347 containers for slots it had nothing to put in

(8) shipped a correct optimisation that moved the wall clock by nothing and named
the real cost. This is that cost, fixed. `Schedule: Fill Day`, 766ms for ZERO
effects, 40% of the navigation sweep.

```
3 layers × 49 slots × 1347 containers  =  198,009 predicate evaluations per day
template slots that actually HOLD items:  13   (Meals 8 · Routine 4 · workout 1)
```
The per-slot FIND was guarded only by `$tSlotTime IS_NOT_EMPTY` — true for all 49
slots — and its predicate is `parentId IS $dayColId AND time IS <slot time>`: a
scan of every container on the grid to find one of the day column's own children.

**THE GUARD AND THE LOOP READ THE SAME EXPRESSION, WHICH IS WHY THIS CANNOT
CHANGE BEHAVIOUR.** The body under the FIND is `LOOP over $tSlot.occurrences`; if
that is empty the loop runs zero times and no APPLY_TEMPLATE happens, so the FIND
could not have led to any effect. Adding `$tSlot.occurrences IS_NOT_EMPTY` cannot
skip a slot the loop would have filled — the loop reads the very same value.

**IT ADDS A RULE RATHER THAN RESTRUCTURING, deliberately.** Hoisting the day's 49
slots into a var and FINDing over that is ~27× and is expressible — but it depends
on `$dayCol.occurrences` being populated in the overlay at that moment, and if it
ever is not, **Fill Day silently stops filling the schedule.** This is the user's
daily schedule; a one-rule change that cannot alter behaviour beats a larger win
that can. Filed, not built.

**MEASURED ON PROD, same probe and machine:**
```
Schedule: Fill Day        766ms  ->  127ms   -83%
NavigationOp sweep       1873ms  -> 1204ms   -36%
blocked per navigation   3091ms  -> 2050ms   -34%
```
**AND THE SCHEDULE STILL FILLS — the check that actually matters.** Today's column
read back out of Mongo before and after is identical: 49 slots, 12 filled, 31
items, same names.

**A/B 2 SAID MY OWN IDEMPOTENCY CHECK GUARDED NOTHING, so it is gone** — `isTarget`
requires exactly one rule and this adds a second, so a re-run can never match an IF
it already patched. **Second time today an A/B retired a guard I wrote on reflex**
(the other was a `fieldsById` level in the options cache). *Writing a guard is
cheap; proving it can fire is the part that makes it worth keeping.*

**A CORRECTION I OWE, and it is the reusable half.** Mid-investigation I reported
that `Schedule - Saturday` claimed all seven weekdays and called it a probable
defect. It is not: my probe printed the MODULE label while the renderer uses the
OCCURRENCE label, and the row was `Meals` — a layer that correctly applies every
day. *A label is two fields on this grid, and printing the wrong one invents a bug.*

1330 server + 3179 client tests, poms grid **0 errors**, pm2 restarted.

---

### 2026-08-23 (8) — 5.6M predicate evaluations removed, THE FREEZE DID NOT MOVE, and the real cause has a name

Item 10, the user's repeated complaint: *"the schedule is still taking way too
long to be applied. it froze for a second."* The 2026-08-07 profile left it
measured and unfixed — `resolveOptions`'s per-field predicate scan at ~766ms,
which that entry called *"genuinely different work per field"*.

**IT IS NOT DIFFERENT WORK PER FIELD, AND ONE MEASUREMENT SETTLES IT.**
`ownerOccurrence` is used for exactly one thing — bound as `$this` so a predicate
can reference the asking row:
```
poms grid    45 find-mode fields · 0 reference $this · 772 rows resolve one
test grid 2  42 find-mode fields · 0 reference $this · 406 rows
```
So 772 rows each ran an INDEPENDENT filter over 7322 records to produce one of
**45** distinct results — ~5.6M predicate evaluations for 45 answers. Driving the
REAL resolver over the REAL live maps, one full pass of all 772 renders, with
only the RESULT cache defeated so the records cache still hits (i.e. exactly the
shipped behaviour before): **2677ms → 0.3ms**.

**AND THE USER-FACING NUMBER DID NOT MOVE. Say it plainly.** Same probe, same
machine, prod before and after the deploy, three date navigations each:
```
before   blocked 3091ms   (2587 / 3091 / 3304)
after    blocked 3273ms   (3023 / 3273 / 3461)   <- run noise; no improvement
```
**The harness pass is over the WHOLE grid; a browser mounts a fraction of it** —
114 instance rows, 248 field pills, **1 select** on screen. So `resolveOptions`
was never what a browser navigation waits on here, whatever the profile of a
different grid said. The change removes real waste and is correct; it is not the
fix for the complaint, and offering the 2677ms as if it were would be a lie.

**THE REAL CAUSE HAS A NAME, and the op sweep reports it itself:**
```
[op-timing] NavigationOp total=1873ms  ops=46
    766ms   0fx   Schedule: Fill Day      <- 40% of the sweep, emits NOTHING
    424ms   3fx   Schedule: Build Schedule
     89ms   2fx   Day Page: Build
[op-fire-done] NavigationOp 2246ms  total=184 effects
```
`Schedule: Fill Day` is 27 steps, **4 LOOPs and 2 FINDs over `$allContainers`**,
fires on `onLoad` AND `onFilterChange`, and produces **zero effects** — 766ms of
work concluding that nothing needs doing. *That its cost coincides with the old
`resolveOptions` figure is a coincidence and nearly sent me to the wrong place
twice.* **This is the next thing to fix and it is a STORED pipeline** — migration
work, on live data, so it wants its own reviewed pass rather than the tail of a
long session.

**A/B 4 SAID ONE LEVEL OF MY OWN CACHE KEY GUARDED NOTHING, so it is gone.** I had
`occurrencesById → modulesById → fieldsById → field`; removing the `fieldsById`
level fails ZERO tests, because the FIELD OBJECT is already the real key and the
store replaces it whenever its content changes. A cache level nobody has watched
catch anything is the guard that gets trusted without earning it.

The three that DO discriminate: dropping `modulesById` fails 2 (a rename serves a
stale label), sharing regardless of `$this` fails 1, and **keying on the
occurrence COUNT fails 4** — the invalidation test re-parents the world at the
SAME count precisely so a derived-scalar key cannot pass it. The result is
FROZEN, because it is now shared across every row rendering that field and one
caller mutating it would change what every other row sees (all 12 consumer sites
checked: read-only).

3179 client tests, lint clean on every edited file, prod HEAD verified.

---

### 2026-08-23 (7) — C3: the field deciding which page an op reads its date from had NO editor

The last gap of the user's own audit ask (*"make sure i can edit everything in the
ui"*). C2 and C4 closed in (5); this closes C3.

**MEASURED RATHER THAN INHERITED — the row was three days old and several filed
rows have gone stale today.** 9 live ops carry a `targetOccurrenceId`, 8 enabled,
**0 dangling**. It is load-bearing: `operationExecutor.js:1510` resolves the op's
working DATE from that occurrence's EFFECTIVE filter — `$activeDate`,
`$filterDate`, `$activePeriodDates`. It is why a Trackers navigation used to
rebuild the Schedule for the Schedule's own unchanged dates (2026-08-09 (8)).

**AND THERE IS A NAME COLLISION THAT WOULD SEND THE NEXT READER TO THE WRONG
KEY.** Every `targetOccurrenceId` match in the client is either
`commitApplyTemplate`'s unrelated argument or **`cfg.targetOccurrenceId` — a
per-STEP action config with the same name, which already HAS an editor in
`OperationsBuilder`.** Two different keys; only the op-level one was unreachable.

**IT IS A PLAIN SELECT BECAUSE `DrilldownPicker` WOULD HAVE BROKEN IT.** That
picker emits `$allItemsById.<id>` paths, and the executor does a bare
`occurrencesById[id]` lookup — storing a path resolves to no occurrence, no date,
and **an op that silently works against today instead of its page.** Exactly the
class of defect this audit exists to find, so the control matches the Category
select beside it instead.

**THE LIST IS NOT PAGES-ONLY, and that is what matters on live data.** 155 page
occurrences are the candidates — but `Mood: Record Selection` targets a
`container/graph`, and **a select whose value is absent from its options renders
BLANK and writes null the next time anything else in the editor changes.** So
opening that op would have silently broken it. The current value is always
present, pinned first and flagged with its role; a dangling id stays selectable
and reads `(missing occurrence)` rather than being quietly written away.
**Restricting to occurrences that CARRY a `filterOverride` would also have been
wrong — only 4 do, because the executor WALKS the parent chain.**

**A TEST CAUGHT A REAL FLAW AND I FIXED THE CODE, NOT THE EXPECTATION:** sorting
on the rendered label floats untitled pages to the TOP, because `(` precedes
every letter. Named pages sort together now; untitled ones sink.

**SCHEMA AND HANDLER CHECKED RATHER THAN ASSUMED** — `targetOccurrenceId` is
declared (`Operation.js:26`) and `update_operation` spreads wholesale, so it
persists, `null` included. That check exists because `Operation.priority` was
stripped by strict mode for months while every seed passed it.

**VERIFIED BY DRIVING IT ON PROD, both cases, with the read-back out of Mongo:**
```
Trackers: Date-Prefix Labels   156 options   selected "Trackers"
  changed to "Tasks", Save     -> Mongo targetOccurrenceId = 9zU5UYHq5FMn  PERSISTED
  restored                     -> 5zaCM_ScvI7n
Mood: Record Selection         157 options   selected "Emotions Wheel (container)"
                                             pinned FIRST, flagged   <- the discriminator
0 page errors · 0 console errors
```
The 156-vs-157 is the control: the pin appears only when it is needed.

**AND THE SERVED-CHUNK CHECK READ 0 FOR THE CONTROL FIRST — the documented tell,
for the third time in this repo.** The ops UI lands in `CommandCenter`, which is
lazy-loaded from `App` and **not referenced in `index`**, so a grep driven off
index.js finds neither the feature nor the control. Fetched by its real name:
new string 1, control (`Uncategorized`) 2, and the served chunk **sha256-identical**
to the local build.

**`npm run lint` was run on every edited file** — the rule (6) earned the hard
way. 3174 client tests, build clean, prod HEAD verified.

**C1 REMAINS OPEN and is genuinely yours:** the tasks goal is TWO coupled fields
(`Tasks Completed` counts up, `Tasks Left` counts down, both encoding "10"), and
nothing in the UI says so. Editable twice, if you know.

---

### 2026-08-23 (6) — the notes body became a FIELD; and I TOOK PROD DOWN with a variable from the other function

User: *"could you make that an automatic thing like our question and answer. could
you let the instances child textmap be a notes field on them."*

**THE MECHANISM ALREADY SHIPPED AND ONE SURFACE NEVER USED IT.** `bodyLink` is
what makes the Daily Answer's editor write into a FIELD instead of the
occurrence's own textmap — 26 modules carry one, every one a `Daily Answer`. The
instance notes body ("Show notes") rendered `DocContent` over
`occurrence.textmap`, so whatever was typed there was unreachable by operations,
field pills and search. This points it at the same mechanism.

**NOTHING WAS STRANDED, and that is measured at FULL DEPTH rather than assumed.**
```
instance occurrences        1145
  carrying a textmap           1     `Cook`
  carrying any TEXT            0     <- read through decompressTextmap
`Notes` field              exists    XRf7_mPqrd26, bound by 0 modules, 0 values
```
A raw scan reports "no text" for every row on the grid — textmaps are stored
COMPRESSED — so the count means nothing until it is decompressed. That is the
`0032` rule, and here it is what made the migration safe rather than a guess.

**IT IS A GRID-LEVEL DEFAULT, NOT A BINDING ON 1021 INSTANCE MODULES.** *"Every
X"* in a migration means every X that existed when it ran, so a module minted
next month would silently miss it — the `0043` / `0064` / `0120` class this repo
keeps paying for. One key covers every instance that will ever exist, and a
module or occurrence binding still overrides it.

**IT DECLARES NO `link`, AND THAT IS THE LOAD-BEARING DECISION.** A binding's
`link` is the JOIN identity for cross-occurrence sync — Daily Answer links on the
DATE so a day's answers stay in step. Reusing that here would be **data
destruction**: every instance row carries this same field, so typing a note on
one row would paste it onto every other row sharing the link value.
`findLinkedSiblings` refuses a link-less binding outright.

**AND THE GRID DEFAULT IS OPT-IN AT THE CALL SITE, which is its whole safety.**
`ModuleTextblock` resolves its body through the SAME function; a default read
from the grid inside the resolver would replace all 1161 textblock bodies with an
empty field — their text IS their own textmap, and nothing would render it.

**MY FIRST GUARD TEST DID NOT DISCRIMINATE, and the A/B is the only reason I
know.** With `link` undefined the ordinary path already bails on
`linkVal == null`, so a plain fixture passes with or without the guard — 37/37
green against the mutation. The shape where the guard bites is real rather than
contrived: **`fields[undefined]` is stored under the STRING key `"undefined"`,
and reading `fields[link]` with link undefined FINDS it** — so an occurrence
carrying that key makes every other one a sibling. Rewritten to that, it fails
for exactly its own reason, with a control proving the same fixture DOES match
once a link is declared.

---

**AND THEN I SHIPPED A `ReferenceError` AND EVERY PANEL ON PROD CRASHED.**
`ModuleInstance.jsx` holds TWO components — `InstanceInner` (line 89), which
declares `ctxGrid`, and the outer `ModuleInstance` wrapper (line 1012), where I
put the new memo. It read a variable belonging to the other function.

**THE TEST SUITE PASSED AND THE BUILD PASSED, AND BOTH ARE THE DOCUMENTED REASON
THIS CLASS SURVIVES.** No test mounts `ModuleInstance` — its own header says why
(1300 lines, needs the whole grid store) — and **a build resolves IMPORTS, not
undefined locals.** 2026-08-01 (6) records this exact shape (`watchRegion is not
defined`) and the rule it wrote was *"run `npm run build` before deploying a
cross-module edit"* — which is precisely the check that cannot see it.

**`npm run lint` CATCHES IT, AND THE GUARD WAS ALREADY THERE.** Verified by
reintroducing the defect rather than assuming:
```
with the defect    1109:40  error  'ctxGrid' is not defined   no-undef
after the fix      (gone)
```
`no-undef: "error"` has been in `client/eslint.config.mjs` since the 2026-07-14
dead-code pass. **THE STANDING RULE IS THEREFORE WRONG AND IS REPLACED: run
`npm run lint` on every file you edited before deploying — the build cannot see
an undefined local, and the test suite does not mount this component.**
*Reported, not fixed:* lint exits non-zero on clean code (6 pre-existing
`react-hooks/exhaustive-deps` "rule not found" errors), which is very likely why
nobody runs it — `grep no-undef` is the usable signal until that config is fixed.

**THE ON-SCREEN TEXT WAS IDENTICAL IN BOTH STATES, and only the CONSOLE told the
truth.** The crashed page and the healthy page produced the same `innerText`
(toolbar, grid name, 48 slot labels), so a text-based probe would have reported
success. My first probe read `.container-shell` and got **0** — and I nearly
called that a selector problem; the class tally is what showed
`lucide-triangle-alert` + `refresh-cw` and named it an error boundary. *A probe
that reports zero is a claim about the probe — until you ask what IS on screen.*

**The fix is not just scope.** The outer wrapper deliberately subscribes only to
slices that are `Object.is`-stable across unrelated writes — it is mounted once
per row, and `grid` changes identity on every write, so subscribing to it would
re-render every instance whenever anything moved. It takes the field-id STRING,
the same pattern the file already uses for `linkedGroupCount` and the activeId
BOOLEAN; `resolveInstanceBodyBinding` therefore takes the RESOLVED default rather
than the grid.

**VERIFIED BY DRIVING IT ON PROD, and the fan-out check is the one that matters:**
```
114 instance rows on screen · 68 body buttons
body shape   boundEditor TRUE   plainDocEditor FALSE   badge "Notes"
             placeholder "Add notes..."   <- data-driven from the field's own meta
typed a note -> occurrences carrying it: 1     <- never more, out of 1145
page errors 0 · probe note swept · Notes values back to 0
```
The badge reads `Notes`, not `Broken link: Notes` — a link-less binding is
per-occurrence BY DESIGN, and calling that broken tells the user something is
wrong with a body working exactly as authored. Third state, not two.

`0212` and the seed are twins written in the same pass so a fresh grid and a
migrated grid cannot drift. Resolved by name AND TYPE, refusing if ambiguous
(this grid carries duplicate field names); `Person Notes` is untouched.
Rehearsed on test grid 2, forced re-run reports *"already points at Notes"*.
Four A/Bs, each mutation asserted to LAND first. 3165 client + 1324 server tests,
poms grid **0 errors**, prod HEAD verified, `PagePreviewApp` chunk sha256-identical
with the new key present and `Broken link` reading 2 as the control.

**REPORTED, NOT FIXED:** `checkGrid` still lists `Notes` under `unused-field` —
it counts bindings, values and operation references, and cannot see a field
referenced from `grid.meta`. It becomes "used" the moment anyone types a note.

---

### 2026-08-23 (5) — THE NUMBER INPUT ASKED FOR A KEY NOTHING WRITES, so every field stepped by 1

The operations-UI audit's item C4 filed `meta.increment` and `meta.multiline` as
INERT and offered *"wire them or drop them"*. **Measuring the VALUES answered it
before any code:** they are not leftovers.
```
Steps 500 · Calories 50 · Liquid Amount 8 (a cup) · Amount/Weight/Protein 5
Set N 1 · three macro fields at 0.1 · one at 0.5
multiline: Person Notes · Allergies · Interests · How We Met · Excerpt
```
Every one is a deliberate authoring decision. Dropping them would have deleted a
designed feature on the grounds that nobody had connected it.

**AND IT IS A NAME MISMATCH, which is why it survived.** The input reads
`meta.step` — carried by **0 fields on all six grids and written by nothing** —
while the seed has always authored `meta.increment`, on **71 fields across four
grids**. So the attribute has been `undefined` everywhere and every number field
moved by the browser's default of 1: tapping the arrow on `Steps` moved it by 1
where its author said 500. *The inert-token class, reached from the READ side —
a renderer asking for a name the data does not use looks exactly like a feature
nobody built.*

**THE FRACTIONAL FIELDS ARE THE SHARP END, and they are their own test.** A step
of 1 makes the browser REJECT a fractional value outright, so the three 0.1 macro
fields were unusable by their own arrows — not merely coarse.

**`multiline` reached only a `markdown`-TYPED field**, so five prose fields
rendered as one-line boxes. **Compact is deliberately excluded**: a row's field
pills share one centreline (2026-07-28) and a growing box breaks it. And
`handleKeyDown` is NOT wired on the textarea — it commits on Enter, and Enter in a
textarea is a new line.

**THE CONTROLS EXIST NOW, which is the user's actual ask** (*"make sure i can edit
everything in the ui"*): `Min` · `Max` · `Step` on a number, `Multi-line` on text,
`Several picks` on select/occurrence — 46 live fields carry `multiSelect` and
whether `Ingredient` took one pick or many was a migration-only decision. **An
empty box stores `null`, never `Number("")`, which is 0** and would silently clamp
a field to zero; that is its own test.

**TWO OF C2's FOUR WERE RETIRED BY MEASURING rather than built.**
`postfixOptions` is already editable — `AffixEditor` writes it, so the row was
stale. And `siblingLinks` is a schema default on all 250 fields with exactly
**TWO** configured (Daily Question ↔ Answer), so *"247 fields with no control"* is
a default, not a gap.

**19 tests, every mutation landing and failing EXACTLY its own cases:** reading
`meta.step` again (3), deleting the multiline branch (1), the clamp block (5), the
multiSelect box (3), coercing an empty box with `Number()` (1). Every FieldDetail
assertion is on what LEAVES the component — a control that writes a key nothing
reads is the class this whole audit is about.

**VERIFIED ON PROD BY LOOKING, and the probe had to be fixed first.** A single-run
sweep read one field's controls under the NEXT field's name, because clicking the
Fields TAB while already in a detail is a no-op and the panel never changed. An
identity assertion (read the detail's own Name box) caught it, so each row below
is from a run where that field was opened FIRST:
```
Steps          number    Min=""  Max=""  Step="500"
Person Notes   text      Multi-line: on
Tags           select    Several picks: on
Completed      boolean   none of the three          <- the control
```
3148 client tests, build clean, deployed, prod HEAD verified, and the served
`CommandCenter` chunk sha256-identical with the new strings present and
`Flow toggle button` as the positive control — **the first check read 0 for the
control too**, which is the documented tell that it was the wrong chunk (FieldsTab
lands in `CommandCenter`, not `index`).

**NOT VERIFIED, and it is the honest gap:** nobody has watched an arrow move
`Steps` by 500 on the grid. The click-to-edit pill would not materialise its input
under the probe, so the grid-side reading is unit-covered and unseen.

---

### 2026-08-23 (4) — `0210` WAS RIGHT AND PRODUCTION COULD NOT SEE IT: three migrations sat inert behind a warm cache

Picked up the other account's session, which ended one line after committing `0211`
with the note *"deploy blocked (other session on import.js)"*. **Nothing was owed
to prod as CODE — and something much worse was owed.**

**THE DEPLOY DIFF SAID "NOTHING TO SHIP", AND IT WAS TELLING THE TRUTH.** Thirteen
commits ahead of prod HEAD, and `git diff --name-only <prodHEAD>..HEAD` splits as
7 migrations · 8 test files · 2 docs · and **two server utilities reached only by
`checkGrid` / `sweepOrphans`** — scripts, not the request path. The 2026-08-13 (3)
rule ("a stale prod HEAD is not evidence of an undeployed feature; diff the paths")
answers correctly here and answers the WRONG QUESTION.

**BECAUSE A MIGRATION IS NOT SHIPPED WHEN IT REACHES ATLAS.** `0209` (Pay Bill),
`0210` (the stamp gate) and `0211` (202 bindings) all wrote to the shared database
between 12:59 and 13:14. Prod's process had been up since **11:29**, and this
server holds a warm per-user cache that is authoritative for reads. So for two
hours production served the PRE-migration operations to the only person using it.
*This file has recorded "restart pm2 after a migration" seven times, always about a
cache re-serving a value. This is the same rule from the other end: the migration
was not merely invisible, it was INERT — the fixed op was still the broken op.*

**MEASURED RATHER THAN ASSUMED, and the discriminator was an op nobody was looking
for.** Driving a real checkbox on prod and reading the field back out of Mongo:
```
                          prod (stale cache)      local (fresh server)
tick `Organize files`     Completed=true          Completed=true
  -> Completed On         NEVER WRITTEN           "2026-08-23"
ops evaluated                     26                       27
`Bills: Mark Paid`            ABSENT                  present     <- 0209 minted it
```
That 26-vs-27 is the whole proof. **The op count is what named the cache**; the
missing value alone would have read as a bug in `0210`, which is where I would have
spent the afternoon.

**FOUR PROBES, AND THE FIRST THREE EACH EXONERATED A LAYER.** The executor emits
the effect over LIVE data (all 69 ops, one `UPDATE_ITEM_FIELD`, nothing countering
it). The browser console says the op FIRES and emits
(`[op-effects] "Schedule: Stamp Completed On" UPDATE_ITEM_FIELD=1`). The socket
trace says **no `update_occurrence` carrying the field ever leaves the tab**. So
the callee was right, the caller was right, and the write vanished between them —
which is only possible if the op prod was running was not the op in the database.

**AND MY FRAME FILTER LIED FIRST.** It did `payload.slice(0, 900)` and THEN asked
`includes(<fieldId>)`, on an occurrence whose serialized fields run past 1,000
characters — so "the frame does not carry it" was a claim about the slice. Re-run
unsliced it gave the same answer, which is the only reason it is quotable. *Check
the probe before believing the failure — and check it again when it happens to
agree with you.*

**THE PROBE IS TICK -> READ -> UNTICK -> READ, which is both the discriminator and
the cleanup.** The ELSE branch must clear the date, or a corrected tick leaves a
completion date describing nothing; and `Organize files` starts and ends at
`Completed=false`. Read back: row restored, **0 occurrences created in the last 40
minutes**, poms grid **0 integrity errors**.

**Prod is now at HEAD and restarted.** 3129 client + 1324 server tests.

**STILL OPEN, and it is the user's call — now with the evidence it was missing:**
what window the `Completed` container should use. `Completed On` demonstrably
populates from now on, but its three current rows carry none, so any window drops
them. That is what the complaint asks for (*"something i completed days ago"*) and
it is still a choice rather than a fix.

---

### 2026-08-23 (3) — ALL 1,467 BOOKMARKS WERE INVISIBLE, and the board looked fine in every other way

Found by RENDERING the board rather than reading it. The rows exist, the covers
resolve, the modules are right, `checkGrid` is clean — the board simply draws
nothing.

**`0199` imported each bookmark's Raindrop save-date into the field called
`Date`, which is the field the GRID FILTER uses.** The grid filters
`Date = today`, so a link saved in 2021 matches on exactly one day of the year:
```
bookmarks carrying a Date     1467
matching today                   0
hidden by the filter          1467      <- the whole board, every ordinary day
```
**AND IT FILTERED INVISIBLY.** The grid-level `fieldVisibility` (2026-08-11) hides
`Date` everywhere except Tasks, Trackers and Schedule — so the field doing the
hiding was not on screen to suspect. Same class as 2026-08-19 (5), where a stale
date hid 21 timeslots, reached from the IMPORT side instead of a template.

**THE VALUE MOVES RATHER THAN BEING CLEARED, and that is the difference from
2026-08-19 (5).** That date was wrong; this one is RIGHT — it is when the user
saved the link, it came out of their own export, and Raindrop shows it. Only the
field is wrong. `0206` moves all 1,467 to a `Saved` field of their own.
**Clearing the page's filter instead cannot work and the reason is already
written down:** a CLEARED date filter means *"show nothing dated"* (2026-08-11),
so the rows would stay hidden. The value has to LEAVE `Date`.

Read back out of Mongo: 0 still dated, 1,467 carrying `Saved`, 0 modules still
binding `Date`, and **binding ORDER preserved** — appending instead of swapping in
place would have moved the date to the end of 1,467 cards. Then verified by
rendering: **0 rows → 14,670 elements**, first row reading its real title and URL.
The clip path was checked too and is clean: it sends no date, so a clipped
bookmark is not born invisible.

**AND ITEM 5 WAS RETIRED BY MEASURING, not built.** *"the fields in trackers font
sizes didnt change and the rest are too big now"* — already fixed, and the live
grid says so: instance labels 15px on the Trackers page AND everywhere else,
display and input fields pinned at 11px in both. The queue row was stale.

**A PROBE READING I NEARLY TOOK AT FACE VALUE.** The Bookmarks container reporting
0 rows is exactly what the preview app reports for other reasons, and this session
had already caught it lying twice. What made it a finding rather than a guess was
going to the DATA for the discriminator — 1,467 dated rows against a filter for
today — and only then rendering again to confirm the fix.

---

### 2026-08-23 (2) — THE CODEX: 75 annotated notes become 75 pages, and three measurements changed the build

User: *"convert all the md files in the notes_codex_annotated to pages with textblocks and
appropriate occurances, into a codex folder"*. Plan +
every number: `docs/superpowers/plans/2026-08-23-codex-import.md`. `0202` + `0203`, applied.

**IT DRIVES THE EXISTING IMPORTER RATHER THAN ADDING A SECOND ONE.** `markdownToModuli` already
turns markdown into containers and textblocks. The three things it cannot do each got their own
tested module, and each exists because of a measurement rather than a guess.

**MEASUREMENT 1 — "AN IMAGE SEARCH BY TITLE" HAS AN EQUIVALENT HERE, AND IT IS THE TAG LINE.** All
75 files open with `#reference #alchemy #daoism`. Left in the body that becomes a textblock reading
the hashtags at the top of every page. **But 72 files also carry a markdown `# Heading`, and the
discriminator is one space:** a tag line is `#word` tokens, a heading is `# ` followed by text.
Matching any leading hash would have eaten 72 titles. Only the FIRST line is read — the annotations
end with hashtags of their own, and sweeping those in would attach words an LLM chose to the user's
note as if they were their tags.

**MEASUREMENT 2 — THE IMPORTER WAS TEARING THE LAST SENTENCE OFF 54 ANNOTATIONS.** It splits a
trailing em-dash clause off a blockquote as an "— attribution" byline, which is right for a
Wikipedia pull-quote and wrong for prose. Measured on the corpus before and after, with the control
that makes the difference mean something:
```
                                     before   after
quote blocks                           460      460
  annotations (bracketed marker)        409      409
  ordinary quotes                        51       51
annotations carrying an attribution      54        0
ordinary quotes carrying one              5        5   <- the control
```
That last row is what says this changed the CLASSIFICATION and not the feature. Deleting the split
would have produced 0 and 0 and looked identical in the first three rows. **And only 409 of the 460
blockquotes are annotations** — the other 51 are the user's own quoted material, so marking every
blockquote would have labelled their quotations as machine-written.

**MEASUREMENT 3 — THE CORPUS CONTAINS A FILE LITERALLY NAMED `.md`.** A real note (a saved rewards
number) whose filename has no stem, so `basename minus .md` leaves an EMPTY STRING and the page
renders as a blank row in the tree. Its own heading reads `# Untitled (.md)`, which is now the first
fallback. **The dry run printed `e.g. .md:` and I looked instead of reading past it.**

**A REHEARSAL ON `test grid 2` CAUGHT AN INERT KEY, and the guard it broke was the dangerous one.**
The folders were minted with `manifestId`, copying `0199` — and **the `Folder` schema has no such
field**, so Mongoose strict mode strips it silently. `0199` has been writing an inert `manifestId` on
every folder it makes. Harmless there; here the idempotency check was ALSO manifestId-scoped, so it
matched nothing, printed the plan instead of "already exists", and the next `--apply` would have
duplicated all 9 folders. *A log line reading correctly while the query saw nothing.* A folder is
scoped by its PARENT CHAIN from the manifest's `rootFolderId`, and that is what both the tree and the
guard ask about now.

**RESUMABLE ON THE RELATIVE PATH, and the basename would not have done.** `Untitled 1/2/3/6/7/8.md`
each exist TWICE — once at the root, once in `untitled_notes/` — with different content every time.
A basename signature would make the second copy look already-imported and drop it. A/B'd; the
basename mutation fails exactly the two tests that describe it.

**ORDER: import, THEN mint the page.** The page is created only once there is a root id to embed —
minting first leaves an empty page behind every time an import fails, and failures are expected
across 75 real documents.

**Read back OUT OF MONGO on both grids, not off the log:**
```
75 pages · 75 DISTINCT codexPath values · 75 parented to a Codex folder
75 embedding exactly one root · 75 roots parented back to their page
75 with a non-empty label · 75 carrying Codex Tags
409 modules marked meta.codexAnnotation · 0 annotations carrying an attribution
Codex Tags 135 options · the existing Tags field UNCHANGED
```
2,109 occurrences against a census predicting ~2,137 content blocks — within 5%, which is the
importer's paragraph gathering, not a missing hundred rows. A second pass reports `0 to import, 75
already done`. poms grid **1 pre-existing error, 0 new**. 3112 client + 1198 server tests.

**The tags got their OWN field**, on the user's call: the existing `Tags` is MIXED — 45 live values,
nine of them wellness dimensions and the rest board categories that drive real pickers — so 135 more
would have swelled every board-category dropdown.

**AND THEN I OPENED IT IN A BROWSER, WHICH FOUND A DEFECT NO TEST COULD (`0204`).** Every page was
minted `kind: "doc"` with the imported root in `occurrences[]` — and **`PageDoc` renders the
occurrence's TEXTMAP and never reads `occurrences[]`**, so all 75 opened as EMPTY EDITORS while their
content sat in the database, complete and unreachable. *The listed-but-not-embedded class, and
`0203`'s own commit message quoted it in a comment directly above the line that made the page a doc.*

**No test and no data check could have caught it, because the DATA IS CORRECT** — 75 pages, each
parented, each listing exactly one root, each root parented back. Only the renderer disagreed. I had
even compared the Codex folder against the working `Bookmarks` folder and called them identical; that
comparison covered `folderType` and parentage and **not `kind`**, which is the one field that
mattered. `0199` had reached the right answer (`kind: "board"`) for the same reason a year of this
file keeps repeating. Fixed at BOTH ends so a fresh import and a migrated grid cannot drift.

**THE PROBE ONLY BECAME TRUSTWORTHY WHEN IT HAD A POSITIVE CONTROL, and five attempts before that
were worthless.** Each reported zero rows with nothing to say whether the sidebar had even opened.
The one that worked reads the renderer's OWN contract (`.manifest-row`, found by reading
`ManifestTree` instead of guessing) and checks the count against a baseline this file already
recorded on 2026-08-21:
```
sidebar closed            0 rows      <- the probe can report zero for the right reason
sidebar open             10 rows      <- matches the 2026-08-21 baseline exactly
Root + Codex expanded    71 rows      <- Codex beside Bookmarks, 8 subfolders, 37 pages by name
```
**The bookmark covers are verified the same way**: opening the Bookmarks page draws 3 cover images
(the rest de-rendered by `content-visibility`), all loaded at real dimensions from the export's
og:images, **0 error glyphs, 0 page errors**.

**STILL NOT VERIFIED, narrowly:** nobody has watched a codex page's textblocks and annotations draw
on screen. The row click that opens a page worked for Bookmarks (the control) and did not fire for a
codex row in the same run, which is a question about the probe, not a claim about the feature.

---

### 2026-08-23 — 1,467 COVERS AND NOT ONE ARTIFACT; the sticky panel gets its picker

Picked up the other account's session, which hit its **monthly spend limit** twice — once one
command into wiring the panel picker (`targetPanelMenu.js` + 9 tests written, untracked, unwired)
and again on the user's next instruction, which got the limit message instead of an answer:
***"make all of those image searches. use the urls as the image search, we dont need an artifact for
each cover."***

**THE MEASUREMENT CHANGED THE COVERS WORK TWICE, and the first change is two thirds of it.** The
1,030 rows that ALREADY carried a cover were rendering nothing. `0199` put the export's image URL in
a text field and **said so in as many words** — *"it is NOT rendered as a picture yet"* — and nothing
had rendered it since. A bookmark's `fileRef` is a WEB PAGE, so the card's own `src` pointed at HTML
and all 1,467 drew the generic 📄. *Most of the pass was a display fix already sitting in the data.*

**AND THE SPEC'S "IMAGE SEARCH BY TITLE" CANNOT BE DONE ON THIS GRID.** The 437 coverless rows do
have titles — my first probe read `occurrence.label` (null) and reported "no title", which the second
probe corrected, because the card draws `occurrence.label ?? module.label`. These are them:
```
"Microsoft Word - 2007-109.doc - 2007-109.pdf"
"Pausanias, Description of Greece, a target="_blank" onclick=..."   <- raw HTML
"diape search results - PornZog Free Porn Clips"
```
Searching images for the third would put pornography on the user's board.

**A 30-ROW SAMPLE WAS TAKEN BEFORE SPENDING THE 437, and it explains the whole result.** Those
bookmarks are not articles — they are login pages, dashboards, docs, `192.168.3.101`,
`localhost:8081`. They have no cover because **they are not content**, which is the same reason
Raindrop could not find one either. Predicted 7% / 57% / 37%; measured:
```
1030  from the export        55  a real og:image
 151  a declared icon       231  a guessed /favicon.ico      146 pages unreadable
```
Reported rather than dressed up: it is a wall of favicons, and the user chose favicon-over-blank
knowing they would be small. **A content-image fallback was considered and REFUSED** — on a login
page the largest image is a logo or an ad, no better than the favicon and worse when it is wrong.

**IT IS NOT `primaryMediaOf`, DELIBERATELY.** That resolver refuses a bare string on purpose, so an
unmigrated media value cannot render and hide the fact that it was never migrated (2026-08-08 (5)).
Teaching it to accept a URL would reopen that hole **for every grid**. `module.meta.cover` is read by
`ArtifactCard` exactly the way it already reads `meta.thumb256` — *a different question with its own
answer, not a fallback inside that one.* The `Cover` FIELD stays authoritative and WINS on every run;
`meta.cover` is derived. **Stated rather than hidden: until a re-run, an edit to the field is not on
screen.**

**THE ABORT KEYED ON THE WRONG SIGNAL, and catching that before the run is the save.** With a favicon
fallback a cover-"miss" is nearly impossible — every URL that parses yields an origin favicon — so
counting misses made the guard **UNFIREABLE**, and a total network outage would have quietly stamped
437 rows with a `/favicon.ico` nobody could load. It keys on FETCH failures now, and refuses when the
first 20 all fail, because that is not twenty dead links. **A single dead link never stops the run:**
this is a years-old export and 146 pages genuinely could not be read.

**Resumable by construction** — a row is fetched only when it has no cover value, so a run that dies
at 300 leaves 137. Verified: a second pass plans **0** fetches. **The fetch list is INTERLEAVED BY
HOST**, because 437 bookmarks are not 437 sites: the export has runs of one domain together, so a
naive pool puts four requests against one host in flight while idling on the rest.

**A TEST FOUND A REAL BUG IN `absolutize`:** `new URL(ref, base)` throws on a malformed BASE **even
when `ref` is already absolute** — so a page with a perfectly good og:image lost it because of its
own URL.

**THE PANEL PICKER: the same walk was about to be written twice.** `ArtifactCard` already collected
"which occurrences are panels" and walked up to the enclosing one, and the menu needs both to list
its choices — so `collectPanelOccurrences` / `enclosingPanelId` / `panelChoices` moved into
`helpers/targetPanel.js` and the card calls them. **The 2026-08-08 (10) rule applied before the
second copy exists rather than after.** Order comes from `grid.occurrences`, not object iteration — a
menu whose rows reshuffle between two right-clicks cannot be learned — and the tick rides in the
ICON, because `ContextMenu` keys rows by LABEL and a "✓ " prefix would make the ticked row a
*different row*.

**ITS DEPTH-CAP A/B IS UNUSUAL AND WORTH RECORDING: removing the cap HANGS the suite rather than
failing it.** The walk is synchronous, so an infinite loop blocks the event loop and vitest's own
timeout can never fire — which is exactly what the defect does to a tab. **My first mutation
(`i >= 0`) was a semantic no-op and the test "passed" against it**; checked the mutation before
believing the A/B, per 2026-08-09 (4). A second mutation later **refused to land** and the assert
said so rather than reporting a pass.

**Read back out of Mongo rather than off the log:** 1467/1467 modules carry `meta.cover`, 1467/1467
rows carry the field, the two AGREE on all 1467, 0 values are not http(s), and the grid's
image-artifact count is **unchanged at 338** — no artifact per cover, which was the instruction.

**Verified in the SERVED chunk with a POSITIVE control**, because the strings land in
`PagePreviewApp` and a grep of `App` reads as a missing feature — the trap this file records twice.
The first check read 0 for the new strings *and* 0 for the control; `Remove from container` (a
pre-existing string) reads 0 in `App` and 2 in `PagePreviewApp`, which is what named the right chunk.
Both chunks sha256-identical to the local build.

30 new tests, each A/B'd. 3103 client + 1161 server tests, build clean, deployed, prod HEAD verified.
poms grid **1 pre-existing error, 0 new**.

**NOT VERIFIED, and it is the honest gap:** nobody has looked at the Bookmarks board in a browser
since the covers landed, and the extension still cannot be loaded headlessly.

---

### 2026-08-23 (2) — ARCHIVE mode; and the `embed: <uuid>` boxes were `0070`'s residue

Picked up the other account's session, which hit its limit **mid-read on Archive
mode**, the last item of the bookmarks spec. All nine steps are now shipped.

**ARCHIVE EARNS ITS BUTTON ON A MEASUREMENT, not on the idea.** A Wayback snapshot
sends **no `x-frame-options` and a CSP carrying no `frame-ancestors`** — so it
frames where the original refuses, with no extension. Checked against
`danbrown.com`, the site the user named as unframeable: live SAMEORIGIN, archived
loads.

**AND MEASURING THE API CAUGHT A DEFECT BEFORE IT SHIPPED.** The availability
endpoint returns `http://web.archive.org/…`. The grid is https, so framing that is
MIXED CONTENT: the browser blocks it and the panel shows a blank box
**indistinguishable from a site refusing to frame** — the failure would have read
as the exact thing the mode exists to work around. Only the archive's own host is
upgraded; the captured url lives in the path and names WHICH capture is wanted.
Second shape: **"never archived" is a 200 whose body is `{"archived_snapshots":{}}`**,
not a 404 — code checking only `res.ok` reads it as success. Kept distinct from
"the archive answered 503", because collapsing them tells someone their page is
not archived when the service was merely down.

**The button is always present; the lookup is not.** A peer button per the user,
never a fallback that appears once something breaks — but a lookup per bookmark
OPENED would send a third party a request for a mode most opens never use. A test
pins that no fetch state can select Archive on the user's behalf. **No SSRF guard,
and a test is what makes that claim true:** the handler is given `169.254.169.254`
and the host actually fetched is asserted to be `archive.org`.

---

**THE OTHER ACCOUNT'S OWN TOP GAP IS CLOSED: the 75 codex pages render.** It had
just fixed one renderer assumption (`0204`, doc→board) and flagged that nobody had
seen a page BODY. Verified read-only through `?previewOcc=` — which pins nothing,
so the live grid took no write: `Dads Church Board Letter` 3,761 chars and `Resume`
11,630, both carrying their expected first sentence, 0 page errors. Structurally,
all 75 root docs embed **every** child they list (1,959 embeds, 0 broken).

**AND OPENING IT FOUND A REAL DEFECT THE DATA CHECKS HAD NOT: `embed: <uuid>` in a
dashed box.** 28 dead embed nodes on 17 hosts — ten reachable day columns and two
Daily Questions. `Monday, August 10th` carries SIX, which dates it exactly:
`0070` deleted 18 duplicate occurrences on 2026-08-11 and never touched the
textmaps embedding them. `0205` scrubs them; the reasoning that made it safe is in
its header, because **this scrub caused a regression once** (2026-08-01 (19)).

**THE COMPANION REPAIR WAS MEASURED AND DROPPED, which is the more useful half.**
54 children are listed by a doc container and embedded by nothing — the same class
`0033` repaired for two pages. At 54 the repair is wrong: measured for CONTENT,
**52 hold nothing at all and 2 hold ONE character**. Re-embedding would add 54
blank boxes to pages that currently look fine. *A count of "invisible content" is
a claim about the count until the content has been weighed.*

**MY PROBE'S CONTROL FLUCTUATED 0 → 1 → 12 AND I ALMOST BELIEVED THE ZERO.** The
preview iframe reported `embed:` placeholders on `Resume`, a page whose every
embed resolves in Mongo. Waiting for a STABLE reading did not fix it — it settled
at 12. The explanation is exact rather than hand-waved: `PagePreviewBody` walks
the CHILD LIST, and the Resume page embeds **exactly 12** occurrences no child
list reaches. Once the control's number was fully explained, the repaired pages'
0 became meaningful; before that it was a coin flip. *A probe whose control moves
cannot prove anything about its target.*

**Reported, not fixed:** 474 embeds across 233 hosts grid-wide are reachable only
through a textmap, so preview CARDS under-render text-heavy pages. Pre-existing
and not codex-specific — the third reachability path 2026-08-13 (4) already names.

1278 server + 3115 client tests, poms grid scrubbed and pm2 restarted, deployed.

---

### 2026-08-21 — ONE SIDEBAR: pinned above the manifest, on the right, and folders start CLOSED

Three asks on one surface — *"make every folder closed by default in the manifest sidebar"*,
*"combine the manifest sidebars into 1 with pinned being the panels opened stuff, that will sit above
the full manifest"*, *"put this on the right side"*.

**MEASURING FIRST CHANGED TWO OF THE THREE.** `ManifestTree` was a TERNARY — `isPagePanel ? <Local>
: <Root>` — so it showed EITHER the panel's pinned pages OR the manifest, never both, behind two
header buttons. And the two sidebars were **already on opposite sides**: Local left, Root right. So
*"put this on the right"* is a **deletion, not a move**, and the merge is one `<ManifestTree>`
carrying every prop the two instances used to split between them — `panelOccurrence` is the one that
makes it draw the pinned section at all.

**AND `isExpanded` IS NOT WHAT IT LOOKS LIKE.** `FolderNode` seeded its open state from
`folder.isExpanded` and **nothing has ever written it back** — so it was a seed-time initial value
rather than a preference, and every seeded folder carried `true`, which is exactly why the whole tree
arrived expanded. Writing there would have meant a socket write to LIVE GRID DATA on every folder
click, for something that is per-device by nature, and would have synced one machine's browsing state
onto another. `helpers/treeExpansion` owns it now (localStorage, default CLOSED). **The field stays
on the record** — the Command Center category tabs still read it — **and the sidebar says in as many
words that it is inert there**, because a field that looks live and is not is the exact class this
repo keeps rediscovering six weeks later.

**Every path in the store fails open to "closed"**, which is the same state as a first visit: a
sidebar that throws on mount takes the panel down with it, and the worst case here is re-opening a
folder.

**ONE OF MY OWN TESTS DID NOT DISCRIMINATE, and the A/B is the only reason I know.** The wrong-shape
case used an OBJECT — but `new Set({})` throws on a non-iterable and the outer try/catch already
covers it, so the test passed with the `Array.isArray` guard removed and proved nothing. **The shape
that actually needs guarding is a STRING:** it parses, it iterates, and `new Set("f1")` silently
becomes `{"f","1"}` — so a folder whose id is `"f"` reads as OPEN. Rewritten to that, it fails for
exactly its own reason. *A guard nobody has watched fail is a guess — and so is a test.*

**VERIFIED ON PROD BY DRIVING IT, with the discriminating sequence rather than a single reading:**
```
first visit        10 rows   Root collapsed          <- closed by default
expand Root        23 rows   storage ["0QU2baW0EjIb"]
after a RELOAD     23 rows                            <- it remembered
```
A memory that did not work would have gone back to 10. Then looked at: one sidebar headed FILES on
the right edge of its panel, `Pinned` open with the panel's pages, `Root` a single collapsed row,
**one** "Files" button per header where there were two, **0 page errors**.

**And the served bundle was checked with a control that actually belongs to it.** The first check
grepped `moduli-theme` and read 0 — but it read 0 for the control too, because that string lives in a
different chunk; the `curl` was also reading gzipped bytes. Ground truth on the server: controls
present (`No files`, `New folder`), new strings present (`moduli-tree-open`, `Pinned`), the retired
ones (`Root directory`, `Local pages`) at **0**, and the server's build **sha-identical** to the
local one.

2839 client tests. **Probe debris, reported not hidden:** `module-less-occurrence` went 1 → 2 while
probing. `sweepOrphans` REFUSES both — they each carry a child, and its predicate only deletes rows
that are empty AND unreachable. That refusal is the guard working, not a failure.

---

### 2026-08-20 (6) — VITAMIN D WAS OFF BY FORTY, and the sodium tile went green when you went over

The open item read *"Vitamin E / K / B6 / Folate have fields and values but no target — the guide
gives none."* **It was stale, and measuring it turned a paperwork item into two live defects.** All
four had targets (15 · 120 · 1.3 · 400), all fourteen totals are bound to the tile and written by
`Nutrition: Today's Micronutrients`, and every one of the fourteen already matched the standard
adult reference value.

**DEFECT 1 — VITAMIN D, OFF BY A FACTOR OF FORTY.** Target `600` is the **IU** figure; the DRI is
**15 mcg**. The per-ingredient values were already mcg — established against a food whose answer is
known rather than by reading the field's name:
```
Eggs 1.1   one large egg = 1.1 mcg = 44 IU     -> the stored values are mcg
```
So the tile summed mcg and compared the total against an IU target: **a day that fully met the
requirement read as 2.5% of goal.** Nothing errored and no number looked absurd, which is exactly why
it survived. The target moves; **not one stored value is touched**, because they were already right.

**DEFECT 2 — SODIUM WAS A GOAL TO REACH.** 2300 mg is the chronic-disease-risk-reduction UPPER
LIMIT, and `displayConfigTarget` defaults to `op: ">="` — so the tile turned **green once you went
OVER your sodium limit**. `targetOp: "<="` now, the countdown semantic `Tasks Left` already uses.

**THE UNITS ARE STAMPED ONLY WHERE THE VALUES WERE CHECKED, and that is the safety of the other
half.** Fifteen fields carried no unit at all, so a bare `900` could have meant mcg RAE or IU. **A
unit inferred from a field's NAME is a guess printed next to a number — worse than no unit, because
it reads as authoritative.** Each was scale-checked against a food with a known value first: Lettuce
48 mcg vitamin K, Peanuts 348 mcg folate, Greek Yogurt 1.3 mcg B12, Eggs 80 mcg RAE vitamin A.

**THE FIGURES WERE LOOKED UP RATHER THAN WAITED FOR** — user: *"look up whats normal for those
values thats blocked for me."* Public reference values are lookupable, which is the rule `0123`
already applies to a food's CONTENT. What still needed the user was the reference PROFILE (adult
male 31-50 — magnesium 400 → 420, the only figure that moves) and which direction the sodium limit
runs, not the numbers.

**AND RE-EXPORTING THE FIXTURE EXPOSED A TEST THAT HAD BEEN PASSING BY LUCK.** The weekday-template
harness re-dated the live day column but **never CLEARED it**, so it counted whatever the snapshot
happened to catch. A fixture taken after the morning sweep made Monday read **12** movements (6
already there + 6 placed) and gave Fri/Sat/Sun **6 apiece on days that must place none**. *The
fixture is a snapshot of a grid that changes hour to hour; any test whose premise is "this column
starts empty" is a coin flip on export timing.* The harness empties the column itself now, with a
CONTROL asserting it really did — a clear that silently matched nothing would put every case straight
back at the mercy of the clock.

**AND `created` BECAME A DELTA IN THE SAME PASS, which the first fix is what revealed.** Clearing the
column made Thursday create **16** rather than 8 — because every weekday template also carries the
day's **meals**, which were previously already present and matched by merge. So an absolute CREATE
count was partly a count of meals and would shift the moment the meal plan did. It is measured
against a rest day now (`Thursday − Saturday === 8`, `Friday − Saturday === 2`), which is the
discriminator the test always meant.

The nutrition test pins **the unit beside every target** now, and that a ceiling is a ceiling — it is
the test that would have caught the IU/mcg mismatch. 18 fields patched, idempotent, read back out of
Mongo. 941 server + 2831 client tests, poms grid **1 pre-existing error, 0 new**, pm2 restarted.

---

### 2026-08-20 (5) — THE SECOND AXIS, and the filter that could not be surfaced

Picked up the other account's session, which had `categoryScopePolicy.js` + `0164` written, 12 tests
green, and the migration **unapplied and uncommitted**.

**THE VISION'S OTHER HALF, unbuilt for months.** *"sum/count/track progress across any time window
AND category"* — the window has worked since May; **0 of 37 tracker ops referenced any category
field**, so *"how many PHYSICAL tasks did I complete this week?"* had no answer. It introduces no
mechanism: an `INIT_VAR` mirroring the op's own `$goalPeriod` source, and a rule beside the date rule
in the same group.
```
date      INIT_VAR $goalPeriod   = $goalItem._effectiveFilter.<dateFieldId>
          rule     $item.fields.<dateFieldId>.value DATE_IN_PERIOD $goalPeriod
category  INIT_VAR $goalCategory = $goalItem._effectiveFilter.<categoryFieldId>
          rule     $item.fields.<categoryFieldId>.value CONTAINS $goalCategory
```

**THE OBVIOUS SURFACING DOES NOT WORK, and finding that out reshaped the whole second half.** The
draft created a `grid.namedFilters` entry and pushed it into `toolbarNavFilters`. Both are wrong:
a namedFilter is reachable ONLY by becoming `activeFilterId` — `Toolbar` renders exactly ONE
`FilterNavWidget`, for the active filter, and `FiltersSection`'s ancestor rows list that filter's
conditions and nothing else — **so picking Category would REPLACE the date nav**. And
`toolbarNavFilters` is written by `ToolbarFilterDropdown`'s "nav here" switch and **read by nothing
that renders** (grep: that file and the schema). *It would have shipped a filter nobody can reach
with every log line reading correctly* — the inert-token class, from the data side.

**SO THE AXIS IS A LOCAL FILTER ON THE TRACKERS' PAGE**, the mechanism that already supports a
second simultaneous axis — and **the Schedule page already carries exactly this** (a second
select-styled entry on Time Slot beside its date filter), so the shape is copied at run time rather
than restated. **The page is DERIVED, never named:** all 37 trackers bind their goal tile
picker-direct and all 37 resolve to ONE page ancestor.

**IT CHANGES NUMBERS, NOT WHAT IS ON SCREEN, and the `condition` is what buys that.**
`getLocalFilterConditions` contributes a visibility condition only for entries whose `condition` is
null. That matters because **Tags is MIXED — 45 values in live use and only nine are wellness
dimensions**, the rest board categories (`image`, `grocery`, `person`). Gating visibility would mean
picking "grocery" EMPTIES the Trackers page while the numbers rescope: an empty screen where the
answer should be.

**THE DRY RUN WAS CHECKED AGAINST A DERIVED EXPECTATION, not accepted as a count.** An independent
walk of the live pipelines found **31 bindable ops · 36 gateable groups · the same 6 uncovered by
name** — and corrected a number in the header on the way: the 111 live `DATE_IN_PERIOD` rules split
**42 loop / 69 trigger**, not 32/69. Only 32 of the 42 are named `$item`; the other 10 are the
hand-written trackers' own loop vars, **which is exactly why the discriminator is trigger-vs-loop
rather than the name.**

**AND RE-RUNNING FOUND A FLAW IN THE FAIL-CLOSED CHECK.** It converged (0 ops, 0 gates) while the
uncovered list went **6 → 14**: `alreadyBound` scanned TOP-LEVEL steps while `addCategoryVar`
recurses, so eight trackers resolving `$goalPeriod` inside a branch had their binding land where the
check could not see it. Benign on a converged grid and **a refusal waiting to happen on the next
pass** — the exact failure the check exists to prevent. A/B'd: reverting fails exactly the one test
written for it.

**Read back out of Mongo rather than off the log:** 31 ops bind `$goalCategory`, 36 gates, **0 inside
a period-all wrapper** (the case that silently voids date filtering on every tracker) and **0
loop-var mismatches** (the case that throws and kills the op). The live gate was then driven through
the REAL evaluator: inert with nothing picked, discriminating once one is.

**AND IT IS VERIFIED ON SCREEN, with a control.** Before opening the Trackers filter menu the page
held 1 `<select>`; after, 3 — and **exactly one carries the Tags option list in the migration's own
frequency order** (`image · physical · emotion`). The menu reads `Date: ‹ Thu, Aug 20 ›  Tags:
[– any –]` with `Tags = –` listed under LOCAL FILTERS: the two axes side by side, which is the thing
a namedFilter could not express. **0 page errors.** *My first probe reported a hit on the word "Tags"
and it was a FALSE POSITIVE — the Routines rows carry `Tags: physical` pills. A substring in
`body.innerText` is not a claim about a menu.*

**Tags has DROPPED OFF poms grid's `unused-field` warning while test grid 1 still lists it** —
independent confirmation the field is genuinely in use now, the same tell `0064` left. 941 server +
2824 client tests, poms grid **1 pre-existing error, 0 new**, pm2 restarted (only server code and a
test changed, so no bundle is owed).

**NOT VERIFIED, and it is the honest gap:** nobody has PICKED a category and watched the tracker
numbers rescope. That write lands on live data, so it is one click for the user rather than a probe
that edits their grid.

---

### 2026-08-20 (4) — the create burst is ONE BATCH: 98 Atlas round trips become 4, and 8.9s becomes 0.3s

The item the 2026-08-20 entry deliberately left unwritten — *"stated rather than half-shipped… it
wants its own reviewed pass"*. This is that pass.

**THE COST, MEASURED BEFORE ANY CODE WAS WRITTEN.** A test that drives the REAL handler with Mongo
mocked and COUNTS round trips reported **98** for a 49-slot build — 49 occurrence upserts and 49
parent `$push`es of ONE child, serialized through a per-socket Promise chain. That is the number the
half-built-schedule entry inferred; here it is measured, and it is now a test, so nobody can
reintroduce a per-create write silently.

**Now a burst is collected and written as one batch:** bulkWrite the rows · read the parents · one
`$push $each` per parent · re-read them. **Four round trips regardless of burst size**, and the test
that pins it asserts the invariant a fixed number cannot state — *the same cost for 5 creates as for
50*.
```
                    round trips        wall clock, REAL Atlas, 49 creates
before                   98                       8931ms
after                     4                        319ms
```

**THE COALESCING WINDOW IS `setImmediate`, and that is not a detail.** socket.io decodes and emits
each packet as its own task, so a microtask closes the window after the first event and every batch
is a batch of one. It is not a timer either — a delay would tax the single-create case (a drag, a
click) to buy nothing. **The prod log shows exactly the predicted shape:** `create_batch START 1 /
DONE 1` for the first packet, then `START 29 / DONE 29` for the rest.

**WHAT THE SERIALIZATION WAS PROTECTING IS KEPT, and that is the whole risk of this change.** `$each`
preserves emit order within a parent and the batch is assembled in emit order. Idempotency moves from
the per-create `$ne` filter to a pre-read plus a set difference. `insertAtIndex` keeps the original
single-row path, because `$each` + `$position` cannot express several different positions in one
update. **The cache rollback is unchanged in spirit and batched in form** — a create that does not
reach Mongo must leave nothing in the warm cache, or `update_occurrence` launders the phantom into a
persisted dangling child ref (2026-08-04, five sweeps).

**THE A/B IS THE PROOF, and it is the right shape for a perf change: the two COST tests fail against
the old handler and the six BEHAVIOUR tests pass against BOTH.** That is what says this changed the
cost and not the semantics. Separately, defeating the cache rollback fails exactly the three phantom
tests and nothing else.

**ASK THE SIGNAL, NOT THE ERROR — found only by aborting a real bulkWrite.** Cancelling one mid-flight
cancels the write correctly (nothing persists, the pool slot frees) and then surfaces as a
**`TypeError`** reading *"Cannot set property name of which has only a getter"* — a driver artifact,
not an `AbortError`. Matching that string would be brittle AND would swallow genuine TypeErrors, so
`isAbort` asks the controller we aborted ourselves. Without it, an ordinary reload logs an error and
emits a spurious `server_error`. *A live (un-aborted) signal was verified harmless first — the check
that mattered, since a throw there would have broken every batch.*

**VERIFIED AGAINST A REAL DATABASE BY DIFFING PERSISTED STATE**, because the risk was a persistence
layer quietly dropping a field — the 2026-08-01 (20) lesson, where Mongoose's `minimize` stripped an
empty object and no in-memory test could see it. A bulkWrite-upserted row and a findOneAndUpdate-
upserted row persist **identically**: 24 keys, the only difference a per-write `timestamp`. So
`setDefaultsOnInsert` applies the same way. Then end to end through the real handler: 49/49 rows,
parent listing all 49 in emit order, **`identitySignature` intact 49/49** (merge idempotency depends
on it), fields and sortOrder kept, cache truthful, replay still 49. Every scratch database dropped
afterwards.

**AND IT IS EXERCISED ON PRODUCTION, not just deployed.** A first grid load fired **no** creates —
the feeds were already in sync — so the deployed path was unexercised and saying "deployed" would
have been the weaker claim. Drove 30 creates through the DEPLOYED server over a real socket against
**test grid 2** (disposable by design; poms grid never touched): 30/30 persisted, listed in emit
order, signatures intact, **203ms**, 0 errors in the log, and all 31 probe documents deleted after —
test grid 2 back to **0 integrity errors**.

**Only server code was owed to prod, and checking that is the 2026-08-13 (3) rule paying off:**
`git diff --name-only` against prod HEAD showed the only `client/` changes were tests and a fixture,
so no bundle changed and nobody has to reload. 927 server tests.

---

### 2026-08-20 (3) — I OPENED IT IN A BROWSER, and the Medications board could not be reached

Picked up the other account's session, which hit its limit part-way through the browser pass the
last two entries both name as their honest gap. **Every claim those entries made about the data was
true. One of them was also unopenable.**

**THE DEFECT ONLY A BROWSER COULD FIND.** `0158` minted the Medications board with
`parentId: supBoard.parentId`, commented *"the same folder the other boards live in"*. **A board
CONTAINER is not in a folder.** Supplements is a PAIR — a `page/board` homed in `Root/Boards/Food`
whose `occurrences[]` LISTS a `container/board` whose own `parentId` is null:
```
Supplements   page/board       parent=FOLDER:Food   lists the container   -> opens
Supplements   container/board  parent=(none)        listed by the page
Medications   container/board  parent=(none)        listedBy=[]           -> nothing to open
```
So the board held all four medications, the dropdown resolved them, the feed was on, and **every
read-back this repo performed said it was fine** — because every one of them read Mongo. `0163` mints
the missing page. *The created-but-unlinked class from a seventh direction, and the first where the
data was perfect and only the ROUTE to it was missing.*

**IT REPAIRS FORWARD RATHER THAN EDITING `0158`.** That migration has executed and its ledger entry
has to describe what ran — the 2026-08-07 (4) rule. Migrations run in order, so a grid that has seen
neither gets the orphan and the repair back to back and converges. Editing history would have saved
one file and made the ledger a lie.

**THE INTEGRITY RULE WAS NARROWED BY A MEASUREMENT, and the number is the whole reason.**
`unreachable-board` fires on a feed-backed board container that no occurrence lists and nothing
parents — 1 of 36 on poms grid before the repair, 0 after, 0 on all five grids. **The obvious wider
rule — "any board container nobody lists" — matches 12 MORE live rows**, the `<ingredient> — files`
containers, which are reached through a FIELD VALUE: the third reachability path 2026-08-13 (4) was
paid for missing. *A guard that cries wolf on the day it ships is one somebody weakens later.* A/B'd:
defeating the predicate fails exactly the one test that asserts it flags and none of the four that
assert it stays quiet.

**AND THE WEEKDAY WORK IS VERIFIED ON SCREEN AT LAST** — the gap the last entry closed with *"nobody
has reloaded the grid and watched Thursday's core + cardio session land."* Somebody has now:
```
7:00am   Eat · Exercise x6 -> Planks, Russian Twists, Leg Raises, Bicycle Crunches,
                              Ab Rollouts, Side Planks · Run · Stretch
7:30am   Hygiene · Hot Tub · Take Medication          <- the morning dose, in Hygiene's own slot
9:00pm   Journal · Eat · Take Medication              <- the night dose, in Journal's own slot
```
Thursday is the cardio day, so Run and Stretch beside the six core movements **is** the
discriminating case. Movement picks resolve to NAMES rather than raw ids, which was its own bug once.
The Medications board renders all four; CBD Gummies sits on Ingredients with its picture and reads
`ingredient, grocery` · 33 cal · protein 0. **0 page errors on every load.**

**MY PROBE REPORTED ZERO SLOTS ON A SCHEDULE WITH 48 OF THEM.** The header innerText is
`"12:00am\nDate:\n—\nThu, Aug 20"` — it carries its own Date pill — and my `^…$` match required the
whole string. *A probe that reports zero is a claim about the probe*, for the Nth time. **A second
probe then disagreed with the first about the SAME slot** — 9 rows, then 3 — which is
`content-visibility` de-rendering rows once they scroll out of view. Settled by reading 7:00am while
it was demonstrably `inViewport`, and screenshotted. *Two reads of one slot disagreeing is not a
contradiction to average; it is a question about when each was taken.*

**Left alone, reported not acted on:** Planks and Side Planks read `Set 1: 1 reps`, because `0119`
backfilled the catalog prescription and a plank is TIMED rather than counted. It is the prescription
the catalog holds, so changing it is the user's call, not a migration's.

2821 client + 919 server tests, poms grid **1 pre-existing error, 0 new**.

---

### 2026-08-20 (2) — the prescription comes off the bench, and the parked diagnosis was WRONG

Picked up the other account's session, which hit its limit mid-sentence while mapping the six
`Workout N` slots. The op it had parked three hours earlier is now live, and the reason it was parked
does not survive contact with the pipeline's own shape.

**THE PARKED DIAGNOSIS IS RETRACTED.** `d7e31b74` recorded the tile holding *slots 1-3 blank and 4-6
with Pull-day movements* and concluded the op *"was matching template rows"*. **It cannot emit that.**
It clears all six slots and then writes slot `$n` in order, so its outputs are six values, a PREFIX of
the day's list, or six blanks — `1-3 blank, 4-6 filled` is none of those. That shape requires the six
CLEARS to be applied and then abandoned partway, which is exactly what `bindSocketToStore` did until
`6b6a5d1d` **committed the same morning**: one throwing effect silently discarded every effect after
it. *The op's writes were fine and the effect loop dropped half of them — a second bug wearing the
first one's symptoms.*

**THE COLUMN SCOPE FIRES, which closes a question four sessions had been varying rules against.**
Driven through the real executor over a fresh export, with the healthy case as the control that makes
the difference mean anything:
```
rows on the column, DATED        page+date 6 · column 6      agree — the control
rows on the column, UNDATED      page+date 0 · column 6      the rollover, and the reason to switch
no column for today at all       page+date 6 · column 0      the column form fails CLOSED
```
`HAS_ANCESTOR $colId` reported nothing on 2026-08-19 because the column was **truncated by a pm2
restart mid-build** — the same restart behind the entry below this one. *Four attempts varied the
scope rules; the scope was never what was wrong, and the data it was being measured against was.*

**A TEST THAT LOOKED BROKEN WAS THE SYSTEM WORKING.** Deleting today's six movement rows and running
the FULL sweep does not produce a column with no movements: `Schedule: Place Cycle Day` merges them
back in during the same sweep. Six rows deleted, the map confirmed empty, six movements still on the
tile. **The grid self-heals a truncated column, measurably** — so the two rollover cases drive the
single op instead. *Check the probe before believing the failure; and when the probe is right, ask
what the disagreement is telling you.*

**`fitnessPrescription.test.js` is back, with the two states that parked it** — a rollover with no
rows placed writes six CLEARS and no stale value survives; a half-drained build writes a PREFIX and
never a gap. Both assert against a tile **pre-loaded with a previous list**, so a survivor would be
visible as one. **THE CLOCK IS PINNED to the fixture's own `_exportedAt`**, because the fixture is one
day's snapshot and the op resolves `$today` at run time — otherwise every assertion goes red the next
morning, and a suite that fails by the calendar gets disabled rather than read. A/B'd: the old scope
fails **exactly** the unstamped-date test and none of the other six.

---

**MEDICATIONS, A TWICE-DAILY ROUTINE, AND CBD GUMMIES** — user, mid-session, plus their answer on
scheduling: ***"Daily, but twice."***

**EVERY PIECE IS COPIED FROM THE ONE THIS GRID ALREADY HAS, at run time rather than restated.**
`Recover` binds a multi-select `Supplement` dropdown scoped to the Supplements board — the same
three-part shape (board · dropdown · routine) one category over — so `0158` reads that board, that
field and the Hygiene routine as its exemplars. **Multi-select is precedent, not a guess**, and the
Habit marker rides along with Hygiene's bindings, which is what makes it impossible to forget (a
routine without it lands in the TASKS count, not Completed Habits).

**THE DOSE IS PART OF THE NAME, deliberately unlike `0122`**, which pulled amounts OUT of ingredient
titles. An ingredient's amount is a serving size; **a medication's dose is its IDENTITY** — 10mg and
20mg aripiprazole are different things to take, and a dropdown listing both as "Aripiprazole" is
unusable. Also on `module.meta.dose`, so nothing parses a label.

**TWO NAMES ARE SPELLED AS THE MANUFACTURER SPELLS THEM** — Vyvanse for *vivance*, Trazodone for
*trazadone*. On a medication list a phonetic spelling reads as correct and is not. Flagged to the
user rather than done silently; the doses are theirs, verbatim.

**BOTH PLACEMENT TIMES ARE LOOKUPS** (`0110`'s rule, two anchors): the slot holding **Hygiene** for
the morning, the slot holding **Journal** for the night — 7:30am and 9:00pm today, and still right the
first time either routine moves. On `Day` because that is what Build Schedule applies every morning,
on the five cycle templates because that is what Hygiene and Hot Tub look like here, and on today's
column directly so it is on the schedule now. It cannot double-place: `Place Cycle Day` only places
rows carrying a Meal or Movement pick.

**THE DROPDOWN IS LEFT EMPTY ON BOTH ROWS.** Which pills go in which dose is a medical fact about this
prescription, and the obvious inference — stimulant in the morning, sedative at night — is the
plausible guess `0052` refused for phone numbers. The rows are the SLOTS; the picks are one tap each.

**THE DRY RUN CAUGHT MY OWN SELECTOR, which is the whole reason to read one.** `0159` copies a
30-binding ingredient rather than listing fields — *"every X" in a migration means every X that exists
when it runs* — and the widest-bound ingredient **on the grid** is `Milk`, one of five homed under the
**Grocery List** rather than under Ingredients. Following its parent would have filed CBD Gummies in
the wrong board **with every log line still reading correctly**. The home is now the board feeding on
the `ingredient` tag; being tagged `grocery` is what puts it on the list, and that board is a
materialized feed, not a home.

The user's numbers are verbatim — 33 kcal · 2g fat · 8g carbs · 15mg sodium per ONE gummy. **The 10mg
is CBD, not a nutrient**, so it lives in the serving size where the micronutrient trackers cannot sum
it into something meaningless. **Protein 0 is the single derived value and says so.** Every other
vitamin and mineral is left BLANK: `0123` could write reference values for whole foods because a
food's content is public and lookupable, and a manufactured gummy's is not.

**Read back out of the database rather than off the log:** the board holds all four medications, the
dropdown resolves them and excludes feed copies, 15 `Take Medication` rows carry the Habit marker, and
CBD Gummies sits on Ingredients with a picture attached by **re-running `0121`** — which is generic
and gap-filling, so it wanted no second copy of itself. 2805 client tests, poms grid **1 pre-existing
error, 0 new**.

**NOT VERIFIED, and it is the honest gap: nobody has looked at any of it in a browser.** Every write is
proven through the real executor over the live data and read back out of Mongo, but the tile, the
Medications board and the two schedule rows have not been seen on screen.

**FILED, NOT BUILT:** weekday templates (`docs/superpowers/plans/2026-08-20-weekday-templates.md`).
The user asked to *"look into"* a template per weekday for repeatable appointments. It is a THIRD
layer, not a replacement — the cycle is FIVE days and they chose to keep it. The missing primitive is
a `weekday:` token (`dateLong:` computes the weekday and throws it away; parsing it out of the column
LABEL is the trap the de-schedule sweep removed `SCHEDULE_LABEL_PREFIX` for). **And the real risk is
not the templates:** `Place Cycle Day` is idempotent by accident of its filter — it only places rows
carrying a pick — while a weekday template holds arbitrary rows, so without its own signature scheme
every load re-clones the whole template into the column.

---

**AND THE CYCLE IS GONE: SEVEN WEEKDAY TEMPLATES.** User: ***"i dont want a cycle, i just want 7 day
templates"***, then ***"give the templates weekday fields"***.

**MEASURING CHANGED THE SHAPE OF THE WORK BEFORE ANY CODE.** All five cycle templates carry the
**identical 8 meals** — only the movements differ — so the week needed a workout assignment and
nothing else. Asked whether food should rotate too (*"do we have a cycle for food… if not then just
keep it the same"*): **there is no food cycle to rotate**, so meals stay identical, as instructed.
*Reported rather than acted on: the Nutrition Plan document DOES define three distinct days of
menus; the grid only ever used one of them.*

**IT RENAMES THE FIVE RATHER THAN MINTING SEVEN.** Four of them already ARE the day the user asked
for. Minting seven fresh templates would re-create ~340 slot occurrences to arrive at content the
grid already holds, and strand five as dead clutter — the thing the user complained about once
already ("why are the old ingredients in the grocery list"). Day 5 becomes Friday and gains Run +
Stretch; Saturday and Sunday clone from it.

**THE DAILY ROUTINES COME OFF ALL SEVEN, and that is the load-bearing decision.** `Place Cycle Day`
could carry them harmlessly because it only placed rows holding a Meal or Movement PICK — and **that
filter is exactly what would make this feature pointless**, since the user's reason for wanting
weekdays is *"specific appointments certain days that are repeatable"* and an appointment carries
neither pick. So the op places EVERYTHING and the template holds only what makes that weekday
different. Decided **structurally** — slot time AND module label both matching a row on `Day` —
never from a list of names: **35 = 7 rows x 5 templates**, with Day 4's 7:00am Run and Stretch
correctly surviving, which is the discriminating case and the reason the rule tests the slot too.

**THE TEMPLATE IS FOUND BY ITS FIELD, which is what the user's phrasing buys.** Baking seven ids
into the pipeline would have made the Weekday field decorative; matching on a NAME would break the
schedule on a rename. `weekday:expr` is the new primitive — `dateLong:` computed the weekday and
buried it in a label — and both share one local-midnight parse, because `new Date("2026-08-24")` is
UTC midnight, i.e. **Sunday evening in CDT: a naive parse puts every Monday's template on Sunday,
silently, and only west of UTC.** That case is the test, with the naive reading kept beside it as the
control.

**IDEMPOTENCE IS `mergeSubtreeInto`'s `auto:<sourceId>` FALLBACK — read in the code, then measured.**
A row nobody hand-signed matches ITSELF on the next merge, so an appointment dragged onto Tuesday is
placed once and recognised every load after, with no signature scheme to remember. A second pass over
the same state creates **0**. Without that, every load re-clones the whole template into the column —
the 23-duplicate-wrappers bug of 2026-07-31 (3), waiting for a third turn.

```
Mon 6 movements Push   Thu 8 creates (6 core + Run + Stretch)   second pass          0 creates
Tue 6 movements Legs   Fri 2 creates (cardio only)              no template claims   0, fails closed
Wed 6 movements Pull   Sat/Sun 0 — meals and routines only
```

**TODAY'S COLUMN WAS CLEARED, and only because the numbers said it was safe.** It held Wednesday's
Pull session, placed this morning while the cycle still ran, and today is a Thursday. Each row was
measured against the movement catalog first: **every set value equalled the catalog prescription
`0119` backfilled (5/5/5/5, 6/6/6/6, 8/8/8/8…) and `Completed` was null on all six.** So it carried
nothing the user entered by `0109`'s own discriminator. Dumped to `backups/orphans/` first. *A row
that differed from its prescription, or was ticked, would have been kept and reported — a workout log
is not something a migration gets to tidy.*

**MY OWN PROBE WAS WRONG TWICE AND THE OP'S RUN LOG SETTLED IT.** It read **0 effects on every
weekday**, which looks exactly like a broken op — and this op's ancestor had just spent four sessions
being broken in that way. `computeTriggerMatch` said it matched, so the log was the next place to
look, and one line named it: every run iterated `$day = 2026-08-20` whatever date I faked.
**`$activePeriodDates` resolves from `operation.targetOccurrenceId`'s effective filter — the op's OWN
page — not from the clock and not from `grid.activeFilterValues`.** *A probe that reports zero is a
claim about the probe until the callee's own log agrees with it.*

**AND THE `noDomainKnowledge` GUARD CAUGHT MY OWN COMMENT** — I named the removed label-prefix
constant while explaining why not to parse labels, and the guard greps source TEXT, which cannot tell
a comment from the code that would reintroduce it. **Reworded rather than narrowed:** a guard that
gets weakened the first time it fires is one nobody trusts.

12 regression tests for the week (each weekday's own movements, the cardio discriminator, the second
pass, the fails-closed case, and the templates-carry-no-daily-routines invariant), and the fitness
harness gained a `world` argument because today's rows are now placed DURING the sweep rather than
existing before it — which is also the real order. 2821 client tests, poms grid **1 pre-existing
error, 0 new**, deployed.

**STILL NOT VERIFIED IN A BROWSER, and it is the same honest gap:** nobody has reloaded the grid and
watched Thursday's core + cardio session land on today's column.


---

### 2026-08-20 — the schedule half-builds because I RESTART THE SERVER MID-BUILD

User: *"it always half built. we need to figure out why the schedule is only half building
everyday."*

**MY FIRST THEORY WAS WRONG AND IS RETRACTED.** I had found an unguarded effect loop in
`bindSocketToStore` (one throwing effect silently discarded every effect after it) and shipped a
per-effect try/catch, implying it was the cause. The user's next console proved otherwise: **239
effects applied in 80ms with no `effect ... threw` line at all.** Nothing throws. The guard is
reasonable hardening and it fixed nothing. *A plausible mechanism that would produce the symptom is
not evidence that it did.*

**THE CHAIN, EACH LINK MEASURED, AND EACH ONE KILLED A SUSPECT:**
```
the OP        driven from a fresh day over the real fixture -> 55 creates in ONE pass, then 0
              from a 17-child column -> 33 creates (17+33 = the full 50). It tops up correctly.
the CLIENT    applies every effect in one synchronous loop: 239 effects / 80ms
the CACHE     localOccsById is CLEARED and rebuilt from the payload on every full_state,
              so a stale optimistic copy cannot mask a truncated build
the SERVER    create_occurrence is a PER-SOCKET SERIALIZED promise chain, 2-3 Atlas round
              trips each: ~65ms warm, ~440ms cold -> a 49-slot build drains for SECONDS
```
So the op, the client and the cache are all fine. What is fragile is the DRAIN WINDOW.

**THE LOG NAMES IT IN THREE LINES:**
```
create_occurrence START 55b791a4-...     <- the 18th, 8:00am
Server running on port 5000              <- the process restarted, mid-write
Server running on port 5000              <- and again
```
That create logged START and never logged DONE. Across the whole log: **2009 STARTs, 2008 DONEs** —
**exactly one** create began and never finished, which is the signature of a kill rather than a
disconnect (a disconnect logs SKIP/ABORT, and there are **0** of each). The slots agree: burst one
wrote the first 18 **in clock order** (Due, 12:00am -> 8:00am) and stopped dead; burst two resumed at
exactly 8:30am and finished.

**WHO RESTARTS IT: I DO.** pm2 reports **255 restarts**, and they are not crashes — 3.2GB free, no
OOM kill, watch disabled. They are deliberate `pm2 restart` calls, which is what `deploy.sh` and
every migration apply does. Today the build died at **06:53** and completed at **07:24**, which is
three minutes after my own deploy. *The recurring daily defect is my own deploys and migration
restarts landing on the user's morning load.*

**IT SELF-HEALS, AND THAT IS WHY THE GAP WAS 30 MINUTES RATHER THAN PERMANENT.** A reconnect brings
a fresh `full_state`, the sweep runs, and the op tops the column up — proven in the harness above.
The server logged no killed second batch (STARTs == DONEs + 1), so no sweep ran in those 30
minutes: **the tab was suspended and healed the moment it reconnected.** The user stares at a half
schedule for exactly as long as their tab is asleep.

**AND THE REASON IT NEVER HEALED IS A REAL DEFECT, FIXED:** `App.jsx` latched
`request_full_state` per MOUNT (`didRequest` + `socket.once("connect")`), so **a reconnect asked for
nothing**. The server only sends `full_state` when asked and the sweep rides on that payload — so
after a reconnect nothing re-ran, and whatever the server dropped stayed dropped **until the page
was RELOADED**. That is the whole 30-minute gap: it completed at 07:24 because my deploy shipped a
new bundle and the tab reloaded. The latch is per CONNECTION now (`helpers/fullStateRequest.js`),
still collapsing the already-connected fast path and the `connect` event into one request, with
disconnect re-arming it. **This makes the app self-heal from ANY interrupted burst, not just this
one.** Extracted from `App.jsx` because mounting App needs the whole store and the latch is exactly
where the bug lived; 6 tests, A/B'd — never re-arming fails exactly the reconnect case and nothing
else, behind a control asserting a FIRST request happens at all.

**THE STANDING RULE THIS EARNS ANYWAY: do not deploy or apply a migration while the user may be
loading the grid.** A restart is not free — it truncates whatever burst is in flight, and the
schedule build is the longest burst this app has. The reconnect fix makes that recoverable rather
than permanent; it does not make it free.

**THE REMAINING FIX IS NOT WRITTEN, and is stated rather than half-shipped:** the build is ~49 creates
x 2-3 serialized round trips (~150 in total), including a parent `$push` of ONE child at a time to
the same parent. Batching that into a single bulk write collapses the vulnerable window from
seconds to ~100ms and speeds up every other burst (feeds, templates, day pages). It is a change to
the create path this repo has repeatedly been damaged by, so it wants its own reviewed pass.

**Also found, not chased:** the public endpoint takes uncaught `URIError`s from bot scanners
(`..%c0%af..%c0%af..env`, `/wp-admin/install.php`). `process.on("uncaughtException")` catches them
so the process survives, but they are noise in the error log and were briefly a red herring here.

---

### 2026-08-19 (9) — I fixed THREE call sites and there were TEN

User: *"its still not showing up. things like movement ingrediant meal, they dont have borders
currently"* — then, a minute later, *"or they do they are just way too light."*

**THE SECOND MESSAGE IS THE DIAGNOSIS, and it is the one I should have reached myself.** (8) gave
the pill edge a token and fixed the call sites it had MEASURED — the select pill, the date pill,
the chips. The occurrence dropdowns render through `MultiSelectWithAdd` and four other wrappers,
each carrying its OWN hardcoded `rgba(var(--occ-pill) / 0.25)` — **lighter than the 0.30 that pass
replaced.** So the controls a user actually names, because they are the ones with words in them,
kept the faintest edge on the grid. Seven sites, all now reading `--occ-pill-border` with their own
alpha as the dark-theme fallback.

**The lesson is cheap and I paid full price for it: I fixed the call sites I had measured instead
of grepping the TOKEN.** `--occ-pill` appears seventeen times in that one file. The constant now
says to grep before adding an eleventh — the same instruction 2026-08-08 (10) wrote after wiring
three identical handlers, arrived at from the other direction.

**AND A SINGLE PICK NOW LOOKS LIKE A MULTI PICK OF ONE.** User: *"make selectors like meal show a
pill inside like ingredient does. so one selected should look like one that has multiple
selected."* Meal and Ingredient are both occurrence dropdowns over the same kind of board — one
single, one multi — and they rendered as two visually unrelated controls for one idea. The single
draws its selection as the same chip now, with the same clear button. **Empty stays plain,
deliberately: a chip around an em-dash reads as a selection you cannot remove.**

Verified on prod under Stardew: `Project: [Roubo bench hook x]` renders as a bordered chip with a
clear button, `rgb(120,75,33)` edges on every pill, and an unset field still reads `Project: —`.
2778 client tests.

---

### 2026-08-19 (8) — the pill border was THERE and did nothing; and a text pill painted a hardcoded green

User: *"those pills need a border, at least in the stardew valley one."*

**THE BORDER EXISTED.** Measured on the live grid rather than assumed absent: `1px solid
rgba(var(--occ-pill) / 0.30)`. On Stardew that composites to about **rgb(168,143,108) against a
rgb(164,157,133) surface** — a few points apart, which is not an edge. *"Needs a border" and "has a
border that resolves to its own background" look identical on screen and are fixed differently.*

**AND NO SINGLE ALPHA IS RIGHT FOR BOTH FAMILIES, which is why this is a token rather than a
number.** The green value pills beside it look fine at the SAME 0.30-0.35 alpha, because green
separates from cream and brown does not. Raising it globally would over-draw every dark theme. So
`--occ-pill-border` defaults in the JS to today's value — **every dark theme is byte-identical** —
and the three light themes set
`color-mix(in srgb, rgb(var(--occ-pill)) 55%, hsl(var(--foreground-1)))`: the pill's own hue mixed
with the theme's ink, so the edge stays HUED instead of becoming a neutral outline. Verified
resolved on prod at **rgb(120,75,33)**, which is the value the mix was chosen to produce. The
multi-select chips had no border at all and take the same one.

**THE SAME INSPECTION FOUND A HARDCODED COLOUR, which is the more interesting half.**
`valueSignPillTint`'s final branch — the one a TEXT value falls through to — returned a literal
`rgba(34,197,94, ...)` emerald while every other branch reads `--signal-*`. So a text pill ignored
the theme entirely and sat beside a number pill **in a different green**: Stardew's `--signal-pos`
is a muted (74,158,63), the literal was (34,197,94). Nobody would report that as a bug; it just
looks slightly off. Confirmed reading the token on prod after the change.

**Deliberately left:** `FLOW_TINTS` is a fixed three-colour semantic palette for in/replace/out, not
a theme surface, and is documented as such.

**A WORKFLOW NOTE, third occurrence today: `deploy.sh` runs its own `git add -A`,** so editing and
then deploying absorbs the work into a `deploy: update site` commit and discards the prepared
message. The reasoning survives in the code comments, but the fix is to COMMIT FIRST, then deploy.

2778 client tests, deployed, verified by looking.

---

### 2026-08-19 (7) — the other two LIGHT themes had it worse, and one of them needed a DIFFERENT fix

(6) fixed Stardew because that is what the user runs. It left a note that `moduli-light` and
`vintage-light` had the same shape and no number against them. Measured — and they were worse:
```
                      green value pill      select / date pill
moduli-light                1.5:1                 3.51:1        21 of 21 rows under 4.5
vintage-light               2.5:1                 2.97:1        21 of 21 rows under 4.5
```
**`moduli-light`'s green ink was `#16a34a`, which is `--signal-pos` EXACTLY** — the same colour as
the 20%-alpha fill it sits on. Guaranteed illegible, by construction, on any light surface.

**THE TWO THEMES NEEDED DIFFERENT FIXES, and noticing that is the point.** The obvious move is to
derive every signal ink from its `--signal-*` the way (6) did. Right for `moduli-light`, where ink
and signal are already the same hue. **Wrong for `vintage-light`, which deliberately re-hues: its
"blue" ink is a RUST tone while `--signal-zero` is TEAL.** Deriving would have quietly overwritten
a choice the theme's author made on purpose — so that one darkens the AUTHORED colour toward black
instead, keeping every hue and buying only the contrast. *A fix that is correct on one instance of
a class is not automatically correct on the next; check what the second one was doing deliberately.*

Both then hit the same second limiter (6) hit: `--occ-pill-text` at a mid tone. It follows
`--foreground-1` on all three light themes now. **The fill still carries the hue, so a pill is
still tinted — only the ink goes dark**, which is what the screenshots show.
```
moduli-light    bulk 1.5  -> 6.05-6.09
vintage-light   bulk 2.5  -> 4.72+
```
**The residual "failures" are the PROBE, and they are identifiable rather than hand-waved:** every
one reports a ratio of exactly 1.00 with ink IDENTICAL to background, which means the sampled box
held a single colour — no text in it at all — plus the rating field, whose "ink" is a star glyph.
*A contrast of exactly 1.00 is not a contrast reading; it is an empty sample.* Settled the way a
colour claim has to be: both themes screenshotted and looked at, every pill legible.

Scoped to eight token lines across the two theme blocks; no other skin can be affected. 2778 client
tests, deployed, verified by looking.

---

### 2026-08-19 (6) — the pills assumed a DARK surface, and six probes were wrong before one was right

User: *"the account dropdowns are very hard to read currently color wise"*, *"any dropdown select
really is hard to read"*, *"ingrediant too"* — with a screenshot of the live grid under Stardew.

**THREE CONTROLS HARDCODED A DARK-SURFACE COLOUR instead of a theme token:**
```
compact SELECT pill   bg-white/5 border-white/10 text-white/60
compact DATE pill     bg-white/5 border-white/10 text-white/55
multi-select CHIPS    bg-primary/20 text-primary
```
White ink at 55-60% opacity is fine over near-black and gone over cream — and `--primary` is
near-WHITE in the base `:root`, so a chip's legibility depended on whether its theme happened to
redefine it. All three now use `--occ-pill` / `--occ-pill-text`, the pair that exists for exactly
this and that all six themes define against their own surface. The boolean OFF pill had the same
assumption with no text (`bg-white/5`), so on a light theme it had no visible box at all.

**THE TOKEN ALONE WAS NOT ENOUGH, and only measuring showed it.** Stardew's `--occ-pill-text` was a
MID brown scoring **3.76:1** against the pill it sits on. It follows `--foreground-1` now — the ink
the theme already uses for prose — which computed to 5.66 and **measured 5.71**. The same held one
level out: the value pills are `rgba(signal / 0.2)`, so on cream a mid-tone ink of the same hue is
the same luminance as its own fill (green **1.8:1**, blue 2.3, red 2.0). Those inks are
`color-mix(in srgb, rgb(var(--signal-*)) 32%, black)` now — **derived from the signal hue, so
retinting a signal moves its ink with it and the two cannot drift.**
```
Stardew   select 1.52 -> 5.05    date 1.39 -> 5.22    green value 1.8 -> 4.9-5.4
Blueprint values unchanged at 7.5-11:1
```

**SIX PROBES WERE WRONG BEFORE ONE WAS RIGHT, and the sequence is the lesson.** (1) A regex for
`rgba()` scored an `oklab()` colour as BLACK and reported 1.12:1 on pills that were merely faint —
Tailwind opacity utilities compile to `oklab`. (2) Canvas `fillStyle` does not normalise `oklab`
either, so the retry inherited a `#000` fallback and produced the identical wrong number. (3) A
CSS background-compositing walk stopped at the wrong layer and scored legible green pills at 1.26.
(4) Switching to RENDERED PIXELS finally worked — until (5) the ink-picker chose the 0.7-opacity
LABEL rather than the value, making a fixed pill look unfixed. (6) And with that corrected, three
rows still read as near-white ink: the probe had mistaken **a bright cloud in the wallpaper**,
showing through a translucent pill, for the text. *The pixel method is only ground truth when the
background is uniform; behind a wallpaper it is not.* Settled by reading the computed colour
(`rgb(52,31,14)` — correct) and then LOOKING at the render.

**The standing rule earns restating in its strongest form: a colour claim is not settled by a
number until the number has been shown to move on a case you already know the answer to.** Every
wrong probe here produced a plausible, precise, quotable figure.

CSS-only for the signal inks, so it is scoped to one theme block and no other skin can be affected.
2778 client tests. Deployed and verified by looking, on both skins.

---

### 2026-08-19 (5) — the slot TEMPLATE carried yesterday's date, and every copy inherited it

User: *"a bunch of timeslots are still missing for today"*, then *"fix the reason those timeslots
broke too."*

**NOTHING WAS MISSING, AND THAT WAS THE FIRST THING TO ESTABLISH.** Today's column held all 48
half-hour slots, listed, in clock order, 0 parented-but-unlisted — so this was never the 2026-07-30
link failure the symptom resembles. **21 of its 49 children carried `Date = 2026-08-18`** while the
grid, the page and the column all filtered on today, so the filter hid them. Driven through the REAL
`isOccurrenceVisible` over live data, **with a control** (the same slot re-dated to today comes back
visible, so the selector is not simply rejecting everything):
```
VISIBLE 28   HIDDEN 21
first visible   5:00am            <- the earlier report, "only 5am and beyond"
hidden          12:00am-4:30am
                7:30am-12:00pm    <- this report, "a bunch still missing"
```
**Both of the user's reports are one defect seen from two positions in the day** — which is why the
first one looked like a start-of-day problem and the second like a middle-of-day one.

**THE CAUSE IS ONE LEVEL UP, found by following `meta.copyLinkSource` rather than theorising.** Every
one of the 21 is a COPY_LINK copy of a slot in the **`Day` template**, and 21 of that template's 55
nodes carry 2026-08-18. COPY_LINK copies a source's FIELDS, so **every day column minted from it is
born with a date that is already wrong.** CLAUDE.md 2026-07-30 (2) states the rule in one line —
*"repair the masters and the copies in the same pass"* — and only the copies had ever been repaired.
`0144` cleared today's copies; `0145` cleared the master.

**IT CLEARS RATHER THAN RE-STAMPS, and a second grid is what settles that.** 28 of the 49 children
carry NO date and render fine: the COLUMN carries the day and the cascade resolves visibility.
Stamping today's date works today and goes stale tomorrow — the trade 2026-08-11 (2) refused for
trackers. **test grid 1 has 61 copy-link sources and 0 dated**, which is the healthy shape stated by
something other than my own reasoning.

**SCOPED STRUCTURALLY, NAMING NO DOMAIN CONCEPT.** The rule is *"an occurrence something copy-links
FROM must not carry a value in a field the grid FILTERS on"*, and the filter fields are read off the
grid's own `activeFilterValues` and `namedFilters[].conditions[].fieldId`. Nothing learns what a
schedule or a timeslot is — `noDomainKnowledge` stays satisfied.

**AND THE CLASS IS LOUD NOW.** `gridIntegrity` gains **`dated-copy-link-source`**. It fired on the
live defect BEFORE the repair (21) and reports 0 after — a rule nobody has watched fail is a guess.
A/B'd: disabling the predicate fails exactly the one test that asserts it flags and none of the four
that assert it stays quiet (a source with no filter value, a value in an unfiltered field, an
occurrence nothing copies, and a grid that filters on nothing).

**WHAT STAMPED THE TEMPLATE ON 2026-08-18 IS NOT ESTABLISHED, and is deliberately not guessed at.**
The integrity rule is the answer to not knowing: the next occurrence is reported the same day
instead of propagating into a morning of invisible slots.

Only the DATE was cleared — **the `Time Slot` identity markers are untouched** (48 of 49 still carry
one), which is the trap 2026-07-30 records: `Build Schedule`, `Alarm` and `Pomodoro: Start` all FIND
their slot by that value, and nulling it breaks all three. poms grid **0 errors**, 914 server tests,
deployed and prod HEAD verified.

---

### 2026-08-19 (4) — the day's schedule was EMPTY because `SET_VAR` never stripped `literal:`

User, mid-session: *"the schedule for today only created 5am and beyond again."*

**THE "AGAIN" POINTED AT THE WRONG BUG, and measuring said so before any code was read.**
2026-07-30 (2) records this symptom as a LINK failure — slot copies parented to the day column but
missing from its `occurrences[]`. Today:
```
today's column   48 slots, 12:00am -> 11:30pm · 49 children · 0 parented-but-unlisted
slots holding anything                          4 of 49, the first at 6:00am
```
The slots were all there and correctly listed. What was missing was their CONTENTS — the day's 8
meals and 8 movements. *A symptom that matches an old entry is a hypothesis, not a diagnosis.*

**THE FIXTURE HARNESS BUILT AN HOUR EARLIER FOUND IT IN ONE RUN, and reading the pipeline had
already produced two wrong theories.** Driving the real load sweep over poms grid's own exported
operations, `Schedule: Place Cycle Day` emitted **0 effects**, and its run log named the step:
```
SET_VAR   $mine  = "literal:1"     -> stored the STRING "literal:1"
INIT_VAR  $mine2 = $mine
IF        $mine2 IS "1"            -> false, forever
end, updates: []
```
`resolveExpr` is what strips a `literal:` prefix, and `SET_VAR` passed it **`cfg.expr` only**,
falling back to the **RAW `cfg.value`**. A step authored with `value:` never reached the stripper,
so the gate could never pass and the whole body was skipped — silently, with the op reporting a
clean run every time.

**THE IDENTICAL DEFECT IS DOCUMENTED ONE CASE BELOW IT.** `MULTIPLY_VAR`'s own comment: *"was
`expr`-only, so a caller passing `by: 240` got resolveExpr(undefined) → NaN → the multiply silently
no-op'd."* Two actions, one mistake, both silent — and the second was written *after* the first was
found and fixed. **A fix applied to one `case` is a fix to one case; grep the neighbours.**

**BLAST RADIUS MEASURED BEFORE TOUCHING A SHARED EXECUTOR CASE.** Of 55 stored `SET_VAR` steps:
**38 on `expr`** (untouched), **17 on `value`**, of which **16 were wrong** — 13 an unstripped
`literal:`, 3 an unresolved `$path` — and all 16 in this one op. The 17th is the bare number 7, and
`resolveExpr` returns non-strings as-is. **Result on the same harness: 0 effects → 16**, which is
exactly the 8 meals + 8 movements a cycle day places.

**This closes the gap 2026-08-13 (2) left open** — *"the op has never fired… that only proves out
at midnight."* It had been firing every load and exiting at its first gate the whole time.

**MY OWN PROBE WAS WRONG FOUR TIMES, and each was caught before it became a claim.** A trigger's
`targetId` is not an occurrence id (it is scoped by `subjectType` — a panel subject compares it to a
MODULE id); an action's type lives at `step.config.type`, not `step.actionType`; the load sweep is
fired with a **null** transaction type, not `"onLoad"`; and `executeActionItem` is POSITIONAL. The
third one is the expensive one: called with `"onLoad"` the sweep matched **0 of 68 ops**, reported
zero errors, and PASSED — a green test over a run that executed nothing. It was only found by
planting a deliberately broken step and watching the test stay green. **The positive control is now
a test of its own**, so "no errors" can never again mean "nothing ran".

A/B'd: restoring the old line fails exactly the 2 tests that describe the defect; the other 4 are
contract pins that pass either way and are kept as such. 2778 client tests, build clean, deployed,
prod HEAD verified.

**NOT VERIFIED, and it is the honest gap:** the 16 rows are proven through the real executor over
the real data, but nobody has watched them land on the live grid — the op writes on the next client
load, which is the user's own browser.

---

### 2026-08-19 (3b) — poms grid's OWN operations are under test at last; and the promo loses its charts page

**THE OLDEST OPEN ITEM: not one of poms grid's 68 stored pipelines had ever been covered.**
`liveOpsBehavioral` boots from `server/seed/*.json` — what a FRESH grid looks like — and poms grid
has diverged by ~143 migrations. `client/src/__tests__/fixtures/pomsGrid.json.br` (**292 KB brotli,
5.7 MB raw, 19.7x**; textmaps stripped because no action reads prose) plus
`pomsGridOps.test.js` closes that. It asserts the load sweep runs every op without one erroring —
**behind a control that it ran ≥20 of them at all** — plus, on the stored pipelines themselves: every
action names an executor case, every picker-direct `$allItemsById.<id>` resolves, every op target and
trigger target still exists. **Each is a defect this repo has actually shipped**, and it earned its
keep within the hour (see (4) above).

**THE PROMO LOSES ITS CHARTS PAGE, which is a stronger claim than the page was.** User: *"charts is
not a top level section — fold it in with tables."* `CONVERTIBLE_CONTAINER_KINDS` is
`["doc","board","canvas","table","graph"]` — a chart is one of the five things a container converts
between, so a section of its own sold it as a reporting bolt-on. **Re-measuring rather than carrying
the figures across caught two that were already stale:** the site said 4 ways to render a container
(source: 5, since `graph` joined them on 2026-08-18) and 5 looks shipping (source: 8). Widening the
list to what the user named exposed the two capabilities with no home at all — **filters and
organisation** — which is now the `organise` page, in the retired one's slot.

**And the sitemap test only checked one direction.** It asserted every capability page is listed; it
had nothing to say about a listing pointing at a page that no longer exists, which is exactly what
retiring one produces and is a 404 served to crawlers on request. A/B'd against the stale entry.

Verified on production: five capability pages in the nav and the cards, `/features/build` carrying
the fold with the corrected figure, `/features/organise` rendering, the retired route resolving to
the not-found page, the served sitemap listing exactly the five, **0 page errors**.

---

### 2026-08-19 (3) — the BAND was a boolean, and a boolean painted Stardew's frame out

Picked up the other account's session, which hit its limit mid-fix. It had just found a real
defect — `wallpaper`, `wallpaperScrim` and the rainbow fields in the JS skin registry were
**INERT**, read by nothing, so Blueprint (a skin defined as pure data, with no CSS block) applied
and the retro rainbow kept painting. Its fix — `applySkin` publishes every token the registry
names — was committed and deployed. **It works, and it shipped a regression with it.**

**`rainbow: <bool>` HAD TWO MEANINGS FOR `false`, AND ONLY ONE OF THEM SURVIVED.** "No band at
all" (the five plain skins) and "my own band, declared in CSS" — which is Stardew, whose block
sets `--retro-rainbow` to a **wooden frame**, deliberately, so the app still has a band in that
skin's material. Once the token was published from JS, `false` resolved to the first meaning, and
**an inline style on `<html>` beats a `:root[data-skin=…]` rule whatever its specificity**. The
frame vanished from poms grid. Nothing failed; it just stopped painting.

**MEASURED ON PRODUCTION BEFORE CHANGING ANYTHING**, by reading the computed token both ways on
the live document:
```
stardew, inline props CLEARED   --retro-rainbow: linear-gradient(90deg, #8a5a2b …)   <- the CSS
stardew, as applySkin writes it --retro-rainbow: none                                <- what ran
every other token               identical
```
So `band` is a VALUE now — `null` for no band, a CSS value for one. Three states, three values;
the gap a boolean had is gone by construction. A/B'd: restoring `band: null` on Stardew fails
exactly the parity test below and nothing else.

**AND THE TEST WRITTEN TO PIN THIS FOUND A SECOND DRIFT, TWO DAYS OLD.**
`skinCssParity.test.js` asserts that every skin's CSS block declares what the registry publishes
— the only defence, since the registry always wins and the stylesheet keeps reading like the
source of truth. It failed on `--grid-surface-a`: the stylesheet said **0.18**, and
`StyleHelpers.SURFACE_ALPHA` has said **0.24** since 2026-08-17. In the grid that is only a
pre-mount fallback — **but `PagePreviewApp` never publishes the token**, so every folder-page
PREVIEW CARD has been painting its surfaces lighter than the same container in the grid. The
comment above it claimed the two "cannot drift". They had. *A comment asserting an invariant is
not the invariant; the test is.*

**Blueprint is skipped by the parity test because it has no token block, and that is the point** —
it is the skin that proves a new look is a DATA edit rather than a CSS one.

**Verified through the REAL code path, by real clicks on production** — switching claude-grid to
Stardew in the Appearance tab and back, rather than simulating the inline write (which is what my
first probe did, and it proves nothing about the code that runs):
```
blueprint   band none                    header ::after paints nothing
stardew     band linear-gradient(90deg…) header ::after paints rgb(138,90,43) -> rgb(176,111,48)
restored    blueprint, byte-identical to before        0 page errors
```
The second column is what matters: the token being right is not the claim, the band being
PAINTED is. 2760 client tests, build clean, prod HEAD verified, poms grid **0 errors**.

---

### 2026-08-19 (2) — SKINS: a Stardew theme, per-grid, and the two numbers that were one

User: *"make my current styling (the retro rainbow look) a default skin … change my main grid to use
the background i just saved … a star dew valley skin/theme. we need a ui to change the theme of the
grid. and cascade by occurance type."* Then, mid-build: *"make sure to include the first skins we
had, light and dark too"*, *"i thought we already had a css cascade"* (yes — see below), and *"use
the newest image in the screenshots folder."*

**THREE MEASUREMENTS SHAPED IT, and each one changed what the work was.**
```
the retro rainbow was NEVER A THEME    --grid-wallpaper / --retro-rainbow and their scrims sat in a
                                       BARE :root, outside every [data-theme] block — so they
                                       applied to all five themes and switching theme changed neither
the theme is per-BROWSER               localStorage["moduli-theme"], so "change my main grid" was
                                       not expressible at all
NO WEBFONT LOADED, ANYWHERE            @fontsource/jetbrains-mono has been a dependency for months
                                       and was NEVER IMPORTED: no @font-face in the sheet, no .woff2
                                       in dist, none served by prod. Every machine fell through to
                                       its own ui-monospace, so the app has looked subtly different
                                       on Windows, macOS and Linux this whole time.
```

**THE CASCADE ALREADY EXISTED AND I DID NOT BUILD A SECOND ONE.** The user asked directly, and they
were right: `resolveStyleCascade` has walked Grid → Panel → Page → Container → Instance since
2026-05-21, with a per-kind field whitelist and an editor mounted at six sites. What it could not
express is *"every doc container"*, because every level of it is a PLACEMENT. So `grid.meta.typeStyles`
is **one `pushLevel` added to the existing walk**, keyed `role/kind` — the string `checkGrid` and the
orphan sweep already use, rather than a second vocabulary. It had to reach `resolveContainerStyle`
and `resolveInstanceStyle`, not just the editor's walker, or the UI would show a level that does not
paint.

**A SKIN IS A SECOND AXIS TO THEMES, NOT A REPLACEMENT.** A theme owns the ~71 surface/text/signal
tokens; a skin owns wallpaper, scrims, fonts, and what happens to colours stored in the DATA.
Folding them together would mean re-authoring five themes to ship one wallpaper. The five original
looks are skins too, each pinning its theme with no wallpaper — and **their scrim goes to 1, which is
not a detail**: a translucent scrim over NO art is a wash over the body colour, not the flat surface
those looks are supposed to have. `:root[data-skin]` is 0,2,0 against a theme's 0,1,0, so a skin wins
whatever the source order, and **an unstamped document is byte-identical to today by construction.**

**THE 424 STORED COLOURS WERE THE WHOLE RISK, and the user's own suggestion was nearly the answer.**
They asked whether a cascade guard could set everything to inherit from its parent. The mechanism
exists (`styleMode`) — but measured: all 315 modules are `styleMode:"own"`, and the 109 occurrence
placements are applied by `resolveContainerStyle` with **no styleMode gate at all**, so there is no
switch to flip on a quarter of them. And it would be a write to protected live data that a second
migration would have to undo. Doing it at the RUNTIME chokepoint instead covers both halves, needs no
write, and is reversible by picking a different skin.

**THE REMAP COLLAPSED A FAMILY, AND ONLY RENDERING IT AS AN IMAGE CAUGHT IT.** The first version
snapped hue to eight anchors and clamped lightness into a band. Driving the real function over poms
grid's real 424 colours and drawing the before/after as a strip showed **nine distinct oranges
landing within four RGB points of each other** — nine different things on that grid, erased. Hue is
PULLED 55% toward the anchor now, and the source's own lightness RANGE is mapped onto the band rather
than clamped into it (almost every stored colour sits between 24% and 56%, so a clamp flattens the
set and a container stops reading lighter than its rows). **The regression test is RELATIVE**, which
is the only defensible threshold: two of the nine are 22 apart in the source already. Measured —
source 22, snap 4 (18%), pull 13 (59%).

**AND ONE NUMBER WAS DOING TWO OPPOSITE JOBS — found by LOOKING at poms grid, not by testing it.**
`surfaceAlpha` was published to `--grid-surface-a` AND used as the cap for stored colours. Under
Stardew those want opposite values, and with one number the result was unmistakable: *Physical* an
opaque orange slab, *Nutrition* inside it another, the rows inside that orange again — **three nested
fills, with the theme's dark-brown ink barely readable on top.** What a skin wants opaque is its own
cream panel; what a stored colour means is *"this row is Physical"*, which is an accent. Split into
`surfaceAlpha` (0.94) and `storedColorAlpha` (0.28); the retro skin has both at 0.24, i.e. unchanged.

**106 OF THE 424 ARE NOT REMAPPED AT ALL, deliberately** — they are the signal-neg red at 10%, a
STATE wash (missed / overdue) rather than a dimension colour. Re-hueing it would turn a signal into
decoration. A grey and anything unparseable are left alone for the same reason.

**AN INERT TOKEN SHIPPED AND WAS CAUGHT THE SAME WAY.** `--font-display` was declared by the skin and
read by nothing, so Silkscreen never loaded — the exact class of defect this session spent its day
removing, committed by me two hours later. It has the headers now; `document.fonts.check()` reports
it loaded, and the split is load-bearing rather than decorative: a blocky heading face at 10px body
text is genuinely unreadable, which is why the skin ships two.

**Verified by looking, on both grids and on production:** claude-grid (no stored colours) and poms
grid (424 of them), Silkscreen headers, VT323 body, wallpaper reading in the gutters, **0 page
errors** and **0 integrity errors** on both. The remap's before/after strip is kept at
`docs/stardew-palette-remap.png` — a palette change is a visual claim.

**FOUND WHILE LOOKING, AND FIXED:** a deleted occurrence left its embed node behind, painting
`embed: <uuid>` as raw text in the doc — a route the doc-page embed fix had just made ordinary. The
scrub is handed the ids the delete just removed, which is the whole difference between it and the
2026-08-01 (19) scrub that WAS the regression.

**AND I BROKE A LIVE OPERATION WITH A PROBE, which is worth recording.** Driving the ops editor, my
picker click landed on an EXISTING step rather than the new one — changing an action type KEEPS the
config, so `INIT_VAR $item = <the tile>` silently became `SUM_VAR` carrying the same config, which
then looked exactly like a stray I had added. Deleting it left `UPDATE $item.…` with nothing bound,
and "Sessions logged" failed on every load until I read the toast in my own screenshot. *A probe that
edits is a probe that can damage; the screenshot is what caught it, not the tests.*

---

### 2026-08-19 — FIXING WHAT THE BUILD FOUND: two actions that ran NOTHING, and 35 with nothing to configure

User: *"please fix the things you ran into and ask questions if needed."* Eight items were filed
against the claude-grid build; six are fixed, one is retracted as my own probe error, and every
answer that was a product decision was asked rather than guessed.

**THE MEASUREMENT CHANGED THE SCOPE BEFORE ANY CODE WAS WRITTEN.** Extracting the picker's action
list and diffing it against the executor's `case` labels and the builder's editors:
```
picker actions          70
NO EXECUTOR CASE         2    SET_FIELD_VALUE, LINK_OCCURRENCE_TO_PARENT
NO STEP EDITOR          35
```
**`LINK_OCCURRENCE_TO_PARENT` was a second silent no-op nobody had noticed** — the build only found
`SET_FIELD_VALUE` because that is the one I happened to use. A list read off the picker would have
fixed one and left the other; a diff found both.

**AND THE TWO ARE NOT THE SAME VERB, which is the reason both exist.** `ADD_CHILD` only LISTS a
child in a parent's `occurrences[]` and leaves `parentId` alone — that is what multi-parenting needs
(one slot shared across day columns). `LINK_OCCURRENCE_TO_PARENT` MOVES it: one `UPDATE_ITEM_PARENT`
effect, which unlists from the old parent, re-parents, and lists under the new one. *Listing without
parenting is the created-but-unlinked class this repo has repaired from five directions;* emitting
the one effect that does all three is what stops this action minting a sixth.

**`SET_FIELD_VALUE` REFUSES A MULTI-MATCH BINDING, deliberately, because `UPDATE` does.** A FIND
that matched several rows binds an ARRAY, and quietly writing to the first — or to all — is exactly
the ambiguity that made UPDATE throw. Two actions resolving the same binding differently is a trap;
failing the same way is the contract. Flow is written **only when the step names one**: the value
effect keeps whatever flow the cell had, so an absent `flow` must not silently reset a number the
user marked as an expense.

**THE 35 EDITORS ARE ONE RENDERER OVER DECLARED DATA, and writing 35 more by hand was the wrong
answer.** Each shape was read off its own executor case — which is the specification — into
`blocks/actionConfigSchema.js`, and one component draws it. **A `path` field is deliberately NOT an
expression input:** the executor walks it inside each ROW of an array, so a `$var` there resolves to
nothing and the step silently does the wrong thing. **The coverage test asserts the EMPTY SET three
ways** — no picker action without an executor case, none without a control, and **no declared key
the executor does not actually read**. That last one is the same defect one level up: a control that
writes a key nothing reads is exactly what this whole pass is about. A/B'd by planting a bogus key.

**THE ORPHAN MODULES ARE FIXED AT DELETE TIME — the user's call, asked before building.** Deleting
an occurrence never removed its module: **64 modules placing 49 occurrences on a grid built in one
sitting, 15 orphans**, every one a row or container deleted or converted. The decision is
`planOrphanModules` **unchanged** — the same predicate `sweepOrphans.js` uses, refusals intact —
because re-deriving "is this module dead" at the delete site would be a second opinion that drifts
from the sweeper's. **Two deliberate differences, each with a reason: `minAgeMinutes: 0`**, since
the age floor exists for a module whose FIRST placement may still be in flight and this module
demonstrably had one (and an in-flight second placement is already in the warm cache); and the scan
is **restricted to the modules this delete unplaced**, so a delete never walks the module table and
the reference scan runs at all only when a module truly lost its last placement — a feed copy shares
its source's module, so sweeping copies never reaches it. **The warm cache stores textmaps
DECOMPRESSED**, which is what makes the substring reference scan honest here in a way a scan over
raw Mongo documents would not be.

**Verified end to end against PRODUCTION on claude-grid, not just in unit tests:** create → 65
modules / 50 occurrences, delete → **64 / 49, and the module is gone**. Before this change the
second line read 65 / 49.

**A TABLE COLUMN WAS A COPY OF THE FIRST, and the honest reading is that it was never duplicating
the row.** A table whose rows are child occurrences renders the SAME record in every column — each
column is a PROJECTION, which is the spreadsheet model and is correct. What was wrong is that an
unconfigured column projects nothing and therefore shows the whole record, so two fresh columns are
identical. A new column is now born pointing at the next field the rows carry that no other column
shows. **Applied at column-creation time on purpose: inferring it at render time would silently
change what every existing table on every grid displays, the Schedule's included.**

**AND MY OWN FIX HAD THE TDZ TRAP THIS FILE ALREADY RECORDS.** `handleAddColumn` needed
`childRowOccs`, which is declared 130 lines below it — and a `useCallback` dep array is evaluated at
RENDER time, so the reference throws before the callback ever runs. Same trap `CanvasContent` paid
for on 2026-05-21. Moved, not worked around.

**A DOC PAGE LISTED A CONTAINER AND NEVER DREW IT** — a doc renders its TEXTMAP and nothing else, so
the page's own "+ container" produced something present in the data and invisible on screen. It is
still listed (it is a real child); the embed is what makes the page draw it.

**THE TREE'S "+" MINTS "Untitled" AND COULD NOT NAME IT.** Folder rows have had double-click rename
all along; doc rows never got one. **Offered ONLY when the doc has no heading, and that restriction
is the point:** the row renders `heading || label`, so with a heading present the rename would write
the label and the heading would still win — *a control that appears to work and does not is worse
than no control.* When a doc has a heading, that heading IS its name, and it is edited in the doc.

**FIRST RUN, and the user picked the restrained option.** A brand-new account landed on a NAMELESS
1×1 grid — a full-bleed wallpaper and one line of small italic text. The grid is named (a nameless
grid renders as a blank slot in the picker) and an empty grid explains what a panel is. **Derived
from what is on screen — no panels rendered — rather than a "new user" flag**, so a grid emptied by
deleting its last panel says the same thing. Nothing is seeded on the user's behalf.
**Verified by REGISTERING A FRESH ACCOUNT on production and looking at it:** grid reads "My grid",
the empty state renders, 0 page errors.

**THE ACCOUNT MENU PRINTED A UUID.** `state.userId` identifies the account to the database and to
nobody else. `full_state` carries the email now, cached on the socket so a grid switch does not
re-query it, with the id as the fallback. Verified on prod: the menu reads the email and no raw id.

**ONE FINDING IS RETRACTED, and it was mine.** I reported that a condition rule's two path pickers
assigned my picks to the wrong side. Reading the code: each side owns its own `onChange` and
`DrilldownPicker` keeps its state per instance — there is no shared state for one to write through
the other. The likelier explanation is my probe clicking the wrong one of two identical small
buttons on one row. **A test now pins both directions**, so a real crossover would be a failure
rather than an argument. *A finding is a claim about the code until the probe has been ruled out.*

**Deployed and verified the documented way:** prod HEAD matched, index + bundle 200, served
`App` / `CommandCenter` / `index` chunks **sha256-identical** to the local build, and the new strings
present in the SERVED chunks with a control reading 0 in both. Driven on production afterwards: the
schema-driven editor renders `sum $ · by · → $` with its hint, and the whole load reports 0 page
errors. 2715 client + 891 server tests. Probe debris swept (one stray table column) and pm2
restarted, since the warm cache is authoritative for reads.

**EDIT PATHS, DRIVEN BY CLICKS (user: *"not just creating, but editing things in the grid should be
tested via the ui clicks"*).** Every one of these was performed by a real click/keystroke against
production and then read back out of Mongo:
```
boolean toggle       click            -> Done today: true            PERSISTED
duration field       click + type     -> Time at bench: "20"         PERSISTED
row label            double-click     -> renamed                     PERSISTED
rating               click a star     -> Went well: 3 -> 4           PERSISTED
select pill          click + pick     -> Sharpening -> Joinery       PERSISTED
text field           click + type     -> note edited                 PERSISTED
tree doc row         double-click     -> Untitled -> "Sharpening log" PERSISTED  (the new fix)
operation edit       header Save      -> steps added AND removed     PERSISTED  (the fix in question)
container delete     right-click      -> occ 51->50, modules 66->65  PERSISTED  (the new fix)
container into doc   header "+"       -> listed AND embedded          PERSISTED  (the new fix)
date field           click            -> opens the NATIVE picker      NOT DRIVABLE
```
**The date pill is the one honest gap and it is not a defect:** it calls `input.showPicker()`, and
that picker is browser CHROME, not DOM, so no probe can click it. Driving the input's own change
event — every layer except the picker's own UI — writes correctly (Aug 3 → Aug 4, persisted).

**TWO OF MY OWN PROBES REPORTED A DEFECT THAT WAS NOT THERE, and both are the same mistake.**
(1) "The header Save did not persist" — it did; I compared TOP-LEVEL step counts while "+ Action"
adds to the innermost step list, so the new step was nested and the top-level count was unchanged
either way. A count that cannot move is not a measurement. (2) "The tree does not list the doc its
own + minted" — it does; my selector was `.manifest-row`, which that row does not carry, and the
tree's own innerText had it all along. **Both times the tell was available and I missed it: a probe
that reports 'no change' has to be shown reporting a change first.**

**Probe debris swept and the grid returned to its pre-session state** — every value restored, the
probe doc deleted, and the 15 PRE-EXISTING orphan modules (created by deletes from before the fix
shipped) swept with a dump first. claude-grid ends at 64 modules / 49 occurrences, **0 integrity
errors**, pm2 restarted because the sweep wrote directly.

**STILL OPEN, said plainly:** the positive branch of the column auto-projection was NOT exercised in
a browser — the only live table on claude-grid has no child rows, so the live click correctly
produced an unprojected column, which verifies the null branch and nothing else. And the tree rename
is unit-covered but has not been double-clicked by a real pointer.

---

### 2026-08-18 — I BUILT A GRID BY CLICKING, and it found six defects reading code never would

Task 11 of the landing-page plan: register a fresh account on production and build a grid called
`claude-grid` entirely through the UI, so the user can judge the new-user path. The grid exists —
4 panels, 4 pages, 6 containers across board/doc/table/graph, 14 fields in 9 of the 11 types, 19
records, two operations composed in the editor, a live bar chart. **checkGrid: 0 errors.** But the
grid is the by-product; the findings are the output.

**THE FIRST ONE STOPPED THE BUILD DEAD: A CONTAINER ADDED THROUGH THE UI VANISHED ON RELOAD.**
`create_module` persisted the module with **no gridId** — the occurrence had one, the page still
listed it as a child, and full_state is grid-scoped, so the module was never sent back and what
remained was the `module-less-occurrence` error `gridIntegrity` reports. **Fixed on the SERVER**,
which already stamps `userId` for exactly this reason and knows the grid too (`activeGridId`), so
the ModulePage call site AND the two in dropHandlers that omit it are all covered — an explicit
gridId still wins, so a template writing into another grid is never re-homed.

**THE MOST EXPENSIVE ONE: THE OPERATIONS EDITOR'S HEADER "Save" ONLY CLOSED THE EDITOR.** Its own
tooltip read *"changes are auto-saved as you edit"*. Nothing auto-saves — the editor holds the whole
operation in local state and only the Save beside Preview/Delete calls `onSave`. I lost a renamed op
and three pipeline steps twice before a **websocket trace** settled it: the header button emitted
NOTHING, the bottom one emitted `update_operation`. *A button that says Save and discards your work
is worse than no button.* It saves the working copy now.

**AND A CHART COULD NOT BE MADE AT ALL.** Every container's header dropdown carries the entire
GraphSection — chart type, label field, value field, and a live readout that told me **"9 roots · 9
rows"** — into a container that drew a plain board, because `ContainerGraph` only renders
`kind: "graph"` and NO UI path sets it (add offers Board/Document/Canvas/Table; convert offers the
same four). Every graph in existence was minted by a migration. `graph` joins the convertible kinds;
the chart drew immediately.

**Also fixed:** every row created by "+ Item" was born `kind: "board"` — 31 of 31 on a grid built by
clicking — which is migration `0003`'s defect still being minted by the live create path (the seed
was fixed in July; this path was not).

**TWO ARE FILED, NOT FIXED, and they are the same shape as each other.** `SET_FIELD_VALUE` is in the
action picker, has a full editor, and is read by `operationIntrospection` — **and the executor has no
case for it**, so the step is a silent no-op (I built a whole tracker on it and the tile stayed at 0;
the working version writes through `UPDATE`). Softer version of the same: roughly 40 actions in the
picker — `SUM_VAR`, `STREAK_VAR`, the Aggregators and Collections groups — have **no editor** in
`OperationsBuilder`, so choosing one renders a step with nothing to configure. And "Duplicate (new
instance)" does nothing inside a table, because `ContainerTable` renders `<ModuleInstance>` without
the `containerId` that handler needs.

**THE PART THAT IS NOT DONE, said plainly:** no dropped file or link became a record. The intake
sheet was reached and offered all five shapes for a pasted URL, and the shape I picked wrote
nothing — a synthetic paste has no real destination context, which is the same limit this file
already records for drag paths. It is a probe limit, not a proven defect, and it is the one row of
the task's capability table I cannot tick.

**What building it felt like, since that was the point:** the field editor, the predicate builder
(with its live "Preview: 4 matches"), the intake sheet and the graph readout are genuinely good —
each tells you what it is about to do before you commit. The paths that hurt are the ones where a
control exists but nothing behind it runs, and they cost hours precisely because the UI looked
right. 2688 client + 885 server tests; four deploys, prod HEAD verified each time.

---

### 2026-08-11 (5) — RETRACTION: the click never fired the op AT ALL, and a TEST WAS PINNING IT

User, after (4) shipped and deployed: *"nothing happened when i clicked an emotion for today."*

**(4) FOUND REAL DEFECTS AND MISSED THE CAUSE.** `runMatchingOperations(operations,
transactionType, transaction, context)` is POSITIONAL. `ContainerGraph` called it with a **single
OBJECT** — so `operations` WAS that object, every other argument was `undefined`, and the op loop
iterated nothing. **No click has ever fired this trigger.** That is the actual reason zero moods
were ever recorded; the period-object/`SAME_DAY` mismatch and the array-throw are real and would
have bitten the instant this was fixed, but they sat downstream of a call that never ran.

It was silent because the call lives in a `try/catch` that exists to stop a broken op taking the
chart down. **Every other call site on the grid is positional; this was the only one that was not.**
And a merely-corrected positional call would still be half a fix — the returned effects have to be
APPLIED and the return value was discarded. It now goes through `operationsBridge.fireOperations`,
the chokepoint every other write path uses.

**A TEST WAS PROTECTING THE BUG, which is why it survived.** `ContainerGraph.test.jsx` asserted
`runMatchingOperations.mock.calls[0][0]` and read `arg.transactionType` — i.e. it encoded the
single-object shape as the contract and passed for months while the feature was dead. *A test that
pins a broken contract is worse than no test: it converts a defect into a guarantee.*

**AND MY OWN VERIFICATION HAD THE IDENTICAL BLIND SPOT.** Every check in (4) drove the executor
DIRECTLY and positionally — over live data, through the real resolver, with controls — so the op
demonstrably worked while the app could never reach it. **I verified the operation and never the
caller**, then reported it fixed. The repo has now paid for this class four times; the rule earns
restating in its strongest form: *driving the callee proves nothing about the call. Assert on what
LEAVES the component.*

`graphSelectFires.test.jsx` does exactly that — renders `ContainerGraph`, fires `EChart`'s
`onSelect`, and asserts the POSITIONAL arguments that leave it. A/B'd against the original defect:
restoring the single-object call fails 4 of its 5 cases.

2461 client tests, deployed, prod HEAD verified, served chunk sha256-identical with the new key
present and both a positive and a zero control — **the first attempt at that check read 0 for the
POSITIVE control too, which is the tell that the probe was grepping the index HTML rather than the
chunk.** Checked, not believed.

---

### 2026-08-11 (4) — the wheel recorded NOTHING, and the highlight was only the symptom

User: *"it should be lighting up the moods i select too"* / *"on the wheel."*

**MEASURED BEFORE READING ANY CODE, and the measurement moved the whole problem: 0 moods have
EVER been recorded** on poms grid and `meta.graph.highlight` is null. The op fires correctly and
its pipeline exits with zero effects — so the highlight was never the bug.

**DEFECT 1 — `$day` IS A PERIOD OBJECT AND `SAME_DAY` CANNOT READ ONE.** `0046` took the day from
the graph's own `_effectiveFilter`, which is the date picker's shape. Driven through the real
comparator over live data, with a control so a `false` means something:
```
SAME_DAY(date, <period object>)    false   <- every candidate failed here
SAME_DAY(date, "2026-08-11")       true
DATE_IN_PERIOD(date, <period obj>) true
DATE_IN_PERIOD(date, wrong day)    false   <- control
```
All 10 Mood-binding occurrences failed the date rule — **including the two dated exactly
2026-08-11** — so `$moodHost` bound nothing and `IF $moodHost IS_NOT_EMPTY` swallowed it. This is
the class 2026-06-03 records for `Table:`/`Canvas: Build`, both migrated SAME_DAY → DATE_IN_PERIOD
for exactly this. **0046 was written afterwards and never got the treatment.**

**DEFECT 2 — THE OBVIOUS FIX THROWS, and only the A/B found it.** Swapping in DATE_IN_PERIOD makes
the span-2 range match THREE journals; FIND binds an ARRAY on multi-match and UPDATE throws
`$moodHost is not a record (no .id)`. *A silent no-op became a crash — the "fix" was worse than
the bug, and I would have shipped it on reasoning alone.*

**THE ROOT CAUSE UNDER BOTH: A SHARED OCCURRENCE HAS NO DAY.** `0068` unified the wheel into ONE
occurrence multi-parented into every day column — fixing "a click matches nothing" and leaving it
with no single day. `buildParentMap` keys child → ONE parent, **last writer wins**, so every
data-side ancestor walk resolves an arbitrary parent. *Fixing one ambiguity created another, and
nobody measured the second.* Only the RENDER TREE knows which column you are looking at, so
`ContainerGraph` reports it (`ancestorOccurrenceId`) and `ModuleContainer` threads it down the same
seam that already pins `occurrenceOverride` "multi-parent-safe". User's call, asked not guessed.

**AND THE PREMISE THE USER'S OWN ANSWER RESTED ON WAS FALSE — measurement caught it.** Scoping the
HOST to the clicked column is the obvious next step and finds NOTHING: the day columns hold **zero**
Mood-binding occurrences. The journals live under the SCHEDULE. **The column supplies the DATE; the
Schedule supplies the HOST.** *Check the premise of an answer, not just the answer.*

**`0080`/`0081` — the orphans, on the user's rule** (*"if its a duplicate, remove it. but if its
not, keep it and resolve it"*). Only ONE of three was a duplicate. **The keepers are keepers because
day columns are TRANSIENT** — Build Schedule rebuilds for the filtered dates — so "unreachable from
the Schedule" means *an older day*, not junk. The delete guard is TEXT-ONLY at full subtree depth
(`0038` scored field values, fired on the app's own date stamp, and refused forever; its header
records that mistake twice).

**`0081` EXISTS BECAUSE `0080` LOOKED DONE AND WAS NOT.** Reading the result back through the real
parent map: the resolved journal was `listed by 2: Schedule, 9:00pm(dead)` and **buildParentMap
picked the dead slot**. *Listing a child is not giving it a path* — a second parent does not stop
the first competing. **The same last-writer-wins ambiguity, third appearance in one session.**

Verified by reading back through the real executor per column after every step: Aug 10 went
MISSED → records to its own journal; 3 of 4 columns record and the 4th has **no journal in
existence for that date**, said plainly rather than counted as a pass. Every A/B fails exactly its
own test: defeating the clicked-column resolution (2), dropping the Schedule scope (2), removing
the writing veto (1), walking only the first parent (1). 2456 client + 865 server tests, poms grid
**0 integrity errors**, deployed and verified — prod HEAD, all referenced assets sha256-identical,
the new key present in the SERVED chunk with both a positive and a zero control.

**NOT VERIFIED IN A BROWSER, and it is the honest gap:** nobody has clicked a slice and watched a
mood land or a slice light up.

---

### 2026-08-11 (3) — a FIXED-DEPTH WALK is a bug waiting for the next re-nesting

User: *"the Date display field is not on every tracker atm and shouldnt be shown on the container
headers. just the individuaL trackers"* / *"the filter date is enough for the containers."*

**BOTH SYMPTOMS WERE ONE MISTAKE IN MY OWN `0072`.** It collected tiles by walking exactly TWO levels
(page → container → tile) and bound whatever it found, **without checking role**:
```
46  instance   the real tracker tiles — 31 bound, 15 MISSED (all at depth 3)
14  container  4 bound, so the field rendered in their HEADER
```
The 15 missed are the tiles inside the nested Workout / Nutrition / Media / Planning groups the
2026-07-30 restructure created. **A fixed-depth walk cannot see them and will keep missing whatever
gets nested next** — this tree has been re-nested twice already. `0073` states the invariant instead:
*every instance-role occurrence under the page, at any depth; no container, ever.* A/B'd by capping
the walk back to two levels — it fails exactly the depth tests.

**And the containers were wrong rather than merely redundant.** A container renders its fields in its
HEADER, beside a title that ALREADY carries the date (`Trackers: Date-Prefix Labels` stamps "Today's
Physical"). So the header showed the date twice — once as prose, once as an **empty pill**, empty
because the op loops `$allInstances` and never had containers in it. *A binding that promises a value
nothing will write is worse than no binding.*

**The op needed no change, which is worth stating.** Its tile loop is `over $allInstances` gated by
`_ancestors HAS_ANCESTOR <page>` — role-filtered and ancestor-scoped at ANY depth, so it already
covered all 46. Only the bindings were wrong, so only the bindings moved. *When a fix and a report
disagree about scope, check whether the op or the data is the thing that is actually narrow.*

Verified through the real resolver: **46/46 tiles render it, 0/14 containers do.**

---

### 2026-08-11 (2) — Tags off everywhere, Date on three pages; and the tracker date that must NOT be set

User: *"hide tags everywhere, and date isnt being set on trackers. hide date everywhere thats not
tasks, schedule, trackers."*

**A DEFAULT WITH THREE EXCEPTIONS IS A CASCADE WITH A ROOT — and the SHOWN cascade had none.** It
gets one (`grid.meta.fieldVisibility`), symmetric with the auto-applied root added hours earlier.
HIDE mode is the right control precisely because it is a BLACKLIST: it suppresses only what it names
and never a module's own bound fields, which is the whole reason the show-whitelist broke the
trackers in the first place. Writing "everywhere" onto all 71 pages instead would need re-writing for
every page created afterwards.
```
grid       hide [Tags, Date]                    everywhere
Tasks      hide [Tags]                          Date shows
Trackers   hide [Tags]                          Date shows
Schedule   hide [Tags, Time Slot, Last Seen]    Date shows
```
**THE SCHEDULE IS MERGED, NOT OVERWRITTEN.** It already hid `[Date, Time Slot, Last Seen]` (seeded
2026-07-11 so its rows show Completed only). The ask names Date and says nothing about the other two,
so the migration DROPS Date and ADDS Tags, keeping the rest. Replacing the list wholesale would
silently un-hide two fields nobody mentioned — *an instruction about one field is not permission to
reset the others.* Ids come from the grid's own `autoAppliedFieldIds` rather than by name, because
this grid carries five duplicate field names.

Verified through the REAL resolver over live data: **Tags renders on 0 of 2566 occurrences**, Date on
182 and only under those three pages, and each tracker still shows its own bound fields beside it.
`0071`.

**AND THE HALF I REFUSED, which is the more interesting one.** *"date isnt being set on trackers"* is
accurate — 0 of 35 tiles carry a value — but stamping one is the opposite of a fix. 2026-04-30
records it verbatim: *"a date field on the occurrence makes the named-filter SAME_DAY check fail on
any other day, so the goal vanished as soon as the user navigated past today"*, and a migration
removed exactly this once already. **It is now strictly worse than it was then:** since this morning a
CLEARED date hides anything dated, so a stamped tracker would also vanish whenever the filter is
cleared. Trackers are date-scoped by their PAGE's filter, not by a value they carry. Flagged to the
user with the history rather than guessed at — *the fix that matches the words would re-create a
documented data loss.*

---

### 2026-08-11 — three fixes the USER'S OWN WORDS designed; and a wheel nobody could ever click

**"its a cascade of shown fields and auto applied fields"** — and, twice, *"universal fields isnt
the name"*. Both corrections were right, and the name was wrong because I was treating a cascade as
a hard-coded category.

**THE TRACKERS BUG WAS A WHITELIST DOING THE WRONG JOB.** Fields carried by every occurrence were
born HIDDEN and revealed by naming them in a `show`-mode `fieldVisibility`. But show-mode is a
WHITELIST — "show Tags AND NOTHING ELSE" — and `fieldVisibility` is a nearest-wins cascade, so
`0064` writing it on the Trackers page hid every tracker's own bound fields. The migration did the
documented thing; the mechanism could not work. **Reusing the SHOWN cascade as the APPLIED cascade
is the whole defect** — the same split, for the same reason, that gave `fieldReveal` its own cascade.
Now `getEffectiveAutoAppliedFieldIds`: rooted at the grid, overridable anywhere, **a LIST not a
flag** so *"turned off on occurances"* is `[]` and needs no second switch, and any level may ADD its
own (a cascade only the grid can set is not a cascade). Verified through the REAL resolver on live
data: **31/31 tracker tiles render their own fields (was 0), 35/35 still render Tags.** `0067`.

**THE WHEEL: THE REPORTED BUG WAS THE SMALLER ONE.** The wheel is a Day Page TEMPLATE child, merge
clones it per column, and **a clone does not carry `feed`** — so 5 of 6 had none and said "nothing
to chart yet". But `Mood: Record Selection` is scoped `targetId: <the TEMPLATE's wheel>`, and a
trigger scoped by occurrence id matches exactly ONE occurrence, so **clicking a wheel on any real
day column matched nothing: no mood has ever been recorded**, including on the one day it displayed.
Nobody reported it because the empty chart hid it. User's call — one wheel, multi-parented — fixes
both: one feed, one id, one op that matches. The alternative (carry `feed` through APPLY_TEMPLATE)
materialises ~130 occurrences AND ~130 modules **per day, forever**. The builder gained a GENERIC
`sharedChildOccurrenceIds` (the Todo link in that same op already had the shape); nothing in it
learns the word "graph". `0068`.

**AND MY OWN MIGRATION WAS WRONG IN THE DANGEROUS WAY, caught only by the dry run.** It resolved the
template by grepping the first `$allItemsById.<id>` in the pipeline — and got the **Schedule page**,
because the op names it earlier. The dry run still read plausibly (*"template already does not list
the graph — no change"*), so the critical unlist silently did nothing while every other line looked
right. `resolveTemplateId` follows the variable chain now and returns null rather than guessing.
**A selector that matches the wrong thing CONFIDENTLY is the `0035` class, and a count would never
have caught it — only checking the dry run against a NAMED expectation did.**

**"show nothing dated" SHIPPED ONLY BECAUSE THE DATA SETTLED THE RISK.** I flagged that "never set"
and "explicitly cleared" might be the same state, which would make a slow load look like data loss.
Measured instead of assumed — they are structurally different:
```
key ABSENT / rightVal null    no filter target ("— any —", or not bootstrapped)  -> passes
{value: null, unit:"day"}     CLEARED ON PURPOSE  (what the Day Page carries)    -> hide dated
a real value                  filters normally
```
So the change is one branch that fires only on the middle state. A multi-pick with a null anchor but
real `dates[]` is a SELECTION, not a clear. *A risk worth raising is also worth measuring rather than
trading away.*

**AND THE "STALE span:2" RECURRENCE TURNED OUT NOT TO EXIST.** 2026-08-01 (11) filed it as open:
*"this recurs the next time a multi-day range is picked and left overnight."* Re-measured through the
REAL `evalRule` over the live shapes — `Grid: Snap Filter To Today` writes a bare `$today`, which
REPLACES the whole object, so a range collapses on the next new-day load. poms grid still showed one
because its marker read **2026-08-10 while today was 2026-08-11**: the op had not run yet. *An open
item is a claim about TODAY'S code — re-measure before inheriting it.* Third time this month a filed
task was retired by measuring instead of built.

**But the same probe found a real defect that MY OWN change had just made matter.** A CLEARED date is
a period object whose value is null — and `isEmptyVal` counts only null/undefined/""/empty-array, so
a cleared page passed `IS_NOT_EMPTY` and got today stamped onto it the next morning. Clear a page,
come back tomorrow, find it dated again with nothing to explain why. Harmless until "clearing means
show nothing dated" shipped hours earlier; then it silently undoes a deliberate state. Guard narrowed
to `IS_NOT_EMPTY AND (value IS_NOT_EMPTY OR unit IS_EMPTY OR dates IS_NOT_EMPTY)` — **each arm covers
a shape that is live on the grid**, and the `unit IS_EMPTY` arm is the load-bearing one: a bare
`"YYYY-MM-DD"` has no `.unit`, so requiring `.value` alone would have silently stopped moving the
Trackers page. `0069`. *Shipping a behaviour change means re-asking what now DEPENDS on the state it
created.*

**THE MERGE DUPLICATION IS ROOT-CAUSED AND FIXED — it was upstream of all of it.** `APPLY_TEMPLATE
mode:"merge"` decides "this already exists" by scanning the TARGET's `occurrences[]` for a matching
`identitySignature`. **A child that fell OUT of that array is invisible to that scan** — the
created-but-unlinked class, repaired from four directions before and now reached from a fifth — so
merge concluded "not here yet" and cloned a second one, then a third. The census is unmistakable:
```
Monday, August 10th   Journal / Notes / Tasks Completed / Highlights   x3 each
                      exactly 1 UNLISTED + 2 listed, every group
284 occurrences whose parent does not list them
  277 unsigned                 merge never matched these anyway
    6 SIGNED                   precisely the stray duplicates
    1 SIGNED, listed elsewhere the shared wheel — correct, and never reached here
```
A signed child whose `parentId` names the target IS the node that signature means. **Two decisions
carry the weight: LISTED WINS when both exist** (preferring the stray would top up the invisible copy
and leave the visible one stale — this can only stop new duplicates, never worsen old ones), and **an
adopted child is RE-LISTED**, because a parent renders `occurrences[]` and topping up a node nobody
lists is the listed-but-not-embedded failure wearing a new hat. Scoped to SIGNED nodes: `parentId`
alone is far too broad a net without a signature to pin identity. Both halves A/B'd INDEPENDENTLY —
disabling the fallback fails 2, disabling the re-list fails exactly 1.

**And the duplicate DATA is gone too, in its own pass (`0070`).** Measured at full depth through
`decompressTextmap` FIRST: all 6 groups / 10 removable copies held **0 characters**, so the
0022/0023 writing refusal never had to fire. 18 occurrences + 18 orphaned modules removed once
subtrees are included. The writing guard counts TEXT, never field values — `0038` scored field
values, fired on `0037`'s own date stamp, and refused to delete anything, and its header records
making that mistake TWICE.

**MY MULTI-PARENT GUARD WAS WRONG ON THE FIRST DRY RUN, and a count would have looked fine.** A
duplicate is of course listed by the parent whose duplicates are being removed, and that parent is
not inside the doomed subtree — so all four second-listed copies read as "shared" and the run
proposed UNLINKING the very things it was meant to delete. Caught only by checking the report against
a derived expectation (18 = 2×2 + 2×4 + 2×1×3). *Second time in one session that a dry run's prose
read plausibly while its selector was wrong; both times the named expectation was the only thing that
noticed.*

Verified after: duplicate groups **6 → 0**, poms grid **0 integrity errors**, unlisted children
**284 → 278** — the 277 unsigned feed sources plus the one deliberately shared wheel, exactly as
predicted. **Deployed with a pm2 restart, because the warm cache is authoritative for reads and would
otherwise re-serve the deleted rows.**

**A 502 on the post-deploy check was the documented restart window, not an outage** — bundle 200 +
index 502 is the tell, first retry answered 200, pm2 online with 13s uptime, `dist/index.html` fresh,
error log empty. Diagnosed rather than assumed, per 2026-08-07 (4).

Every A/B fails exactly the test written for it: the naive template grep (1), the whitelist guard
(2), the cleared-date branch (1). 2388 client + 716 server tests. Deployed twice, prod HEAD verified,
chunks sha256-identical, the new key present in the SERVED bundles with the old key at 0 as the
control. `0067` + `0068` applied to poms grid, each read back through the real resolver.

**NOT VERIFIED IN A BROWSER, and it is the honest gap:** nobody has clicked the wheel and watched a
mood record, or cleared a date and watched the columns go.

---

### 2026-08-09 (8) — the date-nav task: HALF OF IT WAS ALREADY TRUE, and "49 ops" never meant 49 ops ran

D7: *"daycol should only show up on the schedule or daypage and should be always based on the filter
applied on it."* Two questions had to be measured before touching an op, and both answers changed
the work.

**(b) "Do day columns exist anywhere other than Schedule and the Day Page board?" — NO, on all three
grids.** Zero strays. There is nothing to clean up and no migration for that half; it is retired by
measurement rather than built. (First attempt measured the wrong thing — counting only
`Schedule Format = day-col` misses the Day Page board's columns entirely, since that field is a
Schedule concept. A census that answers half the question confidently is worse than none.)

**(a) "Which ops actually fire on each navigation?" — ANSWERED WITHOUT A BROWSER**, by driving the
REAL `computeTriggerMatch` over the LIVE op data (dumped read-only, replayed against synthetic
NavigationOps of the exact shape `updateOccurrenceFilterOverride` fires):
```
poms grid, 67 enabled ops        ops MATCHED by one navigation
toolbar / grid filter                   48
Schedule page nav                        6      ← incl. Day Page: Build
Day Page board nav                       4
Trackers page nav                       44      ← incl. BOTH build ops
onLoad sweep                            53
```
**So the docket's "49 ops are evaluated when about three are date-dependent" is about MATCH-CHECKING,
not execution — a page-local Schedule nav has only ever RUN six ops.** Worth stating plainly,
because the phrasing has been read as "49 pipelines execute" for two sessions.

**AND THE FOREIGN RUNS COULD NEVER HAVE CHANGED ANYTHING, which is what made the fix safe rather than
a trade.** Each build op takes its dates from `$activePeriodDates`, which the executor resolves from
`operation.targetOccurrenceId` — its OWN page (Build Schedule → the Schedule page, Day Page: Build →
the board). So a Trackers navigation rebuilt the Schedule *for the Schedule's own, unchanged dates*:
a per-day FIND, an APPLY_TEMPLATE merge and two extra passes, to conclude nothing changed.

**The one behaviour that DID depend on the coupling turns out not to apply here.** 2026-05-15 records
the user confirming "a Goals nav seeds the Schedule for that day" — but that belonged to
`makeScheduleBuildDayOp`, whose `$schedDate` chain prefers `$trigger.date`. That op is not on poms
grid; `makeScheduleBuildScheduleOp` never had the behaviour to lose. *An old user decision has to be
checked against the op that actually runs today before it is treated as a constraint.*

**Shipped:** both source guards now pass only the toolbar/onLoad case and the op's OWN page, the
`$goalsPage` var they left dead is gone, and the seed's two call sites stop passing it. Migration
**`0062`** carries it to the stored pipelines — **DRY RUN ONLY, reported against a named expectation**
(Build Schedule drops `$goalsPage.id`; Day Page: Build drops `$schedPage.id` + `$goalsPage.id`; both
drop the dead var; 2 ops). **NOT APPLIED — poms grid is live data and that is the user's call.**

**WHAT THIS DOES NOT DO, said plainly: it does not reduce the ops-MATCHED count.** The guard is
inside the pipeline, so a Trackers nav still matches 44 ops — two of them now exit at their first
step instead of running a template merge. Tightening the TRIGGER instead would need `ancestorLabel`,
which matches on a label the user is free to rename; the id-based guard is rename-proof, which is why
it stays where it is.

**And the dominant cost is untouched, because it is a product question rather than a perf one:** of
the 44 ops on a Trackers nav, ~42 are trackers, and they are legitimately date-dependent. Whether
they must all recompute on every date change is the docket's own open question and needs the user.

**NOT MEASURED: wall clock in a browser.** The before/after `[op-timing]` numbers the task asks for
were not taken — every claim here is from the real matcher over real data and a dry run, which is
what made the change safe, but the size of the win is unquantified and I am not claiming one.

7 migration tests (idempotency, surgical scope, a nested guard, and the discriminating case: a var
still read elsewhere is KEPT) + 3 builder tests, A/B'd — re-coupling the goals page fails 2. 619
server tests, 2289 client (the same 3 pre-existing `liveOpsBehavioral` failures).

**Honest coverage gap:** the guard change is pinned structurally, not behaviorally — the behavioral
harness boots from the EXPORTED seed JSON, which still carries the old ops until a reseed.

**The two other unscoped ops, both settled in the same pass:**

- **`Schedule: Place Dated Work` had NO source guard at all** and fired on every page's navigation.
  It now carries one, and — because `evalGroup` handles nested groups — it is nested INSIDE the
  existing `$schedPageId IS_NOT_EMPTY` precondition rather than wrapped around it: adding one rule
  to a condition that already exists is a far smaller edit to a STORED pipeline than re-nesting its
  steps. **That means the migration has to ADD, not just drop** — the builder change alone would be
  inert on an already-seeded grid, which is the "shipped and does nothing" class this repo keeps
  paying for. `addGuard` fails CLOSED with a reason when it cannot find the precondition to attach
  to, and the two halves are pinned against each other (a test asserts `tightenOp` can still read
  what `addGuard` writes, or a later pass would silently miss it).
- **`Days Until Due` is LEFT ALONE, and the measurement is why.** It writes
  **2 values on poms grid** (2 of 2637 occurrences carry a Due date; 20 on test grid 1, 0 on test
  grid 2), so there is nothing to save. And its output is `dueDate − today` — it depends on the WALL
  CLOCK, not on any page's filter, so the nav trigger is the one thing that re-derives a stale
  countdown for a tab left open past midnight. Scoping it would remove a small real benefit to save
  nothing. *Retiring a fix by measuring it is the outcome, not a failure to do the work.*

`0062` therefore reports **3 ops**: two tightened, one guarded for the first time.

---

### 2026-08-09 (7) — the last shape lands: coverage is **24 of 24**, and the drop path had the SAME inert gate

`link-follow` — "…and follow its links". Coverage measured with the router's own tables rather than
read off the list: **24 routed / 24 declared / 0 orphans.** The coverage test now asserts
`notImplemented` is EMPTY, so the contract is closed rather than merely satisfied today.

**THE SPEC SAID "A SECOND FOLLOW-UP KIND IN THE SHEET", AND THE SHEET IS THE WRONG PLACE.** The
task note predicted an async multi-select step inside `IntakeSheet`. Two of the sheet's own
properties say otherwise: its contract is that it is pure UI which *"never writes at all"*, and
`IntakeSheetHost` deliberately CLOSES the sheet before running the caller's callback so *"a slow
write never leaves the sheet sitting open over the work it started"*. A crawl of an arbitrary page
is exactly that slow write — and Escape from step 2 goes BACK, so backing out mid-fetch is a state
nobody needs to get right. So the shape is picked, the sheet closes, and the ROUTE runs the crawl
and opens a separate `ConfirmListHost` — which is what D5's own note ("reuse the shape of
AssistantDrawer's `wikipedia_import_batch` confirm card") was pointing at all along.

**AND THAT CHOICE COST NOTHING AT THE CALL SITES, which was the other half of the reasoning.** A
loader threaded into the sheet would have needed wiring at five call sites — the class of gap that
has been the real defect four sessions running. A route-driven surface needs ONE mount, in App.

**THE CONFIRM IS THE FEATURE, so "nowhere to ask" means DO NOT DO IT.** `openConfirmList` returns
false with no host (a preview iframe, a harness) and the route REFUSES and says so. The fallback
every other shape takes — do today's thing rather than swallow the drop — is exactly wrong here:
importing twenty pages because there was nowhere to ask is the one outcome this shape exists to
prevent. A/B'd — making it import them all fails that test.

**THE SAME INERT-GATE DEFECT AS THE PASTE HOST, on the DROP path this time.** While gating the new
shape out of doc bodies I checked what the caller reports, and `handleExternalDrop`'s link branch
hardcoded `kind: "board"` — so **every doc-body gate in the classifier was inert for a dropped
link**, precisely the defect found on `IntakePasteHost` yesterday (2026-08-09 (5)). It reports the
container's real kind now. *Second time in two days, second call site: a gate is only as good as the
value the caller reports, and the only way to know is to read the caller.*

**Sequential by design, and that is load-bearing rather than lazy.** One fetch and one whole-page
import per link, in a chain — a parallel volley would hammer a stranger's site and stack N
page-builds on the server at once, to save a wait the toast is already narrating page by page. The
test measures concurrency (`maxInFlight === 1`) rather than asserting the shape of the code.

**Homed by `parentId`, because a folder page renders what is PARENTED to it** — the constraint that
decided `files-folder-page`, reached from the link side. `markdownToModuli` already sets the import
root's parentId from what it is handed, so one argument does it.

**It reports the TALLY, not the last outcome.** A dozen fetches against a dozen sites means some
failing is the normal case: "Imported 9 pages · 3 could not be read" is honest where either "done"
or "failed" is a lie. A/B'd — dropping the note fails a test, and a run where everything failed is
reported as a failure rather than "imported 0".

**Server half:** `utils/harvestLinks.js` (pure, 15 tests) + a read-only `link_harvest` socket
handler behind the same guarded fetch `import_url` uses. Links are read from the MAIN CONTENT, not
the raw page — a site's nav and footer links belong to the site, not to the article you dropped,
and they outnumber the real ones several times over.

**Four A/Bs on the route, four on the call site + gate — each fails exactly one test.** 616 server
tests, 2289 client (**the same 3 pre-existing `liveOpsBehavioral` failures — A/B'd against stashed
source this session, identical 3**). Build clean, chunk sanity holding.

**NOT VERIFIED, and it is the honest gap: no link has been followed in a browser.** Every write is
asserted and every refusal is A/B'd, but nobody has dropped a link, watched a real page get crawled,
ticked a list and seen the pages arrive. **Not deployed** for that reason.

**Also filed, unchanged:** text pasted onto a doc container is still listed-but-not-embedded
(`createTextblockInContainer` only splices; the paste host has no editor to insert into). And
`TEXT_DOC_PAGE` remains offered inside a doc, where the page it mints is invisible — the same class
this session gated `link-follow` out of, left alone because fixing it properly means an embed seam
for pages rather than a fourth gate.

---

### 2026-08-09 (6) — `image-canvas` mints its own surface; and every doc gate was inert on PASTE

Coverage **20 → 21 of 24**. Three left.

**The shape MINTS the canvas**, so requiring the destination to already be one meant building the
surface before you could use the shape that builds it. The `onCanvas` gate is gone, along with the
`canDraw` field nothing else read.

**Checked before building, because the same question decided `files-folder-page` the OTHER way.**
`PageCanvas` reads `occurrence.occurrences` and dispatches by role; the folder page reads
`parentId`. So the canvas shape puts the artifacts in the page's CHILD LIST and leaves their home in
Files, where the folder-page shape had to move the files house. Two surfaces, two different answers,
and the only way to know which is which is to read the renderer.

**AND CHECKING THE DOC GATE FOUND A LIVE BUG IN SHIPPED CODE.** `IntakePasteHost` mapped every
container to `"board"` and never reported `"doc"` — so **every doc-body gate in the classifier was
inert on the paste path.** `FILES_CONTAINER`, `FILES_FOLDER_PAGE` and now the canvas shapes were all
being offered inside a doc, where each mints something the doc will never render. Three gates
written carefully over three days, all bypassed by one destination field. *A gate is only as good as
the value the caller reports — the fifth call-site defect this week, and the first one that silently
disabled work already done.*

**One thing is still broken and is filed rather than hidden:** `createTextblockInContainer` only
splices into `occurrences[]`. The doc DROP path embeds via `onLinkChips`; the paste host has no
editor to insert into, so **text pasted onto a doc container is listed but not embedded** — present
in the data, invisible on screen. Fixing it needs a seam the paste host does not have, so it is
written down instead of guessed at.

A/B'd: re-requiring a canvas, dropping the doc gate, and writing the child list per file each fail
exactly one test.

**And four tests asserted `image-canvas` was unimplemented** — true until it wasn't. The full-suite
count went 3 failures → 4, which is the only reason the fourth was caught: three of them lived in
files I had already run, the fourth did not. **Read the failure COUNT, not "roughly the same".**

2229 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Build clean.

---

### 2026-08-09 (5) — the user was right: a board page CAN hold artifacts, and one surface disagreed

User, correcting a note I had written: ***"a board page can hold artifacts. as occurances in the
page. so would canvases."*** Right on both counts. I had claimed the opposite the day before while
designing `files-folder-page`, and the correction is worth recording because **my reasoning was
wrong even though the observation was true.**

**What I said:** "`PageBoard` renders CONTAINERS only, which is why a board page could not hold
artifacts directly." **What is actually true:** the data model allows any role —
`getPageChildrenModules` applies NO role filter and `ModulePage` says so in as many words — but
`PageBoard` handed every child to `<Container>`, and **`ModuleContainer` never inspects its own
role** (zero references to `module.role` in 1600 lines). So an artifact on a board page rendered as
an **empty container shell wearing the file's name**. A missing feature, not a law.

**And `PageCanvas` already did it right**, with a comment saying it *"mirrors ModuleContainer's
child loop"*. So the board page was the single surface out of step — which is exactly why the user's
expectation was reasonable and mine was not.

Fixed: `PageBoard` now routes leaf roles to `ArtifactCard` / `TextblockCard` inside a
`ModuleInstance` shell, the same way the canvas does. `pageChildRenderer(role)` is exported and
tested rather than left inline, because mounting PageBoard needs the whole grid store and the
predicate is where the bug lived. A nested page and a role-less child both keep their existing path,
pinned so neither shifts by accident.

**Does this retract `files-folder-page`?** No — that shape follows D2 ("a new folder per drop under
Imports"), and a folder page also gives it a home in the tree. But the REASON I gave for it was a
missing feature rather than an intrinsic limit, and that distinction matters for whoever reads it
next.

**The lesson: when the user contradicts a claim about their own app, check what the code does
before defending the claim — and check the neighbouring surface too.** Three files disagreed with
each other here; the one I happened to read first was the outlier.

2221 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Build clean.
**NOT verified in a browser** — nobody has dropped a file on a board page and looked at it yet.

---

### 2026-08-09 (4) — the PDF that OCR could not read, read; and an A/B that lied

Coverage stays 20 of 24 — this finishes a shape rather than adding one. `file-ocr-text` was pulled
off PDFs on 08-08 because tesseract cannot read one; **`helpers/pdfPages.js` renders each page to an
image first**, so the shape is honest on PDFs again. Every page, per the user's call over
first-page-only.

**The engine was never the missing piece.** pdf.js already rasterises pages for the artifact viewer;
nothing turned a page into something tesseract could see. One page at a time, callback awaited, each
canvas released before the next — collecting page images first would hold a whole document in memory
at OCR resolution, and the progress line could not name the page it is on.

**Scale is an OCR decision, not a display one.** pdf.js scale 1 is 72 DPI and reads badly; 2.5 is
~180 DPI. The viewer uses 1.2 because a human is reading it — sharing that number would have quietly
produced bad text.

**`progressIntake` earns its keep here specifically:** this is one OCR pass PER PAGE, so a ten-page
scan is minutes, and an indefinite "Reading…" for that long is indistinguishable from a hang. Pages
are joined with a BLANK line so the last line of one page does not run into the first of the next.

**AN A/B LIED, AND THAT IS THE REUSABLE PART.** Testing whether the blank-line join mattered, the
mutation silently failed to apply (shell escaping) and the A/B reported "the test does not
discriminate" — i.e. it looked like a WEAK TEST when the test was fine. Re-run with the mutation
verified, it fails correctly. **Check that the mutation landed before believing an A/B**, exactly as
this file already says to check a probe before believing a failure. An A/B is a probe.

pdfjs stays lazy: the intake chunk grew 1.5 kB, not 400. 2217 client tests (the same 3 pre-existing
`liveOpsBehavioral` failures). Build clean.

---

### 2026-08-09 (3) — a folder page shows what is PARENTED to it, so the files had to move house

Coverage **19 → 20 of 24**. Four shapes left.

**THE CONSTRAINT THAT DECIDED THE WHOLE SHAPE, found by reading before building.** A folder page
renders `childrenByParentId[folderId]`, and that index is built purely from `parentId`. An uploaded
file is normally homed under `Files/<kind>`. **So grouping a drop into a folder while leaving the
files in Files produces an EMPTY page** — the listed-but-not-embedded class, third time this week.

**The obvious alternative was checked and rejected before it was built:** a board page renders
CONTAINERS (`visibleList.map(({ container }) => …)`), so leaf artifacts as direct children of one
render nothing at all.

**So the files are homed in the new folder — and that trade was MEASURED rather than argued.** Of
234 artifacts on poms grid: **223 in `Root/Files/Images`, 5 in `Root/Examples`**. A file homed
outside Files is existing seeded behaviour, not an invariant being broken. That was worth checking,
because the Files TAB was deleted in favour of the folder (2026-08-07 (6)) — which makes Files look
canonical when it is really just the default.

The server already had the seam: `homeFolderForUpload` documents that *"an EXPLICIT parentFolderId
always wins — the user picked that folder"*. The CLIENT upload simply never passed one. Left null
it still files under `Files/<kind>`, so every existing caller is byte-identical.

**Home and placement are separate, as they have been since 2026-08-07 (7):** the page's home is the
new folder (so it is findable in the tree under Imports), its placement is the container you dropped
on (so the drop is visible where you made it).

**A/B'd:** homing the files in Files, rooting the folder outside Imports, and dropping the
fail-closed guard each fail exactly one test.

2211 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Build clean.

---

### 2026-08-09 (2) — "which field?" is unanswerable, so the app stopped trying to answer it

Coverage **18 → 19 of 24**. The second-question step in the sheet, plus the first shape that needs
it — built together, because shipping the mechanism with nothing using it would be unexercised
machinery.

**THE MEASUREMENT KILLED THE OBVIOUS DESIGN.** `link-field-value` writes a dropped URL into a field
on the row. The obvious implementation detects "the link field" — except there is **no url/link
field TYPE and no link binding ROLE** on this grid:
```
types  occurrence 43 · text 42 · number 52 · date 11 · select 14 · boolean 2 · rating 3 · duration 2 · address 1
roles  input 3497 · display 81 · media 207 · files 192
name looks url-ish   "Website", "LinkedIn"   ← 2 of 170
actually holds http  "Website"               ← 1 of 170, 10 rows
```
A link field can therefore only be GUESSED — from its name, or from what it happens to contain
today. **Name matching is exactly what produced 10 candidates and 10 FALSE POSITIVES** in the relink
work (2026-08-07 (6)), and guessing from contents means an empty field can never be picked.

**The user's own answer had already dissolved the problem.** "Always ask which field, even when
there is only one candidate" means the app never needs to identify a link field at all: offer the
TEXT fields the row binds, and the person picks. *A product decision removed an unsolvable
detection problem — worth noticing, because the instinct was to go build the detector.*

**AND THE LIST IS USABLE, also measured rather than hoped:** of 274 modules binding at least one
text field, **253 bind exactly one**, 9 bind two, and 12 bind seventeen. The twelve are the People
rows — which is precisely where asking earns its keep, since Website / LinkedIn / Email are all
plausible. Order is the module's own binding order; floating a url-ish name to the top would be a
recommendation, and the sheet stopped making those yesterday.

**The follow-up is ONE mechanism, not a dialog per shape.** A shape may declare
`followUp: { kind:"choose-one", title, options }`; the sheet renders a second list in place, shares
the same tiles and the same arrow-key handling, and pre-selects nothing there either. **Escape from
step 2 goes BACK rather than throwing the gesture away** — you answered "what should this become",
not "which field" — and commits nothing either way. Two more shapes are already waiting on it
(which trace, which pages).

**THE A/B FOUND AN UNCOVERED SEAM, and this is the fourth session running.** `IntakeSheetHost` — the
thing App actually mounts — has its own `onPick`, and deleting its second argument left **every test
in the file green** while the user's answer was dropped on the floor. The drop handler had the same
hole. Both now have tests that fail when the argument is removed. *A test that renders the component
directly does not test the host that wraps it.*

**Two smaller things worth keeping:** clearing the tile refs in an effect keyed on the step WIPES the
refs that render just assigned (an effect runs after the ref callbacks) — it belongs in the render
body. And `notifyIntake`'s success wording was the OCR shapes' *"Read the text"*, which became a lie
the moment a non-OCR shape reported through it; shapes name their own outcome now.

2204 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Build clean.

---

### 2026-08-09 — the intake sheet stops recommending; and ONE NAME WAS DOING TWO JOBS

User, answering the design questions: ***"there shouldnt be a default, it should ask everytime what
id like to do with it."*** Asked about the two text shapes; it generalises to the whole sheet.

**THE REAL FINDING IS THAT `preselected` WAS DOING TWO UNRELATED JOBS UNDER ONE NAME.** It was the
UI default — the sheet focused and highlighted it — *and* it was what runs when there is **no sheet
host at all** (a preview iframe, a harness). Only the first was asked for; only the second may
survive. So it is renamed `fallback` everywhere, because **leaving it called `preselected` is
exactly how it gets quietly wired back into the UI six weeks from now.** The rename is the fix; the
deletion is the easy half.

**FOCUSING A TILE IS NOT NEUTRAL, and that is the subtle part.** A focused button is activated by
Enter, so focus-on-open IS a default whatever it is called. Focus now lands on the DIALOG; arrow
keys move into the list from there (first Down → first tile, first Up → last), so the keyboard path
survives without one shape being privileged. `tileStyle(isPreselected)` became a flat `tileSt` —
there is no selected state because nothing is selected.

**THE NO-HOST FALLBACK STAYS, and it is not a default in any sense the user experiences** — nobody
is being offered a choice on that path. A drop that cannot ask must still do something; 2026-08-07
(5) verified that path WRITES rather than the drop vanishing. Flagged to the user rather than
decided silently. `filterToImplemented` still re-points it when the classifier's pick did not
survive the filter, or the no-host path would run an unrouted shape and write nothing.

**The classifier keeps ALL its reasoning** (inDoc → textblock, homeless → doc page, several links →
container). Removing the user-facing default must not delete the knowledge — the fallback depends
on it.

**A/B'd both halves:** restoring focus-on-fallback fails 2 tests, restoring the highlight fails 1.
And ~20 assertions across 6 suites were renamed with their TITLES rewritten — several tests existed
specifically to pin a preselection, and **a test title that claims something no longer true is worse
than no title**, because the next person reads it as the contract.

2186 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Build clean, chunk sanity
holding.

**This is the first of nine decisions the user answered on 2026-08-09** — the rest are recorded on
the intake task, with a build order. The sheet's contract went first because everything else adds
tiles to it, and the next piece is the SECOND-QUESTION step (which field / which trace / which
pages), which three separate shapes need and which should be built once.

---

### 2026-08-08 (10) — I fixed the INSTANCE and left the CLASS open; the router reports itself now

A correction to (9), shipped the same day, and worth recording because the mistake is a common one.

**(9) fixed the OCR silence by wiring `onIntakeResult` at all three call sites — and the three
handlers came out BYTE-IDENTICAL.** That is the tell: reporting is not caller-specific business.
Placement genuinely is (a doc inserts a `moduleEmbed`, a board splices — that is why
`onPlaceholders` exists); *announcing an outcome* is not. **And wiring three callers fixed one
INSTANCE while leaving the CLASS open** — the fourth caller forgets and the silence returns, which
is precisely how the original defect happened.

So the router reports every intake outcome itself (`notifyIntake`). `onIntakeResult` still exists
and still WINS when passed — it is an **override, not a requirement**, so forgetting it can no
longer produce silence.

**The progress gap (9) filed as open is closed in the same pass.** OCR is the only thing intake does
that takes seconds, so it is the only thing that announces itself: a loading toast up front, and the
finish REPLACES it by id rather than stacking a second. A caller that owns reporting owns this too,
so nothing double-reports.

**The general lesson: three identical copies of a "caller-specific" handler means it was never
caller-specific.** When a fix is "wire it at every call site", ask whether the default belongs in the
callee instead — otherwise the next call site reintroduces the bug.

2185 client tests (the same 3 pre-existing `liveOpsBehavioral` failures). Both new tests A/B'd:
reverting to seam-only and dropping the loading toast each fail the default-reporting contract.

---

### 2026-08-08 (9) — the OCR shape was pointed at the ONE format OCR cannot read

Coverage **17 → 18 of 24**. Deployed and verified.

**THE PREMISE WAS FALSE, AND ONE PROBE SETTLED IT.** `file-ocr-text` was offered for `.pdf` **and
nothing else** (`OCR_EXT = /\.(pdf)$/i`) — while `helpers/ocr.runOcr` is tesseract.js, **which
cannot read a PDF.** Generated a one-page PDF and handed it straight to the real runner:
`Error attempting to read image.` So the shape was aimed at the single file type its own runner
refuses, and building the route as written would have shipped **a tile that always fails**. It is
offered on IMAGES now, where the runner demonstrably works. A PDF needs a raster step first (pdf.js
is already a dependency); until that exists, not offering it is the honest answer. *Two sessions
running, the task list's "closest to done" item turned out to rest on something untrue — measure the
premise, not just the code.*

**IT IS A REAL SECOND SHAPE, not a duplicate of the checklist one.** Same OCR, and which outcome you
want is a fact about the PHOTO rather than the file: a photo of a LIST wants one item per line; a
photo of a PAGE — receipt, whiteboard, letter — wants the text kept whole, because splitting a
paragraph on its newlines turns one sentence into six checklist items. The sheet asks. The picture
is KEPT either way: the photo is the evidence, and discarding it once the text is out is the
destructive shortcut.

**AND THE CALL-SITE CHECK FOUND A LIVE DEFECT IN A SHAPE THAT SHIPPED THE DAY BEFORE.** Grepping for
`onIntakeResult` across every caller returned **zero**. So the shipped photo-to-checklist shape has
been reporting **nothing at all** — not a failure, not "read nothing", not success — and OCR is
seconds long behind a 3.5MB lazy import, so silence is indistinguishable from a drop that did
nothing. Wired at all three call sites, including the `note` (lines the split refused, the 100-item
cap) that the shape returns deliberately and that was being thrown away. **The third session in a
row where checking the call site — not the unit tests — is what found the real problem.**

**MY OWN TEST DID NOT DISCRIMINATE AT FIRST, and the A/B is the only reason I know.** The
"keeps the prose whole" test passed against a mutation that split per line — because the mutation
was a no-op on the fixture I chose. Fixed by putting a SINGLE newline in the OCR output (a wrapped
line, which must stay one paragraph); the checklist behaviour then fails it. Re-A/B'd: re-gating OCR
to PDFs fails the classifier test, splitting per line fails the prose test, one each.

**Probe trap, mine:** `URL.createObjectURL` rejects a `{name,type}` stub, so the first fixture threw
in a way that read exactly like a broken route. Check the probe before believing the failure — for
the Nth time.

**STILL MISSING, said plainly:** there is no PROGRESS signal. `onIntakeResult` fires at the END, so
the seconds of OCR are still unnarrated; `runOcr` accepts an `onProgress` the intake path never
threads. A loading toast needs an `onIntakeStart` seam.

2183 client tests (the same 3 pre-existing `liveOpsBehavioral` failures — A/B'd against stashed
source this session, identical 3). Build clean, chunk sanity holding.

---

### 2026-08-08 (8) — the two text-tree shapes were the SAME WRITE, and the hint said otherwise

Picked up the other accounts' queue (5 open items; three need the user — a phone, credentials,
export requests). The previous session hit its limit **one command into `text-container-tree`**, so
that is where this one started. Coverage measured with `assertShapeCoverage()`, not read off the
list: **16 implemented / 8 open / 0 orphans before, 17 / 7 / 0 after.**

**THE MEASUREMENT IS THE ENTRY.** `markdownToModuli` always returns a `role:"container" kind:"doc"`
ROOT — **the importer has never minted a page.** The only page wrapper in the whole text path is
`createImportsDocPage`, which the drop handler calls for a HOMELESS import so the root is reachable
at all:
```
destination is a container/page   the tree lands in place, NO page
no destination (empty cell)       panel + Imports doc page, wrapper
```
So **`text-doc-page` WAS `text-container-tree` in two of three destinations**, and its own hint
("the imported tree, wrapped in a page") was true only for the third. Routing the second tile to
that same write would have shipped **a dead tile with a different label on it** — worse than the gap
it closed, and invisible to any test that only asks "did a route run".

**So the pair was made honest from BOTH ends, and BACK-COMPAT IS THE PRESELECTION.**
`text-container-tree` is the tree in place — today's outcome, byte-identical — and is now the
default, so Enter still does exactly what it did. `text-doc-page` earns its name: the tree behind
ONE page card you drill into (a page nested in a container renders as a representation chip, which
is the point — 40 imported sections stop spilling across the board). The homeless case is untouched:
`onImportText` still owns it, because the drop handler is the only layer that knows it just minted
a panel to pin to.

**ORDER, and it is not a style choice:** the import runs **DETACHED** and the page is minted only
after the ack, so the page is created in one shot already embedding a root id that exists. Minting
first leaves an empty page behind every time an import fails. And it **EMBEDS** rather than only
listing — a doc renders its TEXTMAP, so `occurrences: [root]` alone is the listed-but-not-embedded
class this repo has repaired twice.

**A LATENT CLOBBER, found by reusing shipped code rather than re-writing it.**
`createPageInContainer` flips the parent's `allowChildContainers` by writing the module's **WHOLE
`meta`** — so a caller that omits `containerModule` silently overwrites every other key on it. The
shipped caller passes it; nothing enforced that. The new route passes it, and the test asserts an
unrelated meta key SURVIVES: remove the argument and it fails.

**THE CALL SITES ARE WHAT WOULD HAVE MADE THIS HALF-INERT — the same check the last entry demanded.**
`dropHandlers`' text ctx needed `destinationModule` (the clobber) and `onImportResult`: `runImport`'s
toast lives inside its own closure, so a shape that bypasses it lands in **silence**. `IntakePasteHost`
needed both plus a toast — its text path had **no failure reporting at all**, and with no destination
it emitted an import whose root nothing referenced. **That invisible-paste bug is fixed as a
side-effect of the gate**, not by a separate patch.

**Gated, for the reason `FILES_CONTAINER` is gated inside a doc:** `TEXT_CONTAINER_TREE` is not
offered without a destination — a container root with no parent is listed by nobody and embedded in
nothing. A shape that mints something invisible is worse than no shape.

**Every new test A/B'd against the unfixed behaviour**: dropping `containerModule`, importing at the
destination instead of detached, and ungating the container tree each fail **exactly one** test.
Three existing tests pinned the old shape and each was updated with the reason — `linkDropAsks`'
preselect assertion is the same OUTCOME under a new id.

2179 client tests, **the same 3 pre-existing `liveOpsBehavioral` failures — A/B'd against stashed
source, identical 3.** Build clean, chunk sanity holding (tiptap 435 / highlight 969 /
CommandCenter 202 / PagePreviewApp 1007).

**NOT VERIFIED, and it is the honest gap: the page-wrap path has never run in a browser.** The
writes it leaves are asserted (detached import, page minted, root embedded, meta preserved, nothing
minted on failure), and the DEFAULT outcome is unchanged by construction — but nobody has watched a
dropped article become a drillable card. **Not deployed** for that reason.

---

### 2026-08-08 (7) — two intake shapes, and the CALL SITE that would have made them inert

Coverage measured with `assertShapeCoverage()` rather than read off the task list — which was stale
again: **`link-page` and `link-container` were already shipped.** 14 implemented / 10 open / 0
orphans before; **16 / 8 / 0** after.

**`text-textblock` FIXED A LIVE WRONG DEFAULT rather than adding a feature.** The classifier has
always preselected it for text dropped inside a doc body (*"inside a doc the page wrapper has
nowhere to go — the words do"*), but with no route `filterToImplemented` silently re-pointed that at
`text-doc-page`. **Pasting a paragraph into a doc offered to build a whole page.** Identical shape to
the link-chip preselection bug in 2026-08-07 (5): a classifier decision quietly overruled by a
missing route. The test asserts the preselection now SURVIVES the filter, and fails without it.

`textToParagraphs` splits on BLANK LINES only — the one transformation that would otherwise be
lossy, while a single newline is a wrapped line rather than a new paragraph. `kind: "doc"`, because
`"block"` is a value this app uses nowhere (the same trap that entry records).

**`files-container`** is the file twin of `runLinkContainer`. The only structural difference from
`runArtifacts` is the PARENT — which is exactly why it must **not** call the caller's
`onPlaceholders`: that seam wires new ids into the DESTINATION, so reusing it would scatter the
files *beside* the container instead of inside it. The splice **accumulates** the child list, since
each splice writes the whole array and a stale snapshot per file would leave only the last one —
the same accumulation `feedSync` needs, for the same reason.

**THE CALL SITE IS WHAT WOULD HAVE MADE THIS INERT, and only checking found it.**
`dropHandlers`' text ctx passed no `destinationOccurrence`, `dispatch` or `userId` — the text path
had only ever *emitted an import*, so a route that MINTS would have bailed silently and the tile
would have done nothing. Every unit test passed either way. The file ctx and the other two call
sites already carried them; only the text one did not.

**A shape that mints something invisible is worse than no shape.** `FILES_CONTAINER` /
`FILES_FOLDER_PAGE` are gated OUT of a doc body: a doc renders its TEXTMAP, so a container minted
into one is listed in `occurrences[]` and invisible — the "listed but not embedded" class. The
artifact shapes are fine there because the doc arm embeds a `moduleEmbed` per file via
`onPlaceholders`; **no call site wires the equivalent seam for a container**, so the honest move was
to gate rather than to ship it and hope.

**And my own test was wrong before the code was.** The first preselection test invented an `inDoc`
flag; it is derived from `destination.kind === "doc"`. It failed against correct code — check the
probe before believing the failure, for the Nth time.

2168 client tests (same 3 pre-existing). Deployed; served intake chunk carries both new shape ids,
with `link-chip` as the control (the App chunk reads 0 for the control too — the tell that it is the
wrong chunk).

---

### 2026-08-08 (6) — a fixed number was wrong at BOTH values; and a probe arm that proved nothing

The emotions wheel's outer ring, on a phone. `label.minAngle` had been **8** (which blanked all 80
outer labels — the 2026-08-06 disaster) and then **1** (which let them collide into an unreadable
mass). **Both were wrong, and no third constant would have been right:** the same 4.5° slice is
~14px of arc on a 390px phone, ~40px on a desktop and ~170px zoomed in.

So the threshold is derived from a readable ARC LENGTH IN PIXELS —
`deg = minArcPx·360 / (2·π·r)`. **`r` in PIXELS is the whole reason the host box had to be threaded
in at all**: the series radius is a PERCENT and ECharts resolves it against `min(w,h)/2`, so the
option object alone can never know how long an arc is. And because a `rotate: "radial"` label runs
ALONG the radius, what has to fit inside the arc is its **THICKNESS** — the font size — hence
`LABEL_MIN_ARC_PX = LABEL_FONT_PX * 1.8`, a multiple so the two cannot drift.

**The payoff is a composition a constant could never have: ZOOMING NOW REVEALS LABELS.** On a phone
the outer ring is unlabelled at rest and readable the moment you zoom in — which is what makes
hiding acceptable rather than a repeat of the blanked-ring bug. Clamped to 30° so the 8 primary
slices (45°) can never be blanked, and it returns `null` when the box is unknown so any caller
passing none renders exactly the previous chart.

**`EChart` reports its own box** (`onBox`, from a SEPARATE ResizeObserver — the ECharts one only
exists after the dynamic import resolves, and the first option is built while the chunk is in
flight). **The 1px dedupe is load-bearing:** box → option → render → measure is a loop without it.
`ContainerGraph`'s own `hostRef` is the OUTER wrapper and includes the source board, so it is the
wrong box entirely.

**VERIFIED BY SCREENSHOT, because that docket entry says to and because a chart is a canvas.** Real
option → real ECharts → Chromium, four arms:
```
before  390px, minAngle 1     outer ring an unreadable mass of overlapping text
after   390px, zoom 1         outer ring clean colour; primary + secondary still labelled
after   390px, zoom 2 + PAN   every tertiary label readable, cleanly separated
after   1400x900 desktop      fully labelled — unregressed
```
**AND ONE ARM PROVED NOTHING, which is the reusable part.** The first "zoomed" arm was zoom 4
CENTRED — at that scale the outer ring is outside the 390px box entirely, so the shot showed only
the primary ring and said nothing at all about labels. A zoom that moves the thing you are
measuring off screen is not a measurement of it. The PANNED arm is the one that demonstrates the
claim.

2156 client tests (same 3 pre-existing `liveOpsBehavioral` failures). Deployed; prod HEAD
`3ca32154`, served chunks sha256-identical to the local build.

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

### 2026-08-13 (7) — the grocery list gets the PLAN's amounts; and the rainbow band opts out as DATA

User: *"take the amounts out of the title for the grocery list. add the total amount needed in the
quantity field with the proper postfix … but the full amount needed, not just one meals worth. hide
poster and file fields from them and fill the vitamins amounts correctly. keep ingrediants at the
quantity of what it needs for a meal. so half cup for brown rice."*

**THE TOTALS ARE THE PLAN'S OWN, AND `0120` HAD DERIVED THEM.** `0120` computed "servings per day"
by counting meal placements — a reasonable inference, and unnecessary: **`Nutrition Plan.md` carries
an actual "Shopping List (With Measurements)" for the full three days.**
```
Chicken thighs 33 oz · Eggs 6 large · Greek yogurt 3 cups · Tortillas 3 · Granola ¾ cup
Frozen berries 1.5 cups · Brown rice 1.5 cups · Hummus 6 tbsp · Peanuts 1.5 cups
Pecans 1.5 cups · Lettuce 1 head · Frozen mixed veggies 1.5 cups · Apples 6 medium
```
*Read the whole source document before deriving what it already states.* **Protein powder is the one
exception and the doc says so** ("Excludes spices, olive oil, and protein powder, but they remain in
the meal plan"), so its 6 scoops is DERIVED and flagged as such rather than passed off as the plan's.

**THE SERVING SIZE IS PRESERVED, NOT DELETED.** Stripping "(1/2 cup)" from the title removes the only
record of what the macros on that row DESCRIBE — 150 cal is 150 cal *per half cup*. It moves to
`meta.servingSize`, and the macros are left alone: *"keep ingrediants at the quantity of what it
needs for a meal"*.

**ONE `Quantity` FIELD SERVES oz / cups / tbsp / head / count BECAUSE THE POSTFIX IS PER ROW** —
`field.meta.postfixOptions` says what the field OFFERS, `occurrence.fields[fid].postfix` what the row
PICKED (2026-08-08). The cooking units are ADDED to the existing g/kg/ml/L/oz/lb/count rather than
replacing them, so nothing that already picked one loses its choice.

**`0123` — 182 VITAMIN VALUES, AND THE PROVENANCE IS STATED IN THE FILE.** Not from the user's
documents: the plan lists "Key Vitamins & Nutrients" **qualitatively** ("Iron, Zinc, B Vitamins") and
the Basic Nutrition Guide gives daily TARGETS for four vitamins, not per-ingredient content. These
are standard reference values per the stated serving. **The line against `Price`, which `0120` left
empty, is deliberate: a food's vitamin content is a property OF THE FOOD — stable, public, lookupable
— whereas a price is a fact about a shop on a day.** One can be looked up; the other would have been
invented. **Zero is written where a food genuinely contains none**, because `Meal Nutrition` sums
these and a blank would read as "nothing to add" for both the absent and the unmeasured case.

**`0124` — THE RAINBOW BAND IS TURNED OFF AS DATA.** User: *"turn it off on the timeslots."* The
band is a `::after` on every `.container-shell > .container-header`, which reads as an accent on a
page and as **49 stripes down a schedule day column**. The stylesheet may NOT name a timeslot —
`noDomainKnowledge.test.js` fails the build if the generic renderer learns what a schedule is, a rule
already earned twice (the hardcoded timeslot-passed tint, 2026-06-03; `SCHEDULE_LABEL_PREFIX`,
2026-07-26). So the renderer reads `module.meta.headerBand === false` and the migration sets it.
**Which containers is STRUCTURAL — do they carry a `Time Slot` value** — not their label ("7:00am" is
one rename from wrong). 294 modules = 49 slots × 6 roots; **the day column keeps its band**, being
the one header per column a band flatters rather than repeats.

2567 client + 865 server tests, build clean, poms grid **0 errors**.

---

### 2026-08-13 (6) — the grocery list is the PLAN's; and why the new ingredients had no price/quantity/picture

User: *"why are the old ingredients in the grocery list and why dont the new ones have price quantity
and pictures"*.

**THE OLD ONES WERE THERE BECAUSE I LEFT THEM, and that was my misjudgement.** `0115` retired only
exact prefix duplicates and kept eleven more as "staples the plan does not mention". The grocery list
is the plan's SHOPPING LIST; Chicken Breast · Rice · Spinach · Oats · Salmon · Olive Oil · Sweet
Potatoes · Black Beans · Milk · Bananas · Coffee Beans are the 07-28 seed's ingredient set,
superseded wholesale. All 11 untagged. **`Paper Towels` stays** — it is the one row tagged `grocery`
and NOT `ingredient`, and "the old ingredients" is not a household item. *When the caution is wrong,
say which call was wrong rather than re-deriving the same answer.*

**WHY THE NEW ONES HAD NOTHING, measured rather than guessed:** the `Quantity` and `Price` fields
DO exist — an earlier commit put them "on every ingredient" — but it bound them to the modules that
existed THEN. `0103` minted the plan's ingredients afterwards, binding only Board Category, macros
and vitamins:
```
old ingredient   Board Category · Poster · Files · Calories… · Quantity · Price     (9)
new ingredient   Board Category · Calories… · 13 vitamins                          (18, none of the four)
```
**"Every X" in a migration means every X THAT EXISTS WHEN IT RUNS.** A later mint does not inherit it,
and nothing fails — the field is simply absent from the new rows' controls. Same family as `0043`
(a fresh seed with no posters) and `0064` (the seed never learning a renamed key).

**QUANTITY IS DERIVED, PRICE IS DELIBERATELY BLANK.** Quantity = **servings per day**, computed by
walking `MEALS_BY_SLOT` against each meal's own ingredient list — so Peanuts & Apple, eaten twice a
day, gives Peanuts 2, and Pecans, appearing in two different meals, also gives 2. That is a fact
about the plan. **Price is left EMPTY on purpose**: nothing on this grid or in the plan docs knows a
price, and a plausible-looking price in a shopping list is indistinguishable from one the user
entered and will be trusted — the rule `0052` set for phone numbers and `0054` for addresses. The
field is BOUND so there is somewhere to type it.

**A PICTURE IS AN ARTIFACT OCCURRENCE, learned from an existing one rather than assumed:**
`Poster = "e442d34b…"` → `role:"artifact" kind:"image" fileRef:"https://…"`, with `Files` pointing at
the same id. `0121` mints one per ingredient from the app's OWN `/api/images/search` route, and
**homes it where the existing ingredient pictures live — derived as the parent of an artifact an
ingredient already points at**, so a renamed Files folder cannot break it.
- **It probes the route before writing anything** and REFUSES if it is unreachable, because a
  half-populated board is worse than an untouched one: nothing tells you which half failed.
- Idempotent on "already has a Poster", so a re-run after a partial failure fills only the gaps.
- 14/14 attached, one search each, 400ms apart — the route proxies a public endpoint.

Grocery list ends at **15**: the plan's 14, each with a picture and a per-day quantity, plus Paper
Towels. poms grid **0 errors**.

---

### 2026-08-13 (5) — "8 workouts a day?" — the OPTIONAL CORE had been folded in as prescribed

User: *"that seems like alot of excercises for one day. im counting 8 workouts today alone"* —
and the answer was **every training day, not just today.**

**READING THE SOURCE DOC SETTLED IT IN ONE LOOK.** `Fitness Plan.md` lists **6 numbered exercises**
per training day and then a SEPARATE block:
```
### Day 1: Upper Body – Push Focus
1..6  Bench · Shoulder Press · Incline · Lateral Raises · Tricep Dips · Pushdowns
**Optional Core**:  Planks · Russian Twists          <- a separate block
```
`0104` flattened both into `CYCLE.movements` with no distinction — its own header even says
"(+ optional core)" and then lists all eight. **The plan's own structure was the specification and
it was right there; the migration paraphrased it instead of preserving it.** Worth keeping: when a
source document separates two lists, the separation is usually the meaning.

**THE USER'S RESTRUCTURE IS ALSO THE PLAN'S.** *"make one of the rest days a core and cardio day, so
5 templates total"* — and the six optional-core movements (two per training day) are exactly one
core session:
```
Day 1 Push   6 lifts      Day 4 Core & Cardio   the 6 core movements + Run + Stretch
Day 2 Legs   6 lifts      Day 5 Rest            NOTHING for exercise, per the user
Day 3 Pull   6 lifts
```
**CARDIO IS BUILT FROM WHAT EXISTS.** `Muscle Group` HAS a "cardio" option but the Movements board
has **no cardio movement** — so a cardio Exercise row would have nothing to pick and would render as
exactly the empty row `0109` deleted this morning. Physical > Fitness already holds **Run** and
**Stretch**, which is what the plan's Day 4 describes, so those are placed as routines instead.

**`0117` — Set 4 / Weight 4.** The plan prescribes 4 sets on compounds and the action bound only
Set 1-3, so the fourth set could not be recorded. Which lifts get four is **read from the plan** (the
entries reading "4 sets of …" — 8 of them, all 8 resolved). The binding goes on **every** Exercise
module, not just the catalog one: each placed row is a CLONE with its own `fieldBindings`, so binding
the catalog alone would give the field to future rows and leave every existing row without the
control. Inserted AFTER Set 3 because binding order is render order.

**`0119` EXISTS BECAUSE READING THE RESULT BACK CAUGHT WHAT THE LOG DID NOT.** After `0117` today's
Bench still read `sets=[6,6,6,-]`: the field was on the movement OPTION, where a NEWLY placed row
copies from — but every row already placed had copied its sets before the field existed. So the
prescription was correct in the catalog and missing everywhere it is read. It backfills from the
picked movement, and **only where the row's own value is EMPTY — a row is a LOG as well as a
prescription, and overwriting a performed set from the catalog would rewrite history.**

Verified by reading back: 6 lifts on each training day, Day 4 six core + Run + Stretch, **Day 5 zero
lifts**, today down from 8 to 6 with `sets=[6,6,6,6]` on the compounds. Rotation rebuilt over five
names using `0112`'s OWN builder rather than re-authored, so the tested pipeline shape cannot drift.
poms grid **0 errors**, 865 server tests.

---

### 2026-08-13 (4) — the dropdown showed IDs because I pointed at FEED COPIES; grocery list from the plan

User: *"the meal dropdown is showing the ids and not the names"* and *"the grocery list isnt updated
to match the new ingrediants."* Both fixed, plus the audit's sweepable findings.

**THE POINTER BUG WAS MINE AND THE MECHANISM IS THE KEEPER.** `0108` resolved each meal and movement
by walking the **Meals / Movements BOARD's children**. Those boards are FEED-BACKED materialized
views, so their children are feedSync COPIES with client-minted `<epoch-ms>-<rand>` ids:

```
stored Meal/Movement picks   source:0   feedCopy:0   MISSING:72
                             ^ every one dangling, hours after I verified "0 unresolved"
```

Two consequences, and the second is what was on screen:
1. **feedSync RE-MINTS its copies.** The servers restarted, clients reconnected, the sync ran, every
   copy got a new id — and all 72 stored picks became references to occurrences that no longer exist.
2. **Every occurrence dropdown's predicate ends `meta.feedSourceId IS_EMPTY`** — it offers the
   SOURCES, never the copies. So even while the id was live the value was not in the option list, the
   renderer had no label for it, and it printed the raw id.

**A REFERENCE TO A FEED COPY IS VALID ONLY UNTIL THE NEXT SYNC.** CLAUDE.md 2026-08-10 already states
this for WRITES — *"a tag written on a copy is a write to something about to be overwritten"* — and
this is the same rule for POINTERS, which nothing had recorded. **My verification said "72 picks, 0
unresolved" and was TRUE when measured and FALSE twenty minutes later.** A check against data a
background engine regenerates has a shelf life; re-check it after the thing that regenerates it runs.

**THE INTENT SURVIVED THE IDS, by luck that is worth making deliberate.** `0112` had signed every
placed row `identitySignature: "cycle:<pick label>"` for merge-idempotence — and that signature is
what made the repair a LOOKUP instead of guesswork. `0114` repoints from the signature to the source
pool the dropdown itself offers, and only where the value fails to resolve, so a hand-set pick is
never touched. **Proven durable rather than asserted: re-measured AFTER a restart ran feedSync again
— 72 resolve to a source, 0 copies, 0 dangling.**

**`0115` — the grocery list is DERIVED FROM THE MEALS, not listed.** All 16 grocery rows were the
2026-07-28 seed's and not one of the plan's 14 ingredients carried the tag; `0103` replaced the
Ingredients board and never touched grocery. It **writes the TAG, not the board** — the board is a
materialized view, and pushing into its `occurrences[]` fights the sync that just cost a session.
The requirement is computed by walking the six plan meals' own `Ingredient` values, so changing the
plan and re-running picks the change up.
- **Only exact PREFIX duplicates are retired** — "Eggs" against "Eggs (1 large)" — which measured as
  4 rows. The other **12 are KEPT and reported**: Milk, Bananas, Coffee Beans, **Paper Towels**, Rice,
  Spinach, Oats, Salmon, Olive Oil, Sweet Potatoes, Black Beans, Chicken Breast. They are staples the
  plan does not mention, and **a shopping list is precisely where deleting something the user meant
  to buy is worse than leaving a row too many.** Paper Towels is the tell.

**`0116` — 18 stranded textblocks swept, and the GUARD is the point.** Reachability is checked THREE
ways — parent `occurrences[]`, textmap embed, **and field value** — because the 2026-08-07 (8) lesson
was paid for by answering exactly this question with two of the three. **A CONTROL runs first**: each
test must find live rows (1517 / 1327 / 324) or the migration REFUSES, because a test returning zero
is a broken probe, not an empty set. That third check spared two blocks my earlier two-way scan had
condemned. 18 blocks, 23 characters of test typing, dumped raw before deletion.

poms grid **0 errors**, 865 server tests.

---

### 2026-08-13 (3) — AUDIT of 2026-08-09 → 08-13: six findings, and three "defects" that measuring dissolved

User: *"audit this and all the other stuff we worked on the past couple days"* (the whisper session
excluded on their instruction — it made no commits to this repo). Audited by measuring the LIVE
grids and the deployed state, not by re-reading the entries.

**CLEAN, each verified rather than assumed:**
```
2567 client + 865 server tests · client build clean, chunk sizes at documented values
integrity   poms grid 0 errors · test grid 2 0 · test grid 1 the 1 documented frozen-archive error
0 dangling child refs · 0 module-less occurrences · 0 duplicate field names · 0 inert kinds
0 duplicate day columns · 0 "Due" containers (the 08-11 merge into Todo held)
1 Emotions Wheel, multi-parented into 5 columns (the 08-11 "ONE shared wheel" held)
72 Meal/Movement picks, 0 unresolved
```
**The deploy state is CORRECT and that was worth checking rather than assuming:** prod HEAD is
`b2d0e77d` while local is 6 commits ahead — but `git diff --name-only b2d0e77d..HEAD -- client/`
is **EMPTY**. Every commit since is `server/migrations/` plus docs, and migrations run against the
shared Atlas database, so nothing is owed. *A stale prod HEAD is not evidence of an undeployed
feature; diff the paths.*

**THREE APPARENT DEFECTS DISSOLVED UNDER TIMESTAMPS — recorded because the raw count was alarming
and wrong.** A scan found 278 occurrences "parented but not listed by their parent". Excluding
children rendered through a TEXTMAP (a doc lists nothing; it embeds) cut it to 43, and dating the
survivors explained all but one:
- **Ingredients, 10 "invisible"** — the seed's plain rows (`Chicken Breast`, dated 07-28), unlisted
  by `0103` when it replaced them with the plan's unit-bearing ones (`Eggs (1 large)`, dated 08-13).
  That is the migration doing exactly what was asked. Dead rows, not a fault.
- **Grocery List, 6** — dated 2026-07-28, superseded 07-29. **Predates this week entirely.**
- **Notes / Journal, 18 textblocks** — `fwefefifeuife`, `trhthw`, `9865['0`. Test typing, stranded
  by the textblock/backspace work. `sweepOrphans` correctly REFUSES them (they hold a character), so
  they linger as invisible junk.
*A count of "unreachable" rows is a claim about the reachability definition until every way a thing
can be reached has been checked — the 2026-08-07 (8) lesson, paid again from the opposite side.*

**FINDING THAT STANDS, and it needs one look on screen: the Day Page board lists 5 of its 13
columns.** Jul 28 – Aug 5 are parented to it and unlisted. `Day Page: Build` carries an `ADD_CHILD`
in its mint branch; whether an EXISTING column is re-linked on navigation was NOT settled here.
**The 5-second test that settles it: navigate the Day Page to Aug 5 and see whether the column
renders.** It matters because the 08-13 moods work is specifically about going back to a past day.

**MY OWN DEBRIS, found and swept:** `0108`/`0109` deleted 83 occurrences and left their MODULES
behind — deleting an occurrence never removes its module. 67 swept (dumped first); 16 held by
`sweepOrphans`' 60-minute age floor, which is the guard working, not a failure.

**test grid 2 is STALE, not broken:** it still carries the pre-`0067` `grid.meta.universalFieldIds`
while poms grid carries `autoAppliedFieldIds`. The client reads only the latter — but the SEED calls
`0067`, so a fresh grid is correct and a reseed aligns it. **Checked rather than assumed**, because
the same shape (a renamed grid-level key the seed never learned) is exactly how `0043` left a fresh
grid with no posters.

**Also open:** 1 Check In of 19 carries no resolvable Mood.

**THE STANDING HAZARD, unguarded: a client echoing a stale `occurrences[]` back over a migration's
write.** Today was the third recorded instance of that family. There is no guard — the only defence
is the rule now recorded above: **restart the server AND reload the tab before believing a placement
stuck.** Worth a real one: the server could reject a parent-array write whose contents predate the
occurrence's own `updatedAt`.

---

### 2026-08-13 (2) — "none show up on today": the rows were never deleted, the BROWSER echoed a stale array

User, on the deployed grid: *"none show up on today right now, which they should."* The database had
every row. **They were not deleted — their slot stopped listing them.**

```
Eat/Exercise rows with a pick        72 exist
unlisted by the slot they name       9      <- the 7:00am Eat + all 8 Exercise
Hygiene                              back in 7:00am, Hot Tub gone from 7:30am
```

**A sweep DELETES; an array overwrite leaves the row alive and invisible** — which is exactly what
was on screen, and the tell that told the two apart without guessing.

**THE CAUSE IS THE DOCUMENTED SELF-RESTORING CLASS (2026-07-29), reached from a new direction.**
That entry says *"the client holds whatever the last full_state gave it and echoes the whole array
back, so sweeping the DB fixed nothing."* `0106`/`0108` wrote `occurrences[]` directly **while a
browser tab was connected holding the pre-migration arrays**, and the tab's next write echoed its
stale copy over them. The pure ADDs to slots the tab had not touched SURVIVED — which is why the
9:00am-onward meals were fine and only the two slots the MOVE touched came back wrong. That
asymmetry is the fingerprint.

**THE RULE, and the standing one was not enough: a migration that writes `occurrences[]` needs the
CLIENT gone, not just the server restarted.** The documented remedy is a pm2 restart, which clears
the warm cache — necessary, and it was not sufficient, because the stale array was in the BROWSER.
Restart *and* have the tab reload before believing a placement stuck.

**`0111` re-links rather than re-creates**, with `$push` + a `$ne` guard rather than writing the
array whole — a read-modify-write on the very field that got clobbered would race the same client
again. It is deliberately re-runnable: if a tab clobbers it once more, run it again and it converges.

**AND THE REPAIR CREATED A SECOND DEFECT THAT ONLY READING IT BACK CAUGHT.** Hygiene ended up listed
by **BOTH** 7:00am and 7:30am — the echo restored the 7:00am entry while its own `parentId` said
7:30am, so re-linking left it in two places. `0113` unlists it, and **the rule is narrow on purpose**:
only when ANOTHER slot **of the same root** is the child's actual parent. Multi-parenting is
load-bearing here — the Schedule shares one slot across day columns and `Place Dated Work`
multi-parents a task into several days so one tick counts everywhere — and a blanket "listed by a
non-parent" rule would have forked all of it. Dry run: **1 hit, 0 false positives** across every day
column and template.

**THE ROTATION IS WIRED** (`0112`, `Schedule: Place Cycle Day`). Each new day takes the next cycle
template, 1→2→3→4→1.
- **It does NOT rotate the template `Schedule: Build Schedule` applies** — that op resolves its
  template once outside the per-day loop and matches slots by `meta.copyLinkSource`, so pointing it
  elsewhere copies in 49 duplicate slots per day. Build Schedule keeps the SLOTS and the daily
  routines; the new op owns the CONTENTS.
- **Idempotence is `identitySignature` + `mode:"merge"`, not dedupe written in pipeline JSON.**
  Merge skips a node when a sibling already carries the signature, so the migration signs the 56
  template items **and today's 16 already-placed rows** — without that second half the first run
  would clone a duplicate of every one.
- **The op places only rows carrying a PICK.** The cycle templates also hold the daily routines so
  they stay complete if applied by hand — but Build Schedule already places those, so placing them
  here too would put a second Drink on every column. **The dry run is what surfaced this**, before
  it could land.
- **The cycle position is STORED, not computed** (the pipeline has no modulo): a day column carries
  `Cycle Day` as TEXT ("Day 1"), and the stored value is what makes a rebuild stable — a re-run
  reuses it instead of advancing, so the sequence cannot drift on every reload. Text because a
  rule's `right` is a string and comparing it to a stored number is a loose-equality guess.
- Trigger surface is **mirrored from Build Schedule at run time** rather than restated, at a lower
  priority so it always follows it.

**NOT VERIFIED, and it is the honest gap: the op has never fired.** It is wired, enabled, signed and
scoped, but no day has rolled over with it live — that only proves out at midnight, and the first
thing to check then is whether tomorrow's column comes up "Day 2".

Also shipped: `0109` (empty Eat/Exercise off the schedule, catalog kept), `0110` (Hot Tub on the
daily template). poms grid **0 errors**, 865 server tests.

---

### 2026-08-13 — today's schedule matches the cycle template; and the build op's slots belong to ONE template

Picked up the other account's queue (it applied `0104` — four cycle templates — then hit its session
limit before committing). Committed `0104` as the record of what already ran, then the user's two
asks: **rename the templates** (`0105`) and **make today match them** (`0106`). Both applied to poms
grid; **0 integrity errors**.

**THE MEASUREMENT THAT DECIDED THE DESIGN, and it contradicted the obvious approach.** The obvious
move is "point `Schedule: Build Schedule` at the new template". It would have been wrong:

```
build op step [2]   $dayCont = $allItemsById.9EZL5iXnYhul     <- ONE template, resolved ONCE,
                                                                 OUTSIDE the per-day loop
slot match          meta.copyLinkSource IS $tplChildId        <- a specific template's slot IDS
today's 49 slots    identitySignature: null, copyLinkSource -> the ORIGINAL "Day" template
```

**A day's slots are COPY_LINK copies keyed to the slot occurrence ids of the template that minted
them.** Applying a different template over an existing column matches *nothing* and copies in **49
duplicate slots** beside the real ones. The templates carry correct `slot:<label>` signatures — all
49, verified — but the build op never looks at them; `identitySignature` is APPLY_TEMPLATE's
matcher, and this path uses COPY_LINK. **Two identity schemes for one concept, and the one the
header documented is not the one that runs.**

So `0106` places ITEMS into the slots that already exist, matched on the **`Time Slot` value** —
what a slot actually is, and the only key both sides share. Additive and idempotent by label.

**THE "PAST SCHEDULE DAYS" ASK WAS ALREADY MOOT, and only a census showed it.** The previous
session's open ask was *"change the past schedule days to use the new templates"*. There is exactly
**ONE schedule day column on the grid** — today's. Older days are Day Page columns; their Schedule
day-col is swept by the rebuild (the 2026-08-12 `0086` finding, from a new direction). Nothing to
migrate; scope collapsed to today by measuring rather than by building.

**THE REMOVAL IS GUARDED, and the guard is the point.** `0104` drops the generic "Exercise" from a
cycle day because real movements now sit at 7:00am and a generic Exercise beside them double-counts
in every workout tracker. `0106` removes today's only when it carries **nothing the user entered** —
a ticked Completed is a record that a workout happened, and deleting it is data loss, not tidying.
It reported `carries nothing entered` before removing.

**Verified by reading the column back, not from the log.** 16 rows placed (8 meals + 8 movements),
1 removed; every slot now equals the template except the three things deliberately preserved — the
two Todo rows and the four **Peer Support Group** appointments (7:00pm correctly shows the
appointment AND the meal; a slot holds any number of items).

**`0105` renames on the MODULE and checks first.** Nothing resolves these templates by label, and
that is verified rather than assumed — it refuses if any occurrence carries the old name as a label
override or any operation names it. **It is a separate migration from `0104` on purpose:** `0104`'s
existence check keys on the OLD label, so re-running it against a renamed grid would build four MORE
templates. The applied-ledger is what prevents that, which is exactly what a ledger is for.

**THE USER CAUGHT A REAL DEFECT IN `0104`/`0106`, and it was functional, not cosmetic.** *"the
template must use eat and excercise with the correct things filled. not new occurances."* Both had
placed **copies of the BOARD ROWS** — a row literally labelled "Barbell Bench Press" — beside the
routines. Measured against the bindings, those rows are invisible to everything meant to read them:

```
Exercise  binds Movement · Set 1-3 · Weight 1-3 · Completed · Time Slot · Habit   (13)
Eat       binds Meal · Ingredient · Calories/Protein/Carbs/Fats · Habit · …       (23)
rows carrying a Movement or Meal pick, BEFORE this work:                            0
```

The workout trackers resolve the **Movement pick** to read its muscle group (2026-07-25) and
`Meal Nutrition` is **Eat-scoped** — so a bare board copy fed no tracker at all. **A board row is
the OPTION you pick; the routine is the thing you do, and the schedule holds the doing.** `0108`
replaces all 72 copies with `Eat`/`Exercise` rows whose picks arrive FILLED the way a hand pick
would: Movement + `Set 1/2/3` copied from the movement, Meal + its ingredient list + the four macros
**summed over those ingredients** — which is exactly what `0042`'s prefill chain produces.

**ONE RULE, BOTH DESTINATIONS.** `applyCycleDay` runs over the four templates AND today's live
column. Writing it twice is how a migrated grid and a rebuilt day drift — the lesson `0053` and
`0064` both paid for.

**Idempotency keys on the PICK, not the label** — every meal row is called "Eat", so a label check
would place eight duplicates on a re-run and then call itself clean.

Also shipped: **Hot Tub** (`0107`) under Physical → Care, its shape COPIED from Hygiene rather than
enumerated — the **Habit** binding is the discriminator "Completed Habits" counts on, and a routine
minted without it lands silently in the TASKS count instead. Hygiene moved **7:00am → 7:30am** ("the
timeslot after the workouts", read literally — the workout is IN 7:00am), with Hot Tub beside it.

**Verified by reading the grid back:** 72 picks, **0 unresolved**; 40 Eat rows at 23 bindings, 32
Exercise rows at 13; **0 board copies left**; the two Todo rows and four Peer Support appointments
untouched. poms grid **0 errors**, 865 server tests.

**The flagged empty 8:00am Eat came out the same session** — user: *"i dont need the original eat
thats empty or any empty excersise."* `0109`'s discriminator is **structural, and it is the whole
safety of the migration: does the row sit in a TIMESLOT.** The Routines catalog holds the ONE
canonical `Eat` (Physical > Nutrition) and `Exercise` (Physical > Fitness) — the actions every
placed row is cloned FROM — and **matching on the label would have deleted them**, breaking `0108`'s
rule and the "+ Add" flow permanently. They are not in a slot, so they are not placements. 11
removed, catalog reported as declined rather than assumed safe.

**IT HAD TO INCLUDE THE "Day" TEMPLATE, and that is the non-obvious half.** `Day` is what
`Schedule: Build Schedule` still applies every morning, so leaving its empty Eat/Exercise would have
put them back on tomorrow's column and read as the fix silently failing overnight.

**The same reasoning found a gap in the Hot Tub ask** (`0110`): `0108` placed it on the four CYCLE
templates and today, but the rotation is not wired, so tomorrow builds from `Day` — which had no Hot
Tub. The routine would have appeared today and vanished tomorrow. It is placed **in Hygiene's own
slot by LOOKUP, not by naming a time**: 7:30am on the cycle templates (after the workouts), 7:00am
on `Day`, which has no workouts for it to come after. *"The same timeslot as hygiene" is a lookup,
not a constant.*

**THE ROTATION IS NOT WIRED — the user asked for it and it is NOT done.** Stated plainly rather than
half-shipped. What the next session needs, already settled:
- The blocker is that the cycle day must be derived PER DAY inside the loop, and the pipeline has no
  modulo. **Two routes exist and both are unexercised for this:** `CYCLE_FIELD_VALUE` already does
  `dayOfYear % n` but reads `$today`, not the loop's `$day`; and `DATE_ADD`'s `advanceUntil` can roll
  an anchor forward by 4 until it passes `$day`, which yields the cycle position by subtraction.
- **It must NOT rotate the template `Schedule: Build Schedule` applies** — see the slot-identity
  finding above. It should be a SEPARATE op placing items into existing slots, i.e. `0106`'s rule
  running per day.
- It changes a shared op governing every date-carrying page, so it wants its own pass with the
  behavioural harness driving the real executor — not a pipeline edit believed by reading.

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


