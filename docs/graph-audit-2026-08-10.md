# Graph system audit — 2026-08-10

User: *"make sure we can do other kinds of graphs as well, and a good ui for linking diff data to it
via what we pull in from the feed. i want to make other kinds of graphs with it"* → *"do a full
audit on our graph system for this."*

Audited before extending, because two of the three defects below get WORSE with more chart types:
they are both "the UI offers a control the selected type ignores", and every type added multiplies
that surface.

---

## The pieces, and what each one owns

```
helpers/graphData.js    245 lines  28 tests   rows → nodes (hierarchy, encoding, warnings)
helpers/graphOption.js  284 lines  29 tests   nodes → an ECharts option (pure, no React)
helpers/graphView.js    120 lines  17 tests   zoom / pan arithmetic
helpers/feedPull.js      57 lines   9 tests   pull-only feeds + the shared row resolver
ui/GraphSection.jsx     254 lines   7 tests   the encoding editor + live readout
ui/EChart.jsx           348 lines  18 tests   render, resize, pointer, selection
modules/containers/ContainerGraph.jsx 175  10 tests   the surface; selection → operation
```

The split is sound and is why this audit could be done with measurements instead of screenshots:
everything that DECIDES is pure, and only `EChart` touches the library.

**Chart types today:** `sunburst` (nested) · `pie` · `bar` · `line`. Unknown type → bar + a warning.

**Encodings read by `graphData`:** `category` `value` `series` `parent` `level` `children` — the same
six `GraphSection` offers. No orphans in either direction.

**Selection works on every type, and this is the finding that makes new types cheap.** `toDatum`
attaches `occurrenceId` to every datum regardless of chart type, and `ContainerGraph.handleSelect`
fires the ordinary `GraphSelectOp` trigger path. So a new chart type inherits click-to-run-an-
operation with no new code — nothing in the selection path branches on type.

---

## F1 — a split series on a bar/line chart draws its bars UNDER THE WRONG CATEGORIES

Measured, by building the real option from four nodes across two series:

```
categories        ["Mon", "Tue", "Wed"]
series "Alice"    [["Mon",1], ["Tue",2], ["Wed",3]]
series "Bob"      [["Tue",9]]                        ← ONE datum, and it is at INDEX 0
```

`xAxis.data` is built from the union of node names, but each series' `data` is only that series' own
nodes. On an ECharts **category axis, data items map to categories by INDEX** — a datum's `name` is
used for the tooltip and the label, never for placement. So Bob's "Tue" value of 9 is drawn on
**Mon**, and every series that does not carry a datum for every category is shifted left.

Nothing is dropped and nothing errors: the chart is fully populated and quietly wrong. The same
mechanism misplaces data when one series carries two nodes with the same name (`Set` collapses the
category, the series keeps both items).

**Honest limit on this one:** the evidence is the option object, plus documented ECharts category-axis
semantics. **It has not been screenshotted**, and this repo's own rule is that a chart is a canvas.
Confirm with a picture before and after the fix.

**Fix:** pad each series to the full category list (`null` for a missing category) so index and
category agree by construction — not a rendering tweak, a correctness one.

## F2 — "Split by" is a dead control on pie and sunburst

```
pie, same four nodes → 1 series · legend absent · all four slices in one ring
```

`splitSeries` is called only in the bar/line branch. The pie branch maps `flat` directly; the
sunburst branch maps the tree. So setting **Split by** on either type does nothing at all — no
legend, no grouping, no warning. The editor offers all six encodings for every type.

This is the "dead tile" class the intake coverage contract exists to prevent, and it is the one that
scales badly: each new type silently ignores some subset of six controls.

**Fix:** the chart-type definition should declare which encodings it consumes, `GraphSection` should
render only those, and `graphData` should warn when a stored encoding is unusable for the selected
type (a type switch must not silently discard configuration).

## F3 — putting a hierarchy on a non-sunburst chart silently drops every branch node

```
tree  Root → Leaf
pie   ["Leaf"]        ← Root is gone
```

`flatten` pushes a node only when it has no children, so a pie/bar/line of a nested dataset shows
**leaves only**. For the emotions wheel that means switching from sunburst to pie drops the primary
and secondary rings — 128 tertiary slices with no grouping and no indication anything was removed.

Leaves-only is a defensible default (a pie of a tree has to pick a level), but it must be **stated,
and choosable**. This is exactly the user's ask in another form: "linking different data to it" for a
flat chart means picking WHICH level of the pulled rows to plot.

