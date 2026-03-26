import { Map } from 'immutable';
import type { State, MediaFile, MediaLibraryInstance, EntryField } from '../types/redux';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import type { ImplementationMediaFile } from 'decap-cms-lib-util';
export declare const MEDIA_LIBRARY_OPEN = "MEDIA_LIBRARY_OPEN";
export declare const MEDIA_LIBRARY_CLOSE = "MEDIA_LIBRARY_CLOSE";
export declare const MEDIA_LIBRARY_CREATE = "MEDIA_LIBRARY_CREATE";
export declare const MEDIA_INSERT = "MEDIA_INSERT";
export declare const MEDIA_REMOVE_INSERTED = "MEDIA_REMOVE_INSERTED";
export declare const MEDIA_LOAD_REQUEST = "MEDIA_LOAD_REQUEST";
export declare const MEDIA_LOAD_SUCCESS = "MEDIA_LOAD_SUCCESS";
export declare const MEDIA_LOAD_FAILURE = "MEDIA_LOAD_FAILURE";
export declare const MEDIA_PERSIST_REQUEST = "MEDIA_PERSIST_REQUEST";
export declare const MEDIA_PERSIST_SUCCESS = "MEDIA_PERSIST_SUCCESS";
export declare const MEDIA_PERSIST_FAILURE = "MEDIA_PERSIST_FAILURE";
export declare const MEDIA_DELETE_REQUEST = "MEDIA_DELETE_REQUEST";
export declare const MEDIA_DELETE_SUCCESS = "MEDIA_DELETE_SUCCESS";
export declare const MEDIA_DELETE_FAILURE = "MEDIA_DELETE_FAILURE";
export declare const MEDIA_DISPLAY_URL_REQUEST = "MEDIA_DISPLAY_URL_REQUEST";
export declare const MEDIA_DISPLAY_URL_SUCCESS = "MEDIA_DISPLAY_URL_SUCCESS";
export declare const MEDIA_DISPLAY_URL_FAILURE = "MEDIA_DISPLAY_URL_FAILURE";
export declare function createMediaLibrary(instance: MediaLibraryInstance): {
    readonly type: "MEDIA_LIBRARY_CREATE";
    readonly payload: {
        show: (args: {
            id?: string;
            value?: string;
            config: import("../types/immutable").StaticallyTypedRecord<{}>;
            allowMultiple?: boolean;
            imagesOnly?: boolean;
        }) => void;
        hide: () => void;
        onClearControl: (args: {
            id: string;
        }) => void;
        onRemoveControl: (args: {
            id: string;
        }) => void;
        enableStandalone: () => any;
    };
};
export declare function clearMediaControl(id: string): (_dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => void;
export declare function removeMediaControl(id: string): (_dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => void;
export declare function openMediaLibrary(payload?: {
    controlID?: string;
    forImage?: boolean;
    privateUpload?: boolean;
    value?: string;
    allowMultiple?: boolean;
    config?: Map<string, unknown>;
    field?: EntryField;
}): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => void;
export declare function closeMediaLibrary(): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => void;
export declare function insertMedia(mediaPath: string | string[], field: EntryField | undefined): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => void;
export declare function removeInsertedMedia(controlID: string): {
    readonly type: "MEDIA_REMOVE_INSERTED";
    readonly payload: {
        readonly controlID: string;
    };
};
export declare function loadMedia(opts?: {
    delay?: number;
    query?: string;
    page?: number;
    privateUpload?: boolean;
}): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function persistMedia(file: File, opts?: MediaOptions): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function deleteMedia(file: MediaFile, opts?: MediaOptions): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function getMediaFile(state: State, path: string): Promise<{
    url: any;
}>;
export declare function loadMediaDisplayURL(file: MediaFile): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
declare function mediaLibraryOpened(payload: {
    controlID?: string;
    forImage?: boolean;
    privateUpload?: boolean;
    value?: string;
    replaceIndex?: number;
    allowMultiple?: boolean;
    config?: Map<string, unknown>;
    field?: EntryField;
}): {
    readonly type: "MEDIA_LIBRARY_OPEN";
    readonly payload: {
        controlID?: string;
        forImage?: boolean;
        privateUpload?: boolean;
        value?: string;
        replaceIndex?: number;
        allowMultiple?: boolean;
        config?: Map<string, unknown>;
        field?: EntryField;
    };
};
declare function mediaLibraryClosed(): {
    readonly type: "MEDIA_LIBRARY_CLOSE";
};
declare function mediaInserted(mediaPath: string | string[]): {
    readonly type: "MEDIA_INSERT";
    readonly payload: {
        readonly mediaPath: string | string[];
    };
};
export declare function mediaLoading(page: number): {
    readonly type: "MEDIA_LOAD_REQUEST";
    readonly payload: {
        readonly page: number;
    };
};
interface MediaOptions {
    privateUpload?: boolean;
    field?: EntryField;
    page?: number;
    canPaginate?: boolean;
    dynamicSearch?: boolean;
    dynamicSearchQuery?: string;
}
export declare function mediaLoaded(files: ImplementationMediaFile[], opts?: MediaOptions): {
    readonly type: "MEDIA_LOAD_SUCCESS";
    readonly payload: {
        readonly privateUpload?: boolean;
        readonly field?: EntryField;
        readonly page?: number;
        readonly canPaginate?: boolean;
        readonly dynamicSearch?: boolean;
        readonly dynamicSearchQuery?: string;
        readonly files: ImplementationMediaFile[];
    };
};
export declare function mediaLoadFailed(opts?: MediaOptions): {
    readonly type: "MEDIA_LOAD_FAILURE";
    readonly payload: {
        readonly privateUpload: boolean;
    };
};
export declare function mediaPersisting(): {
    readonly type: "MEDIA_PERSIST_REQUEST";
};
export declare function mediaPersisted(file: ImplementationMediaFile, opts?: MediaOptions): {
    readonly type: "MEDIA_PERSIST_SUCCESS";
    readonly payload: {
        readonly file: ImplementationMediaFile;
        readonly privateUpload: boolean;
    };
};
export declare function mediaPersistFailed(opts?: MediaOptions): {
    readonly type: "MEDIA_PERSIST_FAILURE";
    readonly payload: {
        readonly privateUpload: boolean;
    };
};
export declare function mediaDeleting(): {
    readonly type: "MEDIA_DELETE_REQUEST";
};
export declare function mediaDeleted(file: MediaFile, opts?: MediaOptions): {
    readonly type: "MEDIA_DELETE_SUCCESS";
    readonly payload: {
        readonly file: MediaFile;
        readonly privateUpload: boolean;
    };
};
export declare function mediaDeleteFailed(opts?: MediaOptions): {
    readonly type: "MEDIA_DELETE_FAILURE";
    readonly payload: {
        readonly privateUpload: boolean;
    };
};
export declare function mediaDisplayURLRequest(key: string): {
    readonly type: "MEDIA_DISPLAY_URL_REQUEST";
    readonly payload: {
        readonly key: string;
    };
};
export declare function mediaDisplayURLSuccess(key: string, url: string): {
    readonly type: "MEDIA_DISPLAY_URL_SUCCESS";
    readonly payload: {
        readonly key: string;
        readonly url: string;
    };
};
export declare function mediaDisplayURLFailure(key: string, err: Error): {
    readonly type: "MEDIA_DISPLAY_URL_FAILURE";
    readonly payload: {
        readonly key: string;
        readonly err: Error;
    };
};
export declare function waitForMediaLibraryToLoad(dispatch: ThunkDispatch<State, {}, AnyAction>, state: State): Promise<void>;
export declare function getMediaDisplayURL(dispatch: ThunkDispatch<State, {}, AnyAction>, state: State, file: MediaFile): Promise<string>;
export type MediaLibraryAction = ReturnType<typeof createMediaLibrary | typeof mediaLibraryOpened | typeof mediaLibraryClosed | typeof mediaInserted | typeof removeInsertedMedia | typeof mediaLoading | typeof mediaLoaded | typeof mediaLoadFailed | typeof mediaPersisting | typeof mediaPersisted | typeof mediaPersistFailed | typeof mediaDeleting | typeof mediaDeleted | typeof mediaDeleteFailed | typeof mediaDisplayURLRequest | typeof mediaDisplayURLSuccess | typeof mediaDisplayURLFailure>;
export {};
