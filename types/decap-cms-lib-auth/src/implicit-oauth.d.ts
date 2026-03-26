export default class ImplicitAuthenticator {
    constructor(config?: {});
    auth_url: string;
    appID: any;
    clearHash: any;
    authenticate(options: any, cb: any): any;
    /**
     * Complete authentication if we were redirected back to from the provider.
     */
    completeAuth(cb: any): any;
}
