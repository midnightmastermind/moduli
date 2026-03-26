"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.unsafeOverflowAutoScrollForElements = void 0;
var _adapter = require("@atlaskit/pragmatic-drag-and-drop/element/adapter");
var _makeApi = require("../../unsafe-overflow/make-api");
var api = (0, _makeApi.makeApi)({
  monitor: _adapter.monitorForElements
});
var unsafeOverflowAutoScrollForElements = exports.unsafeOverflowAutoScrollForElements = api.unsafeOverflowAutoScroll;