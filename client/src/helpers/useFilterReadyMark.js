// helpers/useFilterReadyMark.js — a page tells its panel "the new value is already on screen, drop the loader".
//
// A toolbar date step shows a loader on every panel whose page the date re-filters (helpers/filterLoading). For a day
// that already exists the rows are there at once, so waiting for every op sweep to go quiet left the spinner over
// rows the user could already read (user, 2026-11-12). Once the page's own filter reads the target value and it has
// content, it marks itself ready. A layout effect, so the mark lands in the same commit — before the paint and
// before the op sweep that follows blocks the thread.

import { useLayoutEffect } from "react";
import { useGridActionsSelector } from "../GridActionsContext";
import { getEffectiveFilterForOccurrence } from "../state/selectors";
import { useFilterLoading, filterIsLoading, filterReachedTarget, markFilterPageReady } from "./filterLoading";

/** Returns whether a change in flight re-filters this page (so callers can hold their empty state). */
export function useFilterReadyMark(occurrence, hasContent) {
  const loadingFields = useFilterLoading();
  const grid = useGridActionsSelector((s) => s.state?.grid || s.grid);
  const getOccMap = useGridActionsSelector((s) => s.getOccMap || (() => s.occurrencesById || {}));
  const pageFilter = loadingFields && occurrence
    ? getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById: getOccMap() })
    : null;
  const loading = !!pageFilter && filterIsLoading(loadingFields, pageFilter);
  const onTarget = loading && filterReachedTarget(loadingFields, pageFilter);
  const id = occurrence?.id;
  useLayoutEffect(() => {
    if (onTarget && hasContent) markFilterPageReady(id);
  }, [onTarget, hasContent, id]);
  return loading;
}
