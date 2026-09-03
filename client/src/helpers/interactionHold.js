// helpers/interactionHold.js
//
// HOLD OPERATION FIRES FOR THE DURATION OF A GESTURE.
//
// `bindSocketToStore` has deferred the fires a DROP causes since 2026-07-02 —
// the drop batch. It does nothing about fires arriving from SOMEWHERE ELSE
// while the finger is down, and on the device that is the larger number by far.
// The user's own capture, a drag begun 13 seconds after a page load:
//
//     opSweeps=19  opMs=3404
//     opBy=[load:1x2544ms/231fx  MeasureOp:11x532ms  MeasureOp:6x278ms]
//     longTasks=152(27966ms)      <- 47% of a 59-second drag
//
// A 2,544ms sweep is a two-and-a-half-second freeze with a finger on the
// screen, and none of it is work the drag asked for (user: "make them not
// affect the drag at all").
//
// ── EXTRACTED, BECAUSE THE DECISIONS ARE WHERE THE BUGS WOULD BE ───────────
// The bridge lives inside `bindSocketToStore`, which needs a socket and a
// store; the queue's contract does not. What is worth pinning is the dedupe
// key and the cap, and both are testable here directly.
//
// ── IT MUST NEVER BE ABLE TO STARVE THE GRID ──────────────────────────────
// If a drag runs long, or the gesture ends in a way nobody anticipated, the
// held work drains ANYWAY and the hold stops holding. Same principle as
// `stagedMount`'s HARD_RELEASE_MS: a scheduling optimisation may not be able to
// hide work permanently.

/** How long held work may sit before the grid gets a slice of it. NOT how long
 *  the hold lasts — see `drainAndRearm`. */
export const HOLD_MAX_MS = 6000;

/** The same fail-safe by size: a burst drains rather than growing a queue
 *  nobody bounded. Also does not stop the hold. */
export const HOLD_MAX_ENTRIES = 200;

export function makeInteractionHold({ maxMs = HOLD_MAX_MS, maxEntries = HOLD_MAX_ENTRIES, onCap } = {}) {
  let queue = null;          // null = not holding; the state every non-drag path is in
  let keys = new Set();
  let capTimer = null;

  const release = () => {
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    const held = queue || [];
    queue = null;
    keys = new Set();
    return held;
  };

  const arm = () => {
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(() => {
      // Only ever hand back WORK. A hold that is open but quiet — most of a
      // settled drag — must not wake the tab every `maxMs` to drain nothing.
      const held = drainAndRearm();
      if (held.length) onCap?.(held);
    }, maxMs);
  };

  // ── A CAP LETS WORK THROUGH; IT DOES NOT END THE GESTURE ──────────────────
  // The first version called `release()` here, which stops holding — so after
  // six seconds every remaining fire ran unheld. The user's drags measured
  // 16-38 SECONDS, which means 10 to 32 seconds of each one was unprotected,
  // and the capture said so: `opSweeps=30` over a 38-second drag with the hold
  // supposedly open the whole time.
  //
  // The fail-safe only ever had to stop work being hidden FOREVER (the same
  // promise `stagedMount`'s HARD_RELEASE_MS makes). Draining and re-arming
  // keeps that promise — the grid gets a slice at least every `maxMs` — while
  // the finger stays protected for as long as it is down.
  const drainAndRearm = () => {
    const held = queue || [];
    queue = [];
    keys = new Set();
    capTimer = null;
    if (held.length) arm();          // a quiet hold arms again on its next `take`
    return held;
  };

  return {
    begin() {
      if (queue !== null) return;      // already holding — never restart or clear
      queue = [];
      keys = new Set();
      arm();
    },

    /**
     * Offer a fire to the hold. Returns true when it was CAPTURED (the caller
     * must not run it), false when the caller should fire as normal.
     *
     * Deduped by what the fire is ABOUT. A settling grid emits the same
     * MeasureOp for one occurrence many times over a long drag, and the drain's
     * own op-level dedup cannot stop the QUEUE growing — that runs afterwards.
     */
    take(transactionType, transaction, run) {
      if (queue === null) return false;
      if (capTimer === null) arm();     // a drained, idle hold arms on its next fire
      // ── A FIRE THAT CARRIES A CONTINUATION IS NEVER DROPPED ────────────────
      // The deferred-MeasureOp path retains an undo action and parks an entry
      // in `_pendingMeasure` BEFORE offering itself here, and only running the
      // continuation releases either. Dropping one as a duplicate would leave
      // the action buffer open forever and leave a pending entry that later
      // writes merge into and nothing ever fires — a tracker that silently
      // stops recomputing. Deduping those is already done upstream (one entry
      // per occurrence+context, later writes MERGE into it) and downstream
      // (the drain's shared cascade set), so the queue does not need to.
      if (run) {
        queue.push({ transactionType, transaction, run });
        if (queue.length >= maxEntries) onCap?.(drainAndRearm());
        return true;
      }
      const key = `${transactionType}|${transaction?.occurrenceId || ""}|${transaction?.fieldId || ""}`;
      if (!keys.has(key)) {
        keys.add(key);
        queue.push({ transactionType, transaction });
        if (queue.length >= maxEntries) onCap?.(drainAndRearm());
      }
      return true;
    },

    /** Stop holding and hand back what was held. */
    end() { return release(); },

    size() { return queue ? queue.length : 0; },
    isHolding() { return queue !== null; },
  };
}
