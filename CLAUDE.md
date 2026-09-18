# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---


> **The log is TRUNCATED.** This file carries only the most recent entries; everything older
> lives in [`CLAUDE.backup.2026-09-18.md`](./CLAUDE.backup.2026-09-18.md) — same content, same order, nothing rewritten.
> It was 1,106,326 characters on 2026-09-18, which is past what any session can read, so the
> narrative below stops at **2026-09-16** and the archive picks up at **2026-09-15 (6)**.
> **Grep the archive before concluding something was never done** — it holds ~225 entries and
> every recurring-defect war story this project has paid for. The standing rules, the data
> model and the roadmap are still at the BOTTOM of this file, not in the archive.

### 2026-09-16 (6) — STARDEW NIGHT: the moonlit mountains as a dark skin; and the regex that would have made it light

User: *"lets move on to making a stardew valley darkmode theme using the image i just saved to the
screenshots folder as the background"* (Reddit snapshot tabled by the user the same turn — not built).

**A SIBLING OF DAY STARDEW, NOT A MODE OF IT.** Day Stardew is a LIGHT theme carrying a stack of
parchment-only overrides (near-black `--stardew-ink`, mint headers forced dark) that are exactly wrong on
a night sky. What the two share is the lettering and the type sizes, so those rules now list both skins
and the parchment ones list only day Stardew. New: a `stardew-night` theme block, a
`:root[data-skin="stardew-night"]` token block (parity test covers it), `STARDEW_NIGHT_PALETTE`, and
`public/stardew-night-wallpaper.webp` (the 911 KB png as a q90 WebP, 130 KB — lossless was 725 KB for art
that sits under a scrim).

**EVERY COLOUR WAS SAMPLED OFF THE IMAGE**, not invented: sky #211c28 / #222240 / #22254f → backgrounds
and surfaces, moon #dbd1c1 → the ink, cloud #adb3c5 → secondary ink and grid lines, lit mountain #285c67
(brightened) → primary. The stored-colour band is darker and less saturated than day's, because a
translucent card over indigo at day-Stardew's 70% lightness glows like a sign. Scrim 0.36 against day's
0.52: the art is already dark.

**THE TRAP IT WOULD HAVE WALKED INTO:** `applySkin` set Tailwind's `dark` class with
`!/light|stardew/.test(skin.theme)` — right while "stardew" named one theme, and it reads
`"stardew-night"` as LIGHT, so every `dark:` variant would have rendered its light form over a night sky.
It reads an explicit `LIGHT_THEMES` set now. A/B'd: the old regex fails exactly "Stardew Night is dark".

**VERIFIED ON PROD, and LOOKED AT**, on test grid 2 via `localStorage["moduli-skin"]` — the real
`resolveSkinId` fallback, so no grid's saved skin was written: data-skin/data-theme `stardew-night`,
`dark` on, wallpaper resolving, Silkscreen + VT323 loaded, body rgb(20,18,33) under rgb(241,235,223)
ink, 0 page errors at 1440x900 and 390x844. Screenshots read well at both sizes. The contrast suite now
includes the theme. Client-only deploy (`341a6e95`), no restart.

**Not done: nothing picks it for you.** It is in the Appearance picker (it reads `SKINS`); poms grid's own
skin is unchanged.

---

### 2026-09-16 (5) — JONAH COULD NOT BOOKMARK A LINK OR MAKE A PAGE FROM ONE; and the link importer never learned the lead image

Picked up the other account's session (hit its limit mid-report). The open queue item was the user's:
*"we also need an audit on jonah and make sure he can do all this stuff if i ask (make bookmark
occurances out of a link or make its own page over it ...). we need to make sure any functionality
we added in, jonah can utilize"*.

**THE AUDIT: HE COULD DO NEITHER.** Jonah reaches the app ONLY through `/api/v1` (his tool pack is
thin REST wrappers), and there was no REST route that mints a bookmark at all, while `/import/url`
existed with no tool calling it. Every recent link feature — covers, titles, Reader/Magic shape,
"+ Page" — was socket-only or client-only.

**AND THE ROUTE HE WOULD HAVE USED HAD DRIFTED FROM THE VIEWER.** `/import/url` and the `import_url`
socket handler each carried a private `extractMainContent → wikiHtmlToMarkdown` chain, so neither
got 09-16 (3)'s infobox lead image (Albert Ellis imported with no portrait) and neither took `shape`
(only Magic was possible). Both now read through `utils/linkImport.readLinkForImport` — the viewer's
own `readerFromHtml` — and shape through `buildImportShape`, moved to `services/importShape.js` so a
REST route does not import a socket-handler module. Both also LIST the root: the reader planner does
not push its own, the 09-16 (3) class. `deriveTitleFromHtml` (an undecoded `<title>` twin) is gone.

- **`POST /api/v1/bookmarks`** — server twin of `addBookmarkOccurrence`; `bookmarkRecords` is pinned
  by a test on exactly the keys the renderer reads. It WAITS for `fetchLinkPreview` (no row on screen
  to keep responsive), a dead site still gets a host-named bookmark, a typed label outranks the
  page's title, non-http(s) and missing parents are refused before anything is written.
- **Tools `save_bookmark` + `import_url`** (both confirm-carded, both in the offline allowlist, both
  in the system prompt). `import_url` strips the planned rows from what the model sees — hundreds of
  records a local model cannot use. With no `parentId` the drawer wraps the root in the Imports
  folder like every other import; WITH one it does not (it is already listed — a wrapper would be a
  second home).
- **Three existing tools were rewriting whole `occurrences[]` arrays on top of the server's atomic
  `$push`/`$pull`** — `create_occurrence`, `copy_occurrence`, and `move_occurrence` (which also did its
  own unlink). That is the stale-snapshot clobber this file records repeatedly. A cross-parent move is
  now ONE `parentId` PATCH; only a same-parent reorder writes a list. `create_occurrence` also stopped
  minting the inert `kind:"list"` (2026-07-29).

19 tests, four A/Bs each failing exactly their own case (unlisted reader root, old extraction chain,
inert kind, label precedence). 2,263 server tests, client assistant suites 78, lint 0 `no-undef`,
build clean, deployed, prod HEAD `7350efa5`.

**VERIFIED ON PROD against test grid 2 through the real routes** (a scratch API token, swept after):
bookmark 201 · title "Albert Ellis - Wikipedia" · the dust-jacket cover · listed; reader page 200 ·
2 occurrences · lead image present · listed. Debris read back out of Mongo: 0 modules, 0 tokens.
**Honest gap: the probe's FIRST run crashed on a page response with no `occurrences`, and nothing in
the log says why** — both requests logged, no error line, and it wrote nothing (checked by label,
host label and fileRef). The second run was clean. **Not verified: nobody has asked Jonah in the chat
drawer**, so the confirm card and the model choosing these tools are unexercised.

---

### 2026-09-17 (6) — A DOC TRACKED EVERY MINTED BLOCK IN TWO SINGLE SLOTS; and the video is still not explained

Picked up the other account's session (limit hit at 22:26, mid-edit, `DocContent.jsx` dirty with
`helpers/provisionalMints.js` + its test untracked). Its last user message was *"you can see it
happening in the video, thats proof that the empty textblocks being created by clicking an empty
line is finicky as hell"* — and it was right to stop demanding its own repro, because the video IS
the measurement.

**WHAT IT FOUND IS REAL AND IS WORSE THAN THE REPORT.** `DocContent` held its click-minted
provisional blocks in **two single slots** — `provisionalOccIdRef` (one id) and `mintWritesRef`
(one cancel) — while the registry they feed (`helpers/provisionalTextblock`) is a MAP. One click is
fine; the user clicks several, and then:
```
unmount cleanup   discards only the LAST id  ->  every earlier block LEAKS in the registry
minting block B   cancels block A's writes   ->  a block still on screen loses its local row
```
**THE LEAK IS SILENT DATA LOSS, not cosmetic.** `Editor.persistContent` returns early while
`hasProvisionalTextblock(json)` is true, and that walk asks whether the doc embeds a node whose
occurrenceId is still in `pending` — so **a leaked entry whose node is still in the document keeps
it true FOREVER and the parent document stops saving.** Verified by reading both ends
(`Editor.jsx:528`, `provisionalTextblock.js:130`) rather than inheriting the claim.

