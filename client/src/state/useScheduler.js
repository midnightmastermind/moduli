// state/useScheduler.js
// ============================================================
// Time-based operation scheduler. Sits outside the event-trigger system
// (runMatchingOperations) so per-second cadence ticks don't pollute the
// action op queue / run log.
//
// Design notes:
//   - One trigger per scheduled op (enforced by editor — schedule != null
//     means triggerObjects must be empty).
//   - Cross-device sync via `schedule.lastFiredAt` on the Operation record.
//     Whichever client fires first updates lastFiredAt; server rejects
//     stale lastFiredAt writes (see socketHandlers/crud.js update_operation
//     guard); other clients see the broadcast and skip their next due check.
//   - atTimes mode fires at most once per minute (HH:MM granularity).
//   - NO hardcoded cadence rule. Display effects (computedValues writes)
//     and persistent effects (UPDATE_ITEM_FIELD/CREATE_ITEM/etc.) are
//     handled uniformly — same code path that event-triggered ops use.
//     Cost is determined by `writes-per-fire × fires-per-hour`, not by
//     cadence alone. A well-designed every-minute op with a smart dedup
//     guard is cheap; a sloppy every-hour op that re-writes every slot
//     on every fire is expensive. The scheduler surfaces this at the
//     console (soft warn) so the author can see what their op is doing.
// ============================================================
import { useEffect, useRef } from "react";
import { executePipeline } from "../helpers/operationExecutor";
import { setComputedValuesAction } from "./actions";
import { operationsBridge } from "./bindSocketToStore";
import { safeEmit } from "../helpers/offlineQueue";

const UNIT_MS = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
// Cadence floor for persistent-effect schedules (UPDATE_ITEM_FIELD,
// CREATE_ITEM, COPY_LINK, NOTIFY, etc.). Sub-minute schedules can still
// run — they're restricted to display-only effects (computedValues writes,
// e.g. live clock ticks). 60s is well above the cost cliff where socket
// writes start to dominate, and well below useful cadences like every-
// minute aggregations.
const PERSISTENT_FLOOR_MS = 60_000;
// Soft cost threshold for the console warning. Extrapolated as
// `effectsThisFire × (3_600_000 / cadenceMs)`. Author still in control;
// this just makes accidental thrashing visible.
const SOFT_WRITES_PER_HOUR_WARN = 600;

export function cadenceMs(schedule) {
  if (!schedule) return Infinity;
  if (schedule.kind === "interval") {
    const u = UNIT_MS[schedule.unit] || UNIT_MS.minute;
    return Math.max(1_000, (Number(schedule.every) || 1) * u);
  }
  // atTimes is point-in-time — treat as hour+ for the display-only rule.
  return Infinity;
}

export function isDueAt(schedule, now, lastFiredAt) {
  if (!schedule) return false;
  const lastMs = lastFiredAt ? new Date(lastFiredAt).getTime() : 0;
  if (schedule.kind === "interval") {
    if (!lastMs) return true;
    return now.getTime() - lastMs >= cadenceMs(schedule);
  }
  if (schedule.kind === "atTimes") {
    const times = Array.isArray(schedule.times) ? schedule.times : [];
    if (!times.length) return false;
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    if (!times.includes(`${hh}:${mm}`)) return false;
    // Dedup: don't fire twice within the same minute on any device.
    return now.getTime() - lastMs > 60_000;
  }
  return false;
}

// Invoked from App.jsx at the top of the component (above the context
// providers), so args are passed explicitly rather than via useContext.
export function useScheduler({ state, dispatch, socket, fieldsById, operationsById, occurrencesById, modulesById }) {
  // Per-tab guard: even with lastFiredAt synced via socket, two ticks
  // landing on the same op within one tick window could both proceed
  // before the echo arrives. This Set is cleared on each successful
  // socket round-trip via update_operation; until then we treat the op
  // as "in flight" locally.
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    if (!operationsById || !socket) return;

    const tick = () => {
      const now = new Date();
      const inFlight = inFlightRef.current;
      for (const opId of Object.keys(operationsById)) {
        const op = operationsById[opId];
        if (!op || !op.enabled || !op.schedule) continue;
        if (inFlight.has(opId)) continue;
        const sched = op.schedule;
        if (!isDueAt(sched, now, sched.lastFiredAt)) continue;

        try {
          inFlight.add(opId);
          const ctx = { state, fieldsById, occurrencesById, operationsById, modulesById };
          const tx = { type: "ScheduleTick", scheduleId: op.id, scheduleKind: sched.kind, at: now.toISOString() };
          const updates = executePipeline(op, ctx, tx);

          // Uniform handling: display effects → computedValues; persistent
          // effects → same dispatch path event-triggered ops use. No cadence
          // gating — author's responsibility to keep writes-per-fire small.
          const displayUpdates = updates.filter((u) => !u._effect);
          const effects = updates.filter((u) => u._effect);

          if (displayUpdates.length > 0) {
            dispatch(setComputedValuesAction(displayUpdates));
          }
          const cmsFloor = cadenceMs(sched);
          const belowFloor = Number.isFinite(cmsFloor) && cmsFloor < PERSISTENT_FLOOR_MS;
          if (effects.length > 0) {
            if (belowFloor) {
              // Sub-minute schedules skip persistent effects. Display work
              // (computedValues writes above) still runs — clock/live-value
              // ops keep working.
              console.warn(
                `[scheduler] "${op.name}" cadence is sub-minute; skipped ${effects.length} ` +
                `persistent effects. Use minute+ cadence for socket-writing pipelines.`
              );
            } else if (typeof operationsBridge.applyEffect === "function") {
              for (const eff of effects) operationsBridge.applyEffect(eff);
            }
          }

          // Soft cost surfacing — extrapolate writes-per-hour and warn if
          // it crosses the threshold. Not a block, just visibility so an
          // accidentally-thrashy pipeline shows up in devtools.
          const cms = cadenceMs(sched);
          if (Number.isFinite(cms) && effects.length > 0) {
            const writesPerHour = effects.length * (3_600_000 / cms);
            if (writesPerHour > SOFT_WRITES_PER_HOUR_WARN) {
              console.warn(
                `[scheduler] "${op.name}" projecting ~${Math.round(writesPerHour)} writes/hour ` +
                `(${effects.length} effects × ${(3_600_000 / cms).toFixed(0)} fires/hr). ` +
                `Consider a dedup guard in the pipeline so each fire only writes what changed.`
              );
            }
          }

          // Stamp lastFiredAt. The socket emit broadcasts to all user
          // sockets so other devices see the update and skip their next
          // due check until cadence elapses again.
          const nextSchedule = { ...sched, lastFiredAt: now.toISOString() };
          safeEmit(socket, "update_operation", { ...op, schedule: nextSchedule });
          // Clear in-flight on next tick once the echo lands (or fail-safe
          // 2s later in case the server is offline).
          setTimeout(() => inFlight.delete(opId), 2_000);
        } catch (err) {
          inFlight.delete(opId);
          console.error(`[scheduler] op "${op.name}" failed:`, err);
        }
      }
    };

    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [operationsById, state, fieldsById, occurrencesById, modulesById, dispatch, socket]);
}
