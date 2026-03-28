import type { AllDragTypes, Input } from '@atlaskit/pragmatic-drag-and-drop/types';
import { type UnsafeOverflowAutoScrollArgs } from './types';
export declare function tryOverflowScrollElements<DragType extends AllDragTypes>({ input, source, entries, timeSinceLastFrame, underUsersPointer, }: {
    input: Input;
    timeSinceLastFrame: number;
    underUsersPointer: Element | null;
    source: DragType['payload'];
    entries: UnsafeOverflowAutoScrollArgs<DragType>[];
}): void;
