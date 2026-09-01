# Render audit — nothing should re-render that does not need to

User, 2026-09-01: *"we should do a full audit on state after this, a full plan
to make sure nothing is rerendering that doesnt need to. i feel like we have
alot of things on the site thats rerendering when its doesnt need to."*

They are right, and it is now measurable rather than a feeling. Four separate
defects of this exact class have been found in two days, each by measurement,
each a component subscribing to something it never reads:

| found | component | subscribed to | cost, measured |
|---|---|---|---|
| 08-31 | `FieldRenderer` | grid-wide occurrence COUNT | 2,956 of 3,065 field renders per load |
| 08-31 | `ModuleInstance` | the whole operations map | 183 of 604 instance renders per load |
| 09-01 | `ModuleContainer` | drag hover state | 2,004-3,383 container renders per drag |
| 09-01 | `ModuleInstance` | drag hover state | 225-248 instance renders per drag |

None was found by reading code. Three of my own hypotheses in the same period
were wrong and were killed by the probe. **The method is the plan.**

## The instrument already exists and is now reachable

`useRenderAttribution` has answered *"which subscribed value changed identity"*
since the frame-1 work, wired into field / container / instance. It was
reachable only from inside DragProvider's drop stopwatch until 2026-09-01, when
`window.__renderAttrs()` / `__renderAttrDiff(prev)` were exposed. It costs
nothing unless `window.__RENDER_ATTR = true`.

Read it as: `s_*` = a subscribed selector changed identity; `p_*` = a prop
changed; `(none) @Label` = neither — a local state or an uncaptured
subscription.

## What is already known to be left

From the last idle-load capture, AFTER the two 08-31 fixes:

```
field     1,663   s_occSetKey 1,100 · s_modulesById 464 · p_occurrence 99
instance    421   s_instancesById+s_modulesById 183 · s_ancestorChain 43
container   652   s_instancesById+s_leafModulesById+s_modulesById 105 · s_ancestorChain 50
```

**`s_modulesById` was the thread to pull** (done — see Executed below). It
appears in every bucket, and
`UPDATE_ITEM_FIELD` auto-attaches a missing `fieldBindings` entry by calling
`updateModule` — which would change that map's identity mid-sweep, re-rendering
everything that subscribes to it. That is a hypothesis; it must be measured,
not assumed.

## Method — in this order, one at a time

1. **Baseline.** Idle load with `__RENDER_ATTR`, wait for quiet, record the
   buckets. `server/scripts/_idlefires.mjs` already does this end to end.
2. **Take the largest single cause**, not the largest component. A cause is a
   subscription; a component is a symptom.
3. **Ask what actually reads it.** Every fix so far has been the same shape:
   the value is read for one narrow purpose, and the subscription is wider than
   that purpose. The hook must still be called — what becomes conditional is
   the value SELECTED.
4. **Ship one change**, re-run the identical probe, and record before/after.
   Two of yesterday's fixes were correct and moved nothing; only the A/B said
   so.
5. **Repeat.** Stop when the remaining causes are work the component genuinely
   needs.

## Rules this has already cost us

- **A load measured right after a deploy is measuring the 215s cold Atlas
  read, not the code.** Two A/B readings were void this way; both reported
  `renders=none` and zero sweeps, *which reads exactly like a fix that worked*.
  Wait for `prewarm done and PINNED` AFTER the latest restart — the previous
  deploy's line is still in the tail.
- **Never gate a subscription by calling the hook conditionally.** Select a
  constant instead; a module-level `EMPTY` for objects, or a literal for
  scalars. A fresh `{}` in the selector re-renders on every store read, which
  is worse than what it replaced.
- **Opt in where the value is a public contract.** `edgeAsAttribute` is
  opt-in because `blocks/` reads `closestEdge` for its own indicator.
- **A control that cannot move proves nothing.** `Tags` staying at 404 renders
  while `Completed` fell 572 → 143 is what showed the field fix narrowed the
  right thing rather than breaking option resolution.

