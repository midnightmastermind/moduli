# client/src/docs — Docs CLAUDE.md

_Updated: 2026-06-06. Check this file before re-reading source._

## Recent Changes (2026-06-06 — CRASH FIX: renderBody contract — "(destructured parameter) is undefined")
- **`ModuleEmbedNode.jsx`** — the textblock + artifact embed branches passed the
  BARE component as `renderBody={TextblockCard}` / `renderBody={ArtifactCard}`.
  But `ModuleInstance` invokes `renderBody()` with NO arguments (it's a zero-arg
  closure — see `ModuleContainer.jsx` `renderBody = () => <TextblockCard
  occurrence={occ} module={mod} />`). So `TextblockCard(undefined)` destructured
  `{ occurrence, module }` off `undefined` → React crash "(destructured parameter)
  is undefined", which took down the whole panel during Wikipedia import (the
  imported prose/media render through these embed branches). Both sites now pass
  the closure form `renderBody={() => <TextblockCard occurrence={occurrence}
  module={mod} />}` / `renderBody={() => <ArtifactCard module={mod}
  label={mod.label} occurrence={occurrence} />}`. Build clean.

## Recent Changes (2026-06-06 — embedded textblock/artifact drag handles + inline link chips)
- **`ModuleEmbedNode.jsx`** — embedded `role:"textblock"` now renders through
  `ModuleInstance` (renderBody=TextblockCard) instead of bare `<TextblockCard>`,
  so imported/embedded textblocks get the GripVertical drag handle + radial menu
  (they had none before). Also: imported media artifacts are `role:"artifact"`
  with a media `kind` (image/audio/…) and NO view, so the old
  `mod.kind === "artifact"` branch never matched and they fell to the
  `<Container>` fallback (rendered nothing — the image bug). New routing:
  `occView.viewType === "display"` → ArtifactContent; else `role === "artifact"`
  → ModuleInstance(renderBody=ArtifactCard) (renders + drag handle); else
  Container.
- **`pills/InstanceTextblockInlineNode.jsx`** — when the occurrence carries
  `meta.link`, the inline node renders a clickable CHIP (url → `<a target=_blank>`,
  occurrence → `→` chip) instead of editable text. Chip is `display:inline;
  white-space:normal` so it WRAPS across lines; the whole node is the drag handle
  (existing `wrapperRef` draggable, `canDrag` false while editing). The markdown
  importer emits these for prose `[text](url)` links (see server/CLAUDE.md).

## Recent Changes (2026-05-20 — InstanceTextblockNode body binding gate)
- **pills/InstanceTextblockNode.jsx**: new `bodyBinding` memo at component
  top, computed via `resolveEditorBinding({ occurrence, module, slot:
  "body" })` (from `client/src/state/editorBindings.js`). When set, the
  inner `<DocContent>` is wrapped in `<BoundBody hostOccurrence={occurrence}
  binding={bodyBinding}>` so the textblock body reads/writes the host's
  own `fields[selfField].value` (TipTap JSON for text fields) instead of
  `occurrence.textmap`. Auto-sync via `propagateBoundFieldWrite` fans
  writes out to any sibling occurrence sharing the host's link-field
  value with selfField present. When `bodyBinding` is null the textblock
  falls through to the existing raw `DocContent` path — fully backward
  compatible with every textblock that hasn't opted into a binding.
- **Binding cascade**: `occurrence.meta.bodyLink` →
  `module.meta.bodyLink` → null. The literal string `"clear"` on the
  occurrence opts out of a module-level binding without re-setting it.
  Same shape that `ModuleContainer.jsx` uses for `headerBinding`.
- **Picker UI** lives in `ui/EditorBindingSection.jsx` (mounted in
  `InstanceForm.jsx` Fields tab inside `BodyBindingPicker`,
  textblock-role only). BoundHeader / BoundBody also render a small
  Link2/Unlink2 badge top-right with the bound field's name (linked when
  host's link value has matching siblings; broken otherwise).

## Recent Changes (May 18 2026 — CellEmbedContext fieldFilter → fieldVisibility)
- **CellEmbedContext.js**: `fieldFilter` key renamed to `fieldVisibility` (default null). Semantics unchanged: `{ mode:"show"|"hide", fieldIds:[] }` is the table column's LOCAL override; null = no column override (ModuleInstance falls back to the occurrence's ancestor `fieldVisibility` cascade). Consumed by ModuleInstance.

