# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---


> **The log is TRUNCATED.** This file carries only the most recent entries. Older ones live in
> [`CLAUDE.backup.2026-11-14.md`](./CLAUDE.backup.2026-11-14.md) (2026-10-30 (10) back to 2026-09-17 (4)) and
> [`CLAUDE.backup.2026-09-18.md`](./CLAUDE.backup.2026-09-18.md) (older), same content, nothing rewritten.
> The narrative below stops at **2026-10-30 (11)**. **Grep both archives before concluding something was never
> done.** The standing rules, the data model and the roadmap are still at the BOTTOM of this file.

### 2026-11-17 — A WORK SHIFT IS BACK IN ITS START SLOT (`0506`); Hours "9am-3pm" (`TIME_RANGE`, `0507`)

User: *"my mr brews work occurances are being put into a later timeslot. i work 9am-3pm today and it only lists it in
930 onward"* · *"put a text field in there called hours and list like 9am-3pm in it with an operation. check the
operation for these imports"*.
- **Cause, read out of Mongo:** the shift (Tasks › Work Shifts, from the calendar share — Time Slot 9:00am, Duration
  6h: the import is right) got its 9:00am copy at 00:01 into a version of today's schedule that was later rebuilt; the
  copy survived listed by nothing (parent gone) and the 9:30–2:30 Duration Copies hung off it. Place Dated Work copies
  into the start slot only while **Scheduled** is unticked (`0484`, "if i delete it from schedule, it shouldnt show up
  again"), and the first placement ticked it — so the slot stayed empty.
- **`0506`:** Place Dated Work, after looking for today's copy in the slot, finds a copy of the row for this day that is
  NOT under the Schedule page (`_ancestors NOT_HAS_ANCESTOR $schedPageId`) and moves it into the slot
  (`LINK_OCCURRENCE_TO_PARENT`). A deleted copy is gone, so 0484 holds (control test). **Hours** (text) bound on the 10
  shift modules and attached by `Share: calendar (.ics)`; op **"Work Shifts: Hours"** (onLoad, onChange Time Slot /
  Duration, onAdd under Work Shifts) writes `TIME_RANGE(Time Slot, Duration)`.
- **`TIME_RANGE` (new action, client):** `{start, minutes, to}` → "9am-3pm" (`slotSpan.timeRangeLabel` / `shortClock`),
  in the action tree + config schema. DATE_ADD only steps days.
- **`0507`:** the span copies (`meta.spanOf`, not linked to the shift) take the range of the row they span.
- Watched on prod (writes blocked, store read after the load ops): the 9:00am slot lists the shift; shift Hours
  "9am-3pm"; 9:30 / 10:00 / 10:30 / 11:00 entries "9am-3pm". Tests `timeRange` (2), `shiftRehomeHours` (5, real
  executor). pm2 restarted after each.

---

### 2026-11-16 (5) — THE DAILY QUESTION: its tag, and the 143 questions that are gone

User: *"make sure its linked (says its not) and the linked text (Daily Question) should be really small"* · *"show only
on hover"* · *"it shouldnt be searching via the ui for its signatures … no signature search"* (memory
`feedback_ops_no_signature_search`).
- **"Broken link" was a wrong definition:** BoundHeader/BoundBody called a binding linked only when ANOTHER copy shared
  its link value (Date). A day has one question container, so it always read broken. `editorBindings.bindingConnected`
  (both use it): the field exists and the host has a link value. Tag 8px, opacity 0 until its header/body is hovered.
  Watched on prod: "Linked: Daily Question" / "Linked: Answer", 8px, 0 → 0.7 on a real hover.
- **The questions are gone, not the link.** Between backups `2026-10-18T13-35` and `14-47` a container "Library"
  (occ `VI5z1eAPtFg5`) holding the 143 question rows was deleted (145 modules: 143 questions, the container, one file).
  No transaction recorded it. Since then the Daily Question field (`Library IS question`) has no options and
  `Day Page: Build Day`'s fill (PICK_RANDOM_FROM_POOL `CWC9WqHPO3EO`, also gone) has written nothing — no question on
  any of the last 20 day columns. The rows were HOMED in Library and LISTED by "Reflection Questions" (occ
  `YFfFUfAIhEL3`, module `CWC9WqHPO3EO`, on Mind › Daily Journal Questions) — the pool the fill reads.
- **`0504` (user: "yes"):** restores ONLY the 117 question rows (original ids, from the 10-18 backup), homed and listed
  by Reflection Questions in their old order; the old Library's books/movies stay deleted. `Day Page: Build Day`'s fill
  FIND now matches `_boundFieldIds ARRAY_INCLUDES <Daily Question>` under the day column (exactly 1 per column,
  measured) instead of the signature. **`0505`**: the field's option limit 100 → 500 (it listed 100 of 117).
  Watched on prod (writes blocked): today's question fills, the picker lists 118 (117 + blank). pm2 restarted.

---

### 2026-11-16 (4) — JONAH: AUTOMATIONS ARE REAL OPERATIONS; questions on the 7B; web search (SearXNG)

