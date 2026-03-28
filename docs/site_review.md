# Moduli — Site Review
_Generated: March 12, 2026. A clean-sweep review of the full project: what's done, what's missing, where the bloat is, and what to do next._

---

## 1. OUTSTANDING FEATURES — "Things You Said" Verification

After reviewing every plan file, BUGS.md, PHASE_PLAN.md, FUTURE_ROADMAP.md, aispecs.md, and banglespecs.md — here is the complete status of every feature and request ever mentioned.

### ✅ Confirmed Done (verified in code + DB today)

| Feature | Where |
|---------|-------|
| Task G — Code block artifact (viewType: "code") | Artifact.jsx + server.js |
| Task I — Grid/table module (viewType: "grid") | Artifact.jsx + View.js enum |
| Bug 2 — Q&A question in H2 heading node | createDefaultUserData.js → confirmed in DB |
| Task H — Sections for all flat notes (uses.md, PRAGMATIC.md, aispecs.md, banglespecs.md) | createDefaultUserData.js → parseSectionsWithInstances |
| Bug 16 — Hover cog cascades to ancestors | index.css :not(:has(...)) fix |
| Bug 17 — Drag highlight lag | DragProvider.jsx already uses direct DOM mutation + DragHotContext split |
| Phase 6.4 — PipelineEditor (4-stage form) | OperationsBuilder.jsx exports PipelineEditor |
| Bug 1 — Instance handle height | Instance.jsx line 227 inline style fix |
| Bug 6 — Hover-only drag handles | index.css .module-handle rules |
| Bug 8 — Day page duplication | Module-level _dayPagesCreating Set |
| Bug 9 — Doc toolbar transparent | DocToolbar.jsx bg-background |
| ModuleEmbed TipTap extension | docs/ModuleEmbedExtension.js + ModuleEmbedNode.jsx |
| Notebook structure (Stan/Notes/Gospel/Phil parent docs with embedded sections) | createDefaultUserData.js |
| Container embedded styling (lightenHex, two-row header, per-section colors) | modules/Container.jsx |
| LocalIterationNav collapsible prop | ui/LocalIterationNav.jsx |
| Container/Panel hideable headers with cog | modules/Container.jsx + Panel.jsx |
| Instance showLabel toggle | modules/Instance.jsx |
| ManifestTree improvements (indent, ellipsis, anchor chips, compact doc row) | modules/ManifestTree.jsx |
| Daily Journal removed — Q&A directly in Day Page | createDefaultUserData.js |
| Live field pill values in docs | docs/hooks/useDocFieldValues.js |
| Real occurrences for docs | createDefaultUserData.js (textmap pattern) |
| RadialMenu portal z-index + open direction fix | ui/RadialMenu.jsx |
| Drag highlight (direct DOM, no React re-render) | DragProvider.jsx setDropHighlight |

### ❌ Genuinely Not Done — Carried Forward

These are real outstanding items from your session requests, confirmed NOT in code:

#### 🔴 High Priority
| # | Feature | Where | Effort |
|---|---------|--------|--------|
| H1 | **Day page auto-creation operation** — CREATE_OCCURRENCE_WITH_ITERATION effect in operationExecutor | operationExecutor.js + createDefaultUserData.js | Medium |
| H2 | **Tree drag-and-drop (full)** — ManifestTree folder/anchor chips draggable to grid cells (not just file→folder) | ManifestTree.jsx + DragProvider.jsx | Medium |

#### 🟡 Medium Priority
| # | Feature | Where | Effort |
|---|---------|--------|--------|
| M1 | **Recurring due dates** — auto-reset dueDate field after completion (weekly/monthly) | operationExecutor.js + Field model | Medium |
| M2 | **onSchedule server trigger** — server cron fires operations at specific hour/minute | server.js setInterval already exists, needs hook | Small |
| M3 | **S6: Expression pills** — inline block trees in doc paragraphs (live computed value pill) | docs/ + blockEvaluator.js | Large |

#### 🟢 Low Priority (from BUGS.md / Feature Queue)
| # | Feature | Notes |
|---|---------|-------|
| L1 | S8: Scenarios doc — test use-case walkthroughs | Documentation task |
| L2 | Bug 15: Schedule+DayPage stacking hint on first load | UX polish |
| L3 | L5: File upload inline preview (images in instance cards) | Phase 6 |
| L4 | Performance: virtual scroll for 100+ items | Phase 6 |

