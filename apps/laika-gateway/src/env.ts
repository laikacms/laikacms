/**
 * Worker env type. Wrangler regenerates `worker-configuration.d.ts` to extend
 * the global `Env` from .dev.vars / `wrangler secret put` / `[vars]`. We
 * re-export the same name so other modules can `import type { Env }`.
 */
export type Env = globalThis.Env;
