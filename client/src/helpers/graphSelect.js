// helpers/graphSelect.js
//
// A click on a graph part (a wheel slice, a bar, a point) is a USER GESTURE, and
// every write its operation makes belongs to ONE undo step.
//
// It used to fire with no action open, so `safeEmit` stamped no `__actionId`
// and the server recorded every write as DERIVED, which the undo stack skips.
// Measured 2026-09-19: after a mood pick the only undoable rows were the day
// column's own text saves, and the pick itself (the Check In, the Mood value,
// the embed) was 49 derived writes. User: *"i went to select a mood on the
// board and pressed the undo button ... and nothing happened."*
//
// `withAction` is the same wrapper every write helper uses (CommitHelpers).
// The op runs synchronously inside it; the deferred MeasureOp continuations
// carry it along via `captureAction` (state/bindSocketToStore).
import { withAction } from "./actionScope";
import { operationsBridge } from "../state/bindSocketToStore";

export function fireGraphSelect(transaction) {
  const name = transaction?.name;
  return withAction(name ? `Selected ${name}` : "Selected on graph", () =>
    operationsBridge.fireOperations?.("GraphSelectOp", transaction));
}
