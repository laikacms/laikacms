import type { User } from 'decap-cms-lib-util';
export type Auth = {
    isFetching: boolean;
    user: User | undefined;
    error: string | undefined;
};
export declare const defaultState: Auth;
declare const auth: any;
export default auth;