## Recent Changes (May 15 2026 — HeadingFocus gated on editor focus)
- **HeadingFocusExtension.js**: `decorations(state)` now returns `DecorationSet.empty` unless `editor.isFocused`. Was applying `.heading-focused` (and the `# ` ::before marker) to whatever heading the *default* selection sat in — every textblock sub-editor's doc is just `[heading]`, default selection is inside it, so an unfocused day-page textblock always showed a stray `#`. Added `handleDOMEvents.focus/blur` that dispatch a no-op tx so the marker appears/clears immediately (a pure blur doesn't otherwise re-run decorations). Captures `const extension = this` to read the live editor. General improvement — affects all doc editors (no stray markers when unfocused), matches the extension's stated "only while editing" intent.

## Recent Changes (May 11 2026 — InstanceTextblockNode drag-out)
- **pills/InstanceTextblockNode.jsx**: Wired Pragmatic DnD `draggable({ element: wrapper, dragHandle: handleDiv, getInitialData: () => ({ type: "module", sourceType: "doc", role: "textblock", id: instanceId, occurrenceId, data: instance || …fallback }) })`. Mirrors the InstancePillNode pattern (Apr 6) — pill drags out, copies to target container/grid cell. Drag init is scoped to the `.module-drag-handle` pill so clicks inside the inner DocContent editor still go to text-editing instead of starting a drag. Removed the `draggable={false}` attribute on the outer wrapper that was blocking native drag entirely.
- **index.css (`.textblock-card`)**: Updated to match `.instance-textblock-block` — same `rgba(134,239,172,0.04)` background, 6px radius, identical inner ProseMirror padding. A textblock now looks the same whether it was minted by typing in a doc (renders via InstanceTextblockNode) or by clicking + Textblock in the QuickAddMenu (renders via TextblockCard inside ModuleInstance). Visual parity, same data shape, same drag-out behavior.

## Recent Changes (Apr 15 2026 — Drag-Out from Doc Embeds)
- **ModuleEmbedNode.jsx**: Imports `embedDeleteRegistry`. Registers `deleteNode` keyed by `occurrenceId` on mount (useEffect with cleanup). Passes `embedSourceType="doc-embed"` to both `ModuleInstance` and `Container` children — tells DragProvider the drag source is a TipTap embed node.
- **helpers/embedRegistry.js**: (existing) Simple `Map<occurrenceId, deleteNode>` — DragProvider calls `embedDeleteRegistry.get(occurrenceId)?.()` to remove the embed node on move.

## Recent Changes (Apr 12 2026 — InstanceTextblock: Separate Node Type)
- **InstanceTextblockExtension.js** (NEW): Dedicated TipTap block node `instanceTextblock` for auto-created typing surfaces. NOT a pill. `group: "block"`, `atom: true`, `draggable: false`. `stopEvent` returns `true` for all events from inside `.instance-textblock-block` — prevents outer ProseMirror NodeSelection on atom click (root cause of cursor-to-beginning bug). `insertInstanceTextblock` command.
- **pills/InstanceTextblockNode.jsx** (NEW): NodeView for `instanceTextblock`. Renders only a `DocContent` sub-editor — no pill badge, no radial menu, no drag handle. `handleExitBlock` moves outer editor cursor to after the node via `editor.chain().setTextSelection(pos + nodeSize).focus().run()`. `handleDeleteBlock` removes TipTap node + calls `CommitHelpers.removeOccurrence`. `draggable={false}`, `onMouseDown={e => e.stopPropagation()}`.
- **InstancePillExtension.js** (REWRITTEN — inline-only): Stripped `bodyContent`, `headerLevel`, `showHeader` attrs. Kept `pillDisplay` in `parseHTML` only (backward compat reading old DB data) — not written on new saves. Removed `stopEvent` override.
- **pills/InstancePillNode.jsx** (REWRITTEN — ~185 lines, was 470): Removed block-mode branch entirely (`isBlockMode`, `handleExitBlock`, `handleDeleteBlock`, `blockOcc`, drag handle choreography, `renderTipTapNode`/`renderTipTapContent`, `HEADING_STYLES`, `showHeader`). Now inline-pill only: label badge, Box icon, field value badges, radial menu (5 items), inline label editing, Pragmatic DnD drag-out.

## Recent Changes (Apr 10 2026 — Block Pill Click Position Fix)
- **InstancePillExtension.js**: Broadened `stopEvent` to return `true` for ALL events from inside `.doc-instance-block` (was only stopping events from inside `.doc-instance-block .ProseMirror`). Root cause: clicks on block pill padding/header (outside sub-editor) reached outer ProseMirror → NodeSelection on atom → stole focus → reset sub-editor cursor to position 0 ("beginning of element" bug).

