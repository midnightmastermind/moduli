// server/__tests__/shareRulesEnsure.test.js
//
// D18: a grid gets exactly ONE rule automatically — the `*` catch-all. The
// typed rules are the user's to write (D19).
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = [];
const hasCatchAll = (o, q) =>
  o.userId === q.userId && o.gridId === q.gridId &&
  (o.triggerObjects || []).some(t =>
    t.eventType === q.triggerObjects.$elemMatch.eventType &&
    t.shareType === q.triggerObjects.$elemMatch.shareType);
vi.mock("../models/Operation.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => store.find(o => hasCatchAll(o, q)) || null }),
  create: async (d) => { store.push({ ...d }); return { ...d }; },
}}));
let folders = [];
vi.mock("../models/Folder.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => folders.find(f => Object.entries(q).every(([k, v]) =>
    k === "meta.protected" ? f.meta?.protected === v : f[k] === v)) || null }),
}}));

const { ensureCatchAllRule } = await import("../utils/shareRulesEnsure.js");
const { runOperationServerSide } = await import("../services/serverExecutor.js");

beforeEach(() => {
  store.length = 0;
  folders = [{ id: "files-folder-g1", userId: "u1", gridId: "g1", name: "Files", meta: { protected: true } }];
});

describe("ensureCatchAllRule", () => {
  it("mints the catch-all when none exists", async () => {
    const r = await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(r.created).toBe(true);
    expect(store).toHaveLength(1);
    expect(store[0].triggerObjects).toEqual([{ eventType: "onShare", shareType: "*" }]);
  });

  it("is idempotent — a second call mints nothing", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    const r = await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(r.created).toBe(false);
    expect(store).toHaveLength(1);
  });

  it("is per GRID — another grid gets its own", async () => {
    folders.push({ id: "files-folder-g2", userId: "u1", gridId: "g2", name: "Files", meta: { protected: true } });
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    const r = await ensureCatchAllRule({ userId: "u1", gridId: "g2" });
    expect(r.created).toBe(true);
    expect(store).toHaveLength(2);
  });

  it("gives it the LOWEST priority", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(store[0].priority).toBeGreaterThanOrEqual(99);
  });

  it("mints ONLY the catch-all — no typed rules (D18)", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    expect(store.flatMap(o => o.triggerObjects.map(t => t.shareType))).toEqual(["*"]);
  });

  it("refuses rather than minting a rule that points nowhere", async () => {
    folders = [];
    await expect(ensureCatchAllRule({ userId: "u1", gridId: "g1" })).rejects.toThrow(/Files folder/);
    expect(store).toHaveLength(0);
  });
});

// The minted pipeline, run through the REAL executor with the mint stubbed:
// what it does to a link and to an already-uploaded file.
const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (a) => { minted.push(a); return { occurrenceId: "new", status: "created" }; },
}));

describe("the catch-all pipeline", () => {
  beforeEach(() => { minted.length = 0; });

  it("files a link in the Files folder, labelled and keyed by the share", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    const r = await runOperationServerSide(store[0], { userId: "u1", gridId: "g1", vars: {
      $share: { type: "link", label: "Example", externalId: "link:https://x.test", props: { url: "https://x.test" } },
    }});
    expect(r.ok).toBe(true);
    expect(minted).toHaveLength(1);
    expect(minted[0].parentFolderId).toBe("files-folder-g1");
    expect(minted[0].label).toBe("Example");
    expect(minted[0].externalId).toBe("link:https://x.test");
  });

  it("does NOT mint a second row for a file ingress already uploaded", async () => {
    await ensureCatchAllRule({ userId: "u1", gridId: "g1" });
    await runOperationServerSide(store[0], { userId: "u1", gridId: "g1", vars: {
      $share: { type: "image", label: "a.jpg", externalId: "sha256:abc", props: { occurrenceId: "occ-file" } },
    }});
    expect(minted).toHaveLength(0);
  });
});
