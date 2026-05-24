# Bugs

1. code blocks arent rendering
2. the components section isnt ordering right. 
3. ~~the grids settings tab should be the farthest left tab.~~ ✅ already first in TABS array
4. tables are deleting row when you click on the row number (shouldnt happen)
5. collapsing the stuff in the tree should collapse the stuff underneath. right now it expands everything when reopened. 
6. the question and answers are broken in the day page. it shows two fields in the body when it should just show the answer field. the header is correct but it should a field for question in the header, not just a header. so for example. what went well? should be a question field inside a container header.
7. ~~the highlight for drag on containers blinks like crazy.~~ ✅ fixed
8. ~~the canvas we have (freepad), looks like it has the functionality of a listpanel. we need it to be recognized as a canvas.~~ ✅ fixed (+ draw toolbar added, drag in/out fixed Mar 26)
9. ~~the moduli header is being cut off by the grid select.~~ ✅ fixed
9b. ~~FIND_OCCURRENCE test failure — `operationActions.test.js > skips deleted occurrences` fails~~ ✅ fixed (restored `!o.deleted` check)
10. right now i cant click in the middle of a sentence and type in a doc and i should be able to. 
11. the daily answer fields are broken (just says object object)
12. we need a new doc button in the tree.
13. i just tried to drag an image file off my desktop to into my grid and nothing happened when i dropped. 
14. we should be able to cycle to empty grid cell in the panel cycler. 
15. we should add in and option that pomodoros create a instancemodule and puts it in whatever container we select (with the option to base it on a time field (i put in the time field thats connected to the container))
16. that reminds me, in the example data, i dont see any fields. we need the date field and the time field. and those should work with the filters.
17. we should have toasts always show up on the panel we are currently on, on mobile (if we arent already)

# Bugs

1. code blocks arent rendering
2. the components section isnt ordering right. 
3. the grids settings tab should be the farthest left tab. 
3.5 important: we should make sure the canvas is working, currently it says drop containers there (should be able to drop any module), and nothing happens when i drop on it currently.)
4. tables are deleting row when you click on the row number (shouldnt happen)
5. collapsing the stuff in the tree should collapse the stuff underneath. right now it expands everything when reopened. 
6. the question and answers are broken in the day page. it shows two fields in the body when it should just show the answer field. the header is correct but it should a field for question in the header, not just a header. so for example. what went well? should be a question field inside a container header.
7. the highlight for drag on containers blinks like crazy.
8. the canvas we have (freepad), looks like it has the functionality of a listpanel. we need it to be recognized as a canvas.
9. the moduli header is being cut off by the grid select.
10. right now i cant click in the middle of a sentence and type in a doc and i should be able to. 
11. the daily answer fields are broken (just says object object)
12. we need a new doc button in the tree. (but dont put it on every single folder. just do one button at the top and make it bigger and make the panelcycler wider)
13. i just tried to drag an image file off my desktop to into my grid and nothing happened when i dropped. 
14. we should be able to cycle to empty grid cell in the panel cycler. (so none for panel) 
15. we should add in and option that pomodoros create a instancemodule and puts it in whatever container we select (with the option to base it on a time field (i put in the time field thats connected to the container))
16. that reminds me, in the example data, i dont see any fields. we need the date field and the time field. and those should work with the filters.
17. dropping a module into the tree should be allowed and put in the corresponding document.
18. Example data. make the bank display fields be checking_account, savings_accounts, moms_saving_account and moms_checking_account and put that in an Bank Account instance. In the example data, do make the goals/accounts have seperate instances for each. just put the fields in one instance for those. 
19. we should have a quick flex layout option for fields and label in an instance or doc header. (direction for both in relation with each other and the fields direction as well)
20. we need to wait on the inputs to change and we press enter for the css layouts in the module settings. or when we take focus off. right now, its living updating on every keystroke and making the app crash. (we should wait until we finish typing until applying css/layout changes). 
21. the highlight blinks like crazy when hovering over the correct spot (instance over a container)
22. we need to be able to change the layout of the headers/labels and the fields. (between each other and fields in relation with another, so theres 2 settings. just do flex options for now. this should be in module settings)
23. tables in docs are not rendering correctly
24. make images in the example data be inside instances. (an instance for each image) (with a description undeneath).
25. make the collapse for listinstences look more like its connected to the instance. right now its just space underneath it.
26. put tip tap tags in by using # with no space.
27. we are going to add a new module type and thats called page. we are splitting up panels functionalities to be a bit diff. panels still handle dragging to cells and such but its just one thing now and may/or may not have have a tree (in the settings). pretty much its always gonna contain a page (the outterness of it will look like a doc. just a tree and the doc sorta thing. a page is going to be either a canvas, a list, or a doc, or display (display will be to show artifacts and up close drill down views).) the manifest tree will have a switch at the top for a local manifest (for just that panel). or the global one. then we can get rid of the manifest in board. everything is gonna have a spot in the manifest tree inside some folder. the pages can only be dropped into panel and all the other modules get dropped into page (whatever kind it is). the panel is just an all around window for now. page is gonna be a new module that handles all the other stuff panel was (panel still has label and settings not pertained to the inner components.) the occurence for panel should just be an array of pages. the manifest will be based on folders though and not panel location. when we are dragging to a panel and drop it, 
---

