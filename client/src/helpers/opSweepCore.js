// helpers/opSweepCore.js
//
// THE LOAD SWEEP AS A PURE FUNCTION OF A SNAPSHOT — what the op-sweep worker runs (user, 2026-10-14: "its
// mostly not letting the operation after load make scrolling slow down"). It builds the same context
// `bindSocketToStore.runLoadSweep` builds and calls the same `runMatchingOperations`, so the effects are the
// page's effects; the page applies them exactly as before. Nothing here touches the page: the snapshot is
// plain data and the result is plain data (effects + which ops ran, for the notification pills).
import { runMatchingOperations, shouldTrigger } from "./operationExecutor";

/**
 * @param {{ occurrences:Array, modules:Array, fields:Array, operations:Array, grid:object, gridId:string,
 *           folders:Array }} snap
 * @returns {{ updates:Array, ran:Array<{name, results, meta}>, errors:Array<{name, message}> }}
 */
export function runSweepSnapshot(snap) {
  const operations = snap.operations || [];
  const fieldsById = {};
  for (const f of snap.fields || []) fieldsById[f.id] = f;
  const operationsById = {};
  for (const o of operations) operationsById[o.id] = o;
  const modulesById = {};
  for (const m of snap.modules || []) if (m?.id) modulesById[m.id] = m;
  const occurrencesById = {};
  for (const o of snap.occurrences || []) {
    const id = o.id || o._id?.toString?.();
    if (id) occurrencesById[id] = { ...o, id };
  }
  const state = { grid: snap.grid, gridId: snap.gridId, modules: snap.modules || [], folders: snap.folders || [],
    fields: snap.fields || [], operations, occurrencesById };
  const ran = [], errors = [];
  const updates = runMatchingOperations(operations, null, null, { state, fieldsById, operationsById, occurrencesById, modulesById }, {
    // The executor reports by op NAME; the page replays these into its notification callbacks.
    onSuccess: (name, results, meta) => ran.push({ name, results, meta: meta ? { eventType: meta.eventType ?? null } : null }),
    onError: (name, err) => errors.push({ name, message: String(err?.message || err) }),
  });
  return { updates: updates || [], ran, errors };
}

/** Actions a worker cannot carry out (they ask the page: a prompt, a fetch, an import, a toast or a sound). */
const PAGE_ACTIONS = /^(GET_USER_INPUT|CALL_API|IMPORT_HTML|IMPORT_MARKDOWN|READ_FILE|NOTIFY)$/;

/** PURE. May this op run in the worker? No step anywhere in its pipeline may need the page. */
export function workerSafeOp(op) {
  const walk = (steps) => (steps || []).every((s) => {
    const t = s?.config?.type || s?.action;
    if (t && PAGE_ACTIONS.test(t)) return false;
    return walk(s?.then) && walk(s?.else) && walk(s?.body);
  });
  return walk(op?.pipeline?.steps);
}

/** The ops an op calls with RUN_OPERATION (by id or name), anywhere in its pipeline. */
function calledOps(op, byId, byName) {
  const out = [];
  const walk = (steps) => { for (const s of steps || []) {
    const c = s?.config || {};
    if ((c.type || s?.action) === "RUN_OPERATION") { const t = byId[c.operationId] || byName[c.operationName]; if (t) out.push(t); }
    walk(s?.then); walk(s?.else); walk(s?.body);
  } };
  walk(op?.pipeline?.steps);
  return out;
}

/**
 * PURE. Can the LOAD sweep run in the worker? Only the ops it would run count — every enabled op the load
 * matches, and everything those call through RUN_OPERATION, transitively. An alarm that rings with a toast
 * is never run by the load, so it does not keep the sweep on the page.
 */
export function loadSweepWorkerSafe(operations) {
  const byId = {}, byName = {};
  for (const o of operations || []) { byId[o.id] = o; if (o.name) byName[o.name] = o; }
  const seen = new Set();
  const queue = (operations || []).filter((o) => o?.enabled !== false && shouldTrigger(o, null, null));
  while (queue.length) {
    const op = queue.pop();
    if (!op || seen.has(op.id)) continue;
    seen.add(op.id);
    if (!workerSafeOp(op)) return false;
    queue.push(...calledOps(op, byId, byName));
  }
  return true;
}
