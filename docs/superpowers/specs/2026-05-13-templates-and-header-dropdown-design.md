# Templates & Header Dropdown — Design Spec

**Date:** 2026-05-13
**Status:** Approved for planning

---

## Goal

Two coupled rebuilds:

1. Replace the scattered filter UI (header `FilterButton` + radial-menu filter items + separate `LocalFilterNav`) with a **single header dropdown** that hosts both filter and template controls. Filter "nav" widgets are type-dispatched (arrows for dates, pills for selects, input for text, custom option arrays).
2. Rebuild templates from the flat `Grid.templates[{ instanceId, fieldDefaults }]` model into **nested subtrees** stored as real occurrences inside a Templates manifest. Apply = deep-clone everything (modules + occurrences). Adds a new `APPLY_TEMPLATE` pipeline action so `Schedule: Build Day`'s 48-slot hardcoded loop collapses into one apply + a date-stamp LOOP.

## Motivation

- **Filter UX is fragmented.** Three entry points for the same data (`FilterButton` chip, radial menu items, `LocalFilterNav` arrows). Each occurrence's filter state is hard to introspect.
- **Templates are unusable for non-trivial structures.** Today's `Grid.templates[]` only models instances-under-a-container. Cannot capture a page + its containers + their instances + their filters.
- **`Schedule: Build Day` is brittle.** The pipeline hardcodes a 48-element array in JS and emits per-slot CREATEs. Adding/changing the schedule requires editing the seed script. With APPLY_TEMPLATE the user edits a normal page (the "Daily Routine" template) and the op stays one line.

## Non-Goals

- Template versioning / history.
- Multi-window template-edit concurrency.
- Visual editor for APPLY_TEMPLATE in v1 — uses the existing generic action config form.
- Removal of `Grid.templates[]` field (kept read-only through v1 for migration; dropped in a follow-up).

## Data Model

### Occurrence (`server/models/Occurrence.js`)

New fields:

- `filterNavConfig: Mixed` — `{ [filterId]: { visible: bool, style: "arrows"|"pills"|"input"|"custom", options?: string[], step?: number } }`. Default `{}`.
- `meta.appliedFromTemplateId: string | null` — set on the root of a newly-applied subtree. Lets "Save over template" know which template to overwrite. Cleared if user "breaks the link".

Already present, re-used:

- `filterOverride: Mixed` — `{ [fieldId]: value | null }`. `null` already mutes; `getEffectiveFilterForOccurrence` already understands this.

### Module (`server/models/Module.js`)

- `meta.templateModule: bool` — set on modules minted during save-as-template so they're hidden from normal pickers. Stripped on apply so clones become normal modules.

### Operation (`server/models/Operation.js`)

- Pipeline action enum gains `APPLY_TEMPLATE`.

### Grid (`server/models/Grid.js`)

- `templates[]` retained for read-only migration. No new writes. Dropped in v1.1.

### Manifest / Folder

- No schema changes. `manifestType: "templates"` and `folderType: "templates"` already exist in the enums.

## Architecture

### Component layout

```
client/src/ui/HeaderDropdown.jsx           NEW  Overlay shell (position: fixed, no reflow)
client/src/ui/HeaderChevron.jsx            NEW  Tiny chevron button mounted in headers
client/src/ui/FiltersSection.jsx           NEW  Block inside HeaderDropdown: ancestor + own + nav switch
client/src/ui/FilterNavWidgets.jsx         NEW  Type-dispatched widgets (arrows/pills/input/custom)
client/src/ui/TemplatesSection.jsx         NEW  Block inside HeaderDropdown: picker + actions
client/src/ui/commandCenter/TemplatesTab.jsx NEW  Two-pane templates browser
client/src/ui/QuickAddMenu.jsx             MOD  Template tiles under each kind
client/src/ui/FilterButton.jsx             DEL  Retired
client/src/ui/LocalFilterNav.jsx           MOD  Dispatch by filterNavConfig.style
client/src/modules/ModulePanel.jsx         MOD  Mount HeaderChevron
client/src/modules/ModulePage.jsx          MOD  Mount HeaderChevron
client/src/modules/ModuleContainer.jsx     MOD  Mount HeaderChevron
client/src/helpers/templateHelpers.js      NEW  Client traversal + apply helpers
client/src/helpers/CommitHelpers.js        MOD  cloneSubtreeAsTemplate, applyTemplate, saveOverTemplate
client/src/helpers/operationActions.js     MOD  Add APPLY_TEMPLATE action
client/src/helpers/operationExecutor.js    MOD  Execute APPLY_TEMPLATE step
server/socketHandlers/templates.js         MOD  Replace handlers
server/socketHandlers/crud.js              MOD  Recognize template-clone broadcasts
server/scripts/migrateLegacyTemplates.js   NEW  One-shot migration
server/scripts/createTestGrid.js           MOD  Daily Routine template + Build Day rewrite
```

### Server flows

