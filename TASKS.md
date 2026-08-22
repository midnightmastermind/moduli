# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

| # | Task | State |
|---|------|-------|
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
| C3 | **`Operation.targetOccurrenceId` has NO editor at all** — 9 live ops carry it and it is load-bearing: the executor resolves `$activePeriodDates` from the op's OWN page through it (CLAUDE.md 2026-08-09 (8)). Every `targetOccurrenceId` match in the client is the unrelated `commitApplyTemplate` argument. So the one field that decides which page a date-driven op reads is invisible to the operations UI | 🐛 confirmed gap |
| C4 | **Two field-meta keys are INERT** — `meta.increment` on **36 fields** and `meta.multiline` on 5 are read by nothing (`DrilldownTimePicker`'s `increment` is unrelated local state). The inert-token class this repo keeps rediscovering; either wire them or drop them. **Checked and NOT a gap:** `meta.workoutGoal` on 26 fields is `0170`'s own idempotency marker, correctly absent from the UI | 🐛 inert |
| D | **The Eminem infobox renders an empty spot before Kimberly — "its just a comma"** — recovered from a COMPACT SUMMARY, not from any user turn, which is why three sweeps missed it | 🐛 never filed |
| E | **Spanish translations in brackets** — *"could you put in the md file the translation next to the spanish in brackets"*. Same recovery | 📋 never filed |
| F | **"and for rest day, dont have anythign for excersise"** / **"but dont show draggables"** / **"we want layout, just not cascaded dude"** — three more from summaries; the third is a CORRECTION to a design decision and needs your context before anything is changed | ❓ needs your call |
| 0 | **`Drink` with `Water` selected, on the `Meals` template** — *"also drink should show up with water selected in the meals template"* (08-22). **STALE — `0187` shipped it.** Re-measured: **8 `Drink` rows on the `Meals` layer, all 8 carrying `Water`** (`QYYO61oFcf33`) | ✅ shipped |
| 1 | **A `Routine` schedule-template LAYER** — *"make another schedule template called routine and merge that in"* (08-22). **STALE — `0185` is applied.** Verified on the live grid: the `Routine` layer carries all seven weekdays and 7 rows, and today's Saturday column holds them merged beside the `Meals` layer — 8 `Eat` + 8 `Drink` + Drink 6:00am · Hygiene · Hot Tub · Take Medication ×2 · Walk · Journal | ✅ shipped |
| 2 | **Display-field audit** — *"look at all my display fields and make sure they are being used by an operation or updated in some way"* (08-20). 99 display-enabled fields on poms grid; `unused-field` flags **15**. Never done; it is the same audit `next-session-decisions.md` files as *"`unused-field` is at 14 — worth one pass now that the audit tooling exists"* | 📋 never started |
| 3 | **The three DARK themes are still unmeasured** for contrast. The 2026-08-20 attempt failed its own calibration — the probe sampled marquee TRACKS rather than glyph boxes, and test grid 2 still carries the base rainbow so the surface behind a translucent pill is not uniform. `next-session-decisions.md` records exactly how to start ahead | 📋 open, method known |
| 3b | **Tracker date-filter audit** — *"after, i want you to audit all my trackers and make sure they are updated and everything is updated when i select a new date filter in the respective spots"* (08-21). Marked **QUEUED** in `CLAUDE_CHAT.md` and never run. Parts landed (`0164` category axis, `0166`/`0167` period-all on three trackers) but the audit itself — every tracker recomputing correctly against **the filter of the page it lives on** — was never done. Adjacent to item 10: a Trackers nav matches 44 ops, ~42 of them trackers | 📋 QUEUED, never run |
| 3c | **Open-page-in-panel highlight** — *"if i open a page in a panel, and its already opened in another visible panel, highlight the page in the spot thats opened (still open the page in the original spot)"*. `openOccurrenceInPanel` knows `alreadyOpen` only for the SAME panel's active page; nothing looks across panels | ❓ appears never built |
| 4 | **"What else is technically needed for the original vision"** — asked 08-20, never answered | 📋 open ask |
| 5 | **Instance/tracker label font sizes** — *"make sure the instance labels text size 1 size bigger too"* (08-20), and the follow-up that says the attempt went wrong: *"the fields in trackers font sizes didnt change and the rest are too big now"* (08-19). No CSS rule sizes `.instance-label`; the sizes are INLINE in `ModuleInstance.jsx`, which is the documented trap. No recorded fix for either | ❓ regression reported, unfixed |
| 5b | **Emotions wheel third level reads blank at rest** — *"its written, the writing is just transparent and only shows on hover"* (08-18). This may BE the deliberate responsive hiding from 2026-08-08 (6) — outer labels are dropped when a 4.5° slice is under ~1.8× the font size, and return on zoom. If so it is working as designed and the design is unwanted; if not it is a real bug. **Needs your call before anything is changed** | ❓ by design or bug |
| 6 | **Monthly Bills goal target is a frozen literal** — `displayConfig.targetValue` is `2040.97` and takes a number only. Correct today, drifts the moment a bill changes | 📋 reported, not fixed |
| 7 | **Micronutrient op double-counts a repeated ingredient across meals** — correct for a day's intake, wrong if the tile is ever pointed at a template | 📋 known limit |
| 8 | **Trackers panel sits at 36% of the left column** — one splitter drag if it reads short | 🎨 cosmetic, your call |
| 9 | **Assistant grid-build plan is written, not executed** — and its blocker is measured: the configured 3B model took **207s** for one read-only tool call and answered wrong. Step 1 is config (the allowlist is an env var), not code | 📋 planned |
| 10 | **Schedule apply ~1s** — `resolveOptions` predicate filter ~766ms | 📋 measured, not fixed |
| 12 | **Ingredient artifacts: only ONE image shows in the spread** — *"all the ingrediants are all showing just one file"* / *"put in alternative photos in ingrediants for each one"* (08-16). Measured on the live fixture: **227 occurrences carry a `Files` value and only 50 carry more than one**, so for 177 of them there IS only one file to show. Two separate things behind one report — the missing alternates (data) and whether the spread renders them all (render) | 📋 measured, unfixed |
| 13 | **Ingredient quantities should match the macros** — *"base the ingrediants on the quanity that matches the protein carbs and fats. and make it the lowest amount with quantity. so 2 eggs become 1 egg and has the macros to match 1 egg"* (08-14). Never recorded as done | ❓ appears never built |
| 14 | **Tracker tile layout asks, three of them, from one afternoon** — *"make the tracker occurances a bit wider and also let the containers extend full width"*, *"the drag handle and the title should be on top of fields"*, *"why arent the workout trackers boxes like the rest… planning, nutrition, and media arent boxes either"* (08-11). Adjacent to item 5, which is the FONT half of the same surface. No `minHeight` rule exists on `ModuleInstance`, so the *"height auto"* half of it may already be moot | ❓ needs your eyes on one screenshot |
| 11 | **Three external-data pipes** — Tasker profiles, ingest credentials, the four slow exports | 🚫 blocked on you |

## Done — 2026-08-22 (afternoon)

| Task | Where |
|------|-------|
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