## 🔴 Open

1. **React child error** — Lucide forwardRef icon components intermittently throw when passed as JSX children (e.g. inside RadialMenu items). Intermittent, hard to repro consistently.

2. **Playwright E2E tests timeout** — Chromium tests fail because grid data doesn't load in 15s, or dev server isn't running. Always start `npm run dev` + resetData before running `npx playwright test`. Known limitation, not a code bug.

3. **ManifestTree ordering wrong in example data** — Items in the sidebar tree appear in the wrong order. The sortOrder values assigned in `createDefaultUserData.js` for the notes folder and its children (parent docs, flat notes sections, etc.) are not producing the intended visual order in the tree.

4. ~~**"Grid" view type should be inline TipTap tables**~~ ✅ Fixed: `GridViewer` component + `viewType: "grid"` branch removed from `ArtifactContent.jsx`. TipTap table extension already provides inline tables in doc containers; the canonical `kind: "table"` container (shipped 2026-05-18) is the layout-grid alternative.

5. **Code blocks not rendering** — TipTap code blocks don't render in doc containers (BUGS.md #1).

6. **Components tab ordering wrong** — The Components section in Command Center isn't ordering items correctly (BUGS.md #2).

7. ~~**Grid Settings should be leftmost tab**~~ ✅ Fixed: `CommandCenter.jsx` `TABS` array has `grid` as index 0.

