# Textblocks as their own occurrence type — measurement and plan

**User, 2026-08-10:** *"we should make a plan to make textblocks its own occurance type instead of a
module instance."*

Measured first. **Two of the plan's starting assumptions turned out to be wrong**, and the
measurement splits the work in half — read the findings before the plan.

---

## FINDING 1 — a textblock is already TWO populations, and only one uses the instance shell

```
poms grid    1094 textblock modules   kinds: inline 721 · doc 373
             1040 textblock occurrences
             homes: page/doc 234 · container/doc 85 · UNPARENTED 721

test grid 2   249 textblock modules   kinds: doc 240 · inline 9
              homes: page/doc 233 · container/doc 7 · UNPARENTED 9
```

The **721 unparented ≈ the 721 inline**. Those are the prose link chips the importer mints
(`role:"textblock" kind:"inline"` carrying `meta.link` — 726 occurrences carry meta, which is that
same set). They have no parent in `occurrences[]` because they are referenced from a **textmap**
node and rendered by `docs/pills/InstanceTextblockInlineNode.jsx`. **They never touch
`ModuleInstance` at all.**

So on poms grid **66% of textblocks already have their own renderer and are already not module
instances.** The ask is really about the OTHER population — the ~373 block textblocks.

**Textblocks are the largest role on the grid** (1094 vs 898 instances), which is why this is worth
doing carefully; but the surface actually in scope is a third of that number.

## FINDING 2 — every parented textblock lives in a DOC. None is on a board or canvas.

`page/doc` + `container/doc` accounts for **every** parented textblock on both grids. Zero live
under a board container, a table, or a canvas page.

That matters because the plan's stated reason for keeping the instance shell was that
`PageCanvas`/`PageBoard` mount leaves through it (PageCanvas even carries a comment saying a
textblock-role leaf comes out blank without it). **That path is real but is exercised by no textblock
today.** It is a capability to preserve, not a constraint that shapes the design.

## FINDING 3 — the shell's DATA machinery is nearly unused; its INTERACTION chrome is what matters

Of 1094 textblock modules / 1040 occurrences on poms grid:

```
bind at least one field      17   (1.5%)
carry a field value          23
have an ownStyle              0
have a linkedGroupId          0
```

So field pills, per-placement style and copy-link — a large part of what `ModuleInstance` exists to
lay out — are essentially dead weight for a textblock. What a textblock genuinely uses from the
shell is the **interaction chrome**: the drag handle + `dragSystem` registration, the radial menu,
the context menu, and multi-select/clipboard participation.

**This is the split the new type should be cut along** — not "textblock vs instance", but
"interaction chrome (shared) vs field/media layout (instance-only)".

**Caveat the numbers carry:** field bindings on textblocks are rare but NOT zero (17), and as of
2026-08-10 `grid.meta.universalFieldIds` gives *every* occurrence Tags + Date, with a textblock's
pills rendering top-right. So a new type must still be able to render fields — it cannot drop that
seam, only stop paying for the full instance layout.

## FINDING 4 — `ModuleRouter` no longer exists

The task's option (b), "its own ROUTE in ModuleRouter", is moot: `modules/ModuleRouter.jsx` was
deleted in the 2026-07-14 dead-code audit as superseded. Routing today is
`ModuleContainer` → `<ModuleInstance renderBody={TextblockCard}>`. There is no router to add a case
to; there are two call sites (`ModuleContainer.jsx:752` and `:1623`) plus `PageCanvas`/`PageBoard`.

---

## RECOMMENDATION

**Option (a) — a real `ModuleTextblock` component — but built by EXTRACTING the shared chrome, not
by duplicating it.**

Rejected alternatives, with reasons:

- **(b) a router case** — there is no router (Finding 4).
- **(c) a distinct `kind` inside the current shell** — this is what exists today, and it is the thing
  the user is asking to move away from. It also keeps every textblock paying for the instance
  layout's memos and branches.