**THE SECOND HALF WAS NEVER NEEDED.** The deferred write already re-checks
`isProvisionalTextblock(occId)` before writing, which is the case the pre-emptive cancel was written
for (an abandoned block). Cancelling a DIFFERENT block was always wrong.

`createMintLedger` is that bookkeeping as a testable unit, out of `DocContent` because mounting it
needs the whole grid store. **A/B'd by rebuilding the old single-slot behaviour INSIDE the ledger** —
the honest shape for new code, since a passing suite otherwise only proves the new code agrees with
itself: 4 of 6 fail, each for its own reason (the leak reads `expected 1 to be 3`). **The other 2
pass either way and are NOT counted as coverage.**

**AND IT DOES NOT EXPLAIN THE VIDEO — said plainly rather than folded into the fix.** A leaked
registry entry and a cancelled local write do not make a block on screen refuse to disappear. The
vanish path is `Editor.onBlur → onEmptyBlur → handleEmptyBlur`, and **a block can only blur if it
focused first**, so the open question is which of those two never happened.

**THREE CANDIDATES RULED OUT BY READING, so the next session does not re-walk them:**
```
double-mint on one line   emptyLineAtCaret requires depth 1 + an EMPTY paragraph — it cannot
                          target a line already holding an instanceTextblock
lazy editor destroying    useLazyEditor is setLive(true) only; `live` is genuinely ONE-WAY
  a live block            (CLAUDE.md asserted this; now verified at the line)
mint firing twice         the check is coalesced, deferred, focus-gated, input-gated,
  per click               empty-line-gated and suppression-gated
```

**THE DIAGNOSTIC COULD NOT HAVE ANSWERED IT, AND THAT IS WHY THIS SESSION SHIPPED ONE.** `[mint]`
**recorded into `window.__mintMarks` and NEVER PRINTED** — using it meant knowing to type
`console.table(window.__mintMarks)`, on a report whose whole value is one click from the person who
can see it. And it only ever covered the MINT: the vanish path had **no marks at all**, which is
precisely the half (5) recorded as unexplained. It prints itself now (1200ms after the last mark, so
a mint and the blur that undoes it land in the SAME table) and names both ends — `focus:claimed`
(with which claim site won), `editor:focus`, `editor:blur` (empty? has a vanish handler?),
`vanish:skip` **with the guard that bailed**, `vanish:fire`, `emptyBlur:skip`/`collapse`.
**OFF is completely inert** — no marks, no timer, no print — and that is the contract under test,
because this runs on every click into an empty line. A/B'd: reverting to record-but-never-print
fails both "prints" tests while the three off-is-inert pins pass either way.

**NOT BUILT, deliberately, and the seam is named so it is one session's work.** The defensible fix
if the measurement confirms a missing blur is *"at most one provisional block"* — minting B discards
any still-provisional A — since a provisional block is empty and unclaimed by definition, and typing
commits it out of that state. `embedDeleteRegistry.get(occId)?.()` is the existing seam that removes
the node. **The hazard is ORDERING**: `handleCaretMintTextblock` is handed `nodeStart` by the
caller, so removing A's node first makes B's position stale. That is surgery on the mint path at the
end of a long session, which this file records going badly.

4,437 client tests across 380 of 383 files; the 3 incomplete are the documented OOM family
(`trackerValues` named in the run) — **zero `FAIL`, zero `×`**, and nothing here goes near the
tracker executor. Deployed, client-only so `deploy.sh` correctly reported *"Server unchanged — NOT
restarting"*. Prod HEAD `d5d29467` verified over SSH, index + entry chunk 200, both served chunks
**sha256-identical** to the local build, and all six new marks present in the SERVED
`PagePreviewApp` with three pre-existing controls — **`App` reading 0 for the CONTROLS too, which is
the documented wrong-chunk tell.**

**THE ONE-MINUTE STEP THAT SETTLES IT:** `window.__mintDiag = true` in the console, then reproduce
the video once. The table prints itself and names which guard bailed.

---

### 2026-09-17 (5) — THE `embed: missing` IS PROSEMIRROR'S OWN FILLER; and 0333 verified the field it WROTE, not the field the RENDERER reads

Picked up the other account's session (monthly spend limit, 20:50, mid-wiring). Its open item was the
user's *"it should be a third option in the radial menu"*; four more arrived from a screen recording.

**COPY-LINK IS THE THIRD RADIAL MODE, and the NARROWING is the load-bearing half.** The handle
toggled two ways (`move ? "copy" : "move"`) so copy-link was unreachable, and it drew the **Move**
icon for a copylink row. Only `handleOccurrenceMove` runs `copylinkInstanceToContainer`;
`handleContainerDrop` and `handleDocEmbedDrop` branch on copy and nothing else, and
**`handlePanelDrop` DESTRUCTURES `mode` and never reads it**. So the cycle is over an ALLOWED list and
an instance is the only surface that opts into three. `dragModeItem` is one definition of the menu
row — RadialMenu's default items and ModuleInstance's copy-linked custom list carried two
hand-written copies of the same ternary. **Reported, not changed:** the panel toggle is ALREADY inert
by that table, and narrowing it would remove a control rather than add one.

**THE `embed: missing` IS NOT A STALE POINTER — IT IS A DEFAULT NODE.** `wrapGroup` content is
`moduleEmbed{2,}`. The delete-scrub handled a group dropping to ZERO and not to ONE, and a one-child
group is a document ProseMirror will not accept: on the next load its schema repair **FILLS the
missing required node with a default `moduleEmbed`, whose `occurrenceId` default is `""`**. Measured
out of Mongo on the Watts article:
```
wrapGroup[ moduleEmbed("e027b531…"), moduleEmbed("") ]
```
That is why no later scrub could clear it — **every scrub matches the ids a delete just removed, and
this node names no id at all.** The client has had the right rule since the wrap work
(`detachGroupMember`: *"a group needs >=2 children … when fewer remain it flattens"*); the server's
scrub is its twin and never learned it. It flattens now, KEEPING the survivor — dropping the group
wholesale would delete an embed the user never deleted. **An existing test pinned the bug**
(`expect(...content).toHaveLength(1)`) and is INVERTED with the reason in place.

**AND ONE PRE-EXISTING FIXTURE WAS A SHAPE THE SCHEMA CANNOT HOLD** — `wrapGroup[paragraph, embed]`,
used to test that the walk reaches DEPTH. It now nests in a blockquote, so it tests one thing.

**`0336` repairs the live document, scoped to an EMPTY id and never to "does this pointer resolve?"**
— that second question is the 2026-08-01 (19) regression, where a scrub removed the only node
rendering a surviving sibling. An empty id names nothing BY CONSTRUCTION. Dry run named exactly the
one document measured independently; applied and read back out of Mongo.

**THE CARET THROW IS THE SAME NODE, AND IT IS NOT COSMETIC.** Backspacing an empty textblock hands
the caret to `pos - 1` — inside the previous sibling — and a wrapGroup holds no inline content, so
ProseMirror throws `TextSelection endpoint not pointing into a node with inline content (wrapGroup)`
**BETWEEN the delete and `dropOccurrenceData()`**: the node leaves the document and the occurrence is
never discarded. `helpers/caretLanding` asks the SCHEMA (`node.inlineContent ?? type.inlineContent`)
rather than listing the block types that fail today, so an image, a table row and whatever is added
next are covered. A/B'd — the discriminating sibling fails alone while the paragraph-join case holds.

**`0333` CLEANED THE WRONG FIELD AND VERIFIED IT.** It stripped markdown from inline chip MODULE
LABELS and reported *"21 cleaned, 0 left"* — still true today (1867 inline modules, 0 dirty labels).
But `InstanceTextblockInlineNode` renders `textmapToInlineText(occurrence.textmap)`, and the raw text
lives THERE:
```
{"type":"text","text":"***The Book: On the Taboo Against Knowing Who You Are***"}
```
***A migration that verifies the field it WROTE rather than the field the RENDERER reads can report
success and change nothing on screen.*** `0337` strips the textmaps with 0333's own `stripInlineMd`.

