# Occurrence Search — design (2026-07-26)

Per user direction (this session): a magnifying-glass button in the panel header that expands
into a textbox and shows a live dropdown of matching occurrences. Picking one opens the page the
occurrence lives on **in that panel** and scrolls to it. Plus a second, page-scoped search in the
page header that only searches occurrences on that page.

Matching covers labels, **ancestor locations**, **field names and values**, and **textblock /
doc body text** — "it shouldn't just be for labels".

---

## 1. Surfaces

| | Panel header search | Page header search |
|---|---|---|
| Where | Left of the Root-tree (Folder) button in `ModulePanel`'s page header row | Left of the filter funnel (`HeaderChevron`) in `ModulePage`'s header |
| Scope | Every occurrence in the current grid | Descendants of that page occurrence only |
| On pick | Resolve nearest ancestor page → pin + activate it **in this panel** → scroll + flash | Scroll + flash (no page switch) |

The panel header carries no filter button today (panel-level filter UI is deliberately suppressed
— `ModulePanel.jsx` ~line 906), so "left of the filter button" resolves to left of the Root-tree
toggle there. Header order becomes:

```
[radial handle] [Local tree] page label [🔍] [Root tree] [stack] [fullscreen]
```

Both surfaces render the same component. Collapsed it is an icon button; clicking expands it into
an input in place; the dropdown opens on the first keystroke.

---

## 2. Engine — `helpers/occurrenceSearch.js` (new, pure)

```
buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId, cache })
  → { entries: SearchEntry[], byId: Map }

searchOccurrences(index, query, { scopeRootId = null, limit = 50 })
  → { results: SearchResult[], total }
```

Pure functions, no React, no socket. Unit-testable in isolation; this is where the behavior lives.

