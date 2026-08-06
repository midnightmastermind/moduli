// ui/GraphSection — editing a chart in the app.
//
// What matters here is not that selects render. It is that editing the chart
// cannot destroy something else on the occurrence: `meta.graph.highlight` is
// written by an OPERATION (that is how a picked slice stays lit), so a form
// that writes whole-meta would silently drop it on the next edit. That is the
// class of bug this file exists to catch.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (...a) => updateOccurrence(...a),
}));

const gridActions = { current: {} };
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => gridActions.current,
}));

import GraphSection from "../ui/GraphSection";

const GRAPH = "occ-graph";
const F_PARENT = "f-parent";
const F_VALUE = "f-value";

function world(graphMeta) {
  const occurrence = {
    id: GRAPH, moduleId: "m-graph", occurrences: ["c1"],
    meta: graphMeta,
  };
  gridActions.current = {
    dispatch: vi.fn(), socket: {},
    occurrencesById: {
      [GRAPH]: occurrence,
      c1: { id: "c1", moduleId: "m-row", label: "Row", occurrences: [], fields: {} },
    },
    modulesById: {
      "m-graph": { id: "m-graph", role: "container", kind: "graph" },
      "m-row": { id: "m-row", role: "instance", label: "Row" },
    },
    fieldsById: {
      [F_PARENT]: { id: F_PARENT, name: "Parent Ref", type: "occurrence" },
      [F_VALUE]: { id: F_VALUE, name: "Amount", type: "number" },
    },
  };
  return occurrence;
}

const lastWrite = () => updateOccurrence.mock.calls.at(-1)[0].occurrence;

beforeEach(() => updateOccurrence.mockClear());
afterEach(cleanup);

describe("GraphSection", () => {
  it("offers to configure an unconfigured container, and writes a default spec", () => {
    const occ = world({});
    const { getByText } = render(<GraphSection occurrence={occ} />);
    fireEvent.click(getByText("Configure"));
    expect(lastWrite().meta.graph).toMatchObject({ type: "sunburst", encoding: expect.any(Object) });
  });

  it("PRESERVES the rest of meta — an op-written highlight must survive an edit", () => {
    // The highlight is how a picked slice stays lit; it is written by an
    // operation, not by this form. A whole-meta write would drop it (and
    // anything else) the first time someone changed the chart type.
    const occ = world({
      graph: { type: "sunburst", encoding: {}, highlight: ["occ-lonely"] },
      headingLevel: 2,
    });
    const { container } = render(<GraphSection occurrence={occ} />);
    fireEvent.change(container.querySelector("select"), { target: { value: "pie" } });
    const meta = lastWrite().meta;
    expect(meta.graph.type).toBe("pie");
    expect(meta.graph.highlight).toEqual(["occ-lonely"]);
    expect(meta.headingLevel).toBe(2);
  });

  it("writes an encoding field id, and clears it back to null", () => {
    // null is a real choice for every encoding (label / tally / flat), so it
    // must be writable, not just an absent key.
    const occ = world({ graph: { type: "sunburst", encoding: {} } });
    const { getAllByRole } = render(<GraphSection occurrence={occ} />);
    const valueSelect = getAllByRole("combobox")[2];      // type, label, value
    fireEvent.change(valueSelect, { target: { value: F_VALUE } });
    expect(lastWrite().meta.graph.encoding.value).toBe(F_VALUE);
    fireEvent.change(valueSelect, { target: { value: "" } });
    expect(lastWrite().meta.graph.encoding.value).toBe(null);
  });

  it("offers a parent field ONLY from occurrence-typed fields", () => {
    // A parent reference names another row; a number field cannot. Offering
    // one would let an author build a hierarchy that silently resolves to
    // nothing.
    const occ = world({ graph: { type: "sunburst", encoding: {} } });
    const { getByTitle } = render(<GraphSection occurrence={occ} />);
    const row = getByTitle(/naming its parent row/).parentElement;
    const options = [...row.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Parent Ref");
    expect(options).not.toContain("Amount");
  });

  it("hides the hierarchy controls for a chart that cannot draw one", () => {
    const occ = world({ graph: { type: "bar", encoding: {} } });
    const { queryByTitle } = render(<GraphSection occurrence={occ} />);
    expect(queryByTitle(/naming its parent row/)).toBeNull();
  });

  it("reports what the CURRENT spec actually draws", () => {
    // The live readout is the point of the section: an encoding can be wrong
    // in a way that still renders a chart, just the wrong one.
    const occ = world({ graph: { type: "pie", encoding: {} } });
    const { getByText } = render(<GraphSection occurrence={occ} />);
    expect(getByText(/1 root/)).toBeTruthy();
  });

  it("renders nothing without an occurrence", () => {
    world({});
    const { container } = render(<GraphSection occurrence={null} />);
    expect(container.firstChild).toBeNull();
  });
});