**AND THE FIRST DRY RUN PLANNED 297 ROWS, WHICH THE BEFORE/AFTER DIFF IS WHAT CAUGHT.** The plan
printed only the AFTER; diffing showed **0 rows where content differs** (all pure marker removal) but
65 whose only change was a leading space — and `textmapToInlineText` already collapses whitespace
before painting, so rewriting the user's prose for no visible change is churn. Compared TRIMMED, it
narrows to **21 — the same 21 `0333` found**, which is independent confirmation it is the same set in
the field that renders. Applied, read back clean.

**THE ERRATIC EMPTY TEXTBLOCKS: TWO SINGLE SLOTS FOR A MAP, and the leak STOPS THE DOC SAVING.**
User: *"you can see it happening in the video, thats proof."* They were right, and my "I could not
reproduce it headlessly" was not a reason to stop — the recording IS the measurement. Five probe runs
never reached a clickable empty line (the article's sit below a scroller that moved `0 -> 3902` while
they moved 6px), and that is a fact about the probe, not the bug.

Reading the mint path with the video's symptoms in hand found it. `DocContent` tracked its
click-minted blocks in **two single slots** while the registry they feed is a **Map**:
```
const provisionalOccIdRef = useRef(null);   // the LAST id
const mintWritesRef       = useRef(null);   // the LAST pending write
```
One empty line is fine. The video shows THREE blocks at once, and then:
- **The unmount cleanup discards only the LAST id**, so every earlier block LEAKS in the registry.
  **That is not cosmetic:** `Editor.persistContent` returns early while `hasProvisionalTextblock(json)`
  is true, and a leaked entry whose node is still in the document keeps it true FOREVER — **the parent
  doc silently stops saving and every later edit is dropped.** That is the "finicky as hell".
- **Minting a second block CANCELLED the first's store writes**, denying a block still on screen its
  server row. The `isProvisionalTextblock` guard inside the deferred write already covers the case
  that cancel was written for (an abandoned block), so cancelling a DIFFERENT block was never needed.

`helpers/provisionalMints.createMintLedger` is that bookkeeping where it can be tested — DocContent's
mint path needs the whole grid store, so a source guard pins the wiring (with a control that the mint
path still exists, or "no single slot" also passes against a file with the feature deleted). A/B'd:
reinstating the last-only slot fails exactly the four cases that describe it.

**AND THEN THE SECOND HALF WAS REPRODUCED AND FIXED (2026-09-18): THE MINT FED ITSELF.**
User: *"the clicking around and empty textblock thing is still happening glitchy wise like the
video"*. Armed `[mint]` on prod and clicked ONE empty line:
```
t=11.1  mint:go              <- block 1
t=28.3  editor:create
t=28.9  mint:check-scheduled <- the mint's OWN transaction
t=46.2  mint:go              <- block 2, SAME CLICK
```
The mint replaces the empty line with an ATOM, the caret moves to the NEXT empty line, that
selection update schedules another check ~17ms later — and the click is still well inside the
1000ms input window, so it mints again. On a run of empty lines it walks down them. That is
*"rapidly being created weirdly"* and *"ones will randomly create it on two lines"*, exactly.

**The window only ever asked "was there a gesture", never "has it already produced a block".** It is
CONSUMED by the mint it caused (`helpers/userInputWindow`), so a second block needs a second
gesture. Consuming rather than widening a window is the point: `provisionalTextblock` already
records a blanket time window going wrong in the OTHER direction (*"it also ate the mint at a
DIFFERENT line"*). Verified on the deployed build, same click, same document: `mint:go` once, then
`mint:skip why:no-recent-input`.

**FOUR PROBE FAULTS COST FIVE RUNS BEFORE ANY OF THIS WAS VISIBLE, and each is reusable.**
- **`mintDiag` prints with `console.table`**, so a console filter on the string `[mint]` matches
  NOTHING. Every earlier run reported "0 logs" and I read it as "no mints ran".
- **The doc GROWS while you scroll** (lazy editors go live), so one scroll-to-bottom lands short —
  measured 4256 of a max that was 3968 when set and 5538 by the time it settled. It has to be
  re-driven until the max stops moving. A loop that breaks on `top >= max` breaks too early.
- **Clicking prose lands in a textblock BODY editor**, which is passed `onCaretMintTextblock: null`
  and returns before the first mark — so it can never mint and never says so. Only an empty line in
  a PAGE or CONTAINER editor mints.
- **Comparing element tops across two RUNS** made a working scroll look broken (`2535 -> 2529`).

***And the user was right that a failed headless repro is not a reason to stop: "you can see it
happening in the video, thats proof."* The recording was the measurement; the probe was the thing
that was wrong, four times over.**

**NOTHING WAS LOST, and that is measured rather than reassuring.**
```
block textblocks 717 · empty 54 · empty AND created today  0
```
So the blocks stacking up in the recording were PROVISIONAL — local-only, never emitted, which is the
design working. The backspace throw above provably strands one; **the click-off case goes through
`handleEmptyBlur`, which writes no selection at all, and is NOT explained.** Said plainly rather than
folded into the fix. The lazy-editor theory was checked and is dead: `live` is one-way, so a focused
block stays live and its `onBlur` fires. Next step is one repro with `window.__mintDiag = true`.

**THE QUOTE MARKS** now sit the same distance from the words (open was 9px against the close's 3px),
derived from the prod geometry recorded that morning. **NOT re-measured on screen** — and the probe
is why: `?previewOcc=` mounts `PagePreviewApp`, which reads `window.parent.__moduli_state__`, so
opened TOP-LEVEL it renders nothing (both arms zero, 0 page errors — the documented tell). Driven
through a real iframe it loads, and still does not reach those cards: the preview walks
`occurrences[]`/`parentId` and under-renders textmap-only embeds (2026-08-23 (2)).

2,310 server + 4,424 client tests. **The 3 files that do not finish are the documented OOM family**
(`trackerValues`, `balanceFlow`, `accountBalances`) — verified by running each ALONE, where each
still exits its worker mid-file. Deployed, prod HEAD verified, served CSS sha-matched with a control
non-zero and the old value at 0. **pm2 restarted, and it mattered:** both migrations wrote straight
to Mongo, so the warm cache was still serving the pre-migration values.

---

### 2026-09-17 (4) — A COPY OF A LINKED ROW IS A PLAIN COPY (confirmed); and COPY-LINK IS NOT IN THE RADIAL MENU

User: *"i want to comfirm, if i copy a copylinked occurance (lets say i copy something from tasks
completed and drag it elsewhere), that it creates a copy and not copylink. it should only ever
copylink for feeds or if i do a copy link myself … which im not sure that we have on in the radial
menu. just double check."*

**THE WORRY IS WELL-FOUNDED IN SHAPE, and the drop path is exactly where it would go wrong.** A feed
copy carries BOTH `linkedGroupId` and `meta.feedSourceId`, and `handleInstanceDrop`'s copy branch
hands the helper **the whole source object** (`sourceOccurrence: { ...sourceOcc, fields:
stampedFields }`). If either key travelled: the new row would silently join the linked group (the
server fans field writes across it), and `feedSync` would treat a hand-placed row as one of ITS
copies and sweep it the moment it stopped matching.

**IT DOES NOT, because the builder never spreads the source.** `copyInstanceToContainer` constructs
a fresh occurrence — id, userId, moduleId, gridId, iteration, timestamp, fields, parentId — and
reads `sourceOccurrence.fields` and nothing else. The server agrees:
`createOccurrenceData` sets the key only when the payload carries it
(`...(linkedGroupId && { linkedGroupId })`).

**AND THE FEED COPIES ARE DRAG-LOCKED, which is what makes the user's exact case safe.** `feedSync`
stamps `dragMode: "copy"` on every copy it mints. Measured on all 9 rows now in Completed — 8 of
them sit on a module whose `defaultDragMode` is **move**, so without that per-occurrence lock
dragging one would MOVE it out of the feed container and feedSync would re-mint it:
```
row                                   occurrence.dragMode   module.default   drag does
Sign up for foodstamps                copy                  move             COPY
Therapy with Keith                    copy                  move             COPY
Psych appointment with Angela         copy                  copy             COPY
  … 9 of 9 identical
```

**THE CENSUS SAYS NOTHING HAS LEAKED, on live data:**
```
occurrences carrying a linkedGroupId   949   across 462 groups
  feed copies                           66
  non-feed                             883
groups mixing SEVERAL non-feed members with feed copies    0   <- the accidental-link signature
```

**THERE IS A THIRD LEGITIMATE SOURCE OF COPY-LINKS, and it is not in the user's list: OPERATIONS.**
The 883 non-feed linked rows are almost entirely the Schedule's own `COPY_LINK` pipeline action —
each timeslot is one occurrence shared across every day column (`12:00am` linked across 9 parents),
plus the Todo container and `Sync To Todo List`'s mirror. That is by design and predates this.

**THE RADIAL MENU: the user is RIGHT, copy-link is not there.** Its toggle is strictly two-way —
```
const newMode = entityDragMode === "move" ? "copy" : "move";
```
— so `copylink` is unreachable from it, and `RadialMenu` also draws the **Move** icon for a
copylink-mode row (`dragMode === "copy" ? Copy : Move`), which is actively misleading. **And
`DragProvider.toggleDragMode` — which DOES cycle move → copy → copylink — has ZERO callers**, so
the three-way cycle is dead code.

**Copy-link IS reachable, by two paths, both verified wired end to end:**
- **The occurrence's settings sheet** — `InstanceForm`/`ContainerForm`/`LayoutForm` all offer
  `{ value: "copylink", label: "Copylink (linked occurrence)" }`, and the chain is honored:
  `occurrence.dragMode` → `dragSystem` (`liveData?.occurrence?.dragMode ?? defaultDragMode`) →
  `handleDragStart({ mode })` → `sessionRef.current.mode` → the drop's `isCopylinkMode` branch. Not
  an inert control.
- **The multi-select clipboard** — shift-click a selection, right-click → *"Copy-link N selected"*,
  then *"Paste linked N here"*.

**A/B'd by planting the exact regression** (`...sourceOccurrence` spread into the builder, asserted
to LAND — the first attempt did not, and the assert said so rather than reporting a pass): it fails
exactly the two tests naming `linkedGroupId` and `meta.feedSourceId` while all four controls hold.
The controls are what stop "carries no link" being satisfied by a copy that carries nothing: the
fields ARE carried, deep-cloned, and a **discriminating sibling** asserts
`copylinkInstanceToContainer` on the same source DOES produce a `linkedGroupId`.

