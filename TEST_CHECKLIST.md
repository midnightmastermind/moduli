# Moduli — Manual Test Checklist (work from 2026-05-18 → 2026-05-19)

Run `npm run dev`. No re-seed is required for any of the items below **except**
the items marked **(RE-SEED)**, which need:
`node --env-file=.env server/scripts/createLiveData.js`.

---

## A. Table container UX (Schedule Table page / any `kind:"table"`)

- [ ] **Delete-row button on every row** — hover any row; a `–` button appears at
      the far right of *that* row (not just the last row). Click it → only that
      row is removed, rows below shift up, content preserved.
- [ ] `–` is disabled (invisible) when only 1 row remains.
- [ ] **+Row strip** — a full-width slim band sits along the bottom of the table
      body with a centered `+`. Click → a new empty row is appended.
- [ ] It visually mirrors the `+Column` strip on the right edge of the header.
- [ ] **Column kebab menu** — open a column's `⋮`. It has labelled sections with
      dividers: **Display**, **Sort**, **Filter**, then **Delete column** (red).
- [ ] **Sort** entry is present and cycles None → Ascending → Descending on click
      (the icon changes ↕ / ▲ / ▼). Sorting reorders rows view-only.
- [ ] **Filter** entry opens the filter picker; **Display** opens the field /
      field-visibility pickers. Long labels truncate with `…`, menu is ~200–280px.

## B. Filter date range picker (toolbar / day-unit filter nav)

- [ ] On a day-unit filter, the old native date input + number spinner are gone,
      replaced by a single **calendar button** showing the date (or range).
- [ ] Click it → a `react-day-picker` calendar pops. Single click = 1-day filter.
- [ ] Click a start day then an end day = a multi-day **range**; the button label
      becomes `May 18 – May 20` and the popover closes.
- [ ] Clicking outside the popover closes it.

## C. Span-aware target scaling

- [ ] Set a goal/tracker with a daily target (e.g. 3/day). With a single day
      selected the progress bar target reads 3.
- [ ] Select a 3-day range → the target scales to 9 (daily × span). Weekly/monthly
      filters still scale by period as before.

## D. Filter-date badge on goals / trackers

- [ ] On a Daily Goals / Accounts instance (anything with a display-type field),
      a small mono badge appears under the label showing the active filter date:
      e.g. `Mon May 19`, `Mon May 19 + 2d` (span), `Week of May 12`, month/year.
- [ ] Regular task instances (no display field) do **not** show the badge.

## E. Command Center behavior + layout

- [ ] Open the Command Center. Start dragging anything → the CC **stays open**
      (no longer auto-collapses).
- [ ] The CC is **horizontally centered** as a card with a shadow/border; the
      area to its left/right is transparent (grid shows through), not a backdrop.
- [ ] CC height is fixed (sized for the Shortcuts tab) and doesn't jump between
      tabs.
- [ ] Drag a **field** or an **operation** pill from the CC onto a doc/grid →
      it is **rejected** (fields/ops are organize-in-place only). Dragging a
      **file/artifact** onto the grid still works.

## F. Polish

- [ ] The linked-copy (chain) badge has a small gap to its left (not flush).
- [ ] Long instance/module labels auto-scroll (marquee) only when they overflow;
      the marquee box has rounded corners matching field pills.

## G. Media section — NEW (board/list instances only)

- [ ] An instance with a **media-role field binding** (role `"media"`) shows a
      media block **under the label and fields** (not as an inline pill).
- [ ] If the media value is set and points to an image → image renders; video →
      `<video controls>`; audio → `<audio controls>`. Capped ~160px tall, rounded.
- [ ] When empty, the block shows a dashed **"Drop media here"** placeholder.
- [ ] **Drag an artifact** (from the manifest tree / CC files) onto the block →
      it highlights blue on drag-over, and on drop the instance's media updates
      to that artifact (persists after reload).
- [ ] The media section does **NOT** appear on: textblock cards, artifact cards
      (doc-looking renderBody), or table cells (`__inCell`) — board/list only.

## G2. Rich occurrence-select picker — NEW

Applies to any **occurrence-type** field (e.g. Movies Watched). Build + 669
client tests green.

