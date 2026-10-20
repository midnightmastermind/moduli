// UI sweep 2026-10-19, every chart type over poms' real data: an occurrence category field named
// every slice by an id (412 of 474 books), and rows sharing a category value were drawn one by one
// (a pie of 474 "book" slices) or dropped (a bar kept 1 of 472).
import { describe, it, expect } from "vitest";
import { buildGraphData } from "../helpers/graphData";

const fieldsById = { author: { id: "author", type: "occurrence" }, cat: { id: "cat", type: "select" }, mins: { id: "mins", type: "number" }, done: { id: "done", type: "boolean" } };
const modulesById = { mA: { id: "mA", label: "Author" }, mB: { id: "mB", label: "Book" } };
const occurrencesById = {
  watts: { id: "watts", moduleId: "mA", label: "Alan Watts" },
  jung: { id: "jung", moduleId: "mA", label: "Carl Jung" },
  b1: { id: "b1", moduleId: "mB", label: "Tao", fields: { author: { value: ["watts"] }, cat: { value: ["book"] }, mins: { value: 30 }, done: { value: true } } },
  b2: { id: "b2", moduleId: "mB", label: "Zen", fields: { author: { value: ["watts"] }, cat: { value: ["book"] }, mins: { value: 15 }, done: { value: false } } },
  b3: { id: "b3", moduleId: "mB", label: "Man", fields: { author: { value: "jung" }, cat: { value: ["book"] }, mins: { value: 10 }, done: { value: true } } },
};
const graph = (encoding) => ({ id: "g", meta: { graph: { type: "bar", encoding } } });
const run = (encoding) => buildGraphData(graph(encoding), { occurrencesById, modulesById, fieldsById, rows: ["b1", "b2", "b3"] }).nodes;

describe("a category field", () => {
  it("names a row by the occurrence it references, not its id", () => {
    expect(run({ category: "author" }).map((n) => n.name)).toEqual(["Alan Watts", "Carl Jung"]);
  });
  it("combines rows that share a value: a count without a value field", () => {
    const nodes = run({ category: "author" });
    expect(nodes.map((n) => n.value)).toEqual([2, 1]);
    expect(nodes[0].occurrenceId).toBe(null);
    expect(nodes[0].occurrenceIds).toEqual(["b1", "b2"]);
    expect(nodes[1].occurrenceId).toBe("b3"); // a single row still opens
  });
  it("and the sum of the value field with one", () => {
    expect(run({ category: "cat", value: "mins" }).map((n) => [n.name, n.value])).toEqual([["book", 55]]);
  });
  it("keeps series apart", () => {
    expect(run({ category: "author", value: "mins", series: "done" }).map((n) => [n.name, n.series, n.value]))
      .toEqual([["Alan Watts", "true", 30], ["Alan Watts", "false", 15], ["Carl Jung", "true", 10]]);
  });
  it("a graph named by LABEL keeps one node per row", () => {
    expect(run({ value: "mins" }).map((n) => n.name)).toEqual(["Tao", "Zen", "Man"]);
  });
});
