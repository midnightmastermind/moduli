# Vision vs Now — Reconciliation Checklist

**Date:** 2026-05-23 · **Task:** #39

The 2026-04 `original-vision.md` framed Moduli as a day-planner: drag-and-drop daily command center, every task measurable, time + category filtering, calendar + to-do + habit tracker + budget/nutrition/workout. This doc audits each piece of that vision against what shipped, flags drift / scope expansion, and lists the features the original described that haven't landed yet.

## Vision → shipped status

| Original-vision piece | Today's status | Note |
|---|---|---|
| **Drag-and-drop daily command center** | ✅ Shipped | Grid + panels + pages + containers + instances; Pragmatic DnD throughout. |
| **Plan your day by dragging tasks into time slots** | ✅ Shipped | Schedule page with timeslot containers. |
| **Track what you actually did** | ✅ Shipped | Per-occurrence field values; complete/incomplete bookkeeping. |
| **Calculate totals, streaks, progress, stats from whatever you log** | ✅ Shipped | Operations pipeline + 15 aggregations + tracker display fields with `$displayRules`. |
| **Every task can be checkbox OR checkbox + numbers/text** | ✅ Shipped | Field types: number / text / boolean / select / occurrence / date / rating / duration. |
| **"Anything you do can be measured"** | ✅ Shipped | Any module can carry any field. |
| **Task Bank library** | ✅ Shipped (different shape) | Daily Toolkit folder + Library page; Templates manifest replaces the original "bundled tasks" concept. |
| **Drag tasks into your day — single / multiple / preset bundles** | ✅ Shipped | Drag-to-schedule + Apply Template (multi-occurrence stamp). |
| **Schedule becomes plan AND log** | ✅ Shipped | One occurrence carries both stamped slot + tracked field values. |
| **Time-lens filtering (today / week / month)** | ✅ Shipped | DrilldownDatePicker → DrilldownTimePicker; multi-date selection; per-period aggregation. |
| **Category filtering (work / personal / health)** | ✅ Shipped | `grid.namedFilters` + per-occurrence `filterOverride` cascade; visible via HeaderChevron filter button. |
| **Calculate across time window + category** | ✅ Shipped | DATE_IN_PERIOD + filterCascade evaluator. |

## Scope expansion beyond the original vision

The product has grown well past "day planner" — these are surfaces the vision doc doesn't mention but that shipped:

- **Rich text editor system** (TipTap doc containers, field pills, instance embeds, doc links, block-level handle menu, command palette)
- **Artifact system** (image / pdf / audio / video / code / markdown artifacts; OCR; sharp thumbnails; SHA-256 dedup; year-month shard; waveform; EXIF)
- **Canvas** (4000×4000 pannable world, drawing tools — pen / marker / fill / line / rect / circle / connect / eraser, color picker, undo/redo, edges between cards)
- **Visual operations builder** (categorized drilldown action picker, value manipulator actions, FIND auto-array, multiple switch on every action)
- **Templates v2** (clone-as-template, apply-template via ops, save-over)
- **Layout cascade** (per-kind drag-in view + nav options + lock + drop rules)
- **Style cascade** (Grid → Panel → Page → Container → Instance ownStyle chain with editor cascade preview)
- **Representation view** (label + icon + thumb + hover popup + inline-field chips)
- **Multi-day Schedule** (hybrid day-col wrappers + shared slot containers; ≤7 days = timeslot format, >7 = shortened grid)
- **REST API + Operations as callable endpoints** (`/api/v1`, Idempotency-Key, OpenAPI, rate limit, CALL_API outbound, IMPORT_HTML/IMPORT_MARKDOWN actions)
- **Jarvis assistant chat drawer** (tool catalog, server-side dispatcher, Anthropic SDK fallback)
- **Drag-to-import** (HTML / markdown / plain-text drop → native doc tree; Wikipedia smoke test; inline images; markdown pipe-tables → `kind:"table"` container)
- **Display rules** (per-occurrence color / icon / suffix / replaceValue rules attached to computed values)
- **Project kanban** (6 columns, Status Router op, bidirectional COPY_LINK to Todo List — partial)

## Still-open features the original vision described (or directly implies)

| Feature | Status | Where it lives in the docket |
|---|---|---|
| **Persistent streaks** | ⬜ Not started | Vision says "streaks" but no streak fields / ops shipped. Could be a `Tracker: Streak` op pattern. |
| **Achievement badges** | ⬜ Not started | Phase 3 docket — never picked up. |
| **Offline support with sync queue** | 🟡 Partial | `offlineQueue.js` buffers writes; conflict resolution + UI status surfaced via SocketStatusBanner. Multi-window full sync still pending. |
| **Pomodoro timer wired into operations** | 🟡 Partial | PomodoroTimer component exists but isn't wired to mint a per-pomodoro instance + tracker. Docket #15 (carried from old BUGS list). |
| **Quick-add presets / bundles** | 🟡 Partial | Templates cover this; "Daily Routine" template exists. The vision implied user-defined "bundle" objects — Templates IS that, but the UI surface for "drag the bundle into a slot" is just template-apply, which is fine but doesn't match the original phrasing. |

## Gaps the original vision DIDN'T describe but should have

The vision doc was written before:

- **External I/O surface** (browser extension, voice, Windows right-click, BangleJS, Spotify widget — see [#40](../client/src/CLAUDE.md) + #53 in the docket)
- **Mobile UX** (separate touch / drag / autoscroll codepaths)
- **AI assistant integration** (Jarvis drawer + offline LLM stack `docs/aispecs.md`)
- **Multi-tenant / per-user storage quota** (file-audit gap #15)
- **People library / profile cards** (#46 in the docket — depends on page-within-page primitive that just shipped)

## TL;DR

The original day-planner vision is **substantially over-delivered** — every promise in the vision doc has shipped, and ~10 major surfaces have been added on top (rich editor / artifact system / canvas / ops builder / templates v2 / cascades / multi-day / REST API / assistant / drag-import). The remaining vision-side gaps are small (streaks, badges, multi-window sync polish). The bigger forward direction is the scope-expansion items the vision doc never anticipated — external I/O, AI assistant tools, mobile parity, multi-tenant prep.

Recommended next direction: keep working through `client/src/CLAUDE.md` docket. The vision doc itself can stay as historical orientation only; the docket is authoritative.
