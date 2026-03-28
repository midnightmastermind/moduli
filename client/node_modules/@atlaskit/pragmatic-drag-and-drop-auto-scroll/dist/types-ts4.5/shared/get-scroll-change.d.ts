import { type Position } from '@atlaskit/pragmatic-drag-and-drop/types';
import type { Axis, Edge, EngagementHistoryEntry, InternalConfig } from '../internal-types';
export declare function getScrollChange({ client, timeSinceLastFrame, engagement, axis, hitbox, edge, isDistanceDampeningEnabled, config, }: {
    timeSinceLastFrame: number;
    axis: Axis;
    engagement: EngagementHistoryEntry;
    client: Position;
    hitbox: DOMRect;
    edge: Edge;
    isDistanceDampeningEnabled: boolean;
    config: InternalConfig;
}): number;
