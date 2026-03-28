export function isShallowEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every(key => Object.is(a[key], b[key]));
}

/**
 * Used to store a stable object, which returns a new object only if one of the values has changed
 */
export function stable(isEqual = isShallowEqual) {
  let cache = null;
  return value => {
    if (cache && isEqual(cache.value, value)) {
      return cache.value;
    }
    cache = {
      value
    };
    return cache.value;
  };
}