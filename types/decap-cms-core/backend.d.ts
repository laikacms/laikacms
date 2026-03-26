import { List } from 'immutable';
import { Cursor } from 'decap-cms-lib-util';
import type AssetProxy from './valueObjects/AssetProxy';
import type { CmsConfig, EntryMap, FilterRule, EntryDraft, Collection, Collections, State, EntryField } from './types/redux';
import type { EntryValue } from './valueObjects/Entry';
import type { Implementation as BackendImplementation, DisplayURL, ImplementationEntry, Credentials, User, AsyncLock, UnpublishedEntry } from 'decap-cms-lib-util';
import type { Map } from 'immutable';
export declare class LocalStorageAuthStore {
    storageKey: string;
    retrieve(): any;
    store(userData: unknown): void;
    logout(): void;
}
export declare function extractSearchFields(searchFields: string[]): (entry: EntryValue) => string;
export declare function expandSearchEntries(entries: EntryValue[], searchFields: string[]): (EntryValue & {
    field: string;
})[];
export declare function mergeExpandedEntries(entries: (EntryValue & {
    field: string;
})[]): any;
export declare function slugFromCustomPath(collection: Collection, customPath: string): any;
interface AuthStore {
    retrieve: () => User;
    store: (user: User) => void;
    logout: () => void;
}
interface BackendOptions {
    backendName: string;
    config: CmsConfig;
    authStore?: AuthStore;
}
export interface MediaFile {
    name: string;
    id: string;
    size?: number;
    displayURL?: DisplayURL;
    path: string;
    draft?: boolean;
    url?: string;
    file?: File;
    field?: EntryField;
}
interface PersistArgs {
    config: CmsConfig;
    collection: Collection;
    entryDraft: EntryDraft;
    assetProxies: AssetProxy[];
    usedSlugs: List<string>;
    unpublished?: boolean;
    status?: string;
}
interface ImplementationInitOptions {
    useWorkflow: boolean;
    updateUserCredentials: (credentials: Credentials) => void;
    initialWorkflowStatus: string;
}
type Implementation = BackendImplementation & {
    init: (config: CmsConfig, options: ImplementationInitOptions) => Implementation;
};
export declare class Backend {
    implementation: Implementation;
    backendName: string;
    config: CmsConfig;
    authStore?: AuthStore;
    user?: User | null;
    backupSync: AsyncLock;
    constructor(implementation: Implementation, { backendName, authStore, config }: BackendOptions);
    status(): Promise<{
        auth: {
            status: boolean;
        };
        api: {
            status: boolean;
            statusPage: string;
        };
    }>;
    currentUser(): any;
    isGitBackend(): any;
    updateUserCredentials: (updatedCredentials: Credentials) => any;
    authComponent(): any;
    authenticate(credentials: Credentials): any;
    logout(): Promise<void>;
    getToken: () => any;
    entryExist(collection: Collection, path: string, slug: string, useWorkflow: boolean): Promise<any>;
    generateUniqueSlug(collection: Collection, entryData: Map<string, unknown>, config: CmsConfig, usedSlugs: List<string>, customPath: string | undefined): Promise<string>;
    processEntries(loadedEntries: ImplementationEntry[], collection: Collection): any;
    listEntries(collection: Collection): Promise<{
        entries: any;
        pagination: any;
        cursor: any;
    }>;
    listAllEntries(collection: Collection): Promise<any>;
    search(collections: Collection[], searchTerm: string): Promise<{
        entries: any;
    }>;
    query(collection: Collection, searchFields: string[], searchTerm: string, file?: string, limit?: number): Promise<{
        query: string;
        hits: any;
    }>;
    traverseCursor(cursor: Cursor, action: string): any;
    getLocalDraftBackup(collection: Collection, slug: string): Promise<{
        entry?: undefined;
    } | {
        entry: EntryValue;
    }>;
    persistLocalDraftBackup(entry: EntryMap, collection: Collection): Promise<any>;
    deleteLocalDraftBackup(collection: Collection, slug: string): Promise<any>;
    deleteAnonymousBackup(): any;
    getEntry(state: State, collection: Collection, slug: string): Promise<EntryValue>;
    getMedia(): any;
    getMediaFile(path: string): any;
    getMediaDisplayURL(displayURL: DisplayURL): any;
    entryWithFormat(collection: Collection): (entry: EntryValue) => EntryValue;
    processUnpublishedEntry(collection: Collection, entryData: UnpublishedEntry, withMediaFiles: boolean): Promise<any>;
    unpublishedEntries(collections: Collections): Promise<{
        pagination: number;
        entries: EntryValue[];
    }>;
    processEntry(state: State, collection: Collection, entry: EntryValue): Promise<EntryValue>;
    unpublishedEntry(state: State, collection: Collection, slug: string): Promise<any>;
    /**
     * Creates a URL using `site_url` from the config and `preview_path` from the
     * entry's collection. Does not currently make a request through the backend,
     * but likely will in the future.
     */
    getDeploy(collection: Collection, slug: string, entry: EntryMap): {
        url: any;
        status: string;
    };
    /**
     * Requests a base URL from the backend for previewing a specific entry.
     * Supports polling via `maxAttempts` and `interval` options, as there is
     * often a delay before a preview URL is available.
     */
    getDeployPreview(collection: Collection, slug: string, entry: EntryMap, { maxAttempts, interval }?: {
        maxAttempts?: number;
        interval?: number;
    }): Promise<{
        /**
         * Create a URL using the collection `preview_path`, if provided.
         */
        url: any;
        /**
         * Always capitalize the status for consistency.
         */
        status: any;
    }>;
    persistEntry({ config, collection, entryDraft: draft, assetProxies, usedSlugs, unpublished, status, }: PersistArgs): Promise<DataFile>;
    invokeEventWithEntry(event: string, entry: EntryMap): Promise<any>;
    invokePrePublishEvent(entry: EntryMap): Promise<void>;
    invokePostPublishEvent(entry: EntryMap): Promise<void>;
    invokePreUnpublishEvent(entry: EntryMap): Promise<void>;
    invokePostUnpublishEvent(entry: EntryMap): Promise<void>;
    invokePreSaveEvent(entry: EntryMap): Promise<any>;
    invokePostSaveEvent(entry: EntryMap): Promise<void>;
    persistMedia(config: CmsConfig, file: AssetProxy): Promise<any>;
    deleteEntry(state: State, collection: Collection, slug: string): Promise<void>;
    deleteMedia(config: CmsConfig, path: string): Promise<any>;
    persistUnpublishedEntry(args: PersistArgs): Promise<DataFile>;
    updateUnpublishedEntryStatus(collection: string, slug: string, newStatus: string): any;
    publishUnpublishedEntry(entry: EntryMap): Promise<void>;
    deleteUnpublishedEntry(collection: string, slug: string): any;
    entryToRaw(collection: Collection, entry: EntryMap): string;
    fieldsOrder(collection: Collection, entry: EntryMap): any;
    filterEntries(collection: {
        entries: EntryValue[];
    }, filterRule: FilterRule): EntryValue[];
}
export declare function resolveBackend(config: CmsConfig): Backend;
export declare const currentBackend: (config: CmsConfig) => Backend;
export {};
