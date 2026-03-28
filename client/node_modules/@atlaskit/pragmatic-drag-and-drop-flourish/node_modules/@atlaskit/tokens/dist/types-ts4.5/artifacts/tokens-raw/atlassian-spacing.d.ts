/**
 * THIS FILE WAS CREATED VIA CODEGEN DO NOT MODIFY {@see http://go/af-codegen}
 * @codegen <<SignedSource::cf28017e4c52dc92f3b9d8ffa77c0af4>>
 * @codegenCommand yarn build tokens
 */
type TokenValue = string;
type TokenValueOriginal = string;
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
