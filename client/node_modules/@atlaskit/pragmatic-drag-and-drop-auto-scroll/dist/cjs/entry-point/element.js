"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.autoScrollWindowForElements = exports.autoScrollForElements = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/element/adapter");
var _makeApi = require("../over-element/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForElements
});
var autoScrollForElements = exports.autoScrollForElements = api.autoScroll;
var autoScrollWindowForElements = exports.autoScrollWindowForElements = api.autoScrollWindow;