# Deep UI Sweep (desktop + phone, accessibility, clarity, performance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (desktop first, phone included in every area) Every button, menu item and input in Moduli is exercised — every field type in every place it renders, on desktop and on a phone — and anything that is broken, inaccessible, confusing or slow is fixed or reported with a measurement.

**Architecture:** A checked-in Playwright harness (`tools/uisweep/`) replaces the one-off `_*.mjs` probes. It has three parts: a **session** (phone or desktop, touch, CPU throttle, skin, writes blocked unless a run opts in), a **crawler** that opens a surface, finds every interactive element in it, activates each one and records what happened, and **checks** (on screen, hit-testable, tap size, contrast/ARIA via axe, Escape, focus, no sideways scroll, timings). A **field matrix** drives every field type × variant × render context. Results land in one report, `docs/ui-sweep-2026-11-03.md`; each defect becomes a test-first fix.

**Tech Stack:** Playwright 1.x (already at repo root), `axe-core` 4.10.2 (new root devDependency, injected into the page), `node:test` for the harness's own unit tests, vitest for app fixes.

**Spec:** the user's asks, 2026-11-03 14:07–14:09 (CLAUDE_CHAT.md): *"another sweep … making sure everything works, is accessible, and easy to understand … focus on mobile versions … i really need the ui to all work and performance especially via the ui tested"* · *"alot of stuff missed in that original checklist/probed (found alot of things broken) so this should be a deeper sweep. make sure to test all types of each input and all buttons and menus. make sure its easy to understand and not too complicated for the user."* The previous sweep is `docs/ui-sweep-2026-10-18.md` (62 surfaces). Use it as a list of places to look, not as proof that they work.

## Global Constraints

