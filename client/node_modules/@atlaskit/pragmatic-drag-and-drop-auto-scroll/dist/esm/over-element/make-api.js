import _defineProperty from "@babel/runtime/helpers/defineProperty";
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { getScheduler } from '../shared/scheduler';
import { addScrollableAttribute } from './data-attributes';
import { tryScroll } from './try-scroll';
export function makeApi(_ref) {
  var monitor = _ref.monitor;
  var elementRegistry = new Map();
  var windowRegistry = new Set();
  function autoScroll(args) {
    // Warn during development if trying to add auto scroll to an element
    // that is not scrollable.
    // Note: this can produce a false positive when a scroll container is not
    // scrollable initially, but becomes scrollable during a drag.
    // I thought of adding the warning as I think it would be a more common pitfall
    // to accidentally register auto scrolling on the wrong element
    // If requested, we could provide a mechanism to opt out of this warning
    if (process.env.NODE_ENV !== 'production') {
      var _window$getComputedSt = window.getComputedStyle(args.element),
        overflowX = _window$getComputedSt.overflowX,
        overflowY = _window$getComputedSt.overflowY;
      var isScrollable = overflowX === 'auto' || overflowX === 'scroll' || overflowY === 'auto' || overflowY === 'scroll';
      if (!isScrollable) {
        // eslint-disable-next-line no-console
        console.warn('Auto scrolling has been attached to an element that appears not to be scrollable', {
          element: args.element,
          overflowX: overflowX,
          overflowY: overflowY
        });
      }
    }

    // Warn if there is an existing registration
    if (process.env.NODE_ENV !== 'production') {
      var existing = elementRegistry.get(args.element);
      if (existing) {
        // eslint-disable-next-line no-console
        console.warn('You have already registered autoScrolling on the same element', {
          existing: existing,
          proposed: args
        });
      }
    }
    elementRegistry.set(args.element, args);
    return combine(addScrollableAttribute(args.element), function () {
      return elementRegistry.delete(args.element);
    });
  }
  function autoScrollWindow() {
    var args = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    // Putting `args` in a unique object so that
    // each call will create a unique entry, even if a consumer
    // shares the `args` object between calls.
    // Just being safe here.
    var unique = _objectSpread({}, args);
    windowRegistry.add(unique);
    return function () {
      return windowRegistry.delete(unique);
    };
  }
  function findEntry(element) {
    var _elementRegistry$get;
    return (_elementRegistry$get = elementRegistry.get(element)) !== null && _elementRegistry$get !== void 0 ? _elementRegistry$get : null;
  }
  function getWindowScrollEntries() {
    return Array.from(windowRegistry);
  }
  function onFrame(_ref2) {
    var latestArgs = _ref2.latestArgs,
      underUsersPointer = _ref2.underUsersPointer,
      timeSinceLastFrame = _ref2.timeSinceLastFrame;
    tryScroll({
      input: latestArgs.location.current.input,
      source: latestArgs.source,
      findEntry: findEntry,
      underUsersPointer: underUsersPointer,
      timeSinceLastFrame: timeSinceLastFrame,
      getWindowScrollEntries: getWindowScrollEntries
    });
  }
  getScheduler(monitor).onFrame(onFrame);
  return {
    autoScroll: autoScroll,
    autoScrollWindow: autoScrollWindow
  };
}