**Hard constraint — no domain knowledge.** The engine reads occurrences, modules, fields and
their values. It must never recognize a label prefix, a container kind, a page name, or a
`meta` flag as meaning something ("this is a schedule", "this is a day column", "this is a
goal"). Every capability here is data-driven: a date is indexed because it is a date, a field
value because it is a field value. If a behavior seems to need "but only for X", the answer is a
field or an operation, not a branch in the search.

### 2.1 `SearchEntry`

```js
{
  occId,
  label,            // what the renderer shows
  pathLabels,       // ["Routines", "Physical"] — root-first ancestor labels
  ancestorIds,      // for scoping the page search
  pageOccId,        // nearest role:"page" ancestor (inclusive), null if none
  role, kind,       // for the row's type icon
  haystacks: {
    label:  "drink water",
    path:   "routines physical",
    fields: "water 16oz completed yes time slot 6:00am",
    body:   "…plain text of textmap…",
    dates:  "2026-07-25 jul 25 july 25 july 25th friday fri 2026",
  },
  fieldPairs,       // [{ name, text }] — used to build the "why it matched" line
}
```

All haystacks are lowercased once at index time. The query is lowercased once per search.

### 2.2 What feeds each haystack

**Label** — `occurrence.label ?? module.label`. Nothing else. The per-placement override wins over
the template label; the search knows no other label rules and no occurrence kinds.

**Path** — each ancestor's label resolved the same way, root-first. Ancestors come from the
`occurrences[]` reverse map (`helpers/dragHitTesting.buildParentMap`) with a `parentId` fallback,
matching every other ancestor walk in the codebase.

**Dates** — for each ISO date found on the occurrence, expand into aliases: `2026-07-25`,
`jul 25`, `july 25`, `july 25th`, `friday`, `fri`, `2026`. Two generic sources, both pure data:
any value in the occurrence's own `filterOverride` that parses as a date, and any date-typed
field value.

This is what makes `9pm july 25` work, and it is deliberately **not** label-based. Stored labels
carry whatever text they were stamped with, in whatever format, and can go stale relative to the
occurrence's own date; the alias index reads the date itself. The search never inspects label
text for meaning, never recognizes a container kind, and has no notion of what a date on an
occurrence signifies — a date is a date.

**Field names + values** — for every entry in `occurrence.fields`:
- the field's `name` is indexed (so "protein" finds everything carrying a Protein field);
- the value is stringified by type:
  - number/duration → `value` and `value+unit` (`42`, `42g`)
  - boolean → `yes` / `no`
  - date → the date-alias expansion above
  - select / multi-select → the option values, joined
  - **occurrence-ref (single or array) → the referenced occurrence's label**, never the raw id
    (a Meal indexes "Tortillas, Cheese"; matching UUIDs is useless)
  - text → verbatim
- Values that are `{ value, flow }` are unwrapped first (arrays pass through — see the 2026-07-12
  `extractValue` bug).

**Body** — plain text of `occurrence.textmap` (textblocks, doc containers) and of any free-text
cells in `occurrence.meta.table.cells`. `plainText()` already exists in `helpers/tableCells.js`;
it lifts into its own small module (`helpers/textmapText.js`) and `tableCells` imports it, so a
search helper doesn't depend on table code. Capped at **10,000 characters per occurrence** so one
imported Wikipedia article can't dominate the index.

### 2.3 Matching

The query is split on whitespace into terms. **Every term must match somewhere** in the entry
(any haystack). AND-of-terms is the whole mechanism behind "add search terms for the container
label it's in":

- `water` → every Drink Water copy, the Water Intake tracker, the water bottle board option
- `water 9:00am` → only the copy under the 9:00am slot
- `9pm july 25` → the occurrence labelled 9:00pm whose ancestor carries the July 25 date

Substring matching, case-insensitive. No fuzzy matching in v1 — with AND-of-terms, fuzz produces
more noise than help.

### 2.4 Ranking

Each term records its **best tier** on that entry; the entry's score is the sum. Lower is better:

| Tier | Source |
|---|---|
| 0 | label, prefix match |
| 1 | label, substring |
| 2 | field name or field value |
| 3 | ancestor path or date alias |
| 4 | body text |

Ties break by ancestor depth (shallower first), then alphabetically by label. Stable and
deterministic — no recency or click-weighting in v1.

Tiering is load-bearing: without it, typing "water" puts every paragraph that mentions water above
the actual Drink Water item.

### 2.5 What is excluded

- `role: "panel"` occurrences — grid scaffolding, not content.
- Occurrences whose module is missing (orphans).
- Occurrences from another grid (`occ.gridId !== gridId`).

**Feed copies are NOT excluded.** An occurrence carrying `meta.feedSourceId` lives on a real board
page; excluding it would mean an item you can see on a board isn't findable. Duplicates are
handled by showing every match with its location, per the user's direction.

### 2.6 Caching

Building the body-text haystack is the expensive part. Per-occurrence entries are cached in a
module-level `WeakMap` keyed on the **occurrence object identity** — a write swaps the identity of
only the occurrences that changed, so a rebuild re-extracts only those and reuses the rest. The
assembled index is memoized against `occurrencesById` identity. The index is built lazily on the
first keystroke, never at mount.

---

## 3. `ui/OccurrenceSearch.jsx` (new)

```jsx
<OccurrenceSearch
  scopeRootId={null}          // null = whole grid; a page occId = that page's subtree
  onPick={(occId) => …}
  placeholder="Search occurrences…"
/>
```

- **Collapsed**: a `Search` (lucide) icon button sized like its header neighbors.
- **Expanded**: the input grows in place; the header label shrinks to make room (`flex` already
  handles this — the label span is `flex: 1, minWidth: 0` with an `AutoMarquee`).
- **Dropdown**: portal-rendered at `position: fixed` anchored to the input, matching the
  `HeaderDropdown` / `QuickAddMenu` pattern (both already solve clipping by `overflow:hidden`
  ancestors). Repositions on scroll rather than closing — the lesson from the 2026-06-09
  QuickAddMenu fix.
- **Rows**: type icon (`helpers/moduleIcons.getModuleTypeIcon`) · label with matched span
  highlighted · muted `Page › Container` path · and, when the match came from anything other than
  the label, a third muted line showing the matching fragment with the term highlighted:

```
Drink Water
  Routines › Physical
Greek Salad
  Routines › Eat
  Protein 42g · Calories 520
Anything you do can be measured
  Viafluere › About
  …track what you actually did, so "I ran ✅ for 25…"
```

- Capped at 50 rows with a `+N more` tail.
- **Keyboard**: ↑/↓ move, Enter picks, Escape closes (collapse + clear). Outside mousedown closes.
- Debounced 120ms between keystroke and re-query.

---

## 4. Opening a result

Extract the pin/activate/jump sequence that already exists inline in
`ui/AssistantDrawer.jsx` (`PanelPickCard.openInPanel`) into a shared
`helpers/openOccurrenceInPanel.js`:

```
openOccurrenceInPanel({ occId, panelOccurrence, ...maps, dispatch, socket })
```

1. Walk up to the nearest `role: "page"` ancestor (inclusive).
2. If that page isn't already in `panelOccurrence.occurrences[]`, pin it
   (`CommitHelpers.pinPageToPanel`).
3. `CommitHelpers.updateView({ ...view, activeOccurrenceId: pageOccId })` on the panel's view.
4. `jumpToOccurrence(occId)` — which already retries after a page-switch grace window.

The panel search calls this. The page search calls `jumpToOccurrence(occId)` directly, since the
page is already open. AssistantDrawer is migrated to the shared helper in the same pass (one
implementation, not two).

**Filtered-out results**: an occurrence hidden by the active filter cascade isn't in the DOM, so
`jumpToOccurrence` returns false. Both surfaces surface that as a toast — "Bike Ride is on
Schedule but hidden by the current filter" — rather than appearing to do nothing.

---

## 5. Page-header × (close page)

Small related ask, same file. `ModulePage`'s header gets an `X` button to the right of the page
name that closes the page out of its panel. `ModulePanel` already owns `closePage(occId)` (it
backs the manifest tree's `page-tree-close-btn`); it just needs threading down as an
`onClosePage` prop through `<Page>`. The button follows the existing reveal-on-hover pattern used
by the tree's close button. No new state, no server change.

---

## 5b. De-schedule the renderers (folded in, per user)

The rule the search engine now states explicitly ("no domain knowledge") is a project-wide rule.
A sweep of the client and the generic server code found four places that break it. Seed files
(`createLiveData.js`, `createDefaultUserData.js`, `liveSystemBuilders.js`) are excluded — they
*define* the schedule as data, which is the correct place for it.

| # | Site | Violation | Fix |
|---|---|---|---|
| 1 | `modules/ModuleContainer.jsx:46-93` | `SCHEDULE_LABEL_PREFIX = "Schedule - "` — `computeScheduleColLabel` string-matches a label prefix to decide whether to recompute a header from its date filter | Delete both. Header renders `occurrence.label ?? module.label`. A seed op stamps `occurrence.label` per-placement via the existing `UPDATE_ITEM_LABEL` effect + `$activeDateRelativeLabel`, exactly as the Trackers containers already get "Today's Physical" |
| 2 | `modules/pages/PageBoard.jsx:39-57, 178-181` | `WEEKDAY_RAINBOW` + `weekdayColor()` — the generic board renderer derives a weekday from a child's date field and applies hardcoded Mon-red…Sun-violet tints | Delete. Same class as the timeslot-passed tint removed 2026-06-03. If the colors are wanted, an op writes `ownStyle` on the child |
| 3 | `ui/PomodoroTimer.jsx:33-44, 173` | `currentSlotLabel()` mints `"9:00am"` solely to string-match `meta.slotLabel` on slot containers | Verify first: the Pomodoro: Start op moved to field-based day-col + slot resolution on 2026-07-14, so `slotLabel` may be vestigial. If unread, delete the helper and the transaction key; if still read, the op switches to the timeslot FIELD (the 2026-07-20 alarm pattern) |
| 4 | `helpers/alarmOps.js:52` | `{ left: "label", comparator: "IS", right: "Schedule" }` — the alarm pipeline builder finds its destination page by literal name | Resolve from a seeded id. `grid.meta.scheduleFieldIds` already carries the field ids; extend it with the page occurrence id and read that. Server twin `makeAlarmOp` changes in lockstep — **keep the two builders in sync** |

Naming-only, no behavior change, cleaned as we pass through: `dropHandlers.js` locals
`dayColOcc` / `copyDayColOcc` / `ccDayColOcc` (all results of the generic
`findFilterOverrideAncestor`).

#1 and #2 change what renders. #1 leaves those headers showing their stamped label until the
stamping op runs, so the op ships in the same pass and a reseed is required. #2 removes the
weekday tints outright.

## 5c. "Snap the filter to today on first load of the day" (folded in, per user)

**Why it's needed.** The full_state bootstrap (`state/bindSocketToStore.js:161-186`) fills
`grid.activeFilterValues` only for fieldIds that have no value, and deliberately never overwrites
an explicit one — then persists it. So the first navigation pins that date permanently and the
grid still shows yesterday when you open it the next morning.

**Blocker to fix first — `SET_FILTER` is half-wired.** `operationActions.js:3226` pushes a
`SET_FILTER` effect; the handler (`bindSocketToStore.js:1242`) dispatches `setFilterNavAction`;
the reducer's `SET_FILTER_NAV` (`masterReducer.js:465`) writes **only** `filterNavState` — the nav
widget. The cascade (`isOccurrenceVisible`) reads `grid.activeFilterValues`. An op can therefore
move the date display today without filtering anything.

Fix: the `SET_FILTER` effect handler also patches `grid.activeFilterValues[fieldId]`
(`updateGridAction` + `safeEmit("update_grid", …)`), mirroring the bootstrap's own write. The
existing "skip if unchanged" guard stays — it is what keeps an onLoad op from looping.

**The op** (seed data, no new action types):

- Name: `Grid: Snap Filter To Today`, `triggerTypes: ["onLoad"]`, priority ahead of the trackers
  so they aggregate against the right date.
- Marker: a seeded hidden occurrence carrying a date field ("Last Opened"). There is no op action
  that writes `grid.meta`, and adding one is more surface than this needs — an occurrence field is
  a first-class op write already.
- Pipeline: FIND the marker (picker-direct `$allItemsById.<id>`) → IF its date is NOT
  `SAME_DAY $today` → `SET_FILTER { fieldId: <date field>, value: $today }` + UPDATE the marker to
  `$today`.

Same-day reloads therefore leave the filter alone: navigate to July 20, reload, you stay on
July 20. Open it the next morning and it snaps to today, once.

## 6. Testing

Pure-helper tests (`__tests__/occurrenceSearch.test.js`):
- label prefix ranks above label substring ranks above body text
- AND-of-terms: `water 9:00am` matches only the copy under that slot
- date aliases: `july 25`, `jul 25`, `2026-07-25` all match an occurrence carrying that date,
  from a `filterOverride` value and from a date-typed field value alike
- a date alias on an ANCESTOR is reachable from its descendants (the location-terms case)
- field name match (`protein`) and field value match (`42g`)
- occurrence-ref field indexes the referenced label, not the id
- `scopeRootId` restricts to a page's subtree
- panels excluded, feed copies included
- WeakMap reuse: rebuilding with one changed occurrence re-extracts only that entry

Component tests (`__tests__/occurrenceSearch.ui.test.jsx`): expand on click, dropdown on
keystroke, ↑/↓/Enter selection, Escape collapses and clears.

De-schedule (§5b): a regression test asserting no client source file matches
`/SCHEDULE_LABEL_PREFIX|computeScheduleColLabel|WEEKDAY_RAINBOW/`, so these can't come back;
`ModuleContainer` renders `occurrence.label` over `module.label` (existing behavior, now the only
rule); `alarmOps` builds its FIND from a configured id, not the string "Schedule".

Snap-to-today (§5c): `SET_FILTER` effect patches `grid.activeFilterValues` **and**
`filterNavState`; the unchanged-value guard still short-circuits; a behavioral test in
`liveOpsBehavioral` — marker dated yesterday → onLoad sweep moves the filter to today and stamps
the marker; marker dated today → no writes at all.

Headless verification on the reseeded Poms grid: panel search "water 9" → the slot copy → panel
switches to that page and the row flashes; page search on Routines finds a body-text match; the ×
closes the page out of the panel; day-column headers still read their date after the stamping op
runs; opening with a stale marker lands on today.

---

## 7. Out of scope (v1)

- Fuzzy / typo-tolerant matching.
- Recency or frequency weighting of results.
- Searching operations, fields-as-entities, or templates (this searches **occurrences**).
- A global (grid-wide, not panel-local) search surface in the toolbar.
- Persisting recent searches.