- [ ] Open the picker for an occurrence field (compact pill, full input, single
      or multi-select). Each option row is a **card**: poster thumbnail (from the
      referenced occurrence's `role:"media"` field) + bold label + up to 3 of its
      field values — not a bare text line / native `<option>`.
- [ ] If a referenced occurrence has no media, a small link icon placeholder
      shows instead of a broken image.
- [ ] The selected value on a single-select occurrence field also renders as the
      rich card (poster + label) in the trigger button.
- [ ] Multi-select still toggles correctly with the checkbox; add-new still works.
- [ ] **Field name + pill**: occurrence multi-select fields (Watch Movie /
      Listen to Podcast / Online Course) now show the field name as a prefix
      (`Movies Watched:`) and a cyan field-pill chrome on the trigger — not a
      bare/blank outline button. (Single-select occurrence already showed this.)
      NOTE: the "dropdown lets me select anything" part is NOT fixed yet — it's
      a seed/resolver issue (task #8, see handoff).

## H. Seed foundation (no behavior change yet — structural) — (RE-SEED)

- [ ] After re-seed, Command Center Fields/Operations tabs show category columns:
      Fields → Scheduling / Workouts / Nutrition / Finance / Wellness /
      Intellectual / Bills / Display / Library / References.
      Ops → Trackers / Schedule Ops / Day Page Ops / Bill Ops / Library Ops.
- [ ] New fields exist (in their categories): Is Task, Cadence, Day, Every N
      Days, Anchor Date, Next Due, Account, Bill, Subscription.

---

## I. Canvas page (2026-05-19 continuation 2)

- [ ] Open a canvas page (Canvas / Schedule Canvas). The **two stray `0`s** that
      used to render in the top-left corner are gone. (Root cause: `edgeHover`
      number state `0 || 0 || 0 || 0` was rendering as text in React JSX
      guards. Coerced to boolean via `!!(...)`.)
- [ ] Pan-grab (Hand tool) on canvas → minimap appears bottom-left + edge bars
      light up in the pan direction (existing behavior, regression check).
- [ ] **NEW** — scroll the canvas surface via mouse wheel / trackpad → minimap
      appears for ~900ms after the last scroll event + edge bars light up in
      the scroll direction. Red edge when pinned at the world boundary.
- [ ] Drag-over a card onto the canvas near an edge → minimap + edge bar still
      work (regression check; the new scroll handler runs in parallel and
      doesn't overwrite the dragover state).

## J. Daily Question (Daily Toolkit > Intellectual > "Daily Journal")

- [ ] On the Daily Journal instance, the **journalQuestion** display pill
      reads on the same baseline as the sibling input pills (completed
      checkbox / Q text / Answer input / Duration). (Fix: display-only
      `FieldRenderer` branch now wraps in the same column-flex shell as the
      input branch.)
- [ ] After re-seed, the **Daily Question Rotator** op fills the question
      field with one of the seeded reflection questions on grid load. (Fix:
      op no longer requires the Daily Journal to live under the Schedule
      page — it finds it anywhere via `label IS "Daily Journal"`.)
- [ ] Open `node --env-file=.env server/scripts/createLiveData.js` re-seed
      tested at least once before checking the above.

## K. Header chrome (containers / panels / pages)

- [ ] Open any panel: panel header now has a noticeably darker background
      strip + a 1px dark border-bottom + a subtle drop shadow underneath.
- [ ] Open any non-embedded container: container header gets the same
      treatment.
- [ ] Open any page panel (Schedule, Daily Toolkit, etc.): the page-tab row
      gets the same treatment.
- [ ] Embedded doc containers (containers rendered inline inside an Artifact
      doc — e.g. notebook sections, the Tasks Completed container on the day
      page) keep their teal `hexToRgba` accent header — the darker
      override is suppressed via `.embedded-container-header`.

## L. Schedule Canvas

- [ ] After re-seed, a new **Schedule Canvas** page exists alongside
      Schedule + Canvas in the Center Hub panel (Notebook hub pins it third).
- [ ] On grid load, the **Schedule Canvas: Build** op runs and the canvas
      contains one card per schedule task for the active day, stacked
      vertically at `x=60, y=60 + (row * 80)`.
- [ ] The cards are copy-linked to the source schedule task: completing a
      card ticks the corresponding Schedule slot's task (server linked-group
      fan-out).
- [ ] Filter navigate to a different day → the canvas rebuilds for that day
      (`onFilterChange` ancestor="Schedule" trigger).

## M. Day page — Tasks Completed container (template only)

- [ ] After re-seed, every NEW day page (Day Page: Build run for a fresh
      date) contains a doc container labeled **Tasks Completed** below the
      H1 "Day Page - {Date}" heading.
- [ ] The container's body is initially empty (a single empty paragraph).
- [ ] The container's label renders as the embedded H2-ish heading via
      Container.jsx's `embedded` mode styling.
- [ ] (PENDING — see handoff) The body is NOT yet auto-populated with the
      schedule tasks for that day — that's the `Day Page: Build Tasks
      Completed` seed op which is in the next-session backlog.

## N. Table cell media

- [ ] Inside any table cell (Schedule Table), the embedded instance's
      media block is **hidden by default** (regression check — board/list
      instances still surface it inline).
- [ ] Open the column kebab menu (`⋮`) → there's a new "Show media" toggle
      below the field-visibility section. Click to flip → cells in that
      column now surface their occurrence's `role:"media"` field as a
      block under label + fields. Click again to hide.
- [ ] The toggle persists across reloads (stored in `column.showMedia` on
      `meta.table.columns`).

## O. Sort menu on non-table occurrences

- [ ] Click the chevron / settings dropdown on any container header, page
      header, or panel header → the dropdown now has a new "Sort children"
      section below the Filters section.
- [ ] Pick **Label** in the field picker → ascending arrow icon highlights.
      Container/page/panel's direct children re-sort alphabetically by
      label. Reload — sort persists (stored on `occurrence.meta.localSort`).
- [ ] Pick any field (e.g. completed / amount / a date field) → children
      re-sort by that field's value. Numeric / date values sort
      numerically; falsy values group at the bottom on ascending.
- [ ] Click the asc/desc arrow → toggles direction.
- [ ] Click the X next to "Sort children" → sort cleared; children fall
      back to drop order (the `occurrences[]` array order).
- [ ] Sort applies to DIRECT children only — nested
      containers/pages/panels are unaffected by an ancestor's sort.
- [ ] (PENDING) Grid-level sort is not yet wired — see handoff task 16.

## P. lastSeen field on schedule-drop

- [ ] After re-seed, a new "Last Seen" date field exists in the Scheduling
      category column of the Command Center Fields tab.
- [ ] Drag any task into a Schedule slot → on the next render, that
      occurrence's lastSeen field is stamped with today's date
      (operation: Schedule: Stamp Date & Time Slot now writes lastSeen in
      addition to the timeslot label).
- [ ] (PENDING) The occurrence-select chip display config that surfaces
      lastSeen on Movies Watched / Books Read / etc. is not yet wired —
      see handoff task 9.

## Q. Login page redesign

- [ ] Open the app while logged out. The left 2/3 of the viewport shows
      the architecture-diagram background image (`/login_bg.jpg`); the
      right 1/3 contains the login box centered vertically and
      horizontally.
- [ ] The login box logo is the new SVG lockup (mark + "moduli" wordmark
      in ribbon style) — replaces the old `moduli_logo.png`.
- [ ] Resize the window narrow — the right column stops at ~280px so
      the form never compresses below its inputs' width.

## R. Logo gap-fix + infinity-style wordmark

- [ ] `client/public/moduli_mark_clean.svg` displays the infinity-knot
      mark as one continuous gradient ribbon (no visible dashes/gaps).
- [ ] `client/public/moduli_wordmark.svg` displays "moduli" with each
      letter drawn in the same ribbon-stroke style as the mark
      (rounded caps, blue gradient, dark backer for depth, white
      specular sheen on top curves, small interlocking knot between
      `d` and `u`).
- [ ] `client/public/moduli_lockup.svg` shows mark + wordmark together
      in one viewBox.
- [ ] (PENDING) Toolbar header still uses the old PNG — swap-in is
      optional; no functional regression expected when the user wants
      to A/B compare.

## S. Smaller switch inputs

- [ ] Find a boolean toggle field (any instance with a checkbox-variant
      boolean field, OR the Sort-section direction switch, OR the
      Filters-section Active toggle). The track is visibly narrower /
      shorter than before — track is `h-3 w-5` (was `h-4 w-7`), thumb
      is `h-2 w-2` (was `h-3 w-3`).
- [ ] Toggle the switch on/off — animation still slides cleanly to
      both end positions (translate fits the smaller track).
- [ ] On mobile, the switch is still easily tappable inside its
      surrounding pill (parent padding unchanged).

## Y. Grid-level sort with row-major reflow

- [ ] Open Command Center → Grid tab. Between Rows/Cols and Filters,
      a new "Sort panels" section is visible.
- [ ] Pick **Label** in the dropdown → grid panels reflow row-major in
      alphabetical order. Panels with longest labels go to the bottom
      rows. rowSpan/colSpan collapse to 1 (each panel occupies one
      cell).
- [ ] Toggle asc/desc → order flips.
- [ ] Pick a field (e.g. `pages` for Books, or any numeric field that
      panels' modules carry) → panels re-sort by that field's value.
      Numeric values sort numerically; non-numeric fall through to
      string compare.
- [ ] Click the X next to "Sort panels" → sort cleared; panels
      return to their original placement (including any rowSpan /
      colSpan they had before).
- [ ] Reload the app → sort persists (stored on `grid.meta.localSort`).
- [ ] Drag a panel to a different cell → in sort mode the placement
      change is ignored (sort wins). Clear sort first, then drag.

## X. Field-settings chip display config

- [ ] Re-seed: `node --env-file=.env server/scripts/createLiveData.js`.
- [ ] Open Command Center → Fields tab → pick `booksRead` (the
      "Books Read" field) → scroll down in the field detail. Below
      the Find options source, a new "Selected chip display"
      section is visible (only for occurrence-type fields).
- [ ] Section shows two toggles (Label / Media) and a chip-picker
      list of every field on the grid. Two fields are pre-selected
      (Pages, Library) from the seed — they show numbered chips
      "1. Pages" + "2. Library".
- [ ] Open any Books Read multi-select picker (Watch Movie task is
      a sibling; Books Read has its own field on whichever instance
      binds it). Select a book → the selected chip subtitle shows
      `Pages: 320 · Library: book` (or similar), in the configured
      order.
- [ ] Toggle Media off → media slot disappears from the chip. Toggle
      Label off → label disappears, leaving only field-value subtitle.
- [ ] Click "✕ auto" → chipDisplay config cleared. Chips revert to
      the auto-derive heuristic (first 3 non-hidden bindings).
- [ ] Reorder by clicking fields in the order you want them shown.
      Click an already-selected field → it deselects. Re-click → it
      appends at the end.
- [ ] Non-occurrence fields (select / text / number / etc.) do NOT
      show the chip display section (gated on `fieldType ===
      "occurrence"`).

## W. Daily Journal Questions page

- [ ] Re-seed: `node --env-file=.env server/scripts/createLiveData.js`.
- [ ] In the Root tree, open the Library folder. There are now two
      pages inside: "Library" (sortOrder 0) and "Daily Journal
      Questions" (sortOrder 1).
- [ ] Open "Daily Journal Questions" → page contains a single
      container "Reflection Questions" with the 7 reflection question
      instances ("What went well today?", "What did you learn?", etc.).
- [ ] Open the Library page → the same 7 question instances ALSO appear
      there (alongside movies / books / podcasts / courses). They're
      the same physical occurrences — multi-parent rendering.
- [ ] Click into a question on the Daily Journal Questions page →
      edit its label. Reload → the change persists AND the same edit
      appears in the Library.
- [ ] Click 🎲 on the Daily Journal's "Daily Question" display field
      (Q. Daily Question randomize button section) → it picks from the
      same 7 questions you just edited.

## V. Day Page Tasks Completed body-seeding

- [ ] Re-seed: `node --env-file=.env server/scripts/createLiveData.js`.
- [ ] Navigate Schedule to today (toolbar or Schedule's local nav). The
      Day Page Build op auto-creates "Day Page - <today>" in the Day
      Pages folder (pinned as an inactive tab on the Notebook hub).
- [ ] Open that day page → it contains an H1 "Day Page - <today>" plus
      a "Tasks Completed" embedded doc container (initially empty).
- [ ] Tick a schedule task complete (`completed` boolean → true) — the
      onChange completedFieldId trigger fires Build Tasks Completed,
      and the container's body now has a moduleEmbed pointing at that
      task. Untick the task — the moduleEmbed is removed on the next
      run (which fires from the same onChange trigger).
- [ ] Repeat for several tasks — each completed task shows as a
      module-embed row in the container.
- [ ] Navigate Schedule to a different day — the day page for that
      date gets its own Tasks Completed body (independent per-date).
- [ ] (PENDING) The list is NOT yet sorted by timeslot. For perfectly
      time-ordered rendering, a SORT_BY primitive or per-slot iteration
      strategy is needed — filed as TODO in the op header comment.

## U. Daily Question 🎲 randomize button

- [ ] Re-seed: `node --env-file=.env server/scripts/createLiveData.js`.
- [ ] Open the Daily Journal instance (under Daily Toolkit → Intellectual,
      or its Schedule copy). The "Daily Question" display field shows the
      currently-picked question text.
- [ ] To the right of the question text, a 🎲 button is visible (and only
      visible because the journalQuestion field has `meta.randomizable:
      true` + a resolved candidate pool > 1).
- [ ] Click 🎲 → a different question label appears. Click again — keeps
      picking randomly from the 7 questions in the Library container with
      `library: "question"`.
- [ ] Reload the app — the question persists (was written to the
      occurrence's field value, not just to memory).
- [ ] The Daily Question Rotator op still fires on filter change /
      onLoad and may overwrite the picked value next time you change
      filters — this is intended; the button is a manual re-roll.
- [ ] (PENDING) The "Daily Journal Questions" page (manage the question
      pool from a dedicated page) is still pending — handoff task 7 part 2.

## T. QuickAddMenu field picker on New X

- [ ] Open a container's QuickAddMenu (+ button in the container
      header). Click "New instance" → if at least one field exists
      on the grid, a new "Add fields" step appears (back chevron at
      top, count header "0 selected", search input).
- [ ] Tick a few fields → the count header updates. Type in the search
      input → list filters by field name.
- [ ] Click "Create" (blue button in the footer) → the new instance is
      created with those fields pre-bound (`role:"input", hidden:false`).
      Verify by opening the instance's Fields tab — the picked fields
      appear there.
- [ ] Click "Skip" instead → instance is created with no field bindings
      (back-compat path).
- [ ] Open a panel/page QuickAddMenu's "New X" → picker is SKIPPED
      (only instance role uses it; containers/panels/pages don't carry
      field bindings).
- [ ] On a brand-new grid with no fields yet → picker is also skipped
      (handleClickNew short-circuits to immediate creation).

## NOT YET DONE — pending next session (see handoff in `please continue.txt`)

These were requested but are **not** implemented yet; do not expect them to work:

- Daily Toolkit → folder + 11 wellness pages (Physical / Physical-Fitness /
  Physical-Nutrition / Intellectual / Emotional / Social / Spiritual /
  Occupational / Financial / Environmental / Creative).
- Bills page (Subscriptions / Utilities / Insurance / Loans / Other) + bill
  instances with cadence/day/anchor + `Bill: Compute Next Due` /
  `Schedule Due: Seed` ops.
- Task cleanup: Pay Bill `billRef`, Cancel Subscription `subscriptionRef`,
  amount-tasks `accountRef`, remove "Renew car insurance" / "Pay utility bill".
- Goal granularity rebuild + tracker label renames + nutrition daily-display.
- Field-settings config for WHICH fields the selected occurrence chips show
  (the picker now shows everything; the per-field display config is pending).
- New `lastSeen` date field stamped on schedule-add (extend `Schedule: Stamp
  Date & Time Slot`), seeded onto our occurrence-select fields.
- "Add item" buttons (QuickAddMenu / New X): let the user pick which fields to
  bind to the new item so tasks can be created quickly with fields attached.
