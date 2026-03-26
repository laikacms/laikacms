import type { EditorialWorkflowAction, EditorialWorkflow } from '../types/redux';
declare function unpublishedEntries(state: any, action: EditorialWorkflowAction): any;
export declare function selectUnpublishedEntry(state: EditorialWorkflow, collection: string, slug: string): import("../types/redux").EntryMap;
export declare function selectUnpublishedEntriesByStatus(state: EditorialWorkflow, status: string): import("../types/redux").EntryMap[] & {
    toArray: () => import("../types/redux").EntryMap[];
};
export declare function selectUnpublishedSlugs(state: EditorialWorkflow, collection: string): string[] & {
    toArray: () => string[];
};
export default unpublishedEntries;
