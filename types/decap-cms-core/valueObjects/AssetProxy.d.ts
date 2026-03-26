import type { EntryField } from '../types/redux';
interface AssetProxyArgs {
    path: string;
    url?: string;
    file?: File;
    field?: EntryField;
}
export default class AssetProxy {
    url: string;
    fileObj?: File;
    path: string;
    field?: EntryField;
    constructor({ url, file, path, field }: AssetProxyArgs);
    toString(): string;
    toBase64(): Promise<string>;
}
export declare function createAssetProxy({ url, file, path, field }: AssetProxyArgs): AssetProxy;
export {};
