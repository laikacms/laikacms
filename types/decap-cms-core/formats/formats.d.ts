import type { Collection, EntryObject } from '../types/redux';
import type { EntryValue } from '../valueObjects/Entry';
export declare const frontmatterFormats: string[];
export declare const formatExtensions: {
    yml: string;
    yaml: string;
    toml: string;
    json: string;
    frontmatter: string;
    'json-frontmatter': string;
    'toml-frontmatter': string;
    'yaml-frontmatter': string;
};
export declare function getFormatExtensions(): any;
export declare const extensionFormatters: {
    yml: {
        fromFile(content: string): any;
        toFile(data: object, sortedKeys?: string[], comments?: Record<string, string>): any;
    };
    yaml: {
        fromFile(content: string): any;
        toFile(data: object, sortedKeys?: string[], comments?: Record<string, string>): any;
    };
    toml: {
        fromFile(content: string): any;
        toFile(data: object, sortedKeys?: string[]): string;
    };
    json: {
        fromFile(content: string): any;
        toFile(data: object): string;
    };
    md: import("./frontmatter").FrontmatterFormatter;
    markdown: import("./frontmatter").FrontmatterFormatter;
    html: import("./frontmatter").FrontmatterFormatter;
};
export declare function resolveFormat(collection: Collection, entry: EntryObject | EntryValue): any;
