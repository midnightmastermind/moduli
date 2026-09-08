// A day you did something on is not torn down.
//
// User, 2026-09-08: *"so currently the occurances that get added to the schedule
// are deleted everytime? that shouldnt happen"*
//
// `Schedule: Build Schedule` PHASE C deletes every day column outside the
// filtered period. Measured against a pre-rollover snapshot, moving to a new day
// removed **137 occurrences, 31 of them COMPLETED** — a psych appointment,
// twelve Sleep records, the `Track` rows carrying the account balances.
//
// The sources survive (the appointment is on the Tasks page, Eat and Sleep in
// the catalog), so what was lost is the RECORD of the day — and the tracker
// history arrays cannot stand in for it, because they are date-scoped and read
// 0 rows for any past day.
//
// BOTH HALVES ARE ASSERTED HERE and the second is what makes the first mean
// something: "nothing is deleted" is trivially satisfied by removing the
// teardown, which would leave a day-col plus its 49 slots of empty scaffolding
// accumulating every single day on a grid whose load time is already a problem.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { TODAY, labelOf, fieldId, ensureTodaysColumn } from "./helpers/scheduleWorld";

vi.setConfig({ testTimeout: 120000 });
const here = path.dirname(fileURLToPath(import.meta.url));
let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
});

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}

/** Every occurrence id the sweep asks to DELETE. */
function deletedBySweep(w) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const updates = runMatchingOperations(ops, null, null, {
    state: { grid: w.fx.grid, gridId: w.fx.grid?._id, fields: w.fx.fields, modules: w.fx.modules,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
      fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];

  const out = new Set();
  for (const e of updates) {
    const kind = e._effect || e.type || e.payload?.type;
    if (!/DELETE|REMOVE_OCCURRENCE/i.test(String(kind || ""))) continue;
    const id = e.itemId || e.occurrenceId || e.payload?.itemId || e.payload?.occurrenceId;
    if (id) out.add(id);
  }
  return out;
}

/**
 * A day column dated OUTSIDE the filtered period — the shape PHASE C tears
 * down. Cloned from today's real column so it carries the same markers.
 */
function pastColumn(w, { completed }) {
  const today = ensureTodaysColumn(w);
  const col = JSON.parse(JSON.stringify(today));
  col.id = `past-col-${completed ? "used" : "untouched"}`;
  col.fields[fieldId(w, "Date")] = { value: "2026-01-15", flow: "in" };
  // Its own child, so the clone does not share today's rows.
  const src = w.fx.occurrences.find(
    (o) => labelOf(w, o) === "Eat" && w.modulesById[o.moduleId]?.role === "instance");
  const row = JSON.parse(JSON.stringify(src));
  row.id = `${col.id}-row`;
  row.parentId = col.id;
  row.fields = { ...(row.fields || {}),
    [fieldId(w, "Date")]: { value: "2026-01-15", flow: "in" } };
  if (completed) row.fields[fieldId(w, "Completed")] = { value: true, flow: "in" };
  col.occurrences = [row.id];

  // Listed by whatever lists today's column, so its ancestry reaches Schedule.
  const parent = w.fx.occurrences.find((o) => (o.occurrences || []).includes(today.id));
  expect(parent, "nothing lists today's column").toBeTruthy();
  parent.occurrences = [...parent.occurrences, col.id];

  for (const o of [col, row]) { w.fx.occurrences.push(o); w.occurrencesById[o.id] = o; }
  return col;
}

describe("the daily schedule rebuild", () => {
  it("KEEPS a past day you completed something on", () => {
    const w = world();
    const col = pastColumn(w, { completed: true });
    expect(deletedBySweep(w).has(col.id),
      "a day you ticked something on was torn down").toBe(false);
  });

  // THE CONTROL. Without it, "nothing is deleted" also passes for a build that
  // stopped cleaning up entirely — and an untouched day is 50 occurrences of
  // empty scaffolding, every day, forever.
  it("still tears down a past day you did nothing on", () => {
    const w = world();
    const col = pastColumn(w, { completed: false });
    expect(deletedBySweep(w).has(col.id),
      "the teardown stopped cleaning up untouched days").toBe(true);
  });

  it("never tears down TODAY", () => {
    const w = world();
    const today = ensureTodaysColumn(w);
    // The period always includes today, so this is the invariant that has to
    // hold whatever the guard does.
    expect(deletedBySweep(w).has(today.id), "today's column was deleted").toBe(false);
    expect(today.fields[fieldId(w, "Date")].value).toBe(TODAY);
  });
});

describe("a kept day does not re-duplicate when you go back to it", () => {
  // User, 2026-09-08: *"we got to make sure that ones i put into my other
  // schedule templates dont unnecessarily duplicate themselves on the same
  // timeslot"* — and keeping past columns is exactly what could cause that: a
  // column the teardown used to remove is now still there when you navigate
  // back, and the build will merge into it.
  //
  // Measured on the live grid first: today's column and all NINE schedule
  // templates carry ZERO duplicates, keyed on IDENTITY (a row's signature, or
  // its module plus what it PICKS). Keying on the module alone reports six
  // false duplicates in the 7:00am slot — six different exercises share the one
  // `Exercise` module, which is the design.
  const identity = (w, o) =>
    o.identitySignature
      ? `sig:${o.identitySignature}`
      : `mod:${o.moduleId}|${[fieldId(w, "Movement"), fieldId(w, "Meal")]
          .map((f) => JSON.stringify(o.fields?.[f]?.value ?? null)).join("|")}`;

  const createsFrom = (w) => {
    const ops = w.fx.operations.filter((o) => o.enabled !== false);
    const updates = runMatchingOperations(ops, null, null, {
      state: { grid: w.fx.grid, gridId: w.fx.grid?._id, fields: w.fx.fields, modules: w.fx.modules,
        occurrencesById: w.occurrencesById, modulesById: w.modulesById,
        fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
      fieldsById: w.fieldsById, operationsById: w.opsById,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
    }, { onError: () => {}, onSuccess: () => {} }) || [];
    return updates.filter((e) =>
      /CREATE/i.test(String(e._effect || e.type || e.payload?.type || "")));
  };

  it("adds nothing to a slot that already holds that row", () => {
    const w = world();
    const today = ensureTodaysColumn(w);

    // What today's column already holds, per slot.
    const held = new Map();
    for (const sid of today.occurrences || []) {
      const slot = w.occurrencesById[sid];
      if (!slot) continue;
      held.set(sid, new Set((slot.occurrences || [])
        .map((k) => w.occurrencesById[k]).filter(Boolean).map((o) => identity(w, o))));
    }
    expect([...held.values()].some((s) => s.size > 0),
      "today's column holds nothing — this test proves nothing").toBe(true);

    // A CREATE landing in a slot that already holds that identity is the
    // duplicate. `parent` is the slot the row is being added to.
    const offenders = [];
    for (const c of createsFrom(w)) {
      const cfg = c.payload || c;
      const parent = cfg.parentId || cfg.parent;
      if (!held.has(parent)) continue;
      const mod = cfg.moduleId || cfg.templateId;
      const sig = cfg.identitySignature;
      const key = sig ? `sig:${sig}` : `mod:${mod}|null|null`;
      if (held.get(parent).has(key))
        offenders.push(`${w.labelOf?.(parent) || parent} <- ${key}`);
    }
    expect(offenders, "the sweep would add a row a slot already holds").toEqual([]);
  });
});
