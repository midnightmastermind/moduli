// __tests__/deleteScrubReachesSender.test.js
//
// THE TAB THAT DID THE DELETE WAS THE ONE TAB THAT NEVER HEARD ABOUT THE SCRUB.
//
// User, 2026-09-17: *"i went to delete the empty container i just produced by
// moving the sections in the new page article … and it leaved an embed: missing
// element in its spot. it shouldnt do that."*
//
// The scrub itself was correct and had been since 2026-08-19. What was wrong is
// WHO it was broadcast to: `socket.to(userRoom(userId))` EXCLUDES the sender.
// The client does not scrub its own textmap optimistically, so the deleting tab
// kept the dead `moduleEmbed` node and kept painting `embed: missing` — and the
// next edit in that tab would echo the stale textmap back and make it permanent.
//
// The same handler already does BOTH emits 100 lines above, for the file
// placement unlink. This pins the pair so the self-emit cannot be dropped again.
import { describe, it, expect, vi } from "vitest";

const updates = [];
vi.mock("../models/Module.js", () => ({
  default: { findOneAndDelete: async () => ({}), find: () => ({ lean: async () => [] }) },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOneAndDelete: async () => ({}),
    findOne: () => ({ lean: async () => null }),
    updateMany: async () => ({}),
    findOneAndUpdate: async (q, patch) => { updates.push({ q, patch }); return {}; },
  },
}));
vi.mock("../models/Grid.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: () => {} }));

const embed = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });

/** Drive the real handler, capturing the two emit channels SEPARATELY. */
async function deleteOcc(uc, occurrenceId) {
  const handlers = {};
  const toOthers = [];   // socket.to(room).emit — everyone EXCEPT the sender
  const toSelf = [];     // socket.emit          — the sender
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: (ev, payload) => toSelf.push({ ev, payload }),
    to: () => ({ emit: (ev, payload) => toOthers.push({ ev, payload }) }),
    join: () => {}, leave: () => {},
    data: { activeGridId: "g1" }, userId: "u1",
  };
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(socket, {
    ensureUserCache: () => uc,
    userCacheReady: () => true,
    loadUserIntoCache: async () => uc,
    userRoom: () => "user:u1",
    gridRoom: () => "grid:u1",
    createOccurrenceData: (o) => o,
  });
  await handlers["delete_occurrence"]({ occurrenceId });
  return { toOthers, toSelf };
}

/** A doc page whose body EMBEDS the container about to be deleted. */
function world() {
  return {
    modulesById: {
      m_doc: { id: "m_doc", userId: "u1", gridId: "g1", role: "page", kind: "doc" },
      m_cont: { id: "m_cont", userId: "u1", gridId: "g1", role: "container", kind: "board" },
    },
    occurrencesById: {
      page: {
        id: "page", userId: "u1", gridId: "g1", moduleId: "m_doc", occurrences: ["cont"],
        textmap: { type: "doc", content: [embed("cont"), { type: "paragraph" }] },
      },
      cont: { id: "cont", userId: "u1", gridId: "g1", moduleId: "m_cont", parentId: "page", occurrences: [] },
    },
    operationsById: {}, fieldsById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
  };
}

// THE FILTER HAS TO DISCRIMINATE, and the first version did not. The parent
// cleanup ALSO emits `occurrence_updated` for this same doc (it drops the child
// from `occurrences[]`) and carries the textmap UNSCRUBBED. Matching on the id
// alone counted both, so "the scrub was broadcast" would have been satisfied by
// a run where the scrub never happened. Match on the thing under test: a body
// that no longer embeds the deleted id.
const embedsCont = (tm) =>
  JSON.stringify(tm || {}).includes('"occurrenceId":"cont"');
const scrubbed = (list) =>
  list.filter(e => e.ev === "occurrence_updated"
    && e.payload?.occurrence?.id === "page"
    && !embedsCont(e.payload.occurrence.textmap));

describe("a delete scrubs the host doc for EVERY tab, the deleter included", () => {
  it("emits the scrubbed textmap to the SENDER", async () => {
    const { toSelf } = await deleteOcc(world(), "cont");
    const hit = scrubbed(toSelf);
    expect(hit).toHaveLength(1);
    expect(hit[0].payload.occurrence.textmap.content.map(n => n.type)).toEqual(["paragraph"]);
  });

  // The control: the other tabs must STILL get it. A "fix" that swapped the
  // broadcast for a self-emit would pass the test above and break every
  // other window.
  it("still emits it to the other tabs", async () => {
    const { toOthers } = await deleteOcc(world(), "cont");
    expect(scrubbed(toOthers)).toHaveLength(1);
  });

  it("persists the scrubbed textmap", async () => {
    updates.length = 0;
    await deleteOcc(world(), "cont");
    expect(updates.some(u => u.q?.id === "page" && "textmap" in (u.patch || {}))).toBe(true);
  });

  // A delete that nothing embeds must not republish an untouched doc — the
  // scrub returns null so the write is skipped entirely. Asserted on the WRITE
  // and on the self-emit, because the PARENT CLEANUP still broadcasts this doc
  // (it drops the child from `occurrences[]`) and that emit is correct; only
  // the scrub self-emits, so an empty `toSelf` is unambiguous.
  it("says nothing when no doc embedded the deleted occurrence", async () => {
    updates.length = 0;
    const uc = world();
    uc.occurrencesById.page.textmap = { type: "doc", content: [{ type: "paragraph" }] };
    const { toSelf } = await deleteOcc(uc, "cont");
    expect(toSelf.filter(e => e.payload?.occurrence?.id === "page")).toHaveLength(0);
    expect(updates.some(u => u.q?.id === "page" && "textmap" in (u.patch || {}))).toBe(false);
  });
});
