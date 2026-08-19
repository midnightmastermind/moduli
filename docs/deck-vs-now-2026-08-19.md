# The pitch deck vs. what exists — 2026-08-19

**Source of truth for "the spec":** `moduli_pitchdeck_styled.pptx` (32 slides), extracted and read in
full. It supersedes `docs/vision-vs-now.md`, which is from 2026-05-23 and audits the *narrower*
`original-vision.md` day-planner framing rather than the deck.

Every status below is **measured against the source or the live database**, not recalled. Counts in
`code` are from a census run today.

---

## The headline

**The platform the deck describes is built. The collaboration and ecosystem layers around it are
not, and were never started.**

Slides 2-24 describe a system — grid, occurrences, fields, calculations, transactions, docs,
artifacts, OCR, automation, AI. Essentially all of it exists and is in daily use on `poms grid`
(3,161 modules, 3,272 occurrences). Slides 25-32 describe the runway *after* that — multi-user,
snapshots, marketplace, alternative views, integrations, agents. Almost none of that exists.

That is a coherent place to be. The risk is that the promo site currently describes the *narrow*
half of what is built.

---

## Slide 5 — the "high-level feature list", item by item

| # | Deck promises | Status | Evidence |
|---|---|---|---|
| 1 | Modular grid workspace (Panels / Containers / Instances) | **Shipped** | Plus a Page level the deck never anticipated |
| 2 | Drag & drop across windows + multi-window sync | **Shipped / partial** | DnD everywhere incl. cross-window payloads; live multi-window sync has documented edge cases (echo races, per-window active grid) |
| 3 | Occurrence-based placement + iteration/snapshots | **Shipped, reshaped** | Occurrences yes. "Iteration" was **retired** in favour of named filters + a filter cascade — a deliberate change, not a gap. Snapshots ≠ shipped (see below) |
| 4 | Custom fields on any instance | **Shipped** | **11 types**: number, text, boolean, select, date, rating, duration, occurrence, markdown, button, address |
| 5 | Derived calculations + dashboards | **Shipped** | Display fields + operations + **9 chart types** (sunburst, pie, bar, bar-h, bar-stacked, line, area, treemap, radar) |
| 6 | Transaction log with undo/redo + history | **Shipped (pass 1)** | Document-snapshot transactions, undo/redo, history panel. Pass 2 — grouping one editing burst into one step, action labels, pruning — scoped and **not started** |
| 7 | Rich document editor as modular blocks | **Shipped** | TipTap; every block is a real occurrence |
| 8 | Inline live variables in docs | **Shipped** | Expression pills, `[Field]` label tokens, bound header/body |
| 9 | Artifact uploads: files as first-class objects | **Shipped** | Upload, dedupe by SHA-256, thumbnails, EXIF, Files folder |
| 10 | File viewer/sorter — **gallery / list / table / timeline** | **Partial** | Viewers for image/pdf/audio/video/code; folder pages; artifact spread. **No timeline view, no gallery-vs-list-vs-table switcher for a file collection** |
| 11 | OCR notebook ingestion (images/PDF → text → structured) | **Shipped** | tesseract + a pdf.js raster step; OCR → checklist and OCR → prose both routed |
| 12 | Automation engine driven by workspace events | **Shipped** | **70 actions**, 14 trigger types, a visual pipeline editor |
| 13 | Script runner + integrations (webhooks / APIs) | **Partial** | `CALL_API` ships and works. A **script runner does not exist** as a user-facing thing; the Connections tab is file-storage import, not app integrations |
| 14 | AI assistant that builds/organizes/automates | **Shipped, thin** | Assistant drawer + **48 tools** against a local Ollama. Not wired to most flows, and not the "coordinator" the deck describes |

**11 of 14 shipped or substantially shipped.**

---

## Slides 8-24 — the system chapters

