export default class PkceAuthenticator {
    /**
     *  @typedef {Object} PkceConfig
     *  @prop {boolean} [use_oidc]
     *  @prop {string} base_url
     *  @prop {string} [auth_endpoint]
     *  @prop {string} [auth_token_endpoint]
     *  @prop {string} [auth_token_endpoint_content_type]
     *  @prop {string} app_id
     */
    /**
     * @param {PkceConfig} config
     */
    constructor(config?: {
        use_oidc?: boolean | undefined;
        base_url: string;
        auth_endpoint?: string | undefined;
        auth_token_endpoint?: string | undefined;
        auth_token_endpoint_content_type?: string | undefined;
        app_id: string;
    });
    oidc_url: string | undefined;
    auth_url: string | undefined;
    auth_token_url: string | undefined;
    auth_token_endpoint_content_type: string | undefined;
    appID: string;
    _loadOidcConfig(): Promise<void>;
    authenticate(options: any, cb: any): Promise<any>;
    /**
     * Complete authentication if we were redirected back to from the provider.
     */
    completeAuth(cb: any): Promise<any>;
}