**NOT CHANGED, and it is the open question rather than an oversight:** whether the radial should
offer copy-link as a third state (and stop drawing the Move icon for it), or whether the settings
sheet + clipboard are the right homes for a deliberate action. That is the user's call.

### 2026-09-17 (3) — COMPLETED GETS ITS OWN PAGE, and a feed's SCOPE is not its container's PARENT

User: *"could we put tasks completed in a seperate page instead of on the tasks page. that way we
dont have a bunch of duplicates on the page (through copylink)."*

**THE DUPLICATES ARE (2)'s OWN DOING, and that is the honest framing.** `0334` removed the
`hide-completed` filters so a ticked task stays in its dimension container — which is what was
asked for, and which is also what puts the feed's copy on screen BESIDE the original. The feed was
always minting that copy; until 0334 the original was hidden, so only one of the two was ever
visible. Moving the container is the other half of that change, not a new problem.

**THE SHARP EDGE, and it is the whole migration:**
```
feed.scope: "9zU5UYHq5FMn"      <- the TASKS page
```
A feed's SCOPE (what it looks at) and its container's PARENT (where it lives) are independent.
Re-pointing the scope at the new page would leave the feed looking at a page whose only instances
are its OWN copies — and `resolveFeedItems` skips anything carrying `meta.feedSourceId` — so it
would resolve to ZERO and sweep every copy it had. **Completed would empty itself and read as data
loss.** So the container moves and the scope does not, with a post-write assertion for exactly
that, because the failure is silent until the next sync.

**MEASURED BEFORE WRITING, and the census is why this is a re-parent rather than a rebuild:**
```
operations naming the Completed container   0
textmaps embedding it                       0
parents listing it                          1   (the Tasks page)
```

**AND THE CONTROL IS WHAT MAKES THE VERIFICATION MEAN ANYTHING.** Driving the REAL
`resolveFeedItems` over a post-migration dump:
```
scope on Tasks (shipped)          resolves 9 sources  == the 9 existing copies -> next sync is a no-op
scope re-pointed at the new page  resolves 0          <- every copy swept
```
That second row is the mistake the refusal guards against, demonstrated rather than asserted.

**Two A/Bs, each failing exactly its own case:** dropping the scope refusal fails 2, dropping the
idempotency guard fails 1 (a re-run would mint a SECOND page). The plan also adopts a page left by
a partial run rather than minting beside it, and skips the unlist when the Tasks page no longer
lists the container — both half-applied states, both tested.

**Read back out of Mongo, and then RENDERED on prod:** Tasks page 12 -> 11 children and no longer
lists Completed; the new `page/board` "Completed" sits in the same Tasks FOLDER carrying
`filterOverride: {}` (an archive filtered to today is empty every morning), listed by exactly one
parent, pinned to Panel A beside Tasks; 9 copies intact; scope unmoved. On screen: Tasks draws 8
dimension containers / 25 rows with no Completed, the new page draws 1 container / 9 rows, 0 page
errors. pm2 restarted — the warm cache is authoritative for reads and would have re-served the old
parentage.

### 2026-09-17 (2) — THE FEED WAS NEVER WHAT HID YOUR TASK; the scrub reached every tab but the one that deleted

Picked up account3's session (limit hit at 08:42 mid-answer on the Keith copy). Four items.

**THE COPY IS WHERE YOU WANTED IT.** The stray "Therapy with Keith" was in a `Todo` container on an
old Aug 17 Day Page column — the only thing listing it — still `Completed: true`, dated today. Moved
to Emotional, unchecked, both dates cleared, with Duration 60 / Dewey Center / Therapy / Keith
intact. Unlinked from the old parent BEFORE re-parenting, `$pull`/`$push` rather than a whole-array
write.

**AND THE DESIGN AROUND IT WAS DECIDED BY MEASURING WHAT THE FEED ACTUALLY DOES.** The user's first
instruction was to retire the Completed feed for an end-of-day op; three messages later they
reversed it themselves (*"maybe dont do an operation but keep completed as a feed"*), and the code
says why both readings were reaching for the same thing. Two of their three claims are ALREADY TRUE:
`feedSync` sweeps only rows it minted (`meta.feedSourceId`) and says so in its own header — *"only
rows THIS feed minted are ever removed, never a hand-placed child"* — so a container holds a feed
AND hand-placed rows, and a copy you make inside Completed survives being unchecked.
```
what hid the ticked task      a hide-completed LOCAL FILTER on each dimension container
                              rule: $occ.fields.<Completed>.value IS_NOT true, hides: true
what the feed did             minted a copy-link into Completed. It never touched the original.
```
So *"feeds should not be removing the original from its spot"* was right about feeds and wrong about
the culprit. **`0334` removes those 10 filters and nothing else** — and the whole end-of-day op
dissolves with them, because the original never leaves.

**SCOPED BY THE RULE'S SHAPE, NOT BY THE `hide-completed-` ID.** A filter goes only if it HIDES and
its WHOLE condition is one rule reading the Completed field: "hide completed things dated before
today" is a narrower deliberate filter, and dropping it would change what a container shows. Dry run
named exactly the 10 measured independently; **Completed and Via Fluere were correctly untouched**
(they carry no such filter). Three A/Bs — dropping the `hides` check, allowing multi-rule
conditions, resolving the field by NAME without TYPE — each fail exactly one case.

**AND THE DATE HALF NEEDED NO CHANGE AT ALL, which only measuring showed.** User: *"i dont like
completed and date filter"* / *"dont use any filter on those"*. Driven through the REAL
`getEffectiveFilterForOccurrence` over a live dump: the Tasks PAGE carries `filterOverride: {}`,
and the cascade reads an empty override as *clear every filter*, so **`eff={}` on all twelve
children** — the grid's `filter_daily` condition is still evaluated, its right-hand value resolves
to undefined, and every row passes. Three containers carry `filterOverride: null` and three `{}`;
the page had already settled it for all of them. *The filter the report named was real; the layer it
was on was not.*

