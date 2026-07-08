# Drag-and-Drop Matrix — full audit 2026-07-07

Source of truth: `helpers/dragSystem.js` (`DragType` + `DropAccepts`), `helpers/dropHandlers.js`
(`routeDrop` + per-handler branches), `ui/Editor.jsx` (`canDropDoc`/`handleDocDrop`),
`modules/pages/PageCanvas.jsx`, `modules/GridMosaic.jsx`, touch registry (`dragSystem` `_registerDrop`).
Every drag works identically on mouse, native HTML5, and touch (long-press pill; doc drops route via
`getDocTouchDropZone`).

## Drag sources → allowed destinations

### Panel (grid cell unit)
- → **empty grid cell** — move placement (rows×cols grids); occupant at exact anchor swaps.
- → **grid frame edge** (tablet landscape, within 26px) — grid grows a track + panel snaps in (`gridSnap`).
- → **mosaic pane** (grids with `meta.layoutTree`) — drop-to-split via GridMosaic's own per-pane targets
  (cell-based mover is bypassed).
- Keyboard variant: Ctrl+Alt+Arrow moves last-clicked panel one cell / grows the grid at the boundary.

### Page (board / doc / canvas / table / folder)
- → **another panel's content** — page tab moves between panels (`handleContainerDrop`; pages are
  panel children exactly like containers).
- → **panel header root/local tree** (drag-enter opens the tree) — re-home the page into a folder.
- Pages are NOT placeable inside containers or docs directly — nested pages happen by data
  (page-within-page renders as representation chip per the layout cascade), not by drag.

### Container (board/list kind)
- → **panel content** — becomes a child of that panel/page.
- → **page content** (board page) — reparent into the page.
- → **canvas page** — placed as a card at the drop point (`meta.x/y`), kind unchanged.
- → **doc editor** (page doc or doc container) — embedded as a `moduleEmbed` block at the drop line;
  drop on the **left/right third of a textblock/doc host** forms a **wrapGroup** (L/C wrap — the
  infobox pattern), anchorable at any visual line (`wrapAnchor`).
- → **grid cell** — drilldown: new panel minted at the cell with the container as content.
- Nested: containers can hold child containers (`meta.allowChildContainers`); a nested **doc**
  container registers a delegate-only drop zone, so drops landing inside it embed in the NESTED
  container's textmap, not the page editor (2026-07-06 fix).
- Cascade locks (`meta.layoutCascade.locked`) block moves OUT of a locked surface (toast); copies exempt.

### Instance (incl. all leaf roles below via `handleOccurrenceMove`)
- → **another container (list/board)** — move / copy / copy-link per drag mode; landing index from
  pointer; Date + Time Slot re-stamped from the destination's filter cascade (day-col aware, MD1).
- → **same container** — reorder (blocked when `behavior.sortable === false`).
- → **ON another instance** — edge drop = insert before/after (`DropAccepts.INSTANCE`).
- → **insert gap** (`ui/InsertGap`) — splice at exact index.
- → **schedule slot** — same as container move + Stamp Date/Time Slot ops fire; trackers re-aggregate
  (2026-07-07 instance-trigger fix).
- → **doc editor** — embedded as pill/`moduleEmbed` at the drop line; left/right-third = wrap-beside.
- → **canvas page** — card at pointer (`meta.x/y`); dragging within canvas repositions (position is
  canvas-local, not fanned to linked copies).
- → **grid cell** — drilldown: new panel + container minted, instance copied in.
- → **table cell** — cells are mini doc editors; drop embeds the occurrence in the cell doc.
  Fill-drag on a cell copy-links across the range (Excel-style).
- → **multi-select**: shift-click N → clipboard copy/move/copy-link, pasted via right-click
  ("Paste N here") on container or page — not a drag but same reparenting semantics, deep for subtrees.

### Textblock
- Everything an instance can do (routes through `handleOccurrenceMove`), plus:
- → **doc editor** — moves the block between docs / reorders top-level blocks (block ⠿ handle);
  inline mini-block chips reorder as inline nodes.
- → **out of its own sub-editor** — self-drop guarded (source editor rejects its own occurrence).
- → **container / canvas / grid cell** — becomes a standalone textblock card.

### Artifact (image / pdf / audio / video / md / code / quote)
- Everything an instance can do, plus:
- → **manifest/root tree folder** — re-home in the file tree.
- → **artifact panel content** — switches the panel's active document (`handleArtifactDrop`).
- → **grid cell** — new artifact panel minted with a View (`viewType:"display"`).
- → **doc editor** — image artifacts form wrap neighbors (the floated figure) or inline figures.
- → **OS desktop** — drag-out is NOT implemented (docket §8 #24, deferred).

### Doc-embed (dragging an embed OUT of a doc/table cell) — `handleDocEmbedDrop`
- → **canvas page** — card at pointer (copy or move; move deletes the embed via `embedDeleteRegistry`).
- → **grid cell** — new panel + container minted around it.
- → **list container** — spliced at index (copy clones occurrence; move re-parents + removes embed).
- Within the same doc: handled by the editor itself (reorder / re-wrap / re-anchor a wrap at any line).

### Folder (manifest tree) — `handleFolderDrop`
- → **panel content** — every child doc added as a page of that panel.
- → **grid cell** — new panel populated the same way.

### Command Center / pool / tree / doc-pill module drags — `handleModuleDrop` (role-routed)
- module role **panel** → grid cell (placement).
- module role **container** → panel content / page / grid cell (drilldown).
- leaf roles (**instance/artifact/textblock**) → container, ON an instance, page, canvas, grid cell
  (drilldown mints panel+container).
- **Field** → instance only (adds to `fieldBindings`). Doc editors REJECT CC field drops (organize-in-
  place; use `@` mentions inside the editor).
- **Operation** → instance only (adds `operationBindings` trigger widget); doc editors reject.
- **Template** (QuickAddMenu / Templates tab) → container/page — `commitApplyTemplate` stamps the
  saved subtree (not routed through dropHandlers).

### External / OS drops
- **Files** (1..N) → container (artifact cards, batched upload toast), artifact panel (into its tree),
  grid cell (one stacked panel per file). 50MB cap, SHA-256 dedup, thumbnails for images.
- **HTML selection / rich text / markdown / URL** → container / page / empty grid cell — the importer
  materializes a native doc tree (headings→containers, prose→textblocks, images→artifacts,
  pipe-tables→table containers); empty-cell drops re-home under the "Imports" folder pinned to a
  new panel.
- **Cross-window** — copy of the payload occurrence into the target container (dedup-guarded).

## Drop-zone accepts (the gate BEFORE handlers run)
| Zone | Accepts |
|---|---|
| Grid cell | panel, module, instance, artifact, folder, file, external |
| Panel content | page, container, instance, module, artifact, folder, external, file, text, url |
| Page content | container, instance, module, artifact, folder, external, file, text, url |
| Container list | instance, module, artifact, external, file, text, url |
| On an instance | instance, module, artifact, file, text, url |
| Doc editor (own target) | any occurrence payload except: CC fields, CC operations, its own occurrence |
| Canvas surface | PAGE_CONTENT set (container, instance, module, artifact, folder, external, file, text, url) |

## Known intentional exclusions
- Pages can't be dropped INTO containers/docs (representation-chip nesting is data-driven, not drag).
- Fields/operations can't enter docs by drag (use `@` mention).
- Drag-out-to-OS not implemented.
- Undo/redo of drops disabled (server-side undo broken — `UNDO_REDO_ENABLED=false`).
