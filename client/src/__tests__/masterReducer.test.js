/**
 * masterReducer.test.js
 *
 * Tests every action type in masterReducer.js.
 * Focus: state.modules is the SINGLE source of truth for panels/containers/instances.
 * derived state.panels/containers/instances are always in sync with state.modules.
 */

import { describe, test, expect } from "vitest";
import { masterReducer } from "../state/masterReducer";
import { ActionTypes } from "../state/actions";

// ─── helpers ──────────────────────────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    userId: null,
    gridId: null,
    grid: null,
    modules: [],
    panels: [],
    containers: [],
    instances: [],
    occurrences: [],
    fields: [],
    manifests: [],
    views: [],
    folders: [],
    operations: [],
    computedValues: {},
    availableGrids: [],
    hydrated: false,
    ...overrides,
  };
}

function dispatch(state, type, payload) {
  return masterReducer(state, { type, payload });
}

// ─── FULL_STATE ───────────────────────────────────────────────────────────────
describe("FULL_STATE", () => {
  test("hydrates modules and derives role arrays", () => {
    const modules = [
      { id: "p1", role: "panel", label: "Schedule" },
      { id: "c1", role: "container", label: "Morning", occurrences: [] },
      { id: "i1", role: "instance", label: "Exercise" },
    ];
    const s = dispatch(makeState(), ActionTypes.FULL_STATE, {
      gridId: "g1",
      grid: { id: "g1" },
      modules,
      occurrences: [],
      fields: [],
    });

    expect(s.hydrated).toBe(true);
    expect(s.modules).toHaveLength(3);
    expect(s.panels).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
    expect(s.panels[0].id).toBe("p1");
    expect(s.containers[0].id).toBe("c1");
    expect(s.instances[0].id).toBe("i1");
  });

  test("resets computedValues on re-hydrate", () => {
    const s0 = makeState({ computedValues: { field1: 42 } });
    const s = dispatch(s0, ActionTypes.FULL_STATE, { modules: [] });
    expect(s.computedValues).toEqual({});
  });
});

// ─── PANELS ───────────────────────────────────────────────────────────────────
describe("Panels — via state.modules", () => {
  test("CREATE_MODULE adds panel to modules and derives panels array", () => {
    const panel = { id: "p1", role: "panel", label: "Goals" };
    const s = dispatch(makeState(), ActionTypes.CREATE_MODULE, { module: { ...panel, role: "panel" } });
    expect(s.modules).toHaveLength(1);
    expect(s.panels).toHaveLength(1);
    expect(s.panels[0].label).toBe("Goals");
  });

  test("UPDATE_MODULE patches panel in modules and re-derives", () => {
    const s0 = makeState({
      modules: [{ id: "p1", role: "panel", label: "Old" }],
      panels: [{ id: "p1", role: "panel", label: "Old" }],
    });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, { module: { id: "p1", label: "New" } });
    expect(s.panels[0].label).toBe("New");
    expect(s.modules[0].label).toBe("New");
  });

  test("UPDATE_MODULE upserts panel if not in modules", () => {
    const s = dispatch(makeState(), ActionTypes.UPDATE_MODULE, {
      module: { id: "p99", role: "panel", label: "New Panel" },
    });
    expect(s.modules).toHaveLength(1);
    expect(s.panels).toHaveLength(1);
  });

  test("DELETE_MODULE removes panel from modules and re-derives", () => {
    const s0 = makeState({
      modules: [
        { id: "p1", role: "panel", label: "Keep" },
        { id: "p2", role: "panel", label: "Delete Me" },
      ],
    });
    const s = dispatch(s0, ActionTypes.DELETE_MODULE, { moduleId: "p2" });
    expect(s.modules).toHaveLength(1);
    expect(s.panels).toHaveLength(1);
    expect(s.panels[0].id).toBe("p1");
  });

  test("Panel drag: moving panel updates state.modules immediately", () => {
    const s0 = makeState({
      modules: [{ id: "p1", role: "panel", label: "Panel", layout: { col: 0 } }],
    });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, {
      module: { id: "p1", layout: { col: 2 } },
    });
    expect(s.panels[0].layout.col).toBe(2);
    expect(s.modules[0].layout.col).toBe(2);
  });
});

