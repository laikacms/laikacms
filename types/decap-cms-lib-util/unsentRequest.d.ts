declare namespace _default {
    export { toURL };
    export { fromURL };
    export { fromFetchArguments };
    export { performRequest };
    export { withMethod };
    export { withBody };
    export { withHeaders };
    export { withParams };
    export { withRoot };
    export { withNoCache };
    export { fetchWithTimeout };
}
export default _default;
declare function toURL(req: any): string;
declare function fromURL(wholeURL: any): Map<string, any>;
declare function fromFetchArguments(wholeURL: any, options: any): Map<string, any>;
declare function performRequest(req: any): any;
declare const withMethod: any;
declare const withBody: any;
declare const withHeaders: any;
declare const withParams: any;
declare const withRoot: any;
declare const withNoCache: any;
declare function fetchWithTimeout(input: any, init: any): Promise<Response>;
import { Map } from "immutable";