#### 🔵 From Your Spec Files (Future Phases)
| File | What It Is | Status |
|------|-----------|--------|
| `aispecs.md` | Offline AI assistant (Ollama + qwen2.5-coder + JSON router) | Phase 15 — not started, architecture doc only |
| `banglespecs.md` | Bangle.js watch integration (BLE → HTTP POST → instance creation) | Phase 9 — not started, architecture doc only |

---

## 2. CODE BLOAT — Dead Files

### Dead Files in `client/src/` Root

| File | Lines | Status | Action |
|------|-------|--------|--------|
| `GridResizeHandle.jsx` | 93 | **Not imported anywhere** | Delete |
| `Debugbar.jsx` | ~40 | **Not imported anywhere** | Delete |
| `PanelClone.jsx` | ~20 | **Not imported anywhere** | Delete |

`uid.js` — **Keep.** Imported by 6 files (CommandCenter, IterationNav, LayoutHelpers, GridFieldsBank, InstanceForm, GridLayoutForm).

`ResizeHandle.jsx`, `LoginScreen.jsx`, `reportWebVitals.js`, `socket.js` — all active.

### Assessment
Server scripts are clean. All 6 legacy scripts deleted in a prior session. Only `resetData.js` remains. Models are all in use.

---

## 3. LARGE FILE BLOAT — Where the Real Problems Are

### Server
| File | Lines | Problem | Fix |
|------|-------|---------|-----|
| `server/utils/createDefaultUserData.js` | **3,753** | Everything in one file: markdown parsers, doc builders, operation builders, field defs, instance makers, wiring logic | Split into 7 modules (see Section 5) |
| `server/server.js` | **2,126** | 80 socket handlers + auth + upload + rooms all inline | Split into socketHandlers/ folder (see Section 5) |

### Client
| File | Lines | Problem | Fix |
|------|-------|---------|-----|
| `ui/CommandCenter.jsx` | **~2,700** | 160-item UI + 7 tabs + search + entity tree all inline | Extract tabs into separate files |
| `helpers/DragProvider.jsx` | **~1,711** | 177 functions — panels, containers, instances, ops, fields, external, auto-scroll all mixed | Extract per-type coordinators |
| `blocks/operationExecutor.js` | **~1,300** | 13+ action types all in one giant switch | Extract action handlers to separate file |
| `helpers/LayoutHelpers.js` | **~1,072** | Layout resolution + iteration cascading + time filtering mixed | Split into 3 focused helpers |
| `ui/GridFieldsBank.jsx` | **~1,006** | Field management + field creation form in one component | Extract FieldForm |
| `ui/LayoutForm.jsx` | **~960** | Panel layout + iteration + style config mixed | Extract StyleEditor, IterationSettings |
| `modules/Container.jsx` | **~919** | Container shell + DocEditorShell + embedded styling all inline | OK for now — split when touching |

---

## 4. TEST COVERAGE GAPS

### What's Well Tested ✅
| File | Tests | Coverage |
|------|-------|----------|
| CalculationHelpers.js | 58 | All 15 aggregations + time filters |
| operationExecutor.js | 104 | Action types, loops, conditionals, date ops |
| masterReducer.js | 55 | All state mutations |
| CommitHelpers.js | 35 | CRUD + socket emission |
| LayoutHelpers.js | 39 | Occurrence filtering |
| Server tests (6 files) | 63 | Schema validation, gridHelpers |
| **Total** | **354** | Core logic well-covered |

### Critical Gaps ❌
| File | Lines | Risk |
|------|-------|------|
| `helpers/DragProvider.jsx` | 1,711 | **Highest risk** — DnD bugs only caught manually |
| `ui/CommandCenter.jsx` | ~2,700 | Bugs in tabs/search/entity tree go undetected |
| `modules/Container.jsx` | ~919 | Embedded styling regressions go undetected |
| `helpers/LayoutHelpers.js` | 1,072 | Iteration cascade bugs go undetected |
| `docs/` (TipTap extensions) | ~800 | Pill insertion/deletion untested |

