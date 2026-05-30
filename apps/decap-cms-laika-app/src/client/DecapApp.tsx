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
// All of the upstream "decap-cms-*" packages are consumed via the
// single-package fork `@laikacms/decap` (v4.beta branch of
// laikacms/decap-cms), which exposes them as subpath exports. `App` and
// `DecapCmsProvider` are named exports of `@laikacms/decap/core`.

import { GitHubBackend } from '@laikacms/decap/backend-github';
import DecapCmsCore, { App as DecapApp, DecapCmsProvider } from '@laikacms/decap/core';
import * as locales from '@laikacms/decap/locales';
import DecapCmsWidgetDatetime from '@laikacms/decap/widget-datetime';
import DecapCmsWidgetString from '@laikacms/decap/widget-string';
import { Widget as LexicalWidget } from 'decap-cms-widget-lexicaleditor';
import { Widget as PortabletextEditorWidget } from 'decap-cms-widget-portabletext-editor';
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
    <DecapCmsProvider config={cmsConfig}>
      <DecapApp />
    </DecapCmsProvider>
  );
}
