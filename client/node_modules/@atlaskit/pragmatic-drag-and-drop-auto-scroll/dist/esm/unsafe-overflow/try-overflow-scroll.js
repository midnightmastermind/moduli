function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
import { getInternalConfig } from '../shared/configuration';
import { getScrollBy } from './get-scroll-by';
export function tryOverflowScrollElements(_ref) {
  var input = _ref.input,
    source = _ref.source,
    entries = _ref.entries,
    timeSinceLastFrame = _ref.timeSinceLastFrame,
    underUsersPointer = _ref.underUsersPointer;
  // For now we are auto scrolling any element that wants to.
  // Otherwise it's hard to know what should scroll first as we might
  // be scrolling elements that have no hierarchical relationship
  var _iterator = _createForOfIteratorHelper(entries),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var _entry$getConfigurati, _entry$getAllowedAxis, _entry$getAllowedAxis2;
      var entry = _step.value;
      // "overflow" scrolling not relevant when directly over the element
      // "over element" scrolling is responsible for scrolling when over an element
      // 1. If we are over the element, then we want to exit and let the "overflow" scroller take over
      // 2. The overflow hitbox area for an edge actually stretches over the element
      //    This check is used to "mask" or "cut out" the element hitbox from the overflow hitbox
      if (entry.element.contains(underUsersPointer)) {
        continue;
      }
      var feedback = {
        input: input,
        source: source,
        element: entry.element
      };

      // Scrolling not allowed for this entity
      // Note: not marking engagement if an entity is opting out of scrolling
      if (entry.canScroll && !entry.canScroll(feedback)) {
        continue;
      }
      var config = getInternalConfig((_entry$getConfigurati = entry.getConfiguration) === null || _entry$getConfigurati === void 0 ? void 0 : _entry$getConfigurati.call(entry, feedback));
      var allowedAxis = (_entry$getAllowedAxis = (_entry$getAllowedAxis2 = entry.getAllowedAxis) === null || _entry$getAllowedAxis2 === void 0 ? void 0 : _entry$getAllowedAxis2.call(entry, feedback)) !== null && _entry$getAllowedAxis !== void 0 ? _entry$getAllowedAxis : 'all';
      var scrollBy = getScrollBy({
        entry: entry,
        input: input,
        timeSinceLastFrame: timeSinceLastFrame,
        allowedAxis: allowedAxis,
        config: config
      });
      if (scrollBy) {
        entry.element.scrollBy(scrollBy);
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
}