**Fix:** a `level` control for flat types (leaves / a specific depth / roll up to depth N), and a
warning when flattening discarded nodes.

## F4 — "Pie" is a donut

`radius: ["38%", "72%"]`. Reasonable at panel size, but it means the type list has no true pie, and a
separate "Donut" entry would be a duplicate. Worth naming honestly in the picker.

---

## What this means for the two feature asks

**More chart types** is cheap on the axes that usually cost: selection is already type-agnostic,
theming and zoom/pan are already resolved outside the option, and an unknown type degrades to bar
rather than blanking the page. What it is NOT cheap on is F2 — adding types to a UI that offers
every encoding for every type multiplies the dead controls. **F2 is a prerequisite, not a follow-up.**

**The linking UI** is the same problem seen from the other side: it should offer the fields present
on the PULLED rows (the feed's live matches, which `resolveGraphRows` already resolves for both the
chart and the readout), show only the encodings the selected type consumes, and say what the current
encoding is discarding. F3 is the missing control inside that UI.

**Order:** F2 (encoding capability per type) → F1 (category alignment) → F3 (level control) → then
new types, which by then are a table entry plus an option branch.

---

## Outcome — all three fixed, then five types added, same session

| | state |
|---|---|
| **F1** category misalignment | FIXED — every series is padded to the shared category list. Two rows sharing a name in one series keep the first and say so, rather than aggregating (this file does not invent aggregates) or going silent. |
| **F2** dead encoding controls | FIXED — each type declares the encodings it reads; the editor renders only those, and `buildEChartsOption` warns about anything configured that the type ignores. Config is kept, not dropped, so switching type and back destroys nothing. |
| **F3** silent hierarchy flattening | FIXED — a `Levels` control (deepest / top / every), default unchanged, and a warning naming how many grouping rows were not drawn. |
| **F4** pie is a donut | Named honestly in the picker rather than "fixed". |

**Added: `bar-h`, `bar-stacked`, `area`, `treemap`, `radar` — 4 types → 9.**

**Two defects found in the ADDING, both of the class this repo keeps paying for:**

1. **ECharts is tree-shaken, and neither new chart was registered.** `graphOption` is pure and never
   touches the library, so treemap and radar built perfectly valid options that would have rendered
   **nothing**, with every unit test green — the call-site class, four sessions running. The
   registration now derives from `CHART_TYPES`, and a test fails when a declared type has no module
   row. (Verified against the installed echarts 6.1.0 that all six charts and `RadarComponent` are
   real exports — a registration naming something the library does not export throws at load.)
2. **The treemap branch sat AFTER the flatten step**, so it warned about discarding a level it had
   in fact drawn. Both nested types now return above it.

**A stale claim in `EChart.jsx` was falsified while checking the cost.** The header said "only the
series actually used are imported — each extra chart type is ~13 kB". A/B'd by building the type
table at 4 and at 9: **the charts chunk is byte-identical, same content hash, 261 kB / 86 kB
gzipped.** `import("echarts/charts")` pulls the whole namespace, so rollup retains every chart
regardless. **New chart types cost nothing** — worth knowing before anyone rations them to protect a
budget that is already spent.

**Verified vs asserted, stated plainly:** every branch is asserted at the option level and A/B'd —
nine mutations, each failing 1–3 tests (unpadded series, no encoding warning, ignored flatten mode,
silent duplicate, our own id reaching ECharts as a series type, unswapped axes, dropped stacking,
treemap drilling on click, per-spoke radar maxes). **Nothing here has been rendered in a browser.**
Two of the three defects this surface has produced were invisible to every assertion and took a
screenshot — so the new types want a look before they are trusted, particularly the radar (whose
polygon geometry no option assertion describes) and the treemap's own `nodeClick`.

**One honest limitation, stated rather than shipped quietly:** a **radar click identifies the
SERIES, not the spoke** — an ECharts radar datum is a whole polygon. Every other type carries
`occurrenceId` per datum and selects a row. Radar is for reading, not picking.

**Also fixed on the way:** `GraphSection`'s live readout only ever heard `buildGraphData`'s warnings,
so the two new classes of warning (an ignored encoding, a discarded level) — precisely the failures
that still LOOK like a chart — would never have reached the reader. It now builds both halves.

**Still open:** a **scatter** type needs a second numeric encoding (`x` alongside `value`), which is
a `graphData` change rather than an option branch — the first type that is not free.
