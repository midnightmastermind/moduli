# Type Review Spec — board / doc / canvas / table + container / instance / artifact / textblock

**Date:** 2026-05-22 · **Task:** #38 · **Status:** Initial draft

A deep audit of every TYPE (kind) and ROLE in Moduli, with refinement ideas and "example that makes it pop" patterns for each. Output drives task #36 (Layout cascade — per-kind defaults) and task #51 (canvas tool additions).

## How "type" works in Moduli (background)

There are two orthogonal dimensions on every Module record:
- **Role** — what the module *is*: `page`, `panel`, `container`, `instance`, `artifact`, `textblock`.
- **Kind** — how the module *renders*: depends on the role. For containers + pages: `list`, `doc`, `board`, `canvas`, `table`, `folder` (folder is page-only). For artifacts: `image`, `pdf`, `audio`, `video`, `markdown`, `code`. Role + kind together pick the renderer.

An **occurrence** is a per-placement instance of a module. Same module + many occurrences = the same content surfaced in multiple places. Field values + style overrides live on the occurrence (the placement), not the module.

The renderer chain is: panel → page (board/doc/canvas/table/folder) → container (list/doc/board/canvas/table) → instance/artifact/textblock leaves. The cascade is roughly homogenous — pages and containers are the same kind dispatch surface, which is what makes the page-within-page primitive (task #45) work for free.

---

## Page kinds

### board
**What it is:** a vertical list of sortable child containers. The most common "tab" layout.

**Current tools:** drop targets for any module, sortable, QuickAddMenu, HeaderDropdown (filters / templates / field visibility), drag-to-reorder.

**Refinement ideas:**
- **Inline collapse:** each container has a chevron in its own header. There's no page-level "collapse all" / "expand all". Add a 2-button affordance in the page header.
- **Sticky container headers:** when the page scrolls past a container, pin that container's header to the top of the viewport. Helps long pages.
- **Group containers by field:** a "Group by" header dropdown that buckets visible containers by a shared field value (similar to the existing local sort, but visually as separators).
- **Multi-column layouts:** today the board is one column. A `meta.columns: N` would lay containers out CSS-grid-wise across N columns at >X breakpoint, letting wide screens use horizontal real estate. The existing multi-day Schedule already renders horizontally — generalize.
- **Container-as-card collapse:** option to render each child container as a thumbnail PreviewNode (matches the folder-page card grid), tap to expand inline.

**Example that pops:** a "Reading Dashboard" board page with three side-by-side containers — Currently Reading (list), Reading Queue (table with priority column), Notes (doc). Multi-column layout makes it usable on a single screen instead of needing scroll.

### doc
**What it is:** a single TipTap rich text editor. The whole page IS the doc.

**Current tools:** TipTap (paragraph/heading/bullet/code/blockquote/tables), pill embeds (FieldPill, InstancePill, ModuleEmbed), DocToolbar (Bold/Italic/etc. + MD export + Unlink), block handle (⋮ left of each block, change kind / duplicate / delete).

**Refinement ideas:**
- **Slash menu** — typing `/` shows a command palette of block types (Notion-style). Currently `/` opens CommandPalette but the experience could be tighter.
- **Markdown shortcuts** — `# ` → H1, `> ` → blockquote, `*` → bullet, `[]` → checklist. TipTap StarterKit has these but verify they're enabled everywhere.
- **Inline checklists** — task list with checkbox. Required for the People profile-card "checklist of follow-ups" use case.
- **Table extension polish** — column resize, sort by column, header pinning. Today's TipTap tables are static-shape.
- **Footnotes** — `[^1]` references with a footer block.
- **Math** — KaTeX / MathJax block + inline. The user mentioned wanting structured info; equations belong here.
- **Mermaid / Graphviz fence** — rendered as image inline. Useful for system diagrams in the assistant-plan / type-review docs themselves.

**Example that pops:** a "Today" doc page with a checklist of slash-command-inserted items, a few `@:`module embeds of in-progress Schedule slots, and a mermaid diagram of the day's dependencies. All rendered inline; one source of truth for the day's intent.

### board (multi-day Schedule special case)
Already covered above; the multi-day day-col wrapper system shipped 2026-05-20 is a special seed pattern that uses regular board kind + scheduleFormat field. Refinements:
- **Drag-between-day-cols** — pick a slot in Mon's column, drag into Wed's column. Today the user has to drop into the right day-col directly; cross-col drag-and-drop should re-stamp the date.
- **Compare mode** — pick 2 days, render them side-by-side stacked vertically. Lighter than the full multi-day spread.

### canvas
**What it is:** a fixed 4000×4000 world with drawing tools + free-floating cards positioned via `meta.x/y`.

**Current tools:** pen / line / square / circle / connect (chain-link) / eraser. Stroke history with undo/redo. Snap-to-center. Edge autoscroll. Card drag-and-drop. Connect-tool edges persist on `meta.edges`. Hand tool for panning.

**Refinement ideas (covered by task #51 — canvas tool additions):**
- Better color picker (palette + custom hex + recent swatches)
- Marker vs pencil distinction (different stroke characters / opacity)
- Fill-color (paint bucket) for closed shapes
- Layers (on/off per layer, edit each, layers dropdown with rename)

**More refinement (this spec):**
- **Sticky-note tool** — single-click drops a styled rect with editable text. Faster than minting a textblock.
- **Lasso / multi-select** — drag a rectangle to select strokes + cards; group-drag, group-color, group-delete.
- **Snap-to-grid / align guides** — when dragging a card, show alignment lines with neighbors (Figma-style).
- **Zoom in/out** — today the canvas is fixed 100% scale. Zoom helps for detailed work (Mona Lisa needs this).
- **Mini-map** — small navigator pane in the corner showing the whole world + viewport rect.
- **Export** — save canvas as PNG/SVG/PDF. The user's "convert blueprint" direction (task #43) pairs with this.
- **Background pattern picker** — dot grid / line grid / blueprint / blank. Defaults to dot grid today.

**Example that pops:** the Drawing Example page (task #37) — Mona Lisa using layers, custom palette, marker for shading, pencil for outlines. Demonstrates the full toolkit.

### table
**What it is:** a layout-only grid where each cell holds a virtualized TipTap mini-editor or a single-field embed of a copy-linked occurrence (Schedule Table pattern).

**Current tools:** TanStack Table + react-virtual. Per-column displayFieldId / fieldVisibility / sort / filter / width. Cell focus-pinning. Spreadsheet keyboard nav (Tab/Enter/arrow at edge). Excel-style copylink fill-drag.

**Refinement ideas:**
- **Column types** — explicit type per column (text, number, date, select, occurrence-ref). Today column types are derived from displayFieldId; an explicit type lets the column header show type-appropriate filter UI (number range, date drilldown picker, select chips).
- **Row grouping** — group rows by a shared field value with collapsible headers. Useful for the People table grouped by gender or note tag.
- **Frozen columns** — pin the first N columns to the left during horizontal scroll.
- **Formula cells** — `=$row.amount * $row.qty` style expressions evaluated client-side. Sibling to the value-manipulator task #31.
- **CSV import/export** — round-trip with spreadsheets. Important for the data-portability story.
- **Per-row actions** — kebab menu in the row-action column (currently it has a remove-row button; could add Copy / Move-to-Project / Open-Profile pattern for the People table).
- **Conditional row styling** — `$displayRules` analog for rows. Highlight overdue rows red, completed rows green-tinted.

**Example that pops:** the People table (task #46/#53) with row grouping by gender, conditional styling for "no contact in 30+ days" rows, and a kebab action menu that runs the "Show Profile" op.

### folder
**What it is:** a card grid of child pages with drilldown animation. Used by Daily Toolkit, Center Hub, and any page whose `kind: "folder"` was minted via the +Folder action.

**Current tools:** PreviewNode card grid, lazy iframe mounts (IntersectionObserver), Windows-7-style breadcrumb + peer nav arrows, drilldown zoom animation.

**Refinement ideas:**
- **Grid density** — small/medium/large card-size toggle. Today cards are a fixed size.
- **Per-card cover override** — let the user set a custom cover image per child page (not just the auto-derived first-image / preview).
- **Drag-to-reorder** — sortable card grid. Today order comes from `sortOrder` set at mint time.
- **List mode toggle** — switch between card grid and list view (compact rows). Useful when a folder has 50+ children.
- **Search within folder** — filter card grid by label substring.

**Example that pops:** the Daily Toolkit folder (already shipped) rendered with grid-density "large" so the 11 wellness pages each get a substantial preview thumbnail. Drag-to-reorder lets the user reorganize their daily flow.

---

## Container kinds

Containers reuse the same kind enum as pages (list / doc / board / canvas / table). The render path is identical (ModuleContainer's kind dispatch). Notable differences:
- A container has a label/header rendered by the parent surface.
- Container's children are leaves (instances / artifacts / textblocks) by default, but `meta.allowChildContainers` opens it to nested containers (the schedule slot pattern).

### list (container)
**What it is:** the default container — sortable list of instances with field pills inline.

**Refinement ideas:**
- **Per-field-pill quick-edit** — click an inline field pill (e.g. "5 reps") to edit in place without opening the full instance form.
- **Group by field** — collapse instances into sections keyed by a select field value.
- **Bulk-edit a field across all visible instances** — header action: "Set Status = Working On" applies to all visible rows.
- **Inline new-instance row** — like Notion's bottom row that becomes the new entry on type.

### doc (container)
Same TipTap surface as page-doc but rendered inside a container's header chrome. Used heavily for the Notebook / Stan / Phil / Daily Journal containers.

**Refinement ideas:** all doc-page refinements apply. Plus:
- **Embedded fields readback** — the doc can reference its parent occurrence's fields via `@:`field. Today field pills work but the read-only "live value" display has rough edges in some cases (task #17 was already fixed but worth re-verifying).

### board / canvas / table inside container
These are less common but valid via `allowChildContainers`. The schedule day-cols are the canonical example (container kind:"list" with allowChildContainers, holding slot child-containers).

**Refinement:** the container header chrome gets tighter when nested — should the inner container's header even render at all? Could be a Layout-cascade rule per kind: "kind:board nested in kind:list → hide header".

---

## Leaf kinds

### instance
**What it is:** a generic record. Label + field pills + optional media + optional textmap (sub-doc).

**Current tools:** field pills (per-binding visibility), media block (drop artifact → set src), radial menu (copy/move/duplicate/delete/sibling-link), inline label edit, fieldVisibility cascade (show/hide/inherit).

**Refinement ideas:**
- **Per-instance custom layout** — today the field pills wrap below the label. Allow flex-row / flex-col / grid per instance. Pairs with the user's "we should have a quick flex layout option for fields and label" (BUGS.md #19).
- **Conditional rendering** — `meta.hideWhen: { fieldId: X, value: Y }` so an instance auto-hides when a condition matches. Today this is done via filter cascade at the container level only.
- **Sibling links UI polish** — the SiblingLinks affordance exists but is hidden in the instance form. Surface a link icon on the instance row when sibling-linked.

### artifact
**What it is:** a file-backed module (image / video / audio / pdf / markdown / code). Two render contexts: ArtifactCard inline in a container, ArtifactContent at the page level.

**Current tools:** download button (#20 done), syntax highlighting for code (#14 done), audio waveform via wavesurfer (#11 done), image OCR (lazy tesseract), EXIF extraction on upload (#12 done), thumbnails (sharp #4 done).

**Refinement ideas (task #43 already captures most):**
- Image lifting (alpha-cut foreground)
- Outline / coloring-page mode
- Blueprint conversion
- In-place image edit (crop / rotate / brightness)
- PDF.js viewer (page nav, search, text selection for citations)
- Video transcoding for unsupported codecs

### textblock
**What it is:** a freestanding rich-text block. Behaves like a single-block doc inside a container or doc.

**Current tools:** TipTap rich text, drag-out to other docs, body binding to a host field (BoundBody — auto-syncs siblings), single inline editor.

**Refinement ideas:**
- **Word-token / magnetic-poetry mode** — already captured in the docket (item 6.6). Each word as a draggable chip.
- **Voice → text** — record a voice memo, auto-transcribe (pairs with task #40 voice OCR).
- **Versioning** — keep a history of edits per textblock; revert to any version.

---

## Universal cross-type refinements

- **Pin to top / lock position** — applies to any occurrence. Pinned items skip sort, stay first.
- **Custom per-occurrence color tag** — already exists via styleMode/ownStyle but the UI to set it is buried. Surface a swatch picker in the radial menu.
- **Per-occurrence collapse memory** — collapse state should persist across reloads (today it resets).
- **Bulk operations across visible items** — task #30 (createMultiple / moveMultiple / etc.) covers the action side; the view side needs a "select all visible" + "select inverse" UI.
- **Keyboard navigation** — arrow-key navigation between instances inside a container, between containers in a page. Today only the canvas + the table have full keyboard nav.

---

## Cross-spec dependencies

- Task #36 (Layout cascade) consumes the per-kind default behavior identified here.
- Task #51 (canvas tool additions) implements the canvas refinements.
- Task #43 (image lifting) implements the artifact image refinements.
- Task #29 / #54 (Last-X + Array-X) influences the instance/container display refinements (per-field-pill quick-edit, group-by-field).
- Task #38 (this doc) is the parent spec.

---

## Future spec subdivisions

If this spec grows past one document, split into:
- `type-review-pages.md` — board / doc / canvas / table / folder
- `type-review-containers.md` — container kinds
- `type-review-leaves.md` — instance / artifact / textblock
- `type-review-cross.md` — universal refinements + cross-type patterns

For now keep as one for grep-ability.
