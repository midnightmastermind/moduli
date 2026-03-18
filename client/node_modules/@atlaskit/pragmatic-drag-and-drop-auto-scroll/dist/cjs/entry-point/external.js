"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.autoScrollWindowForExternal = exports.autoScrollForExternal = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/external/adapter");
var _makeApi = require("../over-element/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForExternal
});
var autoScrollForExternal = exports.autoScrollForExternal = api.autoScroll;
var autoScrollWindowForExternal = exports.autoScrollWindowForExternal = api.autoScrollWindow;