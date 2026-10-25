// helpers/buttonOperation.js — "New operation for this button": a button field's settings make the operation the
// button runs, point the field at it, and open it in the Operations tab.
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { uid } from "../uid";
import { DEFAULT_TRIGGER_PRIORITY } from "./triggerTypes";

/** An On Button operation scoped to `field`, named for the button (its label, else the field's name). */
export function makeButtonOperation(field, { gridId, id = uid(), folderId = null } = {}) {
  const trigger = { eventType: "onButton", subjectType: "field", targetId: field.id, priority: DEFAULT_TRIGGER_PRIORITY };
  return {
    id, gridId,
    name: field?.meta?.buttonLabel || field?.name || "Button",
    description: "",
    pipeline: { sources: [], steps: [] },
    triggerObjects: [trigger], triggerTypes: ["onButton"], triggerType: "onButton",
    enabled: true, folderId,
  };
}

/** The trigger that makes an existing operation runnable from `field`'s button (null when it already has one). */
export function buttonTriggerFor(op, field) {
  const has = (op?.triggerObjects || []).some((t) => t?.eventType === "onButton"
    && (!t.targetId || t.targetId === field.id));
  if (has) return null;
  return { eventType: "onButton", subjectType: "field", targetId: field.id, priority: DEFAULT_TRIGGER_PRIORITY };
}

// The Operations tab reads this when it mounts or hears the event, so a request made while the tab is not shown
// still opens the operation once it is.
let requested = null;
export const OPEN_OPERATION_EVENT = "moduli:open-operation";

export function requestOpenOperation(opId) {
  requested = opId;
  try { window.dispatchEvent(new CustomEvent(OPEN_OPERATION_EVENT, { detail: { opId } })); } catch { /* no window */ }
}

/** The pending request, once. */
export function takeRequestedOperation() {
  const id = requested;
  requested = null;
  return id;
}

/** Create the operation and save the field pointing at it — one undo step — then ask to open it. Returns its id. */
export function createButtonOperation({ field, gridId, dispatch, socket, onSave }) {
  const op = makeButtonOperation(field, { gridId });
  withAction("New button operation", () => {
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    onSave?.({ ...field, meta: { ...(field.meta || {}), operationId: op.id } });
  });
  requestOpenOperation(op.id);
  return op.id;
}
