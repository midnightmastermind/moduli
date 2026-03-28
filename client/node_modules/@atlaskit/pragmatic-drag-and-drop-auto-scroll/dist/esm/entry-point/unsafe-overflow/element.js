import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { makeApi } from '../../unsafe-overflow/make-api';
var api = makeApi({
  monitor: monitorForElements
});
export var unsafeOverflowAutoScrollForElements = api.unsafeOverflowAutoScroll;