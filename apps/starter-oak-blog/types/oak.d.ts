// Ambient stub so tsc --noEmit can resolve @oak/oak (a JSR-only package).
// Deno uses its own import map to load the real types; this stub only
// exists for the pnpm typecheck pass. Keep it minimal — just what main.ts uses.
declare module '@oak/oak' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface NativeRequest extends Request {}

  export interface OakRequest {
    readonly url: URL;
    readonly method: string;
    readonly headers: Headers;
    readonly hasBody: boolean;
    readonly original: NativeRequest;
    readonly body: {
      arrayBuffer(): Promise<ArrayBuffer>,
    };
  }

  export interface OakResponse {
    status: number;
    type: string | undefined;
    body: unknown;
    readonly headers: Headers;
  }

  export interface Context {
    readonly request: OakRequest;
    readonly response: OakResponse;
    readonly params: Record<string, string | undefined>;
  }

  export type Next = () => Promise<unknown>;
  export type Middleware = (ctx: Context, next: Next) => unknown;

  export class Router {
    get(path: string, ...middleware: Middleware[]): this;
    post(path: string, ...middleware: Middleware[]): this;
    put(path: string, ...middleware: Middleware[]): this;
    delete(path: string, ...middleware: Middleware[]): this;
    all(path: string, ...middleware: Middleware[]): this;
    routes(): Middleware;
    allowedMethods(): Middleware;
  }

  export class Application {
    use(...middleware: Middleware[]): this;
    listen(options: { port: number, hostname?: string }): Promise<void>;
  }
}
