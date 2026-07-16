# Plan — Seamless occurrence conversion + text-highlight audit (2026-07-16)

**User goal.** Convert *any* occurrence into another type seamlessly, keeping its children:
- A **doc container → board container** (and back) carrying its children.
- **Type a board's contents in a doc**: a bullet list of mini-textblocks, then
  **highlight it + right-click → "Convert to instances"** and get a real board/list of
  instance occurrences.
- The right-click **Convert** entry is **not just for containers** — every occurrence
  (container / instance / textblock / artifact / page) offers the conversions that make
  sense for it.
- **Prerequisite bug (folded into this plan): text highlighting is broken** — "i can't
  highlight anything." Selecting text (and especially selecting *across* several
  mini-textblocks in a doc) has to work before the highlight→convert flow can exist.

This is a PLAN. Nothing below is implemented yet. Order matters: **Part A (highlight
audit) ships first** — it's an acute bug AND the enabling primitive for Part B's
doc-selection convert flow.

---

## Part A — Text-highlight audit (bug + enabling primitive)

### A0. What's actually broken (grounded in the code)

There is **no single global `user-select:none`** that kills all selection. The blockers are
layered, so "can't highlight anything" is really several distinct failures:

1. **Instance labels/fields opt out inline.** `modules/ModuleInstance.jsx:592`
   (`userSelect:"none"`), plus `modules/NodePill.jsx:91`, `modules/PoolContent.jsx:44`.
   So the plain text you see on a board row (label, field values) is intentionally
   unselectable.
2. **Instance rows / containers are drag sources.** The wrapper carries
   `draggable`/`-webkit-user-drag`. Chromium AND Firefox **suppress native text selection
   and caret placement inside a draggable element / under a draggable ancestor** — the
   exact mechanism already root-caused and fixed for inline chips
   (`docs/pills/InstanceTextblockInlineNode.jsx`, 2026-07-13: arm `draggable` only while
   the radial handle is pressed; place caret from point when an ancestor can't be
   disarmed). Board rows never got that treatment, so their text can't be selected.
3. **Doc prose is re-enabled but only per-block.** `index.css:1030` re-enables
   `user-select:text` on `.doc-editor-content.ProseMirror` / `.textblock-card…`. Single-block
   selection works; **a selection cannot span two sibling mini-textblocks** because each is
   its **own nested ProseMirror editor** (or an `atom` inline node) — a native Range can't
   cross editor boundaries. This is the structural blocker for "highlight the whole bullet
   list."

### A0.1 Priority within Part A (user, 2026-07-16)

**"especially doc stuff isn't text highlighting, like textblocks and mini-textblocks."** The
acute pain is **doc text**, not board rows. Fix these FIRST:
- **Block textblock cards** (`.textblock-card` via `ModuleInstance(renderBody=TextblockCard)`):
  CSS re-enables `user-select:text` on the card, but its wrapping `.instance-row` is
  `draggable=true` → the browser suppresses selection in the whole draggable subtree (CSS can't
  override this). Disarm the textblock row's `draggable` at rest (arm on handle) — this is the
  A3 fix, scoped to renderBody/textblock instances first.
- **Mini-textblock inline chips** (`.itbi-content`): the 2026-07-13 chip fix armed draggable
  on the handle + placed the CARET from point, but **range selection (drag-select) inside the
  chip** and **across sibling chips** still needs verifying/enabling. Same disarm applies.
- Then generalize to board rows (A2/A3) once doc text selection is confirmed in Chromium+FF.

### A1. Audit deliverable

Enumerate every selection/drag-suppression site and classify each **intentional** vs
**accidental**:

| Site | Verdict |
|------|---------|
| `.no-select` toolbar controls, radial handles, `[data-dnd-handle]`, drag grips | intentional — keep |
| `.grid-muted` (during panel drags) | intentional — keep |
| taskList `<label>` checkbox affordance | intentional — keep |
| Instance **label + field text** (`ModuleInstance:592`, NodePill, PoolContent) | **accidental** — see A2 |
| Draggable instance-row / container wrapper suppressing inner selection | **accidental** — see A3 |
| Cross-block doc selection (separate nested editors) | **structural** — see A4 |

