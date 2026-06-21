// Bridge shim for the v4.beta port to `@laikacms/decap`, which consolidates the
// former `decap-cms-*` packages. `decap-cms-core`'s shim is an ambient
// `declare module` rather than a plain module, so `@laikacms/decap/core` cannot
// be path-mapped at it directly (TS2306). Re-export it through a real module so
// `import { ... } from '@laikacms/decap/core'` resolves to the same types.
export * from 'decap-cms-core';
