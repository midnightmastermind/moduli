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

/** Long enough to cover an ordinary drag, short enough that a leak is a hiccup
 *  rather than a grid that never settles. */
export const HOLD_MAX_MS = 6000;

export function makeInteractionHold({ maxMs = HOLD_MAX_MS, onCap } = {}) {
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

  return {
    begin() {
      if (queue !== null) return;      // already holding — never restart or clear
      queue = [];
      keys = new Set();
      capTimer = setTimeout(() => { onCap?.(release()); }, maxMs);
    },

    /**
     * Offer a fire to the hold. Returns true when it was CAPTURED (the caller
     * must not run it), false when the caller should fire as normal.
     *
     * Deduped by what the fire is ABOUT. A settling grid emits the same
     * MeasureOp for one occurrence many times over a long drag, and the drain's
     * own op-level dedup cannot stop the QUEUE growing — that runs afterwards.
     */
    take(transactionType, transaction) {
      if (queue === null) return false;
      const key = `${transactionType}|${transaction?.occurrenceId || ""}|${transaction?.fieldId || ""}`;
      if (!keys.has(key)) {
        keys.add(key);
        queue.push({ transactionType, transaction });
      }
      return true;
    },

    /** Stop holding and hand back what was held. */
    end() { return release(); },

    size() { return queue ? queue.length : 0; },
    isHolding() { return queue !== null; },
  };
}
