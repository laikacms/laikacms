import type { AsyncLock } from './asyncLock';
export interface FetchError extends Error {
    status: number;
}
interface API {
    rateLimiter?: AsyncLock;
    buildRequest: (req: ApiRequest) => ApiRequest | Promise<ApiRequest>;
    requestFunction?: (req: ApiRequest) => Promise<Response>;
}
export type ApiRequestObject = {
    url: string;
    params?: Record<string, string | boolean | number>;
    method?: 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH';
    headers?: Record<string, string>;
    body?: string | FormData;
    cache?: 'no-store';
};
export type ApiRequest = ApiRequestObject | string;
export declare function parseResponse(response: Response): Promise<any>;
export declare function requestWithBackoff(api: API, req: ApiRequest, attempt?: number): Promise<Response>;
type Param = string | number;
type ParamObject = Record<string, Param>;
type HeaderObj = Record<string, string>;
type HeaderConfig = {
    headers?: HeaderObj;
    token?: string | undefined;
};
type Backend = 'github' | 'gitlab' | 'bitbucket';
type RequestConfig = Omit<RequestInit, 'headers'> & HeaderConfig & {
    backend: Backend;
    apiRoot?: string;
    params?: ParamObject;
};
export declare const apiRoots: {
    github: string;
    gitlab: string;
    bitbucket: string;
};
export declare const endpointConstants: {
    singleRepo: {
        bitbucket: string;
        github: string;
        gitlab: string;
    };
};
export declare function apiRequest(path: string, config: RequestConfig, parser?: (response: Response) => Promise<any>): Promise<any>;
export declare function getDefaultBranchName(configs: {
    backend: Backend;
    repo: string;
    token?: string;
    apiRoot?: string;
}): Promise<any>;
export declare function readFile(id: string | null | undefined, fetchContent: () => Promise<string | Blob>, localForage: LocalForage, isText: boolean): Promise<string | Blob>;
export type FileMetadata = {
    author: string;
    updatedOn: string;
};
export declare function readFileMetadata(id: string | null | undefined, fetchMetadata: () => Promise<FileMetadata>, localForage: LocalForage): Promise<FileMetadata>;
/**
 * Check a given status context string to determine if it provides a link to a
 * deploy preview. Checks for an exact match against `previewContext` if given,
 * otherwise checks for inclusion of a value from `PREVIEW_CONTEXT_KEYWORDS`.
 */
export declare function isPreviewContext(context: string, previewContext: string): boolean;
export declare enum PreviewState {
    Other = "other",
    Success = "success"
}
/**
 * Retrieve a deploy preview URL from an array of statuses. By default, a
 * matching status is inferred via `isPreviewContext`.
 */
export declare function getPreviewStatus(statuses: {
    context: string;
    target_url: string;
    state: PreviewState;
}[], previewContext: string): {
    context: string;
    target_url: string;
    state: PreviewState;
} | undefined;
export declare function throwOnConflictingBranches(branchName: string, getBranch: (name: string) => Promise<{
    name: string;
}>, apiName: string): Promise<void>;
export {};
