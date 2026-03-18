"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeApi = makeApi;
var _slicedToArray2 = _interopRequireDefault(require("@babel/runtime/helpers/slicedToArray"));
var _scheduler = require("../shared/scheduler");
var _tryOverflowScroll = require("./try-overflow-scroll");
function makeApi(_ref) {
  var monitor = _ref.monitor;
  var ledger = new Map();
  function unsafeOverflowAutoScroll(args) {
    ledger.set(args.element, args);
    return function () {
      return ledger.delete(args.element);
    };
  }
  function onFrame(_ref2) {
    var latestArgs = _ref2.latestArgs,
      underUsersPointer = _ref2.underUsersPointer,
      timeSinceLastFrame = _ref2.timeSinceLastFrame;
    (0, _tryOverflowScroll.tryOverflowScrollElements)({
      input: latestArgs.location.current.input,
      source: latestArgs.source,
      entries: Array.from(ledger).map(function (_ref3) {
        var _ref4 = (0, _slicedToArray2.default)(_ref3, 2),
          _ = _ref4[0],
          args = _ref4[1];
        return args;
      }),
      underUsersPointer: underUsersPointer,
      timeSinceLastFrame: timeSinceLastFrame
    });
  }

  // scheduler is never cleaned up
  (0, _scheduler.getScheduler)(monitor).onFrame(onFrame);
  return {
    unsafeOverflowAutoScroll: unsafeOverflowAutoScroll
  };
}