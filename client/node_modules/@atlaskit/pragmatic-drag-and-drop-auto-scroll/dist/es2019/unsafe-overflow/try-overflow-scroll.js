import { getInternalConfig } from '../shared/configuration';
import { getScrollBy } from './get-scroll-by';
export function tryOverflowScrollElements({
  input,
  source,
  entries,
  timeSinceLastFrame,
  underUsersPointer
}) {
  // For now we are auto scrolling any element that wants to.
  // Otherwise it's hard to know what should scroll first as we might
  // be scrolling elements that have no hierarchical relationship
  for (const entry of entries) {
    var _entry$getConfigurati, _entry$getAllowedAxis, _entry$getAllowedAxis2;
    // "overflow" scrolling not relevant when directly over the element
    // "over element" scrolling is responsible for scrolling when over an element
    // 1. If we are over the element, then we want to exit and let the "overflow" scroller take over
    // 2. The overflow hitbox area for an edge actually stretches over the element
    //    This check is used to "mask" or "cut out" the element hitbox from the overflow hitbox
    if (entry.element.contains(underUsersPointer)) {
      continue;
    }
    const feedback = {
      input,
      source,
      element: entry.element
    };

    // Scrolling not allowed for this entity
    // Note: not marking engagement if an entity is opting out of scrolling
    if (entry.canScroll && !entry.canScroll(feedback)) {
      continue;
    }
    const config = getInternalConfig((_entry$getConfigurati = entry.getConfiguration) === null || _entry$getConfigurati === void 0 ? void 0 : _entry$getConfigurati.call(entry, feedback));
    const allowedAxis = (_entry$getAllowedAxis = (_entry$getAllowedAxis2 = entry.getAllowedAxis) === null || _entry$getAllowedAxis2 === void 0 ? void 0 : _entry$getAllowedAxis2.call(entry, feedback)) !== null && _entry$getAllowedAxis !== void 0 ? _entry$getAllowedAxis : 'all';
    const scrollBy = getScrollBy({
      entry,
      input,
      timeSinceLastFrame,
      allowedAxis,
      config
    });
    if (scrollBy) {
      entry.element.scrollBy(scrollBy);
    }
  }
}