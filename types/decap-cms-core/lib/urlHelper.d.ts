import type { CmsSlug } from '../types/redux';
export declare function getCollectionUrl(collectionName: string, direct?: boolean): string;
export declare function getNewEntryUrl(collectionName: string, direct?: boolean): string;
export declare function addParams(urlString: string, params: Record<string, string>): any;
export declare function stripProtocol(urlString: string): string;
export declare function getCharReplacer(encoding: string, replacement: string): (char: string) => string;
export declare function sanitizeURI(str: string, options?: {
    replacement: CmsSlug['sanitize_replacement'];
    encoding: CmsSlug['encoding'];
}): any;
export declare function sanitizeChar(char: string, options?: CmsSlug): string;
export declare function sanitizeSlug(str: string, options?: CmsSlug): string;
export declare function joinUrlPath(base: string, ...path: string[]): any;
