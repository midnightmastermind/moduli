/**
 * localOverlayFollowsWrite.test.js
 *
 * `localOccsById` is the client's overlay of the freshest known occurrence
 * state, and `scheduleFeedSync` merges it OVER Redux:
 *
 *     Object.assign(occs, localOccsById);      // the overlay WINS
 *
 * So an entry the overlay never refreshes does not merely go stale — it
 * OVERRULES the correct value. `_updateOccurrence` refreshed it by spreading
 * `...localPrev` and patching only the timestamps, so a write that changes
 * `occurrences[]` (every child-list write — `addInstanceToContainer`, the feed
 * engine's re-link, a drop) left the child list frozen at its pre-write value
 * and re-stamped it as fresh.
 *
 * MEASURED ON THE LIVE GRID — one checkbox tick, then every 2.2 seconds
 * forever, for as long as the tab stayed open:
 *
 *   [feedDiag] RELINK copy=1787860129457-8ndxm8uxj
 *              parentOccUsed=15  reduxParent=16  reduxListsCopy=true
 *
 * Redux held the correct 16-entry list; the overlay's frozen 15 won, so
 * feedSync's step 3b concluded the copy was unlisted and re-linked it — and
 * the write it made refreshed only the timestamp, so the next pass concluded
 * exactly the same thing. 104 writes in 240 seconds and still going when the
 * probe gave up; the server logged `dropped 1 unknown child id(s)` 104 times.
 *
 * The DATA never broke — the server's own `mergeStaleChildArray` restored the
 * child every time. Two correct guards fighting: the client re-attacking a
 * list the server kept repairing.
 *
 * The overlay now takes the write it just made, with the SAME shallow-merge
 * semantics the server applies (`{ ...prev, ...payload }`,
 * socketHandlers/occurrences.js) — a partial patch replaces the keys it
 * carries and leaves the rest, so the two cannot disagree about what a write
 * meant.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";

function mocks() {
  return { dispatch: vi.fn(), socket: { emit: vi.fn(), connected: true } };
}

let local;
beforeEach(() => {
  local = {};
  operationsBridge.updateLocalOcc = (o) => { if (o?.id) local[o.id] = o; };
  operationsBridge.getLocalOcc = (id) => local[id] || null;
  operationsBridge.getLinkedOccs = () => [];
  operationsBridge.getAncestorChain = () => ({ ids: [], labels: [] });
});
afterEach(() => {
  operationsBridge.updateLocalOcc = null;
  operationsBridge.getLocalOcc = null;
  operationsBridge.getLinkedOccs = null;
  operationsBridge.getAncestorChain = null;
});

describe("the local overlay follows the write that was just made", () => {
  test("a child-list write lands in the overlay", () => {
    const { dispatch, socket } = mocks();
    local.p1 = { id: "p1", occurrences: ["a"], updatedAt: "T0" };
    updateOccurrence({ dispatch, socket, occurrence: { id: "p1", occurrences: ["a", "b"] } });
    // Without this the overlay keeps ["a"] and OVERRULES Redux's ["a","b"],
    // so the next feed pass re-links "b" — forever.
    expect(local.p1.occurrences).toEqual(["a", "b"]);
  });

  test("it still refreshes updatedAt — the stale-write guard depends on it", () => {
    const { dispatch, socket } = mocks();
    local.p1 = { id: "p1", occurrences: ["a"], updatedAt: "T0" };
    updateOccurrence({ dispatch, socket, occurrence: { id: "p1", occurrences: ["a", "b"] } });
    expect(local.p1.updatedAt).not.toBe("T0");
  });

  test("A PARTIAL PATCH LEAVES UNMENTIONED KEYS ALONE — the control", () => {
    // The merge must be the server's: keys the payload carries replace, keys
    // it omits survive. Overwriting the whole entry would drop the label,
    // parentId and moduleId that every later read depends on.
    const { dispatch, socket } = mocks();
    local.p1 = { id: "p1", occurrences: ["a"], label: "Completed", parentId: "page1", moduleId: "m1" };
    updateOccurrence({ dispatch, socket, occurrence: { id: "p1", occurrences: ["a", "b"] } });
    expect(local.p1.label).toBe("Completed");
    expect(local.p1.parentId).toBe("page1");
    expect(local.p1.moduleId).toBe("m1");
  });

  test("a fields write replaces the fields map, exactly as the server does", () => {
    // server/socketHandlers/occurrences.js: `{ ...prev, ...occWithoutTextmap }`
    // is a SHALLOW spread — a fields payload replaces the map wholesale. The
    // overlay has to agree, or operations read a map the server does not hold.
    const { dispatch, socket } = mocks();
    local.p1 = { id: "p1", fields: { f1: { value: 1 } }, occurrences: ["a"] };
    updateOccurrence({ dispatch, socket, occurrence: { id: "p1", fields: { f2: { value: 2 } } } });
    expect(local.p1.fields).toEqual({ f2: { value: 2 } });
    expect(local.p1.occurrences).toEqual(["a"]);   // untouched key survives
  });

  test("no overlay entry yet — nothing is invented", () => {
    // `localPrev` absent means this occurrence is not in the overlay; the
    // write must not seed a partial entry that would then OVERRULE Redux's
    // complete one on the next merge.
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "ghost", occurrences: ["a"] } });
    expect(local.ghost).toBeUndefined();
  });
});
