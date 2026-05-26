/**
 * The v4.beta Decap packages ship typed builds in their published tarballs,
 * but the local checkout we link against via pnpm overrides only ships JS
 * for some sub-packages. Declare them as opaque so the side-effect imports
 * and the named imports we actually consume compile either way.
 *
 * `decap-cms-core` exposes the typed surface we need (`DecapCmsProvider`,
 * `App`, `DecapCmsCore`) so it gets a richer typed declaration upstream;
 * the modules below we only use for their default export or registration
 * objects, so the loose declarations are enough.
 */
declare module 'decap-cms-core';
declare module 'decap-cms-backend-github';
declare module 'decap-cms-widget-string';
declare module 'decap-cms-widget-datetime';
declare module 'decap-cms-locales';
