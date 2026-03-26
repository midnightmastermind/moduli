import type { AllDragTypes, CleanupFn, MonitorArgs } from '@atlaskit/pragmatic-drag-and-drop/types';
import type { ElementAutoScrollArgs, WindowAutoScrollArgs } from '../internal-types';
export declare function makeApi<DragType extends AllDragTypes>({ monitor, }: {
    monitor: (args: MonitorArgs<DragType>) => CleanupFn;
}): {
    autoScroll: (args: ElementAutoScrollArgs<DragType>) => CleanupFn;
    autoScrollWindow: (args?: WindowAutoScrollArgs<DragType>) => CleanupFn;
};
