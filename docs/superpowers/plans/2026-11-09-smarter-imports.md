# Smarter Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every share (link, text, image, file) goes through one import pipeline, lands in the Imports folder as a real page laid out like its source, is previewed before saving, and is scored against a fixed test set so "smarter" is measured.

**Architecture:** A server pipeline `extract → structure → enrich(rules) → write` produces `{ markdown, meta }` and hands it to the existing planner (`markdownToModuli`), which stays the only writer. A background job runs Ollama clean-up after the page is saved. A test-set runner in `server/eval/imports/` scores every stage; corrections the user makes are saved and fed back to Ollama as examples.

**Tech Stack:** Node 22 (server, ESM), Express + socket.io, Mongoose, tesseract.js (added to the server), React (share window), vitest (both sides), local Ollama (`OLLAMA_URL`, `/api/chat`).

**Spec:** `docs/superpowers/specs/2026-11-09-smarter-imports-design.md`

## Global Constraints

- Auto files link / text / image / pdf / anything-else shares into the **protected Imports folder** (find it anywhere by `meta.protected` + name `Imports`, as `ensureImportsFolderAndPage` does — 0380 put it inside Files). Calendar (`.ics`) and contact / profile rules are not touched.
- **Ollama never blocks a save.** Every Ollama call runs after the import is written; a slow or failed call leaves the rules-only result. Preview uses rules only and says "AI clean-up will run after saving".
- **Ollama may only fix misreads, never rewrite prose:** its output is accepted only if `acceptCleanup` (Task 7) passes.
- **The preview is the same pipeline in dry-run mode** — what the window shows is what is written.
- **One writer:** occurrences are created only by `markdownToModuli` / `runOperationServerSide`. No new raw `Occurrence.create` paths.
- poms grid is protected live data: the retarget migration is dry-run first, then applied with `scripts/runMigrations.js`, then `sudo -u deploy pm2 restart moduli`.
- Already-shared items stay where they are; only new shares change.
- No change to OCR / import rules ships unless `node server/eval/imports/run.mjs --check` passes (no case scores below its baseline).
- Do not run `deploy.sh` while another session's uncommitted files are in the tree (it runs `git add -A`); commit your own files by path.

## Review Focus

1. **A share whose page cannot be fetched** (IMDb refuses the server; a dead link): Auto must still save the bookmark in Imports and say the readable page could not be built — never a 502 with nothing saved. → test in Task 4.
2. **A photo with no text, or OCR that returns only noise** (`"| ."`): becomes just the picture in Imports, no empty page. → test in Task 3.
3. **Ollama down or slow (CPU droplet, 9s+)**: the page stays as written, no half-applied edit, no error shown to the user beyond a log line. → test in Task 7.
4. **Ollama "improves" prose** (rewords, drops a sentence, translates): rejected by `acceptCleanup`; the rules result stands. → test in Task 7.
5. **The same link shared twice**: one bookmark and one readable page, not two of each (externalId dedupe still holds with the new Imports target). → test in Task 4.

---

### Task 1: Import test set and scoring runner

