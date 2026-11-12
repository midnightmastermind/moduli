// helpers/filterLoading.js — "this panel's filter just changed and its rows are being rebuilt".
//
// User, 2026-11-11: "when i switch to a diff date in the toolbar, it takes a second for the new schedule to load.
// in that second, could you put the loading icon up for the effected filters cascaded … the panels dont look frozen
// while they load" · "it should be the panels loading icon".
//
// A toolbar date change names the filter FIELDS it moved. Each panel decides for itself whether its shown page is
// filtered by one of them (the cascade, `getEffectiveFilterForOccurrence`), and draws the panel's own staged loader
// over its body while the change is loading. Pages that pinned their own value follow the toolbar
// (helpers/filterFollow), so "filtered by the field" is the whole rule.
//
// THE END: the date change runs as op sweeps (sliced, nothing to await), reported by helpers/opActivity. The load
// is over once no sweep has run for QUIET_MS after the change and the browser has painted the result. A change that
// starts no sweep at all ends after NO_SWEEP_MS, and MAX_MS ends it whatever happens — a loader that can stick is
// worse than none. A newer change restarts it.

import { useSyncExternalStore } from "react";
import { subscribeOpActivity } from "./opActivity";
import { afterPaint } from "./afterPaint";

const QUIET_MS = 400;
const NO_SWEEP_MS = 700;
const MAX_MS = 8000;

const listeners = new Set();
let snap = null; // null, or a frozen array of field ids
let timers = [];
let unsubscribe = null;
let sawSweep = false;
let token = 0;
// Pages whose board already shows rows for the new value (an already-built day). Their panel drops the loader at
// once instead of waiting for every op sweep to go quiet (user, 2026-11-12: "the schedule pops up but the loading
// icon remains for a second"). Reset by each change; a frozen Set so the snapshot is identity-stable.
const readyListeners = new Set();
let readySnap = Object.freeze(new Set());
// The value the change is moving to, as JSON. A board only counts as ready once ITS filter reads that value — right
// after the click it still shows the OLD day, which is not the rows the user is waiting for.
let targetJson = null;

function publish(next) {
  snap = next;
  for (const fn of listeners) fn();
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(() => clearTimeout(id));
}

let quietTimer = null;
let capTimer = null;

function clearTimers() {
  for (const t of timers) t();
  timers = [];
  clearTimeout(quietTimer); quietTimer = null;
  clearTimeout(capTimer); capTimer = null;
}

function finish(my) {
  if (my !== token) return;
  clearTimers();
  unsubscribe?.();
  unsubscribe = null;
  // After a paint, so the rebuilt rows are on screen when the loader leaves.
  const cancel = afterPaint(() => { if (my === token) publish(null); });
  timers.push(cancel);
}

/** A filter change on these field ids started. */
export function beginFilterLoading(fieldIds, value) {
  const ids = (fieldIds || []).filter(Boolean);
  if (!ids.length) return;
  targetJson = value === undefined ? null : JSON.stringify(value);
  const my = ++token;
  clearTimers();
  unsubscribe?.();
  sawSweep = false;
  setReady(new Set());
  publish(Object.freeze([...new Set(ids)]));
  // The quiet timer restarts on every sweep; the cap is armed ONCE, so a sweep that never stops cannot hold it.
  unsubscribe = subscribeOpActivity(() => {
    if (my !== token) return;
    sawSweep = true;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => finish(my), QUIET_MS);
  });
  later(() => { if (!sawSweep) finish(my); }, NO_SWEEP_MS);
  capTimer = setTimeout(() => finish(my), MAX_MS);
}

function setReady(next) {
  readySnap = Object.freeze(next);
  for (const fn of readyListeners) fn();
}

/** A page's board shows rows while a change loads: its panel needs no loader. */
export function markFilterPageReady(pageOccId) {
  if (!pageOccId || !snap || readySnap.has(pageOccId)) return;
  setReady(new Set([...readySnap, pageOccId]));
}

function subscribeReady(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}
function getReady() {
  return readySnap;
}

/** The set of page occurrence ids already showing rows for the change in flight. */
export function useFilterReadyPages() {
  return useSyncExternalStore(subscribeReady, getReady, getReady);
}

export function subscribeFilterLoading(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFilterLoading() {
  return snap;
}

/** The field ids being loaded, or null. */
export function useFilterLoading() {
  return useSyncExternalStore(subscribeFilterLoading, getFilterLoading, getFilterLoading);
}

/** Does this effective filter already read the value the change is moving to? Pure. */
export function filterReachedTarget(loadingFieldIds, effectiveFilter) {
  if (targetJson == null || !loadingFieldIds?.length || !effectiveFilter) return false;
  return loadingFieldIds.every((fid) => !(fid in effectiveFilter) || JSON.stringify(effectiveFilter[fid]) === targetJson);
}

/** Is a page with this effective filter affected by the fields loading? Pure. */
export function filterIsLoading(loadingFieldIds, effectiveFilter) {
  if (!loadingFieldIds?.length || !effectiveFilter) return false;
  return loadingFieldIds.some((fid) => fid in effectiveFilter && effectiveFilter[fid] != null);
}

/** Tests only. */
export function _resetFilterLoading() {
  token++;
  clearTimers();
  unsubscribe?.();
  unsubscribe = null;
  sawSweep = false;
  snap = null;
  targetJson = null;
  readySnap = Object.freeze(new Set());
}

export const _FILTER_LOADING = { QUIET_MS, NO_SWEEP_MS, MAX_MS };
