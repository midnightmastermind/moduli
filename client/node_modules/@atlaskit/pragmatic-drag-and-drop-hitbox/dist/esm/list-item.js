import _defineProperty from "@babel/runtime/helpers/defineProperty";
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
import { stable } from './internal/memoize';
// using a symbol so we can guarantee a key with a unique value
var uniqueKey = Symbol('list-item-instruction');
var axisLookup = {
  vertical: {
    start: 'top',
    end: 'bottom',
    size: 'height',
    point: 'y'
  },
  horizontal: {
    start: 'left',
    end: 'right',
    size: 'width',
    point: 'x'
  }
};
function reorderAndCombine(_ref) {
  var client = _ref.client,
    borderBox = _ref.borderBox,
    axis = _ref.axis;
  var quarterOfSize = borderBox[axis.size] / 4;

  // In the top 1/4: reorder-before
  // On the line: reorder-before to give a slight preference to reordering
  if (client[axis.point] <= borderBox[axis.start] + quarterOfSize) {
    return 'reorder-before';
  }
  // In the bottom 1/4: reorder-after
  // On the line: reorder-after to give a slight preference to reordering
  if (client[axis.point] >= borderBox[axis.end] - quarterOfSize) {
    return 'reorder-after';
  }
  return 'combine';
}
function reorder(_ref2) {
  var client = _ref2.client,
    borderBox = _ref2.borderBox,
    axis = _ref2.axis;
  var halfSize = borderBox[axis.size] / 2;

  // In the top 1/2: reorder-before
  // On the line: reorder-after to give a slight preference to moving forward
  if (client[axis.point] < borderBox[axis.start] + halfSize) {
    return 'reorder-before';
  }
  return 'reorder-after';
}

// Note: not using `memoize-one` as all we need is a cached value.
// We do not need to avoid executing an expensive function.
var memoizeInstruction = stable();
function isPossible() {
  for (var _len = arguments.length, values = new Array(_len), _key = 0; _key < _len; _key++) {
    values[_key] = arguments[_key];
  }
  return values.every(function (value) {
    return value === 'available' || value === 'blocked';
  });
}
function isNotAvailable() {
  for (var _len2 = arguments.length, values = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
    values[_key2] = arguments[_key2];
  }
  return values.every(function (value) {
    return value === 'not-available';
  });
}

/**
 * Calculate the `Instruction` for a drag operation based on the users input
 * and the available operations.
 *
 * Notes:
 *
 * - `attachInstruction` can attach an `Instruction | null`. `null` will be attached if all `operations` provided are `"not-available"`.
 * - Use `extractInstruction` to obtain the `Instruction | null`
 *
 * @example
 *
 * ```ts
 * dropTargetForElements({
 * 	element: myElement,
 *  getData({input, element}) {
 *    // The data I want to attach to the drop target
 * 		const myData = {type: 'card', cardId: 'A'};
 *
 *    // Add an instruction to myData
 *    return attachInstruction(myData, {
 * 			input,
 * 			element,
 * 			operations: {
 * 				'reorder-before': 'available',
 * 				'reorder-after': 'available',
 * 				combine: 'available',
 * 			}
 *    });
 *  }
 * });
 * ```
 */
export function attachInstruction(userData, _ref3) {
  var _operations$combine, _operations$reorderB, _operations$reorderA;
  var operations = _ref3.operations,
    element = _ref3.element,
    input = _ref3.input,
    _ref3$axis = _ref3.axis,
    axisValue = _ref3$axis === void 0 ? 'vertical' : _ref3$axis;
  var client = {
    x: input.clientX,
    y: input.clientY
  };
  var borderBox = element.getBoundingClientRect();
  var axis = axisLookup[axisValue];
  var combine = (_operations$combine = operations.combine) !== null && _operations$combine !== void 0 ? _operations$combine : 'not-available';
  var reorderAbove = (_operations$reorderB = operations['reorder-before']) !== null && _operations$reorderB !== void 0 ? _operations$reorderB : 'not-available';
  var reorderBelow = (_operations$reorderA = operations['reorder-after']) !== null && _operations$reorderA !== void 0 ? _operations$reorderA : 'not-available';
  var operation = function () {
    // Combining not possible
    if (!isPossible(combine)) {
      // can reorder above and below
      if (isPossible(reorderAbove, reorderBelow)) {
        return reorder({
          client: client,
          borderBox: borderBox,
          axis: axis
        });
      }

      // can only reorder above
      if (isPossible(reorderAbove)) {
        return 'reorder-before';
      }

      // can only reorder below
      if (isPossible(reorderBelow)) {
        return 'reorder-after';
      }

      // no `true` values - no Outcome available.
      return null;
    }

    // combining is available

    var result = reorderAndCombine({
      client: client,
      borderBox: borderBox,
      axis: axis
    });
    if (result === 'reorder-after') {
      return isNotAvailable(reorderBelow) ? 'combine' : result;
    }
    if (result === 'reorder-before') {
      return isNotAvailable(reorderAbove) ? 'combine' : result;
    }
    return result;
  }();

  // We cannot attach an instruction - all values passed where `false` or no values passed
  if (!operation) {
    return userData;
  }
  var instruction = {
    operation: operation,
    blocked: operations[operation] === 'blocked',
    axis: axisValue
  };
  var memoized = memoizeInstruction(instruction);
  return _objectSpread(_objectSpread({}, userData), {}, _defineProperty({}, uniqueKey, memoized));
}

/**
 * Extract an instruction from the user data if it is available.
 *
 *
 * @example
 *
 * ```ts
 * monitorForElements({
 *  onDrop({location}) {
 *   const innerMost = location.current.dropTargets[0];
 *   if(!innerMost) {
 *     return;
 *   }
 *   const instruction: Instruction | null = extractInstruction(innerMost.data);
 *  }
 * });
 * ```
 */
export function extractInstruction(userData) {
  var _ref4;
  return (_ref4 = userData[uniqueKey]) !== null && _ref4 !== void 0 ? _ref4 : null;
}