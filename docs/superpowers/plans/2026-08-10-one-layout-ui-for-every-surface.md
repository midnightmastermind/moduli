# One layout UI for every surface that arranges children

**Date:** 2026-08-10
**User:** *"i think we have that for just boards but would it be worth using that layout ui for all
occurances"* → *"with cascade in the right spots"* → *"maybe not cascade nvm"* → *"add in a plan for
the layout ui on all types after the textblocks plan"*

**Decision as it landed:** use the rich layout UI everywhere it means something, and do **NOT**
cascade it. Dropping the cascade removes the one real blocker.

**Supersedes** T1 and T2 of `docs/superpowers/plans/2026-08-10-view-and-layout-audit.md`. T3
(`dragInView` wording) and T4 (the panel push-down contract) still stand.

---

## 0. THE PREMISE WAS WRONG. The conclusion survives, for a different reason.

The task carried this reasoning forward from the audit:

> module.layout is per-MODULE, the cascade per-OCCURRENCE. But the census found only 5 of 4,566
> occurrences carry a layout cascade at all — so essentially nothing depends on per-occurrence
> layout, and per-module is cheap to adopt.

**That conflates two different numbers, and the one that matters was never measured.** How many
occurrences carry a cascade *today* says nothing about how many modules would be **forced to share
an arrangement** if layout moved per-module. Measured (`server/scripts/_layoutcensus2.mjs`,
read-only, all three grids):

| surface | modules that arrange children | backing >1 occurrence | max occurrences on one module |
|---|---|---|---|
| panel | 5 | **0** | 1 |
| container (poms grid) | 205 | **50 (24%)** | 2 |
| container (test grid 1) | 125 | **50 (40%)** | 2 |
| container (test grid 2) | 121 | **0** | 1 |
| page | 57 | **0** | 1 |

So the real number is **10× the one the plan reasoned from** — 100 of 646 child-arranging modules
across the three grids, not 5.

**And then the second measurement rescues it.** What ARE those 50?

```
schedule slot · placed under different parents   48
other        · placed under different parents     2   ← "Due" and "Todo"
```

Every one is **the same conceptual thing placed in two day columns** — the Schedule's shared-slot
architecture. Two placements of `12:00am` want the *same* arrangement; sharing it is correct, and
arguably desirable. **There is no case on any grid of two placements of one container module that
would want different layouts.**

**Conclusion: per-module layout is safe. Do not add a per-occurrence override.** But record why —
not "nothing uses per-occurrence layout", which is false, but "the reuse that exists is
uniform-by-design". If a future feature makes one module render in two genuinely different places,
this decision needs revisiting, and *that* is the trigger to watch for.

---

## 1. The two vocabularies, side by side

**`module.layout`** — a full CSS layout editor (LayoutForm's Layout tab: presets, display, flow,
wrap, gap, columns/rows, width/height modes, alignment, scroll). Its default shape
(`ModulePanel.getDefaultLayout`):

```
name · display · flow · wrap · columns · rows · gapPx · alignItems · alignContent
justify · dense · padding · scrollY · widthMode · fixedWidth · fixedHeight · style{} · lock{}
```

**Consumed by `ModulePanel` and nothing else** (`mergeLayout(module?.layout)`).

**`meta.layoutCascade`** — `SURFACE_SHAPE_KEYS`, 8 keys:

```
mode · columns · childGap · hideChildIds · sortChildrenByField · childMaxHeight
childMinWidth · childMaxWidth
```

Consumed by `PageBoard` (all but `stickyHeaders`) and `ModuleContainer` (`mode === "wrap"` at :653,
`stickyHeaders` at :645).

### What is actually STORED (all three grids, **6 occurrences total**)

