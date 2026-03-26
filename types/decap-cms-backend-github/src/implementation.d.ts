import * as React from 'react';
import { Cursor } from 'decap-cms-lib-util';
import API from './API';
import type { Octokit } from '@octokit/rest';
import type { AsyncLock, Implementation, AssetProxy, PersistOptions, DisplayURL, User, Credentials, Config, ImplementationFile, UnpublishedEntryMediaFile, Entry } from 'decap-cms-lib-util';
import type { Semaphore } from 'semaphore';
export type GitHubUser = Octokit.UsersGetAuthenticatedResponse;
type ApiFile = {
    id: string;
    type: string;
    name: string;
    path: string;
    size: number;
};
export default class GitHub implements Implementation {
    lock: AsyncLock;
    api: API | null;
    options: {
        proxied: boolean;
        API: API | null;
        useWorkflow?: boolean;
        initialWorkflowStatus: string;
    };
    originRepo: string;
    isBranchConfigured: boolean;
    repo?: string;
    openAuthoringEnabled: boolean;
    useOpenAuthoring?: boolean;
    alwaysForkEnabled: boolean;
    branch: string;
    apiRoot: string;
    mediaFolder: string;
    previewContext: string;
    token: string | null;
    tokenKeyword: string;
    squashMerges: boolean;
    cmsLabelPrefix: string;
    useGraphql: boolean;
    baseUrl?: string;
    bypassWriteAccessCheckForAppTokens: boolean;
    _currentUserPromise?: Promise<GitHubUser>;
    _userIsOriginMaintainerPromises?: {
        [key: string]: Promise<boolean>;
    };
    _mediaDisplayURLSem?: Semaphore;
    constructor(config: Config, options?: {});
    isGitBackend(): boolean;
    status(): Promise<{
        auth: {
            status: boolean;
        };
        api: {
            status: any;
            statusPage: string;
        };
    }>;
    authComponent(): {
        (props: Record<string, unknown>): React.JSX.Element;
        displayName: string;
    };
    restoreUser(user: User): Promise<{
        token: string;
        useOpenAuthoring: boolean | undefined;
        name: string;
        login: string;
    }>;
    pollUntilForkExists({ repo, token }: {
        repo: string;
        token: string;
    }): Promise<void>;
    currentUser({ token }: {
        token: string;
    }): Promise<Octokit.UsersGetAuthenticatedResponse>;
    userIsOriginMaintainer({ username: usernameArg, token, }: {
        username?: string;
        token: string;
    }): Promise<boolean>;
    forkExists({ token }: {
        token: string;
    }): Promise<any>;
    authenticateWithFork({ userData, getPermissionToFork, }: {
        userData: User;
        getPermissionToFork: () => Promise<boolean> | boolean;
    }): Promise<void | Response>;
    authenticate(state: Credentials): Promise<{
        token: string;
        useOpenAuthoring: boolean | undefined;
        name: string;
        login: string;
    }>;
    logout(): void;
    getToken(): Promise<string | null>;
    getCursorAndFiles: (files: ApiFile[], page: number) => {
        cursor: Cursor;
        files: ApiFile[];
    };
    entriesByFolder(folder: string, extension: string, depth: number): Promise<import("decap-cms-lib-util/src/implementation").ImplementationEntry[]>;
    allEntriesByFolder(folder: string, extension: string, depth: number, pathRegex?: RegExp): Promise<import("decap-cms-lib-util/src/implementation").ImplementationEntry[]>;
    entriesByFiles(files: ImplementationFile[]): Promise<import("decap-cms-lib-util/src/implementation").ImplementationEntry[]>;
    getEntry(path: string): Promise<{
        file: {
            path: string;
            id: null;
        };
        data: string;
    } | {
        file: {
            path: string;
            id: null;
        };
        data: string;
    }>;
    getMedia(mediaFolder?: string): Promise<{
        id: string;
        name: string;
        size: number;
        displayURL: {
            id: string;
            path: string;
        };
        path: string;
    }[]>;
    getMediaFile(path: string): Promise<{
        id: string;
        displayURL: string;
        path: string;
        name: string;
        size: number;
        file: File;
        url: string;
    }>;
    getMediaDisplayURL(displayURL: DisplayURL): Promise<string>;
    persistEntry(entry: Entry, options: PersistOptions): Promise<any>;
    persistMedia(mediaFile: AssetProxy, options: PersistOptions): Promise<{
        id: string;
        name: string;
        size: number;
        displayURL: string;
        path: string;
    }>;
    deleteFiles(paths: string[], commitMessage: string): Promise<undefined>;
    traverseCursor(cursor: Cursor, action: string): Promise<{
        entries: import("decap-cms-lib-util/src/implementation").ImplementationEntry[];
        cursor: Cursor;
    }>;
    loadMediaFile(branch: string, file: UnpublishedEntryMediaFile): Promise<{
        id: string;
        displayURL: string;
        path: string;
        name: string;
        size: number;
        file: File;
    }>;
    unpublishedEntries(): Promise<string[]>;
    unpublishedEntry({ id, collection, slug, }: {
        id?: string;
        collection?: string;
        slug?: string;
    }): Promise<{
        collection: string;
        slug: string;
        status: string;
        diffs: {
            path: string;
            newFile: boolean;
            id: string;
        }[];
        updatedAt: string;
        pullRequestAuthor: string | undefined;
    }>;
    getBranch(collection: string, slug: string): string;
    unpublishedEntryDataFile(collection: string, slug: string, path: string, id: string): Promise<string>;
    unpublishedEntryMediaFile(collection: string, slug: string, path: string, id: string): Promise<{
        id: string;
        displayURL: string;
        path: string;
        name: string;
        size: number;
        file: File;
    }>;
    getDeployPreview(collection: string, slug: string): Promise<{
        url: string;
        status: import("decap-cms-lib-util").PreviewState;
    } | null>;
    updateUnpublishedEntryStatus(collection: string, slug: string, newStatus: string): Promise<any>;
    deleteUnpublishedEntry(collection: string, slug: string): Promise<any>;
    publishUnpublishedEntry(collection: string, slug: string): Promise<any>;
}
export {};
