// helpers/graphData — a graph's data rows are its CHILD OCCURRENCES.
//
// That is the idea the whole graph architecture rests on: a FEED already
// materializes its matches as children, a DRAG already adds one, so "query" and
// "drag occurrences in" stop being two features. Only hardcoded literals are new.
//
// These tests are the contract for turning those children into chart data, with
// no React and no charting library involved.
import { describe, it, expect } from "vitest";
import { buildGraphData } from "../helpers/graphData";

const F_VALUE = "f-intensity";
const F_CATEGORY = "f-name";
const F_SERIES = "f-week";

// A graph occurrence: `meta.graph` is the SPEC, `occurrences[]` is the DATA.
function graph(encoding, childIds = [], extra = {}) {
  return {
    id: "g1", moduleId: "m-graph", occurrences: childIds,
    meta: { graph: { type: "pie", encoding, ...extra } },
  };
}
function child(id, label, fields = {}, occurrences = []) {
  return { id, moduleId: `m-${id}`, label, fields, occurrences };
}
function ctxOf(occs, mods = []) {
  const occurrencesById = {}; for (const o of occs) occurrencesById[o.id] = o;
  const modulesById = { "m-graph": { id: "m-graph", role: "container", kind: "graph" } };
  for (const m of mods) modulesById[m.id] = m;
  for (const o of occs) if (!modulesById[o.moduleId]) modulesById[o.moduleId] = { id: o.moduleId, role: "instance" };
  return { occurrencesById, modulesById, fieldsById: {} };
}

describe("buildGraphData — categories", () => {
  it("uses the occurrence LABEL as the category when none is configured", () => {
    const kids = [child("a", "Angry", { [F_VALUE]: { value: 8 } }), child("b", "Sad", { [F_VALUE]: { value: 3 } })];
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a", "b"]), ctxOf(kids));
    expect(nodes.map(n => n.name)).toEqual(["Angry", "Sad"]);
    expect(nodes.map(n => n.value)).toEqual([8, 3]);
  });

  it("uses a FIELD as the category when configured", () => {
    const kids = [child("a", "row one", { [F_VALUE]: { value: 5 }, [F_CATEGORY]: { value: "Frustrated" } })];
    const { nodes } = buildGraphData(graph({ value: F_VALUE, category: F_CATEGORY }, ["a"]), ctxOf(kids));
    expect(nodes[0].name).toBe("Frustrated");
  });

  it("falls back to the MODULE label when the occurrence has none", () => {
    const kid = child("a", null, { [F_VALUE]: { value: 1 } });
    const ctx = ctxOf([kid], [{ id: "m-a", role: "instance", label: "Bench Press" }]);
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a"]), ctx);
    expect(nodes[0].name).toBe("Bench Press");
  });
});

describe("buildGraphData — values", () => {
  it("unwraps the {value, flow} shape AND accepts a bare value", () => {
    const kids = [
      child("a", "A", { [F_VALUE]: { value: 4, flow: "in" } }),
      child("b", "B", { [F_VALUE]: 6 }),
    ];
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a", "b"]), ctxOf(kids));
    expect(nodes.map(n => n.value)).toEqual([4, 6]);
  });

  it("coerces a numeric STRING (fields store what the input gave them)", () => {
    const kids = [child("a", "A", { [F_VALUE]: { value: "7" } })];
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a"]), ctxOf(kids));
    expect(nodes[0].value).toBe(7);
  });

  it("a child with NO value contributes 0 and RAISES A WARNING, never NaN", () => {
    const kids = [child("a", "A", {}), child("b", "B", { [F_VALUE]: { value: 2 } })];
    const { nodes, warnings } = buildGraphData(graph({ value: F_VALUE }, ["a", "b"]), ctxOf(kids));
    expect(nodes[0].value).toBe(0);
    expect(Number.isNaN(nodes[0].value)).toBe(false);
    expect(warnings.some(w => w.occurrenceId === "a")).toBe(true);
  });

  it("counts ROWS when no value field is configured (a bare tally is legitimate)", () => {
    const kids = [child("a", "A"), child("b", "B")];
    const { nodes } = buildGraphData(graph({}, ["a", "b"]), ctxOf(kids));
    expect(nodes.map(n => n.value)).toEqual([1, 1]);
  });
});

describe("buildGraphData — the three data sources are ONE mechanism", () => {
  it("a FEED copy and a hand-DRAGGED child are indistinguishable in the output", () => {
    // This equivalence IS the architecture: a feed materializes matches as
    // children, so the graph never learns where a row came from.
    const dragged = child("a", "Dragged", { [F_VALUE]: { value: 1 } });
    const fed = child("b", "Fed", { [F_VALUE]: { value: 2 } });
    fed.meta = { feedSourceId: "src-1" };
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a", "b"]), ctxOf([dragged, fed]));
    expect(nodes.map(n => n.name)).toEqual(["Dragged", "Fed"]);
    expect(nodes.every(n => n.occurrenceId)).toBe(true);
  });

  it("appends hardcoded LITERALS after the occurrence rows", () => {
    const kids = [child("a", "Real", { [F_VALUE]: { value: 5 } })];
    const g = graph({ value: F_VALUE }, ["a"], { literals: [{ name: "Target", value: 10 }] });
    const { nodes } = buildGraphData(g, ctxOf(kids));
    expect(nodes.map(n => n.name)).toEqual(["Real", "Target"]);
    expect(nodes[1].occurrenceId).toBe(null);
    expect(nodes[1].value).toBe(10);
  });

  it("renders literals ALONE when the graph has no children", () => {
    const g = graph({}, [], { literals: [{ name: "A", value: 1 }, { name: "B", value: 2 }] });
    const { nodes } = buildGraphData(g, ctxOf([]));
    expect(nodes.map(n => n.value)).toEqual([1, 2]);
  });
});