**THE A/B IS THE CONTROL that makes "everything is visible" mean anything** — replaying ONE
hide-completed filter onto Emotional against the same live dump:
```
after 0334                  6/6 visible
the filter replayed         4/6   HIDDEN: Talk to Angela about Vivance, Therapy with Keith
```
Exactly the two COMPLETED rows, which is the user's report reproduced and then removed.

**AND MY OWN PROBE REPORTED TWO ROWS HIDDEN THAT ARE NOT.** It resolved each CHILD's filter with its
own global walk — and `buildParentMap` keys child -> ONE parent, **last writer wins**, so a task
multi-parented into an old day column's `Todo` (three of Emotional's six are) resolved through THAT
column and inherited its date. **`ModuleContainer` does not work that way**: it computes the
CONTAINER's effective filter once and applies it to every child, which is multi-parent-safe by
construction. Re-run with the renderer's own inputs — container filter + grid named conditions +
`getLocalFilterConditions` — all twelve read `kids N/N`. *A visibility claim measured through a
different walk than the renderer uses is a claim about the walk.*

**ANSWERED RATHER THAN BUILT: deleting the original takes the Completed copy with it.** User:
*"if i were to delete the original then, it would still be minted in completed correct"*. No —
`feedSync` sweeps any copy whose source no longer matches (`if (!wantedSourceIds.has(srcId))
sweep(copy)`). Completed is a live VIEW, not an archive. Worth knowing before deleting something you
want kept there.

---

**THE `***` WAS STORED, NOT MIS-RENDERED.** User: *"the *** arent resolving for markdown like they
should"* → *"the *** was in a minitextblock occurance btw"*. `parseInline` tries `[text](url)` FIRST
— deliberately, so a link wins over a surrounding emphasis run — and then minted the chip with the
label **verbatim**. Every other token in that function is parsed into real marks; the inside of a
link LABEL was the one place the parser never looked. And a chip CANNOT carry a mark even if it did:
it is an occurrence whose text is a module LABEL, a plain string. So the label is stripped through
`stripInlineMd`, which is what container headers already do.
```
inline (link chip) modules on poms grid   1867
  carrying raw markdown in the label        21   "*Billboard* 200" · "***The Book: …***"
```
**`0333` repairs what is already there**, because an importer-only change helps nothing that exists.
**Scoped to `kind:"inline"`, and that is the safety**: 414 modules carry `**…**` in their label and
almost all are the codex `**[annotation]**` markers — `ANNOTATION_RE` keys on exactly that bold
marker, so a blanket "strip markdown from every label" pass would have made every annotation read as
an ordinary quote. Applied: 21 cleaned, 0 left. The control holds — bare `***bold italic***` in
prose still becomes real bold+italic marks.

---

**THE `embed: missing element` A DELETE LEAVES BEHIND: the scrub was right and reached every tab
except the one that deleted.** `socket.to(userRoom(userId))` **EXCLUDES the sender**, and the client
does not scrub its own textmap optimistically — so the deleting tab kept the dead `moduleEmbed` and
kept painting `embed: missing`, and its next edit would echo that stale textmap back and make it
permanent. The same handler already does BOTH emits 100 lines above for the file-placement unlink;
this one never got the pair. Fourth time this file records that exclusion biting.

**Two gaps in the scrub itself, found by reading it rather than by the report.**
`EMBED_TYPES` was missing **`instanceTextblockInline`** — the inline link chip — so deleting a chip's
occurrence left the same junk (a Set lookup is exact; the plural name never matched). And a
**wrapGroup emptied by the scrub** now goes with it: the group is a wrapper around two or more
embeds, and emptied it draws a bare box. It is dropped ONLY when this pass is what emptied it, never
merely because it is empty — its own control test.

**MY FIRST TEST FOR THE SELF-EMIT COULD NOT DISCRIMINATE.** The parent cleanup ALSO emits
`occurrence_updated` for that same doc, carrying the textmap UNSCRUBBED, so filtering on the
occurrence id alone counted both — *"the scrub was broadcast"* would have passed against a run where
the scrub never happened. It matches on the thing under test now: a body that no longer embeds the
deleted id. A/B'd — removing the self-emit fails exactly that one test while the control ("the other
tabs still get it") passes, so a fix that merely SWAPPED the two emits cannot slip through.

---

**THE QUOTE CARD, MEASURED ON PROD BEFORE ANYTHING CHANGED** (test grid 2, the Watts article):
```
card          left 81, width 753
handle group  absolute at the ROW's left edge -> 76..98  = 17px INTO the card
opening mark  card+15 .. card+33                        = 2px UNDER the handle
closing mark  absent
control       an IMAGE card's handle sits at card+5, clear of its content
```
**AND MY FIRST TWO READINGS WERE OF THE WRONG ELEMENT.** The probe resolved the row with
`card.closest(".instance-wrap")` — which climbs PAST the quote's own row into the doc that EMBEDS it
— so it reported the host article's handle. A CSSOM scan for the rule positioning it then found
nothing at all, which is what said the element was wrong (my selector-matching loop also split
compound selectors on commas, so any `:has(a, b)` rule threw and was skipped). Re-measured against
`card.closest(".instance-row")`, the numbers reproduce identically across three cards.

The opening mark moves right past the handle, the handle is nudged right out of the border, and the
closing mark is **inline inside the blockquote** rather than absolute at the card's bottom-right —
that corner belongs to `.artifact-quote-attr`, which is `text-align: right`, so every quote carrying
an attribution would have printed the two on top of each other. **The handle rule is scoped by the
DIRECT chain** `.instance-content:has(> .instance-body > .artifact-card--quote)`: these cards are
embedded in an ARTICLE, so a descendant selector would shove the handle of every ancestor row whose
doc merely CONTAINS a quote — the exact leak the stacked wrap-group rule cost a day for on the same
date. Three A/Bs each fail their own case; verified in the BUILT stylesheet with the old rule at 0
and a control at 1.

**AND THE FIRST VERSION OF THE HANDLE RULE SHIPPED INERT — only re-measuring on prod caught it.**
The marks moved and the handle did not, still at `card-5..17`. The chain is
`content > textcol > body > card`; I had written `content > body > card`, so the `:has()` matched
nothing. **`.instance-textcol` arrived with the ModuleInstance restructure that moved the label into
it, and this is the SECOND selector in this file that level has silently broken** (2026-09-12
records the first — an artifact-card label-suppression rule pointed at `div:first-child`). The test
pins the WHOLE chain now, so a missing level fails rather than matching nothing. *A CSS rule present
in the served stylesheet is not a rule that matches anything.*

**VERIFIED ON PROD, measured and then LOOKED AT** (`screenshots/quote-card-after.png`):
```
              before          after
handle      card-5 .. +17   card+7 .. +29     <- inside the card, off the border
open mark   card+15 .. +33  card+37 .. +52    <- clear of the handle by 8px
text        card+45         card+61
close mark  absent          after the last word, visible
overlap     2px             none
```

### 2026-09-17 — THE PAGE JUMPED BECAUSE A STACKED WRAP GROUP'S CSS REACHED THE GROUPS INSIDE IT; the panel you removed is back; folder pages drag and right-click

**THE JUMPING, reproduced before anything changed.** User: *"i went to move a section outside of a
container in my new page (the alan watts ego and the universe article) … the page start glitching
like crazy. its jumping up and down rapidly."* Read out of Mongo, the drop did not just move "By Maria
Popova" out: it landed on the SIDE of the article's title container and built a `wrapGroup` whose
neighbour is the whole section and whose host is the now-empty title. Rebuilt in that exact shape on
**test grid 2** and measured in a browser:
```
                                  group height states over 4s
current CSS                       2   (7416 <-> 7435px, every few frames)
selectors scoped (in-page CSSOM)  1
```
**The outer group was NOT flipping — it sat stacked the whole time.** Diffing every descendant's box
across frames named the real movers: the image+prose wrap groups INSIDE the moved section, their seams
appearing and vanishing. The outer group's stacked rule is a DESCENDANT selector with `!important`:
```css
.wrap-group--auto-stacked .wrap-group-content > * > :not(:last-child) { float: none !important; width: 100% }
```
so it un-floated every nested group's image. Each then measured "no room", stacked, measured "room",
wrapped — forever. All 75 wrap-group mode selectors now use `> .wrap-group-content`, so a group styles
only its own content. `wrapGroupSelectorScope.test.js` greps the stylesheet for the descendant form and
fails on the old CSS (with a control that the scoped form exists). **Nested groups were always
possible (the importer makes them); this is the first time one sat inside a STACKED group.**

