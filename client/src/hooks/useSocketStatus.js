// hooks/useSocketStatus.js
//
// Subscribes to socket.io's connection lifecycle and returns a tiny
// status object the toolbar uses to render a persistent "Disconnected
// — retrying…" banner while the socket is down, plus a transient
// "Reconnected" pill once it comes back.
//
// Status values:
//   "connected"    — socket is connected (default state once boot-up
//                    completes; also after recovered pill fades).
//   "disconnected" — socket dropped or failed to connect; we're
//                    retrying. Stays in this state for the entire
//                    outage so writes routed through offlineQueue
//                    buffer visibly.
//   "recovered"    — connection just re-established. Held for
//                    `recoveredDurationMs` (default 3000ms) then flips
//                    back to "connected" so the user sees confirmation
//                    before the indicator hides.
//
// Lifetime: hook starts in whichever state matches socket.connected at
// mount, so first-paint reflects reality (e.g. a browser tab restored
// while offline shows "disconnected" immediately).
//
// Reconnect attempts: `attempts` increments each time socket.io
// reports a `reconnect_attempt`; reset to 0 on successful reconnect.
// Toolbar can use this to show "Retrying (3)" or similar if desired.

import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

const DEFAULT_RECOVERED_MS = 3000;

export function useSocketStatus({ recoveredDurationMs = DEFAULT_RECOVERED_MS } = {}) {
  const [status, setStatus] = useState(() => (socket.connected ? "connected" : "disconnected"));
  const [attempts, setAttempts] = useState(0);
  // Tracks whether we've seen a real disconnect event (or booted up
  // already disconnected). Without this, the first `connect` event on
  // a fresh page load flips status "disconnected" → "recovered" and
  // shows a 3s green pill on every reload — cosmetic but annoying.
  // We only treat a connect as a "recovery" when there's actually
  // something to recover from.
  const wasDisconnectedRef = useRef(!socket.connected);

  useEffect(() => {
    let recoveredTimer = null;

    const onConnect = () => {
      setAttempts(0);
      const wasDown = wasDisconnectedRef.current;
      wasDisconnectedRef.current = false;
      if (!wasDown) {
        // Healthy boot — go straight to connected, no recovered flash.
        setStatus("connected");
        return;
      }
      setStatus("recovered");
      if (recoveredTimer) clearTimeout(recoveredTimer);
      recoveredTimer = setTimeout(() => setStatus("connected"), recoveredDurationMs);
    };

    const onDisconnect = () => {
      if (recoveredTimer) { clearTimeout(recoveredTimer); recoveredTimer = null; }
      wasDisconnectedRef.current = true;
      setStatus("disconnected");
    };

    const onConnectError = () => {
      if (recoveredTimer) { clearTimeout(recoveredTimer); recoveredTimer = null; }
      wasDisconnectedRef.current = true;
      setStatus("disconnected");
    };

    const onReconnectAttempt = (n) => {
      setAttempts(typeof n === "number" ? n : (a) => a + 1);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      if (recoveredTimer) clearTimeout(recoveredTimer);
    };
  }, [recoveredDurationMs]);

  return { status, attempts };
}
