// hooks/useNowTick.js
//
// Returns a `Date` that updates on a fixed interval (default 5 minutes).
// Used by render-time "is this past now?" checks so the UI refreshes
// without polling every render. Cheap — one setInterval per consumer;
// React deduplicates re-renders since the returned Date's millisecond
// component is rounded to the tick boundary.

import { useEffect, useState } from "react";

const DEFAULT_TICK_MS = 5 * 60 * 1000; // 5 minutes

function snap(ms, intervalMs) {
  return new Date(Math.floor(ms / intervalMs) * intervalMs);
}

export default function useNowTick(intervalMs = DEFAULT_TICK_MS) {
  const [now, setNow] = useState(() => snap(Date.now(), intervalMs));
  useEffect(() => {
    const tick = () => setNow(snap(Date.now(), intervalMs));
    // Align the first interval to the next tick boundary so all consumers
    // sharing the same intervalMs land on the same wall-clock minute.
    const msUntilBoundary = intervalMs - (Date.now() % intervalMs);
    let intervalId = null;
    const initialTimeout = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, intervalMs);
    }, msUntilBoundary);
    return () => {
      clearTimeout(initialTimeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [intervalMs]);
  return now;
}
