// helpers/sessionRefresh.js
//
// KEEP THE STORED SIGN-IN FRESH WHILE THE APP IS OPEN (2026-10-14).
// A session token lives 7 days and the socket checks it only when it connects, so a
// tab left open kept working while the token in storage expired. Everything that
// reads that token over REST — the share placement window's grid list, uploads,
// the extension's "choose where" window — was refused and showed an empty list.
// On every connect, and every few hours after, the socket asks for a new token;
// it is stored and used for the next reconnect.
import { persistAuth } from "./authStorage.js";

export const SESSION_REFRESH_MS = 6 * 60 * 60 * 1000;

export function bindSessionRefresh(socket, { everyMs = SESSION_REFRESH_MS, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (!socket) return () => {};
  const ask = () => { if (socket.connected) socket.emit("refresh_session"); };
  const onToken = ({ token, userId } = {}) => {
    if (!token) return;
    persistAuth({ token, userId });
    if (socket.auth && typeof socket.auth === "object") socket.auth.token = token;
  };
  socket.on("session_token", onToken);
  socket.on("connect", ask);
  ask();
  const timer = setTimer(ask, everyMs);
  return () => {
    socket.off("session_token", onToken);
    socket.off("connect", ask);
    clearTimer(timer);
  };
}