## Recent Changes (Apr 9 2026 — Drag & Cursor Fix)
- **ModuleEmbedExtension.js**: Changed `draggable: true` → `draggable: false`. ProseMirror was treating moduleEmbed nodes as draggable blocks, causing node selection + drag behavior on click. Embeds are still movable via alignment controls and radial menu.
- **InstancePillNode.jsx**: Block pill drag handle cleanup now also intercepts `dragstart` on the wrapper — prevents text-selection drags from hijacking. Added `drop` listener for more robust `draggable` attribute cleanup.

## Recent Changes (Apr 6 2026 — Pill/Embed Conversion)
- **InstancePillNode.jsx**: Added `editor` + `getPos` props (from TipTap NodeView). Added "Convert to Embed" radial menu item (`Maximize2` icon) — replaces the pill with a `moduleEmbed` block node at the same position. Added to `radialItems` array.
- **ModuleEmbedNode.jsx**: Added `editor`, `getPos`, `deleteNode` props. When selected, toolbar now shows "Pill" button (converts embed back to `instancePill` inline node) and "×" remove button alongside alignment controls.

## Recent Changes (Mar 30 2026 — Uniform Module Rendering in Docs)
- **ModuleEmbedNode.jsx**: Now role-aware. Renders `<ModuleInstance>` for instances, `<ArtifactContent>` for artifacts, `<Container embedded>` for containers (was container-only). Added `ModuleInstance`, `ArtifactContent` imports. Reads `viewsById` from context for artifact detection.
- **Impact**: All modules (instance, container, artifact) dropped into docs now render as their real component, not pills.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DocEditor.jsx` | TipTap editor with @ mentions, drag+drop pills, right-click context menu. Extensions: FieldPill, InstancePill, DocLink, PillBackspace, HeadingFocus. | Feb 22 |
| `DocToolbar.jsx` | Formatting toolbar. Buttons: Bold/Italic/Strike/Code, H1-H3, BulletList/OrderedList/Blockquote/HR, Undo/Redo, `@ Field`, `Pill` (text→instancePill), `Unlink` (pill→text), `MD` (export markdown). | **Feb 22 Session 2** |
| `DocContainer.jsx` | Drop target for instances → inserts pills. Debounced save. Occurrence-based doc storage. | Stable |
| `FieldPillExtension.js` | TipTap extension: fieldPill atom node. attrs: fieldId, fieldName, fieldType, occurrenceId, displayMode. | Stable |
| `InstancePillExtension.js` | TipTap extension: instancePill atom node. attrs: instanceId, instanceLabel, occurrenceId. | Stable |
| `DocLinkExtension.js` | TipTap extension: [[brackets]] doc links. | Stable |
| `hooks/useDocFieldValues.js` | Hook: extracts fieldPill IDs from doc JSON, computes live values. **Mar 20: computedValues migrated to GridLiveContext** (was incorrectly reading from GridActionsContext which no longer provides it). Both `useDocFieldValues` and `useFieldValue` hooks fixed. | **Mar 20** |

## Recent Changes (Mar 20 2026 — C4 Context Split Fix)
- **pills/ExprPillNode.jsx**: Migrated `computedValues` from GridActionsContext to GridLiveContext. Was reading empty default (`{}`) since C4 split removed computedValues from GridActionsContext. All expression pills were evaluating field references to `0`.
- **hooks/useDocFieldValues.js**: Same fix — both `useDocFieldValues()` and `useFieldValue()` hooks now read `computedValues` from GridLiveContext. Fixes field pills in docs showing stale/empty computed values.

## Recent Changes (Mar 17 2026 — Editor UX + CommandPalette Close)
- **Editor.jsx**: Block handle ⋮ menu now closes on Escape or any printable keypress, then refocuses editor. Added `blockMenuOpen` to the popup key-handling useEffect condition and dep array.
- **CommandPalette.jsx**: `Enter` with no matching commands now calls `onClose()` (was a no-op). User can now press Enter to dismiss palette when query has no match and continue typing normally.

## Recent Changes (Mar 14 2026 — D3 Doc Pill Drag Out)
- **pills/InstancePillNode.jsx**: Changed Pragmatic DnD payload from `{ type: "instance", fromDoc: true }` → `{ type: "module", sourceType: "doc", role: "instance", id, data: instance, occurrenceId }`. DragProvider's module handler (command-center/pool path) now also accepts `sourceType: "doc"`. Dragging an instancePill out of the TipTap editor onto a container creates a copy occurrence.

## Recent Changes (Mar 14 2026 — D4 Backspace + D10 Turn Into Instance)
- **PillBackspaceExtension.js**: Rewrote backspace handler. All inline pills convert to text on backspace: `fieldPill` → `#FieldName`, `instancePill` → label, `docLink` → label, `exprPill` → `=expr`. `moduleEmbed` (block embed) moves cursor before the node — does NOT delete or convert (use radial menu to remove).
- **Editor.jsx**: Added "Turn into instance" to right-click context menu (shown only when text is selected + dispatch/socket available). Creates a new `role: "instance"` module via `CommitHelpers.createModule`, replaces selection with `instancePill` node pointing to the new module. New module appears as "Unsorted" in Entity Tree. Added `Box` icon import.