// ─── CONTAINERS ───────────────────────────────────────────────────────────────
describe("Containers — via state.modules", () => {
  test("CREATE_MODULE adds container to modules and derives containers array", () => {
    const container = { id: "c1", role: "container", label: "Todo", occurrences: [] };
    const s = dispatch(makeState(), ActionTypes.CREATE_MODULE, { module: { ...container, role: "container" } });
    expect(s.modules).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
    expect(s.containers[0].label).toBe("Todo");
  });

  test("CREATE_MODULE is idempotent (no duplicates) for containers", () => {
    const s0 = makeState({ modules: [{ id: "c1", role: "container", label: "Existing" }] });
    const s = dispatch(s0, ActionTypes.CREATE_MODULE, { module: { id: "c1", role: "container", label: "Dupe" } });
    expect(s.modules).toHaveLength(1);
  });

  test("UPDATE_MODULE patches container in modules and re-derives", () => {
    const s0 = makeState({
      modules: [{ id: "c1", role: "container", label: "Old", occurrences: [] }],
    });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, {
      module: { id: "c1", label: "Updated" },
    });
    expect(s.containers[0].label).toBe("Updated");
    expect(s.modules[0].label).toBe("Updated");
  });

  test("UPDATE_MODULE upserts container if not in modules", () => {
    const s = dispatch(makeState(), ActionTypes.UPDATE_MODULE, {
      module: { id: "c99", role: "container", label: "New Container" },
    });
    expect(s.modules).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
  });

  test("UPDATE_MODULE updates occurrences list in modules for container", () => {
    const s0 = makeState({
      modules: [{ id: "c1", role: "container", occurrences: ["occ1"] }],
    });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, {
      module: { id: "c1", occurrences: ["occ1", "occ2", "occ3"] },
    });
    expect(s.containers[0].occurrences).toEqual(["occ1", "occ2", "occ3"]);
    expect(s.modules[0].occurrences).toEqual(["occ1", "occ2", "occ3"]);
  });

  test("DELETE_MODULE removes container from modules and re-derives", () => {
    const s0 = makeState({
      modules: [
        { id: "c1", role: "container", label: "Keep" },
        { id: "c2", role: "container", label: "Delete" },
      ],
    });
    const s = dispatch(s0, ActionTypes.DELETE_MODULE, { moduleId: "c2" });
    expect(s.modules).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
    expect(s.containers[0].id).toBe("c1");
  });

  test("Container add does not affect panels or instances in modules", () => {
    const s0 = makeState({
      modules: [
        { id: "p1", role: "panel" },
        { id: "i1", role: "instance" },
      ],
    });
    const s = dispatch(s0, ActionTypes.CREATE_MODULE, {
      module: { id: "c1", role: "container", label: "New" },
    });
    expect(s.panels).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
  });
});

// ─── INSTANCES ────────────────────────────────────────────────────────────────
describe("Instances — via state.modules", () => {
  test("CREATE_MODULE adds instance to modules and derives instances array", () => {
    const s = dispatch(makeState(), ActionTypes.CREATE_MODULE, {
      module: { id: "i1", role: "instance", label: "Exercise" },
    });
    expect(s.modules).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
    expect(s.instances[0].label).toBe("Exercise");
  });

  test("CREATE_MODULE is idempotent for instances", () => {
    const s0 = makeState({ modules: [{ id: "i1", role: "instance", label: "Existing" }] });
    const s = dispatch(s0, ActionTypes.CREATE_MODULE, {
      module: { id: "i1", role: "instance", label: "Dupe" },
    });
    expect(s.modules).toHaveLength(1);
  });

  test("CREATE_MODULE adds instance to modules (in-container variant)", () => {
    const s = dispatch(makeState(), ActionTypes.CREATE_MODULE, {
      module: { id: "i1", role: "instance", label: "Task" },
    });
    expect(s.modules).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
    expect(s.instances[0].id).toBe("i1");
  });

  test("UPDATE_MODULE patches instance in modules", () => {
    const s0 = makeState({
      modules: [{ id: "i1", role: "instance", label: "Old" }],
    });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, {
      module: { id: "i1", label: "Updated" },
    });
    expect(s.instances[0].label).toBe("Updated");
    expect(s.modules[0].label).toBe("Updated");
  });

  test("UPDATE_MODULE upserts instance if not in modules", () => {
    const s = dispatch(makeState(), ActionTypes.UPDATE_MODULE, {
      module: { id: "i99", role: "instance", label: "New" },
    });
    expect(s.instances).toHaveLength(1);
  });

  test("DELETE_MODULE removes instance from modules", () => {
    const s0 = makeState({
      modules: [
        { id: "i1", role: "instance", label: "Keep" },
        { id: "i2", role: "instance", label: "Delete" },
      ],
    });
    const s = dispatch(s0, ActionTypes.DELETE_MODULE, { moduleId: "i2" });
    expect(s.instances).toHaveLength(1);
    expect(s.instances[0].id).toBe("i1");
    expect(s.modules).toHaveLength(1);
  });
});