describe("buildGraphData — nesting (what makes a feeling wheel possible)", () => {
  it("nests by the OCCURRENCE TREE, so the wheel's levels are the grid's own structure", () => {
    const annoyed = child("c1", "Annoyed", { [F_VALUE]: { value: 1 } });
    const frustrated = child("b1", "Frustrated", {}, ["c1"]);
    const angry = child("a1", "Angry", {}, ["b1"]);
    const ctx = ctxOf([angry, frustrated, annoyed]);
    const g = graph({ value: F_VALUE, children: "occurrences" }, ["a1"]);
    const { nodes } = buildGraphData(g, ctx);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("Angry");
    expect(nodes[0].children[0].name).toBe("Frustrated");
    expect(nodes[0].children[0].children[0].name).toBe("Annoyed");
    // depth is what a sunburst renders as rings
    expect(nodes[0].depth).toBe(0);
    expect(nodes[0].children[0].children[0].depth).toBe(2);
    // every level resolves back to an occurrence — that is what makes a click actionable
    expect(nodes[0].children[0].children[0].occurrenceId).toBe("c1");
  });

  it("stays FLAT when nesting is not configured, even if children have children", () => {
    const inner = child("c1", "Inner", { [F_VALUE]: { value: 1 } });
    const outer = child("a1", "Outer", { [F_VALUE]: { value: 9 } }, ["c1"]);
    const { nodes } = buildGraphData(graph({ value: F_VALUE }, ["a1"]), ctxOf([outer, inner]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toEqual([]);
    expect(nodes[0].value).toBe(9);
  });

  it("survives a CYCLE in the occurrence tree instead of hanging", () => {
    const a = child("a1", "A", {}, ["b1"]);
    const b = child("b1", "B", {}, ["a1"]); // points back
    const g = graph({ value: F_VALUE, children: "occurrences" }, ["a1"]);
    const { nodes } = buildGraphData(g, ctxOf([a, b]));
    expect(nodes[0].name).toBe("A");
    expect(nodes[0].children[0].name).toBe("B");
    expect(nodes[0].children[0].children).toEqual([]);
  });
});

describe("buildGraphData — hierarchy from FIELDS (a flat board)", () => {
  // User 2026-08-06: "we can use fields to drive it. like what level is what.
  // since we should have some sort of hiarchy in the feelings board … its a
  // 3 layered wheel of feelings."
  //
  // This is what lets the Feelings board be FLAT — every feeling a sibling
  // occurrence tagged by fields, exactly like every other board on this grid —
  // while still drawing as a 3-ring wheel. The structure becomes data you edit
  // in the app instead of a nesting you have to drag.
  const F_PARENT = "f-parent";
  const F_LEVEL = "f-level";

  // A flat board: all rows are siblings; the tree lives in a field.
  function flatWheel() {
    const rows = [
      ["angry", "Angry", null, "core"],
      ["frustrated", "Frustrated", "angry", "secondary"],
      ["annoyed", "Annoyed", "frustrated", "tertiary"],
      ["happy", "Happy", null, "core"],
      ["content", "Content", "happy", "secondary"],
    ];
    const kids = rows.map(([id, label, parent, lvl]) =>
      child(id, label, {
        [F_VALUE]: { value: 1 },
        [F_LEVEL]: { value: lvl },
        ...(parent ? { [F_PARENT]: { value: parent } } : {}),
      })
    );
    return kids;
  }
  const flatGraph = (enc = {}) =>
    graph({ value: F_VALUE, parent: F_PARENT, ...enc }, ["angry", "frustrated", "annoyed", "happy", "content"]);

  it("builds the tree from a PARENT FIELD, not from nesting", () => {
    const { nodes } = buildGraphData(flatGraph(), ctxOf(flatWheel()));
    expect(nodes.map(n => n.name)).toEqual(["Angry", "Happy"]);          // only roots at top
    expect(nodes[0].children[0].name).toBe("Frustrated");
    expect(nodes[0].children[0].children[0].name).toBe("Annoyed");
    expect(nodes[1].children[0].name).toBe("Content");
  });

  it("derives DEPTH from the tree, so a sunburst gets its 3 rings", () => {
    const { nodes } = buildGraphData(flatGraph(), ctxOf(flatWheel()));
    expect(nodes[0].depth).toBe(0);
    expect(nodes[0].children[0].depth).toBe(1);
    expect(nodes[0].children[0].children[0].depth).toBe(2);
  });

  it("reports the row's own LEVEL field alongside the derived depth", () => {
    // Reported, not used: depth is what the chart renders, so a disagreement
    // between the two is a data problem worth being able to SEE.
    const { nodes } = buildGraphData(flatGraph({ level: F_LEVEL }), ctxOf(flatWheel()));
    expect(nodes[0].level).toBe("core");
    expect(nodes[0].children[0].level).toBe("secondary");
    expect(nodes[0].children[0].children[0].level).toBe("tertiary");
  });

  it("keeps every occurrence reachable — 5 flat rows become 5 nodes in the tree", () => {
    const { nodes } = buildGraphData(flatGraph(), ctxOf(flatWheel()));
    const count = (ns) => ns.reduce((a, n) => a + 1 + count(n.children), 0);
    expect(count(nodes)).toBe(5);
  });

  it("treats a row whose parent is NOT on this graph as a root", () => {
    // So a graph can show one branch of a bigger board without its rows
    // silently vanishing under an absent parent.
    const kids = flatWheel();
    const g = graph({ value: F_VALUE, parent: F_PARENT }, ["frustrated", "annoyed"]); // "angry" excluded
    const { nodes } = buildGraphData(g, ctxOf(kids));
    expect(nodes.map(n => n.name)).toEqual(["Frustrated"]);
    expect(nodes[0].children[0].name).toBe("Annoyed");
  });

  it("accepts a parent stored as a ONE-ELEMENT ARRAY (multi-select dropdown shape)", () => {
    const kids = [
      child("a", "Angry", { [F_VALUE]: { value: 1 } }),
      child("b", "Frustrated", { [F_VALUE]: { value: 1 }, [F_PARENT]: { value: ["a"] } }),
    ];
    const g = graph({ value: F_VALUE, parent: F_PARENT }, ["a", "b"]);
    const { nodes } = buildGraphData(g, ctxOf(kids));
    expect(nodes[0].children[0].name).toBe("Frustrated");
  });

  it("survives a CYCLE typed into the parent field by hand", () => {
    const kids = [
      child("a", "A", { [F_VALUE]: { value: 1 }, [F_PARENT]: { value: "b" } }),
      child("b", "B", { [F_VALUE]: { value: 1 }, [F_PARENT]: { value: "a" } }),
    ];
    const g = graph({ value: F_VALUE, parent: F_PARENT }, ["a", "b"]);
    const { nodes, warnings } = buildGraphData(g, ctxOf(kids));
    // no root exists, so nothing draws — but it must SAY so, not just be empty
    expect(nodes).toEqual([]);
    expect(warnings.some(w => /no root/i.test(w.why))).toBe(true);
  });

  it("ignores a row that names ITSELF as parent", () => {
    const kids = [child("a", "A", { [F_VALUE]: { value: 1 }, [F_PARENT]: { value: "a" } })];
    const g = graph({ value: F_VALUE, parent: F_PARENT }, ["a"]);
    const { nodes } = buildGraphData(g, ctxOf(kids));
    expect(nodes.map(n => n.name)).toEqual(["A"]);
  });

  it("still supports occurrence-tree nesting — the parent field is an ALTERNATIVE", () => {
    const inner = child("c1", "Inner", { [F_VALUE]: { value: 1 } });
    const outer = child("a1", "Outer", {}, ["c1"]);
    const g = graph({ value: F_VALUE, children: "occurrences" }, ["a1"]);
    const { nodes } = buildGraphData(g, ctxOf([outer, inner]));
    expect(nodes[0].children[0].name).toBe("Inner");
  });
});

describe("buildGraphData — robustness", () => {
  it("skips child ids that resolve to nothing rather than emitting holes", () => {
    const kids = [child("a", "A", { [F_VALUE]: { value: 1 } })];
    const { nodes, warnings } = buildGraphData(graph({ value: F_VALUE }, ["a", "gone"]), ctxOf(kids));
    expect(nodes).toHaveLength(1);
    expect(warnings.some(w => w.occurrenceId === "gone")).toBe(true);
  });

  it("splits into SERIES when a series field is configured", () => {
    const kids = [
      child("a", "Mon", { [F_VALUE]: { value: 1 }, [F_SERIES]: { value: "wk1" } }),
      child("b", "Tue", { [F_VALUE]: { value: 2 }, [F_SERIES]: { value: "wk2" } }),
    ];
    const g = graph({ value: F_VALUE, series: F_SERIES }, ["a", "b"]);
    const { nodes } = buildGraphData(g, ctxOf(kids));
    expect(nodes.map(n => n.series)).toEqual(["wk1", "wk2"]);
  });

  it("returns an empty result for a graph with no spec at all", () => {
    const bare = { id: "g1", moduleId: "m-graph", occurrences: [], meta: {} };
    const { nodes, warnings } = buildGraphData(bare, ctxOf([]));
    expect(nodes).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("never throws on null input", () => {
    expect(buildGraphData(null, ctxOf([])).nodes).toEqual([]);
    expect(buildGraphData(undefined, undefined).nodes).toEqual([]);
  });
});
