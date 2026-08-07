# Intake — what we ASK when something comes into the grid

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: AUDIT COMPLETE, BUILD NOT STARTED.** Sequenced after the artifact-spread and prefill
> plans. Supersedes `2026-08-06-jonah-link-follow.md` (folded in as Task 6).

**User direction (2026-08-06):**
> "an audit on bringing stuff into the system. via quickadd, draganddrop, or jonah. we should be
> able to drag links in and it asks if it wants it as a page, container, minitextblock link, etc.
> asks if i want to grab other links too in the same vain. things like that. a full audit on what
> to do when i drag in files and artifacts. we need to have an artifact folder like templates too
> where we keep the actual files. so its a focus on artifacts and links and what we ask when
> bringing them in to the grid."
> …plus: *"image should ask if it wants to create a canvas with it and if we want outline version
> (super imposed drawing off what i brought in)"* and *"think creatively with this audit."*

---

## PART 1 — THE AUDIT (measured, not guessed)

Every intake path was read end to end: `helpers/dropHandlers.js` (`handleFileDrop`,
`handleExternalDrop`, `handleModuleDrop`), `ui/Editor.jsx` (`handleFileDrop` — the doc arm),
`ui/QuickAddMenu.jsx` (`tileKindsForRole`), `helpers/artifactUpload.js`,
`server/services/assistantTools.js` (the 4 import tools), `server/server.js`
(`/api/artifacts/upload`, `/api/images/*`).

### What happens today

| Payload | → container | → page gap | → canvas page | → doc body | → empty grid cell |
| --- | --- | --- | --- | --- | --- |
| **OS file** | artifact instance in it | page's first non-doc container | free-positioned artifact at the point | `moduleEmbed` at the cursor | mints panel + container + artifact |
| **Link / short text** | instance whose **LABEL is the raw URL** | *(same)* | — | `instancePill` | — |
| **HTML / long text** | `import_text` → a real subtree | under the page occ | under the page occ | — | panel + a doc page under **Imports** |
| **Wikipedia title** | — | — | — | — | — |

QuickAdd adds: `artifact` (bare OS file dialog) and `image` (ImagePicker: web search / upload /
URL). Jonah adds: `wikipedia_import`, `wikipedia_import_batch`, `wikipedia_links`,
`import_markdown`, `import_html` — all `requires_confirm`.

### The seven findings

**1. NOTHING ASKS. Anywhere.** Every drop decides silently and commits. The only confirmation
surface in the whole product is Jonah's `ConfirmCard`. Drag-in gets as far as a *preview pill*
("Convert HTML → modules") that announces the decision already made — it offers no choice. So the
same file dropped two feet apart becomes two different things and the user is never told why.

**2. A dropped LINK is the weakest path in the app, and three existing capabilities never meet at
it.** `handleExternalDrop`'s legacy fallback mints an instance whose **label is the raw URL**. Yet:
the importer already mints proper link chips (`markdownImporter.buildInlineLink` →
`role:"textblock" kind:"inline"` carrying `meta.link`), `TextblockCard` already renders
`meta.link.kind === "occurrence"` as an in-app jump, and Jonah can import the whole article behind
that URL. Everything needed to make a dropped link *good* already exists — nothing routes to it.

**3. Files have no home.** Bytes land in `uploads/user/YYYY-MM/` (sharded, sha256-deduped,
thumbnailed — that half is in good shape). The artifact **occurrence** lands wherever the pointer
was and is listed by nothing. Command Center's Files tab scrapes `modulesById` for
`role:"artifact"` because there is no folder to read. **Templates solved exactly this problem** in
migration 0035: one protected folder, `meta.protected` as the marker, location as the only
identity. Artifacts never got the same treatment.

**4. Two intake paths disagree about homelessness, in the same drop zone.** On an empty grid cell:
a *file* mints panel+container+artifact and files it nowhere; *text* mints a panel and wraps the
import in a doc page under an **Imports** folder. Same gesture, same cell, one gets a folder and
one doesn't.

**5. The importer's own output is unreachable from a drop.** `import_text` mints containers,
textblocks, artifacts, **pipe tables**, and link chips. A user dragging a chunk of a page in gets
all of that. A user dragging the *link to that same page* gets a label. The difference is invisible
and unexplained.

**6. Multi-file is uniform but shapeless.** N files → N sibling artifacts. There is no "put these
in a container", no "make a folder page", no "this is a set".

**7. An image is only ever a picture.** It becomes an `ArtifactCard`. It is never offered as a
canvas backdrop, never traced, never set as the field value of the thing it was dropped on — even
though `ImagePickerMenu` already does that last one from the *other* direction (pick an image *for*
a field).

### What is already good and must not be re-built

- **Upload lifecycle** — `helpers/artifactUpload.js` is the single core (optimistic placeholder →
  POST → placement re-persist). Both the board arm and the doc arm use it. Keep.