## Recent Changes (Mar 14 2026 — D7 Table + D2 Embed + R3 Lock)
- **Editor.jsx**: Added `{ Table, TableRow, TableCell, TableHeader }` from `@tiptap/extension-table`. Registered in extensions array. Table CSS in index.css.
- **Editor.jsx**: Added `showEmbedPicker`/`embedQuery`/`embedPos` state. `handleEmbedTrigger()` fires when `:` is typed after `@`. `filteredEmbedContainers` builds list of container occurrences. `handleSelectEmbed(occurrenceId)` calls `insertModuleEmbed`. Popup renders below cursor.
- **CommandPalette.jsx**: Added `insertTable` command (3×3 table with header row) and `embedContainer` command (inserts `@:` to trigger picker).
- **Container.jsx DocEditorShell**: Changed `editable={true}` → `editable={!isLocked}`. Added lock/unlock button (hover-to-show, 11px). `handleToggleLock` calls `CommitHelpers.updateOccurrence({ locked: !locked })`.
- **server/models/Occurrence.js**: Added `locked: { type: Boolean, default: false }`. Existing `update_occurrence` handler already persists any fields via `{ ...prev, ...occurrence }`.

## Recent Changes (Mar 13 2026 — S6 Expression Pill UX Polish)
- **Editor.jsx**: Added `exprActiveIndex` state + `exprListRef` ref for keyboard nav in expr popup. Added ArrowUp/Down/Enter handling in the popup keydown listener. ArrowUp/Down moves through field list. Enter with active item → inserts that field name; Enter with no selection → inserts full `exprQuery` as formula (multi-field support, e.g. `protein * 4`). `exprActiveIndex` resets to -1 on query change (useEffect). Active item auto-scrolls into view.
- **Editor.jsx**: Updated expr popup UI. Header now shows `= {formula}  ↵ insert` when query is non-empty. Field items highlight on hover/keyboard nav (`data-expr-item` attr for scroll-into-view). "No matches — press ↵ to insert formula" message when no fields match (allows entering raw math directly).
- **evalExpr in ExprPillNode.jsx** was already multi-field capable (regex replaces all word tokens). No changes needed there.

## Recent Changes (Mar 12 2026 — S6 Expression Pills)
- **ExprPillExtension.js** (NEW): TipTap inline atom node `exprPill`. Attrs: `{ expr: "" }`. Commands: `insertExprPill({ expr })`.
- **pills/ExprPillNode.jsx** (NEW): Renders as yellow pill (rgba(250,204,21)). Shows `=expr = result`. Double-click to edit formula inline. `evalExpr()` resolves field names against `computedValues + fieldsById`, then safe-evals arithmetic. Whitelist check before Function() call. Radial menu with Remove action.
- **Editor.jsx**: Added `ExprPill` extension. `=` key triggers expr suggestion popup. Shows filteredExprFields list. Click inserts `exprPill` with `expr: field.name`. Backspace closes. Escape closes.

## Recent Changes (Mar 2026 — Session 3 InstancePillNode Updates)
- **InstancePillExtension.js**: Added `showHeader` attr (default: false). Controls whether block pill shows a label header row.
- **InstancePillNode.jsx**: Added `updateAttributes` prop. Added TipTap JSON → React renderer (`renderTipTapNode` / `renderTipTapContent`) — supports headings (smaller sizes 11→9.5px), bold/italic/strike/code, lists, blockquote, codeBlock, hardBreak, hr. Added `showHeader` toggle via radial menu ("Show Header"/"Hide Header" with Eye/EyeOff icons). Block mode header: shows when `showHeader=true` — compact teal row with label + radial menu, double-click to rename. Radial dot (no-header mode) still shows on hover. Content area: uses `renderTipTapContent` instead of plain text extraction.
- **Editor.jsx**: `stickyToolbar` fix — `overflow-auto` moved from root `doc-editor` div to `doc-editor-wrapper` (content area below toolbar). Root div no longer creates scroll context that breaks `position: sticky`.
- **Container.jsx (DocEditorShell)**: Removed `overflow-auto` from Editor `className` prop (was breaking sticky toolbar).

