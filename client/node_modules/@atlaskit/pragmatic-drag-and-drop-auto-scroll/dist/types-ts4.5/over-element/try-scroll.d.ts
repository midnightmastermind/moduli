import type { AllDragTypes, Input } from '@atlaskit/pragmatic-drag-and-drop/types';
import { type ElementAutoScrollArgs, type WindowAutoScrollArgs } from '../internal-types';
export declare function tryScroll<DragType extends AllDragTypes>({ input, findEntry, timeSinceLastFrame, source, getWindowScrollEntries, underUsersPointer, }: {
    input: Input;
    timeSinceLastFrame: number;
    source: DragType['payload'];
    findEntry: (element: Element) => ElementAutoScrollArgs<DragType> | null;
    getWindowScrollEntries: () => WindowAutoScrollArgs<DragType>[];
    underUsersPointer: Element | null;
}): void;
