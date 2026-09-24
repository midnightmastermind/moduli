// A calendar invite shared over REAL HTTP (multipart, real multer), through the
// REAL ingress, rule engine and server executor, by a rule written in the
// shape the Imports tab's editor writes (Plan 2, Task 4's rule). Only the final
// database write (the mint) and the models are faked.
//
// What it proves: each event becomes ONE row whose label is the SUMMARY (D4),
// whose Date / Time Slot / Duration are written and whose Schedule Type is
// BOUND with no value (D17) — the binding `Schedule: Place Dated Work` gates
// on — with the start FLOORED to one of the grid's own slots (D11), keyed on
// the event's UID so an edited invite moves its row (§7).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const F = { type: "fType", date: "fDate", slot: "fSlot", dur: "fDur" };
const ICS_RULE = {
  id: "rule-ics", name: "Share: calendar", gridId: "g1", userId: "u1", enabled: true, priority: 10,
  triggerObjects: [{ eventType: "onShare", shareType: "ics" }],
  pipeline: { steps: [
    { id: "loop", type: "loop", over: "$share.events", as: "$e", body: [
      { id: "mk", type: "action", config: { type: "CREATE", role: "instance", name: "$e.summary",
        parent: "literal:appointments",
        fields: { [F.date]: "$e.start.date", [F.slot]: "$e.start.timeSlot", [F.dur]: "$e.durationMin" },
        attachFields: [F.type] } },
    ]},
    { id: "halt", type: "action", config: { type: "SET_VAR", name: "$share.handled", value: "true" } },
  ]},
};
const CATCH_ALL = { id: "catch", name: "Share: anything else", gridId: "g1", userId: "u1", enabled: true, priority: 99,
  triggerObjects: [{ eventType: "onShare", shareType: "*" }], pipeline: { steps: [] } };

vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => ({ userId: "u1", scopes: ["read", "write"], tokenId: "t" }) } }));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async () => ({ _id: "g1" }),
  findOneAndUpdate: () => ({ lean: async () => ({ shareLog: [] }) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => ({ meta: {} }) }), updateOne: async () => ({}) } }));
vi.mock("../models/Operation.js", () => ({ default: { find: () => ({ lean: async () => [CATCH_ALL, ICS_RULE] }) } }));
vi.mock("../models/Field.js", () => ({ default: { find: () => ({ lean: async () => [
  { id: F.slot, name: "Time Slot", meta: { options: ["1:00pm", "1:30pm", "2:00pm", "2:30pm", "3:00pm"] } },
]}) } }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOne: () => ({ lean: async () => null }), updateOne: async () => ({}), distinct: async () => [] } }));
vi.mock("../models/Module.js", () => ({ default: { findOne: () => ({ lean: async () => null }), find: () => ({ lean: async () => [] }) } }));
vi.mock("../models/Folder.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));
const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (a) => { minted.push(a); return { occurrenceId: `row${minted.length}`, status: "created" }; },
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ics-e2e-"));
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}`, opRunBridge: {},
    shareUpload: multer({ dest: tmp }),
    storeUploadedFile: async ({ file }) => { fs.unlinkSync(file.path); return { occurrence: { id: "ics-file", meta: {} }, fileRef: "user/x.ics" }; },
  }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { minted.length = 0; });

const invite = (uid, summary, start, end) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\n` +
  `SUMMARY:${summary}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const share = async (ics) => {
  const fd = new FormData();
  fd.append("gridId", "g1"); fd.append("source", "android"); fd.append("timeZone", "America/Chicago");
  // Android shares .ics as application/octet-stream — the extension decides.
  fd.append("files", new Blob([ics], { type: "application/octet-stream" }), "invite.ics");
  const res = await fetch(`${base}/share`, { method: "POST", headers: { authorization: "Bearer t" }, body: fd });
  return { status: res.status, body: await res.json() };
};

describe("a shared invite, end to end", () => {
  it("becomes one row: SUMMARY as label, floored slot, date, duration, Schedule Type bound", async () => {
    // 19:17Z is 2:17pm in Chicago → floored to the grid's 2:00pm slot.
    const r = await share(invite("dent-1", "Dentist", "20260925T191700Z", "20260925T201700Z"));
    expect(r.status).toBe(201);
    expect(r.body.type).toBe("ics");
    expect(r.body.events).toBe(1);
    expect(r.body.halted).toBe(true);                       // the catch-all did not also run
    expect(minted).toHaveLength(1);
    const m = minted[0];
    expect(m.label).toBe("Dentist");
    expect(m.parentId).toBe("appointments");
    expect(m.fields[F.date].value).toBe("2026-09-25");
    expect(m.fields[F.slot].value).toBe("2:00pm");
    expect(m.fields[F.dur].value).toBe(60);
    expect(m.fieldBindings.map(b => b.fieldId).sort()).toEqual([F.date, F.dur, F.slot, F.type].sort());
    expect(m.fields[F.type]).toBeUndefined();              // bound, NOT valued (D17)
    expect(m.externalId).toBe("ics:dent-1::mk");
  });

  it("an EDITED invite (same UID, new time) keys the SAME row", async () => {
    await share(invite("dent-1", "Dentist", "20260925T191700Z", "20260925T201700Z"));
    await share(invite("dent-1", "Dentist", "20260925T200000Z", "20260925T210000Z"));
    expect(minted[1].externalId).toBe(minted[0].externalId);
    expect(minted[1].fields[F.slot].value).toBe("3:00pm");
  });
});
