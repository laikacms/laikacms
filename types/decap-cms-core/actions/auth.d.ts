import type { Credentials, User } from 'decap-cms-lib-util';
import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
import type { State } from '../types/redux';
export declare const AUTH_REQUEST = "AUTH_REQUEST";
export declare const AUTH_SUCCESS = "AUTH_SUCCESS";
export declare const AUTH_FAILURE = "AUTH_FAILURE";
export declare const AUTH_REQUEST_DONE = "AUTH_REQUEST_DONE";
export declare const USE_OPEN_AUTHORING = "USE_OPEN_AUTHORING";
export declare const LOGOUT = "LOGOUT";
export declare function authenticating(): {
    readonly type: "AUTH_REQUEST";
};
export declare function authenticate(userData: User): {
    readonly type: "AUTH_SUCCESS";
    readonly payload: User;
};
export declare function authError(error: Error): {
    readonly type: "AUTH_FAILURE";
    readonly error: "Failed to authenticate";
    readonly payload: Error;
};
export declare function doneAuthenticating(): {
    readonly type: "AUTH_REQUEST_DONE";
};
export declare function useOpenAuthoring(): {
    readonly type: "USE_OPEN_AUTHORING";
};
export declare function logout(): {
    readonly type: "LOGOUT";
};
export declare function authenticateUser(): (dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, getState: () => State) => any;
export declare function loginUser(credentials: Credentials): (dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, getState: () => State) => any;
export declare function logoutUser(): (dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, getState: () => State) => void;
export type AuthAction = ReturnType<typeof authenticating | typeof authenticate | typeof authError | typeof doneAuthenticating | typeof logout>;
