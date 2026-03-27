# Module Rendering Uniformity Refactor Plan

---

## Taxonomy

Every component in the module rendering system belongs to exactly one of these four categories. The name tells you the category.

### 1. `Module{Role}` — Role renderers
One component per module role. Handles everything about rendering that role: shell, header, drag handle, context menu, and routing its body to the appropriate kind content.

```
ModulePanel      → role: "panel"
ModulePage       → role: "page"
ModuleContainer  → role: "container"
ModuleInstance   → role: "instance"
```

### 2. `{Kind}Content` — Kind content renderers
The body rendering for a specific kind. Internal to the `Module{Role}` that owns it — never called directly by anything outside. Named after the kind, not the role it lives in, because some kinds are shared across multiple roles (board, canvas, artifact work the same whether they're a page kind or a container kind).

```
BoardContent     → kind: "board" / "list"   — sortable item list
CanvasContent    → kind: "canvas"            — free-form spatial layout
DocContent       → kind: "doc"               — TipTap rich text editor
ArtifactContent  → kind: "artifact"          — file viewer (markdown, image, pdf, audio, video, code)
PoolContent      → kind: "pool"              — draggable pill library
PreviewContent   → viewType: "preview"       — thumbnail card
```

### 3. `ModuleRouter` — Routing layer
One file. Reads `role`, `kind`, and `viewType` from an occurrence and dispatches to the right `Module{Role}`. Also owns the ManifestTree sidebar layout for tree-based views. No rendering logic of its own.

### 4. UI Components — Not module renderers
Shared UI that supports the rendering system but is not itself a module renderer. Does not follow the `Module{Role}` or `{Kind}Content` naming.

```
ManifestTree     → folder/file tree sidebar
containerPopups  → FilterOverridePopup, TemplatePickerPopup
```

---

## Current → Target

| Current file | Category | Target name |
|---|---|---|
| `Module.jsx` | Router | merge into `ModuleRouter.jsx` |
| `View.jsx` | Router | merge into `ModuleRouter.jsx` |
| `Panel.jsx` | Module{Role} | `ModulePanel.jsx` |
| `Page.jsx` | Module{Role} | `ModulePage.jsx` |
| `Container.jsx` | Module{Role} | `ModuleContainer.jsx` |
| `ModuleInstance.jsx` + `Instance.jsx` | Module{Role} | `ModuleInstance.jsx` (merged) |
| `Artifact.jsx` | {Kind}Content | `ArtifactContent.jsx` |
| `PreviewCard.jsx` | {Kind}Content | `PreviewContent.jsx` |
| `containerHelpers.jsx` → `DocEditorShell` | {Kind}Content | `DocContent.jsx` |
| `containerHelpers.jsx` → `CanvasDrawSection` | {Kind}Content | `CanvasContent.jsx` |
| `containerHelpers.jsx` → `PoolPill` | {Kind}Content | `PoolContent.jsx` |
| `containerHelpers.jsx` → `CanvasCard` | — | deleted; canvas behavior absorbed into `ModuleInstance` |
| list rendering in `Container.jsx` | {Kind}Content | `BoardContent.jsx` |
| `ManifestTree.jsx` | UI Component | `ManifestTree.jsx` (unchanged) |
| `containerPopups.jsx` | UI Component | `containerPopups.jsx` (unchanged) |

### docs/ folder

| Current file | Category | Target name |
|---|---|---|
| `pills/InstancePillNode.jsx` | Module{Role} (doc context) | absorbed into `ModuleInstance.jsx` doc branch |
| `pills/InstancePillExtension.js` | Router (TipTap registration) | `ModuleInstanceExtension.js` |
| `ModuleEmbedNode.jsx` | Module{Role} (doc context) | absorbed into `ModuleContainer.jsx` doc branch |
| `ModuleEmbedExtension.js` | Router (TipTap registration) | `ModuleContainerExtension.js` |
| `pills/` subfolder | — | deleted after moves |

---

## How Kinds Map Across Roles

Not every kind applies to every role. This is the complete mapping:

| Kind / viewType | ModulePage | ModuleContainer |
|---|---|---|
| `board` | ✓ BoardContent | ✓ BoardContent |
| `canvas` | ✓ CanvasContent | ✓ CanvasContent |
| `doc` | ✓ ArtifactContent (textmap) | ✓ DocContent (editor) |
| `display` | ✓ ArtifactContent (file viewer) | — |
| `artifact` | — | ✓ ArtifactContent (file viewer) |
| `pool` | — | ✓ PoolContent |
| `preview` | ✓ PreviewContent | ✓ PreviewContent |

`ArtifactContent` handles all file-based rendering: textmap-backed markdown docs, and file-backed images/pdfs/audio/video/code. The distinction is in the `viewType` it receives, not in a separate component.

---

## ModuleInstance Placement Contexts

`ModuleInstance` renders differently depending on what container kind it lives inside. The parent `{Kind}Content` component is responsible for communicating context — `ModuleInstance` itself has no hardcoded knowledge of where it is.

| Placed inside | Behavior |
|---|---|
| `BoardContent` | List DnD reorder, drop indicators, context menu, linked-copy badge |
| `CanvasContent` | `position: absolute` at `meta.x/y`, pointer-drag to reposition, grip handle for drag-out |
| `DocContent` | TipTap NodeView — registered via `ModuleInstanceExtension`, renders as inline pill or block card |

Same principle applies to `ModuleContainer` when it is placed inside another container (canvas or doc).

---

## File Map After Refactor

```
client/src/modules/
  ModuleRouter.jsx       ← NEW (merge of Module.jsx + View.jsx)
  ModulePanel.jsx        ← rename Panel.jsx
  ModulePage.jsx         ← rename Page.jsx
  ModuleContainer.jsx    ← rename Container.jsx
  ModuleInstance.jsx     ← merge ModuleInstance.jsx + Instance.jsx; add canvas + doc branches
  BoardContent.jsx       ← extract from ModuleContainer list branch
  CanvasContent.jsx      ← extract from containerHelpers CanvasDrawSection
  DocContent.jsx         ← extract from containerHelpers DocEditorShell
  ArtifactContent.jsx    ← rename Artifact.jsx
  PoolContent.jsx        ← extract from containerHelpers PoolPill + Container pool branch
  PreviewContent.jsx     ← rename PreviewCard.jsx
  ManifestTree.jsx       ← unchanged
  containerPopups.jsx    ← unchanged
  containerHelpers.jsx   ← DELETED
  Instance.jsx           ← DELETED (merged into ModuleInstance)
  Module.jsx             ← DELETED (merged into ModuleRouter)
  View.jsx               ← DELETED (merged into ModuleRouter)

client/src/docs/
  ModuleInstanceExtension.js  ← rename from pills/InstancePillExtension.js
  ModuleContainerExtension.js ← rename from ModuleEmbedExtension.js
  pills/                      ← DELETED after moves
```
