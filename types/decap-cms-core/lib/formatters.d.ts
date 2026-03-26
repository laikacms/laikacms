import type { Collection, CmsConfig, CmsSlug, EntryMap } from '../types/redux';
import type { Map } from 'immutable';
declare const commitMessageTemplates: {
    readonly create: "Create {{collection}} “{{slug}}”";
    readonly update: "Update {{collection}} “{{slug}}”";
    readonly delete: "Delete {{collection}} “{{slug}}”";
    readonly uploadMedia: "Upload “{{path}}”";
    readonly deleteMedia: "Delete “{{path}}”";
    readonly openAuthoring: "{{message}}";
};
type Options = {
    slug?: string;
    path?: string;
    collection?: Collection;
    authorLogin?: string;
    authorName?: string;
};
export declare function commitMessageFormatter(type: keyof typeof commitMessageTemplates, config: CmsConfig, { slug, path, collection, authorLogin, authorName }: Options, isOpenAuthoring?: boolean): string;
export declare function prepareSlug(slug: string): string;
export declare function getProcessSegment(slugConfig?: CmsSlug, ignoreValues?: string[]): (value: string) => any;
export declare function slugFormatter(collection: Collection, entryData: Map<string, unknown>, slugConfig?: CmsSlug): any;
export declare function previewUrlFormatter(baseUrl: string, collection: Collection, slug: string, entry: EntryMap, slugConfig?: CmsSlug): any;
export declare function summaryFormatter(summaryTemplate: string, entry: EntryMap, collection: Collection): any;
export declare function folderFormatter(folderTemplate: string, entry: EntryMap | undefined, collection: Collection, defaultFolder: string, folderKey: string, slugConfig?: CmsSlug): any;
export {};
