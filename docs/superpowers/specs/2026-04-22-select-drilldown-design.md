# SelectDrilldown Component Design

_Date: 2026-04-22_

## Overview

Replace `PathPicker` (a minimal cascading dropdown for expression-path selection) with a proper, config-driven multi-level drilldown select component. The component is broader than PathPicker — it handles any tree-structured selection: modules, fields, path expressions, etc.

**Goals:**
- One reusable `SelectDrilldown` component with a config-driven levels array
- Two primitive components (`Select`, `Multiselect`) for item-list rendering that match the system's visual design
- Delete PathPicker and all re-export shim files; update import sites directly

---

## Section 1: Shim File Cleanup

Nine re-export stubs in `client/src/modules/` and two in `client/src/modules/containers/` forward to real implementations. These add indirection with no value. All will be deleted and their import sites updated to point directly at the real files.

**Shims and their real targets:**

| Shim | Real File | Known Importers |
|------|-----------|-----------------|
| `modules/Panel.jsx` | `modules/ModulePanel.jsx` | `Grid.jsx:16`, `ui/FullscreenOverlay.jsx:3` |
| `modules/Page.jsx` | `modules/ModulePage.jsx` | none found |
| `modules/Container.jsx` | `modules/ModuleContainer.jsx` | `docs/ModuleEmbedNode.jsx:8` |
| `modules/View.jsx` | `modules/ModuleRouter.jsx` | none found |
| `modules/Module.jsx` | `modules/ModuleRouter.jsx` | none found |
| `modules/Artifact.jsx` | `modules/ArtifactContent.jsx` | none found (ModulePanel imports ArtifactContent directly) |
| `modules/Instance.jsx` (exports `MemoInstanceInner`) | `modules/ModuleInstance.jsx` | `modules/ModuleRouter.jsx:45` (imports as `Instance`) |
| `modules/PreviewCard.jsx` | `modules/PreviewContent.jsx` | none found |
| `modules/containerHelpers.jsx` (re-exports DocContent, PoolContent, CanvasContent + owns CanvasCard) | — | `modules/containers/ContainerPool.jsx:6` (imports `PoolPill`) |
| `modules/containers/ContainerDoc.jsx` | `modules/DocContent.jsx` | none found |
| `modules/containers/ContainerCanvas.jsx` | `modules/CanvasContent.jsx` | none found |

**Note on `containerHelpers.jsx`:** This file owns the real `CanvasCard` component (not a shim) in addition to re-exports. The re-export section will be removed; `CanvasCard` will stay in-place or move to its natural home. `ContainerPool.jsx` will import `PoolPill` directly from `PoolContent.jsx`.

**`PagePreviewApp.jsx`** imports `modules/Panel` (via `FullscreenOverlay`) but was already deleted — skip.

---

## Section 2: SelectDrilldown Component

### Closed State (Chip-Chains)

When closed, the component renders one chip-chain per selected path. Each chain shows the chain of chosen labels separated by `›`. The entire chip-chain block is clickable to open — no separate delete or add buttons.

```
[ Daily Toolkit › Water Today › value ]   [ $item › fields › completed › value ]
```

Clicking anywhere on the chip-chain block opens the drilldown at the appropriate level.

When nothing is selected, shows a placeholder label.

### Open State (Drilldown Dropdown)

A dropdown panel with:
- **Breadcrumb bar** at top showing the current drill path (e.g. `$item › fields ›`). Breadcrumb segments are clickable to go back to that level.
- **Current level list** of items. Each item shows a title, optional subtitle hint, and a `›` arrow if it has children.
- **Search input** (per-level, optional) above the list.
- **Multi-select mode** (per-level, optional): checkboxes on each item, "Done" button to confirm.

Selecting a leaf item (no children) closes the dropdown and adds the chain. Selecting a non-leaf item drills into it, updating the breadcrumb and item list.

### Value Format

`string[][]` — array of chains. Each chain is an array of string values, one per level traversed.

