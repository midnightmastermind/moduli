# Instance bodies — design

_2026-08-16. Status: approved, ready for an implementation plan._

> "i want to play around with the idea of having instances have bodies again. a button that opens
> up a little doc. typing here would create a textblock here too so same rules as doc. it just is
> mini" — user, 2026-08-16

## The finding that shapes this spec: most of it already exists

Measured before designing anything, and it retired three quarters of the work.

`ModuleInstance` already holds `showDoc` / `toggleDoc` (`ModuleInstance.jsx:1010`, `:1211`), already
surfaces a **"Toggle doc"** item in the instance radial menu (`RadialMenu.jsx:339`), and already
renders a real `DocContent` under the row (`:1263`) with a tinted left border derived from the
container's colour.

Two consequences nobody has to build:

- **Typing already mints textblocks under the same rules as a doc page.** `DocContent` gates its
  minting on `onExitBlock` — `onCaretMintTextblock={onExitBlock ? null : handleCaretMintTextblock}`
  (`DocContent.jsx:392`), same for `onAutoCreateTextblock` and `enableInsertGaps`. `ModuleInstance`
  passes **no** `onExitBlock`, so the instance body is treated as a PRIMARY doc editor: click an
  empty line → provisional textblock, abandon it empty → it disappears, and the never-emitted
  provisional lifecycle applies unchanged.
- **Copy-linked siblings already share one body.** `update_occurrence`'s linked-group fan-out
  copies `textmap` as well as `fields` (`server/socketHandlers/occurrences.js`, the
  `if (textmap !== undefined) patch.textmap = textmap;` line inside the `linkedGroupId` loop). So
  the requested "copy-linked siblings share the same body" is existing server behaviour.

**Therefore this is a surfacing job, not a subsystem.** The spec below is deliberately small, and
anything that would duplicate the above is out of scope.

## Decisions (user, 2026-08-16)

| Question | Decision |
| --- | --- |
| How is it opened? | A **button at the bottom-right of the instance row**, revealed on hover. The radial-menu item **stays** — "though you can open it there too". |
| Whose body is it? | **Per placement**, with **copy-linked siblings sharing** — which is exactly what the occurrence-level `textmap` + the linked-group fan-out already do. |
| Who gets the button? | **Every instance**, revealed on row hover. |
| Does it persist? | **No** — ephemeral local state, as today. |
| How many at once? | **Exactly one, app-wide.** |
| Does an outside click close it? | **No** — "i want to be able to drag into it though so let it be open off click." |
| How "mini"? | The chromeless treatment it already has (no toolbar, thin left border). Not a narrower box. |

## What gets built

### 1. The body button

A button in the bottom-right of `.instance-wrap`, hidden at rest and revealed on row hover — the
same affordance pattern the drag handle uses (`.module-drag-handle`, opacity-on-hover), so it costs
no layout and cannot push content.

**It calls the same `toggleDoc` the radial item calls.** One handler, two entry points. Two
handlers is how the two surfaces drift.

### 2. Exclusivity — one body open at a time

`helpers/bodyOpen.js` (new). A module-level exclusive claim: opening a body publishes the
occurrence id; every mounted instance subscribes and closes itself when the published id is not its
own.

**Why not per-component state:** the component that ought to close is precisely the one no longer
receiving events, so it can never know. This is the same shape as the stuck doc-insert-gap solved on
2026-08-01 (9), whose own entry records the reasoning — *"Every doc editor holds a SEPARATE `docGap`
state. Per-editor clearing can never fix this."* The fix there was a global claim
(`claimExclusiveGap` in `helpers/gapHover.js`) that makes "at most one on screen" true **by
construction rather than by bookkeeping**. This mirrors it deliberately; `gapHover.js` is the
reference implementation to follow.

The claim is cleared on unmount so a closed row cannot hold the claim forever.

### 3. No close-on-blur

Nothing closes a body except toggling it or opening another. Explicitly **no** outside-click or
focus-out handler — a drag into the body moves focus out of it, and closing on that would make the
gesture impossible.

### 4. Ephemeral

No writes, no schema change, no migration. `showDoc` stays local `useState`.

## Two things to VERIFY, not assume

Both are checks in the plan rather than tasks, because "it should work" is how inert features ship
here.

1. **The body registers as a drop target when nested in an instance row.** `Editor` skips
   drop-target registration inside `.textblock-card`, `.instance-textblock-block` and `.table-td`
   (2026-08-08 (5) — a card/cell editor must never steal a page drop). `.instance-wrap` is not on
   that list, so it should register — but this must be observed, since it is the whole basis for
   "let it be open off click".
2. **A drop into the body lands in the body, not on the row.** `DragProvider` bails on any drop over
   a `.doc-editor` (2026-06-16), which should already route it. The instance row is itself a drag
   target, so this is the collision worth watching.

If either fails, that is a bug hunt of its own and gets split out rather than absorbed here.

## Testing

The mint rules need **no new tests** — they are the doc path, already covered. Adding tests for
them would assert someone else's contract.

What is new, and where the failure modes actually are:

- Opening body B closes body A (the exclusivity claim).
- An outside click does **not** close an open body.
- The button and the radial item drive the **identical** handler.
- Unmounting a row with an open body releases the claim.

Each A/B'd against a mutation, with the mutation verified to have landed before believing the
result — per this repo's standing rule.

## Out of scope

- Persisting open/closed state (explicitly deferred: "make it 2 for now").
- Any change to how textblocks are minted, saved or abandoned.
- Any change to linked-group propagation.
- Narrowing or re-styling the body box beyond what it renders today.
- Full-screening a body — that is the separate spread-viewer fusion plan.
