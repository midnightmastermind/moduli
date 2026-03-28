export var dataAttribute = 'data-auto-scrollable';
export var selector = "[".concat(dataAttribute, "=\"true\"]");
export function addScrollableAttribute(element) {
  element.setAttribute(dataAttribute, 'true');
  return function () {
    return element.removeAttribute(dataAttribute);
  };
}