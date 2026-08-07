# Staged loading — grid shape first, per-panel spinners, one circular loader

> **STATUS: Task 1 MEASURED 2026-08-06 (results below). The plan's own "discard the mounting half
> if the numbers disagree" clause did NOT fire — rendering dominates the op sweep by roughly 3:1,
> so Tasks 2-4 are aimed at the right layer.**
>
> Task 1 is a MEASUREMENT and it must run before any of the
> rest. This file deliberately stops short of implementation for a reason recorded repeatedly in
> `CLAUDE.md`: on this codebase, *every performance fix that actually worked came from numbers off
> a real device, and every one that came from reading code was wrong* (2026-08-05: four wrong
> diagnoses in one day; 2026-08-04: a proposed optimisation that was already shipped and was itself
> the cause).

**User direction (2026-08-06, task list):**
> "Staged loading: grid shape first, per-panel spinners, one circular loader"

---

## What the load path does TODAY (verified, 2026-08-06)

- **`full_state` is ONE dispatch.** `bindSocketToStore.onFullState` does a single
  `socketDispatch({ type: FULL_STATE, payload })` carrying grid + occurrences + modules + fields +
  operations together. There is no partial state to render from.
- **`App.jsx` gates the entire UI on it**: `state.grid?._id ? <Grid/> : <Spinner size="xl"/>`. So the
  screen is one all-or-nothing spinner, then everything at once — which is exactly the experience
  the task is about.
- **A timing instrument already exists** — `onFullState`'s `markFS(label)` logs
  `[full_state-client] +Nms <label>`. That is the hook Task 1 extends rather than reinventing.

**So "grid shape first" is not a matter of exposing staging that already exists — there is none.**
It requires deliberately deferring work, and the plan's whole risk is deferring the WRONG work.

## What is already known about where load time goes

From the docket in `client/src/CLAUDE.md`, all previously measured:

| Cost | Measured | Note |
| --- | --- | --- |
| on-load op sweep | **556ms**, 58 ops (Build Schedule 114ms, Table: Build 56ms) | one synchronous block, already deferred past first paint |
| eager TipTap mounts | an imported article mounts 100+ ProseMirror instances | "editor static-until-focus" docket entry |
| `full_state` payload | ~1.9MB JSON | ~85% on the wire since WS deflate (2026-07-06) |
| time to 20+ rows (390px, 4× CPU) | **7.8s** — and identical with row-skipping on or off | so it is NOT rendering; it is the op drain |

**That last row is the one that should shape this plan.** A 4× throttled load spent 7.8s to content
*with rendering optimisations making no difference*. Spinners that decorate a 7.8s wait are not the
win; shortening or slicing the drain is. Task 1 exists to confirm that split on current code before
anyone builds chrome around it.

---

## Task 1: MEASURE — what actually blocks first paint

- [ ] **Step 1: extend the existing `markFS` instrument**, do not add a second one. Mark: dispatch
      start/end, first `Grid` commit, first panel commit, last panel commit, op-sweep start/end.
      Gate it behind a flag like every other diagnostic here (`window.__loadDiag`).
- [ ] **Step 2: measure on TEST GRID 2, not poms grid.** A probe that loads the live grid WRITES to
      it (feedSync mints, ops fire) — recorded three times, and it has cost a sweep every time.
- [ ] **Step 3: report the split** — of wall-clock from `full_state` arrival to usable UI, how much
      is (a) the reducer dispatch, (b) React committing the tree, (c) the op sweep, (d) editor
      mounts. **Do not proceed until these are four numbers.**
- [ ] **Step 4: measure at 4× CPU throttle too.** The 7.8s figure above is throttled; an unthrottled
      desktop number will make the problem look solved when it is not.

**The decision this measurement makes:** if the op sweep dominates, the work is slicing it
(`bindSocketToStore` `endDropBatch` already has the per-op macrotask pattern to copy) and the
spinners are cosmetic. If committing the tree dominates, staged mounting is the work. **The plan
below assumes the second and must be discarded if Task 1 says otherwise.**

### RESULTS — 2026-08-06, test grid 2, local server, `_loadsplit.mjs`

Instrument: `client/src/helpers/loadDiag.js` (opt-in, `window.__loadDiag = true`), extending the
`markFS` timer that `onFullState` already had. Marks: dispatch start/end, panel commit (per panel),
grid commit, page/container first RENDER and first COMMIT, op sweep start/end, effects end, and
first paint after the grid commit (double rAF). Long tasks via `PerformanceObserver`, reported as
`supported:false` rather than `0` where the entry type does not exist.

Everything below is ms **from `full_state` arrival**. Medians of 3 runs (2 when throttled).