Ship the audit as a short table in `client/src/CLAUDE.md` + the fixes below.

### A2. Make instance label/field text selectable

- Drop the blanket inline `userSelect:"none"` on the instance content; scope "no-select"
  to the **drag handle + interactive control chrome** only, not the label/value text.
- Keep number/toggle/select *inputs* behaving normally (they manage their own selection).
- Risk: a click-drag that starts on selectable text shouldn't start a card drag. Gate drag
  start to the **handle** (already the model via `dragHandle`) — a text-drag on the label
  becomes a selection, not a move.

### A3. Arm `draggable` only on the handle (board rows, mirror the chip fix)

- Board instance rows + container shells: set `draggable=false`/`user-drag:none` **at rest**;
  arm it (attribute + `-webkit-user-drag:element`) **only** on `pointerdown` of the radial
  drag handle, disarm on `pointerup`/`dragend`. Identical shape to the 2026-07-13 chip fix.
- For ancestors that must stay drag sources, add the **place-selection-from-point** fallback
  (Firefox) the chip already uses.
- Verify headless in **both** Chromium and Firefox: click-drag across a board label produces
  a real selection; the handle still drags.

### A4. Cross-block doc selection (the enabling primitive for Part B)

The convert flow needs "select N sibling mini-textblocks." Options, in preference order:

- **A4a — single editor, block nodes (preferred).** If the mini-textblocks in a doc are
  **block nodes inside one ProseMirror doc** (not N separate nested editors), a native
  selection already spans them. Audit whether the bullet-list-of-textblocks case renders as
  one editor with block children or as N nested editors; if the latter, this is the real
  root cause and the fix is to render those as block nodes in the host editor. This also
  simplifies A2/A3 (one editor, one selection model).
