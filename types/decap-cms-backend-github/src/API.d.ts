import { PreviewState } from 'decap-cms-lib-util';
import type { AssetProxy, DataFile, PersistOptions, FetchError, ApiRequest } from 'decap-cms-lib-util';
import type { Semaphore } from 'semaphore';
import type { Octokit } from '@octokit/rest';
type GitHubUser = Octokit.UsersGetAuthenticatedResponse;
type GitCreateTreeParamsTree = Octokit.GitCreateTreeParamsTree;
type GitHubCompareCommit = Octokit.ReposCompareCommitsResponseCommitsItem;
type GitHubAuthor = Octokit.GitCreateCommitResponseAuthor;
type GitHubCommitter = Octokit.GitCreateCommitResponseCommitter;
type GitHubPull = Octokit.PullsListResponseItem;
export declare const API_NAME = "GitHub";
export declare const MOCK_PULL_REQUEST = -1;
export interface Config {
    apiRoot?: string;
    token?: string;
    tokenKeyword?: string;
    branch?: string;
    useOpenAuthoring?: boolean;
    repo?: string;
    originRepo?: string;
    squashMerges: boolean;
    initialWorkflowStatus: string;
    cmsLabelPrefix: string;
    baseUrl?: string;
    getUser: ({ token }: {
        token: string;
    }) => Promise<GitHubUser>;
}
interface TreeFile {
    type: 'blob' | 'tree';
    sha: string;
    path: string;
    raw?: string;
}
type Override<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U;
type TreeEntry = Override<GitCreateTreeParamsTree, {
    sha: string | null;
}>;
type GitHubCompareCommits = GitHubCompareCommit[];
export declare enum PullRequestState {
    Open = "open",
    Closed = "closed",
    All = "all"
}
interface MetaDataObjects {
    entry: {
        path: string;
        sha: string;
    };
    files: MediaFile[];
}
export interface Metadata {
    type: string;
    objects: MetaDataObjects;
    branch: string;
    status: string;
    pr?: {
        number: number;
        head: string | {
            sha: string;
        };
    };
    collection: string;
    commitMessage: string;
    version?: string;
    user: string;
    title?: string;
    description?: string;
    timeStamp: string;
}
export interface BlobArgs {
    sha: string;
    repoURL: string;
    parseText: boolean;
}
type Param = string | number | undefined;
type Options = RequestInit & {
    params?: Record<string, Param | Record<string, Param> | string[]>;
};
type MediaFile = {
    sha: string;
    path: string;
};
export type Diff = {
    path: string;
    newFile: boolean;
    sha: string;
    binary: boolean;
};
export default class API {
    apiRoot: string;
    token: string;
    tokenKeyword: string;
    branch: string;
    useOpenAuthoring?: boolean;
    repo: string;
    originRepo: string;
    repoOwner: string;
    repoName: string;
    originRepoOwner: string;
    originRepoName: string;
    repoURL: string;
    originRepoURL: string;
    mergeMethod: string;
    initialWorkflowStatus: string;
    cmsLabelPrefix: string;
    baseUrl?: string;
    getUser: ({ token }: {
        token: string;
    }) => Promise<GitHubUser>;
    _userPromise?: Promise<GitHubUser>;
    _metadataSemaphore?: Semaphore;
    commitAuthor?: {};
    constructor(config: Config);
    static DEFAULT_COMMIT_MESSAGE: string;
    user(): Promise<{
        name: string;
        login: string;
    }>;
    hasWriteAccess(): Promise<boolean>;
    reset(): void;
    requestHeaders(headers?: {}): Promise<Record<string, string>>;
    parseJsonResponse(response: Response): Promise<any>;
    urlFor(path: string, options: Options): string;
    parseResponse(response: Response): Promise<any>;
    handleRequestError(error: FetchError, responseStatus: number): void;
    buildRequest(req: ApiRequest): import("decap-cms-lib-util/src/API").ApiRequest;
    request(path: string, options?: Options, parser?: (response: Response) => Promise<any>): Promise<any>;
    nextUrlProcessor(): (url: string) => string;
    requestAllPages<T>(url: string, options?: Options): Promise<T[]>;
    generateContentKey(collectionName: string, slug: string): string;
    parseContentKey(contentKey: string): {
        collection: string;
        slug: string;
    };
    checkMetadataRef(): Promise<any>;
    storeMetadata(key: string, data: Metadata): Promise<void>;
    deleteMetadata(key: string): Promise<void>;
    retrieveMetadataOld(key: string): Promise<Metadata>;
    getPullRequests(head: string | undefined, state: PullRequestState, predicate: (pr: GitHubPull) => boolean): Promise<Octokit.PullsListResponseItem[]>;
    getOpenAuthoringPullRequest(branch: string, pullRequests: GitHubPull[]): Promise<Octokit.PullsListResponseItem>;
    getBranchPullRequest(branch: string): Promise<Octokit.PullsListResponseItem>;
    getPullRequestCommits(number: number): Promise<Octokit.PullsListCommitsResponseItem[]>;
    getPullRequestAuthor(pullRequest: Octokit.PullsListResponseItem): Promise<string | undefined>;
    retrieveUnpublishedEntryData(contentKey: string): Promise<{
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
    readFile(path: string, sha?: string | null, { branch, repoURL, parseText, }?: {
        branch?: string;
        repoURL?: string;
        parseText?: boolean;
    }): Promise<string | Blob>;
    readFileMetadata(path: string, sha: string | null | undefined): Promise<import("decap-cms-lib-util/src/API").FileMetadata>;
    fetchBlobContent({ sha, repoURL, parseText }: BlobArgs): Promise<string | Blob>;
    listFiles(path: string, { repoURL, branch, depth }?: {
        repoURL?: string | undefined;
        branch?: string | undefined;
        depth?: number | undefined;
    }): Promise<{
        type: string;
        id: string;
        name: string;
        path: string;
        size: number;
    }[]>;
    filterOpenAuthoringBranches: (branch: string) => Promise<{
        branch: string;
        filter: boolean;
    }>;
    migrateToVersion1(pullRequest: GitHubPull, metadata: Metadata): Promise<{
        metadata: {
            pr: {
                number: number;
                head: string;
            };
            branch: string;
            version: string;
            type: string;
            objects: MetaDataObjects;
            status: string;
            collection: string;
            commitMessage: string;
            user: string;
            title?: string | undefined;
            description?: string | undefined;
            timeStamp: string;
        };
        pullRequest: Octokit.PullsListResponseItem;
    }>;
    migrateToPullRequestLabels(pullRequest: GitHubPull, metadata: Metadata): Promise<void>;
    migratePullRequest(pullRequest: GitHubPull, countMessage: string): Promise<void>;
    getOpenAuthoringBranches(): Promise<Octokit.GitListMatchingRefsResponseItem[]>;
    listUnpublishedBranches(): Promise<string[]>;
    /**
     * Retrieve statuses for a given SHA. Unrelated to the editorial workflow
     * concept of entry "status". Useful for things like deploy preview links.
     */
    getStatuses(collectionName: string, slug: string): Promise<{
        context: string;
        target_url: string;
        state: PreviewState;
    }[]>;
    persistFiles(dataFiles: DataFile[], mediaFiles: AssetProxy[], options: PersistOptions): Promise<Octokit.GitUpdateRefResponse | undefined>;
    getFileSha(path: string, { repoURL, branch }?: {
        repoURL?: string | undefined;
        branch?: string | undefined;
    }): Promise<string>;
    deleteFiles(paths: string[], message: string): Promise<undefined>;
    createBranchAndPullRequest(branchName: string, sha: string, commitMessage: string): Promise<Octokit.PullsCreateResponse>;
    updatePullRequestLabels(number: number, labels: string[]): Promise<void>;
    diffFromFile(diff: Octokit.ReposCompareCommitsResponseFilesItem): Promise<Diff>;
    editorialWorkflowGit(files: TreeFile[], slug: string, mediaFilesList: MediaFile[], options: PersistOptions): Promise<Octokit.GitUpdateRefResponse | undefined>;
    getDifferences(from: string, to: string): Promise<Octokit.ReposCompareCommitsResponse>;
    rebaseSingleCommit(baseCommit: GitHubCompareCommit, commit: GitHubCompareCommit): Promise<Octokit.ReposCompareCommitsResponseCommitsItem>;
    /**
     * Rebase an array of commits one-by-one, starting from a given base SHA
     */
    rebaseCommits(baseCommit: GitHubCompareCommit, commits: GitHubCompareCommits): Promise<Octokit.ReposCompareCommitsResponseCommitsItem>;
    rebaseBranch(branch: string): Promise<Octokit.ReposCompareCommitsResponseCommitsItem>;
    setPullRequestStatus(pullRequest: GitHubPull, newStatus: string): Promise<void>;
    updateUnpublishedEntryStatus(collectionName: string, slug: string, newStatus: string): Promise<void>;
    deleteUnpublishedEntry(collectionName: string, slug: string): Promise<void>;
    publishUnpublishedEntry(collectionName: string, slug: string): Promise<void>;
    createRef(type: string, name: string, sha: string): Promise<Octokit.GitCreateRefResponse>;
    patchRef(type: string, name: string, sha: string, opts?: {
        force?: boolean;
    }): Promise<Octokit.GitUpdateRefResponse>;
    deleteRef(type: string, name: string): Promise<any>;
    getBranch(branch: string): Promise<Octokit.ReposGetBranchResponse>;
    getDefaultBranch(): Promise<Octokit.ReposGetBranchResponse>;
    backupBranch(branchName: string): Promise<void>;
    createBranch(branchName: string, sha: string): Promise<Octokit.GitCreateRefResponse>;
    assertCmsBranch(branchName: string): boolean;
    patchBranch(branchName: string, sha: string, opts?: {
        force?: boolean;
    }): Promise<Octokit.GitUpdateRefResponse>;
    deleteBranch(branchName: string): Promise<any>;
    getHeadReference(head: string): Promise<string>;
    createPR(title: string, head: string): Promise<Octokit.PullsCreateResponse>;
    openPR(number: number): Promise<Octokit.PullsUpdateBranchResponse>;
    closePR(number: number): Promise<Octokit.PullsUpdateBranchResponse>;
    mergePR(pullrequest: GitHubPull): Promise<Octokit.GitUpdateRefResponse | Octokit.PullsMergeResponse>;
    forceMergePR(pullRequest: GitHubPull): Promise<Octokit.GitUpdateRefResponse>;
    toBase64(str: string): Promise<string>;
    uploadBlob(item: {
        raw?: string;
        sha?: string;
        toBase64?: () => Promise<string>;
    }): Promise<{
        raw?: string | undefined;
        sha?: string | undefined;
        toBase64?: (() => Promise<string>) | undefined;
    }>;
    updateTree(baseSha: string, files: {
        path: string;
        sha: string | null;
        newPath?: string;
    }[], branch?: string): Promise<{
        parentSha: string;
        sha: string;
        tree: Octokit.GitCreateTreeResponseTreeItem[];
        url: string;
    }>;
    createTree(baseSha: string, tree: TreeEntry[]): Promise<Octokit.GitCreateTreeResponse>;
    commit(message: string, changeTree: {
        parentSha?: string;
        sha: string;
    }): Promise<Octokit.GitCreateCommitResponse>;
    createCommit(message: string, treeSha: string, parents: string[], author?: GitHubAuthor, committer?: GitHubCommitter): Promise<Octokit.GitCreateCommitResponse>;
    getUnpublishedEntrySha(collection: string, slug: string): Promise<string>;
}
export {};