**Recommendation**: Write E2E tests (Playwright) for the 5 critical user flows:
1. Drag instance from one container to another
2. Create field + bind to instance + verify aggregation
3. Open notebook → navigate to section → verify section loads
4. Type @ in doc → insert field pill → verify live value
5. Run operation manually → verify SHOW_VALUE updates display

---

## 5. EFFICIENCY — What to Refactor

### A. Split `server.js` (2,126 lines → ~300 lines + 4 handler files)

The server is one giant switch statement. Here's the target structure:

```
server/
├── server.js               (~300 lines — setup only: Express, Socket.io, auth, rooms, imports)
└── socketHandlers/
    ├── crud.js             (create/update/delete for Module, Occurrence, Field, Grid, Operation, View)
    ├── state.js            (request_full_state, full_state emission, cache logic)
    ├── operations.js       (undo, redo, get_transactions, get_field_history, run_operation)
    └── templates.js        (save_template, fill_from_template)
```

Each handler file exports `registerHandlers(io, socket, context)` and registers its own events.

**Impact**: From 80 mixed handlers to 4 focused files. Easy to find, easy to test.

### B. Split `createDefaultUserData.js` (3,753 lines → ~500 lines + 6 helper files)

```
server/utils/
├── createDefaultUserData.js     (~500 lines — imports helpers, orchestrates STEP 1-10)
├── mdParsers.js                 (parseSections, parseSectionsWithInstances, inlineToTipTap)
├── docBuilders.js               (makeDocContent, makeParentDocTextmap, makeNotebookContainerDocContent)
├── operationBuilders.js         (makeLoopSumOp, makeNetBalanceOp, makeCountdownOp, etc.)
├── fieldDefs.js                 (all ~58 field object definitions)
└── instanceMakers.js            (makeWorkout, makeNutrition, journalQADefs, etc.)
```

**Impact**: Finding "where is the journalQuestion field defined?" goes from grep → open one file.

### C. Split `operationExecutor.js` (1,300 lines → ~400 lines + 1 helper file)

```
client/src/blocks/
├── operationExecutor.js         (orchestration: shouldTrigger, executePipeline, runMatchingOperations)
└── operationActions.js          (all executeActionItem cases: SHOW_VALUE, SET_FIELD_VALUE, LOOP actions, DATE_DIFF, etc.)
```

**Impact**: The current 500-line switch becomes a clean import. Easier to add new action types.

### D. Split `LayoutHelpers.js` (1,072 lines → 3 files)

```
client/src/helpers/
├── LayoutHelpers.js             (getPanelContainers, getContainerItems, getContainerItemsWithOccurrences — layout only)
├── IterationHelpers.js          (occurrenceMatchesIteration, cascadeIteration, resolveIteration)
└── TimeFilterHelpers.js         (includeOccurrenceByTime, timeFilterLabel, relative date display)
```

**Impact**: CalculationHelpers already imports both — no consumer changes needed beyond re-exporting.

### E. Extract `CommandCenter.jsx` Tab Components

The 7 tabs are all inline. Each tab should be its own file:

```
client/src/ui/
├── CommandCenter.jsx                   (shell + tab switcher + search)
└── commandCenter/
    ├── FieldsTab.jsx
    ├── OperationsTab.jsx
    ├── ListsTab.jsx
    ├── ComponentsTab.jsx
    ├── FilesTab.jsx
    ├── EntityTreeTab.jsx
    └── SettingsTab.jsx
```

### F. Remove 3 Dead Files

```bash
rm client/src/GridResizeHandle.jsx
rm client/src/Debugbar.jsx
rm client/src/PanelClone.jsx
```

No build changes needed — they're not imported.

---

## 6. WHAT STILL NEEDS TO BE DONE — Phase Status

### Phases 1–4: Core Architecture ✅ ~97% Complete

Everything working. Minor remaining items:
- Day page auto-creation operation (H1 above)
- Tree drag-and-drop full implementation (H2 above)

### Phase 5.1: Cascading Styles ✅ 100% Complete

Grid → Panel → Container → Instance style inheritance. StyleEditor.jsx, StyleHelpers.js, all wired.

### Phase 5 Remainder (~30% done):
- CSS audit + migrate inline styles to Tailwind
- Dark/light mode system
- Responsive layout (mobile breakpoints)
- PDF.js viewer, markdown table rendering

