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

/**
 * Workspace packages `decap-cms-widget-lexicaleditor` and
 * `decap-cms-widget-portabletext-editor` export their types from
 * `dist/index.d.ts`, which is only present after a workspace build.
 * When running `tsc --noEmit` directly (typecheck without a prior
 * `turbo build`), the dist may be absent. Declare them opaque here
 * so standalone typechecks pass; the turbo pipeline builds them first
 * for production and full workspace typechecks.
 */
declare module 'decap-cms-widget-lexicaleditor' {
  export const Widget: () => unknown;
}
declare module 'decap-cms-widget-portabletext-editor' {
  export const Widget: () => unknown;
}
