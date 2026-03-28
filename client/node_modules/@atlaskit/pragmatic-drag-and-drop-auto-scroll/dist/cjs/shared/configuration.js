"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getInternalConfig = getInternalConfig;
var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { (0, _defineProperty2.default)(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
var baseConfig = {
  startHitboxAtPercentageRemainingOfElement: {
    top: 0.25,
    right: 0.25,
    bottom: 0.25,
    left: 0.25
  },
  maxScrollAtPercentageRemainingOfHitbox: {
    top: 0.5,
    right: 0.5,
    bottom: 0.5,
    left: 0.5
  },
  timeDampeningDurationMs: 300,
  // Too big and it's too easy to trigger auto scrolling
  // Too small and it's too hard 😅
  maxMainAxisHitboxSize: 180
};

/** What the max scroll should be per second. Using "per second" rather than "per frame"
 * as we want a consistent scroll speed regardless of frame rate.
 *
 *
 * I explored trying to make the max scroll speed dynamic based on particular factors.
 * However, it ended up being difficult to find a _perfect_ formula.
 *
 * Likely the perfect answer would involve:
 * - the size of the scrollable element
 * - the size of the scrollable element relative to the screen size
 * - the size of the drag preview
 * - the size of elements being scrolled in scrollable elements (expensive and difficult to compute)
 */
var maxPixelScrollPerSecond = {
  // What the value would be if we were scrolling at 15px per frame at 60fps.
  // This is the default as it works well for most experiences.
  // In certain scenarios though it can feel a bit slow.
  standard: 15 * 60,
  // What the value would be if we were scrolling at 25px per frame at 60fps.
  // This is not the default as it feels too fast for a lot of experiences.
  fast: 25 * 60
};
function getInternalConfig(provided) {
  var _provided$maxScrollSp;
  return _objectSpread(_objectSpread({}, baseConfig), {}, {
    // only allowing limited control over the config at this stage
    maxPixelScrollPerSecond: maxPixelScrollPerSecond[(_provided$maxScrollSp = provided === null || provided === void 0 ? void 0 : provided.maxScrollSpeed) !== null && _provided$maxScrollSp !== void 0 ? _provided$maxScrollSp : 'standard']
  });
}