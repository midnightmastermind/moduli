import { monitorForTextSelection } from '@atlaskit/pragmatic-drag-and-drop/text-selection/adapter';
import { makeApi } from '../over-element/make-api';
var api = makeApi({
  monitor: monitorForTextSelection
});
export var autoScrollForTextSelection = api.autoScroll;
export var autoScrollWindowForTextSelection = api.autoScrollWindow;