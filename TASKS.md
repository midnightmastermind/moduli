# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

### Closed 2026-08-23 (afternoon)

- **Bookmarks spec — ALL NINE STEPS SHIPPED.** Archive mode was the last (`062af432`).
- **"Does a codex page's body render?"** — the other account's flagged gap. **YES**, verified
  read-only via `?previewOcc=` (no write to the grid): 3,761 and 11,630 chars with the
  expected text, 0 page errors, and all 75 root docs embed every child they list.
- **`0205` — 28 dead embeds scrubbed.** They painted `embed: <uuid>` on ten day columns and
  two Daily Questions; residue from `0070` (2026-08-11). 1,357 live embeds untouched.

- **`0206` — all 1,467 bookmarks were invisible.** Their Raindrop save-date sat in the grid's
  filter field `Date`; moved to a `Saved` field. Board went 0 rows → 14,670 elements.
- **Item 5 (font sizes) retired by measurement** — see the row below, marked stale.

### Closed 2026-08-23 (evening)

- **The instance notes body is a `Notes` FIELD now** — *"could you make that an automatic
  thing like our question and answer. could you let the instances child textmap be a notes
  field on them."* It reuses `bodyLink`, the mechanism the Daily Question ↔ Answer pair
  already ships. `grid.meta.instanceBodyLink` is the automatic half — a GRID-level default
  rather than a binding written onto 1021 instance modules, because "every X" in a migration
  means every X that existed when it ran. `0212` + the seed are twins.
- **NOTHING was stranded**, measured through `decompressTextmap`: of 1145 instance
  occurrences exactly 1 carried a textmap and it held **0 characters**.
- **It declares NO `link`, deliberately** — a link is the JOIN identity for sync, and every
  instance row carries this same field, so one would paste a row's note onto every row
  sharing the link value. Verified on prod: a typed note lands on **1** occurrence.
- **I TOOK PROD DOWN for ~7 minutes** with `ReferenceError: ctxGrid is not defined` — a
  variable belonging to `InstanceInner` used in the outer `ModuleInstance`. Tests AND the
  build both passed (no test mounts that component; a build resolves imports, not undefined
  locals). **`npm run lint` catches it and always could** — see the new standing rule.

### Closed 2026-08-23 (late afternoon)

- **C4 — `meta.increment` and `meta.multiline` are WIRED, not dropped.** Measuring the values
  showed a designed feature nobody had connected: the number input read `meta.step`, which
  **0 fields on any grid carry and nothing writes**, while the seed authors `meta.increment`
  on 71. Every number field had stepped by 1 — and a step of 1 makes the browser reject a
  fractional value, so the three 0.1 macro fields were unusable by their own arrows.
- **C2 — the controls exist.** `Min` · `Max` · `Step` (number), `Multi-line` (text),
  `Several picks` (select/occurrence). **Two of its four were retired by measuring:**
  `postfixOptions` is already editable via `AffixEditor`, and `siblingLinks` is a schema
  default on all 250 fields with exactly TWO configured — a default, not a gap.
- **C3 CLOSED 2026-08-23 (7)** — `Operation.targetOccurrenceId` now has a picker in the
  operation editor ("Reads its date from"), beside Name and Category. Not pages-only: the
  current value is always present and flagged, because `Mood: Record Selection` targets a
  `container/graph` and a select whose value is missing from its options renders blank and
  writes null on the next change. Driven on prod both ways and read back out of Mongo.
  **C1 is the only part of the audit still open, and it is a design call for you.**


- **`0209`/`0210`/`0211` were INERT ON PRODUCTION for two hours.** They reached Atlas at
  12:59-13:14; prod's process had been up since 11:29 and its warm per-user cache is
  authoritative for reads, so the server kept running the PRE-migration operations.
  The deploy diff correctly said no code was owed — a cache flush was. Prod synced to
  HEAD and pm2 restarted; the tick now stamps `Completed On` on prod, read back out of
  Mongo, grid restored, 0 integrity errors.
- **`Schedule: Stamp Completed On` is verified END TO END at last** — the gap `0210`
  left. A real checkbox ticked in a real browser writes `Completed On = 2026-08-23`,
  and unticking clears it (the ELSE branch, which is the discriminator). Previously
  proven only through the executor over a synthetic pipeline.

### New, reported not fixed

| # | Item | State |
|---|------|-------|
| 22 | **`npm run lint` exits non-zero on clean code** — 6 pre-existing `react-hooks/exhaustive-deps` "rule not found" errors (the plugin is referenced but not registered), which is very likely why nobody runs it. That matters now: lint is the ONLY check that catches an undefined local, and it caught the `ctxGrid` crash exactly. Registering the plugin would also surface the 33 documented `exhaustive-deps` violations, so it is your call whether to fix the config, silence that rule, or leave `grep no-undef` as the usable signal | ❓ your call |
| 21 | ~~**What window should the `Completed` container use?**~~ — **DECIDED 2026-08-23: leave it UNWINDOWED, and invent no dates.** The mechanism is now in place either way (`0210`/`0211`, `Completed On` proven to populate on prod), so a window is a one-migration change whenever it is wanted. The three rows ticked while the op was dead stay unstamped rather than being backfilled with a completion date that is not true | ✅ decided, declined |
| 20 | **A general "relink unlisted children" repair is UNSAFE — measured and abandoned.** Saturday Aug 22's day column is parented to the Day Page board and not listed by it (empty, so nothing was lost), and an unlisted column is what lets `Day Page: Build` mint a duplicate for that date. But the obvious general fix — adopt any child whose `parentId` names a parent that does not list it — matches **265 children across 16 parents**, and **232 of those have `page/doc` parents where being absent from `occurrences[]` is CORRECT** (a doc renders its textmap). It would also relink 8 old day columns that were deliberately swept from the board. Named expectation was 1; the dry run said 265, so nothing was applied. A safe version needs "board-kind parent AND not reachable through the parent's textmap", and the old-columns half is the still-open question from 2026-08-13 (3) — do past day columns belong back on the board? | ❓ your call, selector measured |
| 19 | ~~**A task you ever SCHEDULED disappears from the Tasks page forever**~~ — **RETRACTED 2026-08-23. My figure of "7 of 20 hidden" was wrong: I computed visibility by hand instead of driving `isOccurrenceVisible`.** Through the REAL selector over live data: the Tasks page's `filterOverride: {}` **CLEARS the effective filter outright** (an empty override is not "inherit" — `selectors.js:335`), so the page is already not date-filtered, which is what the user asked for. **18 of 20 rows are visible.** The 2 that are not — `Talk to Angela` (completed) and `Sign up for peer support mentor class` (incomplete, overdue) — resolve an effective filter of `{Date: today}` **because they are MULTI-PARENTED** (Tasks *and* a day-column Todo) and `getEffectiveFilterForOccurrence` walks a parent map that is last-writer-wins, so their chain resolves through the dated column instead of through Tasks. That is the 2026-08-11 (4) ambiguity, not a Tasks-page defect. Fixing it means changing how a multi-parented occurrence picks its filter chain — a core selector, its own reviewed pass | 📋 retracted; 1 real row, different cause |
| 15 | **54 children are listed by a doc container and embedded by nothing** — invisible in the data sense. **Deliberately NOT re-embedded:** measured for content, 52 hold nothing and 2 hold one character, so the repair would add 54 blank boxes. They are `sweepOrphans` candidates | 📋 measured, left alone |
| 16 | **Preview CARDS under-render text-heavy pages** — `PagePreviewBody` walks the child list, and **474 embeds across 233 hosts** grid-wide are reachable only through a textmap, so they draw as `embed: <uuid>` in a preview. Pre-existing, not codex-specific. Fix would be to include modules for textmap-referenced occurrences in the preview's filtered state | 📋 reported |
| 17 | **One dangling `instanceTextblock`** — left alone on purpose: that renderer forces the occurrence live and retries rather than painting an error, so scrubbing would delete a node that recovers itself | 📋 reported |
| 18 | **The durable half of 2026-08-01 (19) is still open** — nothing stops a builder adding to `occurrences[]` without writing the parent's `moduleEmbed`. The 54 above are what that looks like accumulated over three weeks. Now harmless (they are empty); it wants the builder fixed before something non-empty lands there | 📋 root cause open |

