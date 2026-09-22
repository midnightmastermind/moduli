// Both import handlers must put the root into the DESTINATION's warm-cache
// entry and tell the tabs — every read (full_state, every open tab) comes from
// that cache, so a Mongo-only listing is invisible until a restart. See
// importListsInCache.test.js for the measurement. `import_text` never synced
// the cache at all; `import_url` did, but only when the linker had pushed.
import { describe, it, expect, vi } from "vitest";

vi.mock("../models/Module.js", () => ({ default: { insertMany: vi.fn() } }));
vi.mock("../models/Occurrence.js", () => ({ default: { insertMany: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock("../utils/persistImport.js", () => ({ persistImportResult: vi.fn(async () => {}) }));
vi.mock("../utils/linkImport.js", () => ({
  readLinkForImport: vi.fn(async () => ({ ok: true, markdown: "# T\n\nBody text.", title: "T", sourceUrl: "https://x.test/t" })),
}));
let rootSeen = null;
vi.mock("../utils/linkRootIntoParent.js", () => ({
  linkRootIntoParent: vi.fn(async ({ parentId, childId }) => { rootSeen = childId; return { id: parentId, occurrences: ["old", childId] }; }),
}));

const { registerImportHandlers } = await import("../socketHandlers/import.js");

function harness() {
  const handlers = {}; const broadcast = [];
  const uc = { occurrencesById: { dest: { id: "dest", label: "Bookmarks", occurrences: ["old"] } }, modulesById: {} };
  const socket = { userId: "u1", on: (e, fn) => { handlers[e] = fn; }, emit: () => {} };
  const io = { to: () => ({ emit: (evt, p) => broadcast.push({ evt, p }) }) };
  registerImportHandlers(socket, { io, userRoom: (u) => `user:${u}`, ensureUserCache: () => uc });
  return { handlers, broadcast, uc };
}
const call = (h, evt, payload) => new Promise((res) => h[evt](payload, res));

describe.each([
  ["import_text", { content: "# T\n\nBody text.", gridId: "g1", title: "T", parentId: "dest" }],
  ["import_url", { url: "https://x.test/t", gridId: "g1", parentId: "dest" }],
])("%s", (evt, payload) => {
  it("lists the root in the destination's CACHE entry", async () => {
    const { handlers, uc } = harness();
    const out = await call(handlers, evt, payload);
    expect(out.ok).toBe(true);
    expect(uc.occurrencesById.dest.occurrences).toContain(rootSeen);
    // A merge, not a replace: the cached entry's other keys survive.
    expect(uc.occurrencesById.dest.label).toBe("Bookmarks");
  });

  it("tells the tabs the destination changed", async () => {
    const { handlers, broadcast } = harness();
    await call(handlers, evt, payload);
    const upd = broadcast.find((b) => b.evt === "occurrence_updated" && b.p.occurrence.id === "dest");
    expect(upd?.p.occurrence.occurrences).toContain(rootSeen);
  });
});