8. **Table row-number click deletes row** — Clicking the row number handle in an inline TipTap table deletes the row instead of selecting it (BUGS.md #4).

9. ~~**Tree collapse resets expand state**~~ ✅ Fixed: CSS `display:none` keeps children mounted; `collapseGen` propagation resets children when parent closes.

10. **Q&A container fields broken** — Question/answer fields show incorrectly in day page: body shows two fields when only answer should be there; header should show a question field not just text (BUGS.md #6).

11. **Container drag highlight blinks** — The blue highlight border on containers flickers rapidly during drag (BUGS.md #7).

12. ~~**Freepad/canvas renders as list panel, missing draw toolbar**~~ ✅ Fixed: canvas-kind routing in `ModuleContainer.jsx` + `ModulePage.jsx`; full drawing toolbar via `CanvasContent.jsx` (pen / marker / fill / line / rect / circle / connect / eraser + per-color picker + size + undo/redo).

13. **Moduli header cut off by grid select** — The toolbar header is visually truncated by the grid select dropdown (BUGS.md #9).

14. ~~**Can't click mid-sentence in doc**~~ ✅ Fixed (Apr 10 2026): `Editor.jsx` + `DocContent.jsx` added `draggable={false}` on the editor wrapper + `editor.commands.focus()` on padding-click — Pragmatic DnD's parent `draggable="true"` was eating mousedown.

15. **Daily answer fields show "object object"** — Daily answer fields render as `[object Object]` instead of their value (BUGS.md #11).

16. ~~**No "New doc" button in tree**~~ ✅ Fixed: ManifestTree `FolderNode` now exposes `+ New Doc` on folder hover (`handleNewDoc` in `ManifestTree.jsx`) and the root tree's RadialMenu has Board / Doc / Canvas / Folder page-create entries.

17. ~~**Desktop image drag to grid does nothing**~~ ✅ Fixed: OS file drops now upload via `/api/artifacts/upload` and create a new artifact panel at the drop location. If dropped onto an existing artifact panel, switches the active document.

18. ~~**Panel cycler can't cycle to empty cell**~~ ✅ Fixed: `cyclePanelStack` now cycles through N+1 states (N panels + 1 "all hidden" state). When all panels are hidden, an empty pocket shows a "show" button. Calling with `cellKey` instead of `panelId` works from the empty-pocket button.

19. ~~**Missing null guard in FIND_OCCURRENCE**~~ ✅ Obsolete: `FIND_OCCURRENCE` was removed and replaced by the unified `FIND` verb (which iterates a config-named collection like `$allOccurrences` and tolerates missing collections cleanly — `Array.isArray` guard at iteration entry).

20. ~~**Missing null guard in getContainerItems**~~ ✅ Fixed: `getContainerItems` / `getContainerItemsWithOccurrences` in `LayoutHelpers.js` both `if (!occ) return null` per id and `.filter(Boolean)` the result. Empty `containerOccurrence.occurrences[]` returns `[]` early.

21. ~~**Inconsistent pool field meta keys**~~ ✅ Fixed 2026-05-23: ADD_TO_POOL / REMOVE_FROM_POOL action UI in `blocks/OperationsBuilder.jsx` now writes `cfg.poolId` (was `cfg.poolContainerId` — never matched the executor's `cfg.poolId` reader). Executor + `operationIntrospection.js` accept the legacy `poolContainerId` as a fallback so older ops still resolve. Field-level `meta.poolContainerIds` is a different surface (select-field options source) and is already normalized via `state/migrateFieldOptionsSource.js`.

22. ~~**Unused "markdown" field type in schema**~~ — Actually IS used by Q&A question/answer fields. Not a bug.

23. ~~**Weekly time filter missing upper bound**~~ ✅ Fixed: `operationExecutor.js` weekly filter now checks `d >= weekStart && d < weekEnd`.

---

## ✅ Fixed

- **Object.assign spread corrupting occurrencesById** — `bindSocketToStore.js` line 614 used `Object.assign({}, ...Object.values(state.occurrencesById))` which spread occurrence objects' properties (id, fields, targetId...) into a flat merged object instead of preserving the `{[id]: occ}` map. Fixed: replaced with `{ ...state.occurrencesById, ...localOccsById }`.

- **FIND_MODULE checking non-existent `deleted` property** — `operationActions.js` FIND_MODULE was filtering `!m.deleted && !m.trashed`. Modules use `trashed`, not `deleted`. Removed redundant `!m.deleted` check.

- **FIND_OCCURRENCE checking non-existent `deleted` property** — `operationActions.js` FIND_OCCURRENCE was filtering `!o.deleted`. Occurrences have no `deleted` field. Removed the dead check.

- **Operations running continuously (12 toasts every 5 seconds)** — Two root causes: (1) backward-compat in `shouldTrigger` was firing `onChange`-only operations on null transactionType (initial load), not just `onLoad` ops; (2) TN5 "Operation ran, Updated N fields" toast was added on top of per-field transaction toasts. Fixed: added `&& types[0] !== "onChange"` guard to backward-compat block; removed TN5 toast entirely.

- **Instance collapse was hiding fields** — Chevrons were showing on the left and hiding fields/labels on collapse. Fields should always be visible. Collapse/expand only affects the body (textmap/DocEditorShell) below the instance row. Fixed: removed isExpanded field-hiding logic from Instance.jsx; `showDoc`/`toggleDoc` now controls only the body. A 3px `collapse-lip` strip sits between the instance row and the expandable body.

- **Instance body showed two visual areas** — Expanding the body under a list instance showed two distinct visual regions. Caused by `DocEditorShell` being called without `hideToolbar={true}`, which enabled sticky toolbar + overflow-auto creating a boxed look. Fixed: pass `hideToolbar={true}` to DocEditorShell in ModuleInstance.jsx.

- **Instance body wrong color (blue)** — All instance body areas showed as blue (`#4372ac`) regardless of container color. Caused by the generic `.dnd-instance` CSS rule (inline chip style) applying `background: #4372ac` to all `.dnd-instance` elements. Fixed: renamed root div class in `Instance.jsx` from `dnd-instance` → `instance-row`; updated CSS selector to `.instance-wrap > .instance-row`. Also raised card background opacity from 0.35 → 0.55.

- **Dark area at top of all instances** — Each instance card showed a dark gradient bleeding through the top half. Caused by an absolutely-positioned dark well div inside the list container (`background: rgba(20,25,30,0.4)`, `boxShadow: inset 0 2px 4px ...`) showing through the semi-transparent instance card backgrounds. Fixed: removed the dark well div from `Container.jsx` list branch. Also removed the redundant `zIndex: 1` from the role-list wrapper.

- **Doc containers empty in example data (aispecs, banglespecs, uses, PRAGMATIC)** — These containers showed up without content. Missing `viewId: container._viewId` on their occurrence records meant `isDocContainer` was false, so they rendered as empty lists. Fixed: added `viewId: container._viewId || null` to the flat notes section occurrence in `createDefaultUserData.js`.

- **AI Specs / Bangle Specs heading structure wrong** — `aispecs.md` uses H1 (`#`) for main sections and H3 (`###`) for sub-sections, but the parser was using `secLevel=2` (H2) which found wrong sub-sub-sections as containers. `banglespecs.md` uses H1 for PART sections and H2 for sub-steps. Fixed: added `secLevel`/`instLevel` per file in `_flatNotesDefs`; `aispecs.md` now parses with `secLevel:1, instLevel:3`; `banglespecs.md` with `secLevel:1, instLevel:2`.

- **Editor block handle menu blocks typing** — The block type picker (⋮ button on left of each block) showed Text/H1/H2/H3 options but required the user to pick one before typing. Fixed: block menu now closes immediately on Escape or any printable keypress, then refocuses the editor.

- **Command palette (/) doesn't close on Enter with no match** — Typing `/` then a query with no matching commands and pressing Enter was a no-op, leaving the palette open. Fixed: `CommandPalette.jsx` now calls `onClose()` when Enter is pressed and `flatCommands` is empty.

- **Doc container anchor chips opened as new doc instead of scrolling** — Clicking nested anchor chips in ManifestTree navigated to the wrong place. Fixed: anchor chips now pass `parentOccId={parentOccId}` (root doc occ) instead of `parentOccId={occ.id}` (container occ) to children.
