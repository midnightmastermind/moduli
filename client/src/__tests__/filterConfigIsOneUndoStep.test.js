// DEACTIVATING A FILTER IS ONE UNDO STEP — AND IT IS UNDOABLE AT ALL.
//
// Found rebuilding poms grid through the UI (2026-09-22), first pass over the
// FILTER cascade: turning the inherited date filter OFF on one container (the
// header's filter chevron -> Filter tab -> Active) and reading the transactions
// collection back —
//
//   seq 2125  action 01b43867  filterNavConfig  {} -> {filter_…: {visible:false}}
//   seq 2126  action null      filterOverride   null -> {…: null}
//
// One gesture, two transactions, and the one that DOES something — the mute
// that deactivates the filter — carries no action id, so the server records it
// `derived` and the undo stack skips it entirely. Ctrl+Z un-hid the nav widget
// and left the filter off: the user's actual change is unreachable by undo.
//
// `CommitHelpers.updateOccurrence` opens an action (withAction); its sibling
// `updateOccurrenceFilterOverride` calls safeEmit bare, deliberately — the
// operation effect UPDATE_ITEM_FILTER_OVERRIDE goes through the same helper and
// MUST stay derived (an op moving a page's date is not a thing the user undoes).
// So the stamp belongs on the GESTURE, which is what helpers/filterConfig is.
//
// The line: NAVIGATING a filter is not an edit (the toolbar's date step writes
// no transaction at all); CONFIGURING one is.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetActionScope } from "../helpers/actionScope";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as filterConfig from "../helpers/filterConfig";

beforeEach(() => _resetActionScope());

const DATE = "fld-date";
const NAV = "filter_daily";

function run(fn) {
  const emitted = [];
  const socket = {
    connected: true,
    emit: (event, data) => emitted.push({ event, actionId: data?.__actionId }),
    on: vi.fn(), off: vi.fn(), io: { opts: {} },
  };
  fn({ dispatch: vi.fn(), socket });
  const writes = emitted.filter((e) => e.event === "update_occurrence");
  return { writes, ids: [...new Set(writes.map((w) => w.actionId ?? null))] };
}

const occurrence = { id: "occ-1", filterOverride: null, filterNavConfig: {} };
const maps = { occurrencesById: { "occ-1": occurrence }, modulesById: {} };

describe("a filter CONFIGURATION change is one undo step", () => {
  it("deactivateFilter writes the mute AND the nav hide under ONE action", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      filterConfig.deactivateFilter({
        dispatch, socket, occurrence, fieldId: DATE,
        overrides: {}, navConfig: {}, navFilterId: NAV, navWasOn: true, ...maps,
      }));
    expect(writes.length, "the gesture writes both halves").toBe(2);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0], "the write carries no action id at all").toBeTruthy();
  });

  it("deactivateFilter with the nav already hidden writes only the mute — still stamped", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      filterConfig.deactivateFilter({
        dispatch, socket, occurrence, fieldId: DATE,
        overrides: {}, navConfig: {}, navFilterId: NAV, navWasOn: false, ...maps,
      }));
    expect(writes).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  it("activateFilter (re-enable by writing a value) is undoable", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      filterConfig.activateFilter({
        dispatch, socket, occurrence, fieldId: DATE,
        overrides: {}, value: "2026-09-22", ...maps,
      }));
    expect(writes).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  it("clearFilterOverride (relock / remove a local filter) is undoable", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      filterConfig.clearFilterOverride({
        dispatch, socket, occurrence, fieldId: DATE,
        overrides: { [DATE]: "2026-09-21" }, ...maps,
      }));
    expect(writes).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  // THE CONTROL. Without it, "the gesture is stamped" is equally satisfied by
  // wrapping the CommitHelper itself — which would make every operation-driven
  // date change an undo step and bury the user's own gestures under them.
  it("the raw helper stays UNSTAMPED, so an op's filter write is still derived", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.updateOccurrenceFilterOverride({
        dispatch, socket, id: "occ-1", filterOverride: { [DATE]: null },
        navFieldId: DATE, date: null, ...maps,
      }));
    expect(writes).toHaveLength(1);
    expect(ids[0], "an op effect must not become an undo step").toBeNull();
  });
});
