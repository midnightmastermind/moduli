// __tests__/toolbarFilterSelect.test.jsx
//
// Picking a named filter in the toolbar's Filters dropdown did nothing.
// Measured on prod 2026-09-21 while building a grid by clicking: the grid had
// one filter ("Daily", SAME_DAY on the date field), the dropdown listed it,
// the radio hit-tested as the right element — and `grid.activeFilterId`
// stayed null, so no date cascade ever started and the date field's
// auto-stamp had nothing to stamp.
//
// `ToolbarFilterDropdown.setActive` called `onSelectFilter` off
// GridActionsContext. App.jsx's `actionsValue` never provides that key, so
// what ran was the context DEFAULT — `onSelectFilter: () => {}` in
// GridActionsContext.js. A stub nobody overrides is indistinguishable from a
// dead button.
//
// The same file's OTHER action (the "nav here" toggle) writes through
// CommitHelpers and works, and Command Center → Grid has a working
// `activateFilter`. So this pins the toolbar against that behaviour:
// selecting a filter must reach the socket and the store.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ToolbarFilterDropdown from "../ui/ToolbarFilterDropdown";
import { GridActionsContext } from "../GridActionsContext";

const FILTER = {
  id: "filter_daily",
  name: "Daily",
  conditions: [{ fieldId: "f_date", comparator: "SAME_DAY", isNav: true }],
  timeUnit: "day",
};

function mount({ activeFilterId = null } = {}) {
  // `connected: true` matters — CommitHelpers writes go through
  // offlineQueue.safeEmit, which QUEUES instead of emitting on a dead socket.
  const socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  const dispatch = vi.fn();
  const ctx = {
    socket, dispatch,
    state: { grid: { _id: "g1", id: "g1", namedFilters: [FILTER], activeFilterId, toolbarNavFilters: [] } },
    fieldsById: { f_date: { id: "f_date", name: "Logged On", type: "date" } },
  };
  const utils = render(
    <GridActionsContext.Provider value={ctx}>
      <ToolbarFilterDropdown />
    </GridActionsContext.Provider>,
  );
  return { ...utils, socket, dispatch };
}

/** Open the dropdown, then click the radio on the row for `label`.
 *  The row's <strong> is the nav CONDITION's FIELD name when there is one
 *  (that is what renders on screen), falling back to the filter's own name. */
function pick(utils, label) {
  const trigger = utils.container.querySelector("span [role], span button, button");
  fireEvent.click(trigger);
  const row = [...utils.baseElement.querySelectorAll("strong")]
    .find((e) => e.textContent.trim() === label);
  if (!row) throw new Error(`no filter row labelled "${label}" — saw: ${
    [...utils.baseElement.querySelectorAll("strong")].map((e) => e.textContent.trim()).join(", ")}`);
  fireEvent.click(row.closest("div").querySelector("button"));
}

beforeEach(() => vi.clearAllMocks());

describe("the toolbar's filter picker actually selects", () => {
  it("emits the active-filter write to the server", () => {
    const u = mount();
    pick(u, "Logged On");
    const call = u.socket.emit.mock.calls.find(([ev]) => ev === "update_grid_filter");
    expect(call, "no update_grid_filter reached the socket").toBeTruthy();
    expect(call[1].activeFilterId).toBe("filter_daily");
  });

  it("updates the store so the cascade starts without a round trip", () => {
    const u = mount();
    pick(u, "Logged On");
    const disp = u.dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a?.type === "UPDATE_GRID" && a?.payload?.grid?.activeFilterId !== undefined);
    expect(disp, "the optimistic store write never happened").toBeTruthy();
    expect(disp.payload.grid.activeFilterId).toBe("filter_daily");
  });

  it("tints the radio of the filter that IS active", () => {
    // The CONTROL for the render half: "it selects" must not be satisfied by a
    // dropdown that never shows an active state. The radio fills with the
    // accent colour only when `f.id === grid.activeFilterId`.
    const off = mount();
    fireEvent.click(off.container.querySelector("span [role], span button, button"));
    const offBtn = [...off.baseElement.querySelectorAll("strong")]
      .find((e) => e.textContent.trim() === "Logged On").closest("div").querySelector("button");
    expect(offBtn.getAttribute("title")).toBe("Activate filter");
    // Unmount before the second arm: both portals render into document.body,
    // so a left-over dropdown is what the next query would find.
    off.unmount();

    const on = mount({ activeFilterId: "filter_daily" });
    fireEvent.click(on.container.querySelector("span [role], span button, button"));
    const onBtn = [...on.baseElement.querySelectorAll("strong")]
      .find((e) => e.textContent.trim() === "Logged On").closest("div").querySelector("button");
    expect(onBtn.getAttribute("title")).toBe("Active");
  });
});