// ─── MODULES (unified) ───────────────────────────────────────────────────────
describe("CREATE_MODULE / UPDATE_MODULE / DELETE_MODULE", () => {
  test("CREATE_MODULE adds to modules and derives role arrays", () => {
    const s = dispatch(makeState(), ActionTypes.CREATE_MODULE, {
      module: { id: "m1", role: "panel", label: "New Panel" },
    });
    expect(s.modules).toHaveLength(1);
    expect(s.panels).toHaveLength(1);
  });

  test("UPDATE_MODULE patches existing module", () => {
    const s0 = makeState({ modules: [{ id: "m1", role: "container", label: "Old" }] });
    const s = dispatch(s0, ActionTypes.UPDATE_MODULE, {
      module: { id: "m1", label: "Patched" },
    });
    expect(s.containers[0].label).toBe("Patched");
  });

  test("DELETE_MODULE removes from modules", () => {
    const s0 = makeState({ modules: [{ id: "m1", role: "instance" }, { id: "m2", role: "panel" }] });
    const s = dispatch(s0, ActionTypes.DELETE_MODULE, { moduleId: "m1" });
    expect(s.modules).toHaveLength(1);
    expect(s.modules[0].id).toBe("m2");
  });
});

// ─── OCCURRENCES ─────────────────────────────────────────────────────────────
describe("Occurrences", () => {
  test("CREATE_OCCURRENCE adds occurrence", () => {
    const occ = { id: "occ1", targetType: "module", targetId: "p1" };
    const s = dispatch(makeState(), ActionTypes.CREATE_OCCURRENCE, { occurrence: occ });
    expect(s.occurrences).toHaveLength(1);
    expect(s.occurrences[0].id).toBe("occ1");
  });

  test("UPDATE_OCCURRENCE patches occurrence", () => {
    const s0 = makeState({ occurrences: [{ id: "occ1", fields: {} }] });
    const s = dispatch(s0, ActionTypes.UPDATE_OCCURRENCE, {
      occurrence: { id: "occ1", fields: { field1: { value: 42, flow: "in" } } },
    });
    expect(s.occurrences[0].fields.field1.value).toBe(42);
  });

  test("UPDATE_OCCURRENCE upserts if not found", () => {
    const s = dispatch(makeState(), ActionTypes.UPDATE_OCCURRENCE, {
      occurrence: { id: "occ99", targetType: "module" },
    });
    expect(s.occurrences).toHaveLength(1);
  });

  test("DELETE_OCCURRENCE removes occurrence", () => {
    const s0 = makeState({ occurrences: [{ id: "occ1" }, { id: "occ2" }] });
    const s = dispatch(s0, ActionTypes.DELETE_OCCURRENCE, { occurrenceId: "occ1" });
    expect(s.occurrences).toHaveLength(1);
    expect(s.occurrences[0].id).toBe("occ2");
  });
});

// ─── FIELDS ──────────────────────────────────────────────────────────────────
describe("Fields", () => {
  test("CREATE_FIELD adds field", () => {
    const field = { id: "f1", name: "Duration", type: "duration" };
    const s = dispatch(makeState(), ActionTypes.CREATE_FIELD, { field });
    expect(s.fields).toHaveLength(1);
  });

  test("UPDATE_FIELD patches field", () => {
    const s0 = makeState({ fields: [{ id: "f1", name: "Old" }] });
    const s = dispatch(s0, ActionTypes.UPDATE_FIELD, { field: { id: "f1", name: "New" } });
    expect(s.fields[0].name).toBe("New");
  });

  test("DELETE_FIELD removes field", () => {
    const s0 = makeState({ fields: [{ id: "f1" }, { id: "f2" }] });
    const s = dispatch(s0, ActionTypes.DELETE_FIELD, { fieldId: "f1" });
    expect(s.fields).toHaveLength(1);
    expect(s.fields[0].id).toBe("f2");
  });
});

