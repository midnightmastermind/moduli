// state/alarmRingStore.js
// Holds the CURRENTLY-RINGING alarm so a real (keeps-ringing-until-dismissed)
// alarm can be shown with Snooze / Stop — unlike the old fire-and-forget 6s beep.
// When an alarm-type NOTIFY effect fires (operationActions NOTIFY with sound),
// it calls startAlarmRing; the store loops the synthesized ring until the user
// stops it (or snoozes, which re-rings after N minutes). The AlarmDropdown
// subscribes via useSyncExternalStore to surface the ringing banner.
import { ringAlarm, stopAlarm } from "../helpers/alarmSound";

const RING_EVERY_MS = 3500;   // re-trigger the ring so it's continuous
const RING_BURSTS = 4;        // shorter burst per loop tick

let _ringing = null;          // { label, startedAt, ringId } | null
let _loopTimer = null;
let _snoozeTimer = null;
let _ringSeq = 0;             // monotonic — see `ringId` below
const _subs = new Set();

function _emit() { for (const fn of _subs) { try { fn(); } catch { /* ignore */ } } }

export function subscribeAlarmRing(fn) { _subs.add(fn); return () => _subs.delete(fn); }
export function getAlarmRing() { return _ringing; }

// Start (or restart) a persistent ring for `alarm` ({ label }).
//
// IDEMPOTENT WHILE ALREADY RINGING THE SAME ALARM, and it now actually is. The
// comment here has always said so; the code reassigned `_ringing` with a fresh
// `startedAt`, restarted the loop (re-triggering a burst) and emitted, on EVERY
// call. Harmless while nothing watched the identity — and not harmless now that
// the dropdown opens itself on a NEW ring: a repeat call would re-open a panel
// the user had just closed while the same alarm was still going.
//
// `ringId` is a monotonic counter rather than the timestamp, because two rings
// inside one millisecond would share a `startedAt` and read as the same ring.
export function startAlarmRing(alarm = {}) {
  if (_snoozeTimer) { clearTimeout(_snoozeTimer); _snoozeTimer = null; }
  const label = alarm.label || "Alarm";

  // Same alarm, already going: keep the ring's identity and let the loop run on.
  if (_ringing && _ringing.label === label && _loopTimer) return;

  _ringing = { label, startedAt: Date.now(), ringId: ++_ringSeq };
  if (_loopTimer) clearInterval(_loopTimer);
  // THE AUDIO MUST NOT BE ABLE TO COST US THE BANNER. `alarmSound` promises it
  // is "safe to call from anywhere … the notification still shows", and it
  // returns false rather than throwing for the case it knows about (no
  // AudioContext). But it is scheduling WebAudio nodes, and the visual path is
  // now the one that carries Stop and Snooze onto the screen — so a throw here
  // would silence the alarm AND hide the only way to dismiss it.
  try { ringAlarm({ bursts: RING_BURSTS }); } catch { /* the banner still shows */ }
  _loopTimer = setInterval(() => {
    try { ringAlarm({ bursts: RING_BURSTS }); } catch { /* keep the loop alive */ }
  }, RING_EVERY_MS);
  _emit();
}

// Stop ringing NOW (silence + clear the banner). The alarm's schedule is
// untouched — a daily alarm still rings at its next occurrence.
// stopAlarm() cuts the beeps ALREADY scheduled on the audio timeline —
// clearing the loop timer alone would let the current burst play out.
export function stopAlarmRing() {
  if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = null; }
  if (_snoozeTimer) { clearTimeout(_snoozeTimer); _snoozeTimer = null; }
  stopAlarm();
  if (!_ringing) return;
  _ringing = null;
  _emit();
}

// Snooze: silence now, ring again in `minutes`. Client-side + transient (a
// reload cancels a pending snooze — the schedule still fires normally).
export function snoozeAlarmRing(minutes = 5) {
  const label = _ringing?.label || "Alarm";
  stopAlarmRing();
  _snoozeTimer = setTimeout(() => startAlarmRing({ label }), Math.max(1, minutes) * 60 * 1000);
}

export function isSnoozed() { return !!_snoozeTimer; }
