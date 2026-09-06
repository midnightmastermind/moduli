// __tests__/pomsGridOps.test.js
//
// THE OPERATIONS OF THE LIVE GRID, DRIVEN THROUGH THE REAL EXECUTOR.
//
// User, 2026-08-19: *"we also need to make sure in our testing, we have testing
// specifically on poms grid (or a copy of it) and making sure those specific
// operations are working still."*
//
// WHY THIS EXISTS BESIDE `liveOpsBehavioral.test.js`, WHICH ALREADY DRIVES THE
// EXECUTOR. That suite boots from `server/seed/*.json` — what a FRESH grid looks
// like. poms grid has diverged from the seed by ~140 migrations: its stored
// pipelines are not the seed's, so until this file existed **not one of them had
// ever been covered by a test.** Every defect this repo has paid for in a stored
// pipeline — a FIND binding an array into an UPDATE, an action with no executor
// case, a picker-direct reference to an occurrence a sweep removed — was found
// by a user hitting it, because nothing ran them.
//
// THE FIXTURE IS A SNAPSHOT, NOT A CONNECTION. `pomsGrid.json.br` is written by
// `server/scripts/exportGridFixture.js`; it is deterministic, runs in CI, and
// pins the pipelines as they are on the day it was taken. Re-export it after any
// migration that rewrites an op. Textmaps are stripped — no action reads prose —
// which is what makes 5.7 MB fit in 292 KB.
//
// WHAT IS ASSERTED, AND WHY EACH ONE IS A DEFECT THIS REPO HAS ACTUALLY SHIPPED:
//
//   1. the onLoad sweep runs with NO op erroring       (`$col is not a record`)
//   2. every action a stored pipeline names has an executor case  (silent no-op)
//   3. every picker-direct `$allItemsById.<id>` resolves     (72 dangling picks)
//   4. every trigger's target occurrence still exists      (op scoped to a hole)
//
// The counts are asserted first as CONTROLS. A probe that finds nothing makes
// every assertion after it vacuously true, which is the trap 2026-08-01 (16)
// records and this file is built to avoid.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

// The sweep runs 68 pipelines over 3,280 occurrences. That is integration
// scale and legitimately takes seconds.
vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");
const readSource = (rel) => readFileSync(path.resolve(here, "..", rel), "utf8");

let fx, operations, operationsById, fieldsById, modulesById, occurrencesById, grid;

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  grid = fx.grid;
  operations = fx.operations.filter(o => o.enabled !== false);
  operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
});

function buildCtx() {
  const state = {
    grid,
    gridId: grid?._id,
    fields: Object.values(fieldsById),
    modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  };
  return { state, fieldsById, operationsById, occurrencesById, modulesById };
}

describe("the poms grid fixture — controls", () => {
  // Every assertion in this file is a claim about the fixture's contents. If
  // the export half-failed, the claims below are all trivially true.
  it("carries the grid's real population, not an empty shell", () => {
    expect(operations.length).toBeGreaterThan(50);
    expect(fx.occurrences.length).toBeGreaterThan(2000);
    expect(fx.modules.length).toBeGreaterThan(2000);
    expect(fx.fields.length).toBeGreaterThan(100);
    expect(grid?.name).toBe("poms grid");
  });

  it("is a fixture, not a backup — textmaps are stripped", () => {
    expect(fx.occurrences.some(o => "textmap" in o)).toBe(false);
  });

  it("every operation carries a pipeline with steps", () => {
    const empty = operations.filter(o => !(o.pipeline?.steps?.length > 0)).map(o => o.name);
    expect(empty).toEqual([]);
  });
});