- **Grid / Panels / Containers / Instances** — shipped, plus **Pages** and **two grid modes**
  (rows×cols, and a BSP "mosaic"). The deck's "multiple modes (daily workspace, project workspace,
  dashboards)" reads today as different *pages*, not different grid modes.
- **Fields + bindings (input / display / record / derived)** — shipped; roles are `input`, `display`,
  `media`, `files`.
- **Calculations** — shipped and heavily used. Scoped windows (today / week / month / per page) all
  work.
- **Transactions** — shipped; every write is captured as before/after document snapshots, so undo
  covers entity types nobody wrote an inverse for. The deck's "who changed it" is single-user today.
- **Docs** — shipped, including block virtualisation (lazy editors: 117 live TipTap instances → 6).
- **Artifacts** — shipped, beyond the deck: content-hash dedupe, sharded storage, thumbnails, EXIF,
  orphan sweeps.
- **OCR** — shipped.
- **Automation** — shipped, and it is the strongest part of the system relative to the deck.
- **AI assistant** — the weakest. It exists; it is not the coordinator described.

---

## Shipped that the deck never mentions

Worth stating, because the promo site does not mention most of it either:

- **Pages** as a level between panel and container — four kinds (board, doc, canvas, table) plus
  folder pages.
- **Feeds** — a container can *pull* its contents by predicate, so a board is a live query.
- **The intake system** — **24 routed shapes** for a dropped/pasted file, link or text, each asking
  what it should become.
- **Skins + themes** — 7 skins, 6 themes, a per-occurrence-type style cascade (today).
- **Filters as a cascade** — grid → page → container, with named filters and a drilldown date picker.
- **Mobile** — a genuine phone layout with cell navigation, not a squeezed desktop.
- **A landing/promo site** and a public API surface.

---

## Missing, grouped by how far away it is

**Close — natural extensions of what exists**
- Multiple views on the same data: **calendar view**, **timeline / Gantt**, gallery-vs-table
  switching for a collection. The data model supports all three; no renderer exists.
- Global search + **Cmd+K command palette**. Occurrence search exists per panel and per page; there
  is no global palette. (`docs/suggestions/CommandPalette.jsx` is the doc editor's slash menu.)
- Saved searches as "smart containers" — feeds are 90% of this already.
- Notifications **inbox** panel. Toasts and alarms exist; a durable inbox does not.
- Formula field type. Operations do this today, in a more powerful and less approachable way.
- Snapshots / named versions / diff / rollback. The transaction log is the substrate and is already
  there; nothing exposes named snapshots.

**Middle — real projects**
- **Widgets + embeds** (music, video, maps, feeds, iframes) and shareable public views.
- **Deep integrations**: Drive/Dropbox sync, calendar two-way, email ingestion, Slack/Discord,
  GitHub/Jira, web clipper. Of these only a guarded URL fetch exists.
- **Mobile capture**: photo → OCR → instance, voice → transcript, offline sync.
- Templates **marketplace** (templates themselves ship).
- **Agentic AI** — plan-my-day, clean-up-this-workspace, doc → tasks.

**Far — needs a different architecture**
- **Multi-user**: shared grids, roles, permissions, presence, comments/mentions. Nothing exists;
  every model is single-user scoped.
- Relationship/graph view and auto-generated entity pages.
- Security/enterprise: E2E encryption, SSO/SAML, compliance export.

---

## What this means for the promo site

The deck's own one-liner is **"one space. infinite flow."** and slide 2 leads with *"every 'thing'
you do — notes, tasks, trackers, documents, files, dashboards, automations — lives in one unified
grid."*

The site today leads with **"Every task is a checkbox. Or a measurement."** — which is slide 13
(Fields), one chapter of thirty-two, and the *narrowest* true statement about the product. It reads
as a habit tracker. Someone who wants a second brain, a project hub, a file locker or a personal
homepage would not recognise themselves in it, and slide 6 lists **sixteen** such uses.

The revamp should lead with the workspace, not the field. See
`docs/superpowers/plans/2026-08-19-promo-generalisation.md`.
