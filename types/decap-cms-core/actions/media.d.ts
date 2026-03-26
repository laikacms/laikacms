import type AssetProxy from '../valueObjects/AssetProxy';
import type { Collection, State, EntryMap, EntryField } from '../types/redux';
import type { ThunkDispatch } from 'redux-thunk';
import type { AnyAction } from 'redux';
export declare const ADD_ASSETS = "ADD_ASSETS";
export declare const ADD_ASSET = "ADD_ASSET";
export declare const REMOVE_ASSET = "REMOVE_ASSET";
export declare const LOAD_ASSET_REQUEST = "LOAD_ASSET_REQUEST";
export declare const LOAD_ASSET_SUCCESS = "LOAD_ASSET_SUCCESS";
export declare const LOAD_ASSET_FAILURE = "LOAD_ASSET_FAILURE";
export declare function addAssets(assets: AssetProxy[]): {
    readonly type: "ADD_ASSETS";
    readonly payload: AssetProxy[];
};
export declare function addAsset(assetProxy: AssetProxy): {
    readonly type: "ADD_ASSET";
    readonly payload: AssetProxy;
};
export declare function removeAsset(path: string): {
    readonly type: "REMOVE_ASSET";
    readonly payload: string;
};
export declare function loadAssetRequest(path: string): {
    readonly type: "LOAD_ASSET_REQUEST";
    readonly payload: {
        readonly path: string;
    };
};
export declare function loadAssetSuccess(path: string): {
    readonly type: "LOAD_ASSET_SUCCESS";
    readonly payload: {
        readonly path: string;
    };
};
export declare function loadAssetFailure(path: string, error: Error): {
    readonly type: "LOAD_ASSET_FAILURE";
    readonly payload: {
        readonly path: string;
        readonly error: Error;
    };
};
export declare function loadAsset(resolvedPath: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
interface GetAssetArgs {
    collection: Collection;
    entry: EntryMap;
    path: string;
    field?: EntryField;
}
export declare function boundGetAsset(dispatch: ThunkDispatch<State, {}, AnyAction>, collection: Collection, entry: EntryMap): (path: string, field: EntryField) => any;
export declare function getAsset({ collection, entry, path, field }: GetAssetArgs): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => AssetProxy;
export type MediasAction = ReturnType<typeof addAssets | typeof addAsset | typeof removeAsset | typeof loadAssetRequest | typeof loadAssetSuccess | typeof loadAssetFailure>;
export {};