### Phase 6: Performance & Polish (~20% done):
- Virtual scrolling (100+ items)
- Template auto-fill on iteration change
- Kanban swimlane display mode for containers
- Conflict resolution for multi-window edits

### Phase 7: Code Integrity (0% — Next Major Sprint):
This entire phase is the refactors described in Section 5 above, plus:
- Naming convention audit (`create_module` vs `createModule` inconsistency)
- Schema field cleanup (iteration.value legacy vs timeValue)
- Remove all `// legacy fallback` comments
- `server.js` split (biggest win)

### Phases 8–15: Future (Research Docs Exist, Code Not Started)

| Phase | Description | Key File |
|-------|-------------|----------|
| 8 | API & Connections (Google Drive, email, social) | FUTURE_ROADMAP.md |
| 9 | Whiteboard/Canvas mode | FUTURE_ROADMAP.md |
| 10 | Automation & Workflows (recurring ops) | FUTURE_ROADMAP.md |
| 11 | Mobile + PWA | FUTURE_ROADMAP.md |
| 12 | Data/Privacy (self-hosting, encryption) | FUTURE_ROADMAP.md |
| 13 | AI integration (Frog assistant, Jarvis mode) | aispecs.md |
| 14 | Bangle.js watch integration | banglespecs.md |

---

## 7. QUICK WINS — High Impact, Low Effort

These can be done in a single session with minimal risk:

| Win | Effort | Impact |
|-----|--------|--------|
| Delete 3 dead files (GridResizeHandle, Debugbar, PanelClone) | 5 min | Cleaner codebase |
| Split operationExecutor.js → extract operationActions.js | 45 min | Easier to add actions |
| Wire `onSchedule` properly to server setInterval (M2) | 30 min | Operations run on time |
| Add Bug 15 "stacked panel" hint (tooltip on first load) | 30 min | Discoverability |
| Write 5 Playwright E2E tests for critical user flows | 2-3 hrs | Regression safety |

---

## 8. DEPENDENCIES — Nothing to Cut

Client has 40 deps, server has 9 deps. Every one is justified and actively used.

`uid.js` (client-side) is used by 6 files. Keep it — server uses nanoid, client uses its own uid() because it doesn't import server code.

`web-vitals` — only entry point call in main.jsx. Low value but harmless. Could remove if bundle size matters, but it's tiny.

---

## 9. OPEN BUGS

| # | Description | Priority | Fix |
|---|-------------|----------|-----|
| 1 | React child error — Lucide forwardRef icons as JSX children | P1 — Intermittent | Wrap icon renders with `React.createElement` instead of passing component directly |
| 2 | RadialMenu direction needs rebuild verify | P1 — Known | `npm run build` + browser test after any session |
| 15 | Schedule+DayPage stacking not discoverable | P2 | Show "2 panels — click arrows to switch" on first load |

Bugs 3–14 and 16–17 are all resolved.

---

## 10. SUMMARY SCORECARD

| Category | Score | Notes |
|----------|-------|-------|
| **Architecture** | 9/10 | Occurrence/Module/View three-concept model is solid. CommitHelpers as single dispatch point is excellent. |
| **Test coverage** | 7/10 | Core logic well-tested. UI and drag system not tested. |
| **File organization** | 6/10 | Good structure but 4 monolith files (server.js, createDefaultUserData.js, CommandCenter.jsx, DragProvider.jsx) dominate. |
| **Code cleanliness** | 8/10 | No circular deps, no legacy fallbacks, no dead models. 3 dead root files need removing. |
| **Feature completeness** | 8/10 | Phases 1–4 nearly done. Phase 5 CSS/mobile polish pending. Phases 7+ not started. |
| **Dependencies** | 10/10 | Minimal, all justified. |
| **Performance** | 7/10 | Bundle is reasonable. No virtual scroll yet. Full-state payload will scale poorly past 1000+ records. |
| **Docs/Memory** | 9/10 | CLAUDE.md per-folder + MEMORY.md system is excellent. BUGS.md and PHASE_PLAN.md kept current. |

**Overall: 8/10** — Production-quality architecture for a personal tool. The main work is code organization (splitting monoliths), test coverage expansion, and completing Phase 5–7.
