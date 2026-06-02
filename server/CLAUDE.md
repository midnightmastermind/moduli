# server — Server CLAUDE.md

_Updated: 2026-05-27. Check this file before re-reading source._

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
