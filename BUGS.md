# Bugs

1. code blocks arent rendering
2. the components section isnt ordering right. 
3. the grids settings tab should be the farthest left tab. 
4. tables are deleting row when you click on the row number (shouldnt happen)
5. collapsing the stuff in the tree should collapse the stuff underneath. right now it expands everything when reopened. 
6. the question and answers are broken in the day page. it shows two fields in the body when it should just show the answer field. the header is correct but it should a field for question in the header, not just a header. so for example. what went well? should be a question field inside a container header.
7. the highlight for drag on containers blinks like crazy.
8. the canvas we have (freepad), looks like it has the functionality of a listpanel. we need it to be recognized as a canvas.
9. the moduli header is being cut off by the grid select.
10. right now i cant click in the middle of a sentence and type in a doc and i should be able to. 
11. the daily answer fields are broken (just says object object)
12. we need a new doc button in the tree.
13. i just tried to drag an image file off my desktop to into my grid and nothing happened when i dropped. 
14. we should be able to cycle to empty grid cell in the panel cycler. 
15. we should add in and option that pomodoros create a instancemodule and puts it in whatever container we select (with the option to base it on a time field (i put in the time field thats connected to the container))
16. that reminds me, in the example data, i dont see any fields. we need the date field and the time field. and those should work with the filters.
---

## 🔴 Open

1. **React child error** — Lucide forwardRef icon components intermittently throw when passed as JSX children (e.g. inside RadialMenu items). Intermittent, hard to repro consistently.

2. **Playwright E2E tests timeout** — Chromium tests fail because grid data doesn't load in 15s, or dev server isn't running. Always start `npm run dev` + resetData before running `npx playwright test`. Known limitation, not a code bug.

3. **ManifestTree ordering wrong in example data** — Items in the sidebar tree appear in the wrong order. The sortOrder values assigned in `createDefaultUserData.js` for the notes folder and its children (parent docs, flat notes sections, etc.) are not producing the intended visual order in the tree.

4. **"Grid" view type should be inline TipTap tables** — The "Sample Grid" currently renders as a separate panel-level view (`viewType: "grid"`, `GridViewer` component in `Artifact.jsx`). It should not be a separate thing. Tables belong inline in doc text blocks as regular TipTap table nodes (the Table extension is already installed). The grid viewType + GridViewer should be removed; the Sample Grid example data should be a TipTap table embedded in a doc container instead.

---

## ✅ Fixed

- **Instance collapse was hiding fields** — Chevrons were showing on the left and hiding fields/labels on collapse. Fields should always be visible. Collapse/expand only affects the body (textmap/DocEditorShell) below the instance row. Fixed: removed isExpanded field-hiding logic from Instance.jsx; `showDoc`/`toggleDoc` now controls only the body. A 3px `collapse-lip` strip sits between the instance row and the expandable body.

- **Instance body showed two visual areas** — Expanding the body under a list instance showed two distinct visual regions. Caused by `DocEditorShell` being called without `hideToolbar={true}`, which enabled sticky toolbar + overflow-auto creating a boxed look. Fixed: pass `hideToolbar={true}` to DocEditorShell in ModuleInstance.jsx.

- **Instance body wrong color (blue)** — All instance body areas showed as blue (`#4372ac`) regardless of container color. Caused by the generic `.dnd-instance` CSS rule (inline chip style) applying `background: #4372ac` to all `.dnd-instance` elements. Fixed: renamed root div class in `Instance.jsx` from `dnd-instance` → `instance-row`; updated CSS selector to `.instance-wrap > .instance-row`. Also raised card background opacity from 0.35 → 0.55.

- **Dark area at top of all instances** — Each instance card showed a dark gradient bleeding through the top half. Caused by an absolutely-positioned dark well div inside the list container (`background: rgba(20,25,30,0.4)`, `boxShadow: inset 0 2px 4px ...`) showing through the semi-transparent instance card backgrounds. Fixed: removed the dark well div from `Container.jsx` list branch. Also removed the redundant `zIndex: 1` from the role-list wrapper.

- **Doc containers empty in example data (aispecs, banglespecs, uses, PRAGMATIC)** — These containers showed up without content. Missing `viewId: container._viewId` on their occurrence records meant `isDocContainer` was false, so they rendered as empty lists. Fixed: added `viewId: container._viewId || null` to the flat notes section occurrence in `createDefaultUserData.js`.

- **AI Specs / Bangle Specs heading structure wrong** — `aispecs.md` uses H1 (`#`) for main sections and H3 (`###`) for sub-sections, but the parser was using `secLevel=2` (H2) which found wrong sub-sub-sections as containers. `banglespecs.md` uses H1 for PART sections and H2 for sub-steps. Fixed: added `secLevel`/`instLevel` per file in `_flatNotesDefs`; `aispecs.md` now parses with `secLevel:1, instLevel:3`; `banglespecs.md` with `secLevel:1, instLevel:2`.

- **Editor block handle menu blocks typing** — The block type picker (⋮ button on left of each block) showed Text/H1/H2/H3 options but required the user to pick one before typing. Fixed: block menu now closes immediately on Escape or any printable keypress, then refocuses the editor.

- **Command palette (/) doesn't close on Enter with no match** — Typing `/` then a query with no matching commands and pressing Enter was a no-op, leaving the palette open. Fixed: `CommandPalette.jsx` now calls `onClose()` when Enter is pressed and `flatCommands` is empty.

- **Doc container anchor chips opened as new doc instead of scrolling** — Clicking nested anchor chips in ManifestTree navigated to the wrong place. Fixed: anchor chips now pass `parentOccId={parentOccId}` (root doc occ) instead of `parentOccId={occ.id}` (container occ) to children.
