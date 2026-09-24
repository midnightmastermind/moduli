// server/__tests__/shareLog.test.js — the recent-shares log (D16, §12).
import { describe, it, expect, vi } from "vitest";

const pushes = [];
vi.mock("../models/Grid.js", () => ({ default: {
  findOneAndUpdate: (q, u) => { pushes.push({ q, u }); return { lean: async () => ({ shareLog: u.$push.shareLog.$each }) }; },
}}));
const { shareLogEntry, recordShare, SHARE_LOG_MAX } = await import("../services/shareLog.js");

const share = { type: "link", source: "extension", label: "A page", externalId: "page:https://x.test", props: { url: "https://x.test", text: "SECRET BODY" } };

describe("shareLogEntry", () => {
  it("records which rule ran and what it created", () => {
    const e = shareLogEntry({ share, result: { halted: true, ran: [
      { ruleId: "r1", ruleName: "Share: links", ok: true, created: [{ occurrenceId: "o1", status: "created", moduleId: "m" }] },
    ]}});
    expect(e.status).toBe("landed");
    expect(e.halted).toBe(true);
    expect(e.rules[0]).toEqual({ ruleId: "r1", ruleName: "Share: links", ok: true, error: null,
      created: [{ occurrenceId: "o1", status: "created" }] });
  });

  it("a share nothing was written for is NOT 'landed'", () => {
    expect(shareLogEntry({ share, result: { ran: [{ ruleId: "r", ok: true, created: [] }] } }).status).toBe("nothing");
  });

  it("records a failure with its reason", () => {
    const e = shareLogEntry({ share: null, error: "this grid has no Files folder" });
    expect(e.status).toBe("failed");
    expect(e.error).toMatch(/Files folder/);
  });

  it("keeps METADATA only — never the shared content (so no re-run, D16)", () => {
    const e = shareLogEntry({ share, result: { ran: [] } });
    expect(JSON.stringify(e)).not.toMatch(/SECRET BODY/);
    expect(e).not.toHaveProperty("props");
  });
});

describe("recordShare", () => {
  it("appends atomically and keeps only the newest SHARE_LOG_MAX", async () => {
    const emitted = [];
    await recordShare({ userId: "u1", gridId: "g1", entry: { at: "t" },
      io: { to: () => ({ emit: (ev, p) => emitted.push([ev, p]) }) }, userRoom: (u) => `user:${u}` });
    expect(pushes[0].q).toEqual({ _id: "g1", userId: "u1" });
    expect(pushes[0].u.$push.shareLog.$slice).toBe(-SHARE_LOG_MAX);
    expect(emitted[0][0]).toBe("grid_updated");
    expect(emitted[0][1].grid.shareLog).toEqual([{ at: "t" }]);
  });
});
