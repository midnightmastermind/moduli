// __tests__/timeSlotIdentity.test.js
//
// `Time Slot` is a PLACEMENT on most rows and an IDENTITY on a few, and the
// op that clears it could not tell the difference.
//
// `Schedule: Stamp Date & Time Slot` clears Time Slot when a row lands
// somewhere that is not a slot — deliberately, and for a real defect: a COPY
// carries the source's fields, so an item copied out of a 5:00pm slot onto a
// canvas would otherwise keep a slot it no longer sits in (2026-07-30).
//
// But `Schedule: Build Schedule` FINDs the Todo container BY
// `fields.<Time Slot>.value IS "Todo"`, and the Alarm and Pomodoro ops find
// their slot the same way. Measured: no Todo occurrence carries `Schedule
// Format`, so the op's outer guard — written for slots — let every one through
// into the clearing branch, and the copy-link fan-out then shared the null
// across the whole group, master included. It was repaired twice before the
// cause was found (`0292`, then again the same night).
//
// THE TWO TESTS ARE A PAIR. "The marker survives" is also satisfied by a guard
// that never clears anything — which would put the 2026-07-30 defect straight
// back — so the second test drives a genuinely misplaced row and asserts it IS
// still cleared.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
// The Schedule panel the stamp op's trigger is scoped to. Read off the op
// rather than hardcoded, so a re-seed cannot make this test vacuous.
let PANEL;

let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
  const op = base.operations.find((o) => o.name === "Schedule: Stamp Date & Time Slot");
  expect(op, "the stamp op is gone — this suite is about it").toBeTruthy();
  PANEL = (op.triggerObjects || []).find((t) => t.subjectRole === "panel")?.targetId;
  expect(PANEL, "the stamp op is no longer panel-scoped — the trigger shape changed").toBeTruthy();
});

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}

// Fire the create trigger the day rollover fires for a freshly copied row.
function unguard(w) {
  // Strip the guard `0304` added: unwrap any `if` whose only job is to gate a
  // Time Slot clear. Reproduces the shape that erased the marker.
  const ts = w.fx.fields.find((f) => f.name === "Time Slot").id;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        const c = n[i]?.config || n[i];
        const isGuard = (c?.type === "if") && JSON.stringify(c.condition || {}).includes("$item.moduleLabel");
        if (isGuard && Array.isArray(c.then) && c.then.length === 1) { n[i] = c.then[0]; continue; }
        walk(n[i]);
      }
      return;
    }
    Object.values(n).forEach(walk);
  };
  walk(w.fx.operations);
}

function stamp(w, occId, containerId) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const grid = w.fx.grid;
  const lbl = (o) => (o ? (o.label || w.modulesById[o.moduleId]?.label) : "?");
  const updates = runMatchingOperations(ops, "OccurrenceCreateOp", {
    type: "OccurrenceCreateOp", occurrenceId: occId, containerId,
    containerLabel: lbl(w.occurrencesById[containerId]), panelId: PANEL,
  }, {
    state: { grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
             occurrencesById: w.occurrencesById, modulesById: w.modulesById,
             fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];
  const ts = w.fx.fields.find((f) => f.name === "Time Slot").id;
  return updates.filter((e) => (e.fieldId || e.payload?.fieldId) === ts)
                .map((e) => e.value ?? e.payload?.value ?? null);
}

const fid = (w, n) => w.fx.fields.find((f) => f.name === n)?.id;
const lbl = (w, o) => (o ? (o.label || w.modulesById[o.moduleId]?.label) : "?");
const dayColumn = (w) => w.fx.occurrences.find((o) => o.fields?.[fid(w, "Schedule Format")]?.value === "day-col");

describe("Time Slot as an identity marker", () => {
  it("a container whose Time Slot IS its own name keeps it", () => {
    const w = world();
    const ts = fid(w, "Time Slot");
    const todo = w.fx.occurrences.find((o) => lbl(w, o) === "Todo" && o.fields?.[ts]?.value === "Todo");
    expect(todo, "no Todo container carrying its marker — repair it first").toBeTruthy();
    // The condition that made it reachable at all: it carries no Schedule
    // Format, so the op's slot guard does not protect it.
    expect(todo.fields?.[fid(w, "Schedule Format")]?.value).toBeUndefined();

    const col = dayColumn(w);
    expect(col, "no day column to copy into").toBeTruthy();
    if (process.env.AB_UNGUARD === "1") unguard(w);
    expect(stamp(w, todo.id, col.id), "the identity marker was cleared").toEqual([]);
  });

  it("a row genuinely carrying someone else's slot is STILL cleared", () => {
    // THE CONTROL. Without it, "the marker survives" is also satisfied by a
    // guard that never clears — which is the 2026-07-30 defect returning: a
    // copy keeping a slot it no longer sits in.
    const w = world();
    const ts = fid(w, "Time Slot");
    const col = dayColumn(w);
    const slot = w.fx.occurrences.find((o) => o.fields?.[fid(w, "Schedule Format")]?.value === "slot");
    expect(slot, "no real slot in the fixture").toBeTruthy();

    // A task that sits in a slot: its Time Slot is the SLOT's name, not its
    // own. It must carry its OWN module — borrowing the slot's would make its
    // `moduleLabel` the slot's name too, and the guard would correctly (and
    // uselessly) treat it as an identity. That is a fact about the fixture,
    // not about the rule.
    const own = w.fx.modules.find((m) => m.label && !/^\d{1,2}:\d{2}(am|pm)$/.test(m.label) && m.label !== "Todo");
    expect(own, "no ordinary module to borrow").toBeTruthy();
    const task = { id: "identity-control-row", moduleId: own.id, parentId: col.id,
                   label: null, fields: { [ts]: { value: lbl(w, slot), flow: "in" } } };
    expect(task.fields[ts].value).not.toBe(own.label);
    w.fx.occurrences.push(task);
    w.occurrencesById[task.id] = task;

    if (process.env.AB_UNGUARD === "1") unguard(w);
    expect(stamp(w, task.id, col.id), "a misplaced slot value was NOT cleared").toEqual([null]);
  });
});
