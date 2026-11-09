# Smarter imports: shares land in Imports as real pages, OCR keeps its layout, and it gets measurably better

_Design, 2026-11-09. From a conversation with the user; their answers are quoted. Calls made by me (not the
user) are marked **[my call]**._

## Why

Imports and OCR come out wrong often enough that the user hand-fixes most of them. The two things they clip
most are **articles / blog posts** and **photos of paper / screenshots**. Concretely:

- The share window's custom (New) mode *"only showed me to fill the label and didnt let me see the body or
  images"* — articles and messages came out as empty rows.
- A bookmark is only ever a linked browser: *"if its a bookmark, i should be able to just turn it into a page
  there instead of just having a linked browser."*
- OCR loses layout: *"paragraphs are broken up onto new lines, magic isnt magicfying it into diff textblocks if
  its multiple paragraphs"*, and the original picture is not kept on the page.
- Auto scatters things across share rules (Bookmarks, Lookup, YouTube, Files); the user wants them in one place
  to file later.

**The worked example (keep it, it is the first test case).** The photo `share-clip-4d3868d7-….jpg` (poms grid,
2026-11-09 07:20, prod `uploads/user/2026-11/`) is a "Gnosis" card: a title, an opener ending "can refer to:",
a long definition paragraph, a SEPARATE paragraph "The tradition that gave birth…", and a centred italic Jung
quote with attribution. OCR + Page produced ONE paragraph holding everything but the quote, read "I" as "|",
and mangled *jña* → "jiia" and *rigpa* → "righa". Magic then had one blob and made one textblock.

## What success is

The user's measure is **both**: (1) imports rarely need hand edits, and (2) a fixed test set of their real
articles and screenshots is scored before and after every change, and the score goes up.

## Decisions (the user's)

1. **Auto puts pages, text, images and files into `Files › Imports`.** Calendar invites and contacts keep their
   current rules (Appointments, People).
2. **A link shared with Auto becomes a browser page (the bookmark) in Imports, AND the readable Moduli page is
   built under it automatically**, so the user can flip between the live site and the Moduli version without
   re-importing.
3. **What an import becomes is a full page** — laid out like the article (sections, headings, pictures wrapped
   beside prose), not a card.
4. **When the content is a recognisable type, match the user's boards:** e.g. an IMDb page gets the row shape
   and fields of the Movies board (same bindings, poster slot), but still lands in Imports.
5. **The share window shows a read-only preview of what will be created before saving** (label, fields, body,
   pictures); the user accepts or cancels. In New / Preset mode the window must show and let the user set the
   BODY and IMAGES as well as the label, and offer *keep as bookmark* vs *turn into a page* for a link.
6. **Smarts: rules first, AI to fill gaps.** The page's own structured data and the grid's fields decide what
   they can; an AI is asked only for what rules can't settle.
