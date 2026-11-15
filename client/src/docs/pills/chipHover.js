// docs/pills/chipHover.js — when a mini-textblock chip shows its drag handle.
// Over its text (or the handle itself), yes; over one of its link buttons (↗, 🌐), no — those are a different control,
// and the handle appearing beside them read as the chip being picked up (user, 2026-11-15).
export function hoverShowsHandle(target) {
  return !target?.closest?.(".itbi-arrow");
}