// ─── OPERATIONS ──────────────────────────────────────────────────────────────
describe("Operations", () => {
  test("CREATE_OPERATION adds operation", () => {
    const op = { id: "op1", name: "Budget Alert" };
    const s = dispatch(makeState(), ActionTypes.CREATE_OPERATION, { operation: op });
    expect(s.operations).toHaveLength(1);
  });

  test("UPDATE_OPERATION patches operation", () => {
    const s0 = makeState({ operations: [{ id: "op1", name: "Old" }] });
    const s = dispatch(s0, ActionTypes.UPDATE_OPERATION, { operation: { id: "op1", name: "New" } });
    expect(s.operations[0].name).toBe("New");
  });

  test("DELETE_OPERATION removes operation", () => {
    const s0 = makeState({ operations: [{ id: "op1" }, { id: "op2" }] });
    const s = dispatch(s0, ActionTypes.DELETE_OPERATION, { operationId: "op1" });
    expect(s.operations).toHaveLength(1);
  });
});

// ─── COMPUTED VALUES ─────────────────────────────────────────────────────────
describe("Computed Values", () => {
  test("SET_COMPUTED_VALUES merges values by fieldId", () => {
    const s = dispatch(makeState(), ActionTypes.SET_COMPUTED_VALUES, {
      updates: [
        { fieldId: "f1", value: 100 },
        { fieldId: "f2", occurrenceId: "occ1", value: 42 },
      ],
    });
    expect(s.computedValues["f1"]).toEqual({ value: 100, target: null, color: null, icon: null, suffix: null, replaceValue: null });
    expect(s.computedValues["f2:occ1"]).toEqual({ value: 42, target: null, color: null, icon: null, suffix: null, replaceValue: null });
  });

  test("SET_COMPUTED_VALUES stores target alongside value", () => {
    const s = dispatch(makeState(), ActionTypes.SET_COMPUTED_VALUES, {
      updates: [{ fieldId: "f1", value: 7500, target: { value: 10000, period: "daily" } }],
    });
    expect(s.computedValues["f1"]).toEqual({ value: 7500, target: { value: 10000, period: "daily" }, color: null, icon: null, suffix: null, replaceValue: null });
  });

  test("SET_COMPUTED_VALUES merges without wiping existing values", () => {
    const s0 = makeState({ computedValues: { f1: { value: 99, target: null } } });
    const s = dispatch(s0, ActionTypes.SET_COMPUTED_VALUES, {
      updates: [{ fieldId: "f2", value: 50 }],
    });
    expect(s.computedValues["f1"]).toEqual({ value: 99, target: null });
    expect(s.computedValues["f2"]).toEqual({ value: 50, target: null, color: null, icon: null, suffix: null, replaceValue: null });
  });
});

// ─── GRID ─────────────────────────────────────────────────────────────────────
describe("Grid", () => {
  test("UPDATE_GRID patches current grid", () => {
    const s0 = makeState({
      gridId: "g1",
      grid: { id: "g1", cols: 3 },
    });
    const s = dispatch(s0, ActionTypes.UPDATE_GRID, {
      gridId: "g1",
      grid: { cols: 4 },
    });
    expect(s.grid.cols).toBe(4);
  });

  test("DELETE_GRID clears grid data", () => {
    const s0 = makeState({ gridId: "g1", grid: { id: "g1" } });
    const s = dispatch(s0, ActionTypes.DELETE_GRID, { gridId: "g1" });
    expect(s.grid).toBeNull();
    expect(s.gridId).toBeNull();
  });
});

// ─── LOGOUT ──────────────────────────────────────────────────────────────────
describe("Logout", () => {
  test("LOGOUT clears all user data", () => {
    const s0 = makeState({
      userId: "u1",
      gridId: "g1",
      modules: [{ id: "p1", role: "panel" }],
      occurrences: [{ id: "occ1" }],
      computedValues: { f1: 99 },
      hydrated: true,
    });
    const s = dispatch(s0, ActionTypes.LOGOUT, null);
    expect(s.userId).toBeNull();
    expect(s.gridId).toBeNull();
    expect(s.modules).toEqual([]);
    expect(s.occurrences).toEqual([]);
    expect(s.computedValues).toEqual({});
    expect(s.hydrated).toBe(false);
  });
});

