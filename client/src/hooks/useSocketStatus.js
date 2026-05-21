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
// Upper bound for holding the recovered pill open while we wait for
// the offline queue to drain. Caps the wait so a server that ack's
// slowly (or never) doesn't pin the indicator forever.
const RECOVERED_MAX_MS = 10000;
// Per-queued-item extension. With 100ms per item we hold ~10s for a
// queue of 100 items, then RECOVERED_MAX_MS clamps it.
const PER_ITEM_HOLD_MS = 100;

// socket.io reconnection delay formula — must match what socket.io
// actually uses internally so our countdown stays roughly accurate.
// Reads the runtime config from socket.io.opts (set at construction
// time in client/src/socket.js).
function computeNextDelayMs(attempts) {
  const opts = socket.io?.opts || {};
  const base = opts.reconnectionDelay ?? 1000;
  const max = opts.reconnectionDelayMax ?? 5000;
  // socket.io's actual backoff is `min(max, base * 2^attempts)` plus
  // jitter. We ignore jitter — close enough for a UI countdown.
  return Math.min(max, base * Math.pow(2, Math.max(0, attempts - 1)));
}

export function useSocketStatus({ recoveredDurationMs = DEFAULT_RECOVERED_MS } = {}) {
  const [status, setStatus] = useState(() => (socket.connected ? "connected" : "disconnected"));
  const [attempts, setAttempts] = useState(0);
  // Seconds until the next reconnect attempt. Counts DOWN, resets to
  // the predicted delay each time a `connect_error` fires (i.e. the
  // current attempt just failed and the next one is scheduled). Goes
  // to 0 while an attempt is actively in flight and during a healthy
  // connection.
  const [retryInMs, setRetryInMs] = useState(0);
  // Tracks whether we've seen a real disconnect event (or booted up
  // already disconnected). Without this, the first `connect` event on
  // a fresh page load flips status "disconnected" → "recovered" and
  // shows a 3s green pill on every reload — cosmetic but annoying.
  // We only treat a connect as a "recovery" when there's actually
  // something to recover from.
  const wasDisconnectedRef = useRef(!socket.connected);
  const retryDeadlineRef = useRef(0);
  const tickerRef = useRef(null);

  // Start a ticker that decrements retryInMs every 100ms toward 0.
  // Idempotent — re-arming with the same deadline is a no-op via the
  // useEffect dep guarding.
  const armTicker = () => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      const remaining = Math.max(0, retryDeadlineRef.current - Date.now());
      setRetryInMs(remaining);
      if (remaining <= 0 && tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    }, 100);
  };
  const stopTicker = () => {
    if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    retryDeadlineRef.current = 0;
    setRetryInMs(0);
  };

  useEffect(() => {
    let recoveredTimer = null;

    const onConnect = () => {
      setAttempts(0);
      stopTicker();
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
      // An attempt just failed. Predict when socket.io will fire the
      // next one and start the countdown there.
      const delay = computeNextDelayMs(attempts);
      retryDeadlineRef.current = Date.now() + delay;
      setRetryInMs(delay);
      armTicker();
    };

    const onReconnectAttempt = (n) => {
      const next = typeof n === "number" ? n : attempts + 1;
      setAttempts(next);
      // An attempt is actively in flight right now → countdown is
      // meaningless until it either succeeds or fails. Park at 0.
      stopTicker();
    };

    // When the offline queue actually flushes, hold the "recovered"
    // pill longer so the user can see that buffered writes are
    // replaying. Hold time scales with the flushed count but caps at
    // RECOVERED_MAX_MS so a server that doesn't ack quickly doesn't
    // pin the indicator forever. Only meaningful when we're already
    // in the recovered state — otherwise this is a no-op.
    const onQueueFlushed = (e) => {
      const count = e?.detail?.count || 0;
      if (count <= 0) return;
      // Hold time = base recovered window + per-item, clamped.
      const hold = Math.min(RECOVERED_MAX_MS, recoveredDurationMs + count * PER_ITEM_HOLD_MS);
      if (recoveredTimer) clearTimeout(recoveredTimer);
      recoveredTimer = setTimeout(() => setStatus("connected"), hold);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    if (typeof window !== "undefined") {
      window.addEventListener("offlineQueue:flushed", onQueueFlushed);
    }

    // Race fix: if socket connected between our useState init (which
    // read socket.connected === false and seeded status="disconnected")
    // and this effect attaching listeners, the "connect" event already
    // fired with nothing listening — so the pill would stay red
    // forever even though the socket is fine. Re-read socket.connected
    // here and reconcile. We treat this as a healthy boot (no green
    // "recovered" flash), since the disconnect was never observed by
    // the user — it was just a mount-time race.
    if (socket.connected) {
      wasDisconnectedRef.current = false;
      setStatus("connected");
      setAttempts(0);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      if (typeof window !== "undefined") {
        window.removeEventListener("offlineQueue:flushed", onQueueFlushed);
      }
      if (recoveredTimer) clearTimeout(recoveredTimer);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [recoveredDurationMs, attempts]);

  return { status, attempts, retryInMs };
}
