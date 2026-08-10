# View system + layout settings — audit and plan

**User, 2026-08-10:** *"make sure our view system is working. and the layout settings. board
especially cause we have a bunch of css and layout options."*

Measured first, per the standing rule. **The measurement changed the shape of the work**, so read
the findings before the plan.

---

## THE HEADLINE: nothing is broken. Almost nothing is USED.

Across **4,566 occurrences on three grids**, exactly **five** carry a layout cascade — and every one
of them is a PAGE. Zero containers, zero panels, zero instances. One occurrence on one grid carries
a `meta.viewMode`.

```
                        occurrences   meta.layoutCascade   meta.layoutCascadeOverride   meta.viewMode
test grid 1                859               0                       2                       1
poms grid                 2509               1                       1                       0
test grid 2               1198               1                       0                       0
grid.meta.layoutCascadeDefaults : (none) on all three
```

So the premise "we have a bunch of layout options" is about what the EDITOR OFFERS. The question
worth answering is therefore **not** "is the cascade computing correctly" — it demonstrably is, on
the handful of pages that use it — but **"which of the offered controls can the surface they are
offered on actually read?"** That is the `Split by`-on-a-pie class the graph audit found on
2026-08-10, and it is what the rest of this document measures.

**The 2026-07-31 (5) sharp edge is NOT recurring.** Both slots are in use and each is read by the
layer that wrote it: poms grid has one page storing to `layoutCascade` (push-down, written by the
Build Schedule op) and one to `layoutCascadeOverride` (leaf, written by the header menu). No surface
is storing to a slot its own renderer never looks at.

---

## FINDING 1 — `mode` is ONE key with TWO disjoint vocabularies

Only two surfaces render from the cascade at all:

| surface | reads |
|---|---|
| `PageBoard` (role `page`) | `mode` ∈ {stack, flex-row, grid}, `columns` (grid only), `childGap`, `hideChildIds`, `sortChildrenByField`, `childMaxHeight`, `childMinWidth` + `childMaxWidth` (flex-row only) |
| `ModuleContainer` (role `container`) | `mode === "wrap"` **only**, `childMinWidth`, `childGap`, `stickyHeaders` |

`ModuleContainer` never checks `stack`, `flex-row` or `grid`. `PageBoard` never checks `wrap`.
The editor offers all four values in **one** "Arrangement" control, on every surface.

Consequences, both real today:

- **On a container, `Stack` / `Columns` / `Grid` are dead**, along with `columns`,
  `hideChildIds`, `sortChildrenByField`, `childMaxHeight`, `childMaxWidth`. Five keys and three of
  four `mode` values do nothing on the surface that offers them.
- **On a page, `Wrap (squares)` silently ALSO means "stack".** `PageBoard` does not understand
  `wrap`, so it falls through to its stack default, while the value cascades DOWN and makes the
  page's containers wrap their own children. That is exactly what migration `0064` relies on for the
  Trackers page, and it works — but it is one control driving two unrelated decisions at two levels,
  and the label says only one of them.

**RETRACTED IN PART — see T2.** Wrapping children already has a full CSS UI (`module.layout`),
which only panels consume; the cascade's `wrap` is a thin re-implementation of it. The per-surface
split below is still accurate, but the remedy is not what this section first assumed.

**This is not a bug report against the cascade resolver.** `pickSurfaceShape` and
`resolveLayoutCascade` do precisely what they say. The defect is that the EDITOR does not know which
keys the surface it is editing can read.

## FINDING 2 — a PANEL's layout cascade is push-down ONLY

`ModulePanel` does not consume the cascade at all (the only consumers are `ModuleContainer`,
`PageBoard`, `ViewModeSection`, `RepresentationView` and `ModulePage`). A panel arranges its own
children from `module.layout`, not from a cascade rule. So every shape key set in `LayoutForm`'s
cascade section affects only DESCENDANTS — which is defensible, and is invisible in the UI.

## FINDING 3 — the view system has TWO sources of truth, and only PAGES read the newer one

This is the important one, and it is why "is the view system working" has a nuanced answer.

```
what RENDERS            ModuleContainer  →  getEffectiveViewMode(occ)   → occ.meta.viewMode
                        ModuleInstance   →  getEffectiveViewMode(occ)   → occ.meta.viewMode
                        ModulePage       →  resolveEffectiveViewModeFromCascade(...)  ← the CASCADE
                        PreviewNode      →  its own viewMode prop

what the SWITCHER offers  ViewModeSection → reads the CASCADE (navOptions / navAllowChange)
                          ...but WRITES occ.meta.viewMode

what a DROP stamps        dropHandlers    → resolveDropInViewMode(...)  ← the CASCADE
```

So the cascade governs **which buttons you are offered** and **what a drop stamps**, while
`meta.viewMode` governs **what a mounted container or instance actually renders**. A page is the
only role where the cascade also drives the render.

**The user-visible consequence:** setting `dragInView: "representation"` on a page does NOT convert
the containers already sitting in it. It only affects what the next DROP stamps. The key is named
`dragInView`, so that is arguably the intended contract — but the docket calls these "push-down
rules", the editor presents them as such, and a page behaves differently from everything else. At
least one of those three should change.

All four modes ARE implemented — `representation` branches in Container / Instance / Page,
`actual-converted` in Page, `preview` in PreviewNode, `actual` is the unbranched default. Nothing is
half-built. The question is only which layer decides.

---

## PLAN

Ordered so each step's finding can retire the next. **No step is a rewrite of the cascade** — the
resolver is sound and 34 tests cover it.

### T1 — the editor offers only what the surface can read *(the whole "dead controls" problem)*