- **A from-scratch `ModuleTextblock`** — would duplicate the drag registration, radial menu, context
  menu and selection wiring. This repo has paid four times over for exactly that
  (`FieldBindingsEditor`, `notifyIntake`, `MenuSurface`, `stampCloneAncestors`); a second copy of
  the drag/selection wiring is the most expensive possible version of this mistake, because drag is
  the part with no test coverage that only breaks on a real device.

### The shape

Extract from `ModuleInstance` an `OccurrenceShell` carrying ONLY what both need: the
`useDragDrop` registration + handle, `RadialMenu`, the context menu, selection/clipboard, and the
`data-occ-id` / `.instance-wrap` markers that drag hit-testing and `jumpToOccurrence` depend on.

```
OccurrenceShell        drag handle · radial · context menu · selection · occ markers
  ├─ ModuleInstance    + field pills, media block, table-cell override, meta.disabled
  └─ ModuleTextblock   + the editor body, provisional lifecycle, meta.link, universal field pills
```

`ModuleInstance` keeps its own file and its hot-path memos; it just renders the shell around its
existing body. `TextblockCard` becomes `ModuleTextblock`'s body rather than a `renderBody` callback
passed into a foreign component.

### Steps

**T1 — extract `OccurrenceShell`, change nothing else.** `ModuleInstance` renders through it and
must come out byte-identical. **This step ships alone and is verified by render-count A/B**, because
`ModuleInstance` is the hottest path in the app (2026-08-07 measured 452 instance renders on one
date navigation). Use the existing `__RENDER_ATTR` probe; a regression here is a whole-app
regression.

**T2 — `ModuleTextblock`, wired at the two `ModuleContainer` call sites.** Behaviour must be
identical: same chrome, same editor, same provisional lifecycle.

**THE PROPERTY THAT MUST NOT BE LOST, and it is the sharpest thing here:** a provisional textblock
is **NEVER emitted while empty** (`helpers/provisionalTextblock`). It lives in local state until it
earns a row, because deleting a row the server was only just told about is the
create-is-queued/delete-is-not asymmetry behind the recurring `dangling-child-ref` class. Any new
type keeps that or it reintroduces a bug this repo has chased five times. Pin it with a test that
asserts **zero emits** while provisional — the same assertion the 2026-08-05 work used.

**T3 — `PageCanvas` / `PageBoard` route textblock leaves to the new component.** Today they mount
them through the instance shell precisely because a leaf renders blank otherwise. No textblock is
there today (Finding 2), so this is capability-preservation — and therefore the step that most needs
a deliberate test, since no live data would catch a break.

**T4 — leave the INLINE population alone.** It already has its own renderer and its own node type.
Folding it into `ModuleTextblock` would mean rendering a chip through a card shell, which is a
different job. Say so explicitly in the code so the next person does not "finish" the unification.

**T5 — re-measure.** Render counts on a date navigation, before and after, and the drop/paint probe.
If a textblock no longer pays for the instance layout, both should improve; if they do not, say so
plainly rather than claiming a win.

### What this does NOT change

The DATA model. `role: "textblock"` is already first-class — every textblock module already carries
it, `deriveRoleArrays` already buckets it, and `roleByModuleId` already resolves it. **This is a
rendering change, not a schema change, and it needs no migration.** Worth stating up front, because
"its own occurrence type" sounds like a data change and is not one.

---

## Honest limits

- **No browser verification is possible from the plan stage**, and this is a surface where that
  matters more than usual: drag handles, radial menus and selection are exactly the things that pass
  every unit test and fail on a real device (2026-07-06's tablet work, the `setPointerCapture`
  defect on the graph).
- **The 17 textblocks that bind a field** are the discriminating fixtures for T2. Do not test only
  the empty case.
- **Nothing here is sequenced against the layout-UI plan (task #8)** except that #8 waits on this
  one, because whether a textblock keeps a child-arranging surface is decided here.
