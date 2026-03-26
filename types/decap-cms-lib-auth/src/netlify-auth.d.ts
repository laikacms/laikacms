export default Authenticator;
declare class Authenticator {
    constructor(config?: {});
    site_id: any;
    base_url: string;
    auth_endpoint: string;
    handshakeCallback(options: any, cb: any): (e: any) => void;
    authorizeCallback(options: any, cb: any): (e: any) => void;
    getSiteID(): any;
    authenticate(options: any, cb: any): any;
    authWindow: Window | null | undefined;
    refresh(options: any, cb: any): any;
}
