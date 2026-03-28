import { monitorForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { makeApi } from '../over-element/make-api';
var api = makeApi({
  monitor: monitorForExternal
});
export var autoScrollForExternal = api.autoScroll;
export var autoScrollWindowForExternal = api.autoScrollWindow;