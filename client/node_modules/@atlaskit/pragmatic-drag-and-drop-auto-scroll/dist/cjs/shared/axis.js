"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.axisLookup = void 0;
var vertical = {
  start: 'top',
  end: 'bottom',
  point: 'y',
  size: 'height'
};
var horizontal = {
  start: 'left',
  end: 'right',
  point: 'x',
  size: 'width'
};
var axisLookup = exports.axisLookup = {
  vertical: {
    mainAxis: vertical,
    crossAxis: horizontal
  },
  horizontal: {
    mainAxis: horizontal,
    crossAxis: vertical
  }
};