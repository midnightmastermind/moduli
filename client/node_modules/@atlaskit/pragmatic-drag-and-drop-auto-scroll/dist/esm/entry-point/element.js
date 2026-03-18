import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { makeApi } from '../over-element/make-api';
var api = makeApi({
  monitor: monitorForElements
});
export var autoScrollForElements = api.autoScroll;
export var autoScrollWindowForElements = api.autoScrollWindow;