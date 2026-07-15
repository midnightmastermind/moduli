// utils/gridFilterTrigger.js
// ============================================================
// "The GLOBAL (toolbar) filter drives everything."
//
// Date-driven ops (the Schedule builders, and every goal/account/tracker
// aggregation) react to a filter change via ONE of two trigger shapes:
//   • { onFilterChange, subjectType: "filterNav", ancestorLabel: <page> }
//        — the ON-PAGE local date nav (Schedule / Goals / Accounts page).
//   • { onFilterChange, subjectType: "grid" }
//        — the GLOBAL toolbar filter (grid.activeFilterValues).
//
// The Schedule/Day-Page builders declare both; the tracker builders historically
// declared only the on-page one, so changing the toolbar date rebuilt the
// Schedule but NOT the Goals/Accounts trackers (user 2026-07-15: "make all those
// ops respond to the grid filter change as well — accounts and goals").
//
// `ensureGridFilterTrigger(ops)` closes that gap uniformly: any op that listens
// for an on-page (filterNav) filter change but has no grid-subject onFilterChange
// trigger gets one appended. Idempotent (skips ops that already have it). Mutates
// each changed op in place and returns the changed list — same pattern as
// applyPeriodAllPolicy / gateScheduleTrackers.
// ============================================================

function hasTrigger(op, subjectType) {
  return (op.triggerObjects || []).some(
    (t) => t.eventType === "onFilterChange" && t.subjectType === subjectType
  );
}

export function ensureGridFilterTrigger(ops) {
  const changed = [];
  for (const op of ops || []) {
    const listensToPageFilter = hasTrigger(op, "filterNav");
    if (!listensToPageFilter) continue;          // not a filter-driven op — leave it
    if (hasTrigger(op, "grid")) continue;        // already global — idempotent

    // Match the priority of its filterNav trigger so it slots into the same
    // cascade position (trackers run at 3, after the schedule build at 1-2).
    const navTrig = (op.triggerObjects || []).find(
      (t) => t.eventType === "onFilterChange" && t.subjectType === "filterNav"
    );
    op.triggerObjects = [
      ...(op.triggerObjects || []),
      { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: navTrig?.priority ?? 3 },
    ];
    if (!Array.isArray(op.triggerTypes)) op.triggerTypes = [];
    if (!op.triggerTypes.includes("onFilterChange")) op.triggerTypes.push("onFilterChange");
    changed.push(op);
  }
  return changed;
}