- **Storage** — sha256 dedup, YYYY-MM sharding, sharp thumbnails (256/1024 WebP), EXIF. Keep.
- **`resolveFileRef`** — absolute URLs pass through, relative prepend `/uploads/`. This is why
  remote images work with no upload. Keep; intake must keep producing both shapes.
- **Confirm-card machinery** — Jonah's `requires_confirm` + `ConfirmCard` + `/assistant/confirm`
  is a working ask-then-do loop. **Intake should reuse this shape rather than invent a second one.**

---

## PART 2 — THE DESIGN

### One idea: intake resolves a PAYLOAD, then offers SHAPES

Today each code path hard-codes payload→shape. Instead:

```
  drop / paste / QuickAdd / Jonah
        ↓
  classifyIntake(payload, destination)   →  { payload, shapes[], preselected }
        ↓
  IntakeSheet          ← ALWAYS opens (user's call, 2026-08-06)
        ↓
  applyIntakeShape(shape, ctx)           →  the existing helpers, unchanged
```

`applyIntakeShape` is a router over code that **already exists** — `artifactUpload`,
`import_text`, `createChildInContainer`, `createImportsDocPage`. The plan adds a decision layer,
not a second implementation. That is the whole reason this is affordable.

### The sheet ALWAYS opens — and what that forces

**Decided by the user.** I raised the concern that an ask on every drop could make intake feel
slower; the answer was always-ask, so the design's job is to make it cost ~nothing:

- **The best shape is pre-selected and Enter commits it.** Drop → Enter is the fast path, and it
  is one keystroke, not a hunt. Escape cancels and writes nothing.
- **One sheet per gesture, never per item.** Nine files dropped together ask once, for the set.
- **`grid.meta.intakeDefaults` is NOT built.** No remembering, no "don't ask again", no hidden
  state to debug. If always-ask turns out to grate in daily use, the remember layer is a small
  additive follow-up — but nothing is designed around it now.

**The boundary this makes load-bearing: intake is a PLACEMENT decision, not an origin.**
The test is *"is this content being given a shape here for the first time?"* — not *"did the bytes
come from outside?"*

| Asks | Never asks |
| --- | --- |
| OS file / link / text dropped in | Dragging an occurrence between containers |
| **Dragging an artifact out of the Files folder** (user, 2026-08-06) | Moving an embed inside a doc |
| QuickAdd creating something | Re-parenting a page, reordering a list |
| Jonah importing | Any drag whose source and destination are both live placements |

**Dragging out of the library is intake.** The Files folder is a library, so pulling an image out
of it onto a canvas poses exactly the question a fresh drop poses — artifact, canvas, outline, or
field value? The only difference is that the bytes already exist, so the upload half is skipped and
the sheet opens instantly. Without this, the good shapes would be reachable only once per file, on
the drop that first created it.

Without the right-hand column, "always ask" would put a sheet in front of every drag in the app.

**QuickAdd already IS the sheet.** Its tiles are a shape choice made before the content exists, so
picking "Image" must not then ask again. The tile *is* the answer; QuickAdd routes straight to
`applyIntakeShape`. Same for Jonah's ConfirmCard.

### The shapes, per payload

★ = **my recommendation, not asked for.** Each one exists because a capability is already built and
simply never reachable from a drop. Rationale under each table.

