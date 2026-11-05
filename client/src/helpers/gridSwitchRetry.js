// How long a grid switch waits before asking again. A big grid takes far longer than a fixed few seconds to arrive, so
// the wait grows; the server drops a retry whose answer is already on its way (server/socketHandlers/state.js).
const DELAYS_MS = [15000, 30000, 60000];

export function gridSwitchRetryDelay(attempt) {
  return DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)];
}
