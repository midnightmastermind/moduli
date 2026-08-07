# Artifact Spread Viewer — one media model, one viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS — CORRECTED 2026-08-07 BY MEASUREMENT. The "NOT STARTED" this header carried was
> WRONG: Tasks 1-3 are shipped and tested.** Verified by reading the tree, not the checkboxes:
>
> | Task | State |
> | --- | --- |
> | 1. `occurrenceMedia.js` — one resolver | **DONE** — `mediaFieldIdFor` / `filesFieldIdFor` / `primaryMediaOf` / `filesOf` (132 lines) |
> | 2. `ArtifactSpread` — the surface | **DONE** — `ui/ArtifactSpread.jsx` + `ui/ArtifactSpreadHost.jsx` (369 lines), host mounted at `App.jsx:1041` |
> | 3. Open it from the thumbnail | **DONE** — two call sites in `ui/Field.jsx` (1045, 1385), each passing the origin rect |
> | 4. The migration — strings become artifacts | **NOT DONE** — needs a database + a dry run |
> | 5. Seed + docs | **NOT DONE** |
>
> **28 tests** across `__tests__/ArtifactSpread.test.jsx` + `__tests__/occurrenceMedia.test.js`, all
> passing.
>
> **THIS IS THE SECOND PLAN IN TWO DAYS WHOSE HEADER LIED IN THIS DIRECTION** — the prefill plan
> claimed not-started while its migrations had already been applied. A plan header is written once,
> at planning time, and nothing updates it when work lands; the checkboxes drift the same way.
> **Measure the tree before believing a status line** — the same rule this repo already applies to
> a recurring bug ("date the damage before believing it still recurs").

**User direction (2026-08-06):**
> "combine profile pictures on instances and artifacts, making an artifact viewer that combines
> upload and multi view of many diff artifacts. so when i click on a instances image, it opens up
> with a bunch of diff images and artifacts. like opening a folder in iron man, it spreads out the
> info. id just like it to show 4 spots to start and pretty large kinda grid (the shape of it, not
> our other grid definition)."
>
> "the artifact viewer plan would allow multiple files attached to an instance"
> "maybe we should have a files field with multi select."

**Goal:** An occurrence's picture stops being a lone string on a field and becomes the first of its
ARTIFACTS. Clicking it spreads that set out large — images, video, pdf, audio side by side — with
adding a new one available in the same surface.

---

## Why this is a merge, not a new feature

The app already has **two unrelated representations of "an image that belongs to this thing"**, and
that is the whole problem:

| | how it is stored | who renders it | how you add one |
| --- | --- | --- | --- |
| **Profile picture** | a `role:"media"` field binding whose VALUE is a string (`fileRef` or a remote URL) | `Field.jsx` media pill, `resolveOccCard` (dropdown chips), `RepresentationView`, `ModuleInstance`'s media block | `ImagePickerMenu` (search / upload / URL) → writes the string |
| **Artifact** | a `role:"artifact"` module with `fileRef` + its own occurrence | `ArtifactCard` (thumb / expanded / full-bleed), `ArtifactContent`, the `kind:"display"` page | drag-drop or `/api/artifacts/upload` via `helpers/artifactUpload.js` |

So a person's photo cannot be opened, captioned, dragged, replaced from the tree, or sit beside a
PDF — because it is a string, not a thing. And an artifact cannot be a profile picture, because
nothing reads artifacts when it wants a thumbnail.

**The merge:** a media field's value becomes an **occurrence id pointing at an artifact**. Everything
that renders a thumbnail already resolves ids for other reasons (`resolveOccCard` resolves occurrence
picks today), and everything that renders an artifact already exists. The viewer then has something
real to open.

## Architecture

