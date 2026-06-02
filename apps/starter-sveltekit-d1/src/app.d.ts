declare global {
  namespace App {
    /**
     * Cloudflare Pages bindings available via event.platform.env.
     * These are injected by the Cloudflare runtime — NOT in process.env.
     */
    interface Platform {
      env: {
        DB: D1Database,
      };
      context: {
        waitUntil(promise: Promise<unknown>): void,
      };
    }
  }
}

export {};
