// helpers/manualOpRun.js
//
// Applying what an operation returns when the USER ran it by hand — the
// trigger widget on an instance (`module.operationBindings`) and the
// `button`-type field. Both surfaces call `runMatchingOperations` directly
// rather than going through a transaction, so nothing downstream applies the
// result for them.
//
// THE BUG THIS EXISTS TO FIX: both sites kept only the DISPLAY updates —
//
//     const displayUpdates = updates.filter(u => !u._effect);
//     if (displayUpdates.length > 0) dispatch(setComputedValuesAction(displayUpdates));
//
// — and silently dropped everything carrying `_effect`, which is every real
// one: CREATE_ITEM, UPDATE_ITEM_FIELD, DELETE_ITEM, COPY_LINK, NOTIFY. So an
// operation bound to a row as a "Run" button could only ever refresh a
// computed value; a pipeline that CREATES anything did nothing and said
// nothing. Measured on prod 2026-09-21: a CREATE op behind a trigger widget
// reported a run and left the grid unchanged.
//
// `operationsBridge.applyEffect` is the same single-effect applier the
// scheduler uses for cadence-fired ops (bindSocketToStore), so a hand-run op
// now lands exactly like a scheduled one.
import { setComputedValuesAction } from "../state/actions";
import { operationsBridge } from "../state/bindSocketToStore";

/**
 * @param {Array<object>} updates  what runMatchingOperations returned
 * @param {{dispatch?: Function}} ctx
 */
export function applyManualOpUpdates(updates, { dispatch } = {}) {
  if (!Array.isArray(updates) || updates.length === 0) return { display: 0, effects: 0 };

  const displayUpdates = updates.filter((u) => u && !u._effect);
  if (displayUpdates.length > 0) dispatch?.(setComputedValuesAction(displayUpdates));

  let effects = 0;
  for (const eff of updates) {
    // `_suspend` is a sentinel the executor returns for GET_USER_INPUT /
    // CALL_API continuations, not an effect to apply — the socket path skips
    // it the same way (bindSocketToStore).
    if (!eff?._effect || eff._suspend) continue;
    operationsBridge.applyEffect?.(eff);
    effects += 1;
  }
  return { display: displayUpdates.length, effects };
}
