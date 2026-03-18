export function getPercentageInRange(_ref) {
  var startOfRange = _ref.startOfRange,
    endOfRange = _ref.endOfRange,
    value = _ref.value;
  // checking inputs
  var isValid = startOfRange < endOfRange;
  if (!isValid) {
    return 0;
  }
  if (value < startOfRange) {
    return 0;
  }
  if (value > endOfRange) {
    return 1;
  }
  var range = endOfRange - startOfRange;
  return (value - startOfRange) / range;
}