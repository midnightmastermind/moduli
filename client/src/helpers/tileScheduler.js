// helpers/tileScheduler.js — when a light tile may become its real row (ui/DeferredTile).
//
// Mounting a board's tiles is the cost of a long scroll: ~15 per screen, ~25ms each, in one task, so a fast scroll could not
// paint for ~500ms and the view went black (Movies, 2026-11-05). Tiles wait while the scroll is moving; then they are built
// a few per frame, the ones on screen first, so settling does not become the same freeze later.
export const SCROLL_IDLE_MS = 140;
// A scroll that never stops (reading slowly, or anything moving the scroller by itself) must not hold tiles light for ever.
export const TILE_MAX_WAIT_MS = 1200;
const FRAME_BUDGET_MS = 8;

let lastScrollAt = -Infinity;
let queue = new Set();
let raf = 0;

const now = () => performance.now();

/** Any virtualized list reports its scroll here. */
export function noteScroll() {
  lastScrollAt = now();
  ensureLoop();
}

export function isScrollingNow() {
  return now() - lastScrollAt < SCROLL_IDLE_MS;
}

function ensureLoop() {
  if (raf || !queue.size) return;
  raf = requestAnimationFrame(run);
}

function run() {
  raf = 0;
  if (!queue.size) return;
  const scrolling = isScrollingNow();
  const t = now();
  const due = scrolling ? [...queue].filter((j) => t - j.at >= TILE_MAX_WAIT_MS) : [...queue];
  if (due.length) {
    const ordered = due.sort((a, b) => (b.isVisible?.() ? 1 : 0) - (a.isVisible?.() ? 1 : 0));
    const start = now();
    for (const job of ordered) {
      queue.delete(job);
      job.run();
      if (now() - start >= FRAME_BUDGET_MS) break;
    }
  }
  ensureLoop();
}

/** Run `run` when its turn comes. `id` lets a search ask for this tile now. Returns the cancel. */
export function scheduleTile(run, isVisible = null, id = null) {
  const job = { run, isVisible, id, at: now() };
  queue.add(job);
  ensureLoop();
  return () => { queue.delete(job); };
}

// A search landing on a row rings it, and a ring on a light tile would go with the element when the tile is replaced.
export const WANT_TILE_MS = 6000;
const wanted = new Map();

/** Make this row real now if it is waiting, and from its first render if it has not mounted yet. */
export function wantTileNow(id) {
  if (!id) return;
  wanted.set(String(id), now() + WANT_TILE_MS);
  for (const job of [...queue]) {
    if (job.id != null && String(job.id) === String(id)) { queue.delete(job); job.run(); }
  }
}

export function isTileWanted(id) {
  const until = wanted.get(String(id));
  if (until == null) return false;
  if (now() > until) { wanted.delete(String(id)); return false; }
  return true;
}

export function _resetTileScheduler() {
  lastScrollAt = -Infinity;
  queue = new Set();
  raf = 0;
  wanted.clear();
}
