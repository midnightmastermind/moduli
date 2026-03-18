"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getScrollBy = getScrollBy;
var _canScrollOnEdge = require("../shared/can-scroll-on-edge");
var _edges = require("../shared/edges");
var _engagementHistory = require("../shared/engagement-history");
var _getScrollChange = require("../shared/get-scroll-change");
var _isAxisAllowed = require("../shared/is-axis-allowed");
var _isWithin = require("../shared/is-within");
var _hitbox = require("./hitbox");
// Distance dampening is enabled when we are inside the edge
// In order to match "over element" scrolling
function getIsDistanceDampeningEnabled(value) {
  return value.type === 'inside-of-edge';
}
function getSpacingFromProvided(value) {
  var _value$top, _value$right, _value$bottom, _value$left;
  return {
    top: (_value$top = value === null || value === void 0 ? void 0 : value.top) !== null && _value$top !== void 0 ? _value$top : 0,
    right: (_value$right = value === null || value === void 0 ? void 0 : value.right) !== null && _value$right !== void 0 ? _value$right : 0,
    bottom: (_value$bottom = value === null || value === void 0 ? void 0 : value.bottom) !== null && _value$bottom !== void 0 ? _value$bottom : 0,
    left: (_value$left = value === null || value === void 0 ? void 0 : value.left) !== null && _value$left !== void 0 ? _value$left : 0
  };
}
function getHitboxSpacing(provided) {
  return {
    top: getSpacingFromProvided(provided.fromTopEdge),
    right: getSpacingFromProvided(provided.fromRightEdge),
    bottom: getSpacingFromProvided(provided.fromBottomEdge),
    left: getSpacingFromProvided(provided.fromLeftEdge)
  };
}
function getScrollBy(_ref) {
  var entry = _ref.entry,
    timeSinceLastFrame = _ref.timeSinceLastFrame,
    input = _ref.input,
    config = _ref.config,
    allowedAxis = _ref.allowedAxis;
  var client = {
    x: input.clientX,
    y: input.clientY
  };

  // 🔥
  // For each registered item we need to do `getBoundingClientRect()` which is not great
  // Why?
  // 1. The hitbox can extend outside of an elements bounds
  // 2. We want overflow scrolling to start before the user has entered the bounds of the element
  //     Otherwise we could search upwards in the DOM from the `elementFromPoint`
  var clientRect = entry.element.getBoundingClientRect();
  var overflow = getHitboxSpacing(entry.getOverflow());
  var inHitboxForEdge = _edges.edges.map(function (edge) {
    var _getHitbox$edge = _hitbox.getHitbox[edge]({
        clientRect: clientRect,
        overflow: overflow,
        config: config
      }),
      insideOfEdge = _getHitbox$edge.insideOfEdge,
      outsideOfEdge = _getHitbox$edge.outsideOfEdge;

    /** Note:
     * Intentionally _not_ doing an explicit check to
     * see if `client` is with within the `overElementHitbox`.
     *
     * **Why?**
     *
     * 1. 🥱 Redundant
     * This check is already achieved by `element.contains(underUsersPointer)`
     *
     * 2. 📐 Overlap on boundaries
     * Two elements can share the same `{x,y}` points on shared edges.
     * It's not clear which of the two will be picked by
     * `const underUsersPointer = document.elementFromPoint(x,y)`
     * The edge of an "outside" element, can have shared `{x,y}`
     * values along the edge of an "inside element".
     * So when `underUsersPointer` is the "outer" element, the `client`
     * point might actually be also within the "inner" element.
     * We are exclusively relying on `underUsersPointer` make the decision
     * on what we are "over" so we should not be doing "over element" hitbox
     * testing here.
     * https://twitter.com/alexandereardon/status/1721758766507638996
     *
     *
     * 3. 🐞 Chrome bug
     * `document.elementFromPoint(x, y)` can return an element that does not contain `{x,y}`,
     * In these cases, `isWithin({client, clientRect: overElementHitbox})` can return `false`.
     * https://bugs.chromium.org/p/chromium/issues/detail?id=1500073
     */

    if ((0, _isWithin.isWithin)({
      client: client,
      clientRect: outsideOfEdge
    })) {
      return {
        edge: edge,
        hitbox: outsideOfEdge,
        type: 'outside-of-edge'
      };
    }
    if ((0, _isWithin.isWithin)({
      client: client,
      clientRect: insideOfEdge
    })) {
      return {
        edge: edge,
        hitbox: insideOfEdge,
        type: 'inside-of-edge'
      };
    }
    return false;
  }).filter(function (value) {
    return Boolean(value);
  });
  if (!inHitboxForEdge.length) {
    return null;
  }

  // Even if no edges are scrollable, we are marking the element
  // as being engaged with to start applying time dampening
  var engagement = (0, _engagementHistory.markAndGetEngagement)(entry.element);

  // Note: changing the allowed axis during a drag will not
  // reset time dampening. It was decided it would be too
  // complex to implement initially, and we can add it
  // later if needed.
  var scrollableEdges = inHitboxForEdge.filter(function (value) {
    return (0, _isAxisAllowed.isAxisAllowed)(_edges.edgeAxisLookup[value.edge], allowedAxis) && _canScrollOnEdge.canScrollOnEdge[value.edge](entry.element);
  });

  // Nothing can be scrolled
  if (!scrollableEdges.length) {
    return null;
  }
  var lookup = new Map(scrollableEdges.map(function (value) {
    return [value.edge, value];
  }));
  var left = function () {
    var axis = 'horizontal';
    var leftEdge = lookup.get('left');
    if (leftEdge) {
      return (0, _getScrollChange.getScrollChange)({
        client: client,
        isDistanceDampeningEnabled: getIsDistanceDampeningEnabled(leftEdge),
        hitbox: leftEdge.hitbox,
        edge: 'left',
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        config: config
      });
    }
    var rightEdge = lookup.get('right');
    if (rightEdge) {
      return (0, _getScrollChange.getScrollChange)({
        client: client,
        isDistanceDampeningEnabled: getIsDistanceDampeningEnabled(rightEdge),
        hitbox: rightEdge.hitbox,
        edge: 'right',
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        config: config
      });
    }
    return 0;
  }();
  var top = function () {
    var axis = 'vertical';
    var bottomEdge = lookup.get('bottom');
    if (bottomEdge) {
      return (0, _getScrollChange.getScrollChange)({
        client: client,
        isDistanceDampeningEnabled: getIsDistanceDampeningEnabled(bottomEdge),
        hitbox: bottomEdge.hitbox,
        edge: 'bottom',
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
        config: config
      });
    }
    var topEdge = lookup.get('top');
    if (topEdge) {
      return (0, _getScrollChange.getScrollChange)({
        client: client,
        isDistanceDampeningEnabled: getIsDistanceDampeningEnabled(topEdge),
        hitbox: topEdge.hitbox,
        edge: 'top',
        axis: axis,
        timeSinceLastFrame: timeSinceLastFrame,
        engagement: engagement,
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