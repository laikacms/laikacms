import { Map, Set } from 'immutable';
type CursorStoreObject = {
    actions: Set<string>;
    data: Map<string, unknown>;
    meta: Map<string, unknown>;
};
export type CursorStore = {
    get<K extends keyof CursorStoreObject>(key: K, defaultValue?: CursorStoreObject[K]): CursorStoreObject[K];
    getIn<V>(path: string[]): V;
    set<K extends keyof CursorStoreObject, V extends CursorStoreObject[K]>(key: K, value: V): CursorStoreObject[K];
    setIn(path: string[], value: unknown): CursorStore;
    hasIn(path: string[]): boolean;
    mergeIn(path: string[], value: unknown): CursorStore;
    update: (...args: any[]) => CursorStore;
    updateIn: (...args: any[]) => CursorStore;
};
type ActionHandler = (action: string) => unknown;
export default class Cursor {
    store?: CursorStore;
    actions?: Set<string>;
    data?: Map<string, any>;
    meta?: Map<string, any>;
    static create(...args: {}[]): Cursor;
    constructor(...args: {}[]);
    updateStore(...args: any[]): Cursor;
    updateInStore(...args: any[]): Cursor;
    hasAction(action: string): boolean;
    addAction(action: string): Cursor;
    removeAction(action: string): Cursor;
    setActions(actions: Iterable<string>): Cursor;
    mergeActions(actions: Set<string>): Cursor;
    getActionHandlers(handler: ActionHandler): import("immutable").Iterable<string, unknown>;
    setData(data: {}): Cursor;
    mergeData(data: {}): Cursor;
    wrapData(data: {}): Cursor;
    unwrapData(): [Map<string, unknown>, Cursor];
    clearData(): Cursor;
    setMeta(meta: {}): Cursor;
    mergeMeta(meta: {}): Cursor;
}
export declare const CURSOR_COMPATIBILITY_SYMBOL: unique symbol;
export {};
