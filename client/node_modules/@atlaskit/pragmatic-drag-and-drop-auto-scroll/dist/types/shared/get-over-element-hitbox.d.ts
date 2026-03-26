import type { Edge, InternalConfig } from '../internal-types';
export declare const getOverElementHitbox: {
    [Key in Edge]: (args: {
        clientRect: DOMRect;
        config: InternalConfig;
    }) => DOMRect;
};
