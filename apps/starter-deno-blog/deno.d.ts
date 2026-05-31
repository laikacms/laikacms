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

  function serve(
    options: ServeOptions,
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

interface ImportMeta {
  /** Absolute path of the directory containing the current module file.
   *  Available in Deno 1.28+ and Node 21.2+. */
  dirname?: string;
}
