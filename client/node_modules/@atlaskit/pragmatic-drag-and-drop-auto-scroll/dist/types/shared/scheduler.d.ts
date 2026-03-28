import { type AllDragTypes, type BaseEventPayload, type CleanupFn, type MonitorArgs } from '@atlaskit/pragmatic-drag-and-drop/types';
type OnFrameFn<DragType extends AllDragTypes> = (args: {
    underUsersPointer: Element | null;
    latestArgs: BaseEventPayload<DragType>;
    timeSinceLastFrame: number;
}) => void;
type Scheduler<DragType extends AllDragTypes> = {
    onFrame: (fn: OnFrameFn<DragType>) => void;
};
export declare function getScheduler<DragType extends AllDragTypes>(monitor: (args: MonitorArgs<DragType>) => CleanupFn): Scheduler<DragType>;
export {};
