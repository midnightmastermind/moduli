import type { Input } from '@atlaskit/pragmatic-drag-and-drop/types';
import type { AllowedAxis, EngagementHistoryEntry, InternalConfig } from '../internal-types';
export declare function getScrollBy({ element, input, timeSinceLastFrame, engagement, config, allowedAxis, getRect, }: {
    element: Element;
    input: Input;
    engagement: EngagementHistoryEntry;
    timeSinceLastFrame: number;
    allowedAxis: AllowedAxis;
    config: InternalConfig;
    getRect?: (element: Element) => DOMRect;
}): Required<Pick<ScrollToOptions, 'top' | 'left'>>;
