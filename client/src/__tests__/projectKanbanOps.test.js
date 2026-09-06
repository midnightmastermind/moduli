// __tests__/projectKanbanOps.test.js
//
// THE TWO PROJECT ROUTING OPS, DRIVEN THROUGH THE REAL EXECUTOR OVER THE LIVE
// GRID'S OWN PIPELINES.
//
// These two had NEVER FIRED. Measured before `0275` was written:
//
//     modules binding "Status" (the field both ops trigger on)      0
//
// So `Project: Status Router` and `Project: Sync To Todo List` were enabled,
// correct-looking, and unreachable — the kanban was six containers you could
// drag between with nothing behind them. `0275` mints tasks that bind Status;
// this file is the only thing that says the ops do what they claim, because
// nothing about them may be believed from reading a pipeline that has no track
// record.
//
// EVERY ASSERTION IS ON AN EFFECT THAT LEAVES THE EXECUTOR, not on the state
// afterwards — the 2026-08-11 (5) rule. Driving the callee proves nothing about
// what the app does with it, but an effect that never leaves is a dead op.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let fx, operations, operationsById, fieldsById, modulesById, occurrencesById, grid;
let STATUS;
const nameOf = (o) => o?.label ?? modulesById[o?.moduleId]?.label ?? null;

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  grid = fx.grid;
  operations = fx.operations.filter((o) => o.enabled !== false);
  operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  occurrencesById = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const byNameType = (n, t) => fx.fields.filter((f) => f.name === n && f.type === t);
  expect(byNameType("Status", "select"), "Status must resolve uniquely").toHaveLength(1);
  expect(byNameType("Project", "occurrence"), "Project must resolve uniquely").toHaveLength(1);
  STATUS = byNameType("Status", "select")[0].id;
});

const buildCtx = () => ({
  state: {
    grid, gridId: grid?._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  },
  fieldsById, operationsById, occurrencesById, modulesById,
});

/**
 * A real Status change. The coalesced MeasureOp shape — `fields: { fid: { value,
 * flow } }` — is what both ops read (`$trigger.fields.<fid>.value`); a bare
 * value there resolves to undefined and every gate silently fails.
 */
function changeStatus(occId, next) {
  const occ = occurrencesById[occId];
  occurrencesById[occId] = { ...occ, fields: { ...(occ.fields || {}), [STATUS]: { value: next, flow: "in" } } };
  const errors = [];
  const updates = runMatchingOperations(
    operations, "MeasureOp",
    { type: "MeasureOp", occurrenceId: occId, instanceId: occ.moduleId, fields: { [STATUS]: { value: next, flow: "in" } } },
    buildCtx(),
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) },
  );
  return { updates, errors };
}

const projectPage = (label) => Object.values(occurrencesById).find((o) => nameOf(o) === label && modulesById[o.moduleId]?.role === "page");
const childNamed  = (occ, label) => (occ?.occurrences || []).map((i) => occurrencesById[i]).find((o) => nameOf(o) === label);
const columnOf    = (pageLabel, col) => childNamed(childNamed(projectPage(pageLabel), "Kanban"), col);

