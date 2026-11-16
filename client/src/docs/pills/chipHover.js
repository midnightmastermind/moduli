// docs/pills/chipHover.js — when a mini-textblock chip shows its drag handle.
// Only over its TEXT or the handle itself (user, 2026-11-16: "its the space in between them" · "and on the outsides of
// the icons"). The rule used to be "anything but a link button", so the gap between ↗ and 🌐 and the chip's own padding
// around them — the chip element itself — counted as text and showed the handle beside the buttons.
export function hoverShowsHandle(target) {
  return !!target?.closest?.(".itbi-content, .itbi-handle");
}
