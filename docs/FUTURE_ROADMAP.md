# Moduli — Future Roadmap

**Last updated**: 2026-02-22
**Version**: Phases 1–6 in progress (Module Unification complete)

---

## The Vision

Moduli isn't just a planner. It's an **adaptive data surface** — a personal operating system for capturing, organizing, measuring, and displaying anything from anywhere.

Think Jarvis from Iron Man. The scene where Tony hijacks every screen in the room, flicks data between surfaces, pulls files from thin air, and the system just *knows* where things go. That's the north star.

Concretely, this means:
- **Capture from anywhere**: Browser extension clips a webpage → instance with URL field. Voice command adds a task. Phone photo → artifact in file tree. Right-click → "Send to Moduli" from any app. Watch button press → marks habit done.
- **Display anywhere**: Embed a panel in another app. Project your schedule onto a VR workspace. Push today's goals to a smartwatch. Render a read-only dashboard on a TV. Spotify widget on your profile page.
- **Connect to everything**: Calendar events become schedule items. Health data auto-populates fields. Bank transactions flow into expense tracking. Webhook fires when a habit streak breaks. Raindrop bookmarks become instances.

The occurrence-based, module-unified architecture is *designed* for this. Because entities are templates and occurrences are placements, the same data can exist in multiple contexts simultaneously — browser, VR, phone widget, API response, Bangle watch — each with its own view, iteration context, field values.

---

## Current Status (Feb 22, 2026)

| Phase | Focus | Status | % |
|-------|-------|--------|---|
| 1 | Occurrences & Core DnD | ✅ Complete | 100% |
| 2 | Fields & Calculations | ✅ Complete | 100% |
| 3 | Transactions & Block System | ✅ Complete | 100% |
| 4 | Docs, Artifacts & Rich Editor | ✅ Nearly Complete | 95% |
| 5 | Cascading Styles, Module Unification & Polish | 🟡 In Progress | 65% |
| 6 | Operations Editor, Command Center | 🟡 In Progress | 45% |
| 7 | Code Integrity & Architecture Overhaul | ⬜ Not Started | 0% |
| 8 | Automated Testing & Logging | 🟡 Foundation | 10% |
| 9 | API, Connections & Sharing | ⬜ Not Started | 0% |
| 10 | Whiteboard & Canvas Mode | ⬜ Not Started | 0% |
| 11 | Automation & Workflows | ⬜ Not Started | 0% |
| 12 | Mobile & Cross-Platform | ⬜ Not Started | 0% |
| 13 | Data & Privacy | ⬜ Not Started | 0% |
| 15 | AI & Intelligence | ⬜ Not Started | 0% |

**Phases 1–4: 100% complete.** Core architecture, DnD system, field calculations, rich text editor, file system, copylink mode, templates, iteration system, cascading style overrides, Module unification, Operations pipeline, and Command Center are all working.

---

## Phase 5: Cascading Styles, Module Unification & Polish — 65%

### Done ✅
- **5.1 Module Unification**: Panel/Container/Instance merged into single `Module` collection with `role` field. Unified CRUD. `update_module` socket event for all three.
- **5.1 Cascading Styles**: Style system (Grid → Panel → Container → Instance) with inherit/own modes. StyleHelpers.js, StyleEditor.jsx.
- **5.1 Right-click context menus**: ContextMenu.jsx portal pattern. Panel: Copy/Link/Split/Delete. Container: Copy/Delete. Instance: Focus/Copy/Delete.
- **5.1 Panel Copy/Copylink/Split**: `copyPanel`, `copylinkPanel`, `splitPanel`, `unsplitPanel` in LayoutHelpers.js.
- **5.14 Profile Data**: Profile panel with 8 interest category docs + Quick Notes notebook.
- **Pomodoro Timer**: PomodoroTimer.jsx wired to Toolbar.

### Remaining (35%)
- **5.2 CSS Audit**: Audit index.css, remove dead rules, extract to Tailwind utilities
- **5.3 Theme System**: Semantic color tokens, dark/light mode toggle, per-grid themes
- **5.4 Component Standards**: Standardize panel/container/instance visual spec
- **5.5 Responsive Layout**: Mobile-first breakpoints for tablet/phone
- **5.6 Nice-to-Haves**: Undo FLIP animations, PDF viewer in artifact panel, markdown extensions (tables, callouts, toggle lists)

---

## Phase 6: Operations Editor, Command Center & Performance — 45%