## Recent Changes (Mar 2026 — InstancePillNode Block Mode Textblock)
- **InstancePillNode.jsx**: Block mode completely redesigned as "textblock" — no label, no icon header. Just: radial dot handle top-left (opacity 0, shows on hover via `showMenu` state), plain text content extracted from `occurrencesById[occurrenceId].textmap` via `extractPlainText()`. Background: `rgba(134,239,172,0.06)` teal-green, border `rgba(134,239,172,0.16)`, borderRadius 6. Padding `6px 10px 6px 20px` (left pad for radial handle). Added `extractNodeText()` + `extractPlainText()` helpers at top of file. Removed block mode header row (icon + label + field pills). `doc-instance-block` className on outer div.

## Recent Changes (Mar 2026 — FieldPillNode Visual Unification)
- **FieldPillNode.jsx**: Completely restyled to match `Field.jsx` compact display pills. Replaced Tailwind PILL_COLORS (mode-based blue/teal/indigo/purple) with a single inline style object (`PILL_STYLE`/`PILL_STYLE_HOVER`) using the neutral teal-green pill: `rgba(134,239,172,0.08)` bg, `rgba(134,239,172,0.25)` border, `rgba(134,239,172,0.85)` text, `borderRadius: 999`, `fontSize: 10`, `fontFamily: "var(--font-mono)"`. Removed mode icon (Pencil/BarChart2). Format is now `name: value` matching Field compact. Unused imports (Pencil, BarChart2) and `resolvedMode` memo removed.
- Field drops into TipTap heading nodes already work via `posAtCoords` + `insertContentAt` in Editor.jsx — no changes needed.

## Recent Changes (Mar 2026 — Doc Instances as Cards)
- **DocContainer.jsx**: Instance drops now default to `pillDisplay: "block"` — instances appear as doc-instance cards, not inline pills.
- **InstancePillNode.jsx**: Block mode completely redesigned. `isBlockMode` is now just `pillDisplay === "block"` (no longer requires `bodyContent`). New design: compact card row matching list-instance visual style — dark background (`rgba(12,53,70,0.38)`), rounded border, instance icon + label + field value pills + radial menu on hover. Double-click label to rename (shared with inline). Field pills in block mode show `fieldName · value` with blue styling. Removed body textarea (old block full-edit UI). Removed unused state: `fullEdit`, `headerDraft`, `bodyDraft`, `headerInputRef`, `bodyTextareaRef`, `editFocusTarget`, `blockWrapRef`, `isTextOnly`.
- **index.css**: Added `.doc-instance-card` class — sets background + shadow. `.doc-instance-card:hover` slightly brightens.
- **Fields remain as inline pills** — no change to FieldPillNode.jsx.

## Recent Changes (Mar 2026 — DocContainer Display Mode)
- **DocContainer.jsx**: `editable` is now always `true` (TipTap always accepts edits/drops). `showToolbar` prop passes `isEditing` (not `editable`) — toolbar only shows when user clicks to edit. Drops work without switching to edit mode. `cursor: isEditing ? "text" : "default"`.

## Recent Changes (Feb 22 Session 2)

### DocToolbar.jsx
- Added `Unlink` button (N15): appears inline when cursor is on a `fieldPill` or `instancePill`. Replaces the atom node with `#FieldName` text (for fieldPill) or `instanceLabel` text (for instancePill).
- Added `MD` export button (S5): downloads TipTap JSON as `.md` file. `tiptapToMarkdown(node)` recursive converter handles:
  - `paragraph` → `text\n\n`
  - `heading` → `##` × level + `text\n\n`
  - `bulletList/listItem` → `- text`
  - `orderedList/listItem` → `1. text`
  - `blockquote` → `> text`
  - `codeBlock` → ` ``` text ``` `
  - `horizontalRule` → `---`
  - Text marks: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``
  - `fieldPill` → `#FieldName`
  - `instancePill` → label text

## Architecture Notes
- Pills use `atom: true` — cursor cannot enter them; they select as units
- `onContextMenu` handler in DocEditor prevents browser default; shows ContextMenu with formatting + "Insert field" options
- DocLinkSuggestion uses `[[` trigger → shows docs picker
- Pills stored in TipTap JSON as custom node types (not HTML)
