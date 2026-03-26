declare const Languages: {
    readonly YAML: "yaml";
    readonly TOML: "toml";
    readonly JSON: "json";
};
type Language = (typeof Languages)[keyof typeof Languages];
export type Delimiter = string | [string, string];
type Format = {
    language: Language;
    delimiters: Delimiter;
};
export declare function getFormatOpts(format?: Language, customDelimiter?: Delimiter): {
    language: Language;
    delimiters: Delimiter;
};
export declare class FrontmatterFormatter {
    format?: Format;
    constructor(format?: Language, customDelimiter?: Delimiter);
    fromFile(content: string): any;
    toFile(data: {
        body?: string;
    } & Record<string, unknown>, sortedKeys?: string[], comments?: Record<string, string>): any;
}
export declare const FrontmatterInfer: FrontmatterFormatter;
export declare function frontmatterYAML(customDelimiter?: Delimiter): FrontmatterFormatter;
export declare function frontmatterTOML(customDelimiter?: Delimiter): FrontmatterFormatter;
export declare function frontmatterJSON(customDelimiter?: Delimiter): FrontmatterFormatter;
export {};
