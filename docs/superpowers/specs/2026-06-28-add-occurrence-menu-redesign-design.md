# Add-occurrence menu redesign — design + plan

_2026-06-28_

## Goal

Turn the `+` add-occurrence menu (`ui/QuickAddMenu.jsx`) — mounted on panel headers,
container headers, page headers, and the between-item insert-gaps — into a single
**unified search + type-tile** drilldown, module/occurrence-focused, with the curated
module-type icons (`helpers/moduleIcons.js`) used everywhere else (CategoryPathPicker,
value picker). User direction (all 3 accounts + CLAUDE_CHAT): _"the quick add menu should
be more module and occurrence focused and on creating… large icons for the types… if we
are searching for one or creating one… that drilldown menu we have."_

## Decisions (from brainstorming, 2026-06-28)

1. **Layout = unified search + type tiles** on one screen (no drill level).
2. **Tiles create immediately** of their type; the search box only filters the existing list.
   Naming a freshly-created occurrence happens after, via inline rename.
3. **Keep** the field-picker step (instance create), the template tiles, and roll the
   redesign out to **every** `+` surface uniformly.

## Approach

Rewrite **`QuickAddMenu.jsx`'s body in place**, keeping its public props identical
(`targetRole`, `onSelect`, `onCreateNew`, `onAddTextblock`, `createLabel`,
`hostOccurrence`, `onOpenChange`). Because every `+` already routes through this one
component, all surfaces get the redesign with no consumer edits. (Rejected: a new
component or a generic DrilldownPicker rewrite — both churn 6+ call sites for no gain.)

## Layout (portal dropdown, ~260px)

1. **Search input** (top, autofocus) — filters the existing-matches list only.
2. **Type tiles** — big icon tiles, one per kind in `ALLOWED_KINDS_BY_ROLE[targetRole]`
   (instance→board/textblock/artifact, container→board/doc/canvas/table,
   panel→board, page→board/doc/canvas/table/folder). Icon + color via
   `getModuleTypeBadge({ kind })`. **Click = create immediately** of that kind.
3. **Existing matches** — role-matching modules filtered by the search text; each row
   shows its type icon + kind label; click = `onSelect(module)` (fresh placement).
4. **Templates** — when `hostOccurrence` + matching templates exist, apply-template chips
   at the bottom (unchanged).

## Tile-click dispatch

- `kind === "textblock"` → `onAddTextblock()` (its dedicated create path).
- `targetRole === "instance"` AND the grid has ≥1 field AND it's the generic instance
  tile → open the **field-picker** sub-step, then `onCreateNew({ fieldIds, kind })`.
- otherwise → `onCreateNew({ fieldIds: [], kind })`.

`onCreateNew` gains a `kind` field in its argument object. Back-compat: existing
consumers that ignore `kind` keep working (they create their default kind); honoring
`kind` per consumer is a follow-up slice so container/page tiles mint the right kind.

## Edge / empty states

- A role with a single allowed kind still shows that one tile (instant create).
- No existing matches → tiles + a muted "No matches" line (only when search is non-empty).
- Escape / outside-click / scroll-reposition behavior unchanged (already correct).
- The field-picker sub-step (Back / search / checklist / Skip+Create footer) is unchanged
  except it now carries the chosen `kind` into `onCreateNew`.

## Components / isolation

- `QuickAddMenu` stays the one public component. Internals split into small render
  helpers: `TypeTiles` (the tile grid), `ExistingList` (search-filtered matches),
  `FieldPickerStep` (the existing instance sub-step), `TemplateChips`.
- Pure helper `tileKindsForRole(targetRole)` returns the ordered kind list — unit-testable.

## Testing

- `tileKindsForRole` returns the right ordered kinds per role.
- Tile-click dispatch: textblock→onAddTextblock; instance+fields→field-picker;
  other→onCreateNew with `kind`.
- Existing-match filtering by search text; `onSelect` receives the module object.
- (Portal/positioning untested — unchanged from today.)

## Implementation plan

1. **Slice 1 — QuickAddMenu rewrite.** Replace the category-tile / picked-kind body with
   the unified layout (search + type tiles + existing list + templates). Thread `kind`
   through the tile→create dispatch and the field-picker step. Use `moduleIcons`. Keep
   props + portal + field-picker + templates. Build + the unit tests above.
2. **Slice 2 — consumers honor `kind`.** Update `onCreateNew` handlers in
   `modules/ModuleContainer.jsx`, `ModulePanel.jsx`, `ModulePage.jsx`, and
   `ui/InsertGap.jsx` to read `kind` and mint the chosen container/page/instance kind
   (today they mint a default). Small, per-call-site.
3. **Slice 3 — polish.** Tile hover/active states, keyboard nav (optional), and drop the
   now-dead `KIND_TILE`/`showCategories`/`pickedKind` code.

Slice 1 is the load-bearing change and ships the new UX; slices 2–3 refine.