1. **One media model — a `Files` field, multi-select, pointing at ARTIFACT occurrences** (user's
   call, and the better one). Attachment is not a new relationship: it is an occurrence dropdown,
   exactly like Ingredients or Movies Watched. That buys the whole feature off machinery already in
   use — `MultiSelectWithAdd`, `optionsResolver` with a `find` predicate over `role:"artifact"`,
   `resolveOccCard` for the chips — and it means **the same artifact can hang off several
   occurrences** without copying, because a pick is a reference.
   - The alternative considered and REJECTED: artifacts as `occurrences[]` CHILDREN of the instance.
     It reads natural but leaf instances have never had children, so it would put new cases through
     ancestry walks, `getContainerItems*` and the delete cascade for no gain over a field.
   - **The profile picture is the primary entry of `Files`**, not a separate concept. Keep the
     existing `role:"media"` binding as the pointer to WHICH entry is the face (a chip needs a
     deterministic thumbnail and "first image-kind entry" reorders under you); its value becomes an
     artifact occurrence id, so it is one of the ids already in `Files`.
2. **One viewer.** New `ui/ArtifactSpread.jsx`: a large tiled surface over the app showing every
   artifact belonging to one occurrence, plus an always-present "add" tile. Four tiles to start,
   growing with content. Each tile is the EXISTING `ArtifactCard` — the spread owns layout and
   animation, never a second way to draw a PDF.
3. **One add path.** The add tile routes to the existing `openImagePicker` (search / upload / URL)
   and `helpers/artifactUpload.js` (`createArtifactPlaceholders` + `uploadArtifactPlaceholders`) so
   upload progress, the batched toast and placement all behave as they do everywhere else.
4. **Opened from the thumbnail, as an OVERLAY** (settled). Clicking an instance's image opens the
   spread for that occurrence — animating out of the thumbnail's own rect, which is the "opening a
   folder in Iron Man" read. Escape and the backdrop close it; nothing is persisted, so there is no
   page to clean up. The lightbox behaviour `ArtifactCard --expanded` currently owns stays for a bare
   artifact with no siblings; with siblings, the spread wins.

## Tech Stack

React 18, Vitest + @testing-library/react, Express + Socket.io, Mongoose.
Client tests `npm --prefix ./client run test`; server `npm --prefix ./server run test`.

## Global Constraints

- **`poms grid` is protected live data.** Structure changes go through `server/migrations/` +
  `npm run migrate:poms`. Never the seed. Rehearse on `test grid 2`; never `test grid 1`.
- **No fallbacks.** When the media field's value becomes an id, the string read is DELETED, not kept
  as a backstop. A migration converts the data in the same pass.
- **Migrations are idempotent** — find-then-patch, never blind-append.
- **Verify by diffing persisted state against a real database**, not by reading code.
- **The DOM is ground truth** for anything about layout or animation. A jsdom test proves the
  contract; a browser harness proves the geometry (`client/_*.jsx` + Playwright, deleted after).