| key | stored | consumed by |
|---|---|---|
| `mode` | 5 | PageBoard, ModuleContainer (`"wrap"` only) |
| `childMinWidth` | 3 | PageBoard, ModuleContainer |
| `sortChildrenByField` | 3 | PageBoard |
| `columns` | 2 | PageBoard |
| `hideChildIds` | 2 | PageBoard |
| `childGap` | 2 | PageBoard, ModuleContainer |
| `childMaxWidth` | 2 | PageBoard |
| `dragInView` | 1 | *(view system, not a shape key)* |
| **`childMaxHeight`** | **0** | PageBoard — offered, consumed, **never stored** |
| **`stickyHeaders`** | **0** | ModuleContainer — consumed, never stored, **and not in `SURFACE_SHAPE_KEYS`** |

Two findings fall straight out:

- **`childMaxHeight` is a live control nobody has ever used.** Not dead (PageBoard reads it), just
  unexercised. Keep or cut is a judgement call, not a measurement.
- **`stickyHeaders` is offered, consumed, and NOT a surface-shape key — verified, not assumed.**
  It is in the cascade defaults (`layoutCascade.js:102`), the editor renders a control for it
  (`LayoutCascadeEditor.jsx:241`), and `ModuleContainer:645` reads the resolved value to make its
  own header sticky. But it is **absent from `SURFACE_SHAPE_KEYS`**, so `pickSurfaceShape` strips
  it from a surface's OWN rule and it only pushes DOWN. **Consequence: setting "sticky headers" on
  a container makes its CHILDREN's headers sticky, not its own** — which is almost certainly not
  what the control reads as, and is consistent with it never having been stored on any grid.
  Decide it in T5; it is the 2026-07-31 (5) split (write one slot, read another) in a third
  place.

---

## 2. Scope — only surfaces that ARRANGE CHILDREN

| surface | in? | why |
|---|---|---|
| panels (`ModulePanel`) | ✔ already done | the reference implementation |
| containers (board/table/pool) | ✔ | today: only `mode:"wrap"` + `childMinWidth` + `childGap` |
| board / table / folder pages (`PageBoard`) | ✔ | today: stack/flex-row/grid + a few keys |
| doc pages + doc containers | ✘ | render a TEXTMAP, not a child list |
| canvas pages | ✘ | position by `meta.x`/`meta.y` |
| instances | ✘ | no child list |
| **textblocks** | ✘ | **settled by the textblock plan** — no child list; `ModuleTextblock` is a leaf renderer |

The textblock question is why this plan was sequenced second, and it is now answered: a textblock
arranges nothing, so it is out of scope and stays out.

---

## 3. The work

### T1 — one vocabulary: `PageBoard` and `ModuleContainer` consume `module.layout`

Route both through the same `mergeLayout` path `ModulePanel` uses. The mapping is mostly
mechanical, and the cascade key it replaces is named so nothing is lost silently:

| cascade key | `module.layout` equivalent |
|---|---|
| `mode: "stack"` | `display: "flex"`, `flow: "column"` |
| `mode: "flex-row"` | `display: "flex"`, `flow: "row"`, `wrap: "nowrap"` |
| `mode: "grid"` + `columns` | `display: "grid"` + `columns` |
| `mode: "wrap"` | `display: "flex"`, `wrap: "wrap"` — the thing it was always re-implementing |
| `childGap` | `gapPx` |
| `childMinWidth` / `childMaxWidth` | `widthMode` + `fixedWidth` (needs a min/max pair — see risk 1) |
| `childMaxHeight` | `fixedHeight` (or cut — never stored) |

**`mergeLayout` is currently module-private to `ModulePanel`.** Extract it (with
`getDefaultLayout`) into `helpers/` so three consumers share one merge rather than three copies —
the drift this repo keeps paying for.

### T2 — mount the Layout tab on containers and pages

Extract `LayoutForm`'s Layout tab body into a shared component and mount it in `ContainerForm` and
the page settings surface. **Same shape as the `FieldBindingsEditor` extraction (2026-08-10)**,
including its two lessons: derive from the module rather than seeding `useState` once (or it is
stale after any external write), and commit `{id, layout}` only — never a whole-module spread,
which clobbers other keys.

### T3 — retire the redundant cascade keys, KEEP the two that are genuinely cascade-shaped

- **KEEP `hideChildIds` and `sortChildrenByField`.** These are not CSS. They are per-placement
  decisions about *which* children and in *what order* — the Schedule's own Build op writes both.