Give `SURFACE_SHAPE_KEYS` a per-role table — which keys, and for `mode` which VALUES, each role
consumes — and have `LayoutCascadeEditor` render from it. `LayoutCascadeSection` already knows the
role and kind it is editing, so nothing new has to be threaded.

- A key a surface cannot read is **not rendered**, not merely disabled: a disabled control still
  says the option exists.
- **Stored values are KEPT, never stripped.** A page may legitimately carry `wrap` for its
  descendants (0064 does), and the graph audit's own rule applies — switching a surface's kind and
  back must not destroy configuration.
- The table is the ONE source; a test asserts every key in it is actually read by the named surface,
  so it cannot drift the way the graph's encodings did.

**A/B:** deleting the per-role filter must fail a test that asserts `columns` is absent from a
container's editor.

### T2 — RETRACTED. There are TWO layout systems and the good one is panel-only

**The user corrected this, and they are right:** *"we have wrap for this. we have a whole css ui for
the children of the board. it has a css wrap rule."* My original T2 proposed relabelling or
splitting the cascade's `wrap` — both wrong, because wrapping children **already has a proper UI**.

`module.layout` is a full CSS layout editor: **presets** (Grid Cards, …) plus
`display` (grid/flex/columns), `flow`, **`wrap`**, `gapPx`/`gapPreset`, `columns`/`rows`,
`widthMode` + `minWidthPx`/`maxWidthPx`, `heightMode` + min/max, `alignItems`/`alignContent`/
`justify`, `scrollX`/`scrollY`/`scrollType`. It lives in `LayoutForm`'s Layout tab.

**It is consumed by `ModulePanel` and NOTHING ELSE** (`mergeLayout(module?.layout)`). `PageBoard`
and `ModuleContainer` read the layout CASCADE instead, which offers a much thinner and partly
overlapping vocabulary: `mode` / `columns` / `childGap` / `childMinWidth` / `childMaxWidth` /
`childMaxHeight`.

So the two systems answer the SAME question — how does this surface arrange its children — with
different keys, different UIs, and different consumers:

```
module.layout       rich CSS editor, presets, real flex/grid vocabulary   →  PANELS only
meta.layoutCascade  mode/columns/childGap/childMin|MaxWidth/childMaxHeight →  PAGES + CONTAINERS
```

`mode: "wrap"` on the cascade is therefore a thin re-implementation of a `flex-wrap` the other
system already expresses properly — which is why it needed `childMinWidth` doubling as a square
side, and why it means two different things on the two surfaces.

**The real question, and it needs your call before any code:** should `PageBoard` and
`ModuleContainer` consume `module.layout` — the CSS UI you already built — instead of the cascade's
thin `mode`? That would give a board page and a container the presets, wrap, gap, align and scroll
controls panels have had all along, and would make the cascade's shape keys redundant rather than
merely confusing.

Weigh against: the cascade's whole point is that it CASCADES (a page sets it once, descendants
follow), and `module.layout` is per-MODULE, so two occurrences of one container module could not
be arranged differently. A hybrid — `module.layout` as the vocabulary, the cascade as the delivery
mechanism — is probably the answer, and is a bigger piece of work than this audit assumed.

**T1 is unaffected and still worth doing** (the editor should not offer keys the surface cannot
read), but it should be re-scoped once T2 is decided: if the surfaces move to `module.layout`, most
of the cascade's shape keys go away rather than getting a per-role filter.

### T2-OLD (superseded, kept for the reasoning) — say what `wrap` on a page means

Two honest options; this needs your call, not a guess:

- **(a) Keep one key, fix the label.** On a page, "Wrap (squares)" reads as *"stack my containers;
  wrap what is inside them"*. One line of copy, zero behaviour change, `0064` unaffected.
- **(b) Split into `mode` (this surface) and `childMode` (my children).** Cleaner, and makes a page
  able to say "columns, and wrap inside each" — which is not currently expressible. Costs a
  migration for the one occurrence that stores `wrap` today, plus the seed half.

I lean (a) now and (b) only if you ever want that combination, because (b) buys expressiveness
nothing currently asks for.

### T3 — decide what a page's `dragInView` means for what is ALREADY there

Finding 3, put to you as a product question:

- **(a) Leave it.** `dragInView` means what it says; the switcher is how you convert something that
  already exists. Then FIX THE PRESENTATION — the editor should say "new items land as…", because
  "push-down rule" is what makes people expect retroactive effect.
- **(b) Make containers and instances read the cascade** the way pages do, with `meta.viewMode` as
  the per-occurrence override on top. Consistent, and the more powerful model — but it changes what
  renders on every board the moment a rule is set, so it needs the A/B run against live data before
  it ships.

**Do not implement either until it is chosen.** This is the one place where guessing wrong is
expensive.

### T4 — panels: state the push-down-only contract

Smallest item. `LayoutForm`'s cascade section gets a line saying these rules apply to what is
INSIDE the panel, not to the panel. No behaviour change.

### T5 — after T1-T4, re-measure and delete what is still unreachable

Re-run `_layoutcensus.mjs`. Anything still offered and unread is a genuine dead control and should
be removed rather than documented.

---

## What was NOT done, and why

- **No browser verification.** Every finding here is from the code's own consumers and from live
  data through the real resolvers. Whether the Trackers page LOOKS right with `wrap` is a
  screenshot question, and a chart-style "it renders but wrongly" failure is exactly what this
  repo's history says a canvas/CSS surface produces.
- **No changes shipped.** The user asked for a plan first, and T2/T3 are decisions rather than work.
- **The census script is `server/_layoutcensus.mjs`** (gitignored `_*.mjs`). Re-run it after any
  change; its dead-control heuristic knows only what PageBoard reads, so it flags the Trackers page
  — read Finding 1 before believing that line.