**Your live page still has the wrap group** (section beside an empty title). It stops jumping with the
fix; drag the section onto the empty title container's top/bottom edge, or delete that container,
to get the flat shape you meant.

**THE PANEL "REMOVE FROM GRID" DELETED: restored + guarded.** A right-click on a page row in the Root
tree had no menu of its own, bubbled to the panel's, and "Remove from grid" deleted the whole panel.
Restored on prod from the delete's own SnapshotOp `before` + the 04:17 backup's grid list/layout tree
(guarded by an equality check), pm2 restarted. Now: every tree row has its own menu, the panel menu
ignores `[data-manifest-tree]`, the item reads "Remove panel from grid" and asks first.

**THE TREE AND FOLDER PAGES: drag to reorder, drag into a folder, right-click to add or delete.**
`helpers/treeOrder.js` holds the rules once (they were written out four times in ManifestTree):
`edgeForPoint`, `sortOrderForDrop`, `wouldNestInsideItself`, `isInnermostTarget` (Pragmatic fires
`onDrop` on EVERY nested target, so a page row inside two folders ran three handlers), and for folder
pages `cardZoneForPoint` + `planFolderPageDrop`. **Two tree defects found on the way:** the page-row
reorder checked for drag type `"module"` while page drags are `"page"`, so reordering pages had never
worked; and nested folder targets double-handled one drop. On a folder page the middle of a FOLDER card
files the dragged page there (a sub-folder card moves the folder itself, never into its own
descendant); the rim reorders; an instance or container is never re-filed (a folder `parentId` would
strand it out of the container that renders it). Right-click the background for New board/doc/canvas/
table page; right-click a card for the same, "…inside" on a folder card, Open, and Delete (confirmed,
through the one cascading delete path). `createPageInFolder` moved to `helpers/` so the tree and the
folder page mint the same shape. A/B'd: dropping the fileable guard, the cycle guard or the
folder-card guard each fails exactly one test.

**PROBE DEBRIS on test grid 2 (disposable):** a "WATTS REPRO" page and its 96 imported occurrences, pinned
to Panel C. **Probe lesson:** a socket that never sent `request_full_state` has no active grid, so
`create_page` wrote into a `userId:null` cache — the page was in Mongo and invisible to the grid until
re-sent on a socket bound to the grid.

**NOT VERIFIED:** nobody has dragged a card on a folder page or used the new right-click items in a
browser; the rules are unit-tested and the build is clean.

---

### 2026-09-16 (4) — THE BOOKMARKS YOU MADE NEVER GOT A PICTURE; and REDDIT CANNOT BE READ OR FRAMED

**THE COVER REQUEST WAS NOT ABOUT WIKIPEDIA AND NOT ABOUT A RULE.** User: *"we should either
grabbing a wikipedia logo or the first image for wikipedia article bookmarks. the cover image i
mean."* Censused before writing anything:
```
bookmark modules          1472
  with a cover            1464
  NO cover                   8      <- 3 reddit, 1 wikipedia, 1 youtube, 1 wapo, 1 chopra, 1 blank
wikipedia bookmarks         39      (38 covered, 1 not)
```
**THE FALLBACK BEING ASKED FOR ALREADY SHIPPED.** `coverFromHtml`'s order is og:image → declared
icon → site favicon — literally *"the first image OR the logo"* — authored for `0201` and measured
there. **Re-running `0201` today plans ZERO fetches**, and that article answers with an og:image
right now. Nothing was missing for want of a rule; **nothing ever asked the page.**

**THE GAP IS `0201`'s SCOPE:** it selects `meta.raindropId: /^b:/`, so it has never covered a
bookmark created IN THE APP. All 8 are app-made. Same reason they are labelled by a bare host —
`addBookmarkOccurrence` mints `meta: { external: true }` and fetches neither title nor picture.

**SO THE FIX IS THAT SOMETHING ASKS, in the one place already asking.** `fetchLinkPreview` ALREADY
fetches the page for the title, so the cover costs no second request, and it calls `coverFromHtml`
rather than re-deriving an order. The mint then enriches **fire-and-forget** — the row is already on
screen, so a dead site delays nothing.

**AND IT WOULD HAVE SHIPPED COMPLETELY INERT.** `safeEmit(socket, event, data)` takes THREE
parameters and **DROPS a callback**, so the ack could never fire and nothing would ever have patched
— with every log line reading correctly. Caught by reading the callee. The test asserts the ACK, not
the result, so it cannot regress silently; A/B'd, it fails exactly the 3 ack-dependent cases.

**`0332` backfills the 8** using `0201`'s OWN helpers. Dry run named exactly the 7 the independent
census predicted (8 minus the blank browser). Read back out of Mongo: **1464 → 1470 covered,
wikipedia 39 of 39**; the 2 left are the blank browser (no url) and chopra (404). **`0330` — already
written, already idempotent — then re-ran cleanly** now the pages are reachable: 3 labels, including
`"en.wikipedia.org"` → `"Albert Ellis - Wikipedia"`. No new code for that half.

**A PROBE NOTE: reading the result back with `.find()` returned a DIFFERENT row than the migration
wrote.** There are TWO Albert Ellis bookmarks at the same URL, one already covered — the first match
was not the one under test.

**AND VERIFYING ON PROD FOUND A THIRD TWIN.** `link_preview` returned the title **"- YouTube"** for
a video `0330` had named *"Jung, Alcoholics Anonymous, And Drug Seeking Behaviour"* the same
afternoon: `0330` prefers `og:title` and trims the site suffix, `titleFromHtml` read `<title>` raw.
`utils/pageTitle.js` is that rule in one place. **`titleFromHtml` is deliberately LEFT ALONE for the
Reader/Magic header** — whether that should carry the site suffix is an open decision (09-15 (2)),
and answering it as a side effect of a label fix would be a silent answer to someone else's
question. **My own first version re-typed a fourth `decodeEntities` chain whose `&#0?39;` misses
`&#0039;`** — the shared `utils/htmlEntities.js` exists for exactly that and is imported now.

---

**REDDIT: MEASURED, AND EVERY PATH IS CLOSED. NOT BUILT — it needs a decision.** User: *"reddit
links arent being able to resolve with our browser. raindrops preview allows you to open it inline
in web. why cant we."*
```
Web (iframe)          x-frame-options: SAMEORIGIN        -> blocked, permanently
Reader/Magic (www)    8,476 bytes of JS shell            -> 1 word
Reader/Magic (old.)   302 -> login wall; guarded fetch 403
Archive (Wayback)     no snapshot for either post
Raindrop              rdl.ink/render/<url>  200 image/webp 124 KB
```
**MY OWN FIRST READING WAS WRONG AND THE BYTE COUNT IS WHY.** `old.reddit.com` returned **322,014
bytes** where www returned 8,476, and I nearly concluded old.reddit serves real HTML. It is a LOGIN
PAGE — `<title>` "Welcome to Reddit", 5 reader words, no post title anywhere. *A large response is
not the right response.*

**RAINDROP IS NOT OPENING IT INLINE — it renders server-side and sends a PICTURE**, which 2026-09-12
(2) already retracted the proxy theory for and measured. Re-measured today: still a webp.

**SO THE ONLY WORKING ROUTE IS THE ONE THAT ENTRY NAMED AND DID NOT BUILD:** screenshot it
server-side. **Playwright IS available** (root `package.json`, `^1.58.2`) — *my first probe read only
`server/` and `client/` package.json and reported it absent.* But it is a **root devDependency for
e2e tests**, so shipping this means Chromium on the droplet (~300MB + memory), a render endpoint
with a cache, a Snapshot mode, and an SSRF story (playwright navigates directly, around
`safeFetchUrl`). That is a heavy, hard-to-reverse change to their production box — and the same
question was put to the user in 09-11 (2), where they chose to leave Web mode falling back. **Put to
them again rather than installed unilaterally.**

2,244 server + 4,346 client tests (the 2 incomplete client files are the documented OOM pair,
verified by running them ALONE). Deployed three times, prod HEAD verified each time, `0332` + `0330`
applied to poms grid and read back out of Mongo.

