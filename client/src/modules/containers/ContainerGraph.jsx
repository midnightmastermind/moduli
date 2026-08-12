// modules/containers/ContainerGraph.jsx
// ============================================================
// The graph surface: a CHART and, beside it, the SOURCE BOARD of the
// occurrences the chart is made of (user 2026-08-06: "a sidebar next to the
// graph with all the occurances involved in the graph, its a board of the
// draggable occurances").
//
// THE IDEA THAT MAKES THIS SMALL: a graph's data rows are its CHILD
// OCCURRENCES. So the source board is not a new list — it is the graph's own
// children, and the chart is a second view of the same set. That also collapses
// the three data sources the user asked for into one mechanism:
//
//   query / feed → `occurrence.feed` already materializes matches as children
//   drag         → dropping onto a container already adds a child
//   hardcoded    → `meta.graph.literals`, the only genuinely new path
//
// WHAT THIS FILE OWNS: the two-pane layout, resolving the spec, and turning a
// chart selection into an operation trigger. WHAT IT DELEGATES: the data model
// (helpers/graphData), the chart spec (helpers/graphOption), the rendering
// (ui/EChart), and the source board (the child rows the container already
// renders). It knows nothing about emotions, moods, or wheels — a feeling wheel
// is data plus one operation, and `noDomainKnowledge.test.js` guards that.
// ============================================================
import React, { useCallback, useMemo, useRef, useState } from "react";
import { BarChart3, Minimize2 } from "lucide-react";
import EChart, { readChartTheme } from "../../ui/EChart";
import { buildGraphData } from "../../helpers/graphData";
import { resolveFeedItems } from "../../state/selectors";
import { resolveGraphRows } from "../../helpers/feedPull";
import { buildEChartsOption } from "../../helpers/graphOption";
import { DEFAULT_VIEW, isDefaultView } from "../../helpers/graphView";
import { useGridActionsSelector } from "../../GridActionsContext";
import { operationsBridge } from "../../state/bindSocketToStore";

// Bumped whenever this file's click path changes. A log line that cannot tell a
// STALE BUNDLE from a real failure sent us round the same loop twice.
const GRAPH_BUILD = "col-walk-2";

