# server — Server CLAUDE.md

_Updated: 2026-07-07. Check this file before re-reading source._

## Recent Changes (2026-07-10 — pomodoro trackers: bare `label IS "Pomodoro"` never matched sessions)
- **Root cause (verified on the executor):** a pomodoro session is COPY_LINK'd with no
  per-occurrence label, and a bare `label` rule doesn't resolve to the module label in these
  contexts — so every `label IS "Pomodoro"` rule failed. Effects: (1) **Pomodoro History** never
  filled (bare `label` in a loop `as $inst` — the other rules use `$inst.`; History `[]` while
  Pomodoros Today `1` on the same session); (2) **Pomodoro: Complete / Stop** couldn't FIND the
  open session to stamp `Completed:true`, so completion-gated trackers zeroed on reload (user:
  "only updates with Schedule in view … zeroing out on reload").
- **`scripts/createLiveData.js`** — all 3 bare `label IS "Pomodoro"` rules → the
  `pomodoroNumber IS_NOT_EMPTY` presence discriminator (what Pomodoros Today already uses; the
  session always carries it). History loop uses `$inst.fields.<pomoNum>.value`; the FINDs use the
  bare `fields.<pomoNum>.value`. Verified: swapping the rule makes History fill
  (`[{minutes:25,…}]`). Applied to the live DB via idempotent `scripts/patchPomodoroLabels.js`
  (media trackers use `$watchInst.label` etc. — prefixed, NOT affected).

## Recent Changes (2026-07-09 — tracker calc audit: completion gate on Volume/Reps/Nutrition)
- **Audit** of all 44 goal/tracker ops (completion gate / date-period / feed / scope). Findings:
  the 6 per-muscle **Volume** trackers, **Total Reps**, and the 4 per-meal **Nutrition** trackers
  aggregated regardless of the workout/meal being COMPLETED — every other numeric tracker
  (Steps/Water/Protein/Carbs/Fats via makeTrackerOp) gates on `Completed IS true`. User hit it:
  "it added the total weight volume even though i didnt complete the workout." (The earlier "180"
  bench was a STALE feed-triple-count value; the feed guard already fixes it on recompute — verified
  by booting the executor on a live snapshot: fresh onLoad excludes feed copies.)
- **`scripts/createLiveData.js`** — added `{$item.fields.<completed>.value IS true}` to the inline
  per-muscle Volume loop guard (MUSCLE_GROUPS) and the per-meal Nutrition loop guard (mealCategory).
  Total Reps passes the new `requireCompleted: true`.
- **`utils/liveSystemBuilders.js` (`makeTrackerOp`)** — new `requireCompleted` param overrides the
  per-agg completion default; the `multiSum` branch honors it (`includeCompletion: requireCompleted
  === true`). Other multiSum callers unaffected (there are none). Verified on the real executor: an
  UNCOMPLETED bench no longer bumps Chest Volume (stays 90, was wrongly 120); Total Reps guard emits
  the gate. **Reseed (or in-place op patch + server restart) required to apply to the live grid.**
- OPEN (flagged, NOT changed — may be intentional): **Total Workouts** + **Total Reading Time** use
  `timeFilter:"all"` (all-time counters, "Pages pattern") so they ignore the active date filter.

## Recent Changes (2026-07-08 — Occurrence.feed schema + feed replaces Table:/Canvas: Build)
- **`models/Occurrence.js`** — new `feed` key (Mixed, default null): the materialized pull-query
  config (client engine: helpers/feedSync.js). Declared so strict mode doesn't strip it on
  update_occurrence's spread merge.
- **`scripts/createLiveData.js`** — `Table: Build` + `Canvas: Build` ops DELETED (68 ops).
  Schedule Table + Schedule Canvas page occs carry seeded feeds (scope = Schedule page, sort by
  Time Slot) and now INHERIT the date cascade (filterOverride null, was {}). Table's Goal column
  removed (it embedded a per-row goal copy only the op could mint). All `$item._ancestors
  HAS_ANCESTOR`-scoped trackers gained `meta.feedSourceId IS_EMPTY` (feed copies never aggregate).
- **`utils/liveSystemBuilders.js`** — same feed-copy exclusion rule in makeTrackerOp's loop rules.

## Recent Changes (2026-07-07 — image search/upload routes + reseed stale-grid sweep)
- **`server.js`** — two new app-internal routes for the client's ImagePickerMenu (same auth class
  as `/api/artifacts/upload`):
  - `GET /api/images/search?q=` — keyless web image search proxy. Primary: DuckDuckGo images
    (two-step vqd-token flow, browser UA headers); fallback: Wikipedia pageimages. Returns
    `{ results: [{ image, thumbnail, title, width, height, source }], source }`. Picked URLs are
    stored directly in field values / `module.fileRef` (external URLs pass through
    `resolveFileRef` verbatim; `scripts/mirrorRemoteImages.js` can localize later).
  - `POST /api/images/upload` — bare image upload: stores under `uploads/user/YYYY-MM/` and
    returns `{ fileRef, url }`; mints NO module/occurrence (for images that become FIELD values —
    person photo, movie poster — vs standalone artifacts). Rejects non-image mimetypes.
- **`scripts/createLiveData.js`** — new exported `sweepStaleGrids(userId)`, called on every
  DEFAULT (non `--clear`) reseed after `dropExistingLiveGrid`. Deletes grids with ZERO panel
  occurrences that are NOT 1×1, plus their scoped docs. Partial/interrupted reseeds leave
  unnamed 2×3 skeletons that accumulate (user hit this 2026-07-04 AND again 2026-07-07:
  "there shouldnt be 3 grids, only two"). Deliberately preserved: the user's empty 1×1 scratch
  grid (0 panels but 1×1), the Live Grid, any grid with panels. One stale skeleton
  (`6a46fabd…`, 2 orphan occs + 1 manifest + 1 folder) was swept from prod Atlas directly the
  same day; seed re-exported (grids.json now carries exactly 2 grids).


## Recent Changes (2026-07-07 — full operations audit + People: Show Profile fix)
- **All 70 ops audited** (report: `docs/op-audit-2026-07-07.md`). Methods: static pipeline
  validation vs seed, headless load sweep (58 ops, 0 errors), REAL value-change UI tests
  (completed toggle → Tasks Completed 0/10→2/10; water 5 + complete → Daily Water 0→5oz;
  due-date edit → Days Until Due recompute; protein edit fanned to all 3 linked copies), and
  API dry-runs of every op via `/api/v1/operations/:id/run` (66/70 ok; 4 expected-fails:
  2 GET_USER_INPUT suspensions + 2 drop-trigger ops refusing manual context).
- **`scripts/createLiveData.js` ("People: Show Profile") FIXED** — its APPLY_TEMPLATE used
  `templateId`/`targetId`, keys the executor never reads (`templateRef`/`targetOccurrenceVar`),
  so the action silently no-op'd since it was seeded. Reseeded + verified (dry-run stages the
  template clone now).
- Findings (unfixed, see report): Wellness Score occurrence is written by NO op (shows -/0
  forever); bootstrap-token mints an "assistant (auto)" ApiToken per page load when the running
  server's env token is stale vs the DB (120+ rows piled up — restart server after minting, or
  prune); client `save_op_run_log` emits to a server handler that no longer exists.

## Recent Changes (2026-07-06 LATE — perf audit: WS deflate + HTTP compression + cache headers)
- **`server.js` (io options)** — `perMessageDeflate: { threshold: 1024 }`. Socket.io v4 ships WS
  compression DISABLED; full_state is ~1.9MB of JSON (854 occs live grid, textmaps decompressed)
  and Cloudflare does NOT compress WS frames — deflate cuts it ~85% on the wire. Threshold skips
  tiny per-field events. Verified: handshake echoes `Sec-WebSocket-Extensions: permessage-deflate`
  and an authenticated full_state round-trips clean (854 occs / 785 mods / 70 ops).
- **`server.js` (express)** — `app.use(compression())` right after cors (new `compression` dep).
  Gzips API JSON + static when Cloudflare isn't in front (LAN/tablet direct-IP access). Measured:
  App chunk 284KB → 82KB over the wire.
- **`server.js` (static cache headers)** — client dist: `assets/*` (content-hashed) →
  `public, max-age=31536000, immutable`; `index.html` + other root files → `no-cache` (deploys
  take effect immediately). `/uploads`: `md/` + `thumbnails/` are REWRITTEN under the same name →
  `no-cache`; everything else has timestamp-random names → 30d immutable.
- No reseed; **server restart** (and `npm i` in server/ for the compression dep) to apply.

## Recent Changes (2026-07-06 — Importer: stop emitting dead `wrap`/`anchor` wrapGroup attrs)
- **`services/markdownImporter.js` (lines 225-230, 251-253, 239, 256)** — removed `anchor: "top"` and `wrap: false` from both wrapGroup `attrs` emissions (lead aside and section image pairs). The client's `WrapGroupNode` always wraps when neighbors exist and never reads these attrs — they were dead knobs. New attrs: `{ side: "right", anchorIndex: 0, neighborWidth: 320|260 }`. Replaced the stale comments explaining wrap/anchor behavior with clarity on neighbor-first ordering and the draggable seam owning resize.
- **`server/__tests__/markdownImporter.test.js` (tests at lines 497, 531, 575)** — updated 3 test cases: (1) renamed "wrap:false, no L-morph" → "neighbor-first wrapGroup"; (2) removed `expect(attrs.wrap).toBe(false)` + `expect(attrs.anchor).toBe("top")`; (3) added assertions for `attrs.side === "right"`, `attrs.anchorIndex === 0`, `attrs.neighborWidth === 320|260`, and `expect(attrs).not.toHaveProperty("wrap")` + `expect(attrs).not.toHaveProperty("anchor")`. All 222 server tests pass; 39 markdownImporter tests green. **Importer behavior unchanged — clients already ignore the dead attrs; existing docs keep them until re-imported.**

## Recent Changes (2026-06-28 — FIX: raw `<table class="wikitable">` DOM dumped as literal text)
- **`services/wikipediaTools.js` (`wikiHtmlToMarkdown`)** — added a `wikiTable` turndown rule
  (filter `"table"`). **Root cause:** `turndown-plugin-gfm` calls `keep()` for any `<table>` whose
  first row isn't a PURE heading row (`isHeadingRow(node.rows[0])` — see the plugin's
  `turndown-plugin-gfm.cjs.js:132`); a `keep`-matched node is emitted as RAW HTML verbatim. A
  Wikipedia content table like "Literary works" has a `<caption>` (so `rows[0]` / the heading-row
  check fails) → the entire `<table class="wikitable">…</table>` survived into the markdown and
  rendered as literal text in a textblock. The new rule converts EVERY table to a GFM pipe table
  (header + `---` separator + body, cells = `textContent`, `|` escaped); a `<caption>` becomes an
  `### ` heading above it so the title survives. turndown's `add` UNSHIFTS (later rule wins) and
  checks `this.array` BEFORE `this._keep` (`turndown.cjs.js:289-295`), so this rule beats gfm's keep
  AND gfm's own table rule. Placed BEFORE `wikiPullQuote` so `.quotebox`/`.cquote` tables still route
  to the blockquote rule (wikiPullQuote added later = front-most). `.infobox` tables are already
  removed by `WIKI_STRIP_SELECTORS` before turndown, so no double-infobox. The downstream
  `markdownToModuli` pipe-table parser turns the result into a `kind:"table"` container. Regression
  test in `__tests__/htmlToMarkdown.test.js` ("content tables become pipe tables …"). 222 server
  tests pass. **Server restart + re-import to apply.**

## Recent Changes (2026-06-28 — FIX: LINK bullets rendered empty / dropped their title (double-nested chip flattened))
- **`services/markdownImporter.js` (`buildContainer`, bullet `c.kind === "board"` branch)** —
  every bullet item was wrapped in a `buildInlineTextblock` mini-textblock whose textmap held
  the item's inline content. For a LINK bullet (`[text](url)`), that content is a nested
  `instanceTextblockInline` chip — but the client's inline renderer
  (`InstanceTextblockInlineNode.textmapToInlineText`) flattens a mini-textblock to PLAIN TEXT
  only (atom chips have no `.text`/`.content`), so the chip was silently dropped. Symptoms on the
  Eminem import: Discography entries `[Album](url) (1999)` rendered as just " (1999)"; pure-link
  "See also" / influence entries rendered EMPTY (`...` bullets). Fix: an item whose `parseInline`
  result contains a link chip now renders that inline content DIRECTLY in the `listItem` paragraph
  (like prose, which already worked) instead of wrapping it in a mini-textblock. Plain-text items
  still get the draggable mini-textblock wrapper (preserves the existing design + tests). Regression
  test added; one stale test (asserted the old per-item double-nesting) updated. 39 importer / 221
  server tests pass. **Server restart + re-import to apply.**

## Recent Changes (2026-06-15 — FIX: lead aside is now a STRUCTURAL child of the root (empty preview column / unreachable lead image))
- **`services/markdownImporter.js` (root `buildContainer`)** — the lead **aside**
  container (`asideId`, the image+infobox column) was referenced ONLY through the
  root's textmap (`buildSectionBody` front-pushes the wrapGroup embed); it was never
  added to the root occurrence's `occurrences[]`. So it had NO `parentId`/`occurrences[]`
  edge → an ancestry/cascade-delete orphan AND invisible to any consumer that walks the
  occurrence tree without parsing textmaps. The folder-page **preview** (`PagePreviewApp`
  `PagePreviewBody`) scopes its state by walking `occurrences[]`/`parentId` only — so the
  aside (and the lead image rendered inside it) was dropped from the preview subtree,
  rendering the **empty second column** the user reported on the Eminem import; the image
  only appeared after drilling into the real page (full, un-scoped state). Fix: one line —
  `childIds.push(asideId)` after `buildAsideContainer(...)`. `buildSectionBody` already
  skips `id === asideId` in its main loop, so NO double-render. Regression test in
  `__tests__/markdownImporter.test.js` ("the aside is a STRUCTURAL child of the root …")
  walks the subtree the preview way and asserts the lead image is reachable + the aside
  embeds exactly once. 37/37 importer tests pass. **Server restart + re-import to apply**
  (importer change; existing imports keep the old orphaned shape until re-imported).

## Recent Changes (2026-06-12 — lead aside reverted: neighbor-first wrapGroup → PARENT-LEVEL FLOAT)
Per user ("account2 is wrong, do the most recent one") the Wikipedia **lead aside** (main
image stacked over the infobox) is NO LONGER a single-host `wrapGroup`+seam. It's now a
**parent-level CSS float**: the aside is emitted as a right-floated block at the FRONT of the
root section and ALL prose textblocks flow as plain sibling blocks AFTER it, so the whole left
column wraps beside-then-under the infobox (magazine lead, responsive, no fixed heights, no
host coupling). The single-host wrapGroup only wrapped ONE block — the user's bug.
- **`services/markdownImporter.js` (`buildSectionBody`)** — when `asideId` is set, pushes
  `embed(asideId, { align:"right", width:320 })` at the FRONT of `content`; prose emits as
  plain siblings. Deleted the `asideHostId`/`asidePlaced` machinery + the single-host wrapGroup
  branch + the trailing no-host fallback. The dead `containerChildIds` Set (only fed the removed
  host pick) is gone too. The **section-image** wrapGroup branch (non-lead images) is UNCHANGED.
- **`services/markdownImporter.js` (root `buildContainer`)** — stamps `meta.leadFloat = true`
  on the root container module when an aside is created (client hook → `.is-lead-float` CSS,
  see client modules/CLAUDE.md). Module is now captured as `moduleObj` so the flag can be set
  after `asideId` resolves.
- Client half: `alignStyle` default reverted flow-root → plain block (docs/CLAUDE.md) +
  `.is-lead-float` class & CSS (client/src/CLAUDE.md + modules/CLAUDE.md). Validated in a
  headless render against the real `.textblock-card` cascade (`~/.wraptest2/leadfloat.{html,png}`):
  top textblock left of the infobox, second flows full-width under it (the L-foot), no tinted
  box behind the infobox. 36/36 importer tests (2 lead-aside cases rewritten), 218 server +
  1113 client tests pass, build clean. **Server restart + re-import to apply.**

## Recent Changes (2026-06-12 — a CONFIRMED import never runs as a dry run ("planned only — nothing imported"))
- **`services/assistantAgent.js` (`assistantConfirm`)** — the offline model sometimes passes
  `dryRun:true` to `wikipedia_import` (to "plan"), so approving the confirm card minted nothing
  and the drawer showed "(planned only — nothing was imported. Re-run without dry-run …)". But
  the confirm card IS the user's approval to do it for real. New `IMPORT_TOOL_NAMES` set
  (`wikipedia_import` / `wikipedia_import_batch` / `import_markdown` / `import_html`); when a
  confirmed tool is one of these and `input.dryRun` is truthy, it's forced to `false` before
  `tool.run` (and the returned `input` reflects that). 2 regression tests in
  `__tests__/assistantAgent.test.js` (force-false on dryRun:true; untouched when not set) —
  stub `global.fetch` to assert `dryRun:false` on the wire. 218 server tests pass. **Server
  restart** to apply.

## Recent Changes (2026-06-12 — importer: wrapGroups emit NEIGHBOR-first + neighborWidth (block-wrap redesign))
- **`services/markdownImporter.js` (`buildSectionBody`)** — both emitted `wrapGroup`s now put
  the NEIGHBOR(s) FIRST and the HOST last (`content: [neighbor…, host]`), matching the client's
  redesigned real-float wrap (a CSS float only wraps content after it). The lead aside group
  carries `neighborWidth:320`; section-image groups `neighborWidth:260` (the floated column's
  start width — the draggable seam now owns resize, so the old per-embed `align:"right"`/`width`
  attrs were dropped). Client half: docs/ui/helpers/modules CLAUDE.md + spec
  `docs/superpowers/specs/2026-06-12-unified-block-wrap-redesign.md`. **Re-import to apply.**
  4 importer test assertions updated to neighbor-first order; 216/216 server tests pass.

## Recent Changes (2026-06-12 — FIX: dry-run wiki import no longer hands back a wrappable root ("empty embed"))
- **`routes/apiV1.js` (`/research/wikipedia/import`)** — the route gated persist+broadcast
  on `if (!dryRun)` but returned `rootOccurrenceId` UNCONDITIONALLY. A dry run plans the
  tree (mints nothing real) yet handed back a planned root id; the assistant drawer then
  wrapped that id into a PERSISTED "Imports" doc page → a page whose `moduleEmbed` points
  at an occurrence that never existed = the user's **"the page just shows the empty embed."**
  Now `rootOccurrenceId: dryRun ? null : importResult.rootOccurrenceId`. Hardening at the
  source; the client also guards (see client ui/helpers CLAUDE.md `shouldWrapImportOutput`).
  **Root-caused from the DB:** the broken "Eminem" page (created 6/12 00:40, AFTER persistImport
  deployed) embedded a root absent from the DB; a live non-dry-run import of the same route
  persisted 140/140 fine → the broken one was a dry run. `markdownToModuli` output itself is
  clean (0 dangling embeds on real Eminem). The importer/persist pipeline was NOT the bug
  (account1's dangling-ref hypothesis disproven). No restart needed beyond nodemon's auto-reload.

## Recent Changes (2026-06-11 — importer: lead aside is now a RESIZABLE wrap NEIGHBOR the next container morphs around)
- **`services/markdownImporter.js buildSectionBody`** — the lead aside (image stacked over
  the infobox) is no longer a standalone right-FLOATED block. It's now the **neighbor** of a
  `wrapGroup` whose **host is the first sub-container** (e.g. "Early life and education") —
  that container morphs its text/border into an L to **semi-surround** the aside (user:
  "puzzle / mosaic pieces, but with a wrap" — two separate interlocking occurrences, the
  aside NOT nested inside). New `containerChildIds` set tracks sub-sections; `asideHostId` =
  first sub-container, else first prose textblock, else a plain right-float fallback. The
  aside neighbor is `embed(asideId,{width:320,align:"right"})` — `align:"right"` gives it the
  embed RESIZE handle (width is just the start); dragging it re-sizes the column and
  `WrapGroupNode`'s ResizeObserver re-measures so the host notch (the morph) follows.
- Section-image **wrapGroups** also carry explicit `anchorIndex:0` (clean top-L), matching the
  client's per-line wrap model (the `⠿` grip is gone — wraps form / re-morph / un-wrap purely
  by NORMAL drag of the neighbor's radial handle; see client docs/ui/helpers CLAUDE.md).
  Client also gives wrapped neighbors a visible border + drops the crammed caption (modules
  CLAUDE.md). **Re-import to apply.** 36/36 importer tests pass; client build clean.

## Recent Changes (2026-06-11 — importer: lead aside is now a FLOATED block, not a wrapGroup host)
- **`services/markdownImporter.js` (`buildSectionBody`)** — the lead image+infobox
  aside no longer folds into a `wrapGroup` with the FIRST prose textblock as its notch
  host (that made "the infobox + image read like they're in the first paragraph", and
  only ONE paragraph wrapped). It's now emitted as a **standalone right-floated embed**
  (`moduleEmbed(asideId, {align:"right"})`) at the FRONT of the section body, with the
  prose textblocks as normal siblings after it. Per the user: the article's MULTIPLE
  lead textblocks should flow down the LEFT of the image+infobox sidebar and wrap
  full-width underneath once past its bottom — an AUTO, height-driven count. Removed the
  `asidePlaced`/first-textblock coupling + the trailing no-host fallback (the aside is
  always pushed once at the front when present). The per-SECTION image notch wrapGroup
  branch is UNCHANGED (single images still notch-wrap their one host textblock). Image
  is stacked ABOVE the infobox in the aside (`asideMemberIds=[firstImg, table]` — already
  correct). Client half (float + BFC textblock cards + infobox column tint) in
  client/src/docs+modules CLAUDE.md. **Re-import to apply** (existing articles keep the
  old shape). Test updated: the lead-aside test now asserts a front `align:"right"` embed
  (not a wrapGroup) + a following textblock sibling. 35/35 importer + 17/17 htmlToMarkdown
  tests pass; client build clean. VERIFIED in headless browser against a synthetic Eminem
  import: aside floats right (image over infobox), lead textblock cards narrow beside it
  and the run reclaims full width below; infobox key column visibly tinted.

## Recent Changes (2026-06-11 — FIX: imports were NEVER persisted → vanished on reload)
**Root cause of "the Wikipedia article just shows an embed block on reload":** every
import path only BROADCAST `module_created`/`occurrence_created` to connected tabs —
it never WROTE the modules/occurrences to MongoDB (or the warm server cache). So an
import rendered live (the client folds the broadcast into local state) but on the next
reload `full_state` (DB/cache-backed) didn't include it; the page's `moduleEmbed` of
the now-missing root container fell to the `!mod` placeholder. Pre-existing bug, not
from the wrap/quote work (the import OUTPUT is verified clean — no throw / dangling refs).
- **`utils/persistImport.js` (NEW)** — `persistImportResult({ result, userId, uc })`
  upserts every module + occurrence (`findOneAndUpdate({id,userId}, …, {upsert:true})`)
  AND mirrors them into the warm cache. Textmaps are written COMPRESSED to the DB
  (matches `update_occurrence`; `loadUserIntoCache` decompresses on read) while the
  cache/broadcast copies stay RAW — the original `result.occurrences` objects are NOT
  mutated (the routes broadcast them raw immediately after).
- Wired into **all** import entries: `socketHandlers/import.js` (`import_text` — drag
  import; now destructures the cache helpers from ctx) + the four REST routes in
  `routes/apiV1.js` (`/research/wikipedia/import`, `/import/markdown`, `/import/text`,
  `/import/html`) via `getUserCache`. Persist runs BEFORE the broadcast.
- **SERVER RESTART required.** Existing ephemeral imports are already gone from the DB
  — **re-import** to persist them. New imports now survive reload.

## Recent Changes (2026-06-10 — importer: images NOTCH-wrap (wrap:true) + clean infobox/aside labels)
User feedback on the imported Eminem page (re-import to apply; **server restart**):
- **`services/markdownImporter.js` (`buildSectionBody`)** — BOTH image wrapGroups
  (the lead image+infobox aside AND every section image) flipped `wrap:false` →
  **`wrap:true`**. The prose now flows AROUND the image in an L (beside it, then
  reclaiming full width UNDERNEATH = "the notch") and reflows on panel resize via
  native float layout. This REVERSES the prior account3 `wrap:false` decision —
  that was a workaround for the "fragile, didn't reflow" notch, which is now fixed
  (the @tiptap/react grandchildren measure/CSS fix + the shared `wrapNotch` clip
  hook). Per the user: the intro should wrap the lead image, not sit beside it, and
  the wrap "shouldve wrapped around the image regardless if it was 1 or 2 textblocks".
- **`services/markdownImporter.js` labels** — the lead **aside** doc container was
  `label:""` (rendered a generic "Container" header) → now labeled with the article
  subject (`node.label`, e.g. "Eminem"). The infobox **table** label was
  `headers[0] || "Table"` (= "Field" from the `| Field | Value |` header) → now
  `headers[0] || ""` (no label). `buildTable` keeps an explicitly-EMPTY header cell
  empty (no "Column N" fallback) so the infobox renders with NO header title.
- **`services/wikipediaTools.js` (`fullMarkdown`)** — the infobox pipe table header
  row is now `| | |` (empty cells) instead of `| Field | Value |`, so the imported
  table has blank column titles + an empty container label (a bare facts card).
- **`services/markdownImporter.js` (`buildContainer`) — CONSECUTIVE paragraphs now
  MERGE into ONE textblock** (a paragraph accumulator + `flushPara()` on any
  structural block). The user: "ours has 2 textblocks for that chunk when the
  article shows 1" + "it shouldve wrapped around the image regardless." A single
  tall prose chunk also fully hosts the lead-image L-notch. Lists/code/images/
  tables/sub-sections still flush + stay their own blocks (reading order preserved).
  REVERSES the prior "one textblock per paragraph" decision.
- **Aside heading size (A)** — the lead aside now carries `meta.headingLevel: 2` so
  it reads SMALLER than the article's H1 root header (root container is level 0 →
  H1). Whether the final on-screen sizes match the user's ask still wants an
  in-browser glance.
