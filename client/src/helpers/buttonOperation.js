// helpers/buttonOperation.js — ask the Command Center to open an operation in its Operations tab (a button field's
// settings list the operations listening to it; clicking one opens it here).

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