User: *"doues the autommations create operations. it should do that"* · *"is it a normal chatbot too … look up information
… have a convo"* → *"do 1 and 2 with that as well"* (questions on the 7B; a web search tool).
- **Automations:** `services/automation.compileAutomation(spec, ctx)` (pure) turns `{when:{at,days?,date?}|{added_to}|
  {changed,in?,to?}, do:[{notify}|{add_item,to,fields?}|{set,value}|{run}]}` into an Operation: `schedule` atTimes /
  when(weekdays|once), or `triggerObjects` onAdd (0465's shape, `ancestorId`) / onChange (+ an IF on `$trigger.value` and
  `$trigger.occurrence._ancestors`); steps NOTIFY / CREATE / SET_FIELD_VALUE (the triggering item) / RUN_OPERATION; text
  is `literal:`. `POST /api/v1/automate` (dryRun = the card's practice run) resolves places with `/change`'s path rules
  (`editCandidates` + `pickByName`; not found → "did you mean" with the real paths) and records ONE undo step. Jonah's
  tool `automate` (confirm; `AutomationPreview` card: name / when / does) is offered ONLY to automation-shaped requests
  (`isAutomationShaped`: remind, automatically, whenever, every day/morning… — NOT weekday names, a dated batch says
  "every Monday"), with look_up / list_fields / list_folders / jonah_notes. `automationAgainstRequest` sends back days
  the request never named. Client test `jonahAutomation.test.jsx` runs compiled ops through the real executor.
  Eval auto-timed 4/4, auto-tick 4/4 (setup builds its own Todo — test grid 2 has no Tasks › Todo).
- **Questions on the 7B** (`LLM_ASK_MODEL`, default the build model; read tools only). A question's first turn is no
  longer forced to call a tool (`localLoop forceFirst`, builds only) — "thanks" calls nothing.
- **Web:** SearXNG on the droplet (`/usr/local/searxng`, venv, systemd `searxng`, `/etc/searxng/settings.yml`, JSON on,
  127.0.0.1:8888 only; DuckDuckGo answers CAPTCHA, Google/Brave answer). `services/webTools.js`: `web_search`,
  `read_page` (guarded fetch + reader extractor, 4000 chars). The eval needs `SEARXNG_URL` through an ssh tunnel.
  `wikipedia_search` left the local list (search covers it); the prompt cap (12,000 chars) is measured per kind of request.
- **Builds:** page requests are not offered add_filter or (when nothing is edited) change/remove/undo; the planner reads
  a bold-wrapped link, a mixed-link line, `[open links]` after a link, `[X](#x)` as a category, HTML open buttons (in a
  `<panel title>`), a link to several addresses as an open button. Glossary 3 of 4 in the last runs (a miss is one link
  short). CPS, Quick Links, edits, questions pass.
- **Glossary buttons, measured (`tools/uisweep/_glossbtn.mjs`):** pill centre within 1px of label and header on all 7.

---

### 2026-11-16 (3) — JONAH ACTS ON WHAT YOU SELECTED; it offers to open what it made

User: *"continue with what you were working on"* (the Jonah list: act on what you're looking at; link to what it made).
- **Selection:** `AssistantDrawer.describeSelection` sends the multi-selection as `context.selection` = [{id, label, path}]
  (≤20); `assistantAgent.buildSelectionHint` puts them in the request's note ("these" / "this" mean exactly these, pass
  each id); `/change` and `/remove` take `id` (`hitById`), the tools' `name` is no longer required. The window, its
  backdrop and the turtle carry `data-selection-keep`, so typing in Jonah does not end the selection; a confirmed
  change/remove of a selected id ends it. **The model invents ids when nothing is selected** ("someSocialSectionId"):
  an id that names nothing falls back to the name given beside it. Eval case `edit-remove-selected` ("Delete these."):
  2/2; edit-remove 2/2, edit-rename, edit-undo pass.
- **What it made:** `/build` → `rootOccurrenceId`, `/change` → `occurrenceId`; `extractCreatedOccId` accepts an `ok:false`
  reply that carries an id (a build with a leftover problem still made the page) → the panel card offers to open it.

---

### 2026-11-16 (2) — DONE BECOMES COMPLETED (`0503`); "Every item here gets"; chip handle + grab cursor; movie./music.

User: *"all tasks should have a completed field … a setting that gives them all the completed field"* · 2 and 3 (drop
Done; the Done section hides rows completed before today) · *"dont mark them completed if they are not marked done"* ·
the chip handle shows over *"the space in between"* the link buttons · *"the grab cursor should not show unless its on
the drag handle"* · movie./music. opened Jellyfin.
- **`ui/AutoAppliedFieldsSection`** (beside Field Visibility on pages, containers, panels): "Every item here gets" edits
  `occurrence.autoAppliedFieldIds`, the per-occurrence level of `getEffectiveAutoAppliedFieldIds` (nearest wins, so an
  edit starts from the inherited list — `nextAutoApplied`). **The server schema never declared it**, so strict mode
  dropped it and only the grid level ever worked; `models/Occurrence.js` declares it now.
- **`0503`** (applied to poms, snapshot first, pm2 restarted): Done / Done Since gone (125 rows, 23 bindings, the
  section's filter, "Tasks: Mark Done", 2 steps of "Tasks: Completed to Done", the fields); the 43 rows marked Done and
  not ticked → Completed (Completed On = Done Since); the Done section keeps rows whose Completed On is empty / today /
  later; the Tasks page gives every item Tags, Date, Completed. Watched on prod: Todo 6/6 and Appointments 12/12 show
  Completed (the Appointments had none), Done reads "42 items hidden by the Completed On filter".
- **Chip handle:** `chipHover.hoverShowsHandle` is positive now — only over `.itbi-content` / `.itbi-handle` (the chip
  box's padding and the gap between ↗ and 🌐 counted as text). Sweep on prod: off exactly at the text's end, no flicker.
- **Grab cursor:** the chip box had `cursor: grab` from before chips dragged by a handle; `default` now. Probe
  `tools/uisweep/_grabcursor.mjs` (every non-handle element with a grab cursor): 35 → 0.
- **Jonah:** `/build` replies `rootOccurrenceId`, `/change` `occurrenceId`; `extractCreatedOccId` no longer refuses an
  `ok:false` reply that carries an id — so the window offers to open what was made.
- **movie./music.viafluere.com** were in sites-available, never enabled, no certs → nginx's default (Jellyfin). Enabled +
  certbot as root (`ssh root@viafluere.com`; `deploy` has no sudo). Both serve the Radarr / Lidarr logins.
- **WSL crashes:** every panic is `mce: Machine Check Exception … Processor Context Corrupt` (14 since Nov 9, 6 between
  7:41 and 7:52, each ~2 min after boot right after the drive mounts); Windows' WHEA log is empty — likely WSL 3.0.5.0 /
  Hyper-V, not the CPU. Hyper-V also resets the WSL network adapter repeatedly. Crashes left 20 empty git objects; the
  index blobs were rewritten from disk (`git hash-object -w`), nothing lost. **Not fixed** — the user's choice.
- Full test suites not run (they crashed WSL); targeted tests only.

---

### 2026-11-16 — JONAH: a running log in the window; builds ~2× faster; the check reads the request

User: *"please continue"* · *"also i want real updated responses from the chat like you do"*.
- **Running log:** the agent sends one sentence per step (`{phase:"step", text, status}` — `describeCall`,
  `describeResult`, and holdForConfirm's "Checking it first…", "Found 1 problem: … — fixing", "Check passed: 1 page,
  6 sections, 9 links", "Waiting for you to approve"). `AssistantDrawer` collects them (`StepLog`, live line blinks,
  seconds into the request) and keeps the log in the history above the answer; the approval logs "Approved — writing
  it" then what was made. Watched on prod (test grid 2, a read-only question).
- **Found while watching:** the window sent its whole list (cards, tool results, `_meta`) to the model as chat turns —
  `conversationOnly` keeps what was said. `list_folders` with a made-up parent id returned nothing and Jonah said "you
  have no folders" — `listFoldersAnswer` lists all and says so.
- **Speed:** `--spec-type ngram-simple` on the build model (llama-swap) — same output, 7.2 -> 10 tok/s on a replayed
  build (20 on a corrected one). Page requests keep narrowed tools (11 of 14 vs 3 of 7 with a steering note), the
  dropped ones LAST so prompt reuse survives a switch better. Glossary runs 63-70s (were 85-140s).
- **`missingFromRequest`:** a typed web address the plan left out, or buttons asked for and none made, go back to the
  model. Glossary **4 of 4**, each first time. Markdown: a label before one link is that link; `[Open Mail](url)` is the
  Mail section's button. Eval records write speed. Server 3,751 / client 7,558.

---

### 2026-11-15 (8) — JONAH: glossary 4 of 4; change / remove / undo pass through the model; the window is half height

User: *"make the height of the terminal window less, like half the size. and then continue with the jonah improvementx"*.
- Window: 410px tall; `.jonah-terminal--tall` (820) only while a build's preview card is pending. Watched on prod.
- **Found:** llama-server honours `tool_choice:"required"` but lets the model WRITE first, then call; at ~7 tok/s the
  text used up the time (a run stopped mid-sentence at 240s). The send-back now asks for only the corrected call, and
  an unknown page name says which was meant (`buildPlan.closestName`, passed `ctx.names` by `/build`; never resolves on
  its own). Glossary **4 of 4**.
- `pickModel`: undo/change/edit/update/fix are build verbs (undo had gone to the read-only model).
- `buildEdit.normalizeTargetName`: "Social section from Eval Notebook page" → "Eval Notebook › Social" (used by
  pickByName and the route's lookup); change/remove describe the path form.
- Eval gained `setup` (a page built over REST first) and cases edit-rename / edit-remove / edit-undo: 3/3, 2/2 (was 0/2),
  3/3. CPS and Quick Links still pass. Server 3,739 / client 7,556.

---

### 2026-11-15 (7) — JONAH IS A TERMINAL IN THE CENTRE; a board's rows and header buttons are evenly spaced

User: *"dont make it a little chatbox. make it look like a terminal that opens up in the center of the screen with an x
button (keep the little circle guy tho for the button for it). that way the preview page can be bigger"* · *"fix the
spacing above and below the occurances … the bottom is more than the top. also in the header, the buttons on the rights
top spacing is more than the bottom"*.
- **`ui/AssistantDrawer`**: the turtle button opens a centred window (`.jonah-terminal`, 1000×820 max, full screen on a
  phone) over a dimmed grid; X or Escape closes it, a click on the dim does not (a half-typed request survives).
  Lines, not bubbles (`.jonah-line`, your text after `›`), a bare prompt line with `↵ send`, the build preview
  `min(56vh, 560px)` tall. The terminal skin paints every textarea black with `:root[data-skin] textarea !important`;
  the prompt's selector matches its specificity (it lost at `.jonah-terminal-prompt textarea`). Watched on a local
  build against prod: 1000×820 centred on desktop, 390×844 on a phone, focus in the prompt, X closes, turtle returns.
- **`ModuleContainer`**: a board's rows were padded 4/9 (15px above the first row, 20px below the last, measured) →
  6/6 (17/17); the board header 4/2 put its right-hand buttons 1px low, 3/3 1px high (its bottom border counts) →
  3.5/2.5 (6/6). Probe `tools/uisweep/_slotspacing.mjs`.
- Jonah: a page-shaped request (doc page / glossary / dashboard / sections, no "board") is not offered the one-row
  creators or create_board (`toolsForModel(tools, which, text)`); glossary still 3 of 4 — the remaining miss is a
  forced turn answered in words, not a wrong tool.

---

### 2026-11-15 (6) — JONAH CHECKS A BUILD BEFORE ASKING; build turns must call a tool; the card draws the page

User: *"can you brainstorm ways to improve jonah"* → *"okay lets work on that"* (the three I recommended).
- **Self-check:** a confirm-tool may carry `preview(input)`; `build`'s is `/build` with `dryRun`. Before the card,
  `assistantAgent.holdForConfirm` runs it: problems on the FIRST check go back to the model as the tool result
  ("Nothing was made. Fix these…"); a clean check, or a second one, becomes the card with the preview attached.
  `buildPlan.placeholderAddress` makes example.*/localhost/.test/"yourdomain" links a problem.
- **Forced call:** `llmClient.buildChatBody({toolChoice})`; the local loop sends `tool_choice:"required"` on the build
  model's first turn AND the turn after a send-back (without the second, 2 of 4 runs answered "let's fix that" in
  words and built nothing). With `--jinja`, llama-server then constrains the call's arguments to the schema.
- **Preview card:** `/build` dryRun returns `preview {modules, occurrences, fields, roots}`; `AssistantDrawer`
  `BuildPreview` draws each root through `PagePreviewBody` from an isolated state (`buildPreviewState`, the reader
  pattern — no dispatch/socket, no computedValues), plus any problems left.
- Eval: glossary **3 of 4** (was 2 of 4), CPS 2/2, Quick Links 1/1. Prod dryRun check: flags the made-up link,
  1 root (the doc page), 0 rows written. Tests `jonahSelfCheck` (7), `buildPreviewState` (2), buildPlan (+2).
  **Not watched in a browser:** the preview card in the drawer.

---

### 2026-11-15 (5) — A RADIAL DELETE ON ONE OF A MULTI-SELECTION DELETES ALL OF IT, AFTER ASKING

User: *"if i multiselect occurances and delete via one of their radial menus, it should delete all of them. put up an
are you sure message as well"*. `helpers/deleteSelection.js` (NEW): `selectionToDelete(occId, selected)` (the whole
selection when the pressed row is in a selection of 2+, else null = the usual single delete) and `deleteSelected`
(confirm "Delete N selected items?", then every row removed with its lister's list cleaned, ONE undo step). The
right-click "Delete N selected" uses it too (it was its own copy, and said "cannot be undone"). Wired into
ModuleInstance's radial (reads `getSelectionSnapshot()` at click time, so no row subscribes to the selection) and
ModuleContainer's `removeMe`. Pages are not selectable, so untouched. Test `deleteSelection` (5). Client 7,554 pass.
**Watched on prod, writes blocked** (`tools/uisweep/_bulkdelete.mjs`): Drink + Eat shift-selected, Delete on Drink's
radial → "Delete 2 selected items?", No → both still there. **Not pressed Yes on a real grid.**

---

### 2026-11-15 (4) — JONAH `build`: MAKE ANYTHING IN ONE CALL (Phase 1 of 2)

User: *"we should be able to make any occurance with jonah"* · *"everything"* · *"editing and deleting should be in there
as well as undo. do that after the create"* · practice on the glossary. Spec
`docs/superpowers/specs/2026-11-15-jonah-build-anything-design.md`.
- **`services/buildPlan.js` (pure, 23 tests)**: a tree of nodes (page · folder · section · item · text · link · image ·
  file · field · button) → every record, names resolved against the grid and the build itself, problems reported never
  guessed. Doc parents list AND embed; links in a doc are a bullet list of chips; doc sections end in one hover line;
  buttons (`open links` · `show page X` · `add item to X`) reuse a same-label field and one op per action.
  **`page.markdown`** is the form the 7B writes best: `##` sections, `[open links]`, `[label](url)`, `[[Name]]` — plus
  the habits it actually showed (`[Name](Name)` = in-app, an "open … in browser" link line = the button, several links
  a line, `- **Bold**` sub-sections, stray top-level buttons go on the page).
- **`POST /api/v1/build`** (dryRun previews): loads names (pages/sections by label, folders + their cards, button fields
  and what their listeners do), plans, writes (folders, fields, ops, then modules/occurrences via `persistImportResult`),
  mirrors the cache, broadcasts, attaches into an existing `under` parent (list + doc embed).
- **Jonah's tool `build`** (confirm card; in the offline allowlist; the prompt says a page with sections/links/buttons
  is ALWAYS build). Eval: glossary 2 of 4 after four rounds of reading its habits (was 0); CPS 6/7, Quick Links 4/4.
- **Phase 2 (same day): `change` · `remove` · `undo`.** `/build`, `/change`, `/remove` each record ONE undo step
  (txRecorder, one actionId). `POST /api/v1/undo` = Ctrl+Z's rules: the socket handler's undo moved VERBATIM into
  `socketHandlers/undoCore.js` (`makeUndoCore`, `undoTop`), both call it. `services/buildEdit.js` (pure, 10 tests):
  `pickByName` (a path "Page › Section" picks by parent; a page beats a row; still several = "could mean several" +
  the options, never a guess), `planChange` (a module placed once is renamed, a shared one gets the name on this
  placement; field values coerced and bound), `subtreeIds`, `stripEmbeds`. `/change` = rename · fields · moveTo
  (unlinks + un-embeds from the old parent, links + embeds into the new); `/remove` = the occurrence + its listed
  subtree, the parent's list and embed. Jonah's tools `change` / `remove` / `undo` (all confirm). **Watched on prod,
  test grid 2 (REST, cleaned up):** build → rename → move → remove (6) → one undo restores all 7 docs, listed again.
  **Not run through the model yet** (no eval case for change/remove).

---

### 2026-11-15 (3) — GLOSSARY POLISH (`0502`); a wrapped tile keeps its left add gap

User: buttons *"right next to the header labels"* · links *"going downward in a bulletpoint list"* (pages and folders
too) · a *"random blank space"* in Media and Web & dev · *"the extra space on hover isnt working"* · link buttons
*"always show"*, the drag handle only *"if the text of the mini textblock is hovered"* · a tracker's wrapped 4th tile
had no LEFT add button.
- **Buttons beside the label:** `OccurrenceFields types={only|except}`; `ModuleContainer` draws a container's BUTTON
  fields inline after its label (both header layouts), the rest where they were.
- **The blank space / the hover space were ONE thing:** a doc container's hover line is a STORED empty paragraph after
  its final block (no editor extension adds one). `0501` built none (nothing to reveal); a click saved a second into Web
  & dev (the CSS hides only the last); the read-only stand-in drew even one as a blank line. `docs/trailingEmpty`:
  saving keeps at most one (`Editor.persistContent`), the stand-in draws none (`StaticTextmap`), a built section gets
  exactly one (`ensureHoverLine`). **A first version trimmed to ZERO on save, which would have removed the hover line
  from every container** — caught by reading the CSS before deploying.
- **`0502`** (applied to poms): the 8 link textblocks are bullet lists (bold lead line kept), the 8 sections end in one
  hover line. `0501` builds both itself now.
- **Chips:** `.itbi-arrow` always shown (drawn only for links); the handle follows `hoverShowsHandle` (not over a link
  button) and the padding shift follows `.is-hovered`, not `:hover`.
- **Tile edge gaps:** in a wrap/row layout each tile draws its own left (index) and right (index+1) `InsertGap` in the
  gutter (`ModuleInstance edgeGapIndex`, `.insert-gap--edge`); the separate gap element stayed on the line above when the
  tile wrapped. The wrap tile is `overflow: clip` + `overflow-clip-margin` one gutter wide, or it cut them off.
  `InsertGap` now splices into the LIVE parent (`getOccMap`) — a gap inside a memoized tile can hold an old copy
  (A/B'd). Client 7,549 pass.
- **Watched on prod (writes blocked, `tools/uisweep/_glossary*.mjs`, `_tilegaps.mjs`):** Home + Glossary in all 4
  panel headers; Places = 13 bullets, chip arrows shown at rest; all 6 categories live with their button. The button sat
  at the FAR RIGHT at first — the embedded header's label was `flex: 1`; now `0 1 auto`, re-watched beside the label.
  Streak (Today's Stats' wrapped 4th tile) owns a 6px left zone that `elementFromPoint` hits.

---

### 2026-11-15 (2) — THE ROOT GLOSSARY PAGE (`0501`); OPEN_URLS; Home + Glossary in every panel header

User: a root doc page of links to the main pages/folders and quick links to the user's sites by category, all
mini-textblocks, an "open all in browser" button and one per category; a Home button and a Glossary button in each
panel header (no Command Center option); CPS = the Zoom links, Eweka in Media, FetLife in Social.
- **`OPEN_URLS`** (new step, `helpers/openUrls`): takes link chips / records with a url / addresses, emits one effect;
  the effect opens a tab each inside the click and toasts when the browser blocked some (allow pop-ups once).
- **`ui/PanelHeaderButtons`** in `ModulePanel`'s header beside Files: Home (`openPanelOnRootFolderPage` in that panel)
  + one button per `grid.meta.panelButtons` entry `{id,label,icon,operationId}`, run through `runButtonOperation` with
  the panel, so the op can `UPDATE_VIEW $trigger.panelViewId`.
- **An in-app link chip opens its page in its own panel** (`helpers/inAppLink`; it called `jumpToOccurrence` alone,
  which does nothing for a page that is not on screen).
- **`0501`** (applied to poms, pm2 restarted): page "Glossary" (doc) in the root folder → Places (5 pages, 8 folder
  pages) + Quick Links → Mail · Google · Social · CPS (3 Zoom links read off the CPS Class notes) · Media · Web & dev;
  button field "Open in Browser" on Quick Links + each category; ops "Glossary: Open Links" (FIND url chips under the
  pressed container → OPEN_URLS) and "Panel: Open Glossary" (in `grid.meta.panelButtons`). Test `rootGlossary.test.js`
  drives the real executor (A/B: without the ancestor rule a category opens every link). Client 7,518 pass.
- **Jonah could not build it** (test grid 2): a board with made-up URLs, no buttons — no tool for doc pages/chips.
  **Not watched in a browser:** the page, the buttons, the pop-up prompt.

---

### 2026-11-15 — JONAH RUNS ON LLAMA.CPP ON THE PC (llama-swap); Ollama is out of the code path

User: *"replacing ollama … llama-swap with litellm or llama.cpp"* · *"no paid model"* · *"as quick as possible"* · only the
Radeon iGPU. Spec `docs/superpowers/specs/2026-11-15-local-llm-runner-design.md`, plan `…/plans/2026-11-15-local-llm-runner.md`.
- **PC (`C:\moduli-llm`, `infra/llm/`):** llama-swap v273 + llama.cpp b12387 Vulkan, task "Moduli LLM" at logon. `build` =
  Qwen2.5 7B Instruct on the Radeon (~51 read / 7 write tok/s); `fast` = llama3.2 3B on the CPU (~91 / 15) — with the 7B on
  the Radeon there is no device memory for a second model. Both stay loaded. The tunnel sends `^/v1/` on
  `ollama.viafluere.com` to llama-swap (`localhost:8080`, WSL mirrored networking), the rest to Ollama (still installed).
  Model files must sit on a Windows disk: loading from `\\wsl.localhost` crashed WSL twice.
- **Server:** `services/llmClient.js` (OpenAI `/v1/chat/completions`, SSE, tool-call fragments joined by index) for Jonah
  and `importEnrich` (still off); env `LLM_URL` / `LLM_BUILD_MODEL` / `LLM_FAST_MODEL`, `ASSISTANT_BACKEND=local` (it
  still probes `/v1/models` and falls to the dispatcher in ~1s). `pickModel`: build verbs → `build`, else `fast` with READ
  tools only. The fixed prompt + tools are byte-identical between requests and the per-request note (places, date,
  location) sits before the newest user message, so llama-server reuses the prefix: second request 4,325 of 4,516 tokens
  cached, first token 6s instead of ~100s. Build tools take one-line rows (`"Label | url | value"`, bare domains ok); a
  field the grid lacks or a wrong-kind value is left out (reported), not a failed row; a named month is the whole month.
- **Eval (`server/eval/assistant/`, test grid 2 via prod REST, scratch token, cleans up):** Ollama 3B today: CPS fail,
  Quick Links fail. Now: **CPS 4/4 (24-28s), Quick Links 3/3 (~100s)**; questions 6-38s but their answers are weak (the
  same 3B). qwen2.5-coder 7B wrote its calls as text and failed CPS 4/4 — the Instruct model fixed that.
- Deployed `5e62f5c9`; prod `.env` backed up as `.env.bak-2026-11-15-llm`. Watched: prod's `/assistant/chat` → mode
  `local`, model `fast`, 12s. **Not watched:** a build from the drawer on poms. **Ollama not removed** (user's call).

---

### 2026-11-14 — THE IMPROVEMENT LIST: a snapshot that stopped every grid after a bad key, readable failures, a scroll setting

User: *"lets do those things you just put"* (a 10-item list). Done, each tested:
- **Snapshot save** (`server.js`): a `<user>:null` cache key threw a CastError inside ONE try around the loop, so
  every grid after it went unsaved. Skipped, and each grid saves in its own try. poms' snapshot was current.
- **Drive fallback**: an upload kept on the server (expired Drive token) toasts "Google Drive needs reconnecting",
  once per 10 min (`artifactUpload.noteStorageFallback`). **Import errors** read as words (`readableImportError`).
- **Reddit names**: `server/utils/titleFromUrl` (shared) reads a post's title from its slug; a comment link is
  "Comment in r/<sub>". `0500` renamed the 11 named "reddit.com" / "5 yr. ago" on poms; read back: 0 left.
- **Appearance › Scroll**: wheel step per notch, this browser only (`wheelStepPx`, 10-200, default 40).
- **SharePlace** lists a folder's page as "folder". **vitest** capped at 6 workers: the full client run finished
  (885 files / 7,485 pass, 1.3 GB peak) where it used to take WSL down.
- **Not changed, on purpose:** the "two Employment options" are an option and a CONTAINER (Plan › Finances), not
  duplicates. Skipping 403 hosts saves nothing (a 403 is fast); the reason is shown instead.
- **Load (#8): a tab loaded in the BACKGROUND waited for the user to look at it.** Prod `[load]` samples: grid on
  screen median 128ms, ops start median 878ms, but 819 samples over 10s (up to 207s). Not the catalogue (760 of the
  792 slow ones had it; median 398ms). A hidden tab has rAF and never fires it, and `afterPaint`, the staged-mount
  pump and the load sweep all waited on one — so it asked for nothing and ran nothing until shown, then did it all
  at once. `afterPaint.canPaintSoon()` is false while `document.hidden`; those waits use a timer. **Not yet
  confirmed on prod**: `[load]` now ends `hiddenAtLoad=`, so the next slow lines say whether they were hidden.
- **Load, part 2: the builders run before the catalogue** (user picked "split by what they read", then "make the
  builders early"). A visible-tab load waited ~10s for the whole rest (rest 3.1s -> 9.7s, ops 10.4s); 63% of those
  bytes are artifacts no builder reads. The server now sends the rest in two tiers, non-artifact rows first, with
  `opsReady` on the chunk ending tier 1 (`state.js emitDeferred`). `utils/opReadScope.catalogueOps` names the load
  ops that need the artifacts (count steps, `$allArtifacts`, an unconfined `$allItems`/`$allOccurrences` read, a read
  under a page holding artifacts, a pipeline naming one, or a call to such an op) as `full_state.catalogueOpIds`:
  9 of 69 on poms. On `opsReady` the client flushes tier 1 as a PARTIAL store write (`awaitingDeferred` stays on, so
  feed sync still waits) and runs the rest of the load ops. A lookup of a row not loaded yet marks the op
  (`operationExecutor.watchMisses`, FIND `id IS`); its writes are dropped and it runs again with the catalogue ops
  over `withRowsSinceLoad`. `splitShownFirst` also keeps rows parented under a shown page that nothing lists (95 on
  the Schedule). Probe `tools/uisweep/_tierload.mjs`: the early pass ran (124 ops, 178 effects, 1.1s); this PC's
  link is too slow to measure the gain (tier 1 at ~56s, then a ping timeout).
  **Measured on the user's reload (Edge, fast link): ops 10.4s -> 5.2s, done 12.1s -> 6.3s, rest still 8.9s** — the day
  builds finish before the catalogue has arrived. `checkGrid` afterwards: no new duplicates (the two
  `7:00am › Exercise` pairs date to 2026-10-22).
- **The reload loop on a slow link (found while testing the above, and wrongly blamed on it for an hour).** All 51
  rest chunks (~11 MB) were emitted at once; at ~100 KB/s the heartbeat ping queued behind them past the 60s ping
  timeout, the server dropped the socket, the reconnect asked for a fresh full_state — a tab reloading the grid once a
  minute that never finished. It happened with the old sender too. `emitDeferred` is PACED now: at most 2 chunks
  unacknowledged (`emitWithAck`), the client acks on arrival, an old client gets the rest unpaced after 20s, a newer
  full_state cancels a send in progress. Fast link unchanged (rest 6.5s both ways); an 85 KB/s link finished (129s).
- **A hidden tab's sweep is not throttled:** `sliceWork.yieldToBrowser` uses a MessageChannel while `document.hidden`
  (a background tab's worker snapshot + sliced sweep took 95s and once 699s on timer throttling).
- This file split again (`CLAUDE.backup.2026-11-14.md`, 267 entries verbatim).

---

### 2026-11-11 (3) — A TOOLBAR DATE STEP SHOWS EACH AFFECTED PANEL'S LOADER

User: *"in that second, could you put the loading icon up for the effected filters cascaded … so the panels dont look
frozen"* · *"it should be the panels loading icon"*.
- `helpers/filterLoading.js` (NEW): the toolbar marks the filter fields it moved (`beginFilterLoading`); a panel whose
  shown page's effective filter holds one draws its own staged loader (`Spinner sm` + `.staged-hold-spinner`, 150ms CSS
  delay so a quick change shows nothing) over its body (`.panel-filter-loading`). It ends 400ms after the last op sweep
  (helpers/opActivity) plus a paint, 700ms if no sweep starts, 8s at most. The cap is armed once — the first version
  re-armed it per sweep, so a sweep that never stopped held it forever (the test caught it).
- The date change's NavigationOp now fires `afterPaint` (was `setTimeout 0`), so the loader is painted before the
  sweep blocks the thread.
- Watched on a local build against prod, writes blocked, with screencast frames: Next → Drive Map and Trackers (date
  filtered) show the spinner through a 4.8s block, Routines and Tasks (unfiltered) never do; Previous → on at ~0.5s,
  off at 3.5s. Test `filterLoading` (6). Client 7,454 pass.

---

### 2026-11-11 (2) — MAGIC REACHES A "+ PAGE" ARTICLE; quotes have one frame; a chip opens in our browser

User: Panta rhei (a page made with a link's "+ Page") "is not turning them into our nested containers … and i cant
magic it again" · the quote box has "a border inside of a border … the other one should be the frame" · "an open in
our browser button next to the open link button for minitextblocks" · Show greys out while Active is off (d94a2f86).
- **Magic found nothing:** the page is page -> doc container -> ONE textblock holding the whole article, and
  `helpers/pageMagic` only scanned the page's top level ("no plain text blocks"). `magicHosts` also scans the doc
  containers embedded on the page (one level, so a second click does not re-plan the sections Magic made), and
  `placePlan` drops the planner's "Imported" wrapper: its sections take the textblock's place. Watched on a local
  build against prod, writes blocked: the one textblock -> Origin · Flux doctrine · Reception by Goethe · See also ·
  Literature, 34 chips, quotes. **Not pressed on prod** (it rewrites the page; one Magic click does it).
- **Quotes:** inside a row the card draws no border / tint / left bar (`.instance-row .artifact-card--quote`).
- **🌐 on a URL chip** (`.itbi-browser`): `openUrlInPanel` now takes an occurrence's own `meta.link` as well as a url
  field. **And the first click on a chip's ↗ / 🌐 was always lost:** a read-only stand-in swaps to the live editor on
  pointerdown and replaced the chip under the pointer (pointerdown on the button, mousedown on the card) — both
  buttons stop pointerdown now. Tests `pageMagic` (+3), `openBookmark` (+1). Client 7,448 pass.

---

### 2026-11-11 — FILTERS: stacked menu rows, a green icon for ancestor filters, and a pick that runs no date ops

User: *"lets test filters next to improve performance there"* · menu rows *"stacked to avoid the …"* · the icon
*"should be green if any filter is set, local or ancestor"* · *"for the acquaintance one, its not showing that in the
header"*. Screenshots: the People container held Relationship = acquaintance (declared on the People page), its
icon red, no pill.
- **One cause for icon + pill:** `HeaderChevron` counted only the occurrence's OWN `filters[]` and the toolbar's nav
  fields, and pills draw only in the "active" state. Inherited declarations count now.
- **Menu rows** are two lines: name = value on top (wraps), controls underneath. Looked at on a local build.
- **Speed (People › Relationship pick, poms, writes blocked):** six date ops ran on every pick (Fill Day 0.24s,
  Days Until Due writing 13 values, Birthdays) and every feed re-synced. Now an op is skipped when every changed
  filter field is a non-date field it never mentions, feed passes are scoped to feeds under the changed occurrence,
  and an empty sweep builds no parent map. Blocked 1.7s → 1.1s, worst freeze 0.66s → 0.34s. Left: redrawing the
  People board (~1s until rows change). Client 7,443 pass.

---

### 2026-11-10 (2) — A DATE STEP'S OPERATIONS 2.2s → 1.1s: the read model was rebuilt for writes that cannot move it

User (account2): *"look into operations next and see if we can improve the performance at all so it doesnt freeze up
the app"*. account2 measured (`tools/uisweep/_opfreeze.mjs`, writes blocked) and hit its limit; finished here.
- **Cause, from a CPU profile + a rebuild counter (`window.__readModelDiag`):** the executor rebuilds its enriched
  `$allItems` (22k rows) after any op whose effects it treats as structural, and that list included meta, textmap and
  field-visibility writes. Build Schedule writes meta and Day Page: Build writes meta + textmap, so a date step rebuilt
  it 3 times and the NEXT op paid ~220ms each — Fill Day and Readings looked slow while changing nothing. Those three
  are now patched in place (they change no child list, parentId or filterOverride, the only things another row's
  enrichment reads). Readings' own cost was four `parentId IS x` FINDs over every row per day per book: FIND now reads
  a parent's rows from an index.
- **Measured on poms, local build, writes blocked:** ops per date step 2.0–2.3s → 0.9–1.4s; longest freeze 3.1s → 2.4s
  (Next), 2.8s → 1.6–1.8s (Previous); load ops 2.1s → 1.0s. Client 7,418 pass.
- **Left:** Build Schedule ~0.4s per step; ~1s of each freeze is outside the ops (redraw, feed pass).

---

### 2026-11-10 — SMARTER IMPORTS: one pipeline, shares land in Imports, a preview before Clip (`0489`)

Plan `docs/superpowers/plans/2026-11-09-smarter-imports.md` (spec `…/specs/2026-11-09-smarter-imports-design.md`,
ledger `.superpowers/sdd/2026-11-09-smarter-imports/progress.md` in the worktree — rulings R1-R12 are there). Tasks 1-2
by account3 (test set + OCR layout), 3-8 by account2 (account3 hit its limit mid-Task 3).
- **One pipeline** (`services/importPipeline.runImport`, extract -> `markdownToModuli` with `paragraphBlocks`): server
  OCR (`services/serverOcr`, tesseract.js, language data in `server/cache/tesseract/`; Node 22 needs the
  `wasm-feature-detect` 1.8.0 override), an image page PLACES the existing picture occurrence, < 3 words writes nothing.
  The OCR viewer's Magic "+ Page" sends the OCR page to the server.
- **Auto files into Imports (`0489`):** the link / text / image / pdf / catch-all rules' FIXED destinations -> the
  Imports folder (an expression destination — the extension's own pick — is kept); calendar, video, contact, profile
  untouched; already-shared items stay where they are. `IMPORT_TO_PAGE` (server executor): a link is a bookmark now and
  its readable page queued (`services/importJobs`, one at a time; they point at each other, `meta.readerPageId` /
  `meta.bookmarkId`; a page that cannot be read leaves `meta.readerPageError`); an image is OCR'd into a page, or with
  no text the picture moves into Imports; text is a page, or a row when too short. A re-share binds its page
  (`meta.importExternalId`). Catch-all v3 targets Imports.
- **Share window:** `GET /share/stage/:id/import-preview` (the pipeline in dry-run, 8s cap) -> "Will be created in
  Imports" under Auto; a link placed by hand: Keep as bookmark / Turn into a page / Both, a Body box, Pictures toggles.
- **Typed pages:** `utils/structuredData` (JSON-LD incl. `@graph` + `@id`, then Open Graph) and `services/boardMatch`
  (the board whose rows agree on the type's Board Category): a Movie page takes the Movies row's bindings and values,
  still in Imports. A link field is never written a name string.
- **Ollama clean-up (`services/importEnrich`) is built and OFF** (`IMPORT_AI_CLEANUP` unset). Measured 2026-11-10 on
  this PC's Ollama with llama3.2:3b (prod's model): rules 5.191 vs with-ollama 5.191; gnosis 0.997 -> 0.996; ellis +
  stanford refused by `acceptCleanup` (rewrites); mtu timed out; 14-64s per page. Re-measure with
  `node server/eval/imports/run.mjs --with-ollama`.
- **Corrections (`services/importCorrections`):** a user's own edit to a textblock of a page imported in the last 14
  days is kept (one per textblock per 10 min), fed to the clean-up as examples; `run.mjs --add-correction <id>`.
- **Eval:** `server/eval/imports/` (6 cases); `--check` gates OCR / import changes. Gnosis 0.797 -> 0.997, Ellis 0.899
  -> 0.914 over the morning's baseline.
- Server 3,599 / client 7,410 pass. `0489` applied to poms grid (snapshot `backups/poms-grid/2026-11-10T14-34-19…`) and
  test grid 2 (its catch-all), read back, deployed with a restart (prod Node 22: tesseract worker reads the Gnosis
  card; `wasm-feature-detect` 1.8.0 installed).
- **Watched on prod, test grid 2** (probe rules in poms' shape, a scratch token; all removed after): the Gnosis photo ->
  a page in Imports, 4 paragraph textblocks + its quote + the photo itself (still in Files); a Stanford Encyclopedia
  link -> bookmark + page in Imports (36 sections, 165 textblocks), pointing at each other; a Wikipedia link -> the
  same (20 sections, 50 textblocks, the lead picture). `run.mjs --check` passes on prod.
- **Found cleaning up:** deleting an imported page left its QUOTES behind (embedded in a textblock, listed and parented
  by nothing). `inlineChipOwnership.ownEmbeddedBlocks` lists + parents them to the text (`03f11eb9`, deployed).
  **`0490`** repaired what was stored (`758db14f`): a block embedded in exactly one text and owned by nothing is
  parented to and listed by it — poms 547 (541 quotes, the Eminem and Viafluere articles' root sections, 2 tables,
  2 textblocks) in 250 texts, test grid 2 26; read back 0 left; checkGrid shows no new finding.
- **A table in a blockquote is a table** (`758db14f`): the Stanford Encyclopedia's "Academic Tools" box (a
  `<blockquote>` holding a table) became a pull-quote reading "| | How to cite this entry. |". `parseBlocks` unquotes
  lines that form a markdown table (`|` rows + a `---` row); a real quote holding a `|` stays a quote. Re-planned:
  1 table, 0 quotes. After the deploy poms grid loaded in 9s (a full read; the ledger moved).
- **Not watched:** a share from the phone or the extension, the share window's preview and link choices in a browser,
  a Movie page matching the Movies board on a real grid.

---

### 2026-11-08 — A DAY'S OCCASIONS HOLDS ITS APPOINTMENTS (`0488`); an Occasions copy is a mirror

User: *"put in the occassion container in schedule, a copylink of the appointments for that day"* · *"using an
operation of course"*.
- **`Schedule: Place Dated Work`** gets a pass inside its Occasions block (0453): each instance under Tasks ›
  Appointments dated that day is copy-linked into the day's Occasions (`meta.datedWork/occasion/occasionAppt`);
  a copy whose appointment left Appointments is deleted (one moved to another day already was, by 0453's sweep).
  Triggers +3: added to / moved into / moved out of Appointments (0465's helper). Work Shifts are NOT included.
- **The double count, found before it shipped:** the appointment already has a linked copy in its start slot
  (0447), both under the Schedule, so every tracker counting completed Schedule rows would count it twice. Every
  AND group that skips feed copies (`<x>.meta.feedSourceId IS_EMPTY`) now also skips `<x>.meta.occasion`, and so
  does a group over INSTANCES/ITEMS under the Schedule page with no feed rule (`Day Page: Build Tasks Completed`).
  Container lookups are left alone (an Occasions copy is never one); OR groups are never touched. 56 ops. Holiday
  copies (0453) are now skipped the same way. Birthday cards carry no `meta.occasion` (checked).
- Tests `server/__tests__/occasionsAppointments.test.js` (7), `client/src/__tests__/occasionsAppointments.test.js`
  (5, real executor; A/B: no pass fails 5, no exclusion fails the count case). Applied to poms, read back, pm2
  restarted. **Watched (writes blocked):** stepping to Nov 9 put "CPS Class" in that day's Occasions beside its
  birthdays. A day not on screen fills when it is shown. Probe `tools/uisweep/_occappt.mjs`.

---

### 2026-11-06 (8) — A DATE STEP'S PER-COLUMN FIND READS AN INDEX; the 1.9s feed pass is traced, not changed

Picked up account2 (5-hour limit mid-investigation of *"look into the speed of a schedule loading"*).
- **`operationActions.recordsUnder`** — `Schedule: Build Schedule` asks, per off-screen day column, a FIND over
  `$allOccurrences` (~22k rows) with `_ancestors HAS_ANCESTOR <col>`, ~60 times a date step. A plain AND rule of
  that shape now narrows the pool from a per-LIST index (WeakMap, built on the second ask; the condition still runs
  on every narrowed record). Safe because the sweep's `_allItemsCache` is only patched IN PLACE for value-only
  writes (ancestors unchanged) and any structural write replaces the array. `setOccurrenceFieldValue` no longer
  builds a whole-grid map per call. Test `findUnderAncestor` (A/B: only the speed case fails without the index).
  Client 7,393 pass; client-only deploy `2acec349`, served chunk sha-matched. **Not re-measured on prod.**
- **The feed pass on a date step** (`tools/uisweep/_feedstep.mjs`, writes blocked, `__feedDiag`): ~25 whole-pass
  requests per step, decoded via the local source maps — `UPDATE_ITEM_LABEL` (tracker date prefixes),
  `UPDATE_ITEM_META`, and the CREATE / COPY_LINK parent-list writes in `applyOperationEffect`. They debounce into
  ONE pass, and the structural ones are real (a column added under the Schedule can change a scoped feed), so
  scoping the label/meta writes alone would not shrink it. The lever is scoping a STRUCTURAL write to the feeds
  whose `feed.scope` (or an `_ancestors`/`parentId` condition) lies on the written parent's chain — not done.

---

### 2026-11-06 (7) — A DAY STEPPED TO DURING THE LOAD WAITED FOR THE WHOLE CATALOGUE; and a half-grid load saved short counts

User: *"i just went to move nov 9th after reloading the grid and the loading bar for the schedule page just spins"* ·
*"it just showed up but that took forever"*.
- **Measured (probe `_restchunks.mjs`, prod):** the second half of full_state is 49 chunks of ~1.4 MB (~11 MB on the
  wire, deflate is negotiated). This PC's connection measured 65-100 KB/s to every host (cdnjs and Google too), so the
  rest took ~2 minutes; the same probe an hour later got it in 12s. The server sends every chunk the moment it is
  asked; the wait is the link.
- **And every template was in that half** (`_tplcore.mjs`: the Schedule's nine templates and the Day Page template all
  read 0 of 1 children when the first half landed). A new day is cloned from a template, so it could not be built
  until the end. `utils/splitFullState.templateRootIds` (pages under the Templates folder and its subfolders) are now
  extra roots of `splitShownFirst` / `holdBackText` in `state.js`: +542 rows in the first message. Watched on prod:
  every template complete in the first half; Next during the load built Nov 10's Schedule and Day Page columns at once.
- **The client fallback** (`bindSocketToStore`): it counts from the request (it used to count from the first half, and a
  page busy for 15s gave up before asking), a timer that fires LATE (>2s, the page was busy and the chunks were queued
  behind it) or while the socket is down waits another round (up to 180s), and a rest that lands after it ran re-runs
  the load sweep over the whole grid.
- **What the half-grid sweeps cost, read out of Mongo:** a load at 14:20 CST wrote short Song Counts (Ouse 87 of 92,
  Red Hot Chili Peppers 8 of 21, Khalid 2 of 24); a full load wants to correct 451 Song / 185 Episode / 181 Season
  counts. The next full load writes them (one ~18s apply), after that they hold. Found with the new opt-in tally
  `window.__loadDiag` → `window.__loadEffects` (the worker path logs no per-op line).
- Tests `templatesFirst.test.js` (3, wiring A/B'd), `fullStateRestChunks` (+2, both fail without the change). Server
  3,509 / client 7,387 pass. Deployed with a restart (`f166aac3`), then client-only.

---

### 2026-11-06 (6) — A DROP THAT THREW SWITCHED OFF EVERY OPERATION IN THAT TAB; Nov 7 was never built

User: *"i noticed daypage and schedule fail to build on future days"* (account2 hit its limit mid-investigation).
- **Read out of Mongo:** poms grid had Schedule + Day Page columns for Nov 6 and Nov 8 and **none for Nov 7**, the
  date the user's Edge tab set at 12:41 CST. That tab had been open ~50 min, froze (21s/17s long tasks, server "ping
  timeout"), reconnected, ran its load sweep (175 effects), and then **sent no create at all** for the Nov 7 step.
- **Not reproducible in a fresh or reconnected tab** (`tools/uisweep/_futuresend2.mjs`, `_futurerecon.mjs`, writes
  blocked): stepping to an unbuilt day sends the column creates, and a forced offline/online reconnect rebuilds Nov 7.
  account2's last probe stepped once to Nov 8, which already existed, so its "no creates sent" was expected.
- **The gate that can stick:** `DragProvider` called `beginDropBatch` → `routeDrop` → `endDropBatch` with no
  `finally`. A drop that throws leaves `_dropBatchFires` non-null, and every later top-level op fire in the tab
  (the date change's NavigationOp included) is queued into a batch nothing drains, until reload. Now
  `operationsBridge.runDropBatch(fn)` (try/finally) is the only way DragProvider opens it. Also `drainFires`: one
  held fire that threw stopped the rest of the batch and left the undo action open — it logs and continues.
- **Not proven to be what hit the user's tab** (its console was not available); it is the only gate found that
  blocks the build silently and permanently, and it fits "fresh tab works, long-open tab doesn't". A reload builds
  Nov 7. Test `dropBatchRecovers.test.js` (4; each guard A/B'd, fails exactly its own case). Client 7,382 pass.

---

### 2026-11-06 (6) — THE DAY ON SCREEN WAS NEVER BUILT: a window restored its own date, the pages kept the grid's

User: *"i noticed daypage and schedule fail to build on future days"*. Measured on poms grid: Nov 6 and Nov 8 columns
existed, Nov 7 (the grid's date) had neither, and no create for it ever reached the server — while a fresh probe tab
loading on Nov 7 built it fine (writes blocked; the page builds locally).
- **Cause:** since 2026-10-24 every window keeps its own layout, the DATE included (`helpers/windowLayout`
  GRID_LAYOUT_KEYS), and ignores other windows' date changes (`localLayout` LAYOUT_GRID_KEYS). The Schedule / Day Page /
  Trackers pages carry their OWN date (`filterOverride`, shared data that follows the toolbar), and the build ops build
  for the page's date. A window that reopened on its remembered date therefore showed that day in the toolbar while the
  pages — and the build — stayed on the grid's. The user's Edge tab reopened on Nov 7 with the pages on Nov 6: its load
  sweep built Nov 6 (already there: 175 effects applied in 1ms, no creates) and Nov 7 never. Measured the same way with
  a probe: window date Nov 10 → toolbar "Nov 10", 105 creates, all for the grid's Nov 7.
- **Fix (user's pick, "one shared date"):** `activeFilterValues` / `activeFilterId` are out of both lists — a window
  keeps its panels, pages and split, takes the grid's date on reload, and takes another window's date change live (that
  window ran the build). Probe after, window date Nov 8, pages Nov 7: old build toolbar "Sun, Nov 8", fixed build
  "Sat, Nov 7" = the pages. `windowLayout.test.js` / `localLayout.test.js` cases inverted with the reason.
- **The user's own reload built Nov 7** at 13:45 (50 slots + the day page), which is the same mechanism working when the
  window's date matched the pages'.
- Probes: `_futurebuild`, `_futuresend`, `_emitdiag` (`window.__emitDiag`), `_windate` (DAY= the window's saved date).
  **Probe trap:** a writes-blocked probe that loads on a missing day builds it LOCALLY; the next reload in the same
  browser can find it again (boot snapshot), so read "no creates" there with care. And `test grid 2`'s date was left on
  a multi-day pick (Nov 7 + 9) by the end-to-end test.

---

### 2026-11-06 (5) — FIREFOX AGREES WITH CHROMIUM; a search opened during the load never saw the rest of the grid

Sweep continued. **Firefox (the user's browser), desktop, 20 surfaces, writes blocked:** every failure it found is the
same row in Chromium's crawl — nothing Firefox-only. Its one difference (the row right-click menu "could not open") passed
on a re-run: timing.
- **Search (`ui/OccurrenceSearch`):** an open search keeps ONE index (2026-11-02, so a phone does not rebuild per key),
  built when it is opened — so a search opened before the deferred half arrived never showed the catalogue or imported
  pages until it was closed, and said "No matches". Found because the sweep's text-menu surface searched "Bonsai" 6s after
  a reload: empty for 60-90s. While `state.awaitingDeferred`, the held index is rebuilt only when ROWS were added (size
  change; a field write's new identity does not rebuild), and once more when the rest lands; the empty state says "still
  loading". Measured on a local build: Bonsai listed 8-10s after the search opened, without reopening. Test
  `searchWhileLoading.test.jsx`.
- **Alarms panel (`ui/AlarmDropdown`):** the close button and both on/off switches named; Preview sound / Delete / Clear
  are 24px boxes, the Alarm/Reminder toggle 24px tall. axe on the open panel: 0.
- **Field editors (`ui/Field.jsx`):** the six full-size `<Input>`s (text, number, date, duration hours/minutes) are
  named after their field (walker in `comboboxNamed.test.js`).
- **Read and left as crawler artifacts, so nobody re-chases them:** "Add a field — Escape does not close" (Escape closes it
  on a board row and inside a document, measured with listeners on window and document); the canvas colour / 2px chips
  "nothing" (already the selected values); a focused search box "nothing".
- **Double-click selected no word in a textblock (`ui/Editor.jsx` + `helpers/clickSelection.js`):** the editor places
  the caret itself on every left press (Firefox places none inside a draggable row), and that ran on the second press of
  a double-click too and collapsed the word the browser had just selected. Measured: Firefox selected nothing on a live
  block or a stand-in, Chromium nothing on a stand-in. The fix-up now selects the word on 2 clicks and the line on 3
  (`selectionForClicks`, same word rule as the right-click menu). After: "Bonsai" selected in both browsers, and the text
  right-click menu offers Cut / Copy / Delete / formatting again. Test `clickSelection.test.js`.
- **tools/uisweep:** `context.text` right-clicks article PROSE (a textblock or its read-only stand-in) — it had been
  right-clicking a row in both browsers, so it reported the row menu; `goTo` waits 20s on desktop for the first search
  and, when it misses, names what the search listed.

---

### 2026-11-06 (4) — RATING STARS AND THE PILL'S DICE ARE 24px; the share window sizes itself for a phone

User: *"enlarge them"* · *"make sure they are centered"* · *"please continue … with the ui testing"*.
- **`ui/Field.jsx`:** rating stars (both variants) are 24x24 buttons with a centred 16/18px star; "Pick random" (both)
  and the occurrence pill's "Go to" segment are at least 24x24. Measured on the Sweep Row: every star icon offset 0,0
  from its box, the dice/Go to 0.5px (their 1px left divider), every box centred in its pill; screenshot looked at.
  Live axe on poms rebuild: target-size 40 -> 4 (the 4 are the notification stack's back cards, behind the front pill
  by design). Test `ratingDiceTargets.test.jsx`.
- **`meta-viewport` is left, the user's call:** `user-scalable=no` (since the first commit) blocks pinch zoom, which
  fails WCAG, but the app has its own pinch gestures (ZoomableImage, EChart, graphView) and only a real phone shows how
  page zoom would interact with them.
- **Share window (`ui/SharePlace`):** it is its own page, so the phone sizing keyed on `body[data-layout]` never reached
  it — radios 13px, dropdowns 26px. `.share-shell` + `@media (pointer: coarse)`: radios 24px, boxes ≥32px (radios sit in
  their label, so the whole row is the target). **tools/uisweep:** `share.place` stages a link before opening (it had
  always opened an empty window — nothing set `ctx.stage`), and `LOCALBUILD` serves the share pages too (it served only
  `/`, so a local check of `/share-place` silently ran the live bundle).

---

### 2026-11-06 (3) — A PICKED DATE SHOWS AT ONCE; the date picker passes axe

User: *"keep going"*, then *"make sure to look at the performance of the datepicker too in things like filters. it should
be selected right away despite the filtered datas timeline"*. Measured with writes blocked, poms rebuild:
```
                                   desktop 1x          phone 4x
calendar day -> shown selected     77-115ms -> 4-7     382-923ms -> 30-39
date arrow -> label changes        71-116ms -> 2-7     392-575ms -> 11-20
```
- **Cause:** the picker set its selection and called `onCommit` in one handler, and `onCommit` is the filter change (the
  write, the ops listening to the date, every dated board's re-render), so nothing painted until all of it was done. The
  arrows' label came from the stored value, same wait.
- **`helpers/deferredCommit.js` (NEW):** `push` keeps the latest value and commits it after the paint (`afterPaint`);
  `flush` commits now. `NavPickerPopover` sends both commits through it and flushes on close and unmount.
  `FilterNavWidgets.ArrowsWidget` shows a `pending` date at once, later taps step from it (two quick taps = two days,
  one write), and the stored value wins again once the write has gone. Read back: 2x Next -> Nov 8 stored, 2x Prev -> Nov 6.
  Every date filter (toolbar, a page's or container's filter menu) uses these two components.
- **axe (sweep row toolbar#11):** react-multi-date-picker hard-codes unnamed month arrows and an `aria-label` on the
  other month's blank filler days. `helpers/calendarA11y.jsx`: `renderButton={calendarArrow}` (the library's classes kept,
  named Previous/Next month) and `watchHiddenDays` (filler days `aria-hidden`, re-applied as the month changes). axe on
  the open picker: 7 violations -> 0; Next month still turns November -> December.
- **Probe trap:** a probe that clicks a date right after load can be overwritten seconds later by `Grid: Snap Filter To
  Today` — with writes blocked the Last Opened marker never moves, so every probe load is a first load of the day. Settle
  30s first (`SETTLE=30000`).
- **Then the whole-page axe findings:** a board's items were `role="list"` holding rows that became `role="group"` the day
  before (`aria-required-children` on every board) — the items area is a named group now (`ModuleContainer`; the row
  component draws its own wrapper in docs and tables too, so it cannot be the list item). A `combobox` takes no name from
  its text, so every dropdown pill and the grid picker were unnamed: `aria-label` on each (walker
  `comboboxNamed.test.js`). The notification pill and the connection pill are 24px tall (were 22). button-name 20 -> 0,
  aria-required-children 3 -> 0. **Left, a design call:** the rating stars (14px) and "Pick random" (23x19) are segments of
  a row's field pills; 24px would make every desktop pill taller. Tests `deferredCommit` (7), `filterArrowsShowAtOnce` (3),
  `calendarA11y` (5); client 7,361 pass.

---

### 2026-11-06 (2) — DESTRUCTIVE PATHS, ONCE EACH, UNDONE; 1 API token in 6 could never authenticate

Sweep Task 9, picked up from the main account (weekly limit at 08:34 CST, mid-run).
`tools/uisweep/destructiveRun.mjs` makes each case's fixture on **test grid 2** over REST, presses the control,
reads Mongo, undoes once (Ctrl+Z on desktop, the side menu's Undo on a phone), reads Mongo again:
```
                 asks first                         done   one undo   desktop  phone
row delete       no                                 ok     exact      ✓        ✓
container, keep  Cancel / Keep them… / Delete all   ok     exact      ✓        ✓
container, all   same                               ok     exact      ✓        ✓
Break Link       no                                 ok     exact      ✓        ✓
Lock in place    no                                 ok     exact      ✓        ✓
Remove column    no                                 ok     exact      ✓        ✓
page delete      Cancel / Delete                    ok     exact      ✓        (right-click only)
folder delete    no (its contents move up)          ok     exact      ✓        (right-click only)
```
- **Fixed by the main account before its limit (`b8fd7298`, deployed):** a delete waits for the user's running writes
  (`utils/occWriteQueue.js`, `serialByKey.settled`) — "Keep them" left an empty container in Mongo when the late list write
  landed after the delete; and the column menu is placed against the window (`helpers/placeColumnMenu`).
- **Then the column menu was still unreachable:** fixed to the window INSIDE a transformed panel, so the next panel painted
  over it. Portalled to `document.body` (`ContainerTable`; the outside-click handler skips `.table-kebab-menu`).
- **API tokens (`models/ApiToken.js`):** `mint()` draws a 12-char base64url id, which can contain `_`, and `parse()` split on
  the first `_` — so ~1 token in 6 (`1-(63/64)^12`) was refused forever ("Invalid or revoked token"). Found because the probe's
  own token kept 401ing (id `sG9drTxWOD3_`). `parse()` reads the minted length; `authenticate()` also tries the old split, so
  nothing that worked stops. Live tokens with `_` in the id: 2, both the probe's. `apiTokenParse.test.js` (8; 4 fail before).
- **Probe faults, each a failed case until found:** test grid 2's root folder is its manifest's `rootFolderId`, not
  `usr-root-<grid>` (every probe page sat under a folder that does not exist, so the tree never showed it); a tree row must be
  scrolled into view and hit-tested before a right-click (it opened the PAGE's menu behind it); the phone drawer's Undo is a
  text button with no title. A crashed run's empty `ZZ`/`D …` fixtures are cleared at the next start.
- Server 3,506 / client 7,346 pass. Deployed `5f63d17c` with a restart; desktop + phone runs above are against prod.
- **Debris:** 17 empty orphan modules (R1, K1, A1, L1…) from the crashed runs at 14:04-14:07 UTC, swept with `sweepOrphans`.
  test grid 2's other `checkGrid` findings predate today (a module-less row from Oct 2, 6 filtered-empty containers).

---

### 2026-11-06 — THE CRAWLER PRESSED THE WRONG THING IN EVERY SUB-MENU; the accessibility rows

User: *"keep going please"*. Fresh crawls of every surface: phone 2,055 rows, desktop 3,707 (`docs/ui-sweep-2026-11-06-*.md`, crawled before the fixes below went out; the changed surfaces were re-crawled after).
- **`tools/uisweep/crawl.controlsIn` never cleared its numbers.** A sub-menu's control 0 resolved to the parent's control 0, behind the menu: 70+ rows said "covered by the backdrop", and every older level-two row, pass or fail, is void. Real taps showed the menu works.
- **Crawler reads that were wrong, so nobody re-chases them:** a phone date arrow "unreachable" was the tap landing and the thread busy past 2.5s (date moved; the crawler now says slow); a control in a `<label>` is named; Add a field "popup off screen 9000px" is a 460px menu scrolling its list; `context.tree`'s first row is PINNED, which has no menu; "Go there" on the row you are on and Escape stepping out of the field editor first are by design.
- **Phone:** tap minimum 32 for icon and text buttons in menus and forms and boxes there; tick boxes 24 over inline widths; date arrows 32 (24 on desktop) and named "Previous date"/"Next date"; tiny icons a 24px box; a table row's + no longer lies over a pill. The drag handle stays 26 and row corners 30 (user's sizes, they sit over content).
- **Names:** search boxes, settings close, Style and form dropdowns, form inputs, the field editor's boxes, the document editor. A row is `role="group"`: `listitem` with no list failed axe on every board.
- **Real defects found:** Escape did not leave a full-screen panel (`FullscreenOverlay`: it waits for typing and for a popup on top). On a column tile with no picture the lifted drag handle sat on the name (`container-items--content-column`; the label sets its padding inline, so `!important`, and only measuring showed the first rule was inert). 6 of 15 rows on the rebuild's Books, 0 of 65 on poms.
- **Left:** a few small targets (`+` 7x32, Unbind/Hide 16x32, Active 10x10, a 26x14 switch, desktop header icons under 24); axe on the date picker (`aria-prohibited-attr`, unnamed buttons); `share.place` is empty; the sweep's performance pass, destructive paths, consolidating pickers, Firefox.

---

### 2026-11-05 (3) — A LONG GRID BOARD NO LONGER BLACKS OUT: tiles entering a scroll draw light, posters are asked for late and small

User: *"look into scrolling boards and scrolling large boards ... i dont want a bunch of repaints that blank out the screen or stuttering"*, with a video (Movies). Measured on poms, Movies, full screen, 1050x958, prod vs this build, alternating (`tools/uisweep/_scroll.mjs`, gitignored, like `_scrollcheck.mjs`); the ranges are two rounds, except the people row and the phone wheel:
```
                                       prod              this build
longest black, wheel 1200px/30ms       757-6312ms        51-68ms
longest black, scrollbar drag          3116-5460ms       0
normal wheel 400px/30ms, start to end  17.6-18.3s        4.6-5.2s
 posters showing after stopping        12.0-13.5s        1.4-2.4s     <- a drag: 1.3-2.2s, about the same as prod
main thread blocked, drag              11-13s            0.7-1.3s
phone 4x, drag: longest black          3.6-6.3s          1.1-1.2s
People (stacked), 400px/30ms           no black, unchanged by design
```
- **Cause:** ~15 tiles a screen at ~25ms each in one task, so no paint for ~500ms while wheel events queued (hence 18s for a 5s gesture). CSS A/Bs (hover, contain, wallpaper, shadow, marquee) were not the lever.
- **`ui/DeferredTile.jsx` + `helpers/tileScheduler.js`:** a GRID board's tile that mounts during a scroll is its picture and name; it becomes the real row when the scroll settles (140ms), on-screen first, 8ms a frame. It keeps the row's class and ids and stays a direct child of the list. Waits at most 1200ms, so a slow continuous scroll still gets real rows. Light tiles are left out of line measuring.
- **GRIDS ONLY, and that is measured:** on stacked People a light row's other height made the virtualizer correct the scroll, which read as more scrolling, for ever (208,300px, no row ever real). Do not widen it without solving that.
- **Posters:** `helpers/tileImage` asks TMDB for w342 (~42 KB against ~88 KB) on tiles; the viewer keeps the full picture. A light tile asks only after 120ms on screen, so a fling queues nothing. `LoadingImage` remembers decoded pictures, so a swap does not fade one in again. `showRow` lookups: a WeakMap (`nextUnwatched`), 266ms of the scroll profile.
- A search calls `wantTileNow` (6s), so its target is real at once.
- **Probe faults, each of which produced wrong numbers:** full screen draws the panel TWICE, so `[data-panel-id]` found the hidden copy under the one the wheel scrolled (every coverage number before that was wrong); "the first scrollable ancestor" on a phone is one tile's `.instance-fields`; a wheel does not scroll in phone emulation (use DRAG=1); `blankFrames` counts the end of the list. Only a screenshot showed light tiles without posters, while the numbers looked fine. `settle` and `longestBlackMs` are the numbers to read.
- **Seen, left:** the search ring's designed double blink can run twice with a ~250ms gap when the page settles after the first (`jumpToOccurrence` pins this; prod re-blinks too). Scrollbar estimates on a phone vary (228k-371k px).
- **Live, after deploy (served chunk sha-matched):** normal wheel 4.7s, no black. Posters after stopping varied with the row you land on: 1.4, 1.6, 4.7 and once 16.4s (still in flight or decoding, no dead image; TMDB from this box). Not a fixed 2s.
- **Not watched:** a real phone, Firefox (the user's browser; all of this is headless Chromium), rotation on a live grid (`virtualAnchor` tests pass).

---

### 2026-11-05 (2) — THE CRAWL WORKS NOW; a restart is 51s, not 11 min; radial items moved to Settings; duration copies

User: *"fix the depugging of the sweep first"* · *"fix the 11 min load time for poms"* · move Export, Convert, Add a button, History, Apply Template into Settings, Filter Override off the radial, Hide Label on rows · a cover on a row's radial · *"make copies of occurances in the schedule for the duration"* · hide Done · the phone covers every surface, not just where it differs.
- **Crawler (`tools/uisweep`):** a missing root fell back to `document.body`, so a closed popup clicked the whole page, grid picker included. It reports "could not open" now; every surface starts from a fresh load, a control that cannot be pressed is retried once from a fresh load, each surface has a 5-minute budget. Right-click menus are `.menu-surface` (no `.context-menu` element exists). Desktop article 112 failures -> 4. **Not all green:** phone `row.body`/`account`, desktop `context.tree`, and the a11y rows are not triaged to zero (`docs/ui-sweep-2026-11-03.md`).
- **Load:** reads are limited to ~103 KB/s at Atlas, compression changes nothing, so a full read of poms is 11 min (it was not the debugger). `services/gridSnapshot.js` keeps modules + occurrences on disk; a restart reconciles by id + updatedAt. Measured on prod: **661s -> 47-51s**, row counts equal to Mongo. A migration moves the ledger, so that one load reads everything.
- **Grid switch:** one `request_full_state` instead of 7, 57s -> 4.2s (`state.js`, `helpers/gridSwitchRetry`).
- **Real defects:** a doc's lock under its lead picture; pick lists unnamed (listbox + labels); `[[x]](url)` printed raw and any bare `[`/`*` was deleted by the importer; phone tap targets from 10x15px; the row's + covered Show notes on a phone.
- **`0487` Schedule: Duration Copies:** a plain copy (`meta.spanOf`) in each further slot, no Duration, no tick; recomputed each pass. Watched on the rebuild: 240 min -> 7 copies, 60 -> 1, deleted -> 0. **Trap:** which events fire an op come from `triggerTypes`, not `triggerObjects`; a builder setting only the second never runs and a test calling the pipeline directly cannot see it. Applied to poms over REST (no restart), so `0487` is not in its ledger; running the runner would move the ledger. **Not watched on poms itself.** Copies do not follow a tick on the original.
- **Done** hidden on the 2 modules binding it (poms).

---

### 2026-11-05 — UI SWEEP: THE FIELD MATRIX IS DONE IN EVERY CONTEXT; what clicking found on the way

User: *"keep going please"* through the sweep, and *"increase the radial menu button and menu buttons a bit larger on
mobile and make sure the tracks arent covering up content"*. Each field type (30 fixtures on poms rebuild) was driven in
every context: row pill, table cell, doc pill, add-item picker, button form, header filter, operation step.
- **Phone:** the viewport sits beside every shown rail (`MobileGridNav.railInsetStyle`); handle 26px, arc buttons 44px
  (`RadialMenu.arcGeometry`), + 38px. A clipped neighbour panel now starts at x=364, so "visible panel" probes must not
  read rects alone.
- **Field edits were seconds late on a phone:** every edit re-synced all 59 feeds (1.4-2.3s at 4x), from the edit, its
  echo, and ANOTHER GRID's rows (writes go to all of a user's tabs). `feedMayReadFields` + `echoFeedScope`: ~0.1s.
- **Filters (`tools/uisweep/filterRun.mjs`):** removing a local filter wrote `filterOverride: {}`, which clears every
  filter at that level (only the sweep's own board was hit) — `filterConfig.removeDeclaredFilter`; a number filter drew
  the date stepper and stored a date — a number box now; the editor offered fields an ancestor filters, which then hid
  from the menu — not offered; the switch and box are named.
- **Operation steps (`tools/uisweep/opValueRun.mjs`):** a value was one text box for every type, so setting an occurrence
  field meant pasting an id no screen shows. ExprOrPath has a **value** mode (`blocks/StepValueField`: the field's own
  control, `helpers/stepValue`: literal or json, real number/boolean types) on Set field, attach-a-field rows and Update
  on `.fields.<id>.value`. A plain date in a `when` field reads as one-time (`when.toWhen`). A reference to a deleted row
  says "(deleted)" instead of the raw id (`occurrenceValueLabel`); 1 such dangling Meal value exists on the rebuild.
  28/28 in both text and value modes on a local build.
- **Left:** area crawl, consolidating pickers, accessibility findings, performance pass, destructive paths. The
  "uisweep fixtures (delete after)" API tokens are still to revoke when the sweep ends.

---

### 2026-11-03 (4) — VR ON ONE CONTROLLER; DVD discs play in order; shelves A–Z (APK built, NOT installed)

User: lost the left controller · the search takes no typing · shelves A–Z · *"if i drag a series to the dvd player, it
shoudl start with season 1 episode 1. if i drag a season, it should play that season"* · Nathan for You S4E3 "couldnt
play the file".
- **One controller** (`OfficeActivity` InputSystem): each stick does its hand's job; holding **B** (right) or **Y**
  (left) gives it the other hand's (right stick + B = resize up/down, tilt left/right). Old mapping unchanged otherwise.
- **Search typing:** a shelf text box sends `keyboard` on press; the app focuses that WebView and calls
  `showSoftInput(SHOW_FORCED)` (logs `keyboard for …`). A guess at the cause — not reproduced (headset not on adb).
- **A–Z:** `shelfItems` sorts by title (numeric, case-blind) unless the shelf has its own sort, and applies the
  limit AFTER sorting. Records were already A–Z.
- **DVD:** a series disc's src is `watch:<ep1>,<ep2>,…` (S1E1 first, S00 specials last, Jellyfin-linked episodes
  only, ≤400); a season disc gets its season's; an episode stays itself. `ReaderApp` reads a comma list as a queue
  (`ReaderQueue`: ⏮ n of N ⏭, next starts on `ended`). No Kotlin change was needed — `playTape` already passes the src.
  Episodes are indexed once per occurrence map (`episodeIndex`).
- **"Could not play":** measured from here, the server plays S4E3 fine (play info, master + variant playlists,
  a 424 KB segment in 3.9s). The player now prefers hls.js over the WebView's native HLS (the headset WebView claims
  native HLS). Unverified on the headset.
- Web half deployed (restart; `officeCore.mjs` rebuilt). APK built 16:34 with the minecraft-server JDK 25, copied to
  Windows Downloads (`moduli-office.apk`); the headset was not on adb, so NOT installed.

---

### 2026-11-03 (3) — A ROW'S NOTES ARE ITS OWN DOC AGAIN (`0485`); the DVD shelf had no query

User: *"the notes editor should be autocreating textblocks there, just like a doc"* · *"the dvd shelf … only gives me
the "setup" message on it"*.
- **Notes:** `0212` pointed every row's notes drawer at the `Notes` text FIELD (`grid.meta.instanceBodyLink`), and
  a field editor is plain text — it cannot hold a textblock. Measured first: Notes values existed only on the 21 CPS
  Class rows (mine, this morning), no op reads the field, no module binds it, no instance has body text. `0485` unsets
  the binding, so the drawer is `DocContent` over the row's textmap (mints textblocks like any doc), and moves each
  Notes value into ONE textblock in the row's textmap (17 textblocks; copy-linked rows share one). The seed no
  longer sets the binding. Watched on prod: the Nov 5 row's notes show the Zoom links in a textblock with its handle.
  **Not clicked:** typing on the empty line under it (the mint is DocContent's existing path).
- **DVD shelf:** the "Press ⚙ to choose what this shelf holds" message is the EMPTY-shelf text — it was placed with
  no scope. Set in `grid.meta.vrOffice` (pm2 restarted): scope = the TV Series board, condition Board Category
  CONTAINS `series` (the board also lists 181 cover images, which carry no category), title "TV Shows". The server's
  office state answers 193 shows, all drillable. **Not looked at in the headset.**
- **Then, user: the links "arent showing up"** (they were link MARKS, unstyled in Terminal) → *"it should be the same as
  every other link … a little arrow … contained in a minitextblock … edit the line like this message[link]"*. `0486`
  turns link marks in row-note textblocks into link chips (the importer's shape, parented + listed by the textblock;
  51 chips). A link chip now edits as ONE line `text[link]` (`docs/linkChipEdit.js`): focus swaps in the line, commit
  reads the address back (no brackets → the old address kept), Escape saves nothing. **Found by watching it:** the
  first build's Escape saved the `text[link]` line as the label (blur ran before setDraft landed) — fixed with a cancel
  flag, the one chip repaired. Watched on prod: edit → label + arrow target change; restored.

---

### 2026-11-03 (2) — A FILTER DECLARED ON A PAGE FILTERS THE BOARDS UNDER IT; Jellyfin plays in a headset window

User: *"i have relationship aquaitence set and it still shows friends on the people board"* · *"make sure all filter
types work"* · *"selecting none is auto turning off the filter … it makes it inactive"* · *"1 or 2 seconds for the
checkbox to recognize the click"* · *"i cant play any video in the vr app"* · *"dont have a way to hide the top toolbar"*.
- **Cause, read out of Mongo:** the People PAGE declares the Relationship filter; its container held the pick
  (`["acquaintance"]`) — and a container evaluated only its OWN `filters[]`, so nothing read the pick.
  `state/selectors.getInheritedLocalFilterConditions` walks up (nearest declaration per field wins, `active:false`
  switches an inherited one off); ModuleContainer, ModulePage and search's `filterKeep` use it. Census first: of the
  page-level declarations on poms only People's has a value anywhere (Trackers' Tags are muted, Schedule's unset).
- **All types** (`__tests__/filterTypesMatrix.test.js`): select (list / single), multi-select field, occurrence,
  boolean, number, text, date (day / week / month / several days), hide-blanks, no value. One gap fixed: a bare-day
  filter missed a row whose date carries a time (exact IS) — a date against a date now compares by day.
- **None picked is `[]`, never null** (`FilterNavWidgets.togglePick`, Clear): null is the filter switched off at that
  level. An empty list shows every row, blanks included. **The box ticks at once:** the multi-pick keeps its own
  picks and writes after the paint, in a transition. (Active off → Show off: account1, f79bdd43.)
- **No "hide toolbar"** on desktop or phone (a phone had no way back).
- **VR:** a Jellyfin row opened in a headset window plays (`ReaderApp ReaderPlayer`, the app's JellyfinPlayer; the
  window never mounted the file viewer that hosts it). A VHS tape of one is `watch:<row>` (`vr/shelfItems.watchSrc`)
  and the Quest app loads `?read=<row>&screen=<key>` on the screen; closing the player sends `stopVideo`. APK built
  and installed by account1 at 09:42 with its DVD shelf. **Not watched in the headset.**
- Measured, not built (user held it): 45 tracker ops are 0.56-0.63s of a 3.5-5s date step on desktop; the Schedule
  build + Fill Day are most of the rest (`_optime.mjs`).

---

### 2026-11-03 — PHONE HEADERS; THE FIRST MESSAGE CARRIES ONLY THE SHOWN PAGES (freeze 79s → 7s)

**Phone headers** (user: buttons big but fitting, labels not squished, filter into the side menu, one panel button,
the feed icon not stuck in the middle). Measured with `_mhead.mjs` at 390px:
- The toolbar's mini map is ONE "Switch panel" button (`mobile/PanelPicker`) that opens a dropdown of the phone's
  cells, each box named by the page its panel shows; a tap moves there. Grid publishes the cells
  (`activeCellStore.publishPhoneShape` now carries `cells`).
- Filters + the date nav live in the side drawer, inline (`ToolbarFilterDropdown inline`; a popover would open under
  the drawer). The phone clock shows the time only and "Operations running" only its spinner — with the full date
  the row pushed the clock onto the panel button.
- Every header button 34px with a 16px icon, one borderless look (the Files button was 21x17); instance labels 15px,
  container labels 0.95rem; the feed icon sits right after a header's label (containers and pages).
- `bookReaderHeadOneRow` pinned the old one-row header; since 2026-10-20 it wraps on a narrow pane on purpose. The
  test now pins that. Full client suite: 829/829.

**Load** (user: *"we have panels with multiple pages technically inside of them, so i want to make sure those arent
being loaded in too right away. Just the shown pages"*). Measured on poms (`server/_loadmeasure.mjs`): the first
message carried 15,775 rows (~28 MB) and the four shown pages needed 3,706. **`server/utils/splitFullState.
splitShownFirst`**: each panel and the page it shows (down through lists and embeds), every page row, a folder page's
card rows, and one hop of field references go first; everything else follows. 7,743 rows / 4,296 modules first.
The second half is cut by SIZE (`REST_CHUNK_BYTES` 1.5 MB, modules first) — one 4,000-row chunk was 17 MB.
Client: feed sync does not run on half a grid (it would sweep copies whose sources had not arrived); the 15s load
fallback restarts on every chunk (on a 4x phone the chunks landed at 17-30s, so it ran the sweep on half a grid);
a page or embed whose rows are still coming shows loading, not empty. **Prod, 390px, 4x CPU, same probe
(`_mobload2.mjs`):**
```
                    before      after
first message       24.0 MB     13.5 MB
panels / rows       18.5 / 20s  9.5 / 11.2s
longest freeze      79s         7s          <- the 17 MB chunk + its one store write
blocked, quiet      155s, 163s  56s, 60s
```
After: 0 creates and 0 deletes on poms in 25 min, one Schedule and one Day Page column for today.
**Not watched:** opening a not-shown page in the first seconds (it should spin, then fill). The remaining 7s is the
single store write + load sweep after the last chunk.

---

### 2026-11-02 (7) — A PHONE PAGES ROWS × COLS, NEVER THE DESKTOP MOSAIC; scroll numbers for every long board

User: *"the mosaic isnt working on mobile with the track and the new layouts. we should only keep the non mosaic mode
for mobile, so it shouldnt share the same layout as desktop."* Measured on prod (poms grid, 390x844): the phone drew the
desktop split tree (`treeToCells`) — panels at desktop proportions (744px wide on a 390px screen) and moving down from
Tasks landed on nothing. Now a mosaic grid on a phone takes the plain rows × cols path (`MobileGridNav` + `GridRender`).
**`helpers/phoneCells.js`**: a mosaic does not keep `placement` up — poms grid's two "Board 5" panels sat on Panel A's
and Panel C's cells, which rows × cols reads as STACKS — so each panel gets a cell of its own: its placement when in
bounds and free (grid order), else the next free cell, adding rows. Display only, nothing written; rows × cols grids are
untouched (a shared cell there is a deliberate stack). The toolbar mini map reads the same shape
(`activeCellStore.publishPhoneShape`). `MosaicMobileNav` and `bspTree.treeToCells` (+ its test) removed. Watched on
prod: Routines | Tasks (2 tall) / Trackers / Schedule, every rail move lands on one full-screen panel.
**Scroll, the other account's open item** (`_mboard2.mjs`: point Panel A at the board, 40 x 400px steps, 4x CPU, prod):
People 4.8s · Movies 5.5s · Songs 5.6s · Books 5.8s (126-153ms/step) · **People Table 24.4s (590ms/step, worst 1.1s)** —
the table is the next lever. Panel A put back on Routines after every run.
**Then (user: "2 by 3 … routines, tasks, and trackers stacked with schedule taking up the other 3"):** set on the
server — rows 3, cols 2, Routines/Tasks/Trackers in column 0, Schedule col 1 height 3; an empty Root panel the phone made
at 19:09 removed from the grid (user's pick). *"my phone app doesnt show that"*: each window lays its OWN saved layout
(`helpers/windowLayout`, since 10-24) over the server's. On a mosaic grid only phones read the rows × cols keys, so a
phone now takes `rows/cols/sizes/occurrences` + panel `placement/display` from the server, on load and from live updates
(`phoneSharesRowsCols`, `PHONE_SHARED_*`; `incomingGridPatch keepGridKeys`); its page choices stay its own. Probe with a
stale saved copy: deployed showed Schedule top-left + the Root panel, new shows the 3×2. Also: the up rail sat at 30px
under the 44px toolbar (8px tappable) — now at 44px, and the viewport moves down by it when there is a panel above.

---

### 2026-11-02 (6) — PHONE: one pill size; select filters filter; search and People scroll measured and fixed

User, in a row: mobile fields all different sizes · select inputs don't close · select-field filters don't filter and
should be a multi-select · search laggy on mobile, the panel's page first, duplicates (Collin Krainer: several
Files › Images) · People scroll blacks out. All measured at 390x844 with 4x CPU (`_mtap.mjs`, `_msearch.mjs`,
`_mpeople.mjs`, repo root), writes blocked in the probe.
- **Pill sizes (`8e40731d`):** an UNLAYERED `button { font-size: 12px }` in the phone media query beat the pills'
  Tailwind class, so every `<button>` pill read 12px and only the `<label>` date pill 14px. All field pills take
  `--cascade-field-font-size` on the phone layout; the multi-select's visible inner pill gets the 32px height. A table
  column never shrinks under 120px on a phone (People Table was nine ~80px columns of 14px slivers); it scrolls sideways.
- **Selects close on pick, filters (`6fe8de72`):** the compact single-select pills used an UNCONTROLLED Popover. A
  select / occurrence field's filter nav is one multi-pick dropdown (the pills' own list) writing a LIST; a row shows
  when it shares any value (this also fixes a multi-select row like Tags never matching `IS`). Jonah's `add_filter`
  wrote `{condition:$nav…, hides:false}`, which `getLocalFilterConditions` skips — a nav widget only. It writes the
  Filter menu's plain shape now; `0483` rewrote Quick Links + Trackers Tags (date navs kept, applied, pm2 restarted).
- **Search (`HEAD`):** hits under the panel's page first (`preferRootId`); one row per thing (feed copy / linked group
  → the one on your page, else the original; files a matching row's fields point at are not listed). An open search
  keeps its index; the index is warmed at idle. Prod: first search worst frame 2.4–2.7s → **0.97s**, second 0.1s.
  **Trap, measured:** using the shared `cachedParentMap` from the search made the SECOND search 18–23s of typing
  (operation sweeps ran under it); found by bisecting builds, reverted, commented in place.
- **People scroll:** 40 steps **19.5s → 7.9s on prod.** Not mounting — style recalc, ~370ms over ~10,400 elements per
  step: two `:has()` rules re-checked most of the page whenever the virtual list inserted a row — this morning's
  player rule `.artifact-spread-body--playing:has(> .spread-player-tile--max) > :not(…)` (now `… ~ :not(…)`, the player
  is the first tile) and the wrap-float rule ending `> div:first-child` (now `> .instance-handle-group`). Now ~115ms /
  950 elements. `noBroadHasRule.test.js` fails on any `ANCESTOR:has(…) > bareTag`. Found with
  `invalidationTracking` trace events. Rows are also measured by the virtualizer's ResizeObserver
  (`observerOnlyMeasure`) instead of a synchronous `offsetHeight` — that alone changed nothing measurable.
- **Not done:** rows still cost ~200ms a step at 4x (heavy person rows, 27 pills); a lighter placeholder while
  scrolling fast is the next lever. Not checked on a real phone.

---

### 2026-11-02 (5) — 4 CPS CLASSES WERE MISSING: the model skipped a week; dates are the server's job now

User: *"why all my cps classes didnt get added? mon-thurs for november"*. Read out of Mongo: 13 of 17 rows, all
made within 33s by one `create_items` call, and **Nov 23-26 (Thanksgiving week) absent** — every date the model
sent became a row; the 3B model simply left a week out of its list, and nothing said so. Repaired through the
REST API with a scratch token (deleted after): the 4 rows added from the Nov 19 row (same module, fields, list
position after it); a DUPLICATE Nov 2 copy in today's 4:00pm slot (two `Place Dated Work` runs 2 min apart,
two copies of one source, one `copyLinkSource`) deleted. Read back: 17/17 listed, slot holds 1.
**Fix:** `create_items` items take `repeat: {from, to, weekdays?, except?, dateField?}` —
`assistantBuildTools.expandRepeats` (pure; refuses a backwards range, an unknown weekday, >366 days) makes one
row per matching day, and the result carries `dates` so a gap is visible. Both system prompts tell the model to
send one repeating item instead of listing dates. **Checked against the real llama3.2 3B** (prod's prompt + schema,
2 runs, ~9s each): both sent ONE item with `repeat {from 2026-11-01, to 2026-11-30, weekdays [Mon..Thu]}` — and wrote
the path as `Tasks … Appointments` / `Tasks› Appointments`, so `splitPath` now also splits on `…` `...` `»` `|`. It
also puts a stray `Date` in `fields`; the expansion overwrites it. 9 tests; server 3,456 pass; deployed.

---

### 2026-11-02 (5) — PHONE: bigger tap targets; long boards stop sliding and keep their place when rotated

User: *"mobile buttons and inputs … too small … fields too … mobile scroll and search … boards and docs … would go to
the very end of a list if i changed from portrait to landscape"* · *"look at mobile performance in general"*.
- **Tap targets (`index.css`, `body[data-layout="mobile"]` only):** measured at 390x844, 54 of 59 visible buttons were
  under 32px. Field pills 32px tall / 14px text (vertical padding only — horizontal padding put the macro pills one per
  line), the switch 38x22, header buttons 34px, invisible 9px tap areas on the drag handle and row-corner buttons (the
  handle keeps 22px: 2026-07-04, a bigger one pushed row content down), inputs 16px (iOS zoom). Edge rails left at 22px
  — they sit over content.
- **Rotation (`helpers/virtualRows.js`):** Movies (grid) jumped to the END of the list: more tiles per line, a shorter
  list, the offset clamped. People (stacked) landed on another person — card heights change with width. Now the top row
  is tracked while scrolling (`topTileFromDom`, read from the rendered elements and only when the element covers the top;
  readings taken after a width change but before the watcher has seen it are skipped), and after a width change it is
  HELD at the top for `ANCHOR_HOLD_MS` by lining up its real element each frame, released by any touch/wheel/key.
- **The list slid by itself:** with scrollTop unchanged, People's top row went 561 → 514 in 2s as photos loaded. The
  comment said browser scroll anchoring holds the view; measured, it did not. The virtualizer's own size correction is
  back ON, and `estimateFor` keeps an unmeasured row's first estimate once it is above the rendered range (rows below
  still follow the average, which is what stops the end moving away). Drift probe (`_drift.mjs`): deployed 586 → 522,
  new 590 → 590. Rotation (`_rotate.mjs`): the same row before, during and after, 3 of 3. Flick coast 900 → 1,366px.
  Test `virtualAnchor.test.js` (A/B'd). Routines and a long doc (Eminem) already held; unchanged.
- **Search on the phone works:** the Inception movie hit opened the board, row on screen and ringed in 1.7s.
- **Load, measured (prod, 4x CPU):** panels 12-20s, rows 14-24s, blocked 55-69s over the first minute, 22k DOM nodes
  for a one-panel phone screen. One run froze 236s once and did not repeat. Not changed — the big lever is still the
  ~32MB first download (see the 09-28 dockets).
- **Jellyfin (same day):** loose `baldr/series/Season N` folders were all Curb — Jellyfin had matched them to other
  shows (Comedy Khiladigalu, Boys Over Flowers…). Merged into one show folder; Curb, DAVE, The Moaning of Life and The
  Office merged onto one drive each, best copy kept (55 same-drive duplicates deleted on heimdall, the rest parked in
  each drive's `_duplicates`); obfuscated / `1x01` names renamed. 177 shows, 0 duplicates, 0 repeated episodes. Sonarr's
  two wrong entries removed and paths repointed; RoboCop (2014) re-matched.

---

### 2026-11-02 (4) — JONAH ON THE 3B MODEL: CPS classes done, Quick Links not; the arrs read the drives

- **Jonah back on llama3.2:3b** with a short prompt and 17 tools (`14e93307`). **CPS classes worked end to end**:
  13 "CPS Class" rows in Tasks › Appointments (4:00pm, 4h), and a new **Class** option in Schedule Types tagged
  `appointment`. **Quick Links did not**: the 3B sent its lists as JSON text (now accepted, `asList`), and on
  the rerun it wrote the tool call as plain text with 2 rows. The board was built through the same
  `create_board` tool by hand: 13 bookmarks, Quick Link Type on each, filter with the nav showing.
  *A 3B model can fill a short flat call; a 13-row nested one is past it.*
- **The Jellyfin player is a tile in the file viewer** (`326f800a`, account3's open item).
- **Arrs:** the Norse drives are mounted read-write (`mount-norse-drives.ps1`). Radarr 981 movies / 740 with a
  file, Sonarr 177 series / 3,080 episode files, Lidarr 151 artists / 3,589 tracks (refreshes still running).
  **241 Radarr movies have EMPTY folders** (231 on baldr, dated 2021) — they are monitored, so they will be
  searched once an indexer exists. Three hash-named files imported through Radarr's ManualImport.
  qBittorrent + SABnzbd are on all three arrs; Prowlarr syncs to all three but holds **0 indexers**, and
  SABnzbd has no Usenet server.

---

### 2026-11-02 (3) — JONAH GETS ONE-STEP BUILD TOOLS; the 7B model cannot answer in time on CPU

User picked "A": tools for a board with rows, select options, a filter with nav, bulk items; switch to qwen2.5-coder 7B;
rerun the Quick Links board + CPS classes tests (classes use Schedule Type **Class**, which did not exist).
- `services/assistantBuildTools.js` (NEW, `0effe73d`): **create_board** (board page in a folder + container + bookmark
  or item rows, `selectFields`, `filterField`), **create_items** (many rows into a container named by path, e.g.
  "Tasks › Appointments", field values BY NAME; an occurrence-field value that names no option is ADDED into the
  field's `addNew` container, tagged with its query's literal values, bindings copied from a sibling option),
  **add_filter** (Filter-menu shape: active, showNav, nothing set). `create_field` takes `options` and drops a string
  `meta` (the 3B model's field stored meta as a spread string). Offline allowlist + system prompt updated.
  Tests `assistantBuildTools.test.js` (11; removing the add-option branch fails the CPS case). Server 3,443 pass.
- The broken "Quick Link Type" field from the first run deleted (0 bindings / values / filters). Prod
  `OLLAMA_MODEL=qwen2.5-coder:7b`.
- **Rerun: both requests failed before any tool ran** — "Ollama timed out (>50s)". Measured from prod: the 7B runs
  on **CPU only** (`/api/ps` size_vram 0), prompt reading **~28 tokens/s** (3,032 tokens → 108s). Jonah's prompt is
  ~6k tokens, so one generation needs ~200s of reading; Cloudflare cuts at 100s, retries ate the 300s budget.
  Nothing was created. This PC (integrated Radeon) is not the Ollama machine. **Open, the user's call.**

---

### 2026-11-02 (2) — THE FINAL REVIEW'S SIX FIXES SHIPPED; the tunnel comes back on its own after a silent PC

Picked up from two accounts (account3 ran the final review and its fix wave until its limit; the main account finished
most of it and hit its weekly limit before deploying). Shipped as `9c785c8d`, deployed with a restart:
- **Offline within ~8s:** a segment still waits up to 30s for a slow ffmpeg, but after 5s with no headers the proxy
  pings `/System/Info/Public` (3s) and answers 503 when nothing comes back. The player maps a 503 (and an hls network
  error with no answer) to the offline message on both the hls.js and the native path.
- **Played vs. progress race:** a progress report's UserData write is skipped when `/played` ended the session while
  it was in flight, and `markPlayed` waits for an in-flight report first. Empty `cfg.userId` is refused.
- **Sync skips a run within 15 min** of the last successful one (memory + `grid.meta.jellyfinLastSyncAt`), checked in
  the route before the 202; `force` and dry runs bypass it. The Jellyfin client is built before the 202.
- **Signed creates are atomic across sockets:** `create_batch`'s duplicate-signature check + insert are serialized per
  user+grid (`signatureCreateAcrossSockets.test.js`, two sockets → one row).
- **A rewatch started in Jellyfin's own app is not a finish** (a play with a resume position left is skipped).
- Minor: Play only for playable item types, fMP4 `.mp4` segments under `/hls`, a 401 key reads "rejected the API key",
  UserData failures are logged. S00/E0 matching and the hidden sign-in user list (0 public users) were already done.
- **sshd `Match User tunnel` / ClientAliveInterval 15 / CountMax 3** on prod (reloaded) and in the README. The
  running tunnel predated it, so it was ended once (PC reconnected in 12s). **Watched:** the tunnel's packets dropped
  on the droplet (iptables, that connection only, with a 3-min safety removal) → the old session released 8097 at
  +61s and the PC reclaimed it at +69s. Before: up to ~2h.
Server 3,429 pass; client only the known `bookReaderHeadOneRow` failure. **Not watched:** the proxy's 503 timing and
the player's offline message on the live site (unit-tested), Firefox, a phone, episodes, Play next.

---

### 2026-11-02 — JELLYFIN PLAYS INSIDE MODULI; three defects only prod could show

The media-streaming plan (`docs/superpowers/plans/2026-11-01-media-streaming.md`, ledger
`.superpowers/sdd/2026-11-01-media-streaming/`), Task 10 = end to end on prod. What exists now:
- **Tunnel:** Jellyfin on the PC (:8096) reaches the droplet as `127.0.0.1:8097` through a reverse SSH tunnel (user
  `tunnel`, port-forward only; Windows task "Moduli media tunnel", `infra/media-tunnel/`). `media.viafluere.com` (nginx +
  certbot, DNS-only) serves Jellyfin's own web app; Jellyfin transcodes on the GPU (h264_amf), remote cap 4 Mbps.
- **Proxy** `/api/v1/jellyfin/media/*` — session or `?t=` only, an allow-list of an item's own media paths, the key
  added server-side (`services/jellyfinProxy.js`); access log off for that location (the `t=` would be logged).
- **Sync** `POST /api/v1/jellyfin/sync` + op **Jellyfin: Sync** (onLoad + 05:00; enabled 2026-11-02 at the user's go-ahead):
  links rows by file path / provider id / title+year (`meta.jellyfinId`), creates what Moduli lacks, copies Played.
  **Real run:** 7,071 items · **link 4,468** · create **Danny Documentaries 1,822 / movies 20 / TV 7 / seasons 24 /
  episodes 182** (2,029 with a cover copied into uploads/) · **ambiguous 539** (289 duplicate files, 246 episodes of 5 shows
  with duplicate Moduli show rows, 3 provider-id clashes, 1 year-less title) · skipped 18. Mongo: 6,523 linked rows, the
  Danny board lists 1,822. A dry run straight after: link 0, create {}, unchanged 6,523 — idempotent.
- **Player** (`ui/JellyfinPlayer.jsx`, overlay; Play on a linked card, "Play next unwatched" on a series/season row):
  resume, progress, at 90% Last Watched + Watched At + Jellyfin Played. **Media: Log Watch** puts one completed Watch in
  that day's slot (`meta.watchFor = <row>@<Watched At>`).

**Watched on prod** (headless Chromium, native HLS — it decodes H.264 here; Brightburn on the Movies board):
```
Play          GET /play 200 -> master/main.m3u8 200 -> segments 206, 1280x720, currentTime advancing
every request /api/v1/jellyfin/media/... with ?t=; 0 of 8 bodies hold the Jellyfin key (key grep, not printed)
seek to 50%   segments 905+ fetched; pause -> close -> reload: GET /play resumeSeconds 2,718.8; Jellyfin UserData 2,719
seek to 92%   Last Watched 2026-11-02 + Watched At written, Jellyfin Played/PlayCount 1, ONE Watch in
              Schedule - Monday, November 2nd › 5:00am; three more loads (each ran the sync): still one
```
**Three defects, each found only by doing it on prod, each test-first and deployed:**
1. `hlsUrl` had no `VideoBitrate`, so Jellyfin STREAM-COPIED the 1080p h264 source (~19 MB per 6s segment, slower than
   real time over the 9.6 Mbps hotel upload), and the first segments of a session 503'd on the proxy's 5s header
   timeout while ffmpeg started. Now `VideoBitrate=3500000&AudioBitrate=128000` (720p, ~1.4 MB/segment, 1-3s) and HLS
   segments wait 30s for headers. Before: "Could not play this file." (`48c8b929`)
2. **Resume never saved:** under the admin key `/Sessions/Playing{,/Progress,/Stopped}` and `/PlayingItems` all answer 204
   and store no position (that session has no user; Jellyfin 12.4.0, tried by hand). Progress now also writes
   `POST /UserItems/<id>/UserData?userId=<owner>`. (`261e8702`)
3. **Three Watch entries for one viewing:** the player writes Watched At, then `/played` makes Jellyfin stamp
   LastPlayedDate ~3s later; the next load's sync read that as a newer watch, rewrote Watched At, and Log Watch keyed a
   second entry — from two open tabs at the same millisecond, so two. A Jellyfin play within 2h of Watched At is now the
   same viewing (`SAME_VIEWING_MS`). (`c4595a4c`)

**Put back:** Brightburn unplayed in Jellyfin (Played false, position 0), its Last Watched / Watched At cleared through
`update_occurrence`, the test Watch entries deleted through `delete_occurrence` (0 left, 0 dangling refs), Panel A back on
Routines after every probe. **The op stays enabled**, as approved.

**NOT verified:** the real tunnel-down case — the PC's task was not stopped; the offline copy ("Media server is offline —
the PC may be asleep." + Open in Jellyfin) was rendered from a STUBBED `/play` and the server's offline branch is covered
by unit tests only. Not on a phone, not in Firefox (its Playwright build has no H.264), not hls.js (Chromium played HLS
natively), not "Play next" or an episode. Jellyfin's web app was not looked at — its UserData was read over its API.
**Open, the user's call:** the sync runs on EVERY page load (14 runs on 2026-11-02, ~7,071 items each) — the 05:00
trigger alone may be enough; two tabs creating the same `identitySignature` within milliseconds both got through
(`create_batch`'s duplicate check is not atomic across sockets); the 539 ambiguous items (list in the Task 10 report).

---

### 2026-11-01 — A TEXTBLOCK'S HEADINGS LOOK LIKE HEADINGS BEFORE THE FIRST CLICK

User: *"my headers inside textblocks dont resolve either when i first load them, it waits for me to click to edit the
document"*. The lazy stand-in (`ui/StaticTextmap`) drew a heading as a bold body-size `<div>`; the heading sizes and
colours are `.doc-editor-content.ProseMirror hN` rules, which only reach the live editor. The stand-in now renders a
real `<h1>`–`<h6>` (level clamped) and every heading rule also names `.textblock-card-placeholder hN` (plus
`--md-body` on the placeholder). Test `staticTextmapHeadings` (3; the old component fails 2). Client-only deploy;
served CSS carries the rule. **Not looked at in a browser.**

---

### 2026-10-31 (6) — SEARCH KEYS PER USER; TMDB TV; USDA INGREDIENTS (`0469`, `0470` dry run); grocery toggle

- **Keys are not hardcoded** (user: *"a section in command center imports that allow for search boxes and api
  keys"*). A provider declares `apiKey: { id, env, label, getUrl, demo }` (`id` shared: TMDB films + TV are one
  key). Resolution: the user's key (Command Center › Imports › **Search sources**, `ui/commandCenter/
  SearchSourcesSection.jsx`; stored encrypted on `user.meta.searchKeys` by `services/searchKeys.js`, never sent back)
  → server env → demo key. Routes `GET/PUT/DELETE /api/v1/search/keys[/:keyId]` (session only). `/api/search/*`
  reads the session (`searchUser` in server.js) and the client search fetches now send `sessionHeaders()`.
- **`tmdb-tv`** provider (`/search/tv`, `showFields`, `seasonEpisodes`) on the TMDB key; prod already has one.
- **`usda`** provider (FoodData Central, Foundation + SR Legacy, DEMO_KEY fallback): 24 nutrients per 100g in the
  grid's units, Omega-3 summed (ALA 851|619 + EPA/DPA/DHA), `rankFoods` (USDA ranked "Croissants, apple" first).
  Open Food Facts stays for packaged things — for "spinach" it returned a creamed-spinach brand with zeros.
- **`0469`** (applied): 20 "<nutrient> per 100g" fields + **Grams** + a **Grocery List** button bound on the 28
  ingredient rows; the Ingredient search → usda with all 24 keys mapped to per-100g fields; op
  **Ingredients: Scale to Grams** (plain = per-100g × Grams ÷ 100, empty Grams = 100; onChange Grams / any
  per-100g, onAdd under Ingredients + Grocery List); op **Ingredients: Toggle Grocery List** (the Grocery List is a
  feed on Board Category `grocery`, so the button adds/removes that tag); the one onCreate trigger → onAdd.
  Executor test `ingredientsGramsGrocery` (6).
- **`0470` applied ON PROD** (the user's key decrypts only with prod's SECRETS_KEY): 27 ingredients, 700 empty
  values, with hand-picked FDC ids via `USDA_MATCH_PATH` — USDA's search put chocolate frozen yogurt first for
  "Frozen Mixed Veggies", rice crackers for "Rice", sheep milk for "Milk". Skipped: CBD Gummies, Zucchini Peppers
  Onions (a mix), Coffee Beans. Rows that had their own macros (Milk Calories 122) kept them. `rankFoods` reworked
  (every typed word, few untyped words, Foundation, plural stems).
- **`0477`**: Fill the row on the 7 media grids that lacked it (Movies, TV Series, Albums, Games, Songs, Comics,
  Artists), like Books. Read back 8/8.
- Queued (user): Episodes board + an op adding new episodes; Episode / Song fields whose options narrow to the
  picked show / album (a "Limit options" prefill setting writing a `$this` rule — the resolver already supports
  `$this`); a VR TV shelf that works like records.

---

### 2026-10-31 (5) — BUTTON-MADE ROWS FIRE onAdd; a changed pick clears what it no longer fills; Ingredient sums the minerals (`0468`)

- User: *"the operations should work for all onAdd buttons as well"*. A row an operation creates INSIDE a user
  action (a button, a form) now fires OccurrenceCreateOp (`bindSocketToStore.fireOpCreateTrigger`, deferred a task,
  run in the gesture's action). Derived / action-less creates (load sweep, schedules) and feed copies fire nothing;
  rows made by the ops that fire runs do not fire again (one level, held until a sliced sweep finishes). Test
  `opCreateFiresOnAdd` (5; A/B: no call fails 2, no depth guard fails 1). `0467`'s explicit RUN_OPERATION is now
  redundant (Place Dated Work is idempotent), left in place.
- User: cleared Meal and Ingredients, *"the cal and carbs stayed the same but the protien and fats zeroed out"*.
  The transaction log: each removal re-summed, the last ingredient left was 70 / 0 / 20 / 0, and removing it wrote
  nothing (prefill skipped an empty pick and "never overwrote with empty"). `planPrefill` now CLEARS a filled field
  when the pick is emptied or when nothing left in it carries a value, chained (Meal → Ingredients → nutrients).
  A pick whose rows have not loaded still writes nothing. Tests `prefillFromPick` (A/B: 3 fail on the old helper).
- *"I also need all the other supplements to update"*: Eat binds (hidden) Magnesium, Iron, Zinc, Calcium, Omega-3,
  Sodium, Potassium; the Ingredient prefill never named them. `0468` adds a sum row for every number field the
  Ingredient-binding rows carry and the map lacks (dry run named exactly those 7; 17 → 24 rows). Only 16 of 363
  ingredient rows carry a non-zero mineral, so most totals stay 0 until values are entered.
- Prefill is configured per field in Command Center › Fields › (an occurrence field) › Prefill (`PrefillEditor`).

---

### 2026-10-31 (4) — "NEW TASK" PLACES ITS OWN TASK (`0467`)

User: *"i just created a task todo and it didnt add it to the schedule todo until i reloaded"*. Read back: the task
("prepare for cps training", 14:41:36) carries `meta.createdByOperation` — the New task BUTTON is an operation, and a
row an operation creates fires no add trigger, so 0465's onAdd never heard it; its copy appeared at 14:41:55 with the
reload. **`0467`** inserts `RUN_OPERATION Schedule: Place Dated Work` right after New task's Create (ASK_FORM → CREATE →
RUN_OPERATION → SCROLL_TO), the way Build Schedule calls Completed Tasks. Pure `runPlacingAfterCreate` (one top-level
CREATE or it refuses; idempotent). `client/src/__tests__/newTaskPlacesItself.test.js` drives the real executor: the
callee lists the just-created task; without the call it does not (control). Applied to poms, read back, pm2 restarted.
**Not watched in a browser** (it would mean creating a task on the live grid).

---

### 2026-10-31 (3) — THE SNAP TO TODAY IS THE OPERATION'S JOB (`0466`); a window that reopened on yesterday kept it

User: *"loading up today still didnt change the top toolbar filter to today"* → *"this all should be done via
operations, not hardcoded"*. Measured: the grid's stored date and the Last Opened marker were both today (stamped by
the 8:15am load). Each window keeps its own layout, the date included (`helpers/windowLayout`, 10-24), so a window
reloading on its saved yesterday found the marker already today and `Grid: Snap Filter To Today` skipped. A first fix
in app code (a saved window date expires at midnight) was REVERTED at the user's word. **`0466`** rewrites the op:
`$snapStale` is set when the marker is not today OR `$activeDate DATE_BEFORE $today`, and the old else body (SET_FILTER
today, move dated pages, stamp the marker) runs under it. A future date is left alone. Pure `snapWhenStale`
(idempotent, refuses an unknown shape); `client/src/__tests__/snapTodayWhenPast.test.js` drives the real executor,
with the old op shown not snapping in the same case. Applied to poms, read back, pm2 restarted.
**Kept, app-side:** `helpers/dayRollover` (reload on a new day) only makes the load happen; the op decides the date.

---

### 2026-10-31 (2) — A TASK ADDED TO TASKS › TODO REACHES THE SCHEDULE AT ONCE (`0465`)

User: *"could you see why all my todo didnt get transfered to schedule"* · *"and why new ones dont get added"* · *"if a
task ends up in todo it should auto add it to the one in schedule"*. Measured: all 6 Tasks › Todo rows ARE in today's
(and yesterday's) Schedule Todo — 5 as todo copies, Talk to Angela through its Due. Nov 1's column was built Oct 28
and lacks the two tasks made Oct 30 (and still holds a copy of Clean hotel room, moved out since). The cause:
`Schedule: Place Dated Work` (0453's todo-copy pass) ran only on load, a date change and edits to Date / Time Slot /
Due / Completed On, so a task added or dragged in waited for a reload. **`0465`** adds three triggers at the op's
priority: onAdd instance under Tasks › Todo, onMove instance under it (a move's ancestors are its landing place), and
onMove from the Todo container (`fromContainerId`; the sweep removes the copy). The container id is read off the op's
own pipeline. Applied to poms, read back (8 → 11 triggers), pm2 restarted. Test `todoTasksPlaceOnAdd` (3).
**Not watched in a browser.** The op runs over the days on screen, so a day not on screen updates when it is shown.

---

### 2026-10-31 — A TAB LEFT OPEN OVERNIGHT RELOADS ONTO TODAY; an alarm that missed its minute still rings

User: *"make sure that my overall filter changes to todays date on first load? also the alarm for 6am is never going
off anymore … i came back to the page this morning with the last update being like at 8pm the night before and it
didnt do anything till i reloaded"*. Measured: prod's log shows the tab reconnecting with its last send **11h**
earlier and the grid's transactions stop at 9:15pm and resume at 8:14am — the browser had put the tab to sleep
(Edge, sleeping tabs). The 6:30 alarm last rang **Oct 21**. A reload DID snap the date (`activeFilterValues` reads
today), so the snap op works; it simply never ran in a tab that never reloaded.
- **`helpers/dayRollover.js`** (installed in `main.jsx` for the grid app only): when the local calendar day differs
  from the day the page loaded, reload — checked on visibilitychange, `resume`, pageshow, focus and once a minute;
  never while typing; at most once per day. The reload is the "first load of the day" Snap Filter To Today and the
  day builders are written for.
- **`useScheduler.isDueAt` atTimes**: due when an alarm time passed since the last fire and is at most 15 min ago
  (was: only if a tick landed inside that exact minute — a throttled background tab ticks about once a minute).
  `notBefore` keeps a time set/retimed while the tab is open from ringing at once. Test
  `dayRolloverAndAlarmCatchUp` (13; the old scheduler fails the 3 catch-up cases).
- **Idle CPU (user agreed, "if it doesnt hurt performance"):** a poms-grid tab doing nothing used ~11% of a core
  (headless, no GPU). Profiled: JS ~0; the one running animation, the toolbar notification pill's infinite
  `tx-marquee`, was ~60 style recalcs/s and ~2.7s per 30s. It already had `will-change` (A/B'd: no change). It now
  pauses (`animation-play-state`, same layout) while the window is unfocused or hidden (`helpers/windowActive`).
  Measured on the local build: unfocused 3.0s → 0.36s per 30s, focused unchanged. With a GPU the focused cost is
  probably lower than measured here.
- **Not fixable from the page:** a sleeping tab runs nothing, so an alarm cannot ring while the tab sleeps. The user
  must add viafluere.com to Edge's "Never put these sites to sleep" list.

---

### 2026-10-30 (13) — DOC SECTIONS DRAW READ-ONLY UNTIL NEAR VIEW: Eminem's open freeze 5s → 0.6s

User: *"yes please"* (lazy section editors) · *"also look at the time it takes to open the manifest sidebar"*.
- Every section (an embedded doc container) mounted its editor at open — ~45 on Eminem. A section's textmap is
  embeds, so the textblock stand-in could not draw it. **`lazyEditor.sectionStandIn`** expands them: a textblock →
  its own content in a `standinCard`; a sub-section → `standinSection` (label + its expansion); a picture → a 220px
  `standinBox`; a table → 30 + 28/row; wrap groups flattened; never null. `DocContent` takes `sectionLazy`
  (ModuleContainer passes it for embedded doc containers), so the section goes live via the IntersectionObserver
  (700px) or a press. `StaticTextmap` draws the new node types; CSS keeps rough shapes so the page keeps its length
  (Eminem: 34.2k px at open → 34.7k after three 2,500px scrolls). **Measured (local build, prod data):** longest
  freeze **5,046 → 589ms**, blocked 6.3 → 2.3s, 3 editors at open (was 46). A search jump into an unmounted section
  (`jumpToOccurrence`) first forces live the sections on its ancestor chain (`forceLiveAncestors`) and looks again.
- Found, not fixed (predates today, both builds): clicking a TEXT BLOCK result inside the Eminem article in the
  toolbar search opens nothing.
- The file tree: opening it measured ~80ms of work on a fresh browser (collapsed or Root expanded) — not reproduced;
  asked the user for their case.

---

### 2026-10-30 (12) — OPENING EMINEM: 8.2s → 4.5s; the textblock stand-in draws lists, marks and chips (`ui/StaticTextmap`)

User: *"opening a page is taking an extremely long time (took 5 seconds to open up the eminem article)"*. Measured
(rAF gaps from the search click, prod data): **8.2s, 79 live editors, 0 stand-ins** — my own regression from (1) of
this morning: `standInBlocks` returned null for any textmap holding a list or a chip, so every textblock with a link
chip (Eminem: 744 chips) mounted its editor at once. Now the stand-in DRAWS paragraphs, headings, bulleted/numbered
lists, bold/italic/strike/code/underline/links, line breaks and doc chips (the chip's own component, `editor={null}`,
as an idle table cell) — `ui/StaticTextmap`, used by TextblockCard and DocContent; only tables, pictures, embeds and
other nodes still mount eagerly. After: **4.45s, 46 editors, 33 stand-ins, 744 chips drawn**; the build from before
the regression (1646e8bd) measured **4.1s / 42 editors**, so the remainder predates today. Those 46 editors are the
article's SECTIONS (doc containers), not textblocks — tried `onUse` on DocContent blocks: no change, reverted. The
stand-in of Eminem's lead paragraph draws its 60 chips and full text. Next lever if wanted: lazy section editors.

---

### 2026-10-30 (11) — table pills keep their bottom border; list boxes: "Cardio:" in the header style, pill-round corners

User: *"the bottom border is now cut off on some of them"* · *"it should say Cardio: and be the same font as the headers
for the list"* · *"the border corners need to be as rounded as the other field pills"*. The idle marquee clips
vertically too and left the pill 1px each way (lost to rounding in some cells) → `padding-block: 2px` (measured 3px
room above and below, idle and hovered). A list field's title row takes the column headers' style (600, 0.55,
muted ink) with a colon. The list box's corners are 11px — a one-line field pill's 999px radius on its ~22px height.

---


## Claude Session Directives (ALWAYS FOLLOW)

### Token Efficiency — Read Less, Do More
- **Check folder-level `CLAUDE.md` files FIRST** before re-reading source files. Every folder I've touched has a `CLAUDE.md` with a file map and recent changes summary. Use it.
- **Never re-read a file you already touched this session** unless the user explicitly changed it. Track what you've modified.
- **When you touch files in a folder**, update/create that folder's `CLAUDE.md` with the changes made, so future sessions don't re-read the source.
- Key folders with CLAUDE.md: `client/src/`, `client/src/ui/`, `client/src/helpers/`, `client/src/state/`, `server/`
- Memory files are at: `/home/joshpoms/.claude/projects/-home-joshpoms-dndtest2/memory/`

### Pragmatic Programmer Philosophy (ALWAYS APPLY)
- **DRY** — Don't Repeat Yourself. Every piece of knowledge has a single authoritative source. No duplicate logic.
- **Orthogonality** — Keep modules independent. A change in DragProvider shouldn't require changes in ContextMenu.
- **ETC (Easier to Change)** — Design for changeability. Prefer patterns that are easy to modify over ones that are prematurely clever.
- **Tracer Bullets** — Build end-to-end thin slices first, then fatten. Wire Panel → Context → Socket → Reducer before polishing UI.
- **Don't Live with Broken Windows** — Fix bad designs immediately. Don't patch on top of wrong abstractions.
- **The Boyscout Rule** — Leave code cleaner than you found it. Small improvements add up.
- **Contracts (interfaces)** — Each module has a clear public contract. CommitHelpers is the only layer that talks to socket. Components never call socket directly.
- **Power of Plain Text** — Data in plain, portable formats. No magic string formats that only one place understands.
- **Don't Outrun Your Headlights** — Implement one phase at a time. Don't spec Phase 9 while Phase 6 is incomplete.
- **Good Enough Software** — Ship working features before polishing. Don't let perfect block good.

### Session Rules
- Each time you touch files in a folder, update that folder's `CLAUDE.md`
- Start each session by reading `MEMORY.md` and relevant folder `CLAUDE.md` files — not source files
- At 80% context: stop new features, wrap up current task, update MEMORY.md
- At 90% context: only review/cleanup — no new work
- Always leave system in a testable state (`npm run dev` must work)

---

## How the Data Works

### Server (MongoDB via Mongoose)

There are two things stored in the DB for every piece of content: a **Module** and an **Occurrence**.

**Module** is the template — it defines what something is. It has a `role` (panel, container, instance) and a `kind` (list, doc, artifact, board). For file-backed content it also has a `fileRef` path (e.g. `notes/morenotes.md`). Modules don't store position, order, or any per-session state. They are reusable.

**Occurrence** is the placement — it's what actually appears on screen. Every occurrence points at a module via `targetId`. It stores:
- `fields: {}` — field values for this specific placement (e.g. how many reps you did *today* in *this context*)
- `textmap` — TipTap JSON for rich text containers/artifacts
- `parentId` — which parent occurrence or folder this lives inside
- `occurrences: [ids]` — ordered list of child occurrence IDs (this is how ordering works — NOT on the module)
- `viewId` — points to a View record (only when this occurrence needs rendering config)
- `iteration` — time filter + category filter + persistence mode

**View** is a separate record. Occurrences that need rendering config (e.g. a panel showing an artifact file tree) have a `viewId` that points here. View stores `viewType`, `hasTree`, `manifestId`, `activeOccurrenceId`, `layout`. Modules have no viewId — only occurrences do.

**Manifest + Folder** handle the file tree sidebar. A Manifest has a `rootFolderId`. Folders form a tree via `parentId`. Artifact occurrences place themselves in the tree by setting `parentId = folderId`.

**Field** records define what data an instance can collect (number, text, boolean, select, date, duration, rating). Fields are shared templates — instances bind to them via `fieldBindings`.

**Operation** records define automation pipelines. Each has a `pipeline: { sources, steps }` where steps are a top-down code flow: INIT_VAR → LOOP → IF → ADD_TO_VAR → SHOW_VALUE. No black-box aggregations — the math is explicit.

```
Grid
 └── occurrences: [panelOccId, ...]       grid owns the panel occurrence IDs

Panel Occurrence  (viewId → View or null)
 ├── targetId → Module [role: "panel"]
 └── occurrences: [containerOccId, ...]

Container Occurrence  (textmap if kind=doc/artifact)
 ├── targetId → Module [role: "container", kind: "list"|"doc"|"artifact"|"board"]
 └── occurrences: [instanceOccId, ...]

Instance Occurrence
 ├── targetId → Module [role: "instance"]
 └── fields: { fieldId: { value, flow } }

Artifact Panel → View { viewType:"artifact", hasTree:true, manifestId }
  Manifest → rootFolder → Folder children
    └── Artifact Occurrence (parentId = folderId)
         ├── targetId → Module [kind: "artifact", fileRef: "notes/x.md"]
         └── textmap: TipTap JSON  (synced to artifacts/notes/x.md on save)
```

### Client (React + Socket.io)

On connect the server sends `full_state` — a flat dump of all modules, occurrences, views, manifests, folders, fields, operations, computedValues for the user's grid. The client stores these in Redux-like state maps (`modulesById`, `occurrencesById`, `viewsById`, etc.).

**Rendering**: `Grid.jsx` reads the grid's occurrence list, renders a `modules/Panel` for each panel occurrence. Panel reads its child occurrence IDs, renders `modules/Container` for each. Container renders `modules/Instance` for each instance occurrence. If the panel occurrence has a viewId pointing to an artifact view, Panel renders `modules/View` which shows `ManifestTree` sidebar + `modules/Artifact` content.

**Mutations**: Everything goes through `CommitHelpers.js` — the only place that calls `socket.emit`. Components call CommitHelper functions, which dispatch to local state immediately (optimistic) and emit to server. Server persists and broadcasts to other windows.

**Operations**: Triggered by field changes, drops, or iteration changes. `bindSocketToStore.js` catches the trigger event, calls `executePipeline` in `operationExecutor.js`, which runs LOOP/IF/action steps and returns effects. Effects (SET_FIELD_VALUE, SHOW_VALUE, etc.) are applied via CommitHelpers. `computedValues` in state holds display field outputs keyed by `[occurrenceId][fieldId]`. `FieldRenderer` reads from computedValues when `field.displayEnabled`.

**Drag**: `DragProvider.jsx` handles all drag events. Copy = new occurrence with same targetId. Move = update occurrence.parentId + reorder parent.occurrences array. Doc container drop = insert pill at cursor position in TipTap editor.

### Field Values and Flow

Field values are stored as `{ value, flow }` where flow is `"in"`, `"out"`, or `"replace"`. Operations loop over occurrences and aggregate based on flow direction — `"out"` values are negated (expenses, time lost). This lets you have one `amount` field serve both income and expenses in the same operation.

### Module Kinds
| Kind | What it renders | Notes |
|------|----------------|-------|
| `list` | Drag-sortable instance list | Default |
| `doc` | TipTap rich text editor | Field pills, instance embeds |
| `board` | Containers as columns | Kanban-style |
| `artifact` | File content by viewType | Markdown / image / PDF / audio / video |

### Transactions (Audit Trail)

Every change produces a **Transaction** record. Transaction types:

- **MeasureOp** — a field value changed on an occurrence: who (instance), what (field + value), where (container context), when (timestamp)
- **OccurrenceListOp** — an occurrence moved from one container to another: captures source/destination and a field snapshot at the time of move
- **EntityOp** — a module was created, updated, or deleted
- **DocEditOp** — a doc container's textmap changed (TipTap steps)

Transactions have a `state` field: `"applied"`, `"undone"`, or `"redone"`. Undo/redo flips the state and re-applies or reverses the change. The full history is queryable — you can ask "what was the value of this field last Tuesday?" by replaying transactions up to a point.

### Iterations (Time + Category Filtering)

**Iterations** control what data each occurrence "belongs to". Every occurrence has an `iteration` object:

```
iteration: {
  timeFilter: "daily" | "weekly" | "monthly" | "yearly" | "all"
  timeValue:  Date   — specific date/week/month this occurrence is pinned to
  categoryKey: String  — e.g. "context" (optional)
  categoryValue: Mixed — e.g. "work" (optional)
  mode: "persistent" | "specific" | "untilDone"
}
```

**Modes:**
- `persistent` — shows in every iteration (e.g. a recurring habit)
- `specific` — only shows on a particular date/week
- `untilDone` — shows until its `completionFieldId` field goes truthy

**Grid.iterations** defines named iteration configurations (e.g. "Daily Work", "Weekly Personal"). Each has a `timeFilter` and optional `categoryKey`. The grid has a `selectedIterationId` and `currentIterationValue` (the active date/week/month). Panels, containers, and instances can each `inherit` the parent's iteration or set their `own`. This cascades: Grid → Panel → Container → Instance.

**IterationNav** (Toolbar) lets you advance the global time position (prev/next day, week, etc.). Panels with `mode: "own"` show their own local arrows independently.

### Templates

Modules are already templates — the same module can have many occurrences in different places. But there's also an explicit **Templates** feature:

- `grid.templates: [{ id, name, moduleIds, occurrenceIds }]` — saved workspace snapshots
- `save_template` socket event — captures a container (+ its instances) as a reusable template
- `fill_from_template` socket event — stamps a new set of occurrences from the template into a target container
- Templates let you define a "Morning Routine" layout once, then stamp it into any time slot on any day
- Drag a saved template from the Command Center into any container to fill it

---

## Implementation Roadmap

### Phase 1: Occurrences & Core DnD — 98% Complete

| Feature | Status |
|---------|--------|
| Occurrence-based architecture | ✅ Done |
| Pragmatic Drag and Drop integration | ✅ Done |
| Panel/Container/Instance hierarchy | ✅ Done |
| Grid-based cell placement | ✅ Done |
| Copy vs Move modes (per-entity) | ✅ Done |
| Session ref for sync drop handling | ✅ Done |
| RadialMenu with portal z-index | ✅ Done |
| Panel stacking and navigation | ✅ Done |
| Sorting within parents | ✅ Done |
| Drop indicators with edge detection | ✅ Done |
| Live preview during drag | ✅ Done |
| Auto-scroll during drag | ✅ Done |
| Cross-window copy (basic) | ✅ Done |
| Socket.io real-time sync | ✅ Done |
| External file/URL drops | ✅ Done |
| Touch/mobile drag support | ✅ Done |
| Resize touch support | ✅ Done |
| Multi-window sync | ⬜ Not started |

**Remaining (2%)**: Multi-window sync (optional enhancement).

---

### Phase 2: Fields & Calculations — 97% Complete

| Feature | Status |
|---------|--------|
| Field model (input/derived modes) | ✅ Done |
| Field types: number, text, boolean, select, date | ✅ Done |
| Field types: rating, duration | ✅ Done |
| Checkbox inputs (boolean variant) | ✅ Done |
| Toggle switch inputs | ✅ Done |
| Number inputs with increment/decrement | ✅ Done |
| Text inputs | ✅ Done |
| Select dropdowns | ✅ Done |
| Date inputs | ✅ Done |
| Rating inputs (1-5 stars) | ✅ Done |
| Duration inputs (hours + minutes) | ✅ Done |
| Field bindings on instances | ✅ Done |
| Value storage as `{ value, flow }` | ✅ Done |
| Flow-based aggregation (in/out/any) | ✅ Done |
| All 15 aggregations (sum, count, avg, median, mode, etc.) | ✅ Done |
| Scope filtering (grid/panel/container/instance) | ✅ Done |
| Time filtering (today, thisWeek, thisMonth, etc.) | ✅ Done |
| Target scaling across time periods | ✅ Done |
| Progress bar display (in FieldDisplay) | ✅ Done |
| FieldRenderer routing to correct component | ✅ Done |
| FieldPillInput/FieldPillDisplay compact mode | ✅ Done |
| Schema enum for all 15 aggregations | ✅ Done |
| Select field multi-select mode | ✅ Done |
| Select field quick-add options | ✅ Done |
| Select field removeOnComplete | ✅ Done |
| Emotion wheel mood selector | ✅ Done |
| Watchlist/reading list with completion hiding | ✅ Done |
| UI for flow direction selection | ✅ Done |
| UI for configuring allowedFields | ⬜ Not started |
| **Future: Select Field Aggregations** | |
| Count occurrences of each select value | ⬜ Not started |
| "Most common emotion this week" aggregation | ⬜ Not started |
| Select value distribution charts | ⬜ Not started |

**Remaining (3%)**: allowedFields UI.

---

### Phase 3: Transactions & Block System — 88% Complete

**Transaction System** captures WHO, WHAT, WHERE, WHEN for every change:
- Time-travel queries for historical aggregations
- Audit trail with timestamp, previousValue, flow direction
- Undo/redo via transaction state (applied/undone/redone)

**Block System** (Snap!/Scratch inspired visual programming):
- Block types: FIELD, LITERAL, VARIABLE, OPERATOR, COMPARISON, LOGICAL, AGGREGATION, FUNCTION, CONDITION, LOOP
- Block shapes: REPORTER (oval), STATEMENT (rect), C_BLOCK, HAT
- Full visual editor with drag & drop

| Feature | Status |
|---------|--------|
| **Transaction System** | |
| Transaction model (MeasureOp, OccurrenceListOp, EntityOp, DocEditOp) | ✅ Done |
| Undo/redo system (useUndoRedo hook) | ✅ Done |
| TransactionHistory.jsx UI | ✅ Done |
| Server undo/redo socket handlers | 🟡 Partial |
| Undo slide-back animations (FLIP) | ⬜ Not started |
| **Block System** | |
| blockTypes.js (all block types & shapes) | ✅ Done |
| blockEvaluator.js (recursive evaluation) | ✅ Done |
| useBlockDnD.jsx hooks | ✅ Done |
| Block.jsx, Slot.jsx components | ✅ Done |
| BlockPalette.jsx (toolbox) | ✅ Done |
| OperationsBuilder.jsx + OperationsCanvas.jsx | ✅ Done |
| **Notifications & Feedback** | |
| Toast notifications (sonner) | ✅ Done |
| FieldValueIndicator (green/red arrows) | ✅ Done |
| useAnimations hook (FLIP animations) | ✅ Done |
| GridRadialMenu (Undo/Redo/History/Fields) | ✅ Done |
| **Future** | |
| Offline support with sync queue | ⬜ Not started |
| Conflict resolution | ⬜ Not started |
| Achievement badges | ⬜ Not started |

**Remaining (12%)**: Server undo handlers completion, slide-back animations.

---

### Phase 4: Rich Editor, Iterations & Artifact System — Complete

**Rich text with embedded field/instance pills + compound iterations + unified artifact model.**

| Feature | Status |
|---------|--------|
| **Editor (ui/Editor.jsx)** | |
| TipTap editor with @ mentions (FieldPill, InstancePill, DocLink) | ✅ Done |
| DocToolbar (Bold/Italic/Strike/Code, H1-H3, Lists, Unlink, MD export) | ✅ Done |
| FieldPillExtension + InstancePillExtension + DocLinkExtension | ✅ Done |
| Drag instances into doc → inserts pill | ✅ Done |
| **Artifact System (modules/)** | |
| modules/Artifact.jsx — pure content renderer (markdown/image/pdf/audio/video) | ✅ Done |
| modules/View.jsx — layout + ManifestTree sidebar routing | ✅ Done |
| ManifestTree — folder tree, click to set activeOccurrenceId | ✅ Done |
| occurrence.textmap replaces docContent (TipTap JSON in DB) | ✅ Done |
| textmap → artifacts/[fileRef] sync on save | ✅ Done |
| POST /api/artifacts/upload — creates Module + Occurrence + View | ✅ Done |
| artifacts/ static middleware | ✅ Done |
| **Three-Concept Model** | |
| occurrence.viewId → View (separate model, NOT on module) | ✅ Done |
| occurrence.parentId + occurrence.occurrences (tree ordering) | ✅ Done |
| module.fileRef for artifact file reference | ✅ Done |
| Doc.js + Artifact.js deleted (replaced by textmap + fileRef) | ✅ Done |
| panels/ folder deleted (replaced by modules/) | ✅ Done |
| ui/Field.jsx — merged FieldDisplay + FieldPillDisplay | ✅ Done |
| **Iteration System** | |
| IterationNav.jsx, IterationSettings.jsx | ✅ Done |
| Compound iterations (time + category), cascading | ✅ Done |
| Local iteration arrows on panels/containers | ✅ Done |
| **Remaining** | |
| ModuleEmbed TipTap extension (@:(id) universal embed node) | ⬜ Not started |
| Day pages auto-creation operation | ⬜ Not started |
| Live value calculation in field pills | ⬜ Not started |

---

## Compound Iteration System (Phase 4 Enhancement)

### Current State
The system uses `occurrence.iteration` with:
- `key: "time"` - time-based filtering
- `value: Date` - specific date
- `mode: "persistent" | "specific" | "untilDone"`

### Enhanced Design: Compound Iterations

Iterations can be BOTH time-based AND category-based simultaneously. Categories work like tags/contexts that can filter independently of time.

**Enhanced Schema:**
```javascript
// Occurrence iteration
iteration: {
  // Primary axis: time (always present)
  timeKey: { type: String, default: "time" },
  timeValue: { type: Date },
  timeFilter: { type: String, enum: ["daily", "weekly", "monthly", "yearly", "all"] },

  // Secondary axis: category (optional)
  categoryKey: { type: String },    // "context", "project", "area", null
  categoryValue: { type: Mixed },   // "work", "personal", ["health", "fitness"], null

  // Persistence mode (applies to both axes)
  mode: { type: String, enum: ["persistent", "specific", "untilDone"] },

  // Completion tracking (for untilDone mode)
  completedOn: { type: Date },
  completionFieldId: { type: String },
}

// Grid iteration definitions (user-configured)
Grid.iterations: [{
  id: String,
  name: String,                     // "Daily Work", "Weekly Personal"
  timeFilter: String,               // "daily", "weekly", etc.
  categoryKey: String,              // "context", "project", or null
  categoryOptions: [String],        // ["work", "personal", "health"]
}]

Grid.selectedIterationId: String,   // Current iteration definition
Grid.currentTimeValue: Date,        // Current time position
Grid.currentCategoryValue: Mixed,   // Current category filter (or null for all)
```

### Cascading Iterations

Iteration settings can be overwritten as you go down the hierarchy:

```
Grid: Daily + All Categories
  └─ Panel (inherit): Daily + All Categories
      └─ Container (own: Work only): Daily + Work
          └─ Instance (inherit): Daily + Work
  └─ Panel (own: Weekly): Weekly + All Categories
      └─ Container (inherit): Weekly + All Categories
```

**Key Principle**: Each level can either:
- `inherit` - Use parent's iteration settings
- `own` - Override with specific settings

### Local Iteration Navigation

Each panel/container with `mode: "own"` can have its own iteration arrows:

```
┌─────────────────────────────────────────┐
│ Schedule Panel                    [⚙️]  │
│ ◀ Mon, Feb 10  [📅] ▶   [Work ▼]       │
├─────────────────────────────────────────┤
│                                         │
│  • 9:00am Meeting                       │
│  • 10:00am Code review                  │
│                                         │
└─────────────────────────────────────────┘
```

The panel can navigate its own iteration independently of the grid's global iteration.

### Use Cases

1. **Daily Schedule + Work Context**: See only work items for today
2. **Weekly Goals + Personal**: See personal goals for this week
3. **Panel with Different Time**: Grid is daily, but one panel shows weekly view
4. **Category-Only Filter**: Same day, but filtered to "Health" context

---

## Summary: Phase Status

| Phase | Name | Completion |
|-------|------|------------|
| 1 | Occurrences & Core DnD | **100%** |
| 2 | Fields & Calculations | **97%** |
| 3 | Transactions & Operations Pipeline | **100%** |
| 4 | Rich Editor, Iterations & Artifact System | **92%** |
| 5.1 | Cascading Style Overrides | **100%** |

**Phases 1-3, 5.1: Complete. Phase 4: 92% (ModuleEmbed + day-page auto-creation remaining).**

---

## Known Issues

### Priority 1 — Bug Fixes
- [x] ~~**Field schema enum mismatch**: Fixed - all 15 aggregations now in schema~~
- [x] ~~**Panel backgrounds missing**: Fixed - added @config directive for Tailwind v4~~
- [x] ~~**Copy/move drag glitchy**: Fixed - session ref for immediate mode access~~
- [x] ~~**Container fields missing**: Fixed - spread `...obj` in loadUserIntoCache~~
- [ ] **React child error**: forwardRef icon components (intermittent)

### Priority 2 — Polish
- [ ] Touch gesture optimization for mobile
- [ ] Performance optimization for 100+ items

---

## Quick Reference

### Running the App
```bash
# Development (runs client + server)
npm run dev

# Reset sample data
cd server && node scripts/resetData.js
```

### Key Files
| File | Purpose |
|------|---------|
| `client/src/helpers/DragProvider.jsx` | Drag state coordinator |
| `client/src/helpers/CalculationHelpers.js` | All calculation/aggregation logic |
| `client/src/helpers/CommitHelpers.js` | CRUD operations |
| `client/src/ui/FieldRenderer.jsx` | Field display routing |
| `client/src/ui/IterationNav.jsx` | Time navigation controls |
| `client/src/ui/IterationSettings.jsx` | Persistence mode selector |
| `client/src/state/selectors.js` | Occurrence resolution helpers |
| `client/src/blocks/` | Visual block programming system |
| `client/src/docs/` | Rich text editor & pills |
| `server/models/Occurrence.js` | Occurrence schema with iteration |
| `server/models/Transaction.js` | Audit trail schema |

### Architecture Patterns
- **Occurrence-based**: Entities are templates, occurrences are placements
- **Session refs**: Immediate state access during async operations
- **Flow values**: `{ value, flow: "in"|"out"|"replace" }` for aggregation
- **Per-entity drag mode**: `defaultDragMode` on panels/containers/instances
- **Panel placement**: Position stored in `occurrence.placement` (not panel.row/col)
- **Iteration inheritance**: Grid → Panel → Container → Instance cascading
- **Compound iterations**: Time + Category filtering simultaneously

---

## Original Vision (Day Planner Explanation)

### What it is (in plain English)

A **drag-and-drop daily command center** where:
- You plan your day by **dragging tasks into time slots**
- You can also **track what you actually did**
- It can **calculate totals, streaks, progress, and stats automatically** from whatever you log

Think: **calendar + to-do list + habit tracker + budget/nutrition/workout tracker**, all in one.

### The big idea: "Anything you do can be measured"

A normal planner: "I did laundry ✅"

This planner:
- "I ran ✅ **for 25 minutes**"
- "I ate ✅ **42g protein**"
- "I saved ✅ **$20**"
- "I studied ✅ **2 pomodoros**"

Every task can be just a checkbox **or** a checkbox plus numbers/text.

### How scheduling works

**1) Build a "Task Bank"** - Your library of stuff you do (work, gym, meals, finance, routines)

**2) Drag tasks into your day** - Single task, multiple tasks, or preset bundles

**3) The schedule becomes your plan AND your log** - Same slots represent intent and reality

### How calculations work

The app calculates anything based on:
- **What task it was** (Protein vs Savings vs Meditation)
- **What value you entered** (42g, $20, 15 minutes)
- **What time "lens"** (Today, This week, This month)
- **What category filter** (Work only, Personal only, All)

So it can answer:
- "How much protein did I log **today**?"
- "How much did I save **this month**?"
- "How many **work** tasks did I complete **this week**?"
- "What's my streak for journaling?"

### One-liner

A **drag-and-drop day timeline** where every task can be a **checkbox or a measurement**, and the app can **sum/count/track progress across any time window AND category** without needing separate trackers.






##


