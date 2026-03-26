export type Deploys = {
    [key: string]: {
        isFetching: boolean;
        url?: string;
        status?: string;
    };
};
declare const deploys: any;
export declare function selectDeployPreview(state: Deploys, collection: string, slug: string): {
    isFetching: boolean;
    url?: string;
    status?: string;
};
export default deploys;
