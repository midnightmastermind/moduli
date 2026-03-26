"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.unsafeOverflowAutoScrollForTextSelection = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/text-selection/adapter");
var _makeApi = require("../../unsafe-overflow/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForTextSelection
});
var unsafeOverflowAutoScrollForTextSelection = exports.unsafeOverflowAutoScrollForTextSelection = api.unsafeOverflowAutoScroll;