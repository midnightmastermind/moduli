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
