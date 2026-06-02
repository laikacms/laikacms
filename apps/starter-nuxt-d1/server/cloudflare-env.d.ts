/// <reference types="@cloudflare/workers-types" />

declare module 'h3' {
  interface H3EventContext {
    cloudflare: {
      env: CloudflareEnv,
      context: { waitUntil(promise: Promise<unknown>): void },
    };
  }
}

interface CloudflareEnv {
  DB: D1Database;
}
