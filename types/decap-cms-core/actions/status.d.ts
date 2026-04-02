import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
import type { State } from '../types/redux';
export declare const STATUS_REQUEST = "STATUS_REQUEST";
export declare const STATUS_SUCCESS = "STATUS_SUCCESS";
export declare const STATUS_FAILURE = "STATUS_FAILURE";
export declare function statusRequest(): {
    readonly type: "STATUS_REQUEST";
};
export declare function statusSuccess(status: {
    auth: {
        status: boolean;
    };
    api: {
        status: boolean;
        statusPage: string;
    };
}): {
    readonly type: "STATUS_SUCCESS";
    readonly payload: {
        readonly status: {
            auth: {
                status: boolean;
            };
            api: {
                status: boolean;
                statusPage: string;
            };
        };
    };
};
export declare function statusFailure(error: Error): {
    readonly type: "STATUS_FAILURE";
    readonly payload: {
        readonly error: Error;
    };
};
export declare function checkBackendStatus(): (dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, getState: () => State) => Promise<any>;
export type StatusAction = ReturnType<typeof statusRequest | typeof statusSuccess | typeof statusFailure>;
