import _slicedToArray from "@babel/runtime/helpers/slicedToArray";
import { getScheduler } from '../shared/scheduler';
import { tryOverflowScrollElements } from './try-overflow-scroll';
export function makeApi(_ref) {
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
    tryOverflowScrollElements({
      input: latestArgs.location.current.input,
      source: latestArgs.source,
      entries: Array.from(ledger).map(function (_ref3) {
        var _ref4 = _slicedToArray(_ref3, 2),
          _ = _ref4[0],
          args = _ref4[1];
        return args;
      }),
      underUsersPointer: underUsersPointer,
      timeSinceLastFrame: timeSinceLastFrame
    });
  }

  // scheduler is never cleaned up
  getScheduler(monitor).onFrame(onFrame);
  return {
    unsafeOverflowAutoScroll: unsafeOverflowAutoScroll
  };
}