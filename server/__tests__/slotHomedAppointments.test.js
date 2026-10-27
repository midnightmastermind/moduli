import { test, expect } from "vitest";
import { planMoves } from "../migrations/0448-slot-homed-appointments-to-appointments.mjs";

const F = "fmt";
const world = [
  { id: "slotA", moduleId: "s", fields: { [F]: { value: "slot" } }, occurrences: ["homed"] },
  { id: "slotB", moduleId: "s", fields: { [F]: { value: "slot" } }, occurrences: ["homed", "listed"] },
  { id: "appts", moduleId: "c", fields: {}, occurrences: ["listed"] },
  { id: "homed", moduleId: "appt", parentId: "slotA", fields: {} },
  { id: "listed", moduleId: "appt", parentId: "appts", fields: {} },
  { id: "copy", moduleId: "appt", parentId: "slotA", fields: {}, meta: { datedWork: true } },
  { id: "feed", moduleId: "appt", parentId: "slotA", fields: {}, meta: { feedSourceId: "x" } },
  { id: "task", moduleId: "task", parentId: "slotA", fields: {} },
];
const opts = { isAppointmentModule: (m) => m === "appt", slotFormatFieldId: F };

test("moves only an appointment homed in a slot, and names every slot listing it", () => {
  expect(planMoves(world, opts)).toEqual([{ id: "homed", from: "slotA", unlistFrom: ["slotA", "slotB"] }]);
});
test("a second run plans nothing", () => {
  const moved = world.map((o) => o.id === "homed" ? { ...o, parentId: "appts" }
    : o.id.startsWith("slot") ? { ...o, occurrences: o.occurrences.filter((c) => c !== "homed") } : o);
  expect(planMoves(moved, opts)).toEqual([]);
});
