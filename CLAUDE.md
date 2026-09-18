# Moduli

**A modular, event-driven workspace for habit tracking, scheduling, and data visualization.**

> **Read [`CLAUDE_CHAT.md`](./CLAUDE_CHAT.md) at session start.** It's the time-ordered log of user direction across sessions. New direction goes there first before acting.

---


> **The log is TRUNCATED.** This file carries only the most recent entries; everything older
> lives in [`CLAUDE.backup.2026-09-18.md`](./CLAUDE.backup.2026-09-18.md) — same content, same order, nothing rewritten.
> It was 1,106,326 characters on 2026-09-18, which is past what any session can read, so the
> narrative below stops at **2026-09-16 (5)** and the archive picks up at **2026-09-16 (4)**.
> **Grep the archive before concluding something was never done** — it holds ~229 entries and
> every recurring-defect war story this project has paid for. The standing rules, the data
> model and the roadmap are still at the BOTTOM of this file, not in the archive.

### 2026-09-18 (3) — ONE REFUSED DUPLICATE LOST THE WHOLE CREATE BATCH; and the recreation was never the bug

User: *"im not sure why im getting those warnings or the failed to create occurance server_error
either"*, with `[mint]` tables.

**THE SERVER ERROR IS READ OUT OF PROD'S OWN LOG, NOT INFERRED** — and `pm2 list` as root shows
NOTHING: the app runs as the **`deploy`** user, so the log is
`/home/deploy/.pm2/logs/moduli-error-0.log`. Twenty-one identical stacks:
```
create_occurrence error: ReferenceError: io is not defined
  at handleCreateBatch (.../server/socketHandlers/crud.js:1470:39)
```
**`io` IS NOT IN SCOPE IN `crud.js`.** `registerCrudHandlers` destructures `userRoom`/`gridRoom`,
never the server instance — and **this file's own 2026-08-28 (2) entry records catching exactly
that, in exactly this file**, plus `watchRegion` and `ctxGrid` before it. It came back through a
door nobody had used yet: the duplicate-signature refusal, whose "tell the originator" emit is the
only line in the handler that reached for `io`.

**AND IT THROWS INSIDE THE TRY, BEFORE `upsertRows`.** So a batch containing ONE refused duplicate
loses **every legitimate create beside it** — the rows never persist, the client's optimistic copies
linger, and the user gets `server_error: Failed to create occurrence`. A guard against one bad row
was dropping the other 48.

**THE SAME LINE WAS WRONG A SECOND WAY, which is why it could never have worked even with `io`
bound.** It emitted a bare STRING; the client reads `payload.occurrenceId || payload.id` and returns
early on `undefined`. And `socket.to(room)` **EXCLUDES the sender** — the originator is precisely the
one holding the optimistic copy this message exists to clear, so it needs its own `socket.emit`. The
comment above the line said so; the code did neither. Both emits now, object payload.
**4 tests, A/B'd against the restored bug — all four fail**, the load-bearing one being *"does not
take the rest of the batch down with it"*.

---

**THE `[mint]` TABLES SETTLE THE FOCUS BUG, AND THE ANSWER IS NOT WHAT FOUR SESSIONS ASSUMED.** The
node view really is recreated ~200ms after every mint — but the SAME recreation has two outcomes,
and the discriminator is whether the caret had already landed:
```
BAD  (caret landed, claim spent)          GOOD (caret still in flight)
 31  focus:claimed   content-sync         1332  focus:claimed   content-sync
 35  editor:focus          <- landed        ..  (no editor:focus yet)
223  editor:blur    empty=true            1519  editor:destroy / editor:create
223  editor:focus   b93dc523  <- PARENT    1520  focus:claimed   content-sync  <- SURVIVED
236  editor:destroy / editor:create        1532  editor:focus          <- lands
256  focus:none     onCreate  <- nothing
```
*"Empty textblocks losing focus and having it on the next line after"* is that left column. **So the
recreation was never the thing to fix — the spent claim was**, and the cure needs no theory about
why the view was recreated. `Editor`'s vanish-cancel cleanup re-requests the focus claim, so the
recreated view takes the caret back.

