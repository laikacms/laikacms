type CursorStoreData = {
    actions: Set<string>;
    data: Record<string, unknown>;
    meta: Record<string, unknown>;
};
type ActionHandler = (action: string) => unknown;
export default class Cursor {
    store: CursorStoreData;
    get actions(): Set<string>;
    get data(): Record<string, unknown>;
    get meta(): Record<string, unknown>;
    static create(...args: any[]): Cursor;
    constructor(...args: any[]);
    hasAction(action: string): boolean;
    addAction(action: string): Cursor;
    removeAction(action: string): Cursor;
    setActions(actions: Iterable<string>): Cursor;
    mergeActions(actions: Set<string>): Cursor;
    getActionHandlers(handler: ActionHandler): Record<string, unknown>;
    setData(data: Record<string, unknown>): Cursor;
    mergeData(data: Record<string, unknown>): Cursor;
    wrapData(data: Record<string, unknown>): Cursor;
    unwrapData(): [Record<string, unknown>, Cursor];
    clearData(): Cursor;
    setMeta(meta: Record<string, unknown>): Cursor;
    mergeMeta(meta: Record<string, unknown>): Cursor;
}
export declare const CURSOR_COMPATIBILITY_SYMBOL: unique symbol;
export {};
