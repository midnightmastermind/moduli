// helpers/offlineQueue.js
// Buffers socket.emit calls when disconnected. Flushes after reconnect + full_state.

const queue = [];

// Events where only the latest payload per entity matters (dedup by key)
const DEDUP_EVENTS = new Set([
  "update_module", "update_occurrence", "update_field",
  "update_view", "update_folder", "update_manifest",
  "update_operation", "update_grid", "update_grid_filter",
]);

function dedupKey(event, data) {
  if (event === "update_module") return `update_module:${data.module?.id}`;
  if (event === "update_occurrence") return `update_occurrence:${data.occurrence?.id}`;
  if (event === "update_field") return `update_field:${data.field?.id}`;
  if (event === "update_view") return `update_view:${data.view?.id}`;
  if (event === "update_folder") return `update_folder:${data.folder?.id}`;
  if (event === "update_manifest") return `update_manifest:${data.manifest?.id}`;
  if (event === "update_operation") return `update_operation:${data.operation?.id}`;
  if (event === "update_grid") return `update_grid:${data.gridId}`;
  if (event === "update_grid_filter") return `update_grid_filter:${data.gridId}`;
  return null;
}

/**
 * Emit to socket if connected, otherwise queue for later.
 * Drop-in replacement for `socket?.emit(event, data)`.
 */
export function safeEmit(socket, event, data) {
  if (!socket) return;

  if (socket.connected) {
    socket.emit(event, data);
    return;
  }

  // Dedup: replace existing queued update for same entity
  if (DEDUP_EVENTS.has(event)) {
    const key = dedupKey(event, data);
    if (key) {
      const idx = queue.findIndex(q => q._key === key);
      if (idx !== -1) {
        queue[idx] = { event, data, _key: key };
        return;
      }
    }
  }

  queue.push({ event, data, _key: dedupKey(event, data) });
}

/**
 * Flush all queued mutations through the socket. Called after full_state is received
 * on reconnect so mutations are replayed on top of fresh server state.
 *
 * Dispatches a window `offlineQueue:flushed` CustomEvent with detail.count when
 * a non-zero flush happens, so UI consumers (e.g. useSocketStatus) can extend
 * the "Reconnected" indicator until the server has had time to ack the replay.
 */
export function flushOfflineQueue(socket) {
  if (!socket?.connected || queue.length === 0) return;

  const count = queue.length;
  const batch = queue.splice(0);
  for (const { event, data } of batch) {
    socket.emit(event, data);
  }
  console.log(`[offlineQueue] flushed ${count} queued mutations`);
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("offlineQueue:flushed", { detail: { count } }));
    } catch {
      // Older runtimes / SSR — silently skip; the queue still flushed.
    }
  }
}

/**
 * Returns the current queue length (for UI indicators if needed).
 */
export function getQueueLength() {
  return queue.length;
}
