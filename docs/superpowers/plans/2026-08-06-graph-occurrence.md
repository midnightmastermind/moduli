# The Graph Occurrence — a chart you can drag data into, and click to fire an operation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: NOT STARTED.** Sequenced after `2026-08-06-artifact-spread-viewer.md`.

**User direction (2026-08-06):**
> "add a graph occurance in (works same way as table in what occurances it can be). i want the
> library to make it easy to edit within our system and clickable. so i can select diff parts of the
> graph. then we connect it to operations. the goal is to create a feeling wheel of emotions and
> when i select an emotion, it records the mood. so we need the graph library to use that kind of
> graph as well. like a multi level pie chart in a way. … the goal is to put this graph container on
> a daypage so i can select my mood that way. it should be able to do a whole lot of other graphs as
> well."

> "the graph component should let me either use a query like we have for other things (a feed) or
> let me drag occurances to it and let me use the info of it like fields to determine things. we
> should have a sidebar next to the graph with all the occurances involved in the graph, its a board
> of the draggable occurances. we can also do hardcoded values if needed"

**Goal:** a chart is an occurrence like any other. Its data is the occurrences it holds — pulled by
a feed, dragged in by hand, or written as literals — and its slices are clickable, so selecting one
fires an operation. The feeling wheel is the proving case: a multi-level pie where clicking
"Frustrated" records today's mood.

---

## PART 1 — RESEARCH: which charting library

### What the requirements actually demand

