// helpers/buttonRun.js — THE way a button press runs its operation.
//
// Two surfaces press buttons: a `button` field (ui/Field.jsx) and an instance's "Run" widget
// (modules/ModuleInstance.jsx). They each built their own transaction — and the field put the OCCURRENCE id in
// `instanceId`, which everywhere else is the module id. One runner now (user, 2026-10-25: "make sure that button
// field inputs work, its refined, and it works with operations and i can place them on any occurance").
//
// A press runs exactly the named operation (matchesTrigger reads `operationId`). The promise resolves when the
// pipeline is DONE — after every pause (a question, a form, an API call) — through the executor's
// `_onPipelineDone`, so the button can stay busy while a form is open and refuse a second press.
import { useCallback, useRef, useState } from "react";
import { runMatchingOperations } from "./operationExecutor";
import { applyManualOpUpdates } from "./manualOpRun";
import { withAction } from "./actionScope";

/** The ButtonOp transaction for a press of `op` on `hostOccurrence` (the button field `fieldId`, when there is one). */
export function buttonTransaction({ op, hostOccurrence, fieldId = null }) {
  return {
    type: "ButtonOp",
    operationId: op?.id || null,
    occurrenceId: hostOccurrence?.id || null,
    instanceId: hostOccurrence?.moduleId || null,
    fieldId: fieldId || null,
  };
}

/**
 * Run `op` for a press on `hostOccurrence`. `ctx` = { state, fieldsById, operationsById, occurrencesById,
 * modulesById?, dispatch }. Resolves { ran: true } once the pipeline has finished (paused ones included), or
 * { ran: false, reason } when there was nothing to run.
 */
export function runButtonOperation({ op, hostOccurrence, fieldId = null, ctx = {} }) {
  if (!op) return Promise.resolve({ ran: false, reason: "no operation" });
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; resolve({ ran: true }); } };
    const transaction = buttonTransaction({ op, hostOccurrence, fieldId });
    const label = op.name || "button";
    try {
      withAction(`Pressed ${label}`, () => {
        const updates = runMatchingOperations([op], "ButtonOp", transaction, {
          state: ctx.state, fieldsById: ctx.fieldsById, operationsById: ctx.operationsById,
          occurrencesById: ctx.occurrencesById, ...(ctx.modulesById ? { modulesById: ctx.modulesById } : {}),
          _onPipelineDone: finish,
        });
        applyManualOpUpdates(updates, { dispatch: ctx.dispatch });
      });
    } catch (err) {
      console.warn(`[button] ${label} failed:`, err);
      finish();
    }
  });
}

/** `{ busy, run }` — `run(args)` presses once; while that press is still running, more presses are ignored. */
export function useButtonRunner() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const run = useCallback((args) => {
    if (pending.current) return Promise.resolve({ ran: false, reason: "busy" });
    pending.current = true;
    setBusy(true);
    return runButtonOperation(args).finally(() => { pending.current = false; setBusy(false); });
  }, []);
  return { busy, run };
}
