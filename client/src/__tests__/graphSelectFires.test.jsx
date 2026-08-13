// THE CALL SITE, which is where this bug actually lived.
//
// `moodRecordSelection.test.js` drives the executor directly and passed the
// whole time the feature was dead: `ContainerGraph` called
// `runMatchingOperations({...})` with a SINGLE OBJECT while the function takes
// POSITIONAL arguments `(operations, transactionType, transaction, context)`.
// So `operations` was that object, everything else was undefined, the op loop
// iterated nothing, and the surrounding try/catch made it silent. **No click
// had ever fired the trigger** — which is why zero moods were ever recorded.
//
// A test that exercises the executor cannot see that. This one renders the
// component and asserts on what LEAVES it. Same lesson as 2026-08-09 (2): a
// test that renders the component directly does not test the host that wraps
// it — here, the component IS the untested host.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture EChart's onSelect so a "click" can be delivered without ECharts.
let capturedOnSelect = null;
vi.mock("../ui/EChart", () => ({
  default: (props) => { capturedOnSelect = props.onSelect; return React.createElement("div"); },
  readChartTheme: () => ({}),
}));
// `useGridActionsSelectorShallow` was added when the wheel stopped READING the
// occurrence map through a stable getter and started SUBSCRIBING to it — a
// getter never changes identity, so a write left the highlight stale. A context
// double has to offer it or the component throws on mount.
const STATE = {
  getOccMap: () => ({}), modulesById: {}, fieldsById: {}, occurrencesById: {},
};
vi.mock("../GridActionsContext", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));
vi.mock("../helpers/graphData", () => ({
  buildGraphData: () => ({ nodes: [{ name: "Lonely", occurrenceId: "occ-lonely" }], warnings: [] }),
}));
vi.mock("../helpers/feedPull", () => ({ resolveGraphRows: () => [] }));
vi.mock("../state/selectors", () => ({ resolveFeedItems: () => [] }));

import { operationsBridge } from "../state/bindSocketToStore";
import ContainerGraph from "../modules/containers/ContainerGraph";

const WHEEL = { id: "occ-wheel", meta: { graph: { type: "sunburst" } } };

beforeEach(() => {
  capturedOnSelect = null;
  operationsBridge.fireOperations = vi.fn();
});

describe("ContainerGraph fires the trigger through the bridge", () => {
  it("a click calls fireOperations with the GraphSelectOp transaction", () => {
    render(React.createElement(ContainerGraph, { occurrence: WHEEL, renderParentOccurrenceId: "occ-col" }));
    expect(capturedOnSelect).toBeTypeOf("function");

    capturedOnSelect({ occurrenceId: "occ-lonely", value: 1, path: ["Sad", "Lonely"], name: "Lonely" });

    expect(operationsBridge.fireOperations).toHaveBeenCalledTimes(1);
    const [txType, tx] = operationsBridge.fireOperations.mock.calls[0];
    // POSITIONAL, in the order every other write path uses. Passing an object
    // here is precisely the defect this test exists to catch.
    expect(txType).toBe("GraphSelectOp");
    expect(tx).toMatchObject({
      type: "GraphSelectOp",
      occurrenceId: "occ-lonely",
      containerId: "occ-wheel",
      ancestorOccurrenceId: "occ-col",
    });
  });

  it("reports WHERE the click happened, so a shared wheel can resolve its day", () => {
    // The wheel is multi-parented into every day column; no data-side ancestor
    // walk can tell them apart. If this argument is dropped the op can only
    // guess a day — the whole reason the render context is threaded down.
    render(React.createElement(ContainerGraph, { occurrence: WHEEL, renderParentOccurrenceId: "occ-tuesday" }));
    capturedOnSelect({ occurrenceId: "occ-lonely", name: "Lonely" });
    expect(operationsBridge.fireOperations.mock.calls[0][1].ancestorOccurrenceId).toBe("occ-tuesday");
  });

  it("with no render context it still fires, carrying null", () => {
    // A graph outside a day column must degrade to the op's fallback chain,
    // not silently do nothing.
    render(React.createElement(ContainerGraph, { occurrence: WHEEL }));
    capturedOnSelect({ occurrenceId: "occ-lonely", name: "Lonely" });
    expect(operationsBridge.fireOperations).toHaveBeenCalledTimes(1);
    expect(operationsBridge.fireOperations.mock.calls[0][1].ancestorOccurrenceId).toBeNull();
  });

  it("a slice with no occurrence behind it still fires — the OP decides, not the chart", () => {
    // The pipeline guards on `$picked IS_NOT_EMPTY`. Filtering here instead
    // would put that decision in the renderer, which is what this whole surface
    // is built to avoid.
    render(React.createElement(ContainerGraph, { occurrence: WHEEL, renderParentOccurrenceId: "occ-col" }));
    capturedOnSelect({ occurrenceId: null, name: "Literal" });
    expect(operationsBridge.fireOperations.mock.calls[0][1].occurrenceId).toBeNull();
  });

  it("does nothing when the chart reports no selection at all", () => {
    render(React.createElement(ContainerGraph, { occurrence: WHEEL, renderParentOccurrenceId: "occ-col" }));
    capturedOnSelect(null);
    expect(operationsBridge.fireOperations).not.toHaveBeenCalled();
  });
});
