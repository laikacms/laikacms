import type { Collection, Entry, EntryDraft, EntryField, EntryMap } from '../types/redux';
import type { EntryValue } from '../valueObjects/Entry';
export declare const I18N = "i18n";
export declare enum I18N_STRUCTURE {
    MULTIPLE_FOLDERS = "multiple_folders",
    MULTIPLE_FILES = "multiple_files",
    SINGLE_FILE = "single_file"
}
export declare enum I18N_FIELD {
    TRANSLATE = "translate",
    DUPLICATE = "duplicate",
    NONE = "none"
}
export declare function hasI18n(collection: Collection): boolean;
export type I18nInfo = {
    locales: string[];
    defaultLocale: string;
    structure: I18N_STRUCTURE;
};
export declare function getI18nInfo(collection: Collection): {};
export declare function getI18nFilesDepth(collection: Collection, depth: number): number;
export declare function isFieldTranslatable(field: EntryField, locale: string, defaultLocale: string): boolean;
export declare function isFieldDuplicate(field: EntryField, locale: string, defaultLocale: string): boolean;
export declare function isFieldHidden(field: EntryField, locale: string, defaultLocale: string): boolean;
export declare function getLocaleDataPath(locale: string): string[];
export declare function getDataPath(locale: string, defaultLocale: string): string[];
export declare function getFilePath(structure: I18N_STRUCTURE, extension: string, path: string, slug: string, locale: string): string;
export declare function getLocaleFromPath(structure: I18N_STRUCTURE, extension: string, path: string): string;
export declare function getFilePaths(collection: Collection, extension: string, path: string, slug: string): string[];
export declare function normalizeFilePath(structure: I18N_STRUCTURE, path: string, locale: string): string;
export declare function getI18nFiles(collection: Collection, extension: string, entryDraft: EntryMap, entryToRaw: (entryDraft: EntryMap) => string, path: string, slug: string, newPath?: string): {
    newPath: string;
    path: string;
    slug: string;
    raw: string;
}[];
export declare function getI18nBackup(collection: Collection, entry: EntryMap, entryToRaw: (entry: EntryMap) => string): Record<string, {
    raw: string;
}>;
export declare function formatI18nBackup(i18nBackup: Record<string, {
    raw: string;
}>, formatRawData: (raw: string) => EntryValue): any;
export declare function getI18nEntry(collection: Collection, extension: string, path: string, slug: string, getEntryValue: (path: string) => Promise<EntryValue>): Promise<EntryValue>;
export declare function groupEntries(collection: Collection, extension: string, entries: EntryValue[]): any;
export declare function getI18nDataFiles(collection: Collection, extension: string, path: string, slug: string, diffFiles: {
    path: string;
    id: string;
    newFile: boolean;
}[]): any[];
export declare function duplicateDefaultI18nFields(collection: Collection, dataFields: any): any;
export declare function duplicateI18nFields(entryDraft: EntryDraft, field: EntryField, locales: string[], defaultLocale: string, fieldPath?: string[]): EntryDraft;
export declare function getPreviewEntry(entry: EntryMap, locale: string, defaultLocale: string): EntryMap;
export declare function serializeI18n(collection: Collection, entry: Entry, serializeValues: (data: any) => any): Entry;