---

### 2026-09-16 (3) — THE ARTICLE'S ONLY PICTURE WAS IN THE BOX WE THROW AWAY, and the previous session measured a different article

Picked up account3's session, which hit its limit at 13:52 mid-investigation. It left **an
uncommitted CSS edit that was syntactically broken**, and that is the first finding: its
"SPECIFICITY IS LOAD-BEARING" paragraph sat AFTER the `*/` that closed the comment above it, so the
prose stood in the stylesheet where a selector goes and swallowed the next `{...}` — which is the
`.radial-handle-icon` rule itself. **The whole adaptive-handle fix would have shipped INERT** with
nothing to say so: the build succeeds and the source reads correctly. Proven by stripping comments
the way a parser does and printing what is left, then verified in the BUILT stylesheet with controls
— and the first grep read 0 for the CONTROL too, the documented wrong-chunk tell (these rules land
in `index-*.css`, not `PagePreviewApp-*.css`).

**THE WIDENED SELECTOR IT WAS WRITING IS ITSELF LOAD-BEARING**, checked rather than assumed:
`ModeIcon` is a lucide component, so `className` lands ON the `<svg>` — the same element
`.module-drag-handle svg` (0,1,1) colours. A bare `.radial-handle-icon` is (0,1,0) and loses. On most
skins the token is an inherited cream that inverts acceptably; Stardew sets it to `#14100a`.

---

**THE WIKIPEDIA IMAGES: THE PREVIOUS SESSION'S CONCLUSION IS RETRACTED, AND SO IS ITS ARTICLE.** It
measured **Eminem** — 10 images in the markdown, 8 image modules in the magic plan, every URL
answering 200 — and concluded *"the failure is downstream of the plan"*. The user's bookmark is
**Albert Ellis** (their screenshot says so), and through the same chain:
```
Albert Ellis   raw 10 <img>  ->  main content 2  ->  markdown 0
Eminem         raw 28        ->  main content 14 ->  markdown 10
```
Nothing downstream was ever wrong. *A measurement of a different article than the one reported is a
measurement of something else* — the 2026-09-15 (6) class from a new direction. **The user's own
screenshots were in `screenshots/` the whole time and named the article in one look.**

**THE CAUSE: `WIKI_STRIP_SELECTORS` REMOVES `.infobox`, AND ON MOST BIOGRAPHIES THAT BOX HOLDS THE
ARTICLE'S ONLY PICTURE.** Eminem survives only because its body is full of inline figures. The strip
is RIGHT — the box is a metadata table, and printing born/died/alma-mater into a reader is worse than
dropping it — so the picture is **LIFTED OUT before the strip** rather than the strip being loosened.
A control test asserts the metadata is still gone.

**THE IMPORT PATH ALREADY KNEW, WHICH IS WHAT MAKES THIS TWIN DRIFT.** `fullMarkdown`'s own comment:
*"Wikipedia's main photo lives in the .infobox, which wikiHtmlToMarkdown strips, so the article body
has no main image"* — fixed there with the REST summary API. **The reader never got the equivalent,
and cannot copy that one**: it holds only the page HTML it already fetched, runs against any site
rather than en.wikipedia, and a second network round trip inside its deadline is exactly the
2026-09-10 (2) regression. `injectLeadBlocks` is now SHARED by both, byte-identically.