| Requirement | What it rules out |
| --- | --- |
| **Multi-level pie (sunburst)** for the feeling wheel | Recharts (no sunburst), Chart.js (no sunburst without a plugin), visx (primitives only — you'd build it) |
| **Click a segment and know WHICH node**, including its ancestors | Anything that reports only a flat datum index — a wheel needs `Angry › Frustrated › Annoyed` |
| **"A whole lot of other graphs"** from one component | A sunburst-only package; a per-chart-type dependency spread |
| **Editable within our system** — config is DATA the ops/pickers can read and write | Anything whose config is JSX children (Recharts, Nivo) rather than a serializable object |
| **Offline, self-hosted, no license fee** | Highcharts (commercial for non-personal), amCharts (licensed) |
| **Small enough to lazy-load into an existing bundle** | Plotly (~1MB minified; the app already carries pdf/tiptap/highlight chunks) |

### The candidates, measured against those

- **Apache ECharts (Apache 2.0)** — has `sunburst` as a first-class series type, plus ~20 others
  (bar/line/pie/scatter/radar/treemap/heatmap/sankey/graph/gauge/boxplot). **Its entire chart is one
  serializable `option` object**, which is the decisive property here: the app's whole design is
  config-as-data, so a chart's spec can live in `occurrence.meta.graph`, be edited by our own
  pickers, and be written by an operation — with no React tree to describe. Click events on a
  sunburst carry `treePathInfo` (the ancestor chain), which is exactly the feeling wheel's
  requirement. Tree-shakeable to roughly 100 kB gzipped when importing only the used series.
- **Nivo** — has a Sunburst and is genuinely React-native, but each chart is a distinct component
  with its own props. Config lives in JSX, so "the user edits the chart in our editor" would mean
  maintaining a prop-to-component mapping per chart type. Wrong shape for this codebase.
- **Plotly** — has sunburst and click events, but the bundle is the problem, and its config, while
  serializable, is a much larger surface to expose in an editor.
- **D3** — maximum power, and a sunburst is a well-trodden D3 recipe, but everything (arcs,
  transitions, hit-testing, legends, responsiveness) is ours to write and maintain. That is a
  charting library's worth of work to avoid a dependency.

### RECOMMENDATION: Apache ECharts, lazy-loaded, wrapped in ONE component

Not `echarts-for-react` — a thin in-house wrapper. The published React wrappers are small but they
own the lifecycle we need to control (dispose on unmount, `setOption` merge semantics, resize
observation), and this codebase has been bitten before by a wrapper that hides the thing being
debugged. The wrapper is well under a hundred lines.

**Verify before building (Task 1 is a spike, not a leap of faith):** that a sunburst click event
really does carry the full ancestor path, and what a tree-shaken import of `sunburst + pie + bar +
line` actually costs in the built bundle. Both are one measurement each, and the plan's shape
depends on the first.

Sources:
[Choosing a React Chart Library](https://chenguangliang.com/en/posts/blog152_react-chart-libraries-comparison/) ·
[8 Top React Chart Libraries (Querio)](https://querio.ai/articles/top-react-chart-libraries-data-visualization) ·
[Top 5 Chart Libraries (Strapi)](https://strapi.io/blog/chart-libraries)

---

## PART 2 — ARCHITECTURE

### A graph is a CONTAINER KIND, exactly like a table

`kind: "graph"`, alongside `board / doc / canvas / table`. That is the user's own framing ("works
same way as table in what occurances it can be"), and it is already how this codebase adds a
surface: `ModuleContainer` dispatches on `kind`, and `ContainerTable` is the precedent for a
layout-only container whose configuration lives in `occurrence.meta`. So a graph can be a container
inside a page, a page in its own right, an embed in a doc, or a cell — wherever a table can go, with
no new placement rules.

### THE KEY IDEA: a graph's data rows are its CHILD OCCURRENCES

This is what makes all three data sources one mechanism instead of three.

```
Graph occurrence  (kind:"graph")
  ├─ meta.graph  = { type, encoding, options, literals }   ← the SPEC
  └─ occurrences[]                                          ← the DATA
       ├─ Emotion: Angry      (fields: { intensity: 8 })
       ├─ Emotion: Sad        (fields: { intensity: 3 })
       └─ …
```

- **Feed / query** — `occurrence.feed` ALREADY EXISTS and already does exactly this: a declarative
  FIND whose matches are materialized as copy-linked children, self-healing, date-cascade aware
  (2026-07-07). A graph with a feed is a graph whose rows are maintained for it. **Nothing new is
  built for the query case** — it is `<FeedSection>` on a graph's header menu.
- **Drag** — dropping an occurrence onto a graph adds a child. That is what dropping onto any
  container already does. Nothing new.
- **Hardcoded** — `meta.graph.literals: [{ name, value }]`, concatenated after the occurrence-derived
  rows. The only genuinely new path, and it is a list of pairs.

**`encoding` is how a row becomes a datum**, and it is field ids, not magic:

```js
encoding: {
  category: null | fieldId,   // null = the occurrence's LABEL (the common case)
  value:    fieldId,          // the number the slice is sized by
  series:   fieldId | null,   // optional split into multiple series
  children: "occurrences",    // sunburst/treemap: nest by the occurrence tree
}
```

Picked with the existing `DrilldownPicker`, so the graph editor is field-picking — a control this
app already has — rather than a bespoke query builder.

### The sidebar IS a board, not a new component

> *"we should have a sidebar next to the graph with all the occurances involved in the graph, its a
> board of the draggable occurances"*

The graph surface is two panes: the chart, and beside it **the graph occurrence's own children
rendered by the existing container renderer**. That board is where you drag occurrences in and out,
reorder them, and edit their fields — every one of which the board already does. The same discipline
the artifact spread landed on: the new component owns the chart and the layout, and delegates
everything that already exists.

### Clicking a slice fires an OPERATION

Each datum carries the occurrence id it came from. A click resolves to
`{ occurrenceId, path: [ancestor ids], value, seriesName }` and fires a new trigger type
**`onGraphSelect`**, joining the four existing ones. An operation matching that trigger receives
`$trigger.occurrenceId` / `$trigger.path` / `$trigger.value` and does whatever it likes.

**The feeling wheel then needs NO graph-specific code at all:**

```
Feeling Wheel graph  (sunburst, feed over the Emotions board, nested by occurrences)
        ↓ user clicks "Frustrated"
onGraphSelect  →  $trigger.occurrenceId = <Frustrated emotion occurrence>
        ↓
Op "Mood: Record Selection"
   FIND today's day column
   UPDATE its Mood field ← $trigger.occurrenceId
```

The emotion hierarchy is just occurrences nested in containers — which is what the Emotions board
already is. A wheel is a rendering of a tree the grid already holds.

## Tech Stack

React 18, Vitest + @testing-library/react, Express + Socket.io, Mongoose.
New dependency: `echarts` (client, lazy-loaded).
Client tests `npm --prefix ./client run test`; server `npm --prefix ./server run test`.

## Global Constraints

- **`poms grid` is protected live data.** Structure changes go through `server/migrations/` +
  `npm run migrate:poms`. Never the seed. Rehearse on `test grid 2`; never `test grid 1`.
- **No domain knowledge in the renderer.** The graph component must not know what an "emotion" or a
  "mood" is — the same rule that got schedule logic removed from `ModuleContainer` (2026-06-03) and
  enforced by `__tests__/noDomainKnowledge.test.js`. The feeling wheel is DATA plus one operation.
- **No hardcoding.** Chart config is data the system can introspect; identity is field ids and
  occurrence ids, never labels (the 2026-07-16 picker-direct migration).
- **`echarts` must be lazy** — a chart is not on the first-paint path. Follow the
  `highlight.js` / `tesseract.js` precedent (dynamic import, chunk verified in the build).
- **The DOM is ground truth** for anything about geometry or hit-testing. A jsdom test proves the
  contract; a browser harness proves the chart.

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/helpers/graphData.js` (new) | PURE. `buildGraphData(occ, ctx)` → `{ nodes, links }` from children + literals + encoding. The whole data model, testable with no React and no ECharts. |
| `client/src/helpers/graphOption.js` (new) | PURE. `buildEChartsOption(graphSpec, data)` → the ECharts `option` object. Isolating this is what makes chart-type support testable without rendering. |
| `client/src/modules/containers/ContainerGraph.jsx` (new) | The surface: chart pane + source board pane, drop target, selection → trigger. Mirrors `ContainerTable`. |
| `client/src/ui/EChart.jsx` (new) | The thin wrapper: lazy `echarts`, `init`/`setOption`/`dispose`, ResizeObserver, `on("click")`. Nothing chart-specific. |
| `client/src/ui/GraphSection.jsx` (new) | Header-menu editor: chart type, encoding pickers, literals. Mounts beside `<FeedSection>`. |
| `client/src/modules/ModuleContainer.jsx` | `kind === "graph"` branch. |
| `client/src/helpers/triggerTypes.js` | Register `onGraphSelect`. |
| `client/src/ui/ContainerKindSelector.jsx`, `ui/QuickAddMenu.jsx` | Graph as a creatable kind. |
| `server/models/Module.js` | `"graph"` in the kind enum. |
| `server/scripts/createLiveData.js` | Seeds the Emotions board + the Feeling Wheel + the record-mood op. |
| `server/migrations/00NN-feeling-wheel.mjs` (new) | Carries the same to `poms grid`. |

---

### Task 1: SPIKE — prove the two things the design rests on

**Nothing else starts until this reports.** Both answers change the plan if they come back wrong.

- [ ] **Step 1:** Temporary harness (`client/_echarts.{html,jsx}`, deleted after). Render a
      three-level sunburst, click a leaf in a real browser, and **print the click payload**.
      **Assert the ancestor chain is present** — if a click cannot tell you which branch a leaf
      belongs to, the feeling wheel needs a different library and this plan changes.
- [ ] **Step 2:** Add `echarts`, import ONLY `SunburstChart + PieChart + BarChart + LineChart` plus
      the core, build, and **record the real chunk size**. Compare against the documented chunk
      sanity check (tiptap 435 / highlight 969 / CommandCenter 204 / PagePreviewApp 929).
- [ ] **Step 3:** Confirm a lazy dynamic import lands `echarts` in its OWN chunk, not the App chunk.

**Verification:** the click payload and the chunk sizes pasted into this task's notes. A number, not
an impression.

---

### Task 2: `graphData.js` — the data model, pure

**Files:** create `client/src/helpers/graphData.js`; test `client/src/__tests__/graphData.test.js`.

`buildGraphData(graphOcc, { occurrencesById, modulesById, fieldsById })` → `{ nodes, warnings }`
where each node is `{ id, occurrenceId | null, name, value, children[], depth }`.

- [ ] **Step 1: Failing tests.** Cover: category from the LABEL when `encoding.category` is null;
      category from a field when set; value read off `fields[fid].value` with the `{value,flow}`
      unwrap (arrays pass through — the 2026-07-12 rule); a child with NO value contributes 0 and
      raises a warning rather than `NaN`; literals append after occurrence rows; **nesting by the
      occurrence tree produces the sunburst's levels**; a feed copy and a hand-dragged child are
      indistinguishable in the output (that equivalence is the whole architecture).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** `npm --prefix ./client run test -- src/__tests__/graphData.test.js`.

---

### Task 3: `graphOption.js` — spec + data → an ECharts option

**Files:** create `client/src/helpers/graphOption.js`; test `client/src/__tests__/graphOption.test.js`.

- [ ] **Step 1: Failing tests** for `sunburst`, `pie`, `bar`, `line`: the returned option's series
      type is right, the data is attached, and **every datum carries its `occurrenceId`** so a click
      can resolve back to an occurrence. Unknown chart type → a safe fallback plus a warning, never
      a throw (a bad stored spec must not blank the page).
- [ ] **Step 2: Implement.** Theme colors come from the app's CSS custom properties, read once —
      charts must follow the app's theme rather than shipping their own palette.
- [ ] **Step 3: Verify.**

---

### Task 4: `EChart.jsx` — the wrapper

- [ ] **Step 1:** Lazy `import("echarts/core")` + only the used series/components. Init on a ref,
      `setOption(option, { notMerge: true })` on change, `dispose()` on unmount (a leaked ECharts
      instance keeps a canvas and a resize listener alive — this is the one real footgun).
- [ ] **Step 2:** ResizeObserver → `chart.resize()`. The app resizes panels constantly.
- [ ] **Step 3:** `onSelect(payload)` from the click handler, normalized to
      `{ occurrenceId, path, value, seriesName }` — the component's whole outward contract.
- [ ] **Step 4:** Test with `echarts` MOCKED: assert init/setOption/dispose are called at the right
      times and the click normalizes correctly. **A jsdom canvas proves nothing about a chart** —
      the picture is the browser harness's job in Task 5.

---

### Task 5: `ContainerGraph.jsx` — chart + source board

- [ ] **Step 1:** Two panes — `<EChart>` and, beside it, the graph's own children rendered by the
      EXISTING container renderer as the source board. **Do not build a list.** Collapsible; stacks
      vertically under a narrow panel and on mobile.
- [ ] **Step 2:** The whole surface is a drop target that adds a child, using the same drop path
      every container uses. Dropping an occurrence in adds a datum, by construction.
- [ ] **Step 3:** `kind === "graph"` branch in `ModuleContainer`; graph added to
      `ContainerKindSelector` + `QuickAddMenu`; `"graph"` added to the server Module kind enum.
- [ ] **Step 4:** Tests against fixtures: renders one datum per child, a dropped occurrence appears
      in both panes, an empty graph shows an empty state rather than a broken chart.
- [ ] **Step 5:** Browser harness at 1600 / 900 / 390 wide — chart and board both readable, nothing
      overflows horizontally. Screenshot into the task notes.

---

### Task 6: Selection fires an operation

- [ ] **Step 1:** Register `onGraphSelect` in `helpers/triggerTypes.js` and surface it in the
      operations editor's trigger picker.
- [ ] **Step 2:** `ContainerGraph` fires it through the normal path (`runMatchingOperations`) with
      `{ occurrenceId, path, value, seriesName, containerId }` on `$trigger`.
- [ ] **Step 3: A/B the test against unfixed code.** A behavioral test in `liveOpsBehavioral`:
      selecting a slice fires an op that writes a field, asserted by DIFFING state. **It must fail
      before this task's code exists** — a test that passes beforehand is not a test (2026-08-04).

---

### Task 7: The feeling wheel, as DATA

- [ ] **Step 1:** Seed an **Emotions board** — the standard wheel's 6-to-8 primaries, each holding
      its secondaries, each holding tertiaries. Occurrences nested in containers; that nesting IS
      the wheel's levels.
- [ ] **Step 2:** Seed a **Feeling Wheel** graph occurrence: `type:"sunburst"`, a feed over the
      Emotions board, `encoding.children:"occurrences"`. Place it on the day-page template.
- [ ] **Step 3:** Seed **`Mood: Record Selection`** — `onGraphSelect`, scoped to that graph, writing
      `$trigger.occurrenceId` to the day column's Mood field. Verify the existing Moods tracker
      picks the value up; if it reads a different shape, reconcile HERE rather than teaching the
      graph about moods.
- [ ] **Step 4:** Migration `00NN` carries all of it to `poms grid`. Idempotent, find-then-patch.
      **Dry run and report what it matched against a NAMED expectation before applying** — count
      alone is what let `0035` move a real page.
- [ ] **Step 5:** `checkGrid --all` clean; sweep any probe debris (the standing rule: a probe that
      loads the live grid writes to it).

---

### Task 8: `GraphSection.jsx` — editing the chart in-app

- [ ] **Step 1:** Header-menu section beside `<FeedSection>`: chart type, encoding pickers
      (`DrilldownPicker` for the field ids), literal rows, legend/label toggles.
- [ ] **Step 2:** Writes `meta.graph` through `updateOccurrence` like every other header editor.
- [ ] **Step 3:** Tests: changing the type re-renders as the new type; changing the value field
      changes the numbers.

---

### Task 9: Docs + ship

- [ ] Update `client/src/modules/CLAUDE.md`, `client/src/ui/CLAUDE.md`, `client/src/helpers/CLAUDE.md`,
      `server/CLAUDE.md`; root `CLAUDE.md` session entry.
- [ ] Full suite + build with the chunk sanity check; deploy; verify prod HEAD over SSH.

---

## Risks

- **Bundle size.** Task 1 Step 2 exists to find out before anything is built on it. If a
  tree-shaken ECharts is too heavy, the fallback is a hand-written sunburst (arcs are not hard) plus
  ECharts only for the long tail — but do not assume that until measured.
- **A chart is an easy place to smuggle domain knowledge in.** "Feeling wheel" must never appear in
  the renderer. `noDomainKnowledge.test.js` should gain a case for the graph surface.
- **Sunburst readability on a phone.** A three-level wheel at 390px may be untappable. Measure in
  Task 5 before promising the day-page use case on mobile; the fallback is a drill-down (tap a
  primary → its secondaries fill the wheel), which ECharts supports natively but which changes what
  a click MEANS — decide it there, not in passing.
- **Feed + graph both maintain children.** A feed sweeps children it did not mint. Hand-dragging an
  occurrence into a fed graph may therefore be undone on the next sync. **Decide in Task 5:** either
  the source board refuses hand-drops on a fed graph, or the feed learns to leave non-copies alone.
  Do not leave it unspecified — it is the kind of gap that turns into "my drag disappeared".
- **`echarts` is a new runtime dependency**, the first charting library in the app. Keep it behind
  `EChart.jsx` so swapping it later touches one file.
