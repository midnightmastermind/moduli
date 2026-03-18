// client/src/socket.js
import { io } from "socket.io-client";

// In dev, Vite proxies /socket.io → localhost:5000, so connect to same origin.
// In prod (served from port 5000), also same origin. VITE_SERVER_URL overrides for remote deploys.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket"],
  auth: {
    token: localStorage.getItem("moduli-token") || null,
  },
});

export function emit(event, payload) {
  socket.emit(event, payload);
}

export function reconnectWithAuth() {
  socket.auth = { token: localStorage.getItem("moduli-token") || null };
  if (socket.connected) socket.disconnect();
  socket.connect();
}