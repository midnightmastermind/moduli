// socketHandlers/feedLeader.js — wires services/feedLeader onto sockets.
//
// Every membership change is announced to the whole grid room as
// `feed_leader { leaderSocketId }`; each client compares it with its own
// socket.id and runs feed sync only when they match (client
// state/bindSocketToStore.js, scheduleFeedSync).
import { feedLeaders } from "../services/feedLeader.js";

const keyOf = (userId, gridId) => `${userId}:${gridId}`;

function announce(io, gridRoom, userId, gridId) {
  io.to(gridRoom(userId, gridId)).emit("feed_leader", { leaderSocketId: feedLeaders.leaderOf(keyOf(userId, gridId)) });
}

/**
 * Called by the state handler once the socket has joined `gridId`'s room.
 * Leaves the previous grid's group first, handing its lead on if it held it.
 */
export function joinFeedGroup({ io, gridRoom }, socket, userId, gridId, prevGridId) {
  if (!userId || !gridId) return;
  if (prevGridId && prevGridId !== gridId) {
    const { changed } = feedLeaders.leave(keyOf(userId, prevGridId), socket.id);
    if (changed) announce(io, gridRoom, userId, prevGridId);
  }
  feedLeaders.join(keyOf(userId, gridId), socket.id);
  // Always announce: the joining socket needs to hear who leads even when that
  // did not change.
  announce(io, gridRoom, userId, gridId);
}

export function registerFeedLeaderHandlers(socket, { io, gridRoom }) {
  socket.on("feed_claim", () => {
    const userId = socket.userId, gridId = socket.data.activeGridId;
    if (!userId || !gridId) return;
    const before = feedLeaders.leaderOf(keyOf(userId, gridId));
    const after = feedLeaders.claim(keyOf(userId, gridId), socket.id);
    if (after && after !== before) announce(io, gridRoom, userId, gridId);
  });

  socket.on("disconnect", () => {
    const userId = socket.userId, gridId = socket.data.activeGridId;
    if (!userId || !gridId) return;
    const { changed, leader } = feedLeaders.leave(keyOf(userId, gridId), socket.id);
    if (changed && leader) announce(io, gridRoom, userId, gridId);
  });
}

/**
 * `disconnect_other_sessions`: disconnect every socket of THIS user except the
 * caller. A server-initiated disconnect (`"io server disconnect"`) is the one
 * reason a socket.io client does NOT reconnect by itself, and this app never
 * calls `socket.connect()` after it, so the other tabs stay down until they are
 * reloaded, which brings them back on the current build. Needed because a tab
 * left open on an old bundle keeps running the old sync and op behaviour
 * (2026-09-19: a phone tab kept syncing feeds after the one-tab fix shipped).
 * Scoped to the caller's own user room, so it can only ever touch its own tabs.
 */
export function registerSessionHandlers(socket, { io, userRoom }) {
  socket.on("disconnect_other_sessions", async (_payload, ack) => {
    const userId = socket.userId;
    if (!userId) return;
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    let n = 0;
    for (const s of sockets) {
      if (s.id === socket.id) continue;
      s.disconnect(true);
      n++;
    }
    console.log(`🔌 disconnect_other_sessions user=${userId} closed=${n}`);
    if (typeof ack === "function") ack({ closed: n });
  });
}

