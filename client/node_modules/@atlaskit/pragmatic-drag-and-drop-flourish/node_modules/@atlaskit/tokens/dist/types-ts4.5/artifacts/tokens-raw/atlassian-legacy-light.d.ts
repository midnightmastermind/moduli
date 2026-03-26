/**
 * THIS FILE WAS CREATED VIA CODEGEN DO NOT MODIFY {@see http://go/af-codegen}
 * @codegen <<SignedSource::8ba837ec9e96316ec5c338789f9aad1e>>
 * @codegenCommand yarn build tokens
 */
type TokenValue = string | number | {
    radius: number;
    offset: {
        x: number;
        y: number;
    };
    color: string;
    opacity: number;
    spread?: number;
    inset?: boolean;
}[];
type TokenValueOriginal = string | {
    radius: number;
    offset: {
        x: number;
        y: number;
    };
    color: string;
    opacity: number;
    spread?: number;
    inset?: boolean;
}[];
type TokenAttributes = {
    group: string;
    state: string;
    introduced: string;
    description: string;
    suggest?: string[];
    deprecated?: string;
    replacement?: string;
};
type Token = {
    value: TokenValue;
    filePath: string;
    isSource: boolean;
    attributes: TokenAttributes;
    original: {
        value: TokenValueOriginal;
        attributes: TokenAttributes;
    };
    name: string;
    path: string[];
    cleanName: string;
};
declare const tokens: Token[];
export default tokens;
