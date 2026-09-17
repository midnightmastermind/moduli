// A BOOKMARK MADE IN THE APP GETS ITS TITLE AND ITS PICTURE.
//
// Measured on the live grid: 1,464 of 1,472 bookmarks carry a cover, and every
// one of the 8 that do not was made HERE rather than imported — migration 0201
// scopes itself to `meta.raindropId`, so it has never covered an app-made
// bookmark. That is also why those 8 are labelled by a bare host
// ("en.wikipedia.org"): nothing fetched their title either. One `link_preview`
// answers both, because that handler already fetches the page for the title.
import { describe, it, expect, vi } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";

function socketStub({ connected = true, reply = null } = {}) {
  const emitted = [];
  return {
    connected,
    emitted,
    emit: (event, data, ack) => {
      emitted.push({ event, data, hasAck: typeof ack === "function" });
      if (event === "link_preview" && typeof ack === "function" && reply) ack(reply);
    },
  };
}
const parent = { id: "container-1", occurrences: [] };
const base = { gridId: "g1", userId: "u1", containerOccurrence: parent };

const moduleUpdates = (socket) =>
  socket.emitted.filter((e) => e.event === "update_module").map((e) => e.data.module);

describe("an app-made bookmark is enriched", () => {
  it("takes the page's title and cover", () => {
    const socket = socketStub({
      reply: { ok: true, title: "Albert Ellis - Wikipedia", cover: "https://x/photo.jpg" },
    });
    CommitHelpers.addBookmarkOccurrence({
      ...base, socket, dispatch: vi.fn(), url: "https://en.wikipedia.org/wiki/Albert_Ellis",
    });
    const [patched] = moduleUpdates(socket);
    expect(patched, "no module update was emitted").toBeTruthy();
    expect(patched.label).toBe("Albert Ellis - Wikipedia");
    expect(patched.meta.cover).toBe("https://x/photo.jpg");
    // The flag the mint already set must survive a meta patch.
    expect(patched.meta.external).toBe(true);
  });

  // THE EMIT MUST CARRY AN ACK, and this is not a detail: `safeEmit` takes
  // (socket, event, data) and DROPS a callback, so routing this through it
  // would have made the whole enrichment inert while every log line read
  // correctly. That is the shipped-and-does-nothing class this repo keeps
  // paying for, and it is why the test asserts the ack rather than the result
  // alone.
  it("asks with a callback", () => {
    const socket = socketStub({ reply: { ok: true, title: "T", cover: "https://x/c.jpg" } });
    CommitHelpers.addBookmarkOccurrence({ ...base, socket, dispatch: vi.fn(), url: "https://a.test/p" });
    const ask = socket.emitted.find((e) => e.event === "link_preview");
    expect(ask, "link_preview was never emitted").toBeTruthy();
    expect(ask.hasAck, "emitted without an ack — the reply can never arrive").toBe(true);
  });

  // A LABEL THE CALLER PASSED IS SOMEONE'S CHOICE and outranks a page <title>.
  it("never overwrites a label the caller supplied", () => {
    const socket = socketStub({ reply: { ok: true, title: "Page Title", cover: "https://x/c.jpg" } });
    CommitHelpers.addBookmarkOccurrence({
      ...base, socket, dispatch: vi.fn(), url: "https://a.test/p", label: "My Name For It",
    });
    const [patched] = moduleUpdates(socket);
    expect(patched.label).toBe("My Name For It");
    expect(patched.meta.cover).toBe("https://x/c.jpg");   // the cover still lands
  });

  // A SCRATCH BROWSER IS A WORKSPACE, not a saved page: its address changes as
  // you navigate, so a cover fetched once goes stale and "Browser" is the name
  // it should keep.
  it("does not enrich a scratch browser", () => {
    const socket = socketStub({ reply: { ok: true, title: "T", cover: "https://x/c.jpg" } });
    CommitHelpers.addScratchBrowser({ ...base, socket, dispatch: vi.fn(), url: "https://a.test/p" });
    expect(socket.emitted.some((e) => e.event === "link_preview")).toBe(false);
  });

  // FIRE-AND-FORGET. The row is already on screen and already emitted, so a
  // dead site must change nothing — this is the control that the enrichment
  // cannot break saving a bookmark.
  it("still mints when the preview fails, is offline, or never answers", () => {
    for (const [name, socket] of [
      ["failed", socketStub({ reply: { ok: false, error: "unreachable" } })],
      ["silent", socketStub({ reply: null })],
      ["offline", socketStub({ connected: false, reply: { ok: true, title: "T", cover: "https://x/c.jpg" } })],
    ]) {
      const res = CommitHelpers.addBookmarkOccurrence({
        ...base, socket, dispatch: vi.fn(), url: "https://a.test/p",
      });
      expect(res?.moduleId, `${name}: the bookmark was not minted`).toBeTruthy();
      expect(moduleUpdates(socket), `${name}: patched anyway`).toHaveLength(0);
      // Only the CONNECTED arms emit here: offline, `safeEmit` parks the create
      // in the offline queue instead, which is that queue's job rather than
      // this feature's. Asserting an emit there would be testing the wrong unit.
      if (socket.connected) {
        expect(socket.emitted.some((e) => e.event === "create_module"), name).toBe(true);
      }
    }
  });

  it("writes nothing when the page offers neither a title nor a cover", () => {
    const socket = socketStub({ reply: { ok: true } });
    CommitHelpers.addBookmarkOccurrence({ ...base, socket, dispatch: vi.fn(), url: "https://a.test/p" });
    expect(moduleUpdates(socket)).toHaveLength(0);
  });
});