- **RETIRE** `mode` / `columns` / `childGap` / `childMinWidth` / `childMaxWidth` / `childMaxHeight`
  **only after re-measuring what still stores them.** Six occurrences store them today; five are
  written by ops, not by hand.
- **STORED VALUES ARE KEPT, NEVER STRIPPED.** Migration `0064` set the Trackers page to
  `mode:"wrap"` + `childMinWidth:132` and it works. A resolver that ignores a stored key is a
  silent visual regression on a live grid.

### T4 — migrate the 8 occurrences that carry a cascade

**Six occurrences across three grids** — small and nameable, which is what makes it safe:

| grid | occurrence | keys |
|---|---|---|
| poms | Trackers (page/board) | `childMinWidth`, `mode` |
| poms | Schedule (page/board) | `mode`, `columns`, `hideChildIds`, `sortChildrenByField` |
| poms | Day Page (page/board) | `mode`, `childGap`, `sortChildrenByField`, `childMinWidth`, `childMaxWidth` |
| test 1 | Schedule (page/board) | same four |
| test 1 | Profile Card (page/doc) | `dragInView` *(view key — not this plan)* |
| test 2 | Trackers (page/board) | `childMinWidth`, `mode` *(written by `0064`)* |

**Two of these are written by OPS, not by a person** (`Schedule: Build Schedule` writes the
Schedule page's override; `0064` wrote Trackers). **So the migration is only half the job — the
BUILDERS have to change too, or the next op fire rewrites the old shape and the migration silently
reverts.** This is the "shipped and does nothing" class the 2026-08-09 date-nav work paid for:
a builder change alone is inert on a seeded grid, and a migration alone is undone by the next op
fire. Both halves, pinned against each other.

### T5 — re-measure, then delete what is still unreachable

After T1–T4, re-run the census. Anything offered by the editor that no surface reads and no
occurrence stores gets deleted. `childMaxHeight` is the leading candidate; decide `stickyHeaders`
here too.

---

## 4. Risks, each with the reason it is a risk

1. **`childMinWidth`/`childMaxWidth` have no clean `module.layout` twin.** `widthMode` +
   `fixedWidth` is a single width, not a min/max pair, and PageBoard genuinely uses both
   (280/360 defaults). Either extend the layout vocabulary with a min/max pair or accept a
   behaviour change on the three occurrences that store them. **Do not paper over this** — it is
   the one place the two vocabularies do not actually overlap.
2. **Per-module layout is shared by the 50 schedule slots.** Correct today (§0), but it means
   editing one slot's layout edits all of them. That is almost certainly what a user expects; it
   should still be *stated* in the UI rather than discovered.
3. **`ModuleContainer` reads `mode === "wrap"` and `stickyHeaders` from the resolved cascade at
   :645/:653.** Both change under T1. The wrap path is what `0064`'s Trackers page depends on, so it
   has live data behind it.
4. **Inline styles beat stylesheets, and this repo has recorded that trap five times.**
   `ModuleContainer` and `ModuleInstance` set layout-affecting properties inline. A layout editor
   whose output loses to an inline style is a control that silently does nothing — the exact class
   T1 exists to remove. **Check the computed style, not the source, before declaring any key wired.**

---

## 5. Verification

- Census re-run before and after (`_layoutcensus2.mjs`), so "what is stored" is measured rather than
  assumed at both ends.
- A/B every behavioural claim: a container set to wrap must still wrap; the Schedule page must still
  render day columns side by side, sorted by date, with slots hidden.
- **Browser verification is required.** Layout is CSS, and this repo's record is unambiguous that a
  layout claim which has not been looked at is not verified.
- Builder + migration pinned against each other (T4), or the next op fire reverts the migration.

## 6. Non-goals

- No cascade for `module.layout` — the user's explicit call.
- No per-occurrence layout override (§0 says it is not needed; the trigger to revisit is named).
- Doc, canvas, instance and **textblock** surfaces are out of scope and stay out.
- Not the view system — `dragInView` / `meta.viewMode` is audit T3, still open.
