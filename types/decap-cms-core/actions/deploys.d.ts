import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
import type { Collection, Entry, State } from '../types/redux';
export declare const DEPLOY_PREVIEW_REQUEST = "DEPLOY_PREVIEW_REQUEST";
export declare const DEPLOY_PREVIEW_SUCCESS = "DEPLOY_PREVIEW_SUCCESS";
export declare const DEPLOY_PREVIEW_FAILURE = "DEPLOY_PREVIEW_FAILURE";
declare function deployPreviewLoading(collection: string, slug: string): {
    readonly type: "DEPLOY_PREVIEW_REQUEST";
    readonly payload: {
        readonly collection: string;
        readonly slug: string;
    };
};
declare function deployPreviewLoaded(collection: string, slug: string, deploy: {
    url: string | undefined;
    status: string;
}): {
    readonly type: "DEPLOY_PREVIEW_SUCCESS";
    readonly payload: {
        readonly collection: string;
        readonly slug: string;
        readonly url: string;
        readonly status: string;
    };
};
declare function deployPreviewError(collection: string, slug: string): {
    readonly type: "DEPLOY_PREVIEW_FAILURE";
    readonly payload: {
        readonly collection: string;
        readonly slug: string;
    };
};
/**
 * Requests a deploy preview object from the registered backend.
 */
export declare function loadDeployPreview(collection: Collection, slug: string, entry: Entry, published: boolean, opts?: {
    maxAttempts?: number;
    interval?: number;
}): (dispatch: ThunkDispatch<State, undefined, AnyAction>, getState: () => State) => Promise<any>;
export type DeploysAction = ReturnType<typeof deployPreviewLoading | typeof deployPreviewLoaded | typeof deployPreviewError>;
export {};