| | 1440×900, CPU 1× | 1440×900, CPU 4× | 390×844, CPU 4× |
| --- | --- | --- | --- |
| (a) reducer dispatch | **0.1** | **1.1** | **0.7** |
| panel chrome committed | 125 | 504 | 425 |
| content first RENDERS | 148 | 627 | 532 |
| (b) content COMMITTED (131 containers, 26 pages) | **1415** | **6676** | **7058** |
| (c) op sweep | **552** | **2247** | **2061** |
| (c2) applying op effects | 70 | 312 | 346 |
| (d) editor mounts | **0 — none on this grid** | 0 | 0 |
| 20+ instance rows in the DOM | 1532 | 7589 | 8109 |
| **first PAINT** | **2542** | **11784** | **11966** |
| main thread blocked, total | 3688 | 14960 | 13101 |

**The four numbers, and what they say.**

1. **The reducer is free.** 0.1ms at 1×. `FULL_STATE` is not a cost and never was.
2. **Rendering the content tree is the cost.** Containers start rendering at 148ms and do not
   finish committing until 1415ms — **~1265ms of React render work in ONE unbroken task** (the long
   task at t=99 runs 1503ms). Throttled 4×, that same span is **~6000ms**, which is exactly the
   docket's unexplained "7.8s to 20+ rows": rows land at 7589ms, and the op sweep has not even
   started yet.
3. **The op sweep is real but SECOND** — 552ms / 2247ms, roughly a third of the render cost, and it
   runs AFTER the rows exist. **This retires the plan's leading hypothesis.** Slicing the drain
   would shorten the tail, not the wait people describe.
4. **Editor mounts are UNMEASURED, not zero.** Test grid 2's initial view mounts no TipTap at all.
   The "editor static-until-focus" docket entry is about imported articles on **poms grid**, which
   this probe deliberately does not load. Do not read the 0 as evidence.

**The finding that shapes Tasks 2-3, and it is not the one the plan expected.** The panel CHROME
already commits early and on its own — 125ms at 1×, 504ms at 4× — a full second (six seconds
throttled) before its content. So "the grid shape paints first" is *almost already true*, and the
reason nobody sees it is the last row of the table: **the first paint is at 2.5s / 11.8s**, because
React keeps rendering the content in the SAME task and the browser never gets a frame. The work is
therefore **yielding between the chrome commit and the content mount** so the shape can actually
paint, then mounting content progressively — not inventing a staging that does not exist.

**Probe caveats, recorded so the next reading is not over-confident:**
- **0 → ~88ms (321ms at 4×) elapses BEFORE the dispatch**, inside `onFullState` — the field
  migration pass plus `console.log("[socket] full_state received:", payload)`. A console.log of a
  ~2MB object is cheap with no client attached and expensive with CDP attached, which a Playwright
  probe always is. Treat that leading segment as **probe-inflated**, not as a user cost.
- Local server, one machine, headless Chromium. The 4× column is the one to compare against the
  device numbers in `client/src/CLAUDE.md`, and it lines up with them.

---

## Task 2: the grid SHAPE paints without its contents

- [ ] **Step 1:** `App.jsx` stops gating on `state.grid?._id` alone. Panels are placement + label —
      the shape is renderable from `grid.occurrences` + the panel occurrences, which the same
      payload carries.
- [ ] **Step 2:** each `ModulePanel` renders its chrome (header, drag handle, border) immediately
      and its CONTENT behind a readiness flag.
- [ ] **Step 3:** content mounts progressively — one panel per frame (or per `requestIdleCallback`),
      nearest-to-viewport first. On mobile only the active cell's panel is urgent; the rest can wait
      (`MobileGridNav` already knows which cell is active).

## Task 3: per-panel spinners, ONE circular loader

- [ ] **Step 1:** the panel-level indicator is the SAME `Spinner` component already used, at a
      smaller size — not a new spinner design. The user asked for one circular loader; that means
      one visual language, not one instance.
- [ ] **Step 2:** the full-screen spinner survives only for "no grid at all yet" (a genuinely empty
      state), and the grid-switch overlay keeps its current behaviour.
- [ ] **Step 3:** a panel that mounts in under ~150ms must NEVER flash a spinner. A spinner that
      appears and vanishes reads as jank, not progress — gate on a delay, and prove it with a
      throttled capture, not by looking at it once on a fast machine.

### BUILT — 2026-08-06. What Tasks 2/3 actually became, and the two defects on the way

**`helpers/stagedMount.js` (NEW)** hands out permission to mount content, one surface per frame, in
priority order — nearest-first (the ACTIVE CELL on mobile, reading order on desktop).
`hooks/useStagedContent.js` is the React seam; `ModulePanel` renders its chrome and header
immediately and gates only its BODY. It is OFF by default and switched on by `App.jsx` at runtime,
so a unit test that renders a panel still gets its content synchronously.

