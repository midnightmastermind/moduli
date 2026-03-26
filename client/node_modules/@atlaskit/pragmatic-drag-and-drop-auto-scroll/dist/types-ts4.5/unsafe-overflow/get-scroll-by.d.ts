import type { AllDragTypes, Input } from '@atlaskit/pragmatic-drag-and-drop/types';
import type { AllowedAxis, Edge, InternalConfig } from '../internal-types';
import { type UnsafeOverflowAutoScrollArgs } from './types';
export type HitboxForEdge = {
    edge: Edge;
    type: 'inside-of-edge' | 'outside-of-edge';
    hitbox: DOMRect;
};
export declare function getScrollBy<DragType extends AllDragTypes>({ entry, timeSinceLastFrame, input, config, allowedAxis, }: {
    entry: UnsafeOverflowAutoScrollArgs<DragType>;
    input: Input;
    allowedAxis: AllowedAxis;
    timeSinceLastFrame: number;
    config: InternalConfig;
}): Pick<ScrollToOptions, 'top' | 'left'> | null;
