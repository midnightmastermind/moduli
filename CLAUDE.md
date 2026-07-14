# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---

## Handoff — 2026-07-14 (3) (label [Field] tokens; 4-macro meal tiles; per-set weights; full headers)

Third batch (CLAUDE_CHAT 2026-07-14 (3)). Deployed + reseeded:
- **`[Field Name]` label tokens (NEW `helpers/labelTokens.js`)** — an instance label containing
  `[Water]` / `[Completed]` / any field name renders the occurrence's LIVE value at display time
  (ModuleInstance labels + RepresentationView chips). Raw label stays stored/editable (inline
  rename shows the brackets). Carried-value wins over duplicate field names; unknown brackets stay
  literal. This fills the INSTANCE gap in the editor↔field binding system — BoundHeader/BoundBody
  (meta.headerLink/bodyLink, containers + textblocks, write-back + linked-sibling sync) still
  exist and are the read-WRITE path; tokens are read-only display. 7 tests.
- **Per-meal Nutrition tiles carry all four macros** — new "Calories" display field; the 4
  per-meal trackers accumulate calories/protein/carbs/fats in one loop and write 4 goal fields
  (protein FIRST — trackerValue() reads the first write); tiles bind all four. Behavioral test.
- **Workouts: per-set weights** — Weight 1/2/3 fields bound PAIRED with their sets on all 30
  exercises; Workout History rows carry s1/w1/s2/w2/s3/w3; headers are the FULL names
  (Set 1/Weight 1/… — per user, no abbreviations; the table marquee owns the width).
- **Verified**: 1280/1280 client + 237/237 server, reseeded (73+ ops? — see export), deployed.

---

## Handoff — 2026-07-14 (2) (pomodoro = elapsed time; multiples per slot; bare "None"; 3 set counts; table marquee)

Second batch of the session, per user directive (CLAUDE_CHAT 2026-07-14 (2)). All deployed +
reseeded (72 ops now):
- **Pomodoro sessions track RUNNING time**: start at 0 minutes; new `PomoTickOp` (timer fires it
  each running minute + on pause) → new **"Pomodoro: Update Time"** op writes elapsed minutes
  onto the open session. Timeout → Pomodoro: Complete writes the full phase minutes + Completed;
  completing the occurrence EARLY (checkbox) keeps the shorter ticked time. Pause→resume no
  longer mints a second session (Start fires only on a fresh phase).
- **Multiple pomodoros per slot exposed a real bug, fixed**: Start's COPY_LINK source was
  FIND-by-label "Pomodoro" — session copies inherit the module label, so the 2nd start of a day
  matched template + session #1 → array → broken create. Source is picker-direct now
  (`$allItemsById.<template occ id>` captured at seed wiring).
- **Dropdown "None" is bare** — no explanatory wording; where "none" routes is the operation's
  business (user: "the system doesnt know what it is. its just none").
- **Workout History rows carry all 3 set counts** (s1/s2/s3 columns replacing the single "Reps"
  = Set 1 only) and **both array-column tables (compact + full) marquee the WHOLE table box** via
  AutoMarquee when the columns overflow (static when they fit).
- **Verified**: 1272/1272 client (4 new/updated behavioral + display) + 237/237 server, build
  clean, deployed, prod HEAD verified, reseeded (dev=prod Atlas).

---

## Handoff — 2026-07-14 (workout history + pomodoro stale-slot orphan FIXED; timeslot language dropped)

Continuation of account3's interrupted session (its systematic-debugging pass on the user's
2026-07-14 report — see CLAUDE_CHAT 2026-07-14). All three parts shipped, deployed + live grid
reseeded (same Atlas DB as prod, so the local reseed IS the live reseed; deploy restarts pm2):
- **Workout History (Workouts display) fixed** — account3's root cause confirmed + shipped: the
  tracker's loop gated on `workoutType` (bound only by the generic "Morning Workout" task), but
  exercise instances (Bench Press…) carry `muscleGroup` → every exercise was excluded and the
  Exercise/Reps/Wt history stayed `[]` forever. Gate is `muscleGroup IS_NOT_EMPTY` now
  (createLiveData.js ~8597). Behavioral test asserts history rows land.
- **Pomodoro "nothing created in the timeslot" — REAL bug, prod-verified:** the session WAS
  created (05:02:32Z, fields all correct) but parented to a slot that no longer exists. The
  Pomodoro: Start slot FIND matched by LABEL ONLY (any `scheduleFormat:"slot"` under Schedule);
  started at 12:02am it grabbed the PREVIOUS day's "12:00am" per-day slot copy — invisible under
  that day-col's date cascade, then orphaned when the 12:01am new-day rebuild swept the old
  day-col (day-col + 48 fresh slot copies mint per day; prod timeline: rebuild 05:01:19Z, session
  05:02:32Z). FIX: the FIND now resolves TODAY's day-col first (`scheduleFormat IS "day-col"` +
  `date SAME_DAY $today`) and only accepts a slot `HAS_ANCESTOR $dayColId`; empty $dayColId
  fails closed (HAS_ANCESTOR vs empty right matches nothing) → op no-ops instead of wrong-day
  writes. 2 behavioral tests: session lands under today's day-col; a stale-day-col slot whose
  label exists nowhere else NEVER matches (no-op).
- **Timeslot language removed from the Pomodoro UI** (PomodoroTimer.jsx): dropdown option now
  "Automatic (today's schedule)"; comment reworded. Slot-matching behavior itself stays (user:
  "the issue is not decoupled — the schedule is up when i did this").
- **FOLLOW-UP (same session, user live-tested): "last workout works but not Workouts"** — the
  muscleGroup fix put the rows in the DB (verified: prod goal occ carries the Bench Press row),
  but the tile still showed "—": a DISPLAY bug previously masked by the always-empty data.
  `Field.jsx` (a) `rawDisplayValue` nuked bare arrays to undefined (the display-path twin of the
  2026-07-12 extractValue fix) and (b) the compact pill branch returned before the columnar-table
  branch, so compact tiles could never render `displayConfig.columns` rows. Both fixed — ALL
  array-history tiles (Workouts/Meals/Moods/Purchases) now render their tables on goal tiles.
  3 tests in Field.arrayValue.test.jsx.
- **Verified**: 1268/1268 client (6 new) + 237/237 server, build clean, prod HEAD checked
  post-deploy, live headless probes: Workout Log tile renders its Exercise/Reps/Wt rows.
- **Probe lesson (recorded)**: the behavioral harness proved the op pipeline GREEN on a fresh
  seed — the live failure only surfaced from prod DB ground truth (orphan session row). When a
  harness repro passes but the user sees failure, diff LIVE STATE against the harness world
  before touching the pipeline.

---

## Handoff — 2026-07-13 EVE (audit follow-through: categoryKind SHIPPED; caret diag now opt-in)