## Not in scope, and why

**Batching the store writes.** It was the obvious candidate and the measurement
retired it: 208 effects apply in 13-16 slices and React batches within a task,
so the dispatches already collapse. The cost is how much re-renders inside each
commit, which is what this audit is about.

**Virtualising with a package.** `renderWindow` and `content-visibility`
already do this, and the repo has measured a package version of a smaller
problem at 3x WORSE than the hand-rolled one. Extending `renderWindow`'s reach
is a separate, bigger piece — it interacts with drop-target registration,
ProseMirror node views and multi-parented rows.

## Executed 2026-09-01 — results

Idle load, `__RENDER_ATTR`, same probe either side of every change:

| | before | after | |
|---|---|---|---|
| field | 1,759 | 865 | **-51%** |
| instance | 452 | 263 | **-42%** |
| container | 652 | 599 | -8% |

Over the two days, from the first measurement: **field 3,065 → 865 (-72%),
instance 604 → 263 (-56%)**.

Four changes, each a subscription wider than what read it:

1. **`FieldRenderer` / `modulesById`** — read only by `resolveOptions` (which
   runs for option-resolving fields) and by `planPrefill` inside a COMMIT
   CALLBACK. Gated the first, moved the second to `getModMap`. **-492 field
   renders**, and `@Completed` / `@Duration` left the top of the bucket
   entirely — only genuinely resolving fields remain.
2. **`ModuleInstance` / `instancesById`** — selected and **read by nothing**.
   Deleted. **Moved the number by 3**, see below.
3. **`ModuleInstance` / `modulesById`** — read in one render call and one drop
   callback, where the same call already read occurrences non-reactively.
   Now a compute-time read. **-196 instance renders.**
4. **`FieldRenderer` / static option pools** — `wantsResolve` asked WHETHER a
   field resolves options, never WHERE from. Of the resolver's three modes only
   `find` reads the grid; `manual` and `range` are computed from the field's
   own config. **`Tags` — 49 hard-coded values — was the single biggest payer
   in the whole bucket at 408 renders**, and 17 of 66 resolving fields are
   static like it. **-382 field renders**, and half the drop cost, since a drop
   creates an occurrence and the count moves.

### The lesson that cost a commit

**A compound attribution key lists every input that changed, not the cause.**
`s_instancesById+s_modulesById` at 194 renders looked like two names for one
problem; deleting `instancesById` — a subscription with genuinely no reader —
moved the count from 456 to 453, because `modulesById` was still firing on the
same commits. Only fixing the second half moved it. *Read a compound key as a
conjunction, and expect no movement until every term is gone.*

## What is left, and why it is a different kind of change

```
field     865   s_occSetKey 567 · s_modulesById+s_occSetKey 189
container 599   s_instancesById+s_leafModulesById+s_modulesById 105 · s_ancestorChain 50
instance  263   s_ancestorChain 54
```

The remaining field renders are the **49 genuine `find`-mode fields**, and they
are the same thing as the drop's `dropRenders=707(field:615)`. Narrowing them
is no longer a subscription gate — every one of them really does read the grid.
It needs a **pool-scoped key**: a field whose predicate selects "instances
tagged `meal`" should re-resolve when THAT set changes, not when any occurrence
anywhere is created. Cheap to maintain (a per-tag count index) and a genuine
design change rather than a narrowing, so it wants its own pass.

The container bucket is now mostly UNATTRIBUTED — its named causes sum to ~200
of 599 — so the next honest step there is more attribution, not more fixes.
`s_instancesById+s_leafModulesById+s_modulesById` is a THREE-term compound and,
per the lesson above, moves nothing until all three are gone.

## Open, needing one capture each

- `dropRenders=` — shipped 2026-09-01, uncaptured. Splits the 1,842-5,302ms
  drop paint into the write's fan-out vs painting a 20,000-node document.
- Whether the drag numbers improve now the hover no longer re-renders a
  subtree.
