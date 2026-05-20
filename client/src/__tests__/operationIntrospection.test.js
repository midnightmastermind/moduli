// __tests__/operationIntrospection.test.js
// Covers analyzeOperation: per-action contribution to fields_written /
// fields_read / occurrences_written / occurrences_read, the trigger object
// + source contributions, the nested IF/LOOP descent, and the
// `operationsByName` resolution for RUN_OPERATION.
import { describe, it, expect } from "vitest";
import { analyzeOperation, analyzeAllOperations } from "../helpers/operationIntrospection";

const fieldsById = {
  f_date: { id: "f_date", name: "Date", type: "date" },
  f_cal:  { id: "f_cal",  name: "Calories", type: "number" },
  f_done: { id: "f_done", name: "Completed", type: "boolean" },
};

const occurrencesById = {
  occ_sched_page:  { id: "occ_sched_page",  moduleId: "mod_sched" },
  occ_slot_6am:    { id: "occ_slot_6am",    moduleId: "mod_slot" },
  occ_template_dr: { id: "occ_template_dr", moduleId: "mod_routine" },
};

const operationsById = {
  op_build_day: { id: "op_build_day", name: "Schedule: Build Day" },
  op_seed:     { id: "op_seed",      name: "Schedule: Seed Daily Routine" },
};

const operationsByName = {
  "Schedule: Build Day":            operationsById.op_build_day,
  "Schedule: Seed Daily Routine":   operationsById.op_seed,
};

const ctx = { fieldsById, occurrencesById, operationsById, operationsByName };

describe("analyzeOperation — trigger objects", () => {
  it("captures field-typed triggers in triggered_by_fields", () => {
    const op = {
      id: "op1",
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "f_done" },
      ],
      pipeline: { steps: [] },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.triggered_by_fields).toEqual(["f_done"]);
    expect(rec.triggered_by_occurrences).toEqual([]);
  });

  it("captures occurrence-shaped triggers in triggered_by_occurrences + ancestorLabel in ancestor_scopes", () => {
    const op = {
      id: "op2",
      triggerObjects: [
        { eventType: "onAdd", subjectType: "container", targetId: "occ_slot_6am", ancestorLabel: "Schedule" },
        { eventType: "onMove", subjectType: "page",     targetId: "occ_sched_page" },
      ],
      pipeline: { steps: [] },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.triggered_by_occurrences.sort()).toEqual(["occ_sched_page", "occ_slot_6am"]);
    expect(rec.ancestor_scopes).toEqual(["Schedule"]);
  });
});

