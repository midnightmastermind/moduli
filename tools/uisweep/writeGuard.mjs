// tools/uisweep/writeGuard.mjs — the sweep never writes a grid it was not told it may write.
//
// An ALLOWLIST of reads, not a list of writes: an event the sweep does not know is blocked. A new write path the
// client grows tomorrow is therefore blocked too, instead of slipping through a list nobody updated.
// The init script wraps WebSocket.prototype.send in the page, drops a write frame and records its event name in
// window.__blockedWrites (the crawler reads that to tell "this button wrote" from "this button did nothing").

export const READ_EVENTS = new Set([
  "request_full_state", "request_full_state_rest", "join_grid", "join_grid_quiet",
  "feed_claim", "get_undo_state", "get_transactions", "refresh_session", "close_action",
  "link_preview", "link_harvest", "import_plan", "page_reader", "wayback_lookup", "save_scroll_diag",
]);

/** A socket.io v4 event frame `42[...]` (optionally with an ack id `421[...]`) → { event }, else null. */
export function parseFrame(data) {
  if (typeof data !== "string") return null;
  const m = /^42\d*\[\s*"([^"]+)"/.exec(data);
  return m ? { event: m[1] } : null;
}

export function isWrite(event) {
  return !READ_EVENTS.has(event);
}

/** The init script. `allow` true = record writes but let them through (a writes-allowed run still counts them). */
export function guardScript(allow) {
  return `(() => {
  const READS = new Set(${JSON.stringify([...READ_EVENTS])});
  const ALLOW = ${allow ? "true" : "false"};
  window.__blockedWrites = [];
  window.__sentWrites = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string") {
      const m = /^42\\d*\\[\\s*"([^"]+)"/.exec(data);
      if (m && !READS.has(m[1])) {
        if (!ALLOW) { window.__blockedWrites.push(m[1]); return; }
        window.__sentWrites.push(m[1]);
      }
    }
    return send.call(this, data);
  };
})();`;
}