```js
// Single selection: $item.fields.water.value
[["$item", "fields", "water", "value"]]

// Two selections:
[["$item", "fields", "water", "value"], ["$item", "fields", "completed", "value"]]
```

---

## Section 3: Config Format

```js
{
  placeholder: "Select…",           // shown when value is empty
  multi: false,                     // allow multiple chains (top level)
  levels: [
    {
      label: "Variables",           // breadcrumb label for this level
      searchable: false,
      multi: false,                 // multi-select at this level
      items(parentValue) {          // called with value chosen at previous level
        // returns [{ value, title, sub?, hint?, disabled? }]
        return [
          { value: "$item", title: "$item", hint: "loop iteration" },
        ];
      },
      next(selectedItem) {          // returns next level config, or null if leaf
        return null;
      },
    },
    // ... further levels are returned dynamically via next()
  ],
}
```

### PathPicker Compatibility

`PathPicker` is used in `OperationsBuilder.jsx` and `ConditionGroup.jsx` with a `shapeByVar` object and outputs a dot-joined string (`$item.fields.water.value`).

`SelectDrilldown.jsx` exports:
- `buildPathConfig({ sources, fields, inLoop })` — builds a levels config from a shapeByVar (replaces `buildPathShape`)
- `chainToPathString(chain)` — converts `["$item","fields","water","value"]` → `"$item.fields.water.value"`
- `pathStringToChain(str)` — inverse

Call sites in `OperationsBuilder.jsx` and `ConditionGroup.jsx` wrap SelectDrilldown with these helpers so the PathPicker-style string API is preserved at the call sites.

---

## Section 4: Visual Design

Follow system design tokens. Clean, monospace, dark-surface aesthetic matching the OperationsBuilder style.

**Chip-chains (closed):**
- Background: `var(--input-bg)`, border: `var(--border-default)`, rounded corners
- Labels: `var(--font-mono)`, `var(--text-primary)`, `font-size: 10px`
- Separator `›`: `var(--text-muted)`
- Hover: slightly lighter background

**Dropdown panel:**
- Background: `var(--surface-card)` or `var(--input-bg)`, border `var(--border-default)`, `border-radius: 6px`
- `box-shadow: 0 4px 16px rgba(0,0,0,0.4)`
- `position: fixed` (portal into `document.body`) to avoid clipping by overflow parents
- `min-width: 240px`, `max-height: 320px`, scrollable item list

**Items:**
- Padding: `6px 10px`, monospace 11px
- Hover: `var(--accent-blue-bg)` background, `var(--accent-blue-text)` text
- Arrow `›` for non-leaf items, right-aligned
- `hint` text: `var(--text-faint)`, 9px, below title

**Breadcrumb:**
- `var(--text-muted)`, 9px, monospace
- Clickable segments underline on hover
- Separator: ` › `

---

## Section 5: File Plan

**New files:**
- `client/src/ui/SelectDrilldown.jsx` — drilldown dropdown + closed chip-chain state + `buildPathConfig` + value converters
- `client/src/ui/Select.jsx` — single-select item-list primitive (used by SelectDrilldown for leaf levels)
- `client/src/ui/Multiselect.jsx` — multi-select item-list primitive (used for multi=true levels)

**Deleted files:**
- `client/src/blocks/PathPicker.jsx`
- `client/src/modules/Panel.jsx`
- `client/src/modules/Page.jsx`
- `client/src/modules/Container.jsx`
- `client/src/modules/View.jsx`
- `client/src/modules/Module.jsx`
- `client/src/modules/Artifact.jsx`
- `client/src/modules/Instance.jsx`
- `client/src/modules/PreviewCard.jsx`
- `client/src/modules/containers/ContainerDoc.jsx`
- `client/src/modules/containers/ContainerCanvas.jsx`

**Modified: `modules/containerHelpers.jsx`** — remove re-export section, rename to something less misleading (or keep as pure CanvasCard file).

**Modified: import sites** as per Section 1 table above.

---

## Out of Scope

- Async item loading (all items are synchronous from config)
- Keyboard navigation beyond basic tab/enter
- Mobile-specific touch targets (system is primarily desktop)
