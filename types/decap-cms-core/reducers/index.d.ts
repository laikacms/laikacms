import integrations from './integrations';
import entries from './entries';
import editorialWorkflow from './editorialWorkflow';
import collections from './collections';
import mediaLibrary from './mediaLibrary';
import type { Status } from '../constants/publishModes';
import type { State, Collection } from '../types/redux';
declare const reducers: {
    auth: any;
    config: any;
    collections: typeof collections;
    search: any;
    integrations: typeof integrations;
    entries: typeof entries;
    cursors: any;
    editorialWorkflow: typeof editorialWorkflow;
    entryDraft: any;
    medias: any;
    mediaLibrary: typeof mediaLibrary;
    deploys: any;
    globalUI: any;
    status: any;
    notifications: any;
};
export default reducers;
export declare function selectEntry(state: State, collection: string, slug: string): import("../types/redux").EntryMap;
export declare function selectEntries(state: State, collection: Collection): any;
export declare function selectPublishedSlugs(state: State, collection: string): List<string>;
export declare function selectSearchedEntries(state: State, availableCollections: string[]): any;
export declare function selectDeployPreview(state: State, collection: string, slug: string): {
    isFetching: boolean;
    url?: string;
    status?: string;
};
export declare function selectUnpublishedEntry(state: State, collection: string, slug: string): import("../types/redux").EntryMap;
export declare function selectUnpublishedEntriesByStatus(state: State, status: Status): import("../types/redux").EntryMap[] & {
    toArray: () => import("../types/redux").EntryMap[];
};
export declare function selectUnpublishedSlugs(state: State, collection: string): string[] & {
    toArray: () => string[];
};
export declare function selectIntegration(state: State, collection: string | null, hook: string): any;
