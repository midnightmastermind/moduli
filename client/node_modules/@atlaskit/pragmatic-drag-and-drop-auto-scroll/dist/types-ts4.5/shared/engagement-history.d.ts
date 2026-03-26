import { type EngagementHistoryEntry } from '../internal-types';
export declare function markAndGetEngagement(element: Element): EngagementHistoryEntry;
export declare function markEngagement(element: Element): void;
export declare function clearUnusedEngagements(fn: () => void): void;
export declare function clearEngagementHistory(): void;