### Done ✅
- **6.1 Operations CRUD**: Full server socket handlers, cache, full_state. Client actions/reducer/CommitHelpers/bindSocketToStore/App context.
- **6.2 Block evaluator wired**: `operationExecutor.js` evaluates block trees. `computedValues` state slice. `SET_COMPUTED_VALUES` action for batch updates.
- **6.3 Command Center shell**: 7-tab drawer. Fields tab (functional). Operations tab (functional, block + pipeline modes).
- **6.4 Pipeline Editor**: `PipelineEditor` in OperationsBuilder.jsx. `executePipeline()` in operationExecutor.js. Sources/Conditions/Actions 3-stage form. SHOW_VALUE, SET_VALUE, NOTIFY, MOVE, RUN_OPERATION actions.
- **Command Center tabs**: ListsTab, ShortcutsTab, UserSettingsTab, ComponentsTab, FilesTab all implemented (not stubs).
- **BroadcastChannel sync**: Same-origin tab sync for non-socket actions.
- **Focused instance view**: Double-click fills container with drill-down view (breadcrumb → doc editor → linked siblings → history).

### Remaining (55%)
- **6.5 Templates**: Template auto-fill on iteration change (day starts → morning routine drops into 7am slot)
- **6.6 Kanban view**: Container display mode with swimlane columns (status-based)
- **6.7 Recursive drill-down**: childIds navigation (parent instance → child instances → grandchildren)
- **6.8 Performance**: Virtual scrolling for schedule panel, memoize `getPanelContainers`/`getContainerItems`, batch socket debouncing
- **6.9 Error boundaries**: Wrap Panel/Container/Instance in React error boundaries with retry
- **6.10 Server-side validation**: Joi/Zod schema on every socket handler

---

## Phase 7: Code Integrity & Architecture Overhaul — 0%

**Goal**: Apply The Pragmatic Programmer philosophy to every file. Remove legacy fallbacks, dead code, wrong abstractions. Result: modular, uniform, no special-cases.

### 7.1 Integrity Audit
| Area | Task |
|------|------|
| Naming | Uniform naming: `module` not `panel/container/instance` in all variable names |
| Legacy fallbacks | Remove all `panel\|container\|instance` legacy targetType handling (migrate remaining data) |
| Dead code | Delete Panel.jsx, SortableContainer.jsx, SortableInstance.jsx (superseded by Module.jsx) |
| Dead CSS | Audit index.css — remove anything that's unreachable |
| Schema consistency | Every field in every model should have a purpose; remove unused schema fields |
| Socket events | Remove legacy `update_panel`, `update_container`, `update_instance` handlers (all should be `update_module`) |
| DRY violations | Find and eliminate duplicate logic across DragProvider, LayoutHelpers, CommitHelpers |

### 7.2 Organization
| Area | Task |
|------|------|
| File structure | Flat `client/src/` is getting too large. Move to: `ui/`, `panels/`, `docs/`, `fields/`, `blocks/`, `state/`, `helpers/` |
| Component decomposition | DragProvider.jsx (~1300 lines) → split into `usePanelDrag`, `useContainerDrag`, `useInstanceDrag` hooks |
| Module.jsx decomposition | Module.jsx is large — split into ModulePanel.jsx, ModuleContainer.jsx, ModuleInstance.jsx |
| Test coverage | Every helper + every reducer case has a test |

---

## Phase 8: Automated Testing & Logging — 10%

**Foundation complete** (Feb 22):
- Vitest configured in `client/vite.config.js`
- `npm run test` from root delegates to client tests
- 172 tests passing across 4 files: `masterReducer.test.js`, `CalculationHelpers.test.js`, `CommitHelpers.test.js`, `LayoutHelpers.test.js`

### Remaining
- operationExecutor tests (shouldTrigger, executePipeline, runMatchingOperations)
- selectors tests (getGridPanels, getPanelContainers, getContainerItems)
- blockEvaluator tests (all block type evaluations)
- Integration tests: resetData integrity, Occurrence schema, Module CRUD round-trips, panel move persistence
- Server-side tests (Vitest or Jest for server)
- E2E tests (Playwright): panel move, instance drop, field value entry, undo/redo
- Logging system: structured JSON logs (Winston), performance metrics, error tracking

---

## Phase 9: API, Connections & Sharing — 0%

See `PHASE_PLAN.md` Phase 9 for full detail. Summary of subsystems:

