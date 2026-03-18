"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getScheduler = getScheduler;
var _getElementFromPointWithoutHoneyPot = require("@atlaskit/pragmatic-drag-and-drop/private/get-element-from-point-without-honey-pot");
var _engagementHistory = require("./engagement-history");
// We keep this map so that "over element" scrolling and "overflow" scrolling
// can leverage the same scheduler.
// The 'monitor' is the key for looking up schedulers
var schedulers = new Map();
function getScheduler(monitor) {
  var scheduler = schedulers.get(monitor);
  if (scheduler) {
    // @ts-expect-error: I don't know how to link the DragType generic between the key and the value when the
    // monitor itself is the key
    return scheduler;
  }
  var created = makeScheduler(monitor);
  schedulers.set(monitor, created);
  return created;
}
function makeScheduler(monitor) {
  var state = {
    type: 'idle'
  };
  var callbacks = [];
  function loop(timeLastFrameFinished) {
    if (state.type !== 'running') {
      return;
    }
    var timeSinceLastFrame = timeLastFrameFinished - state.timeLastFrameFinished;
    var _state = state,
      latestArgs = _state.latestArgs;

    // A common starting lookup point for determining
    // which auto scroller should be used, and what should be scrolled.
    var underUsersPointer = (0, _getElementFromPointWithoutHoneyPot.getElementFromPointWithoutHoneypot)({
      x: latestArgs.location.current.input.clientX,
      y: latestArgs.location.current.input.clientY
    });
    (0, _engagementHistory.clearUnusedEngagements)(function () {
      callbacks.forEach(function (onFrame) {
        return onFrame({
          underUsersPointer: underUsersPointer,
          latestArgs: latestArgs,
          timeSinceLastFrame: timeSinceLastFrame
        });
      });
    });
    state.timeLastFrameFinished = timeLastFrameFinished;
    state.frameId = requestAnimationFrame(loop);
  }
  function reset() {
    if (state.type === 'idle') {
      return;
    }
    cancelAnimationFrame(state.frameId);
    (0, _engagementHistory.clearEngagementHistory)();
    state = {
      type: 'idle'
    };
  }
  function start(args) {
    if (state.type !== 'idle') {
      return;
    }
    state = {
      // Waiting a frame so we can accurately determine `timeSinceLastFrame`.
      type: 'initializing',
      latestArgs: args,
      frameId: requestAnimationFrame(function (timeLastFrameFinished) {
        if (state.type !== 'initializing') {
          return;
        }
        state = {
          type: 'running',
          timeLastFrameFinished: timeLastFrameFinished,
          latestArgs: state.latestArgs,
          frameId: requestAnimationFrame(loop)
        };
      })
    };
  }

  // this module might have been imported after a drag has started
  // We are starting the auto scroller if we get an update event and
  // the auto scroller has not started yet
  function update(args) {
    if (state.type === 'idle') {
      start(args);
      return;
    }
    state.latestArgs = args;
  }

  // Not exposing a way to stop listening
  monitor({
    onDragStart: start,
    onDropTargetChange: update,
    onDrag: update,
    onDrop: reset
  });
  var api = {
    onFrame: function onFrame(fn) {
      callbacks.push(fn);
    }
  };
  return api;
}