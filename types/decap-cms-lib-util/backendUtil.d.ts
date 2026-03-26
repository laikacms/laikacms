export declare function filterByExtension(file: {
    path: string;
}, extension: string): boolean;
export declare function parseResponse(res: Response, { expectingOk, format, apiName }: {
    expectingOk?: boolean | undefined;
    format?: string | undefined;
    apiName?: string | undefined;
}): Promise<any>;
export declare function responseParser(options: {
    expectingOk?: boolean;
    format: string;
    apiName: string;
}): (res: Response) => Promise<any>;
export declare function parseLinkHeader(header: string | null): any;
export declare function getAllResponses(url: string, options: {
    headers?: {} | undefined;
} | undefined, linkHeaderRelName: string, nextUrlProcessor: (url: string) => string): Promise<any[]>;
export declare function getPathDepth(path: string): number;
