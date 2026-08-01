// helpers/insertGapDiag.js
//
// `[gap]` diagnostics for the STUCK insert-line report (user 2026-07-31/08-01:
// "do you see all the frozen highlight quick add buttons. they get stuck" →
// "put in logs for it and we will see cause its still happening a bit").
//
// A gap's blue line is forced visible by the `insert-gap--open` class, which
// InsertGap holds for exactly as long as it believes its QuickAddMenu is open.
// One leak (a menu UNMOUNTED while open never reported its close) is already
// fixed; the report says it still happens "a bit", so this narrows down which
// of the remaining possibilities it is:
//
//   A. the host still thinks the menu is open  → an OPEN with no matching CLOSE
//   B. React state says closed but the class is on the DOM → a render/CSS
//      divergence, not a state leak
//   C. neither — the line is visible from `:hover` that never released
//      (pointer capture, an overlay swallowing mouseleave)
//
// The SWEEP is what separates them: it reports each stuck element with both its
// live React state and its DOM class, so the answer is in the log line itself
// rather than in a follow-up guess.
//
// ON by default (like helpers/caretDiag.js — a user-facing bug needs zero setup
// to capture). Mute with `window.__gapDiag = false`.

const on = () => typeof window !== "undefined" && window.__gapDiag !== false;

// Gaps that currently believe their menu is open: id → { label, index, at }.
const openGaps = new Map();
let seq = 0;

/** Stable-ish identity for a gap, so a log line names WHICH one stuck. */
export function gapId({ containerLabel, index }) {
  return `${containerLabel || "(unlabelled)"}#${index ?? "?"}`;
}

export function gapOpened(info) {
  if (!on()) return;
  const id = gapId(info);
  openGaps.set(id, { ...info, at: Date.now(), n: ++seq });
  console.log(`[gap] OPEN  ${id}`, { openNow: openGaps.size });
}

export function gapClosed(info, how = "transition") {
  if (!on()) return;
  const id = gapId(info);
  const had = openGaps.get(id);
  openGaps.delete(id);
  console.log(`[gap] CLOSE ${id} via ${how}`, {
    heldMs: had ? Date.now() - had.at : null,
    wasTracked: !!had,
    openNow: openGaps.size,
  });
  // Give React a beat to drop the class, then confirm it actually went away.
  setTimeout(() => sweepGaps(`after close of ${id}`), 900);
}

/**
 * Report every gap whose blue line is currently forced on, with the two facts
 * that tell the causes apart: does the HOST still think it is open, and is the
 * class on the DOM.
 */
export function sweepGaps(reason = "manual") {
  if (!on() || typeof document === "undefined") return [];
  const stuck = [...document.querySelectorAll(".insert-gap--open")].map((el) => {
    const line = el.querySelector(".insert-gap-line");
    const shell = el.closest(".container-shell");
    const label = shell?.innerText?.split("\n")[0]?.trim()?.slice(0, 24) || "?";
    return {
      where: label,
      index: el.dataset.insertIndex,
      lineOpacity: line ? getComputedStyle(line).opacity : "(no line)",
      hovered: el.matches(":hover"),
      // present here = the HOST still believes its menu is open (cause A);
      // absent = the class outlived the state (cause B).
      hostThinksOpen: openGaps.has(gapId({ containerLabel: label, index: el.dataset.insertIndex })),
    };
  });
  // A line can also be lit with NO forced-open class — that is cause C.
  const hoverLit = [...document.querySelectorAll(".insert-gap:not(.insert-gap--open) .insert-gap-line")]
    .filter((l) => getComputedStyle(l).opacity !== "0")
    .map((l) => {
      const el = l.closest(".insert-gap");
      return { index: el?.dataset?.insertIndex, hovered: el?.matches(":hover") };
    });

  if (stuck.length || hoverLit.length) {
    console.log(`[gap] SWEEP (${reason}) — forced-open: ${stuck.length}, lit-without-class: ${hoverLit.length}`);
    if (stuck.length) console.table(stuck);
    if (hoverLit.length) console.table(hoverLit);
    console.log("[gap]   hosts that believe they are open:", [...openGaps.keys()]);
  } else {
    console.log(`[gap] SWEEP (${reason}) — clean`);
  }
  return stuck;
}

if (typeof window !== "undefined") {
  // Call `__gapStuck()` in the console the moment a line is stuck — that single
  // line says which cause it is.
  window.__gapStuck = () => sweepGaps("manual");

  // The first version only logged on open/close, so a session where nothing was
  // opened printed NOTHING and read as "the logging isn't working" (user
  // 2026-08-01: "i didnt see logs for the gap"). Say so on load, then watch on
  // a timer and speak up only when something is actually stuck — a stuck line
  // is the whole point and it can appear without a close ever firing.
  if (on()) {
    console.log("[gap] diagnostics active — __gapStuck() to sweep now, window.__gapDiag = false to mute");
    let lastCount = 0;
    setInterval(() => {
      if (!on() || typeof document === "undefined") return;
      const n = document.querySelectorAll(".insert-gap--open").length;
      if (n !== lastCount) {
        lastCount = n;
        if (n > 0) sweepGaps(`watcher saw ${n} forced-open`);
      }
    }, 3000);
  }
}
