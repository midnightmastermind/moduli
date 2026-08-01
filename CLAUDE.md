# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---

### 2026-08-01 (4) — the stuck highlight was a STALE `:hover`, not a state leak

The user's log settled it: **zero `[gap] OPEN` lines** — no menu ever opened — plus "if i go back
over the highlight, it disappears again". So it was never the forced-open state fixed on 07-31.

**A browser only re-computes `:hover` when the POINTER MOVES.** Moduli reflows constantly under a
stationary pointer — the on-load op drain in the user's own log is 580ms / 124 effects — so a gap
that was hovered keeps `:hover` after the layout shifts out from under the cursor, and stays lit
until the user moves back over it and away. That is exactly the reported behaviour, and nothing in
CSS can correct it: `:hover` is the browser's to own.

**Fix — hover is JS-owned now** (`helpers/gapHover.js`, NEW). `.insert-gap--hot` drives the reveal
instead of `:hover`; a gap claims hover on pointerenter, and one shared document listener re-tests
the pointer against the claimant's CURRENT rect on pointermove, on scroll, and on any
ResizeObserver hit — the layout-change case `:hover` cannot see. A 1s sweep also strips `--hot`
from anything left orphaned by an unmount.

**Reproduced, finally** — hover a gap (1 lit) → force a reflow with the pointer STATIONARY → 0 lit.
Before the fix that middle step stayed lit. That reproduction is the thing three earlier rounds
lacked; the earlier probes all moved the mouse, which is precisely what hides this bug.

**Lesson worth keeping: the absence of a log line was the evidence.** No OPEN lines meant the whole
forced-open theory was wrong, which is what pointed at `:hover`. Instrument the thing you believe,
then believe the silence.

---

### 2026-08-01 (3) — the question header: #### and actually sized; gap logs made visible

- **The inner question container carried NO headingLevel**, so it fell to the level-1 default and
  printed a single `#` four levels deep. It is `####` now (`0030` + the builder): column `#` ›
  Journal `##` › Daily Question `###` › the question `####`.
- **"It doesn't even look like a heading" was a `<select>` quirk** — a select does NOT inherit
  font, so the bound header rendered at the UA's 11px regardless of the level it declared.
  `font: inherit` on `.bound-header-select > select` makes the declared level apply. Measured
  after: hash `####`, question 11px / weight 500 against the 9px "Answer", so the question reads
  above its answer as asked. (The 11 vs the level's 12 is an intermediate wrapper's size — visible
  hierarchy is right, the 1px is not worth another round.)
