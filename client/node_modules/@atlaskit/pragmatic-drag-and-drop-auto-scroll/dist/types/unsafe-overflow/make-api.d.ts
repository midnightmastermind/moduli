import type { AllDragTypes, CleanupFn, MonitorArgs } from '@atlaskit/pragmatic-drag-and-drop/types';
import { type UnsafeOverflowAutoScrollArgs } from './types';
export declare function makeApi<DragType extends AllDragTypes>({ monitor, }: {
    monitor: (args: MonitorArgs<DragType>) => CleanupFn;
}): {
    unsafeOverflowAutoScroll: (args: UnsafeOverflowAutoScrollArgs<DragType>) => CleanupFn;
};
