import { ApolloClient } from 'apollo-client';
import API, { PullRequestState } from './API';
import type { Config, BlobArgs } from './API';
import type { NormalizedCacheObject } from 'apollo-cache-inmemory';
import type { QueryOptions, MutationOptions, OperationVariables } from 'apollo-client';
import type { Octokit } from '@octokit/rest';
interface TreeEntry {
    object?: {
        entries: TreeEntry[];
    };
    type: 'blob' | 'tree';
    name: string;
    sha: string;
    blob?: {
        size: number;
    };
}
interface TreeFile {
    path: string;
    id: string;
    size: number;
    type: string;
    name: string;
}
export default class GraphQLAPI extends API {
    client: ApolloClient<NormalizedCacheObject>;
    constructor(config: Config);
    getApolloClient(): ApolloClient<NormalizedCacheObject>;
    reset(): Promise<import("apollo-client").ApolloQueryResult<any>[] | null>;
    getRepository(owner: string, name: string): Promise<any>;
    query(options: QueryOptions<OperationVariables>): Promise<import("apollo-client").ApolloQueryResult<any>>;
    mutate(options: MutationOptions<OperationVariables>): Promise<import("apollo-link").FetchResult<OperationVariables, Record<string, any>, Record<string, any>>>;
    hasWriteAccess(): Promise<boolean>;
    user(): Promise<any>;
    retrieveBlobObject(owner: string, name: string, expression: string, options?: {}): Promise<{
        isNull: boolean;
        isBinary: any;
        text: any;
    } | {
        isNull: boolean;
        isBinary?: undefined;
        text?: undefined;
    }>;
    getOwnerAndNameFromRepoUrl(repoURL: string): {
        owner: string;
        name: string;
    };
    readFile(path: string, sha?: string | null, { branch, repoURL, parseText, }?: {
        branch?: string;
        repoURL?: string;
        parseText?: boolean;
    }): Promise<string | Blob>;
    fetchBlobContent({ sha, repoURL, parseText }: BlobArgs): Promise<any>;
    getPullRequestAuthor(pullRequest: Octokit.PullsListResponseItem): Promise<string>;
    getPullRequests(head: string | undefined, state: PullRequestState, predicate: (pr: Octokit.PullsListResponseItem) => boolean): Promise<Octokit.PullsListResponseItem[]>;
    getOpenAuthoringBranches(): Promise<any>;
    getStatuses(collectionName: string, slug: string): Promise<any>;
    getAllFiles(entries: TreeEntry[], path: string): TreeFile[];
    listFiles(path: string, { repoURL, branch, depth }?: {
        repoURL?: string | undefined;
        branch?: string | undefined;
        depth?: number | undefined;
    }): Promise<TreeFile[]>;
    getBranchQualifiedName(branch: string): string;
    getBranchQuery(branch: string, owner: string, name: string): {
        query: import("graphql").DocumentNode;
        variables: {
            owner: string;
            name: string;
            qualifiedName: string;
        };
    };
    getDefaultBranch(): Promise<any>;
    getBranch(branch: string): Promise<any>;
    patchRef(type: string, name: string, sha: string, opts?: {
        force?: boolean;
    }): Promise<any>;
    deleteBranch(branchName: string): Promise<any>;
    getPullRequestQuery(number: number): {
        query: import("graphql").DocumentNode;
        variables: {
            owner: string;
            name: string;
            number: number;
        };
    };
    getPullRequest(number: number): Promise<any>;
    getPullRequestAndBranchQuery(branch: string, number: number): {
        query: import("graphql").DocumentNode;
        variables: {
            owner: string;
            name: string;
            originRepoOwner: string;
            originRepoName: string;
            number: number;
            qualifiedName: string;
        };
    };
    getPullRequestAndBranch(branch: string, number: number): Promise<{
        branch: any;
        pullRequest: any;
    }>;
    openPR(number: number): Promise<any>;
    closePR(number: number): Promise<any>;
    deleteUnpublishedEntry(collectionName: string, slug: string): Promise<any>;
    createPR(title: string, head: string): Promise<any>;
    createBranch(branchName: string, sha: string): Promise<any>;
    createBranchAndPullRequest(branchName: string, sha: string, title: string): Promise<Octokit.PullsCreateResponse>;
    getFileSha(path: string, { repoURL, branch }?: {
        repoURL?: string | undefined;
        branch?: string | undefined;
    }): Promise<any>;
}
export {};