- **A4b — selection-rectangle fallback.** Where blocks genuinely are separate draggables
  (board cards, canvas), reuse the planned **shift+drag rubber-band multi-select**
  (docket #4, `state/SelectionContext`) so "highlight" = the occurrence multi-select, not a
  text Range. The convert menu then reads the occurrence selection.
- Decide per surface: **doc → A4a** (text Range over block nodes), **board/canvas → A4b**
  (occurrence rubber-band).

**Exit criteria for Part A:** label/field/doc text selectable in Chromium+Firefox; a doc
bullet list can be selected as one Range (A4a) OR as a multi-occurrence selection (A4b);
handles still drag; no regression to the chip caret fix.

---

## Part B — Seamless occurrence conversion

### B1. One data-layer primitive: `convertOccurrence`

A single `CommitHelpers.convertOccurrence(occId, target)` (socket-backed, optimistic) is the
only place conversion logic lives. Everything else (menus, doc flow) calls it.

`target = { role?, kind? }`. Conversion is **structural**, driven by the current vs target
`role`/`kind` (`server/models/Module.js`), not by hardcoded pairs. Children are always
preserved; only *how they're held/rendered* changes.

**Container kind ↔ kind** (doc / board / list / table):
- **doc → board/list:** the doc's `textmap` embeds children via `moduleEmbed` /
  `instanceTextblock*` nodes. Materialize each embedded occurrence into the container's
  `occurrences[]` (ordering = document order), then clear/space the textmap. Children are the
  *same occurrences* — no re-mint, no data loss.
- **board/list → doc:** build a `textmap` of `moduleEmbed` nodes (one per child in
  `occurrences[]` order); keep `occurrences[]` for ancestry (doc kind renders textmap, so no
  double render — mirrors the importer's doc-container shape).
- **board ↔ list:** kind flip only (both render `occurrences[]`); trivial.
- **→ table:** seed `meta.table.columns` from the children's common field bindings; each
  child becomes a row (reuse the Schedule/People Table cell model).

**Role changes** (textblock ↔ instance ↔ artifact): re-stamp `role` (+ `kind`) and reconcile
bindings — e.g. textblock→instance keeps the textmap as the instance body or promotes its
text to the label (see B3).

**Contract:** never mint fresh ids for existing children (preserve `linkedGroupId`, fields,
iteration). Emit `module_updated` + `occurrence_updated`; optimistic first.

### B2. Right-click "Convert to…" on every occurrence

- New shared helper `helpers/conversionOptions.js`:
  `conversionTargetsFor(module) → [{ label, icon, target }]` — the legal conversions for a
  given role/kind (doc↔board↔list↔table for containers; textblock↔instance for leaves; page
  kind swaps for pages).
- Add a **"Convert to ▸" submenu** to each existing `handleContextMenu` builder:
  `modules/ModuleInstance.jsx` (leaves), `modules/ModuleContainer.jsx` (containers),
  `modules/ModulePage.jsx` / `modules/TextblockCard.jsx`. Each item calls
  `convertOccurrence(occId, target)`. This is the "not just for containers" requirement.

### B3. Doc bullet list → instances (the headline flow)

Depends on **A4** (selecting the list). Two entry points, one engine:
- **Doc selection (A4a):** highlight the bullet list / mini-textblocks in a doc → right-click
  → **"Convert selection to instances."** Engine walks the selected block nodes; each
  `listItem` / mini-textblock / paragraph becomes an **instance occurrence** (label = its
  text, or textmap as body if rich), collected into a **new board/list container** dropped
  where the selection was (replacing the selected nodes with one `moduleEmbed` of the new
  container). This realizes "type out a board using a doc page."
- **Occurrence selection (A4b):** same engine, fed by the rubber-band multi-select on
  board/canvas → "Convert N to instances / group into container."
- Engine lives in `helpers/convertSelectionToInstances.js` (pure: nodes/occurrences →
  {container, instances[]} plan), applied via `convertOccurrence` + create helpers so there's
  one code path + it's unit-testable.

### B4. Tests
- `convertOccurrence` unit tests per pair (doc→board→doc round-trips preserve children +
  fields + linkedGroupId; board→table seeds columns).
- `convertSelectionToInstances` pure tests (bullet list → N instances + 1 container; rich
  textblock → instance-with-body; empty/mixed selection).
- Headless: right-click Convert on a container, an instance, a textblock; doc bullet
  list → highlight → convert → board renders the instances.

---

## Sequencing

1. **A1–A3** — highlight audit + label/field selectable + handle-armed drag (Chromium+FF).
2. **A4** — decide doc block-node model (A4a) vs rubber-band (A4b) per surface; make the doc
   bullet list selectable as one unit.
3. **B1** — `convertOccurrence` primitive + tests (container kind swaps first).
4. **B2** — "Convert to ▸" submenu on all four context-menu builders.
5. **B3** — doc-selection → instances engine + flow.
6. **B4** — round-trip + headless coverage; deploy + reseed if any seed shape changes.

## Decisions (answered 2026-07-16)
- **Q2 — RESOLVED.** The right-click menu carries **two** convert entries:
  1. **"Convert in place"** — this occurrence flips role/kind, keeps its identity + children.
  2. **"Convert a copy into…"** — mints a *converted copy* and opens the existing
     **occurrence-picker menu** to choose the destination occurrence to drop it into
     (leaves the original untouched). Both `convertOccurrence` under the hood
     (`{ inPlace: true }` vs `{ copyTo: destOccId }`).
- **Q3 — RESOLVED.** textblock→instance is **smart**: short/one-line text → instance **label**;
  multi-line/rich text → instance **body** (label left empty).

## Open question still to confirm
- **Q1.** In a doc, is the bullet-list-of-mini-textblocks **one editor with block children** or
  **N separate nested editors**? (Decides A4a vs a bigger doc-model change — confirm from code.)
