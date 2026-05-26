/**
 * Self-bootstrapped Decap CMS root.
 *
 * We intentionally do *not* depend on `decap-cms-app` — the upstream "all
 * batteries" bundle that auto-init's and registers every backend/widget/
 * editor-component on import. Instead we pull `decap-cms-core` directly
 * and compose the React tree ourselves:
 *
 *   <DecapCmsProvider config={...}>
 *     <App />          // the default full-screen CMS layout
 *   </DecapCmsProvider>
 *
 * This keeps the bundle to just what we actually use:
 *   - `decap-cms-backend-github` for OAuth-backed GitHub commits
 *   - `decap-cms-widget-string` / `-datetime` for the `pages` / `posts`
 *     collection's `title` and `date` fields
 *   - our two custom rich-text widgets (Lexical + @portabletext/editor)
 *   - the locales bundle
 *
 * If a future collection needs another stock widget (file, image, list,
 * relation, …) add the corresponding `decap-cms-widget-*` import and one
 * more `CMS.registerWidget(...)` call.
 */
// `App` and `DecapCmsProvider` are named exports of `decap-cms-core` in
// the v4.beta source we link against via `pnpm-local-override.json`. The
// published 3.x `.d.ts` doesn't declare them, so we type-suppress the
// import shape and reassert it via `unknown` casts where needed.

// @ts-expect-error -- v4.beta named exports not in published 3.x types
import { GitHubBackend } from 'decap-cms-backend-github';
import DecapCmsCore, { App as DecapApp, DecapCmsProvider } from 'decap-cms-core';
import * as locales from 'decap-cms-locales';
import DecapCmsWidgetDatetime from 'decap-cms-widget-datetime';
import { Widget as LexicalWidget } from 'decap-cms-widget-lexicaleditor';
import { Widget as PortabletextEditorWidget } from 'decap-cms-widget-portabletext-editor';
import DecapCmsWidgetString from 'decap-cms-widget-string';
import type { ReactNode } from 'react';

import { cmsConfig } from './config';

// One-shot registration. Module-level so `import('./DecapApp')` always
// hands the CMS singleton a fully-populated registry before render.
let registered = false;
function registerOnce(): void {
  if (registered) return;
  registered = true;

  const CMS = DecapCmsCore as unknown as {
    registerBackend: (name: string, cls: unknown) => void,
    registerWidget: (widget: unknown) => void,
    registerLocale: (locale: string, phrases: unknown) => void,
  };

  CMS.registerBackend('github', GitHubBackend);

  CMS.registerWidget(DecapCmsWidgetString);
  CMS.registerWidget(DecapCmsWidgetDatetime);

  CMS.registerWidget(LexicalWidget());
  CMS.registerWidget(PortabletextEditorWidget());

  // Register every locale exposed by `decap-cms-locales`. Each export is an
  // object of phrases keyed by locale code (`en`, `fr`, …).
  for (const [code, phrases] of Object.entries(locales)) {
    CMS.registerLocale(code, phrases);
  }
}

/**
 * Mounted from the `/admin` TanStack route. Lazy-imported so the heavy
 * Decap bundle is only pulled when an editor actually visits the admin.
 */
export function DecapAdmin(): ReactNode {
  registerOnce();
  return (
    <DecapCmsProvider config={cmsConfig as Parameters<typeof DecapCmsProvider>[0]['config']}>
      <DecapApp />
    </DecapCmsProvider>
  );
}
