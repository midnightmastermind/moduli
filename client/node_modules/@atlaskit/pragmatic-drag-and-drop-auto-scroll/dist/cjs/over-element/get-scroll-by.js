"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getScrollBy = getScrollBy;
var _canScrollOnEdge = require("../shared/can-scroll-on-edge");
var _edges = require("../shared/edges");
var _getOverElementHitbox = require("../shared/get-over-element-hitbox");
var _getScrollChange = require("../shared/get-scroll-change");
var _isAxisAllowed = require("../shared/is-axis-allowed");
var _isWithin = require("../shared/is-within");
function getRectDefault(element) {
  return element.getBoundingClientRect();
}
function getScrollBy(_ref) {
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
  var scrollableEdges = _edges.edges.reduce(function (map, edge) {
    var hitbox = _getOverElementHitbox.getOverElementHitbox[edge]({
      clientRect: clientRect,
      config: config
    });
    var axis = _edges.edgeAxisLookup[edge];

    // Note: changing the allowed axis during a drag will not
    // reset time dampening. It was decided it would be too
    // complex to implement initially, and we can add it
    // later if needed.
    if (!(0, _isAxisAllowed.isAxisAllowed)(axis, allowedAxis)) {
      return map;
    }
    if (!(0, _isWithin.isWithin)({
      client: client,
      clientRect: hitbox
    })) {
      return map;
    }
    if (!_canScrollOnEdge.canScrollOnEdge[edge](element)) {
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
      return (0, _getScrollChange.getScrollChange)({
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
      return (0, _getScrollChange.getScrollChange)({
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
      return (0, _getScrollChange.getScrollChange)({
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
      return (0, _getScrollChange.getScrollChange)({
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