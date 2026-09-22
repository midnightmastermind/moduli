// client/src/helpers/filterConfig.js
//
// The filter-CONFIGURATION gestures: activate, deactivate, clear. One place,
// each wrapped in ONE `withAction`, because each is one thing the user did.
//
// WHY THESE LIVE HERE AND NOT IN `CommitHelpers.updateOccurrenceFilterOverride`:
// that helper is also how an OPERATION moves a filter
// (`bindSocketToStore` UPDATE_ITEM_FILTER_OVERRIDE) and how a nav widget steps a
// date. Those writes must stay `derived` — an op rebuilding the day, or the
// arrow you pressed to look at tomorrow, is not a step anyone presses Ctrl+Z to
// take back, and making them undoable buries the user's own gestures under
// dozens of app-authored ones (`actionScope.js` records exactly that going
// wrong: one checkbox producing 201 action ids). So the stamp goes on the
// gesture, not on the write.
//
// The line this draws: NAVIGATING a filter is not an edit — the toolbar's date
// step writes no transaction at all — while CONFIGURING one is.
//
// Measured on prod before this existed (2026-09-22): deactivating the inherited
// date filter on a container wrote TWO transactions, and the one that actually
// deactivated the filter carried no action id, so undo skipped it and only
// un-hid the nav widget.
import { withAction } from "./actionScope";
import * as CommitHelpers from "./CommitHelpers";

/** Drop one key from the override and commit the rest. Shared by every gesture
 *  here: muting writes `null`, everything else deletes. */
function nextOverride(overrides, fieldId, value) {
  const next = { ...(overrides || {}) };
  if (value === undefined) delete next[fieldId];
  else next[fieldId] = value;
  return next;
}

function commitOverride({ dispatch, socket, occurrence, filterOverride, fieldId, date = null, occurrencesById, modulesById }) {
  CommitHelpers.updateOccurrenceFilterOverride({
    dispatch, socket, id: occurrence.id, filterOverride,
    occurrencesById, modulesById,
    navFieldId: fieldId, date,
  });
}

/**
 * Turn the filter OFF here: mute the field AND hide its now-meaningless nav
 * widget. Both halves are ONE undo step because they are one gesture — undoing
 * half of it leaves a container whose filter is off and whose nav is missing,
 * which is a state the user never chose.
 *
 * `navWasOn` is the caller's own effective-nav reading (FiltersSection computes
 * it from the cascade); passing false skips the second write entirely rather
 * than writing a `visible: false` that was already false.
 */
export function deactivateFilter({
  dispatch, socket, occurrence, fieldId,
  overrides, navConfig, navFilterId, navWasOn,
  occurrencesById, modulesById,
}) {
  if (!fieldId || !occurrence?.id) return;
  withAction("Deactivated filter", () => {
    commitOverride({
      dispatch, socket, occurrence, fieldId,
      filterOverride: nextOverride(overrides, fieldId, null),
      occurrencesById, modulesById,
    });
    if (navFilterId && navWasOn) {
      const cfg = navConfig || {};
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: occurrence.id,
          filterNavConfig: { ...cfg, [navFilterId]: { ...(cfg[navFilterId] || {}), visible: false } },
        },
        emit: true,
      });
    }
  });
}

/**
 * Turn the filter back ON here. Two shapes, both one write:
 *   - `value === undefined` drops the mute so the cascade flows again;
 *   - a value force-enables the field on THIS occurrence, for the case where an
 *     ancestor (or a page-wide `filterOverride: {}`) clears it and there is
 *     nothing to un-mute.
 */
export function activateFilter({
  dispatch, socket, occurrence, fieldId, overrides, value,
  occurrencesById, modulesById,
}) {
  if (!fieldId || !occurrence?.id) return;
  withAction("Activated filter", () => {
    commitOverride({
      dispatch, socket, occurrence, fieldId,
      filterOverride: nextOverride(overrides, fieldId, value),
      date: value ?? null,
      occurrencesById, modulesById,
    });
  });
}

/**
 * Drop this occurrence's own entry for the field: re-inherit from the parent
 * (the lock affordance) or remove a local filter. Identical write either way —
 * they were two copies of the same body in FiltersSection.
 */
export function clearFilterOverride({
  dispatch, socket, occurrence, fieldId, overrides,
  occurrencesById, modulesById,
}) {
  if (!fieldId || !occurrence?.id) return;
  withAction("Cleared filter", () => {
    commitOverride({
      dispatch, socket, occurrence, fieldId,
      filterOverride: nextOverride(overrides, fieldId, undefined),
      occurrencesById, modulesById,
    });
  });
}