| # | Task | State |
|---|------|-------|
| K | **BOOKMARK ARTIFACTS — a Raindrop export becomes a board page of bookmarks** — *"i want to add in a task to look at bookmark artfifacts and start building those out. im going to give you a raindrop export and i want you to create a board page of bookmarks where i can click into and it opens the url inside of the panel or i can right click it and import it as a page"* (08-22). Three parts: **(a)** a Raindrop export importer, **(b)** a bookmark occurrence kind that opens its URL INSIDE the panel rather than a new tab, **(c)** a right-click → import-as-page route. **Pieces that already exist to build on:** the `link-page` / `link-container` / `link-chip` intake shapes and `import_url` (2026-08-07/08-09), `harvestLinks` + the `link_harvest` socket handler, and `markdownToModuli`. **Waiting on the export file** | 📋 new ask, blocked on the file |
| J | **`Last Meal` written for nobody** — the leftover of `0190`. **FIXED `0191`.** Measured: 0 modules bound it and one stale `"Eat"` sat on `Meal Log`. The whole `$lastM` variable goes, not just the UPDATE — all three sites — with a BOUNDARIED name match, because `$last` is a prefix of `$lastM` and a substring match deletes both. The FIELD is kept and now shows in `checkGrid`'s `unused-field` warning (15 → 16), which is the honest outcome | ✅ fixed |
| G | **Tasks completed IN the Tasks container never reach `Completed`** — *"tasks that are being completed in the task container (not dragged to schedule though), is not moving to the completed section"* (08-22). **FIXED `ddcb1758`, verified on prod both directions with no reload.** The feed was never wrong — it never RAN again. `update_occurrence` broadcasts with `socket.to(userRoom())`, which EXCLUDES the sender, and the originator gets a timestamp-only ack by design — and every feed-sync call site is an echo handler, so **the one window that could not schedule a sync was the window that made the change.** Creates and deletes are sender-excluded too, so it was never only about ticking a box. The 2026-08-07 (2) NavigationOp class, from the feed side | ✅ fixed |
| H | **Quick-add: FIELD-VALUE INPUTS in the menu** — *"its quick add new occurances with prefilled values, inside the quick add menu"*, then *"dont seed any of them, just seed the fields themselves so they are at the top of the fields selection ... and being able to enter my own values in that field selection (using the appropriate inputs)"* (08-22). **SHIPPED `b036a851`, verified on prod by looking.** Measuring shrank it from a build to a merge: the value step, the real `Field` controls, `initialFields` end-to-end, the sibling-inherited fields and `selectedFirst` had all shipped 08-21 — only the separate **"Values →"** screen remained, and it is deleted. A ticked typeable field now carries its control on its own row; nothing is seeded | ✅ shipped |
| H2 | **Selected fields are their own section now** — *"put the selected fields first, then input fields and then display fields"* (08-22). Filed when verifying H showed the INPUT caption below ~99 display rows. Three flat sections, and inside `Selected` input still comes before display. `selectedFirst` had no caller left and is deleted rather than kept as an unreachable helper | ✅ shipped |
| I | **`Intake` → `Liquid Intake`, and the nutrition tiles get re-cut** — *"change Intake to Liquid Intake in trackers and remove meals, last meals, and meal count from there and add Meal Count with a goal of 3 to Meal Log. also remove Last Meal from the meal log as well"* (08-22). **SHIPPED `0190` / `b819a5a9`.** Two of the three removals were already INERT — `Meals` and `Last Meal` are written by `Meal History` onto the **Meal Log** occurrence, and a field value lives on an OCCURRENCE, so binding them on `Intake` never showed anything. The one real seam was `Meal Count`: the op that writes it was repointed in the same pass, which is what stops it re-creating the `0184` inert-tile bug | ✅ shipped |
| A | **RETRACTED — the `Workouts` tracker is NOT broken.** I filed it as "confirmed, cause narrowed" and that was wrong. The tile was empty because **2026-08-22 is a Saturday, which these templates make a REST DAY** — and your own earlier instruction was *"and for rest day, dont have anythign for excersise"*. Proven by injecting one completed `Barbell Bench Press` onto today's column and re-running the real executor: the tile writes `Barbell Bench Press = 1` and reveals that field. **My "broken on Monday too" evidence was a bad probe** — the op resolves the day with `SAME_DAY $today`, the wall clock, so moving the page filter to a Monday changed nothing and I read that as day-independence. Now covered by `workoutsTodaysSession.test.js` | ✅ retracted, now tested |
| A2 | **Rest days: no line, no template.** *"also dont put a rest day and dont make that a workout"* / *"if its a rest day, i just wont put any workouts in"* (08-22). So a rest day stays the ABSENCE of a workout layer claiming that weekday — no "Rest day" row on the tracker tile, no rest-day template, nothing that reads as a workout | ✅ closed, declined |
| B | **`Macros` tile can never fill** — *"the meal macros … werent updating"* (08-21, 08-22). **STALE — `0184` retired the tile.** Re-measured 08-22: **0 occurrences named `Macros`** on the grid | ✅ shipped |
| B2 | **…and `Meal Nutrition` itself WORKS — retracted as a bug.** The same executor run emits `Total Protein=23 · Calories=305 · Carbs=35 · Fats=7` from today's one completed meal, and `Vitamins & Minerals` emits all 15 values, and `Intake.Meal Count=1`. The 0s stored in Mongo are stale because these are DISPLAY fields recomputed each load. **So the macro complaint is most likely the `Macros` tile (item B), not the maths** | ✅ works — see B |
| C | **Operations-UI audit — "can I edit everything from the UI?"** — *"add in a task to do an audit on the operations ui and make sure i can edit everything in the ui. id like to change my tasks goal from 10 to 5 and i want to make sure we can do that via the ui easily"* (08-22). **YOUR ACCEPTANCE TEST PASSES — done by clicking on prod and read back out of Mongo** (`Tasks Completed.targetValue 10 → 5`, `Tasks Left.startValue 10 → 5`, 0 page errors). **But the audit found seven gaps and one design trap — see C1-C3 below** | ✅ audited, gaps filed |
| C1 | **The tasks goal is TWO coupled fields and nothing in the UI says so.** `Tasks Completed` counts UP `{startValue:0, targetValue:10}` and `Tasks Left` counts DOWN `{startValue:10, targetValue:0}` — both encode "10 tasks", in two separate field editors under two separate names. Changing one is not an error and leaves the tile pair inconsistent. That is the real answer to *"easily"*: it is editable, twice, and you have to know that | ❓ design, your call |
| C2 | **Field keys that are LIVE and have no control anywhere in the app** — measured against the 247 live fields, then grepped for a writer (readers do not count): `meta.multiSelect` on **45 fields** (four read sites in `Field.jsx` — whether a dropdown takes one pick or many is seed/migration-only), `meta.postfixOptions` on 19 (`helpers/fieldAffix.js`), `meta.min`/`meta.max` on 7/4 (the number clamp), and `siblingLinks` on all 247. `FieldDetail` renders fourteen controls and there is no raw-meta editor, so these are reachable only by writing a migration | 🐛 confirmed gap |
| C3 | ✅ **FIXED 2026-08-23 (7)** — see the closed row above. *(original)* **`Operation.targetOccurrenceId` has NO editor at all** — 9 live ops carry it and it is load-bearing: the executor resolves `$activePeriodDates` from the op's OWN page through it (CLAUDE.md 2026-08-09 (8)). Every `targetOccurrenceId` match in the client is the unrelated `commitApplyTemplate` argument. So the one field that decides which page a date-driven op reads is invisible to the operations UI | 🐛 confirmed gap |
| C4 | **Two field-meta keys are INERT** — `meta.increment` on **36 fields** and `meta.multiline` on 5 are read by nothing (`DrilldownTimePicker`'s `increment` is unrelated local state). The inert-token class this repo keeps rediscovering; either wire them or drop them. **Checked and NOT a gap:** `meta.workoutGoal` on 26 fields is `0170`'s own idempotency marker, correctly absent from the UI | 🐛 inert |
| D | **The Eminem infobox renders an empty spot before Kimberly** — *"its just a comma"*. **FIXED `0194`.** Not a stray comma: the importer kept both of Wikipedia's parentheticals for the same spouse and dropped the repeated name, leaving `) , (`. One cell on the grid; the name is NOT invented | ✅ fixed |
| E | **Spanish translations in brackets** — *"could you put in the md file the translation next to the spanish in brackets"*. **BLOCKED — the target cannot be found.** No repo `.md` and no grid document contains Spanish prose (searched both; the only hits are the `José` double-encoding EXAMPLES in the ingestion guide). Needs the file named | 🚫 blocked, needs the file |
| F | **"and for rest day, dont have anythign for excersise"** / **"but dont show draggables"** / **"we want layout, just not cascaded dude"** — three more from summaries; the third is a CORRECTION to a design decision and needs your context before anything is changed | ❓ needs your call |
| 0 | **`Drink` with `Water` selected, on the `Meals` template** — *"also drink should show up with water selected in the meals template"* (08-22). **STALE — `0187` shipped it.** Re-measured: **8 `Drink` rows on the `Meals` layer, all 8 carrying `Water`** (`QYYO61oFcf33`) | ✅ shipped |
| 1 | **A `Routine` schedule-template LAYER** — *"make another schedule template called routine and merge that in"* (08-22). **STALE — `0185` is applied.** Verified on the live grid: the `Routine` layer carries all seven weekdays and 7 rows, and today's Saturday column holds them merged beside the `Meals` layer — 8 `Eat` + 8 `Drink` + Drink 6:00am · Hygiene · Hot Tub · Take Medication ×2 · Walk · Journal | ✅ shipped |
| 2 | **Display-field audit** — *"look at all my display fields and make sure they are being used by an operation or updated in some way"* (08-20). **DONE.** All 99 sorted four ways: **91 healthy**, 6 written-not-bound (`Workout 1-6` → `0192`), 1 bound-not-written (`Total Reps` → `0193`), 1 neither (`Last Meal`, `0191`) | ✅ done |
| 2b | **`sweepOrphans` would delete 135 orphan modules, not 7** — surfaced while doing item 2. The 7 unplaced Volume tiles are among them; the rest is a known accumulation (past migrations delete an occurrence and leave its module). It dumps before deleting and refuses anything referenced or under its age floor — but 135 is far wider than *"sweep them"*, so it is reported rather than run | ❓ your call |
| 3b1 | **Two trackers named for a period they did not scope to** — **`Nutrition: Today's Micronutrients` FIXED (`0196`)**, proven by moving the filter: `Meal Count 1 → 0`, `Vitamin A 31 → 0`, 15 of 16 values move. **`Bills: Paid This Month` is NOT fixed and needs a bigger decision — see 6b** | ✅ half fixed |
| 3b2 | **The two wall-clock trackers now read the page filter** (`0196`) — `Fitness: Today's Prescription` and `Workouts: Today's Session` resolve the day column from the filter, falling back to today when none is set (never to "every column", which would bind an array and throw). **Gap: their movement is not demonstrated** — the grid holds one day column and 08-22 is a rest day, so they are empty whichever day is filtered. The binding is asserted runnable; the movement is not | ✅ shipped, 1 gap |
| 3 | **The three DARK themes are still unmeasured** for contrast. The 2026-08-20 attempt failed its own calibration — the probe sampled marquee TRACKS rather than glyph boxes, and test grid 2 still carries the base rainbow so the surface behind a translucent pill is not uniform. `next-session-decisions.md` records exactly how to start ahead | 📋 open, method known |
| 3b | **Tracker date-filter audit** — *"audit all my trackers and make sure they are updated … when i select a new date filter in the respective spots"* (08-21). **AUDIT DONE 08-22.** 30 tracker ops write 82 display values, all onto the Trackers page. **24 follow the page filter correctly** (`$goalPeriod`, every one sourced from `_effectiveFilter` — 0 exceptions, 0 missing INIT_VARs). Six do not: **2 legitimately** (`Net Worth` is a balance, `Current Streak` walks history), **2 use the WALL CLOCK** (`Fitness: Today's Prescription`, `Workouts: Today's Session` — `Date SAME_DAY $today`, so the filter never moves them), and **2 are named for a period they do not scope to** — see 3b1 | ✅ audited |
| 3c | **Open-page-in-panel highlight** — *"if i open a page in a panel, and its already opened in another visible panel, highlight the page in the spot thats opened"*. **SHIPPED `e81521b3`.** The queue row was stale: the notice already existed in `ModulePanel.openPage` and flashed the whole panel shell. Retargeted to the page header — and **the tab you picked does not exist**: a panel shows ONE page at a time, its name in `.page-header`, others reached through the tree, so the header IS the tab. **Honest gap: nobody has watched it fire in a browser** — the DOM assumption and the CSS are verified on prod, the target choice has 9 tests and 3 A/Bs, but I could not drive the tree to open a page already open elsewhere | ✅ shipped, 1 gap |
| 4 | **"What else is technically needed for the original vision"** — asked 08-20, never answered | 📋 open ask |
| 5 | ~~**Instance/tracker label font sizes**~~ — **STALE, verified on the live grid 2026-08-23**: instance labels render 15px on the Trackers page and everywhere else; display and input fields are pinned at 11px in both, so the label bump cannot cascade. Both halves of the complaint are satisfied. *(original text below)* **Instance/tracker label font sizes** — *"make sure the instance labels text size 1 size bigger too"* (08-20), and the follow-up that says the attempt went wrong: *"the fields in trackers font sizes didnt change and the rest are too big now"* (08-19). No CSS rule sizes `.instance-label`; the sizes are INLINE in `ModuleInstance.jsx`, which is the documented trap. No recorded fix for either | ❓ regression reported, unfixed |
| 5b | **Emotions wheel third level reads blank at rest** — *"its written, the writing is just transparent and only shows on hover"* (08-18). This may BE the deliberate responsive hiding from 2026-08-08 (6) — outer labels are dropped when a 4.5° slice is under ~1.8× the font size, and return on zoom. If so it is working as designed and the design is unwanted; if not it is a real bug. **Needs your call before anything is changed** | ❓ by design or bug |
| 6 | **Monthly Bills goal target is a frozen literal** — `displayConfig.targetValue` is `2040.97` and takes a number only. Correct today, drifts the moment a bill changes | 📋 reported, not fixed |
| 6b | **No bill can be marked PAID — `Bills: Paid This Month` is structurally inert** — its predicate needs `Completed IS true` and **0 of the 11 bills bind `Completed` at all**, so the tile reads 0 forever and there is no checkbox on a bill anywhere in the UI. This is why *"monthly bills should be a monthly goal totalling the amount of bills vs what i paid so far"* has never had a "paid so far" half. Binding a checkbox onto eleven live rows is a product change, not an audit fix — **your call**, and it pairs with item 6 (the frozen 2040.97 target) | ❓ your call |
| 7 | **Micronutrient op double-counts a repeated ingredient across meals** — correct for a day's intake, wrong if the tile is ever pointed at a template | 📋 known limit |
| 8 | **Trackers panel sits at 36% of the left column** — one splitter drag if it reads short | 🎨 cosmetic, your call |
| 9 | **Assistant grid-build plan is written, not executed** — and its blocker is measured: the configured 3B model took **207s** for one read-only tool call and answered wrong. Step 1 is config (the allowlist is an env var), not code | 📋 planned |
| 10 | **Schedule apply ~3s — RE-DIAGNOSED 2026-08-23 (8), the filed cause was the wrong one.** `resolveOptions` sharing shipped (772 rows × 7322 records → 45 answers; harness 2677ms → 0.3ms) and **the prod wall clock did not move**: 3091 → 3273ms blocked per date navigation, run noise. A browser mounts 114 rows and **1 select**, so the options resolver was never what it waits on. The sweep names the real cost itself: `NavigationOp total=1873ms ops=46`, of which **`Schedule: Fill Day` is 766ms and emits ZERO effects** — 27 steps, 4 LOOPs + 2 FINDs over `$allContainers`, on every load and every filter change. Fixing it is a STORED pipeline (migration, live data) and wants its own reviewed pass | 🐛 cause found, not fixed |
| 13b | **12 catalog staples the plan does not use** — Chicken Breast · Rice · Spinach · Oats · Salmon · Olive Oil · Sweet Potatoes · Black Beans · Milk · Bananas · Coffee Beans · Zucchini Peppers Onions. Not duplicates; referenced by no meal; still on the Ingredients board. Left there on purpose — the board is a CATALOG of what you can put in a meal, not this week's shopping list — but if you want it to hold only what the plan uses, say so and they untag the same way the twins did | ❓ your call |
| 12 | **Ingredient artifacts: only ONE image shows in the spread** — *"all the ingrediants are all showing just one file"* / *"put in alternative photos in ingrediants for each one"* (08-16). **BOTH HALVES ARE NOW SATISFIED, measured 08-22.** Data: **25 of 27 ingredients carry 4 photos each**, all resolving (the alternates were added after this was filed). Resolver: the REAL `filesOf` driven over live data returns **4 for 26 of 27** — CBD Gummies has 1, correctly, being a manufactured product `0159` gave one picture — with a control proving it returns 1 on an artifact, so the 4s are not the function always saying 4. Render: `ArtifactSpreadHost` maps EVERY entry (`files.map(f => f.occ.id)`), no `[0]`, no `slice`. **Gap: nobody has watched four windows render** — the Ingredients board needs tree navigation I could not drive | ✅ satisfied, 1 gap |
| 13 | **Ingredient quantities should match the macros** — *"so 2 eggs become 1 egg and has the macros to match 1 egg"* (08-14). **ALREADY SATISFIED — `0122`/`0123` did it after this was filed.** All 15 plan ingredients are at a single unit with matching macros. The same measurement found four exact-name TWINS instead, now untagged (`0195`) | ✅ satisfied |
| 14 | **Tracker tile layout asks, three of them, from one afternoon** — *"make the tracker occurances a bit wider and also let the containers extend full width"*, *"the drag handle and the title should be on top of fields"*, *"why arent the workout trackers boxes like the rest… planning, nutrition, and media arent boxes either"* (08-11). Adjacent to item 5, which is the FONT half of the same surface. No `minHeight` rule exists on `ModuleInstance`, so the *"height auto"* half of it may already be moot | ❓ needs your eyes on one screenshot |
| 11 | **Three external-data pipes** — Tasker profiles, ingest credentials, the four slow exports | 🚫 blocked on you |

## Done — 2026-08-22 (afternoon)

| Task | Where |
|------|-------|
| **Item 3b fixed as well as audited** — `0196`. Micronutrients gates its meal loop on the page period; the two workout trackers resolve their day column from the filter instead of the wall clock. Two rule shapes, because a LOOP may fail open and a FIND may not — an IS_EMPTY arm there would match every day column, bind an array and throw | `5efd9436` |
| **MY FIRST APPLY WAS INERT AND FOURTEEN TESTS PASSED AGAINST IT.** Every stored step is `{id, type:"action", config}`; mine was `{id, config}`, and the executor SKIPS a step without `type` — silently, no log entry. `bound=1` was reported, the pipeline read correctly, nothing changed. Found in the executor's RUN LOG: the step list went `$tile` → `$countTile` with the binding absent from a log that recorded everything else. The structural tests asserted the object the migration BUILDS, never that the executor would run it | — |
| **Item 3b — the tracker date-filter audit, run at last.** 30 ops / 82 writes classified by the date mechanism they actually use, not by name: 24 on the page filter, 2 legitimately period-free, 2 on the wall clock, 2 with no date rule despite being named for one | measured |
| **My own probe was wrong three times before it was right, and each was caught by disbelieving it:** it reported 82 of 82 ops ignoring `$goalPeriod` (an IF's condition lives at `step.condition`, OUTSIDE `config`), every tile resolving to no page (a tile is reached by whoever LISTS it, not by `parentId`), and a rule truncated to `83aa` by an id-shortening regex that hid the very condition being audited | probe |
| **Item 12 retired by measuring — the sixth stale row today.** Data, resolver and render checked separately rather than as one claim: 4 artifacts per ingredient, `filesOf` returning all 4 over LIVE data with a discriminating control, and the host mapping every entry. Nobody has watched it render, and that is said rather than glossed | measured |
| **Item 13 retired by measuring, and a different defect found in its place.** The quantities ask was satisfied by `0122`/`0123`; what the census showed was four exact-name ingredient TWINS with different macros. No meal pointed at any of them — the risk was a dropdown offering "Eggs" twice. Untagged, not deleted | `e5dcda96` |
| **A guard had no test and only an A/B showed it** — dropping the serving-less clause failed NOTHING, because the twin clause already covers the ordinary case. It is load-bearing when TWO same-named rows both carry a serving: each finds the other and BOTH vanish from the board. Now a test, and ambiguity refuses | A/B |
| **Item 3c — the already-open notice rings the PAGE, not the panel.** The feature already existed and the CSS was painting; this is a retarget. The option chosen ("the panel's page tab") turned out not to exist — measured on the prod DOM, not read from source — so the header is the target and the code says why a "tab" fix touches a header | `e81521b3` |
| **Verified on prod as far as it goes, and the gap is stated:** `.page-header` is 1026×25 inside a panel, the class resolves to `already-open-flash` at 1.2s with a real ring colour, and the served stylesheet carries the new name 3× with the old name at **0** as the control. Nobody has watched `openPage` fire it — my tree probe blind-clicked the same twelve buttons and toggled them, which is a bad probe, not a result | probe |
| **Item 2 — the display-field audit, and both halves it found.** 99 fields sorted four ways; `0192` binds the six the prescription writes onto a tile that rendered none, `0193` sweeps the field whose every binder has zero occurrences. The first pass had a FALSE POSITIVE (`Days Until Due` writes via `targetFieldId`), so every config key holding a field id across all 68 pipelines was enumerated and the audit re-run | `64155ee5` |
| **`0193`'s first draft deleted the binder modules and that was wrong** — the dry run declined all seven because they also bind `Category`/`Tracker Date`, shared with live tiles. The guard fired correctly on the wrong question: the right one for a module is `sweepOrphans`' (placed? referenced?), with an age floor this does not have. Field deleted here, modules handed over | — |
| **Item D — the Eminem infobox.** `) , (`, matched once on the whole grid, name not invented. My probe reported **0** minutes after I had read the string by eye — cells live at `meta.table.cells`, not `textmap` | `0f22760c` |
| **A reconciliation pass, because three rows went stale in one afternoon.** Items **B**, **0** and **1** were all shipped this morning by the other account and still read as open; each is now verified against live data rather than against the entry that filed it. The `meta.servingSize` mystery is explained too — it is on the MODULE (15 of them), and the probe that found "0" read the occurrence | measured |
| **`Last Meal` retired at the source** — `0191`. The whole `$lastM` variable, all three sites, with a boundaried name match; the `Meals` write and the loop both survive, each with its own test. A/B: a substring match fails **exactly** the dangerous-direction case. Idempotent on a forced re-run, pm2 restarted, 998 server tests | `e63dda63` |
| **Selected became a SECTION rather than a sort** — ticked fields were split across the Display and Input captions, and with ~99 display fields on this grid the controls sat below the fold. Verified on prod: all seven ticked fields visible without scrolling, `Days Until Due` sorted last inside Selected because it is display-role, then INPUT, then DISPLAY. **0 page errors** | `bf5606d6` |
| **A/B'd, three mutations, each landing and failing its own tests**: collapsing Selected back into the role sections (2), Display before Input in the tail (2), display before input inside Selected (1). And **my own first test failed against correct code** — it asserted a Display caption the fixture could not produce, since its only display field is one the siblings bind | A/B |
| **Item H — the quick-add values are typed IN the field selection.** Measuring first shrank it from a build to a screen merge: four of the five pieces shipped 08-21 and only the separate "Values →" step was left | `b036a851` |
| **The seeding question was asked rather than guessed, and the data made it real.** A census showed a "unanimous sibling value" rule would seed 82 values across 53 containers — 49 select (the constant parts), 30 date (op-written or a STALE `Due = 2026-08-21`) and 3 boolean, **every one of them `Completed = true`**, which with `0189` would hide the new row from its category the instant it existed. Your answer removed the question: seed the fields, never the values | census |
| **One of my own tests was VACUOUS and the A/B is why I know** — `for (const el of valueInputs())` passes trivially on an empty list, so "every input starts empty" was green against a picker rendering no inputs at all. A length control now runs in front of the loop | A/B |
| **And one A/B came back green WITHOUT being a weak test** — dropping `selected &&` from the row gate failed nothing because `typeableIds` is already built from the PICKED set, so the mutation was a no-op. Check the mutation landed before believing an A/B (2026-08-09 (4)). The redundant conjunct is gone | A/B |
| **Verified on prod by looking**, not asserted from the source: `Completed` renders a real toggle, three date fields render native pickers, `Weekday` a select, `Completed On` is ticked and shows only its type label because it is display-role, and an unticked `Account` has no control. All empty. No "Values →". **0 page errors**, poms grid **1 pre-existing error, 0 new** | screenshot |
| **Item G — a local write now re-syncs feeds in the tab that MADE it.** Root-caused rather than guessed: all three `Completed IS true` tasks already resolved and were already materialized, so the predicate, scope and OR-group were fine. The server's own comment names the cause — a *"targeted ack to the ORIGINATOR"* instead of the broadcast | `ddcb1758` |
| **Proven on prod by driving it, with the reload as the CONTROL** — tick `Organize files`, same tab, +7s: `Completed` still held 3; one reload took it to 4. The reload arm is what makes the 3 mean something, since it proves the row DOES match. After the fix: tick → 4 and untick → 3, both with **no reload**, 0 page errors, grid restored | probe |
| **The fix is at the local write, not the broadcast** — widening the server to `io.to(...)` would send every originator a full echo it does not need and re-fire the MeasureOp dedup paths that ack exists to avoid. Four CommitHelpers wrappers schedule it through the `operationsBridge` seam `updateGrid` already uses | — |
| **Two writes deliberately do not schedule one, and both are rules rather than flags** (*"i dont want backwards compatible"*): `fireTrigger:false`, which feedSync ALREADY stamps on every mint and sweep with *"derived data"* beside it — that is what stops the engine rescheduling off its own writes — and a textmap-only patch, since no feed predicate can read a textmap and typing must not run a pass over every feed. Written as a DENYLIST on purpose | — |
| **A/B'd, each mutation failing exactly its own test**: dropping the create call site (1), defeating the textmap guard (1), scheduling before the derived check (2). The four negative tests pass VACUOUSLY against the unfixed code and are reported as such | A/B |
| **My probe's own `organizeDone` column was meaningless** — it queried `label` on the OCCURRENCE and the label lives on the MODULE. `completedKids` was the honest column | — |
| **Two "test failures" were a stale vitest sequencer cache** under `/tmp/vitest-client` still listing two deleted probe files. Cleared: 243 files / **3024 tests**, build clean, chunks at documented sizes, poms grid **1 pre-existing error, 0 new** | — |
| **Operations-UI audit (item C)** — your acceptance test passes by clicking; seven gaps filed as C1-C4 | `6485c2f6` |

## Done — 2026-08-22 (micro sweep)

| Task | Where |
|------|-------|
| **Textblocks in some documents "arent transparent at all"** — and *"certain"* was the whole clue. Not a stored colour (**0 of 79** stored backgrounds on the grid are opaque) and not the textblock tint: it is DEPTH. `--grid-surface-a` is 0.24 and its own comment says it is tuned for ONE panel + ONE container; every nested container re-pays it. **Nutrition Plan is nested 4 deep, Basic Nutrition Guide 3, and Gospel of Thomas / Eminem / Viafluere are FLAT** — the two the user named are the two deepest on the grid | this commit |
| **Measured against the REAL built stylesheet, over a magenta backdrop, with the flat case as the control:** depth 1 `55.5% → 55.5%` **byte-identical** (the documents nobody complained about do not move), depth 3 `36.9% → 55.5%`, depth 4 `30.6% → 55.5%`, depth 5 `26.1% → 55.5%`. The tint was never wrong; it was being paid five times. Also the unresolved half of the 2026-08-19 (2) report (*Physical* an opaque slab, *Nutrition* inside it another) | probe |
| **"The filter menu doesnt match the theme"** — `--panel-bg` and `--panel-border` are read in **NINE files, 26 uses**, and were **defined nowhere**. Every one fell through to its hardcoded dark literal, so the toolbar filter dropdown, its calendar and six other surfaces painted a dark slab on all six skins. Aliased to `--surface-card` / `--border-default` in the bare `:root`, so the indirection resolves per theme at USE time and a tenth file reading the old name is themed for free | this commit |
| **The 2026-08-21 theming pass could not have caught it**, which is why a guard shipped with the fix: that pass converted 82 literals TO THESE TOKENS and verified no literals remained. An inert token is invisible to that check — it looks converted, and the dark fallback looks right on a dark skin. `cssTokensResolve.test.js` asserts every token a stylesheet reads resolves somewhere; it found **two more dead tokens** nobody had noticed (`--muted-foreground` on the doc placeholder, `--text-secondary`), both of which had no fallback at all, so the whole declaration was invalid and dropped | guard |
| **The guard was VACUOUS on its first A/B and is only trustworthy because of it** — reading `var(--panel-bg, …)` in JSX registered the token as *defined*, so it passed against the very bug it was written for. Stripping `var(…)` reads before collecting definitions is what makes it discriminate | A/B |
| **"The entire root folder is being opened in the pinned" — a REAL bug, root-caused.** `FolderNode` keyed its open state by folder id ALONE, and the sidebar draws the same folder twice (a pinned folder page renders its real subtree; the manifest below renders it again). So expanding a folder in `Root` silently expanded it inside `Pinned`, and Pinned filled up with a copy of the manifest as you browsed. The key is scoped by section now — **the root scope keeps the BARE id**, or every browser would forget which folders it had open | this commit |
| **"Pinned and root arent seperated enough"** — the 2026-08-21 merge divided them with a hairline and 5px, which at sidebar row density is the same gap that sits between any two folder rows. Doubled space either side and a real rule weight. **Air, never a tint**: every skin paints a wallpaper behind this sidebar | this commit |
| Both fixes the user re-reported were **already on prod** (`6cabeeba`, `0e090a6b`, both ancestors of prod HEAD `d164ac46`) — so these were incomplete fixes, not a stale build. Checking that first is what stopped this becoming a deploy hunt | measured |
| **`Place Weekday` dropped a whole template layer when two shared a slot — FIXED at the emitter, not the write.** The clone path published its new stub into `$vars` and told **neither** overlay about the PARENT, so a parent's `occurrences[]` never grew during a pipeline and every whole-array write built from it was a snapshot from before the first create. On a Friday, `Cardio` cloned Run + Stretch into 7:00am and the `Meals` layer's adoption re-list then wrote `occurrences=[meal]` over them. `listChildInOverlays` grows the list in **both** overlays at the one place a child is listed | see below |
| **A/B'd, and it named which half does the work:** neutering the clone-path patch fails exactly the merge test; reverting only the adoption write fails **nothing** — so that half is hardening and is reported as such, not counted as the fix. It is kept because the read (`occurrencesById[id] \|\| $vars…find(id)`) and the write disagreed: the old guard read `occurrencesById` alone, so a parent that is itself a same-pipeline clone was skipped | A/B |
| **`COPY_OCCURRENCE` had the identical shape and got the same call** — the emitter is the class, and one door left open re-creates it. The lesson 2026-08-08 (10) records, from the clone side | — |
| **The helper's contract is pinned separately** (`listChildInOverlays.test.js`, 6 cases) because the merge test does not discriminate on it: the `$vars`-only parent, the `occurrencesById`-wins precedence, idempotence, and the null return that is not a failure. Two mutations, each failing **exactly** its own test | A/B |
| **The refreshed fixture LANDED** (item 1b) — `pomsGrid.json.br` re-exported past `0173`/`0174`/`0177`, and `mergedTemplateLayers`, `weekdayTemplates` and `weekdayTasks` rewritten to synthesise the old shape instead of depending on the fixture being stale. **2993 client + 941 server tests, build clean** | this commit |
| **The rainbow header on cold load** — *"that header color is happening when the first grid loads, its a rainbow"*, and the second time it was asked. TWO causes, and the first fix alone was not enough: `useSkin` stamped `DEFAULT_SKIN` (which *is* `retro-rainbow`) before the grid loaded, **and** the gradient was declared under a bare `:root` so an unstamped document had it anyway | `89bf7dc6` + `d164ac46` |
| Narrowed to the complaint — only `--retro-rainbow` moved to a skin-scoped rule; the wallpaper and scrims still default, so it does not trade a rainbow flash for a wallpaper flash | same |
| **Verified on production by sampling a cold load every 250ms**: `(none)\|(unset)` throughout the load, then `stardew\|linear-gradient(90deg,#8a5a…)`. The first fix alone still showed `#e545…` — which is how the second cause was found | probe |

## Micro-ask sweep — all three accounts, full history

357 distinct short user asks were extracted across `.claude`, `.claude-account2`
and `.claude-account3` and the recent tail triaged. **Six were verified SHIPPED**
and are not carried: thicker grid lines (`--grid-line` cites the 08-17 ask
verbatim, 2px, per theme), the spread viewer's zoom-OUT, an empty grid on a fresh
account, ingredient photos, artifact-spread grid layout, and the loading spinners.
Two survive as items 5 and 5b above; the rainbow default is fixed (see above).

**Re-checked and EXPLAINED, not a defect:** `meta.servingSize` reads as absent because the earlier probe looked at the OCCURRENCE. It lives on the **MODULE** — 15 carry it, 0 occurrences do, which is where `0122` put it.

## Unreconciled — the 2026-05-22 backlog in `CLAUDE_CHAT.md`

A feature/bug list from May sits at `CLAUDE_CHAT.md:250-260` and has never been
reconciled against what shipped. Spot-checked two of its bugs: the day-column
header **is** fixed (columns read "Friday, July 31st, 2026"), the open-page
highlight is **not** (item 3c). The feature half — BangleJS drop, quick-add
templates, Windows right-click integration, voice commands, voice OCR,
YouTube/Spotify link + download — is untouched and may simply be stale ambition
rather than queue. Worth one pass to sort shipped from wanted from abandoned.

**Also checked and found STALE, not outstanding:** `CLAUDE_CHAT.md:2011` records
the Wikipedia-import flood as *"NOT DONE"* — it is fixed. `matchSubjectFilter`
now role-matches BEFORE the `!targetId` early-true, with a comment naming the
flood. The note outlived the fix.

## Log audit — every direction from 2026-08-20 → 08-21

All 8 session logs across the three accounts were replayed. **The first pass read
only raw user turns and missed the small asks** — when a session compacts, its
earlier user messages are replaced by a summary, so those asks are inside the
summary text rather than in any `type:"user"` record. Re-reading the 08-20T12:26
summary and `docs/next-session-decisions.md` recovered seven more, now items 1-9
above. The table below is the raw-turn pass; it was correct and incomplete.

| Direction | Where it landed |
|---|---|
| *"look up what the healthy amount is … those shouldnt be dropped"* (vitamins) | `0123`, `0165` |
| *"get rid of the total subscriptions"* | gone — verified: no op, no field, no tile carries the name |
| *"monthly bills should be a monthly goal totalling the amount of bills vs what i paid so far"* | `Monthly Bills` writes `Amount` 2040.97, `Bills: Paid This Month` writes `Bills Paid`, target on the same tile |
| *"look at what those operations need for category and use that"* | `0164` |
| *"make every folder closed by default in the manifest sidebar"* | `helpers/treeExpansion` |
| *"i dont want a cycle, i just want 7 day templates"* | `0161` / `0162` |
| *"is there anyway to merge like templates too"* | `0177` |
| *"we need goals for specific workouts that day"* | `0168` / `0170` / `0171` |
| *"the macros for meals arent working"* | `0174` |
| *"make sure tasks and appointments are good via their operations too"* | `0172` / `0173`; re-verified live — 7 due-dated tasks all placed into a day's `Todo`, 3 appointments correct |
| *"appointments or tasks set to complete … sent to completed at the end of the day"* | feed-scope fix `96b0699a` |
| *"an empty panel just goes to the root manifest folder … go ahead and build it"* | `25022372` |
| *"i want a running list up"* | `TASKS.md` + the published artifact |

**Reported, not fixed — the Monthly Bills target is a frozen literal.**
`displayConfig.targetValue` is `2040.97` and `displayConfig` takes a NUMBER only —
there is no field reference. It matches the live total exactly today, so the tile
is correct now and drifts the moment a bill is added or removed. Making it track
would need either a per-occurrence target or an op that writes a shared field's
`displayConfig`; both are mechanism changes, so it is stated rather than guessed at.

**Not a defect, worth knowing:** `Peer Support Group - Froedtert` (Aug 27, 6:00pm)
sits on the Tasks page unplaced. `Place Dated Work` only builds the days in the
active period, so it lands when the schedule is navigated to that date.

**An instruction that had been missed:** *"keep giving me a running checklist in
your updates."* Saved to memory; updates now carry the queue inline.

## Standing hazard — mixed client versions fight over a feed

Two clients running different code **fight over materialized feed copies**, and neither is
malfunctioning. Feed copies are shared persisted state and the sweep rule is *"delete any copy whose
source I no longer match"* — so a client on the OLD scope walk deletes exactly what a client on the
NEW one just minted, and the new one re-creates it. The result is a fresh id every pass and nothing
ever settling.

Two ways into it, and **both were live while this was being measured**: a browser tab left open
across a deploy runs the old bundle, and a local dev stack (`npm run dev` + `server/server.js`)
points at the **same Atlas database as production**.

Proven twice. On the live grid: `feedDiag` reported **`minted 2, swept 0` on every pass** while the
server logged two deletes per pass — the minting client was not the sweeping one — and the deletes
continued **after that client disconnected**. In a test, `feedMixedClientChurn.test.js` drives the
real `syncFeed` with the resolver giving two different answers: one client is idempotent with stable ids (the control), two
disagreeing clients churn a fresh id every pass, and **the copy they agree on is never disturbed** —
which is exactly what was seen live, one stable row beside two churning ones.

**The rule: deploy a feed-semantics change into a single-client window, and reload every tab.** The log names
the socket on both sides now, so the next occurrence is one grep rather than an afternoon.

## Done — 2026-08-21 (merge of two sessions)

| Task | Where |
|------|-------|
| **Both sessions independently found the same cause** — `feed.scope` walked ONE ancestor chain from `buildParentMap` (last writer wins), so multi-parented rows resolved by document order | agreed |
| The other session verified its fix with a **local stack + `window.__feedDiag`**: three consecutive passes `matches=3 visible=3 existing=3 minted=0 swept=0` | their probe |
| This session measured **blast radius across every feed on every grid**, both code versions: 78 feeds, 262 → 264 rows, **77 of 78 byte-identical** | probe |
| **The parked churn item is CLOSED** — cross-version interference, not a defect in the change | `feedMixedClientChurn.test.js` |

## Done — 2026-08-21 (feed pass)

| Task | Where |
|------|-------|
| **A copy-link lost the source's occurrence label** — a row is `occurrence.label ?? module.label`, and the copy carried `fields` but not `label`, so `Completed` listed a row called **"Appointment"** where *"Psych appointment with Angela"* belonged. Verified on screen after deploy | `1b63f809` |
| The stale copy **repaired itself** — feedSync re-minted it with the name, so the migration written for it was deleted unwritten. 0 of 82 copies mis-named | measured |
| **`delete_occurrence` logged nothing** — creates log START/DONE, deletes logged nothing at all, so the server log could not tell "swept" from "never persisted". That gap cost a whole diagnosis today | `c3d6e999` |
| Feed-scope widening **measured across every feed on every grid** — 78 feeds, 262 → 264 rows, 77 of 78 byte-identical; the one change is exactly the two missing tasks | branch |
| Churn shown to be **specific to the change**, not pre-existing — the same copy is id-stable across a 75s live session on master | probe |

## Done — 2026-08-21 (end-of-day pass)

| Task | Where |
|------|-------|
| **RETRACTED — the end-of-day move.** `Tasks › Completed` is a **materialized feed** (`0060`), not a folder. `0179` built an op to move rows into it; that was a second mechanism beside the one that already existed | `0180` |
| Damage undone and **verified byte-identical to the pre-`0179` snapshot** — three rows back in `Emotional`/`Financial` at their original list positions, `meta.filedFrom` unset, op deleted | `0180` |
| The swept feed copy **re-minted itself** on the next load — verified in a browser, 0 page errors | probe |
| **`DATE_BEFORE_TODAY` / `DATE_IS_TODAY` / `DATE_AFTER_TODAY` were wrong west of UTC** — a bare `YYYY-MM-DD` parsed as UTC midnight, so *today* read as past. `DATE_BEFORE`, one `case` above, had already been fixed and says so. `Compute Next Due` had been treating a bill due TODAY as overdue | `dayKeyOf` |
| **`applyEffectsToLiveOccs` disagreed with the persisting handler twice** — `UPDATE_ITEM_PARENT` set `parentId` and neither parent's `occurrences[]`; `UPDATE_ITEM_META` read only the legacy `metaPatch` while `applyUpdate` emits `metaPath`, so every `meta.*` write was invisible to the rest of the sweep | `operationExecutor` |
| **Four rows whose `parentId` named a container that did not list them** — repaired by a structural sibling test. The shared Emotions Wheel contradicts the same way and is correctly DECLINED | `0178` |

## Done — 2026-08-21 (later)

| Task | Where |
|------|-------|
| **Theme sweep over every dropdown and menu** — 82 literal colours → tokens across 20 floating surfaces | `0e090a6b`, deployed |
| Theme tokens **verified resolving** on the live grid under Stardew — `--menu-shadow-1/2/3` brown (`rgba(52,31,14,…)`) not black, `--scrim` brown, `--signal-warn` darkened | browser probe |
| **Weekday feature VERIFIED IN A BROWSER** — the 2026-08-21 honest gap, closed | probe |
| **Merge templates as layers** — 7 day-templates → 6 reusable layers; `Place Weekday` merges every template whose `Weekday` contains the day. 56 duplicated meal rows → 8; stored rows 84 → 43 | `0177` |
| Today's column needed **no clear** — `0112` signs template rows by CONTENT (`cycle:<pick>`), so consolidating changes nothing a column matches on. Both ticked rows kept | measured |

## Done — 2026-08-21

| Task | Where |
|------|-------|
| Sidebar: Pinned and Root read as two sections | `6cabeeba` |
| Sidebar: Pinned stopped re-drawing the whole manifest (`Root` folder page) | `6cabeeba` |
| The day column's `Todo` had lost its identity marker — **due placement had been a silent no-op** | `0172` |
| `Weekday` on a task → a fresh copy on that weekday, every week | `0173` |
| Due placement yields to a weekday | `0173` |
| New occurrences inherit their siblings' fields, roles included | `12299b4f` |
| Field picker splits Display / Input into sections | `12299b4f` |
| Two inert `kind`s fixed at call sites the 2026-07-29 fix never reached | `12299b4f` |
| `--on-accent` / `--menu-shadow` tokens; the add menu reads the theme | `12299b4f` |
| Schedule snapped back to today (Aug 20 → Aug 21) so today's column rebuilds | data |
| **Both meal trackers were structurally dead** — macros and Meal Log | `0174` |
| `Time 1/2/3` (seconds) replace `Weight N` on planks and side planks; the bogus `1 reps` cleared | `0175` |
| `Date` hidden on timeslots — it was inherited-visible from the Schedule page's list | `0176` |
| Add-menu **value step** — the real field controls, every input type, not a hand-rolled subset | `49267930` |
| Ticked fields sort to the top of the field picker | `49267930` |
| `+ Item` was born with no date — it wrote `fields: {}` where the sibling path stamps the filter | `49267930` |

## DONE — 2026-08-23: the codex, as PAGES not one import (`0202` + `0203`)

User, mid-session: *"i want to create a plan to convert all the md files in the
notes_codex_annotated to pages with textblocks and appropriate occurances, into a codex folder in
our system"* — source `/home/joshpoms/notebook/notes_codex_annotated`, and *"after the bookmark
stuff tho"*.

**A PLAN FIRST, not a migration.** `markdownToModuli` already exists and already builds a tree from
one document; the open questions are about SHAPE at scale — one page per file vs a folder mirroring
the directory tree, what becomes a textblock vs a container, and what happens to the annotations
that presumably make these files "annotated". Measure the corpus before designing anything.

## Sweep #4 — all three accounts, 419 distinct turns, VERIFIED not assumed

The user has now said three times that small asks are missing. This pass re-extracted
**419 distinct user turns across 52 session files** in `.claude`, `.claude-account2` and
`.claude-account3` — 96 of them since 08-14 — and then **measured the live grid** for the
ones a status line could only guess at. The recurring answer is that they shipped; the
value here is that each is now settled by a number rather than by a claim.

| The ask (verbatim) | Measured on poms grid | Verdict |
|---|---|---|
| *"base the ingrediants on the quanity that matches the protein carbs and fats… so 2 eggs become 1 egg"* (08-14) | every grocery ingredient carries `Quantity = 1` with its own per-unit postfix — `oz · large · cup · tbsp · count · medium · scoop` | ✅ shipped |
| *"fill the price there… just give me a rough estimate for each"* (08-14) | 23 of the first 30 grocery rows carry a price (7 · 2.5 · 5.5 · 1.5 · 2 · 3 …). The 7 without are the staples `0115` deliberately KEPT and never priced — Milk, Bananas, Coffee Beans, Paper Towels | ✅ shipped |
| *"the postfix is displaying twice… it will say 3oz oz"* (08-14) | the postfix is stored once, on the row (`Quantity.postfix`), not in the value | ✅ shipped |
| *"i cant edit how many ## hashtags there are for a header"* (08-18) | `client/src/ui/HeadingLevelPicker.jsx` exists and `ModuleContainer` mounts it | ✅ shipped |
| *"tasks set to complete… get properly sent to completed at the end of the day even if they arent on the schedule"* (08-21) | `0179` built a second mechanism and was **retracted** by `0180`; the real defect (feed scope resolving through a last-writer-wins parent map) was then fixed | ✅ shipped, `96b0699a` |
| *"turn off all the vitamins… on the grocery list side"* (08-14) | not separately re-measured this pass — the grocery rows read `Quantity`/`Price` and the vitamin fields are hidden by `fieldVisibility` | 🟡 believed shipped |

**Still unexplained, second pass running:** `meta.servingSize` is `undefined` on **every**
grocery ingredient, though CLAUDE.md 2026-08-13 (7) records serving sizes moving there when
the amounts came out of the titles. Either that write never stuck or they live elsewhere.
It is small and it is a real disagreement between the record and the data.

**Also confirmed by the same probe, and it is why item 0 needs a decision rather than a
build:** `Day` places exactly one `Drink`, at 6:00am, with no Beverage picked.

## Sweep #5 — the stream three sweeps missed

The user said four times that small asks were missing. They were right, and the reason
is mechanical: **a compacted session replaces its earlier user turns with a summary**, so
those asks exist only as quoted text inside an assistant-authored summary record. Sweeps
#1–#4 all read `type:"user"` records and could not see them.

```
record streams in 52 session files, all three accounts
  type:"user"        17,321 records   ->    419 distinct real turns   <- all four sweeps read this
  type:"last-prompt"  4,137 records   ->    402 distinct prompts      <- never read before
  isCompactSummary       18 records   -> 286,536 chars of summary     <- never read before
```

Mining the summaries for quoted asks yielded **315 candidates**, of which the ones with no
trace anywhere in `TASKS.md`, `CLAUDE_CHAT.md` or `CLAUDE.md` are filed above as items D, E
and F. The Eminem infobox comma and the Spanish-translation ask appear in **no user turn at
all** — they exist only inside a summary, which is exactly the class this sweep was for.

**The filter used to say "not recorded" is a heuristic and is NOT a verdict.** It scores a
quote by how many of its distinctive words appear in the three record files. That is good
enough to surface candidates and not good enough to close one, so nothing was retired on its
say-so — the items above are filed as open regardless of what the heuristic thought.
