// modules/containers/ContainerGraph — the graph SURFACE.
//
// EChart is mocked: jsdom cannot prove a chart renders, and this file is not
// about the picture. It is about the surface's contract — that the chart and
// the source board are two views of the SAME child occurrences, that an empty
// or unconfigured graph degrades instead of blanking, and that a selection
// becomes an ordinary operation trigger (which is what lets a feeling wheel
// exist with no graph-specific code).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

let lastEChartProps = null;
vi.mock("../ui/EChart", () => ({
  default: (props) => { lastEChartProps = props; return <div data-testid="echart" />; },
  readChartTheme: () => ({ text: "#fff", faint: "#888" }),
}));

// The component fires through operationsBridge, the chokepoint every other
// write path uses. THIS MOCK USED TO TARGET `runMatchingOperations` AND ASSERT
// A SINGLE-OBJECT CALL — i.e. it pinned the defect: that function is positional,
// so the real call did nothing and this test passed anyway. A test that encodes
// a broken contract protects the bug.
const fireOperations = vi.fn();
vi.mock("../helpers/operationExecutor", () => ({
}));

// A graph PULLS its rows from its feed, the way a dropdown resolves its options.
// Mocked so the test can prove the rows come from the QUERY and not from the
// graph's children — the whole point of the change.
const feedMatches = vi.fn(() => []);
vi.mock("../state/selectors", async (orig) => ({
  ...(await orig()),
  resolveFeedItems: (...a) => feedMatches(...a),
}));

import ContainerGraph from "../modules/containers/ContainerGraph";
import { operationsBridge } from "../state/bindSocketToStore";

const F_VALUE = "f-intensity";

function setup({ graph = { type: "pie", encoding: { value: F_VALUE } }, childIds = ["a", "b"], feed = null } = {}) {
  const occurrencesById = {
    g1: { id: "g1", moduleId: "m-graph", occurrences: childIds, meta: graph ? { graph } : {}, ...(feed ? { feed } : {}) },
    a: { id: "a", moduleId: "m-a", label: "Angry", fields: { [F_VALUE]: { value: 8 } }, occurrences: [] },
    b: { id: "b", moduleId: "m-b", label: "Sad", fields: { [F_VALUE]: { value: 3 } }, occurrences: [] },
  };
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g", userId: "u",
    occurrencesById, modulesById: {}, fieldsById: {}, operationsById: {},
    getOccMap: () => occurrencesById,
    getState: () => ({ grid: {} }),
    state: { grid: {} },
  };
  const view = render(
    <GridActionsContext.Provider value={ctx}>
      <ContainerGraph occurrence={occurrencesById.g1} dispatch={ctx.dispatch} socket={null} />
    </GridActionsContext.Provider>
  );
  return { view, occurrencesById };
}

beforeEach(() => { lastEChartProps = null; fireOperations.mockClear(); operationsBridge.fireOperations = fireOperations; });
afterEach(cleanup);

describe("ContainerGraph", () => {
  it("renders the chart and NO draggable board", () => {
    // The board existed to drag occurrences INTO a graph that OWNED its rows.
    // The rows are pulled now, so there is nothing to drag in and a board of
    // draggables would be an editable copy of a query result (user,
    // 2026-08-10: "but dont show draggables").
    setup();
    expect(screen.getByTestId("echart")).toBeTruthy();
    expect(screen.queryByTestId("board")).toBe(null);
    expect(screen.queryByTitle(/source board/i)).toBe(null);
  });

  it("feeds the chart data derived from its CHILD OCCURRENCES", () => {
    setup();
    const data = lastEChartProps.option.series[0].data;
    expect(data.map(d => d.name)).toEqual(["Angry", "Sad"]);
    expect(data.map(d => d.value)).toEqual([8, 3]);
    // the key that makes a click actionable
    expect(data.map(d => d.occurrenceId)).toEqual(["a", "b"]);
  });

  it("shows an EMPTY state instead of a chart when there are no rows", () => {
    setup({ childIds: [] });
    expect(screen.queryByTestId("echart")).toBe(null);
    expect(screen.getByText(/Nothing to chart yet/i)).toBeTruthy();
  });

  it("degrades with a message when no chart is configured, rather than blanking", () => {
    setup({ graph: null });
    expect(screen.queryByTestId("echart")).toBe(null);
    expect(screen.getByText(/No chart configured/i)).toBeTruthy();
  });

  it("turns a selection into an ordinary OPERATION TRIGGER", () => {
    setup();
    lastEChartProps.onSelect({ occurrenceId: "a", name: "Angry", value: 8, seriesName: null, path: ["Angry"] });
    expect(fireOperations).toHaveBeenCalledTimes(1);
    const [txType, tx] = fireOperations.mock.calls[0];
    expect(txType).toBe("GraphSelectOp");
    expect(tx).toMatchObject({ occurrenceId: "a", value: 8, path: ["Angry"], containerId: "g1" });
  });

  it("survives a THROWING operation — a broken op must not take the chart down", () => {
    fireOperations.mockImplementationOnce(() => { throw new Error("bad pipeline"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup();
    expect(() => lastEChartProps.onSelect({ occurrenceId: "a", path: [] })).not.toThrow();
    expect(screen.getByTestId("echart")).toBeTruthy();
    warn.mockRestore();
  });

  it("ignores a null selection", () => {
    setup();
    lastEChartProps.onSelect(null);
    expect(fireOperations).not.toHaveBeenCalled();
  });


  it("renders without a source board at all (embeds that have no room for one)", () => {
    const occurrencesById = {
      g1: { id: "g1", moduleId: "m-graph", occurrences: ["a"], meta: { graph: { type: "bar", encoding: { value: F_VALUE } } } },
      a: { id: "a", moduleId: "m-a", label: "Angry", fields: { [F_VALUE]: { value: 1 } }, occurrences: [] },
    };
    const ctx = {
      dispatch: vi.fn(), socket: null, occurrencesById, modulesById: {}, fieldsById: {}, operationsById: {},
      getOccMap: () => occurrencesById, getState: () => ({ grid: {} }), state: { grid: {} },
    };
    render(
      <GridActionsContext.Provider value={ctx}>
        <ContainerGraph occurrence={occurrencesById.g1} dispatch={ctx.dispatch} socket={null} />
      </GridActionsContext.Provider>
    );
    expect(screen.getByTestId("echart")).toBeTruthy();
    expect(document.querySelector(".container-graph-board-toggle")).toBe(null);
  });
});

describe("ContainerGraph pulls its rows", () => {
  it("charts the FEED's matches when the graph has NO children of its own", () => {
    // The discriminating case for the whole change: nothing is materialised, so
    // if the component still read `occurrence.occurrences` this would be empty.
    feedMatches.mockReturnValue([
      { occurrence: { id: "a" } },
      { occurrence: { id: "b" } },
    ]);
    setup({ childIds: [], feed: { enabled: true } });
    const data = lastEChartProps.option.series[0].data;
    expect(data.map(d => d.name)).toEqual(["Angry", "Sad"]);
    expect(data.map(d => d.occurrenceId)).toEqual(["a", "b"]);
  });

  it("does NOT consult the feed when the graph has none — a hand-built graph is unaffected", () => {
    feedMatches.mockClear();
    setup({ childIds: ["a"] });
    expect(feedMatches).not.toHaveBeenCalled();
    expect(lastEChartProps.option.series[0].data.map(d => d.name)).toEqual(["Angry"]);
  });
});
