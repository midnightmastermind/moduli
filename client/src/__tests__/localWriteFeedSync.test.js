/**
 * localWriteFeedSync.test.js
 *
 * A feed is materialized by `syncAllFeeds`, and every call site that schedules
 * it lives in `bindSocketToStore`'s SOCKET ECHO handlers. The server broadcasts
 * `occurrence_created` / `_updated` / `_deleted` with `socket.to(userRoom())`,
 * which EXCLUDES the sender — the originator gets a timestamp-only ack by
 * design (occurrences.js: "Targeted ack to the ORIGINATOR"). So in the tab that
 * makes the change, no local write has ever re-synced a feed: tick a task's
 * Completed in the Tasks container and it does not join `Completed` until the
 * page is reloaded or another window happens to be open.
 *
 * Measured on production before this was written: tick → +7s → the Completed
 * container still held 3 children; a reload of the SAME tab took it to 4. The
 * reload arm is the control — it proves the predicate matches, so the 3 is a
 * missing sync rather than a non-matching row.
 *
 * Same class as CLAUDE.md 2026-08-07 (2), where a grid-filter change fired its
 * NavigationOps only in the OTHER windows for exactly this reason.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOccurrence, updateOccurrence, removeOccurrence, deleteOccurrence,
} from "../helpers/CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";

function mocks() {
  return { dispatch: vi.fn(), socket: { emit: vi.fn(), connected: true } };
}
const OCC = { id: "occ1", moduleId: "m1", parentId: "p1", fields: {} };

let sched;
beforeEach(() => {
  sched = vi.fn();
  operationsBridge.scheduleFeedSync = sched;
});
afterEach(() => { operationsBridge.scheduleFeedSync = null; });

describe("a local write re-syncs feeds in the tab that made it", () => {
  test("createOccurrence schedules a sync", () => {
    const { dispatch, socket } = mocks();
    createOccurrence({ dispatch, socket, occurrence: OCC });
    expect(sched).toHaveBeenCalled();
  });

  test("updateOccurrence carrying fields schedules a sync", () => {
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "occ1", fields: { f1: { value: true } } } });
    expect(sched).toHaveBeenCalled();
  });

  test("removeOccurrence schedules a sync", () => {
    const { dispatch, socket } = mocks();
    removeOccurrence({ dispatch, socket, occurrenceId: "occ1", occurrence: OCC, parentOccurrence: { id: "p1", occurrences: ["occ1"] } });
    expect(sched).toHaveBeenCalled();
  });

  test("deleteOccurrence schedules a sync", () => {
    const { dispatch, socket } = mocks();
    deleteOccurrence({ dispatch, socket, occurrenceId: "occ1", occurrence: OCC });
    expect(sched).toHaveBeenCalled();
  });
});

describe("the two writes that must NOT schedule one", () => {
  // feedSync's own mints and sweeps all pass fireTrigger:false, and each
  // carries the comment "derived data". Without this the engine reschedules
  // itself off its own writes on every pass.
  test("a DERIVED create (a feed's own mint) does not", () => {
    const { dispatch, socket } = mocks();
    createOccurrence({ dispatch, socket, occurrence: OCC, fireTrigger: false });
    expect(sched).not.toHaveBeenCalled();
  });

  test("a DERIVED remove (a feed's own sweep) does not", () => {
    const { dispatch, socket } = mocks();
    removeOccurrence({ dispatch, socket, occurrenceId: "occ1", occurrence: OCC,
      parentOccurrence: { id: "p1", occurrences: ["occ1"] }, fireTrigger: false });
    expect(sched).not.toHaveBeenCalled();
  });

  // Typing in a doc debounce-writes the whole textmap. No feed predicate can
  // read a textmap — conditions are `fields.<id>.value`, roles and ancestry —
  // so a full pass over every feed on the grid per typing pause is pure cost.
  // This is the ONE exclusion, and it is a denylist on purpose: enumerating
  // the keys that DO affect a feed is how the 2026-08-05 APPLY_TEMPLATE role
  // gate silently stopped covering the case its own comment described.
  test("a textmap-only update does not", () => {
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "occ1", textmap: { type: "doc", content: [] } } });
    expect(sched).not.toHaveBeenCalled();
  });

  test("...but a write carrying a textmap AND fields still does", () => {
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "occ1", textmap: { type: "doc" }, fields: { f1: { value: 1 } } } });
    expect(sched).toHaveBeenCalled();
  });
});

test("an unbound bridge is not a crash — the sync is wiring, not a dependency", () => {
  operationsBridge.scheduleFeedSync = null;
  const { dispatch, socket } = mocks();
  expect(() => createOccurrence({ dispatch, socket, occurrence: OCC })).not.toThrow();
});