- **The `[gap]` logging printed NOTHING in a quiet session** and read as broken (user: "i didnt see
  logs for the gap"): it only spoke on open/close. It now announces itself on load and watches on a
  3s timer, reporting ONLY when something is actually stuck — a stuck line can appear without a
  close ever firing, which is exactly the case being hunted.

**OPEN — today's day column did not build.** User: "daypage didnt open for today (once) like
schedule." The board still shows Jul 30-31 on Aug 1. NOT investigated yet. First place to look:
the board's own `filterOverride` is pinned to a MULTI-day selection (Jul 30-31), and
`Grid: Snap Filter To Today` moves date-carrying pages forward on a new day — check whether it
skips multi-day shapes, since a multi selection is exactly "a date the user navigated to", which
that op deliberately preserves. Verify against the live filterOverride before changing the op.

---

### 2026-08-01 (2) — wider columns, weekday names, a readable heading step, question marquee

- **Column width is a cascade rule now** (`childMinWidth`/`childMaxWidth`, `0028`) instead of
  PageBoard's hardcoded 280/360. That matters because the SCHEDULE uses the same flex-row renderer
  — bumping the constant would have widened it too. Day Page is 420-560; the default is unchanged
  for everything else, and the width is settable from the page's Layout menu.
- **`##` vs `###` were 15px and 14px** — indistinguishable, so a nested section looked identical to
  its parent (user: "looks like the same size despite diff headings"). Every level now drops at
  least 2px AND loses weight: `{1:18/700, 2:15/650, 3:13/550, 4:12/500 …}`.
- **The Daily Question header marquees** (`meta.labelOverflow: "marquee"`). Bound headers truncate
  by DEFAULT on purpose (2026-07-31, "a control is not prose") — but the question IS prose, reading
  it is the whole point, and it rarely fits a column. Set per-module as data, so the default stands
  for every other bound header.
- **Columns are named "Friday, July 31st, 2026"** (`0029`) via the `dateLong:` token — the same one
  the Schedule's day-columns already use, so both surfaces name a day identically. Renamed by DATE
  rather than by parsing the old label, and a column the user has since renamed by hand is left
  alone.
- Verified live: 560px columns, weekday names, Journal 15/650 holding Daily Question 13/550,
  marquee present, zero page errors.

---

### 2026-08-01 — `[gap]` diagnostics for the stuck insert lines; Daily Question nests under Journal

**Diagnostics (`helpers/insertGapDiag.js`, NEW).** The stuck blue insert lines still happen "a
bit" after the unmount-close fix, so this instruments the three ways it can happen instead of
guessing a fourth time. ON by default (`window.__gapDiag = false` mutes), same posture as
`caretDiag` — a user-facing bug needs zero setup to capture.
- `[gap] OPEN <container>#<index>` / `[gap] CLOSE … via transition|UNMOUNT-while-open` with how
  long it was held, so a stuck line shows as an OPEN with no matching CLOSE.
- `[gap] SWEEP` runs 900ms after every close, and `window.__gapStuck()` runs it on demand. **The
  sweep is what separates the causes**, because it reports each stuck element with BOTH facts:
  `hostThinksOpen` (React still believes the menu is open → a state leak) vs a forced-open class
  with no host claim (→ the class outlived the state) vs a line lit with NO class at all (→ a
  `:hover` that never released). The answer is in the log line, not in a follow-up round trip.
- Ask for the `[gap]` lines plus one `__gapStuck()` at the moment a line is stuck.

**Daily Question now lives INSIDE Journal** (`0027` + the builder), at `###` — it sits in a `##`,
so it is a level deeper. The load-bearing part is `allowChildContainers` on Journal, set BEFORE
anything is re-parented: a container renders child CONTAINERS only with that flag, and moving the
question in without it would have made it vanish while sitting perfectly well in the data — the
exact failure that read as "you got rid of my trackers" on 2026-07-31. Verified live: Journal `##`
15px holding Daily Question `###` 14px, nothing left at column top level.

---

### 2026-07-31 (8) — the frozen quick-add lines: a menu that UNMOUNTS while open never reports its close

User, with a screenshot showing five blue insert lines pinned at once: "do you see all the frozen
highlight quick add buttons. they get stuck".

**`QuickAddMenu.onOpenChange` fired on open/close TRANSITIONS ONLY — which the transition effect
can only observe WHILE MOUNTED.** Unmount an open menu and the host never hears the close.
`InsertGap` holds `insert-gap--open` for exactly as long as it believes the menu is open, and that
class FORCES the blue line visible (it exists so the gap can't collapse out from under an open
menu). So every menu that got unmounted while open pinned its line permanently — and a doc/board
list re-render is enough to unmount one, which is why they ACCUMULATE over a session and why
hovering never reproduces it. The menu now reports `false` from its unmount cleanup.

**Method note, worth keeping:** the `:hover` reveal was ruled OUT by probe first (hover five gaps,
move away → zero lines visible), and the culprit was then identified from the screenshot's
GEOMETRY — the bars are ~50% container width, centered, which is the `.insert-gap-line` strip
(2026-07-24) and not a drag indicator or a doc gap. Measuring what it ISN'T is what made the
remaining explanation findable without a repro.

**Honest limit:** I never reproduced the original stuck state end to end — I found and closed a
leak that produces exactly that symptom. If lines still stick, the next thing to check is whether
`InsertGap`'s host is remounting for another reason, not the menu contract.

---

### 2026-07-31 (7) — day columns: content height, bare date names, horizontal scroll

- **Full content height** (`0026`): the 420px `childMaxHeight` is cleared, so a column is as tall as
  its day. That cap was my remedy for a hover-expansion shove; the user would rather see the whole
  day on load, and the Layout menu can put a cap back if it ever bites. Verified: wrap 667 ≥ shell
  663, nothing clipped.
- **Names lose the "Day Page - " prefix** — the BOARD is already called Day Page, so every column
  repeated it. Renamed the existing columns AND patched `rootLabel` in the stored Build op (and the
  builder): without the op change the prefix returns on the next new day. Columns now read
  "2026-07-30" / "2026-07-31".
- **Horizontal scroll needed no code** — `mode:"flex-row"` already gives the board a
  `width:max-content` row inside an `overflow-x:auto` scroller, so picking a week in the filter
  widens the board instead of squashing the columns. Measured: scrollWidth 742 > clientWidth 542.
  The migration ASSERTS the board is still flex-row and throws otherwise, so a regression surfaces
  as a failed migration rather than a squashed page.

---

### 2026-07-31 (6) — the day-column header was overflowing its own row

From the screenshot: headers unpadded, text too big, columns not lining up. All ONE cause, found by
measuring rather than eyeballing — **the header row is locked to `height: 20px`, but the 22px
heading label rendered 35px tall STARTING 9px ABOVE the row**. It overflowed its own header, which
is why the text read as unpadded, why the rows looked cramped, and why the two columns didn't
align (the overflow interacts with the marquee, so each column settled differently).

- A container with `meta.headingLevel` no longer takes the fixed-height branch: it sizes to its
  text with real padding on all four sides (`6px 10px`), and the label drops the `-1px` nudge that
  exists only for the small fixed-height headers.
- `HEADING_SIZES[1]` 22 → **18** (bold, as asked); level 2 → 15 so the step is still legible.
- Nested/embedded section header top padding 6 → **3px**.
- Day column `childMaxHeight` 600 → **420**.
- Verified on prod: both columns identical (wrap y=87, header y=92 h=36, body y=128), label now
  INSIDE its header (y=98 h=23, was y=83 h=35), 18px/700, padding `6px 10px`.
- **Still open, unasked:** at 18px the title still overflows a 360px column, so it marquees
  continuously. Truncating would read calmer — say the word.

---

### 2026-07-31 (5) — the layout MENU wrote a key the renderer never read

User: "do a full sweep on the layout view menu and make sure thats hooked up so i can change the
boards layout."

**Two independent breaks, both silent.**
1. **Nothing to change.** `LayoutCascadeEditor` exposed only the six VIEW-MODE rules. The layout
   shape PageBoard actually consumes — `mode` / `columns` / `childGap` / `sortChildrenByField` —
   had NO control at all. The Schedule is side-by-side only because Build Schedule stamps
   `mode:"flex-row"` from an op. Editor now has Arrangement (Stack/Columns/Grid), grid columns,
   gap, max height, order-by.
2. **The write went to the wrong key.** For a page/container the menu writes `meta.layoutCascade`
   (the push-DOWN slot), but a page rendering ITSELF resolves as the LEAF — and the leaf layer
   only ever read `meta.layoutCascadeOverride`. So a layout set from the header menu was stored
   somewhere its own renderer never looked.
   **Fix: `SURFACE_SHAPE_KEYS` + `pickSurfaceShape`** — shape keys describe how a surface arranges
   its OWN children, so they apply to the surface that declares them. View-mode keys deliberately
   still push down only: a container saying "my children render as chips" must not become a chip.
   That distinction is the whole fix; 8 tests pin both halves.

- **Day page is side by side** (`0025`): `flex-row`, ordered by the date field, `childMaxHeight:
  600` so a column scrolls inside itself. Written to the SAME slot the menu writes, so changing it
  in-app replaces this instead of fighting an op. Verified on prod: same y, distinct x, 360px each,
  chronological.
- **`#` now reads as `#`.** The STANDARD container header ignored `meta.headingLevel` entirely and
  rendered a fixed ~15px, while an EMBEDDED `##` section renders 16 — so a day COLUMN was
  SMALLER than the sections nested inside it. Standard headers size by heading level now, and
  `HEADING_SIZES[1]` 18 → 22 so the gap between `#` and `##` is the widest in the scale.
  Container labels also got the 2px of air above them that was asked for.
- **OPEN — the sticky hover button.** Measured, not fixed: hovering inside the Daily Question grows
  that box ~76px (an empty add-pocket at y=623 jumps to 699 and back), and that reflow is what
  makes the hover target slip. The height cap bounds the damage; WHICH element grows is still
  unidentified. Don't guess at it — reproduce with the hover probe and find the growing node first.

---

### 2026-07-31 (4) — the signature invariant is now a GATE, and it caught a second armed bug immediately

`gridIntegrity` gained two rules so the 07-31 (3) duplication class cannot go silent again:
- **`unsigned-template-node` (error)** — any occurrence inside a TEMPLATE subtree with no
  `identitySignature`. Template roots are found from `meta.appliedFromTemplateId` on clones plus
  modules carrying `meta.templateModule`. The ROOT is exempt (it is matched by the apply target).
- **`duplicate-template-section` (error)** — the damage rule: a template-applied page holding the
  same section container twice, ignoring anything multi-parented in (its `parentId` points
  elsewhere), so the Schedule's Todo is never counted or "deduped".

**Deliberately NOT checked: the clones' own children.** Merge only ever duplicates TEMPLATE nodes;
a column's other children are whatever the user typed, which has no template counterpart and is
rightly unsigned. A blanket clone-side rule would have flagged every journal entry — the check
would have been noise on day one. Scope came from asking what merge actually matches on.

**It found a second armed duplicate-bomb the moment it ran.** `buildProjectTemplate` wrote each
kanban column's `identitySignature` into the **MODULE's `meta`** — but `identitySignature` is a
TOP-LEVEL field on the OCCURRENCE (schema, 2026-05-14). So those signatures had never done
anything, and re-applying the Project template would have cloned all six columns exactly the way
the Day Page cloned its sections. It just had not gone off yet, because projects are created
rarely. Builder fixed (columns + the Kanban container + the scope textblock), migration `0024`
signs the template on the frozen grid.

- **The seed is the enforcement point**: it already fails on a structurally invalid grid, so this
  is a gate, not a report. Proven by RESEEDING test grid 2 (the seed's own target) and getting a
  clean run — that is what shows the builder fix is right, not reading the diff.
- **`test grid 1` still reports 12 unsigned nodes and is left alone on purpose** — it is the frozen
  ARCHIVE of the old live grid, holding the pre-fix shape. Migrations target `poms grid`; mutating
  an archive to quiet a checker would be the wrong trade.
- Probe debris swept again (6 dangling refs on Schedule Table + Schedule Canvas, all
  `<epoch-ms>-<rand>` client-minted ids from this session's loads — the documented feedSync source).
  poms grid + test grid 2: **0 errors**. 347 server tests (9 new).

---

### 2026-07-31 (3) — the day page duplicated because merge matches on a SIGNATURE, and children need one too

User: "the daypage for yesterday added all the sections twice" — and today's Daily Question had
quietly collected **23** empty question wrappers, one per app load.

**`APPLY_TEMPLATE mode:"merge"` decides "this already exists" by `identitySignature`, and it
RECURSES into whatever it matched.** Two separate gaps, both fixed:
- **Sections** (`0022`): migration `0018` converted the old per-day PAGES into columns and kept
  their sections as they were — with NO signature. Every merge since looked for `daypage:Journal`,
  found nothing, and cloned a second Journal beside the user's. Signing the existing sections is
  the actual fix; deleting the clones is cleanup. 07-28 was unsigned too and would have duplicated
  on its next build.
- **The section's CHILDREN** (`0023` + the builder): signing the section only stops the SECTION
  being re-cloned. Merge then walks inside it, finds the question container unsigned, and clones
  that — every single load. The template now signs `daypage:Daily Question/question` and
  `/answer`. **Signing a node without signing its subtree just moves the duplication one level
  down.**
- **Repair safety, both migrations:** the keeper is whichever copy holds writing, and anything
  containing text is NEVER deleted (it logs and keeps both instead) — a duplicate section is a
  nuisance, a deleted journal entry is not. Todo is skipped entirely: it is the Schedule's own
  container multi-parented in, so its `parentId` points elsewhere, which is the discriminator used.
- **Verified by REPEATING the trigger, not by reading the code**: two full app loads (each runs the
  build op) left every column at exactly one of each section and one wrapper. That is the only
  proof that matters for an idempotency bug.

**Artifact occurrences look like objects again** (user: "it needs to look like a draggable thing.
right now it just blends with the background"). The 2026-06-11 rule stripped the row's card chrome
so the picture alone was the visual box; with the frame gone the occurrence dissolved into the
surface. The row keeps normal instance chrome now, and `.instance-content:has(.artifact-card)`
top-anchors the drag handle (a row with no field pills was being centred by the single-line rule —
an artifact row is never a single line).

---

### 2026-07-31 (2) — "you got rid of my trackers" was a RENDER flag, not deleted data

**Nothing was deleted.** The user reported Workout Log and other trackers gone; the DB had every
one of them (Workout Log, Reps, the six Volume tiles, Meal Log, Meal Nutrition) correctly parented.
**A container only renders child CONTAINERS when its module carries `meta.allowChildContainers`** —
and when the tracker tiles were nested (Workout+Nutrition→Physical, Media→Intellectual,
Planning→Occupational), the re-parenting landed but the flag didn't. So the nested groups and every
tile inside them dropped off the page while the data sat untouched. The Routines dimensions carry
the flag, which is why the identical nesting works there. Migration `0021` sets it on any Trackers
container that HOLDS a container (structural, so it can't drift as more groups get nested).
**The lesson is the one this file already records, from the other direction: the DOM is ground
truth. A tree that reads correctly in Mongo can still render nothing.**

- **Day-page heading levels + colours** (`0020` + `0021`): the day COLUMN is `#` (it holds the
  date), every section is `##`, and the heading TEXTBLOCK that repeated the column's own title is
  deleted — verified to hold only the date string before removing any. Sections take the nine-
  dimension vintage palette (Todo rust · Daily Question plum · Journal teal · Notes avocado ·
  Tasks Completed green · Highlights mustard). The renderer prints one hash per `meta.headingLevel`,
  so no code learns which containers these are.
- **TWO migration selectors were wrong and the DRY RUN caught both** — worth repeating because both
  markers look authoritative and neither is: `meta.appliedFromTemplateId` sits on every Schedule
  ROUTINE CLONE too (the first dry run was about to make 30 workout instances heading level 1), and
  `meta.templateName` is COPIED onto every clone by APPLY_TEMPLATE (so it resolved to a day column,
  not the template). **The template is the one whose MODULE still has `meta.templateModule: true`** —
  apply_template strips that from what it mints. Resolve day columns as the board's children.
- **`$set: { "ownStyle.bg": … }` throws when `ownStyle` is null** ("Cannot create field 'bg' in
  element {ownStyle: null}") — write the whole object.
- **Instance rows: the inline-style trap, for the FOURTH recorded time.** "The people's names still
  aren't aligned at the top" after a CSS fix that looked right — the label group's
  `alignItems: "center"` is an INLINE style in `ModuleInstance.jsx`, which beats any stylesheet rule
  regardless of specificity. Fixed at the source (`hasInlineThumb`), not with `!important`.
  **When a rule silently does nothing, check for an inline style before anything else.**
- **Artifact cards: filename UNDER the image** (user reversed the earlier "above"). The info block
  already had `order: 1`; the name just had to stop being hidden, and the row label above it is
  suppressed so the name reads once. That then exposed a second rule — `.instance-body:has(
  .artifact-card){flex:unset}` sizes the body to content, and `.instance-content` is
  `space-between`, so the card was shoved to the right edge leaving the gutter the caption used to
  fill. `--with-info` cards now take the row width (same specificity, so it must stay AFTER that
  rule in source order).
- 1462 client + 338 server tests, deployed, all four verified on prod with measurements AND
  screenshots (label delta 0px from the image top, filename below the image, nested trackers
  rendering, six distinct section colours).

---

### 2026-07-31 — the day page is DAY COLUMNS, template-driven; Tasks Completed is a board

**The day page works like the Schedule now** (user: "make daypage work like the schedule. with
containers being the days. these would be doccontainers with other containers inside of it").
Migration `0018`, applied to poms grid, deployed, verified live.

```
Day Page  (board page — pinned ONCE)
  └─ Day Page - 2026-07-31    day COLUMN, kind:doc, carries the Date field
       ├─ Daily Question → the question → Daily Answer
       ├─ Todo                the Schedule day-col's OWN container, multi-parented
       ├─ Journal / Notes / Tasks Completed / Highlights
```
- **This retires the ADD_CHILD pinning bug by construction** — there is no per-day page to pin, so
  the hub keeps one tab instead of gaining one every morning (it had three plus a junk
  `[object Object]` module by day three; the module is deleted).
- **It answers filters like the Schedule**: the column carries the Date field and the op targets
  the BOARD page, so an on-page date switch (which never touches the grid filter) builds and shows
  the days you are looking at. Verified live: only today's column renders under `Fri, Jul 31`.
- **TEMPLATE-DRIVEN, both directions** (user: "id also like to change the template on the fly so it
  updates" / "add to it and save the template so i can save my daily routine"):
  the column body is rebuilt from the column's OWN children (the op no longer owns a hardcoded
  section list — that is why a section added to the template used to be cloned but never rendered);
  every template section carries an `identitySignature`, so `mode:"merge"` tops up days that ALREADY
  exist with sections the template has gained and leaves what the user wrote alone; and each column
  is stamped `appliedFromTemplateId`, which is what lights up **"Save over Day Page"** in the header
  dropdown.
- **Where the templates live** (asked directly): `Schedule Template` is a real `page/board` at
  **Library › Templates**; `Day Page` (`ktMxTVErceWq`) is in the separate **Templates manifest**,
  reachable from Command Center → Templates. Both are ordinary modules + occurrences.

**`Tasks Completed` is a BOARD like Todo** (user: "it says click to edit instead of add new item") —
its tasks are CHILDREN now, not moduleEmbeds painted into a doc body. That needed a new pipeline
verb: **`REMOVE_CHILD`**, the exact inverse of ADD_CHILD. It matters because these children are the
SCHEDULE's own occurrences multi-parented in — tidying the list with `REMOVE_OCCURRENCE` would
delete the user's task out of their Schedule. The sweep's keep-test is the add predicate verbatim
with the unlink on its ELSE, so the two cannot drift.

**Also fixed:** habits (Sleep) no longer fill Tasks Completed (module-BINDING discriminator, `0013`);
Sleep's Duration binding was BACK after `0007` and is unbound again — found structurally (the Sleep
module carrying the Habit marker; there are two "Sleep" modules and the other legitimately binds
Sleep Time); **Daily Question resolved zero options because the FIELD WAS TYPE `text`** —
`resolveOptions` returns nothing for any type but select/occurrence on its FIRST line, so the
117-question pool never had a chance (everything the previous session ruled out was genuinely fine);
the question is a section wrapping a bound question container so it renders ONCE; a bound header
truncates instead of marqueeing (a control is not prose); Examples' three dead sample links
repointed after checking each for a 200 (`0014`); image cards stack with the caption under them.

**Two traps worth keeping:**
- **Replacing a function by SPAN swallows its neighbours.** Rewriting `makeDayPageBuildOp` by
  index-slicing the file also deleted `makeProjectCreateOp` + `makeProjectStatusRouterOp`; the seed
  caught it on import. Restored verbatim, then *diffed the exported function and const lists against
  HEAD* to prove nothing else went. Do that diff after any span surgery.
- **A migration that asks "who links X?" will match the thing that OWNS X.** The unpin step matched
  the board itself (it lists day pages — they are its columns), stripped its columns and made it its
  own child. Caught by reading the board's children back after applying. Always read the result back.

---

### 2026-07-30 (8) — the day page CRASHED the app: a LOOP iterated the whole grid

User: "the daypage is crashing the app." Not an exception — a **dead renderer**. Today's
`Tasks Completed` container held a `moduleEmbed` for **every one of the grid's 1280 occurrences**,
the day page that contains it included, so painting the page was unbounded work and Chromium killed
the tab. That page is the hub panel's ACTIVE tab, so the whole app died on load (the probe saw
`page.on("crash")` with zero `pageerror` lines — a crash, not a throw).

**Two executor gaps in the LOOP step, both fixed (`operationExecutor.js:2083`):**
- **`over: "$allInstances"` iterated everything.** That is FIND's spelling for a collection and the
  Tasks Completed builder used it on a LOOP; LOOP only resolved `overExpr`, so the step fell through
  every `gatherLoopItems` branch to its `let occs = Object.values(occurrencesById)` default. A
  `$`-led `over` now resolves as an expression — a legacy typed collection is a bare word
  (`field_occurrences`, `occurrences`, `templates`), so the two spellings cannot collide.
- **`predicate` on a loop step was ignored outright** — the three rules narrowing the pool to
  today's completed tasks never ran. It now filters via `evalGroupAgainstRecord`, exactly as FIND's
  predicate does (rule lefts are RECORD paths, not `$var` expressions).
Either gap alone yields garbage; together they wrote the whole grid into a document. 2 tests.

**This is the SECOND time this class has bitten** (see 2026-07-30 (7): "a LOOP whose `over` is a
nested var path silently iterates EVERYTHING"). Same silent default, different spelling. The
executor now handles both — but the standing rule stands: **a LOOP's `over` is not FIND's `over`;
check what the step actually iterated before trusting a pipeline that "looks right."**

**Migration `0012`** empties any Tasks Completed body embedding something other than a task
occurrence (the honest test — a real busy day has many embeds; ONE embed of the page itself is
enough to hang the tab). Applied to poms grid (679/1280 embeds bad) and test grid 1 (864/864).
**Order matters: deploy, THEN migrate** — a tab on the old bundle re-poisons the container on its
next load; pm2 restarted after the write so the warm cache re-reads it.
1451 client + 329 server tests, all three grids 0 errors, deployed (`aff4142e`), prod-verified: 5
panels render, day page paints heading · Daily Question · Todo · Journal · Notes · Tasks Completed
(11 real entries, all instances) · Highlights. **Items 2 and 3 below are still open.**

---

### 2026-07-30 (7) — the day page builds daily + journal/notes/todo sections. THREE ITEMS STILL OPEN

User: "make sure the daypage is working on poms grid … add in writing sections in the necessary
spots. like a journal todolist notetaking daypage." Spec:
`docs/superpowers/specs/2026-07-30-day-page-design.md`. Migration `0011`, applied to poms grid.
Page order: `# Day Page - <date>` · Daily Question · **Todo** · Journal · Notes · Tasks Completed ·
Highlights. 1449 client + 329 server tests, all three grids 0 errors, deployed.

**START HERE — three things are OPEN, in priority order:**
1. **`ADD_CHILD` does not pin the new day page to the hub panel.** The page IS minted and complete
   in the DB, but never joins the hub's tab strip — so the user correctly reported "that was the
   only day page created" while I kept reporting success from DB queries. Repaired 07-30 by hand
   (`$push` into `rkN14S6dVkeG.occurrences`); **it will recur tomorrow.** The `ADD_CHILD
   parentId=<hub> childId=$newDayPageId` sits in the mint branch — suspect `$newDayPageId`
   (`APPLY_TEMPLATE`'s `rootIdVar`) comes back empty and ADD_CHILD silently no-ops. Verify the
   binding.
2. **Daily Question header shows "(no options — check pool predicate)".** RULED OUT already, do not
   re-check: the field IS `inputEnabled`; `meta._resolvedOptions` is undefined (so BoundHeader:56's
   early return is NOT short-circuiting); BoundHeader passes a correct ctx; `$allInstances` is a
   valid COLLECTION_KEY; `conjunction:"AND"` is harmless (operator defaults to AND);
   `buildCollection` DOES merge the module label — which matters, because the 117 question
   occurrences carry `label: null` and the text lives on the MODULE. Config and call site both look
   right and it still resolves empty. **Stop reading the code — run `resolveOptions` against the
   live field.**
3. **The Examples / sample-files page was never looked at** (user asked 3×): broken links, and an
   image that should be STACKED rather than beside its text. Ask for a screenshot of that page.

**Eight defects fixed, each root-caused from live data:**
- **The build jammed after the FIRST page.** `FIND meta.templateName IS "Day Page"` also matched
  every CLONE (APPLY_TEMPLATE copies meta); a multi-match FIND returns an ARRAY that APPLY_TEMPLATE
  can't resolve. Now picker-direct by id; the builder THROWS without one.
- **`APPLY_TEMPLATE defaultFields` was gated to `role === "instance"`,** so the Daily Question
  (container) and Daily Answer (textblock) never got the date their header/body links join on. The
  gate now asks whether the clone's module BINDS the field — slot/page clones still get nothing.
- **`PUSH_TO_ARRAY` resolved only the TOP level of an object,** so every TipTap node it pushed kept
  the literal `"$task.id"` one level down in `attrs`. It deep-resolves now (as UPDATE already did).
  This was the "Tasks Completed has broken links" report.
- **The page name came from the picker's period OBJECT** → a page literally named
  `Day Page - [object Object]`. Both day-page ops use `$activeDate` + `targetOccurrenceId` now.
- **A LOOP whose `over` is a nested var path silently iterates EVERYTHING.**
  `LOOP over "$dayPage.textmap.content"` wrote 1278 occurrence records into a live page's textmap as
  if they were nodes. **There is no splice in the pipeline language** — the op writes the whole
  content array from FINDs instead, so it owns the section ORDER (add a section to the template →
  add it here too).
- **TWO ancestor-scoped FINDs broke once Todo had a second parent.** `_ancestors` is derived from the
  parent map, so multi-parenting Todo into the day page let its chain resolve through the PAGE:
  Build Schedule's slot dedupe re-minted a duplicate every load, and the op's OWN Todo lookup found
  nothing and stopped rewriting its embed (it sawed off its own branch). Both key on `parentId` now
  — the precise test for a direct child.
- **`Daily Question` was display-only** → its bound header rendered no writable control.
- **Past day pages kept (and kept APPENDING) unresolved embeds** — 1086 on the 07-28 page — because
  Tasks Completed only ever rewrites the CURRENT day's page. Migration clears them.

**Design notes:** Todo is the day-column's OWN container multi-parented in, NOT a copy — one
occurrence, two parents, so a tick here and on the Schedule are the same write (two copies would fork
the state; same reasoning as `createPageInContainer`). `No timeslot` → `Todo` renames the label AND
the Time Slot identity marker in one pass. Journal/Notes/Highlights store plain per-day
`occurrence.textmap` with NO field bindings — the occurrence is minted per day, so the writing is
per-day for free; a binding would only matter if the text had to sync elsewhere (which is why Daily
Answer has one).

**RETRACTED:** an earlier claim that the `Due`/`No timeslot` identity markers were null and Build
Schedule's un-slotted sweep was dead. They are intact — the probe read
`scheduleFieldIds.timeslot` instead of `.timeslotFieldId`.

**The lesson of this session:** three separate times a DB query said "working" while the user's screen
disagreed — the malformed page name, the dead Todo embed, and the unpinned hub tab. **The DOM and the
tab strip are ground truth for "is it working," not the collection.** Also: migrations read RAW
documents, where `textmap` is COMPRESSED — a bare `page.textmap.content` is undefined, which silently
turned a damage check into a no-op.

---

### 2026-07-29 (4) — the add menu creates EVERY occurrence type; two ops bugs found (NOT fixed)

**Shipped — `tileKindsForRole("instance")` is now 12 tiles** (user: "pretty much its to create any
occurance type"). Item · Textblock · Artifact · Image · **4 nested CONTAINERS** (Board/Doc/Table/
Canvas) · **4 PAGES** (Board/Doc/Table/Canvas). Confirmed with the user that table + canvas
containers do exist (`ModuleContainer.jsx:668-671` dispatches all four kinds), so their first list
("board container, doc container") was widened.
- Page tiles use new `page-<kind>` keys — the bare kinds keep meaning CONTAINERS, so no existing
  call site changes meaning. `tileMeta(kind, targetRole)` labels the bare kinds "… container" ONLY
  in the instance menu (where both exist); the page/container-role menus keep short labels.
- **`CommitHelpers.createPageInContainer` (NEW)** — ONE module, ONE occurrence: `parentId` = the
  manifest ROOT FOLDER (so the tree lists it as a real page) and spliced into the container's
  `occurrences[]` (the multi-parent pattern the Schedule uses for shared slots). **Do not "fix"
  this with two occurrences, one per home: `textmap` lives on the OCCURRENCE, so a doc/canvas page
  would carry two independent bodies and the in-container copy would render permanently empty.**
- The cascade defaults a page-in-container to `actual-converted` — for a brand-new empty page that
  is an empty inline box, indistinguishable from just adding a container. So the occurrence carries
  `meta.layoutCascadeOverride.dragInView = "representation"` (the per-occurrence override that
  survives the cascade walk); the header switcher still flips it. NOTE: "preview" proper (the iframe
  card) is a folder-page-only mode — `representation` is the compact view available in a container.
- `folderId` is resolved IN QuickAddMenu (the only layer holding `manifestsById`) and threaded
  through `onCreateNew` → `createChildInContainer`; hosts stay ignorant of folders.
- 1441 client tests (7 new), deployed, prod-verified: all 12 labels render, and "Canvas page" mints
  a `role:page kind:canvas` homed in Root, listed by the container, in representation view, with a
  textmap. **The verification probe wrote to the frozen grid — the page it created was swept and
  pm2 restarted.** `ALLOWED_KINDS_BY_ROLE` was deliberately NOT widened (it filters the
  existing-matches list, not the create tiles) — placing an EXISTING page/table/canvas as a preview
  is a separate ask.

### 2026-07-30 (6) — workout movements count as habits

User: "workouts is a habit but the completed tasks is okay." The 0008 rule made every Routines
action a habit and left everything else a task, which put the 30 workout MOVEMENTS on the tasks side
— they live on the Movements board, not in the Routines catalog. Seed (`makeWorkout`) + migration
`0010` bind the same hidden Habit marker on them, so logging a lift moves Completed Habits.
Identified STRUCTURALLY (whatever the Movements board holds, feed copies skipped), not from a label
list, so it can't drift as movements are added. 33 modules marked.
Completed Tasks reading 0 until the Tasks page has content is CONFIRMED FINE by the user — don't
"fix" it.

---

### 2026-07-30 (5) — Routines split into sub-categories; feed pages are a dangling-ref source

`ROUTINE_GROUPS` (seed) + migration `0009` group all **97 actions into 31 sub-category containers**
under the nine dimensions — Physical → Nutrition/Fitness/Rest/Care, Financial →
Earning/Spending/Saving/Admin, and so on. Dimension modules gain
`meta.allowChildContainers`. The seed THROWS if a dimension's `instKeys` isn't fully placed, so a
future action can't silently fall off the page; the migration keeps any unlisted action at top level
and logs it rather than dropping it. Applied to poms grid, 0 leftovers.

**Finding worth keeping:** the post-migration integrity check caught 12 dangling child refs — on
**Schedule Canvas** and **Schedule Table**, the two FEED-backed pages, from client-minted ids ~7
minutes earlier. So the recurring dangling-ref source is the FEED engine (feedSync mints copies
client-side; the create is queued server-side and bails on disconnect while the parent-list write is
not), NOT just headless probes as assumed on 2026-07-29. Swept; all three grids 0 errors. A feed
resync that reconciles the parent list would close it for good.

---

### 2026-07-30 (4) — mobile: the grid rendered off-centre because a HIDDEN viewport was scrolled

User: "switching grid cells is glitching out, making the screen off center and viewing the wrong
cells/side bar buttons being off." Measured on prod at 390×844: the `.mobile-grid-viewport` computed
`overflow: hidden` **and** sat at `scrollTop 439 / scrollLeft 370`.

- **`overflow: hidden` does NOT make a box unscrollable** — it only hides the scrollbars. Anything
  that reveals a descendant (the scroll-to-current-slot pass, an occurrence-search jump, focusing a
  freshly minted label editor) scrolls every scrollable ancestor, this viewport included. That
  offset then rides on top of the cell transform permanently: the grid paints off-centre, you see a
  slice of the neighbouring cells, and the rails point at the cell `activeCell` says you are on
  rather than the one on screen.
- The mode-off branch already reset scroll to 0, but only ONCE at effect time — the offending
  scroll happens later. It now **pins** the viewport with a scroll listener for as long as the
  panel-native-scroll mode is off. Verified on prod: 439/370 → **0/0**.
- Multicell panels are untouched (that branch owns the scroll deliberately). 23 mobile tests pass.
- **Probe note:** the same run printed "MISMATCH" on every rail tap — that was the PROBE reading a
  non-existent `moduli-activeCell` localStorage key, so its expectation was always `?`. Don't chase
  it; find the real key before re-testing rail↔transform agreement.

---

### 2026-07-30 (3) — Routines catalog de-duplicated; Sleep loses Duration. TRACKERS RESTRUCTURE IS QUEUED

Shipped (seed + migration `0007`, applied to poms grid, deployed): the catalog went **104 → 97
actions with ZERO duplicate labels**. Dropped Nap (Sleep covers it), Lift (bindings were IDENTICAL
to Exercise), Emotional Meditate (Spiritual keeps it), Spiritual Reflect (Emotional keeps it),
Occupational Write (Creative keeps it), Financial Review (Reconcile already covers reviewing
accounts, so Occupational keeps the one Review), and a duplicate Check In placement (the mood-wheel
demo row — Emotional listed it twice).
**Verified before deleting anything**: none of the seven was referenced by any op pipeline, trigger,
or template textmap, and each removed module had exactly ONE occurrence (no Schedule copies), so
nothing was orphaned. The migration still guards per-module at run time and refuses any entry with
children.
**Sleep no longer binds Duration** (user: "the operation should just count each one as 30 min") — a
slot IS 30 minutes, so sleep is measured by how many half-hour slots it fills. The 12 stored
Duration values were CLEARED, which matters beyond tidiness: the "Time Spent" tracker sums Duration
across every completed schedule item, so leaving them would have double-counted sleep.

**QUEUED — approved by the user, designed, NOT yet built** (kept here so nothing is lost):
1. **New "Stats" container, first on the Trackers page** (the date-prefix op will render it
   "Today's Stats"), holding **Completed Tasks · Completed Habits · Now · Streak** — the first three
   moved out of Physical, Completed Habits new.
   *Useful finding: the existing Completed tracker is ALREADY grid-wide* (`trackerArgs` carries
   `scopePageOccId: schedPageOccId`); it only READS as physical because of where it sits. Moving it
   satisfies "should be all, not just physical" with no scope change.
2. **Habit vs task discriminator (user-approved):** bind a hidden marker field on every Routines
   action module. `Completed Habits` = completed AND carries it; `Completed Tasks` = completed AND
   does NOT. Use the module-BINDING form (`_boundFieldIds ARRAY_INCLUDES/ARRAY_NOT_INCLUDES`), not a
   stored value — the 2026-07-11 idiom, and it survives copies for free. Sleep counts as a HABIT
   (user's pick), so it drops out of the tasks count automatically. Note: Completed Tasks will read
   0 until the Tasks page has content, and workout MOVEMENTS dragged from the board count as tasks
   under this rule — flag if that should change.
3. **Sleep = 30 min per completed occurrence** — needs a destination tile; fold into the Stats build.
4. **Nest tracker containers (user-approved):** Workout + Nutrition → Physical, Media →
   Intellectual, Planning → Occupational. Parent container modules need
   `meta.allowChildContainers: true`. Re-parenting is invisible to ops (they target tiles by id —
   same lesson as the 2026-07-25 account-container merge).
5. **Sub-categorize the Routines page the same way** ("nutrition should be in physical in its own
   container etc") — ~35 sub-containers across the 9 dimensions. Deliberately NOT bundled with the
   above: it is the one open-ended piece and a big live-grid change, so it wants its own reviewable
   migration.

---

### 2026-07-30 (2) — today's Schedule was missing its first 11 slots (MY probe caused it)

User: "we dont have the full schedule … 6am to 1130pm with a random 130 am at the end." Exactly
reproduced: today's day-col listed 37 children — 6:00am→11:30pm plus a 1:30am appended last.

- **Not a build failure — a LINK failure.** All 48 slot copies for today existed, and the missing 11
  already carried `parentId` pointing at the day-col. What was missing was their id in the day-col's
  **`occurrences[]`**, which is what the renderer reads. Same asymmetry the 2026-07-29 audit
  documented from the other side: `create_occurrence` is QUEUED server-side and survives, while the
  parent-list write is a separate `update_occurrence` that does not — so a client that goes away
  mid-build leaves created-but-unlisted children. The stray 1:30am was a second copy added by a
  later pass, which is why it sorted last (the array is the render order).
- **I caused this instance**: my `_slotgate.mjs` probe was the first client to load after midnight,
  so IT ran the new-day Build Schedule, and the probe closes its browser seconds later — mid-burst.
  **A probe that loads the live grid can trigger the day rollover. Keep it open, or expect to
  repair.**
- Repaired by relinking the 11, deleting the duplicate 1:30am, and rewriting `occurrences[]` in
  clock order (parse `h:mm am/pm` → minutes; non-slot children preserved after the slots). The
  script REFUSED to drop any duplicate carrying children. Verified live: 48 children, 12:00am first,
  11:30pm last, none missing, none out of order, all 48 painted.
- **Same failure took out today's `Due` + `No timeslot` too** (user reported separately). Both
  copies existed with `parentId` = today's day-col but were unlisted, AND their Time Slot identity
  marker was `""` — because my first too-blunt migration run nulled the MASTERS at 10:22 and the
  build COPY_LINKed them at 10:23, carrying the emptied value through. Restored both markers and
  rebuilt the child list to the convention the correctly-built Fri/Sat day-cols use:
  **[Due, No timeslot, …48 slots in clock order] = 50 children.** All three day-cols now match, 50
  painted each. Lesson: a data repair on a MASTER propagates into every per-day copy minted
  afterwards — repair the masters and the copies in the same pass, or rebuild the copies.
- **Still fragile (not changed):** `Schedule: Build Schedule` self-heals a day-col that is EMPTY,
  but not one that is PARTIALLY linked — nothing re-links a child whose `parentId` already points at
  the day-col but is absent from its array. That covers the slots AND the Due / No timeslot heads.
  Worth an idempotent relink pass in the op.
- **The stale tab kept re-minting the fixed bug, with timestamps to prove it:** 12 more
  `kind:"doc"` instance modules appeared at 11:44 (the Fri/Sat routine clones) — after the
  `operationActions` fix deployed at 10:36. An open tab runs the OLD bundle, whose CREATE still
  defaults `kind` to "doc". Cleared; **it recurs until the tab reloads**. Don't re-investigate a
  fix that "didn't take" before checking the client's vintage.
- **Separately: a stale TAB can re-introduce fixed bugs.** The 6:30 AM alarm fired at 11:30Z and
  STILL minted `kind:"list"` even though the stored pipeline had been stripped at 10:22 and the
  builders were fixed — because the browser tab had been open since before the migration and fired
  from its in-memory pre-migration copy of the op (its `lastFiredAt` never reached the DB either).
  Data cleared; **a reload is the remedy**. When a fix "didn't take", check whether the client
  predates it before re-opening the investigation.

---

### 2026-07-30 — both ops bugs FIXED (and a third, which was the real root of one)

- **Time Slot only gets stamped when the destination IS a slot.**
  `makeStampDateTimeSlotOp` gained an optional `scheduleFormatFieldId`: it now FINDs the
  destination off `$trigger.containerId` and writes `$trigger.containerLabel` ONLY when that
  container carries `Schedule Format IS "slot"`, else writes null. **The ELSE matters as much as
  the gate** — a COPY carries the source's fields, so a slotted item copied onto a canvas would
  otherwise keep a slot it no longer sits in. Grids without the field (createTestGrid) keep the
  ungated stamp byte-identically. Proven in `liveOpsBehavioral` (3 new): gated on the field, a real
  slot stamps "6:00am", a non-slot container stamps null and NEVER its own name. Verified live too
  (created under the day-col → null).
- **`kind` — my first fix was HALF the bug.** Dropping `kind:"list"` from `alarmOps.js` just moved
  the value: `operationActions.js` CREATE defaulted **every** op-minted module to `kind: "doc"`
  regardless of role, so instances kept getting an inert kind (today's 6 routine clones proved it).
  Now `KINDLESS_CREATE_ROLES` (instance/panel) get no kind; an explicit `cfg.kind` is honoured and
  container/page keep the "doc" default. 3 tests.
- **Migration `0006`** carries all of it to the frozen grids. **The data repair took three passes
  because "not a valid slot label" is NOT the same as "wrong":**
  1. Blunt null-everything ALSO nulled the `Due` / `No timeslot` CONTAINERS, which carry their OWN
     label in Time Slot as an **identity marker** — `Schedule: Build Schedule` FINDs them by
     exactly that (`fields.<timeslot>.value IS "No timeslot"`). Restored from the pre-migration
     snapshot.
  2. It also nulled the per-day SLOT COPIES, whose correct value is their own time — Alarm and
     Pomodoro: Start FIND their slot by `fields.<timeslot>.value IS "5:00pm"` and Mark Passed Slots
     compares it `TIME_BEFORE` now. Nulling those silently breaks all three.
  - **The rule that actually separates them:** a value equal to the occurrence's OWN label is an
    identity marker (leave it); a value equal to a PARENT's label is the mis-stamp — reset it to
    the occurrence's own slot time when it has one, else clear. Live grid now: 97/97 slots carry a
    valid time, today's 5:00pm findable, both markers intact, 0 mis-stamped.
- **Probe debris is a real hazard on the frozen grid.** Closing a browser mid-create leaves the
  documented pathology (`create_occurrence` is queued server-side and bails on disconnect; the
  parent-list update is not) — 24 dangling child refs + 2 module-less occurrences, integrity went
  to 2 ERRORS. Swept scoped strictly to the `17854*` client-minted ids. **Sweep probe writes and
  re-check integrity before calling a session done.**
- 1447 client + 325 server tests, all three grids 0 errors, deployed, prod-verified.

---

**Found, root-caused (both now FIXED above — kept for the reasoning trail):**
1. **Time Slot gets a CONTAINER LABEL, not a time** (user: "in workouts, time is set to schedule
   canvas and not a time"). `makeStampDateTimeSlotOp` writes `value: "$trigger.containerLabel"`
   into the Time Slot field with **no check that the destination is a slot at all** — Time Slot is a
   select of 48 time labels, so anything else is out of range. Live grid holds 3 Exercise
   occurrences reading `"Schedule Canvas"` (two under the Schedule Canvas / Schedule Table pages,
   one under a real `12:00am` slot) plus `"Due"`×2 and `"No timeslot"`×2. The Workout History row's
   `timeslot` reads that field verbatim, which is why the tile shows it. **Fix**: gate the UPDATE on
   the destination being a slot — `$trigger.containerId`'s occurrence has `Schedule Format IS
   "slot"` (96 slots + 1 day-col carry it; the canvas/table pages and Due carry null). The
   discriminator is already the one `makeAlarmOp` and Pomodoro: Start use. Then null the 7 bad
   values via migration.
2. **Every fired alarm mints an instance with `kind: "list"`** → `getModuleTypeIcon` prefers kind
   over role, so it draws the BOARD icon (exactly the class of bug the 2026-07-29 kind removal
   fixed). Surfaced as a NEW `inert-kind` integrity warning after today's 5 PM alarm fired
   ("⏰ 5 PM", 22:00Z). `client/src/helpers/alarmOps.js:89` still emits `kind: "list"`; the server
   twin `makeAlarmOp` (liveSystemBuilders.js:2754) already dropped it — **the twins have drifted**.
   The frozen grids' two stored alarm pipelines still carry it, so the fix is both the client
   builder AND a migration over `Alarm: 5 PM` / `Alarm: 6:30 AM`.

---

### 2026-07-29 (3) — empty pocket actually clickable; the Appointment occurrence

Picked up the two items account2's session left open.

- **The empty-pocket fix (`0d1b390a`) did not work, and prod proved it.** Clicking anywhere in an
  empty container's pocket still did nothing below the top 20px. Cause: the CSS marked
  `width: 100% !important` but left `height: 100%` unmarked — QuickAddMenu sets **both** as INLINE
  styles (20px each), and an inline style beats a stylesheet rule regardless of specificity. So the
  trigger stretched full-width but stayed a 20px band at the top of the 44px pocket. One word
  (`!important` on height) fixed it. **This is the third time this exact trap has been recorded**
  (AutoMarquee's `display:block`, ModuleInstance's inline flex-wrap) — when a rule silently does
  nothing, check for an inline style before anything else. Verified on prod by clicking 14px in
  from a pocket's left edge: `elementFromPoint` now returns the BUTTON and the menu opens.
- **Appointment occurrence added** (user: "we need an appointment occurance if we dont already have
  one"). Nothing modelled a scheduled commitment — the nearest things were Social's Meet/Visit/Host
  (people you choose to see) and the Events board (Game Night, Book Club). Added the same noun/verb
  pair the rest of the grid uses: an **Appointments board** (Doctor/Dentist/Therapy/Optometrist/
  Haircut/Car Service/Vet) under the Social board group, feed-backed on `boardCategory:"appointment"`;
  an **Appointment Type** dropdown scoped to that tag; and an **Appointment** action binding
  Completed · Appointment Type · Place · People · Duration · Date(hidden), so it drags onto a slot
  and stamps date + timeslot like any other action.
  **Placed in OCCUPATIONAL, not Social** — the obligations/admin dimension — so Social keeps reading
  as chosen contact. Trackers aggregate by FIELD, not by container, so the dimension is purely where
  you go to find it; moving it is a one-line change with zero tracker consequence.
- **Migration `0005-appointment-occurrence`** carries it to the frozen grids; the seed produces the
  same thing. **The dry run earned its keep:** `Board Category` stores its tag list in
  `meta.optionsSource.values` (manual mode) on poms grid but in `meta.options` in the seed — a blind
  `$set` on `meta.options` would have left a stray one-element list on a field whose real options
  live elsewhere. The migration now appends to whichever list the grid actually uses. Everything is
  resolved BY NAME at run time (no baked ids); the Occupational ROUTINES container is disambiguated
  from the same-labelled tracker container by finding the parent of the unique "Network" action.
  Rehearsed on `test grid 2` (stripped first so the CREATE path ran for real), re-run to prove
  idempotency, then applied to poms grid + **pm2 restarted** (the warm cache would otherwise re-serve
  the old grid).
- 1434 client + 323 server tests, all three grids integrity-clean (0 errors, the same 2 pre-existing
  warnings), deployed, verified live on prod.
- **Probe lesson:** the first verification probe reported the Appointment missing — it read
  `state.modulesById`, but the client store holds FLAT ARRAYS (`modules`/`occurrences`/`fields`).
  The DOM disagreed with the probe, which is what caught it. Check the probe before believing a
  failure.

---

## Handoff — 2026-07-29 (full-site audit: 5 real bugs found and fixed; integrity gate added)

Audited the live grid's data, schema and runtime (not just the code). Findings + fixes, all
deployed. **My initial headline was WRONG and is retracted**: the feed engine is NOT broken — it
resolves 10 matches for Grocery List, all visible, and mints correctly; boards with `matches=0`
legitimately have nothing to pull. What was real:

- **Dangling child refs (the big one).** A parent's `occurrences[]` listed 42 ids naming
  occurrences that do not exist. Cause is an asymmetry: `create_occurrence` is QUEUED server-side
  and bails at every stage on disconnect, `update_occurrence` is neither — so a client that went
  away mid-burst persisted a parent listing children that were never created. Worse, they were
  **self-restoring**: the client holds whatever the last full_state gave it and echoes the whole
  array back, so sweeping the DB fixed nothing (42 refs survived four repairs). Fixed at BOTH
  ends — the client no longer emits its own parent-list write (the create carries `parentId` and
  the server `$push`es it atomically, only if the create persisted), and **the server now drops
  child ids that name no occurrence**. Proven: 4 abrupt sessions → 0 dangling.
  **Operational note: a DB-level `occurrences[]` repair needs a server restart** — the warm
  per-user cache is authoritative for reads and will re-serve the old array otherwise. That cost
  three misleading regression runs.
- **`targetId` was still read in live code paths** — and not just as a dead fallback. The schema
  dropped it and no occurrence carries it, yet `layoutCascade.js` used it in 3 of 4 module
  lookups (so the WHOLE layout cascade resolved role/kind to undefined and silently defaulted),
  ManifestTree's page-child filter matched nothing, and the assistant's `list_pages` came back
  empty. 34 dead fallbacks + 9 broken sole-lookups removed. The test fixtures encoded the same
  pre-rename shape, which is why none of it was caught.
- **Two enabled ops wrote the same target.** `Mark Passed Timeslots` (30 min) and
  `Schedule: Mark Passed Slots` (5 min) both wrote `$slot.ownStyle.bg`, so the slower stomped the
  newer op's green current-slot tint twice an hour. Removed from the seed, and removed from the
  frozen `poms grid` via **migration `0002-drop-duplicate-slot-painter`** — the first real use of
  the migration runner.
- **`Operation.priority` was missing from the schema** while the seed had passed it since
  2026-04-27 — strict mode dropped it, all 68 ops persisted `priority: null`, and the documented
  ordering silently fell back to `triggerObject.priority`. Added.
- **`server/utils/gridIntegrity.js` (NEW) + `scripts/checkGrid.js`** — the seed now FAILS on a
  structurally invalid grid. Checks: dangling child refs, module-less occurrences, two enabled
  ops writing one PRESENTATION target (deliberately narrow — several ops writing one FIELD is
  normal and flagging it made the check noise), unused fields, duplicate field/op names,
  unfireable ops. Every defect above is representable; each had been silent for months.
- Remaining warning on all grids: 14 fields never bound/valued/referenced. Some are deliberate
  palette fields (Tags was seeded for the feed field-check), so they were NOT deleted — worth a
  pass to decide which are leftovers from the 2026-07-25 media retarget.
- 1430 client + 314 server tests, build clean, prod verified desktop + mobile, zero page errors.

---

### 2026-07-29 (2) — kind removed from leaves; media trackers folded into a builder

- **`kind` dropped from instance + panel modules** (user: "get rid of kind if we arent using it").
  It IS used — kind is the sub-type WITHIN a role, and container/page/artifact/textblock all
  render by it (board vs doc vs canvas vs table; image vs video vs pdf; the inline chip vs the
  block textblock). So it was removed only from the roles with no sub-types. **Not cosmetic:**
  `getModuleTypeIcon` resolves kind BEFORE role, so 519 instances + 5 panels carrying
  `kind:"board"` drew the BOARD icon everywhere an icon appears. Seed strips it at the single
  chokepoint every instance passes through (the bulk `insertMany`) so it can't be forgotten;
  migration `0003` cleared 525 on poms grid + 369 on test grid 1, leaving the kind-bearing roles
  untouched; `gridIntegrity` gained an `inert-kind` rule. **There is no "list" container kind —
  it is BOARD everywhere** (the Module.js comment briefly said otherwise; corrected).
- **`makeMediaHistoryOp`** — Movies Watched / Books Read / Podcasts Listened were three
  hand-written Operation literals with an identical 19-node pipeline: ~12KB of duplicated JSON
  over 409 seed lines, now 52. **Provable no-op:** the regenerated pipelines were diffed against
  the pre-change `server/seed/operations.json` and are byte-identical once per-reseed ids are
  normalised — which is why loop-var names are PARAMETERS (not derived from a prefix) and row
  extras have before/after-label slots. New callers pass `varPrefix` and take the defaults.
  6 tests. The remaining bespoke clusters (Workout/Meal/Purchase History, the Pomodoro quartet)
  are the same opportunity and the same method.
- **Field pills on an instance row now share one box** — the multi-select occurrence dropdown
  rendered a completely different control (full-width, square, fixed 24px) from the single-select
  pill (21px, rounded), and neither lined up with the boolean/number pills. All now 21px at one
  y. `!important` was REQUIRED on the centring: AutoMarquee sets `display:block` INLINE, which
  beats a stylesheet rule — the first attempt silently did nothing.
- 1433 client + 323 server tests, all three grids integrity-clean, prod verified desktop+mobile.

---

## Handoff — 2026-07-28 (poms grid is PROTECTED live data; backups + migrations shipped)

Plan: `docs/superpowers/plans/2026-07-28-poms-grid-live-data-freeze.md`. **ALL EIGHT TASKS DONE —
`poms grid` is FROZEN** (`meta.frozenAt`, `frozenAtCommit=ecac1069`, new id
`6a690f6fb8e785df961a9f3c`, 975 occurrences). Rebuilt once from the seed via a one-shot script
that was deleted immediately after; snapshots either side. **The seed must never touch it again —
content changes happen in the app, structure changes go through `server/migrations/`.**

- **Three grids now.** `poms grid` = permanent live data, `meta.protected: true`, the seed must
  NEVER write it. `test grid 1` = the frozen old live grid. `test grid 2` = `DEFAULT_GRID_NAME`,
  the seed's target, overwrite freely. The stray 1×1 is deleted.
- **`server/utils/protectedGrids.js` is THE rule.** `assertNotProtected` throws (a boolean someone
  forgets to check is not a guard). Honoured by `dropExistingLiveGrid` (name AND the found
  document), `sweepStaleGrids`, `clearAllUserGrids`, `resetData.js`, `clearUserData.js`, and the
  runtime `delete_grid`; Grid Settings hides the delete button for a protected grid.
- **Backups: `npm run backup:poms`**, nightly cron on the droplet at 04:17 (14 kept, labelled ones
  never prune). Restore is VERBATIM (same ids — `Occurrence.id` is globally unique and ids are
  woven through parentId/textmap embeds/op pipelines), so rehearse with `--into-db <scratch>`.
  `--verify` compares CONTENT HASHES, not counts. Full drill + refusal table:
  `docs/backup-restore.md`.
- **Changing the live grid from now on:** `server/migrations/` + `npm run migrate:poms`. Content
  changes happen in the app; migrations are only for structure the UI cannot express.
- **`delete_grid` now CASCADES** (it deleted the Grid row only — that stranded 186 documents
  across six dead grids, since swept via `scripts/sweepOrphans.js`, which dumps to
  `backups/orphans/` first and leaves null-gridId docs alone).
- **HARD-LEARNED, recorded so it doesn't repeat:** verifying the guards by running them against
  the LIVE database dropped the live grid — the guard refused `"poms grid"` but the grid was
  still named `"Poms"` (the rename was a later task), so nothing matched. Restored byte-identical
  from the Task 1 backup in one command. **Land the rename/stamp BEFORE any check that exercises
  a name-matched rule, and verify guards on a MOCKED model** — a test that guards the live data
  must not be able to destroy it.
- Also this session: **occurrence search highlights the copy in the panel it opened** (the lookup
  was document-wide, so a copy in another cell stole the flash — prod-reproduced), and **instance
  rows align label/handle/fields on one centreline** (fields sat 3px low; the lift is paid back in
  the row gap when they wrap, and inline-media rows take a smaller lift).
- 296 server + 1429 client tests, build clean, deployed (`920b7917`), prod verified.

---

## Handoff — 2026-07-27 (the 2026-07-26 batch is DEPLOYED; mobile rail taps switch instantly)

Everything from the 2026-07-26 handoff below plus the six follow-up commits (mobile toolbar/page
header, container label size, container menu occurrence types, boards copy-link, hover-label leak,
scroll-to-current-slot) is **deployed** — prod HEAD `a714a037`, verified by SSH + a byte-identical
sha256 on the served `App-*.js` chunk. 1416 client + 246 server tests, build clean.

- **Mobile cell-switch lag FIXED** (user: "the side buttons have a delay on the switch").
  `activeCell` lives in App state, so a rail tap re-rendered the whole grid BEFORE the slider
  transform moved — that commit is the delay. `mobile/MobileGridNav.jsx` now paints the target
  transform **imperatively in the tap's own frame** (`cellTransform(row,col)`, the same string the
  render computes) and holds the target in `pendingCellRef` until the state catches up, so an
  unrelated re-render in between can't snap the cell back. The pending cell is compared **by
  value** — `MosaicMobileNav` passes a fresh `{row,col}` object every render, so identity
  comparison would clear it instantly; it clears when the state reaches the target OR moves
  anywhere else on its own (the silent sub-cell scroll sync). `navigate` clamps against
  `activeCellRef` (the optimistic cell) so back-to-back taps compose. Rail buttons fire on
  **pointerup** with a 12px tap-slop guard (a swipe that starts on the rail doesn't navigate) and
  drop the trailing synthesized click; `touch-action: manipulation` on `.mobile-rail-btn`.
  5 tests. **Prod probe (390×844): transform moves 0.9ms after the tap, settles unchanged, no
  page errors.**
- **Still open from below:** "food is outside the boards folder" — unreproduced (seed parents Food
  under Boards; the rendered root tree shows it indented under Boards). Need the surface it's
  wrong on.

---

## Handoff — 2026-07-26 (occurrence SEARCH in both headers; the de-schedule sweep; snap-to-today)

Spec `docs/superpowers/specs/2026-07-26-occurrence-search-design.md`, plan
`docs/superpowers/plans/2026-07-26-occurrence-search-and-deschedule.md` (15 tasks; 14 shipped,
one dropped on purpose — see below). 1411 client + 246 server tests, build clean, RESEEDED.

- **Occurrence search, two surfaces, one engine.** `helpers/occurrenceSearch.js` (pure, 25 tests)
  indexes every occurrence's label (`occurrence.label ?? module.label` — no other rule), its
  ancestor PATH, field NAMES + VALUES (occurrence refs resolve to the referenced LABEL, never an
  id), textmap/table body text (capped 10k chars), and **date aliases** (`2026-07-25` / `jul 25` /
  `july 25th` / `saturday`) drawn from the occurrence's own date field or `filterOverride` **AND
  from every ancestor's** — that last part is what makes `water july 25` and `9pm july 25` work
  (the date lives on the CONTAINER, not the item; the first implementation missed it and a test
  caught it). Query is **AND-of-terms** across all haystacks, so extra terms narrow by location;
  ranking is tiered label-prefix > label-substring > field > path/date > body, without which a
  paragraph mentioning "water" outranks Drink Water itself. Non-label hits carry the fragment
  that matched, rendered as a third row line.
- **`ui/OccurrenceSearch.jsx`** — magnifier that expands in place, portalled dropdown (repositions
  on scroll, never closes on it), ↑/↓/Enter/Escape. Mounted in the PANEL header left of the
  Root-tree button (whole grid; picking opens the result's page in THAT panel via the new shared
  `helpers/openOccurrenceInPanel.js`, which AssistantDrawer now also uses) and in the PAGE header
  left of the filter funnel (`scopeRootId` = that page; picking just scrolls). A match that is
  filtered out of the DOM says so instead of silently doing nothing.
- **Index caching:** entries are cached per occurrence OBJECT (a write swaps only what changed) —
  and the cache record holds the ancestor objects it was built from, because a PARENT rename
  doesn't touch the child object and would otherwise leave a stale path.
- **Page header also gained the × close button** (unpins the page from the panel via the panel's
  existing `closePage`).
- **DE-SCHEDULE SWEEP (user: "there shouldnt be anything schedule specific in the code").** Four
  violations found and removed, with `__tests__/noDomainKnowledge.test.js` guarding each:
  (1) `ModuleContainer` `SCHEDULE_LABEL_PREFIX` + `computeScheduleColLabel` — the header
  string-matched a `"Schedule - "` label prefix to recompute its title; (2) `PageBoard`
  `WEEKDAY_RAINBOW`/`weekdayColor` — hardcoded Mon-red…Sun-violet tints from a date field, same
  class as the timeslot-passed tint deleted 2026-06-03; (3) `PomodoroTimer.currentSlotLabel()`
  baked the `"9:00am"` format to string-match slots — now `pickTimeOptionForNow` picks the latest
  elapsed option from the timeslot FIELD's own options; (4) `alarmOps` + its server twin
  `makeAlarmOp` found the destination page by `label IS "Schedule"` — now `id IS
  <pageOccurrenceId>`, seeded onto `grid.meta.scheduleFieldIds`. Seed files stay exempt (they
  author the schedule as DATA). `dropHandlers`' `dayColOcc` locals renamed `filterAncestorOcc`.
  **DELIBERATELY NOT DONE:** the planned day-column label-stamping op. The day-col module label is
  already minted as `"Schedule - ${dateLong:$day}"` per day, so the op would rewrite the identical
  string while looping every container on every load. Accepted loss: changing ONE day column's own
  date override no longer retitles it (only the deleted label-sniffing supported that).
- **`SET_FILTER` was half-wired** — `SET_FILTER_NAV` writes only `filterNavState` (the nav WIDGET);
  the cascade reads `grid.activeFilterValues`. So an op could move the date on screen without
  filtering anything. Now patches both + persists, decision extracted as pure
  `applySetFilterEffect` (6 tests) keeping the unchanged-value guard that stops onLoad loops.
- **`Grid: Snap Filter To Today`** (new seeded op, onLoad, trigger priority 0): a page's date is
  persisted in its OWN `filterOverride` and the full_state bootstrap deliberately never overwrites
  an explicit value — so the grid still showed yesterday the next morning. The op compares a hidden
  **"Last Opened Date"** marker occurrence to `$today` and, on a new day only, moves every
  date-carrying page forward and stamps the marker; same-day reloads write nothing, so a date you
  navigated to survives a refresh. **To express that as data, `UPDATE` gained
  `$page.filterOverride.<fieldId>`** → `UPDATE_ITEM_FILTER_OVERRIDE`, applied through
  `updateOccurrenceFilterOverride` so the NavigationOp cascade fires for the page + inheriting
  descendants (null clears the key). Any op can navigate a page's date now.
- **Finding, not fixed:** `op.priority` is NOT in the Operation schema — Mongoose strips it, so
  every seeded op exports `priority: null` and the executor's sort falls back to
  `triggerObject.priority` (which does persist). Op-level priority values in the seed are inert.
- Also this session: **alarms stop instantly on Stop** (`alarmSound.stopAlarm()` ramps each live
  gain to zero over 10ms then stops the oscillator — `ringAlarm` scheduled the whole burst on the
  audio timeline, so clearing the interval let it play out); empty-container **+ stays centered**
  (the hidden "Add new item" label was `opacity:0` but still held its width); inline instance
  images 18px → 22px.
- **NOT done:** no deploy (`./deploy.sh` + verify prod HEAD), and no on-device check of either
  search surface.

---

## Handoff — 2026-07-25 (Poms grid: nine dimensions of wellness — NEW grid, boards, one Routines page)

Per user (CLAUDE_CHAT 2026-07-25), a whole new seeded grid built beside the old one. Plan:
`docs/superpowers/plans/2026-07-25-poms-grid-nine-dimensions.md` (Tasks 1-8, all shipped).

- **The old Live Grid is now `test grid` and is UNTOUCHABLE.** The seed targets a new grid named
  **`Poms`** (`DEFAULT_GRID_NAME`), so `dropExistingLiveGrid` / `sweepStaleGrids` / the seed
  export never see the old data. One late fix: the `meta.defaultGrid` clear was an unscoped
  `Grid.updateMany({ userId })` that bumped `updatedAt` on EVERY grid each reseed (a pure no-op
  write to test grid) — now filtered to grids that actually carry the flag. Verified: test grid's
  `updatedAt` no longer moves on reseed and its 859 occurrences / 803 modules are untouched.
- **34 option BOARDS** (`Boards` folder → 7 life-area sub-folders → one `kind:"board"` page each).
  A new hidden **`Board Category`** select is THE scoping tag: every option instance carries it,
  every board dropdown's find predicate matches on it (always `AND meta.feedSourceId IS_EMPTY` —
  feed copies carry their source's tag and would otherwise double-list), and every board
  CONTAINER occurrence carries its OWN tag value + a `feed` on that tag. So the tag is the source
  of truth and the board is the materialized view: an option tagged anywhere gets pulled in.
  31 new occurrence-dropdown fields; 8 of them query SEVERAL boards via an OR-group predicate
  (Purchase Item, Ingredient, Media, Skill, Reading, Savings Goal, Creative Work, Idea).
  Recipe boards bind other dropdowns (a Meal carries its Ingredients, a Program its Movements,
  an Event its People + Place).
- **`addNew.targets` — "select an occurrence" (the one client change besides themes).** New
  `helpers/addNewOption.js`: `targets` is a plain list of candidate PARENT OCCURRENCE ids; when
  there's more than one the picker asks which, rendering each by its LIVE label. The new option's
  identity fields are copied from the CHOSEN PARENT at run time (`buildStampFields` reads the
  dropdown's own predicate fields off that occurrence) — nothing in the code knows what a "board"
  is. `addNew.fieldIds` additionally prompts for field values through the EXISTING GET_USER_INPUT
  modal. **Found a latent bug doing this:** Field.jsx read `s.gridId`/`s.userId` off the actions
  context, which never carried them (they live on `s.state`), so `createLeafInstanceInParent`
  silently bailed and "+ Add new" had never minted anything. Fixed with `s.state` fallbacks.
- **Pages restructured**: ONE **Routines** board page (9 dimension containers, vintage colors,
  ~103 granular action instances) replaces the 11 wellness pages; **Tasks** (the same 9
  containers, EMPTY, `meta.todoListContainer` kept) replaces Todo List; **Trackers** (all goal
  containers + the account containers, 18 children) replaces Goals AND Accounts.
  `goalsPageOccId`/`accountsPageOccId` are now aliases of `trackersPageOccId` so every
  HAS_ANCESTOR-scoped tracker rule kept working; a post-save pass rescopes the 20 ops whose
  `ancestorLabel` was baked as "Goals"/"Accounts" by `makeTrackerOp` (builders untouched — the
  project is data-only apart from the two permitted client changes).
- **People is a BOARD** (Social folder, feed-backed, the 10 person occurrences parent under it).
  The standalone People page + table + profile-card page + their two ops are DELETED.
- **Trackers retargeted, same goals**: workouts key on the **Movement pick** (muscleGroup lives on
  the picked movement OPTION now, so the per-muscle Volume trackers resolve the pick and read ITS
  muscleGroup, and Workout History rows read "Bench Press", not "Exercise"); the 4 per-meal
  Nutrition trackers collapse to ONE Eat-scoped `Meal Nutrition`; media history reads the new pick
  fields (Media/Reading became multiSelect so the trackers' pick-array loops still apply);
  **Track** is the universal money occurrence (flow toggle in/out/**replace**) superseding Set
  Account Balance; **Earn** carries Income (the Checking Balance NET agg is Income minus Amount,
  so the two money fields must stay distinct).
- **Verified**: 1352/1352 client + 245/245 server, build clean. Headless on the reseeded grid:
  Routines 9 colored containers · Tasks 9 empty · Trackers 18 children with live tiles · Schedule
  builds with the new routine clones (Drink/Hygiene/Eat/Walk/Exercise/Journal) · 34 feed-backed
  board pages · Pomodoro intact · zero page errors · multi-target addNew E2E (add "Tortillas" via
  Ingredient → pick Grocery List → lands there, tagged `grocery`, tag binding hidden).
- **NOT done / deliberate**: no deploy yet (see Task 8 Step 4 — `./deploy.sh` + verify prod HEAD).

---

## Handoff — 2026-07-25 (2) (tracker containers carry the date; account containers merged; mobile scroll reaches the end)

Follow-on batch to the Poms rebuild, all shipped + deployed (`f06bbddf`, prod HEAD verified) and
verified live on prod with a mobile probe:
- **The date phrase moved from the tracker TILES to their CONTAINERS.** `Trackers: Date-Prefix
  Labels` now stamps `"Today's <Dimension>"` on each container under the Trackers page and CLEARS
  `occurrence.label` on the tiles inside, so a tile reads as the bare metric ("Connection Time").
  Reading `moduleLabel` — not `label` — is what stops the op re-prefixing its own write.
- **The five "account" containers are gone.** Finances / Fitness / Learning / Productivity /
  Wellness were a second taxonomy beside the nine dimensions, which is what produced the user's
  "Today's Financial next to Today's Finances". Their tiles now live in the dimension they belong
  to (`acctKeys` on each `goalMappings` entry): Finances→Financial, Fitness→Physical,
  Reading→Intellectual, Productivity→Occupational, Wellness→Emotional. Tracker ops target tiles by
  occurrence id, so re-parenting them changed nothing else.
- **Mobile Schedule "stops at 9:30pm" ROOT-CAUSED and fixed.** Not the clamp (that fix was already
  live and correct) — the page scroller INSIDE a multicell panel sets `overscroll-behavior: contain`
  inline, so on reaching its end it never chained into the viewport and the panel's lower half was
  unreachable. Driving the scrollers by hand proved it: inner-at-max stopped at 9:00pm, and
  `viewport.scrollTop = 814` then showed 11:30pm. The viewport now stamps
  `data-panel-native-scroll` while the mode is live and CSS flips descendants to
  `overscroll-behavior-y: auto !important` (the viewport keeps `contain`, so nothing chains out to
  the document).
- Container header labels one size up (they matched the instance labels); occurrence-dropdown
  option rows drop the "Set image" overlay once an image is set.
- 1352/1352 client + 245/245 server, build clean, reseeded, deployed.
- **Probe lessons (cost two runs each):** a text check ("is 12:00am on screen") proves nothing about
  which mobile cell is ACTIVE — every panel's DOM sits in the slider, just translated off-screen;
  detect a multicell panel by the viewport flipping to `overflow: auto`. And synthetic `TouchEvent`s
  do not drive native scrolling at all — drive the scrollers directly and assert on geometry.

---

## Handoff — 2026-07-24 (drag autoscroll feel + multicell panels scroll natively on mobile + smaller insert gap)

Per user (CLAUDE_CHAT 2026-07-24), three UX asks, all shipped + headless-verified:
- **Drag-over autoscroll** (any scrollable, mobile priority): new pure `helpers/autoscrollMath.js`
  — zone = quarter-height clamped [56,150] (was fixed 80px), speed RAMPS 6→32 px/frame toward the
  edge (was flat 10), 70px GRACE band keeps the last scrollable scrolling when the finger
  overshoots its rect (the old dead-stop = the "finicky"), and the scan hands off from an inner
  scrollable at its end to the one behind it. Verified with a REAL drag session (probe lesson:
  a Playwright drag from an off-viewport handle never starts — selection-autoscroll mimics it).
- **Multicell panels (h or w ≥ 2) on mobile scroll CONTINUOUSLY** (user picked native viewport
  scroll): the mobile viewport becomes an overflow:auto scroller clamped to the panel's row/col
  range; transform anchors to the panel ORIGIN; activeCell silently tracks the nearest sub-cell;
  cell-snap (overscroll + rails, edge sub-cells only) survives ONLY for crossing to a different
  panel. Publishes `data-scroll-max-top/left` so drag autoscroll respects the clamp.
  MobileGridNav pure helpers exported + tested.
- **InsertGap declawed**: 8px hit zone (was 14) + centered 50% line/click strip (was
  edge-to-edge) — stops eating clicks/drag-starts meant for the rows around it.
- 1336/1336 client tests (33 new), build clean. No reseed needed (client-only).

---

## Handoff — 2026-07-20 (alarm → schedule op: fired alarms drop an instance onto today's Schedule)

Per user (chose Option A — per-alarm op step, "like the pomodoro"). A fired alarm/reminder now
also drops an instance onto TODAY's Schedule:
- **`makeAlarmOp` (server) + `buildAlarmOperation` (client) gained `sched`** ({ date, timeslot,
  scheduleFormat field ids }). When set, the pipeline appends `alarmScheduleSteps` after the
  NOTIFY: FIND Schedule page → today's day-col (`scheduleFormat="day-col"` + date SAME_DAY today)
  → the slot matching the alarm's TIMESLOT (`alarmTimeslotLabel`: 17:00→"5:00pm"; :15 stamps
  "5:15pm" but skips the slot FIND → lands in the day-col) → de-dupe on the timeslot FIELD (one
  instance per timeslot per day) → CREATE the alarm instance stamping date + timeslot (hidden).
  The two builders are twins — **keep in sync**. Fires via useScheduler (executePipeline).
- **Per user mid-build**: match/de-dupe on the timeslot FIELD not the label; slot containers +
  the created instance carry that field (any occurrence can). Pomodoro: Start already matched +
  stamped the timeslot field — unchanged, now consistent.
- **`grid.meta.scheduleFieldIds` seed-stamped** — AlarmDropdown reads it to bake `sched` into
  alarms it mints; the seeded 5 PM / 6:30 AM alarms pass it too. **RESEED REQUIRED** (the live
  grid has no scheduleFieldIds yet, so alarms stay plain NOTIFY until reseeded).
- Verified: 245/245 server + 1306/1306 client (6 new tests) + build clean. Deploy + reseed next.

---

## Handoff — 2026-07-14 (4) (unique field names — standing rule; all 11 seed duplicates renamed)

Per user: "there shouldnt be duplicate field names." Swept the seed (`7c46256a`, reseeded):
display twins renamed — Total Protein/Calories/Carbs/Fats, Total Workouts, Total Phone Calls,
Movie/Book/Podcast/Course History, Person Notes. INPUT fields keep the natural names (what users
and `[Field]` label tokens reference). Zero duplicate names verified post-reseed; 1289/1289.
Recorded as memory `feedback-unique-field-names` (with `feedback-no-abbreviations` from the same
session). FieldsTab now ENFORCES it (`42c56c21`): Save rejects colliding names (case-insensitive, inline
error), "+ Field" mints unique defaults; labelTokens' carried-field tiebreak stays as a last net.

---

## Handoff — 2026-07-14 (3) (label [Field] tokens; 4-macro meal tiles; per-set weights; full headers)

Third batch (CLAUDE_CHAT 2026-07-14 (3)). Deployed + reseeded:
- **`[Field]` / `{Field}` label tokens (NEW `helpers/labelTokens.js`)** — an instance label
  containing `[Water]` renders the bare LIVE value ("16"); `{Water}` renders name + value + unit
  ("Water 16oz" — the user's "display the field name too" form). Display sites: ModuleInstance
  labels + RepresentationView chips. **Colon write-back (same-day extension)**: double-click
  rename materializes the current value into every token (`Drink {Water:16oz}`); typing a new
  value writes the FIELD on commit (triggerField per write → trackers fire) and the label
  re-stores value-STRIPPED, so stored labels never go stale. Carried-value wins over duplicate
  field names; unknown brackets/braces stay literal ({ProjectName} template tokens safe). Fills
  the INSTANCE gap in the editor↔field binding system — BoundHeader/BoundBody remain the
  whole-slot binding path with linked-sibling sync. 16 tests.
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


