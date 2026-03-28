import { canScrollOnEdge } from '../shared/can-scroll-on-edge';
import { edgeAxisLookup, edges } from '../shared/edges';
import { getOverElementHitbox } from '../shared/get-over-element-hitbox';
import { getScrollChange } from '../shared/get-scroll-change';
import { isAxisAllowed } from '../shared/is-axis-allowed';
import { isWithin } from '../shared/is-within';
function getRectDefault(element) {
  return element.getBoundingClientRect();
}
export function getScrollBy(_ref) {
  var element = _ref.element,
    input = _ref.input,
    timeSinceLastFrame = _ref.timeSinceLastFrame,
    engagement = _ref.engagement,
    config = _ref.config,
    allowedAxis = _ref.allowedAxis,
    _ref$getRect = _ref.getRect,
    getRect = _ref$getRect === void 0 ? getRectDefault : _ref$getRect;
  var client = {
    x: input.clientX,
    y: input.clientY
  };
  var clientRect = getRect(element);
  var scrollableEdges = edges.reduce(function (map, edge) {
    var hitbox = getOverElementHitbox[edge]({
      clientRect: clientRect,
      config: config
    });
    var axis = edgeAxisLookup[edge];

    // Note: changing the allowed axis during a drag will not
    // reset time dampening. It was decided it would be too
    // complex to implement initially, and we can add it
    // later if needed.
    if (!isAxisAllowed(axis, allowedAxis)) {
      return map;
    }
    if (!isWithin({
      client: client,
      clientRect: hitbox
    })) {
      return map;
    }
    if (!canScrollOnEdge[edge](element)) {
      return map;
    }
    map.set(edge, {
      edge: edge,
      hitbox: hitbox
    });
    return map;
  }, new Map());
  var left = function () {
    var axis = 'horizontal';
    var leftEdge = scrollableEdges.get('left');
    if (leftEdge) {
      return getScrollChange({
        client: client,
        edge: leftEdge.edge,
        hitbox: leftEdge.hitbox,
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        isDistanceDampeningEnabled: true,
        config: config
      });
    }
    var rightEdge = scrollableEdges.get('right');
    if (rightEdge) {
      return getScrollChange({
        client: client,
        edge: rightEdge.edge,
        hitbox: rightEdge.hitbox,
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        isDistanceDampeningEnabled: true,
        config: config
      });
    }
    return 0;
  }();
  var top = function () {
    var axis = 'vertical';
    var bottomEdge = scrollableEdges.get('bottom');
    if (bottomEdge) {
      return getScrollChange({
        client: client,
        edge: bottomEdge.edge,
        hitbox: bottomEdge.hitbox,
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        isDistanceDampeningEnabled: true,
        config: config
      });
    }
    var topEdge = scrollableEdges.get('top');
    if (topEdge) {
      return getScrollChange({
        client: client,
        edge: topEdge.edge,
        hitbox: topEdge.hitbox,
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        isDistanceDampeningEnabled: true,
        config: config
      });
    }
    return 0;
  }();
  return {
    left: left,
    top: top
  };
}