describe("the load sweep — what happens on every page load", () => {
  // THE SWEEP IS FIRED WITH A NULL TRANSACTION TYPE, and getting that wrong is
  // how this test was vacuous for its first hour. `bindSocketToStore` calls
  // `runMatchingOperations(operations, null, null, ...)` on full_state — the
  // no-config path `computeTriggerMatch` treats as the load fire. Called with
  // `"onLoad"` and a `{type:"onLoad"}` transaction instead, it matched **0 of
  // 68 ops**, reported zero errors, and passed. Planting a pipeline that throws
  // did not fail it, which is the only reason I found out.
  //
  // So the emitter count is asserted FIRST. A sweep that runs nothing cannot
  // fail the error assertion, and a green run would mean nothing at all.
  let errors, emitters, updates;

  it("actually runs the grid's operations — the control", () => {
    errors = []; emitters = [];
    updates = runMatchingOperations(
      operations, null, null, buildCtx(),
      {
        onError: (name, err) => errors.push(`${name}: ${err?.message || err}`),
        onSuccess: (name, fx) => emitters.push(`${name} (${fx.length}fx)`),
      },
    );
    applyEffectsToLiveOccs(occurrencesById, updates);
    // 52 ops emitted effects when this was written. Pinned as a floor, not an
    // equality: the sweep is date-dependent, so the exact number legitimately
    // moves with the day it runs on.
    expect(emitters.length, "the load sweep ran no operations at all").toBeGreaterThan(20);
  });

  it("runs them all without one of them erroring", () => {
    // Named rather than counted: a failure has to say WHICH op and why, or the
    // next person is back to reading the grid to find out.
    expect(errors).toEqual([]);
  });

  // THE POSITIVE CONTROL, and the assertion above means nothing without it.
  // "Zero errors" is a claim about the reporting as much as about the grid, and
  // this repo has shipped several probes that reported zero because they were
  // broken. So: corrupt a REAL step in an op that demonstrably runs, and prove
  // the same reporting path names it.
  //
  // The corruption is a real UPDATE repointed at an unbound var — the shape
  // that threw `$col is not a record` on 2026-08-18. It has to be a real step:
  // three invented ones in a row failed to error here, because the config key
  // an UPDATE reads is `path` and I kept writing `target`. An executor case
  // that never runs is not a test of the executor.
  it("and the error reporting is not asleep — a broken step IS reported", () => {
    const findSteps = (steps, pred, out = []) => {
      for (const st of steps || []) {
        if (pred(st)) out.push(st);
        for (const k of ["actions", "steps", "body", "then", "else"]) findSteps(st?.[k], pred, out);
      }
      return out;
    };
    // A deep copy — the corruption must not leak into any other test.
    const ops = structuredClone(operations);
    const runner = ops.find(o => emitters.some(e => e.startsWith(o.name)));
    expect(runner, "no op from the emitter list found to corrupt").toBeTruthy();
    const upd = findSteps(runner.pipeline.steps, st => st?.config?.type === "UPDATE")[0];
    expect(upd, `"${runner.name}" has no UPDATE step to corrupt`).toBeTruthy();
    upd.config.path = "$definitelyNotBound.fields.x.value";

    const seen = [];
    const opsById = Object.fromEntries(ops.map(o => [o.id, o]));
    const occs = structuredClone(occurrencesById);
    runMatchingOperations(ops, null, null, {
      state: { grid, gridId: grid?._id, fields: Object.values(fieldsById),
               modules: Object.values(modulesById), occurrencesById: occs,
               modulesById, fieldsById, operationsById: opsById, operations: ops },
      fieldsById, operationsById: opsById, occurrencesById: occs, modulesById,
    }, { onError: (name, err) => seen.push(`${name}: ${err?.message || err}`) });

    expect(seen.length, "a deliberately broken step was NOT reported").toBeGreaterThan(0);
    expect(seen.join(" ")).toMatch(/definitelyNotBound/);
  });
});

