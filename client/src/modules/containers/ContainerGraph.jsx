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
import { BarChart3, PanelRightClose, PanelRightOpen } from "lucide-react";
import EChart, { readChartTheme } from "../../ui/EChart";
import { buildGraphData } from "../../helpers/graphData";
import { buildEChartsOption } from "../../helpers/graphOption";
import { useGridActionsSelector } from "../../GridActionsContext";
import { runMatchingOperations } from "../../helpers/operationExecutor";

export default function ContainerGraph({ occurrence, dispatch, socket, renderSourceBoard = null }) {
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const operationsById = useGridActionsSelector(s => s.operationsById);
  const getState = useGridActionsSelector(s => s.getState || (() => s.state || {}));

  const [boardOpen, setBoardOpen] = useState(true);
  const hostRef = useRef(null);

  const spec = occurrence?.meta?.graph || null;

  // Rebuilt when the graph's own children change — the chart is a view of the
  // same set the board shows, so one dependency drives both.
  const { nodes, warnings } = useMemo(
    () => buildGraphData(occurrence, { occurrencesById: getOccMap(), modulesById, fieldsById }),
    [occurrence, getOccMap, modulesById, fieldsById]
  );

  const { option } = useMemo(
    () => buildEChartsOption(spec, nodes, readChartTheme(hostRef.current)),
    [spec, nodes]
  );

  // A selection fires the ordinary trigger path, so an operation decides what a
  // click MEANS. This is the whole reason the feeling wheel needs no
  // graph-specific code: "record the mood" is an op matching onGraphSelect.
  const handleSelect = useCallback((sel) => {
    if (!sel) return;
    const state = getState();
    try {
      runMatchingOperations({
        transactionType: "GraphSelectOp",
        transaction: {
          type: "GraphSelectOp",
          occurrenceId: sel.occurrenceId,
          containerId: occurrence?.id,
          value: sel.value,
          path: sel.path,
          seriesName: sel.seriesName,
          name: sel.name,
        },
        state, dispatch, socket,
        occurrencesById: getOccMap(), modulesById, fieldsById, operationsById,
      });
    } catch (e) {
      // A broken op must not take the chart down with it.
      console.warn("[graph] selection trigger failed:", e?.message || e);
    }
  }, [occurrence?.id, getState, dispatch, socket, getOccMap, modulesById, fieldsById, operationsById]);

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
          <EChart option={option} onSelect={handleSelect} className="container-graph-canvas" />
        )}
        {warnings.length > 0 && (
          // Surfaced rather than swallowed: "this row contributed nothing" is
          // exactly the thing that is invisible in a chart.
          <div className="container-graph-warnings" title={warnings.map(w => w.why).join("\n")}>
            {warnings.length} row{warnings.length === 1 ? "" : "s"} contributed nothing
          </div>
        )}
      </div>

      {renderSourceBoard && (
        <>
          <button
            type="button"
            className="container-graph-board-toggle"
            onClick={() => setBoardOpen(v => !v)}
            title={boardOpen ? "Hide the source board" : "Show the source board"}
          >
            {boardOpen
              ? <PanelRightClose style={{ width: 13, height: 13 }} />
              : <PanelRightOpen style={{ width: 13, height: 13 }} />}
          </button>
          {boardOpen && (
            // The graph's own children, rendered by the container's existing
            // row renderer. Drag in, drag out, reorder, edit fields — all of it
            // is behaviour that already exists.
            <div className="container-graph-board">{renderSourceBoard()}</div>
          )}
        </>
      )}
    </div>
  );
}