- **9.1** Universal Programmable API (REST + JWT + WebSocket for external clients)
- **9.2** Connection Framework (pluggable adapter: add new integration = add one file)
- **9.3** Bangle.js Watch (BLE, send/receive commands, sync schedule)
- **9.4** Cloud Storage (Google Drive, Proton Drive, Obsidian vault)
- **9.5** Calendars (Google Calendar, iCal, Apple Calendar, Outlook)
- **9.6** Phone Widget (PWA, Android/iOS widget, quick-add from lock screen)
- **9.7** Email & Text (IMAP pull, SMS via Android bridge, send from Moduli)
- **9.8** Raindrop.io (bookmarks → instances, two-way sync)
- **9.9** Media Server (Plex, Radarr, Sonarr, Lidarr, Readarr, qBittorrent, SABnzbd, Overseerr, Tautulli)
- **9.10** Other Feeds (RSS, GitHub, Notion import, Zapier webhooks)
- **9.11** Spotify & Music (now-playing widget, playlist → container, listening history)
- **9.12** Social Media (Twitter/X, Instagram, YouTube, Reddit, Mastodon, Discord, TikTok — feeds as instances)
- **9.13** Widgets & Embeds — the **MySpace Layer** (widget panel type, Spotify player, social feed widget, stats widget)
- **9.14** Profiles & Social Layer — the **MySpace Social Graph** (public profile URL, follow system, multi-user grids, profile themes)
- **9.15** Import/Export (JSON, Markdown, CSV, PDF, grid duplication)
- **9.16** OCR & Document Import (Tesseract OCR, PDF→markdown, Scan Overlay as doc background, "Extract to System" → containers + instances)
- **9.17** Share to Moduli (browser extension right-click, OS right-click driver, mobile share sheet, universal inbox)

---

## Phase 10: Whiteboard & Canvas Mode — 0%

- Infinite canvas with pan/zoom (react-flow or custom)
- Arbitrary x,y positioning for items
- Connector lines between items
- Canvas templates — scanned document as background with containers/instances overlaid freely
- Document background layer: canvas on top of doc, doc is the backdrop for free-range placement
- Nested grids, container grids, responsive breakpoints

---

## Phase 11: Automation & Workflows — 0%

**Goal**: Real business logic automation without AI. Rule-based workflows, scheduled triggers, recurring operations.

- Scheduled triggers (run operation at specific time/day)
- Recurring operations (daily habit reset)
- Conditional branching in pipeline (if/else blocks)
- Multi-step chained operations (output of op A → input of op B)
- Batch operations (run across all occurrences in a container)
- Webhook trigger + webhook action
- Template auto-fill on iteration change
- Day page auto-creation
- Field computed dependencies (auto-re-run when source changes)

---

## Phase 12: Mobile & Cross-Platform — 0%

- PWA (installable, offline-capable, service worker)
- Mobile-optimized layout (touch-first panels, bottom nav)
- Native iOS/Android wrapper (Capacitor or React Native)
- Home screen widgets (today's schedule, quick-add)
- Push notifications (reminders, streak alerts)
- Apple Watch / Wear OS support

---

## Phase 13: Data & Privacy — 0%

- Self-hosting option (Docker compose, one-command install)
- Automatic backups (daily MongoDB dump → local/cloud)
- Backup restore UI
- End-to-end encryption (client-side for sensitive fields)
- GDPR compliance (full data export, right to deletion)
- Audit log viewer

---

## Phase 15: AI & Intelligence — 0%

**Foundation required**: Phase 6 (Operations) + Phase 11 (Automation) must be complete. AI is a smart operations client — all mutations go through the existing socket/state layer.

- **15.1 AI Profile Builder**: Conversational onboarding → builds panels/containers/instances/fields from chat
- **15.2 Jarvis Mode**: Natural language input ("mark exercise done", "add 30 min workout at 7am") → resolves entity → dispatches through operations layer
- **15.3 Intelligent Insights**: Smart scheduling, habit pattern analysis, goal suggestions
- **15.4 Auto-Tagging**: AI reads instance labels → suggests categories, fields, sibling links
- **15.5 Doc Intelligence**: Summarize day page, extract action items, suggest next steps

---

## Design Principles (Always Apply)

From `PRAGMATIC.md`:
- **DRY** — Single authoritative source for every piece of knowledge
- **Orthogonality** — Independent modules. CommitHelpers is the ONLY socket layer.
- **No Backward Compat** — Data isn't live yet. Change schemas completely. Legacy fallbacks = code rot.
- **Tracer Bullets** — Wire end-to-end thin slices first, then polish
- **Broken Windows** — Fix wrong abstractions immediately, don't patch over them
- **Contracts** — Components never call socket directly. CommitHelpers only.
