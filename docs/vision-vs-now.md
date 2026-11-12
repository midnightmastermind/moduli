# Vision vs Now — 2026-11-12

Supersedes the 2026-05-23 version of this file and `deck-vs-now-2026-08-19.md` as the current status. Sources:
`original-vision.md` (the day-planner pitch), the 32-slide pitch deck (`moduli_pitchdeck_styled.pptx`), and
`FUTURE_ROADMAP.md` (phases 9–15). Items marked unsure were checked against the code on this date.

## Original day-planner vision — done
Drag tasks into time slots, the schedule as plan and log, measurable tasks, totals, time + category lenses,
task-bank bundles: all built. The May gaps:

| Gap (May) | Now |
|---|---|
| Streaks | ✅ Current / Longest Streak trackers |
| Pomodoro wired into operations | ✅ each session is an instance on the schedule |
| Offline | ✅ boots offline from the last visit; offline edits kept |
| Multi-window sync | 🟡 shared date, one feed leader; rough edges remain |
| Achievement badges | ❌ never started |

## Pitch deck — 12 of 14 headline features built
Built: grid, DnD, occurrences, fields, calculations + 9 chart types, rich docs, live values in docs, uploads,
OCR, automation engine, file viewer (now books/PDF/code/CSV/markdown in place), AI assistant (Jonah: build tools,
notes; limited by the local 3B model).
Partial: **undo/redo** (redo switched off, edit grouping never done); **script runner** (none user-facing;
integrations grew instead). File viewer still lacks a timeline / gallery-vs-table switch.

## Future roadmap by phase
| Phase | Status |
|---|---|
| 9 API & connections | ✅ REST API + tokens, Google Drive, share (extension / phone / Windows), calendar + RSS feeds (one-way), Jellyfin play + sync, TMDB/USDA providers, Spotify album linking, OCR, markdown export. 🟡 Raindrop / Notion / Obsidian were one-off imports; arrs configured outside the app. ❌ Bangle watch, two-way Google Calendar, email/SMS, GitHub/Jira, social feeds, widget panels, public profiles |
| 10 Canvas | ✅ drawing, connectors, quick add. ❌ nested grids, doc-as-background |
| 11 Automation | ✅ scheduled triggers, if/else, RUN_OPERATION, day pages + schedules built by ops, buttons, forms |
| 12 Mobile | ✅ phone layout, installable PWA with offline shell, share target. ❌ push notifications, home-screen widgets, watch. (Quest VR app is native) |
| 13 Data & privacy | 🟡 backup/restore CLI only; encrypted stored keys. ❌ restore UI, Docker self-host, E2E encryption |
| 15 AI | 🟡 offline chat that edits the grid. ❌ insights, auto-tagging (import clean-up built, switched off), onboarding |
| Phase 6 leftovers | ✅ kanban, virtual scrolling, error boundaries. 🟡 server-side validation |

## Not started (the August "close" list)
Calendar view · timeline / Gantt · global command palette (toolbar search is grid-wide but runs no commands) ·
formula field · named snapshots with diff / rollback · durable notifications inbox (notification dropdown is partial).
**Far:** multi-user (shared grids, roles, comments) — the one big architectural decision left.

## Built that no plan mentioned
VR office + Quest app, Jellyfin playback in the app, the book reader with Magic, the share placement window,
feeds as live queries, skins, mobile scroll / load performance work.

## Suggested next
1. Calendar view (data supports it; renderer only). 2. Fix redo + group an editing burst into one undo step.
3. Command palette. 4. Named snapshots.
