import type { QueryRequest } from '../reducers/search';
import type { State } from '../types/redux';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import type { EntryValue } from '../valueObjects/Entry';
export declare const SEARCH_ENTRIES_REQUEST = "SEARCH_ENTRIES_REQUEST";
export declare const SEARCH_ENTRIES_SUCCESS = "SEARCH_ENTRIES_SUCCESS";
export declare const SEARCH_ENTRIES_FAILURE = "SEARCH_ENTRIES_FAILURE";
export declare const QUERY_REQUEST = "QUERY_REQUEST";
export declare const QUERY_SUCCESS = "QUERY_SUCCESS";
export declare const QUERY_FAILURE = "QUERY_FAILURE";
export declare const SEARCH_CLEAR = "SEARCH_CLEAR";
export declare const CLEAR_REQUESTS = "CLEAR_REQUESTS";
export declare function searchingEntries(searchTerm: string, searchCollections: string[], page: number): {
    readonly type: "SEARCH_ENTRIES_REQUEST";
    readonly payload: {
        readonly searchTerm: string;
        readonly searchCollections: string[];
        readonly page: number;
    };
};
export declare function searchSuccess(entries: EntryValue[], page: number): {
    readonly type: "SEARCH_ENTRIES_SUCCESS";
    readonly payload: {
        readonly entries: EntryValue[];
        readonly page: number;
    };
};
export declare function searchFailure(error: Error): {
    readonly type: "SEARCH_ENTRIES_FAILURE";
    readonly payload: {
        readonly error: Error;
    };
};
export declare function querying(searchTerm: string, request?: QueryRequest): {
    readonly type: "QUERY_REQUEST";
    readonly payload: {
        readonly searchTerm: string;
        readonly request: QueryRequest;
    };
};
export declare function querySuccess(namespace: string, hits: EntryValue[]): {
    readonly type: "QUERY_SUCCESS";
    readonly payload: {
        readonly namespace: string;
        readonly hits: EntryValue[];
    };
};
export declare function queryFailure(error: Error): {
    readonly type: "QUERY_FAILURE";
    readonly payload: {
        readonly error: Error;
    };
};
export declare function clearSearch(): {
    readonly type: "SEARCH_CLEAR";
};
export declare function clearRequests(): {
    readonly type: "CLEAR_REQUESTS";
};
export declare function searchEntries(searchTerm: string, searchCollections: string[], page?: number): (dispatch: ThunkDispatch<State, undefined, AnyAction>, getState: () => State) => Promise<any>;
export declare function query(namespace: string, collectionName: string, searchFields: string[], searchTerm: string, file?: string, limit?: number): (dispatch: ThunkDispatch<State, ThunkContext, AnyAction>, getState: () => State) => Promise<any>;
export type SearchAction = ReturnType<typeof searchingEntries | typeof searchSuccess | typeof searchFailure | typeof querying | typeof querySuccess | typeof queryFailure | typeof clearSearch | typeof clearRequests>;
