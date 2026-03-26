import _defineProperty from "@babel/runtime/helpers/defineProperty";
import { axisLookup } from '../shared/axis';
// Borrowing the hitbox calculation from over-element
// So we can be sure that the 'insideEdge' calculations
// line up perfectly with the 'over element' edge calculations
import { getOverElementHitbox } from '../shared/get-over-element-hitbox';
function makeGetHitbox(_ref) {
  var axis = _ref.axis,
    side = _ref.side;
  return function hitbox(_ref2) {
    var _DOMRect$fromRect, _DOMRect$fromRect2;
    var clientRect = _ref2.clientRect,
      overflow = _ref2.overflow,
      config = _ref2.config;
    var _axisLookup$axis = axisLookup[axis],
      mainAxis = _axisLookup$axis.mainAxis,
      crossAxis = _axisLookup$axis.crossAxis;
    var edge = mainAxis[side];
    var spacingForEdge = overflow[edge];
    var overElementHitbox = getOverElementHitbox[edge]({
      clientRect: clientRect,
      config: config
    });
    // Same as the over element hitbox,
    // but we are stretching out on the cross axis (if needed)
    var insideOfEdge = DOMRect.fromRect((_DOMRect$fromRect = {}, _defineProperty(_DOMRect$fromRect, mainAxis.point, overElementHitbox[mainAxis.point]), _defineProperty(_DOMRect$fromRect, mainAxis.size, overElementHitbox[mainAxis.size]), _defineProperty(_DOMRect$fromRect, crossAxis.point, overElementHitbox[crossAxis.point] - spacingForEdge[crossAxis.start]), _defineProperty(_DOMRect$fromRect, crossAxis.size, overElementHitbox[crossAxis.size] + spacingForEdge[crossAxis.start] + spacingForEdge[crossAxis.end]), _DOMRect$fromRect));

    // Note: this will be "cut out" by the "overElementHitbox"
    var outsideOfEdge = DOMRect.fromRect((_DOMRect$fromRect2 = {}, _defineProperty(_DOMRect$fromRect2, mainAxis.point, side === 'start' ?
    // begin from before the start edge and growing forward
    clientRect[mainAxis.point] - spacingForEdge[mainAxis.start] :
    // begin from on the end edge and go outwards
    clientRect[mainAxis.end]), _defineProperty(_DOMRect$fromRect2, crossAxis.point, clientRect[crossAxis.point] - spacingForEdge[crossAxis.start]), _defineProperty(_DOMRect$fromRect2, mainAxis.size, side === 'start' ? spacingForEdge[mainAxis.start] : spacingForEdge[mainAxis.end]), _defineProperty(_DOMRect$fromRect2, crossAxis.size, spacingForEdge[crossAxis.start] + clientRect[crossAxis.size] + spacingForEdge[crossAxis.end]), _DOMRect$fromRect2));
    return {
      insideOfEdge: insideOfEdge,
      outsideOfEdge: outsideOfEdge
    };
  };
}
export var getHitbox = {
  top: makeGetHitbox({
    axis: 'vertical',
    side: 'start'
  }),
  right: makeGetHitbox({
    axis: 'horizontal',
    side: 'end'
  }),
  bottom: makeGetHitbox({
    axis: 'vertical',
    side: 'end'
  }),
  left: makeGetHitbox({
    axis: 'horizontal',
    side: 'start'
  })
};