- After any deploy, verify prod HEAD over SSH.

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/helpers/occurrenceMedia.js` (new) | THE media resolver: `filesOf(occ)` (the `Files` picks, primary first), `primaryMediaOf(occ)`, `mediaFieldIdFor(module)`, `filesFieldIdFor(module)`. Every thumbnail site reads through it. |
| `server/scripts/createLiveData.js` | Seeds the shared **`Files`** field: `type:"occurrence"`, `multiSelect: true`, `optionsSource.find` over `role:"artifact"`, `addNew` wired to the upload path. |
| `client/src/ui/ArtifactSpread.jsx` (new) | The spread surface: tiles, add tile, open/close animation, keyboard. |
| `client/src/ui/ArtifactSpreadHost.jsx` (new) | One mounted host + `openArtifactSpread(occId)`, mirroring `ImagePickerHost`'s imperative pattern (call sites live inside popovers that unmount). |
| `client/src/ui/Field.jsx` | Media pill resolves through `occurrenceMedia`; clicking it opens the spread instead of the picker. |
| `client/src/modules/ModuleInstance.jsx` | The row's media block resolves + opens the same way. |
| `client/src/ui/RepresentationView.jsx`, `resolveOccCard` in `Field.jsx` | Chip thumbnails resolve through `occurrenceMedia`. |
| `client/src/modules/ArtifactCard.jsx` | Unchanged rendering; gains only a `compact` tile size for the spread. |
| `server/migrations/00NN-media-fields-to-artifacts.mjs` (new) | Converts every media-field STRING into a real artifact occurrence and rewrites the value to its id. |
| `client/src/index.css` | Spread surface, tile grid, open/close keyframes. |

---

## Decisions (settled 2026-08-06)

1. **Attachments are a `Files` field — multi-select, options are artifact occurrences.** Folded into
   the architecture above. Rejected: artifacts as `occurrences[]` children of the instance.
2. **`Files` is ONE shared field**, bound wherever attachments are wanted — the pattern Tags already
   uses, one dropdown listing every artifact, and it keeps the unique-field-name rule. Rejected:
   per-module Files fields, and a per-binding filter (no per-binding config exists yet; add it later
   if a dropdown ever needs narrowing).
3. **The picture is one you MARK as the face.** The `role:"media"` binding stays as an explicit
   pointer to the primary entry, so "make this the face" is a real action and dropdown chips always
   resolve the same image. Rejected: "first image in Files", where the face changes whenever the
   order does.
4. **The spread is an OVERLAY over the app**, animating open from the thumbnail you clicked, Escape
   to close, nothing stored. Rejected: opening as a real page (adds back the click just removed from
   the sidebar), and the hybrid where dragging it out converts it to a page (two surfaces plus a
   conversion, for a case nobody has asked for yet). The `kind:"display"` page path still exists and
   can be offered from the spread's own menu later.

### Decisions (settled 2026-08-06, SECOND round — during execution)

The user steered the surface substantially while Task 2 was being built. These supersede the
"Architecture" section above where they disagree.

5. **A `Files` field and artifacts INSIDE an occurrence COEXIST — they are not alternatives.**
   > *"the files field is just part of what you can attach to that occurance but the inside of it
   > can still have artifact occurances"*

   Decision 1 rejected *attachment by parenting*; it did not say a container cannot hold artifacts.
   So `filesOf` returns the **UNION** of the Files picks and the occurrence's own artifact children,
   tagging each with `source: "field" | "child"`. That tag is load-bearing: a child's order lives in
   `occurrences[]` and its canvas position on its own meta, while an attachment's order lives in the
   Files array — and an attachment's position *cannot* live on the artifact, because a reference is
   shared by every occurrence that picked it.
   *(Task 1 Step 1's "artifact children" clause was originally read as a leftover from the rejected
   design. It was not — it was this union. Corrected.)*

6. **The spread REUSES the existing board and canvas renderers. It does not implement arrangement.**
   > *"so we can just reuse board or canvas on an overlaid surface"*

   Measured, not assumed: `Container` already accepts an `occurrenceOverride`, and `CanvasContent`
   takes `containerOccurrence` + `itemsWithOccurrences` as plain props. Both are drivable from an
   overlay. Grid arrangement = the board renderer; free arrangement = the canvas renderer. **No
   second reorder, drag, or positioning implementation is written.**

7. **The spread is backed by a real page that EXISTS ONLY IN THE OVERLAY.**
   > *"these pages would exist only in this overlay"*

   This is what makes reuse work: board and canvas persist order and x/y to a real occurrence, so
   the spread page is real — minted lazily on first open, `meta.spreadFor = <ownerOccId>`, id stored
   on the owner's `meta.spreadPageId`. It is **never pinned to a panel and never listed in a
   manifest tree**, so it is reachable only by opening the spread. No synthetic-occurrence hack, and
   nothing to clean up in the sidebar.
   - Attached (Files-field) artifacts are **multi-parented** into that page — the established
     pattern here (the Schedule's shared slots, Todo on the day page). They stay owned wherever they
     live; the spread page merely lists them.
   - Consequence, accepted: a shared artifact's canvas x/y is shared between the spreads that list
     it, exactly as a multi-parented occurrence on two canvases behaves today.

8. **Every tile is the artifact occurrence itself, interactive — not a thumbnail.**
   > *"a board of artifact occurances (the ones that let you interact so not just the thumbnail)"*

   Falls out of reuse: the board/canvas renderers already draw real occurrences.

9. **Drag inside the overlay arranges; SHIFT-drag leaves it.**
   > *"dragging then can be reorder for the grid or just moving on the surface"* /
   > *"holding shift and dragging it will let me drag it something on the grid (surface disappears)"*

   Plain drag is whatever the underlying renderer already does (board reorder / canvas move).
   Shift-drag is the ordinary app drag out onto the grid, with the overlay ghosting itself for the
   duration of the gesture so the drop lands on what is behind it, then closing.

10. **The trigger is unchanged:** clicking an occurrence's **main artifact (its face)** opens the
    spread for that occurrence.

---

### Task 1: `occurrenceMedia.js` — one resolver, in front of everything

**Files:** create `client/src/helpers/occurrenceMedia.js`; test
`client/src/__tests__/occurrenceMedia.test.js`.

**Interfaces:**
- `primaryMediaOf(occ, ctx) -> { artifactOcc, module, src } | null`
- `filesOf(occ, ctx) -> Array<{ occ, module, kind, src }>` — the `Files` picks, primary first
- `mediaFieldIdFor(module) -> fieldId | null` (the one place `bindings.find(b => b.role === "media")`
  lives — it is currently written out at 6 sites)
- `filesFieldIdFor(module) -> fieldId | null`

**Note:** `Files` holds an ARRAY of occurrence ids (the multi-select shape `Field.jsx` already
stores). `extractValue`'s array handling is the 2026-07-12 fix that made those render — do not
re-derive it.

- [ ] **Step 1: Failing test.** Cover: value is an artifact id → resolves; value is a legacy string
      → returns null (NOT a silent passthrough — the migration is what fixes data, and a fallback
      here would hide an unmigrated grid); no media binding → null; artifact children with no
      primary → `mediaArtifactsFor` still lists them.
- [ ] **Step 2: Implement.** Read `module.fieldBindings` for the media role; resolve
      `occ.fields[fid].value` as an occurrence id; collect artifact children from `occ.occurrences[]`.
- [ ] **Step 3: Verify.** `npm --prefix ./client run test -- src/__tests__/occurrenceMedia.test.js`.

**Verification:** all six existing `role === "media"` sites can be expressed through the new
functions (grep must show no remaining inline `b.role === "media"` outside this file at the end of
Task 4).

---

### Task 2: `ArtifactSpread` — the surface, against fixtures

**Files:** create `client/src/ui/ArtifactSpread.jsx`, `ArtifactSpreadHost.jsx`; CSS in `index.css`;
test `client/src/__tests__/ArtifactSpread.test.jsx`.

Layout: a centred surface, tiles at a minimum ~260px, **four visible to start** (2×2 at typical
panel widths), wrapping into more rows as the set grows, always one trailing "add" tile.
`grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))` with a max-width — no dependency on
the app's panel grid.

- [ ] **Step 1: Failing test** — renders one tile per artifact plus the add tile; Escape closes;
      the backdrop closes; a spread with a single artifact still renders (no empty-grid edge case).
- [ ] **Step 2: Implement** using `ArtifactCard` per tile. **Do not re-implement any renderer** —
      pdf/audio/video/image all already have one.
- [ ] **Step 3: Mobile** — on `document.body.dataset.layout === "mobile"` the spread is full-screen
      with one column. Reuse the drawer conventions from `ui/MenuSurface.jsx` (backdrop, safe-area,
      `overscroll-behavior: contain`); do NOT copy its code — a spread is not a menu.
- [ ] **Step 4: Browser harness** (temporary `client/_spread.{html,jsx}`, deleted after): measure
      tile count and box geometry at 1600 / 1200 / 390 wide. Assert 4 tiles fit above the fold at
      1600 and that nothing overflows horizontally at 390.

**Verification:** harness output pasted into the task notes, plus a screenshot.

---

### Task 3: Open it from the thumbnail

**Files:** `Field.jsx` (media pill), `ModuleInstance.jsx` (media block), `RepresentationView.jsx`.

- [ ] **Step 1:** Clicking a resolved thumbnail calls `openArtifactSpread(occurrenceId)`.
      "Set image…" moves INTO the spread's add tile — the pill stops being an entry point to the
      picker so there is exactly one way to add.
- [ ] **Step 2:** Keep the picker reachable for an occurrence with NO artifacts yet (the empty
      thumbnail opens the spread, whose only tile is "add").
- [ ] **Step 3:** E2E in a browser harness: instance row → click image → spread opens with that
      occurrence's artifacts → Escape → focus returns to the row.

---

### Task 4: The migration — strings become artifacts

**Files:** `server/migrations/00NN-media-fields-to-artifacts.mjs`; test for its pure half.

For every occurrence carrying a media-role field with a STRING value:
1. Mint a `role:"artifact"` module (`kind` sniffed from the extension, `fileRef` = the string,
   `meta.external: true` when it is an absolute URL — the existing remote-image shape) and an
   occurrence for it.
2. Rewrite the media field value to the new occurrence id.
3. **Append that id to the owner's `Files` field** so the picture is an attachment like any other,
   and bind `Files` on the owner's module if it is not bound yet
   (`ensureModuleBindingsForOccurrenceFields` is the existing helper for exactly this).
4. Idempotent: a value that already resolves to an artifact occurrence is skipped, and the `Files`
   append is a set-union.

- [ ] **Step 1:** Pure `planMediaConversion(occs, mods, fieldsById)` returning the list of
      conversions, unit-tested (extension sniffing, remote vs local, already-converted, missing
      module).
- [ ] **Step 2:** Dry run on `test grid 2`, then `poms grid`. **Report the count and a sample before
      applying** — this rewrites user-visible field values.
- [ ] **Step 3:** After applying: `checkGrid --all` must show no new errors, and a spot check that
      dropdown chips (`resolveOccCard`) still render their posters.

**Rollback:** the runner snapshots before writing; `npm run restore:grid` from that snapshot.

---

### Task 5: Seed + docs

- [ ] Seed mints artifacts for the seeded posters/photos so a fresh grid matches migrated data.
- [ ] Update `client/src/ui/CLAUDE.md`, `client/src/modules/CLAUDE.md`, `server/CLAUDE.md`.
- [ ] Root `CLAUDE.md` session entry; deploy; verify prod HEAD.

---

## Risks

- **Dropdown chips are the highest-traffic reader of the media value** (`resolveOccCard` runs for
  every option row in every occurrence dropdown). A resolution regression there is very visible.
  Task 1's tests must cover it before Task 4 changes any data.
- **`fileRef` strings are woven into `/uploads` URL building** (`resolveFileRef`). The artifact keeps
  the same `fileRef`, so that layer does not move — verify it does not.
- **Deleting an artifact that several occurrences reference.** A pick is a reference, so removing the
  artifact leaves dangling ids in every `Files` array that named it. The occurrence dropdown already
  tolerates an unresolvable pick (it renders the raw id), but this wants a real answer: either sweep
  the id out of every `Files` array on delete, or resolve-and-skip at render. Decide in Task 4.
- **`Files` must not become a tracker input.** Every occurrence-array field is loop-able by ops; a
  stray tracker summing "number of files" would be noise. Bind it `hidden` where it is not wanted
  and keep it out of `presenceFieldId` discriminators.