Continuation of the PM audit ("keep going"). Finished the remaining audit surfaces (image
routes, ContainerTable child-rows sort, PageCanvas fallback, ModuleInstance under-body fields,
OpDisplayPill — all clean), then shipped the deferred altitude fix (`f64a9c9a`, deployed +
reseeded + verified headless):
- **`Folder.categoryKind` ("field" | "op")** — the field-vs-op category axis is now DATA stamped
  at creation (seed: 9 field + 7 op categories; both tabs' "+ Category" stamp their kind).
  FieldsTab/OperationsTab column filters read it first; the contents inference survives ONLY as
  the fallback for legacy null folders. Fixes both symptoms: op categories no longer render as
  empty FieldsTab columns, and deleting a category's last op can't flip its axis.
- **[caret] diagnostics flipped to OPT-IN** (`window.__caretDiag = true` re-enables) — the
  Firefox caret fix is deployed + verified, so per-click console logging no longer ships on.
- Verification-probe lesson (recorded so the next session doesn't chase ghosts): innerText
  substring checks against the Command Center match TAB LABELS and OP NAMES ("Alarms" the tab,
  "Breakfast Nutrition" the op) — assert against the folder stamps / DOM structure instead.

---

## Handoff — 2026-07-13 PM (correctness audit of the whole since-Monday range; alarm-at-load bug FIXED)

Per user: audit everything shipped since Mon 2026-07-06 (103 commits, `b8fb96bd^..HEAD`) for
correctness + optimization. Subagents were unavailable (account spend limit) → ran the review
INLINE: line-by-line over the fresh runtime surfaces (feedSync engine, useScheduler adaptive
tick, server models/handlers incl. update_grid no-upsert + ensureUserManifest, Field.jsx value
paths, dragSystem payload round-trip, NOTIFY), cross-checked removed behaviors (QuickAddMenu
trigger matrix across all 5 hosts, artifact-page legacy views, manifest core semantics), plus
live probes. Two findings, both FIXED + deployed (`1e2a042f`, prod `2d11b72f`):
- **Alarms rang/toasted on EVERY page load (real bug, user-visible):**
  `computeTriggerMatch` treated `triggerTypes: []` as "no config → fire on load", but explicit
  `[]` is the seed's schedule-only declaration (atTimes alarms, interval slot painters). The
  onLoad sweep executed both alarms' NOTIFY inline (60s ⏰ toast + ringAlarm — the paired
  AudioContext warnings in the user's 2026-07-13 console log; 0fx because NOTIFY pushes no
  effect). Explicit [] now never event-fires; legacy no-config ops keep the load back-compat;
  ops that want a load fire declare "onLoad" (Project: Create already does). Verified live:
  onLoad sweep 59→55 ops, no toast/ring; scheduler firing untouched. Old test locking the buggy
  semantics corrected + 2 new cases; 1264/1264.
- **parseExternalDrop dropped the normalized payload `occurrenceId`** on cross-window drops
  (serializePayload carries it; the parse branch rebuilt the payload without it) — round-trips now.
- Clean on inspection: feedSync (scan-diff + accumulated parent ref), cadenceMs (Infinity for
  atTimes → clamps to the 5s tick, no NaN interval), server model additions (declared-key fixes
  for fieldBindings.role/display strict-mode stripping), update_grid zombie guard, image-picker
  write path. `.gitignore` probe pattern UNANCHORED (`_*.mjs`) — deploy.sh's add -A swept
  client/-rooted probe scripts into deploy commits twice.
- Still-open (unchanged, deliberate): Folder `categoryKind` stamp (own session), the user's
  doc-open perf repro, "copies when it should move" repro, [caret] diagnostics removal once the
  user confirms.

---

## Handoff — 2026-07-13 (caret round 2 FIXED: Firefox draggable-ancestor suppression; deployed `837e4542`)

The user's [caret] logs closed the case in one round-trip: caretAtPoint resolved the mid-chip
click at offset 8, the selection SETTLED at 0, and there were ZERO INTERFERE lines — no JS moved
it; the BROWSER refused placement. The user is on FIREFOX (AudioContext wording + `user-drag=-`
in the drag-source chain), and a discrimination probe (headless FF) proved the mechanism:
**Firefox suppresses native caret placement in an editable that has ANY `draggable="true"`
ANCESTOR** — stripping every draggable attr made the identical click land at offset 10; a bare
nested-editable island works fine. Round 1 (f2e89136) only fixed Chromium's CSS vector.
Fix (`837e4542`, deployed + prod HEAD verified + reseeded):
- **Chip** (InstanceTextblockInlineNode): wrapper's draggable ATTRIBUTE disarmed at rest (armed
  with the CSS hint only while the radial drag handle is pressed) + the content span places its own caret
  from the click point on click (ancestors can't be disarmed — they're real drag sources).
  Range selections are left alone.
- **Editor.jsx**: the mousedown posAtCoords fix-up (the thing that rescues BLOCK textblocks from
  the same suppression) is gated to the editor that OWNS the click — it used to fire in every
  ancestor editor per click (4 competing setTextSelection writes; now 1).
- Verified headless FF + Chromium: chip mid-click → caret mid-text + typing inserts there; FF
  block textblock → offset 64; handle drags arm; wrap 6/6 on a fresh seed; 1262/1262 tests.
- **[caret] diagnostics are still in** (helpers/caretDiag.js, ON by default, once per click) —
  remove or default-off once the user confirms on-device. Probe lesson re-confirmed: a failing
  wrap probe on a dirty grid (`on=false` 6/6) went green after a reseed.

---

## Handoff — 2026-07-12 NIGHT-2 (caret round 2: [caret] diagnostics deployed → FIXED above)

User: "clicking on mini textblocks in the middle is still not putting the writing cursor there —
it puts it at the start; put in logs." Round 1 (f2e89136) fixed the inline chips' user-drag
suppression; desktop headless still places mid-text (chip SETTLED offset 13), so round 2 ships
INSTRUMENTATION instead of a guess (`09d0f7b7`, deployed, prod HEAD verified):
- **`helpers/caretDiag.js` (NEW)** — `[caret]` console lines, ON by default (once per click;
  `window.__caretDiag = false` mutes): DOWN (target, coords, pointerType, caretFromPoint = what
  the browser WOULD place, drag-source ancestor chain = the round-1 signature), SETTLED at
  100/400ms (where the selection actually ended up), INTERFERE (selection writers inside the 2s
  click window: Editor's posAtCoords fix-up + rAF setTextSelection, setContent sync,
  the two padding-click focus('end') sites). Wired into Editor.jsx / DocContent.jsx /
  InstanceTextblockInlineNode.jsx.
- **Early signal from the baseline run:** mousedown BUBBLES through nested editors, so EVERY
  ancestor editor runs the wrapper's posAtCoords caret fix-up against ITS OWN doc and schedules
  its own rAF setTextSelection — the outer editor resolves the click to the atom boundary
  (pos 0/1 = the START). Two competing selection writes per click; likely the winner differs on
  the user's device/geometry. **Next session: get the user's [caret] console lines** (which host:
  block-mini-textblock vs chip vs card; which INTERFERE line lands last before a SETTLED-at-0)
  and fix the losing layer — probably gate the fix-up to the INNERMOST editor only
  (e.g. skip when `e.target.closest('.doc-editor') !== el`).