export default function ContainerGraph({ occurrence, renderParentOccurrenceId = null }) {
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);

  const hostRef = useRef(null);

  // ZOOM IS VIEW STATE, NOT DOCUMENT STATE — deliberately local and unsaved.
  // The graph fills its container (user, 2026-08-06: "the graph should be the
  // size of the container … and have it be zoomable"), and zoom is how you
  // reach a 14px slice on a phone. Persisting it would mean everyone opening
  // the day page inherits wherever the last person left the wheel; a graph
  // should open showing the whole thing.
  const [view, setView] = useState(DEFAULT_VIEW);

  const spec = occurrence?.meta?.graph || null;

  // THE ROWS ARE PULLED, NOT OWNED (user, 2026-08-10: "the graphs are supposed
  // to hold a representation of the occurance, not the occurances themselves …
  // make it use a feed and pull in the data … it should work like our dropdowns
  // in a way … so pulling in the data").
  //
  // So this resolves the feed's matches the same way an occurrence dropdown
  // resolves its options — a live query over the grid, materialising nothing.
  // `feedSync` leaves a pull-only feed alone (helpers/feedPull), so there are no
  // copies to keep in step and none to clone into a day column.
  //
  // A graph with no feed still charts its own children, so a hand-built one is
  // unaffected.
  const { nodes, warnings } = useMemo(
    () => {
      const occurrencesById = getOccMap();
      const rows = resolveGraphRows(occurrence, { occurrencesById, modulesById, resolveFeedItems });
      return buildGraphData(occurrence, { occurrencesById, modulesById, fieldsById, rows });
    },
    [occurrence, getOccMap, modulesById, fieldsById]
  );

  // The chart's MEASURED box, reported by EChart (which owns that element —
  // hostRef here is the outer wrapper and includes the source board).
  // `buildEChartsOption` needs it because the sunburst's label threshold is only
  // expressible in pixels: a 4.5° slice is ~14px of arc on a phone and ~170px
  // zoomed in, and a fixed `minAngle` is wrong at one of those sizes whichever
  // number you pick. Null until first measure — the option then keeps its old
  // fixed default, so the first paint is never worse than before.
  const [boxPx, setBoxPx] = useState(null);

  const { option } = useMemo(
    () => buildEChartsOption(spec, nodes, readChartTheme(hostRef.current), view, boxPx),
    [spec, nodes, view, boxPx]
  );

  // A selection fires the ordinary trigger path, so an operation decides what a
  // click MEANS. This is the whole reason the feeling wheel needs no
  // graph-specific code: "record the mood" is an op matching onGraphSelect.
  //
  // `ancestorOccurrenceId` is WHERE THE CLICK HAPPENED, and it is the one fact
  // no operation can recover for itself. A shared graph is multi-parented (the
  // emotions wheel sits in every day column), so walking the data upward picks
  // an arbitrary parent — `buildParentMap` keys child → ONE parent, last writer
  // wins. Reporting the render context makes "record this on the day I clicked"
  // expressible; without it the op can only ever guess a day.
  // IT GOES THROUGH `operationsBridge.fireOperations`, NOT `runMatchingOperations`,
  // and that is the whole reason a click ever recorded anything.
  //
  // `runMatchingOperations(operations, transactionType, transaction, context)`
  // takes POSITIONAL arguments. This called it with a single OBJECT — so
  // `operations` was that object, every other argument was undefined, and the
  // op loop iterated nothing. **No click had ever fired this trigger**, which is
  // why zero moods had ever been recorded. It failed silently because the whole
  // call sits in a try/catch whose job is to keep a broken op from taking the
  // chart down.
  //
  // Worse, even a correct positional call would have been HALF a fix: the
  // returned effects have to be APPLIED, and this discarded the return value.
  // `fireOperations` is the chokepoint every other write path already uses — it
  // assembles the context, calls the executor correctly, splits display updates
  // from CRUD effects and applies them, and carries the cascade dedup. Wiring a
  // second copy of that here is exactly the drift that produced this bug.
  // WHICH OCCURRENCE IS RENDERING THIS ONE, resolved from the DOM.
  //
  // The prop is threaded by ModuleContainer's child loop, but a DAY COLUMN is a
  // `kind:"doc"` container — it renders its children through its TEXTMAP as
  // moduleEmbed node views, not through that loop. So the prop never arrived and
  // the live log said so plainly: `column=none` on every click. With no column
  // the op fell back to the shared wheel's own filter, which is ONE value for
  // every day — which is exactly why a pick appeared to land on every day at
  // once.
  //
  // Reading the nearest ancestor carrying `data-occ-id` works for BOTH render
  // paths and needs no plumbing through the embed. It runs on click, never per
  // render. The prop still WINS when supplied, so the direct path is unchanged.
  const resolveRenderColumn = useCallback(() => {
    if (renderParentOccurrenceId) return { id: renderParentOccurrenceId, how: "prop", seen: [] };
    // The walk REPORTS what it saw. `column=none` twice in a row with no idea
    // whether the walk ran, found nothing, or the bundle was stale is not a
    // measurement — it is a guess with a number attached.
    const seen = [];
    let node = hostRef.current?.parentElement || null;
    let guard = 0;
    while (node && guard++ < 40) {
      const id = node.getAttribute?.("data-occ-id");
      if (id) {
        seen.push(id === occurrence?.id ? `self(${id.slice(0, 6)})` : id.slice(0, 6));
        // Skip the graph's own shell — we want the surface it SITS IN.
        if (id !== occurrence?.id) return { id, how: "dom", seen };
      }
      node = node.parentElement;
    }
    return { id: null, how: hostRef.current ? "dom-miss" : "no-host", seen };
  }, [renderParentOccurrenceId, occurrence?.id]);

  const handleSelect = useCallback((sel) => {
    if (!sel) return;
    const col = resolveRenderColumn();
    const column = col.id;
    // `[graph]` diagnostics, ON by default — the same posture caretDiag took for
    // a user-facing bug: a report should cost the user no setup. Mute with
    // `window.__graphDiag = false`. It prints what the click CARRIES and whether
    // the bridge is even wired, because "nothing happened" has now had three
    // different causes (a wrong-shaped call, a day that resolved to an object,
    // and a highlight too faint to see).
    if (window.__graphDiag !== false) {
      console.log(`[graph] click name=${sel.name} occ=${String(sel.occurrenceId || "none").slice(0, 8)} ` +
        `column=${String(column || "none").slice(0, 8)} via=${col.how} ` +
        `chain=[${col.seen.join(" < ") || "empty"}] ` +
        `bridge=${typeof operationsBridge.fireOperations === "function" ? "wired" : "MISSING"} ` +
        `build=${GRAPH_BUILD}`);
    }
    try {
      operationsBridge.fireOperations?.("GraphSelectOp", {
        type: "GraphSelectOp",
        occurrenceId: sel.occurrenceId,
        containerId: occurrence?.id,
        ancestorOccurrenceId: column || null,
        value: sel.value,
        path: sel.path,
        seriesName: sel.seriesName,
        name: sel.name,
      });
    } catch (e) {
      // A broken op must not take the chart down with it.
      console.warn("[graph] selection trigger failed:", e?.message || e);
    }
  }, [occurrence?.id, resolveRenderColumn]);

  if (!spec) {
    return (
      <div className="container-graph container-graph--unconfigured">
        <BarChart3 style={{ width: 16, height: 16, opacity: 0.5 }} />
        <span>No chart configured yet — pick a type and a value field.</span>
      </div>
    );
  }

  const empty = nodes.length === 0;

  return (
    <div className="container-graph" ref={hostRef}>
      <div className="container-graph-chart">
        {empty ? (
          <div className="container-graph-empty">
            Nothing to chart yet — drop an occurrence in, or give this graph a feed.
          </div>
        ) : (
          <EChart
            option={option}
            onSelect={handleSelect}
            className="container-graph-canvas"
            view={view}
            onViewChange={setView}
            onBox={setBoxPx}
          />
        )}
        {!isDefaultView(view) && (
          // Only while zoomed: a chart at rest should carry no chrome, and a
          // zoomed one must never be a state you cannot get out of.
          <button
            type="button"
            className="container-graph-reset"
            onClick={() => setView(DEFAULT_VIEW)}
            title="Fit the whole chart (or double-click it)"
          >
            <Minimize2 style={{ width: 12, height: 12 }} />
            <span>{view.zoom.toFixed(1)}×</span>
          </button>
        )}
        {warnings.length > 0 && (
          // Surfaced rather than swallowed: "this row contributed nothing" is
          // exactly the thing that is invisible in a chart.
          <div className="container-graph-warnings" title={warnings.map(w => w.why).join("\n")}>
            {warnings.length} row{warnings.length === 1 ? "" : "s"} contributed nothing
          </div>
        )}
      </div>

      {/* NO SOURCE BOARD. It existed to let you drag occurrences INTO the graph
          back when a graph OWNED its rows; now the rows come from the feed, so
          there is nothing to drag in and a board of draggables would be a
          second, editable copy of a query result (user, 2026-08-10: "but dont
          show draggables"). The occurrences themselves stay where they live —
          on their own board — which is the point of pulling rather than
          owning. */}
    </div>
  );
}
