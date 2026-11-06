// helpers/deferredCommit.js — let a control paint its own state before the work its change sets off.
//
// The date picker's day click set its selection and called onCommit in one handler, and onCommit runs the filter
// change: the grid write, the operations that listen to the date, the re-render of every dated board. The picked
// day could not paint until all of that finished (0.4-0.9s on a phone at 4x CPU, measured 2026-11-06).
// push(value) keeps only the latest value and commits it after the paint; flush() commits a waiting value now
// (the picker closing, or unmounting, must not drop a pick).
import { afterPaint } from "./afterPaint.js";

export function createDeferredCommit(commit, schedule = afterPaint) {
  let pending = null; // { value } while a commit is waiting
  let cancel = null;
  const run = () => {
    cancel = null;
    if (!pending) return;
    const { value } = pending; pending = null;
    commit(value);
  };
  return {
    push(value) {
      pending = { value };
      if (!cancel) cancel = schedule(run);
    },
    flush() {
      if (cancel) { cancel(); cancel = null; }
      run();
    },
  };
}
