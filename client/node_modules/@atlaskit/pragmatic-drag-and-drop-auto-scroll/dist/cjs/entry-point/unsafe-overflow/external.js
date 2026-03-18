"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.unsafeOverflowAutoScrollForExternal = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/external/adapter");
var _makeApi = require("../../unsafe-overflow/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForExternal
});
var unsafeOverflowAutoScrollForExternal = exports.unsafeOverflowAutoScrollForExternal = api.unsafeOverflowAutoScroll;