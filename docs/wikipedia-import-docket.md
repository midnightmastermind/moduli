# Wikipedia / doc-import docket

Outstanding items from the import work (captured 2026-06-06 at user request — "make
docket items for the rest of the stuff i said so we didn't miss anything"). Ordered
roughly by the user's emphasis. Status: ✅ done · 🔭 planned · ❓ needs a decision.

---

## ✅ DONE this session
- **Smarter, article-like importer** (`server/services/markdownImporter.js`).
  Consecutive prose + lists GROUP into one rich textblock — a markdown list →
  ONE `bulletList` node, bold/italic/links stay inline — instead of a stack of
  one-line blocks. Block images → artifacts, tables → table containers,
  sub-sections → nested containers; these flush the running textblock.
- **All doc occurrences** — every section is a `role:container kind:"doc"`
  whose textmap embeds its children via `moduleEmbed`; no `kind:board` containers
  and no `role:instance` list items left in the import.
- **Opens as a DOC page** — panel-picker wraps imports in a `kind:"doc"` page
  (moduleEmbed of the root); server `create_page` now persists `textmap` +
  `filterOverride`.
- **Absolute wiki links** — `wikipediaTools.htmlToMarkdown` resolves `./X` /
  `/wiki/X` → `https://en.wikipedia.org/wiki/X`.
- **Preview + confirm** before importing (thumbnail + extract + link to the page
  in a new tab). **Manual link-setting UI** on any textblock (URL or in-app
  target) — `InstanceForm` LinkSettingsSection + `TextblockCard` chip renderer.
- 38 importer/converter tests pass.

---

## ✅ 1. Section-hierarchy HEADERS — DONE (2026-06-06)
The import preserves heading LEVELS following the markdown directly.
- **`markdownImporter.js`** — each section container stamps
  `meta.headingLevel = min(node.level || 1, 6)` (the markdown heading depth:
  `#`=1, `##`=2, …; synthetic root → 1). Not tree depth — the markdown level.
- **`ModuleContainer.jsx`** — the embedded container header (the variant imported
  sections render as) sizes by `meta.headingLevel` via `HEADING_SIZES`
  {1:26,2:21,3:18,4:16,5:15,6:14}; containers without a level keep the default 20.
- Test: "section containers carry cascading heading levels (article H1→H2→H3)".
  22 importer tests + full client build pass.

## ✅ 2. Linked / multi-article import — "Eminem AND the surrounding wikipedia links" — DONE (2026-06-06)
**Fan-out:**
- `wikipediaTools.links(title, max)` → outbound ARTICLE titles (filters
  File:/Help:/Category:/… namespaces, self-links, dups, strips #anchors; cap 50).
- `GET /research/wikipedia/links` + `wikipedia_links` tool.
- Prompt: call `wikipedia_links` then `wikipedia_import` once per title (each =
  its own Approve card + doc page); ask once for count/depth if unspecified.
**Internal-link rewrite (relink):**
- `services/importRelink.js` — pure `relinkTextmap` / `relinkOccurrences`:
  converts an imported doc's inline Wikipedia link MARK into the editor's native
  `docLink` inline node (targetId = the imported article's root occ) when the
  linked title was imported; un-imported links stay external. 6 tests.
- `POST /research/wikipedia/relink` — builds title→rootOccId from the imported
  roots' labels, walks their textmap descendants, rewrites + persists + broadcasts
  `occurrence_updated`. `relink_imports` tool. Prompt: call it after the batch
  with all rootOccurrenceIds.
- Remaining polish (optional): a one-tap "import N linked pages" summary card +
  default caps; verify docLink navigation to a container root in-browser.

### (original plan kept for reference)
Import the main article + the articles it links to. **Confirmed by user:**
- **One confirm card per article** to choose (approve/decline each individually).
- **How many + depth** come from the user's words; if not given, **ask as
  follow-up questions in the UI** (count, depth).
- **Link rewrite:** links that point to an imported article get rewritten to an
  **internal target** (`meta.link.kind:"occurrence"` / inline link → in-app nav)
  so clicking navigates within Moduli; un-imported links stay external URLs.
- **Plan:**
  1. New tool `wikipedia_links(title, max)` → returns the top-N outbound article
     titles (from the article HTML) so the agent can fan out into N import
     confirms. (Enabling primitive — small, testable.)
  2. Agent: for "X + surrounding links" → call `wikipedia_links`, then emit one
     `wikipedia_import` confirm per chosen title (main + links).
  3. Follow-up Qs in the drawer when count/depth absent (reuse confirm-card UX).
  4. Post-import **relink pass**: build a title→importedRootOccId map across the
     batch; rewrite each imported doc's links whose target title was imported →
     internal nav. (The hardest slice — do after 1–3.)
- ❓ Decision: cap default (top 5? 10?) and depth default (1). One combined
  "Import X + N linked pages?" summary card in addition to per-article cards?

## 🟡 3. Page-kind awareness — DONE at the prompt level (2026-06-06)
System prompt now tells the assistant: pages have a KIND (doc/board/canvas/table);
INFER it from wording ("doc page"→doc, "board"/"kanban"→board, "canvas"/"mind
map"→canvas, "table"→table); if the user says just "a page" with no kind, ASK
first; create via create_module(role:page,kind) + create_occurrence. 30 agent
tests pass. (A richer in-UI page-kind PICKER card is future — folds into #4.)

## 🟡 4. More confirmation UX — readable confirm cards DONE; rich pickers pending
Audit finding: ~17 grid-mutating tools (create_*/update_*/delete_*/apply_template/
update_grid) are ALREADY `requires_confirm` — the Approve/Decline card the prompt
promises does appear. The gap was the CARD QUALITY for non-create tools (raw JSON).
- **DONE (2026-06-06):** `AssistantDrawer.jsx ConfirmCard` generic branch now
  renders the tool's one-line `description` + readable args — id-shaped values
  (parent/occurrence/target/field/module) resolved to labels/names from the live
  store, objects/arrays summarized ("N fields"), noisy keys (gridId/dryRun/userId)
  hidden. Helpers `prettyArgKey` / `friendlyArgValue` / `HIDDEN_ARG_KEYS`.
- **DONE (2026-06-06) — page-KIND picker:** `ConfirmCard` for
  `create_module` with `role:"page"` now renders doc/board/canvas/table buttons
  (pre-selected from the model's guess); Approve sends the chosen `kind`. So #3's
  "ask what kind of page" is now a UI affordance, not just a text question.
- **Remaining polish:** a one-tap "import N linked pages" summary card for the
  linked-import batch; editable fields on create_field cards.

## ✅ 5. board-container header padding — DONE (2026-06-06)
User clarified: the header ITEMS (not just the right buttons) needed ~2px more
above them. `ModuleContainer.jsx` standard header style for `kind:"board"` →
`padding: "4px 3px 2px 3px"` + `minHeight: 20px` (was fixed `height:20px` /
`padding:"2px 3px"`); non-board unchanged. Worth an in-browser confirm.

## 🔭 6. Offline Wikipedia (Kiwix / ZIM) — feasibility + speed
User asked: is there an offline Wikipedia < 1 TB, would it speed us up?
- **Answer:** Yes. Kiwix serves ZIM files locally. English Wikipedia **with
  images ≈ 100 GB**, **text-only ≈ 50–90 GB**; curated subsets ("best of",
  medicine, etc.) are 1–30 GB. Kiwix exposes a local HTTP API.
- **Speed:** it removes the per-article network round-trip to Wikipedia's REST
  API and lets us bulk/linked-import without rate limits — so the IMPORT/fetch
  step gets much faster + works offline. It does **NOT** speed up the local LLM
  (CPU inference, the actual bottleneck) — that's separate.
- **Plan (optional):** add a `WIKI_BACKEND=rest|kiwix` switch in `wikipediaTools`;
  when kiwix, fetch article HTML from the local Kiwix server instead of the REST
  API. Same htmlToMarkdown pipeline downstream.

---

### Notes
- All importer changes live in the TOOL (`markdownImporter.js` / `wikipediaTools.js`)
  — never DB-only — so they apply to all future imports. SERVER RESTART required
  to pick up server changes; re-import to get the new shape (old imports keep the
  old structure).
