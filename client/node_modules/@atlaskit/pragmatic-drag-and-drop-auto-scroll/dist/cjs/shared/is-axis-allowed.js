"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isAxisAllowed = isAxisAllowed;
function isAxisAllowed(axis, allowedAxis) {
  return allowedAxis === 'all' || axis === allowedAxis;
}