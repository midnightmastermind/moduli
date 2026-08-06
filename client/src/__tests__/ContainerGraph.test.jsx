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

const runMatchingOperations = vi.fn();
vi.mock("../helpers/operationExecutor", () => ({
  runMatchingOperations: (...a) => runMatchingOperations(...a),
}));

import ContainerGraph from "../modules/containers/ContainerGraph";

const F_VALUE = "f-intensity";

function setup({ graph = { type: "pie", encoding: { value: F_VALUE } }, childIds = ["a", "b"] } = {}) {
  const occurrencesById = {
    g1: { id: "g1", moduleId: "m-graph", occurrences: childIds, meta: graph ? { graph } : {} },
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
  const board = () => <div data-testid="board">source board</div>;
  const view = render(
    <GridActionsContext.Provider value={ctx}>
      <ContainerGraph occurrence={occurrencesById.g1} dispatch={ctx.dispatch} socket={null} renderSourceBoard={board} />
    </GridActionsContext.Provider>
  );
  return { view, occurrencesById };
}

beforeEach(() => { lastEChartProps = null; runMatchingOperations.mockClear(); });
afterEach(cleanup);

describe("ContainerGraph", () => {
  it("renders the chart AND the source board — two views of the same children", () => {
    setup();
    expect(screen.getByTestId("echart")).toBeTruthy();
    expect(screen.getByTestId("board")).toBeTruthy();
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
    // the board still renders — that is where you drop something in
    expect(screen.getByTestId("board")).toBeTruthy();
  });

  it("degrades with a message when no chart is configured, rather than blanking", () => {
    setup({ graph: null });
    expect(screen.queryByTestId("echart")).toBe(null);
    expect(screen.getByText(/No chart configured/i)).toBeTruthy();
  });

  it("turns a selection into an ordinary OPERATION TRIGGER", () => {
    setup();
    lastEChartProps.onSelect({ occurrenceId: "a", name: "Angry", value: 8, seriesName: null, path: ["Angry"] });
    expect(runMatchingOperations).toHaveBeenCalledTimes(1);
    const arg = runMatchingOperations.mock.calls[0][0];
    expect(arg.transactionType).toBe("GraphSelectOp");
    expect(arg.transaction).toMatchObject({ occurrenceId: "a", value: 8, path: ["Angry"], containerId: "g1" });
  });

  it("survives a THROWING operation — a broken op must not take the chart down", () => {
    runMatchingOperations.mockImplementationOnce(() => { throw new Error("bad pipeline"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup();
    expect(() => lastEChartProps.onSelect({ occurrenceId: "a", path: [] })).not.toThrow();
    expect(screen.getByTestId("echart")).toBeTruthy();
    warn.mockRestore();
  });

  it("ignores a null selection", () => {
    setup();
    lastEChartProps.onSelect(null);
    expect(runMatchingOperations).not.toHaveBeenCalled();
  });

  it("collapses the source board on demand", () => {
    setup();
    expect(screen.getByTestId("board")).toBeTruthy();
    fireEvent.click(document.querySelector(".container-graph-board-toggle"));
    expect(screen.queryByTestId("board")).toBe(null);
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
