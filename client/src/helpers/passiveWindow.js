// helpers/passiveWindow.js — the headset's control panel is a PASSIVE window.
//
// The Quest app's control panel (`/?office` inside window.ModuliNative) answers the room: shelves, notes, players.
// It used to be a whole Moduli tab under a small menu — the full grid drawn (22,885 elements measured on the
// headset, 2026-10-26) and every operation, feed sync and schedule run again — beside the grid screen, which is the
// same again. Every web page in the app shares one process, so the copy cost the headset its memory and the app was
// killed for it (user: "the control panel shouldnt load the entire grid").
// A passive window draws no grid and runs no operations, feed syncs, schedules or reminders; its own writes (a shelf
// reorder, a new note) still go out.
export function isPassiveWindow() {
  if (typeof window === "undefined") return false;
  if (window.__moduliPassive != null) return window.__moduliPassive;
  let passive = false;
  try { passive = !!window.ModuliNative && new URLSearchParams(window.location.search).has("office"); } catch { passive = false; }
  window.__moduliPassive = passive;
  return passive;
}
