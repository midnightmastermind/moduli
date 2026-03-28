import { getScheduler } from '../shared/scheduler';
import { tryOverflowScrollElements } from './try-overflow-scroll';
export function makeApi({
  monitor
}) {
  const ledger = new Map();
  function unsafeOverflowAutoScroll(args) {
    ledger.set(args.element, args);
    return () => ledger.delete(args.element);
  }
  function onFrame({
    latestArgs,
    underUsersPointer,
    timeSinceLastFrame
  }) {
    tryOverflowScrollElements({
      input: latestArgs.location.current.input,
      source: latestArgs.source,
      entries: Array.from(ledger).map(([_, args]) => args),
      underUsersPointer,
      timeSinceLastFrame
    });
  }

  // scheduler is never cleaned up
  getScheduler(monitor).onFrame(onFrame);
  return {
    unsafeOverflowAutoScroll
  };
}