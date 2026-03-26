import type AssetProxy from '../valueObjects/AssetProxy';
export type Medias = {
    [path: string]: {
        asset: AssetProxy | undefined;
        isLoading: boolean;
        error: Error | null;
    };
};
declare const medias: any;
export declare function selectIsLoadingAsset(state: Medias): any;
export default medias;
