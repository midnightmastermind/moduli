"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.autoScrollWindowForTextSelection = exports.autoScrollForTextSelection = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/text-selection/adapter");
var _makeApi = require("../over-element/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForTextSelection
});
var autoScrollForTextSelection = exports.autoScrollForTextSelection = api.autoScroll;
var autoScrollWindowForTextSelection = exports.autoScrollWindowForTextSelection = api.autoScrollWindow;