- **Quotes embed INSIDE the lead-up textblock** (`buildContainer` quote branch) —
  a `> ` blockquote following prose stays its OWN `kind:"quote"` artifact occurrence
  but is pushed as a `moduleEmbed` into the running prose textblock (not flushed as a
  detached sibling), so it flows right after its lead-in ("…who said:"). Per the
  user: "a separate artifact (its own block) but inside the other one."
- Tests: 2 `wrap:false`→`true` assertions updated + new aside-label/empty-table
  assertions; the direct-markdown aside test uses `| | |`. 53/53 importer/wiki
  tests pass; client build clean. **Still in-browser/TODO** (need the running app):
  the H1/H2 heading-SIZE swap (root "Eminem" should read biggest), and the image
  embed's drag-handle gap (put image info there).

## Recent Changes (2026-06-10 — quotes → kind:"quote" ARTIFACT (styled pull-quote))
- **`services/markdownImporter.js`** — `parseBlocks` now recognizes contiguous `> `
  blockquote lines → `{kind:"quote", text, attribution}` (trailing "— Author"
  em/en-dash split off); `buildArtifactQuote` mints a `role:"artifact" kind:"quote"`
  module with `meta.{quote,attribution}` (no fileRef). Replaces the old ugly
  arrow-chip + textblock rendering of quotes.
- **`services/wikipediaTools.js` (`wikiHtmlToMarkdown`)** — new turndown rule
  `wikiPullQuote`: Wikipedia `{{Quote box}}`/`{{Cquote}}` render as `.quotebox` /
  `.cquote` (often a `<table>`, which turndown would mangle into a GFM table), so
  they're converted to a real `> quote — attribution` blockquote. Plain
  `<blockquote>` already converts via turndown's default.
- **Client:** `modules/ArtifactCard.jsx` `kind:"quote"` branch (big quote mark +
  italic text + "— attribution") + `.artifact-card--quote` CSS. Renders through the
  existing artifact embed path (`embedHideLabel`). **Re-import to apply.** 33
  importer tests pass (new quote + list-column cases).

## Recent Changes (2026-06-10 — importer: long bullet lists flow into height-capped columns)
- **`services/markdownImporter.js`** — bullet lists with >20 items now stamp
  `occurrence.meta.listCapRows = 20` on their textblock (via the new optional
  `buildTextblock(content, occMeta)` 2nd arg). The client caps the `<ul>` to ~20
  rows of height and flows the rest into additional columns (`column-fill:auto` +
  `column-width`), so the column count RESPONDS TO HEIGHT, not a fixed number — the
  fix for the long "artists who cited him as an influence" list. Short lists are
  untouched. Client half: `modules/TextblockCard.jsx` (reads `meta.listCapRows` →
  `--list-cap-rows` + `.textblock-card--cols`) + `index.css`. **Re-import to apply**
  (meta only lands on new imports). 31 importer tests pass.

## Recent Changes (2026-06-10 — infobox: strip embedded <style>/<script>/refs before .text())
- **`services/wikipediaTools.js` (`extractInfobox`)** — Wikipedia infoboxes embed
  `<style>.mw-parser-output …{}</style>`; cheerio's `.text()` dumps that CSS
  verbatim into cell values (the "per-person-output { … }" garbage the user saw as
  "broken html in the infobox table"). Now removes
  `style, script, .reference, sup.reference, .mw-editsection, .noprint, .sortkey`
  from the box BEFORE reading rows. Verified: Born/Occupations rows come out clean,
  no CSS, no `[1]` refs. **Re-import to apply.** 48 importer/wiki tests pass.

## Recent Changes (2026-06-09 — importer: infobox → table occurrence in a lead "aside")
- **`services/wikipediaTools.js`** — new `extractInfobox(html)` cheerio-parses the
  article's `.infobox` (which the strip-selectors otherwise discard) into
  `{label,value}` rows (`<br>`→" · ", `<li>`→", " so multi-value cells read
  cleanly). `fullMarkdown` builds a pipe table from it and injects it right after
  the lead image (after the H1). Verified live (Eminem): 13 rows — Born /
  Occupations / Labels / Website / Spouses / …
- **`services/markdownImporter.js`** — the lead image + the infobox table now group
  into a `kind:"doc"` **lead aside** container (`buildAsideContainer`,
  `meta.leadAside:true`) that stacks them vertically and renders SIDE-BY-SIDE on the
  right of the intro textblock (a `wrapGroup` with `wrap:false` = robust flex
  column, no fragile notch). Per the user: image (artifact) + infobox (kind:table)
  "both in a doc container … on the right of the first textblock." Scoped to the
  Wikipedia case — only fires when the lead image is immediately followed by a table
  (`tableChildIds`); a plain lead image with no infobox keeps the normal
  image-beside-prose notch wrap. `buildSectionBody` gained `asideId`/`asideMemberIds`
  (excludes the members from the main flow, makes the aside the first textblock's
  neighbor). `buildContainer` takes `isRoot`. Re-import to apply. 51 importer/wiki
  tests pass (2 new aside cases); 211 server tests green.

## Recent Changes (2026-06-09 — reseed clears the assistant chat history)
- **`scripts/createLiveData.js` (STEP 11 grid write, ~line 5771)** — the
  `Grid.findByIdAndUpdate` that stamps `meta.layoutTree` now ALSO stamps a fresh
  `meta.assistantSeedId: uid()` every run. The assistant chat history lives in
  BROWSER localStorage (`moduli_assistant_history`), which a server script can't
  touch — so instead the drawer compares this marker to the one it last saw and
  clears its transcript when it changes (mirrors the bootstrap-token pattern; no
  new endpoint — `grid.meta` already syncs via `full_state`). See
  client/src/ui/CLAUDE.md (AssistantDrawer SEED_KEY effect). So a reseed now starts
  the Jonah conversation fresh. No server restart needed beyond the normal reseed.

## Recent Changes (2026-06-09 — Canvas: Build cards piled at one spot (fan-out + connect fix))
- **`scripts/createLiveData.js` (`Canvas: Build`, position block ~line 9337)** —
  ROOT CAUSE of "the schedule-canvas nodes still aren't fanned out nor connected":
  the DB showed all 6 cards stamped at the SAME (1760,1850) with a full 5-edge
  chain (edges existed but were zero-length → invisible). The `$col`/`$row` cursor
  resets to 0 every fire (step 5b) and **only advanced when a card was MINTED**. In
  diff mode the schedule builds incrementally, so each fire reset col=0 and minted
  just the one new task's card at col=0 while existing cards didn't advance the
  cursor → every new card piled at slot (0,0). Fix: the slot position is now
  computed for EVERY task and the cursor advances for every task that resolved a
  card (existing OR minted), so a new card always takes the next free slot. Fixes
  BOTH "not fanned out" and "not connected" (the edges become visible once the
  cards spread). **Re-seed required:**
  `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-06-09 — importer follow-ups: trailing `)`, source link → bottom, image width)
- **`services/markdownImporter.js`** — three more user-reported import fixes (re-import to apply):
  - **Balanced-paren URLs.** The link/image url matchers used `[^)]+`, which
    truncated Wikipedia titles like `…/Encore_(Eminem_album)` at the first `)` and
    left a stray trailing `)` after the chip ("The Monster Tour)"). All four
    matchers (`parseInline` link, `paragraphToBlocks` img, `parseBlocks` block-img,
    `stripInlineMd`) now use `(?:[^()]|\([^)]*\))*` (one level of balanced parens).
    Verified: 0 truncated paren URLs.
  - **Source link → BOTTOM.** The "Source: … — Wikipedia ↗" textblock is now
    APPENDED as the root's last child (was prepended first). The doc opens with the
    main-image+intro wrapGroup; the article link sits at the end.
  - **Wrapped image width.** Neighbor image embeds in an importer-built wrapGroup
    get `attrs.width:260, align:"right"` so they render as a sized box that lines up
    in the host's notch (an unconstrained image measured full-width and blew out the
    wrap geometry).

## Recent Changes (2026-06-09 — Wikipedia import: link/emphasis/See-also/main-image/block-wrap fixes)
Five user-reported import bugs, all in `services/markdownImporter.js` +
`services/wikipediaTools.js`. **Server restart + re-import to apply** (Node code;
imports are user-triggered, no reseed).
- **`markdownImporter.js` `parseInline` — emphasis now RECURSES.** Root cause of
  "links with `[]()` still don't resolve": the italic rule's `[^*]+` swallowed the
  whole `[text](url)` inside `*[The Eminem Show](url)*` (69 such album links in the
  Eminem article) so it rendered as literal text. Bold/italic/bolditalic spans now
  recurse through `parseInline` (non-greedy `[\s\S]+?`) and re-apply the mark via
  the new `applyMarks` helper; a link nested in emphasis becomes a chip (the mark
  is dropped on the atom — the link resolving is what matters). Verified live: 717
  link chips, **0** leftover literal `[](url)`.
- **`markdownImporter.js` — bullet lists get `buildInlineLink`.** The "See also"
  section (a list of article links) was calling `parseInline` WITHOUT the minter,
  so its links were un-resolving link marks. Now bullet items mint the same inline
  link chips as prose.
- **`markdownImporter.js` — `SECTION_DENYLIST`.** Drops trailing citation/nav
  cruft sections (Notes / References / External links / Further reading / …) in
  `buildContainer`'s container branch. Removes the "random `-` line with a link"
  (the External-links `- [Official website] [![Edit this at Wikidata]…]` bullet).
  **"See also" is intentionally KEPT** (user wants those as links).
- **`markdownImporter.js` — heading labels stripped of inline md** via
  `stripInlineMd` in `parseBlocks` (so `### …, *The Slim Shady LP*` reads clean,
  no literal `*`).
- **`wikipediaTools.js` — main/lead image injected.** Wikipedia's main photo lives
  in the `.infobox`, which `wikiHtmlToMarkdown` strips → the article had no main
  image. `summary()` now also returns `originalimage`; `fullMarkdown` fetches it
  and injects `![Title](url)` right after the H1, so the importer mints it as the
  page's main image. Verified: artifacts 8→**9**.
