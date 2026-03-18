const ledger = new Map();
const requested = new Set();
export function markAndGetEngagement(element) {
  markEngagement(element);
  const entry = ledger.get(element);
  if (entry) {
    return entry;
  }
  const fresh = {
    timeOfEngagementStart: Date.now()
  };
  ledger.set(element, fresh);
  return fresh;
}
export function markEngagement(element) {
  requested.add(element);
}
export function clearUnusedEngagements(fn) {
  // make sure previous engagement requests don't linger
  requested.clear();

  // perform the required work
  fn();

  // if engagements where not requested, purge it
  ledger.forEach((_, element) => {
    if (!requested.has(element)) {
      ledger.delete(element);
    }
  });

  // cleaning up after ourselves
  requested.clear();
}
export function clearEngagementHistory() {
  ledger.clear();
}