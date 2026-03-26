import { Cursor } from 'decap-cms-lib-util';
import { SortDirection } from '../types/redux';
import type { ImplementationMediaFile } from 'decap-cms-lib-util';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import type { Collection, EntryMap, State, EntryFields, EntryField, ViewFilter, ViewGroup, Entry } from '../types/redux';
import type { EntryValue } from '../valueObjects/Entry';
export declare const ENTRY_REQUEST = "ENTRY_REQUEST";
export declare const ENTRY_SUCCESS = "ENTRY_SUCCESS";
export declare const ENTRY_FAILURE = "ENTRY_FAILURE";
export declare const ENTRIES_REQUEST = "ENTRIES_REQUEST";
export declare const ENTRIES_SUCCESS = "ENTRIES_SUCCESS";
export declare const ENTRIES_FAILURE = "ENTRIES_FAILURE";
export declare const SORT_ENTRIES_REQUEST = "SORT_ENTRIES_REQUEST";
export declare const SORT_ENTRIES_SUCCESS = "SORT_ENTRIES_SUCCESS";
export declare const SORT_ENTRIES_FAILURE = "SORT_ENTRIES_FAILURE";
export declare const FILTER_ENTRIES_REQUEST = "FILTER_ENTRIES_REQUEST";
export declare const FILTER_ENTRIES_SUCCESS = "FILTER_ENTRIES_SUCCESS";
export declare const FILTER_ENTRIES_FAILURE = "FILTER_ENTRIES_FAILURE";
export declare const GROUP_ENTRIES_REQUEST = "GROUP_ENTRIES_REQUEST";
export declare const GROUP_ENTRIES_SUCCESS = "GROUP_ENTRIES_SUCCESS";
export declare const GROUP_ENTRIES_FAILURE = "GROUP_ENTRIES_FAILURE";
export declare const DRAFT_CREATE_FROM_ENTRY = "DRAFT_CREATE_FROM_ENTRY";
export declare const DRAFT_CREATE_EMPTY = "DRAFT_CREATE_EMPTY";
export declare const DRAFT_DISCARD = "DRAFT_DISCARD";
export declare const DRAFT_CHANGE_FIELD = "DRAFT_CHANGE_FIELD";
export declare const DRAFT_VALIDATION_ERRORS = "DRAFT_VALIDATION_ERRORS";
export declare const DRAFT_CLEAR_ERRORS = "DRAFT_CLEAR_ERRORS";
export declare const DRAFT_LOCAL_BACKUP_RETRIEVED = "DRAFT_LOCAL_BACKUP_RETRIEVED";
export declare const DRAFT_CREATE_FROM_LOCAL_BACKUP = "DRAFT_CREATE_FROM_LOCAL_BACKUP";
export declare const DRAFT_CREATE_DUPLICATE_FROM_ENTRY = "DRAFT_CREATE_DUPLICATE_FROM_ENTRY";
export declare const ENTRY_PERSIST_REQUEST = "ENTRY_PERSIST_REQUEST";
export declare const ENTRY_PERSIST_SUCCESS = "ENTRY_PERSIST_SUCCESS";
export declare const ENTRY_PERSIST_FAILURE = "ENTRY_PERSIST_FAILURE";
export declare const ENTRY_DELETE_REQUEST = "ENTRY_DELETE_REQUEST";
export declare const ENTRY_DELETE_SUCCESS = "ENTRY_DELETE_SUCCESS";
export declare const ENTRY_DELETE_FAILURE = "ENTRY_DELETE_FAILURE";
export declare const ADD_DRAFT_ENTRY_MEDIA_FILE = "ADD_DRAFT_ENTRY_MEDIA_FILE";
export declare const REMOVE_DRAFT_ENTRY_MEDIA_FILE = "REMOVE_DRAFT_ENTRY_MEDIA_FILE";
export declare const CHANGE_VIEW_STYLE = "CHANGE_VIEW_STYLE";
export declare function entryLoading(collection: Collection, slug: string): {
    type: string;
    payload: {
        collection: string;
        slug: string;
    };
};
export declare function entryLoaded(collection: Collection, entry: EntryValue): {
    type: string;
    payload: {
        collection: string;
        entry: EntryValue;
    };
};
export declare function entryLoadError(error: Error, collection: Collection, slug: string): {
    type: string;
    payload: {
        error: Error;
        collection: string;
        slug: string;
    };
};
export declare function entriesLoading(collection: Collection): {
    type: string;
    payload: {
        collection: string;
    };
};
export declare function entriesLoaded(collection: Collection, entries: EntryValue[], pagination: number | null, cursor: Cursor, append?: boolean): {
    type: string;
    payload: {
        collection: string;
        entries: EntryValue[];
        page: number;
        cursor: any;
        append: boolean;
    };
};
export declare function entriesFailed(collection: Collection, error: Error): {
    type: string;
    error: string;
    payload: string;
    meta: {
        collection: string;
    };
};
export declare function getAllEntries(state: State, collection: Collection): Promise<any>;
export declare function sortByField(collection: Collection, key: string, direction?: SortDirection): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
export declare function filterByField(collection: Collection, filter: ViewFilter): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
export declare function groupByField(collection: Collection, group: ViewGroup): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
export declare function changeViewStyle(viewStyle: string): {
    type: string;
    payload: {
        style: string;
    };
};
export declare function entryPersisting(collection: Collection, entry: EntryMap): {
    type: string;
    payload: {
        collectionName: string;
        entrySlug: string;
    };
};
export declare function entryPersisted(collection: Collection, entry: EntryMap, slug: string): {
    type: string;
    payload: {
        collectionName: string;
        entrySlug: string;
        /**
         * Pass slug from backend for newly created entries.
         */
        slug: string;
    };
};
export declare function entryPersistFail(collection: Collection, entry: EntryMap, error: Error): {
    type: string;
    error: string;
    payload: {
        collectionName: string;
        entrySlug: string;
        error: string;
    };
};
export declare function entryDeleting(collection: Collection, slug: string): {
    type: string;
    payload: {
        collectionName: string;
        entrySlug: string;
    };
};
export declare function entryDeleted(collection: Collection, slug: string): {
    type: string;
    payload: {
        collectionName: string;
        entrySlug: string;
    };
};
export declare function entryDeleteFail(collection: Collection, slug: string, error: Error): {
    type: string;
    payload: {
        collectionName: string;
        entrySlug: string;
        error: string;
    };
};
export declare function emptyDraftCreated(entry: EntryValue): {
    type: string;
    payload: EntryValue;
};
export declare function createDraftFromEntry(entry: EntryValue): {
    type: string;
    payload: {
        entry: EntryValue;
    };
};
export declare function draftDuplicateEntry(entry: EntryMap): {
    type: string;
    payload: EntryValue;
};
export declare function discardDraft(): {
    type: string;
};
export declare function changeDraftField({ field, value, metadata, entries, i18n, }: {
    field: EntryField;
    value: string;
    metadata: Record<string, unknown>;
    entries: EntryMap[];
    i18n?: {
        currentLocale: string;
        defaultLocale: string;
        locales: string[];
    };
}): {
    type: string;
    payload: {
        field: EntryField;
        value: string;
        metadata: Record<string, unknown>;
        entries: EntryMap[];
        i18n: {
            currentLocale: string;
            defaultLocale: string;
            locales: string[];
        };
    };
};
export declare function changeDraftFieldValidation(uniquefieldId: string, errors: {
    type: string;
    parentIds: string[];
    message: string;
}[]): {
    type: string;
    payload: {
        uniquefieldId: string;
        errors: {
            type: string;
            parentIds: string[];
            message: string;
        }[];
    };
};
export declare function clearFieldErrors(uniqueFieldId: string): {
    type: string;
    payload: {
        uniqueFieldId: string;
    };
};
export declare function localBackupRetrieved(entry: EntryValue): {
    type: string;
    payload: {
        entry: EntryValue;
    };
};
export declare function loadLocalBackup(): {
    type: string;
};
export declare function addDraftEntryMediaFile(file: ImplementationMediaFile): {
    type: string;
    payload: ImplementationMediaFile;
};
export declare function removeDraftEntryMediaFile({ id }: {
    id: string;
}): {
    type: string;
    payload: {
        id: string;
    };
};
export declare function persistLocalBackup(entry: EntryMap, collection: Collection): (_dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function createDraftDuplicateFromEntry(entry: EntryMap): (dispatch: ThunkDispatch<State, {}, AnyAction>) => void;
export declare function retrieveLocalBackup(collection: Collection, slug: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function deleteLocalBackup(collection: Collection, slug: string): (_dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function loadEntry(collection: Collection, slug: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
export declare function tryLoadEntry(state: State, collection: Collection, slug: string): Promise<EntryValue>;
export declare function loadEntries(collection: Collection, page?: number): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function traverseCollectionCursor(collection: Collection, action: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function createEmptyDraft(collection: Collection, search: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<void>;
export declare function createEmptyDraftData(fields: EntryFields, skipField?: (field: EntryField) => boolean): any;
export declare function getMediaAssets({ entry }: {
    entry: EntryMap;
}): any;
export declare function getSerializedEntry(collection: Collection, entry: Entry): import("../types/immutable").StaticallyTypedRecord<import("../types/redux").EntryObject> & import("../types/redux").EntryObject;
export declare function persistEntry(collection: Collection): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function deleteEntry(collection: Collection, slug: string): (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => Promise<any>;
export declare function validateMetaField(state: State, collection: Collection, field: EntryField, value: string | undefined, t: (key: string, args: Record<string, unknown>) => string): {
    error: {
        type: any;
        message: string;
    };
} | {
    error: boolean;
};
