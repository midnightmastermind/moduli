// utils/serialByKey.js
//
// Run async work one-at-a-time PER KEY, in arrival order; different keys run in
// parallel. update_occurrence uses it keyed by (user, occurrence id).
//
// WHY: the handler merges each write onto the cached row (`prev`) and persists
// the WHOLE merged row. Two writes to one row from the same op sweep — a field
// value and then the row's fieldVisibility — overlapped: the first one's
// post-save cache restamp put its OLDER row back over the second's, and its
// whole-row Mongo write could land after the second's. The newer change was
// erased in both places (watched in a Mongo change stream 2026-10-06: the new
// fieldVisibility landed, then a write 25ms later put the old one back).
// Waiting for the previous write to the same row makes each write start from
// the row its predecessor left.
export function createSerialByKey() {
  const tails = new Map();
  return function runSerial(key, fn) {
    const before = tails.get(key) || Promise.resolve();
    const run = before.then(() => fn());
    const tail = run.then(() => {}, () => {});
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  };
}