---

## Handoff — 2026-07-12 NIGHT (simplify-audit APPLIED + spinner fix; the queued full audit is DONE)

Continuation session (account2): picked up account3's session-limited audit + account2's
spend-limited perf thread via the jsonl logs. The queued "/simplify full audit over the past
couple days" had its 4 review agents FINISHED but unapplied (results recovered from
/tmp task outputs); this session applied them all. Shipped (3 commits + docs, deployed):
- **Spinner fix committed** (`4911c9f8`) — account3's uncommitted `viafluere_mark.png` re-crop
  (mark's visual center = rotation pivot; re-verified bbox center within 0.5px) — the infinity
  logo now spins like a top, not a train on a track. Queue item CLOSED.
- **Server dedupe** (`10d99928`) — `makeAlarmOp` (seeded alarms derive from one builder; the
  hand-typed 6:30 AM literal had ALREADY drifted), shared `completionGateOrRule`, one
  `ensureManifestOfType` core behind templates/user manifests.
- **Client audit fixes** (`9ed82dd9`, 19 files) — reuse: openPanelOnRootFolderPage /
  createPagePinnedToPanel / spliceChildIntoParent / isTextmappedModule / arrayIncludes /
  DeltaBadge + one FLOW_TINTS source; altitude: artifact pages mint a REAL View (ModulePage's
  synthesized-view branch deleted), ensureArtifactPageOcc owns the role gate, **QuickAddMenu
  contract fixed at the root** (positive openTrigger opens at MOUNT; onOpenChange on transitions
  only → the 50ms deferrals + gapMenuWasOpenRef workarounds are deleted, ModulePanel's hidden
  menu mounts lazily), createPayload normalizes occurrenceId; perf: dragover uses e.target (no
  per-frame elementFromPoint), detectSideHost depth<1 identity fast-path, ONE shared dragend
  registry, WrapGroupNode single fused prose walk, _boundFieldIds per-template WeakMap cache.
- **Verified**: 1262/1262 client + 237/237 server + build; headless E2E — panel "Add page…"
  (lazy menu opens), doc "Add occurrence here…" (pinned gap palette, no deferral), tree artifact
  click → display page renders via the real View, wrap 6/6 drops re-verified.
- **Deferred (filed, not done)**: OperationsTab/FieldsTab field-vs-op category classification is
  still contents-inference — the altitude fix (stamp `categoryKind` on the Folder record at
  creation + one-time migration) needs schema + seed + both tabs in one session. Also still
  open from the last session: the user's "2 seconds to open a doc page" (measured 287ms
  unthrottled headless; needs the user's device context — likely the eager-TipTap docket).

---

## Handoff — 2026-07-12 LATE (2-col gating + depth fallback + doc-DnD audit; deployed `63fc5dd1`)

All deployed + prod reseeded, HEAD/tree verified. On top of the morning batch:
- **2-col side gating** (per user): NO left/right side points on an existing wrapGroup for outside
  drags — EXCEPT directly over the NEIGHBOR COLUMN, which stacks the drop into that column
  (columns hold N occurrences; host side is one block). Group members always pass (drag = re-morph
  side/anchor). Dragged occ id: threaded into detectSideHost at drop time; `body.dataset.dragOccId`
  (DragProvider stamp) covers dragover indicators.
- **detectSideHost depth<1 fallback**: posAtCoords resolves to the DOC gap at block edges (always,
  for a single-block nested section) — now falls back to the top-level block whose Y-band contains
  the pointer. This was silently killing side drops in single-block sections.
- **Under/above a wrapped image**: exactly ONE honest indicator now (was "2 above, none below").
- **Doc-DnD audit (mouse, headless)**: columns form beside non-text embeds ✓, swap button flips
  sides ✓, wrap↔columns toggle ✓, wrap 6/6 form + 6/6 member re-morph ✓, neighbor-column stacking
  gate ✓, boundary lines honest around wrap groups ✓, 1241/1241 + 237/237. NOT re-run: TOUCH
  parity for the new columns/gating paths (same handleDocDrop/getDocTouchDropZone code, but
  unverified on-device this round).
- **Description v3**: generic-first (the system doesn't know what a "schedule" is — it's a use
  case; the workspace/blocks story leads). Probe note: `_wrap6mouse.mjs` now anchors on the "Most
  apps decide in advance" textblock and measures PLAIN-host wraps (group-adds are gated now).
- **#9 mini-textblock caret FIXED** (`f2e89136`, deployed): the bug was ONLY on the INLINE chips
  (`.itbi-content` — e.g. "Read ✅ 30 pages" in the viafluere doc), not the big textblock cards.
  Root cause: the chip sat in the `user-drag: element` CSS rule → the whole chip was a native
  drag source → Chromium suppresses caret placement in drag sources → click-to-edit landed at
  offset 0. Chip removed from the rule; the wrapper arms `user-drag:element` ONLY while the radial
  drag handle is pressed (InstanceTextblockInlineNode onPointerDown). Verified live: click at 60% of
  the chip → caret offset 10, typing inserts mid-text; handle drag-out still works.
- **Queued**: #13 — doc right-click menu needs an "Add occurrence" item opening the QuickAddMenu.

---

## Handoff — 2026-07-12 (wrap↔columns restored; side drops beside ANYTHING; ops categories; alarms ×2)

All deployed (`8f0b3ccf`) + prod reseeded, tree clean, HEAD verified. Shipped this session:
- **wrap↔columns restored** (docs/CLAUDE.md 2026-07-12 entry): wrapGroup `wrap` attr is back —
  textmapped hosts default to the L-morph with a radial Wrap on/off toggle; side drops beside
  NON-text occurrences (edge thirds) form side-by-side COLUMNS (wrap:false — no morph, no
  auto-stack, but stacks at low width). Seam renders in both modes + new ⇄ swap-sides button ON
  the seam. Neighbor column stacks N occurrences; host is one block.
- **Ops tab categories fixed**: field-only category folders no longer render as ops columns
  (data-driven: has fields + no ops = field category); the 8 uncategorized seed ops got homes
  (Moods/Phone Calls→Trackers, Rotator→Day Page Ops, Project ×3→new Projects, People ×2→Library).
- **Seed**: Viafluere description rewritten (layman + depth, same wrap); 6:30 AM alarm added
  beside the 5 PM one; Schedule hides Date/Time Slot/Last Seen (fieldVisibility, prior commit).
- **Caret-at-click investigated**: NOT reproducible on the current build (doc cards, section
  blocks, inline chips all place the caret at the click point headless — offsets 21/35 verified).
  The user's repro was on the stale prod build. If it recurs: get WHICH textblock + mouse/touch.
- **Probe discipline reminder**: two "regressions" this session (caret offset-0, wrap 0/6) were
  BOTH probe artifacts — stale coords after a second scrollIntoView, and dirty grid state from a
  prior probe run. Reseed + fresh coords before trusting a failing probe.

---

## Handoff — 2026-07-11 NIGHT (deploy pipeline fixed after a MASKED stale deploy; edge bar; field hiding)

**A deploy silently failed and shipped stale code** (user: "flow buttons the same / still no cash
account"): prod reseeds regenerated `server/seed/*.json` IN THE PROD WORKTREE, the next `git pull`
aborted on the churn, and piping the pull through `tail` masked the non-zero exit (`set -e` only
sees the pipe's last command) — so the old build was rebuilt and the OLD seed script reseeded.
Fixed at the root (`09b17a3a`): `deploydata.sh` reseeds with `--no-export` (exports are the
DEV-side fixture) and `deploy.sh` syncs prod via `git fetch + reset --hard origin/master`.
**Lesson: after every deploy, verify prod HEAD (`ssh … git log --oneline -1`), not script output.**

Also shipped (`06a7a9c7`, deployed + reseeded): **doc side-drop edge bar** — the wrap-beside
affordance was an invisible 2px horizontal sliver; detectSideHost now returns the host rect and a
full-height 3px vertical `.wrap-drop-edge` bar paints on the targeted side ("dropping to the
LEFT/RIGHT of this block"). **Schedule field hiding** — the Schedule page occ seeds
`fieldVisibility {mode:"hide", [date, timeslot, lastSeen]}`; rows show Completed only.
**Open:** (a) side-drop beside NON-text occurrences (nonwrapped column) — designed, task filed:
needs a wrapGroup variant that doesn't auto-stack for non-prose hosts; (b) "can't click into a
mini textblock" — NOT reproduced on current build (doc card / section block / inline chip all
take the caret headless); likely the stale build — awaiting user retest after hard reload.

---

## Handoff — 2026-07-11 EVE (deployed to prod; new-grid manifest + zombie-grid fixes; 3 tasks queued)

Account3 session. **Everything through the queue is DEPLOYED** (`6cfa64de` code + docs, then
`e20b92f3`): viafluere.com serves the new build, prod data reseeded TWICE (second time after the
grid fixes), origin current. Probe scripts + screenshots are now gitignored (`/_*.mjs`,
`screenshots/`) so `deploy.sh`'s `git add -A` can't sweep them.

**User's "4 columns to start" + "adding panels didn't work on a new grid / No content" — both
root-caused and shipped (`e20b92f3`):**
- The 4-column grid was a **ZOMBIE duplicate Live Grid**: `update_grid` upserted, so a stale
  connected tab's layoutTree write RESURRECTED the grid doc a reseed had just deleted (panel occs
  already gone → 4-child tree over missing panels + the user's "Board 6" test panel). Upsert
  removed; zombie + a dead skeleton swept from Atlas; fresh default grid verified pristine
  (5 panels, 3-col mosaic [0.8,1,0.8], single copy).
- New grids had **no user manifest** → the manifest tree, folder pages, and empty-cell panel-add
  were silently dead. New `server/utils/userManifest.js` (ensureUserManifest, called in
  request_full_state) + shared client `ensureRootFolderPageOcc` (importsFolder.js): the Toolbar
  + button AND empty-cell tap now open new panels on the ROOT folder page. E2E-verified headless
  (fresh grid → manifest present → both add paths → zero "No content" panels).
- Missed-task audit of all account session logs: everything shipped except one open repro ask —
  **"copies when it should move"** still needs a concrete repro from the user. The stale-chunk CC
  crash is a non-issue on prod (index.html no-cache + immutable assets verified live).

**All three queued items SHIPPED same session:** (a) **flow restyle** — FlowToggle is now a
divided leading segment INSIDE the pill/input (randomizer pattern) and the whole control tints
green/blue/red by flow (compact pills + full number/duration inputs; FLOW_TINTS in ui/Field.jsx).
(b) **Alarms tab** — new CC tab (AlarmClock icon): Android-style rows (tap the big time to edit,
label inline, alarm↔reminder chip, preview sound, enable switch). Each row IS an Operation —
`op.alarm` config + `schedule:{kind:"atTimes"}` + one NOTIFY step (now supports `sound`/`duration`;
`helpers/alarmSound.js` rings synthesized WebAudio beeps). `helpers/alarmOps.js` derives
name/schedule/pipeline from the alarm so they can't drift; the Operations tab renders alarm ops
READ-ONLY ("Managed by the Alarms tab" banner). Seeded **"Alarm: 5 PM"** (rings + notifies,
Alarms op category). Along the way the **hourly-chime lastFiredAt race is FIXED** (useScheduler
now dispatches the stamp locally before the socket emit) — E2E: an alarm fires exactly ONCE in
its minute. (c) **Cash account** — cashBalance field + Cash instance in Finances + gated
supportsReplace "Cash Balance" tracker (sum-of-amount like Mom's). 1241/1241 client + 237/237
server; live grid reseeded.

---

## Handoff — 2026-07-11 LATE (queued tasks shipped: flow button, image search, doc-DnD lines, Tasks Left red)

Reconstructed the cleared task queue from the other accounts' session logs and shipped 4 of 5
items, all on master (**DEPLOYED to prod 2026-07-11** by account3 at `6cfa64de` — origin current,
viafluere.com serving the new build; prod's local seed-export churn stashed as
`prod-local seed export churn (pre 6cfa64de deploy)`):
- **`f3755fde` flow side-button** — finished account3's in-flight work: compact number/duration
  pills opt in via `field.meta.flowToggle` (FieldsTab checkbox; Amount seeded). E2E-verified: the
  popover click that ended the last session works; picking a flow persists `{value, flow}`.
- **`bf616b90` image search everywhere** — audit found 2 gaps: NON-compact media-role fields were
  a raw URL text box (now the same thumbnail + Set-image → ImagePicker as the compact pill), and
  QuickAddMenu had no image path (new "Image" tile → ImagePicker search/upload/URL → new
  `CommitHelpers.addImageArtifactFromUrl` mints a remote-ref `kind:"image"` artifact, no upload
  round-trip; InsertGap threads `url` too). E2E-verified incl. reload persistence.
- **`7904de41` doc-DnD hover lines** — user: "3 hover lines, 2 white dead + 1 blue works; can't
  drag to the right of anything". Root causes: StarterKit's PM Dropcursor per editor instance
  (white, dead — custom handler owns drops) → disabled; DragProvider's inst edge indicators inside
  docs (dead — it bails on `.doc-editor`) → hidden via CSS; and detectSideHost only ran on the
  PAGE editor, whose posAtCoords returns pos 0 over NESTED section-container content → the
  wrap-beside affordance never showed there (drops wrapped via delegation, invisibly). Delegate-only
  nested editors now paint their own indicator lines; the page editor yields via the same zone
  lookup; wrap line and gap line are mutually exclusive. Verified: exactly ONE honest line at every
  position, L/R side flips, 6/6 wrap drops still form.
  **NOT reproduced:** "copies when it should move" — handle drags MOVE+detach correctly in-doc,
  panel→doc, wrap→doc, AND doc→panel (both page-level and nested-container embeds; probes
  `_copymove.mjs`/`_bodydrag.mjs`). The briefly-suspected drag-OUT no-op was a probe artifact
  (stale drop coords). Need a concrete repro from the user if copies persist.
- **`a5e2436a`+`7caec5a8` Tasks Left red until 0** (user directive this session) — root cause was
  SERVER-side: `Field.displayConfig` was a structured sub-schema that silently STRIPPED
  `targetOp`/`startValue`/`columns` on save, so the seeded `"<="` countdown op defaulted to ">="
  and 10/0 read as met (green). displayConfig is now Mixed. Verified live: red at 10/0.
- 1231/1231 client + 237/237 server, build clean, **live grid reseeded** (probe writes swept, seed
  exports current). Probe scripts still at repo root (`_dnddiag/_copymove/_imagetile/_flowprobe…`).

**Wrap width thresholds SHIPPED same session (`2ed6f734`)** — sliver policy replaces the
all-or-nothing fill rule: new pure `decideWrapStack` in docs/wrapAnchor.js (8 tests). Stack only
when the beside band is blank / under ~2 lines / under 35% of the neighbor height (45% to
re-enter), or the prose column is under a readable 160px (was 60 — stacks much sooner when
shrinking). Long text × tall infobox now keeps wrapping at LARGE widths (the old 100%-fill rule
was width-inverted). The rendered guard measures TEXT RECTS in the neighbor band (the old
prose-BOX check missed the fully blank column in the 2026-07-09 screenshots). Thresholds =
`WRAP_SLIVER_*`/`WRAP_MIN_PROSE_W` constants — tune to taste. Queue is EMPTY; all 5 tasks shipped.
**Deployed to prod 2026-07-11** (`6cfa64de`); probe scripts + screenshots are now gitignored
(`/_*.mjs`, `screenshots/`) so `deploy.sh`'s `git add -A` can't sweep them.

---

## Handoff — 2026-07-11 (tracker gating + Set Account Balance shipped; executor log-cap OOM/perf fix)

Finished account2's in-flight work on the 2026-07-11 directives (`e9778bc9` + `9c3e19b5`, master).
**Gating policy shipped:** an item moves trackers/goals only when IN THE SCHEDULE **and** COMPLETE;
an item whose module never binds Completed counts on schedule membership alone. The discriminator is
the module BINDING (new executor `$item._boundFieldIds` enrichment + `ARRAY_NOT_INCLUDES`
comparator), never the stored value — account2's `IS_EMPTY` OR-form counted bound-but-unchecked
items (caught by the behavioral suite). accountRef trackers ALSO scope to Schedule now (toolkit
money items no longer move balances). countTrue/completionRate-done stay strict `IS true`;
`utils/completionGate.js` migrated to the same binding form. **Set Account Balance:** new Financial
Tasks task; its amount is `flow:"replace"` — `makeTrackerOp supportsReplace` (Checking + Mom's)
treats the latest completed in-Schedule replace entry as the balance BASE, with only
same-day-or-later non-replace transactions stacking on top. Verified end-to-end in
`liveOpsBehavioral` (23 tests): reset 500 + same-day ±in/out = 575; replace entries never hit
Spent/Earned. **Executor perf/OOM root-caused:** per-iteration run-log entries (loop_iter +
resolved if-snapshot × ~2500 items × loops × ops × 25 retained runs) OOM'd an 8GB heap and cost
~2-3s/fire — PRE-existing on master (A/B-probed via stash). Loops now log 50 iterations then a
`loop_truncated` marker + mute (FIND candidates stay uncapped per the 2026-05-06 decision).
Measured: onLoad sweep 6.5→1.2s, add-fire ~2.8→0.8s, heap 5GB→1.2GB. 1217/1217 client + 237/237
server, build clean, **live grid reseeded** (seed exports current). **Queued (user, this session):
(a)** image SEARCH in every image-upload spot (image fields / profile pics / dropdown-picker
thumbnails) — Calibre-style one-click; audit which spots miss the existing ImagePickerMenu;
**(b)** the flow side-button on value inputs — green/blue/red = in/replace/out — so ops read the
stored flow (Set Account's UI).

---

## Handoff — 2026-07-07 LATE-3 (occurrence FEEDS shipped — Table:/Canvas: Build ops replaced)

**Feeds are live.** `occurrence.feed = { enabled, conditions, roles, scope, sort, limit }` on any
container or page = a declarative materialized FIND: matching sources (filter-menu conditions +
the owner's effective date cascade) are minted as COPY-LINKED children (`meta.feedSourceId`,
drag-locked to copy), alongside the owner's own children. Engine: `helpers/feedSync.js`
(scan-based self-healing diff, mint/sweep/re-link, accumulated parent ref, fireTrigger:false +
markDerivedOcc echo suppression), scheduled debounced from bindSocketToStore. Trackers exclude
feed copies (`meta.feedSourceId IS_EMPTY` in makeTrackerOp + inline trackers) so feeds can't
double-count. UI: `ui/FeedSection.jsx` in container/page header menus. `Table: Build` +
`Canvas: Build` seed ops DELETED (68 ops now) — Schedule Table (child-occurrence ROWS, new generic
ContainerTable rendering; Goal column dropped) + Schedule Canvas (center-stacked fallback
positions) carry seeded feeds and now INHERIT the date cascade. Verified headless: both pages
materialize today's 6 tasks; reload = zero-write no-op; orphan/dupe self-heals. 12 engine tests;
1212/1212 client + 227/227 server; reseeded. Spec + as-built record:
`docs/superpowers/specs/2026-07-07-occurrence-feed-plan.md` (v1 limits listed there).

---

## Handoff — 2026-07-07 LATE-2 (trackers fixed both orders + notifications overhaul + behavioral test suite + delete-recount fix)

Continuation of the `.claude`-account session (hit its limit mid-edit of createLiveData). All on
`audit-fixes-dnd-wrap-menus`, 4 commits. **Root cause shipped**: tracker ops only had
container-role onAdd/onDelete triggers — instance drops into Schedule slots never re-aggregated.
Every makeTrackerOp now registers the instance-role pair; the `isTask` marker field is REMOVED
(no-hardcoding rule) in favor of the generic `presenceFieldId` (IS_NOT_EMPTY) discriminator
(Pomodoros→pomodoroNumber, Total Workouts→muscleGroup — Workouts was counting water logs).
Verified BOTH orders headless + as tests (complete→drop bumps on the DROP; drop→complete on the
toggle). **Second real bug found & fixed**: deletes never decremented trackers — the delete
snapshot rode `occurrencesOverride` back into executor state (recount still counted the deleted
item). Now the snapshot rides ON the transaction (`_occurrenceSnapshot`, trigger-context only);
override plumbing removed end-to-end.

**Notifications**: op pills carry actual results ("Monthly Bills: Amount→2040.97", "+2 Stretching",
per-item Days Until Due) via `helpers/opResultSummary.js`, shared across all three fire sites
(the drop-move site previously swallowed successes AND failures). Drag toasts name the destination
with page context ("Moved X: Finance & Admin → Schedule › 3:00am (#1)") via a structural
page-ancestor walk; doc-embed drag-outs toast too.

**Behavioral audit is now a test suite** (`client/src/__tests__/liveOpsBehavioral.test.js`, 18
tests): boots the executor on the exported seed (server/seed/*.json), replays the onLoad sweep,
fires real transactions for EVERY input type (boolean/number/duration/select/amount+flow/reps) +
drops/deletes + a multi-day picker selection rebuilding the Schedule (3 day-cols), asserting
tracker VALUES read from each op's own pipeline targets. `datePickerSelection.test.js` locks the
single/range/multi/week/month/year classifier rules. Picker: today-hint is now much lighter than
selection (user ask). Quote artifacts render 13px = doc body. **DnD matrix audit** delivered:
`docs/dnd-matrix-2026-07-07.md`. **Feed plan** (occurrence-menu feed pulling occurrences by
filter-menu conditions) written + soundness-reviewed, NOT implemented — awaiting user review:
`docs/superpowers/specs/2026-07-07-occurrence-feed-plan.md` (3 open questions at the bottom).
1200/1200 client + 227/227 server, build clean, live grid reseeded (probe writes swept).

---

## Handoff — 2026-07-08 (feeds deployed; wrap-beside DnD fixed for cross-doc + wrapped hosts)

Account3's session shipped FEEDS (materialized copy-links, `helpers/feedSync.js`) + behavioral op
tests + notifications, merged to master and deployed. Its last in-flight task (wrap DnD
verification, user directive in CLAUDE_CHAT 2026-07-08) was completed by account2:
**`15883a67 fix(wrap)`** — dropping anything beside a textblock now wraps in ALL cases: cross-doc
MOVEs (was plain-insert-at-top-of-page) and hosts already inside a wrapGroup (new neighbors stack;
schema was already `moduleEmbed{2,}`). Verified headless: 6/6 L/R × top/middle/bottom positions,
persistence across reload, responsive at 4 widths, tablet rotation + rail cell-nav. 1227/1227
client tests. **Deployed to prod + live grid reseeded.** Probe scripts `_wrap6probe.mjs` /
`_wrap1diag.mjs` / `_wrapresp.mjs` / `_tabletrot.mjs` at repo root (token creds expire ~Jul 14).

---

## Handoff — 2026-07-07 LATE (image picker shipped + options-resolver fix + grid sweep)

Continuation of account2's session (hit spend limit mid-verify). **ImagePickerMenu** (Calibre-style
Search/Upload/URL image lookup) shipped and wired into occurrence-dropdown option rows, media-role
field pills, and the artifact image viewer; server proxy routes `/api/images/search` (DDG+Wikipedia)
+ `/api/images/upload` (bare upload). Verification surfaced + fixed two latent optionsResolver bugs
that had EVERY ancestor-scoped occurrence dropdown resolving to zero options (`$record.` prefix not
stripped in `resolveRecordPath`; `_ancestors` never enriched in `buildCollection`). 1162/1162 client
+ 222/222 server tests, build clean, e2e verified headless (Account dropdown → options → Set image →
URL commit). **Live grid reseeded + probe writes surgically removed.** Also per user: stale unnamed
2×3 skeleton grid deleted (again — recurrence of 2026-07-04) and `createLiveData` now auto-sweeps
dead skeleton grids on every default reseed (`sweepStaleGrids`); exactly 2 grids remain (Live Grid +
the 1×1 empty scratch grid). Queued (from account2, user notes mid-session): **goals overhaul —
"full representation of everything tracked/goaled, trackers included; extreme granularity is the
bar"** (task #9 successor).

---

## Handoff — 2026-07-06 (branch `audit-fixes-dnd-wrap-menus`, all 14 plan tasks shipped)

The full 14-task audit-fix plan (`docs/superpowers/plans/2026-07-06-dnd-wrap-menus-audit-fixes.md`)
is implemented and committed on `audit-fixes-dnd-wrap-menus` (not merged to master yet).
1154/1154 client + 222/222 server tests, build clean, **live data reseeded** after the perf probes.

Shipped: InsertGap crash fix (Task 1) · drop-path debug logs gated behind `__dragPerf`/`__dragDiag`
(2) · RadialMenu dead-prop cleanup (3) · ContextMenu 70vh scroll + flexible width (4) · QuickAddMenu
flip-above (5) · importer drops dead `wrap`/`anchor` attrs (6) · **line-level wraps clip/classify the
correct band** via new `wrapAnchor.hasMidAnchor`/`classifyWrapShape` (7) · Editor dragover math
rAF-throttled (8) · member-card scan shared + cached (9) · **dragSystem live-ref payloads — no
JSON.stringify deps, no listener re-registration on occurrence writes** (10, the perf core) ·
MobileGridNav scrollable-ancestor once per gesture (11) · touch pill shows Move/Copy/Copy-link (12) ·
mouse drags on touch-primary devices with a touch-dragstart guard (13 — **needs a real-tablet check**;
revert just that commit if Android long-press still starts a native ghost) · drop→paint re-baselined
(14): median 1742ms → 1378ms @5x throttle; still >600ms, so a **"drop frame-1 flush profiling"
docket entry** is filed in `client/src/CLAUDE.md` (separate session).

**2026-07-06 LATE-3 (`b6a98e14`):** computedValues moved off GridLiveContext to a per-key
`state/computedValuesStore` (all consumers migrated, 1159/1159 tests). A/B drop probe proved the
frame-1 flush is **NOT computedValues-driven** (pre 1750ms / post 1831ms median @5x, identical
render counts) — that hypothesis is closed; component-level profiler attribution is the remaining
frame-1 lever (docket updated). Migration kept for the drain-wave render win. Live grid reseeded.

**2026-07-07:** frame-1 flush ATTRIBUTED (new gated `__RENDER_ATTR` probe) and largely fixed —
drop→paint median **1750ms → 1066ms @5x**, renders 183/156/535 → 54/~10/~2. Three causes:
preview cards re-rendering inside every write's commit (PreviewNode now polls the state snapshot,
500ms deduped), `addInstanceToContainer` identity churn (now stateRef at call time), and
**use-context-selector phantom renders** — GridActionsContext rewritten to a per-provider store +
`useSyncExternalStoreWithSelector` (public API unchanged; 1159/1159 tests; headless field-edit +
drag/drop smoke verified). Docket stays open for the residual (~54 slot-container renders, op
drain). Live grid reseeded after probing.

~~Queued next (CLAUDE_CHAT 2026-07-06): "look into dropping in a doc, and doc container, especially
nested ones. the drop was reloading the entire page"~~ — **DONE 2026-07-06 LATE.** Traced with
`__dragDiag` probes: not a reload, not double-handling — the page editor owned every doc drop and
its nearest top-level boundary hoisted the item to the TOP of the page (source list lost it =
"the page reset"). Fixed: nested doc-container editors register delegate-only drop zones; the page
editor + touch routing hand them drops landing inside (`getDocTouchDropZone`). Verified headless on
desktop + touch; embeds persist in the NESTED container's textmap. See ui/ + helpers/ CLAUDE.md.
Follow-up polish: page-level gap indicator still draws during dragover over a nested container.

---

## Test checklist — 2026-05-20

Re-seed live data first: `node --env-file=.env server/scripts/createLiveData.js`.
Test results last refresh: **37 files / 731 tests passing** (see `test-results.txt`).

### Multi-day Schedule (carryover from earlier this session)
- [ ] Single-day view renders byte-identical to the pre-refactor single-day Schedule
- [ ] Pick a 3-day range in the date picker → 3 day-columns appear, shared slot containers multi-parented into each
- [ ] Pick week / month / year via picker → format flips between `timeslot` (≤7 days, columns side-by-side) and `shortened` (>7 days, wrapped grid)
- [ ] Drag a task into one day's column → task appears only in that day, slot persists
- [ ] Switch back to single-day → no data loss; instances still on their original dates
- [ ] Tracker totals aggregate across the active period (`$activePeriodDates` / `$activePeriodCount`)

### Editor↔field bindings (BoundHeader / BoundBody)
- [ ] Container header bound to a select field with options → dropdown renders inline; pick value → fires write + propagates via link field
- [ ] Textblock body bound to a text field → typing in editor debounce-commits + syncs siblings
- [ ] Link badge in top-right of bound editor shows the bound field name; tooltip reads `Linked: <field name>`
- [ ] Daily Question container in day-page template → click 🎲 dice → random question loads; answer textblock writes back to today's instance

### Multi-select + paste (shipped this session)
- [ ] Shift+click an instance → selection chip overlay highlights it
- [ ] Shift+click more instances → count grows; right-click any selected one shows bulk items at top
- [ ] Choose "Copy N selected" → right-click target container → "Paste N here" mints fresh occurrences with same moduleId → **toast "Pasted N items"** appears for 2s
- [ ] Choose "Move N selected" → right-click target → "Move N here" re-parents (no fresh occurrences; originals move) → **toast "Moved N items"** appears
- [ ] Choose "Copy-link N selected" → right-click target → "Paste linked N here" mints fresh occurrences sharing `linkedGroupId`; toggling a field in one ticks the others → **toast "Linked N items"** appears
- [ ] Paste-here also surfaces on a page right-click (destination is the page occurrence)
- [ ] Self-paste (target = source) is silently skipped
- [ ] **Delete N selected** prompts `confirm(...)` with the count; cancel aborts; confirm deletes

### Canvas connect tool (shipped this session)
- [ ] Open any canvas page → toolbar shows new chain-link icon between Hand and Pen
- [ ] Click connect → cursor switches to crosshair
- [ ] Press on card A, drag a dashed bezier, release on card B → solid bezier persists
- [ ] Reload → connection still there (persisted to `pageOccurrence.meta.edges`)
- [ ] Move either card → bezier follows
- [ ] In connect mode, click on an edge → deletes it
- [ ] **Delete a card connected by an edge** → on the next canvas paint, the orphaned edge is cleaned from `meta.edges` (lazy persist)
- [ ] Switching to any other tool → edges still render but become click-through (no accidental deletion)
- [ ] Drawing tools, drop targets, world pan, mobile toolbar, autoscroll still all work in their respective modes
- [ ] **Undo (Undo button)** undoes both edge additions AND edge deletions (mixed with strokes — most recent action regardless of type)
- [ ] **Redo** replays the undone action

### Multi-select deep-paste (added in review fixups)
- [ ] Shift-select a CONTAINER with children → Copy → paste into another container → new container appears with copies of all its children (not an empty shell)
- [ ] Pasted children preserve fields + iteration mode from source
- [ ] **Copy-link a container with children** → paste into another container → toggling a field in the new linked container's child propagates back to the source's matching child (per-pair linked groups)
- [ ] Move-mode on a container still re-parents the existing container (children come along because they're parented to it)
- [ ] **Shallow paste preserves iterationMode** — copy a persistent leaf instance; the new occurrence is still persistent (not silently demoted to specific)
- [ ] **Canvas edges anchor at card center** even for tall containers — edges land mid-card instead of 30px below the top

### Socket status pill (shipped this session)
- [ ] Throttle Network → Offline in DevTools → red pulsing pill appears right of logo: "Disconnected — retrying (N)" with N incrementing
- [ ] Hover the pill → tooltip explains writes are buffered locally
- [ ] Edit a field / drag a card while offline → no error toasts, no UI freeze
- [ ] Throttle back to Online → green "Reconnected" pill for ~3s → fades to nothing
- [ ] Buffered changes have synced server-side after the pill fades

---

## Handoff — Session 2026-05-20 → Next session

Multi-day Schedule shipped (hybrid architecture: shared slots persist under Schedule, day-col wrappers come/go via multi-parent — zero data loss). New picker (react-multi-date-picker) supports single/range/multi/week/month/year. `$activePeriodDates` + `$activePeriodCount` available in op pipelines. Container-in-container primitive via `module.meta.allowChildContainers`. Test grid byte-identical to before (uses original `makeScheduleBuildDayOp`); live data uses new `makeScheduleBuildScheduleOp`. **Re-seed live data required to test:** `node --env-file=.env scripts/createLiveData.js`.

### Testing feedback fixes (in progress this session)

User tested the multi-day Schedule and reported:
- ✅ Hourly chime disabled (was firing every second — `lastFiredAt` sync race; see `state/useScheduler.js` debug TODO).
- ✅ **Build Schedule perf (d)** — Phase 4 was `LOOP $allContainers` PER day. Refactored to Phase 4a (one-time slot ID collection via PUSH_TO_VAR) + Phase 4b (per-day ADD_CHILD from precomputed list). Cuts from O(days × containers) to O(containers + days × slots).
- ✅ **(a) Multi-day rendering polish** — `client/src/modules/pages/PageBoard.jsx` now detects `meta.scheduleDayColumn` children and (1) hides `meta.scheduleSlot` / `meta.scheduleDueContainer` from page-level render (they're multi-parented into day-cols), (2) switches to horizontal `flex-direction: row` with 280-360px min/max width per column when ≥2 day-cols exist. Single day-col still renders vertically (looks like the original single-day Schedule).
- 🟡 **(b) Goals restructure — Stage 1 done, Stage 2 pending.**
  - **Stage 1 (done):** `makeTrackerOp` in `server/utils/liveSystemBuilders.js` accepts a new `goalOccurrenceId` param. When provided, the goal-lookup step replaces FIND-by-label with `INIT_VAR $goalId = literal:<id>` + `FIND $allItems where id IS $goalId → $goalItem`. Back-compat: legacy `goalLabel`-only callers still work (test grid + currently-unique-label goals in createLiveData).
  - **Stage 2 (pending — user direction needed):** User said "i dont like label compare", "use the category picker to pick a specific occurrence", "i just dont want to write out the id in the operation", "we have grab direct ref" — the seed should use whatever the UI's CategoryPathPicker outputs for an occurrence pick, NOT a literal id baked into the op. CategoryPathPicker outputs are dotted paths like `$<var>.<path>` resolved via `resolveExpr`. For occurrences, no id-indexed map exists in the executor today — there's `$allItems` (array), `$allInstances`, etc. but no `$allItemsById`. Two paths forward:
    - (a) **Add `$allItemsById` to executor** — plain object `{ [id]: item }` exposed in $vars. Reference syntax `$allItemsById.<id>`. Picker emits that path. Tracker's $goalItem = `$allItemsById.<id>` via INIT_VAR with expr. Note: UUIDs contain `-` which probably trips dot-notation path resolver — may need `["<id>"]` bracket-notation support or use a hash-friendly id format.
    - (b) **Deterministic IDs** for seed-stable occurrences (goal items, schedule slots) — generate via hash of stable key like `goalOcc("physical-water")` instead of random `uid()`. Op embeds the deterministic id as literal; survives re-seed because same key → same id. More invasive but eliminates the resolver question.
  - Recommendation: (a) is the smaller change. Implement `$allItemsById` in `operationExecutor.js:1172` area, verify path resolver handles UUIDs (probably needs bracket notation: `$allItemsById["abc-123-def"]`). Then Stage 3: actually split the multi-field goalInstances entries + update tracker call sites in createLiveData.
  - **Why deferred this session:** This needs careful integration with the picker UI's existing output format. Picking the wrong reference shape means an executor change AND a picker change later. Best done in a focused session that touches `CategoryPathPicker.jsx`, `operationExecutor.js`, `liveSystemBuilders.js`, and `createLiveData.js` together.
- ⏳ **(c) Picker redesign** — user wants calendar-style with zoom drilldown (month grid → year grid). Current `react-multi-date-picker` UX doesn't match. See memory `project-pending-features` for options.

Other already-queued items below (folder-page defaults, Pomodoro, GET_USER_INPUT, multi-select, mindmap) remain valid.

### Next steps (in order)

1. **User re-seeds + verifies multi-day Schedule end-to-end** — open Schedule, try single-day (should look exactly like before), then pick a 3-day range / week. Day-cols should appear; instances persist across view changes; trackers aggregate over the period.
2. **D1(a) op rename** — strip "Tracker:" prefix from local createLiveData ops (now redundant with `opCategoryIds.trackers` folder). About 27 ops. Update `waterTrackerName` + `completedTrackerName` params passed to `makeScheduleBuildScheduleOp`. Test grid untouched.
3. **Folder-page defaults for Daily Toolkit + Center Hub panels** — see memory `project-pending-features`. Set the panels' default view to a folder-page (card grid of child pages) instead of a single tab. ~30 lines per panel in createLiveData.
4. **Pomodoro → Schedule** — see memory `project-pending-features`. Pomodoro template instance in Daily Toolkit, Pomodoro goal (3/day), trackers (current pomo + time + history), 3 ops (Start / Complete / Stop) firing from PomodoroTimer.jsx.
5. **Month view page** — see memory `project-pending-features`. Separate page kind with 30 day-containers, no slots. Own `Build Month` op constrained to month-unit filter. Bidirectional with Schedule (drag-into-month creates task w/ null timeslot, picks slot later via select).
6. **GET_USER_INPUT op action** — see memory `project-pending-features`. General-purpose action that opens a modal asking the user for input; chained THENs ask follow-up questions; each step's result lands in `$vars` for downstream steps.
7. **Multi-select system** — see memory `project-multiselect-plan`. Shift+click, shift+arrow tree-walking, rubber-band drag, ContextMenu with copy/move/edit/copylink, paste-here on empty space, radial menu mode icon. Multi-session implementation.
8. ~~**Canvas mindmap (React Flow)**~~ — **DONE 2026-05-20** as a tool added to the existing canvas (not a new page kind, no React Flow). New `connect` tool in `CanvasContent.jsx` lets the user drag from one card to another to draw a bezier edge. Edges persist on `containerOccurrence.meta.edges = [{ id, from, to }]`. SVG overlay sized to the world (4000×4000); clicking an edge in connect mode deletes it. Plays clean with every existing canvas feature (drawing tools, drop targets, world pan, autoscroll, mobile toolbar, filters). `@xyflow/react` removed from package.json. See memory `project-canvas-mindmap-plan` (now slightly out of date — edges live on the page occurrence the same way, but no separate kind exists).
9. ~~**Socket connection status indicator in grid header**~~ — **DONE 2026-05-20**. `hooks/useSocketStatus.js` subscribes to `connect` / `disconnect` / `connect_error` / `reconnect_attempt` and returns `{ status: "connected" | "disconnected" | "recovered", attempts }`. `ui/SocketStatusBanner.jsx` renders an inline pill in the toolbar (right of the logo) — red w/ pulsing dot + "Disconnected — retrying (N)" while down, green + "Reconnected" briefly when restored, nothing when normal. Tooltip on the red pill spells out that writes are buffered (offline queue already handles the buffering — this is just visibility). Pulse keyframe `socket-status-pulse` added to `index.css`. Tied through socket lifecycle events; queue replay continues to happen elsewhere (App.jsx-level on full_state).
9.5. **Offline-queue-aware "Reconnected" fade** — the green pill currently fades after a fixed 3s regardless of whether buffered writes have been server-acknowledged. `flushOfflineQueue` empties the local queue synchronously on reconnect, but the server-roundtrip ack is unknown. Tighten by: (a) capturing pre-flush queue length, (b) listening for the next N entity-updated events from the server, (c) holding the pill until those land or a 10s upper cap fires. Cosmetic — the existing 3s works for typical session lengths.

10. **Assistant LLM chatbox (last item)** — design + spec out an in-app assistant that can perform real actions through a conversational chatbox: create operations (full pipeline w/ trigger + steps), create occurrences/modules/containers/pages, attach fields, navigate filters, save templates, run ops on demand, explain why an op didn't fire, etc. **Read `docs/aispecs.md` first** — the user has a written-out spec there covering the offline LLM stack (Ollama + qwen2.5-coder / deepseek-coder), tool router pattern, sandboxed command executor, OCR layer, and a "frog Jeeves" persona. The plan should incorporate (or supersede) that doc, not duplicate it. The API layer should be a first-class part of the plan — likely a thin Express/route layer on the server that the local LLM (or a hosted Anthropic SDK fallback) calls through, with each tool mapping to a CommitHelpers function or operation-action effect (CREATE, UPDATE, APPLY_TEMPLATE, RUN_OPERATION, etc.). Probably a side-drawer or floating panel that wraps the tool-use loop. Will need: (a) a curated tool catalog with JSON schemas mirroring our pipeline action shapes, (b) state snapshotting so the LLM sees the current grid/modules/fields/operations, (c) confirmation UX before destructive actions, (d) prompt caching against the static system prompt + tool catalog. This is the BIG ticket — full plan to be drafted at the end of the queue.

---

## Older handoffs

Sessions earlier than the past week are archived in [`docs/handoffs/`](./docs/handoffs/):

- [`2026-05-11.md`](./docs/handoffs/2026-05-11.md) — drag-and-drop punch-list
- [`2026-05-11-late.md`](./docs/handoffs/2026-05-11-late.md) — textblock/canvas thread + carryover (all resolved 2026-05-12)

Consult the archive only if the active sections above don't cover something. New session work should treat the latest dated handoff as authoritative — older direction is superseded.

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


