# The Graph Occurrence — a chart you can drag data into, and click to fire an operation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **STATUS: Tasks 1-6 DONE (2026-08-06). Tasks 7-9 remain.** The spike held, the data model,
> option builder, wrapper, surface and trigger are built and tested. **Never rendered in a real
> browser** — jsdom cannot prove a chart draws, so the picture is still unverified. Nothing
> deployed.

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
  children: "occurrences",    // nest by the occurrence TREE
  parent:   fieldId | null,   // …or nest by a PARENT REFERENCE FIELD
  level:    fieldId | null,   // optional: which ring a row declares itself on
}
```

**TWO WAYS TO GET A HIERARCHY — and the field-driven one is what boards want** (user, 2026-08-06:
*"we can use fields to drive it. like what level is what … its a 3 layered wheel of feelings"*).

`children: "occurrences"` nests by the occurrence tree — natural when the rows are already
containers holding containers. **`parent: <fieldId>`** instead builds the tree from a field on each
row pointing at its parent occurrence, which is what lets the hierarchy live on a **FLAT BOARD**:
every feeling a sibling occurrence tagged by fields, exactly like the other 34 boards on this grid,
with the wheel's 3 layers editable in the app rather than dragged into a nesting.

`level` is REPORTED, not used: `depth` comes from the tree and is what the chart renders, so a
level field is for validation and editors — a disagreement between the two is a data problem worth
being able to see. Shipped and tested (10 cases), including a row whose parent is off-graph
(becomes a root, so a graph can show one branch of a bigger board) and a cycle typed in by hand
(draws nothing but SAYS so, rather than being silently empty).

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

### Task 1: SPIKE — prove the two things the design rests on ✅ DONE 2026-08-06

**Both assumptions HELD. The plan proceeds unchanged.** Measured in real Chromium against
`echarts@6.1.0`, not read from docs.

- [x] **Step 1: does a sunburst click carry the ancestor path?** YES. Clicking the "Content" leaf of
      a three-level wheel returned:
      ```
      name         : "Content"
      treePathInfo : [{name:""}, {name:"Happy"}, {name:"Content"}]   ← root + ancestors + self
      occurrenceId : "occ-content"     ← OUR OWN payload, carried on p.data
      value        : 1 · componentType: "series"
      ```
      **Two things this settles.** The ancestor chain is there, so a feeling-wheel click knows
      `Happy › Content`. And an arbitrary key we attach to a datum survives onto the click event —
      so a click resolves back to an occurrence id DIRECTLY, with no index-to-occurrence lookup
      table to keep in sync. Task 3's "every datum carries its occurrenceId" is therefore trivial.

- [x] **Step 2: what does it actually cost?** (esbuild, bundled + minified + gzipped)
      ```
      sunburst ONLY                      158 kB gzip
      sunburst + pie + bar + line        197 kB gzip     (+39 kB for three more chart types)
      full echarts dist                  360 kB gzip
      ```
      **The research's "~100 kB" was optimistic — the real floor is 158 kB.** But the shape of the
      number is what matters: **the CORE is the price of admission and extra chart types are
      nearly free.** Paying 158 kB to get one chart and then +13 kB each for the rest is a good
      trade for "it should do a whole lot of other graphs". In family with this app's existing
      lazy chunks (tiptap 137 · pdf 122 · CommandCenter 50 · highlight 312), and it is LAZY — a
      grid with no graph on screen never downloads it.

- [ ] **Step 3:** Confirm the lazy dynamic import lands `echarts` in its OWN chunk, not the App
      chunk. **Deferred to Task 4**, where the real `EChart.jsx` import exists to measure; the
      standalone probe cannot prove Vite's chunking for a module nothing imports yet.

**PROBE LESSON, recorded because it is this file's own rule.** The first run reported **0 clicks
and no page errors** — which looks like "sunburst clicks don't work". It was the probe: I loaded
`echarts.common.js`, which does not ship the sunburst series at all. The fix was to make the probe
prove the chart had RENDERED (count painted canvas pixels: 346,876) before believing any zero.
*A probe that reports zero is a claim about the probe until you have seen it report non-zero.*

---

### Task 2: `graphData.js` — the data model, pure ✅ DONE (17 tests)

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

### Task 3: `graphOption.js` — spec + data → an ECharts option ✅ DONE (15 tests)

**Files:** create `client/src/helpers/graphOption.js`; test `client/src/__tests__/graphOption.test.js`.

- [ ] **Step 1: Failing tests** for `sunburst`, `pie`, `bar`, `line`: the returned option's series
      type is right, the data is attached, and **every datum carries its `occurrenceId`** so a click
      can resolve back to an occurrence. Unknown chart type → a safe fallback plus a warning, never
      a throw (a bad stored spec must not blank the page).
- [ ] **Step 2: Implement.** Theme colors come from the app's CSS custom properties, read once —
      charts must follow the app's theme rather than shipping their own palette.
- [ ] **Step 3: Verify.**

---

### Task 4: `EChart.jsx` — the wrapper ✅ DONE (10 tests)

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

### Task 5: `ContainerGraph.jsx` — chart + source board ✅ MOSTLY DONE (9 tests)

- [ ] **Step 1:** Two panes — `<EChart>` and, beside it, the graph's own children rendered by the
      EXISTING container renderer as the source board. **Do not build a list.** Collapsible; stacks
      vertically under a narrow panel and on mobile.
- [ ] **Step 2:** The whole surface is a drop target that adds a child, using the same drop path
      every container uses. Dropping an occurrence in adds a datum, by construction.
- [ ] **Step 3:** `kind === "graph"` branch in `ModuleContainer`; graph added to
      `ContainerKindSelector` + `QuickAddMenu`; `"graph"` added to the server Module kind enum.
- [ ] **Step 4:** Tests against fixtures: renders one datum per child, a dropped occurrence appears
      in both panes, an empty graph shows an empty state rather than a broken chart.
- [x] **Step 5: BROWSER HARNESS — DONE 2026-08-06, and it caught a fatal defect.**

      Measured with a real 3-level feeling wheel (6 primaries → 14 secondaries → 26 tertiaries):
      ```
      width  chart   board   stacked  paintedPx  docOverflowX  ringWidth  errors
      1600   1289    287     no       170,083    0             77px       0
       900    604    272     no       170,064    0             77px       0
       390    374    374     YES      85,658     0             55px       0
      ```
      Chart and board both readable at every width, the 390 media query stacks the board under the
      chart, and **nothing overflows horizontally anywhere**. Screenshot confirms a correct,
      fully-labelled wheel.

      **THE MOBILE RISK IS RESOLVED — no drill-down needed.** Rings are **55px** at 390, above the
      40px thumb target this repo already uses for hit areas. (Tangential arc at the outer ring is
      ~40px with 26 leaves; a much denser wheel would shrink that, so re-measure if the emotion set
      grows a lot.)

      **THE DEFECT, and no unit test could ever have found it.** ECharts' sunburst defaults to
      `nodeClick: "rootToNode"` — a click RE-ROOTS the chart to the clicked node. Measured: one
      click on "Astonished" replaced the entire wheel with that single node and a grey back-button.
      For a feeling wheel that is fatal: picking an emotion would zoom the wheel away instead of
      recording a mood. It is the library's internal default, invisible to jsdom and to every
      assertion about our own option object. **It took a screenshot.**

      Fixed with `nodeClick: false`, then re-measured to prove BOTH halves:
      the wheel stays intact after a click (180,919 → 180,900 painted px — the −19 is the hover
      highlight), and **our own `onSelect` still fires** with the full payload
      `{occurrenceId:"occ-free", path:["Happy","Content","Free"]}`. Disabling nodeClick removes only
      ECharts' NAVIGATION; the click event is a separate channel that stays ours. A pick now lights
      its whole ancestor branch (`emphasis: focus "ancestor"`), which is the right feel for
      choosing an emotion. Two regression tests pin both settings.

- [x] **Step 5b: re-measured against the REAL 128-node wheel (2026-08-06).** It found a second
      defect no metric could see, and one open product decision.

      ```
      width  roots  warnings  painted   ring   outer-arc   labels
      1400     8       0      540,668   138px    33px      all 128 readable
       900     8       0      327,500   107px    25px      all 128 readable
       390     8       0      102,152    60px    14px      outer ring COLLIDES
      ```

      **THE DEFECT: the entire outer ring rendered with NO TEXT.** `label.minAngle` hides a label
      whose slice is narrower than N degrees, and it was set to 8 — but 80 tertiary leaves are 4.5°
      each, so all 80 were blanked. A wheel you cannot read is a wheel you cannot pick from, and
      every number still said fine (8 roots, 0 warnings, 540k painted px). Caught by a screenshot,
      like the `nodeClick` bug before it. Fixed with `minAngle: 1` + `overflow: "truncate"`; 1
      rather than 0 so a genuinely degenerate sliver may still drop its label instead of scribbling
      over its neighbours.

      **THE MOBILE DECISION — SETTLED BY THE USER (2026-08-06), and it is (c):**
      > *"the graph should be the size of the container (so the size of the page), and have it be
      > zoomable"*

      So there is ONE wheel everywhere — no reduced 2-ring variant, no drill-down. The surface
      fills its container and zoom does the rest, which keeps a click meaning exactly one thing at
      every width (the property `nodeClick: false` exists to protect). Built in Step 5c.

- [x] **Step 5c: zoom + pan, and the third defect a browser caught.**

      **`helpers/graphView.js` (NEW, pure, 17 tests)** owns the whole model as
      `{ zoom, cx, cy }` where cx/cy are the series centre in PERCENT. That coordinate choice is
      what keeps zoom out of the layout: ECharts already resolves a radial series' percent
      `radius`/`center` against the host box, so scaling the radius and moving the centre zooms and
      pans WITHOUT any file in this feature knowing the container's size. `zoomAt` holds the point
      under the pointer fixed (`c' = p - (p - c)·z'/z`); the pan clamp is derived from the radius,
      so at zoom 1 the range collapses to exactly [50,50] and an unzoomed chart cannot be dragged
      off centre — "panning requires zoom" falls out of the geometry instead of a flag.

      `EChart.jsx` reads the gestures (wheel about the pointer, drag-pan, two-finger pinch,
      double-click reset) and computes none of the arithmetic. `ContainerGraph` holds the view as
      LOCAL state — deliberately not persisted, so a graph always opens showing the whole thing
      rather than wherever the last person left it — and shows a reset pill only while zoomed.
      `.container-graph` carries `min-height: min(70vh, 620px)` because `flex: 1` fills only when
      the parent is a definite-height flex column (a page is; a plain board container is not).

      **THE DEFECT, and it is the third on this surface that only a real browser could show:**
      taking `setPointerCapture` on POINTERDOWN retargets the compatibility mouse events the
      pointer generates — so the following mouseup and click went to the host `div` instead of the
      CANVAS underneath, and **ECharts never saw the click. A stationary click on the wheel
      selected NOTHING, at every width, while all 99 unit tests passed** (jsdom's
      `setPointerCapture` is a stub, so it cannot reproduce this). Fixed by deferring the capture
      until a drag actually exceeds the slop — a click stays a click, and a drag still gets the
      thing capture is for. A/B in the browser: selections `0 → 0` before, `0 → 1` after.

      Measured in a real browser against the REAL 128-node wheel, three widths:
      ```
      width  outer arc @rest  @1.78×   anchor holds  click picks   drag picks   dbl-click resets
      1400        32.5px      57.8px       YES       Stressed          no             YES
       900        25.3px      45.0px       YES       Stressed          no             YES
       390        14.1px      25.1px       YES       Stressed          no             YES
      ```
      Anchor colour identical to the byte before and after zooming at all three widths (sampled
      with the pointer parked off the wheel, so hover emphasis cannot fake it). A click reports the
      full ancestor path (`Anticipation > Stressed`) and the occurrence id. **A 390px phone needs
      2.8× zoom to make a tertiary a 40px thumb target — well inside MAX_ZOOM 12**, which is what
      makes (c) sufficient on its own. 0 page errors at every width.
- [x] **Step 6: THE FEED-VS-DRAG COLLISION DOES NOT EXIST. Retracted — it was never measured.**

      The user said it directly: *"i thought you could have feed items and other occurances."* They
      are right, and the risk this plan carried in two places was fiction written from a suspicion
      about `feedSync` rather than a reading of it.

      `feedSync.js:69` only ever COLLECTS children that carry `meta.feedSourceId`
      (`if (!o?.meta?.feedSourceId || o.parentId !== feedOcc.id) continue;`), so a hand-placed
      child never enters the candidate set the sweep works from — it cannot be swept. The file's
      own header has said so since it was written (*"the ONLY marker the sweep trusts (hand-placed
      children are never touched)"*), and `feedSync.test.js` has pinned it since 2026-07-07:
      *"sweeps copies whose source stopped matching — but never hand-placed children"*, asserting
      `deletes === ["copyGone"]` with the hand-placed sibling left alone. Re-run to confirm rather
      than trusting the comment: **16/16 green.**

      So feed and drag COMPOSE, which is what the architecture claimed all along — a graph's rows
      are its children, and it does not care where a child came from. No decision was needed and no
      code changes.

      **The lesson is one this repo keeps paying for: a risk written from reading a design is a
      HYPOTHESIS, and carrying it as an open question costs real time.** It sat in this plan through
      two sessions and was raised to the user twice as a decision they had to make. One grep and
      one test run ended it.

---

### Task 6: Selection fires an operation ✅ DONE (5 tests)

- [ ] **Step 1:** Register `onGraphSelect` in `helpers/triggerTypes.js` and surface it in the
      operations editor's trigger picker.
- [ ] **Step 2:** `ContainerGraph` fires it through the normal path (`runMatchingOperations`) with
      `{ occurrenceId, path, value, seriesName, containerId }` on `$trigger`.
- [ ] **Step 3: A/B the test against unfixed code.** A behavioral test in `liveOpsBehavioral`:
      selecting a slice fires an op that writes a field, asserted by DIFFING state. **It must fail
      before this task's code exists** — a test that passes beforehand is not a test (2026-08-04).

---

### Task 7: The feeling wheel, as DATA

- [ ] **Step 1 (user, 2026-08-06): the wheel pulls from a BOARD IN THE LIBRARY.**
      > *"the feelings circle should pull from a board in library of feelings. look up the super
      > detailed feelings wheel to see it"*

      So the emotions live in the **Library** folder as a board of their own, like every other
      option board on this grid — NOT as children invented for the graph. The Feeling Wheel graph
      then FEEDS from that board, which is the query path already built. Two consequences worth
      stating: the emotion set is editable in the app like any other board, and the same emotions
      are reusable by anything else (a Mood dropdown, a tracker) because they are ordinary
      occurrences.

      **RESEARCH DONE (2026-08-06) — `server/seed/feelingWheel.js`.** The full Willcox Feeling
      Wheel (1982): **6 core → 36 secondary → 36 tertiary = 72 feelings**, matching the source's
      own description. DERIVED from the published PDF rather than typed from memory, by two
      independent readings: core→secondary from the text's reading order (6 clean groups of 6),
      secondary→tertiary from the LABEL GEOMETRY (radius + angle around the diagram centroid, with
      ring boundaries MEASURED from the radius gaps — 40.3 after the 6th label, 34.2 after the
      42nd — giving exactly 6/36/36 with every secondary holding one tertiary and zero anomalies).
      Cross-checked against the PDF's own worked example ("guilty" → core "sad", outer
      "remorseful"), which the derivation reproduced independently. 10 tests pin it.

      **THE MOOD FIELD ALREADY EXISTS, and this is the decision Task 7 turns on.** Measured on
      poms grid:
      ```
      Mood   type=select  multiSelect=TRUE  optionsSource=manual  47 flat options
             bound by 16 modules (Express, Check In, Vent, 13× Journal)
             occurrences carrying a value: ZERO
      ```
      Its 47 options are a FLAT list (Joyful, Happy, Content, … Focused) — no hierarchy, so a wheel
      cannot be built from it, and its values are plain strings, so a graph click (which carries an
      occurrence id) cannot be written into it as-is.

      **That zero is what makes the choice cheap: converting the field loses no data.** Two ways:
      - **(a) Convert `Mood` to an OCCURRENCE dropdown over the Feelings board.** Consistent with
        how this grid already works — 34 other boards are the source of truth for their dropdowns
        via `boardCategory`, and it is the only option where the wheel's click, the field's value
        and the graph's highlight are all THE SAME occurrence ids, so the op writes one from the
        other with no translation. Cost: 16 modules' binding meaning changes (string → id), and
        the Moods tracker must be re-checked.
      - **(b) Keep the manual select and have the op write the feeling's LABEL.** No change to
        existing bindings, but the ids never round-trip, so the highlight cannot be derived from
        the field and the two must be kept in sync separately — the "two truths" this plan has
        avoided everywhere else.
      **DECIDED 2026-08-06: (a).** The user picked it. So `Mood` becomes an occurrence dropdown
      over the Feelings board, and the wheel's click, the field's value and the graph's highlight
      are all the same occurrence ids — one truth, no translation.

- [x] **Step 1c: DECIDED — (a).**
- [ ] **Step 1d: carry out (a) as a migration.** Repoint `Mood` (`EeAlDE38uQE-`) from
      `optionsSource: manual` (47 flat strings) to an occurrence find over the Feelings board.
      Safe because ZERO occurrences carry a value — assert that again in the dry run rather than
      trusting this note. Re-check the Moods tracker + the 16 bound modules (Express, Check In,
      Vent, 13× Journal) still read sensibly, and keep the 47 old strings recorded in the
      migration header so nothing is silently lost.

- [ ] **Step 1b:** Seed an **Emotions board** — the standard wheel's 6-to-8 primaries, each holding
      its secondaries, each holding tertiaries. Occurrences nested in containers; that nesting IS
      the wheel's levels.
- [ ] **Step 2:** Seed a **Feeling Wheel** graph occurrence: `type:"sunburst"`, a feed over the
      Emotions board, `encoding.children:"occurrences"`. Place it on the day-page template.
- [ ] **Step 3:** Seed **`Mood: Record Selection`** — `onGraphSelect`, scoped to that graph.

      **The division of labour, stated by the user (2026-08-06) and now the rule:**
      > *"we just need it to record the click and the info with it cause the operation is handling
      > what happens with it … the system shouldnt know its a feelings wheel … we control what it
      > does through the operation."*

      The graph reports; the op decides. Two things this op does:
      1. **ADD the feeling to the day's Mood dropdown** — which is a MULTISELECT, so the write is a
         union into the existing array (`$trigger.occurrenceId` appended), not a replace. Several
         feelings in a day is the normal case, and re-picking the same one must not duplicate it.
      2. **WRITE THE HIGHLIGHT BACK** — `meta.graph.highlight` on the graph occurrence, so the
         picked feeling stays lit. Shipped and tested (`graphOption.highlightSet`): the graph
         renders whatever ids that list names, at any depth, on any chart type, and decides nothing
         itself. Keeping the highlight op-written is precisely what stops the renderer needing to
         know what a feeling is.

      Cheapest correct form of both: the highlight list and the Mood value hold the SAME ids, so
      the op can write one from the other rather than maintaining two truths.

      Verify the existing Moods tracker picks the value up; if it reads a different shape,
      reconcile HERE rather than teaching the graph about moods.
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
- [ ] Add a `noDomainKnowledge.test.js` case for the graph surface (Risks names it; the renderer
      must never learn what an emotion is).
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
- ~~**Feed + graph both maintain children.**~~ **RETRACTED 2026-08-06 — this risk was never real.**
  `feedSync` only sweeps children carrying `meta.feedSourceId`, so a hand-dragged row cannot be
  touched; feed and drag compose. Measured (grep + the existing `feedSync` test, 16/16), see Task 5
  Step 6. It was written from a suspicion about the engine rather than a reading of it, and cost two
  sessions and two questions put to the user.
- **`echarts` is a new runtime dependency**, the first charting library in the app. Keep it behind
  `EChart.jsx` so swapping it later touches one file.
