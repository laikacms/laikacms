import type { EntryValue } from '../valueObjects/Entry';
export type Search = {
    isFetching: boolean;
    term: string;
    collections: string[];
    page: number;
    entryIds: {
        collection: string;
        slug: string;
    }[];
    queryHits: Record<string, EntryValue[]>;
    error: Error | undefined;
    requests: QueryRequest[];
};
type QueryResponse = {
    hits: EntryValue[];
    query: string;
};
export type QueryRequest = {
    id: string;
    expires: Date;
    queryResponse: Promise<QueryResponse>;
};
declare const search: any;
export default search;
