/**
 * `@laikacms/decap` ships TypeScript declarations from its built `dist/`,
 * but those are only present after the v4.beta source has been built by
 * the `postinstall` build step. Until that runs, the subpath exports may
 * not resolve to typed `.d.ts` files. Declare them as opaque so the
 * named/default imports we consume compile either way.
 */
declare module '@laikacms/decap/core';
declare module '@laikacms/decap/backend-github';
declare module '@laikacms/decap/widget-string';
declare module '@laikacms/decap/widget-datetime';
declare module '@laikacms/decap/locales';
