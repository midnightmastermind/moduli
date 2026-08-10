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

import GraphSection, { splitFieldsByPresence } from "../ui/GraphSection";

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

// ── the field pickers offer what the FEED PULLS IN ──────────────────────────
// User 2026-08-10: "a good ui for linking diff data to it via what we pull in
// from the feed". These cover the DECISION (which fields are offered first and
// with what count); the <optgroup> rendering itself is one JSX branch above it.
describe("splitFieldsByPresence", () => {
  const F = [{ id: "f-cal", name: "Calories" }, { id: "f-pro", name: "Protein" }, { id: "f-none", name: "Unused" }];
  const rows = [
    { id: "r1", fields: { "f-cal": { value: 200 }, "f-pro": { value: 12 } } },
    { id: "r2", fields: { "f-cal": { value: 300 } } },
  ];

  it("separates the fields the rows carry from the rest of the grid", () => {
    const { onRows, others } = splitFieldsByPresence(F, rows);
    expect(onRows.map((f) => f.id)).toEqual(["f-cal", "f-pro"]);   // 2 rows, then 1
    expect(others.map((f) => f.id)).toEqual(["f-none"]);
  });

  it("counts how many rows carry each — the number that says what a pick will reach", () => {
    expect(splitFieldsByPresence(F, rows).counts.get("f-cal")).toBe(2);
    expect(splitFieldsByPresence(F, rows).counts.get("f-pro")).toBe(1);
  });

  it("orders by how many rows carry it, not by name", () => {
    // "Calories" beats "Protein" alphabetically too, so the discriminating case
    // is one where the popular field sorts LAST by name.
    const fields = [{ id: "f-a", name: "Aaa" }, { id: "f-z", name: "Zzz" }];
    const world = [{ fields: { "f-z": { value: 1 } } }, { fields: { "f-z": { value: 2 } } }, { fields: { "f-a": { value: 3 } } }];
    expect(splitFieldsByPresence(fields, world).onRows.map((f) => f.id)).toEqual(["f-z", "f-a"]);
  });

  it("treats an EMPTY value as absent — an empty field is not data to chart", () => {
    const world = [{ fields: { "f-cal": { value: null }, "f-pro": { value: "" } } }];
    expect(splitFieldsByPresence(F, world).onRows).toEqual([]);
  });

  it("reads an ARRAY value as present — a multi-select is a bare value, not a wrapper", () => {
    // The 2026-07-12 class: treating an array as "object without a value key"
    // made every multi-select read as empty.
    const world = [{ fields: { "f-cal": ["a", "b"] } }];
    expect(splitFieldsByPresence(F, world).onRows.map((f) => f.id)).toEqual(["f-cal"]);
  });

  it("offers EVERY field when nothing is pulled yet, rather than an empty list", () => {
    // A graph is configured before its feed matches anything; hiding the fields
    // then would make it unconfigurable.
    const { onRows, others } = splitFieldsByPresence(F, []);
    expect(onRows).toEqual([]);
    expect(others).toHaveLength(3);
  });
});