**Files:**
- Create: `server/eval/imports/score.js`
- Create: `server/eval/imports/run.mjs`
- Create: `server/eval/imports/cases/gnosis/` — `source.jpg` (copy of prod `uploads/user/2026-11/share-clip-4d3868d7-f73a-4b37-a440-c3de7890bdca.jpg`), `ocr.json` (recorded tesseract page), `expected.md`, `expected.json`
- Create: `server/eval/imports/recordOcr.mjs` (records `ocr.json` for an image case)
- Create: `server/eval/imports/baseline.json`
- Modify: `server/package.json` (add `tesseract.js` ^7.0.0, the client's version; add script `"eval:imports": "node eval/imports/run.mjs"`)
- Test: `server/__tests__/importEvalScore.test.js`

**Interfaces:**
- Produces: `scoreCase({ expectedMd, expectedMeta, actualMd, actualMeta }) -> { total: number /*0..1*/, parts: { paragraphs, headings, quotes, title, imageKept, board, chars } }` (each part 0..1; a part whose expectation is absent is omitted from `parts` and from the average).
- Produces: a case directory shape `{ kind: "image"|"html"|"text"|"wikipedia", source.*, expected.md, expected.json }` where `expected.json` = `{ title?, imageKept?, board?, type? }`. HTML cases store `source.html` + `url.txt` (no network in the runner).
- Produces: `run.mjs` flags `--baseline` (write current scores to `baseline.json`), `--check` (exit 1 if any case < its baseline − 0.001), `--only <case>`, `--with-ollama` (Task 7 hooks in), printing a `console.table` of case × part.
- Consumes (later tasks plug in): `runImport` from Task 3 in dry-run mode, called with the case's source.

`expected.md` for Gnosis (exact):
```
# Gnosis

Gnosis is conscious knowledge. The word "gnosis" can refer to:

The knowledge we acquire … from the unconscious.

The tradition that gave birth to our most respected philosophies, sciences, arts, and religions.

> "I know! I don't need to believe."
> — C. G. Jung
```
(Copy the full definition paragraph text from the image, including *jña* and *rigpa*, when writing the file — read it off `source.jpg`.)

- [ ] **Step 1: Write the failing test** in `importEvalScore.test.js`:
  - `paragraphs`: identical markdown scores 1; actual that merges two expected paragraphs into one scores < 1 (boundaries compared as the set of paragraph-start word offsets, F1).
  - `quotes`: expected has a `>` block, actual has the same words as a plain paragraph → `parts.quotes === 0`.
  - `chars`: `"I know"` vs `"| know"` → `chars` between 0.8 and 1 (1 − normalized Levenshtein over the whole text with markdown syntax stripped).
  - `title`: `expectedMeta.title` absent → `parts.title` undefined and not averaged.
  - `imageKept`: expected `true`, actual meta `images: []` → 0.
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/importEvalScore.test.js` — Expected: FAIL, `scoreCase` not found.
- [ ] **Step 3: Implement `scoreCase`** in `score.js` (pure; paragraph = a markdown block separated by a blank line; heading = a line starting `#`; quote = a `>` block).
- [ ] **Step 4: Run the test** — Expected: PASS.
- [ ] **Step 5: Write `recordOcr.mjs <caseDir>`** — runs tesseract.js (`eng`, the same `recognize(..., {}, { blocks: true })` options `client/src/helpers/ocr.js` uses) on `source.jpg` and writes the page JSON to `ocr.json`. Run it for `gnosis`; commit `ocr.json` so the runner needs no OCR engine.
- [ ] **Step 6: Write `run.mjs`.** Until Task 3 lands, an image case's actual markdown is `ocrToMarkdown(ocr.json, { mode: "magic" })` from today's `client/src/helpers/ocrLayout.js`. Add at least: gnosis (image), 2 article HTML snapshots from the user's grid's Bookmarks/Imports (save the page HTML once with `curl`, hand-write `expected.md` = the article's real paragraphs/headings), 1 screenshot from `uploads/user/2026-11/` with text, 1 Wikipedia page HTML (`Albert Ellis`). Record what each case's source is in a one-line `README.md` in `cases/`.
- [ ] **Step 7: Run** `node server/eval/imports/run.mjs --baseline` — Expected: a table where gnosis `paragraphs` < 1 and `quotes` = 0 (today's defect, measured). Commit the baseline.
- [ ] **Step 8: Commit** `git add server/eval server/__tests__/importEvalScore.test.js server/package.json server/package-lock.json && git commit -m "feat(eval): import test set and scoring runner"`

---

### Task 2: OCR layout from the page's own gaps; quotes; safe character fixes

**Files:**
- Create: `server/utils/ocrLayout.js` (moved from `client/src/helpers/ocrLayout.js`, same exports)
- Modify: `client/src/helpers/ocrLayout.js` → `export * from "../../../server/utils/ocrLayout.js";` (the client already imports server utils this way, e.g. `textmapDigest`)
- Test: `client/src/__tests__/ocrLayout.test.js` (existing, keep green), `server/__tests__/ocrLayoutGaps.test.js` (new)

**Interfaces:**
- Produces (unchanged names): `joinLines(lines)`, `ocrParagraphs(page) -> { paragraphs: [{ lines, kind: "heading"|"para"|"list"|"quote", attribution? }] }`, `ocrToMarkdown(page, { mode }) -> string`.
- Produces: `fixOcrCharacters(text) -> string` — the only rule-level character fix: a standalone `|` between word characters/spaces → `I`. Nothing else.

Paragraph rule (replaces `GAP_LINES = 1.2` as the only gap test): within a tesseract block, compute the median line gap `g` of the page; a gap > `1.6 × g` (and > `0.6 × median line height`) is a break. Also a break when the previous line ends with `:` or `.` / `?` / `!` AND is shorter than 70% of the block's median line width AND the next line starts with a capital at the block's left edge (±1 median char width). Keep the existing `SIZE_JUMP = 1.25` heading rule.

Quote rule: a block whose text starts with an opening quote (`"` `“` `‘`) and ends with a closing quote, or whose lines are centred (left and right margins within 15% of each other and both > 10% of page width), is `kind: "quote"`; a following short line (≤ 6 words) that starts with `—`/`-`/`–` or is a capitalised name (e.g. `C. G. Jung`) becomes its `attribution`. Markdown: `> "…"` then `> — <attribution>`.

- [ ] **Step 1: Write failing tests** in `ocrLayoutGaps.test.js` using `server/eval/imports/cases/gnosis/ocr.json`:
  - `ocrParagraphs` yields ≥ 4 non-heading paragraphs and the third starts `"The knowledge"`, the fourth `"The tradition"`.
  - the last paragraph is `kind: "quote"` with `attribution === "C. G. Jung"`.
  - `fixOcrCharacters('"I know! | don\'t need')` → `'"I know! I don\'t need'`; `fixOcrCharacters("a|b")` unchanged (only a standalone bar); `fixOcrCharacters("x || y")` unchanged.
  - a synthetic page of 6 evenly spaced lines in one block → exactly 1 paragraph (no over-splitting).
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/ocrLayoutGaps.test.js` — Expected: FAIL.
- [ ] **Step 3: Move the file, implement the rules** in `server/utils/ocrLayout.js`; `ocrToMarkdown` runs `fixOcrCharacters` on line text.
- [ ] **Step 4: Run both** `server/__tests__/ocrLayoutGaps.test.js` and `cd client && node node_modules/.bin/vitest run src/__tests__/ocrLayout.test.js` — Expected: PASS.
- [ ] **Step 5: Run** `node server/eval/imports/run.mjs --check` — Expected: gnosis `paragraphs` and `quotes` up, nothing below baseline. Then `--baseline` to record the new floor.
- [ ] **Step 6: Commit** `fix(ocr): paragraphs from the page's gap distribution; quotes and attributions`

---

### Task 3: One import pipeline; server-side OCR; a page keeps its picture and splits paragraphs

**Files:**
- Create: `server/services/importPipeline.js`
- Create: `server/services/serverOcr.js`
- Modify: `server/services/markdownImporter.js` (`markdownToModuli` gains `paragraphBlocks`)
- Modify: `server/eval/imports/run.mjs` (use `runImport({ dryRun: true })` for every case)
- Test: `server/__tests__/importPipeline.test.js`

**Interfaces:**
- Produces: `ocrImage(filePath) -> Promise<page>` in `serverOcr.js` (tesseract.js worker, `eng`, same options as the client; one worker reused, created lazily).
- Produces: `extractImport(source) -> Promise<{ markdown, meta }>` where `source` is one of `{ kind: "link", url, html? }`, `{ kind: "text", text, title? }`, `{ kind: "image", filePath, imageOccurrenceId }`, `{ kind: "html", html, url }`; `meta = { title, images: [{ url, occurrenceId? }], fields: {}, type: null|string, source: { kind, url? } }`.
- Produces: `runImport({ source, gridId, userId, parentId = null, parentFolderId = null, dryRun = false }) -> Promise<{ markdown, meta, plan?, rootOccurrenceId?, empty: boolean }>`; writes through `markdownToModuli({ boldSections: true, paragraphBlocks: true, title: meta.title, sourceUrl })` and sets `meta.importSource` + `meta.importedAt` on the root (Task 8 reads them). `empty: true` (and nothing written) when the extracted text has fewer than 3 words.
- Produces: `markdownToModuli({ …, paragraphBlocks: true })` — each prose paragraph becomes its own textblock inside its section instead of merging per section (default `false`, so existing callers are unchanged).
- Consumes: `ocrToMarkdown` (Task 2), `readLinkForImport` (`server/utils/linkImport.js`), `imagesFromHtml` (`server/utils/pageImages.js`).

Image source: markdown = the OCR markdown with the picture embedded first (`![](<image url>)` resolving to the existing image occurrence, so the planner wraps the text beside it rather than minting a second copy). Link source: `readLinkForImport`; `meta.images` from `imagesFromHtml`. Wikipedia: `extractImport` for a `*.wikipedia.org/wiki/*` link calls the existing wikipedia extraction (`services/wikipediaTools.js` HTML→markdown) as its extract stage.

- [ ] **Step 1: Write failing tests:**
  - `runImport({ source: { kind:"image", … gnosis … }, dryRun:true })` → plan has ≥ 4 textblocks (one per paragraph), one quote node, and one image embed naming `imageOccurrenceId` (mock `ocrImage` to return the recorded `ocr.json`).
  - an image whose OCR text is `"| ."` → `{ empty: true }` and no plan.
  - `markdownToModuli({ markdown: "a\n\nb", paragraphBlocks: true, dryRun: true })` → 2 textblocks; without the flag → 1 (control: existing callers unchanged).
  - a link case with injected `fetchPageHtml` → `meta.title` from the page `<title>` and `meta.images.length > 0`.
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/importPipeline.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `serverOcr.js`, `importPipeline.js`, and the `paragraphBlocks` option.
- [ ] **Step 4: Run** the test file and `node node_modules/.bin/vitest run __tests__/importPlan.test.js __tests__/readerSpeed.test.js` (existing planner tests) — Expected: PASS.
- [ ] **Step 5: Switch the runner to `runImport`; run** `node server/eval/imports/run.mjs --check` — Expected: no regression; record `--baseline`.
- [ ] **Step 6: Point the existing paths at it:** `socketHandlers/import.js` `import_text` / `import_url` and `POST /api/v1/import/url` call `runImport` (their shape/embed/listing behaviour unchanged — their tests must stay green). The OCR viewer's "+ Page" (`client/src/modules/ImageOcrViews.jsx`) emits `import_text` with `{ ocrPage, imageOccurrenceId }` so the server builds the same page Auto would.
- [ ] **Step 7: Run** the full server suite `cd server && node node_modules/.bin/vitest run` — Expected: PASS.
- [ ] **Step 8: Commit** `feat(import): one import pipeline; server OCR; pages keep the picture and split paragraphs`

---

### Task 4: Auto files into Imports — bookmark plus readable page; picture-only for textless images

**Files:**
- Modify: `server/services/serverExecutor.js` (new action `IMPORT_TO_PAGE`)
- Create: `server/services/importJobs.js`
- Create: `server/migrations/0489-auto-shares-into-imports.mjs`
- Modify: `server/utils/shareRulesEnsure.js` (catch-all v3 targets Imports)
- Test: `server/__tests__/autoSharesIntoImports.test.js`

**Interfaces:**
- Produces: executor action `IMPORT_TO_PAGE` config `{ from: "$share", parentFolderId, linkTo?: "$bookmarkId", into?: "$var" }` → calls `runImport` with the share's source (link → `{kind:"link"}`, text → `{kind:"text"}`, image → `{kind:"image", imageOccurrenceId: $share.props.occurrenceId}`); binds the root id to `into`. For a **link** it does not wait: it calls `queueImport(job)` and returns at once.
- Produces: `queueImport({ source, gridId, userId, parentFolderId, linkTo }) -> void` and `onImportDone(cb)` in `importJobs.js` — in-process queue, one job at a time, persists result through `runImport`, then sets `meta.readerPageId` on the bookmark and `meta.bookmarkId` on the page root (both via the socket-path writer so the warm cache is mirrored), then broadcasts. A fetch failure sets `meta.readerPageError` on the bookmark and logs; it does not throw.
- Produces: `findImportsFolder({ userId, gridId }) -> Promise<folderId|null>` (protected, named `Imports`, any depth — share it with the client rule in `client/src/helpers/importsFolder.js` by matching the same predicate).
- Consumes: `runImport` (Task 3).

Migration 0489: for every enabled `onShare` op whose `shareType` ∈ {`link`, `text`, `image`, `pdf`, `*`}: rewrite each CREATE / MOVE destination (`parent`, `parentId`, `parentFolderId`, `to`) to `literal:<Imports folder id>` as `parentFolderId`; append after the link rule's bookmark CREATE an `IMPORT_TO_PAGE { from:"$share", parentFolderId:<Imports>, linkTo:"$<that CREATE's itemIdVar>" }`; in the text and image rules replace the CREATE with `IMPORT_TO_PAGE` (image: picture stays as the file, the page embeds it; `empty` → the picture alone, moved into Imports). Rules for `ics`/`calendar`, `contact`, `profile` are asserted unchanged. Pure `retargetShareRule(op, importsId) -> op|null`, refuses on a missing Imports folder. Marker `imports-0489` makes it idempotent.

- [ ] **Step 1: Write failing tests** (real `runOperationServerSide`, models mocked as in `shareLinkCompat.test.js`):
  - a link share → one bookmark row with `parentId` = Imports; `queueImport` called once with `linkTo` = the bookmark's id.
  - the job, run to completion with an injected `fetchPageHtml`, writes a page root under Imports with `meta.bookmarkId`, and the bookmark gets `meta.readerPageId`.
  - the job with a `fetchPageHtml` that throws → bookmark kept, `meta.readerPageError` set, no page, no throw.
  - the same link shared twice → still one bookmark, `queueImport` not called the second time (externalId dedupe).
  - an image share whose OCR is empty → the picture is in Imports and no page row exists.
  - `retargetShareRule` on a calendar rule → `null` (unchanged); on a link rule → destination is Imports; run twice → identical output.
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/autoSharesIntoImports.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `IMPORT_TO_PAGE`, `importJobs.js`, `findImportsFolder`, the migration, catch-all v3 (`CATCH_ALL_VERSION = 3`; unchanged rule logic, destination Imports; still skipped when `meta.userEdited`).
- [ ] **Step 4: Run** the test file plus `__tests__/shareLinkCompat.test.js __tests__/sharePersonRules.test.js` — Expected: PASS.
- [ ] **Step 5: Dry run on poms** `cd server && node --env-file=.env scripts/runMigrations.js --grid "poms grid" --only 0489-auto-shares-into-imports` — Expected: names exactly the link / text / image / pdf / catch-all rules and nothing else. Apply with `--apply`, read the ops back out of Mongo, restart pm2.
- [ ] **Step 6: Commit** `feat(share): Auto files into Imports; a link becomes a bookmark and its readable page`

---

### Task 5: The share window shows what will be created, and lets you set body and images

**Files:**
- Modify: `server/routes/apiV1.js` — new `GET /share/stage/:id/import-preview?k=&gridId=`
- Modify: `server/services/manualPlacement.js` — takes `importAs` and `images`
- Modify: `client/src/ui/SharePlace.jsx` — Auto preview panel; New/Preset body, images, and link choice
- Create: `client/src/ui/ShareImportPreview.jsx` (the read-only preview; keeps SharePlace from growing past 609 lines)
- Test: `server/__tests__/shareImportPreview.test.js`, `client/src/__tests__/shareImportPreview.test.jsx`

**Interfaces:**
- Produces: preview route (key-authorized like `/share/stage/:id/cover`) → `{ where: "Imports", label, type, board: null|{ id, label }, fields: { [fieldName]: value }, bodyLines: string[] /*first 8 non-empty lines of the markdown*/, images: string[], willBuildPage: boolean, aiNote: "AI clean-up will run after saving" }`. Built from `runImport({ dryRun: true })` with Ollama off. Answers within 8s or returns `{ partial: true }` with what it has (label + images) — never blocks Save.
- Produces: share POST body gains `importAs: "bookmark"|"page"|"both"` (link only; Auto default `"both"`, New/Preset default `"bookmark"`) and `images: string[]` (the chosen pictures). `manualPlacement` with `importAs` `"page"` or `"both"` runs `runImport` into the chosen destination with the user's label/body overrides applied to `meta.title` / the markdown's first paragraph block.
- Consumes: `runImport` (Task 3), `ShareImportPreview` props `{ preview, loading }`.

UI copy (exact): Auto panel heading **"Will be created in Imports"**; link radio labels **"Keep as bookmark"**, **"Turn into a page"**, **"Both"**; body box label **"Body"**; images row label **"Pictures"** (thumbnails from the stage's `candidates` + the preview's `images`, toggle to include); footer note `aiNote`.

- [ ] **Step 1: Write failing tests:**
  - server: the route with a staged link and injected fetch → `label`, `bodyLines.length > 0`, `images.length > 0`, `where === "Imports"`; a staged image share → `bodyLines` from OCR; an unreachable link → 200 with `willBuildPage: false` and the label from the stage.
  - server: POST `/share` mode `manual` with `importAs: "page"` → `runImport` called with the chosen `parentId` and the edited label as title.
  - client: Auto mode renders the heading, the body lines and the AI note; New mode shows a "Body" textarea and "Pictures" toggles for a link and the three link radios; picking "Turn into a page" puts `importAs: "page"` in the payload `buildSharePayload` returns.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement** the route, `manualPlacement` changes, `ShareImportPreview.jsx`, SharePlace wiring.
- [ ] **Step 4: Run** both files plus `server/__tests__/manualPlacement.test.js` and `client/src/__tests__/sharePending.test.jsx` — Expected: PASS.
- [ ] **Step 5: Watch it on prod** (after deploy): stage the Gnosis image and one article link against test grid 2 through `/share/stage`, open `/share-place`, confirm the preview shows body lines and pictures, Save, read the created rows out of Mongo (preview label/body == stored), then delete them through the app.
- [ ] **Step 6: Commit** `feat(share): the placement window previews the import and edits body and pictures`

---

### Task 6: Articles read their structured data and match a board

**Files:**
- Create: `server/utils/structuredData.js`
- Create: `server/services/boardMatch.js`
- Modify: `server/services/importPipeline.js` (enrich-rules stage)
- Test: `server/__tests__/structuredData.test.js`, `server/__tests__/boardMatch.test.js`

**Interfaces:**
- Produces: `readStructuredData(html, url) -> { type: null|"Article"|"Recipe"|"Movie"|"Book"|"Product"|"Person", title?, author?, date?, image?, fields: {} }` — JSON-LD first (`@type`, including inside `@graph` arrays), then Open Graph (`og:type`, `og:title`, `og:image`, `article:author`, `article:published_time`), then `<article>`'s first `<h1>`. `fields` holds type-specific keys (`year`, `director`, `author`, `ingredients`).
- Produces: `matchBoard({ userId, gridId, type }) -> Promise<null|{ id, label, shape }>` — maps the schema type to the grid's Board Category values (`Movie→movie`, `Book→book`, `Recipe→meal|recipe`, `Person→person`, `Product→purchase`); picks the destination whose rows carry that category, via `searchDestinations` (`server/services/destinationSearch.js`), and returns its `shape` (incl. `autoFields`). `Article` and unknown types → `null` (spec call: plain page).
- Produces: `runImport` sets `meta.type`, `meta.fields` (structured values mapped onto the matched board's field names by the same name rules as `sharePresetSuggest`), `meta.board`; the page root takes the board's row bindings but still lands in Imports.
- Consumes: `extractImport` (Task 3).

- [ ] **Step 1: Write failing tests:**
  - a JSON-LD `Movie` snapshot (save one IMDb-like fixture HTML by hand) → `type "Movie"`, `title`, `fields.year`.
  - an `@graph` Article (WordPress shape) → `type "Article"`, `author`, `date`, `image`.
  - no JSON-LD, only og tags → title + image from og.
  - malformed JSON-LD (`{` cut off) → falls through to og, no throw.
  - `matchBoard` with type `Movie` and a mocked destination list → the Movies destination; with `Article` → `null`.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement**, wire into `importPipeline`.
- [ ] **Step 4: Run** the tests and `node server/eval/imports/run.mjs --check` — Expected: PASS; title/board parts up on the HTML cases. Record `--baseline`.
- [ ] **Step 5: Commit** `feat(import): structured data first; a typed page takes its board's row shape`

---

### Task 7: Ollama clean-up after saving, held to "fix misreads only"

**Files:**
- Create: `server/services/importEnrich.js`
- Modify: `server/services/importJobs.js` (enqueue an enrich job after every write, link or not)
- Modify: `server/eval/imports/run.mjs` (`--with-ollama` runs the clean-up on each case and scores both)
- Test: `server/__tests__/importEnrich.test.js`

**Interfaces:**
- Produces: `acceptCleanup(before: string, after: string) -> { ok: boolean, reason?: string }` — ok only if, after removing whitespace differences, every changed span is ≤ 3 characters long, the total edited characters are ≤ 3% of the text, word count changes by ≤ 2%, and paragraph count changes by ≤ 1 per 10 paragraphs. Anything else → `ok: false` with the reason.
- Produces: `cleanupWithOllama({ markdown, kind, examples }) -> Promise<string|null>` — POST `${OLLAMA_URL}/api/chat` (model `process.env.IMPORT_OLLAMA_MODEL || process.env.OLLAMA_MODEL`), 60s timeout, temperature 0; system prompt: fix OCR misreads and rejoin broken words/paragraphs, keep every word you cannot verify exactly as written, return only the markdown. `examples` (Task 8) go in as prior user/assistant turns. Returns `null` on timeout/error.
- Produces: `enrichImport({ rootOccurrenceId, gridId, userId }) -> Promise<{ applied: boolean, reason? }>` — reads the root's textblocks, joins their markdown, calls `cleanupWithOllama`, applies only if `acceptCleanup` passes, writing each changed textblock through `update_occurrence`'s server path (so the cache mirrors and tabs hear it), and stamps `meta.aiCleanedAt` on the root.
- Consumes: `importJobs` (Task 4), `examplesFor` (Task 8; until then `[]`).

- [ ] **Step 1: Write failing tests:**
  - `acceptCleanup("I know! | don't", "I know! I don't")` → ok.
  - a reworded sentence (`"conscious knowledge"` → `"aware understanding"`) → not ok.
  - a dropped sentence → not ok; a translated paragraph → not ok.
  - `enrichImport` with a mocked fetch that times out → `{ applied: false, reason: "ollama" }` and zero writes.
  - `enrichImport` with a mocked fetch returning a rewrite → zero writes; returning a fixed `|` → one write.
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/importEnrich.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** and enqueue enrich in `importJobs` after each write.
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Measure on prod's Ollama:** `ssh root@viafluere.com` then `cd /var/www/moduli/server && sudo -u deploy node --env-file=.env eval/imports/run.mjs --with-ollama` — Expected: a table with rules-only vs with-ollama scores per case; record the timings. The clean-up ships enabled only if the with-ollama total ≥ rules-only total and no case drops; otherwise leave `IMPORT_AI_CLEANUP` unset (the job checks `process.env.IMPORT_AI_CLEANUP === "1"`) and report the numbers.
- [ ] **Step 6: Commit** `feat(import): background Ollama clean-up, accepted only when it fixes misreads`

---

### Task 8: Corrections become examples

**Files:**
- Create: `server/models/ImportCorrection.js`
- Create: `server/services/importCorrections.js`
- Modify: `server/socketHandlers/occurrences.js` (`update_occurrence`: record a correction)
- Test: `server/__tests__/importCorrections.test.js`

**Interfaces:**
- Produces: model `ImportCorrection { userId, gridId, rootOccurrenceId, kind, site, before: String, after: String, createdAt }`, index `{ userId, gridId, kind, site, createdAt: -1 }`.
- Produces: `recordCorrection({ occurrence, prevTextmap, nextTextmap, uc }) -> Promise<void>` — called from `update_occurrence` only for a user action (`__actionId` present) on a textblock whose import root (walk `parentId` up, max 6 hops, to an occurrence with `meta.importSource`) has `meta.importedAt` within 14 days and `meta.aiCleanedAt` or the rules result as `before`. One correction per textblock per 10 minutes (later edits update it). Never throws into the write path.
- Produces: `examplesFor({ userId, gridId, kind, site, limit = 3 }) -> Promise<[{ before, after }]>` — same kind + site first, then same kind, newest first, each pair trimmed to 1,500 characters.
- Produces: `run.mjs --add-correction <correctionId>` writes a new case directory from a stored correction (source = the import's source, expected = `after`), so a user fix can join the test set by hand.
- Consumes: `cleanupWithOllama({ examples })` (Task 7).

- [ ] **Step 1: Write failing tests:**
  - a user edit to a textblock under a 2-day-old import → one `ImportCorrection` with `before`/`after`.
  - a derived write (no `__actionId`) → none; an import 20 days old → none; a textblock not under an import → none.
  - two edits 2 minutes apart → one record holding the latest `after`.
  - `recordCorrection` throwing inside → `update_occurrence` still saves (control: the write lands).
  - `examplesFor` prefers same site over newer different-site examples.
- [ ] **Step 2: Run** `cd server && node node_modules/.bin/vitest run __tests__/importCorrections.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement**; pass `examplesFor(...)` into `enrichImport`'s `cleanupWithOllama` call.
- [ ] **Step 4: Run** the test file and `__tests__/staleTextSave.test.js __tests__/fieldTimestamps.test.js` (the write path's existing tests) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): user corrections are saved and fed back to Ollama as examples`

---

### Task 9: Deploy and watch it end to end

**Files:**
- Modify: `CLAUDE.md` (dated entry at the top), `server/CLAUDE.md`, `client/src/helpers/CLAUDE.md`

- [ ] **Step 1: Run** both full suites: `cd server && node node_modules/.bin/vitest run` and `cd client && node node_modules/.bin/vitest run` — Expected: PASS (the documented OOM trio aside).
- [ ] **Step 2: Deploy** — commit only this plan's files by path, then `./deploy.sh` only when `git status` shows no other session's files; otherwise move only untracked `_*.sh` aside and ask before deploying. Restart pm2 (server code changed). Install tesseract.js on prod via the deploy's `npm ci`.
- [ ] **Step 3: Watch on test grid 2** (writes allowed there, never poms): share the Gnosis image, an article link and a Wikipedia link through `POST /api/v1/share` with a scratch token; read back out of Mongo: all three under Imports; the image page has 4+ paragraph textblocks, a quote and the picture; the link has a bookmark and a readable page pointing at each other; `node server/eval/imports/run.mjs --check` passes on prod. Delete the probe rows through the app and revoke the token.
- [ ] **Step 4: Record** what was measured (scores before/after per case, Ollama timings, what was not watched) in `CLAUDE.md`, then commit.
