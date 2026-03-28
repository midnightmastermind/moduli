"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getOverElementHitbox = void 0;
var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));
var _axis = require("./axis");
var _side = require("./side");
function makeGetHitbox(_ref) {
  var edge = _ref.edge,
    axis = _ref.axis;
  return function hitbox(_ref2) {
    var _DOMRect$fromRect;
    var clientRect = _ref2.clientRect,
      config = _ref2.config;
    var _axisLookup$axis = _axis.axisLookup[axis],
      mainAxis = _axisLookup$axis.mainAxis,
      crossAxis = _axisLookup$axis.crossAxis;
    var side = _side.mainAxisSideLookup[edge];
    var mainAxisHitboxSize = Math.min(
    // scale the size of the hitbox down for smaller elements
    config.startHitboxAtPercentageRemainingOfElement[edge] * clientRect[mainAxis.size],
    // Don't let the hitbox grow too big for big elements
    config.maxMainAxisHitboxSize);
    return DOMRect.fromRect((_DOMRect$fromRect = {}, (0, _defineProperty2.default)(_DOMRect$fromRect, mainAxis.point, side === 'start' ?
    // begin from the start edge and grow inwards
    clientRect[mainAxis.point] :
    // begin from inside the end edge and grow towards the end edge
    clientRect[mainAxis.point] + clientRect[mainAxis.size] - mainAxisHitboxSize), (0, _defineProperty2.default)(_DOMRect$fromRect, crossAxis.point, clientRect[crossAxis.point]), (0, _defineProperty2.default)(_DOMRect$fromRect, mainAxis.size, mainAxisHitboxSize), (0, _defineProperty2.default)(_DOMRect$fromRect, crossAxis.size, clientRect[crossAxis.size]), _DOMRect$fromRect));
  };
}
var getOverElementHitbox = exports.getOverElementHitbox = {
  top: makeGetHitbox({
    axis: 'vertical',
    edge: 'top'
  }),
  right: makeGetHitbox({
    axis: 'horizontal',
    edge: 'right'
  }),
  bottom: makeGetHitbox({
    axis: 'vertical',
    edge: 'bottom'
  }),
  left: makeGetHitbox({
    axis: 'horizontal',
    edge: 'left'
  })
};