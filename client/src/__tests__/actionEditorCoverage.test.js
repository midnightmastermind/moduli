// __tests__/actionEditorCoverage.test.js
//
// Every action the picker offers must be CONFIGURABLE and must RUN.
//
// Measured 2026-08-18 on a grid built through the UI: of 70 picker actions, 2
// had no executor case (SET_FIELD_VALUE, LINK_OCCURRENCE_TO_PARENT — both
// silent no-ops) and 35 had no step editor, so choosing one rendered a step
// with nothing to configure. Both classes are invisible: every surface says
// the step is fine.
//
// The assertions are EMPTY-SET assertions on purpose — "nothing is missing",
// not "these 70 are present" — so adding a 71st action to the picker without
// wiring it fails here rather than shipping silent.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema";

const read = (rel) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

const pickerActions = [
  ...new Set([...read("ui/actionTree.js").matchAll(/\{\s*value:\s*"([A-Z_]+)"/g)].map(m => m[1])),
];
const executorCases = new Set(
  [...read("helpers/operationActions.js").matchAll(/case\s+"([A-Z_]+)"/g)].map(m => m[1]),
);
const builderCases = new Set(
  [...read("blocks/OperationsBuilder.jsx").matchAll(/case\s+"([A-Z_]+)"/g)].map(m => m[1]),
);

describe("action coverage", () => {
  // The control: the extraction works at all. A zero here would make every
  // assertion below vacuously true.
  it("finds the picker's actions", () => {
    expect(pickerActions.length).toBeGreaterThan(50);
    expect(pickerActions).toContain("SET_FIELD_VALUE");
  });

  it("every picker action has an executor case — no silent no-ops", () => {
    const missing = pickerActions.filter(a => !executorCases.has(a));
    expect(missing).toEqual([]);
  });

  it("every picker action is configurable — a hand-written editor or a declared shape", () => {
    const missing = pickerActions.filter(
      a => !builderCases.has(a) && !Object.prototype.hasOwnProperty.call(ACTION_CONFIG_SCHEMA, a),
    );
    expect(missing).toEqual([]);
  });

  it("no schema shadows a hand-written editor — one control per action", () => {
    const shadowed = Object.keys(ACTION_CONFIG_SCHEMA).filter(a => builderCases.has(a));
    expect(shadowed).toEqual([]);
  });

  it("every declared field names a key and a kind the renderer knows", () => {
    const KINDS = new Set(["var", "expr", "path", "text", "number", "select", "bool", "list"]);
    const bad = [];
    for (const [action, schema] of Object.entries(ACTION_CONFIG_SCHEMA)) {
      for (const f of schema.fields || []) {
        if (!f.key) bad.push(`${action}: field with no key`);
        if (!KINDS.has(f.kind)) bad.push(`${action}.${f.key}: unknown kind ${f.kind}`);
        if (f.kind === "select" && !f.options?.length) bad.push(`${action}.${f.key}: select with no options`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every declared key is one the executor actually reads", () => {
    // The schema is a claim about the executor. A key nothing reads is a
    // control that does nothing — the defect this whole pass is about, one
    // level up. Scoped to each action's own case body.
    const src = read("helpers/operationActions.js");
    const marks = [...src.matchAll(/case\s+"([A-Z_]+)":/g)].map(m => ({ name: m[1], at: m.index }));
    const bodyFor = (name) => {
      const hits = marks.filter(x => x.name === name);
      if (!hits.length) return "";
      const start = hits[hits.length - 1].at;
      const next = marks.filter(x => x.at > start).map(x => x.at).sort((a, b) => a - b)[0] ?? src.length;
      return src.slice(start, next);
    };
    // Actions that share one case body with earlier labels (SUM/MIN/MAX/AVG).
    const SHARED = { SUM_VAR: "AVG_VAR", MIN_VAR: "AVG_VAR", MAX_VAR: "AVG_VAR" };
    const bad = [];
    for (const [action, schema] of Object.entries(ACTION_CONFIG_SCHEMA)) {
      const body = bodyFor(SHARED[action] || action);
      if (!body) { bad.push(`${action}: no executor case`); continue; }
      for (const f of schema.fields || []) {
        if (!body.includes(`cfg.${f.key}`)) bad.push(`${action}.${f.key} is never read`);
      }
    }
    expect(bad).toEqual([]);
  });
});
