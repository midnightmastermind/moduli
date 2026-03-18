import { monitorForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { makeApi } from '../../unsafe-overflow/make-api';
var api = makeApi({
  monitor: monitorForExternal
});
export var unsafeOverflowAutoScrollForExternal = api.unsafeOverflowAutoScroll;