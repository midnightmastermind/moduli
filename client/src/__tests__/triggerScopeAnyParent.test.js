// @vitest-environment jsdom
// A trigger's scope ("in Schedule") must see a row through ANY parent that lists
// it. getAncestorChain built its own reverse map where the LAST lister of a child
// won, so a row in the Schedule's Todo — which the day page lists too — walked up
// through the day page and every "in Schedule" onAdd/onMove/onDelete missed it.
// Watched 2026-10-05: `Schedule: Stamp Date & Time Slot` never ran for an add to
// today's Todo, so the row got no Date and the trackers' period gate dropped it.
import { describe, it, expect, vi } from "vitest";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

function setup(order) {
  const socket = { on() {}, emit() {}, connected: true };
  const rows = {
    schedule: { id: "schedule", moduleId: "mP", occurrences: ["schedCol"] },
    schedCol: { id: "schedCol", moduleId: "mC", parentId: "schedule", occurrences: ["todo"] },
    dayPage: { id: "dayPage", moduleId: "mP2", occurrences: ["dayCol"] },
    dayCol: { id: "dayCol", moduleId: "mC2", parentId: "dayPage", occurrences: ["todo"] },
    todo: { id: "todo", moduleId: "mT", parentId: "schedCol", occurrences: ["row"] },
    row: { id: "row", moduleId: "mI", parentId: "todo" },
  };
  const occurrences = order.map((k) => rows[k]);
  const modules = [{ id: "mP", label: "Schedule", role: "page" }, { id: "mP2", label: "Day Page", role: "page" }, { id: "mC", label: "Schedule col", role: "container" }, { id: "mC2", label: "Day col", role: "container" }, { id: "mT", label: "Todo", role: "container" }, { id: "mI", label: "Row", role: "instance" }];
  bindSocketToStore(socket, () => {}, { current: { modules, occurrences, operations: [], fields: [], grid: { activeFilterValues: {} } } });
  occurrences.forEach((o) => operationsBridge.updateLocalOcc(o));
}

describe("getAncestorChain — the scope a trigger is matched against", () => {
  it("reaches the Schedule when the day page lists the Todo AFTER the Schedule column", () => {
    setup(["schedule", "schedCol", "dayPage", "dayCol", "todo", "row"]); // dayCol is the last lister
    const { ids, labels } = operationsBridge.getAncestorChain("row");
    expect(ids).toContain("schedule");
    expect(ids).toContain("dayPage"); // under both, through either parent
    expect(labels).toContain("Schedule");
  });
  it("…and when it lists it first (storage order must not decide)", () => {
    setup(["dayPage", "dayCol", "schedule", "schedCol", "todo", "row"]);
    expect(operationsBridge.getAncestorChain("row").ids).toContain("schedule");
  });
  it("starts with the row itself, then its home chain closest-first", () => {
    setup(["schedule", "schedCol", "dayPage", "dayCol", "todo", "row"]);
    expect(operationsBridge.getAncestorChain("row").ids.slice(0, 4)).toEqual(["row", "todo", "schedCol", "schedule"]);
  });
  it("CONTROL — a row under one parent only does not gain the other's ancestors", () => {
    setup(["schedule", "schedCol", "dayPage", "dayCol", "todo", "row"]);
    expect(operationsBridge.getAncestorChain("dayCol").ids).not.toContain("schedule");
  });
});
