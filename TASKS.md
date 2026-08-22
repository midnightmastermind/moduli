# TASKS — running queue

Maintained by Claude. Newest direction lands here first; the reasoning lives in
`CLAUDE_CHAT.md` and the plans under `docs/superpowers/plans/`.

## Open

| # | Task | State |
|---|------|-------|
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
| 11 | **Three external-data pipes** — Tasker profiles, ingest credentials, the four slow exports | 🚫 blocked on you |

## Done — 2026-08-22 (micro sweep)

| Task | Where |
|------|-------|
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

**One to re-check:** `0` ingredients carry `meta.servingSize`, though CLAUDE.md 2026-08-13 (7) records serving sizes moving there when the amounts came out of the titles. Either they live somewhere else or that write did not stick — measured, not yet explained.

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
