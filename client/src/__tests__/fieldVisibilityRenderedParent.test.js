/**
 * fieldVisibilityRenderedParent.test.js
 *
 * A row listed by TWO parents renders under whichever one is on screen, but the
 * cascade walked `buildParentMap`, which keeps ONE lister per child — the last
 * one scanned. Live case (2026-09-25, "Follow-Up Therapy with Julie S"): an ICS
 * share lands in Tasks › Appointments; filling Date + Time Slot lets
 * `Schedule: Place Dated Work` also list it in the 9:00am slot, and from then on
 * the row in Appointments resolved through the SCHEDULE page's hide list
 * (Time Slot, Last Seen, Date) — the fields the user had just filled vanished.
 *
 * `viaParentId` names the parent the row is rendered in; the first hop goes
 * there, the rest of the walk is unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveFieldVisibilityForOccurrence,
  getEffectiveFieldRevealForOccurrence,
} from "../state/selectors";

const SCHEDULE_HIDE = { mode: "hide", fieldIds: ["tags", "slot", "lastSeen", "date"] };
const TASKS_HIDE = { mode: "hide", fieldIds: ["tags"] };

// Order matters: the 9:00am slot is scanned LAST, so buildParentMap picks it.
const occs = [
  { id: "tasks", fieldVisibility: TASKS_HIDE, fieldReveal: "always", occurrences: ["appts"] },
  { id: "appts", parentId: "tasks", occurrences: ["row"] },
  { id: "schedule", fieldVisibility: SCHEDULE_HIDE, fieldReveal: "hover", occurrences: ["slot9"] },
  { id: "slot9", parentId: "schedule", occurrences: ["row"] },
  { id: "row", parentId: "appts" },
];
const occurrencesById = Object.fromEntries(occs.map(o => [o.id, o]));
const row = occurrencesById.row;

describe("field visibility follows the parent the row is rendered in", () => {
  it("control: with no rendering parent the reverse map's lister decides (the Schedule)", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(row, { occurrencesById })).toEqual(SCHEDULE_HIDE);
  });

  it("rendered in Appointments -> the Tasks page's list, Date and Time Slot show", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(row, { occurrencesById, viaParentId: "appts" }))
      .toEqual(TASKS_HIDE);
  });

  it("rendered in the 9:00am slot -> the Schedule page's list", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(row, { occurrencesById, viaParentId: "slot9" }))
      .toEqual(SCHEDULE_HIDE);
  });

  it("the row's OWN setting still wins over either parent", () => {
    const own = { ...row, fieldVisibility: { mode: "off" } };
    expect(getEffectiveFieldVisibilityForOccurrence(own, { occurrencesById, viaParentId: "slot9" })).toBeNull();
  });

  it("an unknown rendering parent falls back to the normal walk", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(row, { occurrencesById, viaParentId: "gone" }))
      .toEqual(SCHEDULE_HIDE);
  });

  it("fieldReveal takes the same first hop", () => {
    expect(getEffectiveFieldRevealForOccurrence(row, { occurrencesById })).toBe("hover");
    expect(getEffectiveFieldRevealForOccurrence(row, { occurrencesById, viaParentId: "appts" })).toBe("always");
  });
});
