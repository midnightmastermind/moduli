# One layout UI for every surface that arranges children

**User, 2026-08-10:** *"i think we have that for just boards but would it be worth using that layout
ui for all occurances"* → *"with cascade in the right spots"* → *"maybe not cascade nvm"*.

Follows the view/layout audit (`2026-08-10-view-and-layout-audit.md`), whose T1/T2 this supersedes.
Measured first; **the measurement retires the one objection I raised against this.**

---

## THE PROBLEM: two systems answer the same question

```
module.layout       rich CSS editor — presets, display(grid|flex|columns), flow, WRAP,
                    gapPx/gapPreset, columns/rows, widthMode+min/max, heightMode+min/max,
                    alignItems/alignContent/justify, scrollX/scrollY/scrollType
                    →  consumed by ModulePanel ONLY

meta.layoutCascade  mode(stack|flex-row|grid|wrap) · columns · childGap · childMinWidth ·
                    childMaxWidth · childMaxHeight · hideChildIds · sortChildrenByField
                    →  consumed by PageBoard + ModuleContainer
```

Both answer *"how does this surface arrange its children"*, with different keys, different editors
and different consumers. The cascade's `mode: "wrap"` is a thin re-implementation of a `flex-wrap`
the other system already expresses properly — which is why it needed `childMinWidth` doubling as a
square's side, and why `mode` means disjoint things on the two surfaces (`ModuleContainer` reads
only `wrap`; `PageBoard` reads only `stack`/`flex-row`/`grid`).

## THE OBJECTION I RAISED, AND WHY IT DOES NOT SURVIVE MEASUREMENT

`module.layout` is per-MODULE; the cascade is per-OCCURRENCE. So adopting `module.layout` means N
placements of one module share a layout. I flagged that as the thing to check first. Measured:

```
poms grid     container modules 416   with >1 occurrence: 50    (1 occ: 283, 0 occ: 83)
              page modules       71   with >1 occurrence:  0
              panel modules       5   with >1 occurrence:  0
test grid 2   container modules 176   with >1 occurrence:  0
              page / panel                with >1 occurrence:  0
modules carrying module.layout: 5 on each grid — all panels
```

**Pages and panels carry no risk at all** — every module has exactly one occurrence on both grids.

**The only multi-placement containers are the Schedule's shared slots** — "Due" ×4, "Todo" ×4,
"12:00am" ×4, "12:30am" ×4 … i.e. the 48 slots + heads multi-parented across the four day columns,
which is the documented shared-slot pattern. **Those want the same layout by definition**: they are
the same time slot on different days. Per-module is not a compromise for them, it is correct.

So the per-occurrence capability the cascade provides is, in practice, **used by nothing** — which
matches the audit's other finding that only 5 of 4,566 occurrences carry a cascade at all.

**Conclusion: dropping the cascade for LAYOUT is safe, and the user's instinct to skip it is right.**

## Scope — only surfaces that arrange CHILDREN

```
✔ containers (ModuleContainer)   today: mode==="wrap" + childMinWidth + childGap only
✔ board / table pages (PageBoard) today: stack|flex-row|grid + a few keys
✔ panels (ModulePanel)            already done — the reference implementation
✘ doc pages / doc containers      render a TEXTMAP, not a child list
✘ canvas pages                    position children by meta.x/y
✘ instances, artifacts, textblocks no child list to arrange
```

The last line is settled by the textblock plan (`2026-08-10-textblock-as-its-own-type.md`), which is
why this waited on it: a textblock arranges nothing, so it is out of scope either way.

---

## PLAN

**T1 — extract the Layout editor from `LayoutForm`.** Its Layout tab body becomes
`ui/LayoutEditor.jsx`, taking `{ value, onChange }`. `LayoutForm` renders it and must come out
unchanged. Same extraction shape as `FieldBindingsEditor` (2026-08-10): the copy that already works
moves, nothing is rewritten.

**T2 — `PageBoard` and `ModuleContainer` consume `module.layout`.** Through the same `mergeLayout`
path `ModulePanel` uses, so there is one vocabulary and one set of defaults. **Both keep reading the
cascade for `hideChildIds` and `sortChildrenByField`** — those are genuinely cascade-shaped (they
name *which children*, not *how to arrange them*) and have no CSS equivalent. Everything else comes
from `module.layout`.

**T3 — mount `LayoutEditor` on `ContainerForm` and the page settings surface.** `ContainerForm` gets
a Layout tab; a page has no settings form, so it takes a `LayoutSection` in its HeaderDropdown —
exactly the split `FieldBindingsEditor` / `FieldBindingsSection` already uses.

**T4 — migrate the 5 occurrences that carry a cascade**, including the Trackers page that `0064` set
to `mode:"wrap"` + `childMinWidth:132` → its `module.layout` equivalent (display flex, wrap,
minWidthPx 132). **Dry run reported against a named expectation**, and the seed half so a reseeded
grid and a migrated grid cannot drift — `0064` already calls its own migration from the seed, so
follow that.

**T5 — retire the dead shape keys.** After T2, `mode`/`columns`/`childGap`/`childMin|MaxWidth`/
`childMaxHeight` are read by nobody. Remove them from `SURFACE_SHAPE_KEYS` and from the cascade
editor — **but only after re-running the census to confirm nothing still stores them.** A key nobody
reads is a dead control; a key something still stores is a migration.

**T6 — re-measure and look at it.** The Trackers page is the one surface visibly using `wrap` today,
so it is the A/B: it must look identical before and after. **A screenshot, not an assertion** — this
is CSS, and this repo's record on canvas/CSS surfaces (the blanked sunburst ring, the oscillating
wrap group) is that they pass every test and fail on screen.

## What this does NOT do

- **It does not touch the VIEW-mode half of the cascade** (`dragInView` / `navOptions` /
  `navAllowChange` / `representationFieldIds` / `locked`). Those are a different question — *how does
  a child render* rather than *where is it placed* — and the audit's T3 (relabel `dragInView` as
  "new items land as…") still stands independently.
- **It does not make layout cascade.** That is the user's explicit call. A page will no longer be
  able to set an arrangement its containers inherit — which today is what `0064` relies on for
  Trackers, hence T4 converting that one case to an explicit per-container layout.

## Honest risks

- **`ModuleContainer` is a hot path.** T2 adds a `mergeLayout` call per container; memoise on
  `module.layout` identity and A/B render counts with `__RENDER_ATTR`, as the 2026-08-07 work did.
- **`module.layout`'s defaults were tuned for PANELS.** A container defaulting to a panel's grid
  could change the look of 416 containers at once. T2 must resolve "no stored layout" to *today's*
  container rendering, not to `mergeLayout`'s panel default — that is the single most likely way
  this ships a silent, grid-wide visual regression.
