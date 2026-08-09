# client/src/helpers — Helpers CLAUDE.md

_Updated: 2026-08-08. Check this file before re-reading source._
## Recent Changes (2026-08-09 (8) — `link-follow`: the last shape; coverage 24 of 24)
- **`intakeApply.runLinkFollow` + `importLinksIntoFolder`** — one hop, any domain, CONFIRM FIRST.
  The crawl runs, the user ticks a list, and only then does each approved link become a full
  imported page, all filed into ONE new folder under Imports.
- **IT DOES NOT USE THE SHEET'S FOLLOW-UP MECHANISM, and the reason is the sheet's own contract.**
  `IntakeSheet` is pure UI that "never writes at all", and `IntakeSheetHost` CLOSES it before
  running the callback so a slow write is never left sitting under an open sheet. A crawl of an
  arbitrary page is that slow write. So the route opens a separate `ui/ConfirmListHost` — which is
  also what the decision's own note pointed at ("reuse the shape of the `wikipedia_import_batch`
  confirm card"). Side benefit that decided it: a loader threaded into the sheet needs wiring at
  FIVE call sites; a route-driven surface needs one mount in App.
- **"Nowhere to ask" means DO NOT DO IT.** Every other shape falls back to today's behaviour when
  there is no host; here the confirmation IS the feature, so the route refuses and says so.
  Importing twenty pages because a preview iframe had no host is the outcome this shape prevents.
  A/B'd: making it import them all fails exactly that test.
- **SEQUENTIAL, not a volley** — one fetch and one page-build at a time. Parallel would hammer a
  stranger's site and stack N imports on the server to save a wait the toast already narrates per
  page. The test measures concurrency rather than the shape of the code.
- **Homed by `parentId`** — a folder page renders `childrenByParentId`, the constraint that decided
  `files-folder-page`, and `markdownToModuli` sets the import root's parentId from what it is
  handed. One argument does it.
- **Reports the TALLY.** Twelve fetches against twelve sites means partial is the normal case:
  "Imported 9 pages · 3 could not be read". A/B'd both ways (dropped note; all-failed reported as
  a failure, never "imported 0").
- **`linkToPage.harvestLinks` (NEW)** + a private `askServer` both wrappers now share. The
  correlation and the timeout are the two things that are silent when wrong — an uncorrelated
  listener answers to someone else's response (this route has a crawl and N imports in flight), and
  a missing timeout hangs the caller on a server that never replies.
- **`intake.js` gates it out of a doc body AND off a multi-link drop:** it crawls `urls[0]`, so
  offering it for a set would quietly follow one and ignore the rest; and it mints a folder PAGE,
  which a doc lists and cannot render (the gate `FILES_FOLDER_PAGE` and the canvas shapes take).
- **THE CALL SITE HAD THE SAME DEFECT AS THE PASTE HOST.** `dropHandlers`' link branch hardcoded
  `kind: "board"`, so **every doc-body gate was inert for a dropped link** — the identical defect
  found on `IntakePasteHost` the day before. It reports the container's real kind now, and
  `linkCtx` gained the four folder-tree values (`grid`/`manifests`/`folders`/`occurrencesById`)
  the route fails closed without. Both A/B'd: each mutation fails exactly one test.
- Coverage measured from the router's own tables: **24 routed / 24 declared / 0 orphans**, and the
  coverage test now asserts `notImplemented` is EMPTY rather than naming the gap.
## Recent Changes (2026-08-09 (7) — `image-outline`: real Canny, and looking found what tests could not)
- **`imageOutline.js` (NEW, pure + a thin browser half, 14 tests)** — a photo becomes a LINE
  DRAWING. ONE tile that asks colouring-page vs blueprint AFTERWARDS (user: two settings of one
  idea, not two things to pick between before you have decided you want an outline), and **the
  photo STAYS** — "trace only" is about the output image, not about discarding the source.
- **WHY IT IS CANNY AND NOT A THRESHOLD.** Blur → Sobel → keep everything over a cutoff was written
  first and produced **SOLID BLOBS, twice**: a Sobel magnitude is high across the whole SHOULDER of
  an edge, so anything soft merges into filled regions. **Non-maximum suppression** (keep only the
  local peak ALONG the gradient) is what turns a ramp into a line; **hysteresis** is what stops a
  single cutoff either dropping faint contour continuations or admitting every speck of noise.
- **THE LOW THRESHOLD IS A RATIO OF `high`, NOT ITS OWN PERCENTILE — and only LOOKING found it.**
  A percentile rank assumes a broad gradient spread, which a PHOTO has and **LINE ART does not**:
  on a clean ring (one uniform stroke) an independent 68th-percentile cut chopped the contour into
  dashes at arbitrary angles. Measured: **0.24% ink in fragments → 0.97% in continuous arcs** with
  `low = 0.4 * high`, while two real photos moved by almost nothing (2.2→2.4%, 7.9→7.5%). Someone
  drops a screenshot as readily as a photo; only the ratio survives both.
- **The first colouring preset was wrong in a way no metric showed:** σ2.6 / 0.93 / 0.74 produced
  clean lines that **dropped the subject** and came out **dashed**. A broken outline is worse than a
  sparse one — you cannot fill a region whose border has gaps.
- **NOT tuned further against the synthetic ring**, and that restraint is the point: its remaining
  gaps are diagonals where anti-aliasing genuinely halves the gradient, and chasing them barely
  moved the ring (0.97→1.05%) while making both photos twice as busy.
- **Two guards, each from an observed failure:** suppression compares **asymmetrically** (`>` one
  side, `>=` the other) or a constant-gradient PLATEAU passes everywhere and the whole slope inks;
  and **no surviving gradient means trace NOTHING** — a flat image otherwise sets both thresholds to
  0, `mag >= 0` is true for every pixel, and the output is a **solid black rectangle**.
- **The pixel math is pure typed arrays, no canvas** — jsdom has none, and this is the half where
  being wrong is invisible until someone looks. **The canvas half was verified in a REAL BROWSER**
  against a real TRANSPARENT png: 2.2KB image/png, size preserved, **zero transparent pixels and
  zero greys** (the white underlay exists because a transparent source otherwise composites over
  black and comes back framed in garbage), 25-112ms, no page errors.
- **TWO OF MY OWN PROBES PROVED NOTHING FIRST.** A **linear ramp** is degenerate — no crest at all,
  so it says nothing about suppression; a blurred step is what a soft edge actually looks like. And
  a **uniform bar** does not discriminate the low threshold, because an independent percentile keeps
  all of it too — the bar now FADES along its length so its ridge varies 5×, and the mutation then
  fails at 21 of 60 columns. *Verify a mutation is OBSERVABLE, not merely applied.*

## Recent Changes (2026-08-09 (6) — `link-bookmark`: a link becomes a RECORD, and the face must be an artifact)
- **`intakeApply.runLinkBookmark` + `bookmarkFieldIds`** — user's choice over a chip: *"A real
  record with fields."* Title / URL / Notes with the site's favicon as its face — filterable,
  feedable, visible in a dropdown, none of which a textblock chip is.
- **IT MINTS FIRST AND FILLS SECOND.** The title and favicon come from fetching an ARBITRARY HOST —
  seconds, or never. Blocking the mint on that makes the drop look like it did nothing, and a dead
  host would leave nothing at all. The record appears immediately with the URL and a derived label;
  the lookup patches it when it lands. A bookmark with no title is still a bookmark.
- **THE FACE MUST BE AN ARTIFACT OCCURRENCE ID.** `primaryMediaOf` deliberately has **no
  legacy-string fallback**, so a favicon URL written straight into the media field resolves to
  NOTHING — the change would look shipped and be inert. The favicon is minted as a remote-ref image
  artifact and the field holds its id.
- **The favicon is parented to the bookmark AND listed in its `occurrences[]`.** Both halves matter:
  the delete cascade walks the **child LIST** (`collectDescendants`), so a favicon that is only
  parented is ORPHANED the moment the bookmark is deleted. An instance does not render its children,
  so it stays out of the row while appearing in the bookmark's own file spread.
- **Fields resolve by NAME AND TYPE.** Measured on poms grid first: `Title`/`URL` free, `Notes`
  already existing input-enabled and **bound by zero modules**, all 207 media bindings on `Poster`.
  So migration `0061` creates TWO and reuses two, and **the seed CALLS the migration** so a reseeded
  grid and a migrated grid cannot drift.
- **`server/utils/linkPreview.js` (NEW)** — `<title>` plus the best icon a page declares, resolved
  absolute, preferring a real bitmap over a 16px `.ico` and falling back to `/favicon.ico`. Never
  throws for a missing piece; the only failure is "could not reach it". Server-side because it
  fetches a user-supplied URL — same guarded `fetchPageHtml` as `import_url`, which checks EVERY
  redirect hop.
- **TWO A/Bs PROVED NOTHING FIRST, and the fixture was the reason both times:** the same-named decoy
  was listed AFTER the real field (so a name-only match still found the right one), and
  `occurrences: null` is coerced to `[]` by the splice helper (so the mutation was a no-op).

## Recent Changes (2026-08-09 (5) — `image-canvas`, and a LIVE invisible-write bug on the paste path)
- **`image-canvas` is offered ANYWHERE now, not only on a canvas** (user, 2026-08-09). The shape
  MINTS the surface, so requiring one to exist first meant building the thing before you could use
  the shape that builds it. The `onCanvas` gate and the `canDraw` destination field are DELETED —
  nothing read them afterwards.
- **CHECKED BEFORE BUILDING, because the same question decided `files-folder-page` the OTHER way:**
  `PageCanvas` maps over `occurrence.occurrences`, resolves each module and dispatches by ROLE
  (artifact → `ArtifactCard`), positioning by `occ.meta.x/y` with a stacking fallback. So the
  artifacts go in the page's CHILD LIST and their home can stay in Files — unlike the folder page,
  which renders by `parentId` and therefore had to move the files house.
- **The child list is written ACCUMULATED**, not per file: each splice writes the whole array, so a
  stale snapshot per file leaves only the last image on the canvas. Same reason `runFilesContainer`
  and `feedSync` accumulate. A/B'd.
- **Withheld inside a doc body** — a doc renders its TEXTMAP, so a page minted into one is listed
  and invisible, and no caller wires an embed seam for a page. Same gate FILES_CONTAINER takes.
- **A LIVE BUG FOUND WHILE CHECKING THAT GATE: `IntakePasteHost` never reported `"doc"`.** It
  mapped every container to `"board"`, so **every doc-body gate in the classifier was inert on the
  paste path** — FILES_CONTAINER, FILES_FOLDER_PAGE and now the canvas shapes were all being
  offered inside a doc, where each mints something invisible. Fixed: the host resolves the
  destination module and reports `"doc"` when its kind is doc.
- **STILL BROKEN, and recorded rather than hidden:** even with correct gating, `TEXT_TEXTBLOCK` is
  the doc fallback and `createTextblockInContainer` ONLY splices into `occurrences[]` — it does not
  embed. The doc DROP path fixes this with `onLinkChips` (Editor inserts a `moduleEmbed`); the
  PASTE host has no editor to insert into, so **text pasted onto a doc container is still listed
  but not embedded.** Fixing it needs an embed seam the paste host does not have. Filed.
- 8 tests. A/B'd: re-requiring a canvas, dropping the doc gate, and writing the child list per-file
  each fail exactly one. Coverage **20 → 21 of 24**.

## Recent Changes (2026-08-09 (4) — a PDF can be OCR'd now: `pdfPages.js`, every page)
- **`pdfPages.js` (NEW)** — `eachPdfPageImage(file, onPage, { scale, maxPages })` + `isPdfFile`.
  tesseract cannot read a PDF (measured 08-08); pdf.js already rasterises pages for the artifact
  VIEWER, so the missing piece was never the OCR engine — it was turning a page into something the
  engine can see.
- **ONE PAGE AT A TIME, and the callback is AWAITED.** Collecting page images into an array first
  would hold a whole document in memory at OCR resolution, and the caller has to report progress per
  page anyway — an array cannot do that. Each canvas is zeroed before the next is drawn.
- **`PDF_OCR_SCALE = 2.5` is an OCR decision, not a display one.** pdf.js scale 1 is 72 DPI, which
  tesseract reads badly; 2.5 is ~180 DPI. **Do not share the viewer's 1.2** — a human reading a page
  and an OCR engine reading it want different things.
- **`maxPages = 50`, REPORTED not silent.** The user chose every page over first-page-only, so this
  is a floor under a pathological document rather than a policy; it surfaces as
  `note: "first 50 of 120 pages"`, the same contract `splitToChecklistItems` has with its item cap.
