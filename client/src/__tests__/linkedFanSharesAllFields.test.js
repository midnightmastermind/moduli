/**
 * A copy-link group shares EVERY field and value, on screen in the same frame
 * as on the server (user, 2026-10-27: "copylink should always share the same
 * fields and values"). Date and Time Slot used to be held back; see
 * server/__tests__/linkedGroupFansFilterField.test.js.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { updateOccurrence } from "../helpers/CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";

let local;
beforeEach(() => {
  local = {
    a: { id: "a", linkedGroupId: "lg", fields: {} },
    b: { id: "b", linkedGroupId: "lg", fields: {} },
    c: { id: "c", fields: {} },
  };
  operationsBridge.updateLocalOcc = (o) => { if (o?.id) local[o.id] = { ...local[o.id], ...o }; };
  operationsBridge.getLocalOcc = (id) => local[id] || null;
  operationsBridge.getLinkedOccs = (lg, ex) => Object.values(local).filter(o => o.linkedGroupId === lg && o.id !== ex);
  operationsBridge.getAncestorChain = () => ({ ids: [], labels: [] });
});
afterEach(() => {
  for (const k of ["updateLocalOcc", "getLocalOcc", "getLinkedOccs", "getAncestorChain"]) operationsBridge[k] = null;
});

test("a linked copy takes every field, Date and Time Slot included", () => {
  updateOccurrence({
    dispatch: vi.fn(), socket: { emit: vi.fn(), connected: true },
    occurrence: { id: "a", fields: {
      date: { value: "2026-11-02", flow: "replace" },
      slot: { value: "3:00pm", flow: "replace" },
      done: { value: true, flow: "replace" },
    } },
  });
  expect(local.b.fields.date.value).toBe("2026-11-02");
  expect(local.b.fields.slot.value).toBe("3:00pm");
  expect(local.b.fields.done.value).toBe(true);
  expect(local.c.fields.date).toBeUndefined();   // not in the group
});
