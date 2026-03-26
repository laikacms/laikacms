import type { MediaFile } from '../backend';
interface Options {
    partial?: boolean;
    raw?: string;
    data?: any;
    label?: string | null;
    isModification?: boolean | null;
    mediaFiles?: MediaFile[] | null;
    author?: string;
    updatedOn?: string;
    status?: string;
    meta?: {
        path?: string;
    };
    i18n?: {
        [locale: string]: any;
    };
}
export interface EntryValue {
    collection: string;
    slug: string;
    path: string;
    partial: boolean;
    raw: string;
    data: any;
    label: string | null;
    isModification: boolean | null;
    mediaFiles: MediaFile[];
    author: string;
    updatedOn: string;
    status?: string;
    meta: {
        path?: string;
    };
    i18n?: {
        [locale: string]: any;
    };
}
export declare function createEntry(collection: string, slug?: string, path?: string, options?: Options): EntryValue;
export {};
