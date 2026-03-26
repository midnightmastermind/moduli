import type { Edge, InternalConfig } from '../internal-types';
import { type HitboxSpacing } from './types';
export declare const getHitbox: {
    [Key in Edge]: (args: {
        clientRect: DOMRect;
        overflow: HitboxSpacing;
        config: InternalConfig;
    }) => {
        insideOfEdge: DOMRect;
        outsideOfEdge: DOMRect;
    };
};