**THE DISCRIMINATOR IS ALREADY EARNED, which is what makes this safe.** A vanish pending at unmount
means this component was focused and empty ONE MACROTASK ago — a user moving away cannot produce
that, only a teardown can. Gated on the block still being PROVISIONAL, so a textblock the user
deliberately made and left cannot snatch the caret when it scrolls back into view. **The control is
what stops the fix degrading into the opposite bug:** a test asserts the claim is still SPENT when
the caret lands, or "the claim survives" is also satisfied by a build that never releases one.

---

**BACKSPACE NOW SPENDS ITS GESTURE, because a position goes stale and a gesture cannot.** User:
*"sometimes, when i backspace delete the empty container (from within), it shows up again."*
**SOMETIMES is the diagnosis** — the same backspace reads `mint:skip suppressed` on one line and
`mint:go` on the next. The positional hold is the right rule and it misses intermittently: the mint
check is deferred AND coalesced, so it reads the caret after the delete transaction AND after the
occurrence drop has re-rendered the doc, by which point a pre-delete position describes a document
that no longer exists. The keystroke that REMOVED a block must not also be the recent input that
mints one. Precedent: the mint already consumes the gesture that caused it.

**DELIBERATELY NOT DONE IN `handleEmptyBlur`, and that restraint is the other half of the user's
report.** There the user clicked AWAY, often onto another empty line — a real gesture that SHOULD
mint (measured: `emptyBlur:collapse` at t=3415 → `mint:go` at t=3627, and it works). Consuming it is
*"it removes the old one but never creates a new one"* written by hand. That is the test's CONTROL.
**Nothing else reads this window — grepped, one consumer** — so the blast radius is exactly the mint.

---

**THE `TextSelection ... (doc)` THROW HAS A CONCRETE SOURCE, and it is an ordinary gesture on an
ordinary document.** A textblock is an ATOM, so a doc ending in one has no inline position at
`doc.content.size` and `focus("end")` throws. It comes from **clicking the padding below the
document**. `Editor.jsx`'s padding-click has caught this for months; `DocContent.jsx`'s
padding-click — the same decision one file over — never did. **Two implementations of one question,
only one ever fixed**, which is this file's most-repeated class. `caretLanding.focusDocEnd` is that
decision once, called by both, reporting WHICH branch ran so a doc that can never take an end-caret
is visible rather than silent.

---

