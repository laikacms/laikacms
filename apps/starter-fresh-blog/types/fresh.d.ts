// Ambient stub so tsc --noEmit can resolve the "fresh" import (jsr:@fresh/core).
// Deno uses its own import map to load real types; this stub only exists for
// the pnpm typecheck pass. Keep it minimal — just what routes and main.ts use.
declare module 'fresh' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyState = Record<string, any>;

  export interface FreshContext<S extends AnyState = AnyState> {
    readonly req: Request;
    readonly params: Record<string, string | undefined>;
    readonly state: S;
    render(data?: unknown): Response | Promise<Response>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type HandlerReturn = Response | { data: any };
  export type HandlerFn<S extends AnyState = AnyState> = (
    ctx: FreshContext<S>,
  ) => HandlerReturn | Promise<HandlerReturn>;

  export interface RouteHandlers<S extends AnyState = AnyState> {
    GET?: HandlerFn<S>;
    POST?: HandlerFn<S>;
    PUT?: HandlerFn<S>;
    DELETE?: HandlerFn<S>;
    PATCH?: HandlerFn<S>;
    HEAD?: HandlerFn<S>;
    OPTIONS?: HandlerFn<S>;
  }

  export interface PageProps<T = unknown> {
    readonly data: T;
    readonly params: Record<string, string | undefined>;
  }

  export interface DefineHelper<S extends AnyState = AnyState> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handlers<T = unknown>(
      handlers:
        | RouteHandlers<S>
        | HandlerFn<S>,
    ): ReturnType<typeof handlers>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    page<H>(component: (props: PageProps<any>) => unknown): unknown;
    layout(component: (props: unknown) => unknown): unknown;
  }

  export function createDefine<S extends AnyState = AnyState>(): DefineHelper<S>;

  export class App<S extends AnyState = AnyState> {
    use(middleware: unknown): this;
    get(path: string, handler: HandlerFn<S>): this;
    post(path: string, handler: HandlerFn<S>): this;
    all(path: string, handler: HandlerFn<S>): this;
    fsRoutes(dir?: string): this;
    listen(options?: { port?: number, hostname?: string }): Promise<void>;
    fetch(req: Request, info?: unknown): Promise<Response>;
  }

  export function staticFiles(): unknown;
  export function trailingSlashes(mode: 'always' | 'never'): unknown;
}