**THE WIDEST INFOBOX IMAGE, NOT THE FIRST — measured across seven real articles**, which is what
removed the need for a magic threshold: the lead photo is the widest every time (250px on the
biographies, 288 on Tokyo's montage), a signature trails at 150, chrome icons sit at 20-40. "First"
would take a country article's flag over its map. A/B over the real chain — **exactly +1 everywhere,
the lead image, never doubled**:
```
Albert Ellis  0 -> 1      Eminem  10 -> 11
Carl Rogers   0 -> 1      Tokyo   51 -> 52
```
**VERIFIED ON PROD over a real socket**, each address HEAD'd: Albert Ellis 1 image / 200, Carl Rogers
1 / 200, Eminem 11 with the portrait now leading, first three all 200.

---

**"ADD AS A PAGE" ON THE MAGIC AND READER VIEWS — and the minter had no shape.** `import_plan` has
taken `shape: "reader"|"magic"` since 2026-09-12 (it is what those views render), but `import_text`,
the only handler that WRITES, always ran the magic tree. **The button would have handed you a page
that was not the one on screen** — the drift `import_plan`'s own comment warns about. One
`buildImportShape` now serves both, and the test that matters asserts plan and mint AGREE, with a
control that the two shapes genuinely differ (or "they agree" is satisfied by an argument nothing
reads). It sends the markdown the viewer already has rather than re-fetching: `import_url` was the
obvious call and is wrong twice — it pays for the page again, and it has no shape.

**AND IT FOUND A DEFECT BEFORE SHIPPING IT — PARENTED IS NOT LISTED.** `markdownToModuli` pushes its
own root into the destination's `occurrences[]`; **`planReaderShape` is a pure planner and does
not**, so a Reader-shape page would have landed complete, correct and INVISIBLE. **My first test
only checked `parentId`, which is exactly how that class keeps surviving five repairs.**
`utils/linkRootIntoParent.js` is atomic (`$push`, never a whole-array write) and idempotent (`$ne`
guard), so ONE call serves both shapes rather than a per-shape branch that drifts; the parent update
is broadcast, or the destination renders its old child list until a reload and the button reads as
broken. The picker is the EXISTING one — "save as bookmark" and "add as page" ask the same question.

2,234 server tests, lint 0 `no-undef`, build clean, deployed, prod HEAD verified, pm2 restarted
(server code changed).

**NOT VERIFIED, and it is the honest gap: nobody has clicked the + Page button.** The shape contract,
the listing and the persist are all pinned by tests and A/B'd, but no page has been watched landing
in a container.

**STILL OPEN from the same queue, recorded in `CLAUDE_CHAT.md`:** the wikipedia bookmark COVER
fallback, the Jonah audit (*"make sure any functionality we added in, jonah can utilize"*), and
Reddit links not resolving in the browser.

---

### 2026-09-16 (2) — THREE OF THE FOUR WERE ALREADY FIXED; the fourth took THREE attempts and TWO broken deploys

Picked up the other account's session, which hit its limit at 11:57 **mid-verification** — its last
act was cropping a screenshot of the drag handle it had just changed, and it never saw the result.
Four requests were open (`CLAUDE_CHAT.md`, 2026-09-16). All four were measured on prod before
anything was edited, and **three were already repaired by commits nobody had looked at.**

**`4a0708c4` AND `d7f516b2` FIXED THE QUOTE BORDER, THE HANDLE AND THE LAST TEXTBLOCK'S BOTTOM
BORDER in that session's final 20 minutes.** The scoping commit (`:not(.instance-row *)`) stopped
the notch clipping every NESTED row in its own coordinate space, which is what cut the quote AND ate
the last textblock's edge.

**THE BORDER IS PROVEN BY COLOUR, NOT BY SQUINTING AT A CROP.** Each shot was taken so the row's
bottom edge lands at y=60, and the declared border colour is `rgb(70,56,52)`:
```
y=58   rgb(49, 36, 28)    the card fill
y=59   rgb(70, 56, 52)    distance 0 from the declared border colour   <- PAINTED
y=60   rgb(29, 25, 21)    the page behind it
```
*"There is a line there" read off a 458px crop is an opinion; a pixel's distance from the declared
colour is not.* The handle measured `rgb(255,255,255)` on an `rgba(0,0,0,0.5)` disc with
`filter: none` and `text-shadow: none` — the blur that read as a "highlight" is gone.

---

**AND THEN I BROKE THE FOURTH ONE TWICE, ON PRODUCTION, FOR ~40 MINUTES.** The ask was *"make sure
that the expand for the images, opens it in the viewer"*. Prod measured the defect first —
`.artifact-fullscreen 1 / .artifact-spread 0`, the in-place lightbox — and then:
```
attempt 1  8dfef487   no guard; always openArtifactSpread     prod: spread 0 / fullscreen 0  DEAD
attempt 2  4f232ed2   guard on getOcc(id) resolving           prod: spread 0 / fullscreen 0  DEAD
attempt 3  0e58d060   guard on socket === null                prod: spread 0 / fullscreen 1  OK
```
**Attempt 1 removed the lightbox without the viewer taking over.** `ArtifactSpreadHost` resolves its
owner as `occurrencesById[req.occurrenceId]` off the LIVE store, and a Magic/Reader row is a PLANNED
occurrence that exists only inside an isolated `parentState` (`readerStateFromPlan`) — so the lookup
found nothing and the overlay never rendered. A dead button is strictly worse than the thing it
replaced.

**ATTEMPT 2 FAILED FOR THE EXACT REASON IT EXISTED, and that is the entry.** It guarded by asking
whether the occurrence resolved — and `PagePreviewBody` mounts its OWN `GridActionsContext` whose
`getOcc` reads the isolated plan (`PagePreviewApp.jsx:258`). Inside the reader it cheerfully returns
the PLANNED row, so the guard read it as live and called the viewer anyway. **I wrote a guard about
consulting the wrong store BY consulting the wrong store.** *"Can my context resolve this id" is
worthless when the context IS the isolated one.*

**ITS TEST PASSED ONLY BECAUSE THE FIXTURE WITHHELD THE ROW.** Production does not. The test now
RESOLVES the id in BOTH contexts, so it can never again pass for that reason — which is the whole
difference between a test that pins the contract and one that pins the fixture.

**THE HONEST SIGNAL IS `socket`.** The preview provider hands the subtree `dispatch: noop` and
`socket: null` (`PagePreviewApp.jsx:270-271`), which `BookmarkView` already documents as the
structural isolation — *"there is no path from this subtree to a write"*. **The same nulling that
makes the reader unable to WRITE is what makes the viewer unable to RESOLVE**: one condition rather
than two that can drift, needing no new context a future call site could forget. In the reader the
lightbox is not a consolation prize — it is the only thing that CAN open.

**VERIFIED ON PROD WITH A FRESHNESS CHECK THE EARLIER RUNS DID NOT HAVE:**
```
LOADED CHUNKS ["PagePreviewApp-IxC777SD.js"]   the browser is running THIS build
EXPAND {"spread":0,"fullscreen":1}             PASS — the reader falls back to the lightbox
```

**FOUR OF MY OWN TOOLS LIED TODAY, and each cost a cycle:**
- **The probe's freshness check was an `aria-label` present in BOTH builds** — I introduced it in the
  broken commit, so it could never discriminate fixed from broken. It reports the LOADED CHUNK now.
- **I verified a chunk EXISTED at a URL and called it deployed.** That proves a file is reachable,
  not that the page loads it. The check that means something is tracing the ENTRY chunk's reference.
- **Two greps on `BookmarkView.jsx` silently matched NOTHING** and I nearly concluded it does not
  render the reader at all. That file carries a committed NUL byte, so plain `grep` treats it as
  binary — **a trap this very file documents (2026-09-15) and I hit anyway.** `grep -a`.
- **The full suite was OOM-killed twice** because I ran it alongside the build, then died a third
  time on `--minWorkers`, a flag vitest does not have. `--maxWorkers=2` completes in 326s.

4,367 client tests across 371 files, lint 0 `no-undef` (and `getOcc` is NOT orphaned — the delete
path still uses it). **Probe debris: none** — 0 occurrences touched and 0 created on poms grid
across the whole session, so the address-bar + Magic path plans without writing.

**NOT VERIFIED, and it is the honest gap: the VIEWER half has never been watched in a browser.**
Expand on a real board card opening the spread is covered by a unit test and an A/B against the
exact code that broke — but the Magic article is, by construction, the one page where it cannot
work, so nothing here exercised it.

---

### 2026-09-16 — THE PROSE NEVER WRAPPED UNDER THE PICTURE, and one element is why

User, on the Magic render of the badgerherald article: *"the quotes are being cut off"*, *"the
textblock wraps texts isnt wrapping. the text itself should wrap around that image occurance"*,
*"the lines in the wrap … it needs to shift down 2px"*, and *"can you make the drag handle be white
for dark images … cause that was the issue, i couldnt see the drag handle"*. Four reports, four
causes, all measured on screen before anything changed.

**THE WRAP WAS DEAD AND ONE CLASS NAME EXPLAINS IT.** The wrap CSS deliberately neutralises every
formatting context down the host chain — its own comment says *"this is why the L never happened"* —
forcing `.instance-row`, `.instance-content`, `.instance-body` and `.textblock-card` to `display:
block`. **`.instance-textcol` joined that chain later** (the ModuleInstance restructure that moved
the label in beside the fields) and was never added to the list. Being FLEX it shrink-wrapped, so
its BOX sat beside the float for its whole height and the line boxes could never flow under it.
```
                           before      after
.instance-textcol width    157px       423px
lines BESIDE the float     right 191   right 197   (the float starts at x=213)
lines BELOW  the float     right 192   right 458   (the host's edge is 473, over 35 lines)
```
That second row is the whole report: the text stayed in a 180px column all the way down instead of
reclaiming the page under the picture. **CSS that outlived the DOM it was written for**, which this
file records repeatedly — and the only reason it was found is that walking the host chain printed
every element's width instead of trusting the rule to still match.

**THE 2px WAS ONE MARGIN, NOT A FUDGE.** The notch is cut at `--notch-y: 0` — the HOST box's own
top — so the whole L is only aligned if the host and the float start at the same y. They did not:
```
float top 387.5   host box top 389.5   ->  the notch began 2px BELOW the picture
notch bottom      16.2px under the float, where BOTTOM_GAP says 14
```
So a 2px sliver of the host's top border ran across into the picture's footprint, and the bottom
bar's line sat 2px low. The difference is the host `.instance-wrap`'s own `margin-top: 2px` (the
float's is 0) — the border rule had already zeroed the host `.instance-row`'s margin and never
covered the wrap. **Zeroing it aligns both ends at once, which is why there is no `+2` anywhere in
the JS:** after it, `notchTop - floatTop = 0` and the bottom gap is 14.2.

**THE QUOTES WERE RAW MARKDOWN, AND THE FIX BELONGS IN THE RENDERER.** Two of that article's
blockquotes are a single markdown link, stored verbatim — so the card printed
`[Bodies of two Madison men…](https://…)`, and a URL has no break opportunity, so in a narrow wrap
column it overflowed and clipped. **Stripping the link was my first fix and it was wrong** — the
user: *"those specific quotes are links on the inside that arent be resolved to a link either"*. So
the importer now strips only bold/italic/code and KEEPS `[text](url)`, and `linkifyText` resolves
both markdown links and bare URLs. **Putting the markdown pass in the RENDERER is what also repairs
quotes ALREADY imported**, whose stored text still carries the raw syntax; an importer-only change
helps nothing that exists. Measured after: `rawMarkdown false · links 1 · clipped false`.

**AND KEEPING THE LINK REINTRODUCED A HAZARD THE STRIP HAD HIDDEN.** The attribution split reads a
trailing em-dash clause as "— Author", and a dash inside a URL then tore the quote in half
(`[Bodies buried](https://x.com/a` with an author of `b)`). It masks each link to one opaque token
before splitting. **The same change broke annotations and the full suite caught it:**
`ANNOTATION_RE` keys on the BOLD marker `**[label]**`, which the strip removes — so every annotation
read as an ordinary quote and had its tail torn off as an attribution. The marker is detected on the
RAW text now. *A strip that runs before a detector is a change to that detector.*

**THE HANDLE WAS NEVER MISSING — IT WAS THE THEME'S INK ON A DARK PHOTO.** That is also what the
retracted "the images aren't draggable" report was: measured, the handle's box is x 219-241 inside
an image spanning 214-472, fully opaque, simply invisible. It is white with a dark halo over an
image card now — **white ALONE is just as lost on a bright photo, and this grid has both** — and
scoped to `data-kind="image"` so the quote card, which is a light box rather than a photo, keeps the
theme ink.

Every number above re-measured on prod after deploying. 2,217 server tests across 208 files.
**Not done:** the wrap was verified by geometry and a crop, not by dragging a picture by that handle.

---

<!-- Entries older than 2026-09-16 continue in CLAUDE.backup.2026-09-18.md (2026-09-15 (6) and back). -->

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


