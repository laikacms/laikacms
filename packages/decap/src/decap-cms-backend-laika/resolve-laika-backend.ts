/**
 * `resolveLaikaBackend({ local, remote })` — select the Decap `backend:`
 * config on whether the admin is running inside a Vite dev build, so a
 * single admin config targets the local JSON:API `@laikacms/vite-plugin`
 * mounts under `localApi` (LCMS-449 slice 1, issue #847) while iterating,
 * and the remote OAuth backend `createLaikaBackend` drives everywhere else —
 * with no manual switching (LCMS-449 slice 2, issue #848).
 *
 * `createLaikaBackend` and `DevAuthenticationPage` remain public (re-exported
 * from `./index.js`) so a caller can hand-wire a custom local/remote
 * arrangement instead of using this helper.
 */

/**
 * The subset of the Decap `backend:` config block this module reads or
 * builds. Decap's own `CmsBackend['name']` type is a closed union that
 * doesn't include `'laika'` — integrators already widen it (see
 * `laika-backend.ts` and its tests) — so this interface mirrors that reality
 * instead of fighting it.
 */
export interface LaikaBackendModuleConfig {
  name: 'laika';
  base_url: string;
  api_root?: string;
  app_id?: string;
  auth_endpoint?: string;
  auth_token_endpoint?: string;
  auth_token_endpoint_content_type?: string;
  use_oidc?: boolean;
  /** Pre-shared token that skips the PKCE OAuth dance — see `LaikaBackend.devToken`. */
  dev_token?: string;
  acceptRoles?: string[];
  [key: string]: unknown;
}

/**
 * Base path the local JSON:API mounts under. Must match the
 * `localApi.basePath` configured on `@laikacms/vite-plugin` (or its default);
 * duplicated here rather than imported so `@laikacms/decap` keeps no runtime
 * dependency on `@laikacms/vite-plugin`.
 */
export const DEFAULT_LOCAL_BACKEND_BASE_PATH = '/__laika';

/** Dummy token `DevAuthenticationPage` submits when no `devToken` override is given. */
export const DEFAULT_LOCAL_BACKEND_DEV_TOKEN = 'laika-local-dev';

export interface LocalLaikaBackendOptions {
  /**
   * Base path the local JSON:API is mounted at. Defaults to
   * {@link DEFAULT_LOCAL_BACKEND_BASE_PATH}, matching Slice 1's default.
   */
  basePath?: string;
  /**
   * Dummy token `DevAuthenticationPage` submits. Local mode performs no real
   * auth, so this only needs to be non-empty and stable across reloads.
   * Defaults to {@link DEFAULT_LOCAL_BACKEND_DEV_TOKEN}.
   */
  devToken?: string;
}

export interface ResolveLaikaBackendOptions {
  /**
   * Local-mode overrides, applied when the dev flag is truthy. Optional —
   * omit to use the {@link DEFAULT_LOCAL_BACKEND_BASE_PATH} /
   * {@link DEFAULT_LOCAL_BACKEND_DEV_TOKEN} defaults.
   */
  local?: LocalLaikaBackendOptions;
  /**
   * The remote backend config — the `backend:` block built for the OAuth flow
   * `createLaikaBackend` drives. Returned as-is whenever the dev flag isn't
   * truthy.
   */
  remote: LaikaBackendModuleConfig;
  /**
   * Override for `import.meta.env.DEV`. Real call sites can omit this — it's
   * read directly — so tests are the only ones expected to pass it, to
   * exercise both branches deterministically without a bundler. Anything
   * falsy (including when `import.meta.env` itself isn't defined, e.g.
   * outside a Vite build) fails safe to `remote`.
   */
  dev?: boolean;
}

/** Read `import.meta.env.DEV` defensively: `false` when Vite hasn't substituted it. */
function readViteDevFlag(): boolean {
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  return Boolean(meta.env?.DEV);
}

/**
 * Select the Decap `backend:` config for the current build: the local
 * JSON:API (Slice 1) while `vite dev` is running, the remote OAuth backend
 * everywhere else.
 *
 * Fails safe to `remote` whenever the dev flag isn't truthy — an admin
 * loaded outside a Vite-bundled dev context (a production build, a
 * standalone admin, `vite preview`) never targets a phantom local endpoint.
 * Local mode only engages when the admin config itself is built by Vite, so
 * `import.meta.env.DEV` is reliably substituted; document that requirement
 * for consumers of this helper.
 */
export function resolveLaikaBackend(options: ResolveLaikaBackendOptions): LaikaBackendModuleConfig {
  const dev = options.dev ?? readViteDevFlag();
  if (!dev) return options.remote;

  const { basePath = DEFAULT_LOCAL_BACKEND_BASE_PATH, devToken = DEFAULT_LOCAL_BACKEND_DEV_TOKEN } = options.local
    ?? {};

  return {
    name: 'laika',
    base_url: basePath,
    api_root: '',
    dev_token: devToken,
  };
}