**DEFECT 1 — a rAF is not a paint, and a screencast is what proved it.** The first version released
on a double `requestAnimationFrame`. rAF callbacks run BEFORE that frame's paint, so React rendered
the content in the very frame that was meant to paint the chrome. Measured with a CDP screencast at
390px / 4x: **the browser painted NOTHING between 2.0s and 9.7s** — the chrome was committed the
whole time and never reached the screen. `setTimeout(…, 0)` after the rAF was still not enough: on a
saturated main thread Chrome runs a due timer rather than painting. It takes a real idle window
(`PAINT_GAP_MS = 50`), and the same fix had to be applied to the on-load op sweep's own deferral.

**DEFECT 2 — the sweep was jumping the queue.** With the paint fixed, the op sweep (0.5s; **3.8s**
throttled) ran before any content, so the shape sat empty for the whole of it and the first rows
landed at **11.7s** against 8.1s unstaged. The sweep now waits for `whenStagedFirstRelease` — the
NEAREST panel's content goes first, then the sweep pays for the rest.

**AND THE PROBE ITSELF WAS WRONG FIRST.** The original screenshot probe sampled with
`page.screenshot()` + `page.evaluate()` at fixed offsets and reported the whole throttled load
finishing in 1.5s — contradicting the marks by 6 seconds. Both of those APIs **wait on the
renderer**, so a blocked main thread delays the sample past the thing it is sampling. Only
`Page.startScreencast`, which pushes frames as the compositor produces them, can see a mid-load
frame. *A probe that samples through the main thread cannot measure a blocked main thread.*

## Task 4: verify it did not make things worse

- [ ] **Step 1:** re-run Task 1's instrument and compare the same four numbers. Staged mounting adds
      frames; if time-to-usable regresses, the perceived win has to be worth a measured loss and
      that has to be said out loud.
- [ ] **Step 2:** a screenshot at 390px mid-load. Every load-path defect on this surface has been
      caught by looking, not by asserting.
- [ ] **Step 3:** sweep any probe debris and re-check `checkGrid --all` before calling it done.

### VERIFIED — 2026-08-06 (same instrument, same grid, same machine)

| ms from `full_state` | 1440×900 1× before → after | 390×844 4× before → after |
| --- | --- | --- |
| panel chrome committed | 125 → 137 | 425 → 494 |
| **first PAINT** | 2542 → **199** | 11966 → **737** |
| first content committed | 1415 → 1261 | 7058 → 5298 |
| 20+ rows in the DOM | 1532 → **1373** | 8109 → **7181** |
| op sweep finished | 2192 → 2066 | 10478 → 10711 |
| main thread blocked, total | 3688 → 2935 | 13101 → 15327 |

**The headline is the paint: 12.8× earlier on desktop, 16× on a throttled phone** — and content is
not the price, it arrives slightly EARLIER on both. The one honest cost is at the bottom: staged
mounting adds render passes, so total blocked time on the throttled phone rises ~2.2s. That buys a
screen that shows the app's shape from 0.7s instead of a spinner until 12s.

**Looked at, not just asserted** (`_loadshots.mjs`, CDP screencast, 390×844 4×): at 3s and 5s the
staged build shows the toolbar with its date nav, the panel and its "Routines" header, the Schedule
rail and the Tasks bar, with ONE small loader in the body; the unstaged build shows the full-screen
spinner and nothing else. Frames are painted continuously throughout — no dead window.

**Spinner flash** is prevented by construction rather than by looking: the loader is gated on a
150ms wait (`useStagedContent`), and with staging off the hook reports ready on its FIRST render, so
a surface that never waits renders no waiting state at all. Two tests pin both halves.

**Probe debris swept:** the ~20 loads left 41 `missing-module` occurrences on test grid 2 (the
documented abrupt-disconnect class). `sweepOrphans --grid "test grid 2" --apply` removed 39; the 2
it kept HAVE CHILDREN, which its conservative predicate refuses to touch. poms grid and test grid 1
end exactly as they started (their single errors are the pre-existing ones recorded on 08-05).

---

## Risks

- **Decorating a wait instead of shortening it.** The 7.8s throttled measurement says the drain, not
  rendering, is the cost. Spinners would make that *look* intentional while changing nothing. Task 1
  is the guard.
- **Deferred mounting breaks things that measure rects.** Drag hit-testing (`elementFromPoint`), the
  wrap-notch clip measurement, and sticky headers all read geometry — a panel whose content mounts a
  frame later can be measured while empty. The `content-visibility` work (2026-08-04) hit exactly
  this class.
- **Spinner flash.** See Task 3 Step 3. This is the most likely way to ship something that feels
  worse while measuring better.
