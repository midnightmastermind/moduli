"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addScrollableAttribute = addScrollableAttribute;
exports.selector = exports.dataAttribute = void 0;
var dataAttribute = exports.dataAttribute = 'data-auto-scrollable';
var selector = exports.selector = "[".concat(dataAttribute, "=\"true\"]");
function addScrollableAttribute(element) {
  element.setAttribute(dataAttribute, 'true');
  return function () {
    return element.removeAttribute(dataAttribute);
  };
}