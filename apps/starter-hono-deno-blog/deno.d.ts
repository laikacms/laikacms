/**
 * Minimal Deno global type stubs for tsc --noEmit in non-Deno environments.
 * The full Deno type library is used automatically when you run `deno check`.
 */
declare namespace Deno {
  interface ServeOptions {
    port?: number;
    hostname?: string;
    onError?: (err: unknown) => Response | Promise<Response>;
  }

  interface ServeInit {
    port?: number;
    hostname?: string;
    handler: (request: Request) => Response | Promise<Response>;
    onError?: (err: unknown) => Response | Promise<Response>;
  }

  const env: { get(key: string): string | undefined };

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
  function serve(
    options: ServeInit | ServeOptions,
    handler?: (request: Request) => Response | Promise<Response>,
  ): void;
}

interface ImportMeta {
  dirname?: string;
}