**THE CARET NO LONGER SHOWS ON AN EMPTY DOC LINE** (user: *"id like the input cursor to not show up
on an empty line (before the textblock is created) … this should be for outside textblocks, not
inside of them"*). `caret-color: transparent` HIDES it without moving the selection, so the click
still focuses the line and the mint's own focus/recent-input checks are untouched.

**MATCHED ON PROSEMIRROR'S OWN TRAILING HACK, NOT THE PLACEHOLDER PLUGIN'S `is-empty`** —
`prosemirror-view` appends `<br class="ProseMirror-trailingBreak">` to an empty textblock from CORE
(`dist/index.js:1993`, read rather than assumed), so this cannot be switched off by a Placeholder
config change. `:only-child` is what restricts it to an EMPTY line: a paragraph ending in a hard
break carries the same `br` with a sibling before it.

**VERIFIED AGAINST THE BUILT STYLESHEET IN BOTH ENGINES, WITH THREE CONTROLS** — the user is on
Firefox, and a rule present in a stylesheet is not a rule that matches anything:
```
                    chromium        firefox
doc-empty           transparent     transparent   <- the target
doc-prose           visible         visible       <- prose still shows a caret
doc-hardbreak       visible         visible       <- :only-child does its job
block-empty         visible         visible       <- "inside textblocks, not outside"
chip-empty          visible         visible
```
**AND MY FIRST GREP OF THE BUILT CSS READ AS "THE RULE IS MISSING".** The minifier rewrites
`transparent` -> `#0000`, and `grep -o "caret-color:[a-z]*"` cannot match a `#`. *Grep the built
value VERBATIM, not a token you assumed it would keep* — the same trap this file records for
`flex: 0 0 auto` -> `flex:none`.

---

**STILL UNEXPLAINED, and said plainly: what recreates the node view.** `nv` incrementing proves
ProseMirror recreated it rather than React re-rendering, and the parent doc logs **no `onUpdate`**
between the mint and the recreation — so it is not a doc transaction. The re-claim makes it
harmless; it does not explain it.

**AND I BROKE `Editor.jsx` PUTTING AN IMPORT IN.** My inserter took "the first newline after the
first `import `", which landed INSIDE a multi-line `import {` — the near-duplicate-anchor class from
2026-09-03, one variant over. Seven test files passed anyway (none import Editor); the eighth failed
on the esbuild transform, and **the source-guard test read the file as TEXT and passed straight
through a syntax error.** A source guard cannot see a broken parse; the build is what says so.

**NOT VERIFIED, and it is the honest gap: nobody has clicked an empty line since.** Every fix here
is A/B'd with the mutation asserted to land, and the caret rules are measured in two real browsers —
but the focus re-claim only runs on a real teardown, which no test can mount. **And one case is
worse on purpose:** a line whose mint is deliberately suppressed (the one backspace just vacated)
now shows no caret either, so it reads as dead until you type. That is what was asked for; it is one
CSS rule to revert.

---

### 2026-09-18 (2) — THE MINT IS WATCHED WORKING ON PROD, and every page load was minting an invisible day page

Picked up this session's own open gap. Four commits had shipped and been deployed after the entry
below was written — the focus claim surviving a re-mount, a positional backspace hold, a vanish that
a teardown must not trigger, and a doc that must not end with an atom (`cad16186` `2a5b9e11`
`a6df87d0` `a1230349`, prod HEAD verified). **Their own commit messages carry the reasoning; what
none of them had was a single click.** That is what this entry is.

**WATCHED ON PROD, and it is the whole user spec in one table.** Clicking the trailing empty line of
a doc page (`viafluere.com`, the live grid, 0 page errors):
```
t=0      editor:focus b93dc523            the page editor
t=23.3   mint:go                          <- ONCE. the 09-18 gesture-consume fix holding
t=42.8   focus:requested e69b921b         <- the claim, BEFORE the create
t=62.5   editor:create   e69b921b inst=9
t=63.4   focus:claimed   at=content-sync  <- HEARD. this is the defect the entry below fixed
t=64.0   nodeview:mount  e69b921b nv=1
t=64.8   mint:tail-paragraph at=16        <- a1230349, on the LAST line, which is the reported case
t=95.5   editor:focus    e69b921b         <- THE BLOCK TOOK THE CARET
blocks on screen 0 -> 1
```
Then clicking away: `editor:blur empty=true vanishes=true` → `vanish:fire` → `emptyBlur:collapse
pos=15` → **blocks 1 -> 0**, with `nodeview:unmount` arriving 229ms AFTER the collapse — so
`a6df87d0`'s cancel-on-unmount did not swallow a real click-away, which is the control that change
needed. *"each click should negate the last empty textblock … but when clicked off and empty, it
should disappear"* — both halves, measured.

**AND THE ~200ms RE-MOUNT DID NOT REPRODUCE.** Three commits name it as the last unexplained thing
and as upstream of everything they fixed. Across the whole captured window — the table flushes 1200ms
after the last mark, so anything inside ~1.3s would be in it — there is **no `editor:destroy`, no
`nodeview:unmount`, no second `editor:create`.** Said precisely rather than claimed as fixed: this is
one page and one flow, and the user's capture was a different doc. What it does establish is that the
churn is not intrinsic to the mint path.

**NOTHING PERSISTED, WHICH IS THE CONTRACT.** Read back out of Mongo: both provisional occurrences
(`eaa4f793`, `e69b921b`) are **absent**, and the host doc's `updatedAt` predated the run — so the
parent's save was correctly held while a provisional block existed. *A block that is never emitted
leaves no row and does not dirty the doc that hosts it.*

**FOUR MORE PROBE FAULTS, and each cost a run.** The five earlier sessions that "never reached a
clickable empty line" were right about the symptom and the causes are now named:
```
a tagged DOM node          ProseMirror STRIPS unknown attributes on re-render, so
                           `data-probe-line` was gone before the click — carry the target
                           as an (editor index, child index) pair and re-resolve it
getBoundingClientRect      reports a box for a CLIPPED element. The line read y=987 in a
                           1000px viewport and `elementFromPoint` there returned
                           `DIV.page-shell` — verify with elementFromPoint, never the box
"visible prose" filtering  skipped the ONE editor that mints: a page editor's children are
                           big nodes plus a trailing empty line, with no prose paragraph
the trailing line is h=0   it un-collapses on hover — hover its own position first, then
                           RE-MEASURE (the hover moved it 20px and the stale y clicked out
                           of the viewport)
```
**And the mint-wired editor is found BEHAVIORALLY, not by DOM class.** Only `DocContent` passes
`onCaretMintTextblock`, and it passes `null` whenever `onExitBlock` is set. A mint-wired editor marks
`mint:check-scheduled` on EVERY selection update — so clicking each candidate and reading the marks
answers it in one pass. Measured: **8 of 9 editors on that page are not mint-wired**, which is the
documented "clicking prose lands in a body editor" fault with a number against it.

---

**AND THE PROBE FOUND SOMETHING BIGGER THAN IT WENT LOOKING FOR: every page load mints an ORPHANED
DAY PAGE.** Counting what appeared while probing:
```
occurrences created in one hour        96      ~7 per load, 0 feed copies
their shape   1 root with NO MODULE + ~6 sections (Journal, Notes, Daily Question,
              Daily Answer, Tasks Completed), each carrying its daypage:* signature
the root      identitySignature: null   listedBy: 0   <- unreachable, so the next load
                                                        cannot find it and builds another
grid-wide     79 module-less roots · 107 children · 0 of the first 40 listed by anything
by day        07-18: 40 · 07-28: 1 · 07-30: 1 · 09-17: 2 · 09-18: 35
day columns   52, and SIX dates carry two (09-09, 09-12, 09-13, 09-15, 09-16, 09-17)
```
**The mechanism is the documented create/disconnect asymmetry** — `create_occurrence` is queued
server-side and bails at every stage on disconnect while the module write is not — so a load that
ends mid-burst leaves a module with no occurrence or an occurrence with no module. `sweepOrphans`
named the other half in the same run: 68 orphan MODULES labelled *"Friday, September 18th, …"*, i.e.
day columns whose occurrence never landed.

**MY OWN PROBE IS MOST OF TODAY'S 35, and saying so is the point.** Thirteen runs each closed the
browser seconds after the click — *"a probe that loads the live grid can trigger the day rollover.
Keep it open, or expect to repair"* (2026-07-30 (2)), walked into thirteen times in one afternoon.
**The leak is the app's and predates this session** (09-17 has 2, July has 42); the acceleration is
mine.

**SWEPT, with the tool refusing exactly what it should.** `sweepOrphans --apply` removed 4 empty +
unreachable module-less occurrences and 68 orphan modules (72 dumped to `backups/orphans/` first) and
**KEPT every root that would strand a child**, plus the recent day-column modules whose placement may
still be in flight. No pm2 restart: whole unreferenced documents were deleted rather than an
`occurrences[]` array repaired, so the warm cache has nothing stale to re-serve (the 2026-08-01 (18)
distinction). poms grid ends at **2 errors** — 33 module-less roots the sweep correctly declined, and
the 2 pre-existing `container-filtered-empty`.

**NOT FIXED, deliberately: `Day Page: Build` still mints an unreachable subtree on a load that ends
mid-burst.** That is a shared op writing live data, and the honest next step is the one the data
already points at — the root is created without a resolvable module and nothing lists it, so merge's
signature scan cannot see it. It wants its own reviewed pass, not the tail of this one.

74 mint tests across 7 suites green. The archive took the four oldest 2026-09-16 entries to make room
for this one — 4 headings moved, live 43 -> 39, archive 225 -> 229, each asserted present in exactly
one half.

---

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

### 2026-09-18 — THE CLAIM WAS MADE TOO LATE TO BE HEARD; and CLAUDE.md was 1.1M characters

Picked up the other account's session, which died on **"Prompt is too long · automatic compaction
failed"** — this file at **1,106,326 characters** was the cause. Archived first, at the user's ask:
`CLAUDE.backup.2026-09-18.md` holds every entry from 2026-09-15 (6) back, VERBATIM. Split, not
summarised, and verified rather than assumed — **305 headings = 49 live + 256 archived, zero lost,
zero in both**, with each half asserted to be a substring of the original. 1,106,326 -> 91,846.
*A log past what a session can read is the same as no log, except it also costs the context it
does use.*

**THE USER GAVE A SPEC, and it is the deliverable:** *"each click should, negate the last empty
textblock, and then focus on a new textblock. but when clicked off and empty, it should
disappear."* Plus two new specifics — the new block is **NOT focused**, and a vanished one **comes
back**.

**THE FOCUS CLAIM WAS MADE AFTER THE TRANSACTION THAT IT HAD TO BE HEARD BY.**
`editor.view.dispatch` runs handlers SYNCHRONOUSLY and the sub-editor claims the caret in its own
`onCreate`, so `requestTextblockFocus(occId)` sitting after the dispatch can arrive too late to be
seen. **And that single ordering explains BOTH halves of the report**: the block mounts unfocused
(*"it creates a textblock (not focused)"*), and the vanish path is `onBlur` — **a block that never
focused never blurs, so it never disappears.** The file already knew the rule and applied it to the
registry entry ten lines up: *"REGISTER BEFORE the transaction ... an entry added afterwards is too
late."* The caret claim has the identical requirement and was left after it.

**AND THE MINT NOW STATES THE INVARIANT RATHER THAN RELYING ON THE BLUR.** A provisional block is
empty and unclaimed BY DEFINITION — typing commits it out of the registry on the first character —
so when a new one is minted every other one is garbage the vanish path failed to collect.
`planStaleCollapses` runs in the **SAME transaction as the insert**, which removes the ordering
hazard rather than managing it: `nodeStart` was computed by the caller against the pre-edit doc, so
collapsing first would invalidate it. Planned against `tr.doc` and applied **DESCENDING** —
replacing at one position shifts everything after it, so a top-down plan invalidates its own later
entries. Back to an empty LINE, never deleted: the user clicked that line.

**ONE OF MY OWN GUARDS WAS VACUOUS AND ONLY THE A/B SAID SO.** The "claimed before the dispatch"
assertion used a bare `src.indexOf`, which matched the **AUTO-CREATE path's** claim earlier in the
file — before every dispatch, so it **passed against the exact defect it exists to catch**. Scoped
to the mint's own body it fails correctly. *An ordering assertion over a whole file is a claim about
which occurrence you matched.* Every other mutation discriminates with the change asserted to land:
ascending order fails 2, collapsing the just-minted block fails 6, and dropping the `isPending`
check — the guard that stops this touching writing the user did — fails EXACTLY its own one test.

**THE DIAGNOSTIC IS ON BY DEFAULT** (`window.__mintDiag = false` mutes) — a report should cost the
person seeing it no setup. Three marks were added for the three things they described, and one of
them exists because the case was **SILENT**: `focus:none` fires when a provisional block mounts with
NO outstanding claim, which is precisely what a late claim produces and which neither existing
branch reported. `focus:requested` dates the claim against `editor:create`; `block:zombie` names a
node whose occurrence resolves from neither the store nor the registry — the shape of *"it will pop
up again randomly"*, i.e. the parent textmap re-synced from a copy that still embeds it.

4,456 client tests across 382 of 385 files, **zero failures** (the 3 incomplete are the documented
OOM family). Deployed; client-only, so `deploy.sh` correctly reported *"Server unchanged — NOT
restarting"*. Prod HEAD `9dbba40f` verified over SSH, index + entry chunk 200, the served
`PagePreviewApp` **sha256-identical** to the local build carrying all five new marks with three
pre-existing controls, and `__mintDiag!==!1` in the served bytes with **zero** of the `=== true`
form — so it really is on.

**NOT VERIFIED, and it is the honest gap: nobody has clicked two empty lines on the deployed
build.** The ordering fix is reasoned from the synchronous dispatch and pinned by a source guard;
the collapse is pinned by a pure planner. Neither has been watched. One click each way with the
console open settles it, and the table prints itself.

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


