import { axisLookup } from './axis';
import { getPercentageInRange } from './get-percentage-in-range';
import { mainAxisSideLookup } from './side';

// We want a consistent scroll speed across devices, regardless of framerate
function getMaxScrollChange(_ref) {
  var timeSinceLastFrame = _ref.timeSinceLastFrame,
    config = _ref.config;
  var targetScrollPerMs = config.maxPixelScrollPerSecond / 1000;

  // Adjusting out target scroll rate to match the frame rate of the target device
  // This will pull the scroll speed down on high frame rate devices
  // so we get a consistent visual scroll speed regardless of device.
  var proposed = Math.ceil(targetScrollPerMs * timeSinceLastFrame);

  // If lots of time as passed since that last frame (such on lower frame rate devices)
  // we don't want the scroll speed to be too fast, otherwise it can feel jumpy
  // We are capping the scroll speed at what it would be if we were hitting 60fps
  var maximum = config.maxPixelScrollPerSecond / 60;
  return Math.min(proposed, maximum);
}
function getDistanceDampening(_ref2) {
  var client = _ref2.client,
    axis = _ref2.axis,
    edge = _ref2.edge,
    hitbox = _ref2.hitbox,
    config = _ref2.config;
  var mainAxis = axisLookup[axis].mainAxis;
  var side = mainAxisSideLookup[edge];

  // We want to hit the max speed before the edge of the hitbox
  var maxSpeedBuffer = hitbox[mainAxis.size] * config.maxScrollAtPercentageRemainingOfHitbox[edge];
  if (side === 'end') {
    return getPercentageInRange({
      startOfRange: hitbox[mainAxis.start],
      endOfRange: hitbox[mainAxis.end] - maxSpeedBuffer,
      value: client[mainAxis.point]
    });
  }

  // Moving towards start edge

  var raw = getPercentageInRange({
    startOfRange: hitbox[mainAxis.start] + maxSpeedBuffer,
    endOfRange: hitbox[mainAxis.end],
    value: client[mainAxis.point]
  });
  // When moving near start edge
  // - the 'end' edge is where we start scrolling
  // - the 'start' edge is where we reach max speed
  // So we need to invert the percentage when moving backwards
  return 1 - raw;
}
export function getScrollChange(_ref3) {
  var client = _ref3.client,
    timeSinceLastFrame = _ref3.timeSinceLastFrame,
    engagement = _ref3.engagement,
    axis = _ref3.axis,
    hitbox = _ref3.hitbox,
    edge = _ref3.edge,
    isDistanceDampeningEnabled = _ref3.isDistanceDampeningEnabled,
    config = _ref3.config;
  // We have two forms of speed dampening:
  // 1. 🗺️ Distance
  // The closer you are to a hitbox edge, the faster the scroll speed will be
  // 2. ⏱️ Time
  // When first entering a scroll container we want to dampening all scrolling
  // This is to prevent super fast auto scrolling when first entering into
  // a scroll container, or when lifting in a scroll container

  var maxScroll = getMaxScrollChange({
    timeSinceLastFrame: timeSinceLastFrame,
    config: config
  });
  var percentageDistanceDampening = isDistanceDampeningEnabled ? getDistanceDampening({
    client: client,
    edge: edge,
    hitbox: hitbox,
    axis: axis,
    config: config
  }) : 1;

  // Dampen speed by time
  var percentageThroughTimeDampening = getPercentageInRange({
    startOfRange: engagement.timeOfEngagementStart,
    endOfRange: engagement.timeOfEngagementStart + config.timeDampeningDurationMs,
    value: Date.now()
  });

  // Calculate how much of the max scroll we should apply based on dampening
  var percentageOfMaxScroll = percentageDistanceDampening * percentageThroughTimeDampening;

  // We _could_ ease this update (`Math.pow(percentageOfMaxSpeed, 2)`)
  // But linear is feeling really good
  // Always scrolling by at least one pixel, otherwise the scroll does nothing
  var scroll = Math.max(maxScroll * percentageOfMaxScroll, 1);
  var side = mainAxisSideLookup[edge];

  // When moving backwards, we will be scrolling backwards
  return side === 'end' ? scroll : -1 * scroll;
}