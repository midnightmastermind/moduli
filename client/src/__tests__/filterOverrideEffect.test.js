// client/src/__tests__/filterOverrideEffect.test.js
//
// `updateOccurrenceFilterOverride` destructures `{ id }` and bails on
// `if (!id) return`. The UPDATE_ITEM_FILTER_OVERRIDE effect handler passed
// `occurrenceId` instead, so the helper returned immediately: no dispatch, no
// socket emit, no NavigationOp cascade. Net effect — NO operation could move a
// page's filter override, which is exactly why `Grid: Snap Filter To Today`
// advanced its marker every morning but left the Day Page and Schedule pinned
// to the previous day (user 2026-08-02: "the daypage didnt open today").
//
// This pins the CONTRACT (which key the helper accepts) rather than reaching
// into bindSocketToStore's socket wiring.
import { describe, it, expect, vi } from "vitest";
import { updateOccurrenceFilterOverride } from "../helpers/CommitHelpers";

const occId = "day-page-occ";
const DATE_FID = "Eh7oi4HKdbHB";

function harness() {
  const dispatch = vi.fn();
  const socket = { connected: true, emit: vi.fn() };
  const occurrencesById = {
    [occId]: { id: occId, moduleId: "m1", filterOverride: { [DATE_FID]: "2026-08-01" }, occurrences: [] },
  };
  const modulesById = { m1: { id: "m1", label: "Day Page", role: "page" } };
  return { dispatch, socket, occurrencesById, modulesById };
}

const writesOf = (socket) => socket.emit.mock.calls.filter(([e]) => e === "update_occurrence");

describe("updateOccurrenceFilterOverride — the key it needs", () => {
  it("persists the new override when called with `id`", () => {
    const h = harness();
    updateOccurrenceFilterOverride({
      dispatch: h.dispatch, socket: h.socket,
      id: occId,
      filterOverride: { [DATE_FID]: "2026-08-02" },
      occurrencesById: h.occurrencesById, modulesById: h.modulesById,
      navFieldId: DATE_FID, date: "2026-08-02",
    });

    expect(h.dispatch).toHaveBeenCalled();
    const writes = writesOf(h.socket);
    expect(writes).toHaveLength(1);
    expect(writes[0][1].occurrence).toMatchObject({
      id: occId,
      filterOverride: { [DATE_FID]: "2026-08-02" },
    });
  });

  it("does NOTHING when called with `occurrenceId` — the shape that was shipped", () => {
    const h = harness();
    updateOccurrenceFilterOverride({
      dispatch: h.dispatch, socket: h.socket,
      occurrenceId: occId,                       // the bug
      filterOverride: { [DATE_FID]: "2026-08-02" },
      occurrencesById: h.occurrencesById, modulesById: h.modulesById,
      navFieldId: DATE_FID, date: "2026-08-02",
    });

    expect(h.dispatch).not.toHaveBeenCalled();
    expect(writesOf(h.socket)).toHaveLength(0);
  });

  it("a null value clears the key so the page inherits its parent's filter", () => {
    const h = harness();
    updateOccurrenceFilterOverride({
      dispatch: h.dispatch, socket: h.socket,
      id: occId,
      filterOverride: {},                        // key removed
      occurrencesById: h.occurrencesById, modulesById: h.modulesById,
      navFieldId: DATE_FID, date: null,
    });

    const writes = writesOf(h.socket);
    expect(writes).toHaveLength(1);
    expect(writes[0][1].occurrence.filterOverride).toEqual({});
  });
});