// ─── MIXED STATE: modules always stay consistent ───────────────────────────
describe("Mixed state: modules always consistent with derived arrays", () => {
  test("panel + container + instance coexist in modules array", () => {
    let s = makeState();
    s = dispatch(s, ActionTypes.CREATE_MODULE, { module: { id: "p1", role: "panel", label: "Schedule" } });
    s = dispatch(s, ActionTypes.CREATE_MODULE, { module: { id: "c1", role: "container", label: "Morning" } });
    s = dispatch(s, ActionTypes.CREATE_MODULE, { module: { id: "i1", role: "instance", label: "Exercise" } });

    expect(s.modules).toHaveLength(3);
    expect(s.panels).toHaveLength(1);
    expect(s.containers).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
  });

  test("deleting a container does not affect panels or instances", () => {
    let s = makeState({
      modules: [
        { id: "p1", role: "panel" },
        { id: "c1", role: "container" },
        { id: "i1", role: "instance" },
      ],
    });
    s = dispatch(s, ActionTypes.DELETE_MODULE, { moduleId: "c1" });
    expect(s.panels).toHaveLength(1);
    expect(s.containers).toHaveLength(0);
    expect(s.instances).toHaveLength(1);
  });
});

// ─── Doc container / doc instance loading (FULL_STATE) ────────────────────────
describe("Doc containers and instances load from FULL_STATE", () => {
  const textmap = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Verse 1" }] },
      { type: "paragraph", content: [{ type: "text", text: "Sample lyrics" }] },
    ],
  };

  test("FULL_STATE hydrates doc-kind containers with occurrences list", () => {
    const s = dispatch(makeState(), ActionTypes.FULL_STATE, {
      modules: [
        { id: "p1", role: "panel", label: "Notebook", kind: "board" },
        { id: "c1", role: "container", label: "Verse 1", kind: "doc" },
        { id: "c2", role: "container", label: "Chorus", kind: "doc" },
      ],
      occurrences: [
        { id: "oc1", targetId: "c1", parentId: "p1", textmap },
        { id: "oc2", targetId: "c2", parentId: "p1", textmap },
      ],
    });

    expect(s.containers).toHaveLength(2);
    expect(s.containers[0].kind).toBe("doc");
    expect(s.occurrences).toHaveLength(2);
    // Occurrence textmap preserved
    expect(s.occurrences[0].textmap.type).toBe("doc");
  });

  test("FULL_STATE hydrates doc-kind instances with occurrences", () => {
    const s = dispatch(makeState(), ActionTypes.FULL_STATE, {
      modules: [
        { id: "p1", role: "panel", label: "Notebook", kind: "board" },
        { id: "c1", role: "container", label: "Journal", kind: "doc" },
        { id: "i1", role: "instance", label: "What Went Well?", kind: "doc", fieldBindings: [{ fieldId: "f1", role: "input" }] },
      ],
      occurrences: [
        { id: "oi1", targetId: "i1", parentId: "c1", textmap: { type: "doc", content: [] } },
        { id: "oc1", targetId: "c1", parentId: "p1", textmap },
      ],
    });

    expect(s.instances).toHaveLength(1);
    expect(s.instances[0].kind).toBe("doc");
    expect(s.occurrences).toHaveLength(2);
  });

  test("FULL_STATE preserves notebook panel with doc containers in panels list", () => {
    const s = dispatch(makeState(), ActionTypes.FULL_STATE, {
      modules: [
        { id: "p_notebook", role: "panel", label: "Notebook", kind: "board" },
        { id: "p_schedule", role: "panel", label: "Schedule", kind: "list" },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `c_stan_${i}`, role: "container", label: `Stan Stanza ${i + 1}`, kind: "doc",
        })),
      ],
      occurrences: Array.from({ length: 5 }, (_, i) => ({
        id: `occ_stan_${i}`, targetId: `c_stan_${i}`, parentId: "p_notebook", textmap,
      })),
    });

    expect(s.panels).toHaveLength(2);
    expect(s.containers).toHaveLength(5);
    // All containers are doc kind
    expect(s.containers.every(c => c.kind === "doc")).toBe(true);
    // All occurrences loaded
    expect(s.occurrences).toHaveLength(5);
  });

  test("occurrence textmap survives UPDATE_OCCURRENCE round-trip", () => {
    let s = dispatch(makeState(), ActionTypes.FULL_STATE, {
      modules: [{ id: "c1", role: "container", label: "Notes", kind: "doc" }],
      occurrences: [{ id: "oc1", targetId: "c1", textmap }],
    });

    const updatedDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }] };
    s = dispatch(s, ActionTypes.UPDATE_OCCURRENCE, { occurrence: { id: "oc1", targetId: "c1", textmap: updatedDoc } });

    const occ = s.occurrences.find(o => o.id === "oc1");
    expect(occ.textmap.content[0].content[0].text).toBe("Updated");
  });
});

