// services/feedLeader.js — which ONE tab materialises feeds for a user's grid.
//
// Feed sync (client helpers/feedSync.js) mints copy-linked rows for every feed
// match and sweeps the stale ones. Every open tab used to run it. Each tab
// minted its OWN copies of the same sources, the others received them as
// duplicates and swept them, and the date step on prod showed `minted 11` ->
// `swept 10` -> `minted 6` passes going back and forth (2026-09-19). The result
// is shared (grid.activeFilterValues and every filterOverride are persisted),
// so one writer is enough and two are a fight.
//
// Pure bookkeeping: no sockets here, so the rules are testable in isolation.
// A GROUP is one user's one grid; its MEMBERS are the sockets on that grid.
//   - the first member to join leads;
//   - a member CLAIMS the lead when it becomes the tab in use (focus /
//     visible), because a background tab's timers are throttled and its passes
//     would land late;
//   - when the leader leaves, the most recently active member takes over.
// In-memory by design: a server restart disconnects every socket, and each
// rejoin re-establishes a leader.

export function createFeedLeaderRegistry() {
  const groups = new Map(); // key -> { leader, members: Map<socketId, lastActiveAt> }

  const leaderOf = (key) => groups.get(key)?.leader ?? null;

  return {
    leaderOf,

    /** Add a socket to a group. Returns the group's leader. */
    join(key, socketId, now = Date.now()) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { leader: null, members: new Map() }));
      if (!g.members.has(socketId)) g.members.set(socketId, now);
      if (!g.leader) g.leader = socketId;
      return g.leader;
    },

    /** A member becomes the tab in use. Returns the leader, or null if not a member. */
    claim(key, socketId, now = Date.now()) {
      const g = groups.get(key);
      if (!g || !g.members.has(socketId)) return null;
      g.members.set(socketId, now);
      g.leader = socketId;
      return g.leader;
    },

    /**
     * Remove a socket. Returns `{ leader, changed }`: the leader afterwards
     * (null once the group is empty) and whether it moved.
     */
    leave(key, socketId) {
      const g = groups.get(key);
      if (!g || !g.members.delete(socketId)) return { leader: leaderOf(key), changed: false };
      if (g.members.size === 0) { groups.delete(key); return { leader: null, changed: true }; }
      if (g.leader !== socketId) return { leader: g.leader, changed: false };
      let best = null, bestAt = -Infinity;
      for (const [sid, at] of g.members) if (at > bestAt) { best = sid; bestAt = at; }
      g.leader = best;
      return { leader: best, changed: true };
    },
  };
}

export const feedLeaders = createFeedLeaderRegistry();
