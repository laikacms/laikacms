export type Status = {
    isFetching: boolean;
    status: {
        auth: {
            status: boolean;
        };
        api: {
            status: boolean;
            statusPage: string;
        };
    };
    error: Error | undefined;
};
declare const status: any;
export default status;
