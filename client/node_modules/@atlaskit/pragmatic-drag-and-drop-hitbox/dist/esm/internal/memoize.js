export function isShallowEqual(a, b) {
  var aKeys = Object.keys(a);
  var bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every(function (key) {
    return Object.is(a[key], b[key]);
  });
}

/**
 * Used to store a stable object, which returns a new object only if one of the values has changed
 */
export function stable() {
  var isEqual = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : isShallowEqual;
  var cache = null;
  return function (value) {
    if (cache && isEqual(cache.value, value)) {
      return cache.value;
    }
    cache = {
      value: value
    };
    return cache.value;
  };
}