- **`markdownImporter.js` — images now BLOCK-WRAP (reverses the old "importer does
  NOT emit wrapGroups" decision).** New `buildSectionBody(childIds, …)` folds each
  block image into a `wrapGroup` with the next prose textblock host (images are
  buffered because Wikipedia emits the image BEFORE its prose), so the text reflows
  beside the image. A single host can carry MULTIPLE stacked image neighbors. The
  lead image (after the H1) wraps the intro paragraph — NOT the "Source: … —
  Wikipedia ↗" textblock (it isn't a host). Images with no following prose host
  fall back to a full-width standalone embed. Client `WrapGroup` extended to N
  neighbors to match (see client/src/docs/CLAUDE.md). Verified live: 9 wrapGroups,
  every host a textblock; root opens `[Source-link, wrapGroup(intro+mainImg), …]`.
- 42 server tests across markdownImporter / wikipediaLinks / htmlToMarkdown pass.

## Recent Changes (2026-06-09 — Canvas: Build cards now FAN OUT near the world center)
- **`scripts/createLiveData.js` (`Canvas: Build`, mint branch)** — root cause of
  "the canvas looks empty / nothing is fanned out": every minted card was stamped
  `meta.x = 60` (a single vertical column at the world's TOP-LEFT corner). The
  canvas centers on the 4000×4000 world's MIDDLE (~2000,2000) on load, so that
  column sat off-screen — the cards existed but weren't visible. Fixed: replaced
  the `$r`-driven single column with a **3-column grid** (`$col`/`$row` cursor,
  wraps after 3) centered near the world center — `x = 1760 + $col*240`,
  `y = 1850 + $row*150`. `$x`/`$y` are deep-resolved inside the COPY_LINK `meta`
  (verified — operationActions.js:1751). The mindmap edge chain + diff-mode drag
  preservation are untouched. **Re-seed required:**
  `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-06-09 — Grid.meta field + seed opens in BSP "mosaic" layout)
- **`models/Grid.js`** — added `meta: { type: Mixed, default: {} }`. The Grid
  schema had NO meta field, so `GridSettingsTab`'s `grid.meta.defaultStyle` /
  `grid.meta.localSort` writes were silently dropped by strict mode — this fixes
  those AND stores the new opt-in BSP layout at `grid.meta.layoutTree`. Persists
  through the generic `update_grid` handler (client read-modify-writes the whole
  `meta`). **Server restart required** (schema). No reseed strictly needed for the
  field, but see below for the seed.
- **`scripts/createLiveData.js` (STEP 11)** — the seeded grid now opens in mosaic:
  `Grid.findByIdAndUpdate(..., { "meta.layoutTree": <tree> })`. The tree mirrors
  the rows×cols placement (same 5 panels): col0 = toolkit/todo, **col1 = the
  notebook hub as ONE full-height pane (the "middle one, 2 rows high")**, col2 =
  goals/accounts. Client renders via `GridMosaic` (see client/src/modules/CLAUDE.md).
  **Re-seed to apply:** `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-06-08 — assistant: one-card linked import + editable create_field)
- **`services/assistantTools.js`** — new `wikipedia_import_batch({ titles, parentId? })`
  tool (`requires_confirm`): imports each title via `/research/wikipedia/import`
  (capped at 15), collects `rootOccurrenceIds`, then calls `/research/wikipedia/relink`
  ONCE so cross-references between the batch become in-app navigation. Returns
  `{ imported:[{title,rootOccurrenceId}], count, failed, relinked, rootOccurrenceIds }`.
  Replaces the "call wikipedia_import per title + relink_imports" dance with one
  Approve card (client wraps each root under the "Imports" folder — see
  client/src/ui/CLAUDE.md). Also: **`create_field` is now `requires_confirm`** so
  the drawer shows an editable name/type/unit card.
- **`services/assistantAgent.js`** — `OFFLINE_CORE_TOOLS` gains `wikipedia_links`
  + `wikipedia_import_batch`; the SYSTEM_PROMPT "X AND surrounding links" recipe now
  says call `wikipedia_links` → ONE `wikipedia_import_batch` (default main + top 5
  links; no manual per-title import / relink). 30 agent tests pass.
- **SERVER RESTART** required (tool/prompt changes). No reseed.

## Recent Changes (2026-06-06 — Occurrence.label override + "Goals: Date-Prefix Labels" op)
- **`models/Occurrence.js`** — new `label: { type: String, default: null }`.
  Per-placement label override; null = render the module's own label. The client
  renderer prefers it over `module.label`. Written by ops via `UPDATE_ITEM_LABEL`
  (path `$occ.label`). The generic `update_occurrence` handler already spreads it.
- **`scripts/createLiveData.js`** — new **"Goals: Date-Prefix Labels"** op
  (priority 4, folderId trackers). Triggers: `onFilterChange` ancestorLabel
  "Goals" + grid + `onLoad`. `targetOccurrenceId: goalsPageOccId` so
  `$activeDatePossessive` (new executor var: "Today's"/"Yesterday's"/"July 18th")
  resolves from the GOALS page filter cascade (on-page date switch relabels even
  when the grid filter hasn't moved — same mechanism Build Schedule uses).
  Pipeline: LOOP `$allInstances` → IF `_ancestors HAS_ANCESTOR goalsPageOccId`
  AND `moduleLabel IS_NOT_EMPTY` → `UPDATE $goal.label = "${$activeDatePossessive}
  ${$goal.moduleLabel}"`. Reads `moduleLabel` (stable template base) so it never
  re-prefixes its own write. So each goal/tracker tile reads "Today's Water" /
  "July 18th Water" for the day being viewed. **Re-seed REQUIRED + server restart**
  (new schema field): `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-06-06 — confirm-path emits live progress so the import bar stays honest)
- **`routes/apiV1.js` (`POST /assistant/confirm`)** — a confirmed Wikipedia import
  is a 20-30s server round-trip (`assistantConfirm` awaits
  `/research/wikipedia/import`), so the HTTP request — and the drawer's `busy`
  flag — span the whole import. But the confirm path emitted NO
  `assistant_progress` (only the chat loop did), so the ThinkingBar sat at a stale
  "… thinking" for the full import → felt frozen. Now wraps the `assistantConfirm`
  call: emits `{phase:"tool", tool:name}` up front (client shows "… running
  wikipedia import") and `{phase:"done"}` in a `finally` (clears the label). The
  elapsed timer + bar already kept moving (busy spans the request; the client's
  2026-06-05 overrun→indeterminate fix keeps the bar alive past the learned ETA) —
  this makes the LABEL honest too. SERVER RESTART to apply.

## Recent Changes (2026-06-06 — importer: float images for horizontal layout)
- **`services/markdownImporter.js` (`buildContainer`)** — image-artifact children
  now get `moduleEmbed attrs.align:"right"` in the section's textmap (tracked via an
  `imageChildIds` Set). The doc editor's moduleEmbed float (left/center/right/full,
  already a normal doc DnD feature) makes the following textblocks flow BESIDE the
  image → article-like horizontal layout. Users can re-align per-embed in the UI.
  22 importer tests pass. Re-import to apply.

## Recent Changes (2026-06-06 — importer: prose links → INLINE link mini-textblocks)
- **`services/markdownImporter.js`** — `[text](url)` links in PROSE paragraphs now
  become their own `role:"textblock" kind:"inline"` occurrence carrying
  `meta.link={kind:"url",url}`, embedded into the surrounding paragraph via an
  `instanceTextblockInline` node (client renders a chip that flows in the
  sentence — see client/src/docs/CLAUDE.md). New `buildInlineLink(label,url)`
  minter; `parseInline(text, mintLink)` + `paragraphToBlocks(text, mintLink)` take
  an optional minter (passed only for the paragraph branch — bullet lists keep
  plain link marks). Replaces the prior inline `link` mark for prose. Test updated
  (markdownImporter.test.js); 22 importer tests pass. SERVER RESTART + re-import to
  apply.

## Recent Changes (2026-06-06 — HTML→MD rewritten with cheerio + turndown (real fix))
- The regex `htmlToMarkdown` kept mangling Wikipedia HTML (leaked `[edit]` links
  via nested `<span>`s, stray `]` brackets, `_caption_` underscores, misspelling-
  looking artifacts). User approved switching tools ("idc about legacy").
- **`services/wikipediaTools.js`** — new `wikiHtmlToMarkdown(html, title)` uses
  **cheerio** (remove `.mw-editsection`/`.infobox`/`.navbox`/`.reference`/`.hatnote`/
  `.toc`/… by selector — reliable, nesting-aware) + **turndown** (+`turndown-plugin-gfm`
  for tables) for correct HTML→MD. Custom link rule resolves `./X`,`/wiki/X`,`//x`
  → absolute; protocol-relative `//upload…` image URLs → `https://`. `fullMarkdown`
  now uses it (still on action=parse rendered HTML). The OLD regex `htmlToMarkdown`
  stays for the drag-import path. Downstream `markdownToModuli` (doc containers +
  textblocks) is UNCHANGED.
- **Verified live (Eminem):** `[edit]` lines 24→**0**, data-mw garbage gone, clean
  inline links, H2 6→**15** / H3 3→**26**, 9 images present.
- **`server/package.json`** — added `turndown`, `cheerio`, `turndown-plugin-gfm`.
- **`markdownImporter.js`** — each paragraph is now its OWN textblock (was grouped
  into one packed block); lists still = ONE bulletList textblock. Live: 125
  textblocks (was 35), largest 10KB (was 70KB), 43 doc containers, 0 instances.
- **`client/src/docs/ModuleEmbedNode.jsx`** — embedded containers now pass
  `embedded` so they render as DOC containers (bigger `#` markdown header) instead
  of the small standard/board header. 78 server tests pass; client build clean.
- **Remaining (verify in-browser after re-import):** images as inline nodes vs
  artifact occurrences (currently inline, artifacts:0); bullet-list indentation
  CSS (may already be fine with clean turndown lists); 4 stray `_` italics.

## Recent Changes (2026-06-06 — ROOT CAUSE of "import is one big garbage textblock": Parsoid HTML)
- **Diagnosed empirically** (dry-run importer + DB inspect, per user): the
  `markdownImporter` was always correct — feeding it clean markdown yields the
  right nested doc-container tree. The garbage came from **`fullMarkdown` fetching
  Wikipedia's Parsoid REST HTML** (`REST_BASE/page/html`), which embeds `data-mw`
  JSON wikitext + RDFa (`{{hlist|…}}`, `"spouse":{"wt":…}`) that leaked into the
  output — 80KB of cruft, hatnotes as bullet lists, no real section headings.
- **Fix (`services/wikipediaTools.js fullMarkdown`):** fetch the **rendered** HTML
  via `action=parse&prop=text&formatversion=2` instead of Parsoid. Pass
  `keepImages/keepTables/keepFigures:true` + an import-specific `stripClasses`
  (infobox/navbox/refs/hatnote/toc/edit-links/… but NOT `thumb`, so images
  survive). **Verified live (Eminem):** data-mw garbage gone; H2 6→9, H3 3→15;
  images 0→8 artifacts; largest textblock 70KB→23KB; tree = 19 doc containers +
  26 textblocks + 8 artifacts + 0 board instances. 42 wiki/importer tests pass.
- **Note:** `links()` still fetches Parsoid html (fine — it only regexes hrefs).

## Recent Changes (2026-06-06 — importer: article-like GROUPED rich textblocks)
- **`services/markdownImporter.js` (`buildContainer` rewrite)** — stopped
  exploding every block into its own occurrence. Consecutive FLOW content (prose
  paragraphs + lists + code) is now GROUPED into a single rich textblock: a
  markdown list → ONE `bulletList` node (was one `role:instance kind:board` per
  item — those are GONE), bold/italic/links stay inline (links are inline `link`
  marks, not chips). Structural blocks (sub-sections, tables, block images,
  raw-html) flush the running textblock and stand alone. Removed
  `buildInstanceLeaf` / `buildLinkTextblock` / `paragraphToChildren`. Net: an
  imported section reads like the real article (per user: "use markdown,
  bulletpoints grouped in a textblock, look close to the article"). 38
  importer/converter tests pass. SERVER RESTART + re-import to apply.
- **OUTSTANDING import work is tracked in `docs/wikipedia-import-docket.md`**
  (section-hierarchy headers, linked/multi-article import + internal-link rewrite,
  page-kind ask, more confirm UX, board-button alignment bug, offline Kiwix).
- **Docket progress (2026-06-06):** ✅ section-hierarchy headers (importer stamps
  `meta.headingLevel` per markdown depth; ModuleContainer embedded header sizes by
  it). ✅ page-kind ask (prompt infers kind or asks). ✅ board header +2px padding.
  ✅ linked import — fan-out (`wikipediaTools.links` + `GET /research/wikipedia/links`
  + `wikipedia_links` tool) AND internal-link rewrite (`services/importRelink.js`
  pure `relinkTextmap`/`relinkOccurrences` → imported docs' inline wiki link marks
  become native `docLink` nodes when the target was imported; `POST
  /research/wikipedia/relink` + `relink_imports` tool; prompt calls it after the
  batch). 61 server tests across touched suites pass. SERVER RESTART for the
  tool/prompt/endpoint changes.

## Recent Changes (2026-06-05 — import renders as a DOC page, not a board; absolute wiki links)
- **DB diagnosis** (user: "import created a board, not a doc page"): the
  panel-picker wrapped imports in a `role:page kind:board` page + the importer
  minted section containers `kind:board`. User wants the whole import to be a
  document. Fixes:
  - **`services/markdownImporter.js`** — every section container is now
    `role:container **kind:"doc"**` (was board). A doc container renders its
    **textmap**, so `buildContainer` now also writes `textmap` = a `moduleEmbed`
    node per child (prose textblocks, link chips, list-item instances, images,
    sub-sections) — the section reads top-to-bottom as a document, with the
    fine-grained children embedded inline. `occurrences:[childIds]` is kept for
    ancestry/cleanup (doc kind renders textmap, not the occurrences[] list, so no
    double-render). Empty sections get `[{paragraph}]` (TipTap non-empty
    invariant). NOTE: user clarified list==board for CONTAINERS and dislikes
    "list" — so the kinds that matter are board (legacy/canonical) vs **doc**;
    imports use doc. +1 test (20 importer tests pass).
  - **`socketHandlers/crud.js` (`create_page`)** — now persists `occData.textmap`
    AND `occData.filterOverride` (both were silently dropped). Lets the
    panel-picker create a DOC page that embeds the imported content (and the
    `filterOverride:{}` actually sticks so the wrapped page isn't date-filtered).
  - Client wrap is now a `kind:"doc"` page with `textmap:[moduleEmbed(rootOcc)]`
    (see client/src/ui/CLAUDE.md).
- **`services/wikipediaTools.js` (`htmlToMarkdown` link rule)** — wiki-internal
  links are now resolved to ABSOLUTE URLs instead of stripped to plain text:
  `./X` → `https://en.wikipedia.org/wiki/X`, `/wiki/X` → absolute, `//x` →
  `https://x`, `#anchor`/unknown-relative → plain text. **Root-cause fix for the
  broken link chips** (DB showed `meta.link.url = "./Aftermath_Entertainment"`,
  which would open `<app>/./…`). Tests updated + 1 added (36 importer/converter
  tests pass). SERVER RESTART required.

## Recent Changes (2026-06-05 — Import format = "Rule Set A" + link mini-textblocks + wiki preview-confirm)
- **`services/markdownImporter.js`** — imported content now follows the user-chosen
  **fine-grained nested format**:
  - Every imported container module gets `meta: { allowChildContainers: true }`.
    **Root-cause fix for "imported page opened but is empty":** the generic
    `ModuleContainer` only renders child CONTAINERS when this flag is set
    (`leafModulesById` otherwise), so the heading-nested section tree rendered
    blank. Now the whole nested tree shows.
  - **Links → mini-textblocks.** New `buildLinkTextblock(label, url)` mints a
    `role:"textblock"` with `meta.link = { kind:"url", url }` + a minimal textmap.
    New `paragraphToChildren(text)` splits each prose paragraph on `[text](url)`
    (lookbehind `(?<!!)` so `![img](src)` is NOT matched) into a SEQUENCE: text
    runs → textblocks, links → link mini-textblocks. The paragraph branch in
    `buildContainer` now spreads `paragraphToChildren(c.text)` (was one textblock
    with inline link marks). Client `TextblockCard` renders the chip (see
    client/src/modules/CLAUDE.md). Heading→nested-container, paragraph→textblock,
    list-item→instance, image→artifact were already the importer's shape.
  - 3 new tests in `__tests__/markdownImporter.test.js` (link split / image not
    mistaken for a link / nested-container + allowChildContainers). 19/19 pass.
- **`services/assistantTools.js`** — `wikipedia_import` is now `requires_confirm:
  true`, so the drawer shows an Approve/Decline card with a PREVIEW (title +
  thumbnail + extract, fetched client-side from `GET /research/wikipedia/summary`)
  + a clickable link to the Wikipedia page in a new tab, before the import runs.
- **SERVER RESTART required** for the importer + tool changes (Node code). No
  reseed (imports are user-triggered). Existing imported content keeps inline
  link marks until re-imported.

## Recent Changes (2026-06-04 — Drawer auto-connects after reseed: localhost bootstrap-token)
- **Symptom:** after a reseed the assistant drawer's token input was EMPTY — the
  token persists server-side (DB + `server/.env ASSISTANT_API_TOKEN`), but the
  drawer fills its field from BROWSER `localStorage`, which the server reseed
  can't touch. So the user still had to paste once.
- **`routes/apiV1.js`** — new `GET /api/v1/assistant/bootstrap-token` (NO auth —
  it IS the auth bootstrap). Gated by ORIGIN to loopback + **private LAN ranges**
  (RFC1918 `10/172.16-31/192.168`, link-local `169.254`, IPv6 ULA `fc/fd` +
  link-local `fe80`) — the app is accessed over the WSL2 / LAN IP, so
  localhost-only wouldn't reach it; PUBLIC IPs are refused so a port-forwarded
  server never leaks the token. `ASSISTANT_BOOTSTRAP=off` disables it. Returns
  `{ token: null }` off-net / disabled / unset, else `{ token: ASSISTANT_API_TOKEN }`.
  (Gate unit-tested: WSL2 172.20.x / 192.168 / 10.x / loopback / IPv6 allowed;
  8.8.8.8 / 172.15 / 172.32 / public refused.)
- **DEV over IP (`client/vite.config.js`)** — added `server.host: true` so the
  Vite dev server binds 0.0.0.0 and is reachable via the WSL2 / LAN IP. Without
  it Vite bound localhost-only and WSL2's localhost-forwarding is flaky, so dev
  was unusable over the IP (the user had been doing a full build+serve every
  time). Socket + API already connect same-origin (`window.location.origin`) and
  proxy through Vite, so HMR + sockets + REST all work over the IP now.
- **Client** (`AssistantDrawer.jsx`, see client/src/ui/CLAUDE.md) fetches it once
  on mount when it has no saved token and auto-fills — so "run createLiveData →
  drawer just works" is now true with no paste.
- **CAVEAT — server restart:** the running server's `process.env.ASSISTANT_API_TOKEN`
  is read at boot. If you mint a NEW token (createApiToken.js rewrites `.env`)
  or first-seed mints one, **restart the server** so the bootstrap endpoint hands
  out the new value. The DB row is already correct; only the env-in-memory lags.

## Recent Changes (2026-06-04 — Any minted token can become the stable ASSISTANT_API_TOKEN)
- **`utils/assistantToken.js`** — new exported `writeAssistantTokenToEnv(rawToken,
  {envPath})`: UPSERTS the `ASSISTANT_API_TOKEN` line in `server/.env` (replaces
  the existing line in place — no duplicate keys that would shadow it — or
  appends/creates when absent, preserving every other key). `ensureAssistantApiToken`'s
  mint branch now uses it too (was a blind append).
- **`scripts/createApiToken.js`** — after minting, by DEFAULT writes the new raw
  token into `server/.env` as `ASSISTANT_API_TOKEN`, so a token the user mints
  themselves becomes the one `createLiveData`'s `ensureAssistantApiToken`
  re-asserts on every reseed (paste once, survives reseeds). Pass `--no-env` to
  skip (token still survives in the DB, just not auto-re-asserted). Arg parsing
  switched to flag-aware (`--*` filtered out before positional email/scopes/name).
- Verified the upsert against a temp .env: create / replace-in-place (1 line, no
  dupes) / append-among-other-keys / replace-among-other-keys all correct.

## Recent Changes (2026-06-04 — Build Schedule: sort day-columns chronologically)
- **`utils/liveSystemBuilders.js` (`makeScheduleBuildScheduleOp`, PHASE B)** —
  the page's `meta.layoutCascadeOverride` UPDATE now also sets
  `sortChildrenByField: dateFieldId` (alongside `mode`/`columns`/`hideChildIds`).
  Day-columns are appended to the Schedule page's `occurrences[]` in date-picker
  SELECTION order (and idempotent re-adds append at the end), so a 3-day range
  picked 28→29→27 rendered as "28 29 27". `dateFieldId` is a literal id (not a
  `$`-expr) so it survives `deepResolveExpr` untouched. The generic
  `PageBoard.jsx` consumes the key and stable-sorts visible children by that
  field's value (see client/src/modules/CLAUDE.md) — the renderer stays
  schedule-agnostic. **Re-seed required:**
  `node --env-file=.env server/scripts/createLiveData.js`. 25 liveSystemBuilders
  tests green.

## Recent Changes (2026-06-04 — Assistant: best-guess location + UI confirm + robust generic create)
- **Problem:** a 3B model can't reliably produce valid ids for create — it
  invents placeholders (`<Schedule-Timeslot-container-id>`), puts the container
  id in `moduleId`, omits the parent link, so creates silently produced garbage
  that never rendered. User direction: don't hardcode a task tool — best-guess
  the location and let the USER confirm/correct it in the UI.
- **`services/assistantTools.js` (`create_occurrence`)** — now `requires_confirm`
  + generic & robust: accepts a `label` (mints an `instance` template when
  `moduleId` is missing/placeholder — `/[<>\s]/` heuristic), drops placeholder
  parents, creates the occurrence, AND links it into the parent's
  `occurrences[]` (GET parent → PATCH appended — without this a container won't
  render the child). Nothing schedule-specific. Returns `placedIn`.
- **`services/assistantAgent.js`** — create recipe simplified: "call
  create_occurrence with a `label` + best-guess `parentId`; the app pops a card
  for the user to confirm/correct the location." (Was: 2-step create_module then
  create_occurrence with exact ids.)
- **Client (`AssistantDrawer.jsx` ConfirmCard)** — for create_occurrence renders
  an editable LOCATION picker: best-guess pre-filled (real id → used as-is; else
  fuzzy-match the placeholder/label text against container/page labels from the
  live store), searchable list of all containers+pages, Approve disabled until a
  location is chosen. Approve sends the corrected `parentId` to
  `/assistant/confirm`. See client/src/ui/CLAUDE.md.

## Recent Changes (2026-06-04 — Assistant: live token streaming + narration + create recipe)
- **`services/assistantAgent.js`** — the Ollama loop now STREAMS (`stream:true`)
  instead of one blocking `res.json()`. New `streamOllamaChat` parses the NDJSON
  stream and forwards each content delta via `onProgress({phase:"token",delta})`;
  `buildOllamaRequestBody` gained a `stream` flag. Live-probed: first token at
  ~4.8s vs 60-100s of prior silence. Fixes "long gap between 'thinking' and the
  result — no progress" (user wanted Claude-style live updates).
- **`SYSTEM_PROMPT` rewritten discipline + new "Creating & placing things"**
  section: (1) NARRATE one sentence before each tool call (the live progress
  signal); (2) never use placeholder ids like `<Timeslot-container-id>`; (3)
  don't ask pointless follow-ups ("never ask 'what is the purpose'"); (4) the
  create recipe — moduleId (template) vs parentId (destination) are DIFFERENT;
  create_module THEN create_occurrence; `fields` is an OBJECT keyed by real
  field id `{value}`, never a string. Targets the garbage-create the user hit
  (occurrence with placeholder moduleId, parentId:null, stringified invented
  fields). **Prompt-level fix; the fully reliable path is a future high-level
  `create_task` tool — not yet built.**
- **`routes/apiV1.js`** already forwards `onProgress` → `assistant_progress`
  socket event; `token` deltas flow through unchanged.
- 30 tests in assistantAgent.test.js (added stream-flag assertion). NOTE: server
  restart required for prompt/stream changes.

## Recent Changes (2026-06-04 — Green current timeslot + stable assistant token + assistant "place anywhere")
- **`scripts/createLiveData.js` (`Schedule: Mark Passed Slots` op)** — now also
  paints the CURRENT (active-now) slot GREEN, keeping dim-red on already-passed
  slots (user: "green background for the current timeslot"). Two-pass per today's
  day-col: **pass 1** finds `$currentSlotTime` = the latest timeslot that's
  `TIME_BEFORE $currentTime` (walks slots, keeps the max via `TIME_AFTER`);
  **pass 2** paints green if `timeslot IS $currentSlotTime`, else red if passed,
  else clear — priority current>passed>clear, each write dedup'd vs current
  `ownStyle.bg`. New `currentSlotColor = rgba(74,222,128,0.16)`. Past day-cols
  stay all-red; future untouched. **Re-seed required.** Backup at
  `scripts/createLiveData.js.backup` (pre-edit) — remove once verified in-browser.
  NOTE: per-day duplicate-label slots are fine here (each day-col's slots are
  separate COPY_LINK copies; "current" is computed within today's day-col only).
- **`utils/assistantToken.js` (NEW) + `models/ApiToken.js` (`upsertFromRaw`) +
  `scripts/createLiveData.js` main()** — the Jonah assistant API token is now
  STABLE across reseeds (user: "the key I generate doesn't have to be re-entered
  if I rerun the seed"). Reseed (`dropExistingLiveGrid`) already deletes only
  grid-scoped data, NOT ApiToken/User/Grid — the friction was minting a fresh
  random token each time. `ensureAssistantApiToken(userId)`: if
  `ASSISTANT_API_TOKEN` is in server/.env, upsert the matching DB row; else mint
  once, append it to server/.env, print it. main() calls it after seeding and
  prints the raw token. Paste once into the drawer (⚙) — survives every reseed.
- **`services/assistantAgent.js` (`extractDestinations` / `buildDestinationsHint`
  / `fetchDestinations`)** — the assistant can now create/move into ANY named
  place, not just folders (user: "I should be able to create and move stuff
  anywhere"). `fetchDestinations` pulls grid state once and `extractDestinations`
  joins occurrences→modules to list folders + pages + CONTAINERS (each with a
  parent breadcrumb for disambiguation; per-day duplicate label@parent slots
  collapsed). Hint reframed "KNOWN PLACES — create or move things into any of
  these". Also injects TODAY's date into the system prompt so "today"/"6:30pm
  today" resolve. 12 new tests (29 total in assistantAgent.test.js).

## Recent Changes (2026-06-04 — Offline assistant (Jonah/Ollama) hang + "prints tool call but doesn't run it" fix)
- **Symptom:** asking Jonah to "create an eminem wikipedia doc page in the
  Examples folder" ran ~3 min then showed the raw JSON
  `{"name":"wikipedia_import","arguments":{…}}` and did nothing.
- **Root causes (confirmed via a live smoke against the running
  qwen2.5-coder:7b):**
  1. **Ollama default `num_ctx` ≈ 4096** (model trained for 32768, Modelfile
     sets none) → system prompt + ~38 tool schemas truncated before any grid
     data; model lost the tools/system and looped.
  2. **qwen emits tool calls as a JSON blob in `message.content`, NOT the native
     `tool_calls` array.** `ollamaLoop` only read `tool_calls`, saw it empty,
     treated the blob as a final answer, ran nothing → user saw raw JSON. THE
     core bug.
  3. No timeout on the per-generation fetch → a slow/wedged call hung forever.
  4. The model had no Examples-folder id and hallucinated `<Examples-folder-id>`.
- **`services/assistantAgent.js`:**
  - `buildOllamaRequestBody` (NEW, exported) — sends `options.num_ctx`
    (`OLLAMA_NUM_CTX`, default 8192). `ollamaLoop` fetch now wrapped in an
    `AbortController` (`OLLAMA_TIMEOUT_MS`, default 45000) → wedged call throws →
    graceful fallback instead of infinite "… thinking".
  - `parseContentToolCall` (NEW, exported) — recovers a `{name,arguments}` tool
    call from free-text/`content` (fenced ```json, balanced-brace scan, OpenAI
    envelopes, string-encoded args). Guarded by known tool names. Wired into
    `ollamaLoop`: when `tool_calls` is empty it recovers from `content` and
    suppresses the raw JSON from the visible transcript. **This is what makes
    the tool actually run.**
  - `buildDestinationsHint` (NEW, exported) + `fetchDestinations` — inject a
    "KNOWN DESTINATIONS" block (grid folders → `parentId`) into the system
    prompt so named targets ("the Examples folder") resolve WITHOUT a read
    round-trip. The importer's `parentId` sets the root occ's `parentId` =
    folder placement, so folder ids are valid destinations.
  - `selectToolsForBackend` (NEW, exported) — Ollama gets a curated 17-tool
    `OFFLINE_CORE_TOOLS` set (override via `OLLAMA_TOOL_ALLOWLIST`); cloud/
    deterministic get the full 38. Cuts latency ~1.8× and reduces wrong calls.
  - `buildSystemPrompt` now exported (was internal).
  - `assistantChat` gained `onProgress` (forwarded to `ollamaLoop`), emitting
    `{phase:"thinking",iteration}` / `{phase:"tool",tool}` / `tool_done`.
- **`services/assistantTools.js`:** `summarizeGridState` (NEW, exported) +
  `get_grid_state` tool now returns a **bounded summary** (counts + named
  folders/pages/fields/operations with ids) instead of dumping ~600
  occurrences. Pages derived by joining occ.targetId → page-role module.
- **`routes/apiV1.js`** (`/assistant/chat`): wires `onProgress` →
  `io.to(userRoom).emit("assistant_progress", ev)` + a final `{phase:"done"}`.
- **Tests:** `__tests__/assistantAgent.test.js` (NEW, 24 cases) cover all pure
  helpers incl. the exact smoke-test blob. 180/180 server tests green.
- **Latency levers:** `buildOllamaRequestBody` also sets `options.num_predict`
  (`OLLAMA_NUM_PREDICT`, default 768 — caps rambling) + top-level `keep_alive`
  (`OLLAMA_KEEP_ALIVE`, default "30m" — avoids per-message reload).
- **Model switched to `llama3.2:3b`** (set in `server/.env` `OLLAMA_MODEL`; code
  fallback stays `qwen2.5-coder:7b`). Benched on the Eminem request, warm:
  llama3.2:3b **59s, native tool_calls, used the real folder id**; qwen 7b 99s,
  emitted via content (needed recovery), and dropped the parentId. llama3.2 is
  Meta-tuned for tool-calling and this assistant is routing, not coding.
- **Timeout coherence (follow-up fix):** the first per-gen timeout was 45s but a
  real tool-calling turn benches ~60–100s on this CPU box, so EVERY live request
  aborted at 45s → fell back to `deterministicDispatch` → printed the misleading
  "No LLM is running" pattern list (Ollama was up, just slow). Fixed: per-gen cap
  → **180s** (`OLLAMA_TIMEOUT_MS`), added a whole-request budget
  **300s** (`OLLAMA_TOTAL_BUDGET_MS`; each gen's effective timeout =
  min(per-gen, remaining)), client ceiling → **360s**. AND the ollama-branch
  failure path no longer falls to the deterministic dispatcher — it returns an
  HONEST `mode:"ollama-error"` message ("local model didn't finish: … it's
  running but slow"). The deterministic dispatcher is only reached via
  `pickBackend` when Ollama is genuinely unreachable.
- **Env knobs:** `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`,
  `OLLAMA_KEEP_ALIVE`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_TOTAL_BUDGET_MS`,
  `OLLAMA_TOOL_ALLOWLIST` (all in `server/.env`, commented defaults included).
  NOTE: this box does CPU inference (~9.8s for 3 tokens) — multi-step requests
  are still slow regardless; the progress line (client) is why it no longer
  *feels* stuck. No re-seed; **server restart** picks up the service + model
  changes.

## Recent Changes (2026-06-03 — Schedule: Mark Passed Slots (time-based op) + TIME_BEFORE/DATE_BEFORE comparators)

## Recent Changes (2026-06-03 — Schedule: Mark Passed Slots (time-based op) + TIME_BEFORE/DATE_BEFORE comparators)
- **Replaces the removed hardcoded `is-timeslot-passed` client tint** (that baked
  schedule knowledge into the generic `ModuleContainer` — see client/src/CLAUDE.md).
  Coloring is now 100% data-driven via an operation; no component knows what a
  "schedule"/"timeslot" is.
- **`client/src/helpers/operationActions.js` (`evalRule`)** — two generic,
  domain-agnostic comparator pairs added: `TIME_BEFORE`/`TIME_AFTER` (parse 12h
  "9:00am"/"9am" + 24h "14:30" + ISO time-parts → minutes, compare; unparseable →
  false) and `DATE_BEFORE`/`DATE_AFTER` (calendar day-key compare; regex-slice
  avoids `new Date` tz shift). 8 regression tests in
  `__tests__/operationActions.unified.test.js` (216 pass).
- **`scripts/createLiveData.js` — new `Schedule: Mark Passed Slots` op** (inserted
  after Canvas: Build). TIME-BASED: `schedule: { kind:"interval", every:5,
  unit:"minute" }`, `triggerObjects:[]`, `triggerTypes:[]` (fires only via
  `useScheduler`, never events — explicit empty arrays). 5 min ≥ the 60s
  persistent-effect floor (it writes occurrence style). Logic: loop day-col
  containers (`fields.scheduleFormat IS "day-col"` under Schedule) → a slot is
  "passed" if its day-col date `DATE_BEFORE $today` (whole past day) OR
  (`SAME_DAY $today` AND its `timeslot TIME_BEFORE $currentTime`); future days
  untouched. Writes the GENERIC `occurrence.ownStyle.bg` (which
  `resolveContainerStyle` overlays unconditionally — `applyUpdate` supports the
  `$slot.ownStyle.bg` path → `UPDATE_ITEM_OWN_STYLE`). Per-day-column correct
  because day-col slots are PER-DAY COPY_LINK copies (not shared). Dedup'd:
  compares current `ownStyle.bg` before writing, so steady-state fires emit ~zero
  socket writes; reset writes `bg:""` (mergeStyles treats falsy bg as inherit).
  Regression: `__tests__/createLiveData.test.js` ("…is time-based and writes
  ownStyle via TIME_BEFORE/DATE_BEFORE").
- **Re-seed REQUIRED** to apply: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-06-03 — Schedule Table + Canvas: Build migrated to the period model — FIX: produced zero rows/cards)
- **`scripts/createLiveData.js` (`Canvas: Build` op, ~line 8970)** — Phase 1 of
  the Schedule Canvas fix. Same single-date bug as Table: Build (below) — `$schedDate`
  + `SAME_DAY` against the picker's period object matched nothing → zero cards.
  Migrated identically: new `$schedPeriod` (page effective filter primary →
  `$trigger.date` → `$today`); the orphan-sweep `$srcProbe` rule and the
  existence-check `$task` rule switched `SAME_DAY $schedDate` →
  `DATE_IN_PERIOD $schedPeriod`. Diff-mode position preservation + `linkedGroupId`
  Schedule↔canvas sync untouched. Regression: `__tests__/createLiveData.test.js`
  ("Canvas: Build is period-aware …").
  - **Phase 2a (mindmap preview nodes — DONE this session):** each freshly-minted
    card gets `UPDATE $copy.meta.viewMode = "representation"` right after the
    meta.x/y stamp, so canvas cards render as compact representation chips
    (label + type icon) instead of full inline instances. meta is canvas-local
    (excluded from the linkedGroupId fan-out like meta.x/y), so the Schedule
    source keeps its own view mode. Only stamped on mint (guarded by the
    no-existing-copy check) so a user's manual view-mode flip survives re-fires.
    Edges (`containerOccurrence.meta.edges = [{id, from:occId, to:occId}]` on the
    canvas PAGE occurrence) render via the connect tool; cards render via the
    `renderCard` prop — the canvas has no viewMode logic of its own (it's
    per-occurrence meta, honored by ModuleInstance/Container).
  - **Phase 2b (mindmap edge chain — DONE this session, the "easier"/implicit
    variant):** the rebuild branch now threads task cards into a linear mindmap
    chain via auto-generated edges on `$canvas.meta.edges`. Implementation:
    (1) `$edges` is seeded from the canvas's CURRENT edges minus any whose id
    CONTAINS `"auto-"` — so hand-drawn connect-tool edges (ids `"e-…"`) survive
    while the op's chain regenerates each rebuild; the preserve-loop over
    `$canvas.meta.edges` is safe even when undefined (loop coerces non-array
    overExpr → [], operationExecutor:663). (2) The task loop resolves each
    in-period task to a card id `$curCardId` — an EXISTING canvas copy (matched
    by linkedGroupId) OR a freshly-minted one — then pushes an edge
    `{id:"auto-${prev}-${cur}", from:prev, to:cur}` threading consecutive tasks,
    and SET_VARs `$prevCardId`. Because $curCardId is captured for existing cards
    too (not just mints), the chain is always complete over the current task set,
    not just newly-added cards. (3) One `UPDATE $canvas.meta.edges = $edges` at
    the end. **Known scope of the "easier" variant:** it's a single LINEAR chain
    in `$allInstances` iteration order — NOT slot-branched and NOT guaranteed
    chronological/by-timeslot. A richer day→slot→task branched graph (explicit
    slot-label nodes + per-slot columns + slot→task edges) is the future upgrade;
    it needs CREATE'd slot nodes with their own diff-mode lifecycle. Regression:
    `__tests__/createLiveData.test.js` ("Canvas: Build stamps preview nodes +
    builds the mindmap edge chain").
- **`scripts/createLiveData.js` (`Table: Build` op, ~line 8635)** — root-cause
  fix for "the Schedule Table produces no occurrences." The op resolved a single
  `$schedDate` (`$trigger.date` → `$schedPage._effectiveFilter.<dateFieldId>` →
  `$today`) and matched tasks with `SAME_DAY $schedDate`. After the multi-day
  Schedule refactor, the DrilldownDatePicker writes a period **object**
  (`{value,unit,kind,dates}`) into the effective filter — even for a single day —
  so `SAME_DAY` compared a date string against an object and matched nothing →
  zero rows. Migrated to the SAME period model the trackers + Build Schedule use:
  - New `$schedPeriod` resolves **page-effective-filter FIRST** (full object),
    then `$trigger.date`, then `$today`. Page-primary so week/month/multi views
    mirror their whole window (the trackers' `$goalPeriod` pattern).
  - All three task-match rules (Phase 1 orphan-sweep `$srcProbe`, Phase 2
    existence-check `$task`, Phase 3 cells-rebuild `$task2`) switched
    `SAME_DAY $schedDate` → `DATE_IN_PERIOD $schedPeriod`. `DATE_IN_PERIOD`
    already handles day/week/month/year + `{kind:"multi"}` and treats a bare
    `YYYY-MM-DD` as day-unit, so single-day still works. Cells/columns unchanged
    (the Date column disambiguates the extra period rows).
  - Regression: `__tests__/createLiveData.test.js` ("Table: Build is period-aware
    … no SAME_DAY $schedDate"). DB-gated like its siblings (skips without Mongo).
  - **Re-seed REQUIRED to apply:** `node --env-file=.env server/scripts/createLiveData.js`.
  - `Canvas: Build` got the same Phase 1 migration this session (see the entry
    above); its Phase 2 mindmap layer is the remaining Schedule Canvas work.

## Recent Changes (2026-05-27 — Goal refactor: per-metric splits + Media goal + rich history cells)
- **`scripts/createLiveData.js` — umbrella goal instances split into per-metric
  occurrences** (continuation of the Stage-3 goal restructure; account2 did
  Physical/Intellectual + the 7 summaries first):
  - `workoutGoal` umbrella → `workoutReps` ("Reps") + `workoutLog` ("Workout
    Log": last+history pair). Dropped the dead `totalSteps` tile (steps is only
    written to `physicalSteps` — no workout-steps tracker). Per-muscle volume
    tiles unchanged siblings.
  - `nutritionGoal` umbrella → `nutritionProtein`/`nutritionCarbs`/
    `nutritionFats` + `nutritionLog` ("Meal Log": last+history). Per-meal tiles
    unchanged.
  - **Media goal (NEW)** — replaced the 3 standalone `moviesWatchedGoal` /
    `booksReadGoal` / `podcastsListenedGoal` containers with ONE `mediaGoal`
    ("Media") container holding `mediaMovies` / `mediaBooks` / `mediaPodcasts`
    per-type occurrences, each = **last + history** (count was considered then
    dropped per user). New fields: `lastMovie` / `lastBook` / `lastPodcast`.
- **All affected trackers stay mechanics-faithful** — only `goalOccurrenceId` /
  `goalLabel` / `displayRules`-key changed (never op names or pipeline-step
  logic), so RUN_OPERATION-by-name chains, `$goalPeriod`/`_effectiveFilter`
  resolution, trigger surfaces, and scope guards are untouched. The Movies/Books/
  Podcasts trackers were **converted from FIND-by-label → picker-direct
  `$allItemsById.<occId>`** (the last live FIND-by-label goal lookups — audit
  now finds ZERO). `displayRules` keys re-keyed to each new tile's label
  ($displayRules is keyed by occurrence label).
- **Rich history cells** — the Movies/Books/Podcasts trackers now
  `PUSH_TO_ARRAY` descriptor rows: `label` = `{ kind:"occurrence", id:$X.id }`
  (renders a click-to-jump chip), Movies/Books also add `poster` =
  `{ kind:"media", id:$X.id, fieldId:posterUrlFieldId }`. Consumed by the new
  `ArrayCell` renderer (see client/src/ui/CLAUDE.md). `deepResolveExpr` resolves
  the `$X.id` leaves inside the nested descriptor objects.
- Goal containers auto-parent into the Daily Goals page via
  `occurrences: Object.values(goalContOccIds)` — no manual page-wiring needed
  when adding/removing a goal container.
- **Re-seed REQUIRED** to apply (seed-data only, no schema change):
  `node --env-file=.env server/scripts/createLiveData.js`. 152/152 server tests
  green.

## Recent Changes (2026-05-26 — stale-write check exempts same-socket self-succession)
- **`socketHandlers/occurrences.js` (`update_occurrence`)** — both the
  medium-tier per-field conflict check AND the cheap outer-doc stale check now
  skip rejection when the LAST writer of that occurrence was the SAME socket
  (`uc._lastWriterByOcc[id] === socket.id`). New per-user-cache map
  `uc._lastWriterByOcc`, stamped after every successful write.
- **Root cause of "schedule flashes then vanishes + 'another window had a newer
  edit' toast" (single window):** switching the date on the Schedule page
  writes the page's `filterOverride`, then the `Schedule: Build Schedule` op it
  triggers writes the SAME page occurrence's `meta.layoutCascadeOverride`
  (UPDATE_ITEM_META routes through CommitHelpers.updateOccurrence, which sends
  `expectedUpdatedAt`). The second write's baseline predates the first write's
  persist ack → server sees its stored copy as newer → false `occurrence_stale`
  → the client re-syncs the page and the just-built day disappears. A real
  cross-window conflict (different socket.id) is still detected. Server-restart
  only — NO reseed (handler logic, not seed data).
- Pairs with the same-session client fixes (cascade dedup + Build Schedule
  targetOccurrenceId — see below + client CLAUDE.md). 152 server tests green.

## Recent Changes (2026-05-26 — Build Schedule reacts to on-page date switch; filters uniform)
- **`models/Operation.js`** — new `targetOccurrenceId: { type: String, default:
  null }`. The executor (operationExecutor.js:1174) already reads
  `operation.targetOccurrenceId` to resolve the built-in date vars
  (`$activeDate` / `$activePeriod` / `$activePeriodDates`) from THAT occurrence's
  effective filter cascade — but the field was never in the schema (strict mode
  dropped it) and no op set it, so the built-ins always fell back to the GRID
  filter.
- **`utils/liveSystemBuilders.js` (`makeScheduleBuildScheduleOp`)** — now sets
  `targetOccurrenceId: schedulePageOccId`. **Root cause of "schedule builds on
  first load but not after switching the date on the page":** Build Schedule
  loops `$activePeriodDates`, which (target unset) resolved from the GRID filter.
  A toolbar switch changes the grid (worked); an **on-page** switch writes only
  the Schedule page's `filterOverride` (grid unchanged) → `$activePeriodDates`
  stale → it rebuilt the old day, never the new one. Pointing the op at the
  Schedule page makes the built-ins resolve through the page's effective filter
  cascade (page override → grid) — the SAME cascade `Table: Build` and the
  trackers already read in-pipeline (`$schedPage._effectiveFilter`). Grid and
  on-page filter switches are now uniform. The page's filterOverride carries the
  full picker period-shape `{value,unit,kind,dates}`, so this also makes Build
  Schedule consume the rich picker data instead of a grid-flattened value.
- **Re-seed REQUIRED** (op + schema change):
  `node --env-file=.env server/scripts/createLiveData.js` (restart the server
  first so the new schema field persists).
- Regression: `__tests__/liveSystemBuilders.test.js` ("Build Schedule sets
  targetOccurrenceId to the Schedule page …"). 25 tests green.
- **`vitest.config.js`** — `test.cache.dir` → top-level `cacheDir` (silences the
  deprecation warning; client `vite.config.js` got the same change).

## Recent Changes (2026-05-25 part 4 — setMaxListeners on per-socket AbortSignal)
- **`socketHandlers/crud.js` + `socketHandlers/occurrences.js`** — each
  socket creates ONE `AbortController` whose `.signal` is passed to every
  Mongoose query for the socket's lifetime (so a disconnect cancels all
  in-flight round-trips at once). A write burst attaches >10 concurrent
  `abort` listeners to that single signal, tripping Node's default-10 leak
  heuristic → `MaxListenersExceededWarning: 11 abort listeners added to
  [AbortSignal]`. They aren't a leak (each clears when its query settles),
  so both files now call `setMaxListeners(100, abortController.signal)`
  (`import { setMaxListeners } from "node:events"`) right after creating the
  controller. Cosmetic — silences the warning without changing the
  one-controller-per-socket cancellation design. No re-seed.

## Recent Changes (2026-05-25 part 3 — INCLUSIVE scope guard on all mirror ops — FREEZE FIX, the actual one)
- **Root cause (confirmed from `console-export-2026-5-25_18-16-8`):** the
  toolkit-drop freeze is a flat **depth-2** cascade (NOT the depth-8
  recursion the earlier notes assumed — the depth cap never trips). A
  single `OccurrenceDeleteOp` fire runs the whole op suite (86 effects),
  including `Canvas: Build DELETE_ITEM=14 CREATE_ITEM=7`; each of those 14
  deletes re-fires `OccurrenceDeleteOp` → re-runs the suite → loop. **Proof
  in the same log:** `Schedule Table: Build` (already converted to the
  inclusive scope guard last session) fired **6×**; `Canvas: Build` (still
  on the old EXCLUSIVE self-trigger guard) fired **57×** — identical
  trigger surface, opposite outcome.
- **Why the exclusive self-trigger guard failed:** it skipped the rebuild
  only when it could PROVE the trigger was the op's OWN copy
  (`$trigger.occurrence._ancestors HAS_ANCESTOR <ownPageId>`). That proof is
  impossible for a DELETE — the occurrence is already gone from the store,
  so its `_ancestors` resolve empty → guard false → rebuild runs on the
  op's own orphan-sweep deletes → cascade.
- **Fix — flip every mirror op to the INCLUSIVE guard:** rebuild ONLY when
  the trigger is positively a source change — a bulk fire (`$triggerOccId
  IS_EMPTY`) OR `$trigger.occurrence._ancestors HAS_ANCESTOR <sourcePageId>`.
  A deleted/created derived copy can't prove it's a source occurrence, so
  the op no-ops and the cascade dies at the source. Pattern: compute
  `$isSourceChange` (0/1) via two IFs, gate the rebuild on it.
  - **`scripts/createLiveData.js` `Canvas: Build` (~line 8891)** — replaced
    the exclusive guard (+ the now-redundant missing-position self-heal
    probe) with the inclusive guard keyed to `$schedPageId`. Diff body stays
    in the `else` branch (no-op `then`).
  - **`scripts/createLiveData.js` `People Table: Build` (~line 9165)** —
    wrapped its loop + rowCount write in the inclusive guard keyed to the
    **Library container** (`libraryContOccId`), NOT the People page: the
    table's own rows are COPY_LINK copies that also carry
    `library:"person"`, so scoping by the person tag alone would re-match
    them. Ancestor-scoping to the Library container excludes the table's
    rows (parented under the table, not the container).
  - **`utils/liveSystemBuilders.js` `makeDayPageBuildTasksCompletedOp`
    (~line 1658)** — computes `$isSourceChange` (keyed to `$schedPageId`,
    already resolved early) and ANDs `$isSourceChange IS 1` into the
    existing `$dayPageId IS_NOT_EMPTY` rebuild gate. This op only writes a
    textmap (no CRUD fuel) but fired 57× on the cascade via its unscoped
    onAdd/onDelete triggers — now no-ops on non-source CRUD.
- **Pairs with the client-side executor cycle breaker** (see
  client/src/state/CLAUDE.md) — defense-in-depth so op-emitted CRUD echoes
  can never re-fire triggers even if a future mirror op forgets its guard.
- **Re-seed REQUIRED to apply** (seed-data change):
  `node --env-file=.env server/scripts/createLiveData.js`.
- **Regression tests:** `__tests__/liveSystemBuilders.test.js` (3 cases on
  the Day Page op's guard shape — no DB) + `__tests__/createLiveData.test.js`
  (2 DB-backed cases asserting Canvas/People Table pipelines carry the
  inclusive guard). 151 server tests green.

## Recent Changes (2026-05-25 — Table:Build diff mode — FREEZE FIX continuation)
- **`scripts/createLiveData.js` (`Table: Build`, ~line 8632)** —
  rewrote the ELSE branch from clean-and-rebuild to true diff mode
  (mirrors `Canvas: Build`'s pattern). Three phases:
  - **Phase 1** — orphan sweep. For each existing row copy under
    `$tblId`, scan `$allInstances` for a matching source task on
    `$schedDate` under Schedule (by `linkedGroupId`). If none found
    → `DELETE` and bump `$changed`.
  - **Phase 2** — per-task existence check. For each Schedule task
    on `$schedDate`, count copies under `$tblId` with matching
    `linkedGroupId`. If zero → `COPY_LINK` once + bump `$changed`.
  - **Phase 3** — cells rebuild, gated on `$changed > 0`. Wipes
    cells, walks tasks in `$allInstances` order, finds each row
    copy by `linkedGroupId`, writes four cell embeds (all pointing
    at the same row occurrence — the column-level `fieldVisibility`
    config picks fields per column). Skipped entirely when nothing
    changed.
  - **One copy per row** (was three). The previous 3-copies-per-row
    layout was redundant — every column's projection comes from
    `meta.table.columns[i].fieldVisibility`, not from the cell's
    occurrence identity. People Table:Build already uses 1
    copy/row; Schedule Table now matches.
  - **Net effect:** steady-state fire emits **zero** create/update
    events. Single-task add → 1 `create_occurrence` + ~74
    `update_occurrence`. Single-task remove → 1 `delete_occurrence`
    + ~69 update events. Pre-refactor, every fire emitted ~54
    `create_occurrence` events regardless of whether the schedule
    changed — the source of the toolkit-drop + date-filter freeze
    (server log showed a flood of unique creates per drop).
  - **Re-seed required to apply:**
    `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-05-25 — `_THAN` comparator aliases + seed cleanup)
- **`client/src/helpers/operationActions.js` `evalRule`** —
  numeric comparators gained `_THAN` aliases:
  `GREATER_THAN` ↔ `GREATER`,
  `LESS_THAN` ↔ `LESS`,
  `GREATER_THAN_OR_EQUAL` ↔ `GREATER_OR_EQUAL`,
  `LESS_THAN_OR_EQUAL` ↔ `LESS_OR_EQUAL`. Seed authors reach for
  the natural-language form; without the alias the rule silently
  fell through to default `false`, making whichever guard branch
  used it dead code. 4 regression tests in
  `__tests__/operationActions.unified.test.js`.
- **`scripts/createLiveData.js:8624` + `:8917`** —
  `Table: Build` and `Canvas: Build` idempotency guards rewritten
  to use the canonical `GREATER` comparator. Same intent, now
  actually evaluates. Re-seed picks up the change.

## Recent Changes (2026-05-25 — Table/Canvas Build self-trigger guard — FREEZE FIX)
- **`scripts/createLiveData.js` (`Table: Build` ~8615, `Canvas: Build`
  ~8779)** — both ops' rebuild-gate IFs gained a self-trigger guard:
  the no-op THEN now also fires when
  `$trigger.occurrence._ancestors HAS_ANCESTOR $tblId` (resp.
  `$canvasId`) — i.e. the triggering add/delete is one of the op's OWN
  row/card copies, not a real Schedule change. Condition went from
  `AND(rowCount>0, triggerEmpty[, missingPos=0])` to
  `OR(selfGuard, AND(...existing))`. **Root cause of the app freeze on
  drop-into-Schedule:** both ops trigger on unscoped `onAdd`/`onDelete`
  (instance + container, `targetId:""`) AND delete-then-rebuild their
  own copies in an orphan sweep. Each cleanup `DELETE` →
  `deleteOccurrence` (CommitHelpers) → synchronous `OccurrenceDeleteOp`
  → re-matched both ops → deleted more → exponential fan-out bounded
  only by the depth-8 cap (which is why the console flooded with
  `fire depth cap hit … OccurrenceDeleteOp`). The guard breaks the
  self-loop at the source while preserving "rebuild when Schedule
  changes". Relies on the new `$trigger.occurrence._ancestors`
  enrichment (see client/src/helpers/CLAUDE.md).
  **Re-seed required to apply:**
  `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (2026-05-21 — Jarvis assistant (branch: assistant-jarvis))
- **`services/wikipediaTools.js` (NEW)** — `search`, `summary`, and
  `fullMarkdown` against the public Wikipedia REST + MediaWiki APIs.
  No auth. Includes a dependency-free HTML→markdown converter tuned
  for Wikipedia output (strips infobox/navbox/refs/images, keeps
  headings/paragraphs/lists/inline marks).
- **`services/assistantAgent.js` (NEW)** — Jarvis. Two modes:
  - Mode A (default, no key): deterministic dispatcher matching
    `wiki <q>` / `look up <q>` / `page on <q>` / `research <q>` /
    `import:\n<md>` / `list ops` to the matching tool.
  - Mode B (`ANTHROPIC_API_KEY` set): real Claude agent loop with
    tool catalog. Default model `claude-haiku-4-5-20251001`,
    overridable via `ANTHROPIC_MODEL`. MAX_TOOL_ITERATIONS=6 cap.
  Tool catalog (5 tools): `wikipedia_search`, `wikipedia_import`,
  `import_markdown`, `list_operations`, `run_operation`. Each tool
  is a wrapper over an existing `/api/v1/*` endpoint — Jarvis has
  no special privileges.
- **`routes/apiV1.js`** added:
  - `GET /research/wikipedia/search?q=` — list matches
  - `GET /research/wikipedia/summary?title=` — lede + thumbnail
  - `GET /research/wikipedia/full?title=` — full article as markdown
  - `POST /research/wikipedia/import` — composite search → fullMarkdown
    → markdownImporter → broadcast. One HTTP call = a finished page.
  - `POST /assistant/chat` — chat endpoint. Body: `{ messages, gridId }`.
- **`@anthropic-ai/sdk`** added as server dep.

## Recent Changes (2026-05-21 — Phase 4: webhook HMAC + idempotency keys + markdown import)
- **`models/Operation.js`** — added `webhookSecret: String | null`.
  When set, `/api/webhooks/:operationId` requires
  `X-Moduli-Signature: sha256=<hex>` matching `HMAC-SHA256(secret, rawBody)`.
  Unset → endpoint accepts any request (back-compat / public hooks).
- **`server.js`** — global `express.json()` now skipped for
  `/api/webhooks/*` so the raw body bytes survive for HMAC verification.
  Webhook handler uses `express.raw({ type: "*/*", limit: "1mb" })`,
  verifies signature with `crypto.timingSafeEqual`, then parses JSON
  itself for the trigger payload.
- **`routes/apiV1.js`** — added `POST/DELETE /operations/:id/webhook-secret`
  to mint/rotate/disable the HMAC secret. Mint response includes the
  raw secret exactly once (caller must store it).
- **`middleware/idempotency.js` (NEW)** — `Idempotency-Key` header
  support on mutating verbs. Cache keyed by
  `(tokenId, method, path, idemKey)`, 24h TTL, cap 10k entries.
  Replays return cached body with `X-Idempotent-Replay: true`. First
  call gets `X-Idempotent-Stored: true`.
- **`services/markdownImporter.js` (NEW)** — Phase A of the doc
  import pipeline. Deterministic markdown → Moduli entities:
  - `#/##/###` headings → container (kind:list), nested by depth
  - `*/-`/`1.` list items → instance (kind:list)
  - prose paragraphs → textblock (kind:doc) with TipTap JSON
  - fenced code blocks → textblock with codeBlock node
  - inline `**bold**`/`*italic*`/`` `code` ``/`[text](url)` → TipTap marks
  Verified live: 4-heading doc produces 5 containers + 5 instances +
  3 textblocks.
- **`routes/apiV1.js`** — added `POST /import/markdown` exposing the
  importer. `dryRun: true` returns the planned tree without minting.
  Real imports broadcast `module_created` + `occurrence_created` to
  the user's socket room. Idempotency middleware applies, so a
  repeated `Idempotency-Key` won't double-import.
- **`docs/api-testing.md`** — new section 12 with webhook HMAC, idempotency,
  and markdown import recipes + verified-live examples.

## Recent Changes (2026-05-21 night — /api/v1 Phase 3: server executor + secrets + OpenAPI + rate limit)
- **`services/serverExecutor.js` (NEW)** — headless executor for
  `/api/v1/operations/:id/run` when no browser tab is connected.
  Subset of the client executor: `INIT_VAR / SET_VAR / IF / LOOP /
  CALL_API / SHOW_VALUE`. Pure async — Node `fetch` for CALL_API,
  Mongo lookup for `$secrets.X`. Anything outside that subset
  (FIND/CREATE/etc.) still needs the full client executor.
- **`models/Secret.js` (NEW)** — per-user encrypted secret store.
  AES-256-GCM, master key from `SECRETS_KEY` env (32 raw bytes
  base64-encoded). `(userId, key)` unique index. Fails closed if
  `SECRETS_KEY` missing. Used by serverExecutor's `$secrets.<KEY>`
  expressions in CALL_API headers/body/url.
- **`middleware/rateLimit.js` (NEW)** — per-token in-memory token-
  bucket (default 600 req/min). Composes with `apiAuth` so it runs
  after the token's identity is known. Exposes
  `X-RateLimit-{Limit,Remaining,Reset}` + `Retry-After` headers.
  Single-process state; multi-instance deploys need redis.
- **`routes/apiV1OpenApi.js` (NEW)** — hand-curated OpenAPI 3.1
  document. Auto-served at `/api/v1/openapi.json` (no auth — tooling
  needs to fetch the spec to learn the auth scheme). Covers all 17
  path templates, security scheme, request + response shapes.
- **`routes/apiV1.js` updated**:
  - `/operations/:id/run` accepts `executor: "auto" | "server" | "client"`.
    `auto` (default) prefers the client when connected, falls back to
    server executor. Response includes `executor: "server" | "client"`.
  - All 27 protected routes now use `authAndLimit(...)` instead of
    bare `apiAuth(...)` so the rate limiter actually runs.
  - New endpoints: `GET /secrets`, `POST /secrets`,
    `DELETE /secrets/:key`, `GET /openapi.json`.

## Recent Changes (2026-05-21 late — /api/v1 Phase 2: full CRUD + bulk + batch)
- **`routes/apiV1.js` expanded** — added every CRUD verb across the
  four primary entities + bulk + batch:
  - Modules: GET (list w/ ?gridId&role&kind&q&limit&cursor), POST,
    PATCH, DELETE
  - Occurrences: GET (list + by-id), POST, PATCH, DELETE, plus the
    Phase-1 single-field PUT and a new bulk PATCH at
    `/occurrences/:id/fields`
  - Fields: GET (list w/ ?gridId&q&type), POST, PATCH, DELETE, plus
    `POST /fields/bulk` (cross-occurrence bulk writes)
  - Operations: GET (list w/ ?runnable=true filter), POST, PATCH,
    DELETE, plus the headliner POST /:id/run
  - Batch: `POST /batch` — packs N sub-requests in one round-trip,
    each fans through the same router so auth + validation +
    broadcast guarantees match the direct endpoints. Query-string
    parsing implemented so sub-paths like
    `/operations?runnable=true&limit=5` work.
- **`middleware/apiAuth.js`** — early-exit when `req.apiToken` is
  already attached (avoids per-sub-request bcrypt cost inside /batch).
  Scope check still applies.
- **Cursor-based pagination** — `?limit=N&cursor=<base64>` returns
  `{ items, nextCursor, total }`. Cursor encodes the last entity id;
  next page starts after it. Cap 500. Slice-1 implementation iterates
  in-memory after the DB query; phase-3 will push to mongo.
- **All write endpoints broadcast** `*_updated` / `*_created` /
  `*_deleted` to `userRoom(userId)` so connected browser tabs sync
  the same frame the external write lands. REST behaves identically
  to internal socket CRUD from the client's POV.
- **`docs/api-testing.md` (NEW)** — full testing tutorial: prereqs,
  setup, smoke tests, endpoint recipes, end-to-end demo walkthroughs
  (both browser-tab and headless modes), troubleshooting, and a
  "build your own CALL_API op" recipe.

## Recent Changes (2026-05-21 — /api/v1 REST surface + CALL_API outbound action)
- **`models/ApiToken.js` (NEW)** — per-user Bearer token. Wire shape:
  `moduli_<tokenId>_<secret>`. `tokenId` is indexed for O(1) lookup;
  `secret` is bcrypt-hashed. `ApiToken.mint({userId,name,scopes})`,
  `ApiToken.authenticate(rawToken)`, `ApiToken.parse(rawToken)`.
  `lastUsedAt` write-debounced to once per 60s.
- **`middleware/apiAuth.js` (NEW)** — `apiAuth({requireScope})` Express
  middleware. Sets `req.apiToken` + `req.userId` on success; 401 / 403
  on auth / scope failure.
- **`routes/apiV1.js` (NEW)** — Slice-1 REST surface (per
  `docs/api-plan.md`):
  - `GET  /api/v1/grids` — list grids
  - `GET  /api/v1/grids/:id/state` — full snapshot
  - `PUT  /api/v1/occurrences/:id/fields/:fieldId` — write field value
    (broadcasts `occurrence_updated` to user room)
  - `POST /api/v1/operations/:id/run` — synchronous op invocation. The
    headliner. Emits `run_op_for_api` to the user's socket room, holds
    the HTTP response open via `opRunBridge` until a connected client
    emits `api_op_result` back with effects + final `$vars`.
- **`utils/opRunBridge.js` (NEW)** — `Map<requestId,{resolve,reject,
  timer}>` holding HTTP responses while clients run ops over socket.
  Slice-1 mechanism; Phase 3 replaces with a true server-side executor
  (CALL_API needs it for secrets + CORS).
- **`server.js`** — mounts the v1 router, instantiates the bridge, and
  registers the `api_op_result` socket listener that resolves bridge
  promises.
- **`scripts/createApiToken.js` (NEW)** — CLI:
  `node --env-file=.env server/scripts/createApiToken.js <email> [scopes] [name]`
  → prints raw token exactly once.
- **`scripts/seedApiDemoOp.js` (NEW)** — mints a `Demo: Weather Lookup`
  operation that uses `CALL_API` to hit api.open-meteo.com + surfaces
  the result via `SHOW_VALUE` so it lands in the
  `POST .../operations/:id/run` response under `vars`.
- **`scripts/apiDemo.js` (NEW)** — exercises every endpoint
  end-to-end. Verified live: token auth works, grid state returns
  ~600 occurrences, op invocation pulls live Chicago weather from
  open-meteo and returns `{ $temperature: 8.3, $windSpeed: 16.2,
  $units: "°C" }`.
- **`scripts/apiDemoClient.js` (NEW)** — headless socket.io client
  acting as a "fake browser tab" for the demo when there's no real
  client connected. Production users have a Moduli tab open; this
  script is only for terminal-only demos.
- **`socket.io-client`** added to server `package.json` (dev — only
  used by the demo client script).
- **`Operation.triggerType`** — new value `manual` honored; the demo
  op uses it so it doesn't fire on load.

## Recent Changes (2026-05-20 — delete_occurrence cascade respects multi-parenting)
- **`socketHandlers/crud.js delete_occurrence`** — `collectDescendants`
  now only recurses through a child when `child.parentId === id` (i.e.
  the node being deleted is the child's CANONICAL parent). Multi-parented
  children (in `parent.occurrences[]` but with a different `parentId`)
  survive — the existing cleanup loop just detaches them from the
  cascading parent. Fixes a latent bug in
  `makeScheduleBuildScheduleOp` PHASE 5: deleting an out-of-period
  day-col would have wiped every multi-parented slot + the shared Due,
  forcing a full Schedule rebuild via PHASE 2/3 on every period change.
  Single-parent cascades (test grid, every other op) byte-identical to
  before.

## Recent Changes (May 19 2026 — Daily Journal Questions page)
- **scripts/createLiveData.js**: New "Daily Journal Questions" page
  (`role:page kind:board`) pinned in the Library folder at `sortOrder: 1`
  (Library page is sortOrder 0). Contains a new "Reflection Questions"
  container (`role:container kind:list`, `questionsContModId/OccId`) whose
  `occurrences[]` lists the 7 existing question occurrence IDs. The
  questions stay parented under `libraryContOccId` (canonical) and render
  in BOTH places via multi-parent occurrences[] membership — editing a
  question label here updates the Library page too. Page-level
  `filterOverride: {}` + `filterNavConfig.filter_daily.visible: false`
  (mirrors the Library page). No grid panel pin — Library folder only.

## Recent Changes (May 19 2026 — Day Page Build Tasks Completed op + journalQuestion randomizable)
- **utils/liveSystemBuilders.js**: New
  `makeDayPageBuildTasksCompletedOp({ userId, gridId, dateFieldId,
  completedFieldId, isTaskFieldId })` factory. Mirrors `makeDayPageBuildOp`'s
  `$dayDate` chain + idempotent page lookup, then FINDs the cloned "Tasks
  Completed" container under the day page (`parentId IS $dayPageId AND
  label IS "Tasks Completed"`) and rewrites its `textmap` to a
  `{type:"doc", content:[moduleEmbed×N]}` doc — one embed per completed
  task on `$dayDate` under Schedule (`_ancestors HAS_ANCESTOR $schedPageId
  AND fields.<dateFieldId>.value SAME_DAY $dayDate AND completed IS true
  AND isTask IS true`). Uses PUSH_TO_ARRAY + `deepResolveExpr` so each
  `attrs.occurrenceId` resolves to the iteration's `$task.id`. Empty
  result writes a single empty paragraph so TipTap's non-empty-content
  invariant holds. Priority 4 (after Build Day/Stamp/trackers).
- **scripts/createLiveData.js**:
  - Imports + instantiates the new op alongside `makeDayPageBuildOp`.
  - `journalQuestion` field gains `meta.randomizable: true` and
    `meta.optionsSource = { mode:"find", find:{ over:"$allInstances",
    predicate: AND(fields.<libraryFid>.value IS "question"),
    valuePath:"label", labelPath:"label" } }`. FieldRenderer's display
    branch surfaces a 🎲 button (client side) — the Rotator op still
    drives the value on filter changes; the button is a manual re-roll.
- Re-seed required: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (May 18 2026 — Schedule Table column widths rebalanced)
- **scripts/createLiveData.js (Schedule Table `meta.table.columns`)**: widths Date 150→200, Time 150→200, Goal 320→230 (Task stays 240). Date/Time projection columns were cramped while Goal had excess space; the client's `effectiveWidths` scaler preserves these ratios when filling the panel. Existing live grids were patched in-place via a one-off `Occurrence.updateOne` on `meta.table.columns` (the `Schedule Table: Build` op only writes `cells`/`rowCount` by path, so it doesn't clobber column defs) — but the running server caches occurrences in memory, so a server restart (or reseed) is needed for an already-loaded grid to serve the new widths. No new reseed strictly required for the data, but `node --env-file=.env server/scripts/createLiveData.js` will produce the new widths for fresh grids.

## Recent Changes (May 18 2026 — Schedule Table columns use fieldVisibility instead of displayFieldId)
- **scripts/createLiveData.js (Schedule Table page `meta.table.columns`)**: Date/Time columns no longer use the single-field `displayFieldId` projection — they now use `fieldVisibility: { mode: "show", fieldIds: [<one fid>] } + hideLabel: true`. The cell embed renders the full `ModuleInstance` for the copy but filters down to the single targeted field (date or timeslot) AND suppresses the row label (the task name is already in the Task column — duplicating it here added noise). Goal column keeps `fieldVisibility: null + hideLabel: false` (full embed). Task column bumped width 220→240. Visual result: every cell now reads as a row of the same instance, just filtered differently per column — matches the user's mental model of "table rows are occurrences, columns are field projections" instead of "table cells are arbitrary content". Re-seed required: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (May 18 2026 — Schedule Table: Build skips rebuild when already populated)
- **scripts/createLiveData.js (`Schedule Table: Build` op)**: Wrapped step 7–9 (cleanup + reset + rebuild) in an early-exit IF. New guard: `$tbl.meta.table.rowCount > 0 AND $trigger.type IS_NOT "NavigationOp"` → no-op. Motivation: the full rebuild emits ~50 effects (18 CREATE_ITEM + 6 linkedGroup UPDATEs + 25 cell UPDATEs + 1 final rowCount). Each effect is a Redux dispatch + socket emit that triggers a React re-render of the table — with 24 TipTap editors mounted across the cells, every fire pegged the browser. Op fires on onLoad / onFilterChange / onAdd container / onDelete container; before the guard, every full_state re-ran the whole rebuild even when the table was already correct. Now: first load (rowCount === 0) builds; subsequent reloads see rowCount > 0 + null trigger → no-op; date navigation (`$trigger.type === "NavigationOp"`) always rebuilds for the new day; schedule structure changes (onAdd/onDelete containers) also rebuild because $trigger isn't NavigationOp BUT rowCount might be 0 if Build Day wiped it — covered by the IS_NOT guard which only short-circuits when BOTH conditions hold. Re-seed required: `node --env-file=.env server/scripts/createLiveData.js`.

## Recent Changes (May 18 2026 — Schedule Table: Build is now self-healing)
- **scripts/createLiveData.js (`Schedule Table: Build` op)**: Replaced the per-task dedup-FIND (`$rowExists IS_EMPTY` skip-if-exists) with a "clean + reset + rebuild" sequence: (1) loop `$allInstances` and DELETE every occurrence whose `_ancestors HAS_ANCESTOR $tblId` AND `id IS_NOT $cg` (the goal copy is preserved — its dedup remains); (2) UPDATE `$tbl.meta.table.cells` = `{}` and `$tbl.meta.table.rowCount` = `0`; (3) INIT `$r` = 0 via `literal:0`; (4) then the existing task loop COPY_LINKs + cell UPDATEs run unconditionally for every matching task. Motivation: the prior dedup was idempotent only when both the copies AND the cells map were consistent across runs. A client-side concurrency bug (now fixed — see state/CLAUDE.md UPDATE_ITEM_META) silently dropped all but the last cell write per batch, leaving orphan task copies that the dedup happily skipped forever. Self-healing rebuild costs ~6 deletes + 18 COPY_LINKs + 24 cell UPDATEs per op fire, which is cheap and guarantees the table always reflects the current Schedule even if a prior partial run left bad state. Re-seed required: `node --env-file=.env server/scripts/createLiveData.js`.
- **utils/liveSystemBuilders.js**: `makeScheduleBuildDayOp` accepts new `completedTrackerName` param (default `"Tracker: Tasks Completed Today"` for createTestGrid compatibility). createLiveData passes `"Tracker: Completed Today"` (the name it actually seeds) so Build Day's tail `RUN_OPERATION` resolves — previously crashed with `operation not found`.

## Recent Changes (May 18 2026 — Schedule Table page + Build op in createLiveData)
- **scripts/createLiveData.js**: NEW standalone `role:"page" kind:"table"` **"Schedule Table"** page (Interfaces folder, sortOrder 2, after Schedule/Canvas; `filterOverride:{}`). Seeded `meta.table` with 4 stable columns: col0 "Task" (`fieldVisibility:{mode:"hide",fieldIds:[date,timeslot]}`), col1 "Date" (`displayFieldId:dateFieldId`), col2 "Time" (`displayFieldId:timeslotFieldId`), col3 "Goal". `rowCount:0`, `cells:{}` — the op fills them.
- **scripts/createLiveData.js**: NEW op **"Schedule Table: Build"** (priority 8; triggers onAdd/onDelete/onFilterChange[ancestorLabel:"Schedule"]/onLoad). **Idempotent the same way Schedule: Build Day is** — module-based COPY_LINK (copies reuse the Schedule task's moduleId) parented under the Schedule Table page, with row-level existence dedup using Build Day's exact predicate scoped to the table: `templateId IS $taskTpl AND _ancestors HAS_ANCESTOR $tblId AND fields.<dateFieldId>.value SAME_DAY $schedDate`. Row present → skip (cells persist); absent → create **3 copy-linked task occurrences** (col0 main, col1 date-only, col2 timeslot-only — the column `displayFieldId`/`fieldVisibility` projections render the 3 views) + the shared "Physical Wellness" goal copy for col3 (dedup'd ONCE before the loop by `templateId IS $goalTpl AND _ancestors HAS_ANCESTOR $tblId` and reused for every row). The existence FIND uses `IS_EMPTY` which is unambiguous even though 3 copies share templateId, so no per-copy markers needed. `$r` is append-only from the table's current `rowCount`, so re-running adds nothing and a new day appends — exactly how Build Day leaves prior Due copies untouched. No flags, no stamped meta keys. Cell embed docs written via UPDATE (relies on the client `deepResolveExpr`). FINDs target by `label IS "Schedule Table"`; reads source from `label IS "Schedule"` (Schedule trackers/Build-Day use exact `"Schedule"` so no cross-fire). Op count log → 25. Re-seed required: `node --env-file=.env scripts/createLiveData.js`.

## Recent Changes (May 18 2026 — Occurrence.fieldVisibility)
- **models/Occurrence.js**: new top-level `fieldVisibility: Mixed (default null)`. Per-occurrence field-visibility `{ mode:"show"|"hide"|"off", fieldIds:[] }` that cascades to descendant instances like `filters[]` (resolved client-side by `getEffectiveFieldVisibilityForOccurrence`). Generic `update_occurrence` already persists it (`{ ...prev, ...occurrence }`) — no handler change. No re-seed required (default null).

## Recent Changes (2026-05-17 — Period-aware trackers + Today's Moods)
- **`utils/liveSystemBuilders.js`**:
  - `makeTrackerOp` now gates BOTH the inner loop AND the per-event trigger sub-rule on `DATE_IN_PERIOD $goalPeriod` (was `SAME_DAY $goalDate` / `SAME_WEEK $goalDate`). The aggregator iterates EVERY in-period record under the scope page — weekly view sums all 7 days, monthly view sums all month, etc. `$goalPeriod` is resolved from the goal item's `_effectiveFilter` and carries the full `{value, unit}` object; the same chain (effective filter → `$trigger.date` → `$today`) handles all three cases.
  - `buildGridDoc` exposes `units: ["day", "week", "month", "year"]` on the seeded `filter_daily` named filter so the D/W/M/Y toggle renders on the toolbar FilterNav.
- **`scripts/createLiveData.js`**:
  - **Renamed `Tracker: Latest Mood` → `Tracker: Today's Moods`**. Now a custom pipeline that PUSH_TO_ARRAY's a `{mood, date}` row per mood-bearing occurrence in `$goalPeriod` under Schedule and UPDATEs the goal's display field. The `lastMood` field's `displayConfig.columns` now defines two columns (Mood / When).
  - **Movies Watched / Books Read / Podcasts Listened / Courses Taken trackers**: switched from string concatenation + `SAME_DAY $goalDate` to PUSH_TO_ARRAY `{label, date}` (Books keeps Pages too) + `DATE_IN_PERIOD $goalPeriod`. Each display field has the corresponding `date` column added — table now shows when each entry happened, broadening to weekly/monthly visibility automatically.
  - **Daily Goals page filter**: `units: ["day", "week", "month", "year"]` added to the local `goalsFilterId` so the LocalFilterNav D/W/M/Y toggle renders.
- **`scripts/createTestGrid.js`**: Movies Watched tracker rewritten to the same shape (DATE_IN_PERIOD + PUSH_TO_ARRAY rows + date column). Re-seed required.

## Recent Changes (2026-05-17 — Library page + Watch Movie + Movies Watched tracker)
- **`scripts/createTestGrid.js`**: Added:
  - **New fields**: `libraryFieldId` (select, options:["movie","book","tv show"]), `moviesWatchedFieldId` (occurrence, multiSelect:true, optionsSource.find with addNew pointing to libraryContOccId), `moviesWatchedDisplayFieldId` (text, display), `totalMoviesWatchedDisplayFieldId` (number, display, target 2/day).
  - **Library page**: `libraryPageModId` page module (`role:"page" kind:"board"`), pinned to new `libraryFolderId` folder under Root tree (no grid panel — grid is fully occupied 2×3). Page occurrence has `filterOverride:{}` + `filterNavConfig filter_daily visible:false`.
  - **Library container + 8 movies**: `libraryContModId` + `libraryContOccId` holding Inception / The Matrix / Arrival / Dune / Interstellar / Blade Runner 2049 / The Prestige / Tenet. Each movie occurrence has `libraryFieldId: {value:"movie"}`.
  - **Watch Movie task**: `watchMovieModId` in Daily Toolkit's physContOccId. Bindings: `moviesWatchedFieldId` (input) + `dateFieldId` (hidden).
  - **Movies Watched goal instance**: `moviesWatchedGoalModId` in physGoalContOccId alongside Water + Tasks goals.
  - **Field patch**: After occurrences are created, `Field.findOneAndUpdate` patches `meta.optionsSource.addNew.parentOccurrenceId` to `libraryContOccId` (can't set at insertMany time — occurrence IDs aren't minted yet when fields are seeded).
  - **Tracker: Movies Watched operation**: Custom pipeline (not makeTrackerOp). FINDs "Movie Progress" goal → resolves `$goalDate` → FINDs Schedule page → LOOPs over `$allInstances` for Watch Movie occurrences dated `$goalDate` → inner LOOP over `fields[moviesWatchedFieldId].value` array (occurrence IDs) → resolves each movie occurrence → ADDs to count → UPDATEs `totalMoviesWatchedDisplayFieldId` on the goal item. Trigger surface mirrors Water+Tasks (onChange/onAdd/onDelete/onFilterChange ancestorLabel:"Daily Goals"/onLoad).
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (2026-05-17 — Field type enum: module → occurrence)
- **`models/Field.js`**: type enum drops `"module"`, adds `"occurrence"`. Migration runs lazily client-side at `full_state` ingestion (see `client/src/state/migrateFieldOptionsSource.js`).

## Recent Changes (May 15 2026 — Day Page op/template/folder + root tree org + bills-sweep migration)
- **scripts/createTestGrid.js** — Re-seed required: `node --env-file=.env scripts/createTestGrid.js`.
  - **Root tree organized**: new folders under Root — `Tasks` (Daily Toolkit + Todo List), `Trackers` (Daily Goals), `Interfaces` (Schedule + Canvas Test), then Notes, Day Pages. Page occurrences reparented accordingly (parentId only — panel pinning is independent via panel occ.occurrences[]).
  - **"Day Page" template** (templates manifest): a `role:"page" kind:"doc"` root whose OWN textmap is a single `instanceTextblock` node → a `role:"textblock"` child occ whose textmap is H1 `Day Page - {Date}`. Exactly the shape DocContent.handleAutoCreateTextblock produces, so future "save as template" of any doc-with-textblocks applies the same way.
  - **`Day Page: Build` op**: same trigger surface + `$dayDate` chain as `Schedule: Build Day` ($trigger.date → $schedPage._effectiveFilter → $today). Idempotent by deterministic label `Day Page - <date>`. If missing: APPLY_TEMPLATE with `rootParent` = Day Pages folder, `rootLabel` = the dated name, `replacements { "{Date}": "$dayDate" }`, `rootIdVar: "$newDayPageId"`, then `ADD_CHILD` pins it onto the Center Hub panel occ (`panelOccIds.hub`) as an inactive tab (hub View.activeOccurrenceId stays Schedule — like the Notes page).
  - **`Schedule: Build Day` todo sweep**: the dedup-FIND `else` (copy already exists) now calls `COPY_LINK` in migration mode (`sourceId` + `targetId: $existingCopyId`) so a pre-existing/un-linked Due copy gets retroactively joined to the source todo. Combined with the client COPY_LINK deterministic `lg-<srcId>` change, completing either "Pay monthly bills" now ticks the other (server `update_occurrence` fan-out at occurrences.js:91 matches).

## Recent Changes (May 15 2026 — Build Day: Goals trigger restored + tail re-aggregates trackers)
- **scripts/createTestGrid.js (`Schedule: Build Day`)**: Two regressions resolved.
  - **(1) Goals/Physical filter changes again seed Schedule for that date**: re-added `{ onFilterChange, filterNav, ancestorLabel:"Daily Goals", priority:1 }` trigger. The May 15 morning fix removed it (citing "Schedule pollution") — but the user clarified that the seed for goals' day IS the desired behavior; Schedule's own filter cascade hides cross-day instances, so visually nothing leaks. Without the trigger, navigating Goals to an unvisited day showed 0s indefinitely (no underlying tasks for that day).
  - **(2) `$schedDate` chain reordered**: `$trigger.date` is now the primary, `$schedPage._effectiveFilter.<dateFieldId>` falls back for `onLoad`, `$today` last. Previously `$schedPage._effectiveFilter` won — so a Goals-triggered build pulled Schedule's CURRENT filter (potentially a different day) instead of goals' nav date. The user was explicit: "make sure its getting the date from the goals filter in this case". Build Day's triggers are all explicit user-action sources (toolbar/Schedule LocalFilterNav/Goals LocalFilterNav) — `$trigger.date` is the intended date in every case.
  - **(3) Tail RUN_OPERATION steps invoke both trackers** after APPLY_TEMPLATE + sweep. Previously, navigating Schedule to a new day created tasks but Goals' aggregations stayed at their old count until the user manually re-triggered the trackers (filter nav). Trackers' `onFilterChange` is ancestor-scoped to "Daily Goals" — they don't naturally re-fire on Schedule navs. The in-batch `liveOccs` overlay (operationExecutor.runMatchingOperations) means the trackers see this op's CREATE_ITEM effects. When Build Day was itself called by a Goals nav, the trackers also fire naturally at p3 — these tail invocations are a redundant-but-idempotent recompute (pure aggregations).
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 15 2026 — Schedule sweep uses COPY_LINK; due copy ↔ source todo)
- **scripts/createTestGrid.js (`Schedule: Build Day` todo sweep)**: The CREATE that swept matching todos into Due is now a COPY_LINK (new pipeline action — see client/src/helpers/CLAUDE.md). The swept Due copy shares both `moduleId` AND `linkedGroupId` with the source todo. Result: marking either complete propagates via the server's `update_occurrence` linked-group fan-out (`server/socketHandlers/occurrences.js:91-124`) — both rows tick together. No `fieldHidden` needed (reusing source.moduleId means the source's existing fieldBindings, including the already-hidden date binding, carry through). `copyFields` defaults true so the visual states match before the first propagated write. Dedup FIND unchanged — still matches `templateId IS $todoTemplateId AND _ancestors HAS_ANCESTOR $dueId AND fields.<dateFieldId>.value SAME_DAY $schedDate`, which works because COPY_LINK preserves templateId.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 15 2026 — Build Day: Schedule-anchored date, no Daily Goals trigger)
- **scripts/createTestGrid.js (`Schedule: Build Day`)**: (1) Removed the `onFilterChange filterNav ancestorLabel "Daily Goals"` trigger. (2) `$schedDate` chain is now `$schedPage._effectiveFilter.<dateFieldId>` → `$trigger.date` → `$today` — the `$parentFilter` primary is gone. **Bug fixed**: navigating Daily Goals to another day made Build Day fire with `$parentFilter` (trigger-anchored) = the goals' date, so it APPLY_TEMPLATE'd the Daily Routine into the Schedule page dated to the *goals'* day → Schedule showed two days of occurrences while filtered to one. Build Day now builds the Schedule for the SCHEDULE's own date regardless of trigger; a Daily-Goals nav no longer touches Schedule (trackers re-aggregate via their own trigger over existing data). Same owning-entity rule as the goal trackers (`$goalItem._effectiveFilter`) — never `$parentFilter`.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 15 2026 — Goal trackers: effective-filter walk fixed at the root)
- **Root cause** (the 2026-05-15 "completing a tomorrow task updates today's goal" bug, both directions): `getEffectiveFilterForOccurrence` (client/src/state/selectors.js) and `effectiveFilterFor` (client/src/helpers/operationExecutor.js) walked the ancestor chain via `occ.parentId` only. In seeded data only leaf instances carry `parentId`; containers/pages link children via `occurrences[]` and have NO `parentId` (e.g. the Physical goal container occ — createTestGrid.js:419-423). So a deep goal instance's `_effectiveFilter` stopped at its container, never saw the page/grid filter, came back empty, and `$goalDate` fell to `$parentFilter` (anchored on the trigger = the Schedule task) → tomorrow's aggregate written into the goal viewed for today.
- **Fix**: both functions now prefer an `occurrences[]`-derived parent-by-child reverse map (built lazily; operationExecutor passes its prebuilt `parentByChildId` to avoid O(N²)), falling back to `parentId`. Mirrors the existing `ancestorsFor` / CommitHelpers `_ancestorChain` pattern. Backward compatible — all 13 filterCascade + 167 operationExecutor tests green; 2 new regression tests added.
- **scripts/createTestGrid.js (`Tracker: Water Today` + `Tracker: Tasks Completed Today`)**: `$goalDate` resolution is now `$goalItem._effectiveFilter.<dateFieldId>` → `$trigger.date` → `$today`. The `$parentFilter` fallback is gone (trigger-anchored = wrong for a goal aggregation). Reading off the goal INSTANCE is correct now that the chain walk reaches instance → Physical container → Daily Goals page → grid, so a date filter set at ANY of those levels is captured. (The brief intermediate `$goalPage` page-FIND approach was removed — it only saw a page-level filter, missing a Physical-container-level filter.)
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipelines.

## Recent Changes (May 14 2026 — Template merge identity + schedule rebuild)
- **models/Occurrence.js** — new top-level field `identitySignature: { type: String, default: null, index: true }` (NOT in meta). When set on a template-side occurrence, APPLY_TEMPLATE in `mode: "merge"` treats any sibling under the apply target with the same signature as "the same node" — skips cloning, recurses into its template children. Empty/null = always create a fresh clone on each apply.
- **scripts/createTestGrid.js** — Daily Routine template REBUILT as the FULL schedule subtree: 48 slot containers + routine instances pre-placed inside their slots. Each slot template occurrence carries `identitySignature: \`slot:${slot.label}\`` so re-apply on date nav doesn't duplicate slots. Routine instance templates have NO identitySignature → clone fresh per apply (per-day items). Daily Routine root is a `role:"page"` container.
- **scripts/createTestGrid.js (Schedule: Build Day op)** — collapsed from a hardcoded 48-slot LOOP+CREATE block to: FIND template by `meta.templateName`, IF template exists → APPLY_TEMPLATE with `mode: "merge"`, `unwrapRoot: true` → LOOP over `$newScheduleOccs` and stamp `$schedDate` on every cloned ROUTINE INSTANCE (skip slot containers — they're date-agnostic). The empty "Schedule" template I briefly added earlier is gone. Also: `activeFilterValues: {}` in grid init (was `{ [dateFieldId]: todayLocalISO }` which baked in the seed day; client falls back to local-tz today on every load).
- **APPLY_TEMPLATE persistence still racy on first burst** — task #40 tracks the bulk-clone server handler that would replace the per-CREATE_ITEM emit storm with a single atomic `bulk_clone_subtree` event. Until then, slots can drop on a quick reload mid-build (server's per-socket createQueue cancels on disconnect).

## Recent Changes (May 13 2026 — Templates v2 backend)
- **utils/cloneSubtree.js (NEW)** — `cloneSubtree({ rootOccurrenceId, userId, gridId, uc, moduleMetaPatch?, occMetaPatch?, newParentId })`. Walks an occurrence subtree depth-first via `uc.occurrencesById`, mints fresh module + occurrence IDs, persists each via `findOneAndUpdate({ id }, ..., { upsert: true })`. Returns `{ rootClonedOccurrenceId, occurrenceIds, moduleIds }`. Strips `_id` and `linkedGroupId`. `moduleMetaPatch` applied to every cloned module's `meta`; `occMetaPatch` applied to root occurrence only.
- **utils/templatesManifest.js (NEW)** — `ensureTemplatesManifest({ gridId, userId, uc })`. Idempotent upsert of the per-grid `manifestType: "templates"` manifest + root folder using deterministic IDs `tpl-mfst-${gridId}` / `tpl-root-${gridId}`. Called from `socketHandlers/state.js` request_full_state path so every connected client sees the templates manifest in `full_state`.
- **socketHandlers/templates.js (REWRITE)** — old `save_template` / `fill_from_template` removed. Three new handlers: `clone_subtree_as_template` (clones source subtree into the templates manifest, sets `module.meta.templateModule:true` + `occ.meta.templateName`), `apply_template` (clones template subtree into a target occurrence, strips `templateModule`, sets `occ.meta.appliedFromTemplateId` on root, append/replace mode), `save_over_template` (deletes old template subtree + re-clones from current source state, preserving template's parentId + name). All three emit `module_created`/`occurrence_created` per clone + a completion event (`template_created`/`template_applied`/`template_saved_over`).
- **models/Occurrence.js** — new field `filterNavConfig: Mixed` (default `{}`). `meta` is Mixed so `appliedFromTemplateId` lives there without schema change.
- **scripts/migrateLegacyTemplates.js (NEW)** — one-shot, idempotent. Converts any legacy `Grid.templates[]` entries into nested subtrees inside the per-grid Templates manifest. Skip-by-name idempotency. Run once: `node --env-file=.env server/scripts/migrateLegacyTemplates.js`.
- **scripts/createTestGrid.js** — Daily Routine template subtree seeded into the templates manifest (1 container module + 4 instance children mirroring the old Seed Daily Routine presets). `Schedule: Build Day` rewritten: existing 48-slot creation kept, new tail steps FIND the Daily Routine template by name + idempotency-FIND existing instances for `$schedDate` + APPLY_TEMPLATE + LOOP $newOccs to stamp dateFieldId/dueFieldId. `Schedule: Seed Daily Routine` operation deleted entirely.

## Recent Changes (May 11 2026 — Canvas page filter cleared)
- **scripts/createTestGrid.js (canvas page occurrence)**: Added explicit `filterOverride: {}` on the Canvas Test page occurrence. Without it the page inherits the grid's daily date filter, and the two seed canvas notes (which carry no date) get hidden as soon as the user navigates away from today. Matches the same `filterOverride: {}` convention Physical (Daily Toolkit) and General (Todo List) containers use to opt out of date filtering.

## Recent Changes (May 11 2026 — Schedule CREATE ops pass fieldHidden + dueFieldId stamp)
- **scripts/createTestGrid.js (`Schedule: Build Day` + `Schedule: Seed Daily Routine`)**: Every CREATE that stamps `dateFieldId` / `timeslotFieldId` onto a new container/instance now also passes `fieldHidden: { ... }` with those field ids set to true. Reason: the CREATE action's `buildBindings` previously un-hid existing bindings on the matched template module — once the user fixed up Drink Water's hidden Date binding, the next seed run would silently flip it back to visible. With explicit `fieldHidden`, the executor's new conservative `buildBindings` (helpers/operationActions.js change in same session) leaves user-set visibility intact and any new auto-bound field (e.g. timeslot added by seed) ships hidden out of the box.
- **scripts/createTestGrid.js (`Schedule: Build Day` todo sweep)**: The CREATE that sweeps todos into Due now stamps `[dueFieldId]: "$schedDate"` in addition to `[dateFieldId]`. Symptom was "Due field shows literal 'Due: date' on swept todos" — the swept copy had no value bound to its template's existing dueFieldId binding, so the field renderer fell back to the field's name. The dueDate is the same as the active scheduled date by virtue of the sweep predicate, so we can stamp it directly.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipelines and re-mint the template bindings cleanly (the corrupted hidden flags on existing Drink Water / Take Medication / etc. templates are wiped by `dropExistingTestGrid` at the top of the script).

## Recent Changes (May 7 2026 — Tracker: Water Today gains onAdd/onDelete)
- **scripts/createTestGrid.js**: `Tracker: Water Today` now matches the Tasks tracker's coverage. `triggerTypes` adds `"onAdd"` and `"onDelete"`; `triggerObjects` gain matching `subjectType:"module", subjectRole:"container", targetId:""` rows; the inner OR gate adds `$trigger.type IS OccurrenceCreateOp` and `... IS OccurrenceDeleteOp` rules. Without this, dragging a pre-completed water item into a schedule slot fired `OccurrenceCreateOp` but the Water tracker's existing trigger types (onChange/onFilterChange/onLoad) didn't include OccurrenceCreateOp, so it never re-aggregated until you edited a field. Tasks tracker already had this surface — Water was the lone gap.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 6 2026 — socket.io maxHttpBufferSize 1MB → 64MB)
- **server.js**: Bumped socket.io `maxHttpBufferSize` from the default 1MB to 64MB. Operation run logs for ops with big loops (Schedule: Build Day's 48-slot loop with per-iteration FIND candidate evaluations over `$allContainers`) routinely exceed 1MB; the existing tracker logs were already at ~600KB. When a `save_op_run_log` payload blew through the default buffer, socket.io disconnected the socket mid-pipeline. That disconnect cascaded: the per-socket `createQueue` flipped its `disconnected` flag → all pending slot `handleCreateOccurrence` calls bailed → slots never persisted → Build Day re-fired on every reload because the FIND for existing slots came up empty. Symptom from the user: "build day fires once but doesn't stick, op log works in working memory but doesn't persist." With the buffer bump, no oversize-induced disconnect happens on a clean first load and all 48 slot writes complete normally.
- **socketHandlers/crud.js (`handleCreateOccurrence` + `handleLinkToParent`)**: Kept the early `if (disconnected) return;` guards intact. Each Build Day run mints fresh UUIDs for its CREATE effects (executor doesn't support deterministic IDs yet). If we let a disconnected socket's queue keep draining, two parallel queues from two reload sessions both create the same logical slots with different IDs — duplicates pile up. Cancelling the rest of the old queue on disconnect lets the new socket's FIND see whatever already persisted and only create what's missing. Briefly removed during this debug session and immediately reverted because removing it caused the schedule to grow duplicates on every reload (visible: 1 unique + 1 dup per slot per reload past the first).
- **DB cleanup (one-off, dev only)**: Deleted 7 stale `gridId: null` stub occurrences (artifacts of an earlier `update_occurrence` upsert race that's already been fixed via the gridId fallback chain), 1 orphan op-created Drink Water whose parent `28876cfc-…` no longer existed, and 9 duplicate slot occurrences accumulated during the disconnect-check-removal regression.

## Recent Changes (May 6 2026 — Seed FINDs use role-filtered collections)
- **scripts/createTestGrid.js**: Every FIND in the test grid pipelines now declares `over` explicitly so the iteration is restricted to the right role bucket — previously every FIND walked `$allOccurrences` (everything). 17 FINDs total: Schedule page lookups (5) → `$allPages`, goal-instance lookups (2) → `$allInstances`, Due/slot/todo-list container lookups (5) → `$allContainers`, source/dedup/todo-copy instance lookups (3) → `$allInstances`. The two trigger-by-id FINDs in `Schedule: Stamp Date & Time Slot` and `Schedule: Clear Date on Move-Out` keep the default `$allOccurrences` because the triggering record's role is unknown. Pairs with `client/src/helpers/operationExecutor.js` change that fixes `$allPages` (now filters `role:"page"` instead of `"panel"`) and adds `$allPanels` for the panel role.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 4 2026 — Date binding on schedulable instances + local-tz seed filter)
- **scripts/createTestGrid.js (instance modules)**: morningRun / vitamins / stretch / takeMedication / goToGym now declare `dateFieldId` in `fieldBindings` (hidden:true), matching what drinkWater already had. Without this binding, the seed's CREATE wrote a `fields[dateFieldId].value` payload that had no module-level binding to render in the UI — so "Take Medication doesn't even have a Date field" — and the seed's per-(template, slot, date) de-dup FIND (which matches `fields.${dateFieldId}.value SAME_DAY $schedDate`) returned null on every subsequent run, causing duplicate CREATEs.
- **scripts/createTestGrid.js (Grid initialization)**: Added `todayLocalISO` derived from `getFullYear/getMonth/getDate` (local tz). Replaces `today.toISOString().slice(0, 10)` in `activeFilterValues`. The UTC variant rolled forward/backward by a day at TZ boundaries — same bug operationExecutor's `$today` fix dealt with on Apr 29. Re-seeded grids will now show the correct local-tz date as the active filter on first load.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 4 2026 — Cross-trigger seed ↔ trackers via RUN_OPERATION)
- **scripts/createTestGrid.js (`Schedule: Seed Daily Routine`)**: $schedDate fallback chain reordered so `$parentFilter.${dateFieldId}` is the primary source — when a single timeslot's `filterOverride` is changed, the descendant-cascade NavigationOp fires from the slot, $parentFilter resolves to the slot's effective date, and the seed creates instances dated to *that* slot's new date instead of the schedule page's date. Old chain (`$schedPage._effectiveFilter` first) ignored slot-scoped filter changes and is now the second fallback. After the preset loop, two `RUN_OPERATION` steps invoke `Tracker: Water Today` and `Tracker: Tasks Completed Today`. Reason: trackers' `onFilterChange` is ancestor-scoped to "Daily Goals", so a Schedule-page filter change creates new instances but doesn't retrigger goals through `matchAncestorScope`. The in-batch `liveOccs` overlay (`runMatchingOperations` in operationExecutor.js) means trackers see seed's `CREATE_ITEM` effects when invoked here.
- **scripts/createTestGrid.js (`Tracker: Water Today` + `Tracker: Tasks Completed Today`)**: Each tracker now does a `FIND` after computing $goalDate — predicate is `fields.${dateFieldId}.value SAME_DAY $goalDate AND _ancestors HAS_ANCESTOR $schedPageId`. If `$existingItemId IS_EMPTY`, it `RUN_OPERATION`s `Schedule: Seed Daily Routine` first. Seed reads $parentFilter, which (under this caller's transaction) resolves to the goal page's effective filter — so seeded instances land on $goalDate. The aggregation loop runs immediately after and picks up the just-emitted CREATE_ITEM effects.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipelines.

## Recent Changes (May 4 2026 — DB-backed operation run logs)
- **models/OperationRunLog.js (NEW)**: Persists in-memory executor `runHistory` for out-of-browser inspection. Indexed by `(userId, operationId, runAt)`. Capped per (userId, operationId) by the save handler — older entries past `LOG_LIMIT_PER_OP` (25) are pruned on each save.
- **socketHandlers/opRunLogs.js (NEW)**: `save_op_run_log` handler upserts a log + prunes stale; `get_op_run_logs` reads recent entries optionally filtered by `operationId`.
- **server.js**: Imports `registerOpRunLogHandlers`, calls it inside `io.on("connection")` after the other handler registrations.
- **scripts/dumpOpRunLogs.js (NEW)**: CLI dump for the run logs. Usage: `node --env-file=.env scripts/dumpOpRunLogs.js [email] [limit] [operationName]`. Default user is `josh@jpoms.com`, default limit 20. Pretty-prints per-step `varsBefore`, `resolvedConfig`, predicate left/right values, loop iteration items, and final `effects`. Use this when debugging which `$goalDate` / `$schedDate` the executor saw on a given run.

## Recent Changes (Apr 30 2026 — Tracker rename + page-scoped goals + FIND date predicate)
- **scripts/createTestGrid.js**: Renamed `Water Today` → `Tracker: Water Today` and `Tasks Completed Today` → `Tracker: Tasks Completed Today` per user UX request.
- **scripts/createTestGrid.js (Tracker ops)**: Both goal aggregations now drive `$goalDate` off the GOAL ITEM's `_effectiveFilter.<dateFieldId>` — not Schedule's. The Daily Goals page can show a different date than Schedule, and the user wants the goal to honour ITS OWN page filter. `onFilterChange` triggers gain `ancestorLabel: "Daily Goals"` so they only fire when the goal page's filter cascade moves; Schedule-page filter changes no longer retrigger them.
- **scripts/createTestGrid.js (Seed Daily Routine + Build Day todo sweep)**: De-dupe FINDs that previously relied on `cfg.scope.dateFieldId` (removed Apr 30) now include a SAME_DAY rule on the occurrence's date field inside the predicate. Without this, today's pre-completed 6am Drink Water (or any sample item) matched every other date's lookup and the seed silently created nothing on non-today dates.
- **scripts/createTestGrid.js (all ops)**: Removed `pipeline.sources` arrays — they were sugar over `$trigger.X` direct reads. Steps now read `$trigger.type / .fieldId / .date / .occurrenceId / .containerLabel` directly. Re-seed required to pick up the new pipelines: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (Apr 30 2026 — Water goal block: persistent (no date stamp))
- **scripts/createTestGrid.js**: Removed the `dateFieldId` seed from the `waterGoalOccId` occurrence (was `fields: { [dateFieldId]: { value: today.toISOString(), … } }` → now `fields: {}`). Goals are conceptually persistent — a date field on the occurrence makes the named-filter SAME_DAY check fail on any other day, so the water goal vanished as soon as the user navigated past today. With no date field, `isOccurrenceVisible` short-circuits to "persistent" and the goal stays put across all dates. Re-seed required: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (Apr 29 2026 — $schedDate flows from page's effective filter)
- **scripts/createTestGrid.js**: Four ops (`Schedule: Build Day`, `Schedule: Seed Daily Routine`, `Water Today`, `Tasks Completed Today`) restructured so the schedule page is FIND'd first (`itemIdVar: "$schedPageId", itemVar: "$schedPage"`), then `$schedDate` is initialized from `$schedPage._effectiveFilter.${dateFieldId}` with fallback chain `$triggerDate → $today`. Why: on cold load `$trigger.date` is undefined and the previous fallback went straight to `$today`, so newly-created copies were dated today and stayed hidden by any non-today page filter — the symptom was "tasks only appear after I change the filter, never on load." `_effectiveFilter` resolves the parent-chain filter (page override → grid filter), so the auto-build now matches the date the user is actually viewing.
- **client/src/helpers/operationExecutor.js (`executePipeline`)**: Each `$allItems` entry now carries `_effectiveFilter` — the result of `getEffectiveFilterForOccurrence(occ, …)` precomputed at pipeline start. Lets pipelines read a page's effective filter without having to walk the parent chain in pipeline language.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (Apr 28 2026 — Slots created once, no date field)
- **scripts/createTestGrid.js (`Schedule: Build Day` op)**: Removed `scope: { dateFieldId, dateExpr: "$schedDate" }` from the slot FIND step and `date: { fieldId: dateFieldId, value: "$schedDate" }` from both the slot CREATE step and the Due CREATE step. Same removal on the Due FIND. Slot containers (and the Due container) are now created ONCE per grid and have no date field — visibility is delegated to the page-level filter cascade walking down to the per-day instance copies inside them. Why: the prior per-day creation duplicated what the filter cascade already does and accumulated 48-occurrences-per-day clutter that the visible-slot picker (PageBoard `containersList`) couldn't reliably collapse to one per module across days.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the simplified pipeline AND wipe the per-day duplicate slot occurrences left behind by the old logic.

## Recent Changes (Apr 28 2026 — Schedule Auto-Build self-heals partial state)
- **scripts/createTestGrid.js (`Schedule: Build Day` op)**: Replaced the top-level "any slot exists for $schedDate → skip the whole 48-slot loop" guard with a **per-slot** FIND/IF/CREATE inside the slot loop. Predicate: `meta.scheduleSlot IS true AND meta.slotLabel IS $slot.label`, scoped by `dateFieldId/$schedDate`. Removed the prior ELSE that re-stamped the timeslot label (was firing ~48 `update_occurrence` emits on every reload — that was the flood). Why: when a user reloaded mid-build, the server-side per-socket queue had only persisted 6 of the 48 CREATEs; the new full_state had only 6 slots, the old top-level guard saw "any slot exists → skip" and never filled the missing 42. The per-slot guard makes the op idempotent on reload AND self-healing on partial state — works against the existing DB without orphan cleanup because `$item.meta` is template+occurrence merged (operationExecutor.js:590), so the 6 partial-state occurrences carry `scheduleSlot/slotLabel` via their template and match the FIND.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipeline definition. The DB still holds the previous pipeline until re-seed.

## Recent Changes (Apr 27 2026 — Operation Priority + E11000 Retry on Occurrence Writes)
- **models/Operation.js**: Added `priority: { type: Number, default: 5, min: 1, max: 10 }`. Lower runs first. Used by `runMatchingOperations` in `client/src/helpers/operationExecutor.js` as the primary sort key (sortOrder is now a tiebreaker).
- **scripts/createTestGrid.js**: Each seeded op now declares its priority — `Schedule: Auto-Build for Active Date` = 1 (auto-creator must finish before downstream reads); `Schedule: Stamp Date & Time Slot` = 2; `Schedule: Clear Date on Move-Out` = 2; `Water Today` = 3; `Tasks Completed Today` = 3. Re-seed required: `node --env-file=.env scripts/createTestGrid.js`.
- **socketHandlers/occurrences.js (`update_occurrence`)**: Wrapped the upsert in try/catch + E11000 retry. On duplicate-key (a concurrent `create_occurrence` for the same id won the insert race), falls back to `findOneAndUpdate({ id }, { $set: dbDoc })`. Without this the handler crashed and the parent `$push` further down was never reached, leaving slot occurrences orphaned in the DB but absent from `schedPage.occurrences[]`. Same retry added to the linked-group propagation loop.
- **socketHandlers/crud.js (`handleCreateOccurrence`)**: Same E11000 retry wrapped around the create upsert — covers the inverse race where `update_occurrence` arrived first and inserted a partial doc with the same id. The retry's `$set` semantics merge the create's full data (parentId, viewId, etc.) onto the partial doc rather than replacing it. The subsequent parent `$push` now always runs, so slots become children of the schedule page on the first auto-build pass instead of needing a second reload to re-link via `LINK_OCCURRENCE_TO_PARENT`.

## Recent Changes (Apr 26 2026 — Schedule Auto-Build orphan re-link)
- **socketHandlers/crud.js (`setupOccurrencesCRUD`)**: New `link_occurrence_to_parent` socket event. Routes through the same per-socket `createQueue` so concurrent links from a pipeline don't reorder. Atomic `findOneAndUpdate({ id: parentId, occurrences: { $ne: childId } }, { $push: { occurrences: childId } })` — idempotent (no-op when already linked) — then echoes `occurrence_updated` to all sockets in the user room (including the originator) so other tabs/windows pick up the parent change.
- **scripts/createTestGrid.js**: Auto-build pipeline ELSE branches now call `LINK_OCCURRENCE_TO_PARENT` for both Due and slot finds. The container's date FIELD remains the existence-check source of truth (FIND_OCCURRENCE matches by `dateFieldId`/`dateExpr=$schedDate`); ELSE just re-links the matched occurrence to the schedule page in case a prior race left it in `parentId === schedPage` but missing from `schedPage.occurrences[]`.
- **scripts/relinkScheduleOrphans.js (NEW)**: One-time data fix. Finds occurrences with `parentId === schedPage` that aren't in `schedPage.occurrences[]`, sorts by date FIELD then slot hour/minute, and atomically `$push`-es each one (with `$ne` guard so re-runs are no-ops). Dev DB run: 234/234 orphans relinked → page went from 11 → 245 children before the subsequent re-seed wiped the grid.

## Recent Changes (Apr 26 2026 — Schedule Auto-Build $schedDate from $trigger.date)
- **scripts/createTestGrid.js**: Auto-build op now sources its working date from `$trigger.date` (set on every NavigationOp by both grid filter changes and per-page LocalFilterNav clicks) with `$today` fallback. New `$triggerDate` source + `INIT_VAR $schedDate` prelude steps added at the top of `pipeline.steps`. Every `dateExpr: "$activeDate"` inside the auto-build pipeline (Due lookup/create, slot loop find/create, todo sweep SAME_DAY) and the `presetSeedSteps` helper (now takes `dateExpr` param) → `dateExpr: "$schedDate"`. Removed the brittle `$pageOverrideDate` workaround that read `$schedPage.filterOverride.<dateFieldId>` (lines 712-728 of prior version). `$activeDate` is intentionally left intact in the other ops (Water Today, Tasks Completed Today) — they rely on its grid-scoped semantics.
- **Re-seed required**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipeline to the DB.

## Recent Changes (Apr 25 2026 — Artifact Role + Migration)
- **server.js**: Replaced `mimeToViewType` with `mimeToKind(mime, filename) → "image"|"video"|"audio"|"pdf"|"code"|"markdown"`. Added `viewFieldsForKind(kind)` helper that derives `{ viewType, artifactType }` for the (still-created) View record so the artifact-panel display path keeps working. Both `/api/artifacts/upload` and `/api/upload` (and the connection-import handler) now write `role: "artifact"` and the `kind` directly on the Module — `meta.artifactType` and `meta.viewType` are no longer set.
- **scripts/migrateArtifactRole.js** (NEW): One-shot migration. Finds all `role:"instance"` + `kind:"artifact"` modules and rewrites them to `role:"artifact"` with `kind` from `meta.artifactType` (or fileRef extension). Removes `meta.artifactType` and `meta.viewType`. Run: `node --env-file=.env scripts/migrateArtifactRole.js`. Already executed once on the dev DB (8 rows migrated).

## Recent Changes (Apr 11 2026 — Minimal Test Grid Script)
- **scripts/createTestGrid.js** (NEW): Creates a second grid for `josh@jpoms.com` with minimal data for testing. Does NOT delete anything. Panels: [0,0] Daily Toolkit (Physical → Drink Water), [1,0] Todo List (empty General), [0,1 h=2] Center Hub (Schedule + Notes pages), [0,2] Daily Goals (Physical goal → water total). Fields: water, completed, scheduledDate, timeslot, due, totalWater. Operations: Water Today sum + schedule stamp/clear. Run: `node --env-file=.env scripts/createTestGrid.js`

## Recent Changes (Apr 11 2026 — Revert Lazy Loading: All Textmaps Upfront)
- **server.js `loadUserIntoCache`**: Removed `.select("-textmap")` — Occurrence query now loads ALL textmaps. After populating `uc.occurrencesById`, decompresses each textmap via `decompressTextmap(o.textmap)`. Cache holds decompressed textmaps ready to send.
- **server.js**: Added `import { decompressTextmap } from "./utils/textmapCompression.js"`.
- **socketHandlers/occurrences.js `update_occurrence`**: Now stores decompressed textmap in cache (`next.textmap = textmap` before assigning to `uc.occurrencesById`). Same fix for linked occurrence cache updates.
- **socketHandlers/occurrences.js `break_link`**: Decompresses textmap from `occ.toObject()` before caching and broadcasting.
- **socketHandlers/state.js**: `full_state` sends all textmaps (from cache, already decompressed). No `textmaps_batch` needed.
- **client/src/modules/DocContent.jsx**: Removed lazy fetch `useEffect` (was `socket.emit("request_textmap", ...)`). `hasValidTextmap` guard kept as safety net. Textmaps now arrive in `full_state` upfront.
- **client/src/modules/ArtifactContent.jsx**: Added `typeof occurrence.textmap === "object"` guard — prevents TipTap from receiving a compressed base64 string as content.
- **Impact**: All docs load immediately on open. No per-document round trips. Textmaps are ~80% smaller in DB (fflate gzip), so upfront load is much faster than pre-compression.

## Recent Changes (Apr 11 2026 — update_view Duplicate Key Fix)
- **socketHandlers/crud.js `setupGenericCRUD`**: Both `create_${modelName}` and `update_${modelName}` now wrap `findOneAndUpdate({ id, userId }, next, { upsert: true })` in a try/catch for E11000. On duplicate key error, retries with `findOneAndUpdate({ id }, { $set: next })` — handles race condition where two concurrent upserts collide, and data-migration case where view exists with different userId.

## Recent Changes (Apr 10 2026 — Load Performance + Cache Fix)
- **server.js auth middleware**: Simplified from async DB lookup to sync JWT verify only. `io.use()` now calls `verifyToken(token)` (sync, no DB), sets `socket.userId` immediately. Eliminates one DB round trip per connection.
- **server.js `ensureUserCache`**: Initializes cache entry with `_loaded: false` flag so `userCacheReady` is never true on an empty shell.
- **server.js `loadUserIntoCache`**: Added `cacheLoadingPromise` registry — deduplicates concurrent calls (React StrictMode fires effects twice). Added `.lean()` to all DB queries. Removed `timestamp: -1` sort from Occurrence query (unindexed). Sets `uc._loaded = true` on completion, clears promise ref in `.finally()`.
- **server.js `userCacheReady`**: Now checks `uc._loaded` (not just truthy `uc`). Fixes race where empty `{}` objects appeared ready, causing empty `full_state` on second React StrictMode effect.
- **server.js `io.on("connection")`**: Added background cache pre-load — `if (userId && !userCacheReady(userId)) { loadUserIntoCache(userId); }`. Cache starts loading immediately on connect, before `request_full_state` arrives.
- **server.js `socket.on("disconnect")`**: Removed `delete cacheByUser[socket.userId]`. Cache now persists across reconnects — TTL eviction (30min) handles cleanup. Eliminates full DB reload on every page refresh.

## Recent Changes (Apr 3 2026 — Thumbnail Service)
- **services/thumbnailService.js** (NEW): Puppeteer singleton. `generateThumbnail(occId, baseUrl)` screenshots `/preview-render/:occId` → caches PNG at `uploads/thumbnails/{occId}.png`. `invalidateThumbnail(occId)` deletes cached file. `SERVER_BASE_URL` defaults to `http://localhost:5000` (was 3001 — that was the bug).
- **services/renderPreviewHTML.js** (NEW): Renders occurrence as dark-theme HTML for Puppeteer. Doc pages: TipTap JSON → HTML + fallback reads `uploads/md/{occId}.md`. Board pages: fetches child + instance occurrences → renders container cards with instance rows.
- **server.js**: `GET /preview-render/:occId` (internal auth-free render endpoint) + `GET /api/thumbnail/:occId` (cached PNG, generates on miss). `SERVER_BASE_URL` fixed to port 5000.
- **socketHandlers/occurrences.js**: Imports + calls `invalidateThumbnail(id)` + `invalidateThumbnail(parentId)` after update_occurrence.
- **socketHandlers/crud.js**: Imports + calls `invalidateThumbnail` on create_occurrence (parent) + delete_occurrence (all deleted IDs + parent).

## Recent Changes (Apr 3 2026 — Day Page Trigger + Journal Rename)
- **createDefaultUserData.js:3507**: `triggerTypes: ["onNavigation", "onLoad"]` → `triggerTypes: ["onNavigation"]`. Fixes 12 day pages created on every load — operation now only fires on date navigation, not on every full_state receive.
- **createDefaultUserData.js:4184**: `label: "Journal"` → `label: "Day Page"`. The stable centerHub tab that shows the current day page content is now labeled "Day Page" instead of "Journal".

## Recent Changes (Apr 2 2026 — Journal Tab Removed from Tree)
- **createDefaultUserData.js**: `journalPageOccId` now has `parentId: null`. Was `parentId: filesDayPagesFolderId` which made it appear in the Day Pages folder tree as a "Journal" node above the actual day pages. It's a panel navigation tab, not a content page.

## Recent Changes (Apr 2 2026 — Stable Journal Tab + Day Page Navigation)
- **createDefaultUserData.js**: Added `journalPageMod` (role:"page", kind:"doc", label:"Journal") + `journalPageOccId` occurrence with `viewId: dayPageViewId`. This is the stable panel tab whose content pane is controlled by `dayPageView.activeOccurrenceId`. The Day Page Auto-Create operation's `UPDATE_VIEW` step updates this view → Journal tab always shows the current date's page. centerHub now uses `[schedPageOccId, journalPageOccId, freepadPageOccId]` instead of `dayPageDocOccId`. `dayPageDocOccId` stays in the Day Pages folder (tree accessible).
- **Day Page Navigation flow**: Click next/prev day → `handleFilterValueChange` → `onGridUpdated` fires NavigationOp → operation: FIND_OCCURRENCE(dayDate=activeDate) → if missing: COMPUTE_TEXTMAP+CREATE_OCCURRENCE → UPDATE_VIEW(dayPageViewId, activeOccurrenceId=$dayPageId) → Journal tab shows today's content.
- **Schedule filtering**: Already reactive — `containersList` uses `isOccurrenceVisible(containerOcc, effectiveFilters)` with same-day date comparison. Schedule slots with `scheduledDate = activeDate` show; others hide.

## Recent Changes (Apr 2 2026 — Gospel viewId Fix)
- **createDefaultUserData.js**: Fixed missing `viewId` on gospel section occurrences. Main section occurrence (`gd.mainOccId`) and "Why This" occurrence (`gd.whyOccId`) now include `viewId: container._viewId || null`. Without this, containers rendered as list (showing "Drop items here") instead of doc (showing TipTap editor). Stan/Notes/Phil occurrences already had this — only gospel was missing it.

## Recent Changes (Apr 2 2026 — Day Page Template Model)
- **createDefaultUserData.js**: Day page refactored to single-template-module model:
  - Added `dayDate` date field bound to the template module.
  - `dayPageTemplateModuleId` module (role: "page", kind: "doc") is the ONE permanent day page module. All actual day pages are occurrences of this module.
  - `dayPageTemplateOccId` (`meta.isTemplate: true`) holds the bracket-token textmap: `[Date]`, `[DayOfWeek]`. FIND_OCCURRENCE skips it.
  - Yesterday's occurrence now uses `targetId: dayPageTemplateModuleId` + `fields[dayDate] = yesterday`.
  - Day Page Auto-Create operation rewritten as 3 atomic lego steps: FIND_OCCURRENCE (date-field filtered) → IF missing: COMPUTE_TEXTMAP_FROM_TEMPLATE + CREATE_OCCURRENCE_FOR_MODULE → UPDATE_VIEW.

## Recent Changes (Apr 1 2026 — Day Page Fix + Folder Page Modules)
- **createDefaultUserData.js**: (1) Day Page wrapper removed — "Day Page" doc page module + occurrence deleted. Yesterday's day page changed from `role: "container", kind: "artifact"` to `role: "page", kind: "doc"` with readable date label (e.g., "Tue, Mar 31"). Pinned directly to centerHub instead of through wrapper. Older past day pages (2 and 3 days back) removed — only yesterday kept. (2) Folder page modules created for each non-root folder (Day Pages, Documents, Notes, Trackers, Drawing) — `role: "page", kind: "folder"` with occurrence `parentId = folderId`. Enables folder click → open page in ManifestTree.

## Recent Changes (Apr 1 2026 — Parent Docs as Pages + Remove Section Wrappers)
- **createDefaultUserData.js**: Parent doc modules (Stan, Gospel, Phil, flat notes, Comparative Religion, Sample Grid, Gospel Text) changed from `role: "container", kind: "artifact"` to `role: "page", kind: "doc"`. They now appear as page items in the manifest tree with sections properly nested as anchors. Removed per-section page wrapper loop (was creating individual pages for every section container flat under Root). CenterHub panel pinned pages unchanged (Schedule + Day Page + Freepad).

## Recent Changes (Mar 29 2026 — Folder Restructure + Past Day Pages)
- **createDefaultUserData.js**: User manifest folders restructured: Notebook→**Docs** (doc pages + DayPages subfolder), Tracking→**Trackers** (Daily Toolkit, Daily Goals, Accounts, Schedule, Todo List), Tasks folder REMOVED, **Drawing** folder added (Freepad). 3 past day pages created (yesterday, 2 days ago, 3 days ago) — today's NOT pre-created (auto-create operation handles it). CenterHub panel defaults to **Schedule** (was Day Page). Variable `notebookFolderId`→`docsFolderId_um`, `tasksFolderId` removed, `drawingFolderId` added.

## Recent Changes (Mar 28 2026 — User Manifest Folders + Notebook as Folder)
- **createDefaultUserData.js**: User manifest folders: Notebook (doc pages + Freepad + DayPages subfolder), Tracking (Daily Toolkit, Daily Goals, Accounts, Schedule), Tasks (Todo List). Hub folder REMOVED. Notebook/DayPages/ subfolder (folderType: "day-pages") holds Day Page. Schedule moved to Tracking. Freepad moved to Notebook. Day Page is `role: "page", kind: "doc"`. CenterHub panel has 3 pages (Day Page + Schedule + Freepad), defaults to Day Page.

## Recent Changes (Mar 27 2026 — ViewType Cleanup + resetData Fix)
- **models/View.js**: Cleaned up `viewType` enum. Removed `"list"`, `"artifact"`, `"log"`, `"smart"`. Renamed `"artifact"` → `"display"` (file viewer). Renamed `"list"` → `"board"` (default children view). Default is now `"board"`. Updated comment for `artifactType` field to say "Display sub-type" instead of "Artifact sub-type". Final enum: `["board", "display", "markdown", "canvas", "code", "doc", "pool", "preview"]`.
- **server.js `mimeToViewType`**: `viewType: "artifact"` → `viewType: "display"` for all 4 mime types (image/video/audio/pdf).
- **createDefaultUserData.js**: centerHub View record was using `viewType: "page"` (invalid). Fixed to `viewType: "board"` — the view only tracks `activeOccurrenceId`, `hasPages` detection is done via child occurrence roles on the client.

## Recent Changes (Mar 26 2026 — Page Module Integration in Sample Data)
- **createDefaultUserData.js**: Panels renamed to generic "Panel A"–"Panel G" (label + layout.name). Old panel labels become page names. Deferred wiring creates page modules (`role: "page"`, `kind: "board"`) + page occurrences (with `parentId: userGlobalFolderId`) between the 5 board panels and their container occurrences. Notebook (Panel F) and Freepad (Panel G) keep direct container wiring. User manifest simplified: Root + Global folder only (no per-panel folders). Global folder = page library. Panel-local pages tracked via `panelOcc.occurrences[]`.
- **socketHandlers/crud.js**: 5 new composite page handlers: `create_page`, `delete_page`, `move_page`, `pin_page_to_panel`, `unpin_page_from_panel`.
- **models/Folder.js**: Added "global", "grid", "panel" to folderType enum; added panelId field.
- **models/Manifest.js**: Added "user" to manifestType enum.
- **models/Grid.js**: Added manifestId field.

## Recent Changes (Mar 25 2026 — Module Reference Field Type)
- **models/Field.js**: Added `"module"` to type enum (now 8 types). Value stores `{ value: moduleId, flow: "in" }` — references another module by ID.

## Recent Changes (Mar 25 2026 — Schedule Slot Iteration Fields)
- **createDefaultUserData.js**: Schedule time slot container occurrences now get `scheduledDate` + `timeslot` fields (were empty). Container is now the source of truth for iteration context. Instance occurrences in schedule slots also get `timeslot` field (matching their container). Historical seed instances (30-day data) also get `timeslot` field for each slot they're in.

## Recent Changes (Mar 23 2026 — Phil Stone viewId + Q/A Pool Fields)
- **createDefaultUserData.js**: (1) Added `viewId: container._viewId || null` to Phil Stone section occurrence creation (was missing — caused sections to render as empty list containers). (2) Added 3 question pool containers (wentWellQPool, improvedQPool, gratitudeQPool) with 5 questions each. (3) Changed Q/A question fields from `type: "text"` to `type: "select"` with `meta: { sourceType: "pool", poolContainerId }`. (4) Q/A container fieldBinding role changed from "display" to "input". (5) Removed hardcoded field value (was set to field name) from Q/A container occurrences.

## Recent Changes (Mar 22 2026 — Philosopher's Stone Preamble Fix)
- **utils/mdParsers.js**: Both `parseSections` and `parseSectionsWithInstances` now capture content before the first heading as an "Introduction" section. Previously, pre-heading lines were silently dropped. Fixes Philosopher's Stone intro text ("the real bridge") not appearing in the notebook.

## Recent Changes (Mar 22 2026 — Dynamic Page Creation via Operations Pipeline)
- **dayPages.js**: DEPRECATED — all handlers removed. `update_view` already handled by generic CRUD in crud.js. `create_day_page_occurrence` and `navigate_day_page` replaced by generic pipeline actions (FIND_MODULE + CREATE_MODULE + UPDATE_VIEW).
- **server.js**: Removed `registerDayPageHandlers` import and registration call.
- **Grid.js**: Removed `defaultDayPageTemplateId` field from schema.
- **crud.js**: `create_occurrence` handler now passes through `parentId`, `textmap`, `viewId`, `occurrences` fields (were previously stripped by `createOccurrenceData`).
- **createDefaultUserData.js**: "Day Page Auto-Create" operation rewritten to use generic pipeline: `INIT_VAR` (build page name with `${$activeDate}` interpolation) → `FIND_MODULE` (check if exists) → IF empty: `CREATE_MODULE` + ELSE: `FIND_OCCURRENCE` → `UPDATE_VIEW` (always show the right page). No more `NAVIGATE_DAY_PAGE` action type.

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `server.js` | Express + Socket.io server. All socket event handlers. Hosts static client build. Multer file uploads (`/api/upload`). | Recent |
| `utils/createDefaultUserData.js` | Sample data generator for `node scripts/resetData.js`. All fields use `inputEnabled/displayEnabled` (no legacy `mode: "input"`). 4-col grid with Freepad (canvas) panel. 8 dimension containers + goal containers have `ownStyle` colors. 31 operations. | Mar 17 2026 |
| `scripts/resetData.js` | Clears all user data then calls createDefaultUserData. Removed dead Iteration import. | Mar 17 2026 |

## Models

| Model | Key Fields | Notes |
|-------|-----------|-------|
| `Module.js` | **role** (optional string, deprecated — inferred from occurrence hierarchy on client), **kind** (optional string, deprecated — use View.viewType instead), label, userId, gridId, fieldBindings[], operationBindings[], defaultDragMode, styleMode, ownStyle, iteration, siblingLinks[], meta, behaviorMode, behavior{sortable,draggable,droppable}, **fileRef** | Unified model. role/kind are soft-deprecated: still stored for existing data, but the client uses roleByModuleId (hierarchy inference) and view.viewType as canonical sources. |
| `Occurrence.js` | targetId, targetType, parentId, **occurrences[]**, **viewId**, **textmap**, fields{}, iteration, linkedGroupId, placement, **sortOrder** | viewId → View (separate model). textmap = TipTap JSON (replaces old docContent). parentId = folder.id for artifacts, parent occurrence for instances. sortOrder used by ManifestTree for anchor/folder ordering. |
| `View.js` | viewType ("list"\|"artifact"\|"markdown"\|"canvas"), **artifactType** ("image"\|"pdf"\|"audio"\|"video"\|null), **hasTree**, **manifestId**, **activeOccurrenceId**, layout | Separate model — occurrence.viewId → View. NO panelId or activeDocId/activeArtifactId. |
| `Manifest.js` | rootFolderId, userId, gridId, name, manifestType | Root of artifact folder tree |
| `Folder.js` | name, parentId, sortOrder, isExpanded, folderType, userId, gridId | folderType: "normal"\|"trash"\|"templates"\|"day-pages"\|"category" |
| `Grid.js` | namedFilters[], activeFilterId, activeFilterValues{}, fieldIds[], templates[] | |
| `Field.js` | inputEnabled, displayEnabled, displayConfig{showArrows,arrowColor,targetValue,targetPeriod}, type, name, unit, meta, **folderId** | folderId → category Folder |
| `Operation.js` | name, pipeline{sources,steps}, targetFieldId, triggerType, enabled, userId, gridId, **folderId** | steps = top-down code flow (LOOP, IF, action types). folderId → category Folder. |
| `Transaction.js` | type (MeasureOp/OccurrenceListOp/EntityOp), state (applied/undone/redone), data | Audit trail |
| ~~`Doc.js`~~ | **DELETED** | Replaced by Occurrence.textmap |
| ~~`Artifact.js`~~ | **DELETED** | Replaced by Module.fileRef |

## Socket Event Naming Conventions
- Get all state: `full_state` (server → client on connect)
- CRUD pattern: `create_X`, `update_X`, `delete_X` → `X_created`, `X_updated`, `X_deleted`
- Module events: `create_module`, `update_module`, `delete_module` → `module_created/updated/deleted`
- All legacy role-specific handlers removed (create_panel, delete_panel, create_container, etc.)
- Special: `save_template`, `fill_from_template`, `create_operation`, `update_operation`, `delete_operation`
- Undo/redo: `undo`, `redo` → `undo_complete`, `redo_complete`

## HTTP Endpoints

### Artifact Endpoints (Mar 2026)
- `POST /api/artifacts/upload` — saves file to `artifacts/user/`, creates Module + Occurrence + View, emits `artifact_created`. Body: multipart/form-data `{ file, userId, gridId, parentFolderId?, manifestId? }`. Returns `{ module, occurrence, fileRef, url }`.
- `GET /artifacts/*` — static file serving from `artifacts/` directory

### Legacy Upload
- `POST /api/upload` — saves flat to `uploads/`, creates Module only (no Occurrence). Keep for non-artifact file uploads.

### Connection Endpoints (Feb 22)
- `GET /api/connections` — returns `[{ id, name, path, exists, fileCount }]` for `file_storage` (/home/joshpoms/files) and `external_notebook` (/home/joshpoms/notebook)
- `GET /api/connections/:id/files` — returns `[{ name, isDirectory, size, mtime }]` for a connection path
- `POST /api/connections/:id/import` — imports a named file from a connection into Artifact records; body: `{ fileName, userId, gridId, folderId }`
- `POST /api/storage-settings` — saves `manifest.meta.storageSettings` (existing)

## Recent Changes (Mar 20 2026 — Occurrence sortOrder)
- **Occurrence.js**: Added `sortOrder: { type: Number, default: 0 }` to schema. Was previously set in createDefaultUserData.js but silently dropped by Mongoose strict mode. Now persisted — fixes ManifestTree anchor ordering (was appearing bottom-up).

## Recent Changes (Mar 20 2026 — Module Lifecycle: Trash + Cascade Delete)
- **Module.js**: Added `trashed: { type: Boolean, default: false, index: true }` field for soft-delete.
- **crud.js `delete_occurrence`**: Enhanced with cascade — recursively collects all descendant occurrence IDs, deletes them all, cleans up parent occurrence `occurrences[]` arrays, and updates `grid.occurrences` if a panel occurrence was removed. Broadcasts `occurrence_deleted` for each, `occurrence_updated` for affected parents, `grid_updated` if grid changed.
- **crud.js**: Added `trash_module` handler (sets `trashed: true`, broadcasts `module_updated`) and `restore_module` handler (sets `trashed: false`, broadcasts `module_updated`).

## Recent Changes (Mar 20 2026 — Load Speed Optimization)
- **server.js `loadUserIntoCache`**: Added `.lean()` to all 8 DB queries — returns plain JS objects instead of Mongoose documents, skipping hydration overhead (2-5x faster for large datasets). Removed `.toObject()` calls since `.lean()` already returns POJOs.
- **server.js `getAllGridsForUser`**: Now checks in-memory cache first before hitting DB. During `full_state` flow the cache is already populated, so this eliminates a redundant DB round trip.
- **Module.js**: Added `index: true` to `userId` field (was missing — every `Module.find({ userId })` was a full collection scan).
- **Grid.js**: Added `index: true` to `userId` field (same issue).

## Recent Changes (Mar 17 2026 — Flat Notes Parsing Fix)
- **createDefaultUserData.js**: Added `secLevel`/`instLevel` per def in `_flatNotesDefs`. `aispecs.md` now uses `secLevel:1, instLevel:3` (H1 → containers, H3 → instances). `banglespecs.md` uses `secLevel:1, instLevel:2` (H1 → containers, H2 → instances). `uses.md` and `PRAGMATIC.md` stay at `2,3`. `_flatNotesSections` now passes `def.secLevel, def.instLevel` to `parseSectionsWithInstances`.

## Recent Changes (Feb 2026 — Module Unification)
- **Module.js**: NEW unified model replacing Panel+Container+Instance. role enum + kind enum.
- **createDefaultUserData.js**: Full rewrite to use Module. Panel/Container/Instance → `new Module({role, ...})`. Occurrence targetType → "module". Category field (hidden select) injected into all instances for iteration filtering.
- **resetData.js**: Deletes Module records + legacy Panel/Container/Instance collections.

## Recent Changes (Mar 14 2026 — New Feature Demo Data)
- **createDefaultUserData.js**: Added `macroRefId` pre-generated at top.
- **createDefaultUserData.js**: `toolkitContainers.macroRef` — `kind: "doc"` container added. After toolkit wiring loop, `Occurrence.findOneAndUpdate` sets `textmap` (two tables: macro targets + weekly habit tracker) + `locked: true`. Demonstrates D7 (table) + R3 (locked doc) features.
- **createDefaultUserData.js**: `notebookDocContainers.weeklyReview` — `kind: "doc"` container added to notebook panel. Textmap contains moduleEmbed nodes for all 3 Q&A containers (`qaContainerOccIds`). Heading text explains the `@:` trigger. Demonstrates D2 (moduleEmbed) feature.

## Recent Changes (Mar 13 2026 — Filter System in createDefaultUserData)
- **createDefaultUserData.js**: Removed `Iteration` model import. Removed standalone `iterationDefs` loop. Replaced Grid creation `iterations/selectedIterationId/categoryDimensions` → `namedFilters` (Daily/Weekly/All) + `activeFilterId: "filter_all"` + `activeFilterValues`.
- **createDefaultUserData.js**: Added `scheduledDate` field (date type, input, pre-generated ID used in namedFilters). Schedule habit occurrences + 30-day historical data get `scheduledDate: date.toISOString()`.
- **createDefaultUserData.js**: `createOccurrence` helper rewritten — removed `iterationMode`/`date` params + `iteration: {}` block. Added `scheduledDate` param (injects into fields), `filterOverride: null`, `hidden: false`.
- **createDefaultUserData.js**: Removed `iteration: {}` from all Module saves. All `onIteration` → `onNavigation` in operation trigger configs.

## Recent Changes (Mar 2026 — Server Tests + gridHelpers Refactor)
- **`utils/gridHelpers.js`**: NEW pure function `selectGrid(existingIds, requestedId)`. Returns `{ gridId, action: "use"|"fallback"|"create" }`.
- **`server.js`**: Refactored both the `!gridId` block and the stale-gridId block to call `selectGrid()`. Import added at line 60.
- **`__tests__/gridHelpers.test.js`**: 8 tests — all 5 cases (use/fallback/create) + edge cases.
- **`__tests__/occurrenceHelpers.test.js`**: 26 tests — getOccurrencesForGrid (6), autofillOccurrence (6), autofillOccurrences (2), createOccurrenceData (4).
- **`__tests__/fieldSchema.test.js`**: 9 tests — enum enforcement, required fields, defaults.
- **`__tests__/moduleSchema.test.js`**: 11 tests — role enum, behavior defaults, behaviorMode.
- **`__tests__/operationSchema.test.js`**: 8 tests — triggerType enum, enabled default, pipeline Mixed.
- **`__tests__/occurrenceSchema.test.js`**: 9 tests — targetType enum, iteration.mode, required fields.
- **Total**: 63 server tests, all passing. Run: `npm --prefix ./server run test`

## Recent Changes (Mar 2026 — Grid Selection Fix)
- **server.js**: Fixed `request_full_state` with no gridId — now checks `uc.gridsById` for existing grids FIRST instead of always creating a new empty grid. New behavior: if user has existing grids, uses the first one (oldest, from resetData). Only creates new empty grid if user has NO grids at all. Fixes test user always getting empty grid after resetData.
- **tests/e2e/auth.setup.js**: After setting JWT token and reloading page, now waits for `moduli-gridId` to appear in localStorage (set by `onFullState` in bindSocketToStore.js) before saving storageState. Ensures Playwright tests always start with correct gridId in localStorage, so server finds the right grid with all data.

## Recent Changes (Mar 2026 — Pipeline Action Types + View Handler)
- **server.js**: Added `socket.on("update_view", ...)` handler — persists view field patches (activeOccurrenceId, layout, etc.) to DB via `View.findOneAndUpdate`. Emits `view_updated` to other connected windows.
- **server.js**: Added `socket.on("navigate_day_page", ...)` handler — finds/creates day page occurrence for a given date (idempotent), copies textmap from most recent occurrence as template, updates `view.activeOccurrenceId`, emits `occurrence_created` + `view_updated`.
- **server.js**: `create_occurrence_with_iteration` now accepts optional `occurrenceId` param — uses it on new creation (pre-generated client-side for `$lastCreatedOccurrenceId`). On existing-find, emits `_requestedId` so client can reconcile.
- **createDefaultUserData.js**: Added "Day Page Auto-Create" `Operation` record (triggerTypes: onIteration + onSchedule midnight). Uses `NAVIGATE_DAY_PAGE` action with `moduleId: dayPageModuleId`, `viewId: dayPageViewId`. Fires when user navigates days OR at midnight. Replaces hardcoded App.jsx socket emit.
- **createDefaultUserData.js**: Added 4 recurring task reset operations using `RESET_RECURRING_TASK` action type (Doctor Checkup/Car Insurance/File Taxes/Quarterly Review — 365/365/365/90 day recurrence).

## Recent Changes (Mar 2026 — Due Date Fields + Countdown Operations)
- **createDefaultUserData.js**: Added 3 new display fields: `daysUntilDue` ("Days Until Due", postfix " days"), `overdueTasks` ("Overdue Tasks"), `upcomingThisWeek` ("Due This Week").
- **createDefaultUserData.js**: Added `daysUntilDue` display binding to all todo instances that have `dueDate` (buyGroceries, returnBooks, payBills, renewLicense, dentistAppt, fileInsurance, prepPresentation, birthdayGift).
- **createDefaultUserData.js**: Added `planningInstances` — 5 project/deadline instances (moduiLaunch, doctorCheckup, carInsurance, fileTaxes, quarterlyReview) with `dueDate` + `daysUntilDue` bindings.
- **createDefaultUserData.js**: Added `todoPlan` container ("Planning & Deadlines") to `todoContainers`. Added `planningGoal` container to `goalContainers`.
- **createDefaultUserData.js**: Added `planningSummary` goal instance (shows overdueTasks + upcomingThisWeek). Added to `goalInstances`.
- **createDefaultUserData.js**: Added `makeCountdownOp` helper. Added 3 operations: "Days Until Due" (DATE_DIFF per-occurrence), "Overdue Tasks Count" (COUNT_DATE_OVERDUE), "Due This Week" (COUNT_DATE_UPCOMING withinDays:7).
- **createDefaultUserData.js**: Planning instances pre-filled with upcoming due dates (daysFromNow: Launch=45, Doctor=90, Car Insurance=12, Taxes=38, Quarterly=21).

## Recent Changes (Mar 2026 — LOOP Pipeline + Loop-Based Operations)
- **createDefaultUserData.js**: Removed `makeAggOp` (AGGREGATE black-box). Replaced with 7 loop-based helpers at module scope: `makeLoopSumOp`, `makeLoopCountOp`, `makeLoopCountTrueOp`, `makeLoopLastOp`, `makeLoopMultiSumOp`, `makeNetBalanceOp`, `makeCompletionRateOp`. All take `{ name, targetFieldId, fieldId, timeFilter, flowFilter, targetValue, targetPeriod, folderId, userId, gridId }`.
- **createDefaultUserData.js**: All 26 operations now use LOOP/IF/variable steps (INIT_VAR, ADD_TO_VAR, INCREMENT_VAR, MULTIPLY_VAR, DIV_VAR). `makeNetBalanceOp` uses two loops + negate-and-add pattern. `makeCompletionRateOp` uses nested IF + MULTIPLY_VAR×100 + DIV_VAR. Added missing `Time Spent Today` operation (writes to `totalDuration` display field).
- **operationExecutor.js (client)**: Added `DIV_VAR` action: `$a = Math.round($a / by × 100) / 100`. Joined INIT_VAR/ADD_TO_VAR/SET_VAR/MULTIPLY_VAR/INCREMENT_VAR family.

## Recent Changes (Mar 2026 — Workout Redesign + Finance Cleanup)
- **createDefaultUserData.js**: Replaced `workoutReps`, `workoutSets`, `chestMin`/`backMin`/`legsMin`/`shouldersMin`/`armsMin`/`cardioMin` fields with `set1Reps`/`set2Reps`/`set3Reps` (input) + `totalRepsToday` (display). Updated `makeWorkout()` to bind set1/set2/set3Reps + muscleGroup. Replaced 6 muscle-group containers with single "Physical - Fitness" container (`workoutAll`). All 30 workout instances in `workoutAll`. Replaced 6 muscle-group minute ops with single "Total Reps Today" aggregation op. `workoutGoalInstance` now shows `totalRepsToday` + `totalSteps`.
- **createDefaultUserData.js**: Removed `weeklyIncome`, `weeklyExpenses`, `monthlyIncome`, `monthlyExpenses` fields and `monthlyFinances` instance. `bankAccount` instance now shows `netBalance` + `totalSpent` + `totalIncome`.
- **createDefaultUserData.js**: `makeAggOp` now accepts `scope` parameter (was ignored before) and includes it in AGGREGATE config. Adds auto-generated `description` and `triggerConfig` (with `allowedFields` for onChange, `{}` for onIteration). `makeLiteralOp` adds `description` and `triggerConfig`. Reset: 58 fields, 131 instances, 82 containers, 22 operations.

## Recent Changes (Mar 2026 — Journal Q&A Format Fix)
- **createDefaultUserData.js**: Fixed `journalContainerDocContent` — now shows: row 1: `"Question: "` (plain text) + `journalQuestion` fieldPill (display); row 2: `"Answer: "` (bold text) + `journalAnswer` fieldPill (input); row 3: instancePill for journaling instance. Removed "Today's Question: " / instancePill-only layout.

## Recent Changes (Mar 2026 — Full Occurrence-Based Ordering Refactor)
- **server.js `create_module`**: Removed `next.occurrences = []` — modules have no occurrences array.
- **server.js `delete_module`**: Now removes deleted occurrence IDs from parent OCCURRENCES (not parent modules). Calls `Occurrence.findOneAndUpdate` and emits `occurrence_updated` for affected parents.
- **server.js `fill_from_template`**: Now finds container OCCURRENCE (by `targetId === containerId`), updates `containerOcc.occurrences`, persists via `Occurrence.findOneAndUpdate`, emits `occurrence_updated`. Removed `container.occurrences` mutation and `Container.findOneAndUpdate` call.

## Recent Changes (Mar 2026 — Uploads Sync + Occurrence-Based Ordering)
- **server.js**: Textmap sync now writes `uploads/md/{occurrenceId}.md` (per-occurrence, not per-module.fileRef). Removed `artifacts/` static route and `artifactsDir`. Added `uploads/md/` subdir creation on startup.
- **server.js**: Copy-linked occurrence sync extended — now propagates both `fields` AND `textmap` changes. Each linked occurrence also gets its own `uploads/md/{id}.md` written.
- **createDefaultUserData.js**: Removed artifacts/ folder creation and file writing. Creates `uploads/md/` dir. Source markdown files (morenotes.md, gospelofthomasnotes.md) remain in repo root for parsing only.
- **client/src/Instance.jsx (root)**: DELETED (was dead code since modules/Instance.jsx replaced it)
- **LayoutHelpers.js**: `getPanelContainers`, `getContainerItems`, `getContainerItemsWithOccurrences` all accept optional `entityOccurrence` param. Prefers `entityOccurrence.occurrences` for ordering, falls back to `entity.occurrences` (legacy). New internal `resolveChildOccurrenceIds(entity, occ)` helper.
- **Panel.jsx**: Passes `panelOccurrence` to both `getPanelContainers` calls.
- **Container.jsx**: Passes `containerOccurrence` to `getContainerItemsWithOccurrences`. `handleSaveAsTemplate` prefers `containerOccurrence.occurrences` over `module.occurrences` for template item collection.

## Recent Changes (Mar 2026 — Notebook H2/H3 Container Structure)
- **createDefaultUserData.js**: Replaced `parseSections` calls for morenotes/gospel with `parseSectionsWithInstances` (two-level parser). morenotes: `parseSectionsWithInstances(..., 1, 2, 8)` — H1 → containers, H2 within → instances. gospel: `parseSectionsWithInstances(..., 2, 3, 8)` — H2 → containers, H3 within → instances.
- **createDefaultUserData.js**: `notesBySectionKey` now stores `extraLines` (content not under sub-headings) + `instances` (from sub-headings). Container textmap uses `makeDocContent(entry.extraLines)`.
- **createDefaultUserData.js**: Notes wiring creates instance occurrences for H2/H3 sub-headings (currently empty in both files — containers show rich text content from extraLines). Each sub-heading instance gets its own textmap from `inst.lines`.

## Recent Changes (Mar 2026 — Notebook Parser Rewrite + Inline Marks Fix)
- **createDefaultUserData.js**: Added `parseSections(filePath, headingLevel, maxSections)` — simple parser, returns `[{ heading, lines }]`. Added `parseSectionsWithInstances(filePath, sectionLevel, instanceLevel, maxSections)` — two-level parser, returns `[{ heading, instances: [{heading, lines}], extraLines }]`.
- **createDefaultUserData.js**: Fixed `inlineToTipTap(text)` — handles `***bold+italic***` (3 asterisks), `**bold**` (2), `*italic*` (1). Uses regex alternation (longest-first).
- **createDefaultUserData.js**: Added `makeDocContent(lines)` — converts raw markdown lines to TipTap nodes: `* text`/`- text` → bulletList, `## heading` → heading node, inline marks via `inlineToTipTap`.
- **createDefaultUserData.js**: `notesBySectionKey` entries now `{ heading, extraLines, instances: [{id, label, lines}] }`.

## Recent Changes (Mar 2026 — Notebook Panel Overhaul + Workout Weight)
- **createDefaultUserData.js**: Removed separate `notes` panel (kind: "board" with list containers). Changed `dayPage` (Notebook) panel from `kind: "artifact-viewer"` to `kind: "board"`.
- **createDefaultUserData.js**: Replaced `dayPageContainers` (single dayJournal) and `notesContainers`/`notesInstances` with `notebookDocContainers` — one `kind: "doc"` container per H1/H2 section from morenotes.md (8) + gospelofthomasnotes.md (8), plus a "Daily Journal" container first.
- **createDefaultUserData.js**: Journal container docContent has `journalQuestion` fieldPill at top + `journaling` instance pill (with occurrenceId). The journaling instance (with journalAnswer fieldBinding) is created as an occurrence inside the journal container.
- **createDefaultUserData.js**: Added `workoutWeight` field (number, lbs, increment 5, folderId: fitnessFolderId). `makeWorkout()` now includes `workoutWeight` at order 4; `muscleGroup` moved to order 5.
- **createDefaultUserData.js**: Panel placements no longer include `notes`. `panelPlacements` has 6 entries instead of 7.

## Recent Changes (Mar 2026 — Notebook Overhaul v2)
- **createDefaultUserData.js**: Added `parseSectionsWithGroups(filePath, headingLevel, maxSections)` — detects `**Bold:**` subheadings as group separators within sections. Returns `[{ heading, groups: [{label, bullets}] }]`.
- **createDefaultUserData.js**: Added `inlineToTipTap(text)` — converts `**bold**` → TipTap bold marks. Added `makeBulletDocContent(bullets)` — bulletList TipTap doc from bullet strings (preserves bold). Added `makeSectionContainerDocContent(heading, instances)` — H2 heading + instancePill list for container occurrence.
- **createDefaultUserData.js**: morenotes.md (H1 level) — one instance per **Internal:**/**External:** bold subgroup. gospelofthomasnotes.md (H2 level) — one instance per section (all bullets merged). Section containers: `kind: "doc"`.
- **createDefaultUserData.js**: STEP 5 notebook wiring: each group instance occurrence has `docContent = makeBulletDocContent(group.bullets)`. Container occurrence in panel has `docContent = makeSectionContainerDocContent(heading, instances)` — H2 heading + instance pills.

## Recent Changes (Mar 2026 — Notes Panel + Muscle Group Fix)
- **createDefaultUserData.js**: Added `fs`/`path` imports + `parseMarkdownSections(filePath, maxSections)` helper — parses markdown H1/H2 headings into `[{ heading, bullets }]`.
- **createDefaultUserData.js**: `makeWorkout` now stores `group.toLowerCase()` in `meta.defaultMuscleGroup` to match select option values (`{ value: "chest" }` not `"Chest"`).
- **createDefaultUserData.js**: Added `notesContainers` (one container per H1/H2 section, kind: "list") from `morenotes.md` + `gospelofthomasnotes.md` (8 sections each max). Added `notesInstances` (one instance per bullet, kind: "doc", label = bullet text). Added `notes` panel (kind: "board", col 1 row 0-1 stacked with Schedule/Notebook). Occurrence wiring in STEP 5 creates container occs + bullet instance occs.

## Recent Changes (Mar 2026 — Workout/Nutrition Data)
- **createDefaultUserData.js**: Added 30 workout instances (`makeWorkout(label, group)` helper × 5 exercises × 6 muscle groups: Chest/Back/Legs/Shoulders/Arms/Cardio). Added 25 nutrition instances (`makeNutrition(label, mealType, cal, prot, c, fat)` helper, Mediterranean diet). Added workoutGoalInstance + nutritionGoalInstance (display fields for muscle-group mins + macros). toolkitContainers extended with 6 workout + 5 nutrition containers. goalContainers extended with `workoutGoal` + `nutritionGoal`. `allInstances` now includes workout/nutrition instances. `isToolkitInstance` check covers workout + nutrition keys. `toolkitMappings` loop uses `allInstances[instKey]` (not `toolkitInstances` directly). `goalMappings` loop uses `allInstances[instKey]`. Reset produces: 132 instances, 87 containers, 26 operations.

## Recent Changes (Mar 2026)
- **createDefaultUserData.js**: All operations converted to `steps` format. `makeAggOp`/`makeLiteralOp` helpers use `steps`. `budgetAlertOp` and `scheduleCompletionOp` use `if` steps.

## Recent Changes (Feb 22 — Operations Pipeline)
- **Field.js**: MIGRATED — removed mode/metric/conditions/triggers/display. Added inputEnabled, displayEnabled, displayConfig{showArrows,arrowColor,targetValue,targetPeriod}
- **createDefaultUserData.js**: Migrated all derived fields to displayEnabled:true. Added makeAggOp() / makeLiteralOp() helpers. Creates Operations for all display fields. Removed Field.findOneAndUpdate metric.allowedFields calls.
- createProfileData.js: **NEW** — creates Profile folder (8 category docs) + Quick Notes folder (6 root .md/.txt files)
- createDefaultUserData.js: Grid cols 3→4; added "profile" panel (artifact-viewer, col 3, rows 0-1)

## Running
```bash
# Dev (from root)
npm run dev

# Reset sample data (WSL)
wsl -d Ubuntu-24.04 -e bash -c "cd ~/dndtest2/server && ~/.nvm/versions/node/v22.21.1/bin/node scripts/resetData.js"
```