- **`runFileOcrText` splits into `readImage` / `readPdf`.** Pages are joined with a BLANK line so
  `textToParagraphs` keeps them apart — a single newline runs the last line of one page into the
  first line of the next (A/B'd; that mutation fails the test).
- **`progressIntake(token, msg)` (NEW)** — updates the running toast by id. This is where it earns
  its keep: one OCR pass PER PAGE means a ten-page scan is minutes, and an indefinite "Reading…" for
  that long is indistinguishable from a hang.
- **`intake.js` offers `FILE_OCR_TEXT` on PDFs again**, alongside `File` — a PDF you only want to
  keep is the common case, and the sheet asks. Non-image non-PDF files still get no OCR tile.
- **pdfjs stays LAZY:** `pdfPages` statically exports `isPdfFile` but `await import("pdfjs-dist")`
  inside. The intake chunk grew 1.5 kB, not 400.
- 7 tests (pdfjs mocked — jsdom has no canvas, and the rasterising is browser work). **A/B'd:**
  first-page-only and single-newline joining each fail one; so does pulling OCR off PDFs.
  **A/B TOOLING TRAP:** one mutation silently did not apply (shell escaping) and the A/B read as
  "the test does not discriminate". Verify the mutation landed before believing an A/B — the same
  rule as checking a probe before believing a failure.

## Recent Changes (2026-08-09 (3) — `files-folder-page`: the files MOVE HOUSE, and that was checked)
- **A folder page renders `childrenByParentId[folderId]`** — the occurrences whose `parentId` IS that
  folder. `childrenByParentId` is built purely from `parentId` (App.jsx), and an uploaded file is
  normally homed under `Files/<kind>`. **So grouping a drop into a folder and leaving the files in
  Files produces an EMPTY page** — the listed-but-not-embedded class for the third time this week.
- **THE FILES ARE THEREFORE HOMED IN THE NEW FOLDER**, via an explicit `parentFolderId` the server
  already honours (`homeFolderForUpload`: *"An EXPLICIT parentFolderId always wins"*). `artifactUpload`
  gained that pass-through; left null it still files under `Files/<kind>`, so every other caller is
  byte-identical.
- **THAT TRADE WAS MEASURED, NOT ASSUMED.** Of 234 artifacts on poms grid: **223 homed in
  `Root/Files/Images`, 5 in `Root/Examples`**, 6 with no parent. A file homed outside Files is
  existing seeded behaviour, not an invariant this breaks. Worth checking because the Files TAB was
  deleted in favour of the folder (2026-08-07 (6)), which makes it look canonical.
- **A board page was the obvious alternative and does NOT work:** `PageBoard` maps
  `visibleList.map(({ container }) => …)` — it renders CONTAINERS, so leaf artifacts as direct
  children of a board page render nothing. Checked before building, not after.
- **`runFilesFolderPage`** — Imports folder → a new per-drop folder inside it → its folder-page
  occurrence → the page spliced into the DESTINATION (home = the folder, placement = where you
  dropped, the same split uploads use) → the files uploaded with `parentFolderId`. Deliberately no
  `onPlaceholders`: that seam wires ids into the destination and would scatter the files beside the
  page, exactly as it would for `runFilesContainer`.
- **The per-drop folder is NOT `meta.protected`** — Imports is structural and the app files things
  there unasked, but this one is the user's to rename or delete.
- **`describeFileSet`** names it "3 images (2026-08-09)". Deliberately dumb, because the user chose
  auto-naming over a prompt — which only works if a wrong-ish name is cheap to fix.
- **Fails CLOSED without the folder tree** and says so; both call sites now pass
  `grid`/`manifests`/`folders`/`occurrencesById` (resolved values, never `state`).
- 7 tests, **A/B'd**: homing the files in Files, rooting the folder outside Imports, and dropping the
  fail-closed guard each fail exactly one. Coverage **19 → 20 of 24**.

## Recent Changes (2026-08-09 (2) — a shape can ask a SECOND question; `link-field-value` lands)
- **`intakeFields.js` (NEW, pure)** — `linkTargetFieldsFor(module, fieldsById)`. Which fields could a
  dropped URL go into?
- **MEASURED ON poms grid FIRST, and it killed the obvious answer.** There is **no url/link field
  TYPE and no link binding ROLE**:
  ```
  types  occurrence 43 · text 42 · number 52 · date 11 · select 14 · boolean 2 · rating 3 · duration 2 · address 1
  roles  input 3497 · display 81 · media 207 · files 192
  name looks url-ish   "Website", "LinkedIn"   (2 of 170)
  actually holds http  "Website"               (1 of 170, 10 rows)
  ```
  So a link field can only be GUESSED — from a name, or from what it happens to hold today. Name
  matching is what produced **10 candidates and 10 FALSE POSITIVES** in the relink work (2026-08-07
  (6)); guessing from contents means an empty field can never be chosen. **The user's own decision
  removes the need to detect anything** (always ask which field): offer the TEXT fields the
  occurrence binds and let them pick.
- **THE LIST IS USABLE, also measured:** of 274 modules binding ≥1 text field, **253 bind exactly
  one**, 9 bind two, 12 bind seventeen — the People rows, which is exactly where asking earns its
  keep (Website / LinkedIn / Email are all plausible). Order is the module's own BINDING order;
  floating a url-ish name to the top would be a recommendation, and the sheet stopped making those.
- **`intake.js` — a shape may carry `followUp: { kind:"choose-one", title, options }`.** Attached to
  a COPY of the shape constant, never the shared constant itself (a test pins that). The follow-up
  is attached even for a single candidate, because "always ask" means always.
- **`IntakeSheet.jsx` — two steps in one surface.** Both render the same tiles and share one
  arrow-key handler, so there is one interaction to get right rather than two that drift. Step 2
  pre-selects nothing either. **Escape from step 2 goes BACK, not cancel** — you answered "what
  should this become", not "which field" — and commits nothing either way. `onPick(shapeId, answer)`.
- **THE REF-CLEARING BUG, worth keeping:** clearing `itemRefs` in an effect keyed on the step WIPES
  the refs that render just assigned — an effect runs AFTER the ref callbacks. It is truncated in the
  render body instead.
- **`runLinkFieldValue`** — writes `{value, flow}` (a bare string reads fine until something looks
  for `.value`) through `updateOccurrence` with `triggerField`, so it is indistinguishable from
  typing the URL in: the same MeasureOp fires and any operation watching that field runs. **REFUSES
  rather than guessing when no answer arrived** — the no-host fallback can reach a route directly,
  and a URL written into the wrong field is silent.
- **`notifyIntake` gained `res.message`** — its success wording was the OCR shapes' ("Read the
  text"), which becomes a lie the moment a non-OCR shape reports through it.
- **TWO CALL-SITE SEAMS, AND THE A/B FOUND THAT ONE WAS UNCOVERED.** `IntakeSheetHost` — what App
  actually mounts — has its own `onPick`, and deleting its second argument left **every test green**
  while the answer was dropped. Same for the drop handler. Both now have tests that fail when the
  argument is removed. **Fourth session running where the call site, not the unit, was the gap.**
- **Probe trap, again:** a mock socket without `connected: true` makes `safeEmit` QUEUE instead of
  emit, which reads exactly like "the route did nothing".
- Coverage **18 → 19 of 24**.

## Recent Changes (2026-08-09 — the intake sheet has NO DEFAULT; `preselected` → `fallback`)
- **User: *"there shouldnt be a default, it should ask everytime what id like to do with it."*** Asked
  about the two text shapes; the answer generalises to the whole sheet.
- **`preselected` IS RENAMED `fallback` EVERYWHERE, and the rename is the point.** The field was
  doing two unrelated jobs under one name: a UI default the sheet focused and highlighted, and the
  thing that runs when there is **no sheet host at all** (a preview iframe, a test harness). Only the
  first was asked for; only the second may survive. Leaving it called `preselected` is how it gets
  quietly wired back into the UI, so the name now says what it is. The contract note lives at the top
  of `intake.js`.
- **`ui/IntakeSheet.jsx`** — focus lands on the **dialog**, not on a tile. **Focusing a tile is not
  neutral: a focused button is activated by Enter, so it IS a default whatever it is called.** Arrow
  keys move into the list from there (first Down → first tile, first Up → last), so the keyboard path
  is intact without one shape being privileged. `tileStyle(isPreselected)` became a flat `tileSt` —
  no selected state, because nothing is selected — and `data-preselected` is gone. Footer now reads
  *"Pick one · ↑↓ to move · Esc to cancel"*.
- **THE NO-HOST FALLBACK STAYS, deliberately**, at all five call sites
  (`if (!opened) applyIntakeShape(classification.fallback, ctx)`). A drop that cannot ask must still
  do something; 2026-08-07 (5) verified that path WRITES rather than the drop vanishing. It is not a
  default in any sense the user sees — nobody is being offered a choice on that path.
- **`filterToImplemented` still re-points it** when the classifier's pick did not survive the filter,
  and that is load-bearing for the same reason it always was: the no-host path would otherwise run an
  unrouted shape and write nothing.
- **The classifier keeps ALL its reasoning** (inDoc → textblock; homeless → doc page; several links →
  container). Removing the user-facing default must not delete it — the fallback still depends on it.
- 3 new sheet tests (nothing focused, nothing visually singled out, the fallback carries no marker),
  **A/B'd**: restoring focus-on-fallback fails 2, restoring the highlight fails 1. ~20 assertions
  across 6 suites renamed, and every test title that claimed a preselection now describes the
  fallback instead — a title that lies is worse than no title.

## Recent Changes (2026-08-08 (7) — intake REPORTS ITSELF; the seam is an override, not a requirement)
- **A CORRECTION TO (6), SHIPPED THE SAME DAY.** (6) fixed the OCR silence by wiring
  `onIntakeResult` at all three call sites — and the three handlers came out **byte-identical**.
  That is the tell that reporting is not caller-specific business at all. Placement genuinely is
  (a doc inserts a `moduleEmbed`, a board splices — that is why `onPlaceholders` exists);
  *announcing an outcome* is not.
- **Worse, wiring three callers fixed one INSTANCE and left the CLASS open:** the fourth caller
  forgets and the silence is back. That is exactly how the original defect happened.
- **`notifyIntake(ctx, res, token)` + `startIntake(ctx, message)` (NEW, module-private).** The
  router reports every intake outcome itself; `onIntakeResult` still exists and still WINS when a
  caller passes one, so it is an override rather than a requirement. Every `onIntakeResult?.(…)`
  inside the routes now goes through `notifyIntake`, and the three duplicated call-site handlers
  are deleted.
- **`startIntake` closes the progress gap (6) recorded as open.** OCR is the only thing intake does
  that takes seconds — lazy-loading a 3.5MB worker — so it is the only thing that announces itself:
  `toast.loading("Reading the image…")` and the finish REPLACES that toast by id rather than
  stacking a second one. A caller that owns reporting owns this too, so `startIntake` returns null
  when `onIntakeResult` is present and nothing double-reports.
- 2 tests, both A/B'd against the state this replaced: reverting to seam-only, and dropping the
  loading toast, each fail the default-reporting test (at different assertions — it is one contract
  test covering both halves).

## Recent Changes (2026-08-08 (6) — the OCR shape was gated to the ONE format OCR cannot read)
- **`file-ocr-text` was offered for `.pdf` AND NOTHING ELSE** (`OCR_EXT = /\.(pdf)$/i`), and
  `helpers/ocr.runOcr` is tesseract.js — **which cannot read a PDF.** Measured directly against a
  generated one-page PDF before writing the route: `Error attempting to read image.` (and in Node it
  surfaces from the worker's error channel, not as a rejected promise). Building the shape as
  specified would have shipped a tile that always fails. **The classifier offers it on IMAGES now**,
  where the runner demonstrably works; a PDF needs a raster step first (pdf.js is already a
  dependency — render page 1 to a canvas), and until that exists not offering it is the honest
  answer.
- **`runFileOcrText` — the same OCR as `IMAGE_OCR_LIST`, the other outcome.** Which one is right is
  a fact about the PHOTO, not the file: a photo of a LIST wants one item per line; a photo of a PAGE
  (receipt, whiteboard, letter) wants the text kept whole, because splitting a paragraph on its
  newlines turns one sentence into six checklist items. The sheet asks instead of guessing.
- **The picture is KEPT**, exactly as the checklist arm keeps it — the photo is the evidence, and
  discarding it once the text is out is the destructive shortcut. Artifact first, OCR after, and the
  local bytes are read rather than the uploaded URL (already in hand; coupling OCR to a network
  round trip makes a slow thing slower and gives it a second unrelated way to fail).
- **`mintTextblockFromText` extracted** so `runTextTextblock` and the OCR arm share ONE textblock
  mint — they differ only in where the text came from, which is not a reason for two
  implementations. Still routed through `createTextblockInContainer` for the destination's filter
  stamp.
- **A LIVE DEFECT THE CALL-SITE CHECK FOUND, in a shape that shipped a day ago: NOTHING passed
  `onIntakeResult`.** Grep across every caller returned zero. So the shipped `IMAGE_OCR_LIST`
  reported **nothing at all** — not a failure, not "read nothing", not success — and OCR is seconds
  long behind a 3.5MB lazy import, so silence is indistinguishable from a drop that did nothing.
  Wired at all three call sites (`dropHandlers` file ctx, `Editor` doc arm, `IntakePasteHost`),
  including `res.note` (lines the split REFUSED, the 100-item cap) which the shape returns
  deliberately and which was being dropped.
- **Reports the PARTIAL outcome honestly:** unreadable text says *"the file was still added"* rather
  than a blanket failure over a successful upload.
- 4 tests, A/B'd: re-gating OCR to PDFs fails the classifier test; splitting the text per line fails
  the prose test. **The first version of that prose test did NOT discriminate** — the mutation I
  A/B'd with was a no-op on the fixture. Fixed by putting a SINGLE newline in the OCR output (a
  wrapped line, which must stay one paragraph); the checklist behaviour then fails it.
- **PROBE TRAP:** `URL.createObjectURL` rejects a `{name,type}` stub, so the first fixture threw in a
  way that read exactly like a broken route. The tests use a real `File`.
- **STILL MISSING, said plainly:** there is no PROGRESS signal. `onIntakeResult` fires at the END, so
  the seconds of OCR are still unnarrated; `runOcr` takes an `onProgress` the intake path does not
  thread. A loading toast wants a `onIntakeStart` seam.

## Recent Changes (2026-08-08 (5) — the two text-tree shapes were the SAME WRITE; coverage 16 → 17 of 24)
- **MEASURED BEFORE WRITING ANYTHING, and the measurement is the whole entry.** `markdownToModuli`
  always returns a `role:"container" kind:"doc"` ROOT (`buildContainer(tree, …, true)`) — the
  importer has never minted a page. The only page wrapper in the text path is
  `createImportsDocPage`, which the drop handler calls for a HOMELESS import so the root is
  reachable at all:
  ```
  destination is a container/page   the tree lands in place, NO page
  no destination (empty cell)       panel + Imports doc page, wrapper
  ```
  So **`text-doc-page` WAS `text-container-tree` in two of three destinations**, and its "wrapped in
  a page" hint was true only for the third. Shipping the second tile as a route to the same write
  would have been a dead tile with a different label on it — worse than the gap it closed.
- **`runTextContainerTree` (NEW)** — the tree in place. Today's outcome, byte-identical, and now the
  PRESELECTED default so Enter still does exactly what it did. **Deliberately does NOT go through
  `onImportText`**: that seam carries the caller's whole text behaviour including the homeless wrap,
  so routing through it would make the two shapes indistinguishable again.
- **`runTextDocPage`** — the tree behind ONE page card you drill into (a page nested in a container
  renders as a representation chip, which is the point: 40 imported sections stop spilling across
  the board). **HOMELESS STAYS THE CALLER'S** — with no destination it still calls `onImportText`,
  because the drop handler is the only layer that knows it just minted a panel to pin to.
- **ORDER MATTERS: the import runs DETACHED (`parentId: null`) and the page is minted only after the
  ack**, so the page is created in one shot already embedding a root id that EXISTS. Minting first
  would leave an empty page behind every time an import failed — a test pins that.
- **It EMBEDS, not just lists.** A doc page renders its TEXTMAP; writing `occurrences: [root]` and
  stopping there is the listed-but-not-embedded failure this repo has repaired twice.
- **`createPageInContainer` is reused rather than re-implemented** — it splices, stamps the
  `dragInView: "representation"` override, and flips the parent's `allowChildContainers`.
  **`containerModule` MUST be passed:** that flip writes the module's WHOLE `meta`, so omitting it
  writes `{allowChildContainers:true}` over every other key. A latent hazard for any caller that
  forgets; the test asserts an unrelated meta key survives, and it fails without the argument.
- **`intake.js` gates `TEXT_CONTAINER_TREE` OUT when there is no destination** — a container root
  with no parent is listed by nobody and embedded in nothing, the same "mints something invisible"
  gate `FILES_CONTAINER` takes inside a doc. Preselection follows the destination: tree in place
  when there is one, page when homeless — i.e. whichever shape reproduces today's outcome. **The
  preselection is the entire back-compat story now that both shapes are real writes.**
- **THE CALL SITES, checked before believing the unit tests** (the trap the last entry recorded):
  `dropHandlers`' text ctx gained `destinationModule` (the clobber above) and `onImportResult` —
  `runImport`'s toast lives inside its own closure, so a shape that bypasses it would have landed in
  SILENCE. `IntakePasteHost` gained both plus a toast; its text path had no failure reporting at all,
  and with no destination it emitted an import whose root nothing referenced — an invisible paste,
  now gated.
- 11 tests across `intake` / `intakeApply` / `linkDropAsks`, **A/B'd**: dropping `containerModule`,
  importing at the destination instead of detached, and ungating the container tree each fail
  exactly one. `linkDropAsks`' preselect test was updated with the reason — same OUTCOME, new id.

## Recent Changes (2026-08-08 (4) — intake: `text-textblock` and `files-container`; coverage 14 → 16 of 24)
- **`intakeApply.runTextTextblock`** — the dropped/pasted text as ONE textblock, unedited. Exported
  pure `textToParagraphs` splits on BLANK LINES only: that is the one transformation that would
  otherwise lose information, while a single newline is a wrapped line, not a new paragraph.
  `kind: "doc"` — `"block"` is a value this app uses nowhere.
- **IT FIXES A LIVE WRONG DEFAULT.** The classifier already preselected `TEXT_TEXTBLOCK` for text
  dropped inside a doc body ("inside a doc the page wrapper has nowhere to go — the words do"), but
  with no route `filterToImplemented` silently re-pointed it at `TEXT_DOC_PAGE`. Pasting a paragraph
  into a doc offered to build a whole page. Same shape as the link-chip preselection bug recorded on
  2026-08-07 (5); the test asserts the preselection now SURVIVES the filter.
- **`intakeApply.runFilesContainer`** — N files become ONE container holding them. The file twin of
  `runLinkContainer`, and the only structural difference from `runArtifacts` is the parent — which
  is exactly why it does **not** call the caller's `onPlaceholders`: that seam wires new ids into
  the DESTINATION, which would scatter the files beside the container instead of inside it. It
  splices into the container it just minted, **accumulating** the child list (each splice writes the
  whole array, so a stale snapshot per file would leave only the last one — the accumulation
  `feedSync` needs, for the same reason).
- **THE CALL SITE IS WHAT WOULD HAVE MADE THIS INERT.** `dropHandlers`' text ctx passed no
  `destinationOccurrence`, `dispatch` or `userId` — the text path only ever emitted an import, so a
  minting route would have bailed silently and the tile would have done nothing. Checked before
  believing the unit tests; the file ctx and both other call sites already carried them.
- **`intake.js` gates `FILES_CONTAINER`/`FILES_FOLDER_PAGE` OUT of a doc body.** A doc renders its
  TEXTMAP, so a container minted into one is listed in `occurrences[]` and invisible — the
  "listed but not embedded" class. The artifact shapes are fine there because the doc arm embeds a
  `moduleEmbed` per file via `onPlaceholders`; **no call site wires the equivalent seam for a
  container**, so offering it would mint something the user cannot see.
- Coverage now **16 implemented / 8 open / 0 orphans**. Still open: `file-ocr-text`,
  `files-folder-page`, `image-canvas`, `image-outline`, `link-bookmark`, `link-field-value`,
  `link-follow`, `text-container-tree`. (`link-page` and `link-container` were already shipped —
  the task list was stale about both.)

## Recent Changes (2026-08-08 (3) — graphOption: the sunburst's label threshold is derived from PIXELS)
- **`graphOption.radialLabelMinAngle` (NEW, pure, 8 tests)** + `NESTED_RADIUS_PCT` / `LABEL_FONT_PX`
  / `LABEL_MIN_ARC_PX`. `buildEChartsOption` takes a 5th arg, the host's measured `boxPx`.
- **A FIXED `minAngle` CANNOT BE RIGHT, which is what both 8 and 1 were.** The emotions wheel's 80
  tertiary leaves are 4.5° each: ~14px of arc on a 390px phone, ~40px on a desktop, ~170px zoomed.
  `minAngle: 8` blanked the whole outer ring (2026-08-06); `minAngle: 1` let 80 labels collide into
  an unreadable mass. Now `deg = minArcPx·360 / (2·π·r)`, with `r` in PIXELS — which is the only
  reason the box has to be threaded in at all, since the series radius is a PERCENT that ECharts
  resolves against `min(w,h)/2`.
- **A `rotate: "radial"` label runs ALONG the radius, so what must fit the arc is its THICKNESS** —
  the font size. Hence `LABEL_MIN_ARC_PX = LABEL_FONT_PX * 1.8`, expressed as a multiple so the two
  cannot drift.
- **It makes ZOOM REVEAL LABELS**, which is the composition a constant could never have: on a phone
  the outer ring is unlabelled at rest and readable the moment you zoom in.
- **Clamped to 30°** so it can never blank the 8 primary slices (45°) — the 2026-08-06 failure as a
  guard. **Returns `null` when the box is unknown** and the caller keeps its old fixed 1, so any
  caller that passes no box renders exactly the previous chart.
- **VERIFIED BY SCREENSHOT, per that task's own standing order** ("a chart is a canvas"). Real
  option → real ECharts → Chromium, four arms at 390px and 1400×900: before = unreadable mass;
  after zoom 1 = clean outer ring with inner rings still labelled; after zoom 2 + PAN = every
  tertiary label readable; desktop = fully labelled, unregressed. **The zoom-4 arm proved nothing
  at first** — a centred zoom pushes the outer ring outside the box entirely, so the panned arm is
  the one that actually demonstrates the claim.

## Recent Changes (2026-08-08 (2) — feedPredicate.js NEW: feeds get OR and nested groups)
- **`feedPredicate.js` (NEW, pure, 13 tests)** — `buildFeedPredicate(feed, { now })` turns a feed's
  conditions into the group tree `evalGroupAgainstRecord` already understands. **That evaluator was
  never the gap** — it has done AND/OR and nesting since 2026-05-03 and finds a sub-group via
  `Array.isArray(entry.rules)`. What was missing was a feed shape that could express one.
  ```
  feed.conditionOperator : "AND" | "OR"        ABSENT MEANS AND
  Entry = { id, fieldId, comparator, value }         // leaf
        | { id, operator, conditions: Entry[] }      // group
  ```
  A group is recognised by carrying `conditions` (so a leaf can never be mistaken for one); the
  OUTPUT uses `rules`, the key the evaluator looks for.
- **Three drop rules, each reproducing the old inline loop in `resolveFeedItems`:** a leaf with no
  `fieldId` is inert (`+ condition` mints exactly that); **a group with no usable children is
  DROPPED — an empty AND evaluates TRUE, so inside an OR it would match EVERYTHING**; past the depth
  cap it degrades to "unconfigured" rather than walking an unbounded tree on the sync path.
- `now` is resolved ONCE for the whole tree — a sync straddling midnight must not evaluate two rows
  against two different "todays".
- **Back-compat proven, not argued:** the real resolver over live data on both code versions gave
  byte-identical row sets for all 77 enabled feeds (208 rows).

## Recent Changes (2026-08-08 — feedTokens.js NEW: a feed condition can say `$today`)
- **`feedTokens.js` (NEW, pure, 11 tests)** — `resolveFeedConditionValue(value, now?)`. A feed
  condition's value reaches `evalRuleAgainstRecord` with an **EMPTY `$vars`**, so `$today` resolved
  to nothing and "before today" was inexpressible on any feed. A literal date is correct for exactly
  one day. Reuses `dueSpan.dayKey` — LOCAL parts, never `toISOString`.
- **The vocabulary is deliberately CLOSED (one token).** Threading the executor's real `$vars` in
  would let any feed condition reach `$allItems` on a path that runs over every occurrence on the
  grid; this is a lookup table instead.
- **FAILS CLOSED.** An unknown token is returned **verbatim**, so it reaches the comparator as an
  unparseable date and `DATE_BEFORE` answers false. Resolving it to `null` instead reads as *"no
  filter set"* downstream and would match **EVERYTHING** — A/B'd, that variant fails its test.
- **Wired in `state/selectors.resolveFeedItems`, NOT `isOccurrenceVisible`** — see state/CLAUDE.md;
  the inherited handoff note named the wrong function and inherited the wrong risk with it.
- **Additive by measurement:** 71 live feed conditions, 0 begin with `$`; A/B over live data gave
  byte-identical row sets for all 77 feeds.

## Recent Changes (2026-08-07 (8) — mainFile / boardOption / convertRelink / checklistFromText / ocr)
- **`mainFile.js` (NEW, 19 tests)** — `main` on the Files field: WHICH attachment is the face.
  `setMainFile` / `attachFile` / `removeFile` / `clearMainFile` / `resolveMainFile`, plus the CLIENT
  TWIN of `placementSemanticForKind` (**keep in sync with `server/utils/filesFolder.js`** — both
  suites assert the same table so either catches drift).
  - **The invariant is `main ∈ value`, enforced HERE because the UI is not the only writer** — a
    drop, a delete and a migration all touch this value. `resolveMainFile` REFUSES a main that is
    not attached rather than returning it, so broken data falls back instead of resolving to a hole.
  - **`setMainFile` ATTACHES a file that is not there yet.** Dropping on the face area means "this
    is the face"; the only two ways to keep the invariant are refuse or attach, and refusing makes
    the gesture silently do nothing.
  - **`attachFile` is the one that is safe to repeat: the FIRST attachment becomes the face, later
    ones never steal it.** Silently replacing a picture the user picked, as a side effect of
    attaching a second file, is what makes a feature untrustworthy.
- **`occurrenceMedia.primaryMediaOf` prefers `main`, falls back to the `role:"media"` binding.**
  ADDITIVE BY MEASUREMENT: 213 occurrences carry a Files value and **zero** carry a main, so every
  lookup falls through today. **The order cannot be reversed** — rows carry BOTH, so preferring the
  binding would make marking a face silently do nothing. A/B'd: reversing fails exactly the
  discriminating test while the 213-row regression still passes.
- **`boardOption.js` (NEW, 12 tests)** — `optionBoardStampFields` / `isOptionBoard`. What makes a
  board an OPTION board is DERIVED, not listed: measured 37 feeds on poms grid, and every option
  board both declares what it collects (feed condition) and carries that value itself, so the BOARD
  OCCURRENCE is the source of truth. **34 of 37 — matching the documented count — with nothing
  knowing "boardCategory".** Refuses a feed whose field the board does NOT hold (that describes a
  VIEW; minting there makes a row the feed cannot see). Stamps the board's OWN value (`["x"]`), not
  the condition's scalar (`"x"`) — the shapes differ and CONTAINS matches both, so the wrong one
  works until something reads the field expecting an array.
- **`convertRelink.js` (NEW, 12 tests)** — after "Convert to page", other chips on the same URL
  become in-app jumps. **This replaced the MIGRATION, which was measured and refused:** 709 chips →
  10 would relink → all 10 false positives (section HEADINGS matched by label); corrected selector →
  1, and it is `Eminem → Eminem`. Title matching is a guess; at convert time both ends are in hand.
  **The self-loop refusal survives** — an article links to itself, and those chips are inside the
  new page (skipped by `occurrences[]` AND `parentId`). `sameLinkTarget` drops the FRAGMENT but
  KEEPS the query (`?page=2` can be a different document).
- **`checklistFromText.js` (NEW, 13 tests)** — text/OCR → one item per line. **`split("\n")` is not
  the feature**: a photo of handwriting returns items AND debris. A series of refusals (bullets in
  four characters, checkbox glyphs, stray marks, single stray characters, a 100 cap), and it
  deliberately does NOT dedupe, merge wrapped lines, or drop the header — **dropping debris is safe,
  rewriting content is not.** `skipped`/`truncated` are RETURNED so the caller can say so.
- **`ocr.js` (NEW)** — `runOcr` extracted from `ArtifactContent` so intake reaches the SAME runner.
  Returns plain text only; what it becomes stays the caller's call, which is what let a second
  caller exist without a second OCR path. **Verified still LAZY** — own chunk, 0 refs from main.
- **`intakeApply.js`** — new routes: `LINK_BOARD_OPTION`, `IMAGE_ATTACH`, `IMAGE_OCR_LIST`,
  `TEXT_CHECKLIST`. **`artifactUpload.uploadArtifactPlaceholders` gained `onUploaded`** — `persist`
  can only patch the ARTIFACT's own occurrence, and attaching writes a reference from somewhere
  ELSE. Fires on success only: a reference to a failed upload is a pointer to a row that does not
  exist.
- **`dropHandlers.handleArtifactDrop` honours `placementSemanticForKind`** — media copies, markdown
  MULTI-PARENTS (textmap lives on the occurrence, so a copy forks the body). The multiparent path is
  idempotent; the copy path deliberately is not (two copies of a photo on one page is legitimate).
  **This is the other half of the placement-delete rule — until it existed nothing created a SECOND
  placement, so the delete distinction could not be exercised end to end.**
- **TWO PROBE TRAPS, both mine, both would have read as "the code does nothing":** `vi.spyOn` on an
  ESM namespace import does not intercept, and a drop fixture fed `dropTarget` when `dropView` reads
  `target` + `state.modulesById` (it reported ZERO emissions). **Assert on the writes that LEAVE.**

## Recent Changes (2026-08-07 (7) — the upload `persist` stops clobbering the file's home)
- **`dropHandlers.js` + `ui/Editor.jsx` — `persist` no longer stamps `parentId`.** The server now
  homes an uploaded artifact in **Files/&lt;kind&gt;** (`homeFolderForUpload`), and `persist` ran
  right after the upload to patch `parentId` back to the drop destination — so **leaving it alone
  would have made the entire Files-folder rule INERT**, the file landing wherever the pointer was,
  exactly as before. That is the 2026-08-01 (16) "my fix was inert" failure, seen coming this time
  instead of after.
- **The split is: `parentId` = the file's HOME (Files); the destination's `occurrences[]` entry =
  its PLACEMENT.** `onPlaceholders` already wrote that entry for all three destination kinds, so
  nothing had to be added — only the overwrite removed. A doc's placement is its `moduleEmbed`,
  which resolves by occurrence id, so it renders either way.
- **Two things FALL OUT of the split rather than needing to be built:**
  - `delete_occurrence`'s cascade only recurses where `child.parentId === id`, so deleting the
    CONTAINER now unlinks the file instead of destroying it — Step 5's "removing a placement leaves
    the file in Files", for free.
  - the filter cascade is untouched: it walks the `occurrences[]` reverse map, **not** `parentId`
    (containers and pages do not even carry one — memory `effective-filter-ancestor-walk`).
- Canvas still persists `meta` — that is where x/y lives; only the parentId stamp went.
- 1958 client tests, build clean (tiptap 435 / highlight 969 / CommandCenter 204 / PagePreview 981).

## Recent Changes (2026-08-07 (6) — protectedFolders.js NEW: the UI must stop OFFERING a refused delete)
- **`protectedFolders.js` (NEW)** — client twin of `server/utils/protectedFolders.js` (**keep in
  sync**, same relationship `alarmOps` has with `makeAlarmOp`). One predicate, `isProtectedFolder`
  = `!!folder?.meta?.protected`, plus the three names. The server owns ENFORCEMENT; this exists so
  the UI can stop offering a delete the server is going to refuse.
- **WHY THAT MATTERS MORE THAN IT LOOKS, and it was already broken for Templates and Files.**
  `ManifestTree`'s folder delete **REPARENTS every child out to the folder's parent BEFORE** it
  emits the delete. `assertNotProtectedFolder` throws inside `delete_folder`, so the refusal left
  the folder alive with its **contents scattered into the root** — persisted, surviving a reload.
  **A protected folder whose delete is still on the menu is worse than one with no protection at
  all:** the guard converts a clean destructive action into a half-applied one. Fixed in both
  halves — the menu item is hidden AND `handleDelete` bails before the reparent loop, because the
  handler is reachable from anywhere the item is rendered.
- **`importsFolder.js`** — mints Imports with `meta: { protected: true }` (user 2026-08-07: *"make
  imports be a protected folder too in root"*) and **self-heals** a folder minted before protection
  existed, so the guard covers every grid without waiting on migration `0050`. The stamp **MERGES**
  `meta` — a folder carries more than this flag (`meta.cover`). The `"Imports"` literal is now the
  shared constant.
- **The marker is `meta.protected`, NEVER the name** — a user may have their own folder called
  Imports and it is theirs to delete (0035's lesson: a selector matching "things that look like
  templates" moved the user's real project page).
- 4 tests in `__tests__/importsFolder.test.js`; **A/B'd against the unprotected source — 3 of the 4
  fail there.** The fourth ("writes nothing when already protected") is an assertion of ABSENCE and
  passes vacuously; its discriminating sibling is the self-heal case. 1958 client tests, build clean.

## Recent Changes (2026-08-07 (5) — intake Task 5: the .md/.csv shapes and the link chip)
- **`csvToTable.js` (NEW, pure, 26 tests)** — a dropped `.csv`/`.tsv` becomes a real
  `kind:"table"` container by being converted to a **markdown pipe table** and sent through the
  existing `import_text` importer. `buildTable` (server) already mints the table from one, so there
  is no second table builder to keep in sync. RFC-4180 parse (quoted fields, embedded delimiters and
  newlines, `""` escapes, BOM), and the delimiter is picked by PARSING with each candidate and
  taking the one that yields a consistent rectangle — counting raw characters mis-reads any file
  whose prose contains commas.
  - **The non-obvious constraint:** `parseBlocks` only recognises a table whose separator line has
    **two** column groups (`(…)+` requires a repetition), so a **single-column CSV cannot be a
    table**. `csvToMarkdownTable` returns `{ok:false, reason:"too-few-columns"}` rather than
    emitting one that would silently import as prose.
  - A quote only OPENS a field at the field START; otherwise a stray `6" pipe` swallows the file.
- **`linkOccurrence.js` (NEW, pure, 11 tests)** — the **client twin of the importer's
  `buildInlineLink`** (`server/services/markdownImporter.js`). Same `meta.link` on BOTH the module
  and the occurrence, same body text — so a dropped link and an imported page's prose link are the
  SAME thing, which is what lets Task 6's relink find both. **Keep the twins in sync** (same
  relationship as `alarmOps` ↔ `makeAlarmOp`).
  - **The non-inline kind is `"doc"`, not `"block"`.** `TextblockCard` switches on
    `kind === "inline"`; `"block"` is a value this app uses nowhere. The first draft invented it —
    it would have rendered fine right up until something read the kind.
  - **It mints NO ids and no parentage**, deliberately: the write goes through
    `CommitHelpers.createTextblockInContainer`, which stamps the destination's filter values. A
    parallel mint path would have produced a link that is invisible to the date filter — the class
    fixed for artifacts one day earlier.
  - `deriveLinkLabel` strips scheme+host BEFORE looking for a path segment. Matching "last segment"
    against the whole URL returns the HOST on a bare domain (`https://www.example.com` →
    "www.example.com"), which reads as a bug. A test caught it.
- **`intakeApply.js`** — three new routes (`FILE_MARKDOWN_IMPORT`, `FILE_CSV_TABLE`, `LINK_CHIP`).
  The two file routes are the only ASYNC ones (they read the file); they own their own emit rather
  than going through the caller's `onImportText` seam, which carries already-resolved text. **Every
  failure reports through `onImportResult`** — an unreadable file, an empty file and a one-column
  CSV all say so, because the shape promised something specific.
- **`CommitHelpers.createTextblockInContainer`** gained optional `meta` / `textmap` so a textblock
  that IS something more specific routes through the one mint path (and its filter stamp).
- **A BEHAVIOUR FLIP, recorded because a test pinned the old state on purpose:** a dropped link now
  pre-selects the **chip** instead of the plain URL-labelled card. `linkDropAsks.test.js` asserted
  the card and its own comment named Task 5 as what changes it — the classifier always preferred
  the chip; `filterToImplemented` was re-pointing it while the chip had no route. The plain card is
  still offered, one keystroke away.
- 1946 client tests, build clean. **Both new suites A/B'd against the unfixed source** — removing
  the routes fails 6, and the link tests fail against the invented `"block"` kind.

## Recent Changes (2026-08-07 (4) — a field write no longer discards the $allItems read model)
- **`operationExecutor.js`** — the enriched `$allItems` collection is cached per sweep and was
  DISCARDED whenever an op touched the occurrence overlay. `UPDATE_ITEM_FIELD` counted, and **a date
  navigation fires ~45 trackers that each write one** — so the collection was rebuilt once per
  tracker, each rebuild re-walking every occurrence's ancestor chain and effective filter.
  **Measured, not guessed: 44 full rebuilds for a single date change** on test grid 2 (7295
  occurrences), via a temporary `window.__aiBuilds` counter (since removed).
- **The insight is narrow and is what makes this safe:** a field write changes a VALUE on an
  occurrence that already exists. It cannot change the set of occurrences, anyone's parentage, or a
  role/kind/label — so the read model stays structurally valid and exactly one entry is stale.
  `patchAllItemsCache` refreshes that entry through the SAME enrichment closure that built it
  (`_allItemsEnrich`, stashed beside the cache with an id→item index). Every other mutating effect
  still discards the whole thing.
- **The entry is mutated IN PLACE, deliberately.** The role slices (`$allInstances`,
  `$allContainers` …) built by earlier pipelines hold those very objects, so replacing the array
  entry would leave the slices pointing at the stale copy — a silent wrong-number bug, not a crash.
  Identity is preserved; only contents move.
- **It fails CLOSED**: no index, an unknown id, or an occurrence missing from the overlay discards
  the cache rather than patching half of it. A stale read model is far worse than a rebuild.
- **Result — two runs each, same probe (`_aiprobe.mjs`), test grid 2:**
  ```
                              before        after
  $allItems rebuilds / nav       44           3
  op sweep (op-timing)        1598ms       1112ms   (existing day)
                              1515ms        964ms   (fresh day build)
  click → settled             1815ms       1342ms   (existing day)
                              1560ms       1229ms   (fresh day build)
  ```
  **~30-36% off a date change, and unlike the signature fix this one moved the WALL CLOCK**, because
  it removed work the user was actually waiting on rather than duplicate writes.
- Tests: 7 in `__tests__/allItemsCachePatch.test.js` pinning the refresh, **object identity** (the
  role-slice staleness trap), stale-key removal, and all three fail-closed paths. The 465-test
  executor + behavioral suites — which assert real tracker VALUES through the real pipeline — are
  the correctness net for the patch itself.

## Recent Changes (2026-08-07 (3) — APPLY_TEMPLATE signs non-root clones in EVERY mode)
- **`operationActions.js` (APPLY_TEMPLATE `clone`)** — the 2026-07-31 auto-signature fallback
  (`auto:<templateOccId>` for an unsigned node) only ran in MERGE mode. **`Day Page: Build` uses
  BOTH branches**: a brand-new column is cloned through the DEFAULT (append) branch via
  `rootParent`, existing columns are topped up through MERGE. So a fresh column's clones carried
  `identitySignature: null`, the very next merge computed `auto:<templateChildId>`, matched nothing,
  and re-cloned the WHOLE unsigned subtree once — **permanently doubling the column**. Measured on a
  date navigation: **128 CREATE_ITEM on the first merge after a fresh build, 0 on every merge after
  that.** Now `(mode === "merge" || !isRoot)`.
- **A NON-merge ROOT is still deliberately left unsigned**, and that exemption is load-bearing: a
  merge root is matched against the TARGET'S SIBLINGS so it has always needed the derived signature,
  but a non-merge root is a standalone subtree the caller placed itself (`rootParent`) — signing it
  would give **every day column built from one template the SAME signature** as a sibling of the
  board. Same reasoning as `gridIntegrity`'s `unsigned-template-node` rule exempting a root.
- **NO MIGRATION, and that was measured rather than assumed.** The fix is shared CLIENT code, so it
  ships with the bundle — there is no stored pipeline to carry. And `checkGrid --all` says poms grid
  holds **no damage of this class**: its one `duplicate-template-section` is the known pre-existing
  `Aug 4 › Journal×2` (two columns that both hold writing — a human call since 2026-08-05), not
  fresh doubling. **Why poms grid escaped:** migrations `0022`/`0023` hand-signed its template
  sections AND their children, so `srcOcc.identitySignature` is truthy there and the fallback never
  applies. The bug only bites UNSIGNED template nodes — i.e. a freshly seeded grid. So this is
  preventive for poms grid and corrective for new seeds.
- **Tests: 4 added to `__tests__/applyTemplateAutoSign.test.js`** (9 total). They drive the real
  TWO-STEP sequence — build via `rootParent`, fold the CREATE_ITEMs back into the world, then merge
  the same template into what was built — because **neither step is wrong on its own; only the
  handoff between them was**, and a single-step test cannot see that. A/B'd against the unfixed
  line: the 2 discriminating cases fail. The other 2 pin the root exemption in BOTH directions, so
  "simplifying" the condition to always-sign fails them too.

## Recent Changes (2026-08-07 — afterPaint.js NEW: the textblock mint is instant)
- **`afterPaint.js` (NEW)** — `afterPaint(fn)` runs work in the first task AFTER a paint (rAF **then**
  a macrotask; a rAF callback alone still runs before that frame's paint). Returns a cancel.
- **Why it exists, measured:** clicking an empty line cost **1121ms**, and an A/B put the blame in a
  place nobody suspected — `editor.view.dispatch(tr)` inserting the block is **10ms**; the other
  1111ms was the app-wide re-render provoked by `createModule` + `createOccurrence`, which *execute*
  in 0.9ms and shared the task. Deferring them past the paint puts the block on screen in ~30ms.
- **`provisionalTextblock.getProvisionalOccurrence` (NEW)** is the other half. Deferring the write
  alone left the block visible but **un-editable for 1223ms** — the original wait, moved. The
  registry now carries the occurrence OBJECT and the node view reads store-then-registry, so the
  block renders from the same object the write will carry and is typeable in the frame it appears.
- **The guard that keeps this honest:** the deferred write re-checks `isProvisionalTextblock` and is
  cancelled on unmount, so a block abandoned inside that window never mints an occurrence nothing
  renders — the create/delete asymmetry this file has been bitten by repeatedly.

## Recent Changes (2026-08-06 (5) — loadDiag.js + stagedMount.js: the load path, measured then staged)
- **`loadDiag.js` (NEW, opt-in `window.__loadDiag`)** — splits the wall clock from `full_state` to a
  usable UI four ways (reducer / React / op sweep / editor mounts). It EXTENDS `onFullState`'s
  existing `markFS` timer rather than adding a second clock. **Its state lives on `window`, not in
  module scope, and that is load-bearing:** rollup emits this helper into more than one chunk, and
  the first version reported **0 editor mounts on a grid with 241 rows** because `Editor.jsx`'s copy
  had never been started. Long tasks report `supported:false` rather than `0` where the entry type
  does not exist (the 2026-08-04 absent-signal trap).
- **What it found** (full table in `docs/superpowers/plans/2026-08-06-staged-loading.md`): the
  reducer is FREE (0.1ms); rendering the content tree is **~1.3s / ~6s throttled** in one unbroken
  task; the op sweep is a third of that and runs AFTER the rows exist. **The docket's assumption
  that the op drain dominated the load is retired.**
- **`stagedMount.js` (NEW)** — releases surfaces to mount their content one per frame, nearest-first
  (active cell on mobile, reading order on desktop). OFF by default; `App.jsx` enables it at
  runtime, so unit tests render content synchronously. Two things are not style:
  - **`requestAnimationFrame(() => setTimeout(pump, 50))`.** A rAF callback runs BEFORE that frame's
    paint, so releasing inside one makes React render content in the frame that was meant to paint
    the chrome — a CDP screencast caught exactly that: **no paint at all between 2.0s and 9.7s**.
    `setTimeout(…, 0)` was still not enough on a saturated thread; it takes a real idle window.
  - **`whenStagedFirstRelease`** — the on-load op sweep waits for the NEAREST panel's content. Run
    the sweep first and the shape sits empty for its whole 3.8s (throttled), pushing first rows from
    8.1s to 11.7s.
- **`bindSocketToStore`'s sweep deferral** moved from a nested rAF to `rAF → setTimeout(…, 50)`
  behind that gate, for the same reason.
- Measured after: first paint **2542 → 199ms** (desktop 1×) and **11966 → 737ms** (390px, 4×), with
  content arriving slightly EARLIER on both. 10 tests across `stagedMount` / `useStagedContent`.

## Recent Changes (2026-08-06 — prefillFromPick.js NEW: a dropdown pick fills the fields it implies)
- **`prefillFromPick.js` (NEW)** — user 2026-08-06: *"if i select that as the ingrediant, it would
  prefill the nutrition on eat … if i select meal, it would fill the ingrediants dropdown with all
  the ingrediants involved and the nutrition."* Config is per-FIELD data
  (`field.meta.prefill = { enabled, map:[{from,to,combine}], chain }`); nothing in the code knows what
  "nutrition" is. `planPrefill` is pure — no React, no writes — and returns the writes a pick implies.
- **THE POLICY, settled with the user, and it is what keeps this small:**
  *(1)* **a pick ALWAYS overwrites** (*"i can overwrite it but it will be overwritten if i make the
  selection again"*) — so there is no provenance to store and the field shape stays `{value, flow}`;
  *(2)* **no visual marker** — a filled value is an ordinary value; *(3)* **only fields the TARGET
  MODULE already binds are filled** — prefill fills what is there, it never changes what a thing IS
  (unlike a drop, which does add bindings).
- **Chaining is recursion over the same function**, using the FILLED field's own config: Meal fills
  Ingredients (`combine: "union"`), and because the Ingredient field already knows how to sum macros,
  one hop further fills them. Configuring Ingredient→macros once therefore serves both a direct
  ingredient pick and a meal that names ingredients. Depth cap (`chain`) + a claimed-field Set, so a
  cycle terminates and a field is written at most once (first/shallowest write wins).
- **Combine reducers SKIP non-numerics rather than coercing to 0** — a text ingredient must not drag
  a protein total down. `sum/avg/min/max/concat/union/replace`; `union` is what fills one dropdown
  from another.
- **`CommitHelpers.updateOccurrence` `triggerField` now accepts an ARRAY.** A pick and its fills are
  ONE socket write (the target is the occurrence being edited), but each changed field still fires
  its own MeasureOp — a tracker subscribes to a FIELD, so a filled Protein has to move the day's
  Protein exactly as a typed one would. A single object behaves byte-identically.
- 21 tests in `__tests__/prefillFromPick.test.js` (+3 in CommitHelpers). A/B-verified: removing the
  binding guard or the non-numeric skip fails them.

## Recent Changes (2026-08-05 (4) — the in-batch overlay was dropping identitySignature)
- **`operationExecutor.js` (`applyEffectsToLiveOccs`, CREATE_ITEM)** — the overlay rebuilt a
  freshly-created occurrence from the effect and carried id/parent/fields/textmap/role/kind/label,
  but **not `identitySignature`**. APPLY_TEMPLATE stamps a signature on every clone (that is what
  merge matches on) and the real CREATE_ITEM handler persists it — so anything that looked a
  just-cloned node up BY SIGNATURE found nothing until the server echo landed, which for a
  same-batch or same-session lookup is never. Found by the behavioral harness: Day Page: Build's
  new Daily-Question pass clones the day and then has to find the question container INSIDE it, and
  it came back empty every time. Same class as the role/kind stamps the branch already carries for
  the same reason.

## Recent Changes (2026-08-05 (3) — provisionalTextblock.js NEW: a textblock that is not on the server yet)
- **`provisionalTextblock.js` (NEW)** — the registry behind click-to-mint textblocks (user
  2026-08-05: "all new lines be textblocks if im on it … if i move away from it with it still
  empty, it disappears"). Clicking an empty line mints the block BEFORE any keystroke, which is
  what removes the first-save lag — the create no longer races the keypress. The cost is that most
  of those blocks are abandoned empty, and **deleting a row the server was only just told about is
  exactly the create/delete asymmetry behind the recurring `dangling-child-ref` class**
  (`create_occurrence` is QUEUED server-side, `delete_occurrence` is not, so the delete can
  overtake the create). So a provisional block is **never emitted**: it lives in local state until
  it earns a row by holding content (`commit`), and abandoning it is a purely local removal
  (`discard`) that cannot race anything. Exports `registerProvisionalTextblock` /
  `isProvisionalTextblock` / `commitProvisionalTextblock` (idempotent — the save path calls it on
  every keystroke) / `discardProvisionalTextblock` / `forgetProvisionalTextblock`,
  `suppressTextblockMint` + `isTextblockMintSuppressed`, `isEmptyTextblockDoc`,
  `hasProvisionalTextblock`.
  - **`suppressTextblockMint` is load-bearing, not polish.** Collapsing a block back to a line
    (backspace in an empty block, the blur-discard) leaves the caret ON that line — which is
    exactly what the caret-entry mint watches for, so without a suppression window backspace
    re-creates the block it just dismissed and becomes a no-op loop. A/B-verified in the browser
    harness: with the window at 0 the block count goes 2 → 2 across a backspace; at 600ms it goes
    2 → 1 and stays.
  - **`isEmptyTextblockDoc` deliberately is NOT "has no characters"** — a doc holding an image, an
    embed or a list item is kept. The vanish rule is about lines the user never used.
  - **`hasProvisionalTextblock`** is what keeps the PARENT doc's textmap from being written while
    it embeds a block with no server row: a tab closed in that window would leave the parent
    embedding an occurrence that never gets created — a permanent "—" line (the 2026-08-01 (19)
    listed-but-not-embedded failure from the other direction).
- **`CommitHelpers.parentFilterFields` is now exported** (was module-private) so the doc mint can
  stamp the day's date on the block it creates, the same way the + menus do since 91e4a807.
- 12 tests in `__tests__/provisionalTextblock.test.js`.

## Recent Changes (2026-07-25 — addNewOption.js NEW: "+ Add new" = select-an-occurrence + field entry)
- **`addNewOption.js` (NEW)** — the "+ Add new" flow for occurrence dropdowns. A field's
  `meta.optionsSource.addNew` is either `{ parentOccurrenceId }` (legacy single) or
  `{ targets: [occId, …] }` (MULTIPLE candidate destinations). Exports:
  `normalizeAddNewTargets`, `targetOptionsForAddNew` (labels resolved from the LIVE occurrence —
  never stored config strings), `collectPredicateFieldIds` (the `fields.<fid>.value` lefts of the
  dropdown's own find predicate), `buildStampFields` (legacy `stampFields` + **the chosen
  parent's own values for those predicate fields, read at run time** — the generic tag mechanism;
  nothing here knows what a "board" is), `createOptionUnderParent` (stamps bound HIDDEN,
  `addNew.fieldIds` bound visible), `promptEntryFields` (one chained question per entry field
  through the EXISTING `operationsBridge.requestUserInput` modal; cancel keeps the occurrence and
  stops the chain). 11 tests in `__tests__/addNewOption.test.js`.
- **`CommitHelpers.createLeafInstanceInParent`** gained optional `fieldBindings` (the add flow
  binds the new option's identity + entry fields on its minted module).
- Consumer + the latent gridId bug: see ui/CLAUDE.md (Field.jsx).

## Recent Changes (2026-07-24 — drag autoscroll: zone/ramp/grace via new autoscrollMath.js)
- **`autoscrollMath.js` (NEW)** — pure math behind DragProvider's continuous drag-over
  autoscroll (user: "slow and finicky", esp. mobile). `autoscrollZone(h)` = quarter-height
  clamped [56, 150] (was a fixed 80px band); `computeAutoscroll(rect, y)` → `{dir, intensity}`
  where intensity runs 0→1 across the zone AND stays 1 past the rect edge; `autoscrollSpeed`
  ramps 6→32 px/frame (was flat 10); `pointerNearRect` (70px grace band);
  `maxScrollTopFor(el)` honors an element-declared `data-scroll-max-top` cap (the mobile grid
  viewport's panel clamp) so the loop never fights a clamped scroller; `canScrollFurther`.
  Tests: `__tests__/autoscrollMath.test.js` (19).
- **`DragProvider.jsx` (`handleDragMove` autoscroll block + `tickAutoscroll`)** — state now
  carries `speed` (re-tuned in place per frame — el/dir changes still own the rAF start/stop).
  The 150ms scan (a) prefers the innermost scrollable that can still MOVE in the pressed
  direction, so an inner list at its end hands the scroll to the scrollable behind it (e.g. the
  mobile viewport over a multicell panel), and (b) on a scan miss keeps the PREVIOUS scrollable
  when the pointer is within the grace band of its rect — the old behavior dead-stopped the
  scroll the moment the finger drifted 1px past the container edge (the "finicky"). New
  `[dragDiag] autoscroll` line on state change under `window.__dragDiag`. Verified headless
  (real drag session, `body.dataset.dragKind` asserted): zone-entry crawl 423px/s, edge sweeps
  the full scroll room, pointer 30px PAST the edge keeps scrolling. NOTE for future probes: a
  Playwright drag whose handle is outside the viewport never starts a session — Chromium's
  text-SELECTION autoscroll then mimics drag autoscroll and poisons the measurement.

## Recent Changes (2026-07-20 — alarmOps: fired alarms drop an instance onto today's Schedule)
- **`alarmOps.js`** — `buildAlarmOperation` gained an optional `sched`
  ({ dateFieldId, timeslotFieldId, scheduleFormatFieldId }), stored on `op.alarm.sched`
  (applyAlarmToOperation preserves it — it spreads `op.alarm` and rebuilds the pipeline).
  New `alarmScheduleSteps` appends, after the NOTIFY, a Schedule-insert like Pomodoro:
  Start: FIND Schedule page → today's day-col → the slot matching the alarm's TIMESLOT
  (`alarmTimeslotLabel`: "17:00"→"5:00pm"; :15 stamps "5:15pm" but skips the slot FIND) →
  de-dupe on the timeslot FIELD → CREATE the alarm instance (date + timeslot stamped,
  both hidden). MUST mirror the server twin `utils/liveSystemBuilders.js makeAlarmOp`.
  `AlarmDropdown` resolves `sched` from `state.grid.meta.scheduleFieldIds` (seed-stamped)
  and passes it into every alarm it mints. The op fires via useScheduler (executePipeline),
  not a transaction trigger; atTimes cadence is Infinite so its CREATE effects apply.

## Recent Changes (2026-07-17 — mobile drag-to-edge nav: diagonal corners + faster dwell)
- **`DragProvider.jsx` (`handleDragMove` edge-nav)** — the X and Y edge tests are now INDEPENDENT
  (were an else-if chain where X always won): a CORNER drag sets both `dCol` and `dRow` → navigates
  DIAGONALLY, the drag-hover equivalent of the diagonal rail buttons (which previously responded to
  press/onClick only, never to a drag hover). `dir.edge` is built from the parts ("up-left" …) so
  the glow indicator lands at the corner (new `.mobile-edge-{up,down}-{left,right}` corner-glow
  rules in `index.css`). `EDGE_DWELL_MS` 1500 → 1150 ("just a little bit" faster per user).

## Recent Changes (2026-07-17 — copy-into-container rubber-band FIXED: server create-push honors the drop index)
- **`CommitHelpers.createOccurrence`** — new `insertAtIndex = null` param, forwarded ON THE EMIT
  ONLY (`{ occurrence: { ...occurrence, insertAtIndex } }`), never on the dispatched/cached
  occurrence (it's not a persisted field — server `occurrenceData` builds by explicit picks, and
  the parent-`$push` reads `occurrence.insertAtIndex` off the raw payload at crud.js:986 →
  `$position`).
- **`LayoutHelpers.copyInstanceToContainer` + `copylinkInstanceToContainer`** — pass
  `insertAtIndex: toIndex` to `createOccurrence`. ROOT CAUSE of "copying an instance to a spot in a
  container with other instances shows it in the right spot then rubber-bands it to the last spot
  the first time": the client optimistically inserts the copy at the drop index
  (`addInstanceToContainer`), but the server's create handler `$push`ed the child WITHOUT a
  position → APPENDED at the end; that end-order surfaced back to the originator (the concurrent
  indexed `update_occurrence` races the create-push's `updatedAt` bump → the update loses / is
  rejected stale, so the appended order wins). Sending `insertAtIndex` makes the server `$position`
  the child at the SAME index the client used, so every ordering path converges on the drop index.
  Tests: 2 in `__tests__/CommitHelpers.test.js` (insertAtIndex on emit-only + clean dispatch; null →
  plain append).

## Recent Changes (2026-07-15 — file-drop: mosaic-grid guard (don't mint panels → no layoutTree corruption))
- **`dropHandlers.js` (`handleFileDrop`)** — `getCellFromPoint` returns a cell even on a MOSAIC
  grid (BSP `meta.layoutTree`), which has no real empty cells, so a gap-drop hit the empty-cell
  drill-down and minted a new panel — GridMosaic's reconcile then split an existing pane to place
  it, corrupting the seeded full-height Viafluere hub into a sliver (prod repro 2026-07-15: a
  dropped `WIN_….mp4` became a 6th panel). Now `isMosaic = !!fileGrid.meta.layoutTree` gates OFF
  the drill-down, and a new bail (`!finalContainerOcc && !canvasPos && !artifactPanel → clearSession
  + return` BEFORE minting placeholders) means a drop with no real home (mosaic gap, panel chrome)
  creates NOTHING — no stray panel, no orphan artifact occurrences. Test in
  `handleFileDrop.multi.test.js` ("on a MOSAIC grid, a gap-drop mints NO panel"). Live Grid
  layoutTree was repaired + the whole DB swept of orphans the same session (server/CLAUDE.md).

## Recent Changes (2026-07-14 (6) — file-drop UNIFIED across every page/artifact type)
- **`artifactUpload.js` (NEW)** — the ONE upload lifecycle for "drop an upload → it becomes an
  instance of the file". `createArtifactPlaceholders(files, {gridId,userId,dispatch,occExtra})`
  mints + locally dispatches a `role:"artifact"` module+occurrence per file (occExtra(i) stamps
  parentId / canvas meta up-front); `uploadArtifactPlaceholders(placeholders, {…,persist})` POSTs
  each to `/api/artifacts/upload` with progress + the batched toast, and — because the optimistic
  occurrence is never emitted and the server mints a BARE occurrence — re-persists placement
  (`persist(p) → {parentId?, meta?}`) once the row exists server-side (canvas x/y + parent).
- **`dropHandlers.js` (`handleFileDrop`)** — now uses the shared core and resolves the destination
  the SAME way on every surface it owns (board/list/table containers, canvas pages, empty cells):
  (1) container under the pointer, (2) a board/table page's first non-doc container (page-gap),
  (3) a canvas page → free-positioned child at the drop point (meta.x/y), (4) an existing
  display/tree artifact panel → swap active view, (5) an EMPTY grid cell → DRILL DOWN (new board
  panel + container + artifact) — the old "open a display-viewer side panel per file" branch is
  DELETED (that was the user's "side view of the file" bug). `viewFieldsForKindClient` + the inline
  upload machinery removed; dead imports (mimeToKind / uploadWithProgress / createModule|Occurrence
  Action) dropped. Doc pages / doc containers / TABLE CELLS never reach here — the doc editor's own
  onDrop owns them (see ui/CLAUDE.md Editor.jsx). Tests: 3 new in `handleFileDrop.multi.test.js`
  (page-gap, canvas, empty-cell drill-down — all assert NO side-view view is minted).

## Recent Changes (2026-07-14 (5) — file drops land WHERE dropped, like a normal instance)
- **`dropHandlers.js` (`handleFileDrop`)** — a file (e.g. a video) dropped INTO a board/page used
  to skip straight to the `else` branch and mint a NEW artifact PANEL with a display view = the
  "side view of the file" the user reported (no instance occurrence created). Root cause: unlike
  `handleModuleDrop`/`handleExternalDrop`, `handleFileDrop` never resolved an in-grid destination —
  it only checked a directly-hovered container, then fell to a standalone panel. Now it resolves
  the drop DESTINATION the same way a normal instance drop does (from `dropView` it pulls
  `containerOccurrenceId` + `dropTarget`):
    1. container under the pointer (precise occ via `containerOccurrenceId`; doc containers skipped
       — the editor owns their embeds),
    2. else the drop's page (`dropTarget.context.pageOccurrenceId`) → its first droppable non-doc
       container (page-gap drop; a canvas page has no container child so this finds nothing),
    3. else an existing display/artifact panel → swap active view (unchanged),
    4. else a truly EMPTY grid cell → a standalone artifact panel (the legit last-resort, unchanged).
  Placeholders now carry `parentId: destContainerOcc.id`. Regression test in
  `__tests__/handleFileDrop.multi.test.js` ("dropped on a board page-gap lands in the page's first
  column, not a new panel"). 1293/1293 client tests, build clean.

## Recent Changes (2026-07-14 — labelTokens.js NEW: [Field] / {Field} label tokens + colon write-back)
- **`labelTokens.js` (NEW)** — live field tokens in occurrence labels:
  - `[Water]` → the bare value ("16"); `{Water}` → name + value + unit ("Water 16oz") — the
    user's "display the field name too" form. Case-insensitive name match; a field the
    occurrence CARRIES wins over duplicate names; unknown brackets/braces stay literal (so
    template tokens like `{ProjectName}` and prose like `[sic]` survive).
  - **Edit write-back**: `materializeLabelTokens` puts the CURRENT value into each token for
    the inline editor (`Drink {Water:16oz}`); `commitLabelTokens` parses the edited value back
    ("14oz" → 14 for number fields, yes/no for booleans, empty → null), returns changed-only
    `writes` + the label with values STRIPPED (stored labels never go stale).
- **`modules/ModuleInstance.jsx`** — display goes through `resolveLabelTokens` (label
  AutoMarquee + RepresentationView chips); `startLabelEdit` materializes tokens into the draft;
  `commitInlineLabel` applies token writes via `CommitHelpers.updateOccurrence` with a
  `triggerField` per write (ops/trackers fire like any field edit) and stores the cleaned label.
  The read-only display sibling of BoundHeader/BoundBody (which bind whole header/body slots
  with linked-sibling sync). 16 tests in `__tests__/labelTokens.test.js`.

## Recent Changes (2026-07-13 — createLeafInstance* fire OccurrenceCreateOp with panel context)
- **`CommitHelpers.js`** — `createLeafInstanceInParent` + `createLeafInstanceAtIndex` (and
  `createChildInContainer` which routes to them) now mint via `createOccurrence({ …, panelId,
  containerLabel })` instead of a raw `dispatch(createOccurrenceAction)` + `create_occurrence`
  emit. The raw path skipped the OccurrenceCreateOp trigger entirely, so items created from the +
  menus / InsertGap never matched the panel-scoped "Schedule: Stamp Date & Time Slot" op — no
  Date/Time Slot stamped → the item failed every tracker's date gate forever (2026-07-13 repro).
  `panelId`/`containerLabel` params added to all three signatures; `InsertGap.jsx` +
  `ModuleContainer.jsx` thread them from the panel/module context (see modules/CLAUDE.md).

## Recent Changes (2026-07-12 LATE — simplify-audit fixes across helpers)
- **`importsFolder.js`** — new `openPanelOnRootFolderPage` (ensure root folder page + mint board
  View + wire panel occurrence — App.addNewPanel and Grid.handleEmptyCellClick both call it now);
  `ensureArtifactPageOcc` owns the artifact ROLE GATE (non-artifacts return null so call sites
  fall through) and mints a REAL View via new `viewFieldsForArtifactKind(kind)` (ModulePage no
  longer synthesizes one).
- **`CommitHelpers.js`** — new `spliceChildIntoParent` (replaces 5 copies of the
  splice-into-occurrences[] block) + `createPagePinnedToPanel` (shared by ManifestTree +
  ModulePanel create-page flows; `activate` flag covers the panel path's view flip).
- **`operationActions.js`** — array CONTAINS/NOT_CONTAINS + ARRAY_INCLUDES/HAS_ANCESTOR share one
  `arrayIncludes` helper (same exact-member semantic, one impl).
- **`operationExecutor.js`** — `_boundFieldIds` arrays cached per TEMPLATE object
  (`boundFieldIdsFor`, WeakMap — template writes swap object identity so entries self-invalidate);
  was ~2500 fresh arrays per op fire in the $allItems enrichment.
- **`dragSystem.js`** — `createPayload` normalizes the dragged occurrence id to a top-level
  `payload.occurrenceId` (serializePayload carries it); DragProvider's shape-probing chain remains
  only as fallback for payloads built outside createPayload (a few NodeView getInitialData sites).
- **`alarmOps.js`** — dead `ALARM_TYPES` export deleted.

## Recent Changes (2026-07-11 — Alarms: alarmOps.js + alarmSound.js + NOTIFY sound/duration)
- **`alarmOps.js` (NEW)** — pure builders for alarm/reminder Operations (the Alarms tab's data
  layer): `buildAlarmOperation` (atTimes schedule + one NOTIFY step, alarms ring/reminders
  silent), `applyAlarmToOperation` (re-derives name/schedule/pipeline from `op.alarm`; resets
  lastFiredAt only on a TIME change), `listAlarmOperations`, `formatAlarmTime` (17:00→"5:00 PM").
  `op.alarm = { type:"alarm"|"reminder", label, time }` marks an op as Alarms-tab-managed; the
  Operations tab renders those READ-ONLY. 6 tests in `__tests__/alarmOps.test.js`.
- **`alarmSound.js` (NEW)** — `ringAlarm({bursts})`: synthesized WebAudio two-tone digital-alarm
  beeps (no audio asset); no-ops when AudioContext is unavailable/suspended.
- **`operationActions.js` (`NOTIFY`)** — cfg gains `sound` (rings via alarmSound) + `duration`
  (toast lifetime); `message` now resolves `$vars` via resolveExpr.
- **`state/useScheduler.js`** — the lastFiredAt stamp is now ALSO dispatched locally
  (updateOperationAction) before the socket emit — the missing half of the "hourly chime fired
  every second" race (local operationsById kept lastFiredAt null until the echo; the 2s in-flight
  guard expired first). E2E-verified: an atTimes alarm fires exactly once in its minute.

## Recent Changes (2026-07-11 — ensureRootFolderPageOcc: shared "open panel on root folder page")
- **`importsFolder.js`** — new `ensureRootFolderPageOcc({ grid, manifestsById, occurrencesById,
  modulesById, dispatch, socket, userId })`: resolve-or-mint the grid's ROOT folder-page
  occurrence. Extracted from Grid.jsx `handleEmptyCellClick` (which now calls it) and ALSO used by
  App.jsx `addNewPanel` (the Toolbar + button) — a fresh panel now opens on the root folder page
  (view + occurrences wired) instead of a dead "No content" shell. Depends on the server ensuring
  a user manifest per grid (server/utils/userManifest.js, same session).

## Recent Changes (2026-07-11 — addImageArtifactFromUrl: URL-picked images without an upload)
- **`CommitHelpers.js`** — new `addImageArtifactFromUrl({ dispatch, socket, gridId, userId,
  containerOccurrence, url, label?, index? })`: synchronously mints a `role:"artifact" kind:"image"`
  module with `fileRef: url` + `meta.external: true` (the importer's remote-image shape —
  `resolveFileRef` passes absolute URLs through) and an occurrence spliced into the container.
  `createChildInContainer`'s artifact branch routes `url` here BEFORE the file-upload path (its
  signature gained `url = null`). Consumed by QuickAddMenu's new "Image" tile + InsertGap.
  Tests in `__tests__/CommitHelpers.test.js` (2).

## Recent Changes (2026-07-11 — _boundFieldIds enrichment + ARRAY_NOT_INCLUDES + loop run-log cap)
- **`operationExecutor.js`** — every `$allItems` entry now carries `_boundFieldIds` (the template's
  `fieldBindings[].fieldId` list) so rules can introspect "does this item even HAVE field X" vs
  "the value is empty". Consumed by the 2026-07-11 completion-gate policy (server builders): an
  item that never bound Completed counts on scope membership alone; bound-but-unchecked does NOT.
- **`operationActions.js`** — `ARRAY_NOT_INCLUDES` comparator (exact-match array negation, shares
  the `NOT_HAS_ANCESTOR` case).
- **`operationExecutor.js` (PERF/OOM root cause)** — loops now cap per-iteration run-log entries at
  `LOOP_LOG_ITER_CAP = 50`: past the cap, one `loop_truncated` marker is written and the logger is
  MUTED for the rest of the loop (executeSteps re-reads mute per body entry, so the
  snapshotVars/resolveGroupForLog computation is skipped too, not just the pushes; makeLogger.add
  also guards). WHY: loop_iter + a fully-resolved if-snapshot per item × ~2500 items × loops × ops
  × 25 retained runs/op = gigabytes (behavioral suite OOM'd 8GB) and ~2-3s per fire. Measured:
  onLoad sweep 6.5s→1.2s, add-fire ~2.8s→0.8s, heap after 16 fires 5GB→1.2GB. FIND candidate
  breakdowns remain uncapped (2026-05-06 decision). This was the biggest "op drain" docket lever
  found so far.

## Recent Changes (2026-07-07 LATE-2 — feedSync.js NEW: the occurrence-feed engine)
- **`feedSync.js` (NEW)** — materializes `occurrence.feed` pull-queries as copy-linked children
  (replaces Table: Build / Canvas: Build ops). Scan-based self-healing diff on
  `meta.feedSourceId`+parentId; mints via `copylinkInstanceToContainer` (new `dragMode` +
  `fireTrigger` params); sweeps/re-links; ACCUMULATES the parent ref across writes (stale per-mint
  reads = child-list clobber, caught headless). Scheduled debounced from bindSocketToStore.
- **`CommitHelpers.js`** — `createOccurrence` + `removeOccurrence` gained `fireTrigger=true`
  (false = derived data: no op fire, `operationsBridge.markDerivedOcc` suppresses the echo).
- **`LayoutHelpers.js`** — `copylinkInstanceToContainer` passes through `dragMode` (stamped on the
  minted occurrence) + `fireTrigger`.


## Recent Changes (2026-07-07 LATE — delete recount fix + opResultSummary + drag toast page context)
- **`operationExecutor.js`** — `$trigger.occurrence` enrichment now falls back to
  `transaction._occurrenceSnapshot` when the occurrence is gone from state (deletes); `_ancestors`
  from `transaction._ancestorIds` in that case. `applyEffectsToLiveOccs` is exported (behavioral
  test harness). WHY: deletes used to re-inject the snapshot into the whole executor overlay via
  `occurrencesOverride` → tracker recounts still counted the deleted item → deleting a completed
  task never decremented Tasks Completed. Snapshot is TRIGGER CONTEXT only now.
- **`CommitHelpers.js`** — `deleteOccurrence`/`removeOccurrence` stamp `_occurrenceSnapshot` on the
  OccurrenceDeleteOp instead of passing `occurrencesOverride` (plumbing removed in
  bindSocketToStore too).
- **`opResultSummary.js` (NEW)** — `summarizeOpResults(results, {fieldsById, occurrencesById,
  modulesById})` names every op effect for the notification pills (field writes with values,
  creates/deletes/moves by label, all other effect types by name; >12 segments → "+N more");
  `makeOpNotificationCallbacks(push, getCtx)` shared by all three runMatchingOperations sites
  (full_state, generic fire, dropHandlers move — the last previously passed NO callbacks: silent
  successes AND failures). 12 tests.
- **`dropHandlers.js`** — `_destName` prefixes drag toasts with the nearest page-role ancestor
  ("Schedule › 1:00am"); doc-embed drag-outs (canvas + list branches) toast Moved/Copied.


## Recent Changes (2026-07-07 — optionsResolver: ancestor-scoped dropdowns fixed (2 latent bugs))
Root cause of "No occurrences available" in the Account (and every other ancestor-scoped)
occurrence dropdown — found while verifying the ImagePickerMenu e2e:
- **`operationActions.js` (`resolveRecordPath`)** — now also strips a `$record.` prefix (alongside
  the existing `$item.` strip). Seeded optionsSource find predicates carry lefts like
  `$record._ancestors`; unstripped, the path walked `record["$record"]` → null → rule failed.
- **`optionsResolver.js` (`buildCollection`)** — records are now enriched with
  `_ancestors` (via `buildParentMap` from dragHitTesting + parentId fallback, cycle-guarded),
  mirroring the executor's $allItems enrichment. Previously `HAS_ANCESTOR` predicates evaluated
  against `undefined` → every ancestor-scoped optionsSource silently resolved to zero options.
- 3 regression tests in `__tests__/optionsResolver.test.js` (ancestor via parentId AND via parent
  `occurrences[]`, exclusion, bare-path equivalence). 31/31 in suite; 1162/1162 client-wide.


## Recent Changes (2026-07-07 — renderProbe: render-cause attribution (gated))
- **`renderProbe.js`** — `useRenderAttribution(kind, inputs, tag)` + `snapshotAttrs`/`diffAttrs`,
  active only under `window.__RENDER_ATTR === true`: per render, diffs the captured props/selector
  outputs against the previous render and buckets by changed-key set (unchanged → `(none) @tag
  #250ms-bin`). This is what attributed the drop frame-1 flush (see client/src/CLAUDE.md docket).
- **`DragProvider.jsx`** — the `_diag` rAF#2 block additionally logs `[drop-attr]` rows (top
  buckets per kind) when `__RENDER_ATTR` is set; snapshots taken next to `_renders0`.

## Recent Changes (2026-07-06 LATE — dragSystem: getDocTouchDropZone (nested doc-container delegation))
- **`dragSystem.js`** — `getDocTouchDropZone(el) → { el, fn } | null` extracted from
  `getDocTouchDrop` (which is now a thin `.fn` wrapper). Same ancestor climb, but callers can
  tell WHICH `.doc-editor` matched: the page editor's `handleDocDrop` delegates a drop to the
  zone under the point when `zone.el !== el` (nested doc-container editors now register
  delegate-only zones — see ui/CLAUDE.md). DragProvider's touch routing is unchanged and now
  resolves nested container zones automatically. 4 new tests in
  `__tests__/docTouchDropZone.test.js` (climb past unregistered sub-editors, innermost-registered
  wins, null when none, fallback after unregister).

## Recent Changes (2026-07-06 — mouse drags on touch-primary devices (any-pointer:fine))
- **`dragSystem.js` `useDragDrop` touch branch** — a tablet with a mouse/trackpad reports
  `pointer:coarse` (primary) AND `any-pointer:fine`; previously the touch branch never registered
  Pragmatic `draggable()`, so a mouse could not drag at all. Now, when `any-pointer:fine` matches,
  the desktop `draggable()` is registered alongside the touch listeners (live-ref payload, native
  ghost with label+verb). A capture-phase `dragstart` guard cancels native HTML5 drags initiated by
  TOUCH/PEN input (tracked via a capture-phase `pointerdown` pointerType sniff) — Android can start
  a native drag from a long-press, which is exactly the OS-intercept path the touch system bypasses.
  Cleanup removes both capture listeners + the draggable. Unit-tested (registration under
  coarse+fine matchMedia mock); finger drags verified unaffected headlessly. **If the Android
  long-press guard proves insufficient on the real tablet (native ghost still appears), revert this
  task's commit only — it's isolated by design.** Playwright's touch emulation reports
  `any-pointer:fine` = false, so the mouse path can't be exercised headlessly.

## Recent Changes (2026-07-06 — touch drag pill shows the action verb (Move/Copy/Copy-link))
- **`dragSystem.js` `_createDragPill(label, mode)`** — second arg is now the drag mode (was the drag
  type, only used as a label fallback). The pill renders two lines: label on top, the action verb
  (Move / Copy / Copy-link) underneath in 9px muted text — parity with the desktop native ghost
  (`attachDragPreview`). The touch threshold-cross block computes `mode` BEFORE the clone and passes
  it in. Verified headless (touch emulation): a copy-mode item's pill reads label + "Copy".

## Recent Changes (2026-07-06 — dragSystem live-ref payloads: no JSON.stringify deps, no re-registration on occurrence writes)
- **`dragSystem.js` `useDroppable` + `useDragDrop`** — the registration effects' dep arrays no longer
  contain `JSON.stringify(data/context/accepts/allowedEdges)`. `ModuleInstance` passes
  `data: { ...module, occurrence }` (occurrence includes `fields` and, for textblocks, full TipTap
  `textmap`) — so every render of ~580 mounted components stringified KBs, and ANY occurrence write
  (incl. the whole post-drop op cascade) tore down + re-registered Pragmatic adapters AND touch
  listeners. Now: `data`/`context`/`accepts`/`allowedEdges` live in refs read at EVENT time
  (`buildPayload()` at drag start / `getData` at hit time); deps are
  `[type, id, disabled(, nativeEnabled), acceptsKey, edgesKey, dragCtx(, handleNode)]` where
  `acceptsKey = accepts.join("|")` (content-keyed, so real accepts changes still re-register).
- **Touch registry shape changed** — `_registerDrop` entries carry `contextRef`/`acceptsRef`/`edgesRef`
  (live) instead of frozen `context`/`accepts`/`allowedEdges`; `_findDropTarget` + the touch
  `onMove`/`onEnd` read `.current` at event time. The touch payload is built at threshold-cross (not
  at effect registration), so a drop always carries the freshest occurrence data. Registry is private
  to dragSystem.js — no external consumers of the old shape.
- **Tests** — new `__tests__/dragSystemRegistration.test.jsx` (4): no re-register on data/context
  identity churn, `getInitialData` reads latest data/context, re-register on real accepts change,
  droppable getData reads live context. Verified headless (touch emulation vs the live grid):
  long-press pill shows the live label, hover highlights the target container via the ref-based
  registry, cancel cleans up.

## Recent Changes (2026-07-06 — member-card scan shared (dragHitTesting ↔ DragProvider) + 150ms cache)
- **`dragHitTesting.js`** — new export `collectMemberCards(containerEl) → Element[]`: the direct
  member cards of a container (leaf `.instance-wrap` rows + nested `[data-container-id]` shells
  whose owner is `containerEl`). `computeInsertIndexFromPointer` now consumes it — the identical
  inline scan it carried was a DRY violation with DragProvider's. 2 new jsdom tests.
- **`DragProvider.jsx`** — `showDropIndicators` no longer re-runs `querySelectorAll` + a
  `closest()` filter walk per rAF frame while hovering a container: new module-level
  `memberCardsCached(containerEl)` reuses the card LIST for 150ms while the hover stays on the
  same container (rects are still read fresh each frame; drops re-resolve via
  `computeInsertIndexFromPointer` at drop time, so staleness can't misplace a drop).
  `hideDropIndicators` invalidates the cache so a new drag starts fresh.

## Recent Changes (2026-07-06 — drop stopwatch + detectSideHost bail + handleDocDrop DLOG all gated behind __dragPerf/__dragDiag)
- **`DragProvider.jsx` (`handleDrop`)** — drop performance stopwatch + render-diff logging now gated
  behind `window.__dragPerf === true`. Three changes: (1) `_dropT0 = _diag ? performance.now() : 0`;
  (2) `_lap` becomes a no-op function when flag is off; (3) `_renders0` and the trailing
  `requestAnimationFrame` pair measuring paint cost wrapped in `if (_diag)`. When flag is false,
  all stopwatch branches are dead code (no I/O). When true, behavior is byte-identical to before.
- **`Editor.jsx` (`detectSideHost`)** — `bail` function now checks `window.__dragDiag === true` before
  logging "[detectSideHost] null —" diagnostic. Wrapped the console.log in the gate; function
  signature and return value unchanged. When flag is false, bail logs nothing. When true,
  behavior identical to before.
- **`Editor.jsx` (`handleDocDrop`)** — `DLOG` helper function now checks `window.__dragDiag === true`
  before calling console.log for any "[DROP ed=...]" diagnostic. The 21 `DLOG(...)` call sites
  remain unchanged (gate is inside the helper). When flag is false, all calls are no-ops. When
  true, behavior identical to before.

## Recent Changes (2026-07-02 — drag-start lag: DragContext split into stable handlers + reactive DragStateContext)
- **Why:** tablet perf probe showed drag-START lag. Two compounding costs at drag start:
  (1) the old DragContext value changed identity at drag start/end, so every
  `useDroppable`/`useDragDrop` hook (hundreds) re-rendered AND tore down / re-registered its
  Pragmatic DnD targets + touch listeners (`dragCtx` is in the registration effect's deps);
  (2) reactive `disabled:` props on hot components (387 containers / 193 instances) flipped at
  drag start, forcing the same re-registration even with a stable context.
- **`dragSystem.js`** — `DragContext` is now identity-STABLE (handlers/getters only; value built
  ONCE in DragProvider via `useState(() => ...)`, delegating to the latest callbacks through
  `apiRef`). New `DragStateContext` + `useDragStateContext()` carries the reactive state
  (`activePayload/activeType/activeId/isDragging/dragMode/isCopyMode/isMoveMode/isCopylinkMode/`
  `isPanelDrag/isPageDrag/isContainerDrag/isInstanceDrag/isExternalDrag`) — subscribe ONLY where
  render output needs it (GridCell, ModulePanel). `getActiveType()` on the stable context gives
  non-reactive render-time reads (safe where a local `isOver` already re-rendered the component).
- **`DragProvider.jsx`** — the pre-insertion "draft preview" system is GONE (deepClonePanels/
  deepCloneContainers/cloneOccurrencesForDraft, previewMoveInstance/previewMoveContainer, and the
  two big preview blocks in `handleDragMove`) — it deep-cloned panels/containers at drag start
  (the drag-start pause) and occurrences lazily. Drop indicators (direct-DOM) remain the preview.
  At drag start `document.body.dataset.dragType/dragKind` are stamped (kind = panel|container|
  page|leaf) so CSS can gate hot-path behavior with zero re-renders; cleared in `clearSession`.
- **Consumers migrated 2026-07-02** (prior session did Grid.jsx then hit its limit): ModulePanel →
  `useDragStateContext`; ModuleContainer/ModuleInstance → NO subscription (dropped their reactive
  `disabled:` flags — redundant with `accepts` filtering — and use `getActiveType()` / the new
  `body[data-drag-kind="panel"] .container-shell{pointer-events:none}` CSS rule in index.css).

## Recent Changes (2026-06-16 — DragProvider: bail on ANY drop over a `.doc-editor` (fixes wrap re-morph "page resets"))
- **`DragProvider.jsx` (`handleDrop`)** — added an early guard: `if (document.elementFromPoint(x,y)?.closest(".doc-editor")) { s.dropHandled=true; clearSession(); return; }`. The doc Editor's OWN Pragmatic drop target already owns drops landing in a doc editor (re-morph a wrap top↔middle, reorder/insert an embed, form a wrap-beside column). The monitor fired for the SAME drop and ALSO routed it as an occurrence MOVE → embed re-parented + ops re-fired = "the page resets / the block doesn't move." The pre-existing narrow guard only skipped a doc-CONTAINER hover (missed a `role:"textblock"` wrap host). This broad element-at-point check covers all doc hosts. Build clean, 1113 tests.

## Recent Changes (2026-06-12 — wrapGroupOps: host is now the LAST child (block-wrap redesign))
- **`wrapGroupOps.js`** — the `wrapGroup` child convention flipped to NEIGHBOR-first / HOST-
  last (a CSS float only wraps content after it; see docs/CLAUDE.md + the redesign spec).
  `findGroupMember` now reports `hostOccId = node.lastChild` + `neighborCount`; new
  `isNeighborMember(group)` (memberIndex < last). `unwrapGroupAt` / `detachGroupMember` lost
  their `{occurrencesById,dispatch,socket}` args — there's no host `wrapSpacer` to strip
  anymore (the real-float model carries no ghost node); they just collapse/flatten the group.
  Callers updated: `docs/ModuleEmbedNode.jsx`, `ui/Editor.jsx`.

## Recent Changes (2026-06-12 — importsFolder: shouldWrapImportOutput guards against dry-run "empty embed")
- **`importsFolder.js`** — new `shouldWrapImportOutput(output)` →
  `!!output && !output.dryRun && !!output.rootOccurrenceId`. The drawer used to wrap ANY
  import result that carried a `rootOccurrenceId` into a persisted Imports doc page — but a
  DRY RUN returns a PLANNED root while persisting nothing, so the wrap left a page whose embed
  pointed at a never-created occurrence (the "empty embed" the user reported). Consumed by
  `ui/AssistantDrawer.jsx` (single-import branch); a dry run now shows a "(planned only)" note
  instead of wrapping. Server also nulls the dry-run root at the source (server/CLAUDE.md).
  3 new cases in `__tests__/importsFolder.test.js` (9/9 pass). Build clean.

## Recent Changes (2026-06-11 — wrapGroupOps.js NEW: shared doc-editor wrapGroup ops)
- **`wrapGroupOps.js` (NEW)** — one source of truth for mutating the doc `wrapGroup` (the
  two-column frame whose bigger column morphs into an L/C/J):
  - `findGroupMember(doc, occId)` → `{ groupPos, groupNode, hostOccId, memberIndex }` |
    null (memberIndex 0 = morphing host, ≥1 = neighbor in the notch). Top-level scan,
    descends one level into each wrapGroup.
  - `unwrapGroupAt(editor, groupPos, {occurrencesById,dispatch,socket,commit})` — collapse a
    group back to host + neighbors inline; strips the host's floated `wrapSpacer` (un-morph).
  - `detachGroupMember(editor, groupPos, occId, {…})` — remove ONE member (cross-container
    drag-out via `embedDeleteRegistry`); keeps the group valid (host + remaining neighbors
    stays grouped; only-host left → flatten) and un-morphs when nothing's left to wrap.
  Consumed by `docs/ModuleEmbedNode.jsx` (registry delete + radial Unwrap) and `ui/Editor.jsx`
  (drop reposition / unwrap-on-move-out). Replaces the deleted `WrapGroupNode` `⠿` grip — the
  neighbor is now moved with its normal radial drag handle.

## Recent Changes (2026-06-09 — MULTIPLY_VAR accepts `by` (real canvas fan-out root cause))
- **`operationActions.js` (`MULTIPLY_VAR`)** — was `expr`-ONLY
  (`Number(resolveExpr(cfg.expr)) ?? 1`), but `INCREMENT_VAR`/`DIV_VAR` use `cfg.by`.
  The `Canvas: Build` op multiplies the grid cursor with `{ MULTIPLY_VAR $x by:240 }`,
  so `resolveExpr(undefined)` → `NaN`, `$x = 0*NaN = NaN`, then `ADD literal:1760`
  reset it to **1760 for every card** (same for y→1850). THAT — not the cursor
  logic — is why every canvas card piled at (1760,1850) and nothing fanned out or
  showed its edges. Now `Number(resolveExpr(cfg.by ?? cfg.expr)) || Number(cfg.by)
  || 1` (mirrors INCREMENT_VAR). Client-only fix — the already-seeded op's `by:240`
  now works; the existing piled cards re-fan on the next reseed (they're not
  re-minted on a plain reload, so a reseed/clear is needed to drop them). Regression:
  `__tests__/operationExecutor.test.js` ("MULTIPLY_VAR accepts `by`…"), 184 pass.

## Recent Changes (2026-06-09 — bspTree.js: BSP "mosaic" layout math)
- **`bspTree.js` (NEW)** — pure, immutable split-tree helpers for the opt-in mosaic
  panel layout (`grid.meta.layoutTree`; rendered by `modules/GridMosaic.jsx`):
  `deriveTreeFromPlacements(panels)` (column-major build from rows×cols placement),
  `computeLayout(tree, rect)` (→ pane rects + splitter bars with axisExtentPx/
  ratioTotal for pixel→fr drag conversion), `resizeSplit` (conserves pair sum,
  clamps ≥5%), `splitLeaf` (flatten-vs-wrap), `removeLeaf` (collapse single-child
  splits), `allPanelOccIds` / `findLeaf` / `makeLeaf` / `makeSplit` / `isLeaf`.
  Node shapes: `Leaf{id,panelOccId}`, `Split{id,dir:"v"|"h",ratio[],children[]}`
  (dir "v"=vertical bar=columns L→R, "h"=horizontal bar=rows T→B). 17 tests in
  `__tests__/bspTree.test.js`.
- **`dropHandlers.js` (`handlePanelDrop`)** — early-returns when
  `state.grid.meta.layoutTree` is set: a mosaic grid has no (row,col) cells, so
  panel rearrange is handled by GridMosaic's own per-pane drop targets
  (drop-to-split). Prevents the cell-based mover from fighting the mosaic DnD.

## Recent Changes (2026-06-09 — Imports folder now surfaces as a CARD + folder-page occ)
- **`importsFolder.js`** — root cause of "import doesn't land in any folder" / "root
  folder page only shows Interfaces": `ensureImportsFolder` created only a bare
  **Folder record**, but `PageFolder` (the folder-page card grid) lists a sub-folder
  ONLY when it finds a `role:"page" kind:"folder"` occurrence among that folder's
  children (`ModulePage.folderChildOccs`). A bare folder shows in the TREE but is
  invisible on the root folder page. Fix:
  - New `ensureFolderPageOcc({ folderId, label, gridId, occurrencesById, ... })` —
    find-or-create the folder-page occurrence (idempotent via a `meta.folderPage:true`
    self-tag). Mirrors `ManifestTree.openFolderAsPage`.
  - New `ensureImportsFolderAndPage(...) → { folderId, folderPageOccId }` does both
    (folder + its folder-page occ). `ensureImportsFolder(args)` is now a thin wrapper
    returning just `folderId` (back-compat — `createImportsDocPage`'s parent, etc.).
  - `createImportsDocPage` + `dropHandlers.handleExternalDrop` now thread
    `occurrencesById` so every import path mints the folder card.
- Consumers: `AssistantDrawer` batch path uses `ensureImportsFolderAndPage` and
  appends a `panel_pick` for the Imports folder page (the where-to-open prompt the
  batch path was missing). 6 tests in `__tests__/importsFolder.test.js`. Build clean.

## Recent Changes (2026-06-08 — imported content lands in an "Imports" folder)
- **`importsFolder.js` (NEW)** — shared helpers so imports show up grouped in the
  Local/Root tree instead of as loose root pages:
  - `ensureImportsFolder({ grid, manifests, folders, dispatch, socket, userId })`
    finds-or-creates an "Imports" folder under the grid manifest's root folder
    (`manifests`/`folders` are plain arrays — callers pass the reducer's
    `state.manifests`/`state.folders` OR `Object.values` of the `*ById` maps).
  - `createImportsDocPage({ rootOccId, panelOccurrenceId, ..., folderId? })` wraps
    an already-created root occurrence in a `role:"page" kind:"doc"` page (textmap =
    one `moduleEmbed` of the root), parents it under the Imports folder, and pins
    it to the panel (omit `panelOccurrenceId` to skip pinning → shows in the Root
    tree's Imports folder only). Pass `folderId` to reuse a pre-ensured folder
    across a batch (the `wikipedia_import_batch` flow ensures once, then loops).
    Returns the page occ id.
- **`dropHandlers.js` (`handleExternalDrop`)** — the empty-grid-cell import case
  (Mode 3) no longer mints a throwaway panel+container. It mints just a board
  panel at the cell, imports the root DETACHED (`parentId: null`), then on
  `import_text_result` calls `createImportsDocPage` to re-home the root under
  "Imports" pinned to that panel (`dest.wrapPanelOccId`). Container/page drops
  (Modes 1/2) keep drop-where-you-point. The assistant path uses the same helper
  (see ui/CLAUDE.md). 4 tests in `__tests__/importsFolder.test.js`.

## Recent Changes (2026-06-08 — createLeafInstanceAtIndex for the insert-here gap)
- **`CommitHelpers.js`** — new `createLeafInstanceAtIndex({ dispatch, socket,
  gridId, userId, parentOccurrence, index, existingModuleId?, role?, kind?,
  label?, initialFields?, fieldIds? })`. Mirrors `createLeafInstanceInParent`
  but: (a) **splices** the new occurrence id into `parentOccurrence.occurrences[]`
  at `index` (append when null/out-of-range) instead of always appending;
  (b) reuses `existingModuleId` when provided (a fresh placement of a picked
  module — no new template) else mints a `role:"instance"` module; (c) binds
  `fieldIds` as `fieldBindings` on a newly-minted module. Fully synchronous (occ
  id known up-front → no splice race). Powers `ui/InsertGap.jsx`.

## Recent Changes (2026-06-06 — op-writable occurrence.label override + relative-date label vars)
- **`operationExecutor.js`** — two additions powering filter-aware tracker/goal
  names ("Today's Water" / "Yesterday's Water" / "July 18th Water"):
  - Each `$allItems` entry now carries `moduleLabel` (the STABLE template
    label, separate from `label` which prefers the occurrence override). A
    label-decorating op reads `moduleLabel` as its base so it never re-prefixes
    its own previously-written `occurrence.label`.
  - New built-in date vars beside `$activeDateLabel` (same IIFE, so they resolve
    from `operation.targetOccurrenceId`'s effective filter): `$activeDateRelativeLabel`
    = neutral "Today"/"Yesterday"/"Tomorrow"/ordinal "July 18th";
    `$activeDatePossessive` = ready-to-prepend prefix "Today's"/"Yesterday's"/
    "Tomorrow's"/"July 18th" (relative words take `'s`, an explicit date doesn't).
- **`applyUpdate.js` (`routeRecordPath`)** — new `$<occ>.label` path → emits
  `UPDATE_ITEM_LABEL { itemId, label }` (value coerced to string; null clears).
  Sits alongside fields/parentId/meta/ownStyle/textmap. The renderer prefers
  `occurrence.label` over `module.label`, so an op renames a single PLACEMENT
  without touching the shared template. 3 tests in `applyUpdate.varRecord.test.js`.

## Recent Changes (2026-06-06 — drag preview: status folded into native ghost, laggy JS pill retired)
- **`dragSystem.js` (`attachDragPreview`)** — the native drag image is now built
  FROM DATA (label + action verb stacked, less opaque `rgba(15,25,40,0.62)`)
  instead of cloning the source element (the clone collapsed → "empty box").
  Its caller (`onGenerateDragPreview`) now passes `{ label, action }`: label from
  `data.label || data.name || data.occurrence?.label`, action from the drag mode
  (`copy`→"Copy", `copylink`→"Copy-link", else "Move").
- **`DragProvider.jsx`** — REMOVED the `InternalDragPreview` cursor-following pill
  entirely (component + `internalDragPreview` state + `internalPreviewElRef`/
  `internalPreviewPosRef` + the per-tick update block in `handleDragMove` +
  `clearSession` reset + render). It trailed the cursor (JS-followed) while the
  native ghost moved at OS speed → the "lag" the user reported. The action +
  source label now live INSIDE the zero-lag native ghost; the live drop
  destination is conveyed by the container drop-highlight ring. `ExternalImportPreview`
  (for OS/HTML/text drops) is untouched.

## Recent Changes (2026-06-03 — TIME_BEFORE/AFTER + DATE_BEFORE/AFTER comparators)
- **`operationActions.js` (`evalRule`)** — generic, domain-agnostic time/date
  comparators so pipelines can ask "is this time/date before X" without baking
  any logic into seed or components:
  - `TIME_BEFORE` / `TIME_AFTER` — parse BOTH 12h (`"9:00am"`, `"9am"`,
    `"12:30 PM"`) and 24h (`"14:30"`) plus the time part of an ISO datetime →
    minutes-since-midnight, then compare. Either side unparseable → `false`.
  - `DATE_BEFORE` / `DATE_AFTER` — calendar-day compare by day-key (time ignored);
    regex-slices `YYYY-MM-DD` off ISO strings to avoid the `new Date(...Z)` tz
    shift. Either side empty/unparseable → `false`.
  - First consumer: the `Schedule: Mark Passed Slots` time-based op (slot timeslot
    `TIME_BEFORE $currentTime`, day-col date `DATE_BEFORE $today`). 8 tests in
    `__tests__/operationActions.unified.test.js`.

## Recent Changes (2026-05-26 — filter-change cascade dedup: the date-switch 5-10s freeze)
- **Root cause (from `console-export-2026-5-26_9-7-15.log`):** switching the
  date *on the Schedule page* runs `updateOccurrenceFilterOverride`, which fans
  out a separate `NavigationOp` for the source page **plus every inheriting
  descendant** (~50 slots/containers/tasks). Each carries "Schedule" in its
  `_ancestorLabels`, so the ancestor-scoped page-rebuild ops (`Table: Build`,
  `Canvas: Build`, `Schedule: Build Schedule` — `onFilterChange
  ancestorLabel:"Schedule"`) matched **all ~50** and re-ran — `DELETE_ITEM=6`
  each, ~50×. Individual op fires are fast (40-70ms); 50× = the 5-10s freeze,
  and the rebuild never settled ("schedule doesn't build").
- **`operationExecutor.js` (`runMatchingOperations`)** now reads
  `context.cascadeFiredOps` (a Set or null): ops already in it are skipped in
  the match loop, and every op is added as it executes. So an op matching many
  transactions in one cascade runs ONCE. Safe because the rebuild ops resolve
  their working date from `operation.targetOccurrenceId`, not the triggering
  occurrence (verified: no seed op reads `$trigger.occurrence` for NavigationOp
  behavior).
- **`CommitHelpers.js` (`updateOccurrenceFilterOverride`)** now collects the
  source + descendant `NavigationOp` transactions into one array and fires them
  via `operationsBridge.fireOperationsBatch("NavigationOp", transactions)`
  (falls back to per-transaction `fireOperations` when the bridge is unwired,
  e.g. unit tests). `fireOperationsBatch` (bindSocketToStore — see
  state/CLAUDE.md) wraps the burst in a fresh dedup Set.
- Descendant `NavigationOp`s still FIRE (a hypothetical descendant-specific
  trigger would still match for its first occurrence) — they just no-op for
  already-fired ops, which is cheap. Independent date switches use a fresh Set
  so they never dedup against each other.
- Regression: `__tests__/operationExecutor.test.js` ("cascadeFiredOps dedups an
  op across a multi-transaction cascade"). Client-only, no re-seed. 175
  operationExecutor + 30 CommitHelpers tests green.
- **Still open (secondary):** even firing once, the Build ops delete-then-
  rebuild rows instead of replacing in place; the in-batch overlay
  `Object.assign({}, base, localOccsById)` (bindSocketToStore.js ~1267) can't
  represent a deletion, so within one cascade each fire re-sees stale rows from
  the base cache. An in-place replace/upsert is the follow-up cleanup.

## Recent Changes (2026-05-25 part 3 — deleteOccurrence fireTrigger: cycle-breaker sync path)
- **`CommitHelpers.js` (`deleteOccurrence`)** — new `fireTrigger = true`
  option. When `false`, the occurrence is still deleted (cache evict +
  dispatch + `delete_occurrence` emit) but the synchronous
  `OccurrenceDeleteOp` trigger + the rAF per-field `MeasureOp`
  re-aggregation are SKIPPED. `bindSocketToStore`'s `DELETE_ITEM` /
  `REMOVE_OCCURRENCE` effect handlers pass `fireTrigger: false` because
  those delete DERIVED data (mirror-op row/card copies). Re-aggregating
  trackers over a deleted derived row is a no-op on the value (the row
  isn't under the tracker's `$schedPageId` scope) — so it was pure waste:
  17 `OccurrenceDeleteOp` × ~300ms (42 tracker effects each) = the ~5s
  freeze that REMAINED after the infinite loop was fixed (the loop was a
  separate issue — see the inclusive scope guards in server/CLAUDE.md +
  the async `opEmittedOccIds` breaker in state/CLAUDE.md). User-initiated
  deletes keep `fireTrigger:true` so trackers update normally. Regression:
  `__tests__/CommitHelpers.test.js` ("deleteOccurrence with fireTrigger:false
  still deletes but skips the OccurrenceDeleteOp fire"). Client-only, no
  re-seed.

## Recent Changes (2026-05-25 — self-trigger guard: client-only freeze fix, NO reseed)
- **`operationExecutor.js`** — new module-level `_opsApplyingEffects` Set
  + exports `setOpApplyingEffects(opId, on)` / `isOpApplyingEffects(opId)`.
  `runMatchingOperations` skips any op currently in the set (checked before
  `computeTriggerMatch`). Each returned effect is tagged `_sourceOpId = op.id`.
  **`state/bindSocketToStore.js`** marks the producing op applying around each
  `applyOperationEffect(eff)` (set→apply→clear, spanning nested fires). Net
  effect: an op CANNOT be re-triggered by the OccurrenceDeleteOp/CreateOp that
  its OWN delete/create effects synchronously fire. This is the definitive,
  seed-independent fix for the drop-into-Schedule freeze (Table/Canvas Build
  delete their own rows/cards → each delete re-fired the op → exponential
  cascade). Cross-loops (A→B→A) covered too — both stay marked while on the
  stack. Linear A→B→C chains untouched (each op once); RUN_OPERATION recursion
  keeps its own depth cap. Requires only a client rebuild — no re-seed.
  Regression: `__tests__/operationExecutor.test.js` ("ops marked
  applying-effects are skipped (self-trigger guard)").
- **`operationIntrospection.js` (DELETE handler)** — now also inspects
  `itemIdExpr` / `itemIdVar` / `targetExpr` (the dynamic-target keys the
  Build ops use, e.g. `itemIdExpr:"$orphan.id"`). Previously only
  `itemId/target/occurrenceId` → `occurrences_written` came back empty for
  these ops → the depth-cap warning's `suspects:[]` never named the loopers.
  Now the warning identifies the culprit op(s).

## Recent Changes (2026-05-25 — deleteOccurrence snapshots occ for $trigger enrichment)
- **`CommitHelpers.js` (`deleteOccurrence`)** — now snapshots the
  occurrence via `operationsBridge.getLocalOcc(occurrenceId)` BEFORE
  eviction when the caller didn't pass `occurrence`, and passes it as
  `occurrencesOverride` on the `OccurrenceDeleteOp` fire (also sources
  `instanceId`/`containerId`/`fields` from the snapshot). Without this,
  operation-effect deletes (`applyOperationEffect → DELETE_ITEM`, which
  pass no `occurrence`) fired `OccurrenceDeleteOp` with no override, so
  the executor couldn't enrich `$trigger.occurrence` — and the
  Table/Canvas Build self-trigger guard (`$trigger.occurrence._ancestors
  HAS_ANCESTOR <ownPageId>`) silently never matched on the SYNCHRONOUS
  cascade path (it only worked on the async server-echo path, which
  already passed an override). This was the missing half of the
  drop-into-Schedule freeze fix. Regression test in
  `__tests__/CommitHelpers.test.js` ("deleteOccurrence sources snapshot
  from cache and passes it as override"). NOTE: `removeOccurrence` still
  requires the caller to pass `occurrence` — its callers already do.
  NOTE: `operationIntrospection.js`'s DELETE handler only inspects
  `cfg.itemId/target/occurrenceId`, not `cfg.itemIdExpr`, so the
  fire-depth-cap warning's `suspects:[]` is a blind spot — it does NOT
  mean no op is looping. Cosmetic; the guard is the real fix.

## Recent Changes (2026-05-25 — $trigger.occurrence._ancestors enrichment)
- **`operationExecutor.js` ($trigger enrichment, ~line 1094)** — the
  enriched `$trigger.occurrence` now carries `_ancestors`
  (`ancestorsFor(occ.id)`, closest-first id array) alongside
  `id/moduleId/parentId/fields`. Lets a rebuild op distinguish "the
  source changed" from "I just added/deleted my OWN derived copy" via
  `$trigger.occurrence._ancestors HAS_ANCESTOR <ownPageId>`. Enables
  the self-trigger guard added to `Table: Build` + `Canvas: Build` in
  createLiveData.js (see server/CLAUDE.md) — root-cause fix for the
  exponential OccurrenceDeleteOp cascade that froze the app when
  dropping a toolkit item onto Schedule (both Build ops trigger on
  unscoped onAdd/onDelete AND delete their own rows/cards in an orphan
  sweep, so each cleanup delete re-fired them until the depth cap).
  Additive + null-safe (no trigger occurrence → undefined → guard
  fails closed). Regression test in `__tests__/operationExecutor.test.js`
  ("$trigger.occurrence._ancestors is populated for HAS_ANCESTOR guard").

## Recent Changes (2026-05-21 — StyleHelpers cascade walker)
- **`StyleHelpers.js`** — Added `STYLE_FIELDS_BY_KIND` (per-entity-type
  field whitelist driving the editor's kind-aware UI),
  `resolveStyleCascade(ctx, leafKind)` (Grid → Panel → Page →
  Container → Instance walker returning ordered ancestor levels +
  merged resolved style), and `buildStyleCascadeContext({
  leafOccurrence, occurrencesById, modulesById, grid })` (parent-
  chain bucketer that fills the `ctx` shape `resolveStyleCascade`
  expects via the shared `buildParentMap`). Used by
  `ui/StyleEditor.jsx`'s new cascade-view + by ContainerForm /
  InstanceForm / LayoutForm / GridSettingsTab to render kind-aware
  controls per entity. Granular border + font fields added to
  DEFAULT_ENTITY_STYLE in an earlier commit this session.

## Recent Changes (2026-05-21 — CALL_API + SHOW_VALUE + suspend-aware onPipelineDone)
- **`operationActions.js` new action `CALL_API`** — outbound HTTP from
  a pipeline. Same `_suspend` pattern as `GET_USER_INPUT`: returns a
  sentinel `{_suspend, _callApi, request: {fetch}, resultVar,
  errorVar, onError}`. cfg: url / method / headers / query / body /
  timeoutMs / responseVar / onError ("fail" | "continue") / errorVar.
  Eagerly kicks off the `fetch` so the suspend has a ready Promise
  for `_handleSuspend` to await. `onError: "continue"` smuggles an
  error envelope `{__apiError, status, body?, message?}` back through
  the same pipe (executor routes to errorVar).
- **`operationActions.js` new action `SHOW_VALUE`** — stages
  `{_effect: "SHOW_VALUE", name, value}` on the effect list. Two
  consumers: (1) `POST /api/v1/operations/:id/run` (server) surfaces
  every SHOW_VALUE under `vars` in the JSON response, (2) the
  OperationLogPanel can render them as "result" rows. `name` auto-`$`
  prefixes if missing; `value` runs through `resolveExpr`.
- **`operationExecutor.js` `_handleSuspend` / `resumeContinuation`** —
  both now accept `{ onPipelineDone, accumulated }` so a suspend chain
  can report the FINAL set of effects once the last resume runs. The
  /api/v1 bridge uses this to know when to emit `api_op_result`.
  Synchronous pipelines fire `onPipelineDone` immediately with the
  same effects array the caller already has.
- **`operationExecutor.js` `executePipeline`** — extraVars (already
  accepted) are now also folded into `$vars` BEFORE the source loop so
  caller-supplied vars (e.g. from `/api/v1/operations/:id/run`'s body)
  are referenced directly via `$name` without needing a Source row on
  the op. Existing Source-row-declared callers byte-identical to
  before.

## Recent Changes (2026-05-20 — operations review fixups)
- **`operationActions.js` (`DATE_ADD` advanceUntil loop)**: The loop
  ran a fixed `safety = 600` and silently bailed when `amount === 0`
  (advance is a no-op so `result <= limit` stays true forever — wasted
  600 iters and returned an underadvanced date). Now snapshots
  `prevTime` each iter and breaks when `result.getTime() === prevTime`.
  Safety bumped to 5000 so multi-year daily advances finish (730 iters
  for 2 years).
- **`operationExecutor.js` (`_handleSuspend` Promise.catch)**: Was
  unconditionally silent — masked any error inside the resume chain.
  Now keeps cancel silent (`/cancel/i` match) but `console.warn`s
  anything else so a broken modal can't disappear without a trace.
- **`pasteClipboard.js` `buildLinkedSubtree`**: Removed dead
  `|| crypto.randomUUID()` fallback in the `linkedGroupId` chain —
  `srcOcc` is null-guarded at function entry so `srcOcc.id` is
  unconditionally truthy at that point.

## Recent Changes (2026-05-20 — pasteClipboard.js)
- **`pasteClipboard.js` (NEW)** — `runPasteClipboard({ mode, ids,
  destinationOccurrence, destinationModule, occurrencesById, dispatch,
  socket, gridId, userId, panelId })` replays the multi-select
  clipboard (`state/SelectionContext.js`) into a destination occurrence
  (container or page). Mode dispatch:
  - `copy` → **deep clone** when source has children: walks
    `src.occurrences[]` recursively via `buildCloneSubtree` (depth-
    capped at 24), mints fresh ids at every level, deep-copies fields,
    preserves iteration mode, then `emitCloneSubtree` pushes
    parent-first through `CommitHelpers.createOccurrence`. Leaf-only
    sources fall back to `LayoutHelpers.copyInstanceToContainer` —
    iterationMode and iterationValue now passed through from
    `src.iteration` so persistent items don't silently demote to
    specific.
  - `copylink` → **deep linked clone** when source has children:
    `buildLinkedSubtree` is the same shape as `buildCloneSubtree` but
    each level emits a `linkedGroupId` derived from the source
    occurrence's id (or any existing group). The source itself gets
    tagged via `updateOccurrence` when it had no group, so the
    server's `update_occurrence` linked-group fan-out propagates
    writes pairwise between source and clone at every level. Leaf-
    only sources still call `LayoutHelpers.copylinkInstanceToContainer`
    with iterationMode passed through (mints fresh occurrences sharing
    `moduleId` + `linkedGroupId`; assigns a group to the source if it
    had none — server fan-out propagates writes across the group
    thereafter).
  - `move` → finds the current parent via `occurrences[]` reverse scan
    (parentId fallback), calls `LayoutHelpers.moveInstanceBetweenContainers`,
    then updates `src.parentId` so ancestor walks see the move.
  Skips self-paste (`occId === destinationOccurrence.id`) and same-parent
  moves. Build shim `{ id, label, _occurrence }` for the destination is
  built locally so we can reuse the LayoutHelpers add/copy primitives
  unchanged.
- **Wired from**: `modules/ModuleContainer.jsx` (container right-click
  → "Paste N here" / "Move N here" / "Paste linked N here" — top of
  menu when `selection.clipboard` is set) and `modules/ModulePage.jsx`
  (page right-click — same labels). Both call
  `selection.clearClipboard()` + `selection.clear()` after pasting so
  the selection state matches what the user sees.

## Recent Changes (2026-05-19 — boundFieldSync)
- **`boundFieldSync.js` (NEW)** — `propagateBoundFieldWrite({ hostOccurrence,
  binding, nextValue, occurrencesById, dispatch, socket })` finds every
  occurrence sharing host's link-field value AND already carrying
  binding.selfField (via `findLinkedSiblings`), then emits a
  `CommitHelpers.updateOccurrence` for each with selfField patched to
  nextValue. Loop-safe (skips siblings whose value already equals
  nextValue). Called by `modules/BoundHeader.jsx` after every dropdown
  write and by `modules/BoundBody.jsx`'s `makeFieldWriter` after every
  TipTap onUpdate. Editor-↔-field binding sync layer; no explicit
  linkedGroupId — the implicit group is "everyone matching the link
  field's value".

## Recent Changes (May 19 2026 — operationIntrospection + $allOperations)
- **`operationIntrospection.js` (NEW)** — Pure static analyzer. `analyzeOperation(op, { fieldsById, occurrencesById, operationsById, operationsByName }) → IntrospectionRecord` walks `op.pipeline.steps[]` recursively (LOOP body, IF then/else) + `op.triggerObjects[]` + `op.pipeline.sources[]` and returns ten sets (as arrays): `fields_written / fields_read / occurrences_written / occurrences_read / triggered_by_fields / triggered_by_occurrences / ancestor_scopes / invokes_operations / templates_used / created_modules`. Per-action handlers cover CREATE / UPDATE / DELETE / FIND / COPY_LINK / APPLY_TEMPLATE / RUN_OPERATION / ADD_CHILD / LINK_OCCURRENCE_TO_PARENT / *_VAR / pool actions. A generic string-scanner runs over every cfg leaf to catch `field:<id>` tokens + `$<var>.fields.<fid>` patterns regardless of action type — fieldId existence is checked against `fieldsById` so false positives are dropped. `operationsByName` resolves `RUN_OPERATION.operationName` → opId for `invokes_operations`. `analyzeAllOperations(operationsById, ctx)` memoizes per-op records on a WeakMap keyed by the op object identity — recomputes only when the user edits an op. 15 tests in `__tests__/operationIntrospection.test.js`.
- **`operationExecutor.js`** — Imports `analyzeAllOperations` and adds `$allOperations` to the `$vars` setup (array of `{ ...op, ...introspectionRecord }`). `_SNAPSHOT_SKIP` extended with `$allOperations` so run-log snapshots stay small. Authors can now write predicates like `$op.fields_written CONTAINS field:<fid>` or LOOP `$allOperations` with a predicate.

## Recent Changes (May 19 2026 — fieldVisibilityAutoAppend + drop wire-in)
- **`fieldVisibilityAutoAppend.js` (NEW)** — Two helpers used after a drop lands a new occurrence in a scope:
  - `autoAppendFieldsToAncestorsShowMode({ newOccurrence, destinationOccurrence, ctx })`: walks the destination ancestors (inclusive, leaf→root via the shared `buildParentMap` reverse-map; `parentId` fallback). For each ancestor whose `fieldVisibility.mode === "show"`, appends the dropped occurrence's missing fieldIds to `fieldIds`. Stops the walk at the first `off`-mode ancestor (anything above it sees "all fields"). Never strips, only adds — idempotent. Cheap when no ancestor is in show mode (no writes, no walk past the first miss).
  - `autoAppendFieldsToTableColumnShowMode({ tableOccurrence, columnIndex, newOccurrence, ctx })`: parallel helper for table cells. Reads `tableOccurrence.meta.table.columns[colIndex].fieldVisibility`; if `mode === "show"`, appends missing fieldIds via the existing `meta.table.columns` mutation pattern.
  - New fieldIds collected via `module.fieldBindings[].fieldId` (template binding) ∪ `Object.keys(occurrence.fields)` (stamped-but-unbound values — catches Schedule's date/time-slot pattern).
- **`dropHandlers.js`** — Imports `autoAppendFieldsToAncestorsShowMode`. New `autoAppendOnDrop({ ctx, newOccurrenceId, newOccurrence, parentOccurrenceId })` wrapper resolves the two occurrences and fires the helper. Wired into the destination branches of: `handleOccurrenceMove` (container→container move + copy after `stampPageFilterFields` / after `copyInstanceToContainer`, canvas-page destination move + copy, canvas-source → container move + copy), `handleModuleDrop` (canvas-page leaf, CC-leaf → container after `copyInstanceToContainer`), and `handleDocEmbedDrop` (canvas-page move + copy, list-container move + copy). Picker-scoping changes were considered and rejected — per user, all field-vis / filter pickers must continue listing every field on the grid so they can pre-configure fields (e.g. Schedule's hidden Date filter) before any descendant carries them. Auto-append is purely about defaulting the show-list to visible for fields newly arriving via drop.

## Recent Changes (May 18 2026 — deepResolveExpr unblocks embed-cell UPDATE)
- **`operationActions.js`**: New exported `deepResolveExpr(value, $vars)` — recursively runs every string leaf of an object/array through `resolveExpr` (literals pass through unchanged, non-string scalars untouched). The UPDATE action's object branch now uses it AND the branch widened to also cover **arrays** (were previously hitting `resolveExpr(array)` whole → unresolved). This is the documented Phase-D blocker: a pipeline can now `UPDATE $tbl.meta.table.cells.${$r}:0 = { type:"doc", content:[{ type:"moduleEmbed", attrs:{ occurrenceId:"$c0" } }] }` and the `$c0` leaf resolves. Used by the new "Schedule Table: Build" op. 2 new tests in `operationActions.unified.test.js` (object embed-doc + array column-defs); 654/654 green. Note: array UPDATE values are now deep-resolved everywhere — existing ops pass string values (`"$rows"`) so unaffected, but literal `$`-looking strings inside an array value would now resolve.

## Recent Changes (May 18 2026 — Table container helpers + shared COMPARATOR_OPTIONS)
- **`tableCells.js` (NEW)** — Pure helpers for the `kind:"table"` container: `cellKey(r,c)`, `emptyCellDoc()`, `makeEmbedCellDoc(occId)`, `getCellSortValue(doc, column, ctx)` (numeric coercion for plain text; reads `column.displayFieldId` for embed cells and falls back to the occurrence label), `firstEmbedOccId(doc)`, `fillRange(src, target)` (Excel-style single-axis fill; the larger of |dr|/|dc| wins; source cell excluded; clamps to ≥0), `deleteColumn(table, idx)` and `insertColumn(table, idx, def)` (both reindex `cells["r:c"]` keys to track the structural change). 14 unit tests in `__tests__/tableCells.test.js`.
- **`LayoutHelpers.js`** — Extracted `assignLinkedGroup(sourceOccurrence, tagFn)` from `copylinkInstanceToContainer` so fill-drag and the existing copylink path share group assignment. Behavior-preserving: reuses existing `linkedGroupId`, falls back to source id (and tags the source), generates a uid only when there is no source. 4 unit tests in `__tests__/assignLinkedGroup.test.js`.
- **`comparators.js` (NEW)** — Shared `COMPARATOR_OPTIONS` array + `UNARY_COMPARATORS` set. `GridSettingsTab.jsx` and `ContainerTable.jsx`'s per-column filter popover both import from here; `evalRule` is still the canonical evaluator for every value in the list.

## Recent Changes (2026-05-17 — DATE_IN_PERIOD comparator + period-shape filter values)
- **`operationActions.js` (`DATE_IN_PERIOD` case in `evalRule`)**: New comparator. leftVal = date value (ISO string or Date); rightVal accepts either a bare `"YYYY-MM-DD"` (treated as day unit, equivalent to SAME_DAY) OR `{value: "YYYY-MM-DD", unit: "day"|"week"|"month"|"year"}`. Reuses the SAME_WEEK Mon-Sun weekStart helper for week-unit; month/year compare by calendar month/year. Wildcard right (null/""/empty value) passes. Null left fails. Powers tracker period aggregation across the full selected window. 7 regression tests in `operationActions.unified.test.js`.
- **`operationExecutor.js` ($activeDate setup)**: Resolves both bare-string and object-shape filter values. New `$activePeriod` var carries the FULL `{value, unit}` object (or bare string fallback) so tracker pipelines can route DATE_IN_PERIOD off the goal page's effective filter without flattening to a day.

## Recent Changes (2026-05-17 — PUSH_TO_ARRAY pipeline action)
- **`operationActions.js` (`PUSH_TO_ARRAY`)**: New action case. cfg: `{ name, value }`. When `cfg.value` is a plain object, each leaf value is resolved via `resolveExpr` (supports `$var.path` expressions). When `cfg.value` is a primitive, pushes via `resolveExpr`. Creates the array when the variable doesn't exist. Distinct from `PUSH_TO_VAR` which only pushes scalar values via `cfg.expr`. Used by the Books Read tracker to build `[{label, pages}]` rows. 6 unit tests added to `operationActions.unified.test.js`; 615/615 green.

## Recent Changes (2026-05-17 — createLeafInstanceInParent helper)
- **`CommitHelpers.js`**: New exported function `createLeafInstanceInParent({ dispatch, socket, gridId, userId, parentOccurrence, label, initialFields })`. Creates a `role:"instance" kind:"list"` module + occurrence with optional `initialFields`, optimistically dispatches both, emits `create_module` + `create_occurrence`, then appends the new occurrence ID to `parentOccurrence.occurrences[]`. Returns `{ moduleId, occurrenceId }`. Follows `createTextblockInContainer` pattern. Used by `Field.jsx` for occurrence-field add-new.

## Recent Changes (2026-05-17 — optionsResolver $this support)
- **`optionsResolver.js`**: `resolveOptions` now accepts optional third param `ownerOccurrence` (default `null`). When provided, it is passed as `$this` inside the find-mode predicate's `$vars` so predicates like `fields.category.value IS $this.fields.type.value` resolve the owner's field value. Backward-compatible: callers that don't pass it get `{}` for `$vars` (same as before). Also supports flat find shape (`{ mode:"find", over, predicate, ... }` at top level of `optionsSource`) alongside the existing nested shape (`{ find: { over, predicate, ... } }`) via `const cfg = src.find || src`.

## Recent Changes (2026-05-17 — optionsResolver)
- **`optionsResolver.js` (NEW)**: `resolveOptions(field, ctx) → { options: Array<{value, label}>, totalMatched: number }`. Branches on `field.meta.optionsSource.mode`: manual (literal values), range (start/end/step expansion), find (collection walk + predicate filter via `evalGroupAgainstRecord` + `valuePath`/`labelPath` extraction via `resolveRecordPath` + dedupe/sort/limit). Used by `FieldRenderer.jsx` (stamps `meta._resolvedOptions` for runtime), by `SelectOptionsSourceEditor`'s live preview, and by `FilterNavWidgets.derivedOptionsForFilter` (now accepts a `ctx` param).

## Recent Changes (May 15 2026 — COPY_LINK deterministic id + APPLY_TEMPLATE replacements/rootParent + ADD_CHILD)
- **operationActions.js (`COPY_LINK`)**: minted `linkedGroupId` is now DETERMINISTIC `lg-<sourceOccId>` (was `crypto.randomUUID`), in BOTH the fresh-clone path and the migration (`cfg.targetId`) path. Root cause of "Pay monthly bills: complete one, other doesn't tick": Build Day fires several times per load (onLoad + filter-bootstrap onFilterChange); across separate op runs in one batch the source's freshly-minted link isn't visible in the frozen snapshot, so a random id diverged (source in one group, swept/dup copy in another) and the server `update_occurrence` linkedGroupId fan-out never matched. Deterministic derivation makes every COPY_LINK of the same source converge on one group, idempotently. 62 operationActions.unified tests still green.
- **operationActions.js (`APPLY_TEMPLATE`)** — additive, optional cfg (existing callers like Daily Routine byte-for-byte unchanged):
  - `replacements: { "{tok}": expr }` — find-and-replace over every cloned occurrence's textmap text nodes (reuses exported `substituteTextmapTokens` from applyUpdate.js — one impl).
  - Embedded-ref remap: `occRemap`/`modRemap` filled per cloned node (children before parent); a cloned parent's textmap `instanceTextblock`/`moduleEmbed` `occurrenceId`+`instanceId` attrs are rewritten to the clones. Fixes the latent bug where a doc-page template with a textblock child would point clones at the original. Cloned textmaps are now always deep-copied (was shared-by-ref) — strictly safer.
  - `rootParent` (expr → parent id; folder ok) mints a standalone new subtree (no clone-into-target, unwrapRoot ignored). `rootLabel` overrides the root clone's module label. `rootIdVar` binds the cloned root occ id.
  - **Scope**: only the operation-pipeline APPLY_TEMPLATE. The server UI template path (`templates.js`/`cloneSubtree.js`) is untouched (still lacks ref-remap — pre-existing).
- **operationActions.js (new `ADD_CHILD` action)**: cfg `{ parentId, childId }`. Pure occurrences[] append (does NOT touch child.parentId), idempotent, emits existing `UPDATE_OCCURRENCE` effect + patches the in-pipeline overlay. Lets a page live in a folder (tree) AND be a panel's inactive tab (Notes-page pattern). `LINK_OCCURRENCE_TO_PARENT` action/effect no longer exists (stale CLAUDE.md note) — ADD_CHILD is the replacement for pipeline use.
- **applyUpdate.js**: `substituteTextmapTokens` is now `export`ed (was module-private) so APPLY_TEMPLATE shares the one token-substitution impl.

## Recent Changes (May 15 2026 — COPY_LINK recurses into children pairwise)
- **operationActions.js (`case "COPY_LINK"` rewrite)**: When the source has children, each child is recursively COPY_LINKed too — pairwise. `source.occurrences[i]` ↔ `copy.occurrences[i]` share their OWN per-child `linkedGroupId`. Server's `update_occurrence` linked-group fan-out then propagates field/textmap writes within each pair independently, so a doc/container subtree stays fully in sync at every level (mark a sub-textblock done in one copy → ticks across all copies). Body refactored into a `linkOne(src, targetParentId, isRoot, depth)` recursive helper with cycle guard (Set + depth cap 24). Children's CREATE_ITEM emits include `inst.occurrences = childIds` so each parent is created with its child list inlined (matches APPLY_TEMPLATE's pattern, avoids the bindSocketToStore parent.occurrences[] race). cfg.fields / cfg.itemIdVar / cfg.itemVar / cfg.linkedGroupVar / cfg.parent / cfg.insertAtIndex apply to ROOT only (recursing them into children would clobber per-child values; typical caller intent is "stamp date on the root"). cfg.copyFields applies at every level. 2 new regression tests in `__tests__/operationActions.unified.test.js`: "recursively links a 2-level subtree pairwise" + "cfg.fields applies to the ROOT clone only".

## Recent Changes (May 15 2026 — COPY_LINK action + linkedGroupId on CREATE_ITEM)
- **operationActions.js (new `case "COPY_LINK"`)**: Mints a new occurrence sharing both `moduleId` AND `linkedGroupId` with a source occurrence. Server's `update_occurrence` handler (server/socketHandlers/occurrences.js:91-124) propagates field/textmap writes bidirectionally across all occurrences sharing a `linkedGroupId` — so completing one copy marks the source AND every other copy. Distinct from CREATE (mints a new template + independent occurrence) and from a deep-copy. cfg: `{ sourceId, parent?, insertAtIndex?, fields?, copyFields? (default true), linkedGroupVar?, itemIdVar?, itemVar? }`. If source has no `linkedGroupId` yet, mints one + emits an UPDATE_OCCURRENCE on the source so the next field write triggers the linked-group fan-out. Pushes a CREATE_ITEM effect with `template:null` (reusing source.moduleId — no new template). Same optimistic-publish boilerplate as CREATE (overlay parent.occurrences[], _ancestors walk, role-filtered `$all*` slices). 7 regression tests in `__tests__/operationActions.unified.test.js` ("COPY_LINK action").
- **Used by**: `Schedule: Build Day` todo sweep (server/scripts/createTestGrid.js) — swept Due copies are now copy-links, not independent CREATEs. Re-seed required: `node --env-file=.env scripts/createTestGrid.js`.

## Recent Changes (May 15 2026 — grid-subject filter trigger = global filter ONLY)
- **operationExecutor.js (`matchSubjectFilter`)**: A `subjectType:"grid"` trigger on `onFilterChange`/`onNavigation` now matches ONLY a global/toolbar filter change — a NavigationOp with NO `sourceOccurrenceId` and NO `_ancestorIds`. Checked BEFORE the `if (!targetId) return true` shortcut (these triggers use `targetId:""`, so they previously matched every filter change). **Root cause** of "changing the Physical container's date rebuilds the Schedule for the goals' day": `Schedule: Build Day`'s `{onFilterChange, subjectType:"grid", targetId:""}` trigger matched the local Physical-container NavigationOp (which carries `sourceOccurrenceId`+`_ancestorIds` via `CommitHelpers.updateOccurrenceFilterOverride`); Build Day then ran with `$schedDate = $trigger.date` (the goals' date, since `$schedPage._effectiveFilter` was null) and APPLY_TEMPLATE'd the routine into Schedule. Local occurrence filter changes are now handled exclusively by `subjectType:"filterNav"` triggers, scoped by `matchAncestorScope`'s `ancestorLabel`. One shared-function fix — corrects every op with a grid-subject filter trigger, not just Build Day. 3 regression tests in `__tests__/operationExecutor.test.js` ("grid-subject onFilterChange matches global filter changes only"). 559/559 client tests green. Pure client logic — no re-seed needed for this fix.

## Recent Changes (May 15 2026 — effectiveFilterFor + _effectiveFilter walk occurrences[] reverse map)
- **operationExecutor.js (`effectiveFilterFor`)**: Same parentId-only-walk bug as `getEffectiveFilterForOccurrence` — fixed identically. New optional `parentByChildId` param; falls back to the shared `buildParentMap` (dragHitTesting) when not passed; walk step `nextId = pbc[cur.id] ?? cur.parentId`. Exported + covered by `__tests__/operationExecutor.test.js` (all green). Part of the May 15 ancestor-walk consolidation — see state/CLAUDE.md + memory `effective-filter-ancestor-walk`.
- **operationExecutor.js (`executePipeline`)**: The two `getEffectiveFilterForOccurrence(...)` calls (per-`$allItems` `_effectiveFilter` enrichment at ~917, and the `$activeDate` target-occ resolution at ~946) now pass the already-built `parentByChildId` (line 881 `buildParentMap`) so the reverse-map walk costs nothing extra per item. This is what makes `$goalItem._effectiveFilter` resolve the full instance→container→page→grid chain for the goal trackers. See server/CLAUDE.md (May 15) + memory `project-goal-date-page-pattern`.

## Recent Changes (May 13 2026 — Templates v2 client helpers + APPLY_TEMPLATE pipeline action)
- **CommitHelpers.js** — three new helpers: `commitCloneSubtreeAsTemplate(socket, { sourceOccurrenceId, name, parentFolderId })`, `commitApplyTemplate(socket, { templateOccurrenceId, targetOccurrenceId, mode })`, `commitSaveOverTemplate(socket, { sourceOccurrenceId, templateOccurrenceId })`. All three emit via `safeEmit`. Old `saveTemplate` / `fillFromTemplate` removed.
- **templateHelpers.js (NEW)** — pure traversal: `templatesManifestFor(state, gridId)`, `rootFolderForTemplates(state, gridId)`, `templateOccurrencesInFolder(state, folderId)`, `templateKindOf(state, occ)`, `templatesByKind(state, gridId, kindOrRole)`. Used by TemplatesSection / TemplatesTab / QuickAddMenu.
- **operationActions.js** — new `case "APPLY_TEMPLATE"` in `executeActionItem`. Walks template subtree depth-first from `state.modulesById` + `occurrencesById`, mints fresh ids, pushes one `CREATE_ITEM` effect per cloned node + a follow-up `UPDATE_OCCURRENCE` to wire the children list. Mode `replace` clears target's existing children first. Binds `cfg.resultVar` to the array of new occurrence ids (depth-first, leaves first, root last). Optimistic publish into `$vars.$allOccurrences`/`$allItems` so same-pipeline FINDs see the clones.
- **dropHandlers.js** — `handleTemplateDrop` removed; the old payloadType:"template" routing branch deleted. Template drag-out from QuickAddMenu / TemplatesSection / TemplatesTab calls `commitApplyTemplate` directly.

## Recent Changes (May 11 2026 — Canvas-to-container date stamp; QuickAddMenu kind filter)
- **dropHandlers.js (`handleOccurrenceMove` canvas-source MOVE branch)**: After moving a canvas-source leaf into a regular container, the helper now calls `stampPageFilterFields(...)` against the destination container occurrence — same call the regular container-to-container move branch already makes. Before, dragging a Canvas Note into a Schedule slot left the moved occurrence with no `fields[dateFieldId]` value, so `Tracker: Tasks Completed Today` (whose predicate gates on `SAME_DAY $goalDate`) ignored it on completion. The stamp runs BEFORE `fireMoveTrigger`, so the post-move MeasureOp burst sees the freshly-stamped date.

## Recent Changes (May 11 2026 — CREATE preserves hidden bindings; instances drop into grid cells)
- **operationActions.js (`CREATE` → `buildBindings`)**: Existing bindings' `hidden` flag is now preserved unless `cfg.fieldHidden[fid]` explicitly sets it (uses `Object.prototype.hasOwnProperty.call` to distinguish "absent" from "false"). Before: any CREATE that addressed an existing field bound on an existing template by-label silently un-hid it (because `hiddenMap` defaulted to `{}`, `hidden = !!undefined === false`, comparison flipped the stored `true` → `undefined`). Symptom: after the seed op ran, the source "Drink Water" / etc. template modules in Daily Toolkit lost their hidden Date binding and started rendering Date + Time Slot inline. Plus the seed's auto-attached `timeslotFieldId` binding lacked a hidden marker, so every per-day copy showed Time Slot too. Now the seed (and all in-pipeline CREATEs) can carry a `fieldHidden: { ... }` map to mint new bindings hidden and to leave the existing template's user-set visibility untouched.
- **dragSystem.js (`DropAccepts.GRID_CELL`)**: Added `DragType.INSTANCE` so leaf-role drags (notably textblocks dragged from a container) reach empty grid cells. Without it the pragmatic DnD accepts list rejected the drag before any of dropHandlers' leaf-role logic could see it.
- **dropHandlers.js (`handleOccurrenceMove` top branch)**: New early-out — when the drop target is a `GRID_CELL`, mirror handleModuleDrop's leaf-role drilldown: create a new panel + container at `{row,col}` and `copyInstanceToContainer` the dragged module into it. Lets users place a textblock (or any leaf occurrence) anywhere on the grid by dragging from its current container into an empty cell.

## Recent Changes (May 7 2026 — Pre-stamp page-filter date on drag-into-Schedule)
- **dropHandlers.js**: Split `stampPageFilterFields` into a pure `computePageFilterFields` (returns merged fields) plus a thin updater for the post-move case. `handleInstanceDrop` copy mode and `handleModuleDrop` (CC drag) now call `computePageFilterFields` BEFORE `LayoutHelpers.copyInstanceToContainer` and fold the stamp into the synthetic source's fields so the create lands with the destination's date. Post-create `stampPageFilterFields` calls removed from both copy sites. Move case still post-stamps (occurrence already exists), but `stampPageFilterFields` now also calls `operationsBridge.updateLocalOcc` so the per-field MeasureOp loop fired afterwards sees the stamped date in the executor's overlay.
- **Why**: When you dragged a pre-completed water item into a schedule slot, the create fired `OccurrenceCreateOp` + per-field `MeasureOp`s with the source's old date. The post-create stamp then silently fixed the date via `updateOccurrence` (no `triggerField` → no MeasureOp), and trackers (which gate on `fields.<dateFieldId>.value SAME_DAY $goalDate`) had already evaluated the loop before the date was correct. Editing a field afterwards re-fired with the right date, which is why "edit fields after drop" worked. Pre-stamping makes the create's in-flight ops see the right date the first time.

## Recent Changes (May 6 2026 — FIND candidates carry ancestor labels for disambiguation)
- **operationExecutor.js (`collectFindCandidates`)**: Each evaluated candidate now carries `ancestorLabels: string[]` — the candidate's `_ancestors` chain mapped through `$vars.$allItems` and reversed to root-first order, so the OperationLogPanel can render a breadcrumb like `Center Hub › Schedule › 6:00am` next to the candidate label. Unresolved ancestor IDs are dropped so the path has no gaps. Without this, the candidates list for a FIND iterating `$allInstances` (with many same-named "Drink Water" copies seeded into schedule slots) is indistinguishable from a single entry — every row reads "Drink Water · …shortId" and the user can't verify whether the seeded items even made it into the iteration pool.

## Recent Changes (May 6 2026 — $allPages now means role:"page" + new $allPanels + uncapped FIND candidates)
- **operationExecutor.js**: `$allPages` filter changed from `i.role === "panel"` to `i.role === "page"` — the previous filter was a misnomer that matched panel-role grid-cell shells (Panel A/B/C) instead of the actual pages (Schedule, Daily Toolkit, Daily Goals, Todo List). Added a new `$allPanels` slice for the panel role so panels are still iterable. `_SNAPSHOT_SKIP` updated to include both keys.
- **operationActions.js (`CREATE` optimistic publish)**: When a CREATE action runs with `role: "page"` it now appends to `$vars.$allPages`; `role: "panel"` appends to the new `$allPanels`. Was: `role: "panel"` was incorrectly appended to `$allPages` (matching the old misnamed filter).
- **operationExecutor.js (`collectFindCandidates`)**: Removed the `_FIND_CANDIDATE_LIMIT = 25` cap. Every iterated record's per-rule eval now lands in the run log so the user can audit why a FIND failed even on large pools. (Run-log persistence inherits the existing per-op cap of 25 entries from `OperationRunLog`.)
- **scripts/createTestGrid.js (re-seed required)**: All 17 FINDs in the test grid now declare `over` explicitly:
  - Schedule page lookups (5 ops, 5 sites) → `$allPages`
  - "Physical Wellness" / "Task Progress" goal-instance lookups (2 sites) → `$allInstances`
  - "Due" / slot / todo-list container lookups (5 sites) → `$allContainers`
  - Source / dedup / todo-copy instance lookups (3 sites) → `$allInstances`
  - Trigger-by-id lookups (Stamp Date + Clear Date on Move-Out, 2 sites) → kept default `$allOccurrences` because the trigger's role is unknown.
- **Re-seed**: `node --env-file=.env scripts/createTestGrid.js` to push the new pipelines.
- **Regression coverage**: 1 new test in `__tests__/operationExecutor.test.js` (`$allPages filters role:'page'`) confirming the page/panel split + per-collection iteration count.

## Recent Changes (May 6 2026 — FIND log surfaces bound vars + record-resolved predicate values + per-candidate breakdown)
- **operationExecutor.js (`executeSteps`)**: After `executeActionItem` runs, capture a `boundVars` map onto the `action` log entry covering the action's target vars (`cfg.itemVar`, `cfg.itemIdVar`, plus `cfg.name` for the `_VAR_TARGET_ACTIONS` set: INIT_VAR / SET_VAR / *_VAR family). FIND/INIT_VAR don't push effects into `updates`, so the run-history panel had nothing to display — every FIND row rendered "(no match)" even when it bound a record. New `_VAR_TARGET_ACTIONS` set near `_SNAPSHOT_SKIP` distinguishes var-name targets from CREATE's label.
- **operationExecutor.js (`resolveGroupForLog` + `executeSteps` FIND post-resolve)**: The log's predicate `_leftValue` annotations used to come from `resolveExpr(rule.left, $vars)`. For FIND predicates the lefts are bare record paths (`templateId`, `_ancestors`, `fields.<fid>.value`, `meta.scheduleSlot`) — `resolveExpr` returns those unchanged, so the run history showed the path string instead of the matched record's actual value. `resolveGroupForLog` now accepts an optional `record` argument; new `_isBareRecordPath()` helper routes bare paths through `resolveRecordPath` against the record. After a FIND action runs, `resolvedPredicate` is recomputed using the matched record (from `$vars[itemVar]` or `$vars[itemIdVar]` looked up in `$allItems` for id-only seed pipelines).
- **operationExecutor.js (`collectFindCandidates`)**: New helper invoked from `executeSteps` whenever a FIND action runs in log mode. Iterates the same pool the FIND iterated (default `$allOccurrences`), evaluates each leaf rule against each record via `evalRuleAgainstRecord`, and records `{ left, leftValue, comparator, rightValue, matched }` per rule per record. Sort: matched record first, then by score desc, then by id. Cap: `_FIND_CANDIDATE_LIMIT = 25` to keep run logs (esp. DB-persisted) small. Required so the panel can show per-record value breakdowns even when FIND came back empty — the user needs to see which records were close to matching and on which rule they failed.
- **operationActions.js**: Exported `resolveRecordPath` and `evalRuleAgainstRecord` so the executor can mirror FIND's per-record evaluation in the log.
- **Regression coverage**: 6 new tests in `__tests__/operationExecutor.test.js` under `describe("FIND action log entries carry boundVars", ...)` — boundVars on match, null on no-match, predicate left resolves against matched record (`templateId / _ancestors / fields.X.value / meta.X`), id-only fallback via `$allItems`, candidate-by-candidate evaluations on match (matched record first + score), candidate evaluations preserved on no-match.

## Recent Changes (May 5 2026 — CREATE wires parent linkage so HAS_ANCESTOR dedup works across RUN_OPERATION recursion)
- **operationActions.js (`CREATE` action)**: Three additions when publishing a new instance:
  1. Compute `_ancestors` for the new instance by walking the parent chain (preferring `context._parentByChildId` reverse map, falling back to `parentId`) and stamp it onto the instance object placed into `$vars.$allItems` / `$allOccurrences` / role-filtered slices. Same-pipeline FINDs evaluating `_ancestors HAS_ANCESTOR <pageId>` against the new row now match.
  2. Append `instanceId` to `context.occurrencesById[parentId].occurrences` (spread the parent so the cached `localOccsById` ref isn't mutated). The next `executePipeline` rebuild of `parentByChildId` from `.occurrences[]` arrays now picks up the new linkage.
  3. Set `context._parentByChildId[instanceId] = parentId` when the executor passed one in, so any FIND inside the same pipeline that walks the reverse map also sees the link.
- **Why the bug bit:** `Tracker: Tasks Completed Today` and `Tracker: Water Today` self-heal by `RUN_OPERATION`-ing `Schedule: Seed Daily Routine` when no schedule item exists for `$goalDate`. Seed at the end re-`RUN_OPERATION`s the trackers. Each recursive Tracker rebuilt `parentByChildId` from `context.occurrencesById` — and CREATE never updated the parent slot's `occurrences[]` in the overlay. Result: the just-CREATEd rows had empty `_ancestors`, the `_ancestors HAS_ANCESTOR $schedPageId` rule in the dedup FIND failed, the dedup FIND came back empty, and seed re-CREATEd the same items at every recursion level (capped at depth 4 by the recursion guard). User-visible symptoms: marking a schedule task complete spawned duplicate Drink Water / Take Medication / Go to Gym instances, and drag-to-schedule "didn't stick" because the dragged occurrence was buried under newly-seeded duplicates competing for the same template+slot pair.
- **Regression coverage**: 4 new tests in `__tests__/operationActions.unified.test.js` under `describe("CREATE action", ...)` — append-to-parent, ancestors via parentId fallback, ancestors via `_parentByChildId`, end-to-end same-pipeline FIND with `HAS_ANCESTOR` after CREATE.

## Recent Changes (May 4 2026 — RUN_OPERATION action: lookup-by-name + recursion guard)
- **operationActions.js (`RUN_OPERATION` case)**: Action now accepts `cfg.operationName` (looked up via `Object.values(operationsById).find(o => o.name === wanted)`) in addition to `cfg.operationId`. Added a recursion guard via `context._opCallDepth` (cap 4) so an op that calls itself, or a cycle A→B→A, can't blow the stack. The cap only short-circuits the RUN_OPERATION step — subsequent steps in the same frame still run. Effects from the callee bubble up via `updates.push(...)` and merge into the caller's effect list. The callee inherits the same `transaction` (so `$trigger.*` is identical) but its own fresh `$vars`. Regression suite in `__tests__/runOperation.test.js` (4 cases: lookup-by-name, lookup-by-id, recursion cap, missing-op no-op).

## Recent Changes (May 4 2026 — $parentFilter includes trigger occ; run-log persistence)
- **operationExecutor.js (`$parentFilter` setup)**: Walk now starts at `triggerOccId` itself, not its parent. The trigger occurrence's own `filterOverride` is now merged in — required so a page-level NavigationOp (where `transaction.occurrenceId === pageId`) sees the page's NEW override on a filter change. Without this, the source NavigationOp computed against grid filters while the descendant cascade computed against the new override, producing two conflicting writes per filter change (today→tomorrow→today flicker on goal aggregations). Regression test in `__tests__/parentFilterResolution.test.js`.
- **operationExecutor.js (`recordRunLog` site)**: After in-memory `recordRunLog`, now also calls `operationsBridge.persistRunLog?.({ id, operationId, operationName, runAt, durationMs, triggerType, triggerOccurrenceId, transaction, entries })` to mirror the run log to the DB. Best-effort, swallowed errors.
- **bindSocketToStore.js**: `operationsBridge.persistRunLog` wired to `safeEmit(socket, "save_op_run_log", { ...payload, gridId })`. `gridId` pulled from `stateRef.current`. Server stores via `OperationRunLog` (capped at 25 per opId per user).

## Recent Changes (May 3 2026 — Find owns iteration; record-path predicates)
- **operationActions.js (`FIND` action)**: Reads `cfg.over` (default `$allOccurrences`) to obtain the iterable, and evaluates `cfg.predicate` against each record via the new `evalGroupAgainstRecord(group, record, $vars)`. No longer substitutes `$vars.$item` per iteration — the predicate's `rule.left` is interpreted as a dotted record path (`label`, `fields.<fid>.value`, `_ancestors`). New `resolveRecordPath(record, path)` walks the path on the record; tolerates legacy `$item.` prefixes from existing seed data so the runtime accepts both old and new predicate shapes without a migration step.
- **operationActions.js (`CREATE` action)**: Optimistic publish into `$vars.$allItems` extended to keep `$allOccurrences` in sync (alias) and the role-filtered slices ($allContainers / $allPages / $allInstances) when the new instance's role matches. Without this, a FIND step that runs after a CREATE in the same pipeline (using the new $allOccurrences default) wouldn't see the just-created item.
- **operationExecutor.js (`$vars` setup)**: `$allOccurrences`/`$allContainers`/`$allPages`/`$allInstances` are now first-class built-ins, populated alongside `$allItems` and `$allTemplates`/`$allFields`. `$allOccurrences` is an alias of `$allItems`; the others are role-filtered. Lets the editor's collection picker offer all seven without requiring a Source row, and lets the executor resolve them via `resolveExpr` during FIND/Loop.
- **operationExecutor.js (`_SNAPSHOT_SKIP`)**: Expanded to skip the four new built-in collections from per-step var snapshots in the run log.

## Recent Changes (Apr 30 2026 — Ancestor chain walks parent-by-child reverse map)
- **CommitHelpers.js (`_ancestorChain`)**: Now builds a parent-by-child reverse map from each occurrence's `occ.occurrences[]` and walks it as the primary parent source, falling back to `cur.parentId`. Mirrors the executor's `ancestorsFor` so trigger ancestor scoping (`ancestorLabel: "Daily Goals"` etc.) and pipeline `HAS_ANCESTOR` predicates resolve from the same chain. Was a real bug: many seeded grids only set `parentId` on leaf instances; pages and panels track children via `occurrences[]` and have no `parentId`, so the previous `cur.parentId`-only walk stopped after one hop and ancestor-scoped triggers silently failed to match (Tracker: Water Today / Tracker: Tasks Completed Today on Daily Goals navigation).

## Recent Changes (Apr 30 2026 — Local-filter NavigationOp wiring fix + descendant cascade)
- **CommitHelpers.js (`updateOccurrenceFilterOverride`)**: Now calls `operationsBridge.updateLocalOcc({ ...prevOcc, filterOverride })` BEFORE firing NavigationOp. Without this the executor read a stale `filterOverride` from the cached `localOccsById` overlay, so `$schedPage._effectiveFilter` resolved to the old date and "Schedule: Build Day" / "Schedule: Seed Daily Routine" built for the previous day (and their idempotency guards thought the work was already done — symptom: empty schedule when navigating to a fresh day). Function signature also accepts optional `navFieldId` + `date` and forwards them on the NavigationOp transaction so trigger sources binding `$trigger.fieldId` / `$trigger.date` work as a fallback.
- **CommitHelpers.js (descendant cascade)**: After firing NavigationOp for the source occurrence, the helper now walks `occ.occurrences[]` recursively and fires one additional NavigationOp per descendant whose effective filter actually moved. Walk semantics: `filterOverride: null` means "still inheriting, all changed keys propagate, recurse"; `filterOverride: {}` blocks inheritance entirely (descendants under a cleared override are unaffected); a partial override only blocks the keys it owns and propagates the rest. Each descendant fire carries that descendant's own `_ancestorIds` / `_ancestorLabels` chain so `matchAncestorScope` resolves correctly. Two new module-level helpers: `_changedFilterKeys(prev, next)` (diff treats null/undefined as `{}`) and `_walkInheritingDescendants(rootId, changedKeys, occurrencesById)`.
- **Why the cascade exists at all:** When a parent's `filterOverride` changes, descendants' stored data is byte-identical before and after — only their *derived* effective filter shifts. Nothing in Redux/sockets/the executor can detect that by diffing state, so `NavigationOp` has to be enumerated explicitly. This matches the per-affected-occurrence contract every other trigger already follows (`MeasureOp` etc.). Side-effect: page-level filter changes now fire 1 + N NavigationOps where N is the count of inheriting descendants. Existing ops are idempotent so this is correctness-preserving; if it becomes a perf concern, restructure the schedule ops to per-slot scope so they only fire on the slot trigger and not on the page trigger.
- **Why the cache update is BEFORE NavigationOp:** Direct dispatch updates Redux but `localOccsById` is the executor's source of truth for occurrence reads (see bindSocketToStore.js:838). Operations fire from `fireOperations` synchronously after the override write, so the cache must be ahead of the next Redux render.

## Recent Changes (Apr 30 2026 — Operations editor overhaul)
- **operationExecutor.js**: Exported `effectiveFilterFor(occurrenceId, { occurrencesById, gridFilters })` — walks ancestor chain, merges `filterOverride` maps with closer ancestors winning; `gridFilters` acts as the floor; empty override clears merged keys per the existing `getEffectiveFilterForOccurrence` semantics. 5 unit tests cover the merge, override, floor, missing-id, and clear paths.
- **operationExecutor.js (source resolution)**: New entityType branches for `allOccurrences` / `allContainers` / `allPages` / `allInstances` / `allTemplates` (slices of `allItems` / `allTemplates`), `parentFilter` (alias of pre-built `$parentFilter`), and `effectiveFilter` (binds by `targetId` first, falls back to `targetLabel`). (B5, B6, B15)
- **operationExecutor.js (`$trigger`)**: The enrichment loop now filters out any key starting with `iteration` and `_iterationTimeValue` / `_iterationCategoryValue` so legacy transactions don't pollute the trigger snapshot. The panel source no longer copies `iterationTimeValue` / `iterationCategoryValue`. The occurrence source no longer copies `_iterationTimeValue` / `_iterationCategoryValue`. (B14)
- **operationExecutor.js (run-log source snapshot)**: Stopped coercing `$all*` / `$grid` to `[Array(N)]` / `[Object]` strings. Pass the raw values through — `OperationLogPanel.JsonNode` makes everything expandable. (B13)
- **operationExecutor.js (`matchesTrigger`)**: New `matchAncestorScope(to, eventType, transaction)` — when an `onFilterChange` / `onNavigation` trigger has `ancestorId` or `ancestorLabel`, only matches when the changed-filter source is the chosen ancestor or one of its own ancestors. Grid-level `activeFilterValues` changes carry no ancestor data, so any ancestor-scoped trigger ignores them. 4 unit tests cover the new matching semantics. (B16)
- **operationActions.js (`FIND`)**: Removed the `cfg.scope?.dateFieldId` branch. Date filtering belongs in the predicate rules (e.g. `$item.fields.date.value SAME_DAY $today`) — the editor no longer surfaces a separate scope row either. (B8)
- **operationActions.js (`CREATE`)**: Date-typed field writes now validate the resolved value via `isDateValue()`. If the value isn't a `Date` or YYYY-MM-DD-prefixed parseable string, the executor falls back to `$today` rather than stamping a literal string (e.g. the field name `"date"`) into a date field. (B20)
- **CommitHelpers.js (`updateOccurrenceFilterOverride`)**: When called with `occurrencesById` and `modulesById`, fires a `NavigationOp` with `sourceOccurrenceId` plus the source's `_ancestorIds` and `_ancestorLabels` chain — lets `matchesTrigger` ancestor scoping decide which ops to fire. Grid-level filter changes still fire a NavigationOp without ancestor data. (B16)

## Recent Changes (Apr 29 2026 — $today / nav defaults use local-tz day)
- **operationExecutor.js (`executePipeline $vars`)**: `$today` and `$currentDate` now derive from `getFullYear / getMonth / getDate` (local tz), not `_nowDate.toISOString().slice(0, 10)` (UTC). The UTC variant rolls over to "tomorrow" anywhere west of UTC after local-evening — that was the "today is showing tomorrow" bug. New `_localDayString` helper.
- **state/bindSocketToStore.js (`onFullState`)**: filter-nav default resolver (`"today"` / `"startOfWeek"` / `"startOfMonth"`) now uses the same local-tz `localDay()` helper instead of `toISOString().slice(0, 10)`.
- **App.jsx (`handleFilterNav`)**: prev/next date arrows now produce a local-tz `YYYY-MM-DD` string for the same reason — pressing "next day" near midnight no longer skips ahead by the UTC offset.

## Recent Changes (Apr 29 2026 — Iteration vars retired + json: literal)
- **operationExecutor.js (`executePipeline $vars`)**: Removed `$iterationId` / `$iterationValue` / `$iterationFilter` / `$iterationDefinitions` / `$templates` and the `_activeIteration` lookup that fed them. The iteration system was retired in favour of named filters; these vars were dead weight cluttering the run log and the path picker. Saved grid layouts (`grid.templates`) are still reachable via `$grid.templates` if anyone ever needs them. `_SNAPSHOT_SKIP` updated.
- **operationActions.js (`resolveExpr`)**: New `json:` prefix. Anything starting with `json:` is JSON-parsed once and returned as the literal value — used by `ExprOrPath`'s new array mode so users can hand-write a list inline (e.g. `json:["a","b","c"]`). Distinct from `literal:` which is for scalars.

## Recent Changes (Apr 28 2026 — Run-log resolved values + per-iteration loop entries)
- **operationExecutor.js (`executeSteps`)**: Each `action` / `if` log entry now carries `varsBefore` (snapshot of user-facing `$vars` taken just before the step ran), `resolvedConfig` (action `cfg` exprs walked through `resolveExpr`), and `resolvedPredicate` (predicate `rules[]` annotated with `_leftValue` / `_rightValue` per rule). New `loop_iter` entry logged once per iteration with `{ as, index, total, item }` so the run history can show `$preset = {moduleLabel: "Drink Water", slotLabel: "6:00am"}` for each pass instead of just "4 items". Helpers `snapshotVars` / `resolveGroupForLog` / `resolveConfigForLog` added at module top. `_SNAPSHOT_SKIP` excludes `$allItems`/`$allTemplates`/`$allFields`/`$grid` and the executor internals so log payloads stay small.

## Recent Changes (Apr 27 2026 — Operation Priority Sort)
- **operationExecutor.js (`runMatchingOperations`)**: Sort key is now `(priority ?? 5)` first, `sortOrder` second. Lower priority number runs first. Lets the schedule auto-build (priority 1) finish creating slot occurrences before stamp ops (priority 2) and goal aggregations (priority 3) read them.

## Recent Changes (Apr 26 2026 — LINK_OCCURRENCE_TO_PARENT action)
- **operationActions.js**: New `LINK_OCCURRENCE_TO_PARENT` action — emits a `LINK_OCCURRENCE_TO_PARENT` effect with `{ occurrenceId, parentOccurrenceId }`. Optimistically appends the child id to the parent stub inside `$vars.$allOccurrences` (with `includes` guard) so subsequent steps in the same pipeline pass see the link without waiting for the effect to apply. Used by the auto-build operation in the ELSE of "if Due/slot exists" — the container's date FIELD value (FIND_OCCURRENCE → `cfg.dateFieldId`/`cfg.dateExpr`) stays the source of truth for "exists for active date", and this action separately ensures the matched occurrence is wired into `schedPage.occurrences[]`.

## Recent Changes (Apr 25 2026 — Artifact + Textblock Roles + Optimistic Upload)
- **dropHandlers.js**: `handleModuleDrop` now treats `role: "artifact"` and `role: "textblock"` as leaf-placeable (alongside `instance` / undefined) — see `isLeafRole`. Container drops + grid-cell drilldown both honor the new roles. Grid-cell drilldown now scans `state.modules` (not `state.instances`) so it finds artifact / textblock source modules too. `handleFileDrop` destructures `module` from the upload response and dispatches `createModuleAction` + `createOccurrenceAction` BEFORE updating the container — eliminates the blank-spot delay where the container update referenced an occurrence not yet in local state. Reducer is idempotent so the duplicate dispatch on socket arrival is a no-op.
- **LayoutHelpers.js**: `getContainerItemsWithOccurrences` and `getContainerItems` now take `leafModulesLookup` (a merged map of instances + artifacts + textblocks) instead of `instancesLookup`. Return shape `{ instance, occurrence }` is unchanged for back-compat — the `instance` field is now any leaf module. `copyInstanceToContainer` writes `targetType: "module"` (was `"instance"`) so artifact/textblock occurrences pass autofill role detection correctly.
- **CommitHelpers.js**: New `createTextblockInContainer({ dispatch, socket, gridId, userId, containerOccurrence, label })`. Generates IDs client-side, optimistic-dispatches the role:"textblock", kind:"doc" module + occurrence, emits `create_module` / `create_occurrence`, appends the new occurrence ID to the container's `occurrences[]`. Returns `{ moduleId, occurrenceId }`.

## Recent Changes (Apr 23 2026 — Copy-Drag Operation Triggers Fix)
- **LayoutHelpers.js**: `copyInstanceToContainer` now sets `parentId: toContainer._occurrence?.id` on the created occurrence (enables ancestor walk for HAS_ANCESTOR checks). Accepts optional `toPanelId` param, forwarded to `CommitHelpers.createOccurrence`.
- **CommitHelpers.js**: `createOccurrence` now accepts optional `panelId` param; includes it in the OccurrenceCreateOp so `onCreate`/`onAdd` operations with `panelId` filters (e.g. Schedule Stamp) fire on copy-drag.
- **dropHandlers.js**: Copy-drag path now resolves `toPanelOcc` via `findGridPanelOcc` and passes `toPanelId` to `copyInstanceToContainer`, matching the move-drag path's context resolution.

## Recent Changes (Apr 23 2026 — Optimistic Operation Triggers from CommitHelpers)
- **CommitHelpers.js**: `updateOccurrence` now accepts `triggerField = null` param. When provided, calls `operationsBridge.updateLocalOcc(occurrence)` + fires `MeasureOp` with `fieldId` so onChange operations with `allowedFields` match correctly. `FieldRenderer.jsx` passes `triggerField: { fieldId: field.id, value, instanceId }`.
- **CommitHelpers.js**: `createOccurrence` now calls `updateLocalOcc`, fires `OccurrenceCreateOp`, and per-field `MeasureOp` (with `fieldId`/`value`) for each field on the new occurrence. Triggers onAdd + onChange operations immediately on add.
- **CommitHelpers.js**: `deleteOccurrence`/`removeOccurrence` now fire `OccurrenceDeleteOp` first (with occurrence override so executor can still inspect the deleted occurrence), then rAF-deferred per-field `MeasureOp` (so the aggregation sees the occurrence as already gone).
- **dropHandlers.js**: `handleInstanceDrop` now updates `localOccsById` for both source/destination containers and fires per-field `MeasureOp` after move, so onChange aggregations retrigger when instances are drag-moved between slots.

## Recent Changes (Apr 17 2026 — Per-Operation Run Log)
- **operationExecutor.js**: Module-level `runHistory` Map<opId, RunLog[]> (cap 20, newest first). New exports: `getOpRunHistory(opId)`, `getLastOpLog(opId)` (back-compat), `subscribeToOpLog(opId, fn)`. `recordRunLog` unshifts onto history and notifies subscribers with the full list. `runMatchingOperations` creates a `makeLogger()` per op, adds `start`/`end`/`error` entries, and calls `recordRunLog`. `executePipeline` accepts optional 5th `externalLogger` param; reuses it when called from the batch executor or creates its own. Logger attached to `$vars._log` for nested helpers. `executeSteps` adds per-step entries (`action`/`if`/`loop`) with config + result preview. Source-resolution snapshot logged after `$vars` build.

## Recent Changes (Apr 16 2026 — Ancestry Check Replaces pageOccId)
- **operationExecutor.js**: Removed broken `pageOccId` filter from `gatherLoopItems`. Added `parentByChildId` reverse map built in `executePipeline` from all `occ.occurrences[]` arrays, passed via context as `_parentByChildId`. `gatherLoopItems` now adds `_ancestors` (ordered ancestor ID array, closest first) to every loop item. Time filter's `findDateValue` also uses the reverse map for parent-chain date walk.
- **operationActions.js**: Added `HAS_ANCESTOR` (aliased `ARRAY_INCLUDES`) comparator to `evalRule` — checks if an array (e.g. `$item._ancestors`) contains a given ID. Extended `FIND_OCCURRENCE` action to support `moduleLabel` / `moduleLabelExpr` config — looks up module by label in `$allModules`, uses its ID as `targetId`.
- **DB (test grid)**: "Water Today" and "Tasks Completed Today" operations updated — `pageOccId` removed from loop step, FIND_OCCURRENCE step added before loop to dynamically find schedule page by label, `HAS_ANCESTOR` condition added to loop body.

## Recent Changes (Apr 15 2026 — Delete Fires Operations Optimistically)
- **CommitHelpers.js**: `deleteOccurrence` + `removeOccurrence` now accept optional `occurrence` param. Call `operationsBridge.removeLocalOcc(occurrenceId)` before dispatch (evicts from local cache), then fire `MeasureOp` for each field the occurrence had. Mirrors what `onOccurrenceDeleted` does in bindSocketToStore for other windows. Callers in ModuleInstance.jsx, ModuleContainer.jsx, ContainerPool.jsx updated to pass `occurrence`.

## Recent Changes (Apr 15 2026 — DragMode Per-Occurrence + Drag-Out to Board Fix)
- **dropHandlers.js**: Container drag-out from doc to board now uses `drop.dropTarget.context?.pageOccurrenceId` to target the page occurrence (not the panel occurrence). Board panels store containers in page occurrences — the old code added to the panel occurrence which is only page IDs, causing the container to never render.
- **ModuleContainer.jsx**: `containerDragMode` now reads `containerOccurrence?.dragMode ?? module?.defaultDragMode ?? "move"` — occurrence-level dragMode takes priority over module default. `toggleContainerDragModeQuick` now writes to the occurrence via `updateOccurrence` (when occurrence exists) instead of always writing to the module. Toggling one copy's mode no longer affects other occurrences sharing the same module.

## Recent Changes (Apr 15 2026 — Drag-Out from Doc Embeds)
- **dropHandlers.js**: Both `handleInstanceDrop` and `handleContainerDrop` now handle `payload.context.sourceType === "doc-embed"`. Instance: skips `fromC` check, adds `occurrenceId` to `toCOcc.occurrences`, calls `embedDeleteRegistry.get(occurrenceId)?.()` on move mode. Container: same for panel (`toPanelOcc.occurrences`). Enables dragging embedded instances/containers out of docs back to boards.
- **embedRegistry.js**: (existing) `embedDeleteRegistry` Map imported by dropHandlers — completes the drag-out circuit.

## Recent Changes (Apr 10 2026 — DragProvider Doc Container Skip)
- **DragProvider.jsx**: `handleDrop` instance branch now skips doc containers — checks `baseContainers.find(c => c.id === containerId)?.kind === "doc"` before calling `handleInstanceDrop`. Root cause of 3 bugs: (1) extra occurrence created when dragging instance into doc, (2) pending drop popup not closing reliably, (3) blank embed element left after deleting moduleEmbed. All fixed by preventing DragProvider from processing instance drops on doc containers — Editor.jsx's own Pragmatic DnD drop target handles insertion.

## Recent Changes (Apr 9 2026 — Cursor + Drag Fixes)
- **index.css**: Added `cursor: grab !important` to `.module-drag-handle .radial-handle` — previously overridden by Tailwind `cursor-pointer`. `.page-tree-close-btn` hover CSS no longer uses `!important` since inline `opacity: 0` was removed from the button.

## Recent Changes (Apr 9 2026 — Drag Handle Fix: Boolean Flag)
- **dragSystem.js**: Replaced `document.elementFromPoint(e.clientX, e.clientY)` check in `dragstart` interceptor with a `_dragFromHandle` boolean flag (both `useDraggable` and `useDragDrop`). Root cause: `dragstart` fires at the *current* cursor position after the user has moved, not the `pointerdown` position — so `elementFromPoint` was consistently returning elements outside the handle, causing all drags to be cancelled. Flag is set on `pointerdown` on the handle, cleared on first `dragstart` or `pointerup`/`dragend`/`drop`.

## Recent Changes (Apr 6 2026 — Phase E: File Drops + Iframe Removal)
- **DragProvider.jsx**: Added native file drop fallback — `dragover`/`drop` listeners on `.grid-frame` catch OS file drops that Pragmatic DnD might miss. Calls `handleFileDrop` with parsed file payload. Sticky container highlight still in place from earlier fix.
- **dragSystem.js**: Added `DragType.FILE` + `DragType.EXTERNAL` to `DropAccepts.GRID_CELL` — grid cells now accept native file drops (were only accepting panels/modules/artifacts/folders).

## Recent Changes (Apr 6 2026 — Sticky Container Highlight)
- **DragProvider.jsx**: Fixed container highlight sputtering during instance drags. When `getHoveredIds` returns `containerId = null` (cursor in gaps/margins between instances) but still inside the same panel, keeps the previous `containerId` instead of clearing the highlight. Uses `lastHotRef.current` to compare.

## Recent Changes (Apr 3 2026 — Day Page Duplicate Fix)
- **operationExecutor.js:178**: `case "onNavigation"` no longer matches `transactionType == null`. Was: `return transactionType === "NavigationOp" || transactionType == null` → now: `return transactionType === "NavigationOp"`. Same fix for `onIteration` alias. Root cause of 8 duplicate day pages on every load — `onNavigation` was firing on every `full_state` receive because null transactionType matched it.

## Recent Changes (Apr 2 2026 — operationActions + operationExecutor: Day Page Support)
- **operationActions.js** — `FIND_OCCURRENCE` extended: now filters candidates with `Array.isArray` guard, skips `meta.isTemplate === true` occurrences, and supports optional `dateFieldId` + `dateExpr` for date-field matching (finds occurrence where a date field equals the target date by `toDateString()` comparison).
- **operationActions.js** — 3 new action cases added before `PICK_RANDOM_FROM_POOL`:
  - `COMPUTE_TEXTMAP_FROM_TEMPLATE`: deep-clones a template occurrence's `textmap`, substitutes `[token]` strings using `resolveExpr` values, stores result in `$vars` (default `$computedTextmap`). Pure computation — no effect emitted.
  - `CREATE_OCCURRENCE_FOR_MODULE`: creates an occurrence for an existing module (no new module created). Supports `dateFieldId`/`dateExpr` for seeding an initial date field, and `textmapVar` to pick up a pre-computed textmap from `$vars`. Emits `CREATE_OCCURRENCE_FOR_MODULE` effect. Sets `$lastCreatedOccurrenceId`.
  - `FILL_FROM_TEMPLATE`: applies a substituted textmap clone to an EXISTING occurrence. Use for re-filling already-created pages. Emits `UPDATE_OCCURRENCE` effect.
- **operationExecutor.js** — Two new built-in `$vars` added after `$activeDate`:
  - `$activeDateLabel`: human-readable label for the active filter date (e.g. "Thu, Apr 3"). Defaults to today when no date filter active.
  - `$activeDayOfWeek`: full weekday name for active filter date (e.g. "Thursday"). Defaults to today.

## Recent Changes (Mar 31 2026 — Offline Queue + Optimistic Operations + Highlight Fix)
- **offlineQueue.js** (NEW): Module-level queue buffers `socket.emit` calls when disconnected. `safeEmit(socket, event, data)` is a drop-in replacement — emits immediately when connected, queues when offline. Deduplicates update events per entity (keeps latest). `flushOfflineQueue(socket)` replays all queued mutations in order.
- **CommitHelpers.js**: All `socket?.emit()` calls replaced with `safeEmit(socket, ...)` from offlineQueue.js. Added `import { safeEmit } from "./offlineQueue"`. Mutations now buffer automatically when offline and replay after reconnect + full_state.
- **CommitHelpers.js**: Imported `operationsBridge` from `bindSocketToStore`. `setOccurrenceFieldValue` now calls `operationsBridge.updateLocalOcc(updatedOcc)` + `operationsBridge.fireOperations("MeasureOp", ...)` immediately after local dispatch — operations run instantly without waiting for server echo.
- **DragProvider.jsx**: Fixed container highlight during instance drags. `handleDragMove` now calls `setDropHighlight(containerId)` when hovered target changes (was intentionally skipped, relying on `handleDragOver` which doesn't fire when hovering over instances inside containers — innermost drop target wins in Pragmatic DnD).

## Recent Changes (Mar 30 2026 — Operations Trigger Fixes)
- **operationExecutor.js**: (1) Added 6 missing trigger cases to `matchesTrigger`: `onAdd` (→ OccurrenceCreateOp), `onRemove` (→ OccurrenceDeleteOp), `onReorder` (→ OccurrenceListOp same-container), `onUncomplete` (→ MeasureOp falsy value), `onButton` (→ ButtonOp), `onNodeInput` (→ NodeInputOp). All 14 EVENT_TYPES in OperationsTab.jsx now have matching executor cases. (2) Fixed `scopeContainerId` in `gatherLoopItems` — was reading `scopeMod?.occurrences` (module, always empty). Now scans `occurrencesById` for occurrences targeting the container module and collects their child IDs.

## Recent Changes (Mar 30 2026 — DnD Cleanup)
- **DragProvider.jsx**: (1) Removed doc-container skip (`if (toC.kind === "doc") { clearSession(); return; }`) — doc containers now accept drops normally, Editor.jsx handles insertion as `moduleEmbed`. (2) Fixed `shouldHighlight` to highlight containers for ALL drag types except panel drags (was only instance/external). (3) Removed dead `canvasMeta` commented-out code block.

## Recent Changes (Mar 28 2026 — Dual Sidebar Drag Support)
- **dragSystem.js**: Added `FOLDER: "folder"` to `DragType`. Added `DragType.FOLDER` to `DropAccepts.GRID_CELL`, `PANEL_CONTENT`, `PAGE_CONTENT`.
- **DragProvider.jsx**: Added folder drop handler (lines ~1929-1951) — when `type === "folder"` dropped on panel, iterates `childOccurrenceIds`, creates a page module for each child doc, adds page occurrences to panel. **Bug fix**: used `(state?.modules || []).find(m => m.id === childOcc.targetId)` instead of `state?.modulesById?.[...]` (state has `modules` array, not `modulesById` map). Added `"tree-anchor"` and `"tree-page"` to module sourceType whitelist in the MODULE drop handler condition (line ~1672).

## Recent Changes (Mar 27 2026 — ViewType Rename: artifact→display)
- **DragProvider.jsx**: `isExistingArtifactPanel` check `viewType === "artifact"` → `viewType === "display"`. Both `createView` calls that set `viewType: "artifact"` updated to `viewType: "display"` (OS file drop handler + artifact grid-cell drop handler).

## Recent Changes (Mar 26 2026 — Bug Fixes: OS File Drop + Panel Cycler)
- **DragProvider.jsx**: Bug #13 — OS file drops now upload via `/api/artifacts/upload` (fetch + FormData). Creates new artifact panel at drop location, or switches active doc if dropping on existing artifact panel. FILE type removed from old text-instance handler. Deduplication updated: `__file__` drops deduplicate by payload id alone (ignoring containerId), preventing double uploads when both container-list and panel-content fire.
- **DragProvider.jsx**: Bug #14 — `cyclePanelStack` now cycles N+1 states (N panels + "all hidden"). Accepts `cellKey` param for calling from empty-pocket button. `visibleIdx === -1` treated as "all hidden" state at index N.
- **DragProvider.jsx**: Bug (canvas drag-out) — Added `|| payload?.sourceType === "canvas"` to module drop handler condition so CanvasCard drag-out works.

## Recent Changes (Mar 25 2026 — onLoad Trigger + Time Filter Fix)
- **operationExecutor.js**: `shouldTrigger` — added backward compat for old operations (no `triggerTypes` array) to fire on load. Uses `hasExplicitArray` flag: legacy `triggerType`-only operations auto-fire on load unless manual-only. New operations with explicit `triggerTypes` array are respected literally.
- **operationExecutor.js**: `gatherLoopItems` time filter — now checks occurrence's date-type field values (scheduledDate) in addition to legacy `iteration.timeValue`. Walks up parent chain (instance → container → panel) via `findDateValue()` to find a date when the occurrence itself has none. Uses `$activeDate` from filter nav as the comparison target instead of hardcoded `new Date()`. Occurrences with no date at all treated as persistent (pass any time filter).

## Recent Changes (Mar 23 2026 — Panel Cycler Persistence Fix)
- **DragProvider.jsx**: `cyclePanelStack` now emits `update_module` for ALL panels in the stack (was only emitting for the next visible panel). Hidden panels' `display: "none"` is now persisted to server, fixing position loss on reload.

## Recent Changes (Mar 22 2026 — Dynamic Page Creation via Operations Pipeline)
- **operationActions.js**: Added template string interpolation to `resolveExpr` — `"daypage ${$today}"` resolves vars inside `${...}` patterns. Added `FIND_MODULE` action (searches `$allModules` by name/label, sets `$foundModule`/`$foundModuleId`). Added `FIND_OCCURRENCE` action (searches by targetId, sets `$foundOccurrence`/`$foundOccurrenceId`). Added `CREATE_MODULE` action (creates module + occurrence in one shot, sets `$lastCreatedModuleId`/`$lastCreatedOccurrenceId`). Removed `CREATE_OCCURRENCE_WITH_ITERATION` and `NAVIGATE_DAY_PAGE` action types (replaced by generic pipeline).

## Key Files

| File | Purpose | Last Changed |
|------|---------|--------------|
| `DragProvider.jsx` | Drag state coordinator. Manages `monitorForElements`. Handles all drop logic: move/copy/copylink instances+containers+panels. Skips normal move when target is `kind: "doc"` (DocContainer handles it). Handles field drops from command-center → adds to instance fieldBindings. **Mar 10: Refactored to use draftOccurrences map instead of draftContainers/draftPanels occurrence arrays for live preview. All drop handlers now pass occurrence objects (panelOccurrence, containerOccurrence) to LayoutHelpers.** | Mar 2026 |
| `CommitHelpers.js` | All CRUD operations. **ONLY place that calls socket.emit**. Exports: createInstanceInContainer, deleteOccurrence, updatePanel, deletePanel, updateContainer, deleteContainer, createView, updateView, updateOccurrence, updateGrid, etc. | Stable |
| `CalculationHelpers.js` | All 15 aggregation types. `calculateDerivedField` checks `metric.blockTree` first (evaluateBlockTree via require()), falls back to flat `allowedFields`. | Recent |
| `LayoutHelpers.js` | Occurrence filtering (getPanelContainers, getContainerItems, getContainerItemsWithOccurrences, occurrenceMatchesIteration). Panel duplication/linking/splitting. **Mar 10: Major refactor — occurrence.occurrences is the SOLE source of ordering. All add/remove/reorder/move functions now take `panelOccurrence`/`containerOccurrence` params and call updateOccurrence (not updatePanel/updateContainer). No module.occurrences fallback anywhere.** | Mar 2026 |
| `dragSystem.js` | Pragmatic DnD hooks: useDraggable, useDroppable, useDragDrop. DragType enum (PANEL, CONTAINER, INSTANCE, FIELD, ARTIFACT, EXTERNAL). DropAccepts map. `dragHandleRef` param restricts drag origin to specific element. **Mar 19: Phase A perf — haptic vibrate(15) on drag start, vibrate([8,30,8]) on drop, 80ms hold delay, 32ms hit-test throttle, 4px hit-test cache.** | Mar 19 |
| `StyleHelpers.js` | `resolveContainerStyle`, `resolveInstanceStyle`, `styleToCSS`. Cascading style resolution: panel defaults → container overrides → instance overrides. | Recent |
| `CommitHelpers.js` exports (key): | createInstanceInContainer, deleteOccurrence, deletePanel, deleteContainer, updatePanel, updateContainer, updateOccurrence, updateGrid, createView, updateView, saveTemplate, fillFromTemplate | Stable |
| `blockTypes.js` | **MOVED here from blocks/** — Block type constants for visual operations builder. | Mar 2026 |
| `blockEvaluator.js` | **MOVED here from blocks/** — Recursive block tree evaluator. | Mar 2026 |
| `operationActions.js` | **MOVED here from blocks/** — resolveExpr, evalRule, evalGroup, extractFieldValuesFiltered, executeActionItem. | Mar 2026 |
| `operationExecutor.js` | **MOVED here from blocks/** — executePipeline, runMatchingOperations. Imports operationActions. | Mar 2026 |
| `offlineQueue.js` | **NEW** Offline mutation queue. `safeEmit(socket, event, data)` buffers when disconnected, deduplicates updates. `flushOfflineQueue(socket)` replays after reconnect. | Mar 31 |
| `colorHelpers.js` | `hexToRgba(hex, alpha)`, `lightenHex(hex, amount)` — single authoritative source (was duplicated 3x). | Mar 2026 |
| `useTheme.js` | **NEW** Theme hook. `useTheme()` → `{ theme, setTheme, themes }`. `SYSTEM_THEMES` export (moduli-dark/moduli-light/midnight). Persists to localStorage. Sets `data-theme` attr + `dark` class on `<html>`. Called in App.jsx root. | Mar 2026 |
| `IterationHelpers.js` | Iteration/time helpers (used by LayoutHelpers). | Stable |
| `calculationConstants.js` | **NEW** — Pure data constants extracted from CalculationHelpers.js: AGGREGATIONS (15), COMPARISONS, INPUT_FLOWS, DERIVED_FLOWS, PERSISTENCE_MODES, SCOPES, TIME_FILTERS, TIME_FILTER_MULTIPLIERS. 270 lines. | Mar 16 |
| `TransactionHelpers.js` | **NEW** — Socket wrappers for transaction operations: getTransactions, undoTransaction, redoTransaction, getUndoState. All transaction socket.emit calls go through here. | Mar 16 |

## Architecture Rules
- CommitHelpers is the **contract boundary** — components call CommitHelpers, not socket directly.
- DragProvider reads session refs (not React state) for immediate access during async drop handling.
- LayoutHelpers.normalizeId is a private function (not exported).
- splitPartnerId stored on panel entity to track split relationships.

## Recent Changes (Mar 20 2026 — Post-Review Cleanup)
- **dragSystem.js**: Removed dead `rect` variable in both `useDraggable` (was line 363) and `useDragDrop` (was line 750). Assigned but never read after `offsetX`/`offsetY` were hardcoded.

## Recent Changes (Mar 20 2026 — Phase B DragProvider Performance)
- **DragProvider.jsx**:
  - **B1**: Consolidated 3 `elementsFromPoint` calls into `getHoveredIds(x, y)` — single walk extracts panelId+containerId+instanceId. Individual getters kept for handleDrop fallbacks.
  - **B2**: `lastPreviewRef` caches last preview target — instance/container preview blocks skip draft mutations when same target still hovered.
  - **B3**: `dragConfigRef` holds `activeCell`, `setActiveCell`, `rows`, `cols`, `isMobile`. `handleDragMove` dep array reduced from 13 to 6. `handleDragStart` also uses ref for isMobile.

## Recent Changes (Mar 19 2026 — Phase A Drag Performance)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers:
  - **A1 Haptic**: `navigator.vibrate(15)` on drag start, `navigator.vibrate([8, 30, 8])` on successful drop (double-tap feel).
  - **A2 Hold delay**: `_TOUCH_HOLD_MS = 80` — touchmove returns early if finger held < 80ms. Prevents accidental drags from scrolling.
  - **A3 Throttle**: `_HIT_TEST_INTERVAL = 32` — expensive `_findDropTarget` (elementsFromPoint + DOM walk) runs at most every 32ms. Pill position still updates at 60fps.
  - **A4 Cache**: `_HIT_CACHE_DIST = 4` — skip hit-test if pointer moved < 4px since last check (squared distance comparison, no sqrt).

## Recent Changes (Mar 19 2026 — Mobile Drag + UI Fixes)
- **dragSystem.js**: Both `useDraggable` and `useDragDrop` mobile touch handlers: (1) Removed `e.preventDefault()` from `onStart` — CSS `touch-action:none` on triggerEl handles OS gesture suppression, native click/pointer events now fire for taps. (2) Cache `getBoundingClientRect()` at touchstart (`cachedRect`), not first-move. (3) Only `e.preventDefault()` in `onMove` AFTER threshold crossed (sub-threshold jitter doesn't cancel native click). (4) `document.documentElement.style.touchAction/overscrollBehavior` only set when drag actually starts, cleared on drag end only. (5) Removed synthetic `MouseEvent('click')` dispatch from `onEnd` — no longer needed since touchstart doesn't preventDefault. (6) Removed `touchStartTime` variable.

## Recent Changes (Mar 18 2026 — Mobile Fixes)
- **DragProvider.jsx**: `handleDragStart` now sets `document.documentElement.style.touchAction = 'none'` when `isMobile` — prevents Android split-screen gesture from intercepting drags. `clearSession` restores `touchAction = ''`. Added `isMobile` to `handleDragStart` dependency array.

## Recent Changes (Mar 18 2026 — Mobile Grid Nav)
- **DragProvider.jsx**: Added `activeCell`, `setActiveCell`, `isMobile` props. New `dragEdgeTimerRef` + `dragEdgeIndicatorRef` refs. In `handleDragMove` RAF callback: mobile drag-to-edge detection with 40px edge zones, 600ms dwell timer, and pulsing edge glow indicator (direct DOM). `clearSession` clears timer + removes indicator element.

## Recent Changes (Mar 16 2026 — Cleanup Sprint S2+S3+S6)
- **CommitHelpers.js**: Added `updateGridFilter({ dispatch, socket, gridId, patch, emit })`. Field CRUD functions (createField/updateField/deleteField) were already present.
- **TransactionHelpers.js** (NEW): 4 socket wrapper functions for transaction ops. TransactionHistory.jsx + useUndoRedo.js now use these instead of direct socket.emit.
- **calculationConstants.js** (NEW): All 8 constant blocks extracted from CalculationHelpers.js (270 lines). CalculationHelpers.js now re-exports from here. CalculationHelpers.js: 1210 → 937 lines.
- **LayoutHelpers.js** (unchanged): Imports stay as-is.

## Recent Changes (Mar 14 2026 — Cleanup Sprint)
- **LayoutHelpers.js**: Removed all 7 direct `socket.emit("create_occurrence")` calls. Replaced with `CommitHelpers.createOccurrence({ dispatch, socket, occurrence, emit })`. Architecture violation fixed — CommitHelpers is now the sole socket caller.

## Recent Changes (Mar 2026 — U1 Undo FLIP Animation + Canvas)
- **CommitHelpers.js**: `createInstanceInContainer` now accepts `occurrenceId` + `initialMeta` params, includes them in `create_instance_in_container` socket event.
- **App.jsx uses `useAnimations`** for U1 — see client/src/CLAUDE.md.

## Recent Changes (Mar 14 2026 — D3 Doc Pill Drag)
- **DragProvider.jsx**: Added `|| payload?.sourceType === "doc"` to the `type: "module"` handler condition (line ~1405). Doc-sourced pills (InstancePillNode) now use the same copy-to-container path as CC/pool drags.

## Recent Changes (Mar 13 2026 — Grid Cell Drop: Drilldown + Artifact Panel)
- **dragSystem.js**: Added `DragType.ARTIFACT` to `DropAccepts.GRID_CELL` so ManifestTree artifact nodes can be dropped on empty grid cells.
- **DragProvider.jsx** — 3 new grid-cell drop handlers inside the MODULE CC block:
  - `role === "container" + grid-cell`: creates new Panel via `createPanelInGrid`, then adds the container as its sole child via `createContainerInPanel` (drilldown — container fills the panel).
  - `role === "instance" + grid-cell`: creates new Panel → new Container → places instance inside via `copyInstanceToContainer` (drilldown — single instance panel).
- **DragProvider.jsx** — Artifact grid-cell handler added to existing `DragType.ARTIFACT` block:
  - `type === "artifact" + grid-cell`: creates new Panel via `createPanelInGrid`, creates View (`viewType: "artifact"`, `activeOccurrenceId`), updates panel occurrence with `viewId`.
  - Existing panel-content artifact drop (switch active doc) is unchanged.

## Recent Changes (Mar 13 2026 — Bug 17: Remove hotTarget React state)
- **DragProvider.jsx**: Removed `hotTarget` useState entirely. All `setHotTarget` calls deleted. `hotContextValue` now only contains `panelOverCellId`. Container highlight was already handled by `setDropHighlight` (direct DOM `data-drop-active` attribute) — `hotTarget` was redundant.
- **Panel.jsx**: Removed `useDragHotContext` import, `hotTarget` destructure, `isHotPanel` derived var, and `isHot={...}` prop on Container.
- **Container.jsx**: Removed `isHot` param, dead `highlightDrop` variable (was computed but never used in JSX), and `isHot` passthrough to `DocEditorShell`.
- **Editor.jsx**: Removed `isHot` prop. Outline now driven by `isDropTarget` only. `data-drop-active` CSS on outer container already handles the blue ring during drag.
- **dragSystem.js**: Updated `DragHotContext` default to `{ panelOverCellId: null }` (removed `hotTarget`).
- **Result**: Zero React re-renders during drag hover for container highlight. DOM mutation path (`data-drop-active`) was already in place — this just removes the parallel React state path.

## Recent Changes (Mar 12 2026 — Artifact Drop → Panel View Switch)
- **DragProvider.jsx**: Added handler for `type: "artifact"` drops. When a DocNode dragged from ManifestTree is dropped on a `panel-content` drop zone (and no container is targeted), calls `CommitHelpers.updateView({ activeOccurrenceId: payload.occurrenceId })` to switch the panel's active document. Panel occurrence found via `Object.values(occurrencesById).find(o => o.targetId === panelId)`. View looked up via `state?.viewsById?.[viewId]`.

## Recent Changes (Mar 2026 — cyclePanelStack Click-Twice Fix)
- **DragProvider.jsx**: `cyclePanelStack` — replaced `visibleIdx = stack.findIndex(p => panelDisplay(p) !== "none")` with `currIdx = stack.findIndex(p => p.id === panelId)`. Bug: when 2+ panels both have `display: "block"` (default, no explicit setting), `findIndex` found the FIRST panel as visible even though the user was looking at a DIFFERENT panel (the last-rendered one on top). Now uses the `panelId` from the click handler (always the panel whose button was clicked) as the anchor index. No longer relies on `layout.style.display` to find current position.

## Recent Changes (Mar 2026 — DragType.MODULE Fix — CRITICAL)
- **dragSystem.js**: Added `DragType.MODULE = "module"` to `DragType` enum. Added `DragType.MODULE` to `DropAccepts.GRID_CELL` (panel-role drops), `PANEL_CONTENT` (container/instance-role drops), and `CONTAINER_LIST` (instance-role drops). **Root cause of broken CC drag**: ALL drop zones rejected CC module drags because `"module"` was not in any `accepts` list. Build required for effect.

## Recent Changes (Mar 2026 — CC Module Drop All Roles + Panel Fallback)
- **DragProvider.jsx**: Replaced `payload?.type === "module" && payload?.sourceType === "command-center" && containerId` handler with a full role-based handler:
  - `role === "instance"` (or undefined): drops on container OR panel (panel fallback = first droppable container in panel). Removes `&& containerId` requirement.
  - `role === "container"`: drops on panel → calls `LayoutHelpers.createContainerInPanel`.
  - `role === "panel"`: drops on grid cell → updates occurrence placement to new cell (uses `panelModule._occurrenceId` to find existing occurrence).

## Recent Changes (Mar 2026 — Sortable Wire + DragContext Split)
- **DragProvider.jsx**: Added sortable check before instance reorder — `if (sameContainer && toC?.behaviorMode === "own" && toC?.behavior?.sortable === false) { clearSession(); return; }`. Placed right after `const sameContainer = fromC.id === toC.id`.

## Recent Changes (Mar 2026 — Phase 5.2 Behavior Toggles)
- **LayoutHelpers.js**: Added `resolveBehavior(entity, parent)` — returns `{ sortable, draggable, droppable }`, cascading from parent if `entity.behaviorMode === "inherit"`. Default: all true.
- **DragProvider.jsx**: Added droppable check — if `toC.behaviorMode === "own" && toC.behavior?.droppable === false`, drops onto that container are rejected.

## Recent Changes (Mar 2026 — Operation Drop from Command Center)
- **DragProvider.jsx**: Added handler for `type: "operation"` drops with `sourceType: "command-center"`. When dropped onto an instance, adds to `instance.operationBindings` with `widgetType: "trigger"`. Dedup check prevents duplicate binding.
- **DragProvider.jsx**: Added handler for `type: "module"` drops with `sourceType: "command-center"`. When dropped onto a container, calls `LayoutHelpers.copyInstanceToContainer` (iterationMode: "persistent"). Handler placed between OPERATION and FIELD handlers.

## Recent Changes (Mar 2026 — DragContext Split)
- **dragSystem.js**: Added `DragHotContext` + `useDragHotContext()`. This context only contains `{ hotTarget, panelOverCellId }` — things that change during drag hover. Main `DragContext` no longer includes these.
- **DragProvider.jsx**: `contextValue` (stable) no longer has `hotTarget`/`panelOverCellId` in deps. New `hotContextValue = useMemo(()=>({hotTarget, panelOverCellId}), [...])`. Wraps children with `<DragHotContext.Provider value={hotContextValue}>` inside `<DragContext.Provider>`.
- **Impact**: During drag hover (container crossings), only `DragHotContext` changes. `ModuleContainer`/`ModuleInstance` subscribe only to stable `DragContext` → no re-renders during hover. `ModulePanel` subscribes to `useDragHotContext()` for `hotTarget`.
- **CommitHelpers.js**: Added 3 operation action functions: `setOccurrenceFieldValue`, `moveOccurrence`, `createOccurrenceInContainer`.
- **DragProvider.jsx**: `lastHotRef` deduplication — `setHotTarget` only fires when panel/container/instance actually changes. `clearSession` resets `lastHotRef`.
- **Deleted**: `Panel.jsx`, `SortableContainer.jsx`, `SortableInstance.jsx` — fully replaced by `Module.jsx`.

## Recent Changes (Feb 21)
- LayoutHelpers.js: Added copyPanel, copylinkPanel, splitPanel, unsplitPanel functions

## Recent Changes (2026-07-12 — evalRule: array-aware CONTAINS + empty checks (tags field-check))
- **`operationActions.js` (`evalRule`)** — feed conditions can now do a FIELD CHECK on tags-style
  array fields (user directive 2026-07-12): (1) `CONTAINS`/`NOT_CONTAINS` on an ARRAY left match
  by EXACT member equality (same semantic as ARRAY_INCLUDES) instead of substring-over-stringified
  ("art" no longer matches ["smart"]); strings keep substring semantics. (2) `IS_EMPTY`/
  `IS_NOT_EMPTY` treat an empty array as empty, so IS_NOT_EMPTY doubles as "occurrence HAS this
  field with a value". One change covers feeds, FIND predicates, grid filters, and table column
  filters (evalRuleAgainstRecord routes through evalRule). Tests: 5 in
  operationActions.unified.test.js + 3 feed-level in feedSync.test.js.

## Recent Changes (2026-08-06 (2) — graphView.js NEW: the graph fills its container and zooms)
- **`graphView.js` (NEW, pure, 17 tests)** — user 2026-08-06: *"the graph should be the size of the
  container (so the size of the page), and have it be zoomable."* View state is
  `{ zoom, cx, cy }` where **cx/cy are the series centre in PERCENT**, and that coordinate choice is
  the whole reason zoom costs nothing: ECharts already resolves a radial series' percent
  `radius`/`center` against the host box, so scaling the radius and moving the centre zooms and pans
  **without any file here knowing the container's size**. `graphOption` just multiplies the radius
  and writes the centre; `EChart` reads gestures; neither computes any of it.
- **`zoomAt` holds the point under the pointer FIXED** (`c' = p - (p - c)·z'/z`) — anything else
  zooms toward the middle of the box, which feels like the chart running from your cursor. It uses
  the RATIO ACTUALLY APPLIED, not the requested factor, so at the zoom clamp the chart does not
  slide sideways while the zoom stands still.
- **The pan clamp is DERIVED FROM THE RADIUS** (`46 × (zoom-1)`), so at zoom 1 the range collapses
  to exactly `[50,50]`: an unzoomed chart cannot be dragged off centre. "Panning requires zoom"
  falls out of the geometry rather than a boolean someone forgets to check — the same posture as
  `assertNotProtected`.
- A stored view is CLAMPED, never trusted (`meta.graph` is user-editable data), matching the
  unknown-chart-type fallback: a bad zoom degrades to a legal one instead of blanking the surface.

## Recent Changes (2026-08-06 (3) — graphData: a fed hierarchy, and the guard that protects it)
- **`graphData.js` — a row is addressable by the occurrence it STANDS FOR, not only by its own id.**
  A feed materializes each match as a COPY with a NEW id carrying `meta.feedSourceId`, and the
  copy's parent-reference field still names the SOURCE it was copied from. Without an alias every
  fed row looks parentless: measured on the real 128-emotion wheel, the 3-ring sunburst came back
  as **50 flat roots at depth 1**. `memberIdFor` maps both keys; own ids register FIRST and are
  never overwritten, so a hand-dragged row wins a collision with some copy's source id (the two
  kinds of row coexist — feedSync only sweeps what it minted). The root filter resolves through the
  SAME map as the child index, or a fed row would be neither a root nor anyone's child and would
  vanish from the chart.
- **`limit: 0` on a feed means FIFTY.** `resolveFeedItems` reads `Number(feed.limit) > 0 ? … : 50`,
  so a graph feeding a whole board silently draws a third of itself. There is no "unlimited"
  sentinel; set an explicit cap above the board.
- **`__tests__/noDomainKnowledge.test.js` gained a GRAPH case** — the graph surface must not contain
  "emotion" / "feeling" / "mood". **The patterns are plain SUBSTRINGS, deliberately not `\b`-anchored:
  a word boundary does not fire inside an identifier (`_` and camelCase are word characters), so
  `EMOTION_RINGS` slipped straight through the first version.** Verified by planting exactly that
  constant. "wheel" is NOT banned — it is a real input device (`WheelEvent`, `wheelFactor`) and the
  rule only ever matched the zoom gesture code; a guard that cries wolf gets weakened later.

## Recent Changes (2026-08-06 (4) — prefill `sum` and FLOW: opt-in, per row)
- **The question** (task list): should `combine: "sum"` honour a value's `flow`, where `"out"` means
  the number is negative in every other aggregation on this grid?
- **DECIDED FROM DATA, not taste.** Measured on poms grid before choosing: the macro fields prefill
  actually targets (Calories / Protein / Carbs / Fats, wired by 0042) carry **`flowToggle: false`
  and every stored value is `flow: "replace"`** — flow is meaningless there and there is no UI to
  set it. **`Amount` is the exact opposite**: `flowToggle: true`, 24 values split **out:16 / in:5 /
  replace:3**. Summing money without direction would be plainly wrong; negating macros would be
  noise. So neither "always" nor "never" is correct, and it is CONFIGURATION.
- **`flowAware: true` per map row, default OFF** — so the shipped nutrition prefill behaves
  byte-identically and nothing had to be re-migrated. `out` NEGATES, the same convention every
  aggregation here already uses. 2 tests, the opt-in one A/B'd (defeating the flag fails it).
