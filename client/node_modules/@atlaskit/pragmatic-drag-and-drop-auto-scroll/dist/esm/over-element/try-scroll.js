function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
import { getInternalConfig } from '../shared/configuration';
import { markAndGetEngagement } from '../shared/engagement-history';
import { selector } from './data-attributes';
import { getScrollBy } from './get-scroll-by';
function isScrollingAvailable(value) {
  return Boolean(value.top || value.left);
}
function tryScrollElements(_ref) {
  var _container$getConfigu, _container$getAllowed, _container$getAllowed2;
  var target = _ref.target,
    input = _ref.input,
    source = _ref.source,
    findEntry = _ref.findEntry,
    timeSinceLastFrame = _ref.timeSinceLastFrame,
    _ref$available = _ref.available,
    available = _ref$available === void 0 ? {
      top: true,
      left: true
    } : _ref$available;
  // we cannot do any more scrolling
  if (!isScrollingAvailable(available)) {
    return available;
  }

  // run out of parents to search
  if (!target) {
    return available;
  }
  var element = target.closest(selector);

  // cannot find any more scroll containers
  if (!element) {
    return available;
  }
  var container = findEntry(element);

  // cannot find registration, this is bad.
  // fail and just exit
  if (!container) {
    return available;
  }
  function continueSearchUp() {
    var _element$parentElemen;
    return tryScrollElements({
      target: (_element$parentElemen = element === null || element === void 0 ? void 0 : element.parentElement) !== null && _element$parentElemen !== void 0 ? _element$parentElemen : null,
      findEntry: findEntry,
      source: source,
      timeSinceLastFrame: timeSinceLastFrame,
      input: input,
      available: available
    });
  }
  var feedback = {
    input: input,
    source: source,
    element: element
  };

  // Engagement is not marked if scrolling is explicitly not allowed
  if (container.canScroll && !container.canScroll(feedback)) {
    return continueSearchUp();
  }

  // Marking engagement even if no edges are scrollable.
  // We are marking engagement as soon as the element is scrolled over
  var engagement = markAndGetEngagement(element);
  var config = getInternalConfig((_container$getConfigu = container.getConfiguration) === null || _container$getConfigu === void 0 ? void 0 : _container$getConfigu.call(container, feedback));
  var allowedAxis = (_container$getAllowed = (_container$getAllowed2 = container.getAllowedAxis) === null || _container$getAllowed2 === void 0 ? void 0 : _container$getAllowed2.call(container, feedback)) !== null && _container$getAllowed !== void 0 ? _container$getAllowed : 'all';
  var scrollBy = getScrollBy({
    element: element,
    engagement: engagement,
    input: input,
    timeSinceLastFrame: timeSinceLastFrame,
    allowedAxis: allowedAxis,
    config: config
  });

  // Only allow scrolling in directions that have not already been used
  var scroll = {
    top: 0,
    left: 0
  };
  if (available.top && scrollBy.top !== 0) {
    scroll.top = scrollBy.top;
    // can no longer scroll on the top after this
    available.top = false;
  }
  if (available.left && scrollBy.left !== 0) {
    scroll.left = scrollBy.left;
    // can no longer scroll on the left after this
    available.left = false;
  }

  // Only scroll if there is something to scroll
  if (scroll.top !== 0 || scroll.left !== 0) {
    element.scrollBy(scroll);
  }
  return continueSearchUp();
}
function tryScrollWindow(_ref2) {
  var input = _ref2.input,
    timeSinceLastFrame = _ref2.timeSinceLastFrame,
    available = _ref2.available,
    source = _ref2.source,
    entries = _ref2.entries;
  var element = document.documentElement;
  var feedback = {
    input: input,
    source: source,
    element: element
  };
  var _iterator = _createForOfIteratorHelper(entries),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var _entry$getConfigurati, _entry$getAllowedAxis, _entry$getAllowedAxis2;
      var entry = _step.value;
      // this entry is not allowing scrolling, we need to look for another
      if (entry.canScroll && !entry.canScroll(feedback)) {
        continue;
      }

      // Note: if we had an event for when the user is leaving a tab
      // we _could_ conceptually reset the engagement
      var engagement = markAndGetEngagement(element);
      var config = getInternalConfig((_entry$getConfigurati = entry.getConfiguration) === null || _entry$getConfigurati === void 0 ? void 0 : _entry$getConfigurati.call(entry, feedback));
      var allowedAxis = (_entry$getAllowedAxis = (_entry$getAllowedAxis2 = entry.getAllowedAxis) === null || _entry$getAllowedAxis2 === void 0 ? void 0 : _entry$getAllowedAxis2.call(entry, feedback)) !== null && _entry$getAllowedAxis !== void 0 ? _entry$getAllowedAxis : 'all';
      var scrollBy = getScrollBy({
        element: element,
        engagement: engagement,
        input: input,
        config: config,
        allowedAxis: allowedAxis,
        getRect: function getRect(element) {
          return DOMRect.fromRect({
            y: 0,
            x: 0,
            width: element.clientWidth,
            height: element.clientHeight
          });
        },
        timeSinceLastFrame: timeSinceLastFrame
      });
      var scroll = {
        top: available.top ? scrollBy.top : 0,
        left: available.left ? scrollBy.left : 0
      };

      // only trigger a scroll if we are actually scrolling
      if (scroll.top !== 0 || scroll.left !== 0) {
        element.scrollBy(scroll);
      }

      // We only want the window to scroll once
      break;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
}
export function tryScroll(_ref3) {
  var input = _ref3.input,
    findEntry = _ref3.findEntry,
    timeSinceLastFrame = _ref3.timeSinceLastFrame,
    source = _ref3.source,
    getWindowScrollEntries = _ref3.getWindowScrollEntries,
    underUsersPointer = _ref3.underUsersPointer;
  // We are matching browser behaviour and scrolling inner elements
  // before outer ones. So we try to scroll scroller containers before
  // the window.
  var remainder = tryScrollElements({
    target: underUsersPointer,
    timeSinceLastFrame: timeSinceLastFrame,
    input: input,
    source: source,
    findEntry: findEntry
  });

  // Check if we can do any window scrolling
  if (!isScrollingAvailable(remainder)) {
    return;
  }
  tryScrollWindow({
    input: input,
    source: source,
    entries: getWindowScrollEntries(),
    timeSinceLastFrame: timeSinceLastFrame,
    available: remainder
  });
}