- Viewports: desktop **1440×900**; phone **390×844** portrait and **844×390** landscape, `hasTouch: true`, `isMobile: true`, driven with **touch** (`page.touchscreen.tap`, CDP touch events for swipes) — never a mouse on the phone runs.
- Phone runs also at **4× CPU throttle** (CDP `Emulation.setCPUThrottlingRate {rate: 4}`) for every timing.
- Skins: the default skin and **Terminal** (`localStorage["moduli-skin"]`, no grid write). The user runs Terminal.
- Grids: **test grid 2** for anything that writes (create, delete, edit), with every probe row cleaned up through the app's own events. **poms grid read-only**: writes blocked (Task 1). Never step poms' toolbar date unpaired.
- Browsers: Chromium for the crawl; **Firefox** (the user's browser) re-runs every surface that failed or was fixed.
- Hard fails: an element that does nothing when activated (no DOM change, no request, no navigation, no focus change); a page error; a menu or popup partly off screen; sideways scroll on the phone; tap target **< 24px** on the phone (WCAG 2.5.8); axe **critical/serious** violation; Escape not closing a popup; a popup that does not return focus to its trigger.
- Soft fails (fix unless there is a reason recorded in the row): tap target < 32px; hover-only control with no touch path; an icon-only button with no `aria-label`/`title`; a destructive action with no confirm or undo; jargon in visible copy (see Task 2's word list).
- Performance budgets (phone, 4×): opening any menu/popup ≤ **250 ms** tap → painted; a field pick → value shown ≤ **250 ms**; scroll ≤ **150 ms/step** median, **≤ 400 ms** worst, per long board (People Table is 590 ms today); longest main-thread freeze after rows are on screen ≤ **3 s** (7 s today). Desktop: menus ≤ 100 ms. A budget that cannot be met in the sweep becomes a reported item with the measurement, never a silent pass.
- Every fix: a failing test first, then the fix, then an A/B (revert the fix, show the test fails — assert the revert landed). Client-only deploys unless server code changed. One commit per fix.
- Copy rules (from `CLAUDE.md`): name things by what they create ("Board container"), say "board" not "list", no tool names or ids in visible text.

## Review Focus

1. **Touch has no hover.** Anything revealed on hover (the row "+", insert gaps, a chip's handle, the table column kebab, seam swap) must have a touch path or a stated reason. Expected: the phone run lists each hover-only control and either reaches it by tap or records why not. Test: the crawler's `hoverOnly` report (Task 3) is part of the phone run's output.
2. **Same control, different place.** A field works in the row pill and breaks in the form, the table cell or the doc pill (today's select-unpick bug was exactly this). Expected: every type × context cell in Task 5's matrix passes set, change, clear and keyboard. Test: the matrix itself.
3. **Selected vs. hovered vs. focused look different in Terminal.** Expected: the chosen option, the hovered option and the keyboard-focused option are visibly different in both skins. Test: Task 5 screenshots the open list in Terminal with one option hovered and one chosen, and asserts their computed backgrounds/marks differ.
4. **The on-screen keyboard covers the input.** Expected: on the phone, a focused input inside a bottom sheet stays visible (`visualViewport` shrinks by ~300 px). Test: Task 4 simulates a 300 px keyboard (`visualViewport` override via CDP `Emulation.setVisibleSize` is not enough; set the window height to 544 and re-check the focused input is inside the viewport).
5. **The boot snapshot holds clicks.** During the read-only snapshot, clicks are held. Expected: the harness never records a held click as "does nothing". Test: `session.ready()` waits for `[data-testid="snapshot-pill"]` to be gone and for the load sweep to finish (`window.__loadDone` or 12 s settle as `_build.mjs` does), and a crawl started earlier refuses to run.

---

## File Structure

```
tools/uisweep/
  session.mjs        open(opts) → { page, browser, ready() }: viewport/touch/throttle/skin/grid/LOCALBUILD, writes blocked
  writeGuard.mjs     WRITE_EVENTS, READ_EVENTS; init script that drops socket write frames and counts them
  checks.mjs         pure + page helpers: onScreen, hitTarget, tapSize, noSideScroll, escapeCloses, focusReturns, runAxe
  crawl.mjs          crawlSurface(page, surface) → Finding[]: find, activate, classify every control in a surface
  timing.mjs         timeTapToPaint(page, locator), scrollSteps(page, scroller, n), longestFreeze(page, ms)
  report.mjs         appendRows(file, findings) — the sweep report table
  surfaces.mjs       SURFACES: [{ id, area, name, open(page, ctx), close?, writes? }]
  fieldMatrix.mjs    FIELD_CASES × CONTEXTS → cases; driveFieldCase(page, case)
  run.mjs            CLI: node tools/uisweep/run.mjs --area toolbar --vp phone --skin terminal [--grid "test grid 2"]
  __tests__/*.test.mjs   node:test for the pure parts
docs/ui-sweep-2026-11-03.md   the report (Task 2 creates it)
```

---

### Task 1: The session and the write guard

**Files:**
- Create: `tools/uisweep/session.mjs`, `tools/uisweep/writeGuard.mjs`, `tools/uisweep/__tests__/writeGuard.test.mjs`
- Modify: `package.json` (root): devDependency `axe-core@4.10.2`; script `"uisweep": "node tools/uisweep/run.mjs"`; `.gitignore` must NOT ignore `tools/uisweep/` (the root ignores `_*.mjs` — check)

**Interfaces:**
- Produces: `open({ vp: "desktop"|"phone"|"phone-land", throttle = vp !== "desktop" ? 4 : 1, skin = "default"|"terminal", grid = "test grid 2", allowWrites = false, browser = "chromium"|"firefox", localBuild }) → Promise<{ browser, page, ready(), blocked() }>`. `ready()` resolves when panels are on screen, the snapshot pill is gone and the load has settled. `blocked()` returns the socket events the guard dropped.
- Produces: `WRITE_EVENTS: Set<string>` (every `socket.emit` event that changes data — derive the list by grepping `safeEmit(` / `socket.emit(` event names in `client/src`, then subtract `READ_EVENTS`), `READ_EVENTS: Set<string>` (`request_full_state`, `join_grid`, `join_grid_quiet`, `feed_claim`, `get_undo_state`, `refresh_session`, `link_preview`, `link_harvest`, `import_plan`, `page_reader`), `guardScript(allow: boolean) → string` (an init script that wraps `WebSocket.prototype.send`, parses socket.io frames `42[...]`, drops writes and pushes their names to `window.__blockedWrites`).
- Auth: reuse `_mkauth.mjs`'s token shape (`moduli-token`, `moduli-userId`, `moduli-gridId` in localStorage). The grid is resolved by name at open.

- [ ] **Step 1: Failing tests** — `writeGuard.test.mjs`: `parseFrame('42["update_occurrence",{"occurrence":{"id":"x"}}]')` → `{ event: "update_occurrence" }`; `isWrite("update_occurrence") === true`, `isWrite("request_full_state") === false`; every event name in WRITE_EVENTS appears somewhere in `client/src` (read the files) — or the list has drifted; WRITE_EVENTS ∩ READ_EVENTS is empty.
- [ ] **Step 2:** `node --test tools/uisweep/__tests__/` → FAIL (module missing).
- [ ] **Step 3:** Implement `parseFrame`, `isWrite`, the two sets, `guardScript`, and `open()` (start from `_build.mjs`'s `open`, add `isMobile/hasTouch/deviceScaleFactor: 3` for phone, the CDP throttle, the skin key, the guard init script).
- [ ] **Step 4:** Tests pass. Then a live check: open poms grid on the phone, tick a row's Completed switch, assert `blocked()` contains `update_occurrence` and Mongo's `updatedAt` for that row did not move (read it before and after with a one-off query).
- [ ] **Step 5:** Commit `chore(uisweep): session + write guard`.

### Task 2: Checks, timing, the report and its rubric

**Files:**
- Create: `tools/uisweep/checks.mjs`, `tools/uisweep/timing.mjs`, `tools/uisweep/report.mjs`, `tools/uisweep/__tests__/checks.test.mjs`, `docs/ui-sweep-2026-11-03.md`

**Interfaces:**
- Produces (`checks.mjs`): `rectOnScreen(rect, vp) → {ok, offBy}`; `tapSizeVerdict(w, h) → "ok"|"small"(<32)|"fail"(<24)`; `jargonHits(text) → string[]` (word list: `occurrence`, `module`, `instance`, `textmap`, `feed`, `pipeline`, `predicate`, `copylink` (as one word), `$`, raw ids matching `/[A-Za-z0-9_-]{12,}/` — excluded inside the Command Center's Operations editor, which is a power tool); page helpers `hitTarget(page, el)` (elementFromPoint at the centre is the element or inside it — compare element IDENTITY, not text), `noSideScroll(page)`, `escapeCloses(page, popupSel)`, `focusReturns(page, triggerSel)`, `runAxe(page, rootSel) → { critical, serious, moderate }` (inject `node_modules/axe-core/axe.min.js`, `runOnly: wcag2a, wcag2aa, wcag22aa`).
- Produces (`timing.mjs`): `timeTapToPaint(page, locator, changedSel) → ms` (time from the tap to the first rAF where `changedSel` exists/changes), `scrollSteps(page, scrollerSel, n = 40, dy = 400) → { medianMs, worstMs, totalMs }`, `longestFreeze(page, windowMs) → ms` (rAF gap).
- Produces (`report.mjs`): `appendRows(file, findings)` writing `| # | Surface | Control | Desktop | Phone | A11y | Clarity | Perf | Notes |` rows; marks ✅ / 🛠 (commit) / ⚠ (why).
- The report starts with the rubric: **Works** (did what its label says, no error) · **Reachable** (on screen, tappable, ≥24px, touch path) · **Accessible** (axe clean, labelled, Escape, focus) · **Clear** (label says what it does, no jargon, empty states say what to do next, destructive things confirm or undo, the common task is ≤ 3 taps from where you are) · **Fast** (the budgets).

- [ ] **Step 1: Failing tests** — `rectOnScreen({x:-3,y:10,width:50,height:20},{width:390,height:844})` → `{ok:false, offBy:3}`; `tapSizeVerdict(20,40)` → `"fail"`, `(28,40)` → `"small"`, `(32,32)` → `"ok"`; `jargonHits("Add occurrence here")` → `["occurrence"]`; `jargonHits("Board container")` → `[]`; `jargonHits("p4sq3tf2ghse")` → one hit.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; also run `runAxe` once on poms' desktop load and record the baseline counts in the report header.
- [ ] **Step 5:** Commit `chore(uisweep): checks, timing, report rubric`.

### Task 3: The crawler — every button and menu item, activated

**Files:**
- Create: `tools/uisweep/crawl.mjs`, `tools/uisweep/__tests__/crawl.test.mjs`

**Interfaces:**
- Consumes: Task 1 `open`, Task 2 checks.
- Produces: `classifyOutcome(before, after) → "opened"|"changed"|"navigated"|"wrote"|"nothing"|"error"` where `before/after` are `{ domHash, url, focused, popupCount, blockedWrites, errors }` snapshots; `controlsIn(page, rootSel) → Control[]` (`button, [role=button], [role=menuitem], [role=option], [role=tab], [role=switch], a[href], input, select, textarea, [contenteditable=true], [data-radix-collection-item]`, each with label = aria-label ‖ title ‖ text, rect, and `hoverOnly` = invisible until its parent is hovered); `crawlSurface(page, surface, { depth = 2 }) → Finding[]` — opens the surface, snapshots, activates each control (tap on phone, click on desktop), classifies, runs the checks on whatever opened, recurses into what opened up to `depth`, then restores (Escape, re-open) before the next control. Skips controls whose label matches `/delete|remove|log out|disconnect|reset|clear all/i` unless `surface.writes` and the grid is test grid 2 — those are run once, deliberately, in Task 9.
- **"nothing" is the defect class the last sweep missed:** a control whose activation changes no DOM, no URL, no focus, opens nothing and sends nothing. Each one is a row.

- [ ] **Step 1: Failing tests** — `classifyOutcome` over hand-made snapshots: same hash + no write + same url → `"nothing"`; popupCount +1 → `"opened"`; a blocked write → `"wrote"`; an error → `"error"`. And a fixture page (an HTML string loaded with `page.setContent`) with one working button, one dead button and one hover-only button: `crawlSurface` returns exactly `[ok, nothing, ok+hoverOnly]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `chore(uisweep): crawler`.

### Task 4: The surface catalogue

**Files:**
- Create: `tools/uisweep/surfaces.mjs`, `tools/uisweep/run.mjs`

**Interfaces:**
- Produces: `SURFACES` with `area` ∈ `toolbar | commandCenter | radial | settings | header | add | context | docs | drawers | viewers | canvas | table | graph | layout | phone | sharing | account | forms | vr-web`. Start from the 62 rows of `docs/ui-sweep-2026-10-18.md` and add everything shipped since 10-18 (read CLAUDE.md 10-19 → 11-03): the phone PanelPicker and side drawer (filters + date nav inline), phone headers, the field "+" menu on a row, field presets in the add-item picker, button fields + their forms (New task / New movie …, Include boxes), the filter multi-pick and Show switch, lock in place + radial tooltips, Up one level, export to Markdown, the cover radial items, the Jellyfin player (Play, Play next unwatched), search sources keys, the Scheduled field, the row-layout editor drag, the snap bar on mosaic grids, the VR control panel page (`/?office`) at phone size.
- `run.mjs --area <a> --vp desktop|phone|phone-land --skin default|terminal [--browser firefox] [--grid <name>] [--writes]` crawls each surface in the area and appends rows to the report.
- Every surface's `open()` uses real gestures (Playwright `locator.click()` / `page.touchscreen.tap`) — settings tabs switch on a pointer PRESS, `element.click()` does nothing (old sweep's probe note).
- Every popup surface also runs the Review Focus #4 keyboard check on the phone: window height 544, focus its first input, assert the input's rect is on screen.

- [ ] **Step 1:** A `node:test` that every SURFACES entry has a unique id, a known area, and an `open` function; and that every row number 1–62 of the old sweep maps to at least one id (a `from: [n]` key).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write the catalogue and `run.mjs`. **Step 4:** Run → PASS; then `npm run uisweep -- --area toolbar --vp desktop` end to end and check rows appear in the report.
- [ ] **Step 5:** Commit `chore(uisweep): surface catalogue + runner`.

### Task 5: The field matrix — every input type, every variant, every place

**Files:**
- Create: `tools/uisweep/fieldMatrix.mjs`, `tools/uisweep/__tests__/fieldMatrix.test.mjs`
- Fixture data (test grid 2, built once through the app, kept): a board **"Sweep Fields"** whose rows bind one field per case below, a table page over it, a doc page embedding two rows and a field pill, and a button field whose form asks every type. Record the ids in `tools/uisweep/fixtures.json`.

**Interfaces:**
- Produces: `FIELD_CASES` — every type with its variants:
  - `text` (plain, multiline, `linkTemplate`, placeholder) · `number` (plain, flow toggle In/Out/Replace, target + progress, stars) · `boolean` (switch, checkbox variant) · `select` (single manual, single find, multi, `allowNewOptions` add, `randomize` 🎲, `removeOnComplete`, a 49-option list like Time Slot) · `occurrence` (single, multi, `addNew` + destination chooser, search provider) · `date` · `duration` (h/m editor, legacy string value) · `rating` (`max` 5 and 10) · `address` (search, pick) · `when` (Once with several dates, Every N, On days; Reminder on) · `markdown` · `button` (with a listener, with none).
- Produces: `CONTEXTS` — `rowPill` (board row, compact), `rowFull` (row settings › Fields / layout tree), `tableCell` (idle + editing), `docPill` (field pill in a doc), `inlineChip` (inside a textblock), `formModal` (ASK_FORM from a button), `quickAddPicker` (the add-item field picker inputs + presets), `filterNav` (header filter widget, multi-pick, Show switch), `opEditor` (Command Center › Operations value inputs — power tool, jargon allowed).
- Produces: `cases()` = the product, minus combinations the app does not offer (documented in the file with the reason, e.g. `button` has no filter nav). `driveFieldCase(page, c) → Finding` runs, in order: **set** a value → shown; **change** it → shown; **clear / unpick** it (pick the chosen option again for single selects, × for multi, empty for text/number/date) → shown as empty; **keyboard** (Tab in, Enter/Space/arrows, Escape); **persist** (reload, the value is still there — test grid 2 only); and on the phone, **touch** only. Each step times tap → paint (budget 250 ms at 4×).
- Terminal check (Review Focus #3): with a list open, hover option A while option B is chosen; assert B carries the ✓ mark (`[aria-selected=true] svg`) and A does not.

- [ ] **Step 1: Failing tests** — `cases()` contains `select:single-manual@formModal` and `select:single-manual@rowPill`; contains no `button@filterNav`; every FIELD_TYPES entry (read `client/src/helpers/fieldTypes.js`) has at least one case — or the matrix has drifted from the app.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Build the fixture board on test grid 2 by clicking (`--writes`), write `fixtures.json`, implement `cases()` + `driveFieldCase`. **Step 4:** Unit tests PASS; run the matrix desktop + phone + phone-land, default + Terminal; append rows.
- [ ] **Step 5:** Commit `chore(uisweep): field matrix`.

### Task 6: Run the sweep, area by area (desktop, phone, landscape, both skins)

**Files:** `docs/ui-sweep-2026-11-03.md` only (findings); fixes are Task 7.

- [ ] **Step 1:** For each area in this order — `toolbar`, `header`, `add`, `settings`, `radial`, `docs`, `drawers`, `viewers`, `table`, `canvas`, `graph`, `layout`, `context`, `commandCenter`, `forms`, `sharing`, `account`, `phone`, `vr-web` — run **desktop first** (`--vp desktop --skin terminal`, then `--skin default`), then `--vp phone --skin terminal`, then `--vp phone-land`. **Desktop is the priority** (user, 14:13: *"make sure that desktop is a priority too, not just mobile. i just want mobile in the sweep"*); the phone runs are part of every area, not a separate pass.
- [ ] **Step 2:** For each area, read the rows and add the **Clarity** column by hand (the rubric in Task 2): does the label say what it does, would a person who has never seen Moduli know what to tap, how many taps the area's common task takes (e.g. "add a task to today", "move an appointment to 10am", "filter People by Relationship"). Write the tap count down for each common task; > 3 taps is a soft fail.
- [ ] **Step 3:** Commit the report after each area (`docs(uisweep): <area> findings`) so a parallel account can see progress.

### Task 6b: Consolidate the pickers — one single-pick, one multi-pick, used everywhere

User, 14:10: *"make sure we consolidate when we can too. if we have a custom multiselect picker or select picker …
lets reuse it as much as possible wherever its needed and not just have a new one … ik we have custom selects and
multiselects not used places."* Done BEFORE the fix pass, because most picker findings are then fixed once.

**Measured 2026-11-03:** **95 native `<select>`s in 39 files** (OperationsBuilder 20, FieldsTab 8, OperationsTab 7,
SharePlace 5, …), plus separate pickers that each draw their own option list: `Field.jsx`'s four single-pick lists
(compact/full × plain/occurrence), `MultiSelectWithAdd`, `OptionSearchList`, `FilterNavWidgets.MultiPickWidget`,
`ModuleSelect`, `OpCategorySelect`, `ShareGridPicker`, `AutoAppliedFieldsPicker`, `BodyBindingPicker`,
`components/ui/select` (Radix, 3 files), `FieldSelect` / `DestinationPicker` (already wrap `OptionSearchList`).

**Files:**
- Create: `client/src/ui/pickers/SinglePick.jsx`, `client/src/ui/pickers/MultiPick.jsx`, `client/src/ui/pickers/index.js`, `client/src/__tests__/pickersEverywhere.test.js`, `client/src/__tests__/singlePick.test.jsx`, `client/src/__tests__/multiPick.test.jsx`
- Modify: `client/src/ui/Field.jsx` (the four single lists, `MultiSelectWithAdd` → `MultiPick`), `ui/FilterNavWidgets.jsx`, `ui/FieldSelect.jsx`, `ui/DestinationPicker.jsx`, and each file in the census, area by area.

**Interfaces:**
- Produces: `SinglePick({ options: {value, label, description?, group?}[], value, onChange(value|null), placeholder, searchable = options.length > 10, clearable = true, size = "compact"|"full", trigger?: (label) => node, onAddOption?, disabled })` — a trigger + Popover + `OptionSearchList` in single mode. Picking the chosen option clears it when `clearable` (`togglePick` from `Field.jsx`, moved into `pickers/`). Chosen = ✓ + bold (`SelectOptionRow`). Closes on pick. Keyboard: arrows, Enter, Escape; returns focus to the trigger. Phone: opens as the bottom sheet the other popovers use.
- Produces: `MultiPick({ options, value: any[], onChange(any[]), placeholder, searchable, onAddOption?, summary?: (picked) => string, disabled })` — one list with checkboxes; the trigger reads `pickSummary` ("Social, Media" / "3 selected"). Un-picking the last leaves `[]` (an empty pick, not "off" — the filter rule of 11-03).
- `OptionSearchList` stays the one list renderer under both.
- The walker test (`pickersEverywhere.test.js`) reads `client/src/**/*.jsx` and fails on: a native `<select` outside an explicit `NATIVE_SELECT_ALLOWED` map (file → reason — e.g. none expected; anything kept native says why), a hand-rolled option list (`role="option"` or `aria-selected` outside `ui/pickers/` and `Field.jsx`'s `OptionSearchList`/`SelectOptionRow`), and `components/ui/select` imports. Its control asserts the walker FINDS a planted `<select>` in a fixture string.

- [ ] **Step 1: Failing tests** — `singlePick.test.jsx`: renders, picks "B" → `onChange("B")`; picking "B" again → `onChange(null)`; `clearable={false}` → picking "B" again does nothing; the chosen row has `aria-selected="true"` and an svg; Escape closes and focuses the trigger. `multiPick.test.jsx`: picks build `["a","b"]`; un-picking both → `[]`; summary reads "A, B" then "3 selected". `pickersEverywhere.test.js` with the full current census as the starting allowlist (so it passes), plus the planted-select control.
- [ ] **Step 2:** Run → the two component suites FAIL (modules missing).
- [ ] **Step 3:** Build `SinglePick` / `MultiPick` from `Field.jsx`'s pieces (no new list code). Move `Field.jsx`'s four single lists and `MultiSelectWithAdd`, then `FilterNavWidgets.MultiPickWidget`, onto them. Run the existing suites (`selectPickCloses`, `selectOptionToggle`, `filterMultiPick`, `fieldSelect*`) — keep them green, updating source guards to the new names.
- [ ] **Step 4:** Migrate the census AREA BY AREA (one commit each), shrinking the allowlist in the same commit: settings forms → header dropdown sections (Filter/Sort/Data/Layout) → Command Center tabs (FieldsTab, GridSettings, Imports, Appearance) → OperationsTab + OperationsBuilder + ConditionGroup (the power tool: keep the trigger compact, `size="compact"`) → SharePlace → VR office pages → the rest. After each area: the harness re-runs that area on phone + desktop (Task 3 crawler) and the field matrix's `opEditor`/`filterNav` contexts where touched.
- [ ] **Step 5:** End state: `NATIVE_SELECT_ALLOWED` lists only entries with a written reason (expected: none), no hand-rolled option lists, no Radix select. Record the before/after counts in the report.

### Task 7: Fix what the sweep found

**Files:** whatever each finding names; one test file per fix in `client/src/__tests__/` or `server/__tests__/`.

- [ ] **Step 1:** Triage the report into a list at its bottom, ordered: errors and dead controls → off-screen/unreachable on phone → field matrix failures → axe critical/serious → budgets → clarity.
- [ ] **Step 2:** For each item: failing test (behavioural where the component mounts in jsdom, else a source guard with a control), fix, run the test, A/B (revert, assert the revert landed, test fails), commit `fix(<area>): <what the user sees>`, re-run that surface in the harness (Chromium **and Firefox**), mark the row 🛠 with the commit.
- [ ] **Step 3:** Clarity fixes that change wording or layout the user chose before (read CLAUDE_CHAT.md for the surface first) are **asked**, not made — list them in one AskUserQuestion per area.
- [ ] **Step 4:** Deploy after each area's fixes (`./deploy.sh`; client-only unless server changed) and re-run that area against prod.

### Task 8: Performance through the UI (phone, 4×), against the budgets

**Files:**
- Create: `tools/uisweep/perfRun.mjs`; findings in the report's **Perf** section.

**Interfaces:**
- Consumes: Task 1 `open`, Task 2 `timing`.
- Measures on **poms grid, writes blocked**, phone 4× and desktop 1×, 3 runs each, medians: first message size + time; panels on screen; rows on screen; longest freeze in the first 60 s; scroll 40 steps on Movies, Songs, People, People Table, Books, Routines, Schedule; open each panel's page from the PanelPicker; search first and second query; open the Eminem article; open a book in the viewer; open each settings form; open the header Filter tab; pick a filter value (multi-pick); and on **test grid 2** (writes allowed): toolbar date step next + back (paired), tick a task, add a row, delete it.
- Every number goes beside the budget. Over budget → profile it (CDP `Profiler.start/stop`, map frames with the source maps as `_profmap.mjs` did) and either fix it (Task 7 rules) or report the cause with the profile's top frames. **A profiler frame is part of the measurement until an A/B says otherwise** (CLAUDE.md 2026-09-28 (3): the 15 MB console.log cost was the probe's).

- [ ] **Step 1:** Write `perfRun.mjs`; run the baseline; record it.
- [ ] **Step 2:** For each over-budget item: profile → fix or report. People Table scroll (590 ms/step) and the 7 s post-load freeze are known starting points (CLAUDE.md 11-02 (7), 11-03).
- [ ] **Step 3:** Re-run the full perf pass after the fixes; record before/after in one table.

### Task 9: Destructive and write paths, once, on test grid 2

**Files:** report rows only (fixes go through Task 7).

- [ ] **Step 1:** With `--writes --grid "test grid 2"`, drive each skipped control once: delete a row / container (keep vs. delete children) / page / folder, remove from grid, Break Link, Lock in place, undo each with Ctrl+Z (desktop) and the toolbar Undo (phone side menu). Expected: each confirms or is undoable in ONE step, and the undo restores exactly (read back from Mongo).
- [ ] **Step 2:** Clean up every probe row through the app; run `checkGrid` on test grid 2 → no new errors.

### Task 10: What only the user's devices can show

**Files:** `docs/ui-sweep-2026-11-03.md` — a short "Please try" list.

- [ ] **Step 1:** List what headless cannot cover — the real phone (iOS/Android keyboard, share sheet, momentum scroll), the Quest app, Firefox on Windows, the Bangle watch — each with the exact steps and what "working" looks like. Send it to the user as the closing message with the report link.

---

## Self-review

- Spec coverage: works (Tasks 3, 5, 9) · accessible (Task 2 axe + tap + focus, every crawl) · easy to understand (rubric + clarity column + tap counts, Task 6 Step 2; wording changes asked, Task 7 Step 3) · mobile focus (phone first, touch only, landscape, keyboard) · performance via the UI (Task 8, plus per-interaction timings in Tasks 3/5) · "all types of each input" (Task 5 matrix, drift-tested against FIELD_TYPES) · "all buttons and menus" (Task 3 crawler, depth 2, "nothing" outcome).
- Consolidation ("reuse the custom select / multiselect everywhere", 14:10): Task 6b, enforced by a walker test so a new one-off picker fails CI.
- The harness is checked in (`tools/uisweep/`), not another 2,000 `_*.mjs` files, so the next sweep is a re-run.