// ─── Full example-data scenario: all entity types loaded together ────────────
describe("Full example-data hydration (all entity types in one FULL_STATE)", () => {
  // Simulates the real app loading: panels, containers, instances, fields,
  // operations, and occurrences all arrive together in one FULL_STATE payload.
  function makeExampleState() {
    return dispatch(makeState(), ActionTypes.FULL_STATE, {
      gridId: "grid1",
      grid: { id: "grid1", cols: 3, rows: 2, occurrences: ["panelOcc1", "panelOcc2", "panelOcc3"] },
      modules: [
        // Panels
        { id: "panel_schedule", role: "panel", label: "Schedule", kind: "list" },
        { id: "panel_goals", role: "panel", label: "Goals", kind: "board" },
        { id: "panel_notebook", role: "panel", label: "Notebook", kind: "board" },
        // Containers
        { id: "slot_9am", role: "container", label: "9:00 AM", kind: "list", occurrences: ["instOcc1"] },
        { id: "goal_cont", role: "container", label: "Daily Goals", kind: "list", occurrences: ["instOcc2"] },
        { id: "doc_cont", role: "container", label: "Daily Journal", kind: "doc", occurrences: [] },
        // Instances
        { id: "workout_inst", role: "instance", label: "Morning Run",
          fieldBindings: [{ fieldId: "f_duration", role: "input" }, { fieldId: "f_display", role: "display" }] },
        { id: "goal_inst", role: "instance", label: "Duration Goal",
          fieldBindings: [{ fieldId: "f_display", role: "display" }] },
      ],
      occurrences: [
        { id: "panelOcc1", targetId: "panel_schedule", targetType: "module", gridId: "grid1",
          placement: { row: 0, col: 0 } },
        { id: "panelOcc2", targetId: "panel_goals", targetType: "module", gridId: "grid1",
          placement: { row: 0, col: 1 } },
        { id: "panelOcc3", targetId: "panel_notebook", targetType: "module", gridId: "grid1",
          placement: { row: 0, col: 2 } },
        { id: "contOcc1", targetId: "slot_9am", parentId: "panel_schedule" },
        { id: "contOcc2", targetId: "goal_cont", parentId: "panel_goals" },
        { id: "docContOcc", targetId: "doc_cont", parentId: "panel_notebook",
          textmap: { type: "doc", content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Today" }] },
          ]}},
        { id: "instOcc1", targetId: "workout_inst", parentId: "slot_9am",
          fields: { f_duration: { value: 30, flow: "in" } } },
        { id: "instOcc2", targetId: "goal_inst", parentId: "goal_cont" },
      ],
      fields: [
        { id: "f_duration", name: "Duration", fieldType: "number", inputEnabled: true, displayEnabled: false },
        { id: "f_display", name: "Total Duration", fieldType: "number", inputEnabled: false, displayEnabled: true,
          displayConfig: { targetValue: 60, targetPeriod: "daily" } },
      ],
      operations: [
        { id: "op_sum", name: "Sum Duration", enabled: true, triggerType: "onIteration",
          pipeline: {
            sources: [],
            steps: [
              { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
              { id: "s2", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f_display",
                  sourceExpr: "$total", targetValue: 60, targetPeriod: "daily" } },
            ],
          },
        },
      ],
    });
  }

  test("panels load correctly — 3 panels in state", () => {
    const s = makeExampleState();
    expect(s.panels).toHaveLength(3);
    expect(s.panels.map(p => p.label)).toContain("Schedule");
    expect(s.panels.map(p => p.label)).toContain("Goals");
    expect(s.panels.map(p => p.label)).toContain("Notebook");
  });

  test("containers load correctly — including doc-kind container", () => {
    const s = makeExampleState();
    expect(s.containers).toHaveLength(3);
    const docCont = s.containers.find(c => c.kind === "doc");
    expect(docCont).toBeTruthy();
    expect(docCont.label).toBe("Daily Journal");
  });

  test("instances load correctly — fieldBindings preserved", () => {
    const s = makeExampleState();
    expect(s.instances).toHaveLength(2);
    const workout = s.instances.find(i => i.id === "workout_inst");
    expect(workout.fieldBindings).toHaveLength(2);
    expect(workout.fieldBindings[0].fieldId).toBe("f_duration");
  });

  test("occurrences load with field values and textmap", () => {
    const s = makeExampleState();
    expect(s.occurrences).toHaveLength(8);

    const instOcc = s.occurrences.find(o => o.id === "instOcc1");
    expect(instOcc.fields.f_duration.value).toBe(30);
    expect(instOcc.fields.f_duration.flow).toBe("in");

    const docOcc = s.occurrences.find(o => o.id === "docContOcc");
    expect(docOcc.textmap.type).toBe("doc");
    expect(docOcc.textmap.content[0].content[0].text).toBe("Today");
  });

  test("fields load correctly — inputEnabled / displayEnabled / displayConfig", () => {
    const s = makeExampleState();
    expect(s.fields).toHaveLength(2);
    const display = s.fields.find(f => f.id === "f_display");
    expect(display.displayEnabled).toBe(true);
    expect(display.displayConfig.targetValue).toBe(60);
    expect(display.displayConfig.targetPeriod).toBe("daily");
  });

  test("operations load correctly — pipeline structure preserved", () => {
    const s = makeExampleState();
    expect(s.operations).toHaveLength(1);
    const op = s.operations[0];
    expect(op.name).toBe("Sum Duration");
    expect(op.pipeline.steps).toHaveLength(2);
    expect(op.pipeline.steps[0].config.type).toBe("INIT_VAR");
    expect(op.pipeline.steps[1].config.targetFieldId).toBe("f_display");
  });

  test("SET_COMPUTED_VALUES after operation run updates computedValues for display field", () => {
    let s = makeExampleState();
    // Simulate operation run result being dispatched
    s = dispatch(s, ActionTypes.SET_COMPUTED_VALUES, {
      updates: [{ fieldId: "f_display", value: 30, target: { value: 60, period: "daily" } }],
    });
    expect(s.computedValues["f_display"]).toEqual({ value: 30, target: { value: 60, period: "daily" }, color: null, icon: null, suffix: null, replaceValue: null });
  });

  test("computedValues per-occurrence key: fieldId:occurrenceId", () => {
    let s = makeExampleState();
    s = dispatch(s, ActionTypes.SET_COMPUTED_VALUES, {
      updates: [
        { fieldId: "f_duration", occurrenceId: "instOcc1", value: 5 },
        { fieldId: "f_duration", occurrenceId: "instOcc2", value: 10 },
      ],
    });
    expect(s.computedValues["f_duration:instOcc1"]).toEqual({ value: 5, target: null, color: null, icon: null, suffix: null, replaceValue: null });
    expect(s.computedValues["f_duration:instOcc2"]).toEqual({ value: 10, target: null, color: null, icon: null, suffix: null, replaceValue: null });
  });

  test("FULL_STATE resets computedValues from previous run before re-hydrating", () => {
    let s = makeExampleState();
    s = dispatch(s, ActionTypes.SET_COMPUTED_VALUES, {
      updates: [{ fieldId: "f_display", value: 99 }],
    });
    expect(s.computedValues["f_display"].value).toBe(99);

    // Re-hydrate
    s = dispatch(s, ActionTypes.FULL_STATE, { modules: [], occurrences: [], fields: [], operations: [] });
    expect(s.computedValues).toEqual({});
  });

  test("modules array stays consistent with derived panels/containers/instances", () => {
    const s = makeExampleState();
    expect(s.modules).toHaveLength(8); // 3 panels + 3 containers + 2 instances
    const panelIds = s.panels.map(p => p.id);
    const containerIds = s.containers.map(c => c.id);
    const instanceIds = s.instances.map(i => i.id);
    // Every panel/container/instance is also in modules
    for (const id of [...panelIds, ...containerIds, ...instanceIds]) {
      expect(s.modules.some(m => m.id === id)).toBe(true);
    }
  });
});