describe("analyzeOperation — pipeline sources", () => {
  it("field sources → fields_read; occurrence sources → occurrences_read", () => {
    const op = {
      id: "op3",
      pipeline: {
        sources: [
          { variableName: "$d",     entityType: "field",       entityId: "f_date" },
          { variableName: "$sched", entityType: "page",        entityId: "occ_sched_page" },
          { variableName: "$all",   entityType: "allOccurrences" },
        ],
        steps: [],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_read).toEqual(["f_date"]);
    expect(rec.occurrences_read).toEqual(["occ_sched_page"]);
  });
});

describe("analyzeOperation — CREATE / UPDATE / DELETE actions", () => {
  it("CREATE: cfg.fields keys → fields_written; cfg.parent → occurrences_read; role:kind → created_modules", () => {
    const op = {
      id: "op4",
      pipeline: {
        steps: [
          {
            type: "action",
            config: {
              type: "CREATE",
              role: "instance",
              kind: "list",
              parent: "occ_slot_6am",
              fields: { f_date: "$today", f_done: false },
            },
          },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_written.sort()).toEqual(["f_date", "f_done"]);
    expect(rec.occurrences_read).toEqual(["occ_slot_6am"]);
    expect(rec.created_modules).toEqual(["instance:list"]);
  });

  it("UPDATE: cfg.fieldId → fields_written; cfg.itemId → occurrences_written", () => {
    const op = {
      id: "op5",
      pipeline: {
        steps: [
          {
            type: "action",
            config: { type: "UPDATE", itemId: "occ_slot_6am", fieldId: "f_done", value: true },
          },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_written).toEqual(["f_done"]);
    expect(rec.occurrences_written).toEqual(["occ_slot_6am"]);
  });

  it("DELETE: cfg.itemId → occurrences_written", () => {
    const op = {
      id: "op6",
      pipeline: {
        steps: [
          { type: "action", config: { type: "DELETE_ITEM", itemId: "occ_slot_6am" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.occurrences_written).toEqual(["occ_slot_6am"]);
  });
});

describe("analyzeOperation — APPLY_TEMPLATE + RUN_OPERATION", () => {
  it("APPLY_TEMPLATE: cfg.templateOccurrenceId → templates_used; cfg.targetOccurrenceId → occurrences_written", () => {
    const op = {
      id: "op7",
      pipeline: {
        steps: [
          {
            type: "action",
            config: {
              type: "APPLY_TEMPLATE",
              templateOccurrenceId: "occ_template_dr",
              targetOccurrenceId: "occ_sched_page",
            },
          },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.templates_used).toEqual(["occ_template_dr"]);
    expect(rec.occurrences_written).toEqual(["occ_sched_page"]);
  });

  it("RUN_OPERATION: cfg.operationName resolved to opId via operationsByName", () => {
    const op = {
      id: "op8",
      pipeline: {
        steps: [
          { type: "action", config: { type: "RUN_OPERATION", operationName: "Schedule: Build Day" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.invokes_operations).toEqual(["op_build_day"]);
  });

  it("RUN_OPERATION: cfg.operationId honored directly", () => {
    const op = {
      id: "op9",
      pipeline: {
        steps: [
          { type: "action", config: { type: "RUN_OPERATION", operationId: "op_seed" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.invokes_operations).toEqual(["op_seed"]);
  });
});

describe("analyzeOperation — nested IF / LOOP descent", () => {
  it("walks IF then + else for field/occurrence references", () => {
    const op = {
      id: "op10",
      pipeline: {
        steps: [
          {
            type: "if",
            condition: { operator: "AND", rules: [{ left: "$item.fields.f_done.value", comparator: "IS", right: true }] },
            then: [
              { type: "action", config: { type: "UPDATE", itemId: "occ_slot_6am", fieldId: "f_cal", value: 100 } },
            ],
            else: [
              { type: "action", config: { type: "DELETE_ITEM", itemId: "occ_sched_page" } },
            ],
          },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_written).toEqual(["f_cal"]);
    expect(rec.fields_read).toEqual(["f_done"]);
    expect(rec.occurrences_written.sort()).toEqual(["occ_sched_page", "occ_slot_6am"]);
  });

  it("walks LOOP body for actions", () => {
    const op = {
      id: "op11",
      pipeline: {
        steps: [
          {
            type: "loop",
            overExpr: "$allInstances",
            as: "$it",
            body: [
              { type: "action", config: { type: "UPDATE", fieldId: "f_done", value: true } },
            ],
          },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_written).toEqual(["f_done"]);
  });
});

describe("analyzeOperation — generic string scanning", () => {
  it("captures field:<id> tokens inside arbitrary string config", () => {
    const op = {
      id: "op12",
      pipeline: {
        steps: [
          { type: "action", config: { type: "INIT_VAR", name: "$x", expr: "field:f_cal" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_read).toEqual(["f_cal"]);
  });

  it("captures $var.fields.<fid> patterns inside expressions", () => {
    const op = {
      id: "op13",
      pipeline: {
        steps: [
          { type: "action", config: { type: "INIT_VAR", name: "$x", expr: "$item.fields.f_date.value" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_read).toEqual(["f_date"]);
  });

  it("drops fieldIds not present in fieldsById (no false positives)", () => {
    const op = {
      id: "op14",
      pipeline: {
        steps: [
          { type: "action", config: { type: "INIT_VAR", name: "$x", expr: "field:f_doesnt_exist" } },
        ],
      },
    };
    const rec = analyzeOperation(op, ctx);
    expect(rec.fields_read).toEqual([]);
  });
});

describe("analyzeAllOperations — memoization", () => {
  it("returns same record object across calls when op identity is stable", () => {
    const op = {
      id: "op15",
      pipeline: { steps: [{ type: "action", config: { type: "UPDATE", fieldId: "f_done" } }] },
    };
    const opsById = { op15: op };
    const first  = analyzeAllOperations(opsById, ctx);
    const second = analyzeAllOperations(opsById, ctx);
    // Same object reference — memoized via WeakMap on the op object.
    expect(first.op15).toBe(second.op15);
  });
});
