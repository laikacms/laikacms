/**
 * Minimal Deno global type stubs for tsc --noEmit in non-Deno environments.
 * The full Deno type library is used automatically when you run `deno check`.
 */
declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }

  const env: Env;

  interface ServeOptions {
    port?: number;
    hostname?: string;
    onError?: (err: unknown) => Response | Promise<Response>;
  }

  interface HttpServer {
    readonly port: number;
  }

  function serve(
    options: ServeOptions,
    handler: (request: Request) => Response | Promise<Response>,
  ): HttpServer;
}
