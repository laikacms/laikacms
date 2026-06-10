/// <reference types="./node_modules/@types/node/index.d.ts" />

// Minimal Deno global stubs for tsc --noEmit.
// The real Deno types ship with the Deno CLI and are only available during
// `deno check`. This stub satisfies tsc without pulling in the full @types/deno.
declare namespace Deno {
  const env: {
    get(key: string): string | undefined,
    set(key: string, value: string): void,
    toObject(): Record<string, string>,
  };
}
