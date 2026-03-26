import type { Semaphore } from 'semaphore';
import type Cursor from './Cursor';
import type { AsyncLock } from './asyncLock';
import type { FileMetadata } from './API';
export type DisplayURLObject = {
    id: string;
    path: string;
};
export type DisplayURL = DisplayURLObject | string;
export interface ImplementationMediaFile {
    name: string;
    id: string;
    size?: number;
    displayURL?: DisplayURL;
    path: string;
    draft?: boolean;
    url?: string;
    file?: File;
}
export interface UnpublishedEntryMediaFile {
    id: string;
    path: string;
}
export interface ImplementationEntry {
    data: string;
    file: {
        path: string;
        label?: string;
        id?: string | null;
        author?: string;
        updatedOn?: string;
    };
}
export interface UnpublishedEntryDiff {
    id: string;
    path: string;
    newFile: boolean;
}
export interface UnpublishedEntry {
    pullRequestAuthor?: string;
    slug: string;
    collection: string;
    status: string;
    diffs: UnpublishedEntryDiff[];
    updatedAt: string;
}
export interface Map {
    get: <T>(key: string, defaultValue?: T) => T;
    getIn: <T>(key: string[], defaultValue?: T) => T;
    setIn: <T>(key: string[], value: T) => Map;
    set: <T>(key: string, value: T) => Map;
}
export type DataFile = {
    path: string;
    slug: string;
    raw: string;
    newPath?: string;
};
export type AssetProxy = {
    path: string;
    fileObj?: File;
    toBase64?: () => Promise<string>;
};
export type Entry = {
    dataFiles: DataFile[];
    assets: AssetProxy[];
};
export type PersistOptions = {
    newEntry?: boolean;
    commitMessage: string;
    collectionName?: string;
    useWorkflow?: boolean;
    unpublished?: boolean;
    status?: string;
};
export type DeleteOptions = {};
export type Credentials = {
    token: string | {};
    refresh_token?: string;
};
export type User = Credentials & {
    backendName?: string;
    login?: string;
    name: string;
    useOpenAuthoring?: boolean;
};
export type Config = {
    backend: {
        repo?: string | null;
        open_authoring?: boolean;
        always_fork?: boolean;
        branch?: string;
        api_root?: string;
        squash_merges?: boolean;
        use_graphql?: boolean;
        graphql_api_root?: string;
        preview_context?: string;
        identity_url?: string;
        gateway_url?: string;
        large_media_url?: string;
        use_large_media_transforms_in_media_library?: boolean;
        proxy_url?: string;
        auth_type?: string;
        app_id?: string;
        base_url?: string;
        cms_label_prefix?: string;
        api_version?: string;
        status_endpoint?: string;
    };
    auth: {
        use_oidc?: boolean;
        base_url?: string;
        auth_endpoint?: string;
        auth_token_endpoint?: string;
        app_id?: string;
        auth_token_endpoint_content_type?: string;
        email_claim?: string;
        full_name_claim?: string;
        first_name_claim?: string;
        last_name_claim?: string;
        avatar_url_claim?: string;
    };
    media_folder: string;
    base_url?: string;
    site_id?: string;
};
export interface Implementation {
    authComponent: () => void;
    restoreUser: (user: User) => Promise<User>;
    authenticate: (credentials: Credentials) => Promise<User>;
    logout: () => Promise<void> | void | null;
    getToken: () => Promise<string | null>;
    getEntry: (path: string) => Promise<ImplementationEntry>;
    entriesByFolder: (folder: string, extension: string, depth: number) => Promise<ImplementationEntry[]>;
    entriesByFiles: (files: ImplementationFile[]) => Promise<ImplementationEntry[]>;
    getMediaDisplayURL?: (displayURL: DisplayURL) => Promise<string>;
    getMedia: (folder?: string) => Promise<ImplementationMediaFile[]>;
    getMediaFile: (path: string) => Promise<ImplementationMediaFile>;
    persistEntry: (entry: Entry, opts: PersistOptions) => Promise<void>;
    persistMedia: (file: AssetProxy, opts: PersistOptions) => Promise<ImplementationMediaFile>;
    deleteFiles: (paths: string[], commitMessage: string) => Promise<void>;
    unpublishedEntries: () => Promise<string[]>;
    unpublishedEntry: (args: {
        id?: string;
        collection?: string;
        slug?: string;
    }) => Promise<UnpublishedEntry>;
    unpublishedEntryDataFile: (collection: string, slug: string, path: string, id: string) => Promise<string>;
    unpublishedEntryMediaFile: (collection: string, slug: string, path: string, id: string) => Promise<ImplementationMediaFile>;
    updateUnpublishedEntryStatus: (collection: string, slug: string, newStatus: string) => Promise<void>;
    publishUnpublishedEntry: (collection: string, slug: string) => Promise<void>;
    deleteUnpublishedEntry: (collection: string, slug: string) => Promise<void>;
    getDeployPreview: (collectionName: string, slug: string) => Promise<{
        url: string;
        status: string;
    } | null>;
    allEntriesByFolder?: (folder: string, extension: string, depth: number, pathRegex?: RegExp) => Promise<ImplementationEntry[]>;
    traverseCursor?: (cursor: Cursor, action: string) => Promise<{
        entries: ImplementationEntry[];
        cursor: Cursor;
    }>;
    isGitBackend?: () => boolean;
    status: () => Promise<{
        auth: {
            status: boolean;
        };
        api: {
            status: boolean;
            statusPage: string;
        };
    }>;
}
export type ImplementationFile = {
    id?: string | null | undefined;
    label?: string;
    path: string;
};
type ReadFile = (path: string, id: string | null | undefined, options: {
    parseText: boolean;
}) => Promise<string | Blob>;
type ReadFileMetadata = (path: string, id: string | null | undefined) => Promise<FileMetadata>;
type CustomFetchFunc = (files: ImplementationFile[]) => Promise<ImplementationEntry[]>;
export declare function entriesByFolder(listFiles: () => Promise<ImplementationFile[]>, readFile: ReadFile, readFileMetadata: ReadFileMetadata, apiName: string): Promise<ImplementationEntry[]>;
export declare function entriesByFiles(files: ImplementationFile[], readFile: ReadFile, readFileMetadata: ReadFileMetadata, apiName: string): Promise<ImplementationEntry[]>;
export declare function unpublishedEntries(listEntriesKeys: () => Promise<string[]>): Promise<string[]>;
export declare function blobToFileObj(name: string, blob: Blob): File;
export declare function getMediaAsBlob(path: string, id: string | null, readFile: ReadFile): Promise<Blob>;
export declare function getMediaDisplayURL(displayURL: DisplayURL, readFile: ReadFile, semaphore: Semaphore): Promise<string>;
export declare function runWithLock(lock: AsyncLock, func: Function, message: string): Promise<any>;
type LocalTree = {
    head: string;
    files: {
        id: string;
        name: string;
        path: string;
    }[];
};
type GetKeyArgs = {
    branch: string;
    folder: string;
    extension: string;
    depth: number;
};
type PersistLocalTreeArgs = GetKeyArgs & {
    localForage: LocalForage;
    localTree: LocalTree;
};
type GetLocalTreeArgs = GetKeyArgs & {
    localForage: LocalForage;
};
export declare function persistLocalTree({ localForage, localTree, branch, folder, extension, depth, }: PersistLocalTreeArgs): Promise<void>;
export declare function getLocalTree({ localForage, branch, folder, extension, depth, }: GetLocalTreeArgs): Promise<LocalTree | null>;
type GetDiffFromLocalTreeMethods = {
    getDifferences: (to: string, from: string) => Promise<{
        oldPath: string;
        newPath: string;
        status: string;
    }[]>;
    filterFile: (file: {
        path: string;
        name: string;
    }) => boolean;
    getFileId: (path: string) => Promise<string>;
};
type AllEntriesByFolderArgs = GetKeyArgs & GetDiffFromLocalTreeMethods & {
    listAllFiles: (folder: string, extension: string, depth: number) => Promise<ImplementationFile[]>;
    readFile: ReadFile;
    readFileMetadata: ReadFileMetadata;
    getDefaultBranch: () => Promise<{
        name: string;
        sha: string;
    }>;
    isShaExistsInBranch: (branch: string, sha: string) => Promise<boolean>;
    apiName: string;
    localForage: LocalForage;
    customFetch?: CustomFetchFunc;
};
export declare function allEntriesByFolder({ listAllFiles, readFile, readFileMetadata, apiName, branch, localForage, folder, extension, depth, getDefaultBranch, isShaExistsInBranch, getDifferences, getFileId, filterFile, customFetch, }: AllEntriesByFolderArgs): Promise<ImplementationEntry[]>;
export {};
