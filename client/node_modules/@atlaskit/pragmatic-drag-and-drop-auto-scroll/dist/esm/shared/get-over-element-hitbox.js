import _defineProperty from "@babel/runtime/helpers/defineProperty";
import { axisLookup } from './axis';
import { mainAxisSideLookup } from './side';
function makeGetHitbox(_ref) {
  var edge = _ref.edge,
    axis = _ref.axis;
  return function hitbox(_ref2) {
    var _DOMRect$fromRect;
    var clientRect = _ref2.clientRect,
      config = _ref2.config;
    var _axisLookup$axis = axisLookup[axis],
      mainAxis = _axisLookup$axis.mainAxis,
      crossAxis = _axisLookup$axis.crossAxis;
    var side = mainAxisSideLookup[edge];
    var mainAxisHitboxSize = Math.min(
    // scale the size of the hitbox down for smaller elements
    config.startHitboxAtPercentageRemainingOfElement[edge] * clientRect[mainAxis.size],
    // Don't let the hitbox grow too big for big elements
    config.maxMainAxisHitboxSize);
    return DOMRect.fromRect((_DOMRect$fromRect = {}, _defineProperty(_DOMRect$fromRect, mainAxis.point, side === 'start' ?
    // begin from the start edge and grow inwards
    clientRect[mainAxis.point] :
    // begin from inside the end edge and grow towards the end edge
    clientRect[mainAxis.point] + clientRect[mainAxis.size] - mainAxisHitboxSize), _defineProperty(_DOMRect$fromRect, crossAxis.point, clientRect[crossAxis.point]), _defineProperty(_DOMRect$fromRect, mainAxis.size, mainAxisHitboxSize), _defineProperty(_DOMRect$fromRect, crossAxis.size, clientRect[crossAxis.size]), _DOMRect$fromRect));
  };
}
export var getOverElementHitbox = {
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