describe("controls — the fixture actually holds what 0275 built", () => {
  it("both project pages exist with six kanban columns", () => {
    for (const p of ["Project: Paul's Clown Website", "Project: Via Fluere"]) {
      expect(childNamed(projectPage(p), "Kanban")?.occurrences, p).toHaveLength(6);
    }
  });

  // The premise of this whole file. If it is still 0 the ops cannot fire and
  // every assertion below is vacuous.
  it("tasks bind Status — the thing that was 0 before 0275", () => {
    const binders = Object.values(modulesById).filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === STATUS));
    expect(binders.length).toBeGreaterThan(5);
  });

  it("every kanban task's Status equals the column it sits in", () => {
    const wrong = [];
    for (const p of ["Project: Paul's Clown Website", "Project: Via Fluere"]) {
      for (const cid of childNamed(projectPage(p), "Kanban").occurrences) {
        const col = occurrencesById[cid];
        for (const tid of col.occurrences || []) {
          const t = occurrencesById[tid];
          if (t.fields?.[STATUS]?.value !== nameOf(col)) wrong.push(`${nameOf(t)}: ${t.fields?.[STATUS]?.value} in ${nameOf(col)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  // 2026-08-23 (3): the grid filters on Date, so a row carrying one is visible
  // on exactly one day of the year.
  it("NO kanban task carries a Date value", () => {
    const dateFid = fx.fields.filter((f) => f.name === "Date" && f.type === "date")[0].id;
    const dated = [];
    for (const p of ["Project: Paul's Clown Website", "Project: Via Fluere"]) {
      for (const cid of childNamed(projectPage(p), "Kanban").occurrences) {
        for (const tid of occurrencesById[cid].occurrences || []) {
          if (occurrencesById[tid].fields?.[dateFid]?.value) dated.push(nameOf(occurrencesById[tid]));
        }
      }
    }
    expect(dated).toEqual([]);
  });
});

describe("Project: Status Router — a Status change moves the card", () => {
  it("moves the task to the column named by its new Status", () => {
    const docket = columnOf("Project: Paul's Clown Website", "Docket");
    const target = columnOf("Project: Paul's Clown Website", "Test");
    const taskId = docket.occurrences[0];
    const { updates, errors } = changeStatus(taskId, "Test");
    expect(errors).toEqual([]);
    const moves = updates.filter((u) => u._effect === "MOVE_OCCURRENCE" && u.occurrenceId === taskId);
    expect(moves.length, "the router emitted no move at all").toBeGreaterThan(0);
    expect(moves.map((m) => m.toContainerId)).toContain(target.id);
  });

  // THE CONTROL, and the assertion above is worth nothing without it: an op
  // that moved on EVERY change would pass that test too. `$targetColId IS_NOT
  // $currentColId` is what stops a re-fire churning the row.
  it("does NOT move a task whose Status already equals its column", () => {
    const docket = columnOf("Project: Via Fluere", "Docket");
    const taskId = docket.occurrences[0];
    const { updates, errors } = changeStatus(taskId, "Docket");
    expect(errors).toEqual([]);
    expect(updates.filter((u) => u._effect === "MOVE_OCCURRENCE" && u.occurrenceId === taskId)).toEqual([]);
  });

  // It anchors on the task's OWN kanban board, so two projects with identically
  // named columns cannot cross over.
  it("moves within the task's own project, never into the other one's column", () => {
    const paulDocket = columnOf("Project: Paul's Clown Website", "Docket");
    const viaTest    = columnOf("Project: Via Fluere", "Test");
    const paulTest   = columnOf("Project: Paul's Clown Website", "Test");
    const { updates } = changeStatus(paulDocket.occurrences[1], "Test");
    const to = updates.filter((u) => u._effect === "MOVE_OCCURRENCE").map((u) => u.toContainerId);
    expect(to).toContain(paulTest.id);
    expect(to).not.toContain(viaTest.id);
  });
});

describe("Project: Sync To Todo List — the mirror follows the project", () => {
  const tasksContainer = (label) => {
    const tasks = Object.values(occurrencesById).find((o) => nameOf(o) === "Tasks" && modulesById[o.moduleId]?.role === "page");
    return childNamed(tasks, label);
  };

  it("mirrors a Docket task into its OWN project's Tasks container, not Occupational", () => {
    const docket = columnOf("Project: Via Fluere", "Docket");
    const taskId = docket.occurrences.find((id) => !occurrencesById[id].linkedGroupId);
    expect(taskId, "need an unmirrored Docket task").toBeTruthy();
    const { updates, errors } = changeStatus(taskId, "Docket");
    expect(errors).toEqual([]);
    // COPY_LINK emits CREATE_ITEM and the new row's home is on `instance.parentId`
    // — NOT `occurrence.parentId` and not a top-level key. Reading the wrong one
    // reports an empty set, which looks exactly like "the mirror never landed".
    const links = updates.filter((u) => u._effect === "CREATE_ITEM");
    const parents = new Set(links.map((u) => u.instance?.parentId).filter(Boolean));
    expect(parents.size, "no CREATE_ITEM carried a parent at all — the probe, not the op").toBeGreaterThan(0);
    expect(parents, "the mirror did not land in the Via Fluere container").toContain(tasksContainer("Via Fluere").id);
    expect(parents, "the mirror fell back to Occupational despite a project container existing")
      .not.toContain(tasksContainer("Occupational").id);
    expect(links.length).toBeGreaterThan(0);
  });

  // The behaviour the user was told about when they chose copy-link: once the
  // work is in motion the Tasks-page half goes, and the kanban card remains.
  it("deletes the mirror once Status leaves Backburner/Docket", () => {
    const docket = columnOf("Project: Paul's Clown Website", "Docket");
    // A CARD THAT ACTUALLY HAS A MIRROR, not merely the first one carrying a
    // linkedGroupId. Those are not the same thing: measured 2026-09-05, the
    // Docket column's FIRST linked child is "Register the domain", whose group
    // has exactly ONE member — a stranded link with no partner. Selecting it
    // meant the op correctly found no mirror to delete, and the test read that
    // as the op being broken. Fired at a card whose group really is a pair, the
    // op emits DELETE_ITEM.
    //
    // So the group is required to have a SECOND member, and that member has to
    // be under the Tasks page — which is exactly what the op's own mirror FIND
    // requires (`_ancestors HAS_ANCESTOR <Tasks>`).
    const tasksPage = Object.values(occurrencesById)
      .find((o) => nameOf(o) === "Tasks" && modulesById[o.moduleId]?.role === "page");
    const parentOf = new Map();
    for (const o of Object.values(occurrencesById)) for (const c of (o.occurrences || [])) if (!parentOf.has(c)) parentOf.set(c, o.id);
    const underTasks = (id) => {
      for (let cur = id, i = 0; cur && i < 8; i++, cur = parentOf.get(cur) || occurrencesById[cur]?.parentId) {
        if (cur === tasksPage?.id) return true;
      }
      return false;
    };
    const paired = docket.occurrences.find((id) => {
      const lg = occurrencesById[id]?.linkedGroupId;
      if (!lg) return false;
      return Object.values(occurrencesById).some((o) => o.id !== id && o.linkedGroupId === lg && underTasks(o.id));
    });
    expect(paired, "no Docket card has a mirror under the Tasks page — the fixture lost the pair").toBeTruthy();
    const { updates, errors } = changeStatus(paired, "Working On");
    expect(errors).toEqual([]);
    const deletes = updates.filter((u) => u._effect === "DELETE_ITEM" || u._effect === "REMOVE_OCCURRENCE" || u._effect === "DELETE_OCCURRENCE");
    expect(deletes.length, "no delete effect for the mirror").toBeGreaterThan(0);
  });

  it("neither op errors on any column of either project — the sweep control", () => {
    const errs = [];
    for (const p of ["Project: Paul's Clown Website", "Project: Via Fluere"]) {
      for (const cid of childNamed(projectPage(p), "Kanban").occurrences) {
        for (const tid of (occurrencesById[cid].occurrences || []).slice(0, 2)) {
          errs.push(...changeStatus(tid, "In Review").errors);
        }
      }
    }
    expect(errs).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project: Stamp Status From Column — THE INVERSE, added 2026-08-28.
//
// Measured before it was written: of the ops that mention Status, BOTH trigger
// `onChange · field · Status`, and the only op listening for a move is
// `Schedule: Clear Date on Move-Out`. So dragging a card between columns wrote
// nothing — the card moved, Status went stale, and the Router moved it back on
// first touch.
//
// The op is built from its own builder and injected into the fixture's op set,
// because it is not in the committed fixture until the migration ships. Every
// assertion is on an effect that LEAVES the executor.
// ─────────────────────────────────────────────────────────────────────────────
import { makeProjectStampStatusFromColumnOp } from "../../../server/utils/liveSystemBuilders.js";

const KANBAN_COL_FID = "test-kanban-col-marker";

/** Stamp the marker on a page's six columns, the way the migration will. */
function markColumns(pageLabel) {
  const kanban = childNamed(projectPage(pageLabel), "Kanban");
  for (const cid of kanban.occurrences) {
    const col = occurrencesById[cid];
    occurrencesById[cid] = {
      ...col,
      fields: { ...(col.fields || {}), [KANBAN_COL_FID]: { value: nameOf(col), flow: "in" } },
    };
  }
  return kanban;
}

function fireMove({ occurrenceId, toContainerId, only = true }) {
  const op = makeProjectStampStatusFromColumnOp({
    userId: "u", gridId: grid?._id, statusFieldId: STATUS, kanbanColumnFieldId: KANBAN_COL_FID,
  });
  const errors = [];
  const ops = only ? [op] : [...operations, op];
  const updates = runMatchingOperations(
    ops, "OccurrenceMoveOp",
    { type: "OccurrenceMoveOp", occurrenceId, instanceId: occurrencesById[occurrenceId]?.moduleId,
      fromContainerId: occurrencesById[occurrenceId]?.parentId, toContainerId,
      fields: occurrencesById[occurrenceId]?.fields || {} },
    buildCtx(),
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) },
  );
  return { updates, errors };
}

function fireCreate({ occurrenceId, containerId }) {
  const op = makeProjectStampStatusFromColumnOp({
    userId: "u", gridId: grid?._id, statusFieldId: STATUS, kanbanColumnFieldId: KANBAN_COL_FID,
  });
  const errors = [];
  const updates = runMatchingOperations(
    [op], "OccurrenceCreateOp",
    { type: "OccurrenceCreateOp", occurrenceId, instanceId: occurrencesById[occurrenceId]?.moduleId,
      containerId, containerLabel: nameOf(occurrencesById[containerId]), _occRole: "instance" },
    buildCtx(),
    { onError: (n, e) => errors.push(`${n}: ${e?.message || e}`) },
  );
  return { updates, errors };
}

const statusWrites = (updates) => (updates || [])
  .filter((u) => u._effect === "UPDATE_ITEM_FIELD" && u.fieldId === STATUS)
  .map((u) => ({ itemId: u.itemId, value: u.value }));

describe("Project: Stamp Status From Column — a DRAG is a real move", () => {
  it("dropping a card into a column writes that column's status", () => {
    // Via Fluere's board, because the Status Router cases above MUTATE the
    // shared fixture (they move Paul's cards between columns). Asserting a
    // starting value here would be asserting test order.
    markColumns("Project: Via Fluere");
    const docket = columnOf("Project: Via Fluere", "Docket");
    const test   = columnOf("Project: Via Fluere", "Test");
    const taskId = docket.occurrences[0];

    const { updates, errors } = fireMove({ occurrenceId: taskId, toContainerId: test.id });
    expect(errors).toEqual([]);
    expect(statusWrites(updates)).toEqual([{ itemId: taskId, value: "Test" }]);
  });

  it("a card created with the column's + is born with that column's status", () => {
    markColumns("Project: Via Fluere");
    const backburner = columnOf("Project: Via Fluere", "Backburner");
    const review     = columnOf("Project: Via Fluere", "In Review");
    const taskId = backburner.occurrences[0];

    const { updates, errors } = fireCreate({ occurrenceId: taskId, containerId: review.id });
    expect(errors).toEqual([]);
    expect(statusWrites(updates)).toEqual([{ itemId: taskId, value: "In Review" }]);
  });

  // THE GATE. Every container on the grid receives moves; only a marked one may
  // write a status. Without this the op would stamp a page or container NAME as
  // a status — the exact defect the Time Slot gate was written to fix in 2026-07-30.
  it("writes NOTHING when the destination carries no marker", () => {
    markColumns("Project: Via Fluere");
    const docket = columnOf("Project: Via Fluere", "Docket");
    const scope  = childNamed(projectPage("Project: Via Fluere"), "Project Scope");
    const taskId = docket.occurrences[0];

    const { updates, errors } = fireMove({ occurrenceId: taskId, toContainerId: scope.id });
    expect(errors).toEqual([]);
    expect(statusWrites(updates)).toEqual([]);
  });

  // AND IT DOES NOT CLEAR. `makeStampDateTimeSlotOp` clears its field off a
  // non-slot destination; the opposite is right here — a task dragged onto the
  // schedule is still at whatever stage it was, and clearing Status would drop
  // it out of the Todo mirror silently.
  it("leaves an existing Status alone when a card is dragged OUT of the board", () => {
    markColumns("Project: Via Fluere");
    const docket = columnOf("Project: Via Fluere", "Docket");
    const taskId = docket.occurrences[0];
    const before = occurrencesById[taskId].fields?.[STATUS]?.value;

    const { updates } = fireMove({ occurrenceId: taskId, toContainerId: projectPage("Project: Paul's Clown Website").id });
    expect(statusWrites(updates)).toEqual([]);
    expect(occurrencesById[taskId].fields?.[STATUS]?.value).toBe(before);
  });

  it("is idempotent — re-dropping a card into the column it already sits in rewrites the same value", () => {
    markColumns("Project: Via Fluere");
    const docket = columnOf("Project: Via Fluere", "Docket");
    const taskId = docket.occurrences[0];
    const { updates } = fireMove({ occurrenceId: taskId, toContainerId: docket.id });
    expect(statusWrites(updates)).toEqual([{ itemId: taskId, value: "Docket" }]);
  });

  // Alongside every OTHER op the grid has, not in isolation — a pipeline that
  // only works when nothing else runs is not shipped.
  it("runs cleanly among the grid's own 80+ ops", () => {
    markColumns("Project: Via Fluere");
    const docket = columnOf("Project: Via Fluere", "Docket");
    const test   = columnOf("Project: Via Fluere", "Test");
    const { updates, errors } = fireMove({ occurrenceId: docket.occurrences[0], toContainerId: test.id, only: false });
    expect(errors).toEqual([]);
    expect(statusWrites(updates)).toContainEqual({ itemId: docket.occurrences[0], value: "Test" });
  });
});
