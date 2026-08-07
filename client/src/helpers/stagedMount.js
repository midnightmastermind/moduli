// helpers/stagedMount.js
//
// Staged content mounting — the engine behind Tasks 2/3 of
// docs/superpowers/plans/2026-08-06-staged-loading.md.
//
// WHAT THE MEASUREMENT SAID (Task 1, numbers in that plan). Panel CHROME already
// commits on its own — 125ms after `full_state` at 1x CPU, 504ms at 4x — a full
// second (six, throttled) before its content commits. The shape was never
// missing. What is missing is a FRAME: React keeps rendering the content tree in
// the same task, so the browser never paints the chrome it already has, and the
// first paint of the whole app lands at 2.5s / 11.8s.
//
// So this scheduler does exactly one thing: it hands out permission to mount
// content, ONE registrant PER ANIMATION FRAME, in priority order. The frame
// boundary is the entire point — it is what lets the chrome (and then each panel
// as it lands) actually reach the screen instead of arriving all at once at the
// end of one multi-second task.
//
// DELIBERATELY OFF BY DEFAULT. `enableStagedMount()` is called by `App.jsx` at
// runtime. A unit test that renders a panel therefore gets its content
// synchronously, exactly as before — a test should not have to know about a
// frame pump to assert on a panel's contents, and making it opt-in keeps this
// file's own behaviour testable directly (see __tests__/stagedMount.test.js)
// rather than through the components.

const queue = [];          // [{ key, priority, notify }]
const released = new Set();
let enabled = false;
let pumping = false;
let hardStopTimer = null;

// If anything goes wrong — a frame pump that never runs (a backgrounded tab
// throttles rAF to nothing), a registrant that never unsubscribes — content must
// still appear. This is the deadline after which everything waiting is released
// at once. A staged mount is a paint optimisation; it must never be able to
// hide content permanently.
const HARD_RELEASE_MS = 4000;

// How long to stand back after handing the browser a frame. Zero was not enough
// on a saturated main thread: rendering is opportunistic, and Chrome will run a
// due timer callback rather than paint if the thread never actually goes idle.
// This is an idle window wide enough for a frame to complete.
const PAINT_GAP_MS = 50;

function releaseNow(entry) {
  released.add(entry.key);
  try { entry.notify(); } catch { /* a torn-down subscriber is not our problem */ }
  flushFirstReleaseWaiters();
}

// ---------------------------------------------------------------------------
// "After the first panel's content" — the hook the on-load op sweep uses.
//
// The sweep costs 0.5s (3.8s throttled) of unbroken main thread. Run it before
// any content and the user watches the shape sit empty for the whole of it;
// measured on a 4x-throttled phone-sized load, that put the first rows at
// 11.7s against 8.2s unstaged. Letting the NEAREST panel through first means
// the cell you are actually looking at fills in, and the sweep pays for the
// rest.
// ---------------------------------------------------------------------------
let firstReleaseWaiters = [];
let firstReleaseTimer = null;
let hadRelease = false;

function flushFirstReleaseWaiters() {
  hadRelease = true;
  if (!firstReleaseWaiters.length) return;
  const ws = firstReleaseWaiters;
  firstReleaseWaiters = [];
  if (firstReleaseTimer != null) { clearTimeout(firstReleaseTimer); firstReleaseTimer = null; }
  for (const w of ws) { try { w(); } catch { /* caller's problem */ } }
}

/**
 * Run `cb` once the first staged surface has been let through — or immediately
 * when staging is off, and unconditionally after `timeoutMs` so a grid with no
 * panels at all (or one whose panels never mount) still gets its sweep.
 */
export function whenStagedFirstRelease(cb, timeoutMs = 1500) {
  if (!enabled || hadRelease) { cb(); return; }
  firstReleaseWaiters.push(cb);
  if (firstReleaseTimer == null) {
    firstReleaseTimer = setTimeout(() => { firstReleaseTimer = null; flushFirstReleaseWaiters(); }, timeoutMs);
  }
}

function pump() {
  pumping = false;
  if (!queue.length) return;
  // Highest priority (lowest number) first, insertion order as the tiebreak.
  let bestIdx = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].priority < queue[bestIdx].priority) bestIdx = i;
  }
  const [entry] = queue.splice(bestIdx, 1);
  releaseNow(entry);
  if (queue.length) schedulePump();
}

function schedulePump() {
  if (pumping) return;
  pumping = true;
  if (typeof requestAnimationFrame === "function") {
    // rAF, THEN a macrotask — and the `setTimeout` is the load-bearing half.
    // A rAF callback runs BEFORE that frame's paint, so releasing inside one
    // makes React render the content in the very frame that was supposed to
    // paint the chrome. The first version of this file did exactly that and a
    // CDP screencast caught it: 4x throttled, the browser painted NOTHING
    // between 2.0s and 9.7s — the chrome was committed the whole time and never
    // reached the screen. Handing off to a task lets the frame complete
    // (style → layout → paint) before the next chunk of work begins.
    requestAnimationFrame(() => setTimeout(pump, PAINT_GAP_MS));
  } else {
    setTimeout(pump, 16);
  }
}

function armHardRelease() {
  if (hardStopTimer != null) return;
  hardStopTimer = setTimeout(() => {
    hardStopTimer = null;
    while (queue.length) releaseNow(queue.shift());
  }, HARD_RELEASE_MS);
}

/** Turn staging on. Called once by the app shell; tests leave it off. */
export function enableStagedMount() { enabled = true; }

/** Turn staging off and release anything waiting. */
export function disableStagedMount() {
  enabled = false;
  while (queue.length) releaseNow(queue.shift());
  if (hardStopTimer != null) { clearTimeout(hardStopTimer); hardStopTimer = null; }
}

/** Test seam — forget every release so a fresh scenario stages again. */
export function resetStagedMount() {
  queue.length = 0;
  released.clear();
  enabled = false;
  pumping = false;
  hadRelease = false;
  firstReleaseWaiters = [];
  if (firstReleaseTimer != null) { clearTimeout(firstReleaseTimer); firstReleaseTimer = null; }
  if (hardStopTimer != null) { clearTimeout(hardStopTimer); hardStopTimer = null; }
}

export function isStagedMountReleased(key) { return released.has(key); }

/** Is staging on at all? Consumers use it to render ready on the FIRST render
 *  when it is off, so a build (or a unit test) with staging disabled never
 *  renders a waiting state it does not need. */
export function isStagedMountEnabled() { return enabled; }

/**
 * Ask for permission to mount `key`'s content.
 * Returns `true` immediately when staging is off, when this key was already
 * released (so a re-render or a remount never re-stages and flickers), or once
 * its turn comes. `notify` is called when the turn arrives.
 * Returns an unsubscribe function; call it on unmount.
 */
export function requestStagedMount(key, priority, notify) {
  if (!enabled || released.has(key)) {
    notify();
    return () => {};
  }
  const entry = { key, priority, notify };
  queue.push(entry);
  armHardRelease();
  schedulePump();
  return () => {
    const i = queue.indexOf(entry);
    if (i > -1) queue.splice(i, 1);
  };
}
