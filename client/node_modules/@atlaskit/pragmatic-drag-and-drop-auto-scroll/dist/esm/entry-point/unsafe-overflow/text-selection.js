import { monitorForTextSelection } from '@atlaskit/pragmatic-drag-and-drop/text-selection/adapter';
import { makeApi } from '../../unsafe-overflow/make-api';
var api = makeApi({
  monitor: monitorForTextSelection
});
export var unsafeOverflowAutoScrollForTextSelection = api.unsafeOverflowAutoScroll;