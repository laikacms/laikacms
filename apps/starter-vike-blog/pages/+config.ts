import vikeReact from 'vike-react/config';
import type { Config } from 'vike/types';

/**
 * Global Vike config.
 *
 * Extending `vike-react` adds:
 *   - React-based `+onRenderHtml` and `+onRenderClient` hooks
 *   - `useData()` / `usePageContext()` helpers
 *   - Streaming SSR support
 *
 * Individual pages can override any setting via their own `+config.ts`.
 */
export default {
  extends: vikeReact,
} satisfies Config;
