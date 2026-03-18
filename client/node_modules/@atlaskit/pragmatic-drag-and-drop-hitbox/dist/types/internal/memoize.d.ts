type TData = Record<string, unknown>;
export declare function isShallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean;
/**
 * Used to store a stable object, which returns a new object only if one of the values has changed
 */
export declare function stable<T extends TData>(isEqual?: (a: T, b: T) => boolean): (value: T) => T;
export {};
