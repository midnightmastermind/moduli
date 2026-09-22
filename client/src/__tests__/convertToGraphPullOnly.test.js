/**
 * convertToGraphPullOnly.test.js
 *
 * A CONVERTED GRAPH WAS A GRAPH TO THE RENDERER AND A BOARD TO THE FEED ENGINE.
 *
 * Found building a chart through the UI on the rebuild grid (2026-09-22).
 * Converting is the ONLY way to get a `kind:"graph"` container — the create
 * palettes offer board/doc/canvas/table and nothing else, which
 * convertOccurrence's own header records ("nothing in the UI could ever set the
 * kind that RENDERS one"). But the two halves answer to different fields:
 *
 *   ModuleContainer   renders a chart when     module.kind === "graph"
 *   isPullOnlyFeed    reads instead of owns when   occurrence.meta.graph
 *
 * and `planContainerKindConversion` wrote only the module's kind. So a freshly
 * converted graph is NOT pull-only: switch its feed on before opening the Chart
 * tab and the feed MATERIALISES copy-linked children into a container that draws
 * a chart. That is the shape feedPull exists to prevent — its header records the
 * Emotions Wheel materialising 128 copies, which APPLY_TEMPLATE then cloned into
 * every day column.
 *
 * THE MIRROR CASE IS WORSE AND IS WHY THE FIX GOES BOTH WAYS. Convert a graph
 * BACK to a board and a leftover `meta.graph` keeps `isPullOnlyFeed` true — so
 * the board's feed silently mints nothing AND sweeps the copies it made before.
 * A feature that stops working is easier to miss than one that writes too much.
 */
import { describe, it, expect, vi } from "vitest";
import { planContainerKindConversion } from "../helpers/convertOccurrence";
import { isPullOnlyFeed } from "../helpers/feedPull";
import { syncFeed } from "../helpers/feedSync";

const boardModule = { id: "m-box", role: "container", kind: "board", label: "By Category" };
const boardOcc = { id: "box", moduleId: "m-box", gridId: "g", occurrences: [], meta: {} };

/** Apply a conversion plan the way convertContainerKind does. */
function convert(occurrence, module, targetKind) {
  const plan = planContainerKindConversion({ occurrence, module, targetKind });
  return {
    module: plan?.modulePatch ?? module,
    occurrence: plan?.occurrencePatch ?? occurrence,
  };
}

/** Drive the REAL feed materialiser over a one-row world. */
function runFeed(occurrence) {
  const emitted = [];
  const socket = { connected: true, emit: (...a) => emitted.push(a), io: { opts: {} } };
  const modulesById = {
    "m-box": { id: "m-box", role: "container", kind: "board" },
    "m-row": { id: "m-row", role: "instance", kind: "board" },
  };
  const feedOcc = { ...occurrence, feed: { enabled: true, roles: ["instance"], limit: 50 } };
  const occurrencesById = {
    [feedOcc.id]: feedOcc,
    r1: { id: "r1", moduleId: "m-row", gridId: "g", fields: {} },
  };
  const state = {
    userId: "u1", gridId: "g", grid: { _id: "g", namedFilters: [], activeFilterId: null },
    occurrences: Object.values(occurrencesById),
  };
  const res = syncFeed(feedOcc, { state, occurrencesById, modulesById, dispatch: vi.fn(), socket });
  return { ...res, creates: emitted.filter(([ev]) => ev === "create_occurrence").length };
}

describe("converting a container to a graph", () => {
  it("makes it pull-only, so its feed reads instead of owning", () => {
    const { occurrence } = convert(boardOcc, boardModule, "graph");
    expect(isPullOnlyFeed(occurrence)).toBe(true);
  });

  it("so switching the feed on mints NO children", () => {
    const { occurrence } = convert(boardOcc, boardModule, "graph");
    const r = runFeed(occurrence);
    // The mint is asserted FIRST: that is the damage. `bail` is the mechanism,
    // and a test that fails on the mechanism reads as a naming quibble.
    expect(r.creates).toBe(0);
    expect(r.bail).toBe("pull-only");
  });

  it("keeps the rest of meta — a chart is not the only thing stored there", () => {
    const withMeta = { ...boardOcc, meta: { x: 12, y: 40 } };
    const { occurrence } = convert(withMeta, boardModule, "graph");
    expect(occurrence.meta.x).toBe(12);
    expect(occurrence.meta.y).toBe(40);
  });

  it("CONTROL — converting BACK drops the chart, so the feed owns its rows again", () => {
    const { occurrence: asGraph, module: graphModule } = convert(boardOcc, boardModule, "graph");
    const { occurrence: backToBoard } = convert(asGraph, graphModule, "board");
    expect(isPullOnlyFeed(backToBoard)).toBe(false);
    expect(runFeed(backToBoard).creates).toBe(1);
  });

  it("CONTROL — an explicit materialize:false is still honoured on a board", () => {
    // The surface-agnostic opt-in must not be collateral damage of clearing
    // meta.graph on the way out.
    const occ = { ...boardOcc, feed: { enabled: true, roles: ["instance"], materialize: false } };
    expect(isPullOnlyFeed(occ)).toBe(true);
  });

  it("CONTROL — board → table is untouched by any of this", () => {
    const { module, occurrence } = convert(boardOcc, boardModule, "table");
    expect(module.kind).toBe("table");
    expect(occurrence.meta?.graph).toBeUndefined();
  });
});
