// One tab per user+grid materialises feeds (services/feedLeader.js). Two tabs
// each minting their own copies of the same sources swept each other's as
// duplicates on every date step (prod, 2026-09-19).
import { describe, it, expect } from "vitest";
import { createFeedLeaderRegistry } from "../services/feedLeader.js";
import { joinFeedGroup, registerFeedLeaderHandlers } from "../socketHandlers/feedLeader.js";

describe("feed leader registry", () => {
  it("the first tab to join leads; a second does not take it", () => {
    const r = createFeedLeaderRegistry();
    expect(r.join("u:g", "a", 1)).toBe("a");
    expect(r.join("u:g", "b", 2)).toBe("a");
  });

  it("the tab in use claims the lead", () => {
    const r = createFeedLeaderRegistry();
    r.join("u:g", "a", 1); r.join("u:g", "b", 2);
    expect(r.claim("u:g", "b", 3)).toBe("b");
    expect(r.leaderOf("u:g")).toBe("b");
  });

  it("a socket that is not a member cannot claim", () => {
    const r = createFeedLeaderRegistry();
    r.join("u:g", "a", 1);
    expect(r.claim("u:g", "stranger", 2)).toBeNull();
    expect(r.leaderOf("u:g")).toBe("a");
  });

  it("when the leader leaves, the MOST RECENTLY active member takes over", () => {
    const r = createFeedLeaderRegistry();
    r.join("u:g", "a", 1); r.join("u:g", "b", 2); r.join("u:g", "c", 3);
    r.claim("u:g", "b", 10); // b is now leader and most recent
    r.claim("u:g", "a", 20); // a leads, b second-most-recent
    expect(r.leave("u:g", "a")).toEqual({ leader: "b", changed: true });
  });

  it("a non-leader leaving changes nothing; the last one out empties the group", () => {
    const r = createFeedLeaderRegistry();
    r.join("u:g", "a", 1); r.join("u:g", "b", 2);
    expect(r.leave("u:g", "b")).toEqual({ leader: "a", changed: false });
    expect(r.leave("u:g", "a")).toEqual({ leader: null, changed: true });
    expect(r.leaderOf("u:g")).toBeNull();
  });

  it("groups are per user AND grid", () => {
    const r = createFeedLeaderRegistry();
    r.join("u:g1", "a", 1);
    expect(r.join("u:g2", "b", 2)).toBe("b");
  });
});

describe("socket wiring", () => {
  // Real handlers over fake sockets — the class this file keeps paying for is
  // a handler referencing something not in its scope, which only running it finds.
  const makeIo = () => {
    const sent = [];
    return { sent, to: (room) => ({ emit: (ev, p) => sent.push({ room, ev, p }) }) };
  };
  const gridRoom = (u, g) => `user:${u}:grid:${g}`;
  const makeSocket = (id, userId, gridId) => {
    const on = {};
    return { id, userId, data: { activeGridId: gridId }, on: (ev, fn) => { on[ev] = fn; }, fire: (ev) => on[ev]?.() };
  };
  // A unique user per test keeps the shared module registry from leaking between them.
  let n = 0;
  const fresh = () => `user${++n}`;

  it("join announces the leader to the grid room; a focus claim moves it; the leader leaving hands it on", () => {
    const io = makeIo(), u = fresh();
    const a = makeSocket("A", u, "g"), b = makeSocket("B", u, "g");
    registerFeedLeaderHandlers(a, { io, gridRoom }); registerFeedLeaderHandlers(b, { io, gridRoom });
    joinFeedGroup({ io, gridRoom }, a, u, "g", null);
    joinFeedGroup({ io, gridRoom }, b, u, "g", null);
    expect(io.sent.map((s) => s.p.leaderSocketId)).toEqual(["A", "A"]);
    expect(io.sent[0]).toMatchObject({ room: gridRoom(u, "g"), ev: "feed_leader" });

    b.fire("feed_claim");
    expect(io.sent.at(-1).p.leaderSocketId).toBe("B");

    b.fire("disconnect");
    expect(io.sent.at(-1).p.leaderSocketId).toBe("A");
  });

  it("switching grids hands the old grid's lead on", () => {
    const io = makeIo(), u = fresh();
    const a = makeSocket("A", u, "g1"), b = makeSocket("B", u, "g1");
    joinFeedGroup({ io, gridRoom }, a, u, "g1", null);
    joinFeedGroup({ io, gridRoom }, b, u, "g1", null);
    a.data.activeGridId = "g2";
    joinFeedGroup({ io, gridRoom }, a, u, "g2", "g1");
    const g1 = io.sent.filter((s) => s.room === gridRoom(u, "g1"));
    expect(g1.at(-1).p.leaderSocketId).toBe("B");
    expect(io.sent.at(-1)).toMatchObject({ room: gridRoom(u, "g2"), p: { leaderSocketId: "A" } });
  });
});
