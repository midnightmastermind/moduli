// client/src/socket.js
import { io } from "socket.io-client";

// In dev, Vite proxies /socket.io → localhost:5000, so connect to same origin.
// In prod (served from port 5000), also same origin. VITE_SERVER_URL overrides for remote deploys.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],  // websocket first, polling fallback
  reconnectionDelay: 100,       // start retrying quickly (default 1000)
  reconnectionDelayMax: 2000,   // cap at 2s (default 5000)
  timeout: 30000,               // connection timeout — remote DB can be slow on cold start
  auth: {
    token: localStorage.getItem("moduli-token") || null,
  },
});

export function emit(event, payload) {
  socket.emit(event, payload);
}


// WHY DID THE SOCKET DROP? A reconnect re-sends the whole grid, which is what
// "every photo reloads" is (user, 2026-09-26). The server logs its side of the
// reason; this reports the client's — plus the last few messages it sent,
// since an oversized frame is one way a delete could take the connection down.
// Sent after the reconnect, into the same pm2 log as the load diagnostics.
const recentOut = [];
socket.onAnyOutgoing((event, ...args) => {
  recentOut.push({ event, args, at: Date.now() });
  if (recentOut.length > 5) recentOut.shift();
});
let lastDrop = null;
socket.on("disconnect", (reason) => {
  const size = (a) => { try { return JSON.stringify(a).length; } catch { return -1; } };
  lastDrop = {
    reason, at: Date.now(),
    out: recentOut.map((o) => `${o.event}:${size(o.args)}b@-${Date.now() - o.at}ms`).join(" "),
  };
});
socket.on("connect", () => {
  if (!lastDrop) return;
  const d = lastDrop; lastDrop = null;
  socket.emit("save_scroll_diag", {
    line: `[socket] reconnected after "${d.reason}" down=${Date.now() - d.at}ms lastOut=[${d.out}]`,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
  });
});