**LINK** *(the user's headline ask)* — pre-selected: **Chip**
| Shape | What it makes | Reuses |
| --- | --- | --- |
| Chip *(pre-selected)* | `role:"textblock" kind:"inline"` + `meta.link` — the importer's own link shape | `buildInlineLink` |
| Bookmark card | title + favicon + room for a note under it | ArtifactCard |
| **Page** | fetch and import the target — the full container/textblock/table tree | `import_html` |
| Container of links | several links dropped at once → one container of chips | — |
| ★ **Board option** | drop a link on an option board → a real tagged option, not a loose card | `addNewOption.js` |
| ★ Field value | fill the URL/media field of the occurrence it landed on | ImagePicker's write path |
| **…and follow its links?** | the harvest+batch flow (Task 6) | `wikipedia_import_batch` |

★ **Board option is the one I'd fight for.** The grid has 34 option boards scoped by a
`boardCategory` tag, and `addNewOption.js` already knows how to mint an option and stamp the
parent's identity fields at run time. So dropping a film link on the Movies board should produce a
*Movie* — tagged, poster-fetchable, immediately pickable from every Media dropdown — instead of a
card that no dropdown can see. The mechanism is built; only the route from a drop is missing.

**IMAGE** — pre-selected: **Image artifact**. All three extras confirmed for this pass.
| Shape | What it makes | Reuses |
| --- | --- | --- |
| Image artifact *(pre-selected)* | today's behaviour | artifactUpload |
| **Canvas with it** | a `kind:"canvas"` surface holding the image, ready to draw on | CanvasContent |
| **Outline version** | edge-trace → strokes on their own layer *over* the image (docket #43) | `meta.drawData` + `meta.layers` |
| **Attach to this occurrence** | append to its **Files** field — and optionally mark as its main picture | the Files field, below |
| ★ **Photo of a list → items** | OCR → one instance per line, as a real checklist | `tesseract.js` (already shipped) |

The canvas pair is the creative core: **the image stops being a picture and becomes a surface.**
The outline is not a filter — it is a stroke set on its own layer, so it is editable, erasable,
hideable, and it composes with the marker/fill tools already shipped. Drop a floor plan → trace it
→ the tracing is *yours*, the photo underneath is reference. Trace, hide the photo, keep the
drawing.

★ **Photo-of-a-list is the highest-value thing in this whole document for a habit tracker.** OCR
already runs in `ArtifactContent` and already mints a textblock from an image. Splitting that text
on newlines into instances instead of one blob is a small delta and it turns a phone photo of a
handwritten grocery list into a working checklist. This is the shape I'd expect to get used daily.

**FILE (non-image)** — pre-selected: **artifact**
| Shape | Notes |
| --- | --- |
| Artifact *(pre-selected)* | today's behaviour |
| Artifact + OCR'd textblock | OCR exists in `ArtifactContent` |
| ★ **`.md` → the full import tree** | **audit gap:** `import_markdown` has existed as a Jonah tool for months and a dropped `.md` file has never reached it. Dropping a markdown file makes a flat artifact you cannot read. One route, no new code. |
| ★ **`.csv` / `.tsv` → a real table container** | The importer already builds `kind:"table"` containers from pipe tables (`buildTable`). A CSV is a pipe table with different delimiters. |

**MANY FILES** — N siblings *(pre-selected)* · one container holding them · a folder page.

**HTML / TEXT** — pre-selected: **doc page**
| Shape | Notes |
| --- | --- |
| Doc page *(pre-selected)* | today's behaviour |
| Container tree | the importer's structure without the page wrapper |
| One textblock, verbatim | when you want the words, not the shape |
| ★ **Checklist** | lines → instances binding Completed. Paste a list of steps, get a list you can tick. |

### The Files FIELD — an ordinary multi-select, plus a designated face

*(User, 2026-08-06: "the field for files should be like any other multiselect field, but we can set
the selection to the main pic of the occurrence in the settings… we can display the files field and
have a main pic." This is where intake's "set as field value" shape actually lands, and it is the
same field the artifact-spread viewer opens — see `2026-08-06-artifact-spread-viewer.md`.)*

**It is not a new field type.** A shared `Files` field of `type: "occurrence"`, `multiSelect: true`,
whose option pool is the Files folder. It renders, sorts, prefills and filters exactly like every
other multi-select occurrence field, which means the whole existing stack — `MultiSelectWithAdd`,
the option rows with thumbnails, `resolveOptions`, the union combiner in `prefillFromPick` — works
on day one with no special cases.

**The face is a value ON that field, not a second field.** Field values are already
`{ value, flow }` objects that carry per-occurrence extras — `hideName` / `hidePrefix` /
`hidePostfix` are stored beside `value` today. The main picture is one more:

```js
occurrence.fields[filesFieldId] = { value: [artifactOccId, …], flow, main: artifactOccId }
```

Per-occurrence by construction, which is the requirement: *this* person's face is not a property of
the Person template. `main` is always one of `value` — dropping the file drops the face.

**Both are shown, not one or the other.** The field displays its attached files as normal chips
*and* the occurrence renders `main` as its thumbnail. `resolveOccCard` (which today reads the
`role:"media"` binding) prefers the Files field's `main` when present and keeps the media-role
binding as the fallback, so nothing that has a poster today loses it.

**What this replaces:** the awkward split where an occurrence's picture lives in one field and its
attachments live nowhere. One field holds everything attached to a thing; one of them is its face;
clicking the face opens the spread. Setting the face is a click on a chip ("use as main"), plus a
binding-level toggle in settings for whether this field supplies the occurrence's picture at all.

### ★ Two cross-cutting additions

**Bring it in as a TEMPLATE.** Any imported subtree can be filed into the protected Templates
folder instead of into the page. Location is the only marker (2026-08-03), so this is a
destination change, not a new concept — and it turns "I found a routine I like on a website" into a
template you can apply to any day.

**A drop onto a dated surface inherits the date — automatically, not as a shape.** The 2026-08-05
rule is that *any* occurrence can carry fields and a textblock added to a day needs the date or the
filter cannot see it. Intake mints occurrences, so intake must stamp `parentFilterFields` on
everything it creates, exactly as the `+` menus have since `91e4a807`. A file dropped on today's
column that today's column cannot then display is the same class of bug as the 40-of-50 dateless
children.

### ★ The audit gap nobody asked about: PASTE is not an intake path at all

Ctrl+V of an image, a link, or a chunk of a page reaches ProseMirror's own paste handling inside a
doc, and reaches **nothing at all** on a board, a canvas or an empty cell. Every capability in this
plan is unreachable by the most common gesture for bringing something in. The classifier is
payload-shaped, not gesture-shaped, so paste is a small wiring task on top of Task 3 — and skipping
it would mean shipping an intake system that the keyboard cannot use.

### The Files folder — the Templates pattern, exactly

A protected **Files** folder per grid: `meta.protected`, `FILES_FOLDER_NAME`, location is the
marker. Every uploaded artifact occurrence gets `parentId = filesFolderId` — which is *already* the
artifact convention (`CLAUDE.md`: "Artifact occurrences place themselves in the tree by setting
parentId = folderId") — **and** is spliced into wherever it was dropped.

**The subfolder is derived, not chosen.** `mimeToKind` already classifies every upload
(image / video / audio / pdf / code / markdown), so Images / Video / Audio / Documents falls out of
a mapping over a value the server computes today. No new classifier, nothing to keep in sync, and
a file cannot land in the wrong bucket without `mimeToKind` already being wrong somewhere else.

**A placement is a COPY; the file is stored once** (user, 2026-08-06). The Files folder holds the
artifact's home occurrence; every placement elsewhere is a NEW occurrence sharing the SAME module —
so it shares `fileRef`, the sha256, and the thumbnails. One upload, one set of bytes, N placements.
This is already how artifacts dragged from the manifest tree behave (`defaultDragMode: "copy"`),
so intake is adopting the existing rule rather than inventing one, and it keeps the Files folder
honest: deleting a placement is just deleting that placement.

> **Caveat to check before Task 4, not to discover later.** Copy-per-placement is unambiguously
> right for media artifacts, where the occurrence carries only placement and the bytes live on the
> module. It is NOT obviously right for `kind:"markdown"` artifacts, where the *body* lives on
> `occurrence.textmap` — two placements would be two independently-editable bodies. That is the
> exact trap `createPageInContainer` documents ("do not fix this with two occurrences… a doc page
> would carry two independent bodies"). Task 4 must decide per kind: copy for media, and either
> multi-parent or a deliberate "duplicate this note" for textmap-bearing artifacts.

### Non-goals

No new upload endpoint. No second import path. No re-encoding, no OCR-for-PDF, no "understand the
document". Intake decides *shape*, not meaning.

---

## Global Constraints

- **`poms grid` is protected live data.** Any migration (Files folder, backfilling existing
  artifacts) dry-runs first and reports counts against a NAMED expectation — the 0035 lesson
  (a selector that "looks like templates" matched the user's real project page).
- **Nothing may make an intake path slower to *use*.** A remembered default must be a straight
  no-sheet commit.
- **Every shape must be one undo.** All writes of one intake go through a single action scope.
- **The sheet must be reachable on mobile** — it uses `MenuSurface`, so it is a bottom drawer
  there by construction.
- **Verify by diffing persisted state**, and A/B every regression test against unfixed code.

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/helpers/intake.js` **(NEW)** | Pure. `classifyIntake(payload, destination)` → `{shapes[], preselected}`. No React, no writes, no stored defaults. |
| `client/src/ui/IntakeSheet.jsx` **(NEW)** | The ask. Shape tiles, pre-selected one focused, Enter commits, Escape cancels. Renders through `MenuSurface` (drawer on mobile). |
| `client/src/helpers/intakeApply.js` **(NEW)** | `applyIntakeShape(shape, ctx)` — routes to the EXISTING helpers. The only file that writes. |
| `client/src/helpers/dropHandlers.js` | `handleFileDrop` / `handleExternalDrop` classify + open the sheet instead of deciding. Their current behaviour becomes the default shape. |
| `client/src/ui/Editor.jsx` | Same, for the doc arm. |
| `client/src/helpers/filesFolder.js` **(NEW)** | Client twin of the server rule (mirrors `helpers/templateHelpers.js`). |
| `server/utils/filesFolder.js` **(NEW)** | `findFilesFolder` / `resolveFilesFolderId`, mirroring `utils/templatesFolder.js`. |
| `server/utils/protectedFolders.js` | Gains `FILES_FOLDER_NAME`. |
| `server/migrations/00NN-files-folder.mjs` **(NEW)** | Mint the protected Files folder; file existing artifact occurrences into it. Dry-run reports counts by grid. |
| `client/src/helpers/imageTrace.js` **(NEW)** | Pure edge-trace: `ImageData` → stroke paths. Canvas-free logic so it is testable. |
| `server/services/importRelink.js` | Occurrence-level chip relink (Task 6). |
| `server/services/assistantTools.js` | `link_candidates` harvest tool (Task 6). |

---

## Open questions — RESOLVED 2026-08-07 by dropping the feature that raised them

All three questions existed only because Task 6 was a BULK harvest ("import this page and the
pages it links to"). The user retired that idea:

> *"we should avoid the all link thing, but if i rightclick on an external link in our system, we
> should have a convert to page"*

**So link-following is now PULL, not push: one link, on demand, from its own right-click menu.**
That is strictly better and not just smaller:

- **Nothing is unbounded.** A harvest of "all links" off a Wikipedia article is hundreds of pages
  and a second hop is thousands — which is why depth was the only thing keeping it finite. One
  link converted by hand cannot run away.
- **No guessing which links matter.** Ranking (top-N, prose-only, a tick-list) was an attempt to
  infer intent from position. The right-click IS the intent, stated exactly.
- **It composes with what already exists.** `import_html` already builds the whole tree from a
  URL; the only missing piece was ever a route from a link to it.

~~1. When does Jonah offer to follow links?~~ **MOOT** — he doesn't offer; the user asks, per link.
~~2. How many links?~~ **MOOT** — one, the one right-clicked.
~~3. Depth?~~ **MOOT** — one page. Converting a link on the *resulting* page is another deliberate
act, which is depth-as-many-hops-as-you-want without a setting.

---

### Task 1: The classifier (pure, no UI, no writes) ✅ DONE 2026-08-06 (14 tests)

`client/src/helpers/intake.js` — `normalizeIntakePayload` (files > bare urls > html > text, and a
list of bare URLs is a LINK payload while prose *containing* one is TEXT) and
`classifyIntake(payload, destination)`. Two invariants are the point and both are pinned by tests:
**never zero shapes** (an unrecognised payload still gets exactly one — today's behaviour), and
**every emitted id is declared in `INTAKE_SHAPES`**, which is the contract Task 3's router is
asserted against. Destination-gated shapes only appear where they can land: the canvas pair on a
canvas, `board-option` on an option board, `attach`/`field-value` on an occurrence that has the
field. Nothing here reads live data — the caller resolves `isOptionBoard` / `filesFieldId` /
`linkFieldId` and passes them in.


**Files:** `client/src/helpers/intake.js`; test `__tests__/intake.test.js`.

- [ ] **Step 1: Failing tests** — a `.png` on a canvas page offers {artifact, canvas, outline,
      field-value} pre-selecting `artifact`; the same file on a doc offers no canvas shape; a bare
      URL offers {chip, bookmark, page, board-option, field-value, follow-links} pre-selecting
      `chip`; 3 files offer the set shapes; HTML offers {doc page, container tree, textblock,
      checklist}; a `.md` offers the import tree; a `.csv` offers the table; an unknown payload
      returns exactly one shape (**never zero** — intake must always have something to do).
- [ ] **Step 2: Implement.** Classification keys on payload kind × destination kind ONLY. No
      network, no DOM, no stored state.
- [ ] **Step 3:** Assert every shape name maps to a real branch in Task 3's router (a shape with
      no implementation is worse than no shape).

### Task 2: The sheet ✅ DONE 2026-08-07 (14 tests)

**Files:** `client/src/ui/IntakeSheet.jsx`; test `__tests__/intakeSheet.test.jsx`.

- [x] Tiles from `classifyIntake`; the pre-selected tile is focused on open so **Enter commits**.
      Focus is the whole mechanism — the browser's own activation handles Enter and Space, so
      there is no key handling to get wrong.
- [x] Escape cancels **and commits nothing** — asserted as **zero calls to `onPick`**, not "the
      sheet closed". A sheet that closes AND writes is the exact bug this plan exists to prevent,
      and only the write assertion tells them apart. Escape is bound at the DOCUMENT (capture), so
      there is no focus-dependent dead spot where it silently does nothing. Backdrop tap is
      covered the same way.
- [x] One sheet per gesture: a 9-file drop asks once and reports "9 files" in the header.
- [ ] Measure in a real browser at 390×844 and 1440×900 — drawer vs anchored, per `MenuSurface`.
      **NOT DONE.** The tests assert the drawer CLASS flips off `document.body.dataset.layout`, and
      MenuSurface's own geometry was measured in a browser on 2026-08-05 — but this sheet's own
      sizing at both widths has not been looked at.

**Contract that makes the plan's promise structural:** this file is pure UI. It takes a
classification and returns a shape id through `onPick`; every write lives in the router. That is
what makes "Escape commits nothing" true by construction rather than by remembering to guard each
branch.

### Task 3: The router — behaviour-preserving first

**Files:** `client/src/helpers/intakeApply.js`; `dropHandlers.js`; `Editor.jsx`.

- [x] **Step 1: DONE 2026-08-07 (25 tests).** `intakeApply.js` holds the decision layer
      and the behaviour-preserving routes; `<IntakeSheetHost>` is mounted in `App.jsx`; and
      `handleFileDrop` now classifies → filters → **asks** → applies.
      All four intake paths ask: file drops, link drops, HTML/long-text drops, and the doc arm.
      **A link drop is the audit's headline case** — it became a card labelled with the raw URL,
      silently, though the importer could already build the page from it. "Import the page" is a
      real option there now because `import_url` landed the same day.

      **`LINK_INSTANCE` was ADDED to the classifier**, which looks backwards given the audit calls
      today's link behaviour the thing to replace. Without it `filterToImplemented` would fall back
      to the ARTIFACT shape for a link — not what happens today, and a silent behaviour change
      disguised as a refactor. A decision layer that cannot reproduce what the app already does is
      not behaviour-preserving.

      **The ask happens BEFORE any write, and that is the design, not an ordering accident.** The
      old handler minted placeholders and then uploaded; the sheet now opens with nothing minted,
      so Escape cannot leave debris — asserted as "cancel ⇒ zero dispatches, zero emits, zero
      uploads" rather than as a closed sheet.

      **Placement stayed with the drop handler.** Which container's `occurrences[]`, a canvas page,
      an artifact panel's active view — that is genuinely this handler's business, and a copy of it
      inside the router would drift. `runArtifacts` calls an `onPlaceholders` hook between minting
      and uploading instead.

      **A missing host FALLS BACK to today's behaviour** rather than dropping the file on the floor
      (a preview iframe or a test harness has no host). That is also why the pre-existing
      `handleFileDrop` suite still passes untouched — it exercises the fallback, which is exactly
      the byte-identical path this step promised.

      **What Step 1 added beyond "route the shapes" — THE COVERAGE CONTRACT.** Task 1's second rule
      ("a shape offered and not implemented is worse than one not offered") needs an enforcement
      point, or the sheet will happily show "Canvas with it" and do nothing when picked. So the
      router declares `IMPLEMENTED_SHAPE_IDS`, callers run the classification through
      `filterToImplemented` before opening the sheet, and `assertShapeCoverage` reports three
      buckets — implemented, not-yet, and **orphanRoutes** (a route whose shape id no longer
      exists, i.e. a rename that would otherwise rot silently). The filter re-points the
      preselection when the preselected shape is one of the unimplemented ones — which is exactly
      the link case today, since `link-chip` is the classifier's pick and Task 5 owns it — and it
      **never returns zero shapes**, falling back to the artifact route, which is itself asserted
      to be implemented so the escape hatch cannot become its own dead end.

      **VERIFIED IN A REAL BROWSER 2026-08-07** (`_intakeverify.mjs`, test grid 2, Chromium
      1440×900 then 390×844). This is the step's own pass condition, which the unit suites
      structurally cannot cover — they mount the host directly and never exercise the wiring.

      | arm | result |
      | --- | --- |
      | file drop on a container row | **asks** — sheet opens, "Image" preselected AND focused |
      | Escape | **writes nothing** — rows 58 → 58, asserted on the write, not on the sheet closing |
      | Enter | **commits the preselected shape** — rows 58 → 59, sheet closes, no page errors |
      | file drop into a doc body | **asks** (commit `2cb549aa`) |
      | HTML / long-text drop on a container | **asks**, "Doc page" preselected (commit `d210c308`) |
      | sheet at 390×844 | **full-width bottom drawer** — drawer `x0 y683 390×161`, bottom = 844 |
      | link drop | **UNVERIFIED — see below** |

      "Enter commits the preselected shape" IS the byte-identical claim: the fallback arm (no host
      mounted) calls `applyIntakeShape(classification.preselected, ctx)` with the same ctx, so the
      two are the same call. The equivalence is what makes it checkable at all.

      **The link arm could NOT be judged, and the probe proves that rather than assuming it.** A
      SHORT PLAIN TEXT drop — the legacy branch, code this work never touched — also writes nothing
      under a synthetic drop. So the branch they share is unreachable this way and "the link did not
      ask" is a claim about the probe. Reported UNVERIFIED, never FAIL. Checking it needs a hand
      drop from a real OS drag.

      **Three probe traps paid for, recorded in the probe's own header:** (1) dropping at the
      CENTRE of a 13950px-tall container resolves to y≈7000, off screen, on an SVG header icon —
      it reported FAIL on paths that work; (2) `DragProvider` resolves the hovered container from
      `pointerRef`, updated by pointer MOVEMENT, not from the drag event's own coordinates, so a
      synthetic drag that never moves the pointer leaves `containerId` null; (3) the drawer's
      bottom inset is `paddingBottom: max(12px, env(safe-area-inset-bottom))`, so measuring the
      inner dialog reads 12px short of the edge — measure the drawer.

      Probe debris swept afterwards (1 module, 3 occurrences, dumped to `backups/orphans/` first);
      all three grids back to their documented pre-existing baselines.
- [x] **Step 2 ✅ DONE 2026-08-07** — `applyIntakeShape` runs its route inside ONE `withAction`
      scope, so an intake's module creates, occurrence creates, parent-list update and upload are
      a single undo step. `applyIntakeShape` is the one chokepoint every intake write passes
      through, so it is the only place the scope has to open.

      Two things asserted rather than assumed: the write must see an **open** action (asserting
      "an action existed at some point" would pass even if the scope opened and closed before the
      route ran), and a **throwing** route must leave no scope open — a leaked scope silently
      swallows every LATER write into a stale action, so undo would revert far too much rather
      than too little. An unrouted shape opens no scope at all: it writes nothing, and an empty
      undo step is worse than none.
- [x] **Step 3 ✅ DONE 2026-08-07** — `createArtifactPlaceholders` takes a `parentOccurrence` and
      stamps `CommitHelpers.parentFilterFields` into the new occurrence's `fields`. Threaded from
      both arms: the board arm passes the destination container, or the PAGE on a canvas drop
      (a canvas has no container, and the page is what the filter cascade resolves through
      either way); the doc arm passes the doc occurrence.

      **This was a real gap, not a tidy-up.** The typed paths have stamped the parent's filter
      values since 2026-08-05 ("any occurrence can carry fields"); the ARTIFACT path set
      `fields: {}`, so a file dropped on today's column was born with no date and the date filter
      could not see it — present in the data, rendering nowhere, which is indistinguishable from
      a lost upload. Caller-supplied `fields` win over the stamp, matching
      `createLeafInstanceInParent`'s convention. Resolved once per drop, not per file.

      **8 tests (`__tests__/intakeScopeAndFilter.test.js`), A/B'd against the unfixed code: 4
      fail** — including the "one action id" case, which was VACUOUS as first written (two
      `null`s also form a set of size 1, so it passed against the unfixed code until a
      `toBeTruthy` was added first). 1880 client tests, build clean.
- [ ] **Step 4: ★ Paste.** Route Ctrl+V through the same classifier on boards, canvases and empty
      cells. Inside a doc, ProseMirror keeps its own paste handling for plain text.

### Task 4: The Files folder

**Files:** `server/utils/filesFolder.js`, `protectedFolders.js`, migration, client twin.

- [ ] **Step 1:** Server rule + tests, mirroring `templatesFolder.js` (including its guard: the
      resolve returns null rather than writing somewhere else). Subfolders derived from
      `mimeToKind` → Images / Video / Audio / Documents.
- [ ] **Step 2: Decide the placement semantic per kind** (see the caveat above): copy-per-placement
      for media, and a deliberate call for textmap-bearing (`markdown`) artifacts. **Write the
      decision down in the module header** — the next person will hit this.
- [ ] **Step 3:** Uploads home into the right subfolder AND place at the drop destination. Assert
      both edges in a real-DB test on **test grid 2**.
- [ ] **Step 4:** Migration files existing artifacts. **Dry run first, report per grid and per
      subfolder, and check against a named expectation** — not just a count.
- [ ] **Step 5:** Placement-delete vs file-delete: removing a placement must leave the file in
      Files; deleting in Files removes it everywhere. Test both directions. Unlinks go through the
      atomic `$pull` path — never a read-modify-write.
- [ ] **Step 6:** Dragging out of Files opens the sheet (no upload, instant) and lands a placement.

### Task 4b: The Files field + main picture

**Files:** the seeded `Files` field; `ui/Field.jsx`; `resolveOccCard`; `ui/InstanceForm.jsx`;
migration for the field itself. Shared with `2026-08-06-artifact-spread-viewer.md` — **build it
here, that plan consumes it.**

- [ ] **Step 1:** Seed the shared `Files` field (`type:"occurrence"`, `multiSelect:true`, option
      pool = the Files folder). **Pass condition: it needs no special-casing** — it renders,
      filters and prefills through the existing multi-select path unchanged.
- [ ] **Step 2:** `main` on the field value. Pure helpers first (`setMainFile` / `resolveMainFile`):
      `main` must always be a member of `value`, removing that file clears it, and an absent `main`
      is legal. Tests A/B'd against unfixed code.
- [ ] **Step 3:** `resolveOccCard` prefers `main`, falls back to the `role:"media"` binding.
      **Regression: every occurrence that shows a poster today must still show it** — assert
      against real seeded people/movies, not a fixture.
- [ ] **Step 4:** UI — "use as main" on a file chip, and a binding-level toggle for whether this
      field supplies the occurrence's picture.

### Task 5: New shapes

Links and images first — they are the user's ask and they unlock the most.

- [ ] **Link → chip / bookmark / page.** The page shape routes to `import_html`; the chip reuses
      `buildInlineLink`'s shape exactly (do not mint a second link representation). The page shape
      must fail **visibly** on a paywall or SPA and offer the chip instead of minting an empty page.
- [ ] **Image → canvas.** New canvas carrying the image; the drop point becomes its origin.
- [ ] **Image → outline.** `imageTrace.js` pure first (tested on a synthetic bitmap: a black
      rectangle traces to 4 edges), then applied as strokes on their own layer with the photo
      beneath. **Ship the layer even if the trace is crude** — an editable wrong line beats an
      uneditable right one. Expose a threshold.
- [ ] **Image → attach to this occurrence.** Append to its Files field; offer "and make it the
      main picture" in the same step. Only shown when the destination occurrence binds a Files
      field. **Depends on Task 4b.**
- [ ] **Many files → container / folder page.**
- [ ] ★ **`.md` → import tree** and ★ **`.csv` → table container.** Both are routes to existing
      code (`import_markdown`, `buildTable`); do these before the harder ones — they are the
      cheapest real wins in the plan.
- [ ] ★ **Board option** (link dropped on an option board) via `addNewOption.js`.
- [ ] ★ **Photo → checklist** and ★ **text → checklist**: OCR/split into instances binding
      Completed.
- [ ] ★ **Bring in as a template**: file the imported subtree into the Templates folder instead.

### Task 6: Jonah follows the links *(was the whole of plan 3)*

**The gap, unchanged and still live:** `importRelink.relinkTextmap` rewrites inline link **marks**,
but since 2026-06-06 the importer emits each prose link as its own mini-textblock carrying
`meta.link` — so **the existing relink never touches today's imports at all**, which is why every
chip on the Eminem page still opens Wikipedia. `TextblockCard` already renders
`meta.link.kind === "occurrence"` as an in-app jump, so the target shape exists; only the
conversion is missing.

- [ ] **Step 1:** `collectLinkChips` / `relinkLinkChips` — pure, tested. A chip whose URL matches an
      imported title is rewritten to `{kind:"occurrence", occId}`; an unimported one stays
      **byte-identical**; an already-converted chip is skipped. URL forms (`/wiki/X`, `#anchor`,
      underscores, percent-encoding) resolve to one title. **Exact matches only — a wrong
      resolution sends a link to the wrong page, which is worse than leaving it on the web.**
- [ ] **Step 2:** Report against REAL data (read-only): how many chips on the existing Eminem
      import would resolve today.
- [ ] **Step 3:** Harvest tool + confirm card + relink in the batch's tail. **Blocked on the three
      open questions.** Keep the 15-title cap and show the count.
- [ ] **Step 4:** Migration for pages already imported — dry run and report before applying; this
      changes where the user's existing links go.

### Task 7: Close the audit's loose ends

- [ ] Empty-cell file drop uses the same Imports/Files treatment as text (finding 4).
- [ ] The drag preview pill states the shape that will be used *and* that it can be changed.
- [ ] Command Center Files tab reads the Files folder instead of scraping `modulesById` (finding 3).

---

## Risks

- **Always-ask is the decided behaviour, and its whole cost is in the keystroke.** The user chose
  it over remembering; the risk is not the decision but a sloppy implementation of it. If Enter
  does not commit the pre-selected shape, if a 9-file drop opens 9 sheets, or if the sheet lags the
  drop, intake becomes worse than it is today. **Measure the drop→committed path in a browser** —
  it should be one keystroke and feel immediate. The remember layer stays available as an additive
  follow-up if daily use says otherwise.
- **The Files folder changes where every artifact lives.** Copy-per-placement keeps the bytes
  single-sourced, but every placement is still a real occurrence in someone's `occurrences[]` —
  which is exactly the shape that produced the recurring `dangling-child-ref` class. Every unlink
  goes through the atomic `$pull` path, never a read-modify-write.
- **`main` on a field value is an extra key on a Mixed object.** That is an established pattern
  (`hideName`/`hidePrefix`/`hidePostfix` already live there), but Mongoose has bitten this codebase
  before with `minimize` silently dropping empty objects and strict mode stripping undeclared keys.
  **Round-trip `main` through a real database before building UI on it.**
- **Edge-tracing is easy to over-promise.** A photograph traces to noise. Scope it to
  high-contrast sources, expose a threshold, and keep it on its own layer so a bad trace costs one
  layer delete.
- **`import_html` on an arbitrary link is not Wikipedia.** Paywalls, SPAs, and login walls will
  produce junk. The page shape must fail *visibly* (and offer the chip instead), not mint an empty
  page.
