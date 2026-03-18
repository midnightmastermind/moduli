import type { CleanupFn } from '@atlaskit/pragmatic-drag-and-drop/types';
export declare const dataAttribute = "data-auto-scrollable";
export declare const selector = "[data-auto-scrollable=\"true\"]";
export declare function addScrollableAttribute(element: Element): CleanupFn;