**`clone_subtree_as_template`** — Input `{ sourceOccurrenceId, name, parentFolderId }`. Walk source subtree; for each node clone the module (new id, `meta.templateModule: true`) and the occurrence (new id, regenerated `occurrences[]`, deep-copied textmap, copied `filterOverride` and `filterNavConfig`). Root parentId = parentFolderId in templates manifest. Emit `module_created` + `occurrence_created` per node. Returns `{ templateOccurrenceId }`.

**`apply_template`** — Input `{ templateOccurrenceId, targetOccurrenceId, mode: "append"|"replace" }`. Walk template subtree; for each node clone module (new id, strip `templateModule`) and occurrence (new id). Root parentId = targetOccurrenceId, `meta.appliedFromTemplateId = templateOccurrenceId`. `append` pushes onto target.occurrences; `replace` clears target.occurrences first. Returns `{ rootOccurrenceId, newOccurrenceIds[], newModuleIds[] }`.

**`save_over_template`** — Input `{ sourceOccurrenceId, templateOccurrenceId }`. Recursively delete template's module + occurrence subtree. Run clone_subtree_as_template at the old root's parentFolderId, reusing the old template root's id + name.

**`APPLY_TEMPLATE` pipeline step** — Config `{ templateRef, targetOccurrenceVar, mode, resultVar }`. Executor invokes the same clone-walk as `apply_template`, returns the flattened occurrence id list bound to `resultVar` for downstream LOOP+SET_FIELD_VALUE steps.

### UI flows

**HeaderDropdown** opens on chevron click, anchored under the chevron's screen rect (`position: fixed`, `zIndex: 1000`). ESC + outside-click close.

**FiltersSection** layout:

```
Filters
─────────
• Daily (ancestor: Grid)   [On] ▾
  └ Nav: ◀ 2026-05-13 ▶    [Show nav]
• Context (own)            [×]  ▾
  └ Style: [Pills ▾]  [Work] [Home] [Study]
+ Add own filter
```

**TemplatesSection** layout:

```
Templates
─────────
[📁 Routines › Daily Routine] [Apply]
[+ Save as new template]
[↻ Save over Daily Routine]     (only if meta.appliedFromTemplateId set)
[Manage in Command Center]
```

**TemplatesTab** (Command Center) is two-pane: left = ManifestTree pointing at the templates manifest; right = read-only preview + "Apply to..." button that opens a `CategoryPathPicker` over the normal manifest.

## Acceptance Criteria

1. Clicking chevron on Panel / Page / Container header opens HeaderDropdown overlay; doesn't push surrounding content. ESC + outside-click close it.
2. `FilterButton` is deleted. No `<FilterButton />` JSX anywhere.
3. Ancestor filter list correctly walks parent chain. Toggling an ancestor filter off writes `filterOverride[fieldId] = null`; toggling on removes the entry.
4. Adding an own filter writes a non-null `filterOverride[fieldId]`.
5. Filter nav widgets: date → arrows, select → pills, text → debounced input. Switch in dropdown toggles `filterNavConfig[filterId].visible`.
6. New grids get a "Templates" manifest with a root folder.
7. Save-as-template clones source subtree into the Templates manifest. Source unchanged. Clone modules have `meta.templateModule: true`.
8. Apply clones template subtree into target, regenerates all ids, mints fresh modules without `templateModule`. Root occurrence carries `meta.appliedFromTemplateId`.
9. With `meta.appliedFromTemplateId` set, Save Over deletes the old template subtree and re-clones, keeping the template's id + name.
10. TemplatesTab visible in Command Center. Apply To... path picker works against the normal manifest. Preview pane renders selected template read-only.
11. `APPLY_TEMPLATE` pipeline step produces identical end state to UI Apply. `resultVar` holds the flattened occurrence-id array.
12. Rewritten `Schedule: Build Day`: FIND schedPage → FIND dailyRoutineTemplate → APPLY_TEMPLATE → LOOP $newInstances → SET_FIELD_VALUE date/due. 48-slot hardcoded array deleted. End-user UX unchanged.
13. Migration script: running converts existing flat `Grid.templates[]` into nested subtrees in the Templates manifest. Idempotent.
14. No regression in existing trackers, todo sweep, RUN_OPERATION chains.

## Phase Order

| Phase | Ships | Independent? |
|-------|-------|--------------|
| 1 | Server schema extensions + Templates manifest seeding | Yes |
| 2 | HeaderDropdown shell + FiltersSection + filter nav widget dispatch | Yes (filter UX improves immediately) |
| 3 | Server template flows + client templateHelpers + migration | Yes (invisible until 4 lands) |
| 4 | TemplatesSection in HeaderDropdown + QuickAddMenu template tiles + Command Center TemplatesTab | Depends on 3 |
| 5 | APPLY_TEMPLATE op step + Schedule: Build Day rewrite | Depends on 3 |
| 6 | Cleanup (FilterButton deletion, dead-code sweep) | Depends on 2 |
