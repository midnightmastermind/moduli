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

let _ringing = null;          // { label, startedAt } | null
let _loopTimer = null;
let _snoozeTimer = null;
const _subs = new Set();

function _emit() { for (const fn of _subs) { try { fn(); } catch { /* ignore */ } } }

export function subscribeAlarmRing(fn) { _subs.add(fn); return () => _subs.delete(fn); }
export function getAlarmRing() { return _ringing; }

// Start (or restart) a persistent ring for `alarm` ({ label }). Idempotent while
// already ringing the same alarm — it just keeps the loop going.
export function startAlarmRing(alarm = {}) {
  if (_snoozeTimer) { clearTimeout(_snoozeTimer); _snoozeTimer = null; }
  _ringing = { label: alarm.label || "Alarm", startedAt: Date.now() };
  if (_loopTimer) clearInterval(_loopTimer);
  ringAlarm({ bursts: RING_BURSTS });
  _loopTimer = setInterval(() => ringAlarm({ bursts: RING_BURSTS }), RING_EVERY_MS);
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
