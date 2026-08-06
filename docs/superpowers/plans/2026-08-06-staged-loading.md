# Staged loading — grid shape first, per-panel spinners, one circular loader

> **STATUS: PLANNED, NOT STARTED.** Task 1 is a MEASUREMENT and it must run before any of the
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

## Task 4: verify it did not make things worse

- [ ] **Step 1:** re-run Task 1's instrument and compare the same four numbers. Staged mounting adds
      frames; if time-to-usable regresses, the perceived win has to be worth a measured loss and
      that has to be said out loud.
- [ ] **Step 2:** a screenshot at 390px mid-load. Every load-path defect on this surface has been
      caught by looking, not by asserting.
- [ ] **Step 3:** sweep any probe debris and re-check `checkGrid --all` before calling it done.

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