7. **The AI is the local Ollama (Jonah's).** No cloud model.
8. **"Keep training Ollama"** — the user wants OCR, page import, Wikipedia import and Magic to keep getting better.

## How it works

### A. One import pipeline for every source

Today four paths each turn content into a tree: the share rules, `import_url` / `import_text`, the OCR viewer's
"+ Page", and the Wikipedia importer. They should all go through **one pipeline** with stages, so an improvement
to a stage improves every source:

```
source ──► extract ──► structure ──► enrich (rules) ──► enrich (Ollama, background) ──► page
link       HTML →      paragraphs,   title, images,    board match, cleanup,
image      OCR →       headings,     structured data   section names, OCR fixes
text       as is       lists, quotes  (schema.org,
file       per kind                   og:, microdata),
                                      field mapping
```

`markdownToModuli` (the planner Magic, Reader and the Wikipedia import already share) stays the last step that
turns structured markdown into occurrences. **[my call]** The intermediate form between stages is markdown plus
a small metadata object (`{ title, images[], fields{}, type, source }`), because every existing stage already
speaks markdown and it is inspectable in the test set.

### B. OCR keeps the layout (the Gnosis case)

- **Paragraphs from geometry, not tesseract's grouping alone.** `helpers/ocrLayout.js` already splits at line
  height jumps and gaps; it missed the Gnosis gap. Re-derive paragraph breaks from the vertical gap
  DISTRIBUTION on the page (a gap clearly larger than the page's typical line gap is a break), plus a line that
  ends early with a colon or full stop followed by a line starting a new sentence at the left margin.
- **Quotes and attributions:** an italic or centred block, and a short line starting with an em dash or ending
  with a name after a closing quote, becomes a quote node.
- **The original picture is kept on the page**, wrapped beside or above the text.
- **OCR runs on the server** for Auto image shares (no tab may be open). **[my call]** tesseract (CLI or
  tesseract.js under Node) on the droplet, the same engine the client uses, so client and server agree.
- **Ollama cleanup pass (background):** given the OCR markdown, fix obvious misreads ("|" → "I"), rejoin
  hyphenation, and keep words it cannot verify as they are. It must NOT rewrite prose; the diff it may make is
  limited to character-level fixes and paragraph joins/splits, and is rejected otherwise.

### C. Page imports (articles)

- Main-content extraction stays (`readLinkForImport`). Add **structured data first**: schema.org JSON-LD
  (`Article`, `Recipe`, `Movie`, `Book`, `Product`, `Person`), Open Graph, and `<article>` markup give title,
  author, date, lead image and type without guessing.
- **Board match:** the type (from structured data, else the site, else Ollama) picks the user's board whose
  rows carry the closest Board Category; the page's import row takes that board's row shape
  (`destinationSearch.autoFields` already computes a destination's shape).
- **Magic splits real paragraphs into separate textblocks** and real sections into sections. Today's
  `boldSections` / heading rules stay; the change is that structure decided upstream (B, C) is what reaches it.

### D. The share window

- **Auto** shows the preview of what WILL be created: where (Files › Imports), the page's label, the matched
  board shape and fields, the body's first lines and the pictures. Read-only; Save or Cancel.
- **New / Preset** show and let the user set label, **body**, **images** and fields. For a link: *keep as
  bookmark* or *turn into a page* (or both, Auto's default).
- The preview is produced by the same pipeline running in plan mode (`import_plan` / `dryRun`), so what is shown
  is what is made.

### E. Auto's destination

- The per-type share rules for link / text / image / pdf / anything-else are retargeted to `Files › Imports`
  (a migration rewrites their CREATE / MOVE destinations; calendar and contact rules untouched).
- A link creates the bookmark (browser page) in Imports, then the readable page is built from it in the
  background and placed under it.

### F. Getting better over time ("training")

Retraining the model's weights is not practical on the server's CPU. Instead, a **feedback loop**:

1. **Test set.** `server/eval/imports/` holds real cases from the user's grid: the source (an HTML snapshot or
   an image) and the expected result (markdown + metadata), starting with the Gnosis card, a few of the user's
   clipped articles, a few screenshots, and a few Wikipedia pages. A runner scores each stage: paragraph
   boundaries, headings, quotes, title, image kept, board match, character accuracy for OCR.
2. **Corrections become examples.** When the user edits or rejects an import, the before/after is saved
   (per grid) as an example. The Ollama prompts include the few most similar past examples (by source type and
   site).
3. **No change ships without a score.** A rule or prompt change is run against the test set; a regression on
   any case blocks it.

## Constraints

- **Ollama is on the droplet, CPU-only** (3B ~9s for a short prompt; 7B timed out before). Every Ollama step
  runs **after the import is saved, in the background**, and the page updates when it finishes. An import must
  be complete and useful with rules alone; Ollama only improves it. A failed or slow Ollama call leaves the
  rules-only result.
- The share window must stay fast: its preview uses rules only. **[my call]** Ollama's part is not in the
  preview; the preview says "AI clean-up will run after saving".
- poms grid is protected live data: Auto's retargeting is a migration with a dry run first.
- One writer for occurrences (`runOperationServerSide` / `markdownToModuli`); no new parallel path.

## Non-goals

- Retraining or fine-tuning model weights.
- A cloud AI model.
- Changing how calendar invites and contacts are filed.
- Auto-filing imports onto boards (they land in Imports; the user files them).

## Anti-goals (would make this a failure even if it technically works)

- An AI that rewrites the user's text instead of fixing misreads.
- A preview that differs from what is created.
- An import that waits on Ollama before anything is saved.
- "Smarter" claimed without the test-set score to show it.

## Calls made while reviewing the design (mine, check them)

- **"Under it" for a link:** the bookmark (browser page) and its readable page sit side by side in Imports and
  point at each other; the bookmark's existing Reader/Magic tabs open the SAVED page instead of re-reading the
  site. The readable page is the Magic shape.
- **An image with no text** (OCR finds nothing worth keeping) becomes just the picture in Imports, no page.
- **An article matches no board** unless its structured data names a type the grid has a board for; otherwise it
  is a plain page with title, author, date, source link and lead image.
- **Imports already shared** (on the Bookmarks board, Lookup, YouTube) stay where they are; only new shares change.
- **Wikipedia links** go through the same pipeline; its existing importer becomes the "extract" stage for
  wikipedia.org, so it gains the test set and the clean-up pass too.

## Left to the builder

- The exact scoring metrics and weights per stage.
- How similar past examples are chosen (by site/type is the starting point).
- The tesseract packaging on the droplet.
- Order of work. **[my call]** Suggested: test set + runner first (so every later step is measured), then OCR
  layout (B), then the share window (D) and Auto retargeting (E), then page structured data (C), then the
  Ollama passes and the corrections loop (F).