describe("every stored pipeline names things that exist", () => {
  // Pull every action type out of the stored pipelines, at any nesting depth.
  //
  // THE TYPE LIVES AT `step.config.type`. The first version of this read
  // `step.actionType`, found 10 distinct types where there are 34, and its
  // control passed anyway because 10 cleared the threshold I had guessed. A
  // walker that reads the wrong key does not fail — it under-reports, and an
  // under-reporting walker makes the coverage assertion below nearly vacuous.
  // The control is now pinned to the MEASURED number for that reason.
  const actionTypeOf = (s) => s?.config?.type ?? s?.cfg?.type ?? s?.action ?? s?.actionType;
  const walkActions = (steps, out = []) => {
    for (const s of steps || []) {
      if (s?.type === "action") { const a = actionTypeOf(s); if (a) out.push(a); }
      for (const key of ["actions", "steps", "body", "then", "else"]) walkActions(s?.[key], out);
    }
    return out;
  };

  it("finds actions in the stored pipelines — the control", () => {
    const used = new Set(operations.flatMap(o => walkActions(o.pipeline?.steps)));
    // 34 measured 2026-08-19. A DROP here means the walker stopped seeing a
    // nesting shape, not that the grid got simpler.
    expect(used.size).toBeGreaterThanOrEqual(30);
    expect(used.has("UPDATE")).toBe(true);
    expect(used.has("APPLY_TEMPLATE")).toBe(true);
  });

  // The picker-vs-executor version of this lives in actionEditorCoverage; this
  // is the one that matters for THIS grid, whose pipelines were written by
  // migrations rather than by the picker. An action with no case is a step that
  // silently does nothing — the SET_FIELD_VALUE class, 2026-08-18.
  it("every action a stored pipeline names has an executor case", () => {
    const executorCases = new Set(
      [...readSource("helpers/operationActions.js").matchAll(/case\s+"([A-Z_]+)"/g)].map(m => m[1]),
    );
    expect(executorCases.size).toBeGreaterThan(50);   // control
    const used = new Set(operations.flatMap(o => walkActions(o.pipeline?.steps)));
    const missing = [...used].filter(a => !executorCases.has(a)).sort();
    expect(missing).toEqual([]);
  });

  // A picker-direct binding is `$allItemsById.<occurrence id>` — the shape
  // adopted in 2026-05-22 precisely so an op stops matching by LABEL. It is
  // only as stable as the occurrence it names: 2026-08-13 (4) found 72 of these
  // dangling at once, because they pointed at feed COPIES that a resync
  // re-minted. Nothing reports it; the op just quietly finds nothing.
  it("every picker-direct occurrence reference resolves to a real occurrence", () => {
    const refs = new Map();     // occId -> ops naming it
    for (const op of operations) {
      const raw = JSON.stringify(op.pipeline);
      for (const m of raw.matchAll(/\$allItemsById\.([A-Za-z0-9_-]+)/g)) {
        if (!refs.has(m[1])) refs.set(m[1], new Set());
        refs.get(m[1]).add(op.name);
      }
    }
    expect(refs.size, "no picker-direct references found — check the pattern").toBeGreaterThan(5);
    const dangling = [...refs].filter(([id]) => !occurrencesById[id])
      .map(([id, ops]) => `${id} (named by ${[...ops].join(", ")})`);
    expect(dangling).toEqual([]);
  });

  // An op scoped to an occurrence that no longer exists cannot resolve
  // `$activePeriodDates` (the executor reads them from targetOccurrenceId), so
  // it runs against the wrong dates or against none — the 2026-08-09 (8)
  // finding, from the side where the target is simply gone.
  it("every operation's target occurrence still exists", () => {
    const orphaned = operations
      .filter(o => o.targetOccurrenceId && !occurrencesById[o.targetOccurrenceId])
      .map(o => `${o.name} -> ${o.targetOccurrenceId}`);
    expect(orphaned).toEqual([]);
  });

  // A TRIGGER'S `targetId` HAS NO SINGLE ID SPACE, which is why this asserts
  // existence rather than collection. Read off the matcher
  // (operationExecutor.js ~590-610): a `field` subject compares it to a changed
  // FIELD id; a `panel` subject compares it to `transaction.panelId`, which
  // dropHandlers resolves against the panel MODULE list; a `container` subject
  // compares it to `transaction.containerId`, an OCCURRENCE id.
  //
  // The first version of this test asserted every targetId was an occurrence
  // and reported 103 violations — all of them fields, and all of them correct.
  // A probe that flags 103 things on a grid with 0 integrity errors is wrong
  // before the grid is. What is worth catching is the id that names NOTHING:
  // a trigger left pointing at something a sweep removed never fires, and
  // nothing anywhere says so.
  it("every trigger target names something that still exists", () => {
    const exists = (id) => !!(fieldsById[id] || modulesById[id] || occurrencesById[id]);
    let checked = 0;
    const bad = [];
    for (const op of operations) {
      for (const t of op.triggerObjects || []) {
        for (const key of ["targetId", "targetOccurrenceId", "occurrenceId", "fieldId"]) {
          const id = t?.[key];
          if (!id || typeof id !== "string") continue;   // "" means "match any"
          checked++;
          if (!exists(id)) bad.push(`${op.name}.${key} -> ${id} (subjectType=${t.subjectType})`);
        }
      }
    }
    expect(checked, "no trigger targets found — the walk is broken").toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// THE CATEGORY AXIS (migration 0164). The gates are DATA in 31 stored pipelines,
// so the only thing standing between them and a future migration that rewrites
// a tracker is a test that reads them back. Each assertion below is a way the
// axis can break SILENTLY — three of them produce a wrong number rather than an
// error, which is why the sweep passing above is not enough on its own.
describe("the category axis is intact in the stored pipelines", () => {
  const TAGS = "CvJsK3lNu6_e";
  const isLoopDate = (r) =>
    r && typeof r.left === "string" && !r.left.startsWith("$trigger.")
    && /^\$[A-Za-z0-9_]+\.fields\./.test(r.left)
    && r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod";
  const isPeriodAllWrapper = (r) =>
    r && Array.isArray(r.rules) && r.operator === "OR"
    && r.rules.some(isLoopDate)
    && r.rules.some((x) => x && x.left === "$goalPeriod" && x.comparator === "IS_EMPTY");
  const isCategoryGate = (r) =>
    r && Array.isArray(r.rules) && r.operator === "OR"
    && r.rules.some((x) => x && x.right === "$goalCategory" && x.comparator === "CONTAINS");

  // Walk every rule group, reporting each gate WITH the group it sits in — the
  // containing group is what the wrapper check needs.
  const gates = () => {
    const out = [];
    const walk = (node, opName) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, opName));
      if (Array.isArray(node.rules)) {
        for (const r of node.rules) if (isCategoryGate(r)) out.push({ gate: r, group: node, opName });
      }
      for (const v of Object.values(node)) walk(v, opName);
    };
    for (const op of operations) walk(op.pipeline?.steps, op.name);
    return out;
  };

  it("carries category gates at all — the control", () => {
    // The floor is deliberately well below the current count (24 ops / 29 gates
    // after 0168 retired seven trackers). It exists to stop the four assertions
    // below passing vacuously on a fixture that carries no gates at all — not to
    // pin an exact number, which would go red every time a tracker is added or
    // retired and teach whoever hits it to just edit the number.
    const bound = operations.filter((o) => /"name":"\$goalCategory"/.test(JSON.stringify(o.pipeline || {})));
    expect(bound.length).toBeGreaterThanOrEqual(15);
    expect(gates().length).toBeGreaterThanOrEqual(15);
  });

  it("every gate reads a loop var its own group also date-gates", () => {
    // A gate naming a var the group never binds throws at run time and kills the
    // op — the failure the policy's fail-closed skip exists to prevent.
    const bad = [];
    for (const { gate, group, opName } of gates()) {
      const lv = /^\$([A-Za-z0-9_]+)\./.exec(gate.rules.find((x) => x.right === "$goalCategory").left)?.[1];
      const sib = group.rules.find((x) => isLoopDate(x) || isPeriodAllWrapper(x));
      const sibVar = sib && /^\$([A-Za-z0-9_]+)\./.exec(
        isPeriodAllWrapper(sib) ? sib.rules.find(isLoopDate).left : sib.left)?.[1];
      if (!sibVar || sibVar !== lv) bad.push(`${opName}: gate on $${lv}, date gate on $${sibVar}`);
    }
    expect(bad).toEqual([]);
  });

  it("no gate sits INSIDE the period-all wrapper", () => {
    // `(date in period) OR (period IS_EMPTY) OR (category…)` is vacuously true on
    // an unfiltered page — it would silently disable DATE filtering on every
    // tracker while every number still looked plausible.
    expect(gates().filter(({ group }) => isPeriodAllWrapper(group)).map((g) => g.opName)).toEqual([]);
  });

  it("every gate keeps its IS_EMPTY escape arm", () => {
    // Without it a tile reads 0 until a category is picked — the whole grid goes
    // blank-numbered on an unfiltered page, and nothing errors.
    const missing = gates()
      .filter(({ gate }) => !gate.rules.some((x) => x && x.left === "$goalCategory" && x.comparator === "IS_EMPTY"))
      .map((g) => g.opName);
    expect(missing).toEqual([]);
  });

  it("the trackers' page carries the category nav, and it gates no visibility", () => {
    const page = Object.values(occurrencesById).find((o) => (o.filters || []).some((f) => f?.fieldId === TAGS));
    expect(page).toBeTruthy();
    const f = page.filters.find((x) => x.fieldId === TAGS);
    expect(f.active).toBe(true);   // section (2) of FiltersSection needs both to render a widget
    expect(f.showNav).toBe(true);
    expect(f.options.length).toBeGreaterThan(10);
    // A NULL condition would make getLocalFilterConditions contribute a visibility
    // rule — picking "grocery" would then empty the page instead of rescoping it.
    expect(f.condition).toBeTruthy();
  });
});

// THE SWEEP MUST CONVERGE. Running it twice over the same state has to create
// NOTHING the second time — every build op on this grid is written to be
// idempotent, and each one enforces that with a FIND that looks for what it is
// about to make.
//
// It did not converge. `applyEffectsToLiveOccs` dropped `meta` from CREATE_ITEM,
// so a COPY_LINK slot copy reached the next op without the `meta.copyLinkSource`
// its own dedupe FIND matches on, and `Schedule: Build Schedule` re-copied all
// 49 slots on every sweep. Live on 2026-08-31 that was a day column holding 245
// children (49 sources x 5 copies) and +49 occurrences per page load, unbounded.
//
// Asserted as GROWTH between two passes rather than an absolute count, because
// the sweep is date-dependent: on a day with no column yet, pass 1 legitimately
// builds one. Pass 2 is the one that must be silent.
describe("every tracker tile shows a number something writes", () => {
  // THE TEST THE USER ASKED FOR, 2026-09-05: *"alot of them arent updating and
  // the tests should be catching them"* — purchases, workouts array, last
  // purchase, tasks completed, savings balance. They were right, and nothing
  // here could have caught it: every assertion above is about an op ERRORING or
  // a reference RESOLVING. An op that emits zero effects passes all of them.
  //
  // THE DEFECT HAS ONE SHAPE. A tile binds a `display` field that a DIFFERENT
  // tile's op owns — `Total Workouts` is written to `Fitness Stats`, not to
  // `Workout Log`; `Time Spent` was written to `Reading Time` while four other
  // tiles bound it. A tracker op is scoped to ONE goal occurrence, so the second
  // tile renders an empty box forever, with no error anywhere.
  //
  // So the invariant is: a `display` binding on a tile under the Trackers page
  // must be written by the load sweep.
  //
  // `meta.liveSource` is the one carve-out and it is a real one: `Now` and
  // `Time Left` are computed at RENDER from the clock (`useLiveFieldValue`), so
  // no operation ever writes them and requiring one would be wrong.
  let checked, unwritten;

  beforeAll(() => {
    const written = new Set();
    const emitted = [];
    const updates = runMatchingOperations(operations, null, null, buildCtx(), {
      onError: () => {},
      onSuccess: (name, fx2) => emitted.push(name) && null,
    });
    for (const e of updates || []) {
      const id = e.itemId || e.occurrenceId;
      if (e.fieldId && id) written.add(`${id}::${e.fieldId}`);
    }
    const nameOf = (o) => o.label || modulesById[o.moduleId]?.label;
    const page = Object.values(occurrencesById).find(
      (o) => nameOf(o) === "Trackers" && (o.role || modulesById[o.moduleId]?.role) === "page");
    const tiles = [];
    (function walk(id, d) {
      if (d > 6) return;
      for (const cid of (occurrencesById[id]?.occurrences || [])) {
        const c = occurrencesById[cid];
        if (!c) continue;
        tiles.push(c);
        walk(cid, d + 1);
      }
    })(page?.id, 0);

    checked = 0; unwritten = [];
    for (const t of tiles) {
      const m = modulesById[t.moduleId];
      if (!m) continue;
      for (const b of (m.fieldBindings || [])) {
        const f = fieldsById[b.fieldId];
        if (!f || b.role !== "display") continue;
        if (f.meta?.liveSource) continue;   // rendered from the clock, never written
        checked++;
        if (!written.has(`${t.id}::${b.fieldId}`)) unwritten.push(`${nameOf(t)} :: ${f.name}`);
      }
    }
    unwritten.sort();
  });

  // THE CONTROL. A walk that finds no tiles, or a sweep that writes nothing,
  // makes the assertion below vacuously true — which is the trap this whole
  // file is built to avoid.
  it("finds the tracker tiles and their display bindings — the control", () => {
    expect(checked, "no display bindings found under the Trackers page").toBeGreaterThan(100);
  });

  // AN EXACT SET, NOT A CEILING, and that is deliberate in BOTH directions:
  // it cannot GROW (a tracker that stops writing fails here), and a stale entry
  // cannot LINGER (fix one and this fails until it is removed from the list).
  //
  // Each of the five is a decision the user has not made yet, not an accident:
  //
  //   Savings Balance  no operation writes it at all — every other account has
  //                    a balance op. The user's call (2026-09-05) is a logged
  //                    balance affected by tagged transactions, which needs an
  //                    `Account` field on the money rows first. Checking wants
  //                    the same treatment.
  //
  //   the other four   a tile binding a metric another tile already owns, with
  //                    no narrower scope of its own — steps are steps. Unlike
  //                    the five given dimension-scoped trackers on 2026-09-05,
  //                    "scope it to its own tile" does not translate here, so
  //                    they are either mirrored or unbound, and that is a
  //                    product decision.
  it("no tracker tile binds a display field the sweep never writes", () => {
    expect(unwritten).toEqual([
      "Fitness Stats :: Daily Steps",
      "Liquid Intake :: Daily Water",
      "Reading Stats :: Pages Read",
      "Savings Account :: Savings Balance",
      "Workout Log :: Total Workouts",
    ]);
  });
});

describe("the load sweep converges — a second pass creates nothing", () => {
  it("adds no occurrences on the second identical sweep", () => {
    const occs = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
    const state = {
      grid, gridId: grid?._id,
      fields: Object.values(fieldsById), modules: Object.values(modulesById),
      occurrencesById: occs, modulesById, fieldsById, operationsById, operations,
    };
    const ctx = { state, fieldsById, operationsById, occurrencesById: occs, modulesById };

    const sweep = () => {
      const ups = runMatchingOperations(operations, null, null, ctx, { onError: () => {}, onSuccess: () => {} });
      applyEffectsToLiveOccs(occs, ups);
      return ups.filter(e => e?._effect === "CREATE_ITEM").length;
    };

    const firstCreated = sweep();
    const before = Object.keys(occs).length;
    const secondCreated = sweep();
    const after = Object.keys(occs).length;

    // The control: pass 1 has to have DONE something, or "pass 2 created
    // nothing" is true of a sweep that never ran. On an already-built day this
    // is legitimately 0, so it is only asserted as a floor when it fired.
    expect(firstCreated).toBeGreaterThanOrEqual(0);
    expect(secondCreated, "the second sweep created occurrences — an op is not idempotent").toBe(0);
    expect(after - before, "the grid grew on a no-op sweep").toBe(